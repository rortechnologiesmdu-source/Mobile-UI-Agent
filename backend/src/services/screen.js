// Facts about the screen measured from the accessibility tree — the same for every app.
// Used to tell when a screen has finished loading, and to give the planner evidence
// (is there more to scroll? did the last scroll show anything new?) before it decides a
// part of the task is finished.

// The labels on a screen.
function screenLabels(tree) {
  return (Array.isArray(tree) ? tree : []).map((n) => (n.text || n.contentDescription || '').trim()).filter(Boolean);
}

// Share of labels two screens have in common (multiset overlap, 0..1).
function labelSimilarity(a, b) {
  if (!a.length && !b.length) return 1;
  const counts = new Map();
  for (const l of a) counts.set(l, (counts.get(l) || 0) + 1);
  let common = 0;
  for (const l of b) {
    const c = counts.get(l);
    if (c) {
      common += 1;
      counts.set(l, c - 1);
    }
  }
  return common / Math.max(a.length, b.length);
}

// A scroll that leaves this much of the screen the same showed nothing new.
const SAME_SCREEN = 0.9;

// The scrolls (up/down) in the current part, and whether the last one changed nothing.
function lastScroll(steps, partStart, tree) {
  const part = steps.slice(partStart || 0);
  const scrolls = part.map((s, i) => ({ s, i })).filter(({ s }) => s.action?.action === 'swipe' && /^(up|down)$/.test(s.action.direction));
  if (!scrolls.length) return { count: 0, changedNothing: false };
  // The screen it started from vs the screen after it (the next step's, or the current one).
  const { s, i } = scrolls[scrolls.length - 1];
  const after = part[i + 1] ? part[i + 1].accessibilityTree : tree;
  const same = labelSimilarity(screenLabels(s.accessibilityTree), screenLabels(after)) >= SAME_SCREEN;
  return { count: scrolls.length, changedNothing: same };
}

// True when the last scroll in this part showed nothing new: the end of the list.
const listEndReached = (steps, partStart, tree) => lastScroll(steps, partStart, tree).changedNothing;

// Input boxes (Android EditText & co, iOS text fields).
const INPUT = /^(EditText|AutoCompleteTextView|SearchView|SearchAutoComplete|TextField|SearchField|SecureTextField)$/;
const sameText = (a, b) => String(a || '').replace(/\s+/g, ' ').trim() === String(b || '').replace(/\s+/g, ' ').trim();

// After a type step: does an input box on this screen hold exactly what was typed?
// true / false, or null when the last step wasn't a type or there's no input box. Measured
// from the element list, so a long message the box only partly shows still counts as typed.
function typedTextLanded(steps, tree) {
  const last = steps[steps.length - 1];
  if (last?.action?.action !== 'type') return null;
  const boxes = (Array.isArray(tree) ? tree : []).filter((n) => INPUT.test(n.className || ''));
  if (!boxes.length) return null;
  return boxes.some((n) => sameText(n.text, last.action.text));
}

// Short lines for the planner about the current part of the task:
//   steps     — the run's steps; each holds the tree of the screen it was decided on
//   partStart — index of the first step of the current part
//   tree      — the screen now
function screenFacts(steps, partStart, tree) {
  const facts = [];
  const scrollable = (Array.isArray(tree) ? tree : []).some((n) => n.scrollable);
  facts.push(scrollable ? 'A scrollable list/area is on screen.' : 'Nothing on this screen is scrollable.');

  const typed = typedTextLanded(steps, tree);
  if (typed !== null) {
    const text = steps[steps.length - 1].action.text;
    facts.push(
      typed
        ? `The input box holds exactly the text you typed (${text.split('\n').length} lines, ${text.length} characters) — ` +
            'typing worked, even if the box only shows the first lines.'
        : 'The input box does NOT hold the text you typed.'
    );
  }

  const { count, changedNothing } = lastScroll(steps, partStart, tree);
  if (!count) {
    facts.push(scrollable ? 'You have not scrolled yet in this part — more items may be further down.' : 'You have not scrolled in this part.');
    return facts;
  }
  facts.push(
    `You scrolled ${count} time${count > 1 ? 's' : ''} in this part; ` +
      (changedNothing
        ? 'the last scroll did NOT change the screen — the end of the list was reached.'
        : 'the last scroll showed new items, so there may be more below.')
  );
  return facts;
}

module.exports = { screenLabels, labelSimilarity, screenFacts, listEndReached, typedTextLanded, SAME_SCREEN };
