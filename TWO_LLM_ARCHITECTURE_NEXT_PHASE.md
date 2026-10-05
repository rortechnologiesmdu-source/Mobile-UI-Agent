# Mobile UI Agent --- Two-LLM Architecture & Next Phase

## Purpose

This is the implementation handoff for the next phase of Mobile UI
Agent.

The system will use two specialised local LLMs:

1.  **MAI-UI-2B** --- UI perception, grounding and UI action selection.
2.  **Qwen3-8B** --- reasoning, planning, text understanding,
    information extraction, response generation and verification.

The key principle is:

> Qwen3 decides **WHAT should happen next**. MAI-UI decides **HOW to
> perform that UI step**. Android executes the action. The resulting
> observation goes back to the orchestrator.

------------------------------------------------------------------------

## 1. Target Architecture

``` text
USER
  |
  v
React Native
  |
  v
Node / Express Orchestrator
  |
  +--------------------------+
  |                          |
  v                          v
Qwen3-8B                  MAI-UI-2B
Reasoning LLM             UI Specialist
  |                          |
  | high-level subgoal       | UI action
  |                          v
  |                    Android AccessibilityService
  |                          |
  +<------ observation -----+
```

The Node backend is the deterministic orchestrator and owns:

-   AgentState
-   plans and subgoals
-   model calls
-   observations
-   action validation
-   retries
-   loop detection
-   verification
-   completion/failure state

Android should remain primarily an execution and observation layer.

------------------------------------------------------------------------

## 2. Responsibilities

### Qwen3-8B --- Reasoning / Brain

Qwen3 owns:

-   understanding the user's complete request
-   breaking a task into subgoals
-   deciding what information must be found
-   reading and understanding text extracted from screens
-   extracting facts
-   maintaining semantic task state
-   generating messages
-   deciding whether a subgoal is complete
-   deciding whether the overall task is complete
-   deciding whether to retry or change strategy
-   requesting user confirmation for sensitive/external actions

Qwen3 should **not** generate raw screen coordinates.

Example:

``` json
{
  "type": "SUBGOAL",
  "subgoal": "Navigate to Orders in Flipkart"
}
```

Not:

``` json
{
  "x": 0.72,
  "y": 0.18
}
```

### MAI-UI-2B --- UI Specialist

MAI-UI owns:

-   interpreting the current screenshot
-   grounding a target UI element
-   using accessibility/UI information where available
-   choosing a UI action
-   navigating the current application toward the supplied subgoal

MAI-UI should **not** own the user's entire task.

Example input:

``` text
Subgoal:
Navigate to Orders in Flipkart.

Current screenshot:
...

Accessibility tree:
...
```

Example output after the project-specific adapter:

``` json
{
  "type": "tap",
  "target": {
    "description": "Orders",
    "point": {
      "x": 0.72,
      "y": 0.18
    }
  }
}
```

------------------------------------------------------------------------

## 3. Why Two Models?

A task such as:

> Check the last ordered item in Flipkart and send the item's name to
> Prasanna in WhatsApp.

contains multiple capabilities:

1.  Understand intent.
2.  Open Flipkart.
3.  Navigate to Orders.
4.  Identify the latest order.
5.  Read the product name.
6.  Remember it.
7.  Open WhatsApp.
8.  Find Prasanna.
9.  Generate the message.
10. Type and send it.
11. Verify that it was sent.

MAI-UI is specialised for the UI portions. Qwen3 is better positioned as
the semantic planner and reasoning layer.

The architecture therefore becomes:

``` text
Qwen3
  -> "Navigate to Orders"

MAI-UI
  -> tap Account
  -> tap Orders

Android
  -> executes

Observation
  -> returned to orchestrator

Qwen3
  -> "The latest product is X"

Qwen3
  -> "Find Prasanna in WhatsApp"

MAI-UI
  -> navigates to Prasanna

Qwen3
  -> generates exact message

MAI-UI
  -> types and sends

Observation
  -> verification

Qwen3
  -> COMPLETE
```

