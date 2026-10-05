// Run-level safety checks for Agent 2, independent of which model chose the action.

const REPEAT_LIMIT = 3;
// Two points closer than this (as a fraction of the screen) count as the same spot.
const SAME_SPOT = 0.03;
// Labels whose tap sends something to another person — can't be taken back.
const SEND_LABEL = /^send\b/i;
// Labels whose tap places a phone/voice/video call.
const CALL_LABEL = /^(call|dial|voice call|video call)\b/i;
const PHONE_NUMBER = /^\+?[\d][\d\s()-]{4,}$/;

function sameAction(a, b) {
  if (!a || !b || a.action !== b.action) return false;
  if (a.action === 'tap' || a.action === 'long_press') {
    const p = a.target?.point;
    const q = b.target?.point;
    if (!p || !q) return (a.target?.description || '') === (b.target?.description || '');
    return Math.abs(p.x - q.x) <= SAME_SPOT && Math.abs(p.y - q.y) <= SAME_SPOT;
  }
  if (a.action === 'type') return a.text === b.text;
  // Swipes, waits and back/home presses legitimately repeat (scrolling, loading, backing out).
  return false;
}

// True when `action` would be the REPEAT_LIMIT-th identical action in a row — a sign the
// model is stuck on a screen that isn't reacting.
function isRepeating(previousActions, action) {
  const recent = previousActions.slice(-(REPEAT_LIMIT - 1));
  return recent.length === REPEAT_LIMIT - 1 && recent.every((prev) => sameAction(prev, action));
}

function nodeBounds(node) {
  const b = node?.bounds;
  if (!b) return null;
  const vals = Array.isArray(b) ? b : [b.left, b.top, b.right, b.bottom];
  return vals.every((v) => typeof v === 'number') ? vals : null;
}

const nodeLabel = (node) => (node.text || '').trim() || (node.contentDescription || '').trim();

// Screen size in the pixels tree bounds use. Older app builds don't report it; the
// outermost nodes approximate it.
function screenSize(tree, screenWidth, screenHeight) {
  if (screenWidth && screenHeight) return [screenWidth, screenHeight];
  const all = tree.map(nodeBounds).filter(Boolean);
  return [Math.max(0, ...all.map((b) => b[2])), Math.max(0, ...all.map((b) => b[3]))];
}

// Smallest labelled accessibility node under a 0-1 fractional point: { label, bounds }.
function nodeAt(tree, point, screenWidth, screenHeight) {
  if (!Array.isArray(tree) || !point) return null;
  const [width, height] = screenSize(tree, screenWidth, screenHeight);
  if (!width || !height) return null;
  const px = point.x * width;
  const py = point.y * height;
  let best = null;
  for (const node of tree) {
    const b = nodeBounds(node);
    const label = nodeLabel(node);
    if (!b || !label || px < b[0] || px > b[2] || py < b[1] || py > b[3]) continue;
    const area = (b[2] - b[0]) * (b[3] - b[1]);
    if (!best || area < best.area) best = { area, label, bounds: b };
  }
  return best;
}

