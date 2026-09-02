/* ══ UI-REPORTS.JS – rotation health (PRD §7.5, §12) ═════════════════
   The headline KPI is the promise itself: what share of active devotees
   have received prasadam within one full cycle.
═══════════════════════════════════════════════════════════════════════ */

async function loadReports() {
  const panel = document.getElementById('tab-reports');
  const [devotees, areas, rounds, recent, state] = await Promise.all([
    DB.getDevotees(true), DB.getAreas(true), DB.getRounds(60), DB.getRecentCoverage(200), Rotation.getState()
  ]);
  const areaById = new Map(areas.map(a => [a.id, a]));
  const overdueDays = AppState.settings.overdueDays ?? 60;

  const active = devotees.filter(isActiveDevotee);
  const covered = active.filter(d => {
    const n = daysSince(d.lastServedAt);
    return n !== null && n <= overdueDays;
  });
  const never = active.filter(d => !d.lastServedAt);
  const overdue = active.filter(d => { const n = daysSince(d.lastServedAt); return n !== null && n > overdueDays; });
  const coveragePct = active.length ? Math.round(covered.length / active.length * 100) : 100;

  // Round completion times, from the closed-batch history.
  const timed = rounds.filter(r => r.openedAtClient && r.closedAtClient).map(r => ({
    ...r,
    days: Math.max(0, Math.round((new Date(r.closedAtClient) - new Date(r.openedAtClient)) / 86400000))
  }));
  const avgDays = timed.length ? (timed.reduce((n, r) => n + r.days, 0) / timed.length) : null;
  const forceClosed = rounds.filter(r => r.forceClosed);
  const totalMissed = forceClosed.reduce((n, r) => n + (r.missedCount || 0), 0);

  // Per-area health, so an area that keeps getting force-closed is visible.
  const areaHealth = areas.map(a => {
    const members = active.filter(d => d.areaId === a.id);
    const worst = members.reduce((m, d) => {
      const n = daysSince(d.lastServedAt);
      if (n === null) return 'never';
      return m === 'never' ? 'never' : Math.max(m, n);
    }, 0);
    return {
      area: a,
      count: members.length,
      never: members.filter(d => !d.lastServedAt).length,
      overdue: members.filter(d => { const n = daysSince(d.lastServedAt); return n !== null && n > overdueDays; }).length,
      worst,
      closes: rounds.filter(r => (r.areaIds || []).includes(a.id)).length,
      forced: rounds.filter(r => (r.areaIds || []).includes(a.id) && r.forceClosed).length
    };
  }).sort((x, y) => (y.never + y.overdue) - (x.never + x.overdue));

  panel.innerHTML = `
    <div class="stats">
      <div class="stat ${coveragePct === 100 ? 'good' : coveragePct >= 90 ? 'warn' : 'bad'}">
        <div class="stat-value">${coveragePct}%</div><div class="stat-label">Covered in ${overdueDays}d</div></div>
      <div class="stat"><div class="stat-value">${state ? state.roundNumber : '—'}</div><div class="stat-label">Current round</div></div>
      <div class="stat ${never.length ? 'bad' : 'good'}"><div class="stat-value">${never.length}</div><div class="stat-label">Never served</div></div>
      <div class="stat ${overdue.length ? 'bad' : 'good'}"><div class="stat-value">${overdue.length}</div><div class="stat-label">Overdue</div></div>
      <div class="stat"><div class="stat-value">${avgDays === null ? '—' : avgDays.toFixed(1)}</div><div class="stat-label">Avg days / area</div></div>
      <div class="stat ${totalMissed ? 'warn' : 'good'}"><div class="stat-value">${totalMissed}</div><div class="stat-label">Carried forward</div></div>
    </div>

    ${(never.length || overdue.length) ? `
    <div class="card" style="border-left:4px solid var(--color-danger)">
      <div class="card-head">
        <h3><i class="fa-solid fa-triangle-exclamation"></i> Needs attention (${never.length + overdue.length})</h3>
        <button class="btn sm" onclick="window.exportCoverage()"><i class="fa-solid fa-file-excel"></i> Export</button>
      </div>
      <p class="muted small">Active devotees who have not received prasadam within one cycle. This
         list is the whole point of the app — it should trend to zero.</p>
      <div class="table-wrap"><table>
        <thead><tr><th>Name</th><th>Area</th><th>Last received</th><th>In rotation</th></tr></thead>
        <tbody>${[...never, ...overdue].slice(0, 60).map(d => `
          <tr>
            <td>${escapeHtml(d.name)}</td>
            <td>${escapeHtml(areaById.get(d.areaId)?.name || '— none —')}</td>
            <td class="cell-warn">${d.lastServedAt ? escapeHtml(fmtAgo(d.lastServedAt)) : '<span class="pill red">Never</span>'}</td>
            <td><span class="pill ${Rotation.coverageOutlook(d, areas, state).tone}">${escapeHtml(Rotation.coverageOutlook(d, areas, state).text)}</span></td>
          </tr>`).join('')}</tbody>
      </table></div>
      ${(never.length + overdue.length) > 60 ? `<p class="muted small">Showing 60 of ${never.length + overdue.length} — export for the full list.</p>` : ''}
    </div>` : `
    <div class="card" style="border-left:4px solid var(--color-success)">
      <h3><i class="fa-solid fa-circle-check" style="color:var(--color-success)"></i> Everyone is covered</h3>
      <p class="muted small">Every active devotee has received prasadam within the last ${overdueDays} days.</p>
    </div>`}

    <div class="card">
      <div class="card-head"><h3><i class="fa-solid fa-map"></i> Area health</h3></div>
      <div class="table-wrap"><table>
        <thead><tr><th>Area</th><th>Devotees</th><th>Never</th><th>Overdue</th><th>Longest wait</th><th>Rounds closed</th></tr></thead>
        <tbody>${areaHealth.map(h => `
          <tr>
            <td><b>${escapeHtml(h.area.name)}</b>${h.area.batchGroup ? ` <span class="pill blue">${escapeHtml(h.area.batchGroup)}</span>` : ''}</td>
            <td>${h.count}</td>
            <td>${h.never ? `<span class="pill red">${h.never}</span>` : '0'}</td>
            <td>${h.overdue ? `<span class="pill amber">${h.overdue}</span>` : '0'}</td>
            <td>${h.worst === 'never' ? '<span class="pill red">never served</span>' : (h.count ? h.worst + ' days' : '—')}</td>
            <td>${h.closes}${h.forced ? ` <span class="pill amber" title="closed early">${h.forced} early</span>` : ''}</td>
          </tr>`).join('')}</tbody>
      </table></div>
    </div>

    <div class="card">
      <div class="card-head"><h3><i class="fa-solid fa-clock-rotate-left"></i> Round history</h3></div>
      ${rounds.length ? `<div class="table-wrap"><table>
        <thead><tr><th>Round</th><th>Area / batch</th><th>Closed</th><th>Took</th><th>Outcome</th></tr></thead>
        <tbody>${rounds.map(r => {
          const t = timed.find(x => x.id === r.id);
          return `<tr>
            <td>${r.roundNumber}</td>
            <td>${escapeHtml(r.label || (r.areaIds || []).join(', '))}</td>
            <td>${escapeHtml(fmtDateShort(r.closedAtClient))}</td>
            <td>${t ? (t.days === 0 ? 'same day' : `${t.days} days`) : '—'}</td>
            <td>${r.forceClosed
              ? `<span class="pill amber">Closed early — ${r.missedCount || 0} carried forward</span>${r.reason ? `<div class="stop-sub">${escapeHtml(r.reason)}</div>` : ''}`
              : '<span class="pill green">Fully covered</span>'}</td>
          </tr>`;
        }).join('')}</tbody>
      </table></div>` : '<p class="muted small">No areas have been completed yet.</p>'}
    </div>

    <div class="card">
      <div class="card-head">
        <h3><i class="fa-solid fa-hand-holding-heart"></i> Recent seva</h3>
        <span class="muted small">Last ${Math.min(recent.length, 25)} deliveries</span>
      </div>
      ${recent.length ? `<div class="table-wrap"><table>
        <thead><tr><th>When</th><th>Devotee</th><th>Area</th><th>By</th><th>Round</th></tr></thead>
        <tbody>${recent.slice(0, 25).map(l => `
          <tr class="${l.reversal ? 'muted' : ''}">
            <td>${escapeHtml(fmtDateTime(l.servedAtClient))}</td>
            <td>${escapeHtml(l.devoteeName || '')}${l.reversal ? ' <span class="pill grey">reversed</span>' : ''}</td>
            <td>${escapeHtml(areaById.get(l.areaId)?.name || '—')}</td>
            <td>${escapeHtml(l.servedByName || '—')}</td>
            <td>${l.roundNumber ?? '—'}</td>
          </tr>`).join('')}</tbody>
      </table></div>` : '<p class="muted small">Nothing recorded yet.</p>'}
    </div>`;
}

window.loadReports = loadReports;
