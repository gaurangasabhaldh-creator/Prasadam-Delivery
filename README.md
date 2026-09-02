# SevaRoute — Devotee Prasadam Coverage & Rotation

Prasadam is not a meal — it is a token of Radha Gopinath's love. The purpose of
this app is one promise: **no active devotee is ever bereft of it.**

The temple sends prasadam to a growing list of devotees (~600 today) spread
across many areas. Tracked by hand, people get missed for long stretches and
nobody notices. This app replaces that with a **rotating, area-wise coverage
cycle** that advances itself and keeps a permanent record of who received what,
when, and from whom.

Built as a vanilla-JS PWA on Firebase, matching the rest of this repo — no npm,
no build step, no server to run. **See [SETUP.md](SETUP.md) to get it running.**

---

## The core model

The admin defines an ordered sequence of areas. Two areas can share a **batch
name** so they open and close together (the "Area C and D on the same day" case):

```
Area A → Area B → (Area C + Area D) → Area E → … → Area M ⟲ back to A
```

- **Exactly one batch is open at a time.** Every active devotee in it appears on
  a live checklist.
- **A sevadar ticks people off** as prasadam is delivered. There is **no deadline
  and no rush** — the batch stays open until it is done, at your own pace.
- **The instant the last active devotee is ticked, the batch closes and the next
  one opens by itself.** Nobody has to remember to move it forward.
- **After the last area it wraps** back to the first and the **round number**
  goes up. Everyone becomes pending again — while their full history is kept.

### Why this guarantees nobody is missed

Advancement is driven by **completion, not by a calendar**. An area cannot
silently be skipped, because the rotation will not move on until every active
devotee in it is accounted for. Combined with per-devotee *last received* and
*times served* tracking, it is structurally impossible for someone to fall
through the cracks the way a manual list allows.

### Growth mid-cycle

| Situation | What happens |
|---|---|
| New devotee added to an area that is **open now** | Appears on the live checklist immediately — covered this round |
| New devotee added to an area **already closed** this round | Waits automatically; their profile says *"will be included when Area X reopens"* |
| **New area** added | Joins at the end of the sequence; drag it anywhere you like |
| Devotee **paused** (travelling) | Excluded from the checklist *and* from the 100% count; resumes next round |
| Devotee **moved house** | Change their area — one canonical assignment, never duplicated |

### When an area cannot realistically hit 100%

The admin can **close early**. Whoever was missed is recorded, flagged
**carried forward**, and put at the **top of the list** the next time that area
opens — never silently dropped. The round history records that it was an early
close, who was missed, and why.

## The screens

| Tab | Who | What |
|---|---|---|
| **Rotation** | Admin | Which area is open, progress, round number, the whole cycle, close-early |
| **Checklist** | Everyone | The open area's devotees — tick, call, navigate. A sevadar's entire app. |
| **Devotees** | Admin | Directory with last received, times served, and where each sits in the cycle |
| **Setup** | Admin | The area sequence (drag to reorder), batch names, thresholds, accounts |
| **Reports** | Admin | Coverage %, who needs attention, area health, round history, seva log |

## Maps: optional, and free

The rotation engine **needs no external API at all** — checklist, completion
detection, auto-advance and wraparound all run on your own data. The "no one is
bereft" guarantee works from day one before you touch any API.

Maps appear in two places only, both optional:

- **Navigate** deep-links into the Google Maps app already on the phone.
  Free forever — no API key, no billing.

  A devotee's location is normally set by **pasting a Google Maps link**
  (Maps → Share → Copy link). The app reads whatever that link contains:

  | What the link carries | What you get |
  |---|---|
  | Coordinates (`/@30.88,75.83`, `?q=`, `!3d!4d`) | Exact navigation **and** distance ordering |
  | Only an address (the usual "share a place" link) | Real turn-by-turn to that address; skipped when ordering by distance |
  | A short `maps.app.goo.gl` link | Opens in Google Maps; the app cannot read inside it |

  Bare coordinates (`30.8843, 75.8302`) work too, and "Pick on map" is still
  there for anyone who has no Maps link at all.
- **Order by distance** (PRD §8) sorts the open checklist into the shortest
  driving order. With no deadline to race this is a plain travelling-salesman
  ordering, not a time-window problem. Distances default to free straight-line
  estimates; set an OpenRouteService key for real road distances at no cost.

**A devotee without a map pin is still fully in the rotation** and still on the
checklist. A pin only helps sort the stops.

## Roles

| Role | Can do |
|---|---|
| **Sevadar** | See the open checklist, tick devotees served, navigate, add a note |
| **Admin / Coordinator** | Everything above, plus the directory, the sequence, close-early, reports |
| **Super Admin** | Plus account roles |

