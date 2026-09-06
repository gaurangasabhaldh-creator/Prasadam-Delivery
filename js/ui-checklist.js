/* ══ UI-CHECKLIST.JS – the open area's checklist (PRD §7.4) ══════════
   The sevadar's whole app. Big targets, one obvious action per devotee,
   and every write goes through Firestore's offline queue so ticking
   someone off never fails for lack of signal.

   When the last pending devotee is ticked, the rotation advances by
   itself and this screen announces the new area.
═══════════════════════════════════════════════════════════════════════ */

let _checklistSearch = '';
let _checklistOrder = null;   // set once "Order by distance" has been run

async function loadChecklist() {
  const panel = document.getElementById('tab-checklist');
  const [areas, devotees, state] = await Promise.all([
    DB.getAreas(true), DB.getDevotees(true), Rotation.getState()
  ]);
  AppState.areas = areas;
  AppState.rotation = state;

  if (!state) {
    panel.innerHTML = `<div class="empty">
      <i class="fa-solid fa-hourglass-start"></i>
      The rotation has not been started yet.<br>
      <span class="small">${hasRole('admin') ? 'Start it from the Rotation tab.' : 'An admin needs to start it.'}</span>
    </div>`;
    return;
  }

  let checklist = Rotation.buildChecklist(devotees, state);

  // Self-heal: if a client died between recording the last serve and
  // advancing, the batch is sitting finished-but-open. Finish the hand-off
  // now rather than leaving the rotation stuck.
  if (checklist.complete && Rotation.advanceIfComplete) {
    const healed = await Rotation.advanceIfComplete();
    if (healed) {
      _checklistOrder = null;
      AppState.rotation = state = await Rotation.getState();
      checklist = Rotation.buildChecklist(await DB.getDevotees(true), state);
    }
  }

  const areaById = new Map(areas.map(a => [a.id, a]));
  const pct = checklist.total ? Math.round(checklist.doneCount / checklist.total * 100) : 100;

  // Keep a distance ordering if one was computed for this same batch.
  const orderIndex = new Map();
  if (_checklistOrder && _checklistOrder.batchKey === state.batchKey) {
    _checklistOrder.ids.forEach((id, i) => orderIndex.set(id, i));
  }
  const sortPending = (list) => {
    if (!orderIndex.size) return list;
    return [...list].sort((a, b) => (orderIndex.has(a.id) ? orderIndex.get(a.id) : 1e9) -
                                    (orderIndex.has(b.id) ? orderIndex.get(b.id) : 1e9));
  };

  const match = (d) => {
    if (!_checklistSearch) return true;
    const area = areaById.get(d.areaId);
    return `${d.name} ${d.phone || ''} ${d.addressText || ''} ${area?.name || ''}`
      .toLowerCase().includes(_checklistSearch.toLowerCase());
  };

  const pending = sortPending(checklist.pending).filter(match);
  const served = checklist.served.filter(match);

  panel.innerHTML = `
    <div class="card open-batch">
      <div class="card-head">
        <div>
          <span class="pill green"><i class="fa-solid fa-lock-open"></i> Open</span>
          <h2 style="margin:.35rem 0 0">${escapeHtml(state.label || '')}</h2>
          <div class="route-meta"><span>Round <b>${state.roundNumber}</b></span>
            <span><b>${checklist.pending.length}</b> left of ${checklist.total}</span></div>
        </div>
        ${checklist.pending.length > 1 ? `
          <button class="btn sm" onclick="window.orderChecklistByDistance()">
            <i class="fa-solid fa-route"></i> Order by distance</button>` : ''}
      </div>
      <div class="progress big"><div style="width:${pct}%"></div></div>
      <div class="row" style="justify-content:space-between">
        <span><b>${checklist.doneCount}</b> of <b>${checklist.total}</b> served</span>
        <span class="muted small">${pct}%</span>
      </div>
      ${orderIndex.size ? `<p class="muted small" style="margin-top:.5rem">
        <i class="fa-solid fa-route"></i> Ordered by shortest driving route${
          _checklistOrder.totalKm ? ` — about ${fmtKm(_checklistOrder.totalKm)} in total` : ''}.
      </p>` : ''}
    </div>

    ${checklist.total > 6 ? `<input type="search" id="cl-search" class="cl-search"
       placeholder="Find a devotee…" value="${escapeHtml(_checklistSearch)}">` : ''}

    ${checklist.pending.length === 0 ? `
      <div class="card" style="border-left:4px solid var(--color-success)">
        <h3><i class="fa-solid fa-circle-check" style="color:var(--color-success)"></i>
            ${escapeHtml(state.label)} is fully covered</h3>
        <p class="muted small">The next area opens automatically. If you are still seeing this,
           reload — someone else may have just finished the last one.</p>
      </div>` : ''}

    ${pending.map(d => renderChecklistRow(d, areaById.get(d.areaId), false)).join('')}

    ${served.length ? `
      <div class="card-head" style="margin-top:1rem">
        <h3 class="muted"><i class="fa-solid fa-check"></i> Served (${served.length})</h3>
      </div>
      ${served.map(d => renderChecklistRow(d, areaById.get(d.areaId), true)).join('')}` : ''}

    ${checklist.paused.length ? `
      <div class="card" style="margin-top:1rem">
        <div class="card-head"><h3 class="muted"><i class="fa-solid fa-pause"></i>
          Paused — not counted (${checklist.paused.length})</h3></div>
        ${checklist.paused.map(d => `<div class="stop-sub">${escapeHtml(d.name)}</div>`).join('')}
      </div>` : ''}
  `;

  const search = document.getElementById('cl-search');
  if (search) search.oninput = debounce(() => { _checklistSearch = search.value; loadChecklist(); }, 250);
}

