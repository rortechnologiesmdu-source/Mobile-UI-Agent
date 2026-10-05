# Mobile UI Agent --- iOS / iPhone Implementation Plan

## Purpose

This document is the implementation handoff for building an iPhone/iOS
development and testing version of the existing Mobile-UI-Agent project.

The goal is to reuse the same locally running
`mlx-community/MAI-UI-2B-6bit-v2` model on the Mac while replacing the
Android AccessibilityService execution layer with an Xcode
XCTest/XCUIAutomation layer for a physical iPhone.

This is a development/testing project, not an App Store distribution
architecture.

## Critical iOS architecture decision

Do **not** try to build an Android-style iOS `AccessibilityService`.

Use an Xcode UI Testing Bundle based on:

-   XCTest
-   XCUIAutomation
-   XCUIApplication
-   XCUIElement
-   XCUIElementQuery
-   XCUIElementSnapshot
-   XCUIElementAttributes
-   XCUIScreen
-   XCUICoordinate
-   XCUIDevice

Apple documents XCUIAutomation as a UI-testing framework that can
control and inspect application UI. Its element attributes expose
accessibility-derived data such as identifier, type, value, title,
label, enabled/selected state and frame. XCUIScreen provides
screenshots. XCUIElement supports iOS gestures and coordinate
interaction. Apple also documents UI tests that interact with multiple
apps, including Settings.

Official references:

-   https://developer.apple.com/documentation/xcuiautomation
-   https://developer.apple.com/documentation/xctest/
-   https://developer.apple.com/documentation/xcuiautomation/xcuielement
-   https://developer.apple.com/documentation/xcuiautomation/xcuielementattributes
-   https://developer.apple.com/documentation/xcuiautomation/xcuiscreen
-   https://developer.apple.com/documentation/xcuiautomation/xcudevice
-   https://developer.apple.com/documentation/XCUIAutomation/recording-ui-automation-for-testing

## Target architecture

``` text
                         MAC MINI
                             |
              +--------------+--------------+
              |                             |
              v                             |
        Node / Express                     |
              |                             |
              v                             |
        MAI-UI FastAPI                     |
              |                             |
              v                             |
          MAI-UI 2B                        |
              |                             |
              v                             |
       normalized AgentAction               |
              |                             |
              +------------------+          |
                                 |          |
                                 v          |
                         iOS UI Test Runner
                           Swift/XCTest
                                 |
                                 v
                              iPhone
```

The iOS runner is the platform executor. The normal React Native iOS
application should not be treated as a global automation service.

## Existing Android project context

The existing project is a React Native mobile UI agent with a Kotlin
native layer.

Important existing components:

``` text
backend/
    Node/Express
    MongoDB
    Gemini integration

mobile/
    React Native
    Android native Kotlin layer

mobile/android/app/src/main/java/com/com.mobileuse.app/operator/
    MobileUseAccessibilityService.kt
    AgentModule.kt

mobile/
    AgentScreen.tsx
    src/api/client.ts
```

Existing Android responsibilities include:

-   screenshot capture
-   accessibility-tree extraction
-   UI observation
-   action execution
-   agent loop
-   Gemini integration
-   run state/history
-   MongoDB persistence

Existing Android action concepts include:

``` text
tap
type
swipe
launch_app
press_back
press_home
done
```

The Android implementation must continue working.

## Existing local MAI-UI environment

The Mac already has:

``` text
~/Qwen/mai-ui-test
~/Qwen/mai-ui-test/.venv
```

Model:

``` text
mlx-community/MAI-UI-2B-6bit-v2
```

Typical startup:

``` bash
cd ~/Qwen/mai-ui-test
source .venv/bin/activate
uvicorn server:app --host 0.0.0.0 --port 8080
```

The exact server command must be verified against the actual
`server.py`.

The existing prototype exposes:

``` text
GET /health
POST /analyze
```

The model should eventually be loaded once at server startup rather than
reloaded for every request.

## Shared agent architecture

The desired cross-platform model is:

