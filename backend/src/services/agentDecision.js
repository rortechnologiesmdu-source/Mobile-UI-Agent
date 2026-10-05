const { getVisionModel } = require('../config/gemini');
const { decideWithMaiUi } = require('./maiUiClient');

const SYSTEM_PROMPT = `You are Agent 2 of MobileUse, controlling an Android phone on the user's behalf.
You receive: the current goal, step history, the current foreground app, the accessibility tree
(labeled UI elements with bounds), and a screenshot of the current screen.

Return ONLY a single JSON object for the next action, one of:
{ "action": "tap", "target": { "description": string, "point": { "x": number, "y": number } } }
{ "action": "long_press", "target": { "description": string, "point": { "x": number, "y": number } } }
{ "action": "type", "text": string }
{ "action": "swipe", "direction": "up"|"down"|"left"|"right" }
{ "action": "launch_app", "package": string }
{ "action": "press_back" }
{ "action": "press_home" }
{ "action": "wait" }
{ "action": "done", "result": string }

For "tap" and "long_press": "point" is where the touch is performed — the center of the element
as a fraction of screen width/height (0.0-1.0 for both x and y, e.g. a button in the exact
center of the screen is {"x":0.5,"y":0.5}). Use the accessibility tree bounds to place it
precisely when the element is listed there. "description" is the element's visible label/text.
Use "long_press" to open an item's context menu. Use "wait" when the screen is still loading.

No markdown fences, no commentary, just the JSON object.`;

const GEMINI_RETRY_DELAY_MS = 2000;

function parseModelJson(text) {
  const cleaned = text.trim().replace(/^```json/i, '').replace(/^```/, '').replace(/```$/, '').trim();
  return JSON.parse(cleaned);
}

// screenshotBase64: raw base64 (no data: prefix), jpeg.
async function decideWithGemini({ goal, history, currentApp, accessibilityTree, screenshotBase64, apps }) {
  const model = getVisionModel();

  const contextText = [
    SYSTEM_PROMPT,
    `Goal: ${goal}`,
    `Current app: ${currentApp}`,
    `Installed apps (label: package): ${(apps || []).map((a) => `${a.label}: ${a.package}`).join(', ')}`,
    `Step history: ${JSON.stringify(history)}`,
    `Accessibility tree: ${JSON.stringify(accessibilityTree)}`,
  ].join('\n\n');

  const request = [
    { text: contextText },
    { inlineData: { mimeType: 'image/jpeg', data: screenshotBase64 } },
  ];
  let result;
  try {
    result = await model.generateContent(request);
  } catch (err) {
    // Gemini's "high demand"/rate-limit errors are usually momentary — retry once.
    if (!/\b(503|429)\b|high demand|overloaded/i.test(err.message)) throw err;
    console.warn(`[agent2] Gemini busy, retrying once: ${err.message}`);
    await new Promise((resolve) => setTimeout(resolve, GEMINI_RETRY_DELAY_MS));
    result = await model.generateContent(request);
  }

  const text = result.response.text();
  try {
    return parseModelJson(text);
  } catch (err) {
    throw new Error(`Gemini agent decision returned unparseable JSON: ${err.message}`);
  }
}

const SWIPE_DIRECTIONS = ['up', 'down', 'left', 'right'];
const PACKAGE_NAME = /^[A-Za-z][\w]*(\.[A-Za-z_][\w]*)+$/;
const isFraction = (v) => typeof v === 'number' && v >= 0 && v <= 1;
const isNonEmptyString = (v) => typeof v === 'string' && v.trim().length > 0;

// Checks a model's action against the action set AgentModule.executeAction supports and
// returns a clean copy with only the fields the executor reads. Throws instead of letting
// anything malformed reach the phone.
function validateAgentAction(action) {
  const fail = (why) => {
    throw new Error(`invalid agent action (${why}): ${JSON.stringify(action)}`);
  };
  if (!action || typeof action !== 'object') fail('not an object');

  switch (action.action) {
    case 'tap': {
      const { description = '', point } = action.target || {};
      if (typeof description !== 'string') fail('target.description must be a string');
      if (point !== undefined && !(isFraction(point?.x) && isFraction(point?.y))) fail('target.point must be 0-1 fractions');
      if (!description.trim() && !point) fail('tap needs a description or a point');
      return { action: 'tap', target: point ? { description, point: { x: point.x, y: point.y } } : { description } };
    }
    case 'long_press': {
      const { description = '', point } = action.target || {};
      if (typeof description !== 'string') fail('target.description must be a string');
      if (!(isFraction(point?.x) && isFraction(point?.y))) fail('long_press needs target.point as 0-1 fractions');
      return { action: 'long_press', target: { description, point: { x: point.x, y: point.y } } };
    }
    case 'wait':
      return { action: 'wait' };
    case 'type':
      if (!isNonEmptyString(action.text)) fail('text is required');
      return { action: 'type', text: action.text };
    case 'swipe':
      if (!SWIPE_DIRECTIONS.includes(action.direction)) fail('direction must be up/down/left/right');
      return { action: 'swipe', direction: action.direction };
    case 'launch_app':
      if (!PACKAGE_NAME.test(action.package || '')) fail('package must be an Android package name');
      return { action: 'launch_app', package: action.package };
    case 'press_back':
    case 'press_home':
      return { action: action.action };
    case 'done':
      if (action.result !== undefined && typeof action.result !== 'string') fail('result must be a string');
      return { action: 'done', result: action.result || '' };
    default:
      return fail('unknown action type');
  }
}

// Validated Gemini decision. Taps that carry a point are sent gesture-first (description
// cleared): the executor would otherwise try an accessibility ACTION_CLICK by label first,
// which some apps/launchers (observed on vivo) report as handled without reacting — and a
// "successful" click skips the point. MAI-UI taps are sent the same way by its server.
async function geminiAction(observation) {
  const action = validateAgentAction(await decideWithGemini(observation));
  if (action.action === 'tap' && action.target.point) action.target.description = '';
  console.log(`[agent2] Gemini -> ${JSON.stringify(action)}`);
  return action;
}

// AGENT_BACKEND selects the decision model: "gemini" (default) or "mai_ui" (local
// MAI-UI server). With mai_ui, any MAI-UI failure — server down, timeout, unusable
// output — falls back to Gemini unless MAI_UI_FALLBACK=none.
// Returns { action, reason }; reason is the model's own reasoning when it gives one.
async function decideNextAction(observation) {
  const backend = (process.env.AGENT_BACKEND || 'gemini').trim().toLowerCase();
  if (backend === 'gemini') return { action: await geminiAction(observation), reason: '' };
  if (backend !== 'mai_ui') throw new Error(`unknown AGENT_BACKEND "${backend}" (expected gemini or mai_ui)`);

  try {
    const { action, thinking } = await decideWithMaiUi(observation);
    return { action: validateAgentAction(action), reason: thinking };
  } catch (err) {
    if ((process.env.MAI_UI_FALLBACK || 'gemini').trim().toLowerCase() !== 'gemini') throw err;
    console.warn(`[agent2] MAI-UI failed, falling back to Gemini: ${err.message}`);
    return { action: await geminiAction(observation), reason: '' };
  }
}

module.exports = { decideNextAction };
