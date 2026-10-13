// Capability registry for the Decision Layer — the source of truth for which data-collection
// methods actually exist in this project and their state. Qwen proposes methods for an app;
// the backend (services/decisionLayer.js) keeps only what this registry backs, with the
// status this registry gives. Nothing here is guessed: API and MCP list only what's really
// configured (nothing yet), Email reflects the real Gmail connection, Phone Data what the
// collectors have actually stored, MobileUse the app's access setting.

const RawEvent = require('../models/RawEvent');
const gmail = require('./gmail');

// Default priority: non-agent methods first, UI automation last.
const METHODS = ['api', 'mcp', 'email', 'phone_data', 'mobile_use', 'browser_use'];

// Data types each app category can have.
const DATA_TYPES = {
  Shopping: ['shopping.order_history', 'shopping.cart', 'shopping.order_confirmation', 'shopping.delivery_status'],
  'Food and Grocery': ['food.order_history', 'food.cart', 'food.order_confirmation'],
  Bank: ['bank.transactions', 'bank.balance', 'bank.statements', 'bank.alerts'],
  'Travel and Booking': ['travel.bookings', 'travel.tickets', 'travel.ride_history'],
  Health: ['health.records', 'health.appointments', 'health.activity'],
  'Chat and Communication': ['chat.messages', 'chat.contacts'],
  'Social Media': ['social.messages', 'social.activity'],
  Productivity: ['productivity.documents', 'productivity.events'],
  Entertainment: ['entertainment.history', 'entertainment.subscriptions'],
  'Maps and Navigation': ['maps.location_history', 'maps.saved_places'],
  'Security and Identity': ['identity.documents'],
  Other: [],
};
const NOTIFICATIONS = 'app.notifications'; // any app: what its notifications say

// The data types that typically arrive by email, per category.
const EMAIL_TYPES = {
  Shopping: ['shopping.order_confirmation', 'shopping.delivery_status'],
  'Food and Grocery': ['food.order_confirmation'],
  Bank: ['bank.statements', 'bank.alerts'],
  'Travel and Booking': ['travel.bookings', 'travel.tickets'],
  Health: ['health.appointments'],
  Entertainment: ['entertainment.subscriptions'],
};

// Email sender domains for known apps (maintained; extend as needed). Checked against the
// real mailbox before Email is ever shown as Available. Unknown apps: Qwen is asked.
const KNOWN_SENDERS = {
  'in.amazon.mShop.android.shopping': ['amazon.in'],
  'com.amazon.mShop.android.shopping': ['amazon.com'],
  'com.flipkart.android': ['flipkart.com'],
  'com.myntra.android': ['myntra.com'],
  'com.meesho.supply': ['meesho.com'],
  'in.swiggy.android': ['swiggy.in', 'swiggy.com'],
  'com.application.zomato': ['zomato.com'],
  'com.zeptoconsumerapp': ['zeptonow.com', 'zepto.co'],
  'com.grofers.customerapp': ['blinkit.com'],
  'com.bigbasket.mobileapp': ['bigbasket.com'],
  'in.redbus.android': ['redbus.in', 'redbus.com'],
  'com.whereismytrain.android': ['whereismytrain.in'],
  'cris.org.in.prs.ima': ['irctc.co.in'],
  'com.makemytrip': ['makemytrip.com'],
  'com.goibibo': ['goibibo.com'],
  'com.ubercab': ['uber.com'],
  'com.olacabs.customer': ['olacabs.com'],
  'com.xiaomi.hm.health': ['zepp.com', 'huami.com', 'amazfit.com'],
  'com.practo.fabric': ['practo.com'],
  'com.bt.bms': ['bookmyshow.com'],
};

// Service APIs / MCP servers configured in this project, by package. None yet — add entries
// here only when a real, authorised integration exists: { 'in.swiggy.android': ['food.order_history'] }.
const REGISTERED_APIS = {};
const REGISTERED_MCP = {};

function requestedDataTypes(category) {
  return [...(DATA_TYPES[category] || []), NOTIFICATIONS];
}

// The registry's view of every method for one app: [{ method, status, supported_data_types, note }].
async function capabilitiesFor(app) {
  const category = app.category;
  const types = DATA_TYPES[category] || [];
  const caps = [];

  const api = REGISTERED_APIS[app.package];
  caps.push(api
    ? { method: 'api', status: 'available', supported_data_types: api, note: 'A configured service API.' }
    : { method: 'api', status: 'unsupported', supported_data_types: [], note: 'No service API is configured for this app.' });

  const mcp = REGISTERED_MCP[app.package];
  caps.push(mcp
    ? { method: 'mcp', status: 'available', supported_data_types: mcp, note: 'A configured MCP server.' }
    : { method: 'mcp', status: 'unsupported', supported_data_types: [], note: 'No MCP server is configured for this app.' });

  const emailTypes = EMAIL_TYPES[category] || [];
  const g = gmail.status();
  if (!emailTypes.length) caps.push({ method: 'email', status: 'unsupported', supported_data_types: [], note: 'This kind of app doesn’t usually send its data by email.' });
  else if (!g.configured) caps.push({ method: 'email', status: 'unsupported', supported_data_types: [], note: 'No Google OAuth client is configured.' });
  else if (!g.connected) caps.push({ method: 'email', status: 'requires_connection', supported_data_types: emailTypes, note: 'Connect Gmail (read-only) to use emails from this app.' });
  else caps.push({ method: 'email', status: 'unverified', supported_data_types: emailTypes, note: 'Gmail is connected; checked against this app’s senders.' });

  // Phone Data: notifications the collector has actually stored for this package.
  let phone;
  try {
    const own = await RawEvent.countDocuments({ source: 'notification', 'payload.packageName': app.package });
    const any = own ? own : await RawEvent.countDocuments({ source: 'notification' });
    phone = own
      ? { method: 'phone_data', status: 'available', supported_data_types: [NOTIFICATIONS], note: `${own} notification${own === 1 ? '' : 's'} from this app already collected.` }
      : any
        ? { method: 'phone_data', status: 'unverified', supported_data_types: [NOTIFICATIONS], note: 'No notifications from this app collected yet.' }
        : { method: 'phone_data', status: 'requires_permission', supported_data_types: [NOTIFICATIONS], note: 'Notification access may be off for MobileUse.' };
  } catch (err) {
    phone = { method: 'phone_data', status: 'temporarily_unavailable', supported_data_types: [], note: `Couldn't check collected notifications: ${err.message}` };
  }
  caps.push(phone);

  caps.push(app.access
    ? { method: 'mobile_use', status: 'available', supported_data_types: types, note: 'The MobileUse agent can read what the app shows.' }
    : { method: 'mobile_use', status: 'requires_permission', supported_data_types: types, note: 'Mobile Agent Access is No for this app.' });

  caps.push({ method: 'browser_use', status: 'unverified', supported_data_types: types, note: 'The Browser Use project isn’t connected to this backend yet.' });
  return caps;
}

module.exports = { METHODS, DATA_TYPES, EMAIL_TYPES, NOTIFICATIONS, KNOWN_SENDERS, requestedDataTypes, capabilitiesFor };
