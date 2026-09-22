const express = require('express');
const RawEvent = require('../models/RawEvent');
const { categorizeEvents } = require('../services/categorize');

const router = express.Router();

const SOURCES = ['sms', 'notification', 'location', 'file', 'call_log'];
const WINDOW_HOURS = 48;

// Categorizes a small batch of unprocessed sms/notification events (the only
// sources that need an LLM — see services/deterministicSummary.js for the rest),
// then returns per-source tile summaries for the dashboard. Categorization
// failures/slow responses never block the response.
router.get('/summary', async (req, res) => {
  try {
    const unprocessed = await RawEvent.find({ processed: false, source: { $in: ['sms', 'notification'] } })
      .sort({ deviceTimestamp: -1 })
      .limit(10);
    if (unprocessed.length > 0) {
      try {
        await categorizeEvents(unprocessed);
        await Promise.all(unprocessed.map((e) => e.save()));
      } catch (err) {
        console.warn('[dashboard] categorization failed, showing uncategorized events:', err.message);
      }
    }

    const since = new Date(Date.now() - WINDOW_HOURS * 60 * 60 * 1000);

    const tiles = {};
    await Promise.all(
      SOURCES.map(async (source) => {
        const count = await RawEvent.countDocuments({ source, deviceTimestamp: { $gte: since } });
        const latest = await RawEvent.findOne({ source, deviceTimestamp: { $gte: since } })
          .sort({ deviceTimestamp: -1 })
          .lean();
        tiles[source] = {
          count,
          latestSummary: latest?.summaryText ?? null,
          latestAt: latest?.deviceTimestamp ?? null,
        };
      })
    );

    const recentEvents = await RawEvent.find({ deviceTimestamp: { $gte: since } })
      .sort({ deviceTimestamp: -1 })
      .limit(20)
      .lean();

    res.json({ tiles, events: recentEvents });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