``` text
                    Shared Agent Backend
                            |
                       AgentAction
                            |
                +-----------+-----------+
                |                       |
             Android                   iOS
                |                       |
     AccessibilityService        XCUIAutomation
                |                       |
             Android                 iPhone
```

The agent brain should not need to know whether the executor is Android
or iOS.

## Canonical AgentAction

Reuse the existing action type if one already exists. Otherwise create a
normalized schema similar to:

``` json
{
  "type": "tap",
  "target": {
    "description": "Settings",
    "point": {
      "x": 0.52,
      "y": 0.73
    }
  }
}
```

Recommended actions:

``` text
tap
type
swipe
long_press
launch_app
press_back
press_home
wait
done
```

Potential future actions:

``` text
press_enter
answer
```

Do not create incompatible Android and iOS action schemas.

## MAI-UI output

Do not assume MAI-UI's native action format is identical to the
application's current JSON.

First inspect the installed MAI-UI version/model behavior and verify its
real action vocabulary and coordinate convention.

Recommended architecture:

``` text
MAI-UI native response
        |
        v
response parser
        |
        v
normalized AgentAction
        |
        +---- Android executor
        |
        +---- iOS executor
```

Do not force a small UI model into an invented format if the native
action format is more reliable.

## Recommended iOS project structure

Create a separate UI-test target rather than placing cross-app
automation inside the normal React Native app:

``` text
Mobile-UI-Agent/
├── backend/
├── mobile/
│   ├── src/
│   ├── android/
│   └── ios/
└── ios-agent-runner/
    ├── MobileUIAgentUITests/
    │   ├── AgentUITest.swift
    │   ├── IOSAgentController.swift
    │   ├── IOSObservationProvider.swift
    │   ├── IOSActionExecutor.swift
    │   ├── IOSUIElementMapper.swift
    │   ├── AgentProtocol.swift
    │   └── TestConfiguration.swift
    └── MobileUIAgentUITests.xctestplan
```

The coding agent must inspect the repository before creating this
structure and avoid duplicating existing components.

## iOS observation layer

Create an abstraction such as:

``` text
IOSObservationProvider.swift
```

Responsibilities:

``` text
captureScreenshot()
captureUIHierarchy()
captureScreenSize()
captureOrientation()
captureActiveApp()
normalizeObservation()
```

Example normalized observation:

``` json
{
  "platform": "ios",
  "screen": {
    "width": 1179,
    "height": 2556,
    "orientation": "portrait"
  },
  "screenshot": "<base64>",
  "ui_tree": [],
  "active_app": {
    "bundle_id": "...",
    "name": "..."
  }
}
```

Never hard-code the screen dimensions.

## Screenshot capture

Use:

``` swift
let screenshot = XCUIScreen.main.screenshot()
```

Convert the result to PNG/JPEG data and then base64.

For the first proof of concept use PNG. Later benchmark PNG versus JPEG
and resizing.

Do not automatically copy the Android implementation's 540-pixel resize.
MAI-UI visual grounding must be measured.

## iOS UI hierarchy

Use:

``` text
XCUIElement
XCUIElementQuery
XCUIElementSnapshot
XCUIElementSnapshotProviding
XCUIElementAttributes
```

Important attributes include:

``` text
identifier
elementType
value
placeholderValue
title
label
hasFocus
isEnabled
isSelected
frame
```

Normalize elements into a cross-platform structure:

``` json
{
  "id": "login_button",
  "type": "button",
  "text": "Login",
  "label": "Login",
  "value": null,
  "identifier": "login_button",
  "enabled": true,
  "selected": false,
  "frame": {
    "x": 100,
    "y": 600,
    "width": 180,
    "height": 50
  }
}
```

## Tree limits

Do not send an unlimited UI tree.

Use:

``` text
MAX_NODES
MAX_DEPTH
MAX_TEXT_LENGTH
```

Prefer retaining:

1.  interactive elements
2.  visible elements
3.  text-bearing elements
4.  important ancestors

If nodes are omitted, include an omission count.

## Active app strategy

Do not assume `XCUIApplication()` always means the currently visible
arbitrary app.

Use explicit application references where possible:

