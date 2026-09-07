/* ══ UI-CORE.JS – auth, roles, tabs, modals, toasts ══════════════════
   There is no date/meal filter bar in this model: the rotation is driven
   by completion, not by a calendar, so "which day is it" is never an
   input. Tabs re-render on the `rotationChanged` event instead.
═══════════════════════════════════════════════════════════════════════ */

// ── TOASTS ────────────────────────────────────────────
function showToast(message, type = 'info', ms = 3200) {
  const host = document.getElementById('toast-host');
  const icons = { success: 'fa-circle-check', error: 'fa-circle-exclamation',
                  warning: 'fa-triangle-exclamation', info: 'fa-circle-info' };
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `<i class="fa-solid ${icons[type] || icons.info}"></i><span>${escapeHtml(message)}</span>`;
  host.appendChild(el);
  setTimeout(() => el.remove(), ms);
}

function setBusy(on, text = 'Working…') {
  document.getElementById('busy-text').textContent = text;
  document.getElementById('busy').classList.toggle('hidden', !on);
}

// ── MODALS ────────────────────────────────────────────
function openModal(id, html) {
  const modal = document.getElementById(id);
  modal.querySelector('.modal-box').innerHTML = html;
  modal.classList.remove('hidden');
  modal.onclick = (e) => { if (e.target === modal) closeModal(id); };
}

function closeModal(id) {
  const modal = document.getElementById(id);
  modal.classList.add('hidden');
  modal.querySelector('.modal-box').innerHTML = '';
  if (AppState.mapPicker) { AppState.mapPicker.remove(); AppState.mapPicker = null; }
}

function confirmDialog({ title, message, confirmLabel = 'Confirm', danger = false }) {
  return new Promise(resolve => {
    openModal('confirm-modal', `
      <div class="modal-head"><h2>${escapeHtml(title)}</h2></div>
      <p>${escapeHtml(message)}</p>
      <div class="modal-foot">
        <button class="btn" id="cd-no">Cancel</button>
        <button class="btn ${danger ? 'danger' : 'primary'}" id="cd-yes">${escapeHtml(confirmLabel)}</button>
      </div>`);
    document.getElementById('cd-no').onclick  = () => { closeModal('confirm-modal'); resolve(false); };
    document.getElementById('cd-yes').onclick = () => { closeModal('confirm-modal'); resolve(true); };
  });
}

// ── MAP PIN PICKER ────────────────────────────────────
function openPinPicker({ title, lat, lng, onPick }) {
  const startLat = lat ?? AppState.settings.startPoint?.lat ?? 30.9010;
  const startLng = lng ?? AppState.settings.startPoint?.lng ?? 75.8573;
  const zoom = (lat && lng) ? 16 : 13;

  openModal('pin-modal', `
    <div class="modal-head">
      <h2>${escapeHtml(title)}</h2>
      <button class="icon-btn" onclick="closeModal('pin-modal')"><i class="fa-solid fa-xmark"></i></button>
    </div>
    <p class="muted small">Tap the map to place the pin. Drag it to fine-tune.</p>
    <div id="pin-map" class="map tall"></div>
    <div class="row" style="margin-top:.6rem">
      <div class="field" style="flex:1"><label>Latitude</label><input type="number" step="any" id="pin-lat" value="${startLat}"></div>
      <div class="field" style="flex:1"><label>Longitude</label><input type="number" step="any" id="pin-lng" value="${startLng}"></div>
    </div>
    <div class="modal-foot">
      <button class="btn" onclick="closeModal('pin-modal')">Cancel</button>
      <button class="btn primary" id="pin-save"><i class="fa-solid fa-check"></i> Use this location</button>
    </div>`);

  // Leaflet must measure a laid-out container, so defer a tick.
  setTimeout(() => {
    const map = L.map('pin-map').setView([startLat, startLng], zoom);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
                { attribution: '© OpenStreetMap', maxZoom: 19 }).addTo(map);
    const marker = L.marker([startLat, startLng], { draggable: true }).addTo(map);
    const sync = (ll) => {
      document.getElementById('pin-lat').value = ll.lat.toFixed(6);
      document.getElementById('pin-lng').value = ll.lng.toFixed(6);
    };
    map.on('click', e => { marker.setLatLng(e.latlng); sync(e.latlng); });
    marker.on('dragend', () => sync(marker.getLatLng()));
    AppState.mapPicker = map;
    map.invalidateSize();
  }, 60);

  document.getElementById('pin-save').onclick = () => {
    const la = parseFloat(document.getElementById('pin-lat').value);
    const ln = parseFloat(document.getElementById('pin-lng').value);
    if (Number.isNaN(la) || Number.isNaN(ln)) return showToast('Enter a valid latitude and longitude', 'error');
    closeModal('pin-modal');
    onPick({ lat: la, lng: ln });
  };
}

