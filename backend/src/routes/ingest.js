const express = require('express');
const RawEvent = require('../models/RawEvent');
const { applyDeterministicSummaries } = require('../services/deterministicSummary');

const router = express.Router();

// Body: { source, payload, deviceTimestamp } or { events: [ {source, payload, deviceTimestamp}, ... ] }
router.post('/', async (req, res) => {
  try {
    const items = Array.isArray(req.body.events) ? req.body.events : [req.body];

    for (const item of items) {
      if (!item.source || !item.payload || !item.deviceTimestamp) {
        return res.status(400).json({ error: 'each event needs source, payload, deviceTimestamp' });
      }
    }

    await applyDeterministicSummaries(items);
    const docs = await RawEvent.insertMany(items);
    res.status(201).json({ inserted: docs.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
