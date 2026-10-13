const mongoose = require('mongoose');

const AgentStepSchema = new mongoose.Schema(
  {
    stepNumber: Number,
    accessibilityTree: mongoose.Schema.Types.Mixed,
    currentApp: String,
    action: mongoose.Schema.Types.Mixed,
    // The model's own reasoning for this step (MAI-UI's <thinking>), fed back as history.
    reason: { type: String, default: '' },
    // Two-agent runs: the simple instruction Qwen gave, how it became an action
    // ('direct' = open/type/scroll/back/home/wait, 'a11y_node' = tapped the element with
    // that label, 'mai_ui' = MAI-UI found it on the screenshot, 'mai_ui_snapped' = MAI-UI's
    // point moved onto the nearest element with that label), and whether it worked —
    // Qwen's check on the next screen (null until then).
    instruction: { type: String, default: '' },
    resolvedVia: {
      type: String,
      enum: ['a11y_node', 'vision_bbox', 'direct', 'mai_ui', 'mai_ui_snapped', null],
      default: null,
    },
    ok: { type: Boolean, default: null },
    check: { type: String, default: '' },
    // How many facts the run's memory held after this step (spots steps that collect nothing).
    memoryCount: { type: Number, default: 0 },
  },
  { _id: false }
);

const AgentRunSchema = new mongoose.Schema(
  {
    goal: { type: String, required: true },
    // Which device runs it. iOS runs started from the iOS app wait as 'queued' until
    // the iOS runner (ios-agent-runner, XCUITest on the Mac) claims them.
    platform: { type: String, enum: ['android', 'ios'], default: 'android' },
    status: {
      type: String,
      enum: ['queued', 'running', 'done', 'failed', 'stopped'],
      default: 'running',
    },
    steps: { type: [AgentStepSchema], default: [] },
    // Launcher apps installed on the phone when the run started: [{ label, package }].
    apps: { type: mongoose.Schema.Types.Mixed, default: [] },
    resultText: { type: String, default: null },
    // Two-agent runs' WORKING MEMORY — lives only while the run runs, wiped when it ends:
    //  plan:   Qwen's understanding of the task, made before the first step —
    //          { goals: [string], parts: [{ goal, app, done_when }], current: <index of the part in progress> }
    //  memory: facts Qwen copied off the screens because the task needs them later
    //          (e.g. full order names + dates to send on WhatsApp)
    plan: { type: mongoose.Schema.Types.Mixed, default: null },
    memory: { type: [String], default: [] },
    // At the end, Qwen turns the memory into structured JSON (e.g. a list of orders); kept.
    extracted: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model('AgentRun', AgentRunSchema);
