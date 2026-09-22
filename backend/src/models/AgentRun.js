const mongoose = require('mongoose');

const AgentStepSchema = new mongoose.Schema(
  {
    stepNumber: Number,
    accessibilityTree: mongoose.Schema.Types.Mixed,
    currentApp: String,
    action: mongoose.Schema.Types.Mixed,
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
    resultText: { type: String, default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model('AgentRun', AgentRunSchema);
