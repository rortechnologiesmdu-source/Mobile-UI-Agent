// Corrects taps where MAI-UI names the right element but points at the wrong place.
//
// Seen on the iOS simulator: in Spotlight the model reasons 'tap on the "Settings"
// option' but taps the search box at the bottom, which also shows the typed word
// "Settings". When the model's reasoning quotes a label, the tap misses it, and the
// screen has exactly one tappable element with that label, the tap is moved onto it.
// Anything ambiguous is left alone.

const TAPPABLE = /^(Button|Cell|Icon|Link|Switch|Toggle|Tab|MenuItem)$/;
const TEXT_FIELD = /^(TextField|SearchField|SecureTextField|TextView)$/;

const normalize = (s) => (s || '').toLowerCase().replace(/\s+/g, ' ').trim();
const bounds = (n) => n.bounds && [n.bounds.left, n.bounds.top, n.bounds.right, n.bounds.bottom];
const contains = (outer, inner) =>
  outer[0] <= inner[0] && outer[1] <= inner[1] && outer[2] >= inner[2] && outer[3] >= inner[3];

// Labels the model put in quotes, in order: 'tap the "Settings" option' -> ['Settings'].
function quotedLabels(reason) {
  return [...(reason || '').matchAll(/["“]([^"”]{1,60})["”]/g)].map((m) => m[1].trim()).filter(Boolean);
}

// Returns { action, snappedTo } — the same action when no correction applies.
function snapTapToNamedTarget({ action, reason, accessibilityTree, screenWidth, screenHeight }) {
  const point = action.action === 'tap' && action.target?.point;
  const tree = Array.isArray(accessibilityTree) ? accessibilityTree : [];
  if (!point || !screenWidth || !screenHeight || !tree.length) return { action };
  const px = point.x * screenWidth;
  const py = point.y * screenHeight;

  // A text field showing the typed word ("Settings" in the search box) is where the
  // label came from, not the element the model means — leave fields and their
  // contents out of the candidates.
  const fields = tree.filter((n) => TEXT_FIELD.test(n.className || '') && bounds(n)).map(bounds);
  const inField = (n) => fields.some((f) => contains(f, bounds(n)));
  const candidates = tree.filter((n) => bounds(n) && !inField(n));

  for (const label of quotedLabels(reason)) {
    // Exact spelling first: Spotlight lists the "Settings" app and a "settings" web
    // suggestion; the model's quote ("Settings") tells them apart.
    const exact = candidates.filter((n) => (n.text || '').trim() === label);
    const named = exact.length ? exact : candidates.filter((n) => normalize(n.text) === normalize(label));
    if (!named.length) continue;

    // Already on it: the tap lands inside an element with that label.
    if (named.some((n) => { const b = bounds(n); return px >= b[0] && px <= b[2] && py >= b[1] && py <= b[3]; })) {
      return { action };
    }

    // One target only: every tappable match must be nested in the outermost one
    // (iOS reports a cell, its icon and its text separately for the same item).
    const tappable = named.filter((n) => TAPPABLE.test(n.className || ''));
    if (!tappable.length) continue;
    const outer = tappable.reduce((a, b) => {
      const [ba, bb] = [bounds(a), bounds(b)];
      return (bb[2] - bb[0]) * (bb[3] - bb[1]) > (ba[2] - ba[0]) * (ba[3] - ba[1]) ? b : a;
    });
    const ob = bounds(outer);
    if (!tappable.every((n) => contains(ob, bounds(n)))) return { action };

    const cx = (ob[0] + ob[2]) / 2;
    const cy = (Math.max(ob[1], 0) + Math.min(ob[3], screenHeight)) / 2;
    const snapped = {
      ...action,
      target: { ...action.target, point: { x: Math.round((cx / screenWidth) * 1e4) / 1e4, y: Math.round((cy / screenHeight) * 1e4) / 1e4 } },
    };
    return { action: snapped, snappedTo: label };
  }
  return { action };
}

module.exports = { snapTapToNamedTarget, quotedLabels };