``` swift
let app = XCUIApplication(bundleIdentifier: targetBundleID)
```

Maintain a configurable target bundle ID.

For multi-app flows, maintain explicit `XCUIApplication` references for
known bundle IDs.

The coding agent must verify which applications can be controlled on the
actual Xcode/iOS environment.

## Important iOS limitation

XCUIAutomation is officially a UI-testing framework, not a universal
Android-style accessibility service.

Apple documents multi-app UI testing, including interaction with
Settings, but this does not guarantee that every arbitrary app exposes
every UI element or that every screen is controllable in every
situation.

Therefore the implementation must support:

``` text
target visible/queryable?
    |
    +-- yes -> semantic UI action
    |
    +-- no -> coordinate action if supported
    |
    +-- no -> explicit unsupported/target-not-found error
```

Never silently claim success.

## iOS action executor

Create:

``` text
IOSActionExecutor.swift
```

Suggested interface:

``` swift
protocol AgentExecutor {
    func execute(_ action: AgentAction) throws -> ActionResult
}
```

Start with:

``` text
tap
type
swipe
wait
```

Then add:

``` text
long_press
launch_app
system actions
```

## Tap

Preferred order:

``` text
1. identifier
2. exact label
3. exact title/value
4. matching element
5. coordinate fallback
```

Semantic example:

``` swift
element.tap()
```

Coordinate fallback should use `XCUICoordinate`.

## Element matching

Do not simply select the first result.

Recommended priority:

``` text
exact identifier
    ↓
exact label
    ↓
exact title
    ↓
exact value
    ↓
fuzzy text
    ↓
coordinate
```

If multiple elements remain ambiguous, return:

``` text
target_ambiguous
```

## Coordinates

Canonical cross-platform coordinates should be:

``` text
0.0 <= x <= 1.0
0.0 <= y <= 1.0
```

Convert dynamically:

``` text
absoluteX = normalizedX * screenWidth
absoluteY = normalizedY * screenHeight
```

However, MAI-UI may use a different coordinate range. Normalize its
coordinates in the backend parser before they reach the iOS executor.

Validate coordinate mapping using:

``` text
(0,0)
(1,0)
(0,1)
(1,1)
(0.5,0.5)
```

before using the agent for complex tasks.

## Type text

Conceptually:

``` swift
textField.tap()
textField.typeText("hello")
```

Validate existence/enabled/hittable state first.

Test special characters and keyboard behavior.

## Swipe

Support:

``` text
up
down
left
right
```

Prefer element methods where applicable:

``` text
swipeUp()
swipeDown()
swipeLeft()
swipeRight()
```

Future schema can support precise start/end coordinates and duration.

## Long press

Add long press because UI agents often need it for context menus and
drag initiation.

Use supported XCTest/XCUIAutomation APIs for the exact SDK in use. Do
not use private event injection.

## Home/system actions

Apple provides device-level testing interactions through:

``` swift
XCUIDevice.shared
```

Verify the actual supported physical-button/system interactions for the
current iPhone and iOS version.

Do not assume an Android-style home action has an exact iOS equivalent.

If unsupported, return:

``` json
{
  "success": false,
  "error": "unsupported_system_action"
}
```

## Back navigation

There is no universal Android-style Back button.

Do not implement:

``` text
press_back -> blindly swipe from left
```

Instead use visible navigation controls or app-specific navigation where
available.

Treat `press_back` as a logical action that the iOS executor resolves to
a supported navigation mechanism.

## Wait

Support:

``` json
{
  "type": "wait",
  "duration_ms": 1000
}
```

Prefer state-based waiting such as element existence rather than fixed
sleeps whenever possible.

## Launch app

Use known bundle IDs with `XCUIApplication(bundleIdentifier:)`.

Do not hard-code arbitrary IDs without verifying them.

## Agent loop

Use the existing backend/run-state design.

Recommended flow:

``` text
iOS runner
    |
    | observation
    v
Node/Express
    |
    v
MAI-UI FastAPI
    |
    v
MAI-UI
    |
    v
normalized AgentAction
    |
    v
iOS runner
```

