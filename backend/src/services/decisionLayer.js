// Decision Layer: which data-collection methods may work for an app, in priority order.
// Qwen3.5 (its own endpoint on the model server, /methods — separate from the MobileUse
// agent's endpoints, same loaded model) proposes methods with reasons; this file validates
// the proposal against the capability registry before anything is shown:
//   - unknown method ids are rejected; data types must be from the allowed list
//   - every status comes from the registry, never from the model
//   - Email is checked against the real mailbox (the senders Qwen suggests must have mail)
//   - order is the fixed default priority: API, MCP, Email, Phone Data, MobileUse, BrowserUse
// Only plain values are taken from the model — never code or instructions.

const AppAccess = require('../models/AppAccess');
const qwen = require('./qwenClient');
const gmail = require('./gmail');
const { METHODS, KNOWN_SENDERS, requestedDataTypes, capabilitiesFor } = require('./capabilities');

const PENDING_STALE_MS = 3 * 60 * 1000; // an analysis "pending" longer than this was lost
const DOMAIN = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i;

// Plain one-line text only (no code fences, markup or newlines), capped.
const cleanText = (s, max = 200) =>
  String(s || '')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/[`<>{}]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);

const validDomains = (list) =>
  (Array.isArray(list) ? list : []).map((d) => String(d).trim().toLowerCase().replace(/^@/, '')).filter((d) => DOMAIN.test(d)).slice(0, 5);

// Validated, prioritised methods from Qwen's proposal + the registry. Also returns what was
// rejected (for the log). `askSenders` (optional) asks Qwen only for an app's email sender
// domains, when neither its proposal nor the maintained list has them.
async function validate(proposal, caps, requested, { pkg, askSenders } = {}) {
  const rejected = [];
  const proposed = new Map();
  for (const p of Array.isArray(proposal) ? proposal : []) {
    const method = typeof p?.method === 'string' ? p.method.trim().toLowerCase() : '';
    if (!METHODS.includes(method)) {
      rejected.push(`unknown method "${cleanText(p?.method, 40)}"`);
      continue;
    }
    if (!proposed.has(method)) proposed.set(method, p);
  }

  const methods = [];
  for (const cap of caps) {
    const p = proposed.get(cap.method);
    const allowedTypes = cap.supported_data_types.filter((t) => requested.includes(t));
    const proposedTypes = Array.isArray(p?.supported_data_types) ? p.supported_data_types.filter((t) => typeof t === 'string') : [];
    const badTypes = proposedTypes.filter((t) => !allowedTypes.includes(t));
    if (badTypes.length) rejected.push(`${cap.method}: invalid data types ${badTypes.slice(0, 3).join(', ')}`);
    const goodTypes = proposedTypes.filter((t) => allowedTypes.includes(t));
    const entry = {
      method: cap.method,
      status: cap.status,
      supported_data_types: goodTypes.length ? goodTypes : allowedTypes,
      reason: cap.note,
    };

    // Email: Gmail is connected -> look for real mail from the senders Qwen suggests.
    if (cap.method === 'email' && cap.status === 'unverified') {
      // The maintained list and Qwen's suggestions together (either alone can miss a sender).
      let senders = [...new Set([...((pkg && KNOWN_SENDERS[pkg]) || []), ...validDomains(p?.email_senders)])].slice(0, 5);
      if (!senders.length && askSenders) senders = validDomains(await askSenders().catch(() => []));
      if (!senders.length) {
        entry.reason = 'Gmail is connected, but no sender for this app was identified.';
      } else {
        try {
          const found = await gmail.countFrom(senders);
          entry.status = found ? 'available' : 'unverified';
          entry.reason = found
            ? `Recent emails from ${senders.join(', ')} found in Gmail.`
            : `No emails from ${senders.join(', ')} in the last 90 days.`;
        } catch (err) {
          entry.status = err.code === 'not_connected' ? 'requires_connection' : 'temporarily_unavailable';
          entry.reason = err.code === 'not_connected' ? 'Connect Gmail (read-only) to use emails from this app.' : `Gmail check failed: ${cleanText(err.message, 120)}`;
        }
      }
    } else if (p?.reason && cap.status === 'available') {
      // The model's short explanation, only where the method is actually available — for any
      // other status the registry's factual note is shown (no "can collect…" promises).
      entry.reason = cleanText(p.reason) || cap.note;
    }
    methods.push(entry);
  }
  methods.sort((a, b) => METHODS.indexOf(a.method) - METHODS.indexOf(b.method));
  methods.forEach((m, i) => (m.priority = i + 1));
  return { methods, rejected };
}

// Runs the analysis for one app (record from the appaccess collection).
async function analyzeApp(doc) {
  const app = { package: doc.package, label: doc.label, category: doc.userCategory || doc.category, access: doc.access === true };
  const requested = requestedDataTypes(app.category);
  const caps = await capabilitiesFor(app); // if the registry can't be read, the analysis fails — nothing guessed
  const response = await qwen.methods({
    app: { package_name: app.package, display_name: app.label, category: app.category },
    requested_data_types: requested,
    available_capabilities: caps.map(({ method, status, supported_data_types, note }) => ({ method, status, supported_data_types, note })),
  });
  // Gmail connected but no sender named: ask Qwen just for this app's sender domains.
  const emailCap = caps.find((c) => c.method === 'email');
  const askSenders = async () => {
    const r = await qwen.methods({
      app: { package_name: app.package, display_name: app.label, category: app.category },
      requested_data_types: emailCap.supported_data_types,
      available_capabilities: [{ method: 'email', status: emailCap.status, supported_data_types: emailCap.supported_data_types, note: 'List the sender domains this app emails from.' }],
    });
    return (r.candidate_methods || []).find((m) => m?.method === 'email')?.email_senders || [];
  };
  const { methods, rejected } = await validate(response.candidate_methods, caps, requested, { pkg: app.package, askSenders });
  if (rejected.length) console.log(`[decision] ${app.package}: rejected from model output: ${rejected.join('; ')}`);
  return { status: 'completed', methods, error: null, analyzedAt: new Date() };
}

// Starts (or restarts) the analysis in the background and returns the app's record with
// status "pending"; the record is updated to "completed" or "failed" when it ends.
async function startAnalysis(pkg) {
  const doc = await AppAccess.findOne({ package: pkg }).lean();
  if (!doc) return null;
  const a = doc.analysis || {};
  if (a.status === 'pending' && a.startedAt && Date.now() - new Date(a.startedAt).getTime() < PENDING_STALE_MS) return doc;
  const pending = { status: 'pending', methods: [], error: null, analyzedAt: a.analyzedAt || null, startedAt: new Date() };
  const updated = await AppAccess.findOneAndUpdate({ package: pkg }, { $set: { analysis: pending } }, { new: true, lean: true });
  console.log(`[decision] analysing ${pkg}`);
  analyzeApp(updated)
    .then((analysis) => {
      console.log(`[decision] ${pkg}: ${analysis.methods.map((m) => `${m.priority}.${m.method}=${m.status}`).join(' ')}`);
      return AppAccess.updateOne({ package: pkg }, { $set: { analysis } });
    })
    .catch((err) => {
      console.error(`[decision] ${pkg} analysis failed: ${err.message}`);
      return AppAccess.updateOne({ package: pkg }, { $set: { analysis: { status: 'failed', methods: [], error: cleanText(err.message, 200), analyzedAt: new Date() } } });
    })
    .catch(() => {});
  return updated;
}

module.exports = { analyzeApp, startAnalysis, validate };
