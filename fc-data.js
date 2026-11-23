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
    S.myFixtures = S.myFixtures || {};
    S.myEvents = S.myEvents || {};
    S.myComps = S.myComps || {};
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
      const savedMyFix = localStorage.getItem('fc_my_fixtures');
      if (savedMyFix) S.myFixtures = { ...S.myFixtures, ...JSON.parse(savedMyFix) };
      const savedMyEv = localStorage.getItem('fc_my_events');
      if (savedMyEv) S.myEvents = { ...S.myEvents, ...JSON.parse(savedMyEv) };
      const savedMyComps = localStorage.getItem('fc_my_comps');
      if (savedMyComps) S.myComps = { ...S.myComps, ...JSON.parse(savedMyComps) };
      const savedCustomComps = localStorage.getItem('fc_custom_comps');
      if (savedCustomComps && window.comps) {
        const parsed = JSON.parse(savedCustomComps);
        if (Array.isArray(parsed)) {
          parsed.forEach((c) => {
            if (!comps.find((x) => String(x.id) === String(c.id))) comps.unshift(c);
          });
        }
      }
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
      this.restoreAuthSession();
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

  /* ===== Real User Accounts (Supabase Auth) ===== */
  getAuthSession() {
    try {
      const raw = localStorage.getItem('fc_auth_session');
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  },

  applyAuthSession(sessionObj, isBootRestore = false) {
    if (!sessionObj || !sessionObj.user) return;
    try {
      const toStore = {
        access_token: sessionObj.access_token || '',
        refresh_token: sessionObj.refresh_token || '',
        expires_at: sessionObj.expires_at || Math.floor(Date.now() / 1000) + 3500,
        user: sessionObj.user
      };
      localStorage.setItem('fc_auth_session', JSON.stringify(toStore));
    } catch (e) {}

    const u = sessionObj.user;
    const meta = u.user_metadata || {};
    S.authUser = { id: u.id, email: u.email, user_metadata: meta };
    S.user.email = u.email || S.user.email;
    if (meta.full_name) S.user.name = meta.full_name;
    else if (!S.user.name && u.email) S.user.name = u.email.split('@')[0];
    if (meta.location_cluster) S.user.loc = meta.location_cluster;
    if (Array.isArray(meta.formats) && meta.formats.length) {
      S.user.fmts = {};
      meta.formats.forEach((f) => (S.user.fmts[f] = true));
    }
    if (Array.isArray(meta.positions) && meta.positions.length) {
      S.user.pos = {};
      meta.positions.forEach((p) => (S.user.pos[p] = true));
    }
    if (meta.experience) S.user.exp = meta.experience;
    if (Array.isArray(meta.availability) && meta.availability.length) {
      S.user.avail = {};
      meta.availability.forEach((a) => (S.user.avail[a] = true));
    }
    if (meta.card && typeof meta.card === 'object') {
      S.user.card = { ...(S.user.card || {}), ...meta.card };
    } else if (!S.user.card) {
      try {
        const localC = localStorage.getItem('fc_my_card');
        if (localC) S.user.card = JSON.parse(localC);
      } catch (e) {}
    }
    S.user.pass = '';

    // Returning signed-in users go straight to Home if no deep link
    if (isBootRestore && S.stack.length === 1 && S.stack[0].s === 'welcome' && !window.location.search) {
      S.stack = [];
      S.tab = 'home';
    }
    this.identifyUser();
  },

  restoreAuthSession() {
    const sess = this.getAuthSession();
    if (!sess || !sess.user) return;
    this.applyAuthSession(sess, true);
    if (!this.isSupabaseConfigured() || !sess.access_token) return;
    const baseUrl = this.cfg.supabaseUrl.replace(/\/+$/, '');
    const nowSec = Math.floor(Date.now() / 1000);
    if (sess.refresh_token && sess.expires_at && sess.expires_at - nowSec < 300) {
      fetch(`${baseUrl}/auth/v1/token?grant_type=refresh_token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: this.cfg.supabaseKey },
        body: JSON.stringify({ refresh_token: sess.refresh_token })
      })
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          if (data && data.access_token && data.user) {
            this.applyAuthSession(data, false);
            if (typeof render === 'function') render();
          }
        })
        .catch(() => {});
    } else {
      fetch(`${baseUrl}/auth/v1/user`, {
        headers: { apikey: this.cfg.supabaseKey, Authorization: `Bearer ${sess.access_token}` }
      })
        .then((r) => (r.ok ? r.json() : null))
        .then((u) => {
          if (u && u.id) {
            this.applyAuthSession({ ...sess, user: u }, false);
            if (typeof render === 'function') render();
          }
        })
        .catch(() => {});
    }
  },

  async authSignUp(email, password, profileMeta = {}) {
    if (!this.isSupabaseConfigured()) return { ok: false, error: 'Cloud database not configured.' };
    const baseUrl = this.cfg.supabaseUrl.replace(/\/+$/, '');
    try {
      const res = await fetch(`${baseUrl}/auth/v1/signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: this.cfg.supabaseKey },
        body: JSON.stringify({ email, password, data: profileMeta })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        return { ok: false, error: data.msg || data.error_description || data.message || 'Could not create account.' };
      }
      // Record profile into public.users for Owner Data Hub
      this.record(
        'users',
        {
          full_name: profileMeta.full_name || email.split('@')[0],
          email_or_phone: email,
          location_cluster: profileMeta.location_cluster || S.user.loc,
          formats: profileMeta.formats || [],
          positions: profileMeta.positions || [],
          experience: profileMeta.experience || S.user.exp,
          availability: profileMeta.availability || []
        },
        'user_signed_up',
        { email, location: profileMeta.location_cluster || '' }
      );
      if (data.access_token && data.user) {
        this.resetLocalUserMaps();
        this.applyAuthSession(data, false);
        await this.pullLiveRecords();
        return { ok: true, needsEmailConfirm: false };
      }
      if (data.id || (data.user && data.user.id)) {
        return { ok: true, needsEmailConfirm: true };
      }
      return { ok: false, error: 'Unexpected signup response. Please try signing in.' };
    } catch (e) {
      return { ok: false, error: 'Network error while creating account. Please try again.' };
    }
  },

  async authSignIn(email, password) {
    if (!this.isSupabaseConfigured()) return { ok: false, error: 'Cloud database not configured.' };
    const baseUrl = this.cfg.supabaseUrl.replace(/\/+$/, '');
    try {
      const res = await fetch(`${baseUrl}/auth/v1/token?grant_type=password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: this.cfg.supabaseKey },
        body: JSON.stringify({ email, password })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.access_token || !data.user) {
        let msg = data.error_description || data.msg || data.message || 'Invalid email or password.';
        if (msg.toLowerCase().includes('email not confirmed')) {
          msg = 'Please confirm your email first — check your inbox for the verification link from Supabase.';
        }
        return { ok: false, error: msg };
      }
      this.resetLocalUserMaps();
      this.applyAuthSession(data, false);
      this.captureAnalytics('user_signed_in', { email: data.user.email });
      await this.pullLiveRecords();
      return { ok: true };
    } catch (e) {
      return { ok: false, error: 'Network error while signing in. Please try again.' };
    }
  },

  async authUpdateProfile(profileMeta = {}) {
    const sess = this.getAuthSession();
    if (!this.isSupabaseConfigured() || !sess || !sess.access_token) return { ok: false };
    const baseUrl = this.cfg.supabaseUrl.replace(/\/+$/, '');
    try {
      const res = await fetch(`${baseUrl}/auth/v1/user`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          apikey: this.cfg.supabaseKey,
          Authorization: `Bearer ${sess.access_token}`
        },
        body: JSON.stringify({ data: profileMeta })
      });
      const u = await res.json().catch(() => null);
      if (res.ok && u && u.id) {
        this.applyAuthSession({ ...sess, user: u }, false);
        return { ok: true };
      }
      return { ok: false };
    } catch (e) {
      return { ok: false };
    }
  },

  async authResetPassword(email) {
    if (!this.isSupabaseConfigured()) return { ok: false, error: 'Cloud not configured.' };
    const baseUrl = this.cfg.supabaseUrl.replace(/\/+$/, '');
    try {
      const res = await fetch(`${baseUrl}/auth/v1/recover`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: this.cfg.supabaseKey },
        body: JSON.stringify({ email, redirect_to: window.location.origin + window.location.pathname })
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        return { ok: false, error: d.msg || d.error_description || 'Could not send reset email.' };
      }
      return { ok: true };
    } catch (e) {
      return { ok: false, error: 'Network error sending reset link.' };
    }
  },

  resetLocalUserMaps() {
    S.joined = {};
    S.permits = {};
    S.myGames = {};
    S.myFixtures = {};
    S.myEvents = {};
    S.myVenues = {};
    S.attending = {};
    S.tickets = {};
    S.isAdmin = false;
    if (window.games) games.forEach((g) => (g.isMine = false));
    if (window.fixtures) fixtures.forEach((f) => (f.isMine = false));
    if (window.events) events.forEach((e) => (e.isMine = false));
    if (window.venues) venues.forEach((v) => (v.isMine = false));
    if (window.teams) teams.forEach((t) => (t.role = null));
    ['fc_joined', 'fc_permits', 'fc_my_games', 'fc_my_fixtures', 'fc_my_events', 'fc_attending', 'fc_tickets'].forEach((k) => {
      try {
        localStorage.removeItem(k);
      } catch (e) {}
    });
  },

  authSignOut() {
    const sess = this.getAuthSession();
    if (this.isSupabaseConfigured() && sess && sess.access_token) {
      const baseUrl = this.cfg.supabaseUrl.replace(/\/+$/, '');
      fetch(`${baseUrl}/auth/v1/logout`, {
        method: 'POST',
        headers: { apikey: this.cfg.supabaseKey, Authorization: `Bearer ${sess.access_token}` }
      }).catch(() => {});
    }
    try {
      localStorage.removeItem('fc_auth_session');
    } catch (e) {}
    S.authUser = null;
    S.authErr = null;
    S.user.name = '';
    S.user.email = '';
    S.user.pass = '';
    this.resetLocalUserMaps();
    S.stack = [{ s: 'signin' }];
    S.tab = 'home';
    toast('Signed out successfully');
    if (typeof render === 'function') render();
  },

  /* ===== Real Fixture & Event Cloud Publishing ===== */
  async publishFixture(item) {
    const payload = {
      fixture_id: String(item.id),
      h: item.h,
      a: item.a,
      t: item.t,
      s: item.s,
      sc: item.sc || '',
      v: item.v,
      comp: item.comp || 'Lagos Grassroots Cup',
      fee: item.fee || 'Free',
      price: +item.price || 0,
      org: item.org || S.user.name,
      creator_id: item.creator_id || '',
      creator_email: item.creator_email || '',
      timeline: item.timeline || []
    };
    await this.record(
      'event_submissions',
      {
        event_name: `${item.h} vs ${item.a}`,
        category: item.comp || 'Match Fixture',
        venue: item.v,
        event_date: item.t,
        event_time: item.fee || 'Free',
        submitted_by: item.org || S.user.name,
        status: 'published_fixture'
      },
      'fixture_published',
      payload
    );
  },

  async updateFixture(item) {
    const payload = {
      fixture_id: String(item.id),
      h: item.h,
      a: item.a,
      t: item.t,
      s: item.s,
      sc: item.sc || '',
      v: item.v,
      comp: item.comp || 'Lagos Grassroots Cup',
      fee: item.fee || 'Free',
      price: +item.price || 0,
      org: item.org || S.user.name,
      creator_id: item.creator_id || '',
      creator_email: item.creator_email || '',
      timeline: item.timeline || []
    };
    const ts = new Date().toISOString();
    this.db.app_events.unshift({
      event_name: 'fixture_updated',
      screen: 'match',
      user_contact: (window.S && ((S.authUser && S.authUser.email) || S.user.email)) || '',
      properties: payload,
      created_at: ts
    });
    this.persistLocal();
    this.captureAnalytics('fixture_updated', payload);
    if (this.isSupabaseConfigured()) {
      await this.supabaseInsert('app_events', {
        event_name: 'fixture_updated',
        screen: 'match',
        user_contact: (window.S && ((S.authUser && S.authUser.email) || S.user.email)) || '',
        properties: payload
      });
    }
  },

  async publishEvent(item) {
    const payload = {
      event_id: String(item.id),
      im: item.im || 'event1',
      title: item.title,
      cat: item.cat || 'Grassroots',
      trust: item.trust || 'Organiser-published',
      venue: item.venue,
      when: item.when,
      fee: item.fee || 'Free',
      status: item.status || 'Upcoming',
      org: item.org || S.user.name,
      tix: Boolean(item.tix),
      left: +item.left || 0,
      about: item.about || '',
      creator_id: item.creator_id || '',
      creator_email: item.creator_email || ''
    };
    await this.record(
      'event_submissions',
      {
        event_name: item.title,
        category: item.cat || 'Grassroots',
        venue: item.venue,
        event_date: item.when,
        event_time: item.fee || 'Free',
        submitted_by: item.org || S.user.name,
        status: 'published_event'
      },
      'event_published',
      payload
    );
  },

  async updateEvent(item) {
    const payload = {
      event_id: String(item.id),
      im: item.im || 'event1',
      title: item.title,
      cat: item.cat || 'Grassroots',
      trust: item.trust || 'Organiser-published',
      venue: item.venue,
      when: item.when,
      fee: item.fee || 'Free',
      status: item.status || 'Upcoming',
      org: item.org || S.user.name,
      tix: Boolean(item.tix),
      left: +item.left || 0,
      about: item.about || '',
      creator_id: item.creator_id || '',
      creator_email: item.creator_email || ''
    };
    const ts = new Date().toISOString();
    this.db.app_events.unshift({
      event_name: 'event_updated',
      screen: 'createEvent',
      user_contact: (window.S && ((S.authUser && S.authUser.email) || S.user.email)) || '',
      properties: payload,
      created_at: ts
    });
    this.persistLocal();
    this.captureAnalytics('event_updated', payload);
    if (this.isSupabaseConfigured()) {
      await this.supabaseInsert('app_events', {
        event_name: 'event_updated',
        screen: 'createEvent',
        user_contact: (window.S && ((S.authUser && S.authUser.email) || S.user.email)) || '',
        properties: payload
      });
    }
  },

  async publishCompetition(item) {
    const payload = {
      comp_id: String(item.id),
      name: item.name,
      type: item.type,
      season: item.season,
      teams: +item.teams || 0,
      format: item.format || '11-a-side',
      area: item.area || 'Lagos',
      venue: item.venue || '',
      fee: item.fee || 'Free',
      prize: item.prize || '',
      verified: Boolean(item.verified),
      verification_requested: Boolean(item.verificationRequested),
      desc: item.desc || '',
      enrolled_teams: item.enrolledTeams || [],
      org: item.org || (window.S && S.user && S.user.name) || '',
      creator_id: item.creator_id || '',
      creator_email: item.creator_email || ''
    };
    await this.record(
      'event_submissions',
      {
        event_name: item.name,
        category: 'Competition',
        venue: item.venue || item.area || 'Lagos',
        event_date: item.season,
        event_time: item.fee || 'Free',
        submitted_by: item.org || (window.S && S.user && S.user.name) || 'Organiser',
        status: item.verified ? 'verified_competition' : 'published_competition'
      },
      'competition_published',
      payload
    );
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
      if (window.S && S.myFixtures) localStorage.setItem('fc_my_fixtures', JSON.stringify(S.myFixtures));
      if (window.S && S.myEvents) localStorage.setItem('fc_my_events', JSON.stringify(S.myEvents));
      if (window.S && S.myComps) localStorage.setItem('fc_my_comps', JSON.stringify(S.myComps));
      if (window.S && S.attending) localStorage.setItem('fc_attending', JSON.stringify(S.attending));
      if (window.S && S.tickets) localStorage.setItem('fc_tickets', JSON.stringify(S.tickets));
      if (window.comps) {
        const customComps = comps.filter((c) => c.isMine || c.fromCloud);
        localStorage.setItem('fc_custom_comps', JSON.stringify(customComps));
      }
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
    let isCustomVenue = false;
    if (window.venues && row.venue_name) {
      const foundIdx = venues.findIndex((v) => v.name.toLowerCase() === String(row.venue_name).toLowerCase());
      if (foundIdx >= 0) {
        vIdx = foundIdx;
      } else {
        vIdx = -1;
        isCustomVenue = true;
      }
    }
    const initSlots = row.slots_left !== undefined && row.slots_left !== null ? +row.slots_left : 4;
    return {
      id: row.id || 'g_' + (row.created_at || Date.now()),
      title: row.title || 'Open Game',
      v: vIdx,
      isCustomVenue,
      venueName: row.venue_name || (window.venues ? venues[vIdx >= 0 ? vIdx : 0].name : 'Lagos Pitch'),
      pitch: row.pitch_name || 'Main Pitch',
      when: row.match_when || 'Upcoming',
      fmt: row.format || '5-a-side',
      need: +row.players_needed || 10,
      left: initSlots,
      initialLeft: initSlots,
      price: row.price_ngn !== undefined && row.price_ngn !== null ? +row.price_ngn : 0,
      org: row.organiser_name || 'Organiser',
      creator_email: (row.organiser_contact || '').toLowerCase(),
      level: row.skill_level || 'All levels',
      approval: Boolean(row.requires_approval),
      created_at: row.created_at || '',
      fromCloud: true
    };
  },

  getGameRoster(gameOrId) {
    const g = typeof gameOrId === 'object' && gameOrId ? gameOrId : typeof findGame === 'function' ? findGame(gameOrId) : null;
    if (!g) return [];
    const gid = String(g.id);
    const gtitle = String(g.title || '').toLowerCase();
    const allEvs = (this.db.app_events || []).slice().reverse();
    const map = new Map();

    for (const ev of allEvs) {
      const p = ev.properties || {};
      const matchId = p.game_id !== undefined && String(p.game_id) === gid;
      const matchTitle = !p.game_id && p.game_title && String(p.game_title).toLowerCase() === gtitle;
      if (!matchId && !matchTitle) continue;
      const contact = (p.player_contact || ev.user_contact || '').trim();
      const name = (p.player_name || contact.split('@')[0] || 'Player').trim();
      const key = (contact || name || p.permit_code || ev.created_at).toLowerCase();
      if (ev.event_name === 'open_game_joined') {
        map.set(key, {
          name: name || 'Player',
          contact: contact || '',
          permitCode: p.permit_code || 'Confirmed',
          paymentNote: p.payment_note || '',
          joinedAt: ev.created_at || ''
        });
      } else if (ev.event_name === 'open_game_left') {
        map.delete(key);
      }
    }

    if (map.size === 0 && Array.isArray(this.db.game_joins)) {
      for (const j of this.db.game_joins) {
        if (j.game_title && String(j.game_title).toLowerCase() === gtitle) {
          const contact = (j.player_contact || '').trim();
          const name = (j.player_name || contact.split('@')[0] || 'Player').trim();
          const key = (contact || name).toLowerCase();
          if (!map.has(key)) {
            map.set(key, {
              name: name || 'Player',
              contact,
              permitCode: 'Confirmed',
              paymentNote: +j.price_ngn > 0 ? 'Paid' : 'Free',
              joinedAt: j.created_at || ''
            });
          }
        }
      }
    }

    return Array.from(map.values());
  },

  mergeLiveIntoUI() {
    if (!window.games) return;
    const allEvs = this.db.app_events || [];
    const authEmail = window.S && S.authUser && S.authUser.email ? S.authUser.email.toLowerCase() : '';
    const authId = window.S && S.authUser && S.authUser.id ? String(S.authUser.id) : '';
    const cloudGames = (this.db.open_games || []).map((r) => this.rowToUiGame(r));

    // Enrich cloudGames with creator_id from open_game_created events
    const createGameEvs = allEvs.filter((ev) => ev.event_name === 'open_game_created' && ev.properties && ev.properties.game_id);
    for (const cg of cloudGames) {
      const cEv = createGameEvs.find((ev) => String(ev.properties.game_id) === String(cg.id));
      if (cEv && cEv.properties) {
        if (cEv.properties.creator_id) cg.creator_id = cEv.properties.creator_id;
        if (cEv.properties.creator_email && !cg.creator_email) cg.creator_email = String(cEv.properties.creator_email).toLowerCase();
      }
    }

    // Apply any game edits stored in app_events (oldest to newest)
    const editEvents = allEvs
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
        if (p.v !== undefined) {
          target.v = +p.v;
          target.isCustomVenue = +p.v < 0;
        }
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

    // Apply net slot decrements from open_game_joined minus open_game_left events
    const joinEvents = allEvs.filter((ev) => ev.event_name === 'open_game_joined' && ev.properties);
    const leaveEvents = allEvs.filter((ev) => ev.event_name === 'open_game_left' && ev.properties);
    for (const cg of cloudGames) {
      const joinsAfterEdit = joinEvents.filter((ev) => {
        const matchId = ev.properties.game_id && String(ev.properties.game_id) === String(cg.id);
        const matchTitle = !ev.properties.game_id && ev.properties.game_title === cg.title;
        if (!matchId && !matchTitle) return false;
        if (cg.lastEditedAt && ev.created_at && ev.created_at < cg.lastEditedAt) return false;
        return true;
      }).length;
      const leavesAfterEdit = leaveEvents.filter((ev) => {
        const matchId = ev.properties.game_id && String(ev.properties.game_id) === String(cg.id);
        const matchTitle = !ev.properties.game_id && ev.properties.game_title === cg.title;
        if (!matchId && !matchTitle) return false;
        if (cg.lastEditedAt && ev.created_at && ev.created_at < cg.lastEditedAt) return false;
        return true;
      }).length;
      const netJoins = Math.max(0, joinsAfterEdit - leavesAfterEdit);
      if (cg.initialLeft !== undefined) {
        cg.left = Math.max(0, Math.min(+cg.need || 10, cg.initialLeft - netJoins));
      }
    }

    if (cloudGames.length > 0) {
      for (let i = cloudGames.length - 1; i >= 0; i--) {
        const cg = cloudGames[i];
        const existingIdx = games.findIndex((x) => String(x.id) === String(cg.id));
        const matchesAuth = Boolean(
          (authId && cg.creator_id && String(cg.creator_id) === authId) ||
            (authEmail && cg.creator_email && cg.creator_email.toLowerCase() === authEmail)
        );
        if (matchesAuth && window.S) {
          S.myGames = S.myGames || {};
          S.myGames[cg.id] = true;
        }
        if (existingIdx >= 0) {
          const wasMine = authEmail
            ? matchesAuth
            : Boolean(games[existingIdx].isMine || (window.S && S.myGames && S.myGames[cg.id]));
          games[existingIdx] = { ...games[existingIdx], ...cg, isMine: wasMine };
          const [item] = games.splice(existingIdx, 1);
          games.unshift(item);
        } else {
          cg.isMine = authEmail ? matchesAuth : Boolean(window.S && S.myGames && S.myGames[cg.id]);
          games.unshift(cg);
        }
      }
    }

    // Reconstruct & merge real cloud Fixtures (published + live updates)
    if (window.fixtures) {
      const pubFixEvs = allEvs
        .filter((ev) => ev.event_name === 'fixture_published' && ev.properties && ev.properties.fixture_id)
        .slice()
        .reverse();
      const cloudFixMap = {};
      for (const ev of pubFixEvs) {
        const p = ev.properties;
        cloudFixMap[String(p.fixture_id)] = {
          id: String(p.fixture_id),
          h: p.h || 'Home FC',
          a: p.a || 'Away FC',
          t: p.t || 'Upcoming',
          s: p.s || 'Upcoming',
          sc: p.sc || '',
          v: p.v || 'Lagos Pitch',
          comp: p.comp || 'Lagos Grassroots Cup',
          fee: p.fee || 'Free',
          price: +p.price || 0,
          org: p.org || 'Organiser',
          creator_id: p.creator_id || '',
          creator_email: (p.creator_email || ev.user_contact || '').toLowerCase(),
          timeline: Array.isArray(p.timeline) ? p.timeline : [],
          going: 1,
          attended: 0,
          tixSold: 0,
          fromCloud: true
        };
      }
      const updFixEvs = allEvs
        .filter((ev) => ev.event_name === 'fixture_updated' && ev.properties && ev.properties.fixture_id)
        .slice()
        .reverse();
      for (const ev of updFixEvs) {
        const p = ev.properties;
        const target = cloudFixMap[String(p.fixture_id)] || fixtures.find((f) => String(f.id) === String(p.fixture_id));
        if (target) {
          if (p.h !== undefined) target.h = p.h;
          if (p.a !== undefined) target.a = p.a;
          if (p.t !== undefined) target.t = p.t;
          if (p.s !== undefined) target.s = p.s;
          if (p.sc !== undefined) target.sc = p.sc;
          if (p.v !== undefined) target.v = p.v;
          if (p.comp !== undefined) target.comp = p.comp;
          if (p.fee !== undefined) target.fee = p.fee;
          if (p.price !== undefined) target.price = +p.price;
          if (Array.isArray(p.timeline)) target.timeline = p.timeline;
        }
      }
      const cloudFixtures = Object.values(cloudFixMap);
      for (const cf of cloudFixtures) {
        const matchesAuth = Boolean(
          (authId && cf.creator_id && String(cf.creator_id) === authId) ||
            (authEmail && cf.creator_email && cf.creator_email.toLowerCase() === authEmail)
        );
        if (matchesAuth && window.S) {
          S.myFixtures = S.myFixtures || {};
          S.myFixtures[cf.id] = true;
        }
        const idx = fixtures.findIndex((x) => String(x.id) === String(cf.id));
        if (idx >= 0) {
          fixtures[idx] = { ...fixtures[idx], ...cf, isMine: authEmail ? matchesAuth : Boolean(fixtures[idx].isMine || (S.myFixtures && S.myFixtures[cf.id])) };
        } else {
          cf.isMine = authEmail ? matchesAuth : Boolean(S.myFixtures && S.myFixtures[cf.id]);
          fixtures.unshift(cf);
        }
      }
    }

    // Reconstruct & merge real cloud Events (published + updates)
    if (window.events) {
      const pubEvEvs = allEvs
        .filter((ev) => ev.event_name === 'event_published' && ev.properties && ev.properties.event_id)
        .slice()
        .reverse();
      const cloudEvMap = {};
      for (const ev of pubEvEvs) {
        const p = ev.properties;
        cloudEvMap[String(p.event_id)] = {
          id: String(p.event_id),
          im: p.im || 'event1',
          title: p.title || 'Football Event',
          cat: p.cat || 'Grassroots',
          trust: p.trust || 'Organiser-published',
          venue: p.venue || 'Lagos Field',
          when: p.when || 'Upcoming',
          fee: p.fee || 'Free',
          status: p.status || 'Upcoming',
          org: p.org || 'Organiser',
          tix: Boolean(p.tix),
          left: +p.left || 0,
          comp: -1,
          b: '',
          about: p.about || '',
          creator_id: p.creator_id || '',
          creator_email: (p.creator_email || ev.user_contact || '').toLowerCase(),
          going: 1,
          attended: 0,
          tixSold: 0,
          fromCloud: true
        };
      }
      const updEvEvs = allEvs
        .filter((ev) => ev.event_name === 'event_updated' && ev.properties && ev.properties.event_id)
        .slice()
        .reverse();
      for (const ev of updEvEvs) {
        const p = ev.properties;
        const target = cloudEvMap[String(p.event_id)] || events.find((e) => String(e.id) === String(p.event_id));
        if (target) {
          if (p.title !== undefined) target.title = p.title;
          if (p.cat !== undefined) target.cat = p.cat;
          if (p.venue !== undefined) target.venue = p.venue;
          if (p.when !== undefined) target.when = p.when;
          if (p.fee !== undefined) target.fee = p.fee;
          if (p.tix !== undefined) target.tix = Boolean(p.tix);
          if (p.left !== undefined) target.left = +p.left;
          if (p.about !== undefined) target.about = p.about;
        }
      }
      const cloudEvents = Object.values(cloudEvMap);
      for (const ce of cloudEvents) {
        const matchesAuth = Boolean(
          (authId && ce.creator_id && String(ce.creator_id) === authId) ||
            (authEmail && ce.creator_email && ce.creator_email.toLowerCase() === authEmail)
        );
        if (matchesAuth && window.S) {
          S.myEvents = S.myEvents || {};
          S.myEvents[ce.id] = true;
        }
        const idx = events.findIndex((x) => String(x.id) === String(ce.id));
        if (idx >= 0) {
          events[idx] = { ...events[idx], ...ce, isMine: authEmail ? matchesAuth : Boolean(events[idx].isMine || (S.myEvents && S.myEvents[ce.id])) };
        } else {
          ce.isMine = authEmail ? matchesAuth : Boolean(S.myEvents && S.myEvents[ce.id]);
          events.unshift(ce);
        }
      }
    }

    // Hydrate signed-in user's joined games, permits, tickets, and RSVPs across devices
    if (authEmail && window.S) {
      S.joined = S.joined || {};
      S.permits = S.permits || {};
      S.tickets = S.tickets || {};
      S.attending = S.attending || {};
      const chronEvs = allEvs.slice().reverse();
      for (const ev of chronEvs) {
        const evEmail = (ev.user_contact || (ev.properties && ev.properties.spectator_contact) || '').toLowerCase();
        if (evEmail !== authEmail || !ev.properties) continue;
        const p = ev.properties;
        if (ev.event_name === 'open_game_joined' && p.game_id) {
          S.joined[p.game_id] = true;
          if (p.permit_code) S.permits[p.game_id] = p.permit_code;
        } else if (ev.event_name === 'open_game_left' && p.game_id) {
          delete S.joined[p.game_id];
          delete S.permits[p.game_id];
        } else if (ev.event_name === 'ticket_purchased' && p.item_key) {
          S.tickets[p.item_key] = {
            key: p.item_key,
            type: p.item_type || (String(p.item_key).startsWith('f_') ? 'fixture' : 'event'),
            id: p.item_id || String(p.item_key).replace(/^[ef]_/, ''),
            title: p.event_title || 'Match Ticket',
            venue: p.venue || 'Lagos Venue',
            when: 'Confirmed Ticket',
            qty: +p.quantity || 1,
            total: +p.total_ngn || 1500,
            code: p.ticket_code || 'TIX-849201'
          };
        } else if (ev.event_name === 'fixture_rsvp_going' && p.item_key) {
          if (!S.attending[p.item_key] || S.attending[p.item_key].status !== 'attended') {
            S.attending[p.item_key] = {
              key: p.item_key,
              type: p.item_type || (String(p.item_key).startsWith('e_') ? 'event' : 'fixture'),
              id: String(p.item_key).replace(/^[ef]_/, ''),
              title: p.match_title || 'Match',
              venue: p.venue || 'Lagos Pitch',
              when: p.match_when || 'Upcoming',
              status: 'going'
            };
          }
        } else if (ev.event_name === 'fixture_rsvp_cancelled' && p.item_key) {
          delete S.attending[p.item_key];
        } else if (ev.event_name === 'fixture_attendance_verified' && p.item_key) {
          S.attending[p.item_key] = {
            key: p.item_key,
            type: p.item_type || (String(p.item_key).startsWith('e_') ? 'event' : 'fixture'),
            id: String(p.item_key).replace(/^[ef]_/, ''),
            title: p.match_title || 'Match',
            venue: p.venue || 'Lagos Pitch',
            when: p.match_when || 'Matchday',
            status: 'attended'
          };
        }
      }
    }

    if (window.teams && Array.isArray(this.db.teams) && this.db.teams.length > 0) {
      for (let i = this.db.teams.length - 1; i >= 0; i--) {
        const rt = this.db.teams[i];
        if (!rt.team_name) continue;
        const isMyTeam = Boolean(authEmail && rt.owner_contact && String(rt.owner_contact).toLowerCase() === authEmail);
        const existingIdx = teams.findIndex((t) => t.name.toLowerCase() === rt.team_name.toLowerCase());
        if (existingIdx < 0) {
          teams.unshift({
            id: rt.id || 't_' + i,
            name: rt.team_name,
            loc: rt.location || 'Lagos',
            fmt: rt.format || '7-a-side',
            m: 1,
            role: isMyTeam ? 'Owner' : null
          });
        } else if (isMyTeam) {
          teams[existingIdx].role = 'Owner';
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
        .register('./sw.js?v=19', { updateViaCache: 'none' })
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
      // 1. Instant encoded payloads (?g= game, ?m= match fixture, ?e= event, ?c= competition)
      if (params.has('g')) {
        try {
          const decoded = JSON.parse(decodeURIComponent(escape(atob(params.get('g')))));
          if (decoded && decoded.title) {
            const existingIdx = games.findIndex((x) => String(x.id) === String(decoded.id));
            if (existingIdx >= 0) games[existingIdx] = { ...games[existingIdx], ...decoded };
            else games.unshift(decoded);
            this.deepLinkGameId = decoded.id;
            S.stack = [{ s: 'game', a: decoded.id }];
            render();
            return;
          }
        } catch (err) {}
      }
      if (params.has('m')) {
        try {
          const decoded = JSON.parse(decodeURIComponent(escape(atob(params.get('m')))));
          if (decoded && decoded.h) {
            const existingIdx = fixtures.findIndex((x) => String(x.id) === String(decoded.id));
            if (existingIdx >= 0) fixtures[existingIdx] = { ...fixtures[existingIdx], ...decoded };
            else fixtures.unshift(decoded);
            S.stack = [{ s: 'match', a: decoded.id }];
            render();
            return;
          }
        } catch (err) {}
      }
      if (params.has('e')) {
        try {
          const decoded = JSON.parse(decodeURIComponent(escape(atob(params.get('e')))));
          if (decoded && decoded.title) {
            const existingIdx = events.findIndex((x) => String(x.id) === String(decoded.id));
            if (existingIdx >= 0) events[existingIdx] = { ...events[existingIdx], ...decoded };
            else events.unshift(decoded);
            S.stack = [{ s: 'event', a: decoded.id }];
            render();
            return;
          }
        } catch (err) {}
      }
      if (params.has('c')) {
        try {
          const decoded = JSON.parse(decodeURIComponent(escape(atob(params.get('c')))));
          if (decoded && decoded.name) {
            const existingIdx = comps.findIndex((x) => String(x.id) === String(decoded.id));
            if (existingIdx >= 0) comps[existingIdx] = { ...comps[existingIdx], ...decoded };
            else comps.unshift(decoded);
            S.stack = [{ s: 'comp', a: decoded.id }];
            render();
            return;
          }
        } catch (err) {}
      }

      if (params.has('p')) {
        try {
          const decoded = JSON.parse(decodeURIComponent(escape(atob(params.get('p')))));
          if (decoded && decoded.n) {
            const existingIdx = players.findIndex((x) => x.n.toLowerCase() === String(decoded.n).toLowerCase());
            if (existingIdx >= 0) players[existingIdx] = { ...players[existingIdx], ...decoded };
            else players.unshift(decoded);
            if (decoded.card) {
              try {
                const saved = JSON.parse(localStorage.getItem('fc_player_cards') || '{}');
                saved[String(decoded.n).toLowerCase()] = { ...(saved[String(decoded.n).toLowerCase()] || {}), ...decoded.card };
                localStorage.setItem('fc_player_cards', JSON.stringify(saved));
              } catch (e) {}
            }
            S.stack = [{ s: 'player', a: decoded.n }];
            render();
            return;
          }
        } catch (err) {}
      }

      if (params.has('admin') || window.location.hash === '#admin') {
        S.stack = [{ s: 'admin' }];
        render();
      } else if (params.has('player')) {
        const rawName = params.get('player');
        S.stack = [{ s: 'player', a: rawName }];
        render();
      } else if (params.has('comp')) {
        const rawId = params.get('comp');
        S.stack = [{ s: 'comp', a: rawId }];
        render();
      } else if (params.has('game')) {
        const rawId = params.get('game');
        this.deepLinkGameId = rawId;
        S.stack = [{ s: 'game', a: rawId }];
        render();
      } else if (params.has('venue')) {
        const id = +params.get('venue') || 0;
        S.stack = [{ s: 'venue', a: id }];
        render();
      } else if (params.has('event')) {
        const rawId = params.get('event');
        S.stack = [{ s: 'event', a: rawId }];
        render();
      } else if (params.has('match')) {
        const rawId = params.get('match');
        S.stack = [{ s: 'match', a: rawId }];
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
  const v = (window.venues && venues[g.v >= 0 ? g.v : 0]) || venues[0];
  const vName = g.venueName || v.name;
  const playerContact = ((S.authUser && S.authUser.email) || S.user.email || '').trim();
  const playerName = (S.user.name || (playerContact ? playerContact.split('@')[0] : 'Player')).trim();

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
      player_name: playerName,
      player_contact: playerContact,
      price_ngn: +g.price || 0,
      status: g.approval ? 'pending_approval' : 'confirmed'
    },
    'open_game_joined',
    {
      game_id: String(g.id),
      game_title: g.title,
      venue: vName,
      player_name: playerName,
      player_contact: playerContact,
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

window.leaveOpenGame = function (id) {
  const g = findGame(id);
  if (!g || !(S.joined && S.joined[g.id])) return;
  const v = (window.venues && venues[g.v >= 0 ? g.v : 0]) || venues[0];
  const vName = g.venueName || v.name;
  showModal({
    title: 'Leave this open game?',
    sub: `Your player slot in "${g.title}" will be released so another player can join.`,
    icon: 'logout',
    tone: 'warn',
    danger: true,
    meta: [
      ['Game', g.title],
      ['Venue', vName + ' · ' + g.pitch],
      ['When', g.when]
    ],
    primary: 'Yes, Release My Slot',
    secondary: 'Keep My Spot',
    primaryFn: async () => {
      const playerContact = ((S.authUser && S.authUser.email) || S.user.email || '').trim();
      const playerName = (S.user.name || (playerContact ? playerContact.split('@')[0] : 'Player')).trim();
      const oldPermit = (S.permits && S.permits[g.id]) || '';
      delete S.joined[g.id];
      if (S.permits) delete S.permits[g.id];
      g.left = Math.min(+g.need || 10, (+g.left || 0) + 1);
      FCData.persistLocal();

      const payload = {
        game_id: String(g.id),
        game_title: g.title,
        venue: vName,
        player_name: playerName,
        player_contact: playerContact,
        permit_code: oldPermit,
        slots_left: g.left
      };
      const ts = new Date().toISOString();
      FCData.db.app_events.unshift({
        event_name: 'open_game_left',
        screen: 'game',
        user_contact: playerContact,
        properties: payload,
        created_at: ts
      });
      FCData.persistLocal();
      FCData.captureAnalytics('open_game_left', payload);

      if (FCData.isSupabaseConfigured()) {
        const baseUrl = FCData.cfg.supabaseUrl.replace(/\/+$/, '');
        Promise.all([
          FCData.supabaseInsert('app_events', {
            event_name: 'open_game_left',
            screen: 'game',
            user_contact: playerContact,
            properties: payload
          }),
          fetch(`${baseUrl}/rest/v1/open_games?id=eq.${encodeURIComponent(g.id)}`, {
            method: 'PATCH',
            headers: {
              'Content-Type': 'application/json',
              apikey: FCData.cfg.supabaseKey,
              Authorization: `Bearer ${FCData.cfg.supabaseKey}`,
              Prefer: 'return=minimal'
            },
            body: JSON.stringify({ slots_left: +g.left })
          }).catch(() => {})
        ]);
      }

      const topCur = S.stack && S.stack[S.stack.length - 1];
      if (topCur && topCur.s === 'gamePass') {
        S.stack.pop();
      }
      toast('You left the game and released your slot');
      render();
    }
  });
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
  const v = (window.venues && venues[g.v >= 0 ? g.v : 0]) || venues[0];
  const vName = g.venueName || v.name;
  const isFree = !g.price || +g.price === 0;
  S.permits = S.permits || {};
  if (!S.permits[g.id]) {
    S.permits[g.id] = 'FCP-' + Math.floor(100000 + Math.random() * 900000);
  }
  const code = S.permits[g.id];
  return `${hdr('Player entry permit', `<button class="round" onclick="openShare('game','${g.id}')">${ic('share')}</button>`)}
    <div style="text-align:center;padding-top:6px">
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
      <button class="btn sm ghost" style="color:var(--bad)" onclick="leaveOpenGame('${g.id}')">Leave Game (Release Slot)</button>
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
        <div class="row sp"><span class="muted small">Supabase Database &amp; Auth</span><span class="tag ${sbOk ? 'ok' : 'warn'}">${sbOk ? 'Connected ✓' : 'Local Mode'}</span></div>
        <div class="row sp" style="margin-top:8px"><span class="muted small">Signed-In Account</span><span class="tag ${window.S && S.authUser ? 'ok' : 'warn'}">${window.S && S.authUser ? S.authUser.email : 'Guest'}</span></div>
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
        <div class="col" style="margin-top:12px">
          <button class="btn sm" onclick="FCData.pullLiveRecords().then(()=>toast('Synced from Supabase'))">Refresh Live Data</button>
          <button class="btn sm ghost" onclick="FCData.syncAllLocalToSupabase()">Push Local to Cloud</button>
        </div>
      </div>`;
  } else if (k === 'Live Records') {
    const tbls = [
      ['open_games', 'Games'],
      ['event_submissions', 'Fixtures & Events'],
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