The iOS runner should not directly call the model if the Node backend
already owns run state/history.

## Runner loop

Conceptually:

``` swift
while !finished && step < maxSteps {
    let observation = try observer.capture()

    let action = try backend.decide(
        task: task,
        observation: observation,
        history: history
    )

    let result = try executor.execute(action)

    history.append(
        observation: observation,
        action: action,
        result: result
    )

    if action.type == "done" {
        finished = true
    }

    step += 1
}
```

Initial safety values:

``` text
MAX_STEPS=15
MAX_RUNTIME_SECONDS=180
```

Make configurable.

## Backend communication

Recommended:

``` text
Swift XCTest
    |
    | HTTP/JSON
    v
Node :4000
```

Configuration:

``` text
AGENT_BACKEND_URL=http://<MAC-IP>:4000
```

Do not hard-code the Mac IP in source.

Use Xcode scheme environment variables or configuration files.

## Suggested observation request

``` json
{
  "run_id": "abc123",
  "platform": "ios",
  "task": "Open Settings and find Wi-Fi",
  "observation": {
    "screenshot_base64": "...",
    "ui_tree": [],
    "screen": {
      "width": 1179,
      "height": 2556,
      "orientation": "portrait"
    },
    "active_app": {
      "bundle_id": "com.apple.Preferences",
      "name": "Settings"
    }
  }
}
```

Response:

``` json
{
  "action": {
    "type": "tap",
    "target": {
      "identifier": "Wi-Fi"
    }
  }
}
```

Execution response:

``` json
{
  "success": true,
  "action": "tap"
}
```

## Action validation

Before execution validate:

``` text
known action type
required target exists
coordinates finite
0 <= x <= 1
0 <= y <= 1
text exists for type
direction valid for swipe
duration reasonable
```

Never execute arbitrary model-generated code.

## MAI-UI prompt

Conceptually provide:

``` text
TASK:
<user task>

PLATFORM:
iOS

SCREEN:
<dimensions/orientation>

UI TREE:
<normalized hierarchy>

SCREENSHOT:
<image>

HISTORY:
<recent steps>
```

Tell the model:

``` text
You are operating an iOS UI.
Use the screenshot and UI information.
Choose the smallest appropriate action.
Do not invent UI elements.
Do not claim success unless the requested state is visible.
```

However, use MAI-UI's verified native prompt/action format if its model
card/package requires one.

## History and loop detection

Maintain recent:

``` text
observation
action
execution result
next observation
```

Detect repeated cycles such as:

``` text
same observation
same action
same observation
same action
```

After a threshold, return `agent_stuck` or request a different strategy.

## Safety

Because this agent can operate a real iPhone, initially restrict testing
to harmless tasks.

Recommended controls:

``` text
MAX_STEPS
MAX_RUNTIME
ALLOW_SYSTEM_APPS
ALLOW_EXTERNAL_APPS
CONFIRM_SENSITIVE_ACTIONS
```

Avoid initial tests involving: - banking - purchases - deleting data -
password entry - sending messages - changing important accounts/settings

## Logging

Each step should record:

``` text
timestamp
run_id
step
task
active app
node count
model action
normalized action
execution result
latency
error
```

Do not log credentials, tokens, or sensitive text unnecessarily.

## Physical iPhone setup

Prerequisites:

``` text
Mac
Xcode
Apple development signing
physical iPhone
USB or supported wireless development connection
trusted/paired device
current iOS/Xcode development requirements satisfied
```

The coding agent must verify the actual current Xcode/iOS requirements
rather than assuming an old setup.

Useful discovery:

``` bash
xcrun xctrace list devices
xcodebuild -list
```

## Xcode test command

The coding agent should make the UI test target runnable from Terminal.

Conceptually:

``` bash
xcodebuild   -project <project>.xcodeproj   -scheme <UITestScheme>   -destination 'platform=iOS,id=<DEVICE_ID>'   test
```

Use the actual workspace/project/scheme/device information discovered
from the repository.

## Xcode environment variables

Configure:

