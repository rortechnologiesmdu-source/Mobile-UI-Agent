// Qwen (general planner / extractor) calls to the local model server
// (mai-ui-test/server.py: POST /decide, POST /extract). Text-only — Qwen sees the
// accessibility tree, not pixels; MAI-UI does the visual grounding.

const DEFAULT_BASE_URL = 'http://127.0.0.1:8080';
const DEFAULT_TIMEOUT_MS = 60000;

function baseUrl() {
  return (process.env.MAI_UI_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, '');
}

async function postJson(path, payload) {
  const url = `${baseUrl()}${path}`;
  const timeoutMs = Number(process.env.MAI_UI_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS;
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    const reason = err.name === 'TimeoutError' ? `timed out after ${timeoutMs}ms` : err.cause?.code || err.message;
    throw new Error(`Qwen server unavailable at ${baseUrl()}: ${reason}`);
  }
  let body;
  try {
    body = await res.json();
  } catch {
    throw new Error(`Qwen server returned a non-JSON response (HTTP ${res.status})`);
  }
  if (!res.ok || !body.success) {
    const code = body.error?.code || `HTTP ${res.status}`;
    throw new Error(`Qwen ${path} failed: ${code} ${body.error?.message || ''}`.trim());
  }
  return body;
}

// Qwen checks whether the last step worked, saves facts the task needs, and picks the
// next simple instruction (or declares the task done). It sees the screenshot too.
// history: short strings, one per step ("tap "Orders" -> tapped ✓").
// memory: facts saved so far. failed: instructions that already failed twice.
// note: a correction from the backend (e.g. "you said done, but nothing was sent yet").
// goals/plan: from plan() — plan lines carry their status ("▶ 2. Send ... [WhatsApp] — done when ...").
// screenFacts: measured facts about the screen ("the last scroll did NOT change the screen ...").
// Returns { done, instruction, result, check, lastOk, partDone, remember }.
async function decide({ task, accessibilityTree, screenshotBase64, history, memory, failed, currentApp, apps, note, goals, plan, screenFacts }) {
  const body = await postJson('/decide', {
    task,
    accessibilityTree: accessibilityTree || [],
    screenshotBase64: screenshotBase64 || '',
    history: history || [],
    memory: memory || [],
    failed: failed || [],
    currentApp: currentApp || '',
    apps: apps || [],
    note: note || '',
    goals: goals || [],
    plan: plan || [],
    screenFacts: screenFacts || [],
  });
  const remember = Array.isArray(body.remember) ? body.remember : [];
  const lastOk = typeof body.last_ok === 'boolean' ? body.last_ok : null;
  console.log(
    `[agent2] Qwen decide -> done=${body.done} "${(body.instruction || body.result || '').slice(0, 70)}"` +
      ` last_ok=${lastOk}${body.part_done ? ' PART DONE' : ''}${remember.length ? ` +${remember.length} facts` : ''}` +
      ` (${body.timing_ms?.total}ms)`
  );
  return {
    done: Boolean(body.done),
    instruction: body.instruction || '',
    result: body.result || '',
    check: body.check || '',
    lastOk,
    partDone: body.part_done === true,
    remember,
  };
}

// Qwen reads the task once, before the first step: what the user wants (goals) and the
// ordered parts, each in one app with how to tell it's finished.
// Returns { goals: [string], parts: [{ goal, app, done_when }], missing } — missing: what the task
// needs but doesn't say (e.g. who to send to); "" when nothing is.
async function plan({ task, apps }) {
  const body = await postJson('/plan', { task, apps: apps || [] });
  console.log(
    `[agent2] Qwen plan (${body.timing_ms?.total}ms): ` +
      (body.parts || []).map((p, i) => `${i + 1}. ${p.goal}${p.app ? ` [${p.app}]` : ''}`).join(' | ') +
      (body.missing ? ` | MISSING: ${body.missing}` : '')
  );
  return { goals: body.goals || [], parts: body.parts || [], missing: body.missing || '' };
}

// Qwen normalises collected observations into structured JSON. Returns the data object.
async function extract({ task, observations, schema }) {
  const body = await postJson('/extract', { task, observations, schema });
  return body.data;
}

// A strict second look before the current part counts as finished.
// Returns { complete, evidence, missing, next }.
async function verify({ task, part, doneWhen, memory, partSteps, screenFacts, accessibilityTree, screenshotBase64, currentApp }) {
  const body = await postJson('/verify', {
    task,
    part,
    doneWhen: doneWhen || '',
    memory: memory || [],
    partSteps: partSteps || [],
    screenFacts: screenFacts || [],
    accessibilityTree: accessibilityTree || [],
    screenshotBase64: screenshotBase64 || '',
    currentApp: currentApp || '',
  });
  console.log(
    `[agent2] verify "${part.slice(0, 50)}" -> ${body.complete ? `complete: ${body.evidence}` : `NOT complete: ${body.missing} -> ${body.next}`}`.slice(0, 260) +
      ` (${body.timing_ms?.total}ms)`
  );
  return { complete: body.complete === true, evidence: body.evidence || '', missing: body.missing || '', next: body.next || '' };
}

module.exports = { decide, extract, plan, verify };
