const { getTextModel } = require('../config/gemini');

const PROMPT = `You are categorizing raw Android events for a personal dashboard.
For each event below, return a JSON array (same order, same length) where each item is:
{ "category": string, "extracted": object|null, "summaryText": string }

Rules:
- "category" is a short label, e.g. "bank_debit", "bank_credit", "order_update", "otp", "message", "other".
- "extracted" pulls structured fields when present (amount, merchant, date) or null if none apply.
- "summaryText" is one short plain-English sentence for a dashboard feed.
Respond with ONLY the JSON array, no markdown fences, no commentary.

Events:
`;

function eventToPromptLine(event) {
  return JSON.stringify({
    source: event.source,
    payload: event.payload,
    deviceTimestamp: event.deviceTimestamp,
  });
}

function parseModelJson(text) {
  const cleaned = text.trim().replace(/^```json/i, '').replace(/^```/, '').replace(/```$/, '').trim();
  return JSON.parse(cleaned);
}

// Sends a batch of unprocessed RawEvent docs to Gemini and mutates them in place
// with category/extracted/summaryText. Caller is responsible for saving.
async function categorizeEvents(events) {
  if (events.length === 0) return events;

  const model = getTextModel();
  const prompt = PROMPT + events.map(eventToPromptLine).join('\n');
  const result = await model.generateContent(prompt, { timeout: 20000 });
  const text = result.response.text();

  let parsed;
  try {
    parsed = parseModelJson(text);
  } catch (err) {
    throw new Error(`Gemini categorization returned unparseable JSON: ${err.message}`);
  }

  if (!Array.isArray(parsed) || parsed.length !== events.length) {
    throw new Error('Gemini categorization returned a mismatched array length');
  }

  events.forEach((event, i) => {
    event.category = parsed[i].category ?? 'other';
    event.extracted = parsed[i].extracted ?? null;
    event.summaryText = parsed[i].summaryText ?? '';
    event.processed = true;
  });

  return events;
}

module.exports = { categorizeEvents };
