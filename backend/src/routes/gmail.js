const crypto = require('crypto');
const express = require('express');
const gmail = require('../services/gmail');

const router = express.Router();

// One-time `state` values for the sign-in round trip (CSRF protection), 10 minutes each.
const pendingStates = new Map();
const STATE_TTL_MS = 10 * 60 * 1000;
const MAX_DAYS = 31;

const page = (title, body) =>
  `<!doctype html><meta charset="utf-8"><title>${title}</title><body style="font-family:sans-serif;padding:32px">` +
  `<h2>${title}</h2><p>${body}</p></body>`;
const escapeHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

router.get('/status', (req, res) => {
  const s = gmail.status();
  res.json({ ...s, connectUrl: s.configured ? `http://localhost:${process.env.PORT || 4000}/api/gmail/connect` : null });
});

// Open in the Mac's browser: Google sign-in and consent (read-only), then back to /oauth/callback.
router.get('/connect', (req, res) => {
  try {
    const state = crypto.randomBytes(16).toString('hex');
    pendingStates.set(state, Date.now() + STATE_TTL_MS);
    res.redirect(gmail.authUrl(state));
  } catch (err) {
    res.status(500).send(page('Gmail not configured', escapeHtml(err.message)));
  }
});

router.get('/oauth/callback', async (req, res) => {
  const { code, state, error } = req.query;
  const expires = pendingStates.get(state);
  pendingStates.delete(state);
  if (error) return res.status(400).send(page('Gmail not connected', `Google said: ${escapeHtml(error)}`));
  if (!code || !expires || expires < Date.now()) {
    return res.status(400).send(page('Gmail not connected', 'This sign-in link expired or was not started here. Open /api/gmail/connect again.'));
  }
  try {
    const s = await gmail.exchangeCode(String(code));
    console.log(`[gmail] connected${s.email ? ` (${s.email})` : ''}`);
    res.send(page('Gmail connected', `Read-only access${s.email ? ` for ${escapeHtml(s.email)}` : ''} is set up. You can close this tab.`));
  } catch (err) {
    console.error(`[gmail] connect failed: ${err.message}`);
    res.status(500).send(page('Gmail not connected', escapeHtml(err.message)));
  }
});

// Emails from the last `days` days (default 7): sender, subject, received time, snippet, id.
router.get('/recent', async (req, res) => {
  const days = Math.min(MAX_DAYS, Math.max(1, Number(req.query.days) || 7));
  const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
  try {
    res.json(await gmail.listRecent({ days, limit }));
  } catch (err) {
    if (err.code === 'not_connected') return res.status(409).json({ error: 'not_connected', message: err.message, ...gmail.status() });
    res.status(502).json({ error: 'gmail_failed', message: err.message });
  }
});

router.post('/disconnect', async (req, res) => {
  await gmail.disconnect();
  console.log('[gmail] disconnected');
  res.json(gmail.status());
});

module.exports = router;