// ── TABS ──────────────────────────────────────────────
const TAB_LOADERS = {
  checklist: () => window.loadChecklist && window.loadChecklist(),
  rotation:  () => window.loadRotation && window.loadRotation(),
  devotees:  () => window.loadDevotees && window.loadDevotees(),
  config:    () => window.loadConfig && window.loadConfig(),
  reports:   () => window.loadReports && window.loadReports()
};

function switchTab(name) {
  AppState.currentTab = name;
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
  document.querySelectorAll('.tabpanel').forEach(p => p.classList.add('hidden'));
  document.getElementById(`tab-${name}`).classList.remove('hidden');

  const loader = TAB_LOADERS[name];
  if (loader) return Promise.resolve(loader()).catch(e => {
    console.error(`[SevaRoute] tab ${name} failed`, e);
    showToast('Could not load this tab', 'error');
  });
}

// When the rotation advances, every open screen is stale.
function fireRotationChanged() {
  document.dispatchEvent(new CustomEvent('rotationChanged'));
}
document.addEventListener('rotationChanged', () => {
  const loader = TAB_LOADERS[AppState.currentTab];
  if (loader) Promise.resolve(loader()).catch(e => console.error('[SevaRoute] reload failed', e));
});

// ── ROLE-GATED UI ─────────────────────────────────────
function applyRoleUI() {
  document.getElementById('user-role-badge').textContent = ROLE_LABEL[AppState.userRole] || '';
  // Account management is an owner-only concern, so the hamburger only
  // exists for them rather than appearing and then refusing to work.
  document.getElementById('btn-users').classList.toggle('hidden', !hasRole('superAdmin'));
  document.getElementById('topbar-sub').textContent = AppState.userName || 'Prasadam Coverage';

  let firstVisible = null;
  document.querySelectorAll('.tab').forEach(tab => {
    const show = hasRole(tab.dataset.minRole);
    tab.classList.toggle('hidden', !show);
    if (show && !firstVisible) firstVisible = tab.dataset.tab;
  });

  // A sevadar's whole job is the open checklist, so that is where they
  // land. Admins land on the rotation dashboard. A home-screen shortcut
  // (#checklist / #rotation) overrides both, but only if the role allows it.
  let preferred = hasRole('admin') ? 'rotation' : 'checklist';
  const wanted = window._pendingTab;
  if (wanted && TAB_LOADERS[wanted]) {
    const tab = document.querySelector(`.tab[data-tab="${wanted}"]`);
    if (tab && !tab.classList.contains('hidden')) preferred = wanted;
  }
  window._pendingTab = null;
  switchTab(preferred || firstVisible || 'checklist');
}

// ── BOOTSTRAP ─────────────────────────────────────────
async function loadBootstrap() {
  const [settings, areas, rotation] = await Promise.all([
    DB.getSettings(), DB.getAreas(true), Rotation.getState()
  ]);
  AppState.settings = settings;
  AppState.areas = areas;
  AppState.rotation = rotation;
}

// ── AUTH ──────────────────────────────────────────────
let authMode = 'signin';

