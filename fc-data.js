/* ==========================================================================
   Football Community Lagos — Cloud Data, Analytics, Live Sync & PWA Module
   ========================================================================== */

const DEFAULT_FC_CONFIG = {
  supabaseUrl: 'https://lqkeaotyyfmajabcqhgq.supabase.co',
  supabaseKey: 'sb_publishable_RP1haqnhloKRaq6slQZlLA_XtaEcxx2',
  posthogKey: 'phc_qQH6x8kwgSqAvmzPeozxmS66s8mwCUJ55Q7f4sWp8G6f',
  posthogHost: 'https://us.i.posthog.com'
};

function normalizeSupabaseUrl(url) {
  if (!url) return '';
  const m = url.match(/supabase\.com\/dashboard\/project\/([a-z0-9]+)/i);
  if (m) return `https://${m[1]}.supabase.co`;
  return url.replace(/\/+$/, '');
}

const FCData = {
  cfg: { ...DEFAULT_FC_CONFIG },
  db: {
    users: [],
    bookings: [],
    open_games: [],
    game_joins: [],
    ticket_orders: [],
    teams: [],
    event_submissions: [],
    app_events: []
  },
  adminTab: 'Overview',
  adminTable: 'open_games',
  swReady: false,
  loading: true,
  deepLinkGameId: null,

  init() {
    S.permits = S.permits || {};
    S.myGames = S.myGames || {};
    S.attending = S.attending || {};
    S.tickets = S.tickets || {};
    S.gpayMethod = S.gpayMethod || 'card';
    try {
      const savedPermits = localStorage.getItem('fc_permits');
      if (savedPermits) S.permits = { ...S.permits, ...JSON.parse(savedPermits) };
      const savedJoined = localStorage.getItem('fc_joined');
      if (savedJoined) S.joined = { ...S.joined, ...JSON.parse(savedJoined) };
      const savedMyGames = localStorage.getItem('fc_my_games');
      if (savedMyGames) S.myGames = { ...S.myGames, ...JSON.parse(savedMyGames) };
      const savedAttending = localStorage.getItem('fc_attending');
      if (savedAttending) S.attending = { ...S.attending, ...JSON.parse(savedAttending) };
      const savedTickets = localStorage.getItem('fc_tickets');
      if (savedTickets) S.tickets = { ...S.tickets, ...JSON.parse(savedTickets) };
      const savedCfg = localStorage.getItem('fc_cloud_config');
      if (savedCfg) {
        const parsed = JSON.parse(savedCfg);
        this.cfg = {
          supabaseUrl: normalizeSupabaseUrl(parsed.supabaseUrl || DEFAULT_FC_CONFIG.supabaseUrl),
          supabaseKey: parsed.supabaseKey || DEFAULT_FC_CONFIG.supabaseKey,
          posthogKey: parsed.posthogKey || DEFAULT_FC_CONFIG.posthogKey,
          posthogHost: parsed.posthogHost || DEFAULT_FC_CONFIG.posthogHost
        };
      }
      this.cfg.supabaseUrl = normalizeSupabaseUrl(this.cfg.supabaseUrl);
      const savedDb = localStorage.getItem('fc_local_db');
      if (savedDb) {
        this.db = { ...this.db, ...JSON.parse(savedDb) };
        this.mergeLiveIntoUI();
      }
    } catch (e) {
      console.warn('Storage init warning:', e);
    }

    this.handleUrlDeepLinks();

    if (this.cfg.posthogKey) {
      this.initPostHog();
    }
    if (this.isSupabaseConfigured()) {
      this.pullLiveRecords().then(() => {
        this.loading = false;
        this.checkDeepLinkFullAlert();
        if (typeof render === 'function') render();
      });
      // Keep laptop & mobile in sync automatically
      window.addEventListener('focus', () => this.pullLiveRecords());
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') this.pullLiveRecords();
      });
      setInterval(() => {
        if (document.visibilityState === 'visible') this.pullLiveRecords();
      }, 12000);
    } else {
      this.loading = false;
    }
    this.registerPWA();
  },

  isSupabaseConfigured() {
    return Boolean(this.cfg.supabaseUrl && this.cfg.supabaseKey);
  },

  isPostHogConfigured() {
    return Boolean(this.cfg.posthogKey);
  },

  saveConfig(newCfg) {
    this.cfg = { ...this.cfg, ...newCfg };
    this.cfg.supabaseUrl = normalizeSupabaseUrl(this.cfg.supabaseUrl);
    try {
      localStorage.setItem('fc_cloud_config', JSON.stringify(this.cfg));
    } catch (e) {}
    if (this.cfg.posthogKey) this.initPostHog();
    if (this.isSupabaseConfigured()) this.pullLiveRecords();
  },

  persistLocal() {
    try {
      localStorage.setItem('fc_local_db', JSON.stringify(this.db));
      if (window.S && S.permits) localStorage.setItem('fc_permits', JSON.stringify(S.permits));
      if (window.S && S.joined) localStorage.setItem('fc_joined', JSON.stringify(S.joined));
      if (window.S && S.myGames) localStorage.setItem('fc_my_games', JSON.stringify(S.myGames));
      if (window.S && S.attending) localStorage.setItem('fc_attending', JSON.stringify(S.attending));
      if (window.S && S.tickets) localStorage.setItem('fc_tickets', JSON.stringify(S.tickets));
    } catch (e) {}
  },

  initPostHog() {
    if (!this.cfg.posthogKey) return;
    if (!document.getElementById('ph-sdk-script')) {
      const s = document.createElement('script');
      s.id = 'ph-sdk-script';
      s.async = true;
      s.src = 'https://us-assets.i.posthog.com/static/array.js';
      s.onload = () => {
        if (window.posthog && typeof window.posthog.init === 'function') {
          window.posthog.init(this.cfg.posthogKey, {
            api_host: this.cfg.posthogHost || 'https://us.i.posthog.com',
            person_profiles: 'identified_only'
          });
          this.identifyUser();
        }
      };
      document.head.appendChild(s);
    }
  },

  identifyUser() {
    if (!window.S || !S.user) return;
    const distinctId = S.user.email || S.user.phone || S.user.name || 'anon-player';
    if (window.posthog && typeof window.posthog.identify === 'function') {
      window.posthog.identify(distinctId, {
        name: S.user.name,
        email: S.user.email,
        location: S.user.loc,
        experience: S.user.exp
      });
    }
  },

  captureAnalytics(eventName, props = {}) {
    const distinctId = (window.S && S.user && (S.user.email || S.user.name)) || 'lagos-player';
    const payload = {
      event: eventName,
      distinct_id: distinctId,
      properties: {
        ...props,
        app_area: (window.S && S.user && S.user.loc) || 'Lagos',
        timestamp: new Date().toISOString()
      }
    };

    if (window.posthog && typeof window.posthog.capture === 'function') {
      window.posthog.capture(eventName, payload.properties);
    } else if (this.cfg.posthogKey) {
      fetch((this.cfg.posthogHost || 'https://us.i.posthog.com') + '/capture/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ api_key: this.cfg.posthogKey, ...payload })
      }).catch(() => {});
    }
  },

  async record(table, rowData, eventName, eventProps = {}, uiObjRef = null) {
    const ts = new Date().toISOString();
    const recordWithTime = { ...rowData, created_at: ts };

    if (this.db[table]) {
      this.db[table].unshift(recordWithTime);
    }
    const logItem = {
      event_name: eventName || table,
      screen: this.currentScreenName(),
      user_contact: (window.S && S.user && S.user.email) || '',
      properties: eventProps,
      created_at: ts
    };
    this.db.app_events.unshift(logItem);
    this.persistLocal();

    if (eventName) {
      this.captureAnalytics(eventName, eventProps);
    }

    if (this.isSupabaseConfigured()) {
      const [inserted] = await Promise.all([
        this.supabaseInsert(table, rowData, true),
        this.supabaseInsert('app_events', {
          event_name: logItem.event_name,
          screen: logItem.screen,
          user_contact: logItem.user_contact,
          properties: logItem.properties
        })
      ]);
      if (inserted && inserted.id && uiObjRef) {
        uiObjRef.id = inserted.id;
        recordWithTime.id = inserted.id;
        this.persistLocal();
      }
    }
  },

  async updateOpenGame(g) {
    const vObj = (window.venues && venues[g.v]) || venues[0];
    const vName = g.venueName || vObj.name;
    const updatePayload = {
      game_id: String(g.id),
      title: g.title,
      v: g.v || 0,
      venue_name: vName,
      pitch_name: g.pitch,
      match_when: g.when,
      format: g.fmt,
      players_needed: +g.need,
      slots_left: +g.left,
      price_ngn: +g.price || 0,
      skill_level: g.level,
      requires_approval: Boolean(g.approval),
      notes: g.notes || '',
      organiser_name: g.org || S.user.name
    };
    const ts = new Date().toISOString();
    this.db.app_events.unshift({
      event_name: 'open_game_updated',
      screen: 'createGame',
      user_contact: (window.S && S.user && S.user.email) || '',
      properties: updatePayload,
      created_at: ts
    });
    this.persistLocal();
    this.captureAnalytics('open_game_updated', updatePayload);

    if (this.isSupabaseConfigured()) {
      const baseUrl = this.cfg.supabaseUrl.replace(/\/+$/, '');
      await Promise.all([
        this.supabaseInsert('app_events', {
          event_name: 'open_game_updated',
          screen: 'createGame',
          user_contact: (window.S && S.user && S.user.email) || '',
          properties: updatePayload
        }),
        fetch(`${baseUrl}/rest/v1/open_games?id=eq.${encodeURIComponent(g.id)}`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            apikey: this.cfg.supabaseKey,
            Authorization: `Bearer ${this.cfg.supabaseKey}`,
            Prefer: 'return=minimal'
          },
          body: JSON.stringify({
            title: g.title,
            venue_name: vName,
            pitch_name: g.pitch,
            match_when: g.when,
            format: g.fmt,
            players_needed: +g.need,
            slots_left: +g.left,
            price_ngn: +g.price || 0,
            skill_level: g.level,
            requires_approval: Boolean(g.approval)
          })
        }).catch(() => {})
      ]);
    }
  },

  async supabaseInsert(table, row, returnRow = false) {
    if (!this.isSupabaseConfigured()) return null;
    const baseUrl = this.cfg.supabaseUrl.replace(/\/+$/, '');
    try {
      const res = await fetch(`${baseUrl}/rest/v1/${table}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: this.cfg.supabaseKey,
          Authorization: `Bearer ${this.cfg.supabaseKey}`,
          Prefer: returnRow ? 'return=representation' : 'return=minimal'
        },
        body: JSON.stringify(row)
      });
      if (!res.ok) return null;
      if (returnRow) {
        const data = await res.json();
        return Array.isArray(data) ? data[0] : data;
      }
      return true;
    } catch (e) {
      console.warn('Supabase sync deferred:', e);
      return null;
    }
  },

  rowToUiGame(row) {
    let vIdx = 0;
    if (window.venues && row.venue_name) {
      const foundIdx = venues.findIndex((v) => v.name.toLowerCase() === String(row.venue_name).toLowerCase());
      if (foundIdx >= 0) vIdx = foundIdx;
    }
    const initSlots = row.slots_left !== undefined && row.slots_left !== null ? +row.slots_left : 4;
    return {
      id: row.id || 'g_' + (row.created_at || Date.now()),
      title: row.title || 'Open Game',
      v: vIdx,
      venueName: row.venue_name || (window.venues ? venues[vIdx].name : 'Lagos Pitch'),
      pitch: row.pitch_name || 'Main Pitch',
      when: row.match_when || 'Upcoming',
      fmt: row.format || '5-a-side',
      need: +row.players_needed || 10,
      left: initSlots,
      initialLeft: initSlots,
      price: row.price_ngn !== undefined && row.price_ngn !== null ? +row.price_ngn : 0,
      org: row.organiser_name || 'Organiser',
      level: row.skill_level || 'All levels',
      approval: Boolean(row.requires_approval),
      created_at: row.created_at || '',
      fromCloud: true
    };
  },

  mergeLiveIntoUI() {
    if (!window.games) return;
    const cloudGames = (this.db.open_games || []).map((r) => this.rowToUiGame(r));

    // Apply any game edits stored in app_events (oldest to newest)
    const editEvents = (this.db.app_events || [])
      .filter((ev) => ev.event_name === 'open_game_updated' && ev.properties && ev.properties.game_id)
      .slice()
      .reverse();

    for (const ev of editEvents) {
      const p = ev.properties;
      const target =
        cloudGames.find((cg) => String(cg.id) === String(p.game_id)) ||
        games.find((g) => String(g.id) === String(p.game_id));
      if (target) {
        if (p.title !== undefined) target.title = p.title;
        if (p.v !== undefined) target.v = +p.v;
        if (p.venue_name !== undefined) target.venueName = p.venue_name;
        if (p.pitch_name !== undefined) target.pitch = p.pitch_name;
        if (p.match_when !== undefined) target.when = p.match_when;
        if (p.format !== undefined) target.fmt = p.format;
        if (p.players_needed !== undefined) target.need = +p.players_needed;
        if (p.slots_left !== undefined) {
          target.left = +p.slots_left;
          target.initialLeft = +p.slots_left;
          target.lastEditedAt = ev.created_at || '';
        }
        if (p.price_ngn !== undefined) target.price = +p.price_ngn;
        if (p.skill_level !== undefined) target.level = p.skill_level;
        if (p.requires_approval !== undefined) target.approval = Boolean(p.requires_approval);
        if (p.notes !== undefined) target.notes = p.notes;
      }
    }

    // Apply slot decrements from game_joins / open_game_joined events
    const joinEvents = (this.db.app_events || []).filter(
      (ev) => ev.event_name === 'open_game_joined' && ev.properties
    );
    for (const cg of cloudGames) {
      const joinsAfterEdit = joinEvents.filter((ev) => {
        const matchId = ev.properties.game_id && String(ev.properties.game_id) === String(cg.id);
        const matchTitle = !ev.properties.game_id && ev.properties.game_title === cg.title;
        if (!matchId && !matchTitle) return false;
        if (cg.lastEditedAt && ev.created_at && ev.created_at < cg.lastEditedAt) return false;
        return true;
      }).length;
      if (joinsAfterEdit > 0 && cg.initialLeft !== undefined) {
        cg.left = Math.max(0, cg.initialLeft - joinsAfterEdit);
      }
    }

    if (cloudGames.length > 0) {
      for (let i = cloudGames.length - 1; i >= 0; i--) {
        const cg = cloudGames[i];
        const existingIdx = games.findIndex((x) => String(x.id) === String(cg.id));
        if (existingIdx >= 0) {
          const wasMine = Boolean(games[existingIdx].isMine || (window.S && S.myGames && S.myGames[cg.id]));
          games[existingIdx] = { ...games[existingIdx], ...cg, isMine: wasMine };
          const [item] = games.splice(existingIdx, 1);
          games.unshift(item);
        } else {
          cg.isMine = Boolean(window.S && S.myGames && S.myGames[cg.id]);
          games.unshift(cg);
        }
      }
    }

    if (window.teams && Array.isArray(this.db.teams) && this.db.teams.length > 0) {
      for (let i = this.db.teams.length - 1; i >= 0; i--) {
        const rt = this.db.teams[i];
        if (!rt.team_name) continue;
        const exists = teams.some((t) => t.name.toLowerCase() === rt.team_name.toLowerCase());
        if (!exists) {
          teams.unshift({
            id: rt.id || 't_' + i,
            name: rt.team_name,
            loc: rt.location || 'Lagos',
            fmt: rt.format || '7-a-side',
            m: 1,
            role: 'Owner'
          });
        }
      }
    }
  },

  async pullLiveRecords() {
    if (!this.isSupabaseConfigured()) return;
    const baseUrl = this.cfg.supabaseUrl.replace(/\/+$/, '');
    const headers = {
      apikey: this.cfg.supabaseKey,
      Authorization: `Bearer ${this.cfg.supabaseKey}`
    };
    try {
      const tables = ['open_games', 'game_joins', 'app_events', 'users', 'bookings', 'ticket_orders', 'teams', 'event_submissions'];
      await Promise.all(
        tables.map(async (t) => {
          try {
            const res = await fetch(`${baseUrl}/rest/v1/${t}?select=*&order=created_at.desc&limit=100`, {
              headers,
              cache: 'no-store'
            });
            if (res.ok) {
              const rows = await res.json();
              if (Array.isArray(rows)) {
                this.db[t] = rows;
              }
            }
          } catch (err) {}
        })
      );
      this.mergeLiveIntoUI();
      this.refreshActiveDeepLinkGame();
      this.persistLocal();
      if (typeof render === 'function') render();
    } catch (e) {
      console.warn('Supabase pull warning:', e);
    }
  },

  refreshActiveDeepLinkGame() {
    if (!window.S || !S.stack || !S.stack.length) return;
    const topItem = S.stack[S.stack.length - 1];
    if (topItem && topItem.s === 'game') {
      const params = new URLSearchParams(window.location.search);
      const qGame = params.get('game');
      if ((qGame === '0' || qGame === '') && !params.has('g') && games.length > 0) {
        topItem.a = games[0].id;
      } else if (qGame) {
        const exact = games.find((x) => String(x.id) === String(qGame));
        if (exact) topItem.a = exact.id;
      }
    }
  },

  checkDeepLinkFullAlert() {
    if (!this.deepLinkGameId) return;
    const g = findGame(this.deepLinkGameId);
    this.deepLinkGameId = null;
    if (g && +g.left <= 0 && !(window.S && S.joined && S.joined[g.id])) {
      showFullSlotsModal(g);
    }
  },

  async syncAllLocalToSupabase() {
    if (!this.isSupabaseConfigured()) {
      toast('Enter your Supabase URL & Key first');
      return;
    }
    let count = 0;
    const tables = ['users', 'bookings', 'open_games', 'game_joins', 'ticket_orders', 'teams', 'event_submissions'];
    for (const t of tables) {
      for (const row of this.db[t] || []) {
        const copy = { ...row };
        const ok = await this.supabaseInsert(t, copy);
        if (ok) count++;
      }
    }
    showModal({
      title: 'Cloud Sync Complete!',
      sub: `Synced ${count} local record(s) to your Supabase project.`,
      meta: [
        ['Supabase URL', this.cfg.supabaseUrl],
        ['Records Synced', String(count)]
      ],
      primary: 'Done'
    });
  },

  exportCSV(table) {
    const rows = this.db[table] || [];
    if (!rows.length) {
      toast('No records in ' + table + ' yet');
      return;
    }
    const keys = Object.keys(rows[0]);
    const csvLines = [
      keys.join(','),
      ...rows.map((r) =>
        keys
          .map((k) => {
            const v = r[k] === undefined || r[k] === null ? '' : typeof r[k] === 'object' ? JSON.stringify(r[k]) : String(r[k]);
            return `"${v.replace(/"/g, '""')}"`;
          })
          .join(',')
      )
    ];
    const blob = new Blob([csvLines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `football-community-${table}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast('Downloaded ' + table + '.csv');
  },

  currentScreenName() {
    if (!window.S) return 'home';
    const cur = S.stack && S.stack[S.stack.length - 1];
    return cur ? cur.s : S.tab || 'home';
  },

  registerPWA() {
    if ('serviceWorker' in navigator) {
      let hadController = Boolean(navigator.serviceWorker.controller);
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (hadController && !window._swReloading) {
          window._swReloading = true;
          window.location.reload();
        }
      });
      navigator.serviceWorker
        .register('./sw.js?v=9', { updateViaCache: 'none' })
        .then((reg) => {
          this.swReady = true;
          if (reg && typeof reg.update === 'function') reg.update();
        })
        .catch(() => {});
    }
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      window.deferredPWAPrompt = e;
    });
  },

  handleUrlDeepLinks() {
    try {
      const params = new URLSearchParams(window.location.search);
      // 1. Check if instant encoded game payload (?g=...) is present
      if (params.has('g')) {
        try {
          const decoded = JSON.parse(decodeURIComponent(escape(atob(params.get('g')))));
          if (decoded && decoded.title) {
            const existingIdx = games.findIndex((x) => String(x.id) === String(decoded.id));
            if (existingIdx >= 0) {
              games[existingIdx] = { ...games[existingIdx], ...decoded };
            } else {
              games.unshift(decoded);
            }
            this.deepLinkGameId = decoded.id;
            S.stack = [{ s: 'game', a: decoded.id }];
            render();
            return;
          }
        } catch (err) {
          console.warn('Could not decode game param:', err);
        }
      }

      if (params.has('admin') || window.location.hash === '#admin') {
        S.stack = [{ s: 'admin' }];
        render();
      } else if (params.has('game')) {
        const rawId = params.get('game');
        this.deepLinkGameId = rawId;
        // Preserve rawId so pullLiveRecords can resolve UUIDs from Supabase without falling back to dummy games[0]
        S.stack = [{ s: 'game', a: rawId }];
        render();
      } else if (params.has('venue')) {
        const id = +params.get('venue') || 0;
        S.stack = [{ s: 'venue', a: id }];
        render();
      } else if (params.has('event')) {
        const id = +params.get('event') || 0;
        S.stack = [{ s: 'event', a: id }];
        render();
      } else if (params.has('match')) {
        const id = +params.get('match') || 0;
        S.stack = [{ s: 'match', a: id }];
        render();
      } else if (params.has('team')) {
        const rawId = params.get('team');
        S.stack = [{ s: 'team', a: rawId }];
        render();
      } else if (params.has('screen')) {
        const sc = params.get('screen');
        if (SC[sc]) {
          S.stack = [{ s: sc }];
          render();
        }
      } else if (params.has('tab')) {
        const tb = params.get('tab');
        S.stack = [];
        S.tab = tb;
        if (params.has('sub')) S.sub[tb] = params.get('sub');
        render();
      }
    } catch (e) {}
  }
};

window.FCData = FCData;

/* ===== Full Slots Modal Helper ===== */
window.showFullSlotsModal = function (g) {
  const v = (window.venues && venues[g.v]) || venues[0];
  const vName = g.venueName || v.name;
  showModal({
    title: 'Game Slots Full!',
    sub: `All ${g.need} player slots for "${g.title}" have been filled. Check out other open games available near you.`,
    icon: 'users',
    tone: 'warn',
    meta: [
      ['Game', g.title],
      ['Status', `Full (${g.need} of ${g.need} players)`],
      ['Venue', vName + ' · ' + g.pitch]
    ],
    primary: 'Check Other Open Games',
    primaryFn: () => {
      S.stack = [];
      S.tab = 'explore';
      S.sub.explore = 'Open Games';
    },
    secondary: 'Close'
  });
};

/* ===== PWA Install Helper ===== */
window.installPWA = async function () {
  FCData.captureAnalytics('pwa_install_clicked');
  if (window.deferredPWAPrompt) {
    window.deferredPWAPrompt.prompt();
    const { outcome } = await window.deferredPWAPrompt.userChoice;
    window.deferredPWAPrompt = null;
    if (outcome === 'accepted') {
      toast('App installed to your home screen!');
    }
    return;
  }
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
  showModal({
    title: 'Add to Home Screen',
    sub: isIOS
      ? 'On iPhone/iPad Safari: tap the Share icon at the bottom of your screen, then tap "Add to Home Screen".'
      : 'Tap your browser menu (⋮) in the top corner and select "Install App" or "Add to Home Screen".',
    meta: [
      ['App Name', 'Football Community Lagos'],
      ['Size', '< 1 MB (Instant Load)'],
      ['Works Offline', 'Yes · Cached via PWA']
    ],
    primary: 'Got It'
  });
};

/* ===== Real Share & Deep Link Handler ===== */
window.shareVia = function (channel) {
  const it = S.shareItem || {
    type: 'Open Game',
    id: games[0].id,
    title: games[0].title,
    sub: (games[0].venueName || venues[games[0].v].name) + ' · ' + games[0].when,
    url: 'sazzy97.github.io/Football-Community/?game=' + encodeURIComponent(games[0].id)
  };
  const targetUrl = it.fullUrl || it.url;
  const fullUrl = 'https://' + targetUrl.replace(/^https?:\/\//, '');
  const displayUrl = 'https://' + it.url.replace(/^https?:\/\//, '');
  const shareText = `⚽ ${it.title} (${it.type})\n📍 ${it.sub}\n🏷️ ${it.tag || ''}\n👉 Join here: ${fullUrl}`;

  FCData.record('app_events', {}, 'content_shared', {
    channel,
    item_type: it.type,
    item_title: it.title,
    url: displayUrl
  });

  if (channel === 'Copy Link') {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(fullUrl).catch(() => {});
    }
    showModal({
      title: 'Link Copied!',
      sub: 'The live share link is on your clipboard and ready to paste in WhatsApp or anywhere.',
      meta: [
        ['Item', it.title],
        ['Details', it.sub],
        ['Link', displayUrl]
      ],
      primary: 'Done'
    });
    return;
  }

  if (channel === 'WhatsApp') {
    window.open('https://wa.me/?text=' + encodeURIComponent(shareText), '_blank');
  } else if (channel === 'Telegram') {
    window.open('https://t.me/share/url?url=' + encodeURIComponent(fullUrl) + '&text=' + encodeURIComponent(shareText), '_blank');
  } else if (channel === 'X / Post') {
    window.open('https://twitter.com/intent/tweet?text=' + encodeURIComponent(shareText), '_blank');
  } else if (channel === 'More' && navigator.share) {
    navigator.share({ title: it.title, text: shareText, url: fullUrl }).catch(() => {});
    return;
  }

  showModal({
    title: 'Shared via ' + channel + '!',
    sub: 'Your live ' + it.type.toLowerCase() + ' link has been prepared for ' + channel + '.',
    meta: [
      ['Shared', it.title],
      ['Channel', channel],
      ['Link', displayUrl]
    ],
    primary: 'Done'
  });
};

/* ===== Join Open Game Flow (Free -> Permit Code, Paid -> Checkout -> Permit Code) ===== */
window.joinOpenGame = function (id) {
  const g = findGame(id);
  if (!g) return;

  // If already joined, take them straight to their Permit Code screen
  if (S.joined && S.joined[g.id]) {
    go('gamePass', g.id);
    return;
  }

  // If slots are full, show Full Slots modal directing to other open games
  if (+g.left <= 0) {
    showFullSlotsModal(g);
    return;
  }

  const isFree = !g.price || +g.price === 0;
  if (isFree) {
    completeGameJoin(g.id, 'Free Entry');
  } else {
    go('gamePay', g.id);
  }
};

window.completeGameJoin = function (id, paymentNote) {
  const g = findGame(id);
  if (!g) return;
  const v = (window.venues && venues[g.v]) || venues[0];
  const vName = g.venueName || v.name;

  S.permits = S.permits || {};
  const permitCode = S.permits[g.id] || 'FCP-' + Math.floor(100000 + Math.random() * 900000);
  S.permits[g.id] = permitCode;

  if (!S.joined[g.id] && +g.left > 0) {
    g.left = Math.max(0, +g.left - 1);
  }
  S.joined[g.id] = true;
  FCData.persistLocal();

  FCData.record(
    'game_joins',
    {
      game_title: g.title,
      venue_name: vName + ' · ' + g.pitch,
      match_when: g.when,
      player_name: S.user.name,
      player_contact: S.user.email,
      price_ngn: +g.price || 0,
      status: g.approval ? 'pending_approval' : 'confirmed'
    },
    'open_game_joined',
    {
      game_id: String(g.id),
      game_title: g.title,
      venue: vName,
      price_ngn: +g.price || 0,
      permit_code: permitCode,
      payment_note: paymentNote || ''
    }
  );

  // Navigate to Permit Code Success Screen
  const topCur = S.stack[S.stack.length - 1];
  if (topCur && (topCur.s === 'gamePay' || topCur.s === 'processing')) {
    S.stack.pop();
  }
  S.stack.push({ s: 'gamePass', a: g.id });
  render();
};

window.payForGameSlot = function (id) {
  const g = findGame(id);
  if (!g) return;
  if (+g.left <= 0 && !(S.joined && S.joined[g.id])) {
    showFullSlotsModal(g);
    return;
  }
  go('processing');
  setTimeout(() => {
    const cur = S.stack[S.stack.length - 1];
    if (cur && cur.s === 'processing') {
      completeGameJoin(g.id, 'Paid · ' + N(g.price));
    }
  }, 1400);
};

/* ===== Paid Game Checkout Screen (SC.gamePay) ===== */
SC.gamePay = (id) => {
  const g = findGame(id);
  const v = (window.venues && venues[g.v]) || venues[0];
  const vName = g.venueName || v.name;
  const fee = +g.price || 2500;
  const method = S.gpayMethod || 'card';
  const methods = [
    ['card', 'Debit Card / Paystack Checkout', 'Instant verification & permit code issuance'],
    ['transfer', 'Instant Bank Transfer / USSD', 'Pay via Nigerian bank transfer or USSD code']
  ];
  return `${hdr('Confirm & pay slot')}
    <div class="card">
      <div class="row sp"><span class="tag gold">${g.fmt}</span><span class="tag ok">${g.left} slot${g.left === 1 ? '' : 's'} left</span></div>
      <div class="b" style="font-size:18px;margin-top:8px">${g.title}</div>
      <div class="sub small" style="margin-top:2px">${vName} · ${g.pitch}</div>
      <div class="kv" style="margin-top:10px"><span class="muted">Date &amp; time</span><b>${g.when}</b></div>
      <div class="kv"><span class="muted">Organiser</span><b>${g.org}</b></div>
      <div class="kv"><span class="muted">Player</span><b>${S.user.name}</b></div>
      <div class="kv"><span class="muted">Slot fee per player</span><b>${N(fee)}</b></div>
    </div>
    <h2 class="sec">Select payment method</h2>
    <div class="list">
      ${methods
        .map(
          (m) => `<div class="opt ${method === m[0] ? 'on' : ''}" onclick="S.gpayMethod='${m[0]}';render()">
            <div class="radio"></div>
            <div class="grow"><b>${m[1]}</b><div class="sub small">${m[2]}</div></div>
          </div>`
        )
        .join('')}
    </div>
    <div class="note" style="margin-top:14px">Your unique player permit code will be generated immediately after payment verification.</div>
    <div style="margin-top:20px">
      <button class="btn" onclick="payForGameSlot('${g.id}')">Pay ${N(fee)} &amp; Get Permit Code</button>
    </div>`;
};

/* ===== Game Join Success & Permit Code Screen (SC.gamePass) ===== */
SC.gamePass = (id) => {
  const g = findGame(id);
  const v = (window.venues && venues[g.v]) || venues[0];
  const vName = g.venueName || v.name;
  const isFree = !g.price || +g.price === 0;
  S.permits = S.permits || {};
  if (!S.permits[g.id]) {
    S.permits[g.id] = 'FCP-' + Math.floor(100000 + Math.random() * 900000);
  }
  const code = S.permits[g.id];
  return `
    <div style="text-align:center;padding-top:18px">
      <div class="modal-ico" style="margin:0 auto 14px">${ic('check')}</div>
      <h1>${g.approval ? 'Join Request & Permit Ready' : 'You’re In! Spot Confirmed'}</h1>
      <p class="sub" style="margin:6px 0 18px">Present this permit code to the game organiser (${g.org}) when you arrive at the pitch.</p>
    </div>
    <div class="card" style="text-align:center;border:2px dashed var(--brand);background:var(--surface)">
      <span class="tag gold">PLAYER ENTRY PERMIT</span>
      <div style="font-size:28px;font-weight:800;letter-spacing:2px;margin:10px 0 4px;color:var(--brand)">${code}</div>
      <div class="small muted">Verified Player Pass · ${S.user.name}</div>
      <div style="margin:14px auto;width:116px;height:116px;border-radius:16px;background:var(--surface2);display:grid;place-items:center;color:var(--text)">
        <svg viewBox="0 0 24 24" style="width:82px;height:82px" fill="none" stroke="currentColor" stroke-width="1.4">${P.qr}</svg>
      </div>
      <button class="btn sm ghost" style="margin:0 auto" onclick="navigator.clipboard&&navigator.clipboard.writeText('${code}');toast('Permit code ${code} copied!')">Copy Permit Code</button>
    </div>
    <div class="card" style="margin-top:14px">
      <div class="kv"><span class="muted">Game</span><b>${g.title}</b></div>
      <div class="kv"><span class="muted">Venue &amp; Pitch</span><b>${vName} · ${g.pitch}</b></div>
      <div class="kv"><span class="muted">Date &amp; Time</span><b>${g.when}</b></div>
      <div class="kv"><span class="muted">Format</span><b>${g.fmt}</b></div>
      <div class="kv"><span class="muted">Entry Status</span><span class="tag ok">${isFree ? 'Free · Confirmed' : 'Paid · ' + N(g.price)}</span></div>
    </div>
    <div class="col" style="margin-top:18px">
      <button class="btn" onclick="openShare('game','${g.id}')">${ic('share')}Invite &amp; Share Game</button>
      <button class="btn ghost" onclick="S.sub.activity='Games Joined';S.stack=[];S.tab='activity';render()">View in My Activity</button>
    </div>`;
};

/* ===== Owner Data & Cloud Setup Screen (SC.admin) ===== */
SC.admin = () => {
  const sbOk = FCData.isSupabaseConfigured();
  const phOk = FCData.isPostHogConfigured();
  const k = FCData.adminTab || 'Overview';
  const db = FCData.db;

  const tabs = ['Overview', 'Live Records', 'Cloud Keys', 'SQL Setup'];
  const tabBar = `<div class="tabs">${tabs
    .map((t) => `<button class="${k === t ? 'on' : ''}" onclick="FCData.adminTab='${t}';render()">${t}</button>`)
    .join('')}</div>`;

  let content = '';
  if (k === 'Overview') {
    const rsvpCount = (db.app_events || []).filter((e) => e.event_name === 'fixture_rsvp_going').length;
    const verifiedCount = (db.app_events || []).filter((e) => e.event_name === 'fixture_attendance_verified').length;
    content = `
      <div class="card">
        <div class="row sp"><span class="muted small">Supabase Database</span><span class="tag ${sbOk ? 'ok' : 'warn'}">${sbOk ? 'Connected ✓' : 'Local Mode'}</span></div>
        <div class="row sp" style="margin-top:8px"><span class="muted small">PostHog Analytics &amp; Replays</span><span class="tag ${phOk ? 'ok' : 'warn'}">${phOk ? 'Active ✓' : 'Add Key'}</span></div>
        <div class="row sp" style="margin-top:8px"><span class="muted small">PWA Home Screen Support</span><span class="tag ok">Active ✓</span></div>
      </div>
      <div class="stat-grid">
        <div class="stat-box" onclick="FCData.adminTab='Live Records';FCData.adminTable='users';render()"><b>${db.users.length}</b><small>Signups</small></div>
        <div class="stat-box" onclick="FCData.adminTab='Live Records';FCData.adminTable='bookings';render()"><b>${db.bookings.length}</b><small>Bookings</small></div>
        <div class="stat-box" onclick="FCData.adminTab='Live Records';FCData.adminTable='open_games';render()"><b>${db.open_games.length}</b><small>Games Created</small></div>
        <div class="stat-box" onclick="FCData.adminTab='Live Records';FCData.adminTable='game_joins';render()"><b>${db.game_joins.length}</b><small>Game Joins</small></div>
        <div class="stat-box" onclick="FCData.adminTab='Live Records';FCData.adminTable='app_events';render()"><b>${rsvpCount}</b><small>"I'll Be There"</small></div>
        <div class="stat-box" onclick="FCData.adminTab='Live Records';FCData.adminTable='app_events';render()"><b>${verifiedCount}</b><small>At Pitch ✓</small></div>
      </div>
      <div class="card">
        <div class="b">Where do I see all my data?</div>
        <div class="sub small" style="margin-top:6px">
          1. <b>Right here in Live Records:</b> Every signup, pitch booking, game creation, and ticket order is stored immediately and can be exported to Excel/CSV.<br>
          2. <b>Supabase Table Editor:</b> Connected to your live Supabase database.<br>
          3. <b>PostHog Dashboard:</b> Recording live events and user journeys.
        </div>
        <div class="row" style="margin-top:12px">
          <button class="btn sm" onclick="FCData.pullLiveRecords().then(()=>toast('Synced from Supabase'))">Refresh Live Data</button>
          <button class="btn sm ghost" onclick="FCData.syncAllLocalToSupabase()">Push Local to Cloud</button>
        </div>
      </div>`;
  } else if (k === 'Live Records') {
    const tbls = [
      ['open_games', 'Games'],
      ['game_joins', 'Joins'],
      ['bookings', 'Bookings'],
      ['users', 'Users'],
      ['ticket_orders', 'Tickets'],
      ['teams', 'Teams'],
      ['app_events', 'Activity Log']
    ];
    const curT = FCData.adminTable || 'open_games';
    const list = db[curT] || [];
    content = `
      <div class="hscroll">${tbls
        .map((t) => `<button class="chip ${curT === t[0] ? 'on' : ''}" onclick="FCData.adminTable='${t[0]}';render()">${t[1]} (${(db[t[0]] || []).length})</button>`)
        .join('')}</div>
      <div class="row sp" style="margin:6px 0 12px">
        <span class="small muted"><b>${list.length}</b> record(s) captured</span>
        <button class="btn sm ghost" onclick="FCData.exportCSV('${curT}')">Download CSV</button>
      </div>
      ${
        list.length === 0
          ? `<div class="card" style="text-align:center;padding:24px"><div class="b">No ${curT} records yet</div><div class="sub small" style="margin-top:4px">Try completing onboarding, booking a pitch, or creating a game to see live data appear here immediately!</div></div>`
          : `<div class="list">${list
              .slice(0, 25)
              .map(
                (r) => `<div class="card small">${Object.entries(r)
                  .slice(0, 6)
                  .map(([key, val]) => `<div class="kv" style="padding:5px 0"><span class="muted">${key}</span><b style="text-align:right;max-width:190px;overflow:hidden;text-overflow:ellipsis">${typeof val === 'object' ? JSON.stringify(val) : val}</b></div>`)
                  .join('')}</div>`
              )
              .join('')}</div>`
      }`;
  } else if (k === 'Cloud Keys') {
    content = `
      <div class="note" style="margin-bottom:14px">Enter your project keys from <b>supabase.com/dashboard</b> (Settings → API) and <b>posthog.com</b> (Project Settings).</div>
      <div class="field">Supabase Project URL<input id="cfg_sb_url" value="${FCData.cfg.supabaseUrl}" placeholder="https://xyzcompany.supabase.co"></div>
      <div class="field">Supabase Anon Public Key<input id="cfg_sb_key" value="${FCData.cfg.supabaseKey}" placeholder="sb_publishable_..."></div>
      <div class="field">PostHog Project API Key<input id="cfg_ph_key" value="${FCData.cfg.posthogKey}" placeholder="phc_xxxxxxxxxxxxxxxxxxxxxxxx"></div>
      <div class="field">PostHog Host<input id="cfg_ph_host" value="${FCData.cfg.posthogHost}" placeholder="https://us.i.posthog.com"></div>
      <button class="btn" onclick="saveCloudConfigUI()">Save &amp; Connect Cloud</button>
      <button class="btn ghost" style="margin-top:10px" onclick="FCData.pullLiveRecords().then(()=>{toast('Refreshed from Supabase');render()})">Refresh Data from Supabase</button>`;
  } else if (k === 'SQL Setup') {
    const sqlText = `-- Paste in Supabase -> SQL Editor -> New Query -> Run
create table if not exists public.users (id uuid default gen_random_uuid() primary key, full_name text, email_or_phone text, location_cluster text, formats text[], positions text[], experience text, availability text[], created_at timestamptz default now());
create table if not exists public.bookings (id uuid default gen_random_uuid() primary key, booking_ref text, user_name text, user_contact text, venue_name text, pitch_name text, format text, booking_date text, booking_time text, amount_ngn integer, payment_option text, status text, created_at timestamptz default now());
create table if not exists public.open_games (id uuid default gen_random_uuid() primary key, title text, organiser_name text, organiser_contact text, venue_name text, pitch_name text, match_when text, format text, players_needed integer, slots_left integer, price_ngn integer, skill_level text, requires_approval boolean, created_at timestamptz default now());
create table if not exists public.game_joins (id uuid default gen_random_uuid() primary key, game_title text, venue_name text, match_when text, player_name text, player_contact text, price_ngn integer, status text, created_at timestamptz default now());
create table if not exists public.ticket_orders (id uuid default gen_random_uuid() primary key, ticket_ref text, event_title text, venue_name text, buyer_name text, buyer_contact text, quantity integer, total_ngn integer, created_at timestamptz default now());
create table if not exists public.teams (id uuid default gen_random_uuid() primary key, team_name text, location text, format text, owner_name text, owner_contact text, created_at timestamptz default now());
create table if not exists public.event_submissions (id uuid default gen_random_uuid() primary key, event_name text, category text, venue text, event_date text, event_time text, submitted_by text, status text, created_at timestamptz default now());
create table if not exists public.app_events (id uuid default gen_random_uuid() primary key, event_name text, screen text, user_contact text, properties jsonb, created_at timestamptz default now());`;
    content = `
      <div class="note" style="margin-bottom:12px">Copy this SQL and run it once inside your <b>Supabase Dashboard → SQL Editor</b> (full file also saved as <code>supabase-schema.sql</code> in the repo).</div>
      <div class="code-box" id="sql_schema_box">${sqlText}</div>
      <button class="btn" style="margin-top:14px" onclick="navigator.clipboard&&navigator.clipboard.writeText(document.getElementById('sql_schema_box').innerText);toast('SQL Schema copied to clipboard!')">Copy SQL Schema</button>`;
  }

  return `${hdr('Owner Data Hub')}${tabBar}${content}`;
};

window.saveCloudConfigUI = function () {
  const supabaseUrl = ($('cfg_sb_url') && $('cfg_sb_url').value.trim()) || '';
  const supabaseKey = ($('cfg_sb_key') && $('cfg_sb_key').value.trim()) || '';
  const posthogKey = ($('cfg_ph_key') && $('cfg_ph_key').value.trim()) || '';
  const posthogHost = ($('cfg_ph_host') && $('cfg_ph_host').value.trim()) || 'https://us.i.posthog.com';
  FCData.saveConfig({ supabaseUrl, supabaseKey, posthogKey, posthogHost });
  FCData.adminTab = 'Overview';
  render();
  showModal({
    title: 'Cloud Configuration Saved!',
    sub: 'Your Supabase and PostHog settings are active.',
    meta: [
      ['Supabase', supabaseUrl ? 'Configured ✓' : 'Local Mode'],
      ['PostHog', posthogKey ? 'Active ✓' : 'Not set']
    ],
    primary: 'View Dashboard'
  });
};

window.addEventListener('DOMContentLoaded', () => {
  FCData.init();
});
