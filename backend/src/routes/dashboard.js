const express = require('express');
const RawEvent = require('../models/RawEvent');
const { categorizeEvents } = require('../services/categorize');

const router = express.Router();

// Categorizes a small batch of unprocessed events, then returns today's events for
// the dashboard. Categorization failures/slow responses never block the response —
// the dashboard should always render, even if some events are still uncategorized.
router.get('/summary', async (req, res) => {
  try {
    const unprocessed = await RawEvent.find({ processed: false })
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

    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const todaysEvents = await RawEvent.find({
      deviceTimestamp: { $gte: startOfDay },
    })
      .sort({ deviceTimestamp: -1 })
      .lean();

    res.json({
      count: todaysEvents.length,
      events: todaysEvents,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
