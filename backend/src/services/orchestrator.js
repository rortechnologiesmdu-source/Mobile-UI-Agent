// Two-agent orchestration. Per step, Qwen3.5 (the planner: sees the screenshot, the
// element list, the step history and the run's memory) checks whether the last step
// worked, copies any facts the task needs into memory, and gives the ONE next simple
// instruction. The instruction then becomes an action as cheaply as possible:
//   open / type / scroll / back / home / wait  -> direct
//   tap "<label>" (Android)                    -> the one element with that label
//   anything else                              -> MAI-UI-2B on the screenshot, moved
//                                                 onto the nearest element with the
//                                                 label when there are several
// Both models stay loaded on the model server (no swapping). Enabled with
// AGENT_MODE=two_agent; the single-model path is the rollback.

const qwen = require('./qwenClient');
const { decideWithMaiUi } = require('./maiUiClient');
const { validateAgentAction } = require('./agentDecision');
const { tapByLabel, snapToNearestTarget } = require('./grounding');
const { screenFacts, listEndReached, typedTextLanded } = require('./screen');

const HISTORY_FOR_QWEN = 10;
const HISTORY_FOR_MAI_UI = 3;
// An instruction that already failed this many times is listed for Qwen as "don't
// repeat"; proposing it once more stops the run (catches tap <-> back loops, which
// the repeat guard misses because the actions alternate).
const FAIL_LIMIT = 2;
// Moves that are fine to repeat: scrolling through a list, waiting for a load, backing out.
const REPEATABLE = /^\s*(scroll|swipe|wait|press back|go back)\b/i;

// The agent's own control app (the phone app running this task). Its screen shows the task
// text and a Stop button, so a tap there re-taps the task or stops the run — never allowed.
const OWN_APP = 'com.mobileuse.app';

// Tasks that end by sending something. Sending ends the run by itself (the phone asks the
// user to confirm the Send tap), so Qwen saying "done" on such a task is always premature.
const SEND_TASK = /\b(send|share|forward|reply)\b/i;

// "type ..." must carry the exact text in quotes. Unquoted, Qwen is describing it
// ('Type the list of orders into the message field'), which must never be typed literally.
const TYPE_STEP = /^\s*(?:type|input|enter|write)\b/i;
const QUOTED_TEXT = /["“]([\s\S]+)["”]/;
const TYPE_NEEDS_TEXT =
  'Your type step had no text in double quotes. Give the EXACT text to type in double quotes, written out in ' +
  'full (e.g. type "My orders:\n1. ...\n2. ..." using the facts in MEMORY).';

const normalizeInstruction = (s) =>
  String(s || '').toLowerCase().replace(/["'“”‘’.!]/g, '').replace(/\s+/g, ' ').trim();

// The plan as Qwen sees it: "✓ 1. Collect my orders [Amazon Shopping] — done when ...".
// plan = { goals, parts: [{ goal, app, done_when }], current } — parts before `current`
// are finished, `current` is being worked on.
function planLines(plan, current) {
  return (plan?.parts || []).map((p, i) => {
    const mark = i < current ? '✓' : i === current ? '▶' : '○';
    return `${mark} ${i + 1}. ${p.goal}${p.app ? ` [${p.app}]` : ''}${p.done_when ? ` — done when ${p.done_when}` : ''}`;
  });
}

// After the checker has refused the same part this many times, go by the planner (a
// checker that can't be satisfied must not stall the run).
const CHECKER_LIMIT = 3;
const CHECKER_REFUSAL = /^checker: part not finished/;

// A fact's identity for matching: without a leading "Label:", case and punctuation, first
// 40 letters/digits (same rule the backend uses to skip duplicate facts).
const factKey = (f) =>
  String(f).replace(/^\s*[a-z][a-z ]{0,15}:\s*/i, '').toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 40);

// The list items in a type step ("1. ...", "- ...") that aren't in memory: the planner made
// them up. Data that gets typed (and maybe sent) must come from what was collected.
const LIST_ITEM = /^\s*(?:\d{1,3}[.)]|[-•*])\s+(.+)$/;
function typedText(instruction) {
  const m = QUOTED_TEXT.exec(instruction || '');
  return m ? m[1].replace(/\\n/g, '\n') : '';
}
function inventedItems(text, memory) {
  const keys = memory.map(factKey).filter((k) => k.length >= 12);
  return text
    .split('\n')
    .map((line) => LIST_ITEM.exec(line)?.[1])
    .filter(Boolean)
    .filter((item) => {
      const k = factKey(item);
      return !keys.some((f) => k.startsWith(f) || f.startsWith(k.slice(0, 40)));
    });
}
// The list written from memory itself, keeping the planner's heading ("My orders:").
function listFromMemory(text, memory) {
  const heading = text.split('\n').find((line) => line.trim() && !LIST_ITEM.test(line));
  const items = memory.map((f, i) => `${i + 1}. ${String(f).replace(/^\s*[a-z][a-z ]{0,15}:\s*/i, '')}`);
  return [heading?.trim(), ...items].filter(Boolean).join('\n');
}

