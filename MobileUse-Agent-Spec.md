# MobileUse Agent — Project Spec

## 1. Problem

Right now, if you want an AI to "do something" on your phone (check your Amazon orders, open an app and search for something, read a screen and summarize it), the only real options are:

- Build a dedicated integration for every single app (API/MCP), which doesn't scale and most consumer apps don't expose one anyway.
- Manually do it yourself.

There's no general-purpose way for an AI agent to operate a phone the way a human does — by looking at the screen, understanding what's on it, and tapping/typing/swiping to get things done — across **any** app, without needing that app's cooperation.

## 2. Solution

**MobileUse** is an independent Android app (built with React Native + a native Android module) that acts as an AI agent living on the user's own phone. It:

1. **Observes** the current screen using two combined signals:
   - A **screenshot** (visual — what a human would see)
   - The **Accessibility Tree** (semantic — labeled UI elements like buttons, text, and their positions)
2. **Sends this combined observation** to a cloud-hosted multimodal LLM, which decides the next action toward the user's stated goal.
3. **Acts** on the phone via Android's Accessibility APIs — tap, type, swipe, scroll, launch app, go back/home.
4. **Loops**: observe → decide → act → observe again, until the goal is done or it needs to stop.

No laptop, no ADB, no USB connection. Once installed and permissions are granted, the app runs entirely standalone on the phone. The "brain" (LLM) lives in the cloud; the "eyes and hands" (screenshot capture, accessibility tree reading, tap/type/swipe execution) live on the phone.

### Explicit scope decisions (v0.1)

