/* ══ CONFIG.JS – Firebase init, AppState, constants, shared utilities ══
   Domain: a rotating, area-wise prasadam COVERAGE system (PRD v0.2).
   There are no meals and no deadlines here. One area-batch is open at a
   time; when every active devotee in it is served, the next opens by
   itself; after the last area the sequence wraps into a new round.
═══════════════════════════════════════════════════════════════════════ */

// ── SETUP GATE ────────────────────────────────────────
const IS_CONFIGURED = !String(firebaseConfig.apiKey || '').startsWith('PASTE_');

let fdb = null;
const TS = () => firebase.firestore.FieldValue.serverTimestamp();

if (IS_CONFIGURED) {
  firebase.initializeApp(firebaseConfig);
  fdb = firebase.firestore();

  // The sevadar's phone must keep working through dead zones (PRD §10).
  fdb.enablePersistence({ synchronizeTabs: true }).catch(err => {
    if (err.code === 'failed-precondition') {
      console.warn('[SevaRoute] Offline persistence disabled (multiple tabs open)');
    } else if (err.code === 'unimplemented') {
      console.warn('[SevaRoute] Offline persistence not supported in this browser');
    }
  });
}

// ── ROLES ─────────────────────────────────────────────
// PRD §3 has two working roles plus an owner. Legacy values from the
// earlier meal-based build are mapped so existing logins keep working
// rather than silently dropping to zero privileges.
const ROLES = ['sevadar', 'admin', 'superAdmin'];

const ROLE_RANK = {
  sevadar: 1, admin: 2, superAdmin: 3,
  driver: 1, dispatcher: 2   // legacy aliases
};

const ROLE_LABEL = {
  sevadar:    'Sevadar',
  admin:      'Admin / Coordinator',
  superAdmin: 'Super Admin',
  driver:     'Sevadar',
  dispatcher: 'Admin / Coordinator'
};

// ── ROTATION ──────────────────────────────────────────
const BATCH_STATUS = {
  upcoming: { label: 'Upcoming', pill: 'grey',  icon: 'fa-hourglass' },
  open:     { label: 'Open',     pill: 'green', icon: 'fa-lock-open' },
  closed:   { label: 'Closed',   pill: 'blue',  icon: 'fa-circle-check' }
};

const DEFAULT_SETTINGS = {
  // Where sevadars set out from. Optional — only used to order stops
  // sensibly (PRD §8). The rotation itself needs no location at all.
  startPoint: { name: 'Temple', lat: null, lng: null, address: '' },
  // Flag an open batch that has been sitting unusually long. Visibility
  // only — the PRD is explicit that nothing forces a batch closed (§11).
  staleBatchDays: 14,
  // How overdue a devotee must be before the directory flags them.
  overdueDays: 60,
  roadFactor: 1.35
};

// ── APP STATE ─────────────────────────────────────────
const AppState = {
  currentTab: 'rotation',
  user: null,
  userRole: null,
  userName: null,

  settings: { ...DEFAULT_SETTINGS },

  // The live rotation snapshot, refreshed on every load.
  rotation: null,     // { roundNumber, batchKey, areaIds, openedAt, ... }

  areas: [],
  currentDevoteeId: null
};

// Caches — the directory is read on nearly every screen and changes rarely.
const CACHE_TTL_MS = 90 * 1000;
const makeCache = () => ({ data: null, at: 0 });
const DevoteeCache = makeCache();
const AreaCache    = makeCache();

const cacheValid = (c) => c.data !== null && (Date.now() - c.at) < CACHE_TTL_MS;
const cacheSet = (c, data) => { c.data = data; c.at = Date.now(); return data; };
function cacheBust() { DevoteeCache.data = null; AreaCache.data = null; }

/* ══ DATE & TIME ═════════════════════════════════════════════════════
   IST-local throughout. A UTC slip would misdate a delivery record by a
   day, which matters when "last served" is the whole safety net.
═════════════════════════════════════════════════════════════════════ */

