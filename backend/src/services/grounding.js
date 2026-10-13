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

// ---------------------------------------------------------------------------
// Android: tap by label (two-agent runs)
//
// Qwen names what to tap ('tap "Your Orders"'). When exactly one on-screen element
// carries that label, we tap its centre directly — exact and instant, no vision model.
// Several matches (e.g. "Orders" in a menu and in a heading) go to MAI-UI, whose rough
// point then picks the nearest of them (snapToNearestTarget). No match: MAI-UI alone.
// ---------------------------------------------------------------------------

// Android input boxes show what was typed (the search box reading "Orders"); they're
// never the element a label means.
const ANDROID_INPUT = /^(EditText|AutoCompleteTextView|SearchView|SearchAutoComplete)$/;
const TAP_VERB = /^\s*(?:tap|click|press|select|choose|open|long[\s-]?press)\s+(?:on\s+)?(?:the\s+)?/i;
const MAX_SNAP_DISTANCE = 0.15; // of screen height: farther than this, trust MAI-UI's point

const round4 = (v) => Math.round(v * 1e4) / 1e4;
const nodeLabels = (n) => [n.text, n.contentDescription].map(normalize).filter(Boolean);

// The label an instruction names: the quoted text ('tap "Your Orders"'), else the
// words after the verb ('tap Orders' -> 'Orders'). Null for descriptions that aren't
// a label ('tap the search icon at the top right of the screen').
function labelFromInstruction(instruction) {
  const s = String(instruction || '');
  const quoted =
    s.match(/["“]([^"”]{1,120})["”]/) || s.match(/(?:^|[\s(])['‘]([^'’]{1,120})['’](?=$|[\s,.;:)!?])/);
  if (quoted) return { label: quoted[1].trim(), quoted: true };
  if (!TAP_VERB.test(s)) return null;
  const rest = s
    .replace(TAP_VERB, '')
    .replace(/[.!]+$/, '')
    .replace(/\s+(?:button|tab|icon|link|option)$/i, '')
    .trim();
  if (!rest || rest.split(/\s+/).length > 4) return null;
  return { label: rest, quoted: false };
}

// Distinct on-screen elements carrying the label (nested duplicates of one item — a
// row, its text, its icon — count once, as the outermost).
function findLabelTargets({ label, quoted, accessibilityTree, screenWidth, screenHeight }) {
  const want = normalize(label);
  if (!want) return [];
  const visible = (b) =>
    b && b[2] > b[0] && b[3] > b[1] && b[2] > 0 && b[3] > 0 &&
    (!screenWidth || b[0] < screenWidth) && (!screenHeight || b[1] < screenHeight);
  const nodes = (Array.isArray(accessibilityTree) ? accessibilityTree : []).filter(
    (n) => visible(bounds(n)) && !ANDROID_INPUT.test(n.className || '')
  );
  let named = nodes.filter((n) => nodeLabels(n).includes(want));
  // Qwen sometimes shortens long titles ("Aristocrat Comet Cabin ... Trolley Ba"):
  // for long quoted labels with no exact match, accept a prefix either way.
  if (!named.length && quoted && want.length >= 12) {
    named = nodes.filter((n) => nodeLabels(n).some((l) => l.startsWith(want) || (l.length >= 12 && want.startsWith(l))));
  }
  const boxes = named.map(bounds);
  return named.filter(
    (n, i) => !boxes.some((o, j) => j !== i && contains(o, boxes[i]) && (!contains(boxes[i], o) || j < i))
  );
}

function centerPoint(node, screenWidth, screenHeight) {
  const b = bounds(node);
  const cx = (Math.max(b[0], 0) + Math.min(b[2], screenWidth)) / 2;
  const cy = (Math.max(b[1], 0) + Math.min(b[3], screenHeight)) / 2;
  return { x: round4(cx / screenWidth), y: round4(cy / screenHeight) };
}

// Exactly one element with the label: tap (or long-press) its centre. Otherwise null.
// The description stays empty so the executor does a real touch at the point (some
// launchers ignore an accessibility click — see MAI_UI_A11Y_TAP on the model server).
function tapByLabel({ instruction, accessibilityTree, screenWidth, screenHeight }) {
  const named = labelFromInstruction(instruction);
  if (!named || !screenWidth || !screenHeight) return { action: null, targets: [] };
  const targets = findLabelTargets({ ...named, accessibilityTree, screenWidth, screenHeight });
  if (targets.length !== 1) return { action: null, targets, label: named.label };
  const kind = /^\s*long[\s-]?press\b/i.test(instruction) ? 'long_press' : 'tap';
  const point = centerPoint(targets[0], screenWidth, screenHeight);
  return { action: { action: kind, target: { description: '', point } }, targets, label: named.label };
}

// MAI-UI's point for a label that appears several times: move it onto the nearest of
// those elements (unless it's already on one, or none is near).
function snapToNearestTarget({ action, targets, screenWidth, screenHeight }) {
  const point = (action?.action === 'tap' || action?.action === 'long_press') && action.target?.point;
  if (!point || !targets?.length || !screenWidth || !screenHeight) return { action };
  const px = point.x * screenWidth;
  const py = point.y * screenHeight;
  const inside = (b) => px >= b[0] && px <= b[2] && py >= b[1] && py <= b[3];
  if (targets.some((n) => inside(bounds(n)))) return { action };
  let best = null;
  for (const n of targets) {
    const c = centerPoint(n, screenWidth, screenHeight);
    const d = Math.hypot(c.x * screenWidth - px, c.y * screenHeight - py);
    if (!best || d < best.d) best = { c, d };
  }
  if (best.d > MAX_SNAP_DISTANCE * screenHeight) return { action };
  return { action: { ...action, target: { ...action.target, point: best.c } }, snapped: true };
}

module.exports = {
  snapTapToNamedTarget,
  quotedLabels,
  labelFromInstruction,
  findLabelTargets,
  tapByLabel,
  snapToNearestTarget,
};
