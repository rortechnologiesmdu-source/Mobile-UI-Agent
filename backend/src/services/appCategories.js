// App categories for Installed Apps & Access Control. A category only organises apps — it
// never grants access. Decided in this order: the user's own correction, a maintained map of
// known packages, keyword rules on the package/name, Android's own category hint, else Other.

const CATEGORIES = [
  'Bank',
  'Shopping',
  'Travel and Booking',
  'Health',
  'Chat and Communication',
  'Social Media',
  'Productivity',
  'Entertainment',
  'Food and Grocery',
  'Maps and Navigation',
  'Security and Identity',
  'Other',
];

// Known packages (maintained; extend as needed).
const KNOWN = {
  Bank: [
    'com.sbi.lotusintouch', 'com.sbi.SBIFreedomPlus', 'com.csam.icici.bank.imobile', 'com.snapwork.hdfc',
    'com.msf.kbank.mobile', 'com.axis.mobile', 'com.infrasofttech.indianbank', 'com.google.android.apps.nbu.paisa.user',
    'net.one97.paytm', 'com.phonepe.app', 'in.org.npci.upiapp', 'com.dreamplug.androidapp', 'com.bankofbaroda.mconnect',
    'com.canarabank.mobility', 'com.unionbank.ecommerce.mobile.android', 'com.pnb.mbanking',
  ],
  Shopping: [
    'in.amazon.mShop.android.shopping', 'com.amazon.mShop.android.shopping', 'com.flipkart.android', 'com.myntra.android',
    'com.meesho.supply', 'com.ril.ajio', 'com.fsn.nykaa', 'com.snapdeal.main', 'com.tul.tatacliq', 'com.jio.jiomart',
  ],
  'Food and Grocery': [
    'com.application.zomato', 'in.swiggy.android', 'com.grofers.customerapp', 'com.bigbasket.mobileapp',
    'com.zeptoconsumerapp', 'com.dunzo.user', 'com.Dominos', 'com.done.faasos',
  ],
  'Travel and Booking': [
    'com.makemytrip', 'com.goibibo', 'com.ixigo.train.ixitrain', 'com.ixigo', 'in.redbus.android', 'cris.org.in.prs.ima',
    'com.olacabs.customer', 'com.ubercab', 'com.rapido.passenger', 'com.airbnb.android', 'com.booking', 'com.cleartrip.android',
  ],
  'Maps and Navigation': ['com.google.android.apps.maps', 'com.waze', 'com.mapmyindia.app.mappls'],
  'Chat and Communication': [
    'com.whatsapp', 'com.whatsapp.w4b', 'org.telegram.messenger', 'com.google.android.apps.messaging', 'com.android.mms',
    'com.facebook.orca', 'com.discord', 'com.google.android.gm', 'com.google.android.dialer', 'com.android.dialer',
    'com.google.android.contacts', 'com.truecaller', 'com.skype.raider', 'com.Slack', 'us.zoom.videomeetings',
    'com.microsoft.teams', 'com.google.android.apps.tachyon',
  ],
  'Social Media': [
    'com.instagram.android', 'com.facebook.katana', 'com.snapchat.android', 'com.twitter.android', 'com.linkedin.android',
    'com.pinterest', 'com.reddit.frontpage', 'in.mohalla.sharechat', 'com.threads.android', 'com.instagram.barcelona',
  ],
  Entertainment: [
    'com.spotify.music', 'com.google.android.youtube', 'com.netflix.mediaclient', 'in.startv.hotstar', 'com.jio.media.jiobeats',
    'com.amazon.avod.thirdpartyclient', 'com.gaana', 'com.bt.bms', 'com.jio.media.ondemand', 'com.google.android.apps.youtube.music',
  ],
  Health: [
    'com.google.android.apps.fitness', 'com.practo.fabric', 'com.healthifyme.basic', 'com.sec.android.app.shealth',
    'com.curefit.android', 'com.phonegap.rxpal', 'com.netmedsmarketplace.netmeds', 'com.aranoah.healthkart.plus',
  ],
  Productivity: [
    'com.google.android.apps.docs', 'com.google.android.calendar', 'com.google.android.keep', 'notion.id',
    'com.google.android.apps.tasks', 'com.dropbox.android', 'com.microsoft.office.outlook', 'com.microsoft.office.word',
    'com.android.chrome', 'com.google.android.apps.photos', 'com.google.android.calculator', 'com.google.android.deskclock',
  ],
  'Security and Identity': [
    'com.google.android.apps.authenticator2', 'com.azure.authenticator', 'com.digilocker.android',
    'in.gov.uidai.mAadhaarPlus', 'com.lastpass.lpandroid', 'com.x8bit.bitwarden', 'com.google.android.apps.walletnfcrel',
  ],
};
const BY_PACKAGE = Object.fromEntries(Object.entries(KNOWN).flatMap(([cat, pkgs]) => pkgs.map((p) => [p, cat])));

// Keyword rules on "package label" — only for packages not in the map above.
const RULES = [
  ['Bank', /\bbank|banking|\bsbi\b|yono|hdfc|icici|kotak|\bupi\b|phonepe|paytm|google pay|\bbhim\b|\bcred\b/i],
  ['Food and Grocery', /zomato|swiggy|grocery|blinkit|zepto|bigbasket|\bfood\b|restaurant|pizza/i],
  ['Shopping', /shopping|\bshop\b|\bstore\b|mart\b|amazon|flipkart|myntra|meesho/i],
  ['Travel and Booking', /travel|booking|flight|\btrain|\bbus\b|\bcab\b|hotel|irctc|redbus|\bola\b|uber|rapido/i],
  ['Maps and Navigation', /\bmaps?\b|navigation|\bgps\b/i],
  ['Health', /health|fitness|\bfit\b|medic|pharma|doctor|hospital|clinic/i],
  ['Security and Identity', /authenticator|password|vault|aadhaar|digilocker|\bwallet\b/i],
  ['Chat and Communication', /messag|\bchat\b|\bmail\b|dialer|\bphone\b|contacts|\bsms\b/i],
  ['Social Media', /social|instagram|facebook|twitter|snapchat|linkedin/i],
  ['Entertainment', /music|video|movie|\bgame|player|\bradio\b|podcast|\btv\b/i],
  ['Productivity', /docs|calendar|notes|office|drive|calculator|clock|files|scanner/i],
];

// Android's ApplicationInfo.category hint (API 26+): GAME 0, AUDIO 1, VIDEO 2, IMAGE 3,
// SOCIAL 4, NEWS 5, MAPS 6, PRODUCTIVITY 7, ACCESSIBILITY 8; -1 = undefined.
const ANDROID_HINT = { 0: 'Entertainment', 1: 'Entertainment', 2: 'Entertainment', 4: 'Social Media', 6: 'Maps and Navigation', 7: 'Productivity' };

function classify({ package: pkg, label, androidCategory }) {
  if (BY_PACKAGE[pkg]) return BY_PACKAGE[pkg];
  const text = `${pkg || ''} ${label || ''}`;
  const rule = RULES.find(([, re]) => re.test(text));
  if (rule) return rule[0];
  return ANDROID_HINT[androidCategory] || 'Other';
}

module.exports = { CATEGORIES, classify };
