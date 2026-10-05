// Agent 2 decisions from the local MAI-UI server (mai-ui-test/server.py on the Mac).
// The server runs MAI-UI in its native format and translates the result into the
// same AgentAction shape Gemini returns, so nothing downstream needs to change.

const DEFAULT_BASE_URL = 'http://127.0.0.1:8080';
const DEFAULT_TIMEOUT_MS = 60000;

// screenshotBase64: raw base64 (no data: prefix), jpeg.
async function decideWithMaiUi({ goal, history, currentApp, accessibilityTree, screenshotBase64, apps }) {
  const baseUrl = (process.env.MAI_UI_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, '');
  const timeoutMs = Number(process.env.MAI_UI_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS;

  if (!screenshotBase64) throw new Error('MAI-UI needs a screenshot, but this observation has none');

  const form = new FormData();
  form.append('image', new Blob([Buffer.from(screenshotBase64, 'base64')], { type: 'image/jpeg' }), 'screen.jpg');
  form.append('prompt', goal);
  form.append('ui_tree', JSON.stringify(accessibilityTree || []));
  form.append('history', JSON.stringify(history || []));
  form.append('current_app', currentApp || '');
  form.append('apps', JSON.stringify(apps || []));

  let res;
  try {
    res = await fetch(`${baseUrl}/analyze`, {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    const reason = err.name === 'TimeoutError' ? `timed out after ${timeoutMs}ms` : err.cause?.code || err.message;
    throw new Error(`MAI-UI server unavailable at ${baseUrl}: ${reason}`);
  }

  let body;
  try {
    body = await res.json();
  } catch {
    throw new Error(`MAI-UI server returned a non-JSON response (HTTP ${res.status})`);
  }
  if (!res.ok || !body.success) {
    const code = body.error?.code || `HTTP ${res.status}`;
    throw new Error(`MAI-UI returned no usable action: ${code} ${body.error?.message || ''}`.trim());
  }

  console.log(
    `[agent2] MAI-UI ${JSON.stringify(body.native)} -> ${JSON.stringify(body.action)} (${body.timing_ms?.total}ms)`
  );
  return { action: body.action, thinking: body.thinking || '' };
}

module.exports = { decideWithMaiUi };
