/* ══ UI-USERS.JS – account management drawer (super admin only) ══════

   Slides in from the hamburger. Two things it can do: change what an
   account is allowed to do, and take that access away.

   On "removing" someone — worth being precise, because the obvious
   version does not work. Deleting their users/{uid} document does NOT
   remove them: the Firebase Auth login still exists, they sign in again,
   and ensureUserProfile() recreates the profile as a sevadar, quietly
   handing access back. So removal here REVOKES instead — the record
   stays, marked disabled, and the security rules give a disabled account
   rank 0, which denies everything and survives a re-login.

   Deleting the login itself needs the Admin SDK and cannot be done from a
   browser at all; that lives in the Firebase Console.
═══════════════════════════════════════════════════════════════════════ */

let _userSearch = '';

function openUserPanel() {
  if (!hasRole('superAdmin')) return;
  const drawer = document.getElementById('user-drawer');
  drawer.classList.remove('hidden');
  // Let the class land before transitioning, or it snaps open.
  requestAnimationFrame(() => drawer.classList.add('open'));
  document.body.classList.add('drawer-open');
  loadUserPanel();
}

function closeUserPanel() {
  const drawer = document.getElementById('user-drawer');
  drawer.classList.remove('open');
  document.body.classList.remove('drawer-open');
  setTimeout(() => drawer.classList.add('hidden'), 200);
}

async function loadUserPanel() {
  const body = document.getElementById('user-drawer-body');
  body.innerHTML = '<div class="empty"><i class="fa-solid fa-spinner fa-spin"></i>Loading accounts…</div>';

  let users;
  try {
    users = await DB.getUsers();
  } catch (e) {
    body.innerHTML = `<div class="alert danger">${escapeHtml(describeWriteError(e, 'load accounts'))}</div>`;
    return;
  }

  const me = AppState.user ? AppState.user.uid : null;
  const active = users.filter(u => !u.disabled);
  const owners = active.filter(u => u.role === 'superAdmin');
  const revoked = users.filter(u => u.disabled);

  const shown = users.filter(u => {
    if (!_userSearch) return true;
    return `${u.email || ''} ${u.name || ''}`.toLowerCase().includes(_userSearch.toLowerCase());
  }).sort((a, b) =>
    (a.disabled ? 1 : 0) - (b.disabled ? 1 : 0) ||
    (ROLE_RANK[b.role] || 0) - (ROLE_RANK[a.role] || 0) ||
    (a.email || '').localeCompare(b.email || ''));

  body.innerHTML = `
    <div class="stats" style="grid-template-columns:repeat(3,1fr)">
      <div class="stat"><div class="stat-value">${active.length}</div><div class="stat-label">Active</div></div>
      <div class="stat"><div class="stat-value">${owners.length}</div><div class="stat-label">Super admins</div></div>
      <div class="stat ${revoked.length ? 'warn' : ''}"><div class="stat-value">${revoked.length}</div><div class="stat-label">Revoked</div></div>
    </div>

    ${owners.length === 1 ? `<div class="alert warning">
      There is only <b>one Super Admin</b>. Promote a second one before revoking or demoting
      anybody — otherwise a single lost password locks everyone out of account management.
    </div>` : ''}

    ${users.length > 5 ? `<input type="search" id="usr-search" placeholder="Search by email…"
       value="${escapeHtml(_userSearch)}" style="margin-bottom:.75rem">` : ''}

    ${shown.map(u => renderUserCard(u, me)).join('') ||
      '<div class="empty"><i class="fa-solid fa-user-slash"></i>No account matches that search.</div>'}

    <div class="alert info" style="margin-top:1rem">
      <b>What "revoke" does.</b> The account keeps its record and history but can no longer sign
      in or see anything. This is the real removal — deleting the record would let them sign up
      again as a sevadar.<br><br>
      To delete the <b>login itself</b>, go to the Firebase Console →
      <b>Authentication → Users</b> and delete it there. A browser cannot do that.
    </div>`;

  const search = document.getElementById('usr-search');
  if (search) search.oninput = debounce(() => { _userSearch = search.value; loadUserPanel(); }, 250);
}

