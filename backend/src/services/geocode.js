// Reverse geocoding via Nominatim (OpenStreetMap) — free, no API key needed.
// Used to turn a location snapshot's raw lat/lng into a human-readable place
// name for the dashboard, since raw coordinates aren't meaningful at a glance.
const USER_AGENT = 'MobileUse-PersonalApp/0.1 (contact: ajaymadhavank@rortechnologies.com)';

async function reverseGeocode(lat, lng) {
  const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&zoom=14&addressdetails=1`;
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`reverse geocode failed: ${res.status}`);

  const data = await res.json();
  const addr = data.address || {};
  return (
    addr.suburb ||
    addr.neighbourhood ||
    addr.village ||
    addr.town ||
    addr.city ||
    addr.county ||
    data.display_name ||
    null
  );
}

module.exports = { reverseGeocode };
