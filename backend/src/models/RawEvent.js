const mongoose = require('mongoose');

const RawEventSchema = new mongoose.Schema(
  {
    source: {
      type: String,
      enum: ['sms', 'notification', 'location', 'activity', 'file', 'contact'],
      required: true,
    },
    // Raw payload as received from the device, shape varies by source.
    payload: { type: mongoose.Schema.Types.Mixed, required: true },
    deviceTimestamp: { type: Date, required: true },
    receivedAt: { type: Date, default: Date.now },

    // Filled in once Gemini categorization has run over this event.
    processed: { type: Boolean, default: false },
    category: { type: String, default: null },
    extracted: { type: mongoose.Schema.Types.Mixed, default: null },
    summaryText: { type: String, default: null },
  },
  { timestamps: true }
);

RawEventSchema.index({ source: 1, deviceTimestamp: -1 });
RawEventSchema.index({ processed: 1 });

module.exports = mongoose.model('RawEvent', RawEventSchema);
