/* ══ EXCEL.JS – spreadsheet import / export (PRD §7.1) ═══════════════
   xlsx-js-style (not plain xlsx) so exports carry real borders and fills.
   Import maps arbitrary columns onto our fields, then fuzzy-matches
   existing devotees so re-importing an updated sheet updates records
   instead of duplicating them.
═══════════════════════════════════════════════════════════════════════ */

const HEADER_STYLE = {
  font: { bold: true, sz: 11, color: { rgb: 'FFFFFF' } },
  fill: { fgColor: { rgb: '1A5C3A' } },
  alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
  border: { top: { style: 'thin', color: { rgb: 'FFFFFF' } }, bottom: { style: 'thin', color: { rgb: 'FFFFFF' } },
            left: { style: 'thin', color: { rgb: 'FFFFFF' } }, right: { style: 'thin', color: { rgb: 'FFFFFF' } } }
};
const CELL_STYLE = {
  alignment: { vertical: 'center', wrapText: true },
  border: { top: { style: 'thin', color: { rgb: 'DFE6E2' } }, bottom: { style: 'thin', color: { rgb: 'DFE6E2' } },
            left: { style: 'thin', color: { rgb: 'DFE6E2' } }, right: { style: 'thin', color: { rgb: 'DFE6E2' } } }
};

function sheetFromRows(rows, widths) {
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const range = XLSX.utils.decode_range(ws['!ref']);
  for (let R = range.s.r; R <= range.e.r; R++) {
    for (let C = range.s.c; C <= range.e.c; C++) {
      const addr = XLSX.utils.encode_cell({ r: R, c: C });
      if (ws[addr]) ws[addr].s = R === 0 ? HEADER_STYLE : CELL_STYLE;
    }
  }
  ws['!cols'] = (widths || []).map(w => ({ wch: w }));
  ws['!rows'] = [{ hpt: 24 }];
  return ws;
}

const downloadWorkbook = (wb, filename) =>
  XLSX.writeFile(wb, filename, { bookType: 'xlsx', cellStyles: true });

/* ── EXPORT: DIRECTORY ─────────────────────────────── */
window.exportDevotees = async function () {
  setBusy(true, 'Building spreadsheet…');
  try {
    const [devotees, state] = await Promise.all([DB.getDevotees(), Rotation.getState()]);
    const areaById = new Map(AppState.areas.map(a => [a.id, a]));

    const rows = [['Name', 'Phone', 'Address', 'Area', 'Batch', 'Bhoga', 'Status',
                   'Last received', 'Days since', 'Times served', 'In rotation',
                   'Google Maps link', 'Latitude', 'Longitude', 'Notes']];

    devotees.forEach(d => {
      const area = areaById.get(d.areaId);
      const since = daysSince(d.lastServedAt);
      rows.push([
        d.name || '', d.phone || '', d.addressText || '',
        area?.name || '', area?.batchGroup || '',
        BHOGA_TYPES[d.bhoga] ? BHOGA_TYPES[d.bhoga].label : '',
        d.status === 'paused' ? 'Paused' : 'Active',
        d.lastServedAt ? fmtDateShort(d.lastServedAt) : 'Never',
        since === null ? '' : since,
        d.timesServed || 0,
        Rotation.coverageOutlook(d, AppState.areas, state).text,
        d.mapsUrl || '',
        hasCoords(d) ? d.lat : '', hasCoords(d) ? d.lng : '',
        d.notes || ''
      ]);
    });

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, sheetFromRows(rows, [22, 14, 32, 18, 10, 15, 10, 14, 11, 12, 34, 40, 12, 12, 26]), 'Devotees');
    downloadWorkbook(wb, `Devotees_${todayStr()}.xlsx`);
    showToast(`Exported ${devotees.length} devotees`, 'success');
  } catch (e) {
    showToast('Export failed: ' + e.message, 'error');
  } finally { setBusy(false); }
};