function toLocalDateStr(date = new Date()) {
  const d = (date instanceof Date) ? date : new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const todayStr = () => toLocalDateStr(new Date());

function fmtDateShort(value) {
  if (!value) return '—';
  const d = (value instanceof Date) ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

function fmtDateTime(value) {
  if (!value) return '—';
  const d = (value instanceof Date) ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
}

// Whole days between an ISO timestamp and now. Null when never served —
// the caller decides how to present "never", which is not the same as 0.
function daysSince(isoOrDate) {
  if (!isoOrDate) return null;
  const d = (isoOrDate instanceof Date) ? isoOrDate : new Date(isoOrDate);
  if (Number.isNaN(d.getTime())) return null;
  return Math.floor((Date.now() - d.getTime()) / 86400000);
}

function fmtAgo(isoOrDate) {
  const n = daysSince(isoOrDate);
  if (n === null) return 'never';
  if (n === 0) return 'today';
  if (n === 1) return 'yesterday';
  if (n < 30) return `${n} days ago`;
  const months = Math.floor(n / 30);
  return months === 1 ? 'a month ago' : `${months} months ago`;
}

const fmtKm = (km) => `${(km || 0).toFixed(1)} km`;

// ── GEO ───────────────────────────────────────────────
const EARTH_RADIUS_KM = 6371;
const toRad = (deg) => deg * Math.PI / 180;

function haversineKm(a, b) {
  if (!a || !b) return 0;
  const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 +
            Math.sin(dLng / 2) ** 2 * Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat));
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

function hasCoords(o) {
  return !!o && typeof o.lat === 'number' && typeof o.lng === 'number' &&
         !Number.isNaN(o.lat) && !Number.isNaN(o.lng);
}

function centroid(points) {
  const valid = (points || []).filter(hasCoords);
  if (!valid.length) return null;
  const s = valid.reduce((acc, p) => ({ lat: acc.lat + p.lat, lng: acc.lng + p.lng }), { lat: 0, lng: 0 });
  return { lat: s.lat / valid.length, lng: s.lng / valid.length };
}

// ── MISC ──────────────────────────────────────────────
function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function normalizePhone(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('91')) return digits.slice(2);
  if (digits.length === 11 && digits.startsWith('0'))  return digits.slice(1);
  return digits;
}

// Firestore's "Missing or insufficient permissions" tells the user nothing
// they can act on. By far the most common cause is security rules that are
// older than the code — a collection the app now writes to simply has no
// rules entry, so it falls through to the catch-all deny. Say that.
function describeWriteError(e, action = 'save that') {
  const code = e && e.code ? String(e.code) : '';
  if (code === 'permission-denied' || /insufficient permissions/i.test(e?.message || '')) {
    return `Could not ${action}: the database rejected the write. ` +
           'This usually means firestore.rules has not been re-published since the app was updated. ' +
           'Deploy the rules from firestore.rules, then try again.';
  }
  if (code === 'unavailable' || code === 'failed-precondition') {
    return `Could not ${action}: no connection to the database. It will sync when you are back online.`;
  }
  if (code === 'not-found') return `Could not ${action}: that record no longer exists.`;
  if (code === 'aborted') return `Could not ${action}: someone else changed it at the same moment. Try once more.`;
  return `Could not ${action}: ${e && e.message ? e.message : 'unknown error'}${code ? ` (${code})` : ''}`;
}

function hasRole(minRole) {
  return (ROLE_RANK[AppState.userRole] || 0) >= (ROLE_RANK[minRole] || 99);
}

function debounce(fn, ms = 300) {
  let t;
  return function (...args) { clearTimeout(t); t = setTimeout(() => fn.apply(this, args), ms); };
}

// ── GOOGLE MAPS HANDOFF (free — launches the installed app) ───────────
function navUrl(lat, lng) {
  if (/android/i.test(navigator.userAgent)) return `google.navigation:q=${lat},${lng}`;
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=driving&dir_action=navigate`;
}

function fullAddressOf(target, areaName, city) {
  const parts = [target.addressText, areaName, city]
    .map(p => String(p || '').trim()).filter(Boolean);
  // With nothing real to search for, "India" alone would resolve to the
  // centre of the country — a confidently wrong pin is worse than no link.
  if (!parts.length) return '';
  return [...parts, 'India'].join(', ');
}

function dirUrl(destination) {
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}` +
         `&travelmode=driving&dir_action=navigate`;
}

/* ── PASTED GOOGLE MAPS LINKS ────────────────────────────────────────
   People share locations as Maps links, not coordinates, so that is what
   the app accepts. The shapes that actually turn up:

     .../place/Some+Address/@30.88,75.83,17z/...   ← coords in the path
     .../maps?q=30.88,75.83                        ← coords in a param
     .../maps/place/Addr/data=!3d30.88!4d75.83     ← coords in the data blob
     .../maps/place/Full+Address/data=!4m2!3m1!1s0x..  ← NO coords at all
     https://maps.app.goo.gl/xxxx                  ← short link, opaque
     30.8843, 75.8302                              ← pasted coordinates

   Coordinates are extracted when they are there, because they unlock
   distance ordering. When they are not — as in the common "share place"
   link — the address sits in the /place/ path segment, and that is enough
   to hand Google a real turn-by-turn destination. A short link is opaque
   client-side (resolving it needs a redirect the browser will not allow
   cross-origin), so it is stored and opened as-is.                       */