``` text
AGENT_BACKEND_URL
AGENT_MAX_STEPS
AGENT_TIMEOUT_SECONDS
AGENT_TARGET_BUNDLE_ID
AGENT_DEBUG
```

Example:

``` text
AGENT_BACKEND_URL=http://192.168.x.x:4000
AGENT_MAX_STEPS=15
AGENT_TIMEOUT_SECONDS=180
AGENT_DEBUG=true
```

Do not commit a personal LAN IP.

## Secrets

A local `details.txt` contains development secrets.

Never: - commit it - print it - copy secrets into source - place
credentials in this document - paste credentials into logs

Ensure `.gitignore` protects it.

## FastAPI/network security

FastAPI currently binds to:

``` text
0.0.0.0:8080
```

That makes it reachable from the local network.

For development: - trusted LAN only - no public exposure - no port
forwarding - consider localhost when remote access is unnecessary

Do not expose the inference service publicly without
authentication/security controls.

## MAI-UI performance

Do not reload the 2B model for every agent step.

Preferred:

``` text
server startup
    |
    v
load model once
    |
    +--> request 1
    +--> request 2
    +--> request 3
```

Measure: - screenshot time - tree extraction - HTTP latency - model
inference - action execution - full step time

## First proof of concept --- no MAI-UI

Create the smallest XCUITest:

``` text
Start physical-device test
        |
        v
Capture screenshot
        |
        v
Find a known UI element
        |
        v
Tap it
        |
        v
Capture second screenshot
        |
        v
Report result
```

Example harmless flow:

``` text
Open Settings
Find Wi-Fi
Tap Wi-Fi
```

If this cannot be made reliable with public XCUITest APIs, stop and
report the limitation before building the agent.

## Second proof of concept --- backend

After the iOS POC works:

``` text
XCUITest
    |
    | screenshot + tree
    v
Node backend
    |
    v
test response
```

Verify serialization and networking before using MAI-UI.

## Third proof of concept --- MAI-UI

Then:

``` text
iPhone screenshot
+
iOS UI tree
+
task
    |
    v
Node
    |
    v
FastAPI
    |
    v
MAI-UI
    |
    v
action
```

Start with a single action.

## Fourth proof of concept --- execution

Test:

``` text
"Tap Wi-Fi."
```

Verify:

``` text
observation
    ->
model
    ->
parsed action
    ->
target resolution
    ->
XCUIAutomation
    ->
post-action observation
```

Only after this works enable the complete loop.

## Full agent test progression

Start with:

``` text
Open Settings.
```

Then:

``` text
Find Wi-Fi.
```

Then:

``` text
Open Wi-Fi.
```

Then:

``` text
Scroll down.
```

Then:

``` text
Type into a safe test text field.
```

Then multi-step navigation.

## Gemini fallback

Keep:

``` text
AgentBackend
    |
    +-- MAI_UI_LOCAL
    |
    +-- GEMINI
```

Example configuration:

``` text
AGENT_BACKEND=MAI_UI_LOCAL
```

Do not remove Gemini until MAI-UI is reliable.

## Cross-platform safety

The iOS work must not break:

``` text
Android AccessibilityService
AgentModule.kt
Android screenshot
Android tree extraction
Android action execution
existing run state
Gemini fallback
```

## Recommended Swift abstractions

``` swift
protocol ObservationProvider {
    func capture() throws -> AgentObservation
}

protocol AgentExecutor {
    func execute(_ action: AgentAction) throws -> ActionResult
}

protocol AgentBackend {
    func decide(
        task: String,
        observation: AgentObservation,
        history: [AgentStep]
    ) async throws -> AgentAction
}
```

Use existing project models if equivalent types already exist.

## Suggested Swift data types

``` swift
struct AgentAction: Codable {
    let type: String
    let target: AgentTarget?
    let text: String?
    let direction: String?
    let durationMs: Int?
}

struct AgentTarget: Codable {
    let identifier: String?
    let label: String?
    let x: Double?
    let y: Double?
}

struct AgentObservation: Codable {
    let platform: String
    let screenshotBase64: String
    let uiTree: [UIElement]
    let screen: ScreenInfo
    let activeApp: AppInfo?
}
```

