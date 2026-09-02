/* ══ UI-CONFIG.JS – areas, the sequence, settings, accounts (PRD §7.2) ══
   The area SEQUENCE is the app's most important setting: it is the order
   the rotation walks, and the order the whole guarantee rests on.
═══════════════════════════════════════════════════════════════════════ */

let _seqDrag = null;

async function loadConfig() {
  const panel = document.getElementById('tab-config');
  const [areas, devotees, users, state] = await Promise.all([
    DB.getAreas(true), DB.getDevotees(true), DB.getUsers(), Rotation.getState()
  ]);
  AppState.areas = areas;
  AppState.rotation = state;

  const countIn = (id) => devotees.filter(d => d.areaId === id && isActiveDevotee(d)).length;
  const sequence = buildSequence(areas);
  const s = AppState.settings;

  panel.innerHTML = `
    <!-- ── THE SEQUENCE ── -->
    <div class="card">
      <div class="card-head">
        <h2><i class="fa-solid fa-list-ol"></i> Area Sequence</h2>
        <div class="row">
          <button class="btn sm" onclick="window.suggestSequence()"><i class="fa-solid fa-wand-magic-sparkles"></i> Suggest order</button>
          <button class="btn primary sm" onclick="window.editArea()"><i class="fa-solid fa-plus"></i> Add area</button>
        </div>
      </div>
      <p class="muted small">
        The rotation walks this list top to bottom, then wraps back to the first and starts a new
        round. Drag to reorder. Give two areas the same <b>batch name</b> to have them open and
        close together.
      </p>

      ${areas.length ? `
        <div id="seq-list" class="seq-list">
          ${areas.map((a, i) => `
            <div class="seq-row" draggable="true" data-id="${a.id}" data-index="${i}">
              <i class="fa-solid fa-grip-vertical seq-grip"></i>
              <span class="seq-pos">${i + 1}</span>
              <div style="flex:1; min-width:0">
                <b>${escapeHtml(a.name)}</b>
                ${a.batchGroup ? `<span class="pill blue">batch: ${escapeHtml(a.batchGroup)}</span>` : ''}
                ${state && state.areaIds.includes(a.id) ? '<span class="pill green">open now</span>' : ''}
                <div class="stop-sub">${countIn(a.id)} active devotees${a.city ? ' · ' + escapeHtml(a.city) : ''}</div>
              </div>
              <button class="icon-btn" onclick="window.editArea('${a.id}')"><i class="fa-solid fa-pen"></i></button>
              <button class="icon-btn" onclick="window.removeArea('${a.id}')"><i class="fa-solid fa-trash"></i></button>
            </div>`).join('')}
        </div>
        <div class="row end" style="margin-top:.6rem">
          <span class="muted small" id="seq-hint">Drag a row to change the order</span>
          <div class="spacer"></div>
          ${areas.length > 1 ? `<button class="btn sm" onclick="window.openMergeAreas()"><i class="fa-solid fa-code-merge"></i> Merge areas</button>` : ''}
        </div>

        <div class="seq-preview" style="margin-top:.8rem">
          ${sequence.map(b => `<span class="seq-chip ${state && b.key === state.batchKey ? 'first' : ''}">${escapeHtml(b.label)}</span>`)
            .join('<i class="fa-solid fa-arrow-right seq-arrow"></i>')}
          <i class="fa-solid fa-arrow-rotate-left seq-arrow"></i>
        </div>
      ` : `<div class="empty"><i class="fa-solid fa-map"></i>No areas yet — add the first one.</div>`}
    </div>

    <!-- ── SETTINGS ── -->
    <div class="card">
      <div class="card-head"><h2><i class="fa-solid fa-sliders"></i> Settings</h2></div>
      <div class="grid-2">
        <div class="field">
          <label>Flag a devotee overdue after (days)</label>
          <input type="number" min="1" id="cf-overdue" value="${s.overdueDays ?? 60}">
          <p class="muted small">Roughly how long one full cycle takes. Drives the "never / overdue" warnings.</p>
        </div>
        <div class="field">
          <label>Flag an area open too long after (days)</label>
          <input type="number" min="1" id="cf-stale" value="${s.staleBatchDays ?? 14}">
          <p class="muted small">Visibility only — nothing is ever force-closed automatically.</p>
        </div>
      </div>

      <div class="field">
        <label>Starting point (optional)</label>
        <div class="row">
          <input id="cf-start-name" value="${escapeHtml(s.startPoint?.name || 'Temple')}" style="flex:1 1 140px">
          <span id="cf-start-coords" class="pill ${hasCoords(s.startPoint) ? 'green' : 'grey'}" style="flex:1">
            ${hasCoords(s.startPoint) ? `${s.startPoint.lat.toFixed(5)}, ${s.startPoint.lng.toFixed(5)}` : 'Not set'}
          </span>
          <button class="btn sm" id="cf-start-pin"><i class="fa-solid fa-map-pin"></i> Place</button>
        </div>
        <p class="muted small">Only used by the optional "order by distance" button on the checklist.
           The rotation itself needs no location at all.</p>
      </div>

      <div class="modal-foot"><button class="btn primary" id="cf-save"><i class="fa-solid fa-check"></i> Save settings</button></div>
    </div>

    <!-- ── ACCOUNTS ── -->
    ${hasRole('superAdmin') ? `
    <div class="card">
      <div class="card-head"><h2><i class="fa-solid fa-user-shield"></i> Accounts</h2></div>
      <p class="muted small">Sevadars see only the open checklist. Admins can manage the directory and the sequence.</p>
      <div class="table-wrap"><table>
        <thead><tr><th>Email</th><th>Role</th></tr></thead>
        <tbody>${users.map(u => `
          <tr>
            <td>${escapeHtml(u.email || '')}${u.id === AppState.user.uid ? ' <span class="pill grey">you</span>' : ''}</td>
            <td><select onchange="window.changeUserRole('${u.id}', this.value)" ${u.id === AppState.user.uid ? 'disabled' : ''}>
              ${ROLES.map(r => `<option value="${r}" ${u.role === r ? 'selected' : ''}>${ROLE_LABEL[r]}</option>`).join('')}
            </select></td>
          </tr>`).join('')}</tbody>
      </table></div>
    </div>` : ''}`;

  wireSequenceDrag();

  let startCoords = hasCoords(s.startPoint) ? { lat: s.startPoint.lat, lng: s.startPoint.lng } : null;
  document.getElementById('cf-start-pin').onclick = () => openPinPicker({
    title: 'Where do sevadars set out from?',
    lat: startCoords?.lat, lng: startCoords?.lng,
    onPick: (c) => {
      startCoords = c;
      const el = document.getElementById('cf-start-coords');
      el.className = 'pill green'; el.style.flex = '1';
      el.textContent = `${c.lat.toFixed(5)}, ${c.lng.toFixed(5)}`;
    }
  });

  document.getElementById('cf-save').onclick = async () => {
    setBusy(true, 'Saving…');
    try {
      await DB.saveSettings({
        overdueDays: Number(document.getElementById('cf-overdue').value) || 60,
        staleBatchDays: Number(document.getElementById('cf-stale').value) || 14,
        startPoint: {
          name: document.getElementById('cf-start-name').value.trim() || 'Temple',
          address: s.startPoint?.address || '',
          lat: startCoords?.lat ?? null, lng: startCoords?.lng ?? null
        }
      });
      showToast('Settings saved', 'success');
      await loadConfig();
    } finally { setBusy(false); }
  };
}

