const express = require('express');
const RawEvent = require('../models/RawEvent');
const { applyDeterministicSummaries } = require('../services/deterministicSummary');
const { extractOtp } = require('../services/otp');

const router = express.Router();

const NOTIFICATION_RETENTION = 10;

// For SMS, pull the OTP out of the body and stash it on the payload so the
// browser-use agent can read payload.otp directly. Never overwritten by the
// later Gemini categorization (which only touches category/extracted/summaryText).
function annotateSms(items) {
  for (const item of items) {
    if (item.source === 'sms' && item.payload && typeof item.payload === 'object') {
      const otp = extractOtp(item.payload.body);
      item.payload.otp = otp; // string of digits, or null when none found
    }
  }
}

// Notifications are high-frequency and low-value to keep forever — maintain a
// rolling window of only the most recent N, dropping older ones as new arrive.
async function pruneNotifications() {
  const excess = await RawEvent.find({ source: 'notification' })
    .sort({ deviceTimestamp: -1 })
    .skip(NOTIFICATION_RETENTION)
    .select('_id');
  if (excess.length > 0) {
    await RawEvent.deleteMany({ _id: { $in: excess.map((d) => d._id) } });
  }
}

// Body: { source, payload, deviceTimestamp } or { events: [ {source, payload, deviceTimestamp}, ... ] }
router.post('/', async (req, res) => {
  try {
    const items = Array.isArray(req.body.events) ? req.body.events : [req.body];

    for (const item of items) {
      if (!item.source || !item.payload || !item.deviceTimestamp) {
        return res.status(400).json({ error: 'each event needs source, payload, deviceTimestamp' });
      }
    }

    annotateSms(items);
    await applyDeterministicSummaries(items);
    const docs = await RawEvent.insertMany(items);

    if (items.some((item) => item.source === 'notification')) {
      await pruneNotifications();
    }

    res.status(201).json({ inserted: docs.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