Do not duplicate an existing shared schema.

## Failure codes

Use structured errors such as:

``` text
NETWORK_ERROR
MODEL_ERROR
INVALID_MODEL_ACTION
TARGET_NOT_FOUND
TARGET_AMBIGUOUS
TARGET_NOT_HITTABLE
UNSUPPORTED_ACTION
COORDINATE_OUT_OF_RANGE
TIMEOUT
AGENT_STUCK
TEST_RUNNER_ERROR
APP_NOT_FOUND
```

Never silently continue after an execution failure.

## Testing

Unit-test:

``` text
model response parser
coordinate conversion
action validation
element matching
observation serialization
error handling
```

Real-device UI-test:

``` text
tap
type
swipe
multi-step flow
```

## Development order

### Phase 1 --- Audit

No behavior changes.

Identify: - iOS project - Xcode schemes - UI test targets -
AgentAction - backend endpoints - MAI-UI service - Android executor -
React Native integration

### Phase 2 --- iOS POC

Screenshot + UI hierarchy + tap.

### Phase 3 --- Observation

Normalize iOS observation.

### Phase 4 --- Executor

Tap/type/swipe/wait.

### Phase 5 --- Backend

XCTest -\> Node.

### Phase 6 --- MAI-UI

Node -\> FastAPI -\> MAI-UI.

### Phase 7 --- One action

MAI-UI -\> tap.

### Phase 8 --- Full loop

Observe -\> reason -\> act -\> observe.

### Phase 9 --- Reliability

History, loop detection, timeouts, errors.

### Phase 10 --- Cross-platform

Verify Android remains functional.

## Definition of done

-   [ ] Physical iPhone is recognised by Xcode.
-   [ ] UI test target runs on the physical iPhone.
-   [ ] XCUIScreen screenshot works.
-   [ ] UI hierarchy/snapshot extraction works for selected test apps.
-   [ ] Normalized observation is generated.
-   [ ] Observation reaches Node.
-   [ ] Node reaches local MAI-UI.
-   [ ] MAI-UI returns a valid action.
-   [ ] Action is validated.
-   [ ] iOS executor executes it.
-   [ ] Post-action observation works.
-   [ ] Multi-step loop works.
-   [ ] 15-step safety limit works.
-   [ ] timeout works.
-   [ ] loop detection works.
-   [ ] structured errors work.
-   [ ] Android still works.
-   [ ] Gemini fallback still works.
-   [ ] no secrets are committed.
-   [ ] no private APIs are used.

# Coding-agent instructions

Before modifying code:

1.  Inspect the repository thoroughly.
2.  Inspect the iOS project and Xcode schemes.
3.  Identify existing UI test targets.
4.  Identify the shared AgentAction model.
5.  Identify the Node endpoints.
6.  Identify the MAI-UI FastAPI contract.
7.  Identify Android observation/action components.
8.  Report the exact files/classes that should change.
9.  Do not rewrite working components unnecessarily.
10. Build the physical-iPhone XCUITest proof of concept first.
11. Do not integrate MAI-UI until screenshot/tree/tap works.
12. Preserve Gemini fallback.
13. Do not expose secrets.
14. Do not use private iOS APIs.
15. Do not assume arbitrary-app control is guaranteed.
16. Validate coordinate mapping before complex tasks.
17. Keep Android working throughout.

The desired final flow is:

``` text
iPhone / XCTest
      |
      | screenshot + normalized UI tree + task
      v
Node / Express
      |
      v
FastAPI
      |
      v
local MAI-UI-2B
      |
      v
normalized AgentAction
      |
      v
iOS XCUIAutomation executor
      |
      v
iPhone
```

## Final principle

**Same brain, different hands.**

MAI-UI remains the shared UI-reasoning brain.

Android uses:

``` text
AccessibilityService
```

iOS development/testing uses:

``` text
XCTest + XCUIAutomation
```

Do not attempt to make the iOS side a fake Android AccessibilityService.
