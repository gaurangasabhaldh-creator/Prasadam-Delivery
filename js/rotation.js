/* ══ ROTATION.JS – the coverage state machine (PRD §5, §7.3) ═════════

   The core guarantee: advancement is driven by COMPLETION, never by a
   calendar. A batch stays open until every active devotee in it is
   accounted for, so an area cannot silently be skipped.

   Sequence:  A → B → (C+D) → E → … → M → back to A as Round 2

   Two design decisions worth stating up front:

   1. A devotee's progress is stored as `servedInRound` (a number), not a
      pending/served boolean. "Pending" means servedInRound !== the round
      currently open. That makes starting a new round a single write to
      one document instead of resetting 600 devotee records, and it makes
      the full history trivially reconstructible.

   2. Advancing is a COMPARE-AND-SET on the single state document. The
      Firestore client SDK cannot run a query inside a transaction, so
      "is the batch finished?" cannot be answered atomically alongside the
      write. Instead the two steps are separated:

        a. marking one devotee served is its own transaction — atomic and
           idempotent, so a double-tap or a replayed offline write cannot
           inflate timesServed;
        b. advancing re-reads the state inside a transaction and only
           commits if the batch and round are still the ones we measured.

      Two sevadars finishing the last two devotees at the same instant may
      both decide the batch is done, but only one CAS can win — the other
      sees the state has moved and stands down. This also self-heals: if a
      client dies between (a) and (b), the next checklist load completes
      the advance, so a finished batch can never sit open forever.
═══════════════════════════════════════════════════════════════════════ */

