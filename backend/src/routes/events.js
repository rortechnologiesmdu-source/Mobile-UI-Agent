const express = require('express');
const RawEvent = require('../models/RawEvent');
const { categorizeEvents } = require('../services/categorize');

const router = express.Router();

const VALID_SOURCES = ['sms', 'notification', 'location', 'file', 'call_log', 'activity', 'contact'];

// GET /api/events/:source?sinceHours=48&limit=20 — detail-screen feed for one data source.
router.get('/:source', async (req, res) => {
  const { source } = req.params;
  if (!VALID_SOURCES.includes(source)) {
    return res.status(400).json({ error: `unknown source: ${source}` });
  }

  try {
    const sinceHours = Number(req.query.sinceHours) || 48;
    const limit = Number(req.query.limit) || 50;
    const since = new Date(Date.now() - sinceHours * 60 * 60 * 1000);

    if (source === 'sms' || source === 'notification') {
      const unprocessed = await RawEvent.find({ source, processed: false, deviceTimestamp: { $gte: since } })
        .sort({ deviceTimestamp: -1 })
        .limit(10);
      if (unprocessed.length > 0) {
        try {
          await categorizeEvents(unprocessed);
          await Promise.all(unprocessed.map((e) => e.save()));
        } catch (err) {
          console.warn(`[events] categorization failed for ${source}:`, err.message);
        }
      }
    }

    const filter = { source, deviceTimestamp: { $gte: since } };
    // Only show location snapshots that resolved to a real place name — a raw
    // lat/lng pair isn't useful on its own (see services/deterministicSummary.js).
    if (source === 'location') {
      filter['extracted.placeName'] = { $exists: true, $ne: null };
    }

    const events = await RawEvent.find(filter)
      .sort({ deviceTimestamp: -1 })
      .limit(limit)
      .lean();

    res.json({ count: events.length, events });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
