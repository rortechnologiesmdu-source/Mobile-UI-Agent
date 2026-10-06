const express = require('express');
const AgentRun = require('../models/AgentRun');
const { decideNextAction } = require('../services/agentDecision');
const { isRepeating, checkSend, REPEAT_LIMIT } = require('../services/safety');
const { snapTapToNamedTarget } = require('../services/grounding');

const router = express.Router();

// Hard step-count cap per task (MobileUse-Agent-Spec.md section 5: "safety
// rules baked in from v0.1") — stops runaway loops rather than trusting the
// model to always emit "done".
const MAX_STEPS = 15;
const MAX_REASON_CHARS = 600;
const MAX_APPS = 300;
const QUEUE_TIMEOUT_MS = 10 * 60 * 1000;
const RUNNER_ALIVE_MS = 5000;
// What the iOS app needs to show runs; leaves out the large per-step UI trees.
const LIGHT_RUN_FIELDS = '-steps.accessibilityTree -apps';
// A screen with fewer labelled elements than this right after a tap is usually still
// transitioning (an app opening); deciding from it leads to blind repeat taps.
const MIN_SETTLED_LABELS = 3;
const ACTIONS_THAT_CHANGE_SCREEN = ['tap', 'long_press', 'launch_app'];

// True when the screen looks half-drawn right after an action that changes screens.
// At most one automatic wait in a row, so screens that are genuinely sparse
// (games, video) still get a real decision next time.
function isMidTransition(steps, accessibilityTree) {
  const last = steps[steps.length - 1]?.action;
  if (!last || !ACTIONS_THAT_CHANGE_SCREEN.includes(last.action)) return false;
  const labelled = (accessibilityTree || []).filter((n) => (n.text || n.contentDescription || '').trim()).length;
  return labelled < MIN_SETTLED_LABELS;
}

