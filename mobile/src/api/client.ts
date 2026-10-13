import { getBackendUrl, InstalledApp, Observation } from '../native/agent';

// Set at build time from MOBILEUSE_BACKEND_URL in android/gradle.properties.
const BASE_URL = `${getBackendUrl()}/api`;

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${options?.method ?? 'GET'} ${path} failed: ${res.status} ${body}`);
  }
  return res.json();
}

// For calls made by the agent loop, which keeps running while this app is backgrounded
// (it's operating other apps). React Native's fetch polyfill resolves responses via
// setTimeout, and RN pauses JS timers in the background, so a fetch there never
// settles. XMLHttpRequest's callbacks don't go through a timer.
function requestInBackground<T>(path: string, method: string, body?: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(method, `${BASE_URL}${path}`);
    xhr.setRequestHeader('Content-Type', 'application/json');
    // Covers a MAI-UI step plus a Gemini fallback.
    xhr.timeout = 150000;
    xhr.onload = () => {
      if (xhr.status < 200 || xhr.status >= 300) {
        reject(new Error(`${method} ${path} failed: ${xhr.status} ${xhr.responseText}`));
        return;
      }
      try {
        resolve(JSON.parse(xhr.responseText));
      } catch {
        reject(new Error(`${method} ${path} returned invalid JSON`));
      }
    };
    xhr.onerror = () => reject(new Error(`${method} ${path} failed: network error`));
    xhr.ontimeout = () => reject(new Error(`${method} ${path} timed out`));
    xhr.send(body === undefined ? null : JSON.stringify(body));
  });
}

export type EventSource = 'sms' | 'notification' | 'location' | 'activity' | 'file' | 'contact' | 'call_log';

export type RawEventInput = {
  source: EventSource;
  payload: Record<string, unknown>;
  deviceTimestamp: string;
};

export function ingestEvents(events: RawEventInput[]) {
  return request<{ inserted: number }>('/ingest', {
    method: 'POST',
    body: JSON.stringify({ events }),
  });
}

export type DashboardEvent = {
  _id: string;
  source: string;
  payload: Record<string, unknown>;
  deviceTimestamp: string;
  category: string | null;
  extracted: Record<string, unknown> | null;
  summaryText: string | null;
};

export type DashboardTile = {
  count: number;
  latestSummary: string | null;
  latestAt: string | null;
};

export function getDashboardSummary() {
  return request<{ tiles: Record<EventSource, DashboardTile>; events: DashboardEvent[] }>(
    '/dashboard/summary'
  );
}

export function getEventsBySource(source: EventSource, sinceHours = 48, limit = 50) {
  return request<{ count: number; events: DashboardEvent[] }>(
    `/events/${source}?sinceHours=${sinceHours}&limit=${limit}`
  );
}

// homePackage: the phone's home-screen app — the agent may always go home.
export function startAgentRun(goal: string, apps: InstalledApp[] = [], homePackage = '') {
  return request<{ runId: string }>('/agent2/runs', {
    method: 'POST',
    body: JSON.stringify({ goal, apps, homePackage }),
  });
}

export type AgentAction =
  | { action: 'tap'; target: { description: string; point?: { x: number; y: number } } }
  | { action: 'long_press'; target: { description: string; point: { x: number; y: number } } }
  | { action: 'wait' }
  | { action: 'type'; text: string }
  | { action: 'swipe'; direction: 'up' | 'down' | 'left' | 'right' }
  | { action: 'launch_app'; package: string }
  | { action: 'press_back' }
  | { action: 'press_home' }
  | { action: 'done'; result: string };

export function stepAgentRun(
  runId: string,
  observation: Observation
) {
  return requestInBackground<AgentStepResult>(`/agent2/runs/${runId}/step`, 'POST', observation);
}

// Set when the run paused (status 'needs_approval') because the task needs an app that's
// disabled in Installed Apps & Access Control.
export type AppApproval = { package: string; label: string; reason: string; message: string };

export type AgentStepResult = {
  action: AgentAction;
  stepNumber: number;
  status: string;
  resultText: string | null;
  // Set when the action would send something; the user must allow it first.
  confirm: string | null;
  approval?: AppApproval;
};

// After the user allowed the app: the backend re-checks the saved setting, then continues.
export function resumeAgentRun(runId: string) {
  return requestInBackground<{ status: string }>(`/agent2/runs/${runId}/resume`, 'POST');
}

export function stopAgentRun(runId: string, reason?: string) {
  return requestInBackground<{ status: string }>(
    `/agent2/runs/${runId}/stop`,
    'POST',
    reason ? { reason } : undefined
  );
}

export type AgentRunSummary = {
  _id: string;
  goal: string;
  status: 'running' | 'needs_approval' | 'done' | 'failed' | 'stopped';
  resultText: string | null;
  steps: unknown[];
  createdAt: string;
};

export function listAgentRuns() {
  return request<{ runs: AgentRunSummary[] }>('/agent2/runs');
}

// ---------------------------------------------------------------------------
// Installed Apps & Access Control
// ---------------------------------------------------------------------------

export type MethodStatus =
  | 'available'
  | 'requires_connection'
  | 'requires_permission'
  | 'unverified'
  | 'unsupported'
  | 'temporarily_unavailable';

export type CollectionMethod = {
  method: 'api' | 'mcp' | 'email' | 'phone_data' | 'mobile_use' | 'browser_use';
  status: MethodStatus;
  priority: number;
  supported_data_types: string[];
  reason: string;
};

export type AppAnalysis = {
  status: 'none' | 'pending' | 'completed' | 'failed';
  methods: CollectionMethod[];
  error?: string | null;
  analyzedAt?: string | null;
};

export type AppInfo = {
  package: string;
  label: string;
  category: string;
  categoryCorrected: boolean;
  access: boolean;
  accessUpdatedAt: string | null;
  analysis: AppAnalysis;
};

type AppsResponse = { apps: AppInfo[]; categories: string[] };

// Reports the phone's installed apps; new ones are added with access No.
export function syncApps(apps: { package: string; label: string; androidCategory: number }[]) {
  return request<AppsResponse>('/apps/sync', { method: 'POST', body: JSON.stringify({ apps }) });
}

export function getApps() {
  return request<AppsResponse>('/apps');
}

// Resolves with the SAVED record; throws if it wasn't saved.
export function setAppAccess(pkg: string, access: boolean, label?: string) {
  return request<{ app: AppInfo }>(`/apps/${encodeURIComponent(pkg)}/access`, {
    method: 'PUT',
    body: JSON.stringify({ access, label }),
  });
}

// Same, for the agent loop (runs while this app is in the background).
export function setAppAccessInBackground(pkg: string, access: boolean, label?: string) {
  return requestInBackground<{ app: AppInfo }>(`/apps/${encodeURIComponent(pkg)}/access`, 'PUT', { access, label });
}

// null = back to the automatic category.
export function setAppCategory(pkg: string, category: string | null) {
  return request<{ app: AppInfo }>(`/apps/${encodeURIComponent(pkg)}/category`, {
    method: 'PUT',
    body: JSON.stringify({ category }),
  });
}

// Re-runs the Decision Layer's method analysis for one app.
export function analyzeApp(pkg: string) {
  return request<{ app: AppInfo }>(`/apps/${encodeURIComponent(pkg)}/analyze`, { method: 'POST' });
}

// ---------------------------------------------------------------------------
// Dashboard sections: Mobile Agent results and the API (Gmail) section
// ---------------------------------------------------------------------------

// Dashboard calls give up after this long, so a slow backend never freezes the screen.
const DASHBOARD_TIMEOUT_MS = 20000;

async function requestWithTimeout<T>(path: string): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DASHBOARD_TIMEOUT_MS);
  try {
    const res = await fetch(`${BASE_URL}${path}`, { signal: controller.signal });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err: any = new Error(body.message || body.error || `GET ${path} failed: ${res.status}`);
      err.code = body.error;
      throw err;
    }
    return body as T;
  } catch (e: any) {
    if (e.name === 'AbortError') throw new Error('The backend took too long to answer. Pull down to retry.');
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

export type MobileAgentRecord = {
  _id: string;
  runId: string;
  task: string;
  status: 'done' | 'failed' | 'stopped';
  resultText: string | null;
  data: unknown;
  items: string[];
  steps: number;
  finishedAt: string | null;
};

export function getMobileAgentResults(page = 1, limit = 20) {
  return requestWithTimeout<{ records: MobileAgentRecord[]; total: number; page: number; hasMore: boolean }>(
    `/dashboard/mobile-agent?page=${page}&limit=${limit}`
  );
}

export type GmailStatus = { configured: boolean; connected: boolean; email: string | null; connectUrl: string | null };
export type EmailSummary = { id: string; threadId: string; from: string; subject: string; receivedAt: string; snippet: string };

export function getGmailStatus() {
  return requestWithTimeout<GmailStatus>('/gmail/status');
}

// Emails received in the last `days` days (throws with code 'not_connected' if Gmail isn't connected).
export function getRecentEmails(days = 7, limit = 50) {
  return requestWithTimeout<{ emails: EmailSummary[]; truncated: boolean; days: number; limit: number }>(
    `/gmail/recent?days=${days}&limit=${limit}`
  );
}