function renderChecklistRow(d, area, isServed) {
  const nav = navUrlFor(d, area?.name, area?.city);
  const carried = !!d.carriedForwardFrom;

  // "Mark served" is THE action on this screen, so it is a full-width button
  // in its own right — not something hidden behind a note dialog. Everything
  // else (call, navigate, note) is secondary and sits below it.
  return `
  <div class="check-card ${isServed ? 'done' : ''}">
    <div class="check-head">
      <div class="tick ${isServed ? 'on' : ''}" aria-hidden="true">
        <i class="fa-solid ${isServed ? 'fa-check' : 'fa-circle'}"></i>
      </div>
      <div class="stop-body">
        <div class="stop-name">${escapeHtml(d.name)}</div>
        <div class="chip-row">
          ${carried ? '<span class="pill amber" title="Missed last time — please prioritise">Carried forward</span>' : ''}
          ${(!hasCoords(d) && !d.mapsUrl) ? '<span class="pill red" title="No map link — use the written address">No location</span>' : ''}
        </div>
        <div class="stop-sub">${escapeHtml(area?.name || 'No area')}${d.addressText ? ' · ' + escapeHtml(d.addressText) : ''}</div>
        ${d.notes ? `<div class="stop-sub"><i class="fa-solid fa-note-sticky"></i> ${escapeHtml(d.notes)}</div>` : ''}
        <div class="stop-sub muted">Last received: ${fmtAgo(d.lastServedAt)}${d.timesServed ? ` · ${d.timesServed} time${d.timesServed === 1 ? '' : 's'}` : ''}</div>
      </div>
    </div>

    ${isServed ? `
      <div class="check-actions">
        <button class="btn undo-btn" onclick="window.undoServe('${d.id}')">
          <i class="fa-solid fa-rotate-left"></i> Undo
        </button>
        ${nav ? `<a class="btn" href="${nav}" target="_blank" rel="noopener">
          <i class="fa-solid fa-diamond-turn-right"></i> Navigate</a>` : ''}
      </div>`
    : `
      <button class="btn served-btn" onclick="window.markServed('${d.id}')">
        <i class="fa-solid fa-check"></i> Mark served
      </button>
      <div class="check-actions">
        ${d.phone ? `<a class="btn" href="tel:${escapeHtml(d.phone)}"><i class="fa-solid fa-phone"></i> Call</a>` : ''}
        ${nav ? `<a class="btn" href="${nav}" target="_blank" rel="noopener"><i class="fa-solid fa-diamond-turn-right"></i> Navigate</a>` : ''}
        <button class="btn" onclick="window.markServedWithNote('${d.id}')"><i class="fa-solid fa-pen"></i> Note</button>
      </div>`}
  </div>`;
}

/* ── MARKING ───────────────────────────────────────── */

// A GPS fix at the moment of handover is good evidence, but a refused or
// slow permission must never block the sevadar from moving on.
function currentPosition(timeoutMs = 4000) {
  return new Promise(resolve => {
    if (!navigator.geolocation) return resolve(null);
    let settled = false;
    const finish = (v) => { if (!settled) { settled = true; resolve(v); } };
    navigator.geolocation.getCurrentPosition(
      p => finish({ lat: p.coords.latitude, lng: p.coords.longitude }),
      () => finish(null),
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 30000 }
    );
    setTimeout(() => finish(null), timeoutMs + 200);
  });
}

