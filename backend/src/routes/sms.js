// Read-only SMS access for the browser-use agent (OTP retrieval).
//
// The same data is in Mongo directly:
//   db = "mobileuse", collection = "rawevents", filter { source: "sms" }
//   latest: .find({ source: "sms" }).sort({ deviceTimestamp: -1 }).limit(1)
//   OTP is at payload.otp (also payload.body for the full text).
//
// These endpoints are just a convenience wrapper over that query.
const express = require('express');
const RawEvent = require('../models/RawEvent');
const { extractOtp } = require('../services/otp');

const router = express.Router();

// Shape returned to the agent: full detail plus the parsed OTP.
function present(doc) {
  if (!doc) return null;
  const p = doc.payload || {};
  return {
    _id: doc._id,
    sender: p.sender ?? null,
    body: p.body ?? null,
    // Stored at ingest; fall back to parsing on read for older rows.
    otp: p.otp ?? extractOtp(p.body) ?? null,
    payload: p,
    deviceTimestamp: doc.deviceTimestamp,
    receivedAt: doc.receivedAt,
  };
}

// Builds the Mongo filter from query params, all optional:
//   sender=VM-AMAZON     sender contains this (case-insensitive)
//   contains=Amazon      body contains this (case-insensitive)
//   withinSeconds=120    only messages newer than N seconds (freshness guard)
//   otpOnly=true         only messages that have an extracted OTP
function buildFilter(query) {
  const filter = { source: 'sms' };
  if (query.sender) filter['payload.sender'] = { $regex: escapeRegex(query.sender), $options: 'i' };
  if (query.contains) filter['payload.body'] = { $regex: escapeRegex(query.contains), $options: 'i' };
  if (query.otpOnly === 'true') filter['payload.otp'] = { $ne: null };
  const within = Number(query.withinSeconds);
  if (Number.isFinite(within) && within > 0) {
    filter.deviceTimestamp = { $gte: new Date(Date.now() - within * 1000) };
  }
  return filter;
}

const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// GET /api/sms/latest — the newest matching SMS (or 404 when none match).
router.get('/latest', async (req, res) => {
  try {
    const doc = await RawEvent.findOne(buildFilter(req.query)).sort({ deviceTimestamp: -1, _id: -1 }).lean();
    if (!doc) return res.status(404).json({ error: 'no matching sms' });
    res.json({ sms: present(doc) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/sms — latest N matching messages (default 20, max 100).
router.get('/', async (req, res) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100);
    const docs = await RawEvent.find(buildFilter(req.query))
      .sort({ deviceTimestamp: -1, _id: -1 })
      .limit(limit)
      .lean();
    res.json({ count: docs.length, messages: docs.map(present) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
