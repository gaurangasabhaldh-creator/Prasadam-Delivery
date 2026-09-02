/* ══ FIREBASE-CONFIG.JS ══════════════════════════════════════════════
   Fill these in from your Firebase console before first run.

   Firebase Console → Project Settings → General → "Your apps" → Web app
   → SDK setup and configuration → Config

   Unlike the sibling apps in this repo, this file is kept separate from
   config.js so you can swap Firebase projects (dev / production) without
   touching application code. See SETUP.md for the full walkthrough.
═══════════════════════════════════════════════════════════════════════ */

const firebaseConfig = {
  apiKey:            "AIzaSyBBTCwstXCXN3IPjRZ9RRi5_97hyoZWIEA",
  authDomain:        "prasadam-delivery.firebaseapp.com",
  projectId:         "prasadam-delivery",
  storageBucket:     "prasadam-delivery.firebasestorage.app",
  messagingSenderId: "819722817628",
  appId:             "1:819722817628:web:7dd4e3cd1ff28d7ba19699"
};

/* ── OPTIONAL: Google Maps Geocoding key ───────────────────────────────
   Only needed for automatic address → coordinates lookup. Leave empty and
   the app still works — you place each devotee's pin manually on the map
   instead, which costs nothing and needs no billing account.

   If you do set it, restrict the key in Google Cloud Console to the
   Geocoding API and to your app's domain (HTTP referrer), or anyone who
   views source can spend your quota.                                     */
const GEOCODING_API_KEY = "";

/* ── OPENROUTESERVICE KEY (recommended — free, no billing account) ─────
   One free key gives you BOTH real road-network distances for the routing
   engine AND address lookup — no credit card, no billing account, unlike
   Google. This is the single biggest accuracy upgrade available for free.

   Get one at: https://openrouteservice.org/dev/#/signup
   Free tier is generous for a trust's scale — roughly 500 matrix requests
   and 1,000 geocoding requests per day. One route generation = 1 matrix
   request, and each address is geocoded only once, ever.

   Paste the key below, then set DISTANCE_PROVIDER to 'ors'.               */
const ORS_API_KEY = "";

/* ── DISTANCE MATRIX PROVIDER ──────────────────────────────────────────
   How the solver measures travel between two points. See js/geo.js.

     'haversine' — straight-line distance × a road-winding factor.
                   Free, instant, offline, no key. Orders stops correctly
                   in a dense city, but the kilometre figures are estimates
                   and it cannot know about one-ways, rivers or flyovers.
                   The default only because it needs no signup.

     'ors'       — OpenRouteService: real road network. Free key, no
                   billing account. RECOMMENDED once you have a key —
                   set ORS_API_KEY above and switch this to 'ors'.

     'osrm'      — real road network via an OSRM server. Free and accurate
                   if you self-host (PRD §7.2). The public demo server is
                   rate-limited and explicitly not for production use.

     'google'    — Routes API Compute Route Matrix. Adds live traffic, but
                   billed per element (N² per run — read the PRD's §7.2
                   cost warning before switching this on).                 */
const DISTANCE_PROVIDER = 'haversine';
const OSRM_BASE_URL     = 'https://router.project-osrm.org';
const ROUTES_API_KEY    = "";