------------------------------------------------------------------------

## 4. Models

### Existing UI model

Keep the currently working model:

``` text
mlx-community/MAI-UI-2B-6bit-v2
```

Do not replace the current MAI-UI setup during the first implementation
pass.

Official project:

https://github.com/Tongyi-MAI/MAI-UI

### New reasoning model

Use:

``` text
Qwen/Qwen3-8B-MLX-4bit
```

This is the preferred initial local reasoning model for the user's Apple
Silicon Mac with 16 GB unified memory.

Official model:

https://huggingface.co/Qwen/Qwen3-8B-MLX-4bit

Use MLX / `mlx-lm`. Do not commit model weights into Git.

------------------------------------------------------------------------

## 5. Automatic Model Setup

The coding agent should automate model setup as much as practical.

Provide a script such as:

``` bash
./scripts/setup_reasoning_model.sh
```

or an equivalent command.

It should:

1.  Check Python.
2.  Create/use a dedicated reasoning virtual environment.
3.  Install/update `mlx-lm`.
4.  Download `Qwen/Qwen3-8B-MLX-4bit` if missing.
5.  Avoid downloading it again if already cached.
6.  Run a small generation test.
7.  Print the model location and success/failure.

Example Python loading:

``` python
from mlx_lm import load, generate

model, tokenizer = load("Qwen/Qwen3-8B-MLX-4bit")
```

Do not put model files inside the Git repository.

Add any local model directories to `.gitignore`.

If Hugging Face authentication is required, use the local Hugging Face
CLI or an environment variable. Never put tokens in source code.

------------------------------------------------------------------------

## 6. Memory Constraint

The development Mac has 16 GB unified memory.

Therefore:

-   Start with Qwen3-8B 4-bit.
-   Do not automatically download large BF16/14B/32B models.
-   Avoid unnecessarily loading duplicate model instances.
-   Keep MAI-UI and Qwen3 independently startable.
-   If both models compete for memory, the architecture must still
    remain valid while services are started/stopped independently.

------------------------------------------------------------------------

## 7. Local Services

Recommended development topology:

``` text
Mac
|
+-- MAI-UI service
|     MAI-UI-2B
|     FastAPI
|     :8080
|
+-- Reasoning service
|     Qwen3-8B-4bit
|     MLX
|     :8090
|
+-- Node / Express backend
      :4000
```

Preserve the existing MAI-UI port if it is already configured
differently.

Prefer an OpenAI-compatible API for Qwen3 so the Node backend can use a
standard client.

Example:

``` text
POST /v1/chat/completions
GET  /health
```

The reasoning service should expose its loaded model name through
`/health`.

------------------------------------------------------------------------

## 8. Android Must Not Call the Models Directly

Preferred:

``` text
Android
   |
   v
Node / Express
   |
   +--> Qwen3
   |
   +--> MAI-UI
```

Do not add Qwen3-specific model loading to Android.

Do not add MAI-UI implementation-specific networking to Android.

This keeps the mobile layer model-independent.

------------------------------------------------------------------------

## 9. AgentState

The orchestrator should own a structured state object.

Example:

``` json
{
  "task": "Check the last ordered item in Flipkart and send the item's name to Prasanna in WhatsApp",
  "status": "running",
  "current_app": "Flipkart",
  "current_subgoal": "Find the most recent order",
  "facts": {
    "recipient": "Prasanna",
    "last_ordered_item": null
  },
  "plan": [
    "Open Flipkart",
    "Navigate to Orders",
    "Identify latest order",
    "Extract product name",
    "Open WhatsApp",
    "Find Prasanna",
    "Send product name",
    "Verify message"
  ],
  "completed_steps": [],
  "last_action": null,
  "retry_count": 0,
  "step_count": 0
}
```

