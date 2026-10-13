// App-access policy for the Mobile UI Agent: which apps the agent may open or act in. The
// controller (routes/agent2.js) checks it on every step — the planned apps, every launch_app,
// and whatever app is in front however the agent got there (a tap, a deep link, a link from
// another app) — so the models can't route around it. Read from MongoDB each time, so a
// change on the Installed Apps screen applies to the very next step.

const AppAccess = require('../models/AppAccess');

// Never need approval: the agent's own app, the system UI, permission dialogs and home screens.
const ALWAYS_ALLOWED = new Set([
  'com.mobileuse.app',
  'android',
  'com.android.systemui',
  'com.android.intentresolver',
  'com.android.permissioncontroller',
  'com.google.android.permissioncontroller',
  'com.android.launcher3',
  'com.bbk.launcher2',
  'com.google.android.apps.nexuslauncher',
  'com.sec.android.app.launcher',
  'com.miui.home',
  'com.oppo.launcher',
  'com.huawei.android.launcher',
]);

const PACKAGE_RE = /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)+$/;

// homePackage: the phone's home-screen app, reported by the phone when the run started.
function isExempt(pkg, homePackage) {
  return ALWAYS_ALLOWED.has(pkg) || (Boolean(homePackage) && pkg === homePackage);
}

// { allowed, label } for a package. Unknown packages (never seen on the Installed Apps screen)
// are not allowed — nothing gets access automatically.
async function accessFor(pkg) {
  const doc = await AppAccess.findOne({ package: pkg }).select('access label').lean();
  return { allowed: doc?.access === true, label: doc?.label || pkg, known: Boolean(doc) };
}

// The approval request for a disabled app, or null when the package may be used.
async function approvalNeeded(pkg, homePackage, reason) {
  if (!pkg || isExempt(pkg, homePackage)) return null;
  const { allowed, label } = await accessFor(pkg);
  if (allowed) return null;
  return {
    package: pkg,
    label,
    reason,
    message:
      `"${label}" is currently disabled in Installed Apps & Access Control. ` +
      'The Mobile UI Agent cannot access this app until you allow it.',
  };
}

module.exports = { ALWAYS_ALLOWED, PACKAGE_RE, isExempt, accessFor, approvalNeeded };