// Going round in circles: this many steps in a row in the current part added nothing to a
// memory that already holds data — the planner is told so it finishes or changes approach.
const STALL_STEPS = 5;

// How many items the part (or task) asks for: "last 10", "latest 5", "top 3", "10 most recent".
function countAsked(...texts) {
  for (const t of texts) {
    const m = /\b(?:last|latest|recent|newest|top|first)\s+(\d{1,3})\b/i.exec(t || '') ||
      /\b(\d{1,3})\s+(?:most\s+)?(?:recent|latest|newest|last)\b/i.exec(t || '');
    if (m) return Number(m[1]);
  }
  return null;
}

// The step that itself finishes a send part (tapping Send) — checked by the user's Allow/Cancel instead.
const FINAL_SEND_TAP = /^\s*(?:tap|click)\s+(?:on\s+)?(?:the\s+)?["“']?(?:send|share|post|submit)["”']?(?:\s+button)?\s*$/i;

// Package of the app a plan part happens in (null if it names none we can open).
const partPackage = (part, apps) => (part?.app ? resolveOpenApp(`open ${part.app}`, apps) : null);

// One short line per past step for Qwen: 'tap "Orders" -> tapped ✓'.
function historyLines(steps) {
  return steps.slice(-HISTORY_FOR_QWEN).map((s) => {
    const mark = s.ok === true ? ' ✓' : s.ok === false ? ' ✗' : '';
    const did = describeAction(s.action);
    const why = s.reason && s.instruction && s.reason !== s.instruction ? ` (${s.reason.split('\n')[0].slice(0, 120)})` : '';
    return s.instruction ? `${s.instruction.split('\n')[0]} -> ${did}${why}${mark}` : `${did}${mark}`;
  });
}

// Failed instructions, normalized -> { text, count }.
function failedInstructions(steps) {
  const failed = new Map();
  for (const s of steps) {
    if (s.ok !== false || !s.instruction || REPEATABLE.test(s.instruction)) continue;
    const key = normalizeInstruction(s.instruction);
    const entry = failed.get(key) || { text: s.instruction, count: 0 };
    entry.count += 1;
    failed.set(key, entry);
  }
  return failed;
}

// observation: { goal, steps, memory, plan, currentApp, accessibilityTree, screenshotBase64,
//   apps, platform, screenWidth, screenHeight } — steps are the run's steps so far; plan is
//   the run's plan from Qwen's first look at the task (see planLines).
// Returns { action, reason, instruction, resolvedVia, ok, check, lastOk, remember, planCurrent, stop }:
//   check/lastOk — Qwen's verdict on the PREVIOUS step (the caller stores it there)
//   remember     — new facts for the run's memory
//   planCurrent  — index of the plan part now being worked on (advances when Qwen says a part is done)
//   ok           — outcome of THIS step when already known (false: MAI-UI couldn't find it)
//   stop         — set when the run should end instead (the same step failing again)
async function decideTwoAgent(observation) {
  const { goal, steps = [], memory = [], plan, currentApp, accessibilityTree, screenshotBase64, apps } = observation;
  const { platform, screenWidth, screenHeight } = observation;
  const parts = plan?.parts || [];
  let current = Math.min(plan?.current || 0, parts.length);
  const startPart = current; // the plan moves on by at most one part per step
  const partStart = plan?.partStart || 0; // first step of the current part
  const memStart = plan?.memStart || 0; // first memory fact collected in the current part
  const facts = screenFacts(steps, partStart, accessibilityTree);
  let checkerNote = ''; // why the strict check sent the agent back to work, if it did
  let confirmedDone = false; // this screen was checked and the current part is already complete

  // 1) Qwen checks the last step and the flow, remembers facts, says whether the current
  //    part is finished, and picks the next step (or finishes).
  const ask = (note) =>
    qwen.decide({
      task: goal,
      goals: plan?.goals || [],
      plan: planLines(plan, current),
      accessibilityTree,
      screenshotBase64,
      currentApp,
      apps,
      history: historyLines(steps),
      memory,
      screenFacts: facts,
      failed: [...failedInstructions(steps).values()]
        .filter((f) => f.count >= FAIL_LIMIT)
        .map((f) => `${f.text} (failed ${f.count} times)`),
      note,
    });
  let decision;
  const advance = () => {
    if (decision.partDone && current === startPart && current < parts.length) {
      current += 1;
      console.log(`[agent2] plan: part ${current} done${current < parts.length ? ` -> now ${current + 1}. ${parts[current].goal}` : ' (all parts)'}`);
    }
  };
  // Asks again with a correction, keeping the facts and a finished part from the first answer.
  const reask = async (note, why) => {
    console.log(`[agent2] ${why}; asking again`);
    const first = decision;
    decision = await ask(note);
    keepAnswer();
    decision.remember = [...(first.remember || []), ...(decision.remember || [])];
    advance();
  };
  // Several steps with no new data while memory already has some: say so up front.
  const recent = steps.slice(partStart).slice(-STALL_STEPS);
  const stalled =
    memory.length > 0 && recent.length === STALL_STEPS && recent.every((st) => st.memoryCount === memory.length);
  if (stalled) console.log(`[agent2] ${STALL_STEPS} steps without new data (memory: ${memory.length}); telling the planner`);
  // A finished answer is data: when the planner finishes with a result but saved no facts,
  // keep the result as a fact — if the checker sends it back to work, the knowledge isn't
  // lost (it once re-read a cart, forgot the items it had listed, and answered "empty").
  const keepAnswer = () => {
    if (decision.done && decision.result && !/^\s*need:/i.test(decision.result) && !(decision.remember || []).length) {
      decision.remember = [decision.result];
    }
  };
  decision = await ask(
    stalled
      ? `The last ${STALL_STEPS} steps collected nothing new and MEMORY already holds ${memory.length} items. If MEMORY ` +
          'covers what the ▶ current part needs, set part_done (or done). Otherwise do something different — e.g. read ' +
          'the list already on screen and keep the items whose dates fit (a wider filter is fine); don\'t keep re-filtering.'
      : undefined
  );
  keepAnswer();

  // Measured beats seen: the last step typed text and the input box holds exactly that text,
  // so it worked — whatever the screenshot made the planner think (a long message shows
  // only its first lines in the box).
  if (typedTextLanded(steps, accessibilityTree) === true && decision.lastOk === false) {
    console.log('[agent2] planner judged the typing failed, but the input box holds exactly the typed text; counting it as worked');
    decision.lastOk = true;
  }

  // Finishing the current part (or the whole task) needs a strict second look first: is
  // it really complete on this screen and in memory? If not, do what's missing instead.
  const refusals = steps.slice(partStart).filter((st) => CHECKER_REFUSAL.test(st.reason || '')).length;
  const finishing = (decision.partDone || decision.done) && !/^\s*need:/i.test(decision.result) && !FINAL_SEND_TAP.test(decision.instruction || '');
  if (finishing && refusals >= CHECKER_LIMIT) {
    console.log(`[agent2] checker already refused this part ${refusals} times; going by the planner`);
  } else if (finishing) {
    const part = parts[current] || { goal, done_when: '' };
    let check = null;
    try {
      check = await qwen.verify({
        task: goal,
        part: part.goal,
        doneWhen: part.done_when,
        memory: [...memory, ...(decision.remember || [])],
        partSteps: steps.slice(partStart).map((st) => `${(st.instruction || '').split('\n')[0]} -> ${describeAction(st.action)}`),
        screenFacts: facts,
        accessibilityTree,
        screenshotBase64,
        currentApp,
      });
    } catch (err) {
      console.error(`[agent2] verify failed, going by the planner: ${err.message}`);
    }
    // Measured evidence beats the checker: the last scroll in this part showed nothing new,
    // so the end of the list really was reached and every item has been seen.
    if (check && !check.complete && listEndReached(steps, partStart, accessibilityTree)) {
      console.log(`[agent2] checker refused (${check.missing.slice(0, 80)}), but the last scroll showed nothing new; accepting the part`);
      check = null;
    }
    // ...or the part asks for N items and this part has collected at least N.
    const asked = countAsked(part.goal, goal);
    if (check && !check.complete && asked) {
      const known = new Set(memory.map((f) => f.toLowerCase().trim()));
      const fresh = (decision.remember || []).filter((f) => !known.has(String(f).toLowerCase().trim())).length;
      const collected = memory.length - memStart + fresh;
      if (collected >= asked) {
        console.log(`[agent2] checker refused, but the task asks for ${asked} and ${collected} were collected in this part; accepting`);
        check = null;
      }
    }
    if (!check || check.complete) confirmedDone = Boolean(check?.complete) || check === null;
    if (check && !check.complete) {
      // The checker's own step is only a hint: the planner, which knows the real action set
      // and the whole context, decides what to do about what's missing.
      checkerNote = `checker: part not finished — ${check.missing || 'something is missing'}`;
      await reask(
        `A strict check says the current part is NOT finished: ${check.missing || 'something is missing'}` +
          `${check.next ? ` (it suggests: ${check.next})` : ''}. Continue the current part with one real step. ` +
          'Ads, sponsored and recommended items are never part of the data.',
        'checker said not finished'
      );
      decision = { ...decision, done: false, partDone: false };
    }
  }
  advance();

  // "Done" while parts of the plan are still open, or on a send task (sending ends the run
  // by itself, after the user confirms). "need: ..." (something missing) is accepted.
  if (decision.done && !/^\s*need:/i.test(decision.result)) {
    const open = parts.slice(current + 1);
    if (open.length && current === startPart) {
      // Qwen judged its work finished, so the current part at least is: move on to the next.
      current += 1;
      console.log(`[agent2] plan: part ${current} done (Qwen said done) -> now ${current + 1}. ${parts[current].goal}`);
    }
    if (open.length || SEND_TASK.test(goal)) {
      await reask(
        open.length
          ? `You said the task is done, but these parts are not finished: ${open.map((p) => p.goal).join('; ')}. ` +
              `Continue with the ▶ current part.`
          : 'You said the task is done, but it asks to send/share and nothing has been sent yet ' +
              '(tapping Send ends the task by itself). Continue with the current part.',
        'Qwen said done before the plan was finished'
      );
    }
  }

  // "open X" while X is already on screen does nothing (it just resumes the same page): the
  // planner must move within the app instead.
  if (!decision.done && currentApp && resolveOpenApp(decision.instruction, apps) === currentApp) {
    const name = (apps || []).find((a) => a.package === currentApp)?.label || currentApp;
    await reask(
      `You are already in ${name} — "open ${name}" does nothing (the app resumes on this same page). ` +
        'Move within the app instead: press back, or tap what leads to what you need.',
      `planner tried to open ${name} while already in it`
    );
    if (!decision.done && resolveOpenApp(decision.instruction, apps) === currentApp) {
      decision = { ...decision, instruction: 'press back' };
      console.log(`[agent2] still opening ${name}; pressing back instead`);
    }
  }

  // Every part of the plan is finished — confirmed on this screen (or in an earlier step):
  // the only step left is to finish. No more taps — an extra action after the work is done
  // can only change something nobody asked for. (An action that itself completes the part —
  // "tap Send", a switch still off — isn't blocked: the checker didn't confirm it done.)
  if (!decision.done && parts.length && current >= parts.length && (startPart >= parts.length || confirmedDone)) {
    await reask(
      'Every part of the plan is finished. Reply done now, with the result (list any data the task asked for).',
      'plan finished but the planner gave another step'
    );
    if (!decision.done) {
      const result = memory.length ? `Finished. Collected:\n${memory.map((f, i) => `${i + 1}. ${f}`).join('\n')}` : 'Task finished.';
      decision = { ...decision, done: true, result };
      console.log('[agent2] still not done; finishing the run with the collected data');
    }
  }

  // Going back to the app of a finished part (its data is already in memory): redirect to
  // the current part's app.
  if (!decision.done && current < parts.length) {
    const opening = resolveOpenApp(decision.instruction, apps);
    const here = partPackage(parts[current], apps);
    const finished = parts.slice(0, current).find((p) => partPackage(p, apps) === opening);
    if (opening && finished && opening !== here) {
      const target = parts[current].app || 'the app of the current part';
      await reask(
        `The part "${finished.goal}" is finished and its data is in MEMORY. Don't go back to ${finished.app}. ` +
          `The current part is "${parts[current].goal}"${here ? ` in ${target}: open ${target}` : ''}.`,
        `Qwen tried to reopen ${finished.app} (finished part)`
      );
      if (!decision.done && here && finished && resolveOpenApp(decision.instruction, apps) === opening) {
        decision.instruction = `open ${target}`;
        console.log(`[agent2] still going back; opening ${target} instead`);
      }
    }
  }

  // A type step without the actual text: ask once for the exact words.
  if (!decision.done && TYPE_STEP.test(decision.instruction) && !QUOTED_TEXT.test(decision.instruction)) {
    await reask(TYPE_NEEDS_TEXT, `type step without quoted text ("${decision.instruction}")`);
    if (!decision.done && TYPE_STEP.test(decision.instruction) && !QUOTED_TEXT.test(decision.instruction)) {
      // Still described, not given: write it from memory, or don't type at all.
      decision.instruction = memory.length
        ? `type "${memory.map((f, i) => `${i + 1}. ${f.replace(/^\s*\w+:\s*/, '')}`).join('\n')}"`
        : 'wait';
      console.log(`[agent2] still no text; typing from memory instead: ${decision.instruction.slice(0, 80)}`);
    }
  }
  // Typing the data this very part is collecting means the planner jumped ahead: data is
  // only used after the part that collects it is finished (e.g. typing the order list while
  // still in the shop app would put it in the shop's search box).
  if (!decision.done && current < parts.length - 1 && TYPE_STEP.test(decision.instruction)) {
    const typedKey = String(decision.instruction).toLowerCase().replace(/[^a-z0-9]+/g, '');
    const ownData = memory.slice(memStart).filter((f) => factKey(f).length >= 12 && typedKey.includes(factKey(f)));
    if (ownData.length) {
      await reask(
        `You are still on part ${current + 1} ("${parts[current].goal}"), which COLLECTS this data. Don't type it ` +
          `here: if the part is finished, set part_done and give the first step of the next part ` +
          `("${parts[current + 1].goal}"${parts[current + 1].app ? ` in ${parts[current + 1].app}` : ''}).`,
        'planner tried to type the data before finishing the part that collects it'
      );
      if (!decision.done && TYPE_STEP.test(decision.instruction)) {
        const next = partPackage(parts[current + 1], apps);
        decision = { ...decision, instruction: next ? `open ${parts[current + 1].app}` : 'wait' };
        console.log(`[agent2] still typing early; ${decision.instruction} instead`);
        if (next && current === startPart) current += 1; // moving to the next part's app
      }
    }
  }

  // A typed list must hold only collected data: items not in memory were made up.
  if (!decision.done && memory.length && TYPE_STEP.test(decision.instruction)) {
    let invented = inventedItems(typedText(decision.instruction), memory);
    if (invented.length) {
      await reask(
        `Your text lists items that are NOT in MEMORY (e.g. "${invented[0].slice(0, 80)}"). Type ONLY the items in ` +
          'MEMORY, exactly as saved — never add items from the screen or invent any.',
        `planner typed ${invented.length} item(s) not in memory`
      );
      invented = TYPE_STEP.test(decision.instruction) ? inventedItems(typedText(decision.instruction), memory) : [];
      if (!decision.done && TYPE_STEP.test(decision.instruction) && invented.length) {
        decision.instruction = `type "${listFromMemory(typedText(decision.instruction), memory)}"`;
        console.log(`[agent2] still made-up items; typing the list from memory instead (${memory.length} items)`);
      }
    }
  }

  const verdict = {
    check: decision.check,
    lastOk: decision.lastOk,
    remember: decision.remember,
    planCurrent: current,
    planPartStart: current !== startPart ? steps.length : partStart, // this step opens the next part
    partAdvanced: current !== startPart,
  };

  if (decision.done) {
    const result = decision.result || 'Task finished.';
    return { ...verdict, action: { action: 'done', result }, reason: result, resolvedVia: 'direct' };
  }

  // The same step failing again (with this verdict on the last step counted): stop.
  const instruction = decision.instruction;
  const prev = steps[steps.length - 1];
  const judged = prev && prev.ok == null && decision.lastOk !== null ? [...steps.slice(0, -1), { ...prev, ok: decision.lastOk }] : steps;
  const failed = failedInstructions(judged).get(normalizeInstruction(instruction));
  if (failed && failed.count >= FAIL_LIMIT) {
    return {
      ...verdict,
      action: { action: 'wait' },
      reason: instruction,
      instruction,
      stop: `Stopped: "${failed.text}" didn't work ${failed.count} times and the planner tried it again.`,
    };
  }
  const base = { ...verdict, reason: checkerNote || instruction, instruction };

  // 2) No grounding needed: open an app, type, scroll, back, home, wait.
  const launch = resolveOpenApp(instruction, apps);
  if (currentApp === OWN_APP && !launch && !/^\s*(?:press|go)\s+home\b/i.test(instruction)) {
    // Leave the agent's own app: straight into the current part's app when the plan names one.
    const pkg = partPackage(parts[current], apps);
    console.log(`[agent2] on the agent's own app: "${instruction}" -> ${pkg ? `launch_app ${pkg}` : 'press_home'} instead`);
    const action = pkg ? { action: 'launch_app', package: pkg } : { action: 'press_home' };
    return { ...base, action, reason: `left the agent's own app instead of: ${instruction}`, resolvedVia: 'direct' };
  }
  if (launch) {
    console.log(`[agent2] open shortcut: "${instruction}" -> launch_app ${launch}`);
    return { ...base, action: { action: 'launch_app', package: launch }, resolvedVia: 'direct' };
  }
  const direct = resolveDirectAction(instruction);
  if (direct) {
    console.log(`[agent2] direct shortcut: "${instruction}" -> ${JSON.stringify(direct)}`);
    return { ...base, action: validateAgentAction(direct), resolvedVia: 'direct' };
  }

  // 3) Android: exactly one element carries the label -> tap it directly.
  let targets = [];
  if (platform !== 'ios') {
    const byLabel = tapByLabel({ instruction, accessibilityTree, screenWidth, screenHeight });
    targets = byLabel.targets;
    if (byLabel.action) {
      console.log(`[agent2] label tap: "${byLabel.label}" -> ${JSON.stringify(byLabel.action.target.point)}`);
      return { ...base, action: validateAgentAction(byLabel.action), resolvedVia: 'a11y_node' };
    }
  }

  // 4) MAI-UI-2B finds it on the screenshot, with the last few steps as context.
  let action;
  try {
    ({ action } = await decideWithMaiUi({
      goal: instruction, // the simple instruction, not the whole task
      history: steps.slice(-HISTORY_FOR_MAI_UI).map((s) => ({ ...s.action, reason: s.instruction || s.reason })),
      currentApp,
      accessibilityTree,
      screenshotBase64,
      apps,
    }));
  } catch (err) {
    // One unusable answer (e.g. a "drag" the phone can't do) is a failed step, not a failed
    // run: record it so the planner tries something else (the fail guard stops repeats).
    if (/unavailable/i.test(err.message)) throw err; // model server down: nothing to retry
    console.log(`[agent2] MAI-UI couldn't act on "${instruction}": ${err.message}`);
    return { ...base, action: { action: 'wait' }, reason: `could not do "${instruction}": ${err.message.slice(0, 120)}`, ok: false, resolvedVia: 'mai_ui' };
  }

  // Only the planner finishes a task. MAI-UI sometimes "answers" instead of acting ("View
  // Cart has been tapped successfully") — that's a step that did nothing, not the end.
  if (action?.action === 'done') {
    console.log(`[agent2] MAI-UI answered instead of acting on "${instruction}"; not ending the run`);
    return { ...base, action: { action: 'wait' }, reason: `could not do "${instruction}" (the UI model answered instead of acting)`, ok: false, resolvedVia: 'mai_ui' };
  }

  // When asked to tap something it can't find, MAI-UI sometimes "gives up" by emitting
  // back/home — which silently navigates away and derails the plan. Don't execute that:
  // record the step as failed so Qwen re-plans on the same screen next turn.
  const wantedTap = /^\s*(?:tap|click|long[\s-]?press)\b/i.test(instruction);
  if (wantedTap && action && (action.action === 'press_back' || action.action === 'press_home')) {
    console.log(`[agent2] MAI-UI couldn't find target for "${instruction}"; not navigating away`);
    return { ...base, action: { action: 'wait' }, reason: `could not find "${instruction}" on screen`, ok: false, resolvedVia: 'mai_ui' };
  }

  // Several elements carry the label: move MAI-UI's rough point onto the nearest one.
  const snap = snapToNearestTarget({ action, targets, screenWidth, screenHeight });
  if (snap.snapped) {
    console.log(`[agent2] MAI-UI point moved onto the nearest of ${targets.length} matches: ${JSON.stringify(snap.action.target.point)}`);
  }
  return { ...base, action: validateAgentAction(snap.action), resolvedVia: snap.snapped ? 'mai_ui_snapped' : 'mai_ui' };
}

// If the instruction is "open <App>" (or "launch/go to <App>") and that app is in the
// phone's installed list, returns its package; otherwise null.
function resolveOpenApp(instruction, apps) {
  const m = /^\s*(?:open|launch|go to|start)\s+(?:the\s+)?(.+?)(?:\s+app)?\s*$/i.exec(instruction || '');
  if (!m || !Array.isArray(apps)) return null;
  const want = m[1].trim().toLowerCase();
  if (!want) return null;
  const match = apps.find((a) => {
    const label = (a.label || '').trim().toLowerCase();
    return label && (label === want || (label.length >= 3 && (label.includes(want) || want.includes(label))));
  });
  return match ? match.package : null;
}

// Maps a Qwen instruction that is a concrete device action (not a tap/long_press that
// needs visual grounding) straight to an AgentAction. Returns null for tap/long_press
// and anything unrecognised, which then go to MAI-UI. "type"/"scroll"/"back"/"home"/
// "wait"/"swipe" are executed directly so MAI-UI can't turn them into a stray tap.
function resolveDirectAction(instruction) {
  const t = String(instruction || '').trim().replace(/[.!]+$/, '');
  let m;

  // type "<text>" | type <text> | input "<text>"  (NOT "press enter" — that stays with MAI-UI)
  if ((m = /^(?:type|input)\s+([\s\S]+)$/i.exec(t))) { // [\s\S]: the text may span lines (a list)
    const text = m[1]
      .trim()
      .replace(/^(["'])([\s\S]*)\1$/, '$2')
      .replace(/\\n/g, '\n') // a literal "\n" (escaped twice by the planner) is a line break
      .trim();
    if (text) return { action: 'type', text };
    return null;
  }

  // back / home
  if (/^(?:press|tap|go|navigate|hit)?\s*back$/i.test(t) || /\bgo back\b/i.test(t)) return { action: 'press_back' };
  if (/^(?:press|tap|go)?\s*home$/i.test(t) || /\bgo home\b/i.test(t)) return { action: 'press_home' };

  // wait
  if (/^wait\b/i.test(t)) return { action: 'wait' };

  // scroll <dir> — "scroll down" reveals content below, which is a finger swipe UP.
  if ((m = /\bscroll\s+(up|down|left|right)\b/i.exec(t))) {
    const map = { down: 'up', up: 'down', left: 'left', right: 'right' };
    return { action: 'swipe', direction: map[m[1].toLowerCase()] };
  }

  // swipe <dir> — direction is taken literally (finger movement).
  if ((m = /\bswipe\s+(up|down|left|right)\b/i.exec(t))) {
    return { action: 'swipe', direction: m[1].toLowerCase() };
  }

  return null;
}

function describeAction(a) {
  if (!a || typeof a !== 'object') return '';
  switch (a.action) {
    case 'tap':
      return a.target?.description ? `tapped "${a.target.description}"` : 'tapped';
    case 'long_press':
      return 'long-pressed';
    case 'type':
      return `typed "${a.text}"`;
    case 'swipe':
      return `swiped ${a.direction}`;
    case 'launch_app':
      return `opened ${a.package}`;
    case 'press_back':
      return 'pressed back';
    case 'press_home':
      return 'pressed home';
    case 'wait':
      return 'waited';
    case 'done':
      return 'done';
    default:
      return a.action || '';
  }
}

module.exports = { decideTwoAgent, resolveOpenApp, resolveDirectAction };