// The person a task wants something sent to, e.g. "share X to Prasanna in WhatsApp"
// -> "Prasanna". Empty when the goal doesn't name one.
function recipientFromGoal(goal) {
  const text = (goal || '').replace(/["“”']/g, ' ');
  const viaApp = text.match(/\bto\s+(.+?)\s+(?:in|on|via|using|through)\s+\S+/i);
  const atEnd = text.match(/\bto\s+([^,.!?]+?)\s*(?:[,.!?]|$)/i);
  // "call Harish krk" / "call Harish krk on WhatsApp" (no "to").
  const callName = text.match(/\bcall\s+(?!to\b)([^,.!?]+?)\s*(?:\s(?:on|in|via|using)\s|[,.!?]|$)/i);
  return ((viaApp || atEnd || callName || [])[1] || '').trim();
}

// Lowercase letters/digits only, so "Prasanna, 🙃" and "prasanna" compare equal.
const normalize = (s) => (s || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

// Labels that can name who a Send goes to: names in the bar beside the Send button
// (WhatsApp's share picker) and the title area at the top (an open chat). The message
// input itself is excluded — its text is the message, not the recipient.
function recipientLabels(tree, sendBounds, screenHeight) {
  const [sl, st, , sb] = sendBounds;
  const band = (sb - st) * 0.75;
  const sendMid = (st + sb) / 2;
  const topLimit = screenHeight * 0.12;
  const labels = [];
  for (const node of tree) {
    const b = nodeBounds(node);
    const label = nodeLabel(node);
    if (!b || !label || SEND_LABEL.test(label) || /edittext/i.test(node.className || '')) continue;
    const mid = (b[1] + b[3]) / 2;
    const besideSend = Math.abs(mid - sendMid) <= band && b[2] <= sl + 1;
    const inTitle = b[3] <= topLimit;
    if (besideSend || inTitle) labels.push(label);
  }
  return labels.filter(
    (l) => !/^(back|search|selected|\d+ selected|new group|new contact|more options|video call|voice call|send to)$/i.test(l)
  );
}

// Checks a tap on a "Send" control before it happens:
//   null               — not a send
//   { block: message } — the selected recipient isn't the one the goal names; don't send
//   { confirm: message } — ask the user first (naming the recipient when known)
// "Charu" matches "charu nivedhidha"; "Charu Nivedhidha" matches "Charu".
function nameMatcher(wanted) {
  const want = normalize(wanted);
  return (label) => {
    const have = normalize(label);
    const first = have.split(' ')[0];
    return have.includes(want) || (first.length >= 3 && want.split(' ').includes(first));
  };
}

// Calls are checked more strictly than sends: when the goal names a person, their name
// must be visible on screen (contact page, search result, or the call button's own
// label like "Call Harish Krk"). A bare number on a dial pad never qualifies — the
// model has been seen inventing numbers.
function checkCall({ goal, label, tree, app }) {
  const wanted = recipientFromGoal(goal);
  const labels = (tree || []).map(nodeLabel).filter(Boolean);
  const number = labels.find((l) => PHONE_NUMBER.test(l));
  const shown = number ? ` (number on screen: ${number})` : '';
  if (wanted) {
    const match = [label, ...labels].find(nameMatcher(wanted));
    if (!match) {
      return {
        kind: 'call',
        block: `Stopped before calling: "${wanted}" isn't shown on screen${shown}. No call was made.`,
      };
    }
    return { kind: 'call', confirm: `Call "${wanted}" in ${app}?${shown}` };
  }
  return { kind: 'call', confirm: `The agent is about to start a call in ${app}${shown}. Allow it?` };
}

// Checks a tap on a "Send" or "Call" control before it happens:
//   null               — not a send/call
//   { block: message } — the recipient on screen isn't the one the goal names; don't do it
//   { confirm: message } — ask the user first (naming the recipient when known)
function checkSend({ goal, action, accessibilityTree, screenWidth, screenHeight, currentApp }) {
  if (action.action !== 'tap') return null;
  const node = nodeAt(accessibilityTree, action.target.point, screenWidth, screenHeight);
  const label = node?.label || action.target.description || '';
  const app = currentApp || 'this app';
  if (CALL_LABEL.test(label)) return checkCall({ goal, label, tree: accessibilityTree, app });
  if (!SEND_LABEL.test(label)) return null;

  const wanted = recipientFromGoal(goal);
  const height = screenSize(accessibilityTree || [], screenWidth, screenHeight)[1];
  const seen = node ? recipientLabels(accessibilityTree, node.bounds, height) : [];

  if (wanted && seen.length) {
    const match = seen.find(nameMatcher(wanted));
    if (!match) {
      return {
        kind: 'send',
        block: `Stopped before sending: "${seen.join(', ')}" is selected, but your task says "${wanted}". Nothing was sent.`,
      };
    }
    return { kind: 'send', confirm: `Send to "${match}" in ${app}?` };
  }
  const who = seen.length ? ` (selected: ${seen.join(', ')})` : '';
  return { kind: 'send', confirm: `The agent is about to tap "${label}" in ${app}${who}. This may send something to someone. Allow it?` };
}

module.exports = { isRepeating, checkSend, recipientFromGoal, REPEAT_LIMIT };