/* ── EXPORT: COVERAGE / ROTATION HEALTH ────────────── */
window.exportCoverage = async function () {
  setBusy(true, 'Building spreadsheet…');
  try {
    const [devotees, areas, rounds, state] = await Promise.all([
      DB.getDevotees(true), DB.getAreas(true), DB.getRounds(200), Rotation.getState()
    ]);
    const areaById = new Map(areas.map(a => [a.id, a]));
    const overdueDays = AppState.settings.overdueDays ?? 60;
    const wb = XLSX.utils.book_new();

    // Sheet 1 — the ones at risk, which is what this report is for.
    const risk = [['Name', 'Phone', 'Area', 'Last received', 'Days since', 'Times served', 'In rotation']];
    devotees.filter(isActiveDevotee)
      .filter(d => { const n = daysSince(d.lastServedAt); return n === null || n > overdueDays; })
      .sort((a, b) => (daysSince(b.lastServedAt) ?? 1e9) - (daysSince(a.lastServedAt) ?? 1e9))
      .forEach(d => risk.push([
        d.name || '', d.phone || '', areaById.get(d.areaId)?.name || '',
        d.lastServedAt ? fmtDateShort(d.lastServedAt) : 'NEVER',
        daysSince(d.lastServedAt) ?? '', d.timesServed || 0,
        Rotation.coverageOutlook(d, areas, state).text
      ]));
    XLSX.utils.book_append_sheet(wb, sheetFromRows(risk, [22, 14, 18, 14, 11, 12, 34]), 'Needs attention');

    // Sheet 2 — round history.
    const hist = [['Round', 'Area / batch', 'Opened', 'Closed', 'Days', 'Closed early', 'Carried forward', 'Reason', 'Who was missed']];
    rounds.forEach(r => {
      const days = (r.openedAtClient && r.closedAtClient)
        ? Math.max(0, Math.round((new Date(r.closedAtClient) - new Date(r.openedAtClient)) / 86400000)) : '';
      hist.push([
        r.roundNumber ?? '', r.label || (r.areaIds || []).join(', '),
        fmtDateShort(r.openedAtClient), fmtDateShort(r.closedAtClient), days,
        r.forceClosed ? 'Yes' : 'No', r.missedCount || 0, r.reason || '',
        (r.missedDevoteeNames || []).join(', ')
      ]);
    });
    XLSX.utils.book_append_sheet(wb, sheetFromRows(hist, [8, 22, 14, 14, 8, 12, 14, 24, 40]), 'Round history');

    downloadWorkbook(wb, `Coverage_${todayStr()}.xlsx`);
    showToast('Coverage report exported', 'success');
  } catch (e) {
    showToast('Export failed: ' + e.message, 'error');
  } finally { setBusy(false); }
};

/* ── IMPORT ────────────────────────────────────────── */
const IMPORT_FIELDS = [
  { key: 'name',        label: 'Name',    required: true,  hints: ['name', 'devotee', 'full name', 'naam'] },
  { key: 'phone',       label: 'Phone',   required: false, hints: ['phone', 'mobile', 'contact', 'number', 'no.'] },
  { key: 'addressText', label: 'Address', required: false, hints: ['address', 'house', 'street', 'location', 'pata'] },
  { key: 'area',        label: 'Area',    required: false, hints: ['area', 'zone', 'locality', 'sector', 'colony'] },
  { key: 'bhoga',       label: 'Bhoga',     required: false, hints: ['bhoga', 'prasadam type', 'type', 'offering'] },
  { key: 'mapsUrl',     label: 'Maps link', required: false, hints: ['maps link', 'google maps', 'map link', 'location link', 'link', 'url'] },
  { key: 'lat',         label: 'Latitude',  required: false, hints: ['lat', 'latitude'] },
  { key: 'lng',         label: 'Longitude', required: false, hints: ['lng', 'lon', 'long', 'longitude'] },
  { key: 'notes',       label: 'Notes',   required: false, hints: ['note', 'remark', 'comment', 'landmark'] }
];

let _importRows = null, _importHeaders = null;

window.openImportModal = function () {
  openModal('import-modal', `
    <div class="modal-head">
      <h2>Import Devotees</h2>
      <button class="icon-btn" onclick="closeModal('import-modal')"><i class="fa-solid fa-xmark"></i></button>
    </div>
    <p class="muted small">Pick your existing <b>.xlsx</b> or <b>.csv</b>. First row must be column headings.
       Nothing is written until you confirm the preview.</p>
    <div class="field"><label>Spreadsheet file</label><input type="file" id="imp-file" accept=".xlsx,.xls,.csv"></div>
    <div id="imp-stage"></div>`);
  document.getElementById('imp-file').onchange = handleImportFile;
};

async function handleImportFile(e) {
  const file = e.target.files[0];
  if (!file) return;
  setBusy(true, 'Reading file…');
  try {
    const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
    const raw = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, blankrows: false, defval: '' });
    if (raw.length < 2) { setBusy(false); return showToast('That sheet has no data rows', 'error'); }
    _importHeaders = raw[0].map(h => String(h || '').trim());
    _importRows = raw.slice(1).filter(r => r.some(c => String(c || '').trim() !== ''));
    setBusy(false);
    renderColumnMapping();
  } catch (err) {
    setBusy(false);
    showToast('Could not read that file: ' + err.message, 'error', 6000);
  }
}

