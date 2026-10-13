const mongoose = require('mongoose');

// Installed Apps & Access Control: one record per Android app (by package identifier). The
// `access` flag is the Mobile UI Agent's allowlist — enforced by the backend controller on
// every step (services/appAccess.js), not just shown in the app. Apps start NOT allowed;
// nothing gets access automatically. Icons stay on the phone (not stored here).
const AppAccessSchema = new mongoose.Schema(
  {
    package: { type: String, required: true, unique: true },
    label: { type: String, default: '' },
    androidCategory: { type: Number, default: -1 },
    // Category from the maintained mapping, and the user's own correction (wins when set).
    category: { type: String, default: 'Other' },
    userCategory: { type: String, default: null },
    access: { type: Boolean, default: false },
    accessUpdatedAt: { type: Date, default: null },
    lastSeenAt: { type: Date, default: null },
    // Decision Layer result for this app: candidate data-collection methods, validated
    // against the capability registry. Kept separate from access: a failed analysis never
    // changes access, and a listed method never grants it.
    analysis: {
      type: mongoose.Schema.Types.Mixed,
      default: () => ({ status: 'none', methods: [], error: null, analyzedAt: null }),
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('AppAccess', AppAccessSchema, 'appaccess');