/* ── SEQUENCE REORDERING ───────────────────────────── */
function wireSequenceDrag() {
  document.querySelectorAll('.seq-row').forEach(row => {
    row.ondragstart = (e) => {
      _seqDrag = { id: row.dataset.id, index: Number(row.dataset.index) };
      row.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', row.dataset.id);   // Firefox needs a payload
    };
    row.ondragend = () => { row.classList.remove('dragging'); _seqDrag = null; };
    row.ondragover = (e) => { if (_seqDrag) { e.preventDefault(); row.classList.add('drag-over'); } };
    row.ondragleave = () => row.classList.remove('drag-over');
    row.ondrop = async (e) => {
      e.preventDefault();
      row.classList.remove('drag-over');
      if (!_seqDrag) return;
      const to = Number(row.dataset.index);
      if (to === _seqDrag.index) return;
      await applyReorder(_seqDrag.index, to);
    };
  });
}

async function applyReorder(from, to) {
  const ids = AppState.areas.map(a => a.id);
  const [moved] = ids.splice(from, 1);
  ids.splice(to, 0, moved);

  setBusy(true, 'Saving order…');
  try {
    await DB.saveSequence(ids);
    showToast('Sequence updated', 'success');
    await loadConfig();
    // The dashboard's "next up" depends on this ordering.
    if (AppState.rotation) fireRotationChanged();
  } catch (e) {
    showToast('Could not save the order: ' + e.message, 'error');
  } finally { setBusy(false); }
}

window.suggestSequence = async function () {
  const devotees = await DB.getDevotees();
  const suggested = Solver.suggestAreaSequence(AppState.areas, devotees, AppState.settings.startPoint);

  const ok = await confirmDialog({
    title: 'Reorder by geography?',
    message: `Suggested: ${suggested.map(a => a.name).join(' → ')}. This is only a guess from where devotees are pinned — your own knowledge of the city usually beats it.`,
    confirmLabel: 'Use this order'
  });
  if (!ok) return;

  setBusy(true, 'Saving order…');
  try {
    await DB.saveSequence(suggested.map(a => a.id));
    showToast('Sequence reordered', 'success');
    await loadConfig();
  } finally { setBusy(false); }
};

