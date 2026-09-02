/* ══ UI-ROTATION.JS – the admin's rotation dashboard (PRD §7.5) ══════
   Answers, at a glance: which area is open, how far along it is, what
   round we're on, and what comes next.
═══════════════════════════════════════════════════════════════════════ */

async function loadRotation() {
  const panel = document.getElementById('tab-rotation');
  const [areas, devotees, state] = await Promise.all([
    DB.getAreas(true), DB.getDevotees(true), Rotation.getState()
  ]);
  AppState.areas = areas;
  AppState.rotation = state;

  if (!areas.length) {
    panel.innerHTML = `<div class="empty">
      <i class="fa-solid fa-map"></i>
      No areas yet. The rotation is a sequence of areas, so add those first.<br>
      <button class="btn primary" style="margin-top:1rem" onclick="switchTab('config')">
        <i class="fa-solid fa-plus"></i> Set up areas</button>
    </div>`;
    return;
  }

  if (!state) {
    const seq = buildSequence(areas);
    panel.innerHTML = `
      <div class="card">
        <div class="card-head"><h2><i class="fa-solid fa-play"></i> Start the rotation</h2></div>
        <p>The sequence is ready. Starting it opens the first area's checklist; from then on the
           app advances by itself each time an area is fully covered.</p>
        <div class="seq-preview">
          ${seq.map((b, i) => `<span class="seq-chip ${i === 0 ? 'first' : ''}">${escapeHtml(b.label)}</span>`)
              .join('<i class="fa-solid fa-arrow-right seq-arrow"></i>')}
          <i class="fa-solid fa-arrow-rotate-left seq-arrow" title="wraps back to the start"></i>
          <span class="seq-chip muted-chip">Round 2…</span>
        </div>
        <div class="modal-foot">
          <button class="btn primary" onclick="window.startRotation()">
            <i class="fa-solid fa-play"></i> Start with ${escapeHtml(seq[0].label)}</button>
        </div>
      </div>`;
    return;
  }

  const checklist = Rotation.buildChecklist(devotees, state);
  const sequence = Rotation.describeSequence(areas, devotees, state);
  const openIdx = sequence.findIndex(b => b.isOpen);
  const next = sequence[(openIdx + 1) % sequence.length];
  const pct = checklist.total ? Math.round(checklist.doneCount / checklist.total * 100) : 100;

  const openDays = daysSince(state.openedAtClient);
  const stale = openDays !== null && openDays >= (AppState.settings.staleBatchDays ?? 14);

  // "No one is bereft" is the whole promise, so the count of people who
  // have not been served within a full cycle belongs on the front page.
  const overdueDays = AppState.settings.overdueDays ?? 60;
  const active = devotees.filter(isActiveDevotee);
  const neverServed = active.filter(d => !d.lastServedAt).length;
  const overdue = active.filter(d => {
    const n = daysSince(d.lastServedAt);
    return n !== null && n > overdueDays;
  }).length;
  const carried = active.filter(d => d.carriedForwardFrom).length;

  panel.innerHTML = `
    <div class="card open-batch">
      <div class="card-head">
        <div>
          <span class="pill green"><i class="fa-solid fa-lock-open"></i> Open now</span>
          <h2 style="margin:.35rem 0 0">${escapeHtml(state.label || 'Current area')}</h2>
          <div class="route-meta">
            <span>Round <b>${state.roundNumber}</b></span>
            <span>Open <b>${fmtAgo(state.openedAtClient)}</b></span>
            <span><b>${checklist.total}</b> active devotees</span>
          </div>
        </div>
        <button class="btn primary" onclick="switchTab('checklist')">
          <i class="fa-solid fa-list-check"></i> Open checklist
        </button>
      </div>

      <div class="progress big"><div style="width:${pct}%"></div></div>
      <div class="row" style="justify-content:space-between">
        <span><b>${checklist.doneCount}</b> of <b>${checklist.total}</b> served — ${pct}%</span>
        <span class="muted small">${checklist.pending.length} remaining${checklist.paused.length ? ` · ${checklist.paused.length} paused (not counted)` : ''}</span>
      </div>

      ${stale ? `<div class="alert warning" style="margin-top:.75rem">
        This area has been open ${openDays} days. Nothing forces it closed — this is visibility only —
        but if some devotees can't be reached you can close it early and carry them forward.
      </div>` : ''}

      <div class="row" style="margin-top:.75rem">
        <span class="muted small">Next up: <b>${escapeHtml(next ? next.label : '—')}</b>${
          openIdx === sequence.length - 1 ? ' <span class="pill blue">starts round ' + (state.roundNumber + 1) + '</span>' : ''}</span>
        <div class="spacer"></div>
        ${hasRole('admin') ? `
          <button class="btn sm" onclick="window.forceCloseBatch()">
            <i class="fa-solid fa-forward"></i> Close early &amp; carry forward</button>` : ''}
      </div>
    </div>

    <div class="stats">
      <div class="stat"><div class="stat-value">${state.roundNumber}</div><div class="stat-label">Round</div></div>
      <div class="stat"><div class="stat-value">${active.length}</div><div class="stat-label">Active devotees</div></div>
      <div class="stat ${neverServed ? 'warn' : 'good'}"><div class="stat-value">${neverServed}</div><div class="stat-label">Never served</div></div>
      <div class="stat ${overdue ? 'bad' : 'good'}"><div class="stat-value">${overdue}</div><div class="stat-label">Over ${overdueDays} days</div></div>
      <div class="stat ${carried ? 'warn' : ''}"><div class="stat-value">${carried}</div><div class="stat-label">Carried forward</div></div>
    </div>

    <div class="card">
      <div class="card-head">
        <h3><i class="fa-solid fa-arrows-spin"></i> The cycle</h3>
        <span class="muted small">Round ${state.roundNumber}</span>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>#</th><th>Area / batch</th><th>Devotees</th><th>This round</th><th></th></tr></thead>
          <tbody>
            ${sequence.map((b, i) => `
              <tr class="${b.isOpen ? 'row-open' : ''}">
                <td class="muted">${i + 1}</td>
                <td>
                  <b>${escapeHtml(b.label)}</b>
                  ${b.areas.length > 1 ? '<span class="pill blue">batched</span>' : ''}
                </td>
                <td>${b.devoteeCount}</td>
                <td>
                  ${b.status === 'open'
                    ? `<b>${b.servedThisRound}/${b.devoteeCount}</b> served`
                    : b.status === 'closed'
                      ? '<span class="pill green">Covered</span>'
                      : '<span class="muted small">Waiting</span>'}
                </td>
                <td class="actions">
                  <span class="pill ${BATCH_STATUS[b.status].pill}">
                    <i class="fa-solid ${BATCH_STATUS[b.status].icon}"></i> ${BATCH_STATUS[b.status].label}
                  </span>
                  ${hasRole('admin') && !b.isOpen
                    ? `<button class="icon-btn" title="Open this batch now"
                         onclick="window.jumpToBatch(${i})">
                         <i class="fa-solid fa-arrow-right-to-bracket"></i></button>` : ''}
                </td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
      <p class="muted small" style="margin-top:.6rem">
        The rotation advances on its own the moment an area is fully covered — nobody has to
        remember to move it forward. After the last area it wraps to the first and the round number
        goes up.
      </p>
    </div>`;
}

/* ── ACTIONS ───────────────────────────────────────── */
window.startRotation = async function () {
  setBusy(true, 'Starting the rotation…');
  try {
    const areas = await DB.getAreas(true);
    const state = await Rotation.start(areas);
    showToast(`Rotation started — ${state.label} is open`, 'success', 5000);
    await loadBootstrap();
    await loadRotation();
  } catch (e) {
    showToast(describeWriteError(e, 'start the rotation'), 'error', 9000);
  } finally { setBusy(false); }
};

window.forceCloseBatch = async function () {
  const [devotees, state] = await Promise.all([DB.getDevotees(true), Rotation.getState()]);
  const checklist = Rotation.buildChecklist(devotees, state);

  if (!checklist.pending.length) {
    return showToast('Everyone in this area is already served — it will advance by itself', 'info', 5000);
  }

  openModal('confirm-modal', `
    <div class="modal-head"><h2>Close ${escapeHtml(state.label)} early?</h2></div>
    <p><b>${checklist.pending.length}</b> ${checklist.pending.length === 1 ? 'devotee has' : 'devotees have'}
       not been served yet. They will be <b>carried forward</b> and put at the top of the list the next
       time this area opens — they are not dropped.</p>
    <div class="carry-list">
      ${checklist.pending.slice(0, 12).map(d => `<div>${escapeHtml(d.name)}</div>`).join('')}
      ${checklist.pending.length > 12 ? `<div class="muted">+${checklist.pending.length - 12} more</div>` : ''}
    </div>
    <div class="field"><label>Reason (optional)</label>
      <input id="fc-reason" placeholder="e.g. travelling, unreachable this round"></div>
    <div class="modal-foot">
      <button class="btn" onclick="closeModal('confirm-modal')">Cancel</button>
      <button class="btn danger" id="fc-go"><i class="fa-solid fa-forward"></i> Close &amp; carry forward</button>
    </div>`);

  document.getElementById('fc-go').onclick = async () => {
    const reason = document.getElementById('fc-reason').value.trim();
    closeModal('confirm-modal');
    setBusy(true, 'Closing…');
    try {
      const { advanced, missed } = await Rotation.forceClose(reason);
      showToast(`Closed. ${missed.length} carried forward. ${advanced.state.label} is now open.`, 'warning', 6000);
      await loadBootstrap();
      fireRotationChanged();
    } catch (e) {
      showToast(describeWriteError(e, 'close that area'), 'error', 9000);
    } finally { setBusy(false); }
  };
};

// Takes the batch's INDEX in the sequence, never its name. An area called
// "Devi's Colony" interpolated into an inline handler decodes back to a bare
// apostrophe and breaks the JavaScript before it can run.
window.jumpToBatch = async function (index) {
  const areas = await DB.getAreas(true);
  const batch = buildSequence(areas)[index];
  if (!batch) return showToast('That batch is no longer in the sequence', 'error');
  const batchKey = batch.key, label = batch.label;

  const ok = await confirmDialog({
    title: `Open ${label} now?`,
    message: 'This jumps the rotation straight to that area without closing the current one. Use it to correct a mistake, not as the normal way to move forward.',
    confirmLabel: 'Open it', danger: true
  });
  if (!ok) return;

  setBusy(true, 'Switching…');
  try {
    await Rotation.openBatch(batchKey);
    showToast(`${label} is now open`, 'success');
    await loadBootstrap();
    fireRotationChanged();
  } catch (e) {
    showToast(describeWriteError(e, 'switch batch'), 'error', 9000);
  } finally { setBusy(false); }
};

window.loadRotation = loadRotation;