The first account created becomes Super Admin. Enforced in `firestore.rules`,
not just the UI: a sevadar can record coverage but cannot rename, reassign or
delete a devotee.

## Data model

```
devotees/{id}      name, phone, address, mapsUrl, lat/lng, areaId, status,
                   servedInRound, lastServedAt, timesServed, carriedForwardFrom
areas/{id}         name, city, sequencePosition, batchGroup
settings/rotation  roundNumber, batchKey, areaIds, openedAt   ← the open batch
rounds/{r}_{b}     closed-batch history: when, how long, force-closed, who was missed
coverageLog/{id}   append-only seva record: devotee, area, round, when, by whom
```

**Progress is stored as `servedInRound` (a number), not a pending/served flag.**
"Pending" means `servedInRound !== the round currently open`. Starting a new
round is therefore a single write to one document rather than resetting 600
devotee records, and the full history stays reconstructible.

**Advancing is a compare-and-set on the state document.** The Firestore client
SDK cannot run a query inside a transaction, so "is this batch finished?" cannot
be answered atomically alongside the write. The two steps are separated instead:
recording one serve is its own transaction (atomic and idempotent), and
advancing re-reads the state inside a transaction, committing only if the batch
and round are still the ones that were measured. Two sevadars finishing the last
two devotees at once may both decide it is done, but only one CAS can win. It
also self-heals — if a client dies between the two steps, the next checklist load
completes the hand-off, so a finished batch can never sit open forever.

## File map

```
index.html              app shell, tab containers, modals
css/style.css           design tokens + all styling
js/firebase-config.js   ← YOU EDIT THIS: Firebase keys, optional map keys
js/config.js            AppState, constants, IST dates, the sequence builder
js/db.js                Firestore wrapper — CRUD, soft delete, audit trail
js/rotation.js          THE ENGINE — checklist, auto-advance, wraparound, force-close
js/geo.js               geocoding (cached) + pluggable travel-cost matrix
js/solver.js            optional within-area stop ordering (TSP)
js/excel.js             import/export via xlsx-js-style
js/ui-core.js           auth, roles, tabs, modals, toasts
js/ui-rotation.js       admin rotation dashboard
js/ui-checklist.js      the sevadar's checklist
js/ui-devotees.js       directory + per-devotee history
js/ui-config.js         area sequence editor, settings, accounts
js/ui-reports.js        coverage KPIs, area health, round history
firestore.rules         security rules — deploy these
sw.js                   service worker (bump CACHE on every deploy)
tests/parse.html        parses every module with the real JS engine
tests/rotation.html     52 assertions on the rotation engine
tests/edge.html         95 assertions on edge cases, link parsing, past bugs
tests/smoke.html        107 assertions across the whole app
```

## Conventions

- Dates are IST-local, never UTC — a slip would misdate a delivery record.
- Soft delete only (`isActive: false`); nothing is ever hard-deleted.
- The coverage log is **append-only** — an undo appends a reversal rather than
  erasing history.
- Batch writes capped at 400 docs.
- **Bump the `CACHE` string in `sw.js`** after any HTML/JS/CSS change.
- **Never interpolate user text into an inline `onclick`.** `escapeHtml` turns
  `'` into `&#39;`, which the browser decodes back to a bare apostrophe *before*
  the JS parser sees the attribute — so an area named "Devi's Colony" produces a
  SyntaxError and a dead button. Pass an id or an index and look the value up.

## Status

**Phase 1 (MVP) is complete** — devotee directory with bulk import, area
creation with sequence ordering and batching, the rotation engine
(open → checklist → auto-advance on 100% → wraparound), the sevadar checklist,
and the admin dashboard.

**Phase 2 is largely in** — within-area distance ordering, Google Maps
navigation handoff, carried-forward reporting, and overdue-devotee flagging.

**Not built (Phase 3):** push notifications when a new area opens, multi-team
parallel batches, devotee-facing notifications. Hindi/Punjabi UI strings are
also not done — the interface is English only.

### Open questions from PRD §14 — what was assumed

| Question | Assumed |
|---|---|
| One batch open at a time, or parallel teams? | **One at a time.** The state is a single document, so parallel batches would be an additive change. |
| What counts as "served" — a tap, or photo/note? | **A tap**, with an optional note. Photo capture is not built. |
| Who decides the area sequence? | **You do** — drag to reorder. A "Suggest order" button proposes one from geography, advisory only. |
| Devotees per area / number of areas? | Designed for ~600 across dozens of areas; nothing assumes a size. |
| Force-closed misses: auto-retry or manual review? | **Auto-carried forward** and shown at the top of the list next time, per §5.4. |

If any of those are wrong, say so — most are small changes.
