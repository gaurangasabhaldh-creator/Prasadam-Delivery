/* ══ UI-DEVOTEES.JS – the directory (PRD §7.1) ═══════════════════════
   Every row carries the "no one is bereft" signal: when they last
   received prasadam, how many times, and where they sit in the rotation.
═══════════════════════════════════════════════════════════════════════ */

let _devSearch = '';
let _devFilter = 'all';   // all | overdue | never | paused | noPin | carried

async function loadDevotees() {
  const panel = document.getElementById('tab-devotees');
  const [devotees, areas, state] = await Promise.all([
    DB.getDevotees(), DB.getAreas(), Rotation.getState()
  ]);
  const areaById = new Map(areas.map(a => [a.id, a]));
  const overdueDays = AppState.settings.overdueDays ?? 60;

  const active = devotees.filter(isActiveDevotee);
  const neverServed = active.filter(d => !d.lastServedAt);
  const overdue = active.filter(d => { const n = daysSince(d.lastServedAt); return n !== null && n > overdueDays; });
  const noPin = devotees.filter(d => !hasCoords(d));
  const paused = devotees.filter(d => d.status === 'paused');
  const carried = active.filter(d => d.carriedForwardFrom);
  const noBhoga = active.filter(d => !BHOGA_TYPES[d.bhoga]);

  const filtered = devotees.filter(d => {
    if (_devFilter === 'overdue') { const n = daysSince(d.lastServedAt); if (!(isActiveDevotee(d) && n !== null && n > overdueDays)) return false; }
    if (_devFilter === 'never'   && !(isActiveDevotee(d) && !d.lastServedAt)) return false;
    if (_devFilter === 'paused'  && d.status !== 'paused') return false;
    if (_devFilter === 'noPin'   && hasCoords(d)) return false;
    if (_devFilter === 'carried' && !d.carriedForwardFrom) return false;
    if (_devFilter === 'noBhoga' && BHOGA_TYPES[d.bhoga]) return false;
    if (BHOGA_TYPES[_devFilter] && d.bhoga !== _devFilter) return false;
    if (_devSearch) {
      const hay = `${d.name} ${d.phone || ''} ${d.addressText || ''} ${areaById.get(d.areaId)?.name || ''}`.toLowerCase();
      if (!hay.includes(_devSearch.toLowerCase())) return false;
    }
    return true;
  });

  panel.innerHTML = `
    <div class="stats">
      <div class="stat"><div class="stat-value">${active.length}</div><div class="stat-label">Active</div></div>
      <div class="stat ${neverServed.length ? 'warn' : 'good'}"><div class="stat-value">${neverServed.length}</div><div class="stat-label">Never served</div></div>
      <div class="stat ${overdue.length ? 'bad' : 'good'}"><div class="stat-value">${overdue.length}</div><div class="stat-label">Over ${overdueDays}d</div></div>
      <div class="stat ${carried.length ? 'warn' : ''}"><div class="stat-value">${carried.length}</div><div class="stat-label">Carried forward</div></div>
      <div class="stat ${noBhoga.length ? 'warn' : 'good'}"><div class="stat-value">${noBhoga.length}</div><div class="stat-label">No bhoga</div></div>
      <div class="stat"><div class="stat-value">${paused.length}</div><div class="stat-label">Paused</div></div>
    </div>

    ${noBhoga.length ? `<div class="alert warning">
      <b>${noBhoga.length} devotee${noBhoga.length === 1 ? ' has' : 's have'} no bhoga set.</b>
      They are still fully in the rotation, but appear in an unlabelled group at the bottom of the
      checklist. Use the <b>No bhoga set</b> filter to assign them.
    </div>` : ''}

    ${noPin.length ? `<div class="alert info">
      <b>${noPin.length} devotee${noPin.length === 1 ? ' has' : 's have'} no map pin.</b>
      They are still fully in the rotation and still appear on the checklist — a pin only helps
      order the stops by distance, which is optional.
    </div>` : ''}

    <div class="card">
      <div class="card-head">
        <h2>Devotee Directory</h2>
        <div class="row">
          <button class="btn sm" onclick="window.exportDevotees()"><i class="fa-solid fa-file-excel"></i> Export</button>
          <button class="btn sm" onclick="window.openImportModal()"><i class="fa-solid fa-file-import"></i> Import</button>
          ${Geo.isGeocodingAvailable() && noPin.length
            ? `<button class="btn sm" onclick="window.geocodeAll()"><i class="fa-solid fa-location-crosshairs"></i> Locate all</button>` : ''}
          <button class="btn primary sm" onclick="window.editDevotee()"><i class="fa-solid fa-plus"></i> Add</button>
        </div>
      </div>

      <div class="row" style="margin-bottom:.75rem">
        <input type="search" id="dev-search" placeholder="Search name, phone or address…"
               value="${escapeHtml(_devSearch)}" style="flex:2 1 220px">
        <select id="dev-filter" style="flex:1 1 160px">
          <option value="all">Everyone</option>
          <option value="overdue">Overdue (${overdue.length})</option>
          <option value="never">Never served (${neverServed.length})</option>
          <option value="carried">Carried forward (${carried.length})</option>
          <option value="noBhoga">No bhoga set (${noBhoga.length})</option>
          ${BHOGA_KEYS.map(k => `<option value="${k}">${BHOGA_TYPES[k].label} (${active.filter(d => d.bhoga === k).length})</option>`).join('')}
          <option value="noPin">No map pin (${noPin.length})</option>
          <option value="paused">Paused (${paused.length})</option>
        </select>
      </div>

      ${filtered.length ? `
      <div class="table-wrap"><table>
        <thead><tr><th>Name</th><th>Area</th><th>Last received</th><th>Times</th><th>In rotation</th><th class="right"></th></tr></thead>
        <tbody>${filtered.map(d => renderDevoteeRow(d, areaById, state, overdueDays)).join('')}</tbody>
      </table></div>
      <p class="muted small" style="margin-top:.6rem">Showing ${filtered.length} of ${devotees.length}</p>
      ` : `<div class="empty"><i class="fa-solid fa-user-slash"></i>
             ${devotees.length ? 'Nobody matches these filters.' : 'No devotees yet — add one or import your spreadsheet.'}
           </div>`}
    </div>`;

  const s = document.getElementById('dev-search');
  s.oninput = debounce(() => { _devSearch = s.value; loadDevotees(); }, 250);
  const f = document.getElementById('dev-filter');
  f.value = _devFilter;
  f.onchange = () => { _devFilter = f.value; loadDevotees(); };
}

