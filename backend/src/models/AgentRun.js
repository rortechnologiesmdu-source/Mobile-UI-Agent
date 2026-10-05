const mongoose = require('mongoose');

const AgentStepSchema = new mongoose.Schema(
  {
    stepNumber: Number,
    accessibilityTree: mongoose.Schema.Types.Mixed,
    currentApp: String,
    action: mongoose.Schema.Types.Mixed,
    // The model's own reasoning for this step (MAI-UI's <thinking>), fed back as history.
    reason: { type: String, default: '' },
    resolvedVia: { type: String, enum: ['a11y_node', 'vision_bbox', null], default: null },
  },
  { _id: false }
);

const AgentRunSchema = new mongoose.Schema(
  {
    goal: { type: String, required: true },
    status: {
      type: String,
      enum: ['running', 'done', 'failed', 'stopped'],
      default: 'running',
    },
    steps: { type: [AgentStepSchema], default: [] },
    // Launcher apps installed on the phone when the run started: [{ label, package }].
    apps: { type: mongoose.Schema.Types.Mixed, default: [] },
    resultText: { type: String, default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model('AgentRun', AgentRunSchema);