The exact schema can evolve, but state ownership must remain in the
orchestrator.

------------------------------------------------------------------------

## 10. Model Contracts

Create three clear contracts:

``` text
AgentState
ReasoningDecision
AgentAction / UIObservation
```

### ReasoningDecision

Suggested types:

``` text
SUBGOAL
EXTRACT
RESPOND
VERIFY
COMPLETE
FAIL
ASK_USER
```

Example:

``` json
{
  "type": "EXTRACT",
  "field": "last_ordered_item",
  "value": "boAt Rockerz 450 Bluetooth Headphones",
  "confidence": 0.94
}
```

### MAI-UI boundary

Keep MAI-UI-specific output behind an adapter:

``` text
MAI-UI native response
        |
        v
maiUiAdapter
        |
        v
existing AgentAction
        |
        v
Android
```

Do not make Android understand MAI-UI's native response format.

------------------------------------------------------------------------

## 11. Orchestrator Loop

The old blind loop should evolve from:

``` text
action
 -> sleep
 -> action
 -> sleep
```

to:

``` text
Qwen3 decides subgoal
       |
       v
MAI-UI performs UI action
       |
       v
Android executes
       |
       v
Observation
       |
       v
Verification / state update
       |
       v
Qwen3 decides next subgoal
       |
       v
repeat
```

Each step should have bounded retries and an overall step limit.

Suggested initial limits:

``` text
MAX_STEP_COUNT = 30
MAX_SUBGOAL_RETRIES = 3
MAX_IDENTICAL_ACTIONS = 3
```

These should be configurable.

------------------------------------------------------------------------

## 12. Qwen3 Prompt Responsibilities

The reasoning system prompt should make the model's boundary explicit:

``` text
You are the reasoning/planning model for a mobile UI agent.

You understand the user's task, plan the task, extract information,
generate text, maintain semantic state, and decide when the task is
complete.

You do NOT directly control the screen.
You do NOT generate tap coordinates.

A separate UI specialist, MAI-UI, performs UI interactions.

Return structured JSON according to the defined decision schema.
```

Use separate logical prompt modes for:

``` text
Planner
Extractor
Response Generator
Verifier
```

These are roles of the same Qwen3 model, not separate model instances.

------------------------------------------------------------------------

## 13. MAI-UI Prompt Responsibilities

MAI-UI should receive a focused UI subgoal.

Conceptually:

``` text
You are the UI execution specialist.

You receive the current screen and a focused UI subgoal.

Find the relevant UI element and perform the action needed to
make progress toward that subgoal.

Do not reinterpret the entire user's task.
Do not invent unrelated actions.
```

Use the existing MAI-UI integration format where possible.

------------------------------------------------------------------------

## 14. Example: Flipkart → WhatsApp

User:

``` text
Check the last ordered item in Flipkart and send the item's name to Prasanna in WhatsApp.
```

### Qwen3

``` json
{
  "type": "SUBGOAL",
  "subgoal": "Open Flipkart and navigate to Orders"
}
```

### MAI-UI

Uses screenshot/UI tree and performs the necessary taps.

### Android

Executes the returned action.

### Observation

Returns screenshot + accessibility tree + package + useful visible text.

### Qwen3

Reads the order screen:

``` json
{
  "type": "EXTRACT",
  "field": "last_ordered_item",
  "value": "boAt Rockerz 450 Bluetooth Headphones"
}
```

Orchestrator stores:

``` json
{
  "facts": {
    "last_ordered_item": "boAt Rockerz 450 Bluetooth Headphones"
  }
}
```

### Qwen3

``` json
{
  "type": "SUBGOAL",
  "subgoal": "Open WhatsApp and locate the conversation with Prasanna"
}
```

### MAI-UI

Navigates to Prasanna.

### Qwen3

``` json
{
  "type": "RESPOND",
  "recipient": "Prasanna",
  "message": "The last item I ordered was boAt Rockerz 450 Bluetooth Headphones."
}
```