- **No authentication handling needed for now** — target apps (e.g. Amazon, Chrome, YouTube) are already logged in on the phone. The agent does not need to handle PIN/OTP/biometric/2FA flows in this version. *(This should still be revisited before expanding to apps that log out or session-expire — flagging it as a known future gap, not solving it now.)*
- **No local sandboxed app-data reading** (e.g. no reading another app's private database). Not possible on non-rooted Android anyway due to OS sandboxing — irrelevant for this architecture.
- **Simple actions only** for v0.1: open an app, tap something, type something, read/report back what's on screen. No multi-app chained workflows, no background scheduling yet.

## 3. Tech Stack

| Layer | Choice | Why |
|---|---|---|
| App shell / UI | **React Native** | Cross-platform UI, fast iteration, user's chosen framework |
| OS-level agent capabilities | **Native Android module (Kotlin)**, bridged into React Native via a Native Module / Turbo Module | `AccessibilityService` and `MediaProjection` (screenshot capture) are Android system APIs — they are not accessible from JS/React Native directly and **must** be implemented natively in Kotlin, then exposed to the RN JS layer through a bridge |
| Screen observation | `AccessibilityService` (UI tree) + `MediaProjection` (screenshot bitmap) | Together give both semantic (labeled elements) and visual (pixels) understanding of the screen |
| Action execution | `AccessibilityService` gesture dispatch (`dispatchGesture`) + node-based actions (`performAction(ACTION_CLICK)` etc.) | Standard, supported Android mechanism for an app to act on behalf of the user, no root/ADB needed |
| AI brain | **Cloud multimodal LLM** — Google **Gemini (free tier via Google AI Studio API)**, same choice as the [[browser-agent-learning]] browser-use project, for consistency and zero cost. Gemini 2.0/2.5 Flash supports image input, which is required since we're sending screenshots. | Free tier, multimodal (accepts screenshot + text), same provider already validated in the browser project |
| Networking | Simple REST call from the phone (via RN, or via the Kotlin native side) to the Gemini API with the screenshot (base64) + accessibility tree (JSON) + goal + history | Straightforward, no separate backend server needed for v0.1 |
| State/history | In-app local storage (e.g. simple JSON/SQLite via RN) | Keep last N steps, current app, current screen state for the agent's short-term memory |

**Note on the free-tier check:** Google AI Studio's Gemini API free tier does support image (vision) input as of now, with request-per-minute/day limits that are workable for a single-user personal agent doing occasional tasks. Rate limits should be checked at implementation time since free-tier quotas change — worth a quick live check on Google AI Studio's pricing page before building.

## 4. Methods / Functionalities (v0.1)

### 4.1 Onboarding / Permissions
- Request **Accessibility Service** permission (user enables MobileUse under Settings → Accessibility).
- Request **Screen Capture (MediaProjection)** permission (one-time system dialog, re-prompted per session per Android rules).
- Simple in-app explanation screens for both ("MobileUse needs this to see and act on your screen on your behalf").

### 4.2 Observation Engine
- `captureScreenshot()` — grabs current screen bitmap via MediaProjection, encodes to base64/compressed JPEG.
- `getAccessibilityTree()` — walks the current active window's node tree via `AccessibilityNodeInfo`, extracts: text, contentDescription, className, bounds (screen coordinates), clickable/scrollable flags.
- `getCurrentApp()` — current foreground package name, for context.
- Combine into a single JSON "observation" object sent to the LLM each step.

### 4.3 Agent Loop (core logic)
```
1. User types a goal (e.g. "Open Chrome and search Predestination")
2. LOOP:
   a. Capture observation (screenshot + a11y tree + current app)
   b. Send observation + goal + step history to Gemini
   c. Gemini returns a semantic action, e.g.:
      { "action": "tap", "target": { "description": "Search bar" } }
      { "action": "type", "text": "Predestination" }
      { "action": "launch_app", "package": "com.android.chrome" }
      { "action": "done", "result": "..." }
   d. Action Resolver:
      - First try to match target.description to an accessibility node → click/act on it directly (deterministic, coordinates from node bounds)
      - If no matching node found, fall back to using the screenshot + returned bounding box estimate from the LLM to tap by (x,y)
   e. Execute the resolved physical action (tap/type/swipe/launch)
   f. If action == "done" → stop and show result to user
   g. Else → go back to (a)
3. Safety cap: max N steps per task (e.g. 15) to avoid infinite loops; show "stuck" state to user if hit
```

### 4.4 Action Types (v0.1 minimal set)
- `tap(target_description)`
- `type(text)`
- `swipe(direction)` — up/down/left/right scroll
- `launch_app(package_name)`
- `press_back()`
- `press_home()`
- `done(result_text)` — agent reports completion + any extracted info back to the user

### 4.5 UI (React Native)
- Simple chat-style screen: text input for the goal, "Run Agent" button.
- Live status panel while running: current step number, current detected action ("Tapping 'Search'...", "Typing 'Predestination'..."), and optionally the current screenshot thumbnail for debuggability.
- "Stop" button to abort mid-task.
- History list of past runs (goal + success/fail + result text).

## 5. Agent Details

**Brain vs body split:**
- **Brain** (decision-making): Gemini API call — receives observation, returns next semantic action. Stateless per call; conversation history/short-term memory passed in each request as context.
- **Body** (perception + actuation): Native Kotlin module — screenshot capture, accessibility tree reading, gesture dispatch. Purely mechanical, no intelligence.
- **Bridge**: React Native JS layer orchestrates the loop — calls native module for observation, calls Gemini API for decision, calls native module again for action.

**Action resolution priority (semantic-first, vision-fallback):**
1. Accessibility tree node match (most reliable, exact coordinates from node bounds)
2. Vision-based bounding box estimate from the screenshot (fallback when no matching node — e.g. icon-only buttons with no label)

**Safety rules baked in from v0.1:**
- Hard step limit per task to prevent runaway loops.
- Agent only ever acts within apps already present/logged in on the phone — no credential entry, no handling of PIN/OTP/biometric screens in this version.
- All actions logged (screenshot + a11y tree + chosen action) at every step, both for debugging and as a dataset for later improving reliability.

## 6. First Test Tasks (build → validate in this order)

1. "Open Chrome" — launch_app + verify foreground app changed.
2. "Open Chrome and search for Predestination" — launch, find search bar (a11y match), tap, type, press enter.
3. "Open Amazon and tell me my most recent order" — navigate to Orders, read/extract text from accessibility tree, report back — no tapping precision required, tests the *read* path.

If all three work reliably, v0.1 is proven and ready to expand (more action types, scheduling, more apps).
