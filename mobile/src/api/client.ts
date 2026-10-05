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

export function startAgentRun(goal: string, apps: InstalledApp[] = []) {
  return request<{ runId: string }>('/agent2/runs', {
    method: 'POST',
    body: JSON.stringify({ goal, apps }),
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

export type AgentStepResult = {
  action: AgentAction;
  stepNumber: number;
  status: string;
  resultText: string | null;
  // Set when the action would send something; the user must allow it first.
  confirm: string | null;
};

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
  status: 'running' | 'done' | 'failed' | 'stopped';
  resultText: string | null;
  steps: unknown[];
  createdAt: string;
};

export function listAgentRuns() {
  return request<{ runs: AgentRunSummary[] }>('/agent2/runs');
}