### MAI-UI

Receives the focused UI instruction:

``` text
Enter this exact message in the current WhatsApp chat and send it.
```

It finds the message box, types, and sends.

### Verification

The orchestrator obtains a new observation and verifies that:

-   the intended chat is open;
-   the sent message appears;
-   the text matches the intended message.

Only then:

``` json
{
  "type": "COMPLETE",
  "result": "The item name was sent to Prasanna in WhatsApp.",
  "completion": true
}
```

------------------------------------------------------------------------

## 15. External Action Safety

Sending a WhatsApp message is an external side effect.

During development, implement:

``` env
AGENT_CONFIRM_EXTERNAL_ACTIONS=true
```

Before sending:

``` text
Recipient: Prasanna
Message: The last item I ordered was ...

Confirm?
```

Only after confirmation should MAI-UI execute the send.

Do not silently send messages during early testing.

------------------------------------------------------------------------

## 16. Verification

Never assume that an action succeeded just because Android executed it.

Use:

``` text
Action
  ↓
New observation
  ↓
Verification
  ↓
State update
```

Examples:

-   after opening Orders, verify Orders content is visible;
-   after selecting Prasanna, verify the correct chat;
-   after sending a message, verify the message appears.

------------------------------------------------------------------------

## 17. Retry and Loop Detection

Track:

``` text
last action
current screen hash
recent actions
current subgoal
retry count
```

If the agent repeatedly does:

``` text
tap Orders
tap Orders
tap Orders
```

without progress, stop the loop and ask Qwen3 to re-plan.

If the agent reaches:

``` text
A -> B -> A -> B -> A -> B
```

detect it as a loop.

Never allow an unlimited agent loop.

------------------------------------------------------------------------

## 18. Observation Design

Keep observations structured:

``` json
{
  "package": "com.flipkart.android",
  "screen_width": 1080,
  "screen_height": 2400,
  "screenshot": "...",
  "accessibility_tree": [],
  "visible_text": [
    "Orders",
    "Delivered",
    "boAt Rockerz 450 Bluetooth Headphones"
  ]
}
```

Use the screenshot for visual grounding and use structured
text/accessibility information when it is sufficient for semantic
reasoning.

Do not send huge duplicated histories unnecessarily.

------------------------------------------------------------------------

## 19. Existing Android Layer

Reuse the current:

-   `MobileUseAccessibilityService`
-   `AgentModule`
-   React Native observation/action bridge
-   screenshot collection
-   accessibility tree
-   existing AgentAction executor

The Android layer should primarily:

``` text
receive action
 -> execute
 -> return result/observation
```

It should not contain the reasoning logic.

------------------------------------------------------------------------

## 20. Existing Gemini

Do not remove Gemini immediately.

Create a provider abstraction:

``` text
ReasoningProvider
|
+-- Qwen3LocalProvider
|
+-- GeminiProvider
```

Configuration:

``` env
REASONING_PROVIDER=qwen3
```

The existing Gemini provider should remain available as a fallback
during development.

This also makes it possible to compare:

``` text
Qwen3 local
vs
Gemini
```

without changing the orchestrator.

------------------------------------------------------------------------

## 21. Suggested Backend Components

Adapt to the existing project structure, but aim for responsibilities
similar to:

``` text
backend/src/services/
    reasoningAgent.js
    qwenProvider.js
    geminiProvider.js
    maiUiAdapter.js
    agentOrchestrator.js
    actionValidator.js
```

Possible TypeScript contracts:

