// Pulls a one-time code out of an SMS body so the browser-use agent can read it
// straight from Mongo (payload.otp) instead of re-parsing the text.
//
// Conservative on purpose — a wrong code wastes a login attempt:
//   - only messages that contain an OTP-ish keyword yield a code (so order
//     numbers, amounts, phone numbers in ordinary texts never come back as OTPs),
//   - currency amounts and years are ignored,
//   - among what's left, a 6-digit group and groups after the keyword are preferred.

const OTP_KEYWORDS =
  /\b(otp|one[\s-]?time|verification|verify|verified|code|passcode|pass\s?code|pin|2fa|two[\s-]?factor|security\s?code|login\s?code|log\s?in\s?code|auth(?:entication)?|access\s?code|confirmation\s?code)\b/i;

// Runs of digits possibly split by single spaces/hyphens: "492013", "123 456", "12 34 56".
const GROUP_RE = /\d[\d\s-]{2,12}\d|\d{4,8}/g;

// Currency / order markers just before a number -> it's an amount or id, not a code.
const AMOUNT_PREFIX = /(?:rs\.?|inr|₹|\$|usd|rupees?|amount|#|a\/c|acct|account|ref)\s*$/i;

const looksLikeYear = (digits) => digits.length === 4 && /^(19|20)\d{2}$/.test(digits);

function candidates(body) {
  const out = [];
  let m;
  GROUP_RE.lastIndex = 0;
  while ((m = GROUP_RE.exec(body)) !== null) {
    const digits = m[0].replace(/[\s-]/g, '');
    if (digits.length < 4 || digits.length > 8 || looksLikeYear(digits)) continue;
    const before = body.slice(Math.max(0, m.index - 8), m.index);
    if (AMOUNT_PREFIX.test(before)) continue;
    out.push({ digits, index: m.index });
  }
  return out;
}

// 6 digits is the most common OTP, then 4/8, then others.
const lengthScore = (digits) => ({ 6: 3, 4: 2, 8: 2 }[digits.length] ?? 1);

// Returns the extracted OTP string (leading zeros preserved) or null.
function extractOtp(body) {
  if (typeof body !== 'string' || !body) return null;
  const keyword = OTP_KEYWORDS.exec(body);
  if (!keyword) return null; // not a verification message — don't guess

  const found = candidates(body);
  if (found.length === 0) return null;
  const at = keyword.index;

  return found
    .slice()
    .sort((a, b) => {
      const sa = lengthScore(a.digits);
      const sb = lengthScore(b.digits);
      if (sa !== sb) return sb - sa; // prefer OTP-typical length
      const aAfter = a.index >= at;
      const bAfter = b.index >= at;
      if (aAfter !== bAfter) return aAfter ? -1 : 1; // prefer groups after the keyword
      return Math.abs(a.index - at) - Math.abs(b.index - at); // then nearest
    })[0].digits;
}

module.exports = { extractOtp };
