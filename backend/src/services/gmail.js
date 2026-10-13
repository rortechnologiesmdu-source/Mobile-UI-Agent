// Read-only Gmail access (scope gmail.readonly) for Dashboard -> API and for the Decision
// Layer's "Email" capability. Plain HTTPS calls to Google — no extra libraries.
//
// Credentials: the Google OAuth client ID/secret are read on the backend from details.txt
// (lines "Client ID : ..." / "Client Secret : ..."), or GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET.
// They are never logged, returned, or sent to the phone. Having them doesn't grant mailbox
// access: the user signs in once (Mac browser -> /api/gmail/connect). The resulting token is
// kept in backend/.secrets/gmail-token.json (git-ignored, owner-only) and refreshed as needed.

const fs = require('fs');
const path = require('path');

const SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
const API = 'https://gmail.googleapis.com/gmail/v1/users/me';

const DETAILS_FILE = process.env.GOOGLE_DETAILS_FILE || path.join(__dirname, '../../../details.txt');
const SECRETS_DIR = process.env.GMAIL_SECRETS_DIR || path.join(__dirname, '../../.secrets');
const TOKEN_FILE = path.join(SECRETS_DIR, 'gmail-token.json');
const MAX_EMAILS = Number(process.env.GMAIL_MAX_EMAILS) || 50;
const FETCH_CONCURRENCY = 5;
const TIMEOUT_MS = 15000;

class GmailNotConnected extends Error {
  constructor(message = 'Gmail is not connected') {
    super(message);
    this.code = 'not_connected';
  }
}

function redirectUri() {
  return process.env.GMAIL_REDIRECT_URI || `http://localhost:${process.env.PORT || 4000}/api/gmail/oauth/callback`;
}

// { clientId, clientSecret } or null. Env wins over details.txt. Values never leave this module.
function credentials() {
  let clientId = process.env.GOOGLE_CLIENT_ID || '';
  let clientSecret = process.env.GOOGLE_CLIENT_SECRET || '';
  if ((!clientId || !clientSecret) && fs.existsSync(DETAILS_FILE)) {
    const text = fs.readFileSync(DETAILS_FILE, 'utf8');
    const value = (re) => (text.match(re)?.[1] || '').trim();
    clientId = clientId || value(/^\s*client\s*id\s*[:=]\s*(\S+)\s*$/im);
    clientSecret = clientSecret || value(/^\s*client\s*secret\s*[:=]\s*(\S+)\s*$/im);
  }
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

function readToken() {
  try {
    return JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8'));
  } catch {
    return null;
  }
}

function writeToken(token) {
  fs.mkdirSync(SECRETS_DIR, { recursive: true, mode: 0o700 });
  fs.writeFileSync(TOKEN_FILE, JSON.stringify(token), { mode: 0o600 });
}

function deleteToken() {
  try {
    fs.unlinkSync(TOKEN_FILE);
  } catch {}
}

// { configured, connected, email } — what the dashboard and the capability registry need.
function status() {
  const token = readToken();
  return { configured: Boolean(credentials()), connected: Boolean(token?.refresh_token), email: token?.email || null };
}

function authUrl(state) {
  const creds = credentials();
  if (!creds) throw new Error('Google OAuth client ID/secret not found (details.txt or GOOGLE_CLIENT_ID/SECRET)');
  const params = new URLSearchParams({
    client_id: creds.clientId,
    redirect_uri: redirectUri(),
    response_type: 'code',
    scope: SCOPE,
    access_type: 'offline', // a refresh token, so the user signs in once
    prompt: 'consent',
    include_granted_scopes: 'true',
    state,
  });
  return `${AUTH_URL}?${params}`;
}

async function postForm(url, form) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(form),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(`Google: ${body.error || res.status}${body.error_description ? ` (${body.error_description})` : ''}`);
    err.googleError = body.error;
    throw err;
  }
  return body;
}