// Starts a new Agent 2 run for a goal. Returns the created run id.
router.post('/runs', async (req, res) => {
  try {
    const { goal } = req.body;
    if (!goal) return res.status(400).json({ error: 'goal is required' });
    const apps = (Array.isArray(req.body.apps) ? req.body.apps : [])
      .filter((a) => a && typeof a.label === 'string' && typeof a.package === 'string')
      .slice(0, MAX_APPS)
      .map((a) => ({ label: a.label.slice(0, 80), package: a.package.slice(0, 200) }));

    // Android sends neither field, so its runs start 'running' exactly as before.
    const platform = req.body.platform === 'ios' ? 'ios' : 'android';
    const status = req.body.queued === true ? 'queued' : 'running';

    const run = await AgentRun.create({ goal, platform, status, steps: [], apps });
    res.status(201).json({ runId: run._id, status });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// When each platform's runner last asked for work — "is a runner connected?".
const lastRunnerPoll = {};

// The iOS runner polls this for the oldest queued run of its platform and takes it
// (queued -> running). Queued runs nobody picked up in time are failed rather than
// executed long after the user asked.
router.post('/runs/claim', async (req, res) => {
  try {
    const platform = req.body?.platform === 'ios' ? 'ios' : 'android';
    lastRunnerPoll[platform] = Date.now();
    const staleBefore = new Date(Date.now() - QUEUE_TIMEOUT_MS);
    await AgentRun.updateMany(
      { platform, status: 'queued', createdAt: { $lt: staleBefore } },
      { status: 'failed', resultText: `No ${platform} runner picked this up within ${QUEUE_TIMEOUT_MS / 60000} minutes.` }
    );
    const run = await AgentRun.findOneAndUpdate(
      { platform, status: 'queued' },
      { status: 'running' },
      { sort: { createdAt: 1 }, new: true }
    );
    if (!run) return res.status(204).end();
    console.log(`[agent2] ${platform} runner claimed run ${run._id}: ${run.goal}`);
    res.json({ runId: run._id, goal: run.goal });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/runner', (req, res) => {
  const platform = req.query.platform === 'ios' ? 'ios' : 'android';
  const last = lastRunnerPoll[platform];
  res.json({ platform, connected: Boolean(last && Date.now() - last < RUNNER_ALIVE_MS) });
});

// Given the current observation, returns the next action and appends the step to the run.
router.post('/runs/:id/step', async (req, res) => {
  try {
    const run = await AgentRun.findById(req.params.id);
    if (!run) return res.status(404).json({ error: 'run not found' });
    if (run.status !== 'running') return res.status(409).json({ error: `run is ${run.status}` });

    const { currentApp, accessibilityTree, screenshotBase64, screenWidth, screenHeight } = req.body;
    // Each past action carries the model's reasoning for it, so the model can tell
    // what it has already done (e.g. that the message was already sent).
    const history = run.steps.map((s) => (s.reason ? { ...s.action, reason: s.reason } : s.action));

    const midTransition = isMidTransition(run.steps, accessibilityTree);
    if (midTransition) console.log(`[agent2] screen still changing in ${currentApp}; auto-wait`);
    const decided = midTransition
      ? { action: { action: 'wait' }, reason: 'The screen is still changing after the last action; waiting before deciding.' }
      : await decideNextAction({
          goal: run.goal,
          history,
          currentApp,
          accessibilityTree,
          screenshotBase64,
          apps: run.apps || [],
        });
    const { reason } = decided;
    let { action } = decided;

    // iOS only (Android behaves exactly as before): move a tap onto the element the
    // model named when its point missed it.
    if (run.platform === 'ios') {
      const snap = snapTapToNamedTarget({ action, reason, accessibilityTree, screenWidth, screenHeight });
      if (snap.snappedTo) {
        console.log(
          `[agent2] ios: tap moved onto "${snap.snappedTo}": ${JSON.stringify(action.target.point)} -> ${JSON.stringify(snap.action.target.point)}`
        );
        action = snap.action;
      }
    }

    const repeating = isRepeating(
      run.steps.map((s) => s.action),
      action
    );
    const send = repeating
      ? null
      : checkSend({ goal: run.goal, action, accessibilityTree, screenWidth, screenHeight, currentApp });
    const confirm = send?.confirm || null;

    run.steps.push({
      stepNumber: run.steps.length + 1,
      currentApp,
      accessibilityTree,
      action,
      reason: (reason || '').slice(0, MAX_REASON_CHARS),
    });

    if (action.action === 'done') {
      run.status = 'done';
      run.resultText = action.result || '';
    } else if (repeating) {
      // Not executed by the phone: it stops as soon as the run isn't running.
      run.status = 'failed';
      run.resultText = `Stopped: chose the same ${action.action} ${REPEAT_LIMIT} times in a row and the screen didn't change.`;
    } else if (send?.block) {
      // Wrong recipient selected: never executed, and not worth asking about.
      run.status = 'failed';
      run.resultText = send.block;
    } else if (confirm) {
      // Sending is the end of the task; the phone asks the user first and stops the
      // run (with a cancelled reason) if they decline.
      run.status = 'done';
      run.resultText = send.kind === 'call' ? 'Call started after your confirmation.' : 'Sent after your confirmation.';
    } else if (run.steps.length >= MAX_STEPS) {
      run.status = 'failed';
      run.resultText = `Stopped: exceeded the ${MAX_STEPS}-step safety cap without finishing.`;
    }

    await run.save();
    if (run.status !== 'running') console.log(`[agent2] run ${run._id} ${run.status}: ${run.resultText}`);
    res.json({ action, stepNumber: run.steps.length, status: run.status, resultText: run.resultText, confirm });
  } catch (err) {
    console.error(`[agent2] step failed for run ${req.params.id}: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

router.post('/runs/:id/stop', async (req, res) => {
  try {
    const update = { status: 'stopped' };
    if (typeof req.body?.reason === 'string' && req.body.reason) update.resultText = req.body.reason.slice(0, 200);
    const run = await AgentRun.findByIdAndUpdate(req.params.id, update, { new: true });
    if (!run) return res.status(404).json({ error: 'run not found' });
    res.json({ status: run.status });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Without ?platform (the Android app) this returns exactly what it always has.
// With ?platform=ios it returns only that platform's runs, without the UI trees.
router.get('/runs', async (req, res) => {
  try {
    const { platform } = req.query;
    const query = platform ? AgentRun.find({ platform }).select(LIGHT_RUN_FIELDS) : AgentRun.find();
    const runs = await query.sort({ createdAt: -1 }).limit(20).lean();
    res.json({ runs });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// One run with its steps (actions and reasoning), for following it live.
router.get('/runs/:id', async (req, res) => {
  try {
    const run = await AgentRun.findById(req.params.id).select(LIGHT_RUN_FIELDS).lean();
    if (!run) return res.status(404).json({ error: 'run not found' });
    res.json({ run });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