// Guess each mapping from the heading so the common case needs no clicks.
function guessColumn(field) {
  const lower = _importHeaders.map(h => h.toLowerCase());
  for (const hint of field.hints) { const i = lower.findIndex(h => h === hint); if (i !== -1) return i; }
  for (const hint of field.hints) { const i = lower.findIndex(h => h.includes(hint)); if (i !== -1) return i; }
  return -1;
}

function renderColumnMapping() {
  const options = (sel) => ['<option value="-1">— not in my sheet —</option>']
    .concat(_importHeaders.map((h, i) => `<option value="${i}" ${i === sel ? 'selected' : ''}>${escapeHtml(h || `Column ${i + 1}`)}</option>`)).join('');

  document.getElementById('imp-stage').innerHTML = `
    <div class="alert info">Found <b>${_importRows.length}</b> rows. Check the column matching below.</div>
    ${IMPORT_FIELDS.map(f => `
      <div class="row" style="margin-bottom:.4rem">
        <span style="flex:1 1 120px">${f.label}${f.required ? ' *' : ''}</span>
        <select class="imp-map" data-field="${f.key}" style="flex:2 1 180px">${options(guessColumn(f))}</select>
      </div>`).join('')}
    <div class="field"><label>Default area for rows with no area column</label>
      <select id="imp-default-area"><option value="">— none —</option>
        ${AppState.areas.map(a => `<option value="${a.id}">${escapeHtml(a.name)}</option>`).join('')}</select></div>
    <div class="modal-foot">
      <button class="btn" onclick="closeModal('import-modal')">Cancel</button>
      <button class="btn primary" id="imp-preview"><i class="fa-solid fa-eye"></i> Preview</button>
    </div>`;
  document.getElementById('imp-preview').onclick = buildImportPreview;
}

// Levenshtein, to spot near-duplicate names on re-import.
function levenshtein(a, b) {
  a = String(a || '').toLowerCase(); b = String(b || '').toLowerCase();
  if (a === b) return 0;
  if (!a.length || !b.length) return Math.max(a.length, b.length);
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++)
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}

