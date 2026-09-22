// Location, file, and call-log events get a templated summary instead of a Gemini
// call — the fields are already structured on-device, so there's nothing for an
// LLM to extract. Only 'sms' and 'notification' (unstructured text) go through
// Gemini categorization (see services/categorize.js).
const { reverseGeocode } = require('./geocode');

const DETERMINISTIC_SOURCES = new Set(['location', 'file', 'call_log']);

function humanFileSize(bytes) {
  if (!bytes || bytes <= 0) return '0 KB';
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(0)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

async function summarizeLocation(payload) {
  const lat = Number(payload.lat);
  const lng = Number(payload.lng);

  let placeName = null;
  try {
    placeName = await reverseGeocode(lat, lng);
  } catch (err) {
    console.warn('[deterministicSummary] reverse geocode failed, falling back to coordinates:', err.message);
  }

  return {
    category: 'location_snapshot',
    extracted: { placeName },
    summaryText: placeName ? `You were near ${placeName}` : `You were near ${lat.toFixed(4)}, ${lng.toFixed(4)}`,
  };
}

function summarizeFile(payload) {
  return {
    category: 'new_file',
    extracted: null,
    summaryText: `New file: ${payload.name} (${humanFileSize(payload.size)})`,
  };
}

function summarizeCallLog(payload) {
  const label = { incoming: 'Incoming', outgoing: 'Outgoing', missed: 'Missed' }[payload.type] || 'Unknown';
  return {
    category: 'call_log',
    extracted: null,
    summaryText: `${label} call with ${payload.number}${payload.duration ? ` (${payload.duration}s)` : ''}`,
  };
}

async function summarize(event) {
  if (event.source === 'location') return summarizeLocation(event.payload);
  if (event.source === 'file') return summarizeFile(event.payload);
  if (event.source === 'call_log') return summarizeCallLog(event.payload);
  return null;
}

async function applyDeterministicSummaries(events) {
  await Promise.all(
    events.map(async (event) => {
      if (!DETERMINISTIC_SOURCES.has(event.source)) return;
      const summary = await summarize(event);
      if (!summary) return;
      event.category = summary.category;
      event.extracted = summary.extracted;
      event.summaryText = summary.summaryText;
      event.processed = true;
    })
  );
  return events;
}

module.exports = { applyDeterministicSummaries, DETERMINISTIC_SOURCES };
