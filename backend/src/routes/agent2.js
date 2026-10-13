const express = require('express');
const AgentRun = require('../models/AgentRun');
const MobileAgentResult = require('../models/MobileAgentResult');
const { decideNextAction } = require('../services/agentDecision');
const { decideTwoAgent } = require('../services/orchestrator');
const { isRepeating, checkSend, REPEAT_LIMIT } = require('../services/safety');
const { snapTapToNamedTarget } = require('../services/grounding');
const qwen = require('../services/qwenClient');
const { screenLabels, labelSimilarity } = require('../services/screen');

const router = express.Router();

// Hard step-count cap per task (MobileUse-Agent-Spec.md section 5: "safety
// rules baked in from v0.1") — stops runaway loops rather than trusting the
// model to always emit "done".
const MAX_STEPS = 15;
// Two-agent runs take one simple step per turn and can cross apps (read orders in
// Amazon, then send them on WhatsApp) — that needs more steps.
const MAX_STEPS_TWO_AGENT = Number(process.env.MAX_STEPS_TWO_AGENT) || 30;
// Facts kept in a run's memory (each up to 500 chars: full product names are long).
const MAX_MEMORY = 200;
const MAX_REASON_CHARS = 600;
const MAX_APPS = 300;
const QUEUE_TIMEOUT_MS = 10 * 60 * 1000;
const RUNNER_ALIVE_MS = 5000;
// What the iOS app needs to show runs; leaves out the large per-step UI trees.
const LIGHT_RUN_FIELDS = '-steps.accessibilityTree -apps';
const ACTIONS_THAT_CHANGE_SCREEN = ['tap', 'long_press', 'launch_app', 'press_back', 'press_home'];
// Model server (for pre-warming a model while the screen settles).
const MODEL_BASE_URL = (process.env.MAI_UI_BASE_URL || 'http://127.0.0.1:8080').replace(/\/+$/, '');
// How many "still settling" waits we allow after a screen-changing action before we
// decide anyway, so a slow/forever-animating screen can't stall the run.
const MAX_SETTLE_WAITS = Number(process.env.SETTLE_MAX_WAITS) || 4;
// The screen counts as loaded once this share of its labels is the same across two
// consecutive captures. Not 100%: feeds (Amazon, YouTube) keep streaming a few items and
// would otherwise always wait the full MAX_SETTLE_WAITS.
const SETTLE_SIMILARITY = Number(process.env.SETTLE_SIMILARITY) || 0.9;
// Per-run settle tracking: the last capture's labels + how many times we've waited.
// In-memory (runs are short-lived; a backend restart just means we re-settle, which is safe).
const settleState = new Map();

