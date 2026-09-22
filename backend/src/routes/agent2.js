const express = require('express');
const AgentRun = require('../models/AgentRun');
const { decideNextAction } = require('../services/agentDecision');

const router = express.Router();

// Starts a new Agent 2 run for a goal. Returns the created run id.
router.post('/runs', async (req, res) => {
  try {
    const { goal } = req.body;
    if (!goal) return res.status(400).json({ error: 'goal is required' });

    const run = await AgentRun.create({ goal, status: 'running', steps: [] });
    res.status(201).json({ runId: run._id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Given the current observation, returns the next action and appends the step to the run.
router.post('/runs/:id/step', async (req, res) => {
  try {
    const run = await AgentRun.findById(req.params.id);
    if (!run) return res.status(404).json({ error: 'run not found' });
    if (run.status !== 'running') return res.status(409).json({ error: `run is ${run.status}` });

    const { currentApp, accessibilityTree, screenshotBase64 } = req.body;
    const history = run.steps.map((s) => s.action);

    const action = await decideNextAction({
      goal: run.goal,
      history,
      currentApp,
      accessibilityTree,
      screenshotBase64,
    });

    run.steps.push({ stepNumber: run.steps.length + 1, currentApp, accessibilityTree, action });

    if (action.action === 'done') {
      run.status = 'done';
      run.resultText = action.result || '';
    }

    await run.save();
    res.json({ action, stepNumber: run.steps.length, status: run.status });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/runs/:id/stop', async (req, res) => {
  try {
    const run = await AgentRun.findByIdAndUpdate(req.params.id, { status: 'stopped' }, { new: true });
    if (!run) return res.status(404).json({ error: 'run not found' });
    res.json({ status: run.status });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/runs', async (req, res) => {
  try {
    const runs = await AgentRun.find().sort({ createdAt: -1 }).limit(20).lean();
    res.json({ runs });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
