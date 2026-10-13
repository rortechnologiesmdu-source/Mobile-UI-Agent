const mongoose = require('mongoose');

// One record per agent run in the `mobileagent` collection: the task the user gave and the
// final data the agent got for it (e.g. "Extract the last 3 orders from amazon" -> the 3
// orders). Written when the run ends — done, failed or stopped — after Qwen has turned the
// run's collected facts into structured data. Runs that collect nothing still get a record
// (data: null). The full step-by-step run stays in `agentruns` (runId links them).
const MobileAgentResultSchema = new mongoose.Schema(
  {
    runId: { type: mongoose.Schema.Types.ObjectId, ref: 'AgentRun', required: true, unique: true },
    task: { type: String, required: true },
    // The final data for the task: structured JSON from Qwen (e.g. { orders: [...] }); if that
    // fails or comes back empty, the collected items ({ items: [...] }) or the final answer
    // ({ answer: "..." }). null only when the run collected nothing at all.
    data: { type: mongoose.Schema.Types.Mixed, default: null },
    // Everything the agent collected, exactly as read off the screens (one line per item).
    items: { type: [String], default: [] },
    // Qwen's final answer, or why the run stopped.
    resultText: { type: String, default: null },
    status: { type: String, enum: ['done', 'failed', 'stopped'], required: true },
    platform: { type: String, enum: ['android', 'ios'], default: 'android' },
    steps: { type: Number, default: 0 },
    startedAt: Date,
    finishedAt: Date,
  },
  { timestamps: true }
);

module.exports = mongoose.model('MobileAgentResult', MobileAgentResultSchema, 'mobileagent');