/* ── AREAS ─────────────────────────────────────────── */
window.editArea = function (id) {
  const a = id ? AppState.areas.find(x => x.id === id) : { name: '', city: '', batchGroup: '' };
  const groups = [...new Set(AppState.areas.map(x => x.batchGroup).filter(Boolean))];

  openModal('area-modal', `
    <div class="modal-head">
      <h2>${id ? 'Edit Area' : 'Add Area'}</h2>
      <button class="icon-btn" onclick="closeModal('area-modal')"><i class="fa-solid fa-xmark"></i></button>
    </div>
    <div class="field"><label>Area name *</label><input id="ar-name" value="${escapeHtml(a.name || '')}" placeholder="e.g. Samrala Chowk"></div>
    <div class="field"><label>City</label><input id="ar-city" value="${escapeHtml(a.city || '')}" placeholder="Helps address lookup"></div>
    <div class="field">
      <label>Batch name (optional)</label>
      <input id="ar-batch" value="${escapeHtml(a.batchGroup || '')}" list="batch-groups" placeholder="e.g. CD">
      <datalist id="batch-groups">${groups.map(g => `<option value="${escapeHtml(g)}">`).join('')}</datalist>
      <p class="muted small">Areas sharing a batch name open and close <b>together</b> — use it for
         "Area C and D on the same day". Leave blank for an area that stands alone.</p>
    </div>
    ${!id ? '<div class="alert info">New areas join at the end of the sequence. Drag to move it.</div>' : ''}
    <div class="modal-foot">
      <button class="btn" onclick="closeModal('area-modal')">Cancel</button>
      <button class="btn primary" id="ar-save"><i class="fa-solid fa-check"></i> Save</button>
    </div>`);

  document.getElementById('ar-save').onclick = async () => {
    const name = document.getElementById('ar-name').value.trim();
    if (!name) return showToast('Area name is required', 'error');
    setBusy(true, 'Saving…');
    try {
      await DB.saveArea({
        id, name,
        city: document.getElementById('ar-city').value.trim(),
        batchGroup: document.getElementById('ar-batch').value.trim(),
        sequencePosition: id ? a.sequencePosition : undefined
      });
      closeModal('area-modal');
      showToast('Area saved', 'success');
      await loadConfig();
    } finally { setBusy(false); }
  };
};

window.removeArea = async function (id) {
  const area = AppState.areas.find(a => a.id === id);
  const devotees = await DB.getDevotees();
  const affected = devotees.filter(d => d.areaId === id).length;
  const isOpen = AppState.rotation && AppState.rotation.areaIds.includes(id);

  const ok = await confirmDialog({
    title: `Delete "${area.name}"?`,
    message: (isOpen ? 'This area is OPEN right now — deleting it will move the rotation on. ' : '') +
      (affected
        ? `${affected} devotee${affected === 1 ? '' : 's'} will be left with no area, which means they stop being covered until you reassign them.`
        : 'This area has no devotees.'),
    confirmLabel: 'Delete', danger: true
  });
  if (!ok) return;

  setBusy(true, 'Deleting…');
  try {
    await DB.deleteArea(id);
    // Don't strand the rotation on a batch that no longer exists.
    if (isOpen) {
      const areas = await DB.getAreas(true);
      const seq = buildSequence(areas);
      if (seq.length) await Rotation.openBatch(seq[0].key);
    }
    showToast('Area deleted', 'success');
    await loadBootstrap();
    await loadConfig();
  } finally { setBusy(false); }
};

window.openMergeAreas = function () {
  const opts = AppState.areas.map(a => `<option value="${a.id}">${escapeHtml(a.name)}</option>`).join('');
  openModal('area-modal', `
    <div class="modal-head">
      <h2>Merge Areas</h2>
      <button class="icon-btn" onclick="closeModal('area-modal')"><i class="fa-solid fa-xmark"></i></button>
    </div>
    <p class="muted small">Imported sheets often create near-duplicates like "Field Ganj" and "Field ganj". Merging moves every devotee into the area you keep.</p>
    <div class="field"><label>Merge these away</label>
      <select id="mg-sources" multiple size="6">${opts}</select>
      <p class="muted small">Ctrl/Cmd-click to pick more than one.</p></div>
    <div class="field"><label>Into this area (kept)</label><select id="mg-target">${opts}</select></div>
    <div class="modal-foot">
      <button class="btn" onclick="closeModal('area-modal')">Cancel</button>
      <button class="btn primary" id="mg-go"><i class="fa-solid fa-code-merge"></i> Merge</button>
    </div>`);

  document.getElementById('mg-go').onclick = async () => {
    const sources = [...document.getElementById('mg-sources').selectedOptions].map(o => o.value);
    const target = document.getElementById('mg-target').value;
    if (!sources.length) return showToast('Pick at least one area to merge away', 'error');
    if (sources.includes(target)) return showToast('An area cannot be merged into itself', 'error');
    setBusy(true, 'Merging…');
    try {
      const moved = await DB.mergeAreas(sources, target);
      closeModal('area-modal');
      showToast(`Merged — ${moved} devotee${moved === 1 ? '' : 's'} moved`, 'success');
      await loadConfig();
    } finally { setBusy(false); }
  };
};

window.changeUserRole = async function (uid, role) {
  await DB.setUserRole(uid, role);
  showToast(`Role set to ${ROLE_LABEL[role]}`, 'success');
};

window.loadConfig = loadConfig;
