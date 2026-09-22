const { getVisionModel } = require('../config/gemini');

const SYSTEM_PROMPT = `You are Agent 2 of MobileUse, controlling an Android phone on the user's behalf.
You receive: the current goal, step history, the current foreground app, the accessibility tree
(labeled UI elements with bounds), and a screenshot of the current screen.

Return ONLY a single JSON object for the next action, one of:
{ "action": "tap", "target": { "description": string, "point": { "x": number, "y": number } } }
{ "action": "type", "text": string }
{ "action": "swipe", "direction": "up"|"down"|"left"|"right" }
{ "action": "launch_app", "package": string }
{ "action": "press_back" }
{ "action": "press_home" }
{ "action": "done", "result": string }

For "tap": "description" should match the visible label/text of the element as closely as
possible (used to find it in the accessibility tree first, the reliable path). Always ALSO
include "point" as your best-guess center of that element as a fraction of screen width/height
(0.0-1.0 for both x and y, e.g. a button in the exact center of the screen is {"x":0.5,"y":0.5})
— this is the fallback used only if no accessibility node matches the description, e.g. for
icon-only buttons with no visible label.

No markdown fences, no commentary, just the JSON object.`;

function parseModelJson(text) {
  const cleaned = text.trim().replace(/^```json/i, '').replace(/^```/, '').replace(/```$/, '').trim();
  return JSON.parse(cleaned);
}

// screenshotBase64: raw base64 (no data: prefix), jpeg.
async function decideNextAction({ goal, history, currentApp, accessibilityTree, screenshotBase64 }) {
  const model = getVisionModel();

  const contextText = [
    SYSTEM_PROMPT,
    `Goal: ${goal}`,
    `Current app: ${currentApp}`,
    `Step history: ${JSON.stringify(history)}`,
    `Accessibility tree: ${JSON.stringify(accessibilityTree)}`,
  ].join('\n\n');

  const result = await model.generateContent([
    { text: contextText },
    { inlineData: { mimeType: 'image/jpeg', data: screenshotBase64 } },
  ]);

  const text = result.response.text();
  try {
    return parseModelJson(text);
  } catch (err) {
    throw new Error(`Gemini agent decision returned unparseable JSON: ${err.message}`);
  }
}

module.exports = { decideNextAction };