const Rotation = {

  STATE_DOC: 'rotation',   // settings/rotation — the single source of truth

  _ref() {
    return fdb.collection('settings').doc(this.STATE_DOC);
  },

  /* ── STATE ─────────────────────────────────────────
     { roundNumber, batchKey, areaIds, label, openedAt, openedAtClient,
       startedBy, sequenceVersion }                                     */
  async getState() {
    const snap = await this._ref().get();
    return snap.exists ? snap.data() : null;
  },

  // Starts the rotation at the first batch of the sequence. Safe to call
  // when already running — it refuses rather than silently resetting
  // progress, which would wipe a round's work.
  async start(areas, { force = false } = {}) {
    const sequence = buildSequence(areas);
    if (!sequence.length) throw new Error('Add at least one area before starting the rotation');

    const existing = await this.getState();
    if (existing && !force) return existing;

    const first = sequence[0];
    const state = {
      roundNumber: 1,
      batchKey: first.key,
      areaIds: first.areaIds,
      label: first.label,
      openedAt: TS(),
      openedAtClient: new Date().toISOString(),
      startedBy: AppState.user ? AppState.user.uid : 'system'
    };
    await this._ref().set(state);
    await DB.audit('rotation.start', 'rotation', first.key, { roundNumber: 1, label: first.label });
    return state;
  },

  // The devotees on the currently open checklist, with their status for
  // THIS round resolved. Paused devotees are excluded from the checklist
  // and from the completion count (PRD §11).
  buildChecklist(devotees, state) {
    if (!state) return { pending: [], served: [], paused: [], total: 0, doneCount: 0, complete: false };

    const inBatch = (devotees || []).filter(d => state.areaIds.includes(d.areaId));
    const active = inBatch.filter(isActiveDevotee);
    const paused = inBatch.filter(d => d.isActive !== false && d.status === 'paused');

    const served = active.filter(d => isServedInRound(d, state.roundNumber));
    const pending = active.filter(d => !isServedInRound(d, state.roundNumber));

    // Anyone carried forward from a force-close comes first — the PRD is
    // explicit that they must be prioritised, not merely remembered.
    pending.sort((a, b) => {
      const ac = a.carriedForwardFrom ? 0 : 1;
      const bc = b.carriedForwardFrom ? 0 : 1;
      return ac - bc || (a.name || '').localeCompare(b.name || '');
    });

    return {
      pending, served, paused,
      total: active.length,
      doneCount: served.length,
      // An empty batch counts as complete, otherwise a area with only
      // paused devotees would wedge the rotation forever.
      complete: active.length === 0 || pending.length === 0
    };
  },

  /* ── MARK SERVED ───────────────────────────────────
     Writes the devotee's progress, appends an immutable coverage log
     entry, and — in the same transaction — advances the rotation if that
     tick completed the batch.                                          */
  async markServed(devoteeId, { note = '', lat = null, lng = null } = {}) {
    const areas = await DB.getAreas(true);
    const sequence = buildSequence(areas);

    const devoteeRef = fdb.collection('devotees').doc(devoteeId);
    const stateRef = this._ref();
    const logRef = fdb.collection('coverageLog').doc();

    // Step (a): record this one serve, atomically and idempotently.
    await fdb.runTransaction(async (tx) => {
      const [stateSnap, devoteeSnap] = await Promise.all([tx.get(stateRef), tx.get(devoteeRef)]);
      if (!stateSnap.exists) throw new Error('Rotation has not been started yet');
      if (!devoteeSnap.exists) throw new Error('Devotee not found');

      const state = stateSnap.data();
      const devotee = { id: devoteeSnap.id, ...devoteeSnap.data() };

      if (!state.areaIds.includes(devotee.areaId)) {
        throw new Error(`${devotee.name} is not in the area that is currently open`);
      }
      // Idempotent: a double-tap, or an offline write replayed on
      // reconnect, must not inflate timesServed.
      if (isServedInRound(devotee, state.roundNumber)) return;

      tx.update(devoteeRef, {
        servedInRound: state.roundNumber,
        lastServedAt: new Date().toISOString(),
        lastServedAreaId: devotee.areaId,
        timesServed: (devotee.timesServed || 0) + 1,
        carriedForwardFrom: null,          // clearing the missed flag
        updatedAt: TS(),
        updatedAtClient: new Date().toISOString(),
        updatedBy: AppState.user ? AppState.user.uid : 'system'
      });

      tx.set(logRef, {
        devoteeId, devoteeName: devotee.name || '',
        areaId: devotee.areaId,
        roundNumber: state.roundNumber,
        batchKey: state.batchKey,
        servedAt: TS(),
        servedAtClient: new Date().toISOString(),
        servedBy: AppState.user ? AppState.user.uid : 'system',
        servedByName: AppState.userName || '',
        note: note || '',
        lat, lng
      });

    });

    cacheBust();
    // Step (b): did that finish the batch? Guarded by compare-and-set.
    return this.advanceIfComplete();
  },

  /* ── ADVANCE IF COMPLETE (compare-and-set) ─────────
     Safe to call at any time and from anywhere: it does nothing unless the
     open batch really is finished, and it cannot double-advance. Called
     after every serve, and again whenever the checklist loads, so a batch
     left finished-but-open by a crashed client heals itself.

     `steps` chains through consecutive empty batches — an area whose
     devotees are all paused is complete on sight — while the cap stops an
     all-empty sequence from spinning forever.                            */
  async advanceIfComplete(steps = 0) {
    if (steps > 25) return null;

    const [areas, devotees, state] = await Promise.all([
      DB.getAreas(true), DB.getDevotees(true), this.getState()
    ]);
    if (!state) return null;

    const checklist = this.buildChecklist(devotees, state);
    if (!checklist.complete) return null;

    const advanced = this._nextState(state, buildSequence(areas));
    let committed = false;

    await fdb.runTransaction(async (tx) => {
      const snap = await tx.get(this._ref());
      const live = snap.exists ? snap.data() : null;
      // If another sevadar already moved this batch on, stand down.
      if (!live || live.batchKey !== state.batchKey || live.roundNumber !== state.roundNumber) return;

      tx.set(this._ref(), advanced.state);
      tx.set(fdb.collection('rounds').doc(`${state.roundNumber}_${state.batchKey}`), {
        roundNumber: state.roundNumber,
        batchKey: state.batchKey,
        areaIds: state.areaIds,
        label: state.label || '',
        openedAtClient: state.openedAtClient || null,
        closedAt: TS(),
        closedAtClient: new Date().toISOString(),
        forceClosed: false,
        servedCount: checklist.doneCount,
        missedCount: 0,
        missedDevoteeIds: [],
        closedBy: AppState.user ? AppState.user.uid : 'system'
      });
      committed = true;
    });

    if (!committed) return null;

    await DB.audit('rotation.advance', 'rotation', advanced.state.batchKey, {
      from: advanced.from, to: advanced.state.label,
      roundNumber: advanced.state.roundNumber, wrapped: advanced.wrapped
    });
    cacheBust();

    // The batch we just opened may itself be empty; keep going, but report
    // the ORIGINAL hand-off so the sevadar is told what they finished.
    const further = await this.advanceIfComplete(steps + 1);
    return further ? { ...further, from: advanced.from, wrapped: advanced.wrapped || further.wrapped } : advanced;
  },

  // Pure: given the open state and the sequence, what opens next?
  // Falling off the end wraps to the first batch and increments the round.
  _nextState(state, sequence) {
    const idx = sequence.findIndex(b => b.key === state.batchKey);
    const isLast = idx === -1 || idx >= sequence.length - 1;
    const next = isLast ? sequence[0] : sequence[idx + 1];
    const roundNumber = isLast ? (state.roundNumber || 1) + 1 : (state.roundNumber || 1);

    return {
      from: state.label || state.batchKey,
      wrapped: isLast,
      state: {
        roundNumber,
        batchKey: next.key,
        areaIds: next.areaIds,
        label: next.label,
        openedAt: TS(),
        openedAtClient: new Date().toISOString(),
        startedBy: AppState.user ? AppState.user.uid : 'system'
      }
    };
  },

  /* ── UNDO ──────────────────────────────────────────
     A mis-tap on someone's name is easy and the consequence — a devotee
     recorded as served who wasn't — is exactly what this app exists to
     prevent. Only allowed while their batch is still open.             */
  async undoServed(devoteeId) {
    const state = await this.getState();
    if (!state) throw new Error('Rotation has not been started');

    const devotee = await DB.getDevotee(devoteeId);
    if (!devotee) throw new Error('Devotee not found');
    if (!state.areaIds.includes(devotee.areaId)) {
      throw new Error('That area is no longer open — the entry is part of a closed round');
    }
    if (!isServedInRound(devotee, state.roundNumber)) return;

    await fdb.collection('devotees').doc(devoteeId).update({
      servedInRound: null,
      timesServed: Math.max(0, (devotee.timesServed || 1) - 1),
      updatedAt: TS(),
      updatedAtClient: new Date().toISOString(),
      updatedBy: AppState.user ? AppState.user.uid : 'system'
    });

    // The coverage log is an audit trail, so the original entry stays and
    // a reversal is appended rather than deleting history.
    await fdb.collection('coverageLog').add({
      devoteeId, devoteeName: devotee.name || '',
      areaId: devotee.areaId, roundNumber: state.roundNumber,
      batchKey: state.batchKey, reversal: true,
      servedAt: TS(), servedAtClient: new Date().toISOString(),
      servedBy: AppState.user ? AppState.user.uid : 'system',
      servedByName: AppState.userName || '',
      note: 'Marked served in error — reversed'
    });

    await DB.audit('rotation.undo', 'devotee', devoteeId, { roundNumber: state.roundNumber });
    cacheBust();
  },

  /* ── FORCE CLOSE (PRD §5.4) ────────────────────────
     Real life: someone is travelling or unreachable. The admin may close
     early, but whoever was missed is recorded and flagged so they are
     prioritised when the area next opens — never silently dropped.     */
  async forceClose(reason = '') {
    const [areas, devotees] = await Promise.all([DB.getAreas(true), DB.getDevotees(true)]);
    const state = await this.getState();
    if (!state) throw new Error('Rotation has not been started');

    const sequence = buildSequence(areas);
    const checklist = this.buildChecklist(devotees, state);
    const missed = checklist.pending;

    const batch = fdb.batch();

    missed.forEach(d => {
      batch.update(fdb.collection('devotees').doc(d.id), {
        carriedForwardFrom: state.roundNumber,
        updatedAt: TS(),
        updatedAtClient: new Date().toISOString(),
        updatedBy: AppState.user ? AppState.user.uid : 'system'
      });
    });

    batch.set(fdb.collection('rounds').doc(`${state.roundNumber}_${state.batchKey}`), {
      roundNumber: state.roundNumber,
      batchKey: state.batchKey,
      areaIds: state.areaIds,
      label: state.label || '',
      openedAtClient: state.openedAtClient || null,
      closedAt: TS(),
      closedAtClient: new Date().toISOString(),
      forceClosed: true,
      reason: reason || '',
      servedCount: checklist.doneCount,
      missedCount: missed.length,
      missedDevoteeIds: missed.map(d => d.id),
      missedDevoteeNames: missed.map(d => d.name || ''),
      closedBy: AppState.user ? AppState.user.uid : 'system'
    });

    const advanced = this._nextState(state, sequence);
    batch.set(this._ref(), advanced.state);

    await batch.commit();
    await DB.audit('rotation.forceClose', 'rotation', state.batchKey, {
      missed: missed.length, reason, to: advanced.state.label
    });
    cacheBust();
    return { advanced, missed };
  },

  // Admin jump — for correcting a mistake, not routine use.
  async openBatch(batchKey, roundNumber = null) {
    const areas = await DB.getAreas(true);
    const sequence = buildSequence(areas);
    const target = sequence.find(b => b.key === batchKey);
    if (!target) throw new Error('That batch is not in the sequence');

    const current = await this.getState();
    const state = {
      roundNumber: roundNumber ?? current?.roundNumber ?? 1,
      batchKey: target.key,
      areaIds: target.areaIds,
      label: target.label,
      openedAt: TS(),
      openedAtClient: new Date().toISOString(),
      startedBy: AppState.user ? AppState.user.uid : 'system'
    };
    await this._ref().set(state);
    await DB.audit('rotation.jump', 'rotation', batchKey, { label: target.label });
    return state;
  },

  /* ── PROJECTIONS FOR THE DASHBOARD ─────────────────  */

  // Where each batch stands relative to the open one, so the admin can
  // see the whole cycle at a glance (PRD §7.2).
  describeSequence(areas, devotees, state) {
    const sequence = buildSequence(areas);
    const openIdx = state ? sequence.findIndex(b => b.key === state.batchKey) : -1;

    return sequence.map((b, i) => {
      const members = (devotees || []).filter(d => b.areaIds.includes(d.areaId) && isActiveDevotee(d));
      const servedThisRound = state
        ? members.filter(d => isServedInRound(d, state.roundNumber)).length
        : 0;

      let status = 'upcoming';
      if (openIdx !== -1) {
        if (i === openIdx) status = 'open';
        else if (i < openIdx) status = 'closed';   // already done this round
      }

      return {
        ...b,
        devoteeCount: members.length,
        servedThisRound: status === 'open' ? servedThisRound : (status === 'closed' ? members.length : 0),
        status,
        isOpen: status === 'open'
      };
    });
  },

  // "New devotee added to an area whose batch is already CLOSED this
  // round → shows when that area reopens" (PRD §5.3). This produces that
  // sentence for a devotee's profile.
  coverageOutlook(devotee, areas, state) {
    if (!state) return { text: 'Rotation has not been started yet', tone: 'grey' };
    if (!isActiveDevotee(devotee)) return { text: 'Paused — not in the rotation', tone: 'amber' };

    const sequence = buildSequence(areas);
    const theirIdx = sequence.findIndex(b => b.areaIds.includes(devotee.areaId));
    if (theirIdx === -1) return { text: 'No area assigned — will not be covered', tone: 'red' };

    const openIdx = sequence.findIndex(b => b.key === state.batchKey);
    const batch = sequence[theirIdx];

    if (theirIdx === openIdx) {
      return isServedInRound(devotee, state.roundNumber)
        ? { text: `Served in round ${state.roundNumber}`, tone: 'green' }
        : { text: 'On the checklist that is open right now', tone: 'green' };
    }
    if (theirIdx < openIdx) {
      return isServedInRound(devotee, state.roundNumber)
        ? { text: `Served in round ${state.roundNumber}`, tone: 'green' }
        : { text: `Missed this round — will be included when ${batch.label} reopens`, tone: 'amber' };
    }
    const away = theirIdx - openIdx;
    return {
      text: `Will be included when ${batch.label} opens (${away} ${away === 1 ? 'batch' : 'batches'} away)`,
      tone: 'blue'
    };
  }
};

window.Rotation = Rotation;
