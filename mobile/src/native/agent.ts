import { NativeModules } from 'react-native';

const { AgentModule } = NativeModules;

export type AccessibilityNode = {
  text: string;
  contentDescription: string;
  className: string;
  clickable: boolean;
  scrollable: boolean;
  bounds: { left: number; top: number; right: number; bottom: number };
};

export type Observation = {
  currentApp: string;
  accessibilityTree: AccessibilityNode[];
  screenshotBase64: string;
};

// Safety net on top of the native-side watchdog (see MobileUseAccessibilityService.kt) —
// if a native promise never settles for any reason, the agent loop must still be able
// to recover with a clear error instead of hanging forever.
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

export function checkAccessibilityEnabled(): Promise<boolean> {
  return AgentModule.checkAccessibilityEnabled();
}

export function openAccessibilitySettings(): void {
  AgentModule.openAccessibilitySettings();
}

export function getObservation(): Promise<Observation> {
  return withTimeout(AgentModule.getObservation(), 10000, 'getObservation');
}

export function executeAction(action: Record<string, unknown>): Promise<boolean> {
  return withTimeout(AgentModule.executeAction(action), 8000, 'executeAction');
}