async function buildImportPreview() {
  const map = {};
  document.querySelectorAll('.imp-map').forEach(sel => { map[sel.dataset.field] = Number(sel.value); });
  if (map.name === -1) return showToast('The Name column must be mapped', 'error');

  const defaultAreaId = document.getElementById('imp-default-area').value || null;
  setBusy(true, 'Matching against existing records…');
  const existing = await DB.getDevotees(true);
  const areaByName = new Map(AppState.areas.map(a => [a.name.trim().toLowerCase(), a]));

  const cell = (row, idx) => idx === -1 ? '' : String(row[idx] ?? '').trim();
  const parsed = [];
  const newAreas = new Set();

  _importRows.forEach((row, i) => {
    const name = cell(row, map.name);
    if (!name) return;
    const phone = normalizePhone(cell(row, map.phone));
    const areaName = cell(row, map.area);

    let areaId = defaultAreaId;
    if (areaName) {
      const found = areaByName.get(areaName.toLowerCase());
      if (found) areaId = found.id; else newAreas.add(areaName);
    }

    // A phone match is decisive; otherwise a close name match catches
    // "Radha Devi" vs "Radha Devi." on a re-import.
    let match = phone ? existing.find(d => d.phone && d.phone === phone) : null;
    if (!match) match = existing.find(d => d.name && levenshtein(d.name, name) <= Math.max(1, Math.floor(name.length * 0.15)));

    let lat = parseFloat(cell(row, map.lat)), lng = parseFloat(cell(row, map.lng));
    let hasPin = !Number.isNaN(lat) && !Number.isNaN(lng) && lat !== 0 && lng !== 0;

    // A pasted Maps link often carries coordinates; take them when the sheet
    // has no explicit lat/lng columns of its own.
    // Accept "Raj", "raj bhoga", "RAJ BHOGA" — whatever the sheet holds.
    const bhogaRaw = cell(row, map.bhoga).toLowerCase().replace(/bhoga/g, '').trim();
    const bhoga = BHOGA_KEYS.find(k => k === bhogaRaw || BHOGA_TYPES[k].short.toLowerCase() === bhogaRaw) || '';

    const mapsUrl = cell(row, map.mapsUrl);
    if (!hasPin && mapsUrl) {
      const parsed = parseMapsLink(mapsUrl);
      if (parsed && parsed.lat !== null && parsed.lat !== undefined) {
        lat = parsed.lat; lng = parsed.lng; hasPin = true;
      }
    }

    parsed.push({
      rowNumber: i + 2, isUpdate: !!match, matchId: match?.id || null, matchName: match?.name || null, areaName,
      data: {
        name, phone,
        addressText: cell(row, map.addressText),
        areaId,
        bhoga: bhoga || match?.bhoga || '',
        mapsUrl: mapsUrl || match?.mapsUrl || '',
        lat: hasPin ? lat : (match?.lat ?? null),
        lng: hasPin ? lng : (match?.lng ?? null),
        geocodeStatus: hasPin ? 'ok' : (match && hasCoords(match) ? 'ok' : 'pending'),
        status: match?.status || 'active',
        notes: cell(row, map.notes) || match?.notes || ''
      }
    });
  });

  setBusy(false);
  const updates = parsed.filter(p => p.isUpdate).length;
  const noArea = parsed.filter(p => !p.data.areaId && !p.areaName).length;

  document.getElementById('imp-stage').innerHTML = `
    <div class="stats" style="margin-bottom:.75rem">
      <div class="stat good"><div class="stat-value">${parsed.length - updates}</div><div class="stat-label">New</div></div>
      <div class="stat"><div class="stat-value">${updates}</div><div class="stat-label">Updates</div></div>
      <div class="stat ${noArea ? 'bad' : ''}"><div class="stat-value">${noArea}</div><div class="stat-label">No area</div></div>
    </div>

    ${newAreas.size ? `<div class="alert info"><b>${newAreas.size} new area name${newAreas.size === 1 ? '' : 's'}</b>:
      ${[...newAreas].slice(0, 6).map(escapeHtml).join(', ')}${newAreas.size > 6 ? '…' : ''}.
      These will be created and added to the <b>end</b> of the rotation sequence.</div>` : ''}

    ${noArea ? `<div class="alert warning">${noArea} row${noArea === 1 ? '' : 's'} have no area.
      They will be imported but <b>never covered</b> until you assign them one.</div>` : ''}

    <div class="table-wrap" style="max-height:280px; overflow-y:auto">
      <table><thead><tr><th>Row</th><th>Name</th><th>Area</th><th>Bhoga</th><th>Location</th><th>Action</th></tr></thead>
        <tbody>${parsed.slice(0, 100).map(p => `
          <tr><td class="muted small">${p.rowNumber}</td>
            <td>${escapeHtml(p.data.name)}</td>
            <td>${escapeHtml(p.areaName || '—')}</td>
            <td>${p.data.bhoga ? `<span class="pill blue">${escapeHtml(BHOGA_TYPES[p.data.bhoga].short)}</span>` : '<span class="muted small">—</span>'}</td>
            <td>${p.data.lat ? '<span class="pill green">Exact</span>'
                  : p.data.mapsUrl ? '<span class="pill blue">Link</span>'
                  : '<span class="muted small">—</span>'}</td>
            <td>${p.isUpdate ? `<span class="pill amber" title="Matched ${escapeHtml(p.matchName || '')}">Update</span>` : '<span class="pill green">New</span>'}</td>
          </tr>`).join('')}</tbody></table>
    </div>
    ${parsed.length > 100 ? `<p class="muted small">Showing the first 100 of ${parsed.length}.</p>` : ''}

    <div class="modal-foot">
      <button class="btn" onclick="window.openImportModal()"><i class="fa-solid fa-arrow-left"></i> Back</button>
      <button class="btn primary" id="imp-commit"><i class="fa-solid fa-check"></i> Import ${parsed.length} rows</button>
    </div>`;
  document.getElementById('imp-commit').onclick = () => commitImport(parsed, [...newAreas]);
}

async function commitImport(parsed, newAreaNames) {
  setBusy(true, 'Importing…');
  try {
    const created = new Map();
    for (const name of newAreaNames) {
      const id = await DB.saveArea({ name, city: '', batchGroup: '' });
      created.set(name.toLowerCase(), id);
    }
    if (newAreaNames.length) AppState.areas = await DB.getAreas(true);

    parsed.forEach(p => {
      if (!p.data.areaId && p.areaName) p.data.areaId = created.get(p.areaName.toLowerCase()) || null;
    });

    const saved = await DB.bulkSaveDevotees(parsed.map(p => ({ id: p.matchId, data: p.data })));
    closeModal('import-modal');
    setBusy(false);
    showToast(`Imported ${saved} devotees${newAreaNames.length ? `, ${newAreaNames.length} new areas` : ''}`, 'success', 5000);
    await loadDevotees();
  } catch (e) {
    setBusy(false);
    console.error('[SevaRoute] import failed', e);
    showToast('Import failed: ' + e.message, 'error', 6000);
  }
}