function parseMapsLink(raw) {
  const input = String(raw || '').trim();
  if (!input) return null;

  // Someone pasting bare coordinates is really giving us the best case.
  const bare = input.match(/^(-?\d{1,3}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)$/);
  if (bare) {
    const lat = parseFloat(bare[1]), lng = parseFloat(bare[2]);
    if (Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
      return { url: '', lat, lng, placeText: '', kind: 'coords' };
    }
  }

  if (!/^https?:\/\//i.test(input)) return null;

  let lat = null, lng = null;
  const COORD = [
    /@(-?\d{1,3}\.\d+),(-?\d{1,3}\.\d+)/,                                  // /@lat,lng,17z
    /!3d(-?\d{1,3}\.\d+)!4d(-?\d{1,3}\.\d+)/,                              // inside data=
    /[?&](?:q|query|ll|sll|center|daddr)=(-?\d{1,3}\.\d+),\s*(-?\d{1,3}\.\d+)/,
    /[?&]destination=(-?\d{1,3}\.\d+),\s*(-?\d{1,3}\.\d+)/,
    /\/(-?\d{1,3}\.\d+),(-?\d{1,3}\.\d+)(?:[/?]|$)/                        // bare path pair
  ];
  for (const re of COORD) {
    const m = input.match(re);
    if (!m) continue;
    const a = parseFloat(m[1]), b = parseFloat(m[2]);
    // Reject nonsense rather than routing someone into the ocean.
    if (Math.abs(a) <= 90 && Math.abs(b) <= 180) { lat = a; lng = b; break; }
  }

  // The human-readable address Google puts in the /place/ segment.
  let placeText = '';
  const place = input.match(/\/place\/([^/@?]+)/);
  if (place) {
    try { placeText = decodeURIComponent(place[1]); }
    catch { placeText = place[1]; }
    placeText = placeText.replace(/\+/g, ' ').trim();
    // Google sometimes puts a plus-code or a bare coordinate pair here;
    // neither reads as an address to a human, so don't show it as one.
    if (/^-?\d+\.\d+,\s*-?\d+\.\d+$/.test(placeText)) placeText = '';
  }

  return {
    url: input, lat, lng, placeText,
    kind: lat !== null ? 'coords' : (placeText ? 'place' : 'link')
  };
}

// Is this link good enough to sort the checklist by distance?
function mapsLinkHasCoords(raw) {
  const p = parseMapsLink(raw);
  return !!(p && p.lat !== null && p.lat !== undefined);
}

/* Navigation target, best available first:
     1. real coordinates      — exact, and enables distance ordering
     2. address from the link — Google resolves it, true turn-by-turn
     3. the saved link itself — opens the place; driver taps Directions
     4. the typed address     — last resort
   A devotee with none of these simply has no link, and the button hides. */
function navUrlFor(target, areaName, city) {
  if (hasCoords(target)) return navUrl(target.lat, target.lng);

  if (target && target.mapsUrl) {
    const p = parseMapsLink(target.mapsUrl);
    if (p) {
      if (p.lat !== null && p.lat !== undefined) return navUrl(p.lat, p.lng);
      if (p.placeText) return dirUrl(p.placeText);
      return p.url;
    }
  }

  const addr = fullAddressOf(target, areaName, city);
  return addr ? dirUrl(addr) : null;
}

/* ── THE AREA SEQUENCE ───────────────────────────────────────────────
   Areas carry a sequencePosition, and optionally a batchGroup so that
   two areas open and close together (the PRD's "Area C and D" case).
   This collapses the area list into the ordered list of BATCHES that the
   rotation actually steps through.                                     */
function buildSequence(areas) {
  const active = (areas || []).filter(a => a.isActive !== false);
  const batches = new Map();

  active.forEach(a => {
    // Ungrouped areas get a batch of their own, keyed by area id.
    const key = a.batchGroup ? `g:${a.batchGroup}` : `a:${a.id}`;
    if (!batches.has(key)) {
      batches.set(key, { key, label: a.batchGroup || a.name, areas: [], position: a.sequencePosition ?? 9999 });
    }
    const b = batches.get(key);
    b.areas.push(a);
    // A grouped batch sits at its earliest member's position.
    b.position = Math.min(b.position, a.sequencePosition ?? 9999);
  });

  const list = [...batches.values()];
  list.forEach(b => {
    b.areaIds = b.areas.map(a => a.id);
    if (b.areas.length > 1) b.label = b.areas.map(a => a.name).join(' + ');
  });
  list.sort((a, b) => a.position - b.position || a.label.localeCompare(b.label));
  return list;
}

// A devotee is pending for the round currently open unless they were
// marked served IN that round. Storing the round number rather than a
// boolean means a new round needs no mass reset across 600 records.
function isServedInRound(devotee, roundNumber) {
  return !!devotee && devotee.servedInRound === roundNumber;
}

function isActiveDevotee(d) {
  return !!d && d.isActive !== false && d.status !== 'paused';
}