function renderDevoteeRow(d, areaById, state, overdueDays) {
  const area = areaById.get(d.areaId);
  const since = daysSince(d.lastServedAt);
  const isOverdue = isActiveDevotee(d) && since !== null && since > overdueDays;
  const never = isActiveDevotee(d) && !d.lastServedAt;
  const outlook = Rotation.coverageOutlook(d, AppState.areas, state);

  return `<tr>
    <td>
      <div class="stop-name">${escapeHtml(d.name)}
        ${d.carriedForwardFrom ? '<span class="pill amber">Carried</span>' : ''}
        ${d.status === 'paused' ? '<span class="pill grey">Paused</span>' : ''}
      </div>
      <div class="stop-sub">${escapeHtml(d.phone || '—')}</div>
      ${BHOGA_TYPES[d.bhoga]
        ? `<span class="pill blue"><i class="fa-solid ${BHOGA_TYPES[d.bhoga].icon}"></i> ${escapeHtml(BHOGA_TYPES[d.bhoga].short)}</span>`
        : '<span class="pill amber">No bhoga set</span>'}
    </td>
    <td>${escapeHtml(area ? area.name : '—')}
      ${(hasCoords(d) || d.mapsUrl) ? '' : '<div class="stop-sub muted">no location</div>'}</td>
    <td class="${isOverdue || never ? 'cell-warn' : ''}">
      ${never ? '<span class="pill red">Never</span>' : escapeHtml(fmtAgo(d.lastServedAt))}
      ${isOverdue ? '<div class="stop-sub" style="color:var(--color-danger)">Overdue</div>' : ''}
    </td>
    <td>${d.timesServed || 0}</td>
    <td><span class="pill ${outlook.tone}">${escapeHtml(outlook.text)}</span></td>
    <td class="actions">
      <button class="icon-btn" title="History" onclick="window.viewDevoteeHistory('${d.id}')"><i class="fa-solid fa-clock-rotate-left"></i></button>
      <button class="icon-btn" title="Set location" onclick="window.pinDevotee('${d.id}')"><i class="fa-solid fa-map-pin"></i></button>
      <button class="icon-btn" title="${d.status === 'paused' ? 'Resume' : 'Pause'}" onclick="window.toggleDevoteePause('${d.id}')">
        <i class="fa-solid ${d.status === 'paused' ? 'fa-play' : 'fa-pause'}"></i></button>
      <button class="icon-btn" title="Edit" onclick="window.editDevotee('${d.id}')"><i class="fa-solid fa-pen"></i></button>
      <button class="icon-btn" title="Remove" onclick="window.removeDevotee('${d.id}')"><i class="fa-solid fa-trash"></i></button>
    </td>
  </tr>`;
}