``` typescript
type ReasoningDecisionType =
  | "SUBGOAL"
  | "EXTRACT"
  | "RESPOND"
  | "VERIFY"
  | "COMPLETE"
  | "FAIL"
  | "ASK_USER";

interface ReasoningDecision {
  type: ReasoningDecisionType;
  subgoal?: string;
  field?: string;
  value?: string;
  recipient?: string;
  message?: string;
  reason?: string;
  completion?: boolean;
}

interface AgentState {
  task: string;
  status: "running" | "waiting_user" | "completed" | "failed";
  currentApp?: string;
  currentSubgoal?: string;
  facts: Record<string, unknown>;
  plan: string[];
  completedSteps: string[];
  lastAction?: unknown;
  lastObservation?: unknown;
  stepCount: number;
  retryCount: number;
}
```

Use the repository's existing language/types if different.

------------------------------------------------------------------------

## 22. Configuration

Use environment variables rather than hard-coded local IPs:

``` env
REASONING_PROVIDER=qwen3
REASONING_BASE_URL=http://127.0.0.1:8090/v1
REASONING_MODEL=Qwen/Qwen3-8B-MLX-4bit

MAI_UI_BASE_URL=http://127.0.0.1:8080
MAI_UI_MODEL=MAI-UI-2B
```

For Android-to-Mac networking, use the existing project approach and
development configuration.

Never hard-code the developer's Mac IP into application source.

------------------------------------------------------------------------

## 23. Secrets

Never commit:

``` text
Gemini API keys
MongoDB credentials
Hugging Face tokens
personal credentials
```

The existing local secret file must remain outside Git tracking.

Do not print secrets into logs.

------------------------------------------------------------------------

## 24. Setup / Startup

The ideal developer workflow is eventually:

``` bash
./scripts/setup_reasoning_model.sh
```

then:

``` bash
./scripts/start_local_agents.sh
```

Expected output:

``` text
✓ MAI-UI running
✓ Qwen3 reasoning service running
```

The Node backend can remain separately started during development.

If combined startup is initially unreliable, provide:

``` bash
./scripts/start_mai_ui.sh
./scripts/start_reasoning.sh
npm run dev
```

Document all commands.

------------------------------------------------------------------------

## 25. Implementation Phases

### Phase A --- Model Infrastructure

1.  Inspect the current repository.
2.  Preserve working MAI-UI.
3.  Create reasoning service.
4.  Install MLX dependencies.
5.  Automatically download Qwen3-8B 4-bit if missing.
6.  Test a local generation.
7.  Expose HTTP API.
8.  Add `/health`.

### Phase B --- Providers

9.  Add `Qwen3LocalProvider`.
10. Preserve `GeminiProvider`.
11. Add provider selection.
12. Add `MAIUIProvider` / adapter.
13. Convert MAI-UI output into existing AgentAction.

### Phase C --- Orchestrator

14. Add AgentState.
15. Add ReasoningDecision schema.
16. Add subgoal loop.
17. Add action validation.
18. Add retry limits.
19. Add loop detection.
20. Add verification.

### Phase D --- Testing

21. Qwen3-only test.
22. MAI-UI-only test.
23. Two-model simple UI task.
24. Information extraction task.
25. Cross-app task.

### Phase E --- Real Workflow

26. Implement Flipkart → WhatsApp.
27. Add confirmation before sending.
28. Verify the sent message.
29. Log the complete trajectory.
30. Measure failures and latency.

------------------------------------------------------------------------

## 26. First Milestones

Do not begin by implementing the entire Flipkart → WhatsApp workflow.

### Milestone 1

Prove:

``` text
Node
 ↓
Qwen3
 ↓
structured subgoal
```

### Milestone 2

Prove:

``` text
Node
 ↓
MAI-UI
 ↓
AgentAction
 ↓
Android
```

### Milestone 3

Prove:

``` text
Qwen3
 ↓
subgoal
 ↓
MAI-UI
 ↓
Android
 ↓
observation
 ↓
Qwen3
```

### Milestone 4

Prove information extraction.

### Milestone 5

Implement the complete cross-app workflow.

------------------------------------------------------------------------

## 27. Testing Tasks

### Simple UI

