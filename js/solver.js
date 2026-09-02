/* ══ SOLVER.JS – within-area stop ordering (PRD §8) ══════════════════

   SECONDARY, OPTIONAL LAYER. The rotation engine does not depend on any
   of this, and the app is fully usable without it.

   With no meal deadline to race, this is not a time-window problem at
   all — it is a plain Travelling Salesman ordering: given the devotees
   still pending in the open batch, what is the shortest driving order to
   visit them? Nearest-neighbour to construct, 2-opt and Or-opt to
   improve, which is effectively optimal at the size of one area's
   checklist.
═══════════════════════════════════════════════════════════════════════ */

const Solver = {

  /* Orders the pending devotees of the open checklist.
     Devotees without coordinates cannot be ordered, so they are returned
     separately rather than dropped — they still have to be delivered.  */
  async orderChecklist(devotees, { startPoint = null, areas = [] } = {}) {
    const areaById = new Map((areas || []).map(a => [a.id, a]));

    const mappable = (devotees || []).filter(hasCoords);
    const unmappable = (devotees || []).filter(d => !hasCoords(d));

    if (mappable.length <= 1) {
      return {
        ordered: mappable.map((d, i) => ({ ...d, sequence: i + 1 })),
        unmappable, totalKm: 0, provider: 'none'
      };
    }

    // Start from the temple if it has been placed, otherwise from the
    // devotee nearest the group's own centre — so the order still reads
    // sensibly with no start point configured.
    const origin = hasCoords(startPoint) ? startPoint : centroid(mappable);
    const points = [origin, ...mappable];
    const matrix = await Geo.buildMatrix(points, { speedKmph: 22 });
    const dist = matrix.dist;

    // Nearest neighbour from the origin (index 0).
    const remaining = mappable.map((d, i) => ({ devotee: d, mi: i + 1 }));
    const order = [];
    let prev = 0;
    while (remaining.length) {
      let bestI = 0, bestD = Infinity;
      remaining.forEach((r, i) => {
        if (dist[prev][r.mi] < bestD) { bestD = dist[prev][r.mi]; bestI = i; }
      });
      const chosen = remaining.splice(bestI, 1)[0];
      order.push(chosen);
      prev = chosen.mi;
    }

    const tourKm = (seq) => {
      let km = 0, p = 0;
      seq.forEach(s => { km += dist[p][s.mi]; p = s.mi; });
      return km;
    };

    // 2-opt then Or-opt. No feasibility constraints to honour here, which
    // is what makes this so much lighter than the meal-window design.
    let best = order, bestKm = tourKm(best), improved = true, guard = 0;
    while (improved && guard++ < 60) {
      improved = false;

      for (let i = 0; i < best.length - 1 && !improved; i++) {
        for (let j = i + 1; j < best.length && !improved; j++) {
          const trial = best.slice();
          const seg = trial.slice(i, j + 1).reverse();
          trial.splice(i, seg.length, ...seg);
          const km = tourKm(trial);
          if (km < bestKm - 1e-9) { best = trial; bestKm = km; improved = true; }
        }
      }

      for (let len = 1; len <= 3 && !improved; len++) {
        for (let i = 0; i + len <= best.length && !improved; i++) {
          const seg = best.slice(i, i + len);
          const rest = [...best.slice(0, i), ...best.slice(i + len)];
          for (let p = 0; p <= rest.length && !improved; p++) {
            if (p === i) continue;
            const trial = [...rest.slice(0, p), ...seg, ...rest.slice(p)];
            const km = tourKm(trial);
            if (km < bestKm - 1e-9) { best = trial; bestKm = km; improved = true; }
          }
        }
      }
    }

    return {
      ordered: best.map((s, i) => ({ ...s.devotee, sequence: i + 1 })),
      unmappable,
      totalKm: Math.round(bestKm * 100) / 100,
      provider: matrix.provider,
      degraded: matrix.degraded || null
    };
  },

  // Suggests a sequence for the areas themselves, for an admin who would
  // rather not order a dozen areas by hand (PRD §14 Q3). Advisory only —
  // the admin's own knowledge of the city usually beats a centroid tour.
  suggestAreaSequence(areas, devotees, startPoint = null) {
    const withCentres = (areas || []).map(a => ({
      area: a,
      centre: centroid((devotees || []).filter(d => d.areaId === a.id))
    })).filter(x => x.centre);

    const noCentre = (areas || []).filter(a => !withCentres.some(x => x.area.id === a.id));
    if (withCentres.length <= 1) return [...withCentres.map(x => x.area), ...noCentre];

    const origin = hasCoords(startPoint) ? startPoint : withCentres[0].centre;
    const remaining = [...withCentres];
    const order = [];
    let prev = origin;

    while (remaining.length) {
      let bestI = 0, bestD = Infinity;
      remaining.forEach((r, i) => {
        const d = haversineKm(prev, r.centre);
        if (d < bestD) { bestD = d; bestI = i; }
      });
      const chosen = remaining.splice(bestI, 1)[0];
      order.push(chosen);
      prev = chosen.centre;
    }

    // Areas with no pinned devotees have no position to reason about, so
    // they go last rather than being placed arbitrarily.
    return [...order.map(o => o.area), ...noCentre];
  }
};

window.Solver = Solver;