// ── EDIT / CREATE ─────────────────────────────────────
window.editDevotee = async function (id) {
  const d = id ? await DB.getDevotee(id)
               : { name: '', phone: '', addressText: '', areaId: '', status: 'active', notes: '' };

  const areaOpts = ['<option value="">— No area (will not be covered) —</option>']
    .concat(AppState.areas.map(a => `<option value="${a.id}" ${a.id === d.areaId ? 'selected' : ''}>${escapeHtml(a.name)}</option>`))
    .join('');

  openModal('devotee-modal', `
    <div class="modal-head">
      <h2>${id ? 'Edit Devotee' : 'Add Devotee'}</h2>
      <button class="icon-btn" onclick="closeModal('devotee-modal')"><i class="fa-solid fa-xmark"></i></button>
    </div>

    <div class="field"><label>Name *</label><input id="dv-name" value="${escapeHtml(d.name || '')}"></div>
    <div class="field"><label>Phone</label><input id="dv-phone" inputmode="numeric" value="${escapeHtml(d.phone || '')}"></div>
    <div class="field"><label>Address</label><textarea id="dv-address" placeholder="House / street / landmark">${escapeHtml(d.addressText || '')}</textarea></div>

    <div class="field">
      <label>Which bhoga do they receive? *</label>
      <div class="bhoga-picker" id="dv-bhoga-picker">
        ${BHOGA_KEYS.map(k => `
          <button type="button" class="bhoga-opt ${d.bhoga === k ? 'on' : ''}" data-bhoga="${k}">
            <i class="fa-solid ${BHOGA_TYPES[k].icon}"></i>
            <span>${BHOGA_TYPES[k].label}</span>
          </button>`).join('')}
      </div>
      <p class="muted small">The checklist is grouped by this, so a sevadar can see at a glance
         which offering each devotee is waiting for.</p>
    </div>

    <div class="grid-2">
      <div class="field"><label>Area</label><select id="dv-area">${areaOpts}</select></div>
      <div class="field"><label>Status</label>
        <select id="dv-status">
          <option value="active" ${d.status !== 'paused' ? 'selected' : ''}>Active — in the rotation</option>
          <option value="paused" ${d.status === 'paused' ? 'selected' : ''}>Paused — skip for now</option>
        </select>
      </div>
    </div>

    <div class="field"><label>Notes</label><textarea id="dv-notes" placeholder="Gate code, floor, landmark…">${escapeHtml(d.notes || '')}</textarea></div>

    <div class="field">
      <label>Google Maps link</label>
      <textarea id="dv-maps" rows="2" placeholder="Paste a Google Maps link, or type 30.9010, 75.8573">${escapeHtml(d.mapsUrl || '')}</textarea>
      <div id="dv-maps-status" class="maps-status"></div>
      <p class="muted small">
        In Google Maps: find the place → <b>Share</b> → <b>Copy link</b> → paste it here.
        The sevadar's <b>Navigate</b> button will take them straight there.
      </p>
      <div class="row" style="margin-top:.4rem">
        <span id="dv-coords" class="pill ${hasCoords(d) ? 'green' : 'grey'}" style="flex:1">
          ${hasCoords(d) ? `Pinned at ${d.lat.toFixed(5)}, ${d.lng.toFixed(5)}` : 'No exact coordinates'}
        </span>
        <button class="btn sm" id="dv-pin"><i class="fa-solid fa-map-pin"></i> Pick on map</button>
        ${Geo.isGeocodingAvailable() ? `<button class="btn sm" id="dv-geocode"><i class="fa-solid fa-magnifying-glass-location"></i> Look up</button>` : ''}
      </div>
      <p class="muted small">Everything here is optional — a devotee with no location at all is
         still fully in the rotation and still on the checklist.</p>
    </div>

    ${id ? `<div class="alert info">
      Last received: <b>${escapeHtml(fmtAgo(d.lastServedAt))}</b> · ${d.timesServed || 0} time${(d.timesServed || 0) === 1 ? '' : 's'} in total
    </div>` : ''}

    <div class="modal-foot">
      <button class="btn" onclick="closeModal('devotee-modal')">Cancel</button>
      <button class="btn primary" id="dv-save"><i class="fa-solid fa-check"></i> Save</button>
    </div>`);

  // Tap-to-choose rather than a dropdown: three options is few enough that
  // showing them all is faster than opening a select, especially one-handed.
  let bhoga = BHOGA_TYPES[d.bhoga] ? d.bhoga : '';
  document.querySelectorAll('#dv-bhoga-picker .bhoga-opt').forEach(btn => {
    btn.onclick = () => {
      // Tapping the chosen one again clears it, so a mistake is undoable.
      bhoga = (bhoga === btn.dataset.bhoga) ? '' : btn.dataset.bhoga;
      document.querySelectorAll('#dv-bhoga-picker .bhoga-opt')
        .forEach(b => b.classList.toggle('on', b.dataset.bhoga === bhoga));
    };
  });

  let coords = hasCoords(d) ? { lat: d.lat, lng: d.lng } : null;
  const coordsEl = document.getElementById('dv-coords');
  const setCoords = (c) => {
    coords = c;
    coordsEl.className = 'pill green'; coordsEl.style.flex = '1';
    coordsEl.textContent = `Pinned at ${c.lat.toFixed(5)}, ${c.lng.toFixed(5)}`;
  };

  document.getElementById('dv-pin').onclick = () => openPinPicker({
    title: 'Place devotee location', lat: coords?.lat, lng: coords?.lng, onPick: setCoords
  });

  // Tell the coordinator immediately what the link they pasted is worth —
  // whether it will navigate, and whether it also unlocks distance ordering.
  const mapsEl = document.getElementById('dv-maps');
  const mapsStatus = document.getElementById('dv-maps-status');
  const reviewLink = () => {
    const raw = mapsEl.value.trim();
    if (!raw) { mapsStatus.innerHTML = ''; return; }
    const p = parseMapsLink(raw);
    if (!p) {
      mapsStatus.innerHTML = `<span class="pill red"><i class="fa-solid fa-triangle-exclamation"></i>
        That does not look like a Google Maps link or a coordinate pair</span>`;
      return;
    }
    if (p.lat !== null && p.lat !== undefined) {
      // Coordinates found — adopt them so the checklist can be distance-sorted.
      setCoords({ lat: p.lat, lng: p.lng });
      mapsStatus.innerHTML = `<span class="pill green"><i class="fa-solid fa-circle-check"></i>
        Exact location found — navigation and distance ordering will both work</span>`;
    } else if (p.placeText) {
      mapsStatus.innerHTML = `<span class="pill blue"><i class="fa-solid fa-diamond-turn-right"></i>
        Navigation will work — ${escapeHtml(p.placeText.slice(0, 70))}${p.placeText.length > 70 ? '…' : ''}</span>
        <div class="stop-sub">No coordinates in this link, so this devotee is skipped when ordering by distance.
        Use “Pick on map” as well if you want that.</div>`;
    } else {
      mapsStatus.innerHTML = `<span class="pill amber"><i class="fa-solid fa-link"></i>
        Link saved — it will open in Google Maps</span>
        <div class="stop-sub">Short links cannot be read by the app. A full link (or “Pick on map”)
        also enables distance ordering.</div>`;
    }
  };
  mapsEl.oninput = debounce(reviewLink, 350);
  reviewLink();

  const geoBtn = document.getElementById('dv-geocode');
  if (geoBtn) geoBtn.onclick = async () => {
    const addr = document.getElementById('dv-address').value.trim();
    if (!addr) return showToast('Enter an address first', 'warning');
    const city = AppState.areas.find(a => a.id === document.getElementById('dv-area').value)?.city || '';
    setBusy(true, 'Looking up address…');
    const r = await Geo.geocode(addr, city);
    setBusy(false);
    if (!r.ok) return showToast(geocodeErrorText(r.reason), 'error', 5000);
    setCoords({ lat: r.lat, lng: r.lng });
    showToast(Geo.isPrecise(r.precision) ? 'Location found' : 'Only approximate — check the pin',
              Geo.isPrecise(r.precision) ? 'success' : 'warning', 5000);
  };

  document.getElementById('dv-save').onclick = async () => {
    const name = document.getElementById('dv-name').value.trim();
    if (!name) return showToast('Name is required', 'error');

    setBusy(true, 'Saving…');
    try {
      await DB.saveDevotee({
        id, name,
        phone: document.getElementById('dv-phone').value,
        addressText: document.getElementById('dv-address').value,
        areaId: document.getElementById('dv-area').value || null,
        bhoga,
        mapsUrl: document.getElementById('dv-maps').value,
        lat: coords?.lat ?? null, lng: coords?.lng ?? null,
        geocodeStatus: coords ? 'ok' : 'pending',
        status: document.getElementById('dv-status').value,
        notes: document.getElementById('dv-notes').value
      });
      closeModal('devotee-modal');

      // Tell them plainly where this person now sits in the cycle —
      // "added but invisible until next month" is the confusion the
      // manual system caused in the first place.
      if (!id) {
        const fresh = await DB.getDevotees(true);
        const added = fresh.find(x => x.name === name);
        if (added) {
          const outlook = Rotation.coverageOutlook(added, AppState.areas, AppState.rotation);
          showToast(`${name} added — ${outlook.text.toLowerCase()}`, 'success', 6000);
        } else showToast('Devotee added', 'success');
      } else showToast('Devotee updated', 'success');

      await loadDevotees();
    } catch (e) {
      showToast(describeWriteError(e, 'save this devotee'), 'error', 9000);
    } finally { setBusy(false); }
  };
};

