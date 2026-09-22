const express = require('express');
const RawEvent = require('../models/RawEvent');
const { categorizeEvents } = require('../services/categorize');

const router = express.Router();

const SOURCES = ['sms', 'notification', 'location', 'file', 'call_log'];
// Matches each source's detail-screen window (see the mobile detail screens) so
// tile counts agree with what tapping through actually shows.
const WINDOW_HOURS_BY_SOURCE = {
  sms: 120,
  notification: 24 * 30, // pruned to the latest 10 anyway, window just needs to not exclude them
  location: 48,
  file: 168,
  call_log: 48,
};
const DEFAULT_WINDOW_HOURS = 48;

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

    const tiles = {};
    await Promise.all(
      SOURCES.map(async (source) => {
        const windowHours = WINDOW_HOURS_BY_SOURCE[source] ?? DEFAULT_WINDOW_HOURS;
        const since = new Date(Date.now() - windowHours * 60 * 60 * 1000);
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

    const widestSince = new Date(Date.now() - Math.max(...Object.values(WINDOW_HOURS_BY_SOURCE)) * 60 * 60 * 1000);
    const recentEvents = await RawEvent.find({ deviceTimestamp: { $gte: widestSince } })
      .sort({ deviceTimestamp: -1 })
      .limit(20)
      .lean();

    res.json({ tiles, events: recentEvents });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