``` text
Open Settings.
Open Wi-Fi.
Scroll down.
Press Back.
```

### Information extraction

``` text
Read a visible product name.
Read a displayed price.
Extract a value from an order screen.
```

### Multi-step

``` text
Find the last order.
Read the product name.
Open WhatsApp.
Find Prasanna.
Send the product name.
Verify.
```

Track:

``` text
success/failure
step count
Qwen3 calls
MAI-UI calls
latency
retries
failure point
```

------------------------------------------------------------------------

## 28. Do Not Do

The coding agent must not:

-   rewrite the entire backend;
-   rewrite the Android AccessibilityService unnecessarily;
-   remove Gemini immediately;
-   commit model weights;
-   commit secrets;
-   make Android directly load Qwen3;
-   make Android directly load MAI-UI;
-   make Qwen3 produce raw tap coordinates;
-   make MAI-UI responsible for the entire user task;
-   assume an action succeeded without observation/verification;
-   create an unlimited loop;
-   silently send external messages during early testing;
-   hard-code the Mac's IP address.

------------------------------------------------------------------------

## 29. Definition of Done --- Architecture

The two-model architecture is complete when:

-   [ ] Qwen3-8B 4-bit runs locally.
-   [ ] Model setup/download is automated or clearly scripted.
-   [ ] MAI-UI continues to run.
-   [ ] Node can call Qwen3.
-   [ ] Node can call MAI-UI.
-   [ ] Qwen3 returns structured reasoning decisions.
-   [ ] MAI-UI output is converted to AgentAction.
-   [ ] AgentState exists.
-   [ ] Subgoals exist.
-   [ ] Action validation exists.
-   [ ] Retry and loop limits exist.
-   [ ] Completion is verified.
-   [ ] Gemini remains available as fallback.
-   [ ] Android remains model-independent.
-   [ ] Secrets remain outside Git.
-   [ ] Model weights remain outside Git.

------------------------------------------------------------------------

## 30. Definition of Done --- Real Workflow

The first major end-to-end target is successful when the agent can:

-   [ ] Understand the request.
-   [ ] Navigate Flipkart.
-   [ ] Reach Orders.
-   [ ] Identify the latest order.
-   [ ] Extract the correct product name.
-   [ ] Store the fact in AgentState.
-   [ ] Open WhatsApp.
-   [ ] Find Prasanna.
-   [ ] Generate the correct message.
-   [ ] Ask for confirmation before sending during development.
-   [ ] Type the message.
-   [ ] Send it.
-   [ ] Verify it appeared in the correct chat.
-   [ ] Report completion.

------------------------------------------------------------------------

## 31. Final Mental Model

Think of the system as:

``` text
Qwen3:
"What does the user want?"
        |
        v
Qwen3:
"What information do we need?"
        |
        v
Qwen3:
"What should the UI agent do next?"
        |
        v
MAI-UI:
"Where is that thing on the screen?"
        |
        v
MAI-UI:
"Tap/type/swipe here."
        |
        v
Android:
"Done."
        |
        v
Observation:
"Here is the new screen."
        |
        v
Qwen3:
"What does this screen tell us?"
        |
        v
Qwen3:
"Great, I found the required information."
        |
        v
Qwen3:
"Now perform the next semantic step."
        |
        v
MAI-UI:
"Navigate and interact with the UI."
        |
        v
Verification
        |
        v
COMPLETE
```

The important architectural rule is:

> **Qwen3 decides WHAT should happen. MAI-UI decides HOW to interact
> with the UI. Android executes it. The orchestrator owns state and
> verification.**

Keep the models independently replaceable so that a future stronger
reasoning model or stronger UI model can be introduced without rewriting
the Android execution layer.

## 32. Official References

-   MAI-UI: https://github.com/Tongyi-MAI/MAI-UI
-   Qwen3-8B MLX 4-bit: https://huggingface.co/Qwen/Qwen3-8B-MLX-4bit