function geocodeErrorText(reason) {
  return {
    notFound: 'Address not found — try adding the city, or place the pin manually.',
    quota:    'Geocoding quota exhausted for now.',
    denied:   'Geocoding key rejected. Check the key and its restrictions.',
    noKey:    'No geocoding key configured — place the pin manually instead.',
    network:  'No connection to the geocoding service.'
  }[reason] || 'Could not look up that address.';
}

// ── HISTORY ───────────────────────────────────────────
window.viewDevoteeHistory = async function (id) {
  setBusy(true, 'Loading history…');
  const [d, log] = await Promise.all([DB.getDevotee(id), DB.getCoverageForDevotee(id)]);
  setBusy(false);

  const outlook = Rotation.coverageOutlook(d, AppState.areas, AppState.rotation);

  openModal('devotee-modal', `
    <div class="modal-head">
      <h2>${escapeHtml(d.name)}</h2>
      <button class="icon-btn" onclick="closeModal('devotee-modal')"><i class="fa-solid fa-xmark"></i></button>
    </div>
    <div class="stats" style="margin-bottom:.75rem">
      <div class="stat"><div class="stat-value">${d.timesServed || 0}</div><div class="stat-label">Times served</div></div>
      <div class="stat"><div class="stat-value" style="font-size:1rem">${escapeHtml(fmtAgo(d.lastServedAt))}</div><div class="stat-label">Last received</div></div>
    </div>
    <div class="alert ${outlook.tone === 'red' ? 'danger' : outlook.tone === 'amber' ? 'warning' : 'info'}">
      ${escapeHtml(outlook.text)}
    </div>
    <h3>Seva record</h3>
    ${log.length ? `<div class="table-wrap"><table>
      <thead><tr><th>When</th><th>Round</th><th>By</th><th>Note</th></tr></thead>
      <tbody>${log.map(l => `<tr class="${l.reversal ? 'muted' : ''}">
        <td>${escapeHtml(fmtDateTime(l.servedAtClient))}</td>
        <td>${l.roundNumber ?? '—'}</td>
        <td>${escapeHtml(l.servedByName || '—')}</td>
        <td>${l.reversal ? '<span class="pill grey">Reversed</span> ' : ''}${escapeHtml(l.note || '')}</td>
      </tr>`).join('')}</tbody></table></div>`
      : '<p class="muted small">No deliveries recorded yet.</p>'}
    <div class="modal-foot"><button class="btn" onclick="closeModal('devotee-modal')">Close</button></div>`);
};

