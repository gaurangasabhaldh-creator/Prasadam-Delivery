/* ══ DB.JS – Firestore wrapper ═══════════════════════════════════════
   Collections
     users/{uid}              role, name
     devotees/{id}            directory + rotation progress
     areas/{id}               name, sequencePosition, batchGroup
     settings/app             start point, thresholds
     settings/rotation        the open batch (see rotation.js)
     settings/bootstrap       write-once ownership marker
     rounds/{round}_{batch}   closed-batch history
     coverageLog/{id}         immutable "seva record" (PRD §6)
     auditLog/{id}            who changed what

   Conventions: soft delete only (isActive:false), dual timestamps
   (server + client ISO), batches capped at 400 docs.
═══════════════════════════════════════════════════════════════════════ */

const BATCH_LIMIT = 400;

const DB = {

  stamp(extra = {}) {
    return {
      ...extra,
      updatedAt: TS(),
      updatedAtClient: new Date().toISOString(),
      updatedBy: AppState.user ? AppState.user.uid : 'system'
    };
  },

  stampNew(extra = {}) {
    return {
      ...this.stamp(extra),
      createdAt: TS(),
      createdAtClient: new Date().toISOString(),
      createdBy: AppState.user ? AppState.user.uid : 'system',
      isActive: true
    };
  },

  async audit(action, entity, entityId, details = {}) {
    try {
      await fdb.collection('auditLog').add({
        action, entity, entityId, details,
        userId: AppState.user ? AppState.user.uid : 'system',
        userName: AppState.userName || '',
        at: TS(), atClient: new Date().toISOString()
      });
    } catch (e) {
      console.warn('[SevaRoute] audit write failed', e);   // never block the real write
    }
  },

  // ── USERS ───────────────────────────────────────────
  async ensureUserProfile(user) {
    const ref = fdb.collection('users').doc(user.uid);
    const snap = await ref.get();
    if (snap.exists) return { id: snap.id, ...snap.data() };

    // "Am I the first account?" must NOT be a query over users: security
    // rules evaluate a list query without knowing which documents it will
    // return, so a rule scoping users to their own document can never
    // authorise one — and the first user has no role to fall back on.
    // A marker document answers it with a plain get, which rules can allow.
    const bootstrapRef = fdb.collection('settings').doc('bootstrap');
    const bootstrap = await bootstrapRef.get();
    const isFirstAccount = !bootstrap.exists;

    const profile = {
      ...this.stampNew({
        email: user.email,
        name: user.displayName || (user.email || '').split('@')[0],
        role: isFirstAccount ? 'superAdmin' : 'sevadar'
      }),
      createdBy: user.uid,
      updatedBy: user.uid
    };

    if (isFirstAccount) {
      // Claim ownership and create the profile atomically; rules evaluate
      // against pre-batch state so the "unclaimed" check still passes.
      const batch = fdb.batch();
      batch.set(ref, profile);
      batch.set(bootstrapRef, {
        claimed: true, ownerUid: user.uid, ownerEmail: user.email || '',
        claimedAt: TS(), claimedAtClient: new Date().toISOString()
      });
      await batch.commit();
    } else {
      await ref.set(profile);
    }

    await this.audit('user.create', 'user', user.uid, { role: profile.role, isFirstAccount });
    return { id: user.uid, ...profile };
  },

  async getUsers() {
    const snap = await fdb.collection('users').get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  },

  /* ── ACCOUNT MANAGEMENT (super admin only) ─────────
     Note on "removing" someone: deleting their users/{uid} document does
     NOT remove them. The Firebase Auth login still exists, they can sign
     in again, and ensureUserProfile() would simply recreate the profile
     as a sevadar — quietly handing back access.

     So removal here means REVOKING: the profile stays, marked disabled,
     and the security rules give a disabled account rank 0, which denies
     everything. That survives a re-login, which a delete would not.

     Deleting the Auth login itself needs the Admin SDK (server-side) and
     is impossible from a browser — it is done in the Firebase Console.   */

  async setUserRole(uid, role) {
    if (!ROLES.includes(role)) throw new Error('Unknown role');
    if (uid === (AppState.user && AppState.user.uid)) {
      throw new Error('You cannot change your own role');
    }
    const users = await this.getUsers();
    const target = users.find(u => u.id === uid);
    if (!target) throw new Error('Account not found');

    // Never let the last owner be demoted — that locks everybody out of
    // account management permanently, with no way back from inside the app.
    if (target.role === 'superAdmin' && role !== 'superAdmin') {
      const owners = users.filter(u => u.role === 'superAdmin' && !u.disabled);
      if (owners.length <= 1) throw new Error('This is the only Super Admin — promote someone else first');
    }

    await fdb.collection('users').doc(uid).update(this.stamp({ role }));
    await this.audit('user.role', 'user', uid, { role, from: target.role, email: target.email || '' });
  },

  async setUserAccess(uid, disabled) {
    if (uid === (AppState.user && AppState.user.uid)) {
      throw new Error('You cannot revoke your own access');
    }
    const users = await this.getUsers();
    const target = users.find(u => u.id === uid);
    if (!target) throw new Error('Account not found');

    if (disabled && target.role === 'superAdmin') {
      const owners = users.filter(u => u.role === 'superAdmin' && !u.disabled);
      if (owners.length <= 1) throw new Error('This is the only Super Admin — promote someone else first');
    }

    await fdb.collection('users').doc(uid).update(this.stamp({
      disabled: !!disabled,
      disabledAt: disabled ? new Date().toISOString() : null,
      disabledBy: disabled ? (AppState.user ? AppState.user.uid : 'system') : null
    }));
    await this.audit(disabled ? 'user.revoke' : 'user.restore', 'user', uid,
                     { email: target.email || '', role: target.role });
  },

  // ── SETTINGS ────────────────────────────────────────
  async getSettings() {
    const snap = await fdb.collection('settings').doc('app').get();
    return snap.exists ? { ...DEFAULT_SETTINGS, ...snap.data() } : { ...DEFAULT_SETTINGS };
  },

  async saveSettings(patch) {
    await fdb.collection('settings').doc('app').set(this.stamp(patch), { merge: true });
    AppState.settings = { ...AppState.settings, ...patch };
    await this.audit('settings.update', 'settings', 'app', patch);
  },

  // ── AREAS ───────────────────────────────────────────
  async getAreas(force = false) {
    if (!force && cacheValid(AreaCache)) return AreaCache.data;
    const snap = await fdb.collection('areas').where('isActive', '==', true).get();
    const areas = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (a.sequencePosition ?? 9999) - (b.sequencePosition ?? 9999) ||
                      (a.name || '').localeCompare(b.name || ''));
    return cacheSet(AreaCache, areas);
  },

  async saveArea(area) {
    const payload = {
      name: (area.name || '').trim(),
      city: area.city || '',
      batchGroup: (area.batchGroup || '').trim() || null,
      sequencePosition: area.sequencePosition ?? 9999
    };
    if (area.id) {
      await fdb.collection('areas').doc(area.id).update(this.stamp(payload));
      await this.audit('area.update', 'area', area.id, payload);
      AreaCache.data = null;
      return area.id;
    }
    // New areas join at the end of the sequence by default (PRD §5.3).
    if (area.sequencePosition === undefined || area.sequencePosition === null) {
      const existing = await this.getAreas(true);
      payload.sequencePosition = existing.reduce((m, a) => Math.max(m, a.sequencePosition ?? 0), 0) + 1;
    }
    const ref = await fdb.collection('areas').add(this.stampNew(payload));
    await this.audit('area.create', 'area', ref.id, payload);
    AreaCache.data = null;
    return ref.id;
  },

  // Persists a whole reordering in one batch so the sequence can never be
  // left half-renumbered.
  async saveSequence(orderedAreaIds) {
    const batch = fdb.batch();
    orderedAreaIds.forEach((id, i) => {
      batch.update(fdb.collection('areas').doc(id), this.stamp({ sequencePosition: i + 1 }));
    });
    await batch.commit();
    await this.audit('area.reorder', 'area', 'sequence', { count: orderedAreaIds.length });
    AreaCache.data = null;
  },

  async deleteArea(areaId) {
    const affected = await fdb.collection('devotees').where('areaId', '==', areaId).get();
    let batch = fdb.batch(), n = 0;
    for (const doc of affected.docs) {
      batch.update(doc.ref, this.stamp({ areaId: null }));
      if (++n >= BATCH_LIMIT) { await batch.commit(); batch = fdb.batch(); n = 0; }
    }
    batch.update(fdb.collection('areas').doc(areaId), this.stamp({ isActive: false }));
    await batch.commit();
    await this.audit('area.delete', 'area', areaId, { devoteesUnlinked: affected.size });
    cacheBust();
  },

  // Imported spreadsheets spawn "Field Ganj" and "Field ganj " constantly.
  async mergeAreas(sourceIds, targetId) {
    let moved = 0;
    for (const sid of sourceIds) {
      if (sid === targetId) continue;
      const affected = await fdb.collection('devotees').where('areaId', '==', sid).get();
      let batch = fdb.batch(), n = 0;
      for (const doc of affected.docs) {
        batch.update(doc.ref, this.stamp({ areaId: targetId }));
        moved++;
        if (++n >= BATCH_LIMIT) { await batch.commit(); batch = fdb.batch(); n = 0; }
      }
      batch.update(fdb.collection('areas').doc(sid), this.stamp({ isActive: false }));
      await batch.commit();
    }
    await this.audit('area.merge', 'area', targetId, { sourceIds, devoteesMoved: moved });
    cacheBust();
    return moved;
  },

  // ── DEVOTEES ────────────────────────────────────────
  async getDevotees(force = false) {
    if (!force && cacheValid(DevoteeCache)) return DevoteeCache.data;
    const snap = await fdb.collection('devotees').where('isActive', '==', true).get();
    const list = snap.docs.map(d => ({ id: d.id, ...d.data() }))
                          .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    return cacheSet(DevoteeCache, list);
  },

  async getDevotee(id) {
    const snap = await fdb.collection('devotees').doc(id).get();
    return snap.exists ? { id: snap.id, ...snap.data() } : null;
  },

  async saveDevotee(devotee) {
    const payload = {
      name: (devotee.name || '').trim(),
      phone: normalizePhone(devotee.phone),
      addressText: (devotee.addressText || '').trim(),
      lat: devotee.lat ?? null,
      lng: devotee.lng ?? null,
      geocodeStatus: devotee.geocodeStatus || (hasCoords(devotee) ? 'ok' : 'pending'),
      // The Google Maps link the coordinator pasted. Kept verbatim even when
      // coordinates were extracted from it, so the original is never lost.
      mapsUrl: (devotee.mapsUrl || '').trim(),
      // Which offering this devotee receives; '' means not assigned yet.
      bhoga: BHOGA_TYPES[devotee.bhoga] ? devotee.bhoga : '',
      areaId: devotee.areaId || null,
      status: devotee.status || 'active',
      notes: devotee.notes || ''
    };

    if (devotee.id) {
      const before = await this.getDevotee(devotee.id);
      await fdb.collection('devotees').doc(devotee.id).update(this.stamp(payload));
      const changed = {};
      Object.keys(payload).forEach(k => {
        if (JSON.stringify(before?.[k]) !== JSON.stringify(payload[k])) {
          changed[k] = { from: before?.[k] ?? null, to: payload[k] };
        }
      });
      if (Object.keys(changed).length) {
        await fdb.collection('devotees').doc(devotee.id).collection('profileChanges').add({
          changed, at: TS(), atClient: new Date().toISOString(),
          by: AppState.user ? AppState.user.uid : 'system'
        });
      }
      cacheBust();
      return devotee.id;
    }

    // A brand-new devotee starts un-served. If their area's batch happens
    // to be open right now they appear on the live checklist immediately;
    // otherwise they wait for it to reopen (PRD §5.3). Both fall out of
    // the servedInRound model with no extra bookkeeping.
    const ref = await fdb.collection('devotees').add(this.stampNew({
      ...payload,
      servedInRound: null,
      lastServedAt: null,
      timesServed: 0,
      carriedForwardFrom: null
    }));
    await this.audit('devotee.create', 'devotee', ref.id, { name: payload.name });
    cacheBust();
    return ref.id;
  },

  async setDevoteeStatus(id, status) {
    await fdb.collection('devotees').doc(id).update(this.stamp({ status }));
    await this.audit('devotee.status', 'devotee', id, { status });
    cacheBust();
  },

  async deleteDevotee(id) {
    await fdb.collection('devotees').doc(id).update(this.stamp({ isActive: false }));
    await this.audit('devotee.delete', 'devotee', id, {});
    cacheBust();
  },

  async bulkSaveDevotees(rows) {
    let saved = 0;
    for (let i = 0; i < rows.length; i += BATCH_LIMIT) {
      const batch = fdb.batch();
      rows.slice(i, i + BATCH_LIMIT).forEach(row => {
        const ref = row.id ? fdb.collection('devotees').doc(row.id) : fdb.collection('devotees').doc();
        batch.set(ref, row.id ? this.stamp(row.data) : this.stampNew({
          ...row.data, servedInRound: null, lastServedAt: null, timesServed: 0, carriedForwardFrom: null
        }), { merge: true });
        saved++;
      });
      await batch.commit();
    }
    await this.audit('devotee.bulkImport', 'devotee', 'bulk', { count: saved });
    cacheBust();
    return saved;
  },

  async saveGeocode(id, lat, lng, status = 'ok', formatted = '') {
    await fdb.collection('devotees').doc(id).update(this.stamp({
      lat, lng, geocodeStatus: status,
      geocodedAddress: formatted || null,
      geocodedAt: new Date().toISOString()
    }));
    cacheBust();
  },

  // ── HISTORY ─────────────────────────────────────────
  async getRounds(limit = 100) {
    const snap = await fdb.collection('rounds').orderBy('closedAtClient', 'desc').limit(limit).get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  },

  async getCoverageForDevotee(devoteeId, limit = 50) {
    // Ordering is applied client-side so this needs no composite index —
    // a devotee's own history is small enough that it costs nothing.
    const snap = await fdb.collection('coverageLog')
      .where('devoteeId', '==', devoteeId).limit(limit).get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => String(b.servedAtClient || '').localeCompare(String(a.servedAtClient || '')));
  },

  async getRecentCoverage(limit = 200) {
    const snap = await fdb.collection('coverageLog')
      .orderBy('servedAtClient', 'desc').limit(limit).get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  }
};

window.DB = DB;