// Adds Qwen's new facts to the run's memory, skipping ones it already has.
// Two facts about the same thing often differ only in wording ("Order: Aristocrat Comet
// Cabin ..." vs "Aristocrat Comet Cabin ..., Order placed 8 Oct"): compare them without a
// leading "Label:", case and punctuation, on their first 40 letters/digits.
const FACT_KEY_CHARS = 40;
const factKey = (f) =>
  String(f)
    .replace(/^\s*[a-z][a-z ]{0,15}:\s*/i, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
    .slice(0, FACT_KEY_CHARS);

function addToMemory(run, facts) {
  const key = factKey;
  const seen = new Set((run.memory || []).map(key));
  const added = [];
  for (const fact of facts || []) {
    const k = key(fact);
    if (!k || seen.has(k) || run.memory.length >= MAX_MEMORY) continue;
    run.memory.push(String(fact).slice(0, 500));
    seen.add(k);
    added.push(fact);
  }
  return added;
}

// Saves the run's task and final data to the `mobileagent` collection (one record per run,
// updated if the run ends twice — e.g. done, then the user cancels the Send confirmation; a
// later save never wipes data an earlier one stored).
async function saveResult(run, data, items) {
  try {
    await MobileAgentResult.updateOne(
      { runId: run._id },
      {
        $set: {
          task: run.goal,
          status: run.status,
          resultText: run.resultText ?? null,
          platform: run.platform || 'android',
          steps: run.steps?.length || 0,
          startedAt: run.createdAt,
          finishedAt: new Date(),
          ...(data != null && { data }),
          ...(items.length && { items }),
        },
        $setOnInsert: { runId: run._id, ...(data == null && { data: null }), ...(!items.length && { items: [] }) },
      },
      { upsert: true }
    );
    console.log(
      `[agent2] run ${run._id} saved to mobileagent: ${run.status}, ` +
        `${data != null ? `data ${JSON.stringify(data).slice(0, 120)}` : 'no data'}, ${items.length} items`
    );
  } catch (err) {
    console.error(`[agent2] run ${run._id} saving to mobileagent failed: ${err.message}`);
  }
}

// Empty extraction results: null, [], {} or an object whose values are all empty.
const isEmptyData = (d) =>
  d == null ||
  (Array.isArray(d) ? !d.length : typeof d === 'object' && !Object.values(d).some((v) => v != null && !(Array.isArray(v) && !v.length)));

// When a run ends (done, failed or stopped): Qwen turns what the run collected into
// structured JSON (e.g. a list of orders) — kept on the run as `extracted` and saved with the
// task to the `mobileagent` collection, together with the collected items themselves. Then
// the working memory (plan + facts) is wiped — it only lives for the run. Runs after the phone
// already has its answer.
async function finishRun(run) {
  const items = [...(run.memory || [])];
  const answer = run.status === 'done' && run.resultText ? run.resultText : '';
  // The data comes from the items collected; when none were saved but the run finished with
  // an answer (e.g. "Items in the cart: X, Y"), from that answer.
  const observations = items.length ? items : answer ? [answer] : [];
  let data = null;
  if (observations.length) {
    try {
      data = await qwen.extract({ task: run.goal, observations });
      console.log(`[agent2] run ${run._id} extracted: ${JSON.stringify(data).slice(0, 300)}`);
    } catch (err) {
      console.error(`[agent2] run ${run._id} extraction failed: ${err.message}`);
    }
    // Never save an empty result when something was collected.
    if (isEmptyData(data)) data = items.length ? { items } : { answer };
  }
  await saveResult(run, data, items);
  if (!run.memory?.length && !run.plan) return;
  await AgentRun.updateOne({ _id: run._id }, { ...(data != null && { extracted: data }), memory: [], plan: null }).catch(
    (err) => console.error(`[agent2] run ${run._id} clearing working memory failed: ${err.message}`)
  );
}

// Qwen's first look at the task: goals + ordered parts. A single-part plan (the task as
// is) if that fails, so the run still goes ahead.
async function makePlan(run) {
  try {
    const { goals, parts, missing } = await qwen.plan({ task: run.goal, apps: run.apps || [] });
    if (missing) return { goals, parts, current: 0, missing };
    if (parts.length) return { goals, parts, current: 0 };
  } catch (err) {
    console.error(`[agent2] run ${run._id} planning failed, using the task as one part: ${err.message}`);
  }
  return { goals: [run.goal], parts: [{ goal: run.goal, app: '', done_when: '' }], current: 0 };
}

// Fire-and-forget: tell the model server to make `model` resident now, so the (~6-9s)
// swap overlaps the screen settling instead of blocking the next decision. We don't await
// the full load — the server finishes it under its lock; the aborted request is harmless.
function prewarm(model) {
  fetch(`${MODEL_BASE_URL}/warm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model }),
    signal: AbortSignal.timeout(2000),
  }).catch(() => {});
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

    // Wait for the screen to settle after a screen-changing action BEFORE deciding, so the
    // planner/grounder never act on a half-loaded screen (which caused taps to miss). The
    // screen is "settled" once SETTLE_SIMILARITY of its labels match across two consecutive
    // captures, or we hit the wait cap. With MODELS_RESIDENT=one on the model server, the
    // pre-warm overlaps the planner's load with this wait (with both resident it's a no-op).
    const runKey = String(run._id);
    const lastAction = run.steps[run.steps.length - 1]?.action;
    if (lastAction && ACTIONS_THAT_CHANGE_SCREEN.includes(lastAction.action)) {
      const labels = screenLabels(accessibilityTree);
      const prev = settleState.get(runKey);
      if (!prev || (labelSimilarity(prev.labels, labels) < SETTLE_SIMILARITY && prev.waits < MAX_SETTLE_WAITS)) {
        const waits = (prev?.waits || 0) + 1;
        settleState.set(runKey, { labels, waits });
        prewarm('qwen'); // load the planner during the wait so deciding is instant after
        console.log(`[agent2] screen settling in ${currentApp} (wait ${waits}/${MAX_SETTLE_WAITS})`);
        return res.json({ action: { action: 'wait' }, stepNumber: run.steps.length, status: 'running', resultText: '', confirm: null });
      }
    }
    settleState.delete(runKey); // settled (or not a transition) — decide on this screen

    // Two-agent (Qwen plans/checks/remembers each step, MAI-UI-2B grounds) when
    // AGENT_MODE=two_agent; otherwise the single-model path (AGENT_BACKEND).
    const twoAgent = (process.env.AGENT_MODE || '').trim().toLowerCase() === 'two_agent';
    const maxSteps = twoAgent ? MAX_STEPS_TWO_AGENT : MAX_STEPS;
    // First step: Qwen understands the task and makes the plan (kept in working memory).
    if (twoAgent && !run.plan) run.plan = await makePlan(run);
    // The task leaves out something it needs (e.g. who to send to): stop now and say what,
    // instead of guessing it.
    if (twoAgent && run.plan?.missing && run.status === 'running' && !run.steps.length) {
      run.status = 'failed';
      run.resultText = `Need more information: ${run.plan.missing}. Add it to the task and run it again.`;
      await run.save();
      console.log(`[agent2] run ${run._id} failed: ${run.resultText}`);
      res.json({ action: { action: 'done', result: run.resultText }, stepNumber: 0, status: run.status, resultText: run.resultText, confirm: null });
      finishRun(run);
      return;
    }
    const decided = twoAgent
      ? await decideTwoAgent({
          goal: run.goal,
          steps: run.steps.map((s) => (s.toObject ? s.toObject() : s)), // plain objects, safe to copy
          memory: run.memory || [],
          plan: run.plan,
          currentApp,
          accessibilityTree,
          screenshotBase64,
          apps: run.apps || [],
          platform: run.platform,
          screenWidth,
          screenHeight,
        })
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

    // Qwen's verdict on the previous step (seeing this screen) and the facts it saved.
    const prevStep = run.steps[run.steps.length - 1];
    if (twoAgent && prevStep) {
      if (prevStep.ok == null && typeof decided.lastOk === 'boolean') prevStep.ok = decided.lastOk;
      if (decided.check && !prevStep.check) prevStep.check = decided.check.slice(0, MAX_REASON_CHARS);
    }
    if (twoAgent && decided.remember?.length) {
      const added = addToMemory(run, decided.remember);
      if (added.length) console.log(`[agent2] memory +${added.length}: ${added.join(' | ').slice(0, 200)}`);
    }
    if (twoAgent && run.plan && Number.isInteger(decided.planCurrent) && decided.planCurrent !== run.plan.current) {
      // Reassign (plan is Mixed). The new part starts at this step, and its facts after the
      // ones saved by this reply (those finished the previous part).
      run.plan = { ...run.plan, current: decided.planCurrent, partStart: decided.planPartStart, memStart: run.memory.length };
    }

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
      instruction: (decided.instruction || '').slice(0, MAX_REASON_CHARS),
      resolvedVia: decided.resolvedVia || null,
      ok: typeof decided.ok === 'boolean' ? decided.ok : null,
      memoryCount: run.memory?.length || 0,
    });

    if (action.action === 'done') {
      run.status = 'done';
      run.resultText = action.result || '';
    } else if (decided.stop) {
      // The same step failing again: not executed, the run ends here.
      run.status = 'failed';
      run.resultText = decided.stop;
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
      run.resultText =
        send.kind === 'call'
          ? 'Call started after your confirmation.'
          : send.kind === 'pay'
            ? 'Order/payment step tapped after your confirmation.'
            : 'Sent after your confirmation.';
    } else if (run.steps.length >= maxSteps) {
      run.status = 'failed';
      run.resultText = `Stopped: exceeded the ${maxSteps}-step safety cap without finishing.`;
    }

    await run.save();
    if (run.status !== 'running') {
      settleState.delete(runKey);
      console.log(`[agent2] run ${run._id} ${run.status}: ${run.resultText}`);
    }
    res.json({ action, stepNumber: run.steps.length, status: run.status, resultText: run.resultText, confirm });
    if (run.status !== 'running') finishRun(run);
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
    settleState.delete(String(run._id));
    res.json({ status: run.status });
    finishRun(run);
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