window.markServed = async function (devoteeId, note = '') {
  setBusy(true, 'Saving…');
  try {
    const pos = await currentPosition();
    const advanced = await Rotation.markServed(devoteeId, { note, lat: pos?.lat ?? null, lng: pos?.lng ?? null });

    setBusy(false);
    if (advanced) {
      _checklistOrder = null;   // the new area needs its own ordering
      await loadBootstrap();
      announceAdvance(advanced);
    } else {
      showToast('Marked served', 'success', 1800);
    }
    await loadChecklist();
  } catch (e) {
    setBusy(false);
    showToast(describeWriteError(e, 'record that delivery'), 'error', 9000);
  }
};

// The moment the app earns its keep — say plainly what just happened.
function announceAdvance(advanced) {
  openModal('confirm-modal', `
    <div class="modal-head"><h2><i class="fa-solid fa-circle-check" style="color:var(--color-success)"></i>
      ${escapeHtml(advanced.from)} is complete</h2></div>
    <p>Every active devotee in that area has received prasadam.</p>
    ${advanced.wrapped
      ? `<div class="alert success"><b>Round ${advanced.state.roundNumber} begins.</b>
           The whole sequence has been covered — it now starts again from the top.</div>`
      : ''}
    <p><b>${escapeHtml(advanced.state.label)}</b> is now open.</p>
    <div class="modal-foot">
      <button class="btn primary" onclick="closeModal('confirm-modal')">Continue</button>
    </div>`);
}

window.markServedWithNote = function (devoteeId) {
  openModal('stop-modal', `
    <div class="modal-head">
      <h2>Serve with a note</h2>
      <button class="icon-btn" onclick="closeModal('stop-modal')"><i class="fa-solid fa-xmark"></i></button>
    </div>
    <div class="field"><label>Note (optional)</label>
      <textarea id="sv-note" placeholder="Handed to family member, left at gate…"></textarea></div>
    <div class="modal-foot">
      <button class="btn" onclick="closeModal('stop-modal')">Cancel</button>
      <button class="btn primary" id="sv-go"><i class="fa-solid fa-check"></i> Mark served</button>
    </div>`);
  document.getElementById('sv-go').onclick = async () => {
    const note = document.getElementById('sv-note').value.trim();
    closeModal('stop-modal');
    await window.markServed(devoteeId, note);
  };
};

window.undoServe = async function (devoteeId) {
  const ok = await confirmDialog({
    title: 'Undo this?',
    message: 'They go back to pending. The original entry stays in the seva record.',
    confirmLabel: 'Undo'
  });
  if (!ok) return;
  setBusy(true, 'Undoing…');
  try {
    await Rotation.undoServed(devoteeId);
    showToast('Moved back to pending', 'success');
    await loadChecklist();
  } catch (e) {
    showToast(describeWriteError(e, 'undo that'), 'error', 9000);
  } finally { setBusy(false); }
};

/* ── OPTIONAL ROUTE ORDERING (PRD §8) ──────────────── */
window.orderChecklistByDistance = async function () {
  setBusy(true, 'Working out the shortest order…');
  try {
    const [devotees, state] = await Promise.all([DB.getDevotees(true), Rotation.getState()]);
    const checklist = Rotation.buildChecklist(devotees, state);

    const result = await Solver.orderChecklist(checklist.pending, {
      startPoint: AppState.settings.startPoint, areas: AppState.areas
    });

    _checklistOrder = {
      batchKey: state.batchKey,
      ids: result.ordered.map(d => d.id),
      totalKm: result.totalKm
    };

    setBusy(false);
    if (result.unmappable.length) {
      showToast(`${result.unmappable.length} devotee${result.unmappable.length === 1 ? '' : 's'} without a map pin left at the end`, 'warning', 5000);
    } else {
      showToast(`Ordered — about ${fmtKm(result.totalKm)}`, 'success');
    }
    if (result.degraded) {
      showToast('Road-distance service unreachable — used straight-line estimates', 'warning', 6000);
    }
    await loadChecklist();
  } catch (e) {
    setBusy(false);
    showToast('Could not order the list: ' + e.message, 'error', 6000);
  }
};

window.loadChecklist = loadChecklist;
