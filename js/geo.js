/* ══ GEO.JS – geocoding + travel-cost matrix ══════════════════════════
   Two jobs, deliberately kept apart (PRD §7.1):

   1. GEOCODING — address text → lat/lng. Runs once per devotee, cached
      forever on the devotee record. Free tier covers thousands of one-time
      lookups; we never re-geocode an address we already resolved.

   2. TRAVEL MATRIX — cost between every pair of stops, fed to the solver.
      This is the expensive one (N² elements per run), so it is pluggable:
      haversine (free, default) → OSRM (free, self-hosted) → Google Routes.
═══════════════════════════════════════════════════════════════════════ */

const Geo = {

  // ── ADDRESS CACHE ───────────────────────────────────
  // Keyed on the normalised address string, so re-importing the same
  // spreadsheet or fixing a typo elsewhere never costs a second lookup.
  _cacheKey: 'sevaroute_geocache_v1',
  _cache: null,

  _loadCache() {
    if (this._cache) return this._cache;
    try {
      this._cache = JSON.parse(localStorage.getItem(this._cacheKey) || '{}');
    } catch {
      this._cache = {};
    }
    return this._cache;
  },

  _saveCache() {
    try {
      localStorage.setItem(this._cacheKey, JSON.stringify(this._cache || {}));
    } catch (e) {
      // Quota exceeded on a big import — drop the cache rather than break
      // the import. Worst case we pay for a few repeat lookups.
      console.warn('[SevaRoute] geocode cache full, clearing', e);
      this._cache = {};
    }
  },

  _normAddr(addr) {
    return String(addr || '').toLowerCase().replace(/\s+/g, ' ').trim();
  },

  // ── GEOCODING ───────────────────────────────────────
  hasOrs() {
    return !!(typeof ORS_API_KEY !== 'undefined' && ORS_API_KEY);
  },

  hasGoogleGeocoding() {
    return !!(typeof GEOCODING_API_KEY !== 'undefined' && GEOCODING_API_KEY);
  },

  isGeocodingAvailable() {
    return this.hasGoogleGeocoding() || this.hasOrs();
  },

  // Which service will actually run, for display in the UI.
  geocoderName() {
    if (this.hasGoogleGeocoding()) return 'Google';
    if (this.hasOrs()) return 'OpenRouteService';
    return null;
  },

  async geocode(address, cityHint = '') {
    const key = this._normAddr(address + '|' + cityHint);
    if (!key) return { ok: false, reason: 'empty' };

    const cache = this._loadCache();
    if (cache[key]) return { ok: true, ...cache[key], cached: true };

    // Google first when configured (best Indian address coverage), else
    // OpenRouteService, which needs no billing account.
    if (!this.hasGoogleGeocoding()) {
      if (this.hasOrs()) return this._geocodeOrs(address, cityHint, key);
      return { ok: false, reason: 'noKey' };
    }

    const query = cityHint ? `${address}, ${cityHint}` : address;
    const url = `https://maps.googleapis.com/maps/api/geocode/json`
              + `?address=${encodeURIComponent(query)}`
              + `&region=in&key=${GEOCODING_API_KEY}`;

    try {
      const res = await fetch(url);
      const data = await res.json();

      if (data.status === 'OK' && data.results && data.results.length) {
        const r = data.results[0];
        const out = {
          lat: r.geometry.location.lat,
          lng: r.geometry.location.lng,
          formatted: r.formatted_address,
          // APPROXIMATE means Google fell back to the locality centre — the
          // pin is somewhere in the neighbourhood, not at the door. Flag it
          // so the dispatcher can correct it by hand (PRD §6.1).
          precision: r.geometry.location_type || 'UNKNOWN'
        };
        cache[key] = out;
        this._saveCache();
        return { ok: true, ...out };
      }

      if (data.status === 'ZERO_RESULTS') return { ok: false, reason: 'notFound' };
      if (data.status === 'OVER_QUERY_LIMIT') return { ok: false, reason: 'quota' };
      if (data.status === 'REQUEST_DENIED') return { ok: false, reason: 'denied', detail: data.error_message };
      return { ok: false, reason: data.status || 'error', detail: data.error_message };
    } catch (e) {
      return { ok: false, reason: 'network', detail: e.message };
    }
  },

  // OpenRouteService geocoding (Pelias/OSM). Free key, no billing account.
  // Boundary-restricted to India so "Model Town" resolves locally rather
  // than to a same-named place on another continent.
  async _geocodeOrs(address, cityHint, cacheKey) {
    const query = cityHint ? `${address}, ${cityHint}, India` : `${address}, India`;
    const url = 'https://api.openrouteservice.org/geocode/search'
              + `?api_key=${encodeURIComponent(ORS_API_KEY)}`
              + `&text=${encodeURIComponent(query)}`
              + '&boundary.country=IN&size=1';

    try {
      const res = await fetch(url);
      if (res.status === 403) return { ok: false, reason: 'denied' };
      if (res.status === 429) return { ok: false, reason: 'quota' };
      if (!res.ok) return { ok: false, reason: 'error', detail: `HTTP ${res.status}` };

      const data = await res.json();
      const hit = data.features && data.features[0];
      if (!hit) return { ok: false, reason: 'notFound' };

      const [lng, lat] = hit.geometry.coordinates;
      // Pelias reports its match granularity; anything coarser than a
      // street address deserves a human look before we route on it.
      const layer = hit.properties?.layer || '';
      const out = {
        lat, lng,
        formatted: hit.properties?.label || query,
        precision: (layer === 'address' || layer === 'venue') ? 'ROOFTOP' : 'APPROXIMATE'
      };

      const cache = this._loadCache();
      cache[cacheKey] = out;
      this._saveCache();
      return { ok: true, ...out };
    } catch (e) {
      return { ok: false, reason: 'network', detail: e.message };
    }
  },

  // A pin resolved only to street/locality level is worse than useless for
  // routing — it will send the driver to the wrong end of the road. Treat it
  // as needing review rather than silently trusting it.
  isPrecise(precision) {
    return precision === 'ROOFTOP' || precision === 'RANGE_INTERPOLATED';
  },

  // Geocodes every devotee missing coordinates, sequentially with a small
  // gap. Google's per-second limit is generous but a 500-row import fired in
  // parallel will trip it; sequential-with-delay is slower but reliable.
  async geocodePending(devotees, { onProgress, cityHint = '', delayMs = 120 } = {}) {
    const pending = devotees.filter(d => !hasCoords(d) && d.addressText);
    const result = { total: pending.length, ok: 0, failed: 0, needsReview: 0, errors: [] };

    for (let i = 0; i < pending.length; i++) {
      const d = pending[i];
      const r = await this.geocode(d.addressText, cityHint);

      if (r.ok) {
        const status = this.isPrecise(r.precision) ? 'ok' : 'review';
        await DB.saveGeocode(d.id, r.lat, r.lng, status, r.formatted);
        result.ok++;
        if (status === 'review') result.needsReview++;
      } else {
        await DB.saveGeocode(d.id, null, null, 'failed');
        result.failed++;
        result.errors.push({ name: d.name, reason: r.reason });
        // Quota exhaustion won't fix itself on the next row — stop early
        // rather than burning through the rest of the list failing.
        if (r.reason === 'quota' || r.reason === 'denied') {
          result.abortedReason = r.reason;
          break;
        }
      }

      if (onProgress) onProgress(i + 1, pending.length, d.name);
      if (!r.cached && delayMs) await new Promise(res => setTimeout(res, delayMs));
    }

    return result;
  },

  /* ══ TRAVEL MATRIX ═══════════════════════════════════════════════════
     Returns { dist, time, provider, degraded }
       dist[i][j] — kilometres from point i to point j
       time[i][j] — minutes, including the vehicle's speed profile
     Points are [{lat,lng}, ...] with index 0 the origin to measure from.
  ═════════════════════════════════════════════════════════════════════ */

  async buildMatrix(points, { speedKmph = 22, provider = null } = {}) {
    const use = provider || (typeof DISTANCE_PROVIDER !== 'undefined' ? DISTANCE_PROVIDER : 'haversine');

    if (use === 'ors') {
      try {
        return await this._orsMatrix(points, speedKmph);
      } catch (e) {
        console.warn('[SevaRoute] OpenRouteService matrix failed, falling back to haversine', e);
        return { ...this._haversineMatrix(points, speedKmph), degraded: 'ors-failed' };
      }
    }

    if (use === 'osrm') {
      try {
        return await this._osrmMatrix(points, speedKmph);
      } catch (e) {
        console.warn('[SevaRoute] OSRM matrix failed, falling back to haversine', e);
        return { ...this._haversineMatrix(points, speedKmph), degraded: 'osrm-failed' };
      }
    }

    if (use === 'google') {
      try {
        return await this._googleMatrix(points, speedKmph);
      } catch (e) {
        console.warn('[SevaRoute] Routes API matrix failed, falling back to haversine', e);
        return { ...this._haversineMatrix(points, speedKmph), degraded: 'google-failed' };
      }
    }

    return this._haversineMatrix(points, speedKmph);
  },

  // Straight-line distance inflated by a road-winding factor. In a dense
  // Indian city grid the real driving distance runs ~1.3–1.4× the crow-flight
  // distance, so this orders stops correctly even though absolute numbers are
  // approximate. Good enough to plan with; swap to OSRM when precision pays.
  _haversineMatrix(points, speedKmph) {
    const n = points.length;
    const factor = AppState.settings.roadFactor || 1.35;
    const dist = Array.from({ length: n }, () => new Array(n).fill(0));
    const time = Array.from({ length: n }, () => new Array(n).fill(0));

    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const km = haversineKm(points[i], points[j]) * factor;
        const mins = (km / speedKmph) * 60;
        dist[i][j] = dist[j][i] = km;
        time[i][j] = time[j][i] = mins;
      }
    }
    return { dist, time, provider: 'haversine' };
  },

  // OpenRouteService matrix — real road distances and durations for the whole
  // N×N grid in ONE request, on a free key with no billing account. This is
  // the accuracy upgrade that matters: haversine cannot know about one-way
  // streets, rivers, railway crossings or flyovers, all of which decide the
  // real order of stops in an Indian city.
  async _orsMatrix(points, speedKmph) {
    if (!this.hasOrs()) throw new Error('ORS_API_KEY not set');

    const n = points.length;
    // Free tier caps a matrix at 3,500 routed pairs, i.e. about 59×59.
    if (n * n > 3500) {
      throw new Error(`ORS free-tier matrix limit exceeded (${n} points = ${n * n} pairs, max 3500)`);
    }

    const res = await fetch('https://api.openrouteservice.org/v2/matrix/driving-car', {
      method: 'POST',
      headers: {
        'Authorization': ORS_API_KEY,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      // ORS takes [lng, lat] — the reverse of the [lat, lng] used everywhere
      // else in this app. Getting this backwards silently routes through the
      // wrong hemisphere, so it is worth the explicit comment.
      body: JSON.stringify({
        locations: points.map(p => [p.lng, p.lat]),
        metrics: ['distance', 'duration'],
        units: 'km'
      })
    });

    if (res.status === 403) throw new Error('ORS key rejected — check the key and its permissions');
    if (res.status === 429) throw new Error('ORS rate limit reached — try again shortly');
    if (!res.ok) throw new Error(`ORS HTTP ${res.status}: ${await res.text()}`);

    const data = await res.json();
    const dist = Array.from({ length: n }, () => new Array(n).fill(0));
    const time = Array.from({ length: n }, () => new Array(n).fill(0));

    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const km = data.distances?.[i]?.[j];
        const sec = data.durations?.[i]?.[j];
        // null means the point could not be snapped to a road; fall back so
        // one bad pin cannot sink the whole run.
        dist[i][j] = (km == null) ? haversineKm(points[i], points[j]) * 1.35 : km;
        time[i][j] = (sec == null) ? (dist[i][j] / speedKmph) * 60 : sec / 60;
      }
    }

    return { dist, time, provider: 'ors' };
  },

  // OSRM's /table service returns the full N×N matrix in a single request —
  // no per-element billing, which is exactly why the PRD recommends it.
  async _osrmMatrix(points, speedKmph) {
    const n = points.length;
    // The public demo server caps out around 100 coordinates; a self-hosted
    // instance has no such limit but we keep the guard for safety.
    if (n > 100) throw new Error(`OSRM table limit exceeded (${n} points)`);

    const coords = points.map(p => `${p.lng},${p.lat}`).join(';');
    const url = `${OSRM_BASE_URL}/table/v1/driving/${coords}?annotations=duration,distance`;

    const res = await fetch(url);
    if (!res.ok) throw new Error(`OSRM HTTP ${res.status}`);
    const data = await res.json();
    if (data.code !== 'Ok') throw new Error(`OSRM ${data.code}`);

    const dist = Array.from({ length: n }, () => new Array(n).fill(0));
    const time = Array.from({ length: n }, () => new Array(n).fill(0));

    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        // OSRM returns metres and seconds; nulls appear when a point can't
        // be snapped to the road network.
        const m = data.distances?.[i]?.[j];
        const s = data.durations?.[i]?.[j];
        dist[i][j] = (m === null || m === undefined) ? haversineKm(points[i], points[j]) * 1.35 : m / 1000;
        time[i][j] = (s === null || s === undefined) ? (dist[i][j] / speedKmph) * 60 : s / 60;
      }
    }
    return { dist, time, provider: 'osrm' };
  },

  // Routes API Compute Route Matrix — the current, non-legacy endpoint.
  // Billed per element (origins × destinations), so this is chunked to stay
  // inside the per-request cap and to make the cost visible in the console.
  async _googleMatrix(points, speedKmph) {
    if (!ROUTES_API_KEY) throw new Error('ROUTES_API_KEY not set');

    const n = points.length;
    const dist = Array.from({ length: n }, () => new Array(n).fill(0));
    const time = Array.from({ length: n }, () => new Array(n).fill(0));

    // Google caps a single computeRouteMatrix call at 625 elements.
    const CHUNK = 25;
    const url = 'https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix';
    const wp = p => ({ waypoint: { location: { latLng: { latitude: p.lat, longitude: p.lng } } } });

    let elements = 0;

    for (let oi = 0; oi < n; oi += CHUNK) {
      for (let di = 0; di < n; di += CHUNK) {
        const origins = points.slice(oi, oi + CHUNK);
        const destinations = points.slice(di, di + CHUNK);
        elements += origins.length * destinations.length;

        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Goog-Api-Key': ROUTES_API_KEY,
            'X-Goog-FieldMask': 'originIndex,destinationIndex,duration,distanceMeters,condition'
          },
          body: JSON.stringify({
            origins: origins.map(wp),
            destinations: destinations.map(wp),
            // TWO_WHEELER gives materially better routing for bike-based
            // delivery in Indian cities — it uses lanes cars can't take.
            travelMode: speedKmph <= 25 ? 'TWO_WHEELER' : 'DRIVE',
            routingPreference: speedKmph <= 25 ? 'TRAFFIC_UNAWARE' : 'TRAFFIC_AWARE'
          })
        });

        if (!res.ok) throw new Error(`Routes API HTTP ${res.status}: ${await res.text()}`);
        const rows = await res.json();

        rows.forEach(r => {
          const i = oi + (r.originIndex || 0);
          const j = di + (r.destinationIndex || 0);
          if (r.condition === 'ROUTE_NOT_FOUND') {
            dist[i][j] = haversineKm(points[i], points[j]) * 1.35;
            time[i][j] = (dist[i][j] / speedKmph) * 60;
            return;
          }
          dist[i][j] = (r.distanceMeters || 0) / 1000;
          time[i][j] = parseFloat(String(r.duration || '0s').replace('s', '')) / 60;
        });
      }
    }

    console.info(`[SevaRoute] Routes API: ${elements} elements billed for ${n} points`);
    return { dist, time, provider: 'google', elements };
  },

};

window.Geo = Geo;