// Called by the OAuth callback with Google's one-time code.
async function exchangeCode(code) {
  const creds = credentials();
  if (!creds) throw new Error('Google OAuth client ID/secret not found');
  const t = await postForm(TOKEN_URL, {
    code,
    client_id: creds.clientId,
    client_secret: creds.clientSecret,
    redirect_uri: redirectUri(),
    grant_type: 'authorization_code',
  });
  if (!t.refresh_token) throw new Error('Google returned no refresh token — remove this app at myaccount.google.com/permissions and connect again');
  const token = { refresh_token: t.refresh_token, access_token: t.access_token, expires_at: Date.now() + (t.expires_in - 60) * 1000, scope: t.scope };
  writeToken(token);
  try {
    const profile = await gmailGet('/profile');
    writeToken({ ...token, email: profile.emailAddress });
  } catch {}
  return status();
}

async function accessToken() {
  const token = readToken();
  if (!token?.refresh_token) throw new GmailNotConnected();
  if (token.access_token && token.expires_at > Date.now()) return token.access_token;
  const creds = credentials();
  if (!creds) throw new Error('Google OAuth client ID/secret not found');
  try {
    const t = await postForm(TOKEN_URL, {
      refresh_token: token.refresh_token,
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      grant_type: 'refresh_token',
    });
    writeToken({ ...token, access_token: t.access_token, expires_at: Date.now() + (t.expires_in - 60) * 1000 });
    return t.access_token;
  } catch (err) {
    // Revoked or expired consent: the saved token is useless — the user must connect again.
    if (err.googleError === 'invalid_grant') {
      deleteToken();
      throw new GmailNotConnected('Gmail access was revoked or expired — connect again');
    }
    throw err;
  }
}

async function gmailGet(pathAndQuery) {
  const res = await fetch(`${API}${pathAndQuery}`, {
    headers: { Authorization: `Bearer ${await accessToken()}` },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (res.status === 401) {
    deleteToken();
    throw new GmailNotConnected('Gmail access was revoked — connect again');
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Gmail API: ${body.error?.message || res.status}`);
  return body;
}

const header = (msg, name) => msg.payload?.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value || '';

// Emails received in the last `days` days (relative to now), newest first: sender, subject,
// date, snippet, id. Only metadata is fetched — never bodies. Up to `limit`; `truncated`
// says there were more.
async function listRecent({ days = 7, limit = MAX_EMAILS } = {}) {
  const since = Date.now() - days * 24 * 60 * 60 * 1000;
  const ids = [];
  let pageToken;
  let more = false;
  do {
    const params = new URLSearchParams({ q: `after:${Math.floor(since / 1000)}`, maxResults: String(Math.min(100, limit - ids.length + 1)) });
    if (pageToken) params.set('pageToken', pageToken);
    const page = await gmailGet(`/messages?${params}`);
    ids.push(...(page.messages || []).map((m) => m.id));
    pageToken = page.nextPageToken;
  } while (pageToken && ids.length <= limit);
  if (ids.length > limit || pageToken) more = true;
  const wanted = ids.slice(0, limit);

  const emails = [];
  for (let i = 0; i < wanted.length; i += FETCH_CONCURRENCY) {
    const batch = await Promise.all(
      wanted.slice(i, i + FETCH_CONCURRENCY).map((id) =>
        gmailGet(`/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`)
      )
    );
    for (const m of batch) {
      const receivedAt = Number(m.internalDate);
      if (receivedAt < since) continue; // strictly inside the window
      emails.push({ id: m.id, threadId: m.threadId, from: header(m, 'From'), subject: header(m, 'Subject'), receivedAt: new Date(receivedAt).toISOString(), snippet: m.snippet || '' });
    }
  }
  emails.sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));
  return { emails, truncated: more, days, limit };
}

// How many emails (up to `cap`) came from any of these sender domains in the last `days`.
async function countFrom(domains, { days = 90, cap = 5 } = {}) {
  const clean = domains.filter((d) => /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(d)).slice(0, 5);
  if (!clean.length) return 0;
  const q = `(${clean.map((d) => `from:${d}`).join(' OR ')}) newer_than:${days}d`;
  const page = await gmailGet(`/messages?${new URLSearchParams({ q, maxResults: String(cap) })}`);
  return (page.messages || []).length;
}

async function disconnect() {
  const token = readToken();
  deleteToken();
  if (token?.refresh_token) {
    await postForm(REVOKE_URL, { token: token.refresh_token }).catch(() => {});
  }
}

module.exports = { SCOPE, GmailNotConnected, status, authUrl, exchangeCode, listRecent, countFrom, disconnect, redirectUri };
