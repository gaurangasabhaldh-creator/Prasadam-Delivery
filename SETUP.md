# SevaRoute — Setup

Getting from a fresh clone to a running rotation. Budget about 30 minutes for
the first run, most of it spent entering devotees.

There is **no build step and no npm**. Everything runs directly in the browser.

---

## 1. Create a Firebase project (10 min)

1. Go to [console.firebase.google.com](https://console.firebase.google.com) and
   **Add project**. Name it anything (e.g. `sevaroute`). Google Analytics is not needed.
2. In the left sidebar: **Build → Authentication → Get started → Email/Password → Enable → Save**.
3. **Build → Firestore Database → Create database**. Pick a region close to you
   (`asia-south1` for India) and start in **production mode** — the rules in
   `firestore.rules` replace the defaults in step 3.
4. **Project settings** (gear icon) **→ General → Your apps →** click the web icon `</>`.
   Register the app, then copy the `firebaseConfig` object it shows you.

Paste those values into `js/firebase-config.js`:

```js
const firebaseConfig = {
  apiKey:            "AIza...",
  authDomain:        "sevaroute.firebaseapp.com",
  projectId:         "sevaroute",
  storageBucket:     "sevaroute.firebasestorage.app",
  messagingSenderId: "123456789",
  appId:             "1:123456789:web:abc123"
};
```

> These values are not secrets — they identify your project, they don't grant
> access. Access is controlled by the security rules in the next step. Every
> Firebase web app ships them in client code.

## 2. Run it

Open `index.html` in a browser, or serve the folder:

```bash
python -m http.server 8000
```

Then visit `http://localhost:8000`.

Some browsers restrict `localStorage` and service workers on `file://` URLs, so
a local server is the smoother path.

**The first account you create becomes Super Admin.** Create yours before
sharing the link with anyone else.

## 3. Lock down the database (important)

Until you do this, your Firestore is wide open.

```bash
npm install -g firebase-tools    # one time
firebase login
firebase init firestore          # choose your project, keep firestore.rules
firebase deploy --only firestore:rules
```

Or paste the contents of `firestore.rules` into
**Firestore Database → Rules → Publish** in the console.

The rules enforce the role hierarchy `sevadar → admin → superAdmin`. A sevadar
can record coverage and advance the rotation, but cannot rename, reassign or
delete a devotee, and cannot edit the area sequence. The coverage log is
append-only — nothing can erase a delivery record.

## 4. Create your areas and put them in order (5 min)

Open the **Setup** tab.

1. **Add each area** — Samrala Chowk, Field Ganj, Dugri, and so on.
2. **Drag the rows** into the order you want the rotation to walk. This is the
   single most important setting in the app: it is the cycle.
3. **Batch two areas together** by giving them the same *batch name* — that is
   the "Area C and D on the same day" case. They then open and close as one.

There is a **Suggest order** button that proposes a sequence from where devotees
are pinned. It is only a guess from geography; your own knowledge of the city
almost always beats it.

No kitchen location, no meal times, no vehicles — none of that applies here.

## 5. Load your devotees

**Devotees tab → Import.** Point it at your existing spreadsheet; it guesses the
column mapping from your headings and shows a preview before writing anything.
Re-importing an updated sheet updates existing records rather than duplicating
them (matched on phone, falling back to a close name match).

**Every devotee needs an area** — that is what puts them in the rotation. Rows
imported without one are flagged in the preview, and the app will keep warning
you until they are assigned, because a devotee with no area is never covered.

**Set each devotee's bhoga** — Baal, Raj or Sandhya. The checklist is grouped by
this, so a sevadar sees the offerings separately. If your spreadsheet has a
column for it the import picks it up (it accepts "Raj", "raj bhoga", "RAJ
BHOGA"); otherwise use the **No bhoga set** filter on the Devotees tab to assign
them. Devotees without one still appear on the checklist, in their own group.

**Setting a location:** open a devotee and paste a **Google Maps link**
(in Maps: find the place → Share → Copy link). The sevadar's *Navigate* button
then takes them straight there.

If the link happens to contain coordinates the app also uses them to sort the
checklist by distance; the ordinary "share a place" link does not carry any, and
that is fine — navigation still works. A location of any kind is optional: a
devotee with none is still fully in the rotation.

## 6. Start the rotation

**Rotation tab → Start.** It opens the first area in your sequence and builds the
checklist. From then on the app runs itself:

- sevadars tick people off as prasadam is delivered
- when the last active devotee in the area is ticked, it **closes and opens the
  next one automatically**
- after the last area it wraps to the first and the round number goes up

Nothing is scheduled and nothing expires. An area stays open until it is done.

## 7. Add your sevadars

Have each sevadar create their own account (they will land on the sign-in screen
and choose "Create an account instead"). New accounts come in as **Sevadar**,
which sees only the open checklist — nothing else. Promote anyone who needs more
under **Setup → Accounts**.

---

## Optional: address lookup (geocoding)

Only needed if you want addresses converted to map pins automatically.

1. [Google Cloud Console](https://console.cloud.google.com) → same project →
   **APIs & Services → Enable APIs → Geocoding API**.
2. **Credentials → Create credentials → API key.**
3. **Restrict the key** to the Geocoding API and to your app's domain (HTTP
   referrer). Without this, anyone reading your page source can spend your quota.
4. Put it in `js/firebase-config.js` as `GEOCODING_API_KEY`.

Each address is geocoded **once** and cached permanently, so a database of a few
thousand devotees sits comfortably inside the free monthly tier. Google requires
a payment method on file before issuing any key, even for free-tier use.

## Optional: real road distances

By default the engine measures distance as straight-line × a road-winding factor
(1.35). That is free, instant, works offline, and is accurate enough to put stops
in the right order in a dense city. Absolute kilometre figures are approximate.

For real road distances, set `DISTANCE_PROVIDER` in `js/firebase-config.js`:

| Value | What it does | Cost |
|---|---|---|
| `'haversine'` | Straight line × winding factor. Default only because it needs no signup. | Free |
| `'ors'` | **OpenRouteService — recommended.** Real road network. | Free key, no billing account |
| `'osrm'` | Real road network via an OSRM server | Free if self-hosted |
| `'google'` | Routes API Compute Route Matrix, with live traffic | **Billed per element** |

### Optional: OpenRouteService (5 minutes, free, no credit card)

Only worth doing if you use the "Order by distance" button. One free key covers
both road distances and address lookup, with no billing account.

1. Sign up at [openrouteservice.org/dev/#/signup](https://openrouteservice.org/dev/#/signup).
2. Create a free token ("Standard" plan).
3. In `js/firebase-config.js` set `ORS_API_KEY = "your-key"` and
   `DISTANCE_PROVIDER = 'ors'`.
4. The "Order by distance" button on the checklist now follows real roads.

Free tier is roughly 500 matrix requests and 1,000 geocoding requests per day.
Ordering one checklist costs **one** matrix request, and each address is
geocoded once and cached forever, so a temple will not come close to the limit.

Setting `ORS_API_KEY` also enables the **Locate all** button on the Devotees tab
without needing a Google Geocoding key or a billing account. If both keys are
set, Google is used for geocoding (better Indian address coverage) and ORS for
distances.

One limit worth knowing: the free ORS matrix caps at 3,500 point-pairs, i.e.
about **59 devotees** in one area. Past that the app automatically falls back to
haversine for that run and tells you so. Splitting a very large area into two
keeps each checklist under the cap.

⚠️ **Read this before switching to `'google'`.** The matrix is billed per
origin–destination pair, so ordering an area of N devotees costs roughly N²
elements. Ordering several large areas in one day can consume most of a month's
free allowance. The PRD flags self-hosted OSRM as the cost-control path for
exactly this reason. The app prints the element count to the browser console
after every Google matrix build so you can watch it.

The public OSRM demo server (`router.project-osrm.org`) is rate-limited and
explicitly not for production. To self-host:

```bash
docker run -t -i -p 5000:5000 -v "${PWD}:/data" \
  osrm/osrm-backend osrm-routed --algorithm mld /data/punjab-latest.osrm
```

Then set `OSRM_BASE_URL` to `http://localhost:5000`.

---

## Deploying

Any static host works — Firebase Hosting, GitHub Pages, Netlify:

```bash
firebase init hosting     # public directory: .
firebase deploy --only hosting
```

**After every deploy that changes HTML/JS/CSS, bump the version string at the
top of `sw.js`** (`sevaroute-v1` → `sevaroute-v2`). Without that bump the
service worker keeps serving the old cached files and users won't see changes.

## Running the tests

Two suites, both plain HTML — open them in a browser, no tooling required:

- `tests/parse.html` — parses all 13 modules with the browser's own JS engine.
- `tests/rotation.html` — 52 assertions on the rotation engine: sequence
  building and batching, checklist composition, paused handling, auto-advance,
  wraparound and round increment, carried-forward priority, and a full
  two-round cycle simulation.
- `tests/edge.html` — 95 assertions on edge cases and past bugs: Google Maps
  link parsing across every common URL shape, malformed data,
  duplicate/missing sequence positions, batch groups split across the list,
  single-area wraparound, apostrophes in area names, and a guard that no
  Firestore query ever runs inside a transaction.
- `tests/smoke.html` — 107 assertions across the whole app with a mocked data
  layer: every tab renders, the rotation advances end to end, force-close
  carries people forward, role gating holds, exports build real workbooks.

Both print a PASS/FAIL summary at the bottom of the page.

## Troubleshooting

| Symptom | Cause |
|---|---|
| `auth/configuration-not-found` when creating an account | **Step 1.2 not done** — Email/Password sign-in is off. Firebase Console → Build → Authentication → Get started → Sign-in method → Email/Password → Enable → Save |
| `auth/unauthorized-domain` | Add the domain under Authentication → Settings → Authorized domains |
| Auth silently does nothing on `file://` | Firebase Auth needs an `http(s)` origin — serve the folder instead of opening the file directly |
| Setup screen won't go away | `js/firebase-config.js` still has `PASTE_…` placeholders |
| "Missing or insufficient permissions" | Rules not deployed, or your account's role is too low |
| A devotee never appears on any checklist | They have no area assigned — Devotees tab shows this |
| The rotation will not advance | Someone in the open area is still pending. Paused devotees do not block it; check the Rotation tab progress bar |
| An area is stuck open for weeks | Nothing forces it closed by design. Use "Close early & carry forward" |
| A sevadar sees only the Checklist tab | That is correct — promote them under Setup → Accounts if they need more |
| Changes don't appear after deploy | `sw.js` version string not bumped |
