// Backend reachable via `adb reverse tcp:4000 tcp:4000` while the phone is on USB.
const BASE_URL = 'http://localhost:4000/api';

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

export type RawEventInput = {
  source: 'sms' | 'notification' | 'location' | 'activity' | 'file' | 'contact';
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

export function getDashboardSummary() {
  return request<{ count: number; events: DashboardEvent[] }>('/dashboard/summary');
}

export function startAgentRun(goal: string) {
  return request<{ runId: string }>('/agent2/runs', {
    method: 'POST',
    body: JSON.stringify({ goal }),
  });
}

export type AgentAction =
  | { action: 'tap'; target: { description: string } }
  | { action: 'type'; text: string }
  | { action: 'swipe'; direction: 'up' | 'down' | 'left' | 'right' }
  | { action: 'launch_app'; package: string }
  | { action: 'press_back' }
  | { action: 'press_home' }
  | { action: 'done'; result: string };

export function stepAgentRun(
  runId: string,
  observation: { currentApp: string; accessibilityTree: unknown; screenshotBase64: string }
) {
  return request<{ action: AgentAction; stepNumber: number; status: string }>(
    `/agent2/runs/${runId}/step`,
    { method: 'POST', body: JSON.stringify(observation) }
  );
}

export function stopAgentRun(runId: string) {
  return request<{ status: string }>(`/agent2/runs/${runId}/stop`, { method: 'POST' });
}
