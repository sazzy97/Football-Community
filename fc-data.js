/* ==========================================================================
   Football Community Lagos — Cloud Data, Analytics & PWA Module
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
  adminTable: 'bookings',
  swReady: false,

  init() {
    try {
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
      if (savedDb) this.db = { ...this.db, ...JSON.parse(savedDb) };
    } catch (e) {
      console.warn('Storage init warning:', e);
    }

    if (this.cfg.posthogKey) {
      this.initPostHog();
    }
    if (this.isSupabaseConfigured()) {
      this.pullLiveRecords();
    }
    this.registerPWA();
    this.handleUrlDeepLinks();
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
    } catch (e) {}
  },

  initPostHog() {
    if (!this.cfg.posthogKey) return;
    // Use PostHog HTTP Capture API directly + load web SDK for session replay
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

    // 1. Send via PostHog SDK if loaded, or direct PostHog Capture endpoint
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

  async record(table, rowData, eventName, eventProps = {}) {
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
      await Promise.all([
        this.supabaseInsert(table, rowData),
        this.supabaseInsert('app_events', {
          event_name: logItem.event_name,
          screen: logItem.screen,
          user_contact: logItem.user_contact,
          properties: logItem.properties
        })
      ]);
    }
  },

  async supabaseInsert(table, row) {
    if (!this.isSupabaseConfigured()) return null;
    const baseUrl = this.cfg.supabaseUrl.replace(/\/+$/, '');
    try {
      const res = await fetch(`${baseUrl}/rest/v1/${table}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: this.cfg.supabaseKey,
          Authorization: `Bearer ${this.cfg.supabaseKey}`,
          Prefer: 'return=minimal'
        },
        body: JSON.stringify(row)
      });
      return res.ok;
    } catch (e) {
      console.warn('Supabase sync deferred:', e);
      return false;
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
      const tables = ['users', 'bookings', 'open_games', 'game_joins', 'ticket_orders', 'teams', 'event_submissions'];
      for (const t of tables) {
        const res = await fetch(`${baseUrl}/rest/v1/${t}?select=*&order=created_at.desc&limit=50`, { headers });
        if (res.ok) {
          const rows = await res.json();
          if (Array.isArray(rows) && rows.length > 0) {
            this.db[t] = rows;
          }
        }
      }
      this.persistLocal();
    } catch (e) {
      console.warn('Supabase pull warning:', e);
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
        delete copy.id;
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
      navigator.serviceWorker
        .register('./sw.js')
        .then(() => {
          this.swReady = true;
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
      if (params.has('admin') || window.location.hash === '#admin') {
        S.stack = [{ s: 'admin' }];
        render();
      } else if (params.has('game')) {
        const id = +params.get('game') || 0;
        S.stack = [{ s: 'game', a: id }];
        render();
      } else if (params.has('venue')) {
        const id = +params.get('venue') || 0;
        S.stack = [{ s: 'venue', a: id }];
        render();
      } else if (params.has('event')) {
        const id = +params.get('event') || 0;
        S.stack = [{ s: 'event', a: id }];
        render();
      } else if (params.has('team')) {
        const id = +params.get('team') || 0;
        S.stack = [{ s: 'team', a: id }];
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
    id: 0,
    title: 'Thursday Night 5s',
    sub: 'Lekki Goal Arena · Thu 12 Nov · 20:00',
    url: 'sazzy97.github.io/Football-Community/?game=0'
  };
  const fullUrl = 'https://' + it.url.replace(/^https?:\/\//, '');
  const shareText = `⚽ ${it.title} (${it.type})\n📍 ${it.sub}\n👉 Join on Football Community: ${fullUrl}`;

  FCData.record('app_events', {}, 'content_shared', {
    channel,
    item_type: it.type,
    item_title: it.title,
    url: fullUrl
  });

  if (channel === 'Copy Link') {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(fullUrl).catch(() => {});
    }
    showModal({
      title: 'Link Copied!',
      sub: 'The share link is on your clipboard and ready to paste in WhatsApp or anywhere.',
      meta: [
        ['Item', it.title],
        ['Link', fullUrl]
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
    sub: 'Your ' + it.type.toLowerCase() + ' invite link is ready.',
    meta: [
      ['Shared', it.title],
      ['Channel', channel],
      ['Link', fullUrl]
    ],
    primary: 'Done'
  });
};

/* ===== Join Open Game Helper ===== */
window.joinOpenGame = function (id) {
  const g = games[id || 0], v = venues[g.v];
  S.joined[id || 0] = true;
  FCData.record(
    'game_joins',
    {
      game_title: g.title,
      venue_name: v.name + ' · ' + g.pitch,
      match_when: g.when,
      player_name: S.user.name,
      player_contact: S.user.email,
      price_ngn: g.price,
      status: g.approval ? 'pending_approval' : 'confirmed'
    },
    'open_game_joined',
    { game_title: g.title, venue: v.name, price_ngn: g.price }
  );
  showModal({
    title: g.approval ? 'Join Request Sent!' : 'Spot Reserved!',
    sub: g.approval
      ? 'The organiser (' + g.org + ') will review your request and notify you.'
      : 'Your player slot is confirmed for ' + g.title + '.',
    meta: [
      ['Game', g.title],
      ['Venue', v.name + ' · ' + g.pitch],
      ['When', g.when],
      ['Contribution', N(g.price)]
    ],
    primary: 'View in My Activity',
    primaryFn: () => {
      S.sub.activity = 'Games Joined';
      S.stack = [];
      S.tab = 'activity';
    },
    secondary: 'Share Game',
    secFn: () => openShare('game', id || 0)
  });
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
        <div class="stat-box" onclick="FCData.adminTab='Live Records';FCData.adminTable='ticket_orders';render()"><b>${db.ticket_orders.length}</b><small>Tickets</small></div>
        <div class="stat-box" onclick="FCData.adminTab='Live Records';FCData.adminTable='app_events';render()"><b>${db.app_events.length}</b><small>Events Tracked</small></div>
      </div>
      <div class="card">
        <div class="b">Where do I see all my data?</div>
        <div class="sub small" style="margin-top:6px">
          1. <b>Right here in Live Records:</b> Every signup, pitch booking, game creation, and ticket order is stored immediately and can be exported to Excel/CSV.<br>
          2. <b>Supabase Table Editor:</b> Paste your Supabase URL &amp; Anon Key in the <b>Cloud Keys</b> tab so every user action syncs to your cloud database in real time.<br>
          3. <b>PostHog Dashboard:</b> Paste your PostHog Project Key to watch video session replays and conversion funnels.
        </div>
        <div class="row" style="margin-top:12px">
          <button class="btn sm" onclick="FCData.adminTab='Cloud Keys';render()">Configure Keys</button>
          <button class="btn sm ghost" onclick="FCData.syncAllLocalToSupabase()">Sync to Supabase</button>
        </div>
      </div>`;
  } else if (k === 'Live Records') {
    const tbls = [
      ['bookings', 'Bookings'],
      ['users', 'Users'],
      ['open_games', 'Games'],
      ['game_joins', 'Joins'],
      ['ticket_orders', 'Tickets'],
      ['teams', 'Teams'],
      ['app_events', 'Activity Log']
    ];
    const curT = FCData.adminTable || 'bookings';
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
      <div class="field">Supabase Anon Public Key<input id="cfg_sb_key" value="${FCData.cfg.supabaseKey}" placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6..."></div>
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