// ── ROW ACTIONS ───────────────────────────────────────
window.pinDevotee = async function (id) {
  const d = await DB.getDevotee(id);
  openPinPicker({
    title: `Location for ${d.name}`, lat: d.lat, lng: d.lng,
    onPick: async (c) => {
      await DB.saveGeocode(id, c.lat, c.lng, 'ok');
      showToast('Location saved', 'success');
      await loadDevotees();
    }
  });
};

window.toggleDevoteePause = async function (id) {
  const d = await DB.getDevotee(id);
  const next = d.status === 'paused' ? 'active' : 'paused';
  await DB.setDevoteeStatus(id, next);
  showToast(next === 'paused'
    ? `${d.name} paused — skipped by the rotation, history kept`
    : `${d.name} resumed — back in the rotation`, 'success', 5000);
  await loadDevotees();
};

window.removeDevotee = async function (id) {
  const d = await DB.getDevotee(id);
  const ok = await confirmDialog({
    title: 'Remove devotee?',
    message: `${d.name} will be taken out of the rotation. Their seva record is kept. To skip them temporarily, use Pause instead.`,
    confirmLabel: 'Remove', danger: true
  });
  if (!ok) return;
  await DB.deleteDevotee(id);
  showToast('Devotee removed', 'success');
  await loadDevotees();
};

window.geocodeAll = async function () {
  const devotees = await DB.getDevotees();
  const pending = devotees.filter(d => !hasCoords(d) && d.addressText);
  if (!pending.length) return showToast('Everyone with an address already has a pin', 'info');

  const ok = await confirmDialog({
    title: 'Look up addresses?',
    message: `${pending.length} address${pending.length === 1 ? '' : 'es'} will be sent to ${Geo.geocoderName()}. Results are cached, so each address is only looked up once.`,
    confirmLabel: 'Look them up'
  });
  if (!ok) return;

  setBusy(true, 'Looking up addresses…');
  const result = await Geo.geocodePending(devotees, {
    onProgress: (done, total, name) => setBusy(true, `Looking up ${done} of ${total}… (${name})`)
  });
  setBusy(false);

  let msg = `${result.ok} located`;
  if (result.needsReview) msg += `, ${result.needsReview} approximate`;
  if (result.failed) msg += `, ${result.failed} failed`;
  showToast(msg, result.failed ? 'warning' : 'success', 6000);
  if (result.abortedReason) showToast(geocodeErrorText(result.abortedReason) + ' Stopped early.', 'error', 7000);
  await loadDevotees();
};

window.loadDevotees = loadDevotees;