function wireAuth() {
  const emailEl = document.getElementById('auth-email');
  const passEl  = document.getElementById('auth-password');
  const errEl   = document.getElementById('auth-error');
  const submit  = document.getElementById('auth-submit');
  const toggle  = document.getElementById('auth-toggle');

  const showError = (msg) => { errEl.textContent = msg; errEl.classList.remove('hidden'); };
  const clearError = () => errEl.classList.add('hidden');

  // Reveal toggle. Flipping input.type keeps the browser's own password
  // manager working, which swapping the element would break.
  const pwToggle = document.getElementById('auth-password-toggle');
  pwToggle.onclick = () => {
    const nowVisible = passEl.type === 'password';
    passEl.type = nowVisible ? 'text' : 'password';
    pwToggle.innerHTML = `<i class="fa-solid ${nowVisible ? 'fa-eye-slash' : 'fa-eye'}"></i>`;
    pwToggle.setAttribute('aria-pressed', String(nowVisible));
    pwToggle.setAttribute('aria-label', nowVisible ? 'Hide password' : 'Show password');
    pwToggle.title = nowVisible ? 'Hide password' : 'Show password';
    const end = passEl.value.length;
    passEl.focus();
    try { passEl.setSelectionRange(end, end); } catch { /* not supported everywhere */ }
  };

  toggle.onclick = () => {
    authMode = authMode === 'signin' ? 'signup' : 'signin';
    submit.querySelector('span').textContent = authMode === 'signin' ? 'Sign In' : 'Create Account';
    toggle.textContent = authMode === 'signin' ? 'Create an account instead' : 'I already have an account';
    passEl.autocomplete = authMode === 'signin' ? 'current-password' : 'new-password';
    clearError();
  };

  submit.onclick = async () => {
    const email = emailEl.value.trim();
    const password = passEl.value;
    if (!email || !password) return showError('Enter both email and password.');
    if (authMode === 'signup' && password.length < 6) return showError('Password must be at least 6 characters.');

    clearError();
    submit.disabled = true;
    try {
      if (authMode === 'signin') await firebase.auth().signInWithEmailAndPassword(email, password);
      else await firebase.auth().createUserWithEmailAndPassword(email, password);
    } catch (e) {
      // Firebase's raw codes are developer-facing; translate the common ones.
      const map = {
        'auth/invalid-email':          'That email address does not look right.',
        'auth/user-not-found':         'No account with that email. Create one instead?',
        'auth/wrong-password':         'Incorrect password.',
        'auth/invalid-credential':     'Email or password is incorrect.',
        'auth/email-already-in-use':   'That email already has an account. Sign in instead.',
        'auth/weak-password':          'Please choose a longer password.',
        'auth/network-request-failed': 'No connection. Check your internet and try again.',
        'auth/too-many-requests':      'Too many attempts. Wait a moment and try again.',
        'auth/configuration-not-found':
          'Email/Password sign-in is not switched on for this Firebase project yet. ' +
          'In the Firebase Console: Build → Authentication → Get started → ' +
          'Sign-in method → Email/Password → Enable → Save. Then try again.',
        'auth/operation-not-allowed':
          'Email/Password sign-in is disabled for this Firebase project. ' +
          'Enable it under Authentication → Sign-in method.',
        'auth/unauthorized-domain':
          'This domain is not authorised for sign-in. Add it under ' +
          'Authentication → Settings → Authorized domains.'
      };
      showError(map[e.code] || `${e.message} (${e.code || 'unknown'})`);
    } finally {
      submit.disabled = false;
    }
  };

  passEl.onkeydown = (e) => { if (e.key === 'Enter') submit.click(); };
  document.getElementById('btn-signout').onclick = async () => {
    if (await confirmDialog({ title: 'Sign out?', message: 'You will need to sign in again.', confirmLabel: 'Sign out' })) {
      await firebase.auth().signOut();
      location.reload();
    }
  };
}

// ── ENTRY POINT ───────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  if (!IS_CONFIGURED) {
    document.getElementById('setup-screen').classList.remove('hidden');
    return;
  }

  wireAuth();
  document.querySelectorAll('.tab').forEach(tab => { tab.onclick = () => switchTab(tab.dataset.tab); });

  // Esc closes the drawer, like every other dismissible surface.
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const drawer = document.getElementById('user-drawer');
    if (drawer && !drawer.classList.contains('hidden')) window.closeUserPanel();
  });

  firebase.auth().onAuthStateChanged(async (user) => {
    const authScreen = document.getElementById('auth-screen');
    const app = document.getElementById('app');

    if (!user) {
      authScreen.classList.remove('hidden');
      app.classList.add('hidden');
      return;
    }

    setBusy(true, 'Loading…');
    try {
      const profile = await DB.ensureUserProfile(user);

      // A revoked account keeps its record so history survives, but must not
      // get past this point. The rules deny it everything anyway; this is the
      // difference between a clear message and a screen full of errors.
      if (profile.disabled) {
        await firebase.auth().signOut();
        setBusy(false);
        authScreen.classList.remove('hidden');
        app.classList.add('hidden');
        const err = document.getElementById('auth-error');
        err.textContent = 'This account no longer has access. Ask a Super Admin to restore it.';
        err.classList.remove('hidden');
        return;
      }

      AppState.user = user;
      AppState.userRole = profile.role;
      AppState.userName = profile.name || user.email;

      await loadBootstrap();

      authScreen.classList.add('hidden');
      app.classList.remove('hidden');
      applyRoleUI();
    } catch (e) {
      console.error('[SevaRoute] startup failed', e);
      showToast('Could not load your profile: ' + e.message, 'error', 7000);
    } finally {
      setBusy(false);
    }
  });
});

window.showToast = showToast;
window.setBusy = setBusy;
window.openModal = openModal;
window.closeModal = closeModal;
window.confirmDialog = confirmDialog;
window.openPinPicker = openPinPicker;
window.switchTab = switchTab;
window.loadBootstrap = loadBootstrap;
window.fireRotationChanged = fireRotationChanged;
window.applyRoleUI = applyRoleUI;