function renderUserCard(u, me) {
  const isMe = u.id === me;
  const rank = ROLE_RANK[u.role] || 0;

  return `
  <div class="user-card ${u.disabled ? 'revoked' : ''}">
    <div class="user-head">
      <div class="user-avatar ${u.disabled ? 'off' : ''}">
        <i class="fa-solid ${u.disabled ? 'fa-user-slash' : rank >= 3 ? 'fa-user-shield' : rank >= 2 ? 'fa-user-gear' : 'fa-user'}"></i>
      </div>
      <div style="flex:1; min-width:0">
        <div class="stop-name">${escapeHtml(u.email || u.name || 'Unknown')}
          ${isMe ? '<span class="pill grey">you</span>' : ''}</div>
        <div class="stop-sub">
          ${escapeHtml(ROLE_LABEL[u.role] || u.role || '—')}
          ${u.createdAtClient ? ' · joined ' + escapeHtml(fmtDateShort(u.createdAtClient)) : ''}
        </div>
        ${u.disabled ? `<div class="stop-sub" style="color:var(--color-danger)">
          Access revoked${u.disabledAt ? ' ' + escapeHtml(fmtAgo(u.disabledAt)) : ''}</div>` : ''}
      </div>
    </div>

    ${isMe ? `<p class="muted small" style="margin:.5rem 0 0">
      You cannot change your own role or revoke yourself — that is what stops an instance
      being left with no owner.</p>`
    : `
      <div class="user-actions">
        <select onchange="window.changeUserRole('${u.id}', this.value)" ${u.disabled ? 'disabled' : ''}>
          ${ROLES.map(r => `<option value="${r}" ${u.role === r ? 'selected' : ''}>${ROLE_LABEL[r]}</option>`).join('')}
        </select>
        ${u.disabled
          ? `<button class="btn sm" onclick="window.restoreUser('${u.id}')">
               <i class="fa-solid fa-rotate-left"></i> Restore</button>`
          : `<button class="btn sm danger-ghost" onclick="window.revokeUser('${u.id}')">
               <i class="fa-solid fa-ban"></i> Remove access</button>`}
      </div>`}
  </div>`;
}

/* ── ACTIONS ───────────────────────────────────────── */
window.changeUserRole = async function (uid, role) {
  const users = await DB.getUsers();
  const target = users.find(u => u.id === uid);

  // Promoting to owner hands over full control, including the ability to
  // revoke the person doing the promoting. Worth one deliberate pause.
  if (role === 'superAdmin' && target?.role !== 'superAdmin') {
    const ok = await confirmDialog({
      title: 'Make Super Admin?',
      message: `${target?.email || 'This account'} will be able to manage every account — including revoking yours. Only do this for someone you trust with the whole instance.`,
      confirmLabel: 'Make Super Admin'
    });
    if (!ok) return loadUserPanel();   // put the dropdown back
  }

  setBusy(true, 'Updating…');
  try {
    await DB.setUserRole(uid, role);
    showToast(`${target?.email || 'Account'} is now ${ROLE_LABEL[role]}`, 'success', 4000);
  } catch (e) {
    showToast(e.message, 'error', 7000);
  } finally {
    setBusy(false);
    await loadUserPanel();
  }
};

window.revokeUser = async function (uid) {
  const users = await DB.getUsers();
  const target = users.find(u => u.id === uid);

  const ok = await confirmDialog({
    title: 'Remove this account?',
    message: `${target?.email || 'This account'} will be signed out and locked out immediately. Their record and history are kept. You can restore them at any time.`,
    confirmLabel: 'Remove access', danger: true
  });
  if (!ok) return;

  setBusy(true, 'Removing…');
  try {
    await DB.setUserAccess(uid, true);
    showToast('Access removed', 'success');
  } catch (e) {
    showToast(e.message, 'error', 7000);
  } finally {
    setBusy(false);
    await loadUserPanel();
  }
};

window.restoreUser = async function (uid) {
  setBusy(true, 'Restoring…');
  try {
    await DB.setUserAccess(uid, false);
    showToast('Access restored', 'success');
  } catch (e) {
    showToast(e.message, 'error', 7000);
  } finally {
    setBusy(false);
    await loadUserPanel();
  }
};

window.openUserPanel = openUserPanel;
window.closeUserPanel = closeUserPanel;
window.loadUserPanel = loadUserPanel;
