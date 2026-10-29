'use strict';

/* ================================================================ constants */
const INDICES = [
  { key: 'NSE:NIFTY 50', label: 'NIFTY 50' },
  { key: 'NSE:NIFTY BANK', label: 'BANK NIFTY' },
  { key: 'BSE:SENSEX', label: 'SENSEX' },
];
const DEFAULT_WATCH = ['NSE:RELIANCE-EQ', 'NSE:INFY-EQ', 'NSE:TCS-EQ', 'NSE:HDFCBANK-EQ', 'NSE:ICICIBANK-EQ', 'NSE:SBIN-EQ'];
const LIST_COUNT = 5;
const LIST_MAX = 50;
const MODIFIABLE = new Set(['OPEN', 'TRIGGER PENDING', 'AMO REQ RECEIVED']);
const PENDING = new Set([...MODIFIABLE, 'OPEN PENDING', 'VALIDATION PENDING', 'PUT ORDER REQ RECEIVED',
  'MODIFY PENDING', 'MODIFY VALIDATION PENDING', 'CANCEL PENDING']);
const INTERVALS = [['minute', '1m'], ['3minute', '3m'], ['5minute', '5m'], ['15minute', '15m'],
  ['30minute', '30m'], ['60minute', '1H'], ['day', '1D']];
const PALETTE = ['#6d8cff', '#22c58b', '#f5b544', '#ff6a3d', '#b07cff', '#3ec5e0', '#8e97ab'];
const IST_OFFSET = 19800;

const ICONS = {
  x: '<path d="M18 6L6 18M6 6l12 12"/>',
  trash: '<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/>',
  chart: '<path d="M3 3v18h18"/><path d="M7 15l4-4 3 3 5-6"/>',
  depth: '<path d="M4 6h16M4 12h10M4 18h6"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M21 12.8A9 9 0 1111.2 3a7 7 0 009.8 9.8z"/>',
  check: '<circle cx="12" cy="12" r="10"/><path d="M8 12l3 3 5-6"/>',
  alert: '<circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z"/>',
  logout: '<path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
  keyboard: '<rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10"/>',
  wallet: '<path d="M20 12V8H6a2 2 0 010-4h12v4"/><path d="M4 6v12a2 2 0 002 2h14v-4"/><path d="M18 12a2 2 0 000 4h4v-4z"/>',
  box: '<path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/><path d="M3.3 7L12 12l8.7-5M12 22V12"/>',
  trend: '<path d="M3 17l6-6 4 4 8-8"/><path d="M14 7h7v7"/>',
  globe: '<circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15 15 0 010 20M12 2a15 15 0 000 20"/>',
  chevron: '<path d="M6 9l6 6 6-6"/>',
  inbox: '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.5 5.1L2 12v6a2 2 0 002 2h16a2 2 0 002-2v-6l-3.5-6.9A2 2 0 0016.8 4H7.2a2 2 0 00-1.7 1.1z"/>',
  refresh: '<path d="M21 12a9 9 0 11-3-6.7L21 8"/><path d="M21 3v5h-5"/>',
  star: '<path d="M12 2l3 7 7 .6-5.3 4.7 1.6 7.2L12 17.8 5.7 21.5l1.6-7.2L2 9.6 9 9z"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  activity: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
};
const I = (name) => `<svg class="i" viewBox="0 0 24 24">${ICONS[name] || ''}</svg>`;

/* ==================================================================== utils */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nfCache = {};
function fmt(n, d = 2) {
  if (n == null || n === '' || !isFinite(n)) return '—';
  nfCache[d] ||= new Intl.NumberFormat('en-IN', { minimumFractionDigits: d, maximumFractionDigits: d });
  return nfCache[d].format(n);
}
const inr = (n, d = 2) => (n == null || !isFinite(n) ? '—' : (n < 0 ? '-' : '') + '₹' + fmt(Math.abs(n), d));
const signed = (n, d = 2) => (!isFinite(n) ? '—' : (n > 0 ? '+' : '') + fmt(n, d));
const pct = (n) => (n == null || !isFinite(n) ? '—' : signed(n) + '%');
const cls = (n) => (n > 0 ? 'up' : n < 0 ? 'down' : '');
const sum = (arr, f) => arr.reduce((a, x) => a + (+f(x) || 0), 0);
function compact(n) {
  if (!isFinite(n)) return '—';
  const a = Math.abs(n);
  if (a >= 1e7) return (n / 1e7).toFixed(2) + ' Cr';
  if (a >= 1e5) return (n / 1e5).toFixed(2) + ' L';
  return fmt(n, 0);
}
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
const parseKey = (key) => { const i = key.indexOf(':'); return { exchange: key.slice(0, i), tradingsymbol: key.slice(i + 1) }; };
const keyOf = (x) => `${x.exchange}:${x.tradingsymbol}`;
const dp = (inst) => (['CDS', 'BCD'].includes(inst?.exchange) ? 4 : 2);
const isIndex = (inst) => inst.segment === 'INDICES';
const isDeriv = (inst) => (inst.segment ? !['NSE', 'BSE', 'INDICES'].includes(inst.segment) : !['NSE', 'BSE'].includes(inst.exchange));
const qtyInLots = (inst) => ['MCX', 'CDS', 'BCD'].includes(inst.exchange);

const store = {
  get(k, d) { try { const v = localStorage.getItem('nt.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('nt.' + k, JSON.stringify(v)); } catch { /* storage unavailable */ } },
};

function chg(q) {
  if (!q) return { ltp: null, ch: null, p: null };
  const close = q.ohlc?.close;
  const ch = close ? q.last_price - close : (q.net_change || 0);
  return { ltp: q.last_price, ch, p: close ? (ch / close) * 100 : 0 };
}

function fmtExpiry(e) {
  if (!e) return '';
  const d = new Date(e + 'T00:00:00');
  return isNaN(d) ? e : d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
}
function subLabel(it) {
  if (isIndex(it)) return `${it.exchange} · INDEX`;
  if ((it.instrument_type === 'CE' || it.instrument_type === 'PE') && it.expiry) return `${it.exchange} · ${it.name} ${+it.strike} ${it.instrument_type} · ${fmtExpiry(it.expiry)}`;
  if (isDeriv(it) && it.expiry) return `${it.exchange} · ${fmtExpiry(it.expiry)} ${it.instrument_type || ''}`;
  return it.exchange;
}
function istNow() { const d = new Date(); return new Date(d.getTime() + (d.getTimezoneOffset() + 330) * 60000); }
function marketOpen() {
  const t = istNow(); const m = t.getHours() * 60 + t.getMinutes();
  return t.getDay() > 0 && t.getDay() < 6 && m >= 555 && m < 930;
}
const emptyState = (icon, title, msg = '') => `<div class="empty">${I(icon)}<b>${esc(title)}</b>${msg}</div>`;

/* ==================================================================== state */
function loadLists() {
  let lists = store.get('lists', null);
  if (!Array.isArray(lists)) lists = [DEFAULT_WATCH.map((key) => ({ key }))];
  while (lists.length < LIST_COUNT) lists.push([]);
  return lists.slice(0, LIST_COUNT).map((l) => l.filter((it) => it?.key).map((it) => ({ ...parseKey(it.key), ...it })));
}

const S = {
  loggedIn: false, mock: false, view: 'dashboard',
  profile: null, margins: null, quotes: {},
  lists: loadLists(), active: Math.min(store.get('active', 0), LIST_COUNT - 1), selected: 0, expanded: null,
  holdings: [], positions: [], orders: [], trades: [],
  ordersLoaded: false, orderStatus: new Map(), ordersTab: 'open',
  portfolioLoaded: false, sort: {}, tableRows: {}, sigs: {},
  confirm: store.get('confirmOrders', false), // one-click Buy / Sell unless turned on in the menu
  chart: { inst: store.get('chartInst', null), interval: store.get('chartInterval', '15minute'), api: null, seq: 0, loadedFor: null, last: null,
    edits: {}, editsFor: null, pendingProtect: null },
  prot: { items: [], since: -1, sig: '' },
  order: null,
};

/* ====================================================================== api */
async function api(path, opts = {}) {
  let res;
  try {
    res = await fetch('/api' + path, {
      method: opts.method || 'GET',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'kite-ui' },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
  } catch {
    throw new Error('Cannot reach the local server. Is app.py running?');
  }
  let data;
  try { data = await res.json(); } catch { data = { error: `HTTP ${res.status}` }; }
  if (!res.ok) {
    const err = new Error(data.error || 'Request failed');
    err.type = data.error_type;
    err.status = res.status;
    if (data.error_type === 'TokenException' && S.loggedIn) {
      toast('error', 'Session expired', 'Please log in to Kotak Neo again.');
      showLogin();
    }
    throw err;
  }
  return data;
}

/* ================================================================== toasts */
function toast(type, title, msg = '', ms = 5000, action = null) {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `${I(type === 'success' ? 'check' : type === 'error' ? 'alert' : 'info')}
    <div class="body"><b>${esc(title)}</b>${msg ? `<span>${esc(msg)}</span>` : ''}${action ? `<div><button class="act">${esc(action.label)}</button></div>` : ''}</div>
    <button class="icon-btn" aria-label="Dismiss">${I('x')}</button>`;
  const close = () => { el.classList.add('out'); setTimeout(() => el.remove(), 200); };
  el.querySelector('.icon-btn').onclick = close;
  if (action) el.querySelector('.act').onclick = () => { close(); action.fn(); };
  const box = $('#toasts');
  box.append(el);
  while (box.children.length > 4) box.firstElementChild.remove();
  if (ms) setTimeout(close, type === 'error' ? ms * 1.6 : ms);
}

/* ================================================================== modals */
function openModal(html, onClose) {
  const bd = document.createElement('div');
  bd.className = 'backdrop';
  bd.innerHTML = html;
  const close = () => { if (!bd.isConnected) return; bd.remove(); onClose?.(); };
  bd._close = close;
  bd.addEventListener('mousedown', (e) => { if (e.target === bd) close(); });
  bd.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) close(); });
  $('#modal-root').append(bd);
  return { el: bd, close };
}
const topModal = () => $('#modal-root').lastElementChild;

function confirmDialog(title, msg, okLabel = 'Confirm', danger = false) {
  return new Promise((resolve) => {
    const m = openModal(`<div class="dialog" role="dialog"><h2>${esc(title)}</h2><p>${msg}</p>
      <div class="acts"><button class="btn btn-ghost" data-close>Cancel</button>
      <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-ok>${esc(okLabel)}</button></div></div>`,
    () => resolve(false));
    const ok = m.el.querySelector('[data-ok]');
    ok.onclick = () => { m.el.remove(); resolve(true); };
    ok.focus();
  });
}

function showShortcuts() {
  const rows = [['Search instruments', '/'], ['Move in watchlist', '↑ ↓'], ['Buy / Sell selected', 'B / S'],
    ['Market depth', 'D'], ['Open chart', 'C'], ['Remove from watchlist', 'Del'], ['Switch watchlist', '1 – 5'],
    ['Go to Dashboard / Orders', 'G D / G O'], ['Go to Positions / Holdings', 'G P / G H'], ['Go to Chart', 'G C'], ['Trend line / S-R line (chart)', 'Alt+T / Alt+H'], ['Delete selected drawing', 'Del'], ['Go to Option chain', 'G X'],
    ['Toggle theme', 'T'], ['Submit order (in order window)', 'Enter'], ['Close dialogs', 'Esc']];
  openModal(`<div class="dialog"><h2>Keyboard shortcuts</h2><p>Trade without leaving the keyboard.</p>
    <div class="shortcuts">${rows.map(([a, k]) => `<span>${a}</span><div>${k.split(' ').map((x) => (x.length <= 3 && x !== '–' ? `<kbd>${x}</kbd>` : x)).join(' ')}</div>`).join('')}</div>
    <div class="acts"><button class="btn btn-primary" data-close>Got it</button></div></div>`);
}

/* =================================================================== theme */
const currentTheme = () => document.documentElement.dataset.theme || 'dark';
function applyTheme(t) {
  document.documentElement.dataset.theme = t;
  try { localStorage.setItem('nt.theme', t); } catch { /* ignore */ }
  $('#theme-toggle').innerHTML = I(t === 'dark' ? 'sun' : 'moon');
  PANES.forEach((p) => p.api && styleChart(p));
}
const cssVar = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

/* ================================================================ session */
async function boot() {
  applyTheme(currentTheme());
  const params = new URLSearchParams(location.search);
  if (params.has('login_error')) {
    const msg = params.get('login_error');
    $('#login-error').textContent = msg === '1' ? 'Login was cancelled or failed. Please try again.' : msg;
    $('#login-error').classList.remove('hidden');
    history.replaceState(null, '', '/');
  }
  let s = { logged_in: false };
  try { s = await api('/session'); } catch (e) { $('#login-error').textContent = e.message; $('#login-error').classList.remove('hidden'); }
  S.mock = !!s.mock;
  S.needsMpin = s.needs_mpin !== false;
  if (s.logged_in) startApp(); else showLogin();
}

function showLogin() {
  S.loggedIn = false;
  stopPolling();
  $$('#modal-root > *').forEach((m) => m.remove());
  S.order = null;
  $('#app').classList.add('hidden');
  $('#login-screen').classList.remove('hidden');
  if (S.mock) {
    $('#login-fields').classList.add('hidden');
    $('#login-btn').innerHTML = `Enter demo mode ${I('arrow')}`;
    $('#login-foot').textContent = 'Demo mode: simulated prices and orders. Nothing is sent to Kotak.';
  } else {
    $('#login-mpin').classList.toggle('hidden', !S.needsMpin);
    setTimeout(() => $('#login-totp')?.focus(), 50);
  }
}

async function startApp() {
  S.loggedIn = true;
  $('#login-screen').classList.add('hidden');
  $('#app').classList.remove('hidden');
  $('#demo-badge').classList.toggle('hidden', !S.mock);
  renderWatchTabs();
  renderWatchlist();
  renderIndices();
  switchView(store.get('view', 'dashboard'));
  await Promise.allSettled([loadProfile(), loadMargins(), loadOrders(), loadPortfolio(), loadProtections()]);
  hydrateLists();
  startPolling();
}

async function submitLogin(ev) {
  ev.preventDefault();
  const btn = $('#login-btn'), errEl = $('#login-error');
  const body = S.mock ? {} : { totp: $('#login-totp').value.trim(), mpin: $('#login-mpin').value.trim() };
  btn.disabled = true;
  errEl.classList.add('hidden');
  try {
    await api('/login', { method: 'POST', body });
    $('#login-totp').value = ''; $('#login-mpin').value = '';
    startApp();
  } catch (e) {
    errEl.textContent = e.message; errEl.classList.remove('hidden');
    $('#login-totp').select();
  } finally { btn.disabled = false; }
}

async function logout() {
  if (!(await confirmDialog('Log out?', 'You will need to sign in to Kotak Neo again to trade.', 'Log out', true))) return;
  try { await api('/logout', { method: 'POST' }); } catch { /* session may already be gone */ }
  showLogin();
}

/* ================================================================ polling */
const timers = [];
function every(ms, fn) {
  const t = { stopped: false };
  const loop = async () => {
    if (t.stopped) return;
    if (!document.hidden && S.loggedIn) { try { await fn(); } catch { /* surfaced elsewhere */ } }
    if (!t.stopped) t.id = setTimeout(loop, ms);
  };
  t.id = setTimeout(loop, ms);
  t.stop = () => { t.stopped = true; clearTimeout(t.id); };
  timers.push(t);
}
// One request per refresh at a time: while Kotak is slow, repeated calls would otherwise pile up
// and use all of the browser's few connections to this server, freezing everything else.
// A call made while one is running asks for exactly one more run after it.
function singleFlight(fn) {
  let running = null; let again = false;
  const run = () => {
    running = Promise.resolve().then(fn).finally(() => {
      running = null;
      if (again) { again = false; run().catch(() => {}); }
    });
    return running;
  };
  return () => { if (running) { again = true; return running; } return run(); };
}

function startPolling() {
  stopPolling();
  startStream();
  refreshQuotes();
  every(2000, refreshQuotes);
  every(4000, loadOrders);
  every(4000, loadProtections);
  every(8000, () => (['dashboard', 'positions', 'holdings', 'chart'].includes(S.view) ? loadPortfolio() : null));
  every(4000, () => (S.view === 'options' ? loadPortfolio() : null));
  every(30000, loadMargins);
}
function stopPolling() { while (timers.length) timers.pop().stop(); stopStream(); }

let quoteInFlight = false;
let lastQuoteAt = 0;
// Everything currently on screen that needs a live price.
function wantedKeys() {
  const keys = new Set(INDICES.map((i) => i.key));
  currentList().forEach((i) => keys.add(i.key));
  if (S.order) keys.add(S.order.inst.key);
  if (S.view === 'chart') visiblePanes().forEach((p) => p.inst && keys.add(p.inst.key));
  if (S.view === 'options' && S.oc.data) {
    keys.add(S.oc.data.spot);
    S.oc.keys.forEach((k) => keys.add(k));
    S.positions.forEach((p) => { if (p.quantity && DERIV_EXCH.has(p.exchange)) keys.add(keyOf(p)); });
  }
  return keys;
}

// Prices arrive over the live stream; REST polling is only the fallback when it is down.
async function refreshQuotes() {
  // Watchdog: the server sends something at least every 15 s. A stream that has gone
  // silent (a half-dead connection after a network blip) is reopened instead of
  // leaving prices frozen.
  if (LIVE.connected && Date.now() - LIVE.lastMsg > 40000) startStream();
  if (LIVE.connected) syncStreamKeys();
  // Poll REST quotes unless ticks are really flowing: the browser can be connected to this
  // server while the server's own feed from the broker is down.
  if (LIVE.connected && LIVE.status === 'live') return;
  if (quoteInFlight) return;
  const wait = 1050 - (Date.now() - lastQuoteAt); // keep REST quote polling to ~1 request / second
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  const keys = wantedKeys();
  quoteInFlight = true;
  try {
    const data = await api('/quote?' + [...keys].map((k) => 'i=' + encodeURIComponent(k)).join('&'));
    for (const [k, q] of Object.entries(data)) {
      const prev = S.quotes[k];
      q._dir = prev ? Math.sign(q.last_price - prev.last_price) : 0;
      S.quotes[k] = q;
    }
    updatePrices();
  } finally {
    quoteInFlight = false;
    lastQuoteAt = Date.now();
  }
}
const quotesSoon = debounce(() => refreshQuotes().catch(() => {}), 120);


/* ============================================================ live stream */
// The server keeps one Kotak Neo market-data WebSocket and pushes ticks here over Server-Sent
// Events (within ~15 ms of each tick). Order postbacks arrive on the same stream.
const LIVE = { es: null, cid: Math.random().toString(36).slice(2, 12), connected: false, sig: '', status: 'off', retry: null, lastMsg: 0 };

function setLiveStatus(status) {
  LIVE.status = status;
  const el = $('#live-pill');
  if (!el) return;
  const live = LIVE.connected && status === 'live';
  el.className = `live-pill ${live ? 'on' : LIVE.connected ? 'wait' : 'off'}`;
  el.lastElementChild.textContent = live ? 'LIVE' : LIVE.connected ? 'CONNECTING' : 'POLLING';
  el.title = live ? 'Streaming ticks in real time from the Kotak Neo feed'
    : LIVE.connected ? 'Connecting to the Kotak Neo feed…' : 'Live stream unavailable: refreshing prices every 2 s';
}

function startStream() {
  stopStream();
  if (!window.EventSource) return;
  const es = new EventSource(`/api/stream?cid=${LIVE.cid}`);
  LIVE.es = es;
  const seen = () => { LIVE.lastMsg = Date.now(); };
  es.onopen = () => { seen(); LIVE.connected = true; LIVE.sig = ''; syncStreamKeys(); setLiveStatus(LIVE.status); };
  es.addEventListener('ping', seen);
  es.addEventListener('status', (e) => { seen(); setLiveStatus(JSON.parse(e.data).status); });
  es.addEventListener('ticks', (e) => { seen(); onTicks(JSON.parse(e.data)); });
  es.addEventListener('order', () => { seen(); ordersSoon(); });
  es.onerror = () => { LIVE.connected = false; setLiveStatus('off'); }; // EventSource retries on its own
}

function stopStream() {
  LIVE.es?.close();
  LIVE.es = null;
  LIVE.connected = false;
  setLiveStatus('off');
}

// Market depth is only streamed for instruments where it is on screen.
function depthKeys() {
  const keys = new Set();
  if (S.order) keys.add(S.order.inst.key);
  if (S.expanded) keys.add(S.expanded);
  return [...keys];
}

async function syncStreamKeys() {
  const keys = [...wantedKeys()].sort();
  const depth = depthKeys().sort();
  const sig = keys.join('|') + '#' + depth.join('|');
  if (sig === LIVE.sig || !LIVE.connected) return;
  LIVE.sig = sig;
  try {
    await api('/stream/subscribe', { method: 'POST', body: { cid: LIVE.cid, keys, depth } });
  } catch (e) {
    LIVE.sig = ''; // retry on next sync
    if (e.status === 404) startStream(); // the server no longer knows this stream: reopen it
  }
}

let ticksPending = false;
function onTicks(ticks) {
  for (const [k, q] of Object.entries(ticks)) {
    const prev = S.quotes[k];
    const next = prev ? { ...prev, ...q } : q;
    next._dir = prev ? Math.sign(q.last_price - prev.last_price) : 0;
    S.quotes[k] = next;
  }
  if (ticksPending) return;
  ticksPending = true;
  const flush = () => { ticksPending = false; updatePrices(); };
  // rAF is paused in background tabs; keep candles and P&L ticking there with a timer.
  if (document.hidden) setTimeout(flush, 250); else requestAnimationFrame(flush);
}

const ordersSoon = debounce(() => {
  loadOrders().catch(() => {});
  setTimeout(() => loadPortfolio().catch(() => {}), 300);
  loadProtections().catch(() => {});
}, 150);

/* =================================================================== data */
async function loadProfile() {
  S.profile = await api('/profile');
  const p = S.profile;
  const initials = (p.user_name || p.user_id || '?').split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
  $('#avatar').textContent = initials;
  renderCurrent('dashboard');
}

async function loadMargins() {
  S.margins = await api('/margins');
  renderCurrent('dashboard');
}

async function loadPortfolio() {
  // Loaded independently: a holdings failure must never hide open positions (or vice versa).
  const [h, p] = await Promise.allSettled([api('/holdings'), api('/positions')]);
  if (h.status === 'fulfilled') S.holdings = h.value || [];
  if (p.status === 'fulfilled') {
    ensureInstCache(p.value?.net || []);
    S.positions = p.value?.net || [];
  }
  if (h.status === 'rejected' && p.status === 'rejected') throw p.reason;
  S.portfolioLoaded = true;
  renderCurrent();
  refreshChartTrades();
}

async function loadProtections() {
  const r = await api(`/protections?since=${S.prot.since}`);
  for (const e of r.events) toast(e.kind, e.title, e.text, 7000);
  if (r.events.length) { loadPortfolio().catch(() => {}); loadMargins().catch(() => {}); }
  S.prot.since = r.last_event;
  const sig = JSON.stringify(r.items);
  if (sig !== S.prot.sig) {
    S.prot.sig = sig;
    S.prot.items = r.items;
    renderCurrent();
    refreshChartTrades();
  }
}

async function loadOrders() {
  const [o, t] = await Promise.allSettled([api('/orders'), api('/trades')]);
  if (o.status === 'rejected') throw o.reason;
  const orders = o.value;
  const trades = t.status === 'fulfilled' ? t.value : S.trades;
  orders.sort((a, b) => String(b.order_timestamp).localeCompare(String(a.order_timestamp)));
  let filled = false;
  for (const o of orders) {
    const prev = S.orderStatus.get(o.order_id);
    if (S.ordersLoaded && prev !== o.status) { notifyOrder(o, prev); if (o.status === 'COMPLETE') filled = true; }
    S.orderStatus.set(o.order_id, o.status);
  }
  S.ordersLoaded = true;
  ensureInstCache(orders);
  S.orders = orders;
  S.trades = (trades || []).sort((a, b) => String(b.fill_timestamp).localeCompare(String(a.fill_timestamp)));
  const open = orders.filter((o) => PENDING.has(o.status)).length;
  $('#open-count').textContent = open;
  $('#open-count').classList.toggle('hidden', !open);
  renderCurrent();
  refreshChartTrades();
  if (filled) { loadPortfolio().catch(() => {}); loadMargins().catch(() => {}); }
}

function notifyOrder(o, prev) {
  const what = `${o.transaction_type} ${prettyKey(o)}`;
  const isExitLeg = o.tag === 'ktTP' || o.tag === 'ktSL';
  if (o.status === 'COMPLETE') {
    toast('success', `${what} executed`, `${o.filled_quantity} qty @ ${inr(o.average_price)}`, 8000,
      isExitLeg ? null : { label: 'Set TP / SL on chart', fn: () => openChart(o, { protect: o.product }) });
  }
  else if (o.status === 'REJECTED') toast('error', `${what} rejected`, o.status_message || 'Rejected by the exchange / RMS');
  else if (o.status === 'CANCELLED' && prev) toast('info', `${what} cancelled`, `Order #${o.order_id}`);
}

// Every watchlist item is checked against today's instrument master: details are refreshed,
// and symbols Kotak no longer lists (renamed after a corporate action, delisted, expired)
// are flagged instead of silently showing no price.
S.notListed = new Set();
async function hydrateLists() {
  const keys = new Set(S.lists.flat().map((it) => it.key));
  if (S.chart.inst) keys.add(S.chart.inst.key);
  if (!keys.size) return;
  try {
    const all = [...keys];
    const found = {};
    for (let i = 0; i < all.length; i += 200) { // the lookup endpoint takes 200 keys at a time
      Object.assign(found, await api('/instruments/lookup?' + all.slice(i, i + 200).map((k) => 'i=' + encodeURIComponent(k)).join('&')));
    }
    S.notListed = new Set(all.filter((k) => !found[k]));
    S.lists = S.lists.map((l) => l.map((it) => (found[it.key] ? { ...it, ...slim(found[it.key]) } : it)));
    if (S.chart.inst && found[S.chart.inst.key]) S.chart.inst = { ...S.chart.inst, ...slim(found[S.chart.inst.key]) };
    saveLists();
    renderWatchlist();
  } catch { /* instrument master unavailable; items still quote fine */ }
}

async function resolveInst(partial) {
  const key = partial.key || keyOf(partial);
  const base = { ...partial, key, ...parseKey(key) };
  if (base.segment && base.lot_size) return base;
  const known = S.lists.flat().find((i) => i.key === key && i.segment);
  if (known) return { ...known, ...base, ...slim(known) };
  try {
    const found = await api('/instruments/lookup?i=' + encodeURIComponent(key));
    if (found[key]) return { ...base, ...slim(found[key]) };
  } catch { /* fall through */ }
  return { lot_size: 1, tick_size: 0.05, segment: base.exchange, ...base };
}

/* ============================================================== watchlist */
const currentList = () => S.lists[S.active];
function slim(i) {
  const o = { key: i.key || keyOf(i) };
  for (const k of ['exchange', 'tradingsymbol', 'name', 'instrument_token', 'lot_size', 'tick_size',
    'segment', 'instrument_type', 'expiry', 'strike']) if (i[k] != null && i[k] !== '') o[k] = i[k];
  return o;
}
const saveLists = () => store.set('lists', S.lists.map((l) => l.map(slim)));

function renderWatchTabs() {
  $('#wl-tabs').innerHTML = S.lists.map((_, i) =>
    `<button class="${i === S.active ? 'active' : ''}" data-list="${i}" title="Watchlist ${i + 1} (${i + 1})">${i + 1}</button>`).join('');
}

function switchList(i) {
  if (i === S.active) return;
  S.active = i; S.selected = 0; S.expanded = null;
  store.set('active', i);
  renderWatchTabs(); renderWatchlist(); quotesSoon();
}

const rowEls = new Map();
function renderWatchlist() {
  const list = currentList();
  rowEls.clear();
  $('#wl-name').textContent = `Watchlist ${S.active + 1}`;
  $('#wl-count').textContent = `${list.length} / ${LIST_MAX}`;
  if (!list.length) {
    $('#watchlist').innerHTML = `<div class="wl-empty">${I('star')}<div style="color:var(--text);font-weight:600;margin-bottom:4px">This watchlist is empty</div>
      <div style="font-size:13px">Press <kbd>/</kbd> to search, then <kbd>Enter</kbd> to add an instrument.</div></div>`;
    return;
  }
  S.selected = Math.max(0, Math.min(S.selected, list.length - 1));
  $('#watchlist').innerHTML = list.map((it, idx) => `
    <div class="wl-row${idx === S.selected ? ' selected' : ''}" data-idx="${idx}">
      <div class="wl-main">
        <div class="wl-sym"><span class="sym">${esc(it.tradingsymbol)}</span>${S.notListed.has(it.key)
          ? `<span class="sub warn" title="Kotak's scrip master for today has no ${esc(it.key)}. The symbol was probably renamed (e.g. after a demerger) or delisted. Remove it and search for the company again.">Not listed at Kotak today · renamed?</span>`
          : `<span class="sub">${esc(subLabel(it))}</span>`}</div>
        <div class="wl-px"><span class="ltp num">—</span><span class="chg num">&nbsp;</span></div>
        <div class="wl-actions">
          ${isIndex(it) ? '' : '<button class="mini-btn b" data-act="buy" title="Buy (B)">B</button><button class="mini-btn s" data-act="sell" title="Sell (S)">S</button>'}
          <button class="mini-btn" data-act="depth" title="Market depth (D)">${I('depth')}</button>
          <button class="mini-btn" data-act="chart" title="Chart (C)">${I('chart')}</button>
          <button class="mini-btn" data-act="remove" title="Remove (Del)">${I('trash')}</button>
        </div>
      </div>
      <div class="wl-depth${S.expanded === it.key ? '' : ' hidden'}"></div>
    </div>`).join('');
  $$('#watchlist .wl-row').forEach((el) => rowEls.set(list[+el.dataset.idx].key, el));
  updatePrices();
}

function selectRow(idx, scroll) {
  const list = currentList();
  if (!list.length) return;
  S.selected = Math.max(0, Math.min(idx, list.length - 1));
  $$('#watchlist .wl-row').forEach((el) => el.classList.toggle('selected', +el.dataset.idx === S.selected));
  if (scroll) $(`#watchlist .wl-row[data-idx="${S.selected}"]`)?.scrollIntoView({ block: 'nearest' });
}

function toggleDepth(it) {
  S.expanded = S.expanded === it.key ? null : it.key;
  rowEls.forEach((el, key) => el.querySelector('.wl-depth').classList.toggle('hidden', key !== S.expanded));
  updatePrices();
  quotesSoon(); // start/stop streaming depth for this row
}

function addToList(inst) {
  const list = currentList();
  const key = inst.key || keyOf(inst);
  const at = list.findIndex((i) => i.key === key);
  if (at >= 0) { selectRow(at, true); toast('info', `${inst.tradingsymbol} is already in this watchlist`, '', 2500); return; }
  if (list.length >= LIST_MAX) { toast('error', 'Watchlist is full', `Max ${LIST_MAX} instruments per list.`); return; }
  list.push(slim({ ...inst, key }));
  saveLists();
  S.selected = list.length - 1;
  renderWatchlist();
  selectRow(S.selected, true);
  quotesSoon();
}

function removeFromList(idx) {
  const list = currentList();
  const [it] = list.splice(idx, 1);
  if (!it) return;
  if (S.expanded === it.key) S.expanded = null;
  saveLists();
  renderWatchlist();
  toast('info', `Removed ${it.tradingsymbol}`, '', 2000);
}

function flash(el, dir) {
  if (!dir) return;
  el.classList.remove('flash-up', 'flash-down');
  void el.offsetWidth;
  el.classList.add(dir > 0 ? 'flash-up' : 'flash-down');
  setTimeout(() => el.classList.remove('flash-up', 'flash-down'), 350);
}

function depthHTML(q, inst, clickable = false) {
  const d = q?.depth;
  if (!q) return '<div class="muted" style="padding:10px 0;font-size:12px">Waiting for quote…</div>';
  const n = dp(inst);
  const stats = `<div class="depth-stats">
    <div>Open<b class="num">${fmt(q.ohlc?.open, n)}</b></div><div>High<b class="num">${fmt(q.ohlc?.high, n)}</b></div>
    <div>Low<b class="num">${fmt(q.ohlc?.low, n)}</b></div><div>Prev close<b class="num">${fmt(q.ohlc?.close, n)}</b></div>
    ${q.volume != null ? `<div>Volume<b class="num">${compact(q.volume)}</b></div>` : ''}
    ${q.average_price ? `<div>Avg price<b class="num">${fmt(q.average_price, n)}</b></div>` : ''}
    ${q.lower_circuit_limit ? `<div>Lower ckt<b class="num">${fmt(q.lower_circuit_limit, n)}</b></div><div>Upper ckt<b class="num">${fmt(q.upper_circuit_limit, n)}</b></div>` : ''}
  </div>`;
  if (!d || (!d.buy?.length && !d.sell?.length)) return `<div class="muted" style="padding:8px 0 0;font-size:12px">No market depth for this instrument.</div>${stats}`;
  const max = Math.max(1, ...d.buy.map((x) => x.quantity), ...d.sell.map((x) => x.quantity));
  const side = (rows, kind, total) => `<table class="${kind}"><thead><tr><th>${kind === 'bid' ? 'Bid' : 'Offer'}</th><th>Orders</th><th>Qty</th></tr></thead><tbody>
    ${rows.map((r) => `<tr class="${clickable ? 'lvl' : ''}" data-price="${r.price}" style="background:linear-gradient(to left, var(--${kind === 'bid' ? 'buy' : 'sell'}-soft) ${(r.quantity / max) * 100}%, transparent 0)">
      <td class="num">${fmt(r.price, n)}</td><td class="num">${r.orders}</td><td class="num">${fmt(r.quantity, 0)}</td></tr>`).join('')}
    <tr class="total"><td>Total</td><td></td><td class="num">${compact(total)}</td></tr></tbody></table>`;
  return `<div class="depth">${side(d.buy, 'bid', q.buy_quantity ?? sum(d.buy, (x) => x.quantity))}${side(d.sell, 'ask', q.sell_quantity ?? sum(d.sell, (x) => x.quantity))}</div>${stats}`;
}

/* ===================================================== live price updates */
function renderIndices() {
  $('#indices').innerHTML = INDICES.map((ix) => {
    const c = chg(S.quotes[ix.key]);
    return `<div class="idx" title="${ix.key}"><div class="n">${ix.label}</div>
      <div><span class="v num">${fmt(c.ltp)}</span><span class="c num ${cls(c.ch)}">${c.p == null ? '' : pct(c.p)}</span></div></div>`;
  }).join('');
  const dash = $('#dash-idx');
  if (dash) {
    dash.innerHTML = INDICES.map((ix) => {
      const c = chg(S.quotes[ix.key]);
      return `<div class="idx-card"><div class="n">${ix.label}</div><div class="v num">${fmt(c.ltp)}</div>
        <div class="c num ${cls(c.ch)}">${c.ch == null ? '&nbsp;' : `${signed(c.ch)} (${pct(c.p)})`}</div></div>`;
    }).join('');
  }
}

function updatePrices() {
  renderIndices();
  const list = currentList();
  for (const [key, el] of rowEls) {
    const q = S.quotes[key];
    if (!q) continue;
    const it = list.find((i) => i.key === key) || parseKey(key);
    if (!it.instrument_token && q.instrument_token) it.instrument_token = q.instrument_token;
    const c = chg(q);
    const ltpEl = el.querySelector('.ltp');
    const txt = fmt(c.ltp, dp(it));
    if (ltpEl.textContent !== txt) { ltpEl.textContent = txt; flash(ltpEl, q._dir); }
    ltpEl.className = `ltp num ${cls(c.ch)}`;
    const chEl = el.querySelector('.chg');
    chEl.textContent = `${signed(c.ch, dp(it))}  ${pct(c.p)}`;
    chEl.className = `chg num ${cls(c.ch)}`;
    if (S.expanded === key) el.querySelector('.wl-depth').innerHTML = depthHTML(q, it);
  }
  if (S.order) updateOrderQuote();
  if (S.view === 'chart') visiblePanes().forEach((p) => updateChartQuote(p));
  if (S.view === 'options') updateChain();
}

/* ================================================================= search */
let searchSeq = 0;
let searchItems = [];
let searchIdx = 0;

const runSearch = debounce(async (q) => {
  const seq = ++searchSeq;
  if (!q.trim()) { hideSearch(); return; }
  const box = $('#search-results');
  if (box.classList.contains('hidden') || !searchItems.length) {
    box.innerHTML = '<div class="sr-empty">Searching…</div>';
    box.classList.remove('hidden');
  }
  let res;
  try { res = await api('/instruments/search?q=' + encodeURIComponent(q)); } catch (e) {
    if (seq === searchSeq) box.innerHTML = `<div class="sr-empty">${esc(e.message)}</div>`;
    return;
  }
  if (seq !== searchSeq) return;
  searchItems = res.map((i) => ({ ...i, key: keyOf(i) }));
  searchIdx = 0;
  renderSearch(q);
}, 140);

function renderSearch(q) {
  const box = $('#search-results');
  box.classList.remove('hidden');
  if (!searchItems.length) { box.innerHTML = `<div class="sr-empty">No instruments match “${esc(q)}”</div>`; return; }
  box.innerHTML = searchItems.map((it, i) => {
    const sub = isDeriv(it) && it.expiry
      ? `${fmtExpiry(it.expiry)} · ${it.instrument_type}${it.strike ? ' · ' + fmt(it.strike, 0) : ''} · Lot ${it.lot_size}`
      : (it.name || '');
    return `<div class="sr-item${i === searchIdx ? ' active' : ''}" data-i="${i}">
      <div class="meta"><div class="sym">${esc(it.tradingsymbol)}</div><div class="name">${esc(sub)}</div></div>
      <span class="chip">${esc(isIndex(it) ? 'INDEX' : it.exchange)}</span>
      <div class="acts">
        ${isIndex(it) ? '' : '<button class="mini-btn b" data-act="buy">B</button><button class="mini-btn s" data-act="sell">S</button>'}
        <button class="mini-btn" data-act="chart" title="Chart">${I('chart')}</button>
        <button class="mini-btn" data-act="add" title="Add to watchlist">+</button>
      </div></div>`;
  }).join('');
}

function hideSearch() { $('#search-results').classList.add('hidden'); searchItems = []; }
function moveSearch(d) {
  if (!searchItems.length) return;
  searchIdx = (searchIdx + d + searchItems.length) % searchItems.length;
  $$('#search-results .sr-item').forEach((el) => el.classList.toggle('active', +el.dataset.i === searchIdx));
  $(`#search-results .sr-item[data-i="${searchIdx}"]`)?.scrollIntoView({ block: 'nearest' });
}
function searchAction(it, act) {
  if (act === 'buy' || act === 'sell') openOrder(it, act.toUpperCase());
  else if (act === 'chart') openChart(it);
  else addToList(it);
  $('#search').value = '';
  hideSearch();
  if (act === 'add' || !act) $('#search').blur();
}

/* ================================================================== views */
const section = (v) => $(`.view[data-view="${v}"]`);

function switchView(v) {
  if (!section(v)) v = 'dashboard';
  S.view = v;
  store.set('view', v);
  $$('.view').forEach((el) => el.classList.toggle('hidden', el.dataset.view !== v));
  $$('#nav button').forEach((b) => b.classList.toggle('active', b.dataset.view === v));
  S.sigs[v] = null;
  if (v === 'chart') loadCharts();
  else renderCurrent(v);
  if (['dashboard', 'positions', 'holdings', 'chart', 'options'].includes(v) && S.loggedIn) loadPortfolio().catch(() => {});
  if (v === 'options' && S.loggedIn) { if (!S.oc.data && !S.oc.loading) loadChain(); else quotesSoon(); }
}

function renderCurrent(only) {
  const v = S.view;
  if (only && only !== v) return;
  const renderers = { dashboard: renderDashboard, orders: renderOrders, positions: renderPositions, holdings: renderHoldings, options: renderOptions };
  const fn = renderers[v];
  if (!fn) return;
  const sig = JSON.stringify([v, S.sort, S.ordersTab, v === 'dashboard' ? [S.profile, S.margins, S.holdings, S.positions, S.orders.length] :
    v === 'orders' ? [S.orders, S.trades, S.ordersLoaded] : v === 'options' ? [S.oc.underlying, S.oc.expiry, S.oc.range, S.oc.loading, !!S.oc.data, S.oc.error,
      S.positions.map((x) => [x.tradingsymbol, x.product, x.quantity, x.average_price, x.quantity ? 0 : x.pnl]), S.instCache.size] :
    v === 'positions' ? [S.positions, S.portfolioLoaded, S.prot.items, S.instCache.size] : [S.holdings, S.portfolioLoaded]]);
  if (S.sigs[v] === sig) return;
  S.sigs[v] = sig;
  fn(section(v));
}

/* ------------------------------------------------------------- tables */
function table(id, cols, rows, { empty, foot, rowClass } = {}) {
  const st = S.sort[id];
  if (st) {
    const c = cols.find((x) => x.key === st.key);
    if (c?.sort) rows = [...rows].sort((a, b) => { const x = c.sort(a); const y = c.sort(b); return (x > y ? 1 : x < y ? -1 : 0) * st.dir; });
  }
  S.tableRows[id] = rows;
  if (!rows.length) return `<div class="table-wrap">${empty}</div>`;
  return `<div class="table-wrap"><table class="tbl" data-table="${id}"><thead><tr>${cols.map((c) =>
    `<th class="${c.r ? 'r' : ''}${c.sort ? ' sortable' : ''}" data-key="${c.key}">${c.label}${st?.key === c.key ? `<span class="arrow">${st.dir > 0 ? '▲' : '▼'}</span>` : ''}</th>`).join('')}</tr></thead>
    <tbody>${rows.map((r, i) => `<tr class="${rowClass ? rowClass(r) : ''}" data-row="${i}">${cols.map((c) => `<td class="${c.r ? 'r' : ''}">${c.html(r)}</td>`).join('')}</tr>`).join('')}</tbody>
    ${foot ? `<tfoot><tr>${foot}</tr></tfoot>` : ''}</table></div>`;
}
const symCell = (r) => {
  const i = S.instCache.get(keyOf(r));
  if (isOptionInst(i)) return `<span class="sym" title="${esc(r.tradingsymbol)}">${esc(optLabel(i))}<small>${fmtExpiry(i.expiry)} · ${esc(r.exchange)}</small></span>`;
  return `<span class="sym">${esc(r.tradingsymbol)}<small>${esc(r.exchange)}</small></span>`;
};
const acts = (...btns) => `<div class="row-acts">${btns.join('')}</div>`;
const actBtn = (act, label, kind = '') => `<button class="mini-btn ${kind}" data-act="${act}">${label}</button>`;

/* ------------------------------------------------------------- dashboard */
function greeting() {
  const h = istNow().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

function fundsCard(title, seg, icon) {
  if (!seg) return `<div class="card"><h3>${I(icon)} ${title}</h3><div class="skeleton" style="height:28px;width:60%"></div>
    <div class="skeleton" style="margin-top:18px"></div><div class="skeleton" style="margin-top:10px;width:80%"></div></div>`;
  const avail = seg.net;
  const used = seg.utilised?.debits || 0;
  const pctUsed = avail + used > 0 ? Math.min(100, (used / (avail + used)) * 100) : 0;
  return `<div class="card"><h3>${I(icon)} ${title} <span class="right">${seg.enabled === false ? '<span class="chip">Disabled</span>' : ''}</span></h3>
    <div class="muted" style="font-size:12px;margin-bottom:2px">Margin available</div>
    <div class="big num">${inr(avail)}</div>
    <div class="meter"><div style="width:${pctUsed}%"></div></div>
    <div class="kv"><span>Margins used</span><b class="num">${inr(used)}</b></div>
    <div class="kv"><span>Opening balance</span><b class="num">${inr(seg.available?.opening_balance)}</b></div></div>`;
}

function holdingsSummary() {
  const h = S.holdings;
  const inv = sum(h, (x) => x.average_price * (x.quantity + (x.t1_quantity || 0)));
  const cur = sum(h, (x) => x.last_price * (x.quantity + (x.t1_quantity || 0)));
  const day = sum(h, (x) => (x.day_change || 0) * (x.quantity + (x.t1_quantity || 0)));
  return { inv, cur, pnl: cur - inv, pnlPct: inv ? ((cur - inv) / inv) * 100 : 0, day, dayPct: cur - day ? (day / (cur - day)) * 100 : 0 };
}

function renderDashboard(el) {
  const p = S.profile;
  const name = p ? (p.user_shortname || (p.user_name || '').split(' ')[0]) : '';
  const H = holdingsSummary();
  const posPnl = sum(S.positions, (x) => x.pnl);
  const openPos = S.positions.filter((x) => x.quantity).length;
  const openOrders = S.orders.filter((o) => PENDING.has(o.status)).length;
  const movers = [...S.holdings].sort((a, b) => Math.abs(b.day_change_percentage || 0) - Math.abs(a.day_change_percentage || 0)).slice(0, 5);
  const isOpen = marketOpen();
  const today = istNow().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' });
  el.innerHTML = `
    <div class="view-head">
      <div><h1>${greeting()}${name ? ', ' + esc(name) : ''}</h1>
        <p style="display:flex;align-items:center;gap:10px">${today}
          <span class="pill ${isOpen ? 'live' : ''}"><span class="dot"></span>${isOpen ? 'Market open' : 'Market closed'}</span></p></div>
      <button class="btn btn-outline btn-sm" data-global="refresh">${I('refresh')} Refresh</button>
    </div>
    <div class="grid grid-4">
      ${fundsCard('Equity', S.margins?.equity, 'wallet')}
      ${fundsCard('Commodity', S.margins?.commodity, 'globe')}
      <div class="card"><h3>${I('box')} Holdings <span class="right"><a href="#" data-goto="holdings">View →</a></span></h3>
        <div class="muted" style="font-size:12px;margin-bottom:2px">Total P&amp;L</div>
        <div class="big num ${cls(H.pnl)}">${inr(H.pnl)}<small>${pct(H.pnlPct)}</small></div>
        <div class="kv" style="margin-top:22px"><span>Current value</span><b class="num">${inr(H.cur)}</b></div>
        <div class="kv"><span>Investment</span><b class="num">${inr(H.inv)}</b></div></div>
      <div class="card"><h3>${I('trend')} Today <span class="right"><a href="#" data-goto="positions">View →</a></span></h3>
        <div class="muted" style="font-size:12px;margin-bottom:2px">Positions P&amp;L</div>
        <div class="big num ${cls(posPnl)}">${inr(posPnl)}</div>
        <div class="kv" style="margin-top:22px"><span>Open positions</span><b class="num">${openPos}</b></div>
        <div class="kv"><span>Pending orders</span><b class="num">${openOrders}</b></div></div>
    </div>
    <div class="grid grid-2" style="margin-top:16px">
      <div class="card"><h3>${I('activity')} Market overview</h3><div class="idx-cards" id="dash-idx"></div></div>
      <div class="card"><h3>${I('star')} Holdings movers <span class="right muted">today</span></h3>
        ${movers.length ? movers.map((m) => `<div class="mover"><span class="sym">${esc(m.tradingsymbol)}</span>
          <span class="num muted">${fmt(m.last_price)}</span>
          <span class="chip ${m.day_change_percentage >= 0 ? 'ok' : 'bad'} num">${pct(m.day_change_percentage)}</span></div>`).join('')
          : `<div class="muted" style="padding:20px 0;text-align:center">${S.portfolioLoaded ? 'No holdings yet.' : 'Loading…'}</div>`}
      </div>
    </div>`;
  renderIndices();
}

/* ---------------------------------------------------------------- orders */
const STATUS_CLASS = { COMPLETE: 'ok', REJECTED: 'bad', CANCELLED: '', OPEN: 'info', 'TRIGGER PENDING': 'warn', 'AMO REQ RECEIVED': 'warn' };

function renderOrders(el) {
  const open = S.orders.filter((o) => PENDING.has(o.status));
  const done = S.orders.filter((o) => !PENDING.has(o.status));
  const tab = S.ordersTab;
  const time = (t) => esc(String(t || '').slice(11, 19));
  const sideChip = (r) => `<span class="chip ${r.transaction_type === 'BUY' ? 'buy' : 'sell'}">${r.transaction_type}</span>${
    r.tag === 'ktTP' ? ' <span class="chip ok" title="Take-profit leg">TP</span>' : r.tag === 'ktSL' ? ' <span class="chip bad" title="Stop-loss leg">SL</span>' : ''}`;
  const priceCell = (o) => {
    const px = o.order_type === 'MARKET' || o.order_type === 'SL-M' ? '<span class="muted">MKT</span>' : fmt(o.price);
    return `<span class="num">${px}${o.trigger_price ? `<span class="faint"> / trg ${fmt(o.trigger_price)}</span>` : ''}</span>`;
  };
  const orderCols = [
    { key: 'time', label: 'Time', html: (o) => `<span class="num muted">${time(o.order_timestamp)}</span>`, sort: (o) => o.order_timestamp },
    { key: 'side', label: 'Type', html: sideChip, sort: (o) => o.transaction_type },
    { key: 'sym', label: 'Instrument', html: symCell, sort: (o) => o.tradingsymbol },
    { key: 'prod', label: 'Product', html: (o) => `<span class="chip">${esc(o.product)}</span> <span class="faint" style="font-size:11px">${esc(o.order_type)}</span>`, sort: (o) => o.product },
    { key: 'qty', label: 'Qty', r: true, html: (o) => `<span class="num">${o.filled_quantity || 0} / ${o.quantity}</span>`, sort: (o) => o.quantity },
    { key: 'price', label: 'Price', r: true, html: priceCell, sort: (o) => o.price },
    { key: 'avg', label: 'Avg', r: true, html: (o) => `<span class="num">${o.average_price ? fmt(o.average_price) : '—'}</span>`, sort: (o) => o.average_price },
    { key: 'status', label: 'Status', html: (o) => `<span class="chip ${STATUS_CLASS[o.status] ?? 'info'}">${esc(o.status)}</span>${o.status === 'REJECTED' && o.status_message ? `<span class="reason">${esc(o.status_message)}</span>` : ''}`, sort: (o) => o.status },
  ];
  let body;
  if (tab === 'open') {
    body = table('open', [...orderCols, { key: 'a', label: '', html: (o) => MODIFIABLE.has(o.status)
      ? acts(actBtn('modify', `${I('edit')}`, ''), actBtn('cancel', 'Cancel', '')) : '' }], open,
    { empty: emptyState('inbox', 'No pending orders', '<div>Orders waiting to be executed will show up here.</div>') });
  } else if (tab === 'executed') {
    body = table('executed', [...orderCols, { key: 'a', label: '', html: () => acts(actBtn('repeat', 'Repeat')) }], done,
      { empty: emptyState('inbox', 'No executed orders today', '<div>Completed, rejected and cancelled orders appear here.</div>') });
  } else {
    body = table('trades', [
      { key: 'time', label: 'Time', html: (t) => `<span class="num muted">${time(t.fill_timestamp || t.exchange_timestamp)}</span>`, sort: (t) => t.fill_timestamp },
      { key: 'side', label: 'Type', html: sideChip, sort: (t) => t.transaction_type },
      { key: 'sym', label: 'Instrument', html: symCell, sort: (t) => t.tradingsymbol },
      { key: 'prod', label: 'Product', html: (t) => `<span class="chip">${esc(t.product)}</span>`, sort: (t) => t.product },
      { key: 'qty', label: 'Qty', r: true, html: (t) => `<span class="num">${t.quantity}</span>`, sort: (t) => t.quantity },
      { key: 'avg', label: 'Price', r: true, html: (t) => `<span class="num">${fmt(t.average_price)}</span>`, sort: (t) => t.average_price },
      { key: 'id', label: 'Trade ID', html: (t) => `<span class="num faint">${esc(t.trade_id)}</span>` },
    ], S.trades, { empty: emptyState('inbox', 'No trades today', '<div>Your fills will be listed here.</div>') });
  }
  const tb = (id, label, n) => `<button class="${tab === id ? 'active' : ''}" data-otab="${id}">${label}<span class="n">${n}</span></button>`;
  el.innerHTML = `<div class="view-head"><div><h1>Orders</h1><p>${open.length} pending · ${done.length} executed · ${S.trades.length} trades</p></div>
    <div class="seg-tabs">${tb('open', 'Pending', open.length)}${tb('executed', 'Executed', done.length)}${tb('trades', 'Trades', S.trades.length)}</div></div>
    ${S.ordersLoaded ? body : '<div class="table-wrap" style="padding:20px"><div class="skeleton"></div><div class="skeleton" style="margin-top:12px"></div></div>'}`;
}

async function cancelOrder(o) {
  const ok = await confirmDialog('Cancel order?', `${esc(o.transaction_type)} ${o.quantity} × <b>${esc(o.tradingsymbol)}</b> @ ${o.order_type === 'MARKET' ? 'market' : inr(o.price)}`, 'Cancel order', true);
  if (!ok) return;
  try {
    await api(`/orders/${o.variety}/${o.order_id}`, { method: 'DELETE' });
    toast('success', 'Cancellation requested', `${o.tradingsymbol} · #${o.order_id}`);
    loadOrders().catch(() => {});
  } catch (e) { toast('error', 'Could not cancel order', e.message); }
}

/* ------------------------------------------------------------- positions */
function renderPositions(el) {
  const rows = [...S.positions].sort((a, b) => (b.quantity !== 0) - (a.quantity !== 0));
  const total = sum(rows, (x) => x.pnl);
  const cols = [
    { key: 'prod', label: 'Product', html: (r) => `<span class="chip">${esc(r.product)}</span>`, sort: (r) => r.product },
    { key: 'sym', label: 'Instrument', html: symCell, sort: (r) => r.tradingsymbol },
    { key: 'qty', label: 'Qty', r: true, html: (r) => `<span class="num ${r.quantity > 0 ? 'up' : r.quantity < 0 ? 'down' : ''}">${r.quantity}</span>${
      DERIV_EXCH.has(r.exchange) && r.quantity && lotUnit(S.instCache.get(keyOf(r))) > 1 ? ` <span class="chip num">${+lotsOf(r).toFixed(2)}L</span>` : ''}`, sort: (r) => r.quantity },
    { key: 'avg', label: 'Avg', r: true, html: (r) => `<span class="num">${fmt(r.average_price)}</span>`, sort: (r) => r.average_price },
    { key: 'ltp', label: 'LTP', r: true, html: (r) => `<span class="num">${fmt(r.last_price)}</span>`, sort: (r) => r.last_price },
    { key: 'pnl', label: 'P&amp;L', r: true, html: (r) => `<span class="num ${cls(r.pnl)}">${signed(r.pnl)}</span>`, sort: (r) => r.pnl },
    { key: 'chg', label: 'Day chg', r: true, html: (r) => { const p = r.close_price ? ((r.last_price - r.close_price) / r.close_price) * 100 : null; return `<span class="num ${cls(p)}">${pct(p)}</span>`; }, sort: (r) => (r.close_price ? r.last_price / r.close_price : 0) },
    { key: 'prot', label: 'TP / SL', html: (r) => {
      const p = S.prot.items.find((x) => x.exchange === r.exchange && x.tradingsymbol === r.tradingsymbol && x.product === r.product);
      if (p) {
        const unit = lotUnit(S.instCache.get(keyOf(r)));
        const deriv = DERIV_EXCH.has(r.exchange);
        const show = (legs, c) => legs.length ? [...legs].sort((a, b) => a.price - b.price).map((l) => `<span class="num ${c}">${fmt(l.price)}<small class="faint"> ×${deriv ? `${+(l.qty / unit).toFixed(2)}L` : l.qty}</small></span>`).join(' ') : '<span class="faint">—</span>';
        return `<span class="prot-cell">${show(p.tps, 'up')}<span class="faint">/</span>${show(p.sls, 'down')}<span class="chip">${p.mode.toUpperCase()}</span></span>`;
      }
      return r.quantity ? actBtn('protect', 'Set TP/SL') : '';
    } },
    { key: 'book', label: 'Book profit', html: (r) => (r.quantity && DERIV_EXCH.has(r.exchange)
      ? `<div class="book-cell">${bookButtons(r, 'data-act="book" data-n')}</div>` : '') },
    { key: 'a', label: '', html: (r) => acts(r.quantity ? actBtn('exit', 'Exit') : '', r.quantity ? actBtn('add', 'Add') : '', actBtn('chart', I('chart'))) },
  ];
  el.innerHTML = `<div class="view-head"><div><h1>Positions</h1><p>${rows.filter((r) => r.quantity).length} open · ${rows.filter((r) => !r.quantity).length} closed</p></div>
    <div style="text-align:right"><div class="muted" style="font-size:12px">Total P&amp;L</div><div class="big num ${cls(total)}">${inr(total)}</div></div></div>
    ${!S.portfolioLoaded ? '<div class="table-wrap" style="padding:20px"><div class="skeleton"></div></div>'
    : table('positions', cols, rows, {
      rowClass: (r) => (r.quantity ? '' : 'dim'),
      empty: emptyState('trend', 'No positions', '<div>Intraday and F&amp;O positions will appear here once your orders execute.</div>'),
      foot: `<td colspan="5">Total</td><td class="r num ${cls(total)}">${signed(total)}</td><td colspan="4"></td>`,
    })}`;
}

function exitPosition(p) {
  openOrder(p, p.quantity > 0 ? 'SELL' : 'BUY', { units: Math.abs(p.quantity), product: p.product, orderType: 'MARKET' });
}

/* -------------------------------------------------------------- holdings */
function renderHoldings(el) {
  const H = holdingsSummary();
  const qty = (r) => r.quantity + (r.t1_quantity || 0);
  const cols = [
    { key: 'sym', label: 'Instrument', html: (r) => `${symCell(r)}${r.t1_quantity ? ' <span class="chip warn">T1</span>' : ''}`, sort: (r) => r.tradingsymbol },
    { key: 'qty', label: 'Qty', r: true, html: (r) => `<span class="num">${qty(r)}</span>`, sort: qty },
    { key: 'avg', label: 'Avg cost', r: true, html: (r) => `<span class="num">${fmt(r.average_price)}</span>`, sort: (r) => r.average_price },
    { key: 'ltp', label: 'LTP', r: true, html: (r) => `<span class="num">${fmt(r.last_price)}</span>`, sort: (r) => r.last_price },
    { key: 'inv', label: 'Invested', r: true, html: (r) => `<span class="num">${fmt(r.average_price * qty(r))}</span>`, sort: (r) => r.average_price * qty(r) },
    { key: 'cur', label: 'Cur. value', r: true, html: (r) => `<span class="num">${fmt(r.last_price * qty(r))}</span>`, sort: (r) => r.last_price * qty(r) },
    { key: 'pnl', label: 'P&amp;L', r: true, html: (r) => { const v = (r.last_price - r.average_price) * qty(r); return `<span class="num ${cls(v)}">${signed(v)}</span>`; }, sort: (r) => (r.last_price - r.average_price) * qty(r) },
    { key: 'net', label: 'Net chg', r: true, html: (r) => { const v = r.average_price ? ((r.last_price - r.average_price) / r.average_price) * 100 : 0; return `<span class="num ${cls(v)}">${pct(v)}</span>`; }, sort: (r) => (r.average_price ? r.last_price / r.average_price : 0) },
    { key: 'day', label: 'Day chg', r: true, html: (r) => `<span class="num ${cls(r.day_change_percentage)}">${pct(r.day_change_percentage)}</span>`, sort: (r) => r.day_change_percentage },
    { key: 'a', label: '', html: () => acts(actBtn('buy', 'Buy', 'b'), actBtn('sell', 'Sell', 's'), actBtn('protect', 'TP/SL'), actBtn('chart', I('chart'))) },
  ];
  const byVal = [...S.holdings].sort((a, b) => b.last_price * qty(b) - a.last_price * qty(a));
  const top = byVal.slice(0, 6);
  const rest = sum(byVal.slice(6), (r) => r.last_price * qty(r));
  const alloc = [...top.map((r, i) => ({ n: r.tradingsymbol, v: r.last_price * qty(r), c: PALETTE[i] })), ...(rest ? [{ n: 'Others', v: rest, c: PALETTE[6] }] : [])];
  el.innerHTML = `<div class="view-head"><div><h1>Holdings</h1><p>${S.holdings.length} stocks in your demat</p></div></div>
    ${S.holdings.length ? `
    <div class="stat-strip">
      <div><label>Total investment</label><div class="v num">${inr(H.inv)}</div></div>
      <div><label>Current value</label><div class="v num">${inr(H.cur)}</div></div>
      <div><label>Total P&amp;L</label><div class="v num ${cls(H.pnl)}">${inr(H.pnl)}<small>${pct(H.pnlPct)}</small></div></div>
      <div><label>Day's P&amp;L</label><div class="v num ${cls(H.day)}">${inr(H.day)}<small>${pct(H.dayPct)}</small></div></div>
    </div>
    <div class="card" style="margin-bottom:16px"><h3>${I('box')} Allocation</h3>
      <div class="alloc">${alloc.map((a) => `<div title="${esc(a.n)}" style="flex:${a.v};background:${a.c}"></div>`).join('')}</div>
      <div class="alloc-legend">${alloc.map((a) => `<span><i style="background:${a.c}"></i>${esc(a.n)} <span class="num faint">${H.cur ? ((a.v / H.cur) * 100).toFixed(1) : 0}%</span></span>`).join('')}</div>
    </div>` : ''}
    ${!S.portfolioLoaded ? '<div class="table-wrap" style="padding:20px"><div class="skeleton"></div></div>'
    : table('holdings', cols, S.holdings, {
      empty: emptyState('box', 'No holdings', '<div>Stocks you buy with CNC (delivery) show up here from T+1.</div>'),
      foot: S.holdings.length ? `<td colspan="4">Total</td><td class="r num">${fmt(H.inv)}</td><td class="r num">${fmt(H.cur)}</td><td class="r num ${cls(H.pnl)}">${signed(H.pnl)}</td><td class="r num ${cls(H.pnlPct)}">${pct(H.pnlPct)}</td><td colspan="2"></td>` : '',
    })}`;
}

/* ================================================================== chart */
// Up to two independent panes. Pane 0 (S.chart) also carries the trade levels
// (entry / TP / SL); "open chart" loads into the focused pane.
const INTERVAL_SEC = { minute: 60, '3minute': 180, '5minute': 300, '15minute': 900, '30minute': 1800, '60minute': 3600, day: 86400 };
Object.assign(ICONS, {
  cursor: '<path d="M5 3l14 7-6 2-2 6z"/>',
  tline: '<path d="M5 19L19 5"/><circle cx="5" cy="19" r="2"/><circle cx="19" cy="5" r="2"/>',
  hline: '<path d="M3 12h18"/><path d="M3 6h5M3 18h5" opacity=".45"/>',
  layout1: '<rect x="3" y="4" width="18" height="16" rx="2"/>',
  layout2: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M12 4v16"/>',
  swap: '<path d="M8 3L4 7l4 4"/><path d="M4 7h16"/><path d="M16 21l4-4-4-4"/><path d="M20 17H4"/>',
});
S.chart.idx = 0;
S.chart2 = { idx: 1, inst: store.get('chart2Inst', null), interval: store.get('chart2Interval', '5minute'), api: null, seq: 0, loadedFor: null, last: null };
const PANES = [S.chart, S.chart2];
S.chartLayout = store.get('chartLayout', 1) === 2 ? 2 : 1;
S.chartFocus = 0;
const visiblePanes = () => PANES.slice(0, S.chartLayout);

function paneEls(p) {
  if (!p.el) {
    const root = document.querySelector(`.chart-pane[data-pane="${p.idx}"]`);
    const q = (s) => root.querySelector(s);
    p.el = { root, head: q('.chart-head'), legend: q('.chart-legend'), canvas: q('.chart-canvas'), overlay: q('.chart-overlay'),
      draw: q('.draw-layer'), pill: q('.draw-pill'), box: q('.chart-box') };
  }
  return p.el;
}

function styleChart(p = S.chart) {
  const up = cssVar('--up'); const down = cssVar('--down');
  p.api.applyOptions({
    layout: { background: { type: 'solid', color: cssVar('--panel') }, textColor: cssVar('--muted'), fontFamily: 'Inter, system-ui, sans-serif', fontSize: 11 },
    grid: { vertLines: { color: cssVar('--border') }, horzLines: { color: cssVar('--border') } },
    rightPriceScale: { borderColor: cssVar('--border') },
    timeScale: { borderColor: cssVar('--border'), timeVisible: true, secondsVisible: false, rightOffset: 6 },
    crosshair: { mode: 0 },
  });
  p.series.applyOptions({ upColor: up, downColor: down, wickUpColor: up, wickDownColor: down, borderVisible: false });
  p.upA = up + '55'; p.downA = down + '55';
  if (p.bars) p.vol.setData(p.bars.map((b) => ({ time: b.time, value: b.volume, color: b.close >= b.open ? p.upA : p.downA })));
  bumpDrawings();
}

function ensureChart(p = S.chart) {
  if (p.api) return true;
  if (!window.LightweightCharts) return false;
  p.api = LightweightCharts.createChart(paneEls(p).canvas, { autoSize: true });
  p.series = p.api.addCandlestickSeries();
  p.vol = p.api.addHistogramSeries({ priceFormat: { type: 'volume' }, priceScaleId: 'vol', lastValueVisible: false, priceLineVisible: false });
  p.api.priceScale('vol').applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
  p.api.subscribeCrosshairMove((e) => renderLegend(p, e?.seriesData?.get(p.series)));
  p.priceZoom = null; // set by the mouse wheel: a fixed price range instead of auto-fit
  p.series.applyOptions({
    autoscaleInfoProvider: (orig) => {
      if (p.priceZoom) return { priceRange: { ...p.priceZoom } };
      const r = orig();
      // Fit the candles, pulling in only TP / SL / entry lines close to them. A far-away line must
      // not squash the candles into a strip; it is pinned to the chart's edge instead.
      if (p.idx !== 0 || !r || !LV.size) return r;
      let { minValue, maxValue } = r.priceRange;
      const reach = (maxValue - minValue) * LEVEL_REACH;
      const lo = minValue - reach; const hi = maxValue + reach;
      for (const lv of LV.values()) {
        if (lv.dragging || lv.price < lo || lv.price > hi) continue;
        minValue = Math.min(minValue, lv.price); maxValue = Math.max(maxValue, lv.price);
      }
      return { ...r, priceRange: { minValue, maxValue } };
    },
  });
  if (p.idx === 0) requestAnimationFrame(levelsLoop);
  styleChart(p);
  initDrawLayer(p);
  initPriceZoom(p);
  return true;
}

/* ------------------------------------------------------------ price zoom */
// The chart library's wheel only zooms time. Zoom price too, around the cursor, so the wheel
// zooms into the candles; when zoomed, dragging up/down pans the price. Double-click resets.
const ZOOM_SPEED = 0.002; // per wheel delta unit: one mouse notch (100) zooms ~18%

function visiblePriceRange(p) {
  if (p.priceZoom) return { ...p.priceZoom };
  const { h } = plotSize(p);
  const m = p.api.priceScale('right').options().scaleMargins;
  const hi = p.series.coordinateToPrice(h * m.top);
  const lo = p.series.coordinateToPrice(h * (1 - m.bottom));
  return hi == null || lo == null || hi <= lo ? null : { minValue: lo, maxValue: hi };
}

function setPriceZoom(p, range) {
  p.priceZoom = range;
  p.api.priceScale('right').applyOptions({ autoScale: true });
}

function initPriceZoom(p) {
  const el = paneEls(p).canvas;
  const inPlot = (ev) => {
    const r = el.getBoundingClientRect();
    const { w, h } = plotSize(p);
    const x = ev.clientX - r.left; const y = ev.clientY - r.top;
    return x >= 0 && x <= w && y >= 0 && y <= h ? y : null;
  };
  el.addEventListener('wheel', (ev) => {
    const y = inPlot(ev);
    if (y == null || !p.loadedFor || !ev.deltaY) return;
    const range = visiblePriceRange(p);
    const at = p.series.coordinateToPrice(y);
    if (!range || at == null) return;
    const f = Math.exp(Math.max(-300, Math.min(300, ev.deltaY)) * ZOOM_SPEED); // < 1 zooms in
    setPriceZoom(p, { minValue: at - (at - range.minValue) * f, maxValue: at + (range.maxValue - at) * f });
  }, { capture: true, passive: true }); // the library zooms time on the same event
  el.addEventListener('pointerdown', (ev) => {
    if (ev.button !== 0 || !p.priceZoom || DRAW.tool !== 'cursor' || inPlot(ev) == null) return;
    const y0 = ev.clientY; const r0 = { ...p.priceZoom };
    const m = p.api.priceScale('right').options().scaleMargins;
    const perPx = (r0.maxValue - r0.minValue) / Math.max(1, plotSize(p).h * (1 - m.top - m.bottom));
    const move = (e) => {
      const d = (e.clientY - y0) * perPx;
      setPriceZoom(p, { minValue: r0.minValue + d, maxValue: r0.maxValue + d });
    };
    const up = () => { document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up); };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
  }, true);
  el.addEventListener('dblclick', () => setPriceZoom(p, null));
}

function renderLegend(p = S.chart, bar) {
  const b = bar || p.last;
  const el = paneEls(p).legend;
  if (!b) { el.innerHTML = ''; return; }
  const n = dp(p.inst);
  const color = b.close >= b.open ? 'up' : 'down';
  el.innerHTML = ['open', 'high', 'low', 'close'].map((k) => `<span>${k[0].toUpperCase()}<b class="num ${color}">${fmt(b[k], n)}</b></span>`).join('');
}

function renderChartHead(p = S.chart) {
  const inst = p.inst;
  const c = chg(inst && S.quotes[inst.key]);
  const title = inst ? (isOptionInst(inst) ? optLabel(inst) : inst.tradingsymbol) : (p.idx ? 'Second chart' : 'Chart');
  paneEls(p).head.innerHTML = `
    <div class="title">${esc(title)}${inst ? `<small>${esc(inst.exchange)}</small>` : ''}</div>
    ${inst ? `<div><span class="px num js-ltp ${cls(c.ch)}">${fmt(c.ltp, dp(inst))}</span>
      <span class="num js-chg ${cls(c.ch)}" style="font-size:13px;margin-left:6px">${c.ch == null ? '' : `${signed(c.ch)} (${pct(c.p)})`}</span></div>` : ''}
    <div class="seg-tabs">${INTERVALS.map(([v, l]) => `<button data-interval="${v}" class="${v === p.interval ? 'active' : ''}">${l}</button>`).join('')}</div>
    <div class="spacer"></div>
    ${inst && !isIndex(inst) ? `<button class="btn btn-buy btn-sm" data-chart-act="BUY">Buy</button><button class="btn btn-sell btn-sm" data-chart-act="SELL">Sell</button>` : ''}`;
}

function renderChartToolbar() {
  const t = DRAW.tool;
  const hint = t === 'trend' ? (DRAW.pending ? 'Click the second point' : 'Click the first point · Esc to cancel')
    : t === 'hline' ? 'Click a price level · Esc to cancel'
      : DRAW.selected ? 'Drag to move · drag the dots to reshape · Del to delete' : 'Alt+T trend · Alt+H support / resistance · double-click resets zoom';
  $('#chart-toolbar').innerHTML = `
    <div class="seg-tabs" title="Layout">
      <button data-layout="1" class="${S.chartLayout === 1 ? 'active' : ''}" title="One chart">${I('layout1')}</button>
      <button data-layout="2" class="${S.chartLayout === 2 ? 'active' : ''}" title="Two charts side by side">${I('layout2')}</button>
    </div>
    ${S.chartLayout === 2 ? `<button class="tb-btn" data-chart-swap title="Swap the two charts (TP/SL lines live on the left one)">${I('swap')} Swap</button>` : ''}
    <span class="tb-sep"></span>
    <div class="seg-tabs">
      <button data-tool="cursor" class="${t === 'cursor' ? 'active' : ''}" title="Select / move (Esc)">${I('cursor')}</button>
      <button data-tool="trend" class="${t === 'trend' ? 'active' : ''}" title="Trend line (Alt+T)">${I('tline')} Trend</button>
      <button data-tool="hline" class="${t === 'hline' ? 'active' : ''}" title="Horizontal support / resistance line (Alt+H)">${I('hline')} S / R</button>
    </div>
    <button class="tb-btn" data-draw-clear title="Delete all drawings on the ${S.chartLayout === 2 ? 'focused' : ''} chart">${I('trash')} Clear</button>
    <span class="tb-hint">${hint}</span>`;
}

function applyLayout() {
  const panes = $('#chart-panes');
  panes.dataset.layout = S.chartLayout;
  PANES.forEach((p) => paneEls(p).root.classList.toggle('focused', S.chartLayout === 2 && p.idx === S.chartFocus));
}

// Start time (IST-as-UTC seconds) of the candle the market is in now; candles align
// intraday candles to the 09:15 open. Null outside market hours.
function currentBarTime(interval) {
  if (!marketOpen()) return null;
  const now = Math.floor(Date.now() / 1000) + IST_OFFSET;
  const day = now - (now % 86400);
  if (interval === 'day') return day;
  const step = INTERVAL_SEC[interval];
  const open = day + 9 * 3600 + 15 * 60;
  return open + Math.floor((now - open) / step) * step;
}

function updateChartQuote(p = S.chart) {
  const inst = p.inst;
  const q = inst && S.quotes[inst.key];
  if (!q) return;
  const ch = chg(q);
  const head = paneEls(p).head;
  const ltp = head.querySelector('.js-ltp');
  if (ltp) {
    ltp.textContent = fmt(ch.ltp, dp(inst)); ltp.className = `px num js-ltp ${cls(ch.ch)}`;
    const c2 = head.querySelector('.js-chg');
    c2.textContent = `${signed(ch.ch)} (${pct(ch.p)})`; c2.className = `num js-chg ${cls(ch.ch)}`;
  }
  if (p.last && p.loadedFor === `${inst.key}|${p.interval}`) {
    const px = q.last_price;
    const bucket = currentBarTime(p.interval);
    if (bucket && bucket > p.last.time) { // a new candle has started
      p.last = { time: bucket, open: px, high: px, low: px, close: px, volume: 0 };
      p.bars.push(p.last);
    } else {
      p.last.close = px;
      p.last.high = Math.max(p.last.high, px);
      p.last.low = Math.min(p.last.low, px);
    }
    if (q.volume != null) {
      if (p.cumVol != null && q.volume > p.cumVol) p.last.volume = (p.last.volume || 0) + (q.volume - p.cumVol);
      p.cumVol = q.volume;
    }
    p.series.update(p.last);
    p.vol.update({ time: p.last.time, value: p.last.volume || 0, color: p.last.close >= p.last.open ? p.upA : p.downA });
    renderLegend(p);
    if (p.idx === 0) syncChartLevels();
  }
}

async function openChart(inst, opts = {}) {
  const p = opts.protect || S.chartLayout === 1 ? S.chart : PANES[S.chartFocus];
  p.inst = slim({ ...inst, key: inst.key || keyOf(inst) });
  if (p.idx === 0) S.chart.pendingProtect = opts.protect || null;
  store.set(p.idx ? 'chart2Inst' : 'chartInst', p.inst);
  if (S.view === 'chart') loadChart(p); else switchView('chart');
}

// Clicking anywhere in a pane focuses it, even before it has a chart loaded.
function initPaneFocus() {
  PANES.forEach((p) => {
    const el = paneEls(p);
    if (el.focusInit) return;
    el.focusInit = true;
    el.root.addEventListener('pointerdown', () => {
      if (S.chartFocus !== p.idx) { S.chartFocus = p.idx; applyLayout(); }
    }, true);
  });
}

function loadCharts() {
  initPaneFocus();
  applyLayout();
  renderChartToolbar();
  visiblePanes().forEach((p) => loadChart(p));
}

async function loadChart(p = S.chart) {
  const c = p;
  const el = paneEls(p);
  renderChartHead(p);
  const ov = el.overlay;
  ov.classList.remove('hidden');
  if (!c.inst) {
    ov.innerHTML = p.idx
      ? emptyState('layout2', 'Second chart', '<div>Click here to focus this chart, then open an instrument from the watchlist (chart button or <kbd>C</kbd>).</div>')
      : emptyState('chart', 'No instrument selected', '<div>Select an instrument in your watchlist and press <kbd>C</kbd>, or click its chart button.</div>');
    el.legend.innerHTML = '';
    return;
  }
  if (!ensureChart(p)) {
    ov.innerHTML = emptyState('alert', 'Charting library failed to load', '<div>Check your internet connection and reload.</div>');
    return;
  }
  const want = `${c.inst.key}|${c.interval}`;
  if (p.idx === 0 && c.editsFor !== c.inst.key) { c.edits = {}; c.editsFor = c.inst.key; }
  if (c.loadedFor === want) { ov.classList.add('hidden'); quotesSoon(); afterPaneLoad(p); return; }
  if (p.idx === 0) clearLevels();
  c.series.setMarkers([]);
  c.loadedFor = null;
  bumpDrawings();
  const seq = ++c.seq;
  ov.innerHTML = '<div class="muted">Loading candles…</div>';
  try {
    if (!c.inst.instrument_token) c.inst = slim(await resolveInst(c.inst));
    if (!c.inst.instrument_token) throw new Error('Could not resolve the instrument token for this symbol.');
    const d = await api(`/historical/${c.inst.instrument_token}/${c.interval}`);
    if (seq !== c.seq) return;
    const seen = new Set();
    const bars = (d.candles || []).map((k) => ({
      time: Math.floor(Date.parse(String(k[0]).replace(/([+-]\d\d)(\d\d)$/, '$1:$2')) / 1000) + IST_OFFSET,
      open: k[1], high: k[2], low: k[3], close: k[4], volume: k[5],
    })).filter((b) => isFinite(b.time) && !seen.has(b.time) && seen.add(b.time)).sort((a, b) => a.time - b.time);
    if (!bars.length) {
      ov.innerHTML = emptyState('chart', 'No data for this range', '<div>Try a different interval.</div>');
      c.loadedFor = null; return;
    }
    c.bars = bars;
    c.priceZoom = null; // a new instrument / interval starts auto-fitted
    c.api.priceScale('right').applyOptions({ autoScale: true });
    c.series.setData(bars);
    c.vol.setData(bars.map((b) => ({ time: b.time, value: b.volume, color: b.close >= b.open ? c.upA : c.downA })));
    c.series.applyOptions({ priceFormat: { type: 'price', precision: dp(c.inst), minMove: c.inst.tick_size || 0.05 } });
    c.api.timeScale().setVisibleLogicalRange({ from: Math.max(0, bars.length - 160), to: bars.length + 4 });
    c.last = bars[bars.length - 1];
    c.cumVol = null;
    c.loadedFor = want;
    ov.classList.add('hidden');
    renderLegend(p);
    quotesSoon();
    afterPaneLoad(p);
  } catch (e) {
    if (seq !== c.seq) return;
    const hint = /permission|subscri|insufficient/i.test(e.message) ? '<div style="margin-top:6px">Kotak Neo could not provide historical candles for this instrument.</div>' : '';
    ov.innerHTML = emptyState('alert', "Couldn't load chart", `<div>${esc(e.message)}</div>${hint}`);
    c.loadedFor = null;
  }
}

function afterPaneLoad(p) {
  if (p.idx === 0) afterChartLoad(); else updateMarkers(p);
  loadDrawings(p);
  bumpDrawings();
}

function swapCharts() {
  const [a, b] = PANES;
  [a.inst, b.inst] = [b.inst, a.inst];
  [a.interval, b.interval] = [b.interval, a.interval];
  store.set('chartInst', a.inst); store.set('chart2Inst', b.inst);
  store.set('chartInterval', a.interval); store.set('chart2Interval', b.interval);
  DRAW.selected = null;
  loadCharts();
}

/* ------------------------------------------------------------- drawings */
// Trend lines and horizontal support/resistance lines, stored per instrument in
// absolute time + price on the server, so they show on every interval and device.
const DRAW = { tool: 'cursor', items: new Map(), loading: new Set(), selected: null, pending: null, hover: null, version: 0, timers: new Map() };
const DRAW_COLORS = ['#6d8cff', '#22c58b', '#ff4d6a', '#f5b544', '#b07cff', '#9aa3b5'];
const drawId = () => Math.random().toString(36).slice(2, 10);
const itemsFor = (p) => (p.inst ? DRAW.items.get(p.inst.key) || [] : []);
const bumpDrawings = () => { DRAW.version++; };

async function loadDrawings(p) {
  const key = p.inst?.key;
  if (!key || DRAW.items.has(key) || DRAW.loading.has(key)) return;
  DRAW.loading.add(key);
  try {
    const r = await api('/drawings?key=' + encodeURIComponent(key));
    if (!DRAW.items.has(key)) DRAW.items.set(key, r.items || []);
  } catch { /* keep it empty; nothing to show */ } finally { DRAW.loading.delete(key); bumpDrawings(); }
}

function saveDrawings(key) {
  clearTimeout(DRAW.timers.get(key));
  DRAW.timers.set(key, setTimeout(async () => {
    try { await api('/drawings', { method: 'PUT', body: { key, items: DRAW.items.get(key) || [] } }); } catch (e) { toast('error', 'Could not save drawings', e.message); }
  }, 400));
}

function setItems(key, items) { DRAW.items.set(key, items); DRAW.createdAt = performance.now(); bumpDrawings(); saveDrawings(key); }

function setTool(tool) {
  DRAW.tool = tool;
  DRAW.pending = null;
  DRAW.hover = null;
  if (tool !== 'cursor') DRAW.selected = null;
  // Switch click capture right away rather than on the next animation frame.
  PANES.forEach((p) => p.el?.draw.classList.toggle('drawing', tool !== 'cursor'));
  renderChartToolbar();
  bumpDrawings();
}

// --- time <-> x: points are stored as absolute times, mapped through bar indices
// (fractional between bars, extrapolated by the interval beyond the data).
function timeToX(p, t) {
  const bars = p.bars;
  if (!bars?.length) return null;
  const n = bars.length;
  const step = INTERVAL_SEC[p.interval] || 60;
  let lg;
  if (t <= bars[0].time) lg = (t - bars[0].time) / step;
  else if (t >= bars[n - 1].time) lg = n - 1 + (t - bars[n - 1].time) / step;
  else {
    let lo = 0; let hi = n - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (bars[mid].time <= t) lo = mid; else hi = mid; }
    lg = lo + (t - bars[lo].time) / (bars[hi].time - bars[lo].time);
  }
  return p.api.timeScale().logicalToCoordinate(lg);
}

function xToTime(p, x) {
  const bars = p.bars;
  const lg = p.api.timeScale().coordinateToLogical(x);
  if (lg == null || !bars?.length) return null;
  const n = bars.length;
  const step = INTERVAL_SEC[p.interval] || 60;
  if (lg <= 0) return Math.round(bars[0].time + lg * step);
  if (lg >= n - 1) return Math.round(bars[n - 1].time + (lg - (n - 1)) * step);
  const i = Math.floor(lg);
  return Math.round(bars[i].time + (lg - i) * (bars[i + 1].time - bars[i].time));
}

function plotSize(p) {
  const el = paneEls(p).canvas;
  return { w: Math.max(0, el.clientWidth - p.api.priceScale('right').width()), h: Math.max(0, el.clientHeight - p.api.timeScale().height()) };
}

function eventPoint(p, ev, magnet) {
  const r = paneEls(p).draw.getBoundingClientRect();
  const x = ev.clientX - r.left; const y = ev.clientY - r.top;
  let t = xToTime(p, x);
  let price = p.series.coordinateToPrice(y);
  if (magnet) { // snap to the nearest open/high/low/close within 10 px
    const i = Math.round(p.api.timeScale().coordinateToLogical(x) ?? -1);
    const bar = p.bars?.[i];
    if (bar) {
      let best = null;
      for (const v of [bar.open, bar.high, bar.low, bar.close]) {
        const yy = p.series.priceToCoordinate(v);
        if (yy != null && Math.abs(yy - y) < 10 && (!best || Math.abs(yy - y) < best.d)) best = { v, d: Math.abs(yy - y) };
      }
      if (best) { price = best.v; t = bar.time; }
    }
  }
  return t == null || price == null ? null : { t, p: +(+price).toFixed(4) };
}

function trendXY(p, d, w) {
  const x1 = timeToX(p, d.a.t); const y1 = p.series.priceToCoordinate(d.a.p);
  const x2 = timeToX(p, d.b.t); const y2 = p.series.priceToCoordinate(d.b.p);
  if ([x1, y1, x2, y2].some((v) => v == null)) return null;
  let ex = x2; let ey = y2;
  if (d.extend && x2 !== x1) { ex = x2 > x1 ? w + 40 : -40; ey = y1 + ((y2 - y1) * (ex - x1)) / (x2 - x1); }
  return { x1, y1, x2, y2, ex, ey };
}

function drawingSvg(p, d, w, preview = false) {
  const sel = DRAW.selected?.id === d.id && DRAW.selected.pane === p.idx;
  const col = d.color || DRAW_COLORS[0];
  const cls_ = `dw${sel ? ' sel' : ''}${preview ? ' preview' : ''}`;
  if (d.type === 'hline') {
    const y = p.series.priceToCoordinate(d.p);
    if (y == null) return '';
    const label = fmt(d.p, dp(p.inst));
    const lw = label.length * 7 + 12;
    return `<g data-id="${d.id}" class="${cls_}"><line class="hit" x1="0" x2="${w}" y1="${y}" y2="${y}"/>
      <line class="vis" x1="0" x2="${w}" y1="${y}" y2="${y}" stroke="${col}"/>
      <rect x="4" y="${y - 9}" width="${lw}" height="18" rx="4" fill="${col}"/><text class="lbl" x="${4 + lw / 2}" y="${y + 4}" text-anchor="middle">${label}</text>
      ${sel ? `<circle class="handle" data-h="body" cx="${w / 2}" cy="${y}" r="5" stroke="${col}"/>` : ''}</g>`;
  }
  const L = trendXY(p, d, w);
  if (!L) return '';
  return `<g data-id="${d.id}" class="${cls_}"><line class="hit" x1="${L.x1}" y1="${L.y1}" x2="${L.ex}" y2="${L.ey}"/>
    <line class="vis" x1="${L.x1}" y1="${L.y1}" x2="${L.ex}" y2="${L.ey}" stroke="${col}"/>
    ${sel || preview ? `<circle class="handle" data-h="a" cx="${L.x1}" cy="${L.y1}" r="5" stroke="${col}"/><circle class="handle" data-h="b" cx="${L.x2}" cy="${L.y2}" r="5" stroke="${col}"/>` : ''}</g>`;
}

function renderDrawings(p) {
  const el = paneEls(p);
  if (!p.api || !p.loadedFor) { el.draw.innerHTML = ''; el.pill.classList.add('hidden'); p.drawSig = ''; return; }
  const { w, h } = plotSize(p);
  const vr = p.api.timeScale().getVisibleLogicalRange();
  const sig = [w, h, vr?.from, vr?.to, p.series.priceToCoordinate(p.last?.close ?? 0), p.series.priceToCoordinate((p.last?.close ?? 0) * 1.01), DRAW.version].join('|');
  if (sig === p.drawSig) return;
  p.drawSig = sig;
  el.draw.setAttribute('width', w); el.draw.setAttribute('height', h);
  el.draw.style.width = w + 'px'; el.draw.style.height = h + 'px';
  el.draw.classList.toggle('drawing', DRAW.tool !== 'cursor');
  let out = itemsFor(p).map((d) => drawingSvg(p, d, w)).join('');
  if (DRAW.pending?.pane === p.idx && DRAW.pending.cur) {
    out += drawingSvg(p, { id: '_new', type: 'trend', a: DRAW.pending.a, b: DRAW.pending.cur, color: DRAW_COLORS[0] }, w, true);
  } else if (DRAW.tool === 'hline' && DRAW.hover?.pane === p.idx && DRAW.hover.pt) {
    out += drawingSvg(p, { id: '_new', type: 'hline', p: DRAW.hover.pt.p, color: DRAW_COLORS[3] }, w, true);
  }
  el.draw.innerHTML = out;
  renderPill(p, w);
}

function renderPill(p, w) {
  const el = paneEls(p);
  const d = DRAW.selected?.pane === p.idx && itemsFor(p).find((x) => x.id === DRAW.selected.id);
  if (!d) { el.pill.classList.add('hidden'); return; }
  let x; let y;
  if (d.type === 'hline') { x = Math.min(w - 120, 160); y = p.series.priceToCoordinate(d.p); } else {
    const L = trendXY(p, d, w);
    if (!L) { el.pill.classList.add('hidden'); return; }
    x = (L.x1 + L.x2) / 2; y = Math.min(L.y1, L.y2);
  }
  if (y == null) { el.pill.classList.add('hidden'); return; }
  el.pill.style.left = `${Math.max(90, Math.min(w - 90, x))}px`;
  el.pill.style.top = `${Math.max(46, y)}px`;
  const html = `${DRAW_COLORS.map((c) => `<button class="sw${(d.color || DRAW_COLORS[0]) === c ? ' on' : ''}" data-pill="color" data-v="${c}" style="background:${c}" title="Colour"></button>`).join('')}
    ${d.type === 'trend' ? `<button class="txt${d.extend ? ' on' : ''}" data-pill="extend" title="Extend to the right">Extend →</button>` : ''}
    <button class="txt danger" data-pill="delete" title="Delete (Del)">${I('trash')}</button>`;
  if (el.pill.dataset.html !== html) { el.pill.innerHTML = html; el.pill.dataset.html = html; }
  el.pill.classList.remove('hidden');
}

function drawLoop() {
  if (S.view === 'chart') visiblePanes().forEach(renderDrawings);
  requestAnimationFrame(drawLoop);
}
requestAnimationFrame(drawLoop);

function selectedDrawing() {
  const s = DRAW.selected;
  if (!s) return null;
  const p = PANES[s.pane];
  const d = itemsFor(p).find((x) => x.id === s.id);
  return d ? { p, d } : null;
}

function deleteDrawing(p, d) {
  const key = p.inst.key;
  const before = itemsFor(p);
  setItems(key, before.filter((x) => x.id !== d.id));
  DRAW.selected = null;
  renderChartToolbar();
  toast('info', 'Drawing deleted', '', 4000, { label: 'Undo', fn: () => setItems(key, [...(DRAW.items.get(key) || []), d]) });
}

async function clearDrawings() {
  const p = S.chartLayout === 2 ? PANES[S.chartFocus] : S.chart;
  const items = itemsFor(p);
  if (!p.inst || !items.length) { toast('info', 'No drawings on this chart', '', 2500); return; }
  const name = isOptionInst(p.inst) ? optLabel(p.inst) : p.inst.tradingsymbol;
  if (!(await confirmDialog('Delete all drawings?', `${items.length} drawing${items.length > 1 ? 's' : ''} on <b>${esc(name)}</b> (all intervals).`, 'Delete all', true))) return;
  setItems(p.inst.key, []);
  DRAW.selected = null;
  renderChartToolbar();
  toast('info', 'Drawings cleared', name, 5000, { label: 'Undo', fn: () => setItems(p.inst.key, items) });
}

function startDrawingDrag(p, d, handle, ev) {
  const start = eventPoint(p, ev, false);
  if (!start) return;
  const orig = JSON.parse(JSON.stringify(d));
  const auto = p.api.priceScale('right').options().autoScale;
  p.api.applyOptions({ handleScroll: false, handleScale: false });
  p.api.priceScale('right').applyOptions({ autoScale: false });
  let moved = false;
  const move = (e) => {
    const cur = eventPoint(p, e, handle === 'a' || handle === 'b');
    if (!cur) return;
    moved = true;
    if (d.type === 'hline') d.p = +(orig.p + (cur.p - start.p)).toFixed(4);
    else if (handle === 'a') d.a = cur;
    else if (handle === 'b') d.b = cur;
    else {
      const dt = cur.t - start.t; const dp_ = cur.p - start.p;
      d.a = { t: orig.a.t + dt, p: +(orig.a.p + dp_).toFixed(4) };
      d.b = { t: orig.b.t + dt, p: +(orig.b.p + dp_).toFixed(4) };
    }
    bumpDrawings();
  };
  const up = () => {
    document.removeEventListener('pointermove', move);
    p.api.applyOptions({ handleScroll: true, handleScale: true });
    p.api.priceScale('right').applyOptions({ autoScale: auto }); // keep a zoom the user set
    if (moved) saveDrawings(p.inst.key);
  };
  document.addEventListener('pointermove', move);
  document.addEventListener('pointerup', up, { once: true });
}

function initDrawLayer(p) {
  const el = paneEls(p);
  if (el.drawInit) return;
  el.drawInit = true;
  // Drop the selection when clicking empty chart space.
  el.box.addEventListener('pointerdown', (ev) => {
    if (DRAW.tool === 'cursor' && DRAW.selected && !ev.target.closest('.dw, .draw-pill')
      && performance.now() - (DRAW.createdAt || 0) > 400) { // the creating click must not deselect
      DRAW.selected = null; bumpDrawings(); renderChartToolbar();
    }
  }, true);
  el.draw.addEventListener('pointermove', (ev) => {
    if (DRAW.pending?.pane === p.idx) { DRAW.pending.cur = eventPoint(p, ev, true); bumpDrawings(); }
    else if (DRAW.tool === 'hline') { DRAW.hover = { pane: p.idx, pt: eventPoint(p, ev, true) }; bumpDrawings(); }
  });
  el.draw.addEventListener('pointerleave', () => { if (DRAW.hover) { DRAW.hover = null; bumpDrawings(); } });
  el.draw.addEventListener('pointerdown', (ev) => {
    if (!p.loadedFor || ev.button !== 0) return;
    ev.preventDefault();
    ev.stopPropagation();
    const key = p.inst.key;
    if (DRAW.tool === 'hline') {
      const pt = eventPoint(p, ev, true);
      if (!pt) return;
      const d = { id: drawId(), type: 'hline', p: pt.p, color: DRAW_COLORS[3] };
      setItems(key, [...itemsFor(p), d]);
      setTool('cursor');
      DRAW.selected = { pane: p.idx, id: d.id };
      renderChartToolbar();
      return;
    }
    if (DRAW.tool === 'trend') {
      const pt = eventPoint(p, ev, true);
      if (!pt) return;
      if (DRAW.pending?.pane !== p.idx) { DRAW.pending = { pane: p.idx, a: pt, cur: pt }; renderChartToolbar(); bumpDrawings(); return; }
      if (pt.t === DRAW.pending.a.t && pt.p === DRAW.pending.a.p) return;
      const d = { id: drawId(), type: 'trend', a: DRAW.pending.a, b: pt, color: DRAW_COLORS[0], extend: false };
      setItems(key, [...itemsFor(p), d]);
      setTool('cursor');
      DRAW.selected = { pane: p.idx, id: d.id };
      renderChartToolbar();
      return;
    }
    const g = ev.target.closest('.dw');
    const d = g && itemsFor(p).find((x) => x.id === g.dataset.id);
    if (!d) return;
    DRAW.selected = { pane: p.idx, id: d.id };
    bumpDrawings();
    renderChartToolbar();
    startDrawingDrag(p, d, ev.target.closest('.handle')?.dataset.h || 'body', ev);
  });
  el.pill.addEventListener('pointerdown', (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    const b = ev.target.closest('[data-pill]');
    const s = selectedDrawing();
    if (!b || !s) return;
    if (b.dataset.pill === 'delete') { deleteDrawing(s.p, s.d); return; }
    if (b.dataset.pill === 'color') s.d.color = b.dataset.v;
    if (b.dataset.pill === 'extend') s.d.extend = !s.d.extend;
    bumpDrawings();
    saveDrawings(s.p.inst.key);
  });
}

/* ====================================================== chart trade levels */
// Entry line for each open trade on the charted instrument, fill markers, and
// draggable TP / SL lines. The server places them as linked exit orders (OCO)
// for every product: Kotak Neo has no GTT — see protect.py.
const LV = new Map();
const protModeFor = () => 'oco';
const findProt = (inst, product) => S.prot.items.find((r) => r.exchange === inst.exchange && r.tradingsymbol === inst.tradingsymbol && r.product === product);

function legProblem(t, leg, price, ltp) {
  if (ltp == null) return null;
  const long = t.qty > 0;
  if (leg === 'tp') return (long ? price > ltp : price < ltp) ? null : `TP must be ${long ? 'above' : 'below'} LTP`;
  return (long ? price < ltp : price > ltp) ? null : `SL must be ${long ? 'below' : 'above'} LTP`;
}

function chartTrades() {
  const inst = S.chart.inst;
  if (!inst) return [];
  const pos = S.positions.filter((p) => p.exchange === inst.exchange && p.tradingsymbol === inst.tradingsymbol && p.quantity);
  const out = pos.filter((p) => p.product !== 'CNC')
    .map((p) => ({ product: p.product, qty: p.quantity, avg: p.average_price, mult: p.multiplier || 1 }));
  // CNC: delivery holdings plus anything bought today (same rule as the server).
  const pc = pos.find((p) => p.product === 'CNC');
  const h = ['NSE', 'BSE'].includes(inst.exchange) ? S.holdings.find((x) => x.tradingsymbol === inst.tradingsymbol) : null;
  const held = h ? h.quantity + (h.t1_quantity || 0) - (h.used_quantity || 0) : 0;
  const added = Math.max(pc?.quantity || 0, 0);
  if (held + added > 0) {
    const avg = (held * (h?.average_price || 0) + added * (pc?.average_price || 0)) / (held + added);
    out.push({ product: 'CNC', qty: held + added, avg, mult: 1, holding: held > 0 });
  } else if (pc && pc.quantity < 0) {
    out.push({ product: 'CNC', qty: pc.quantity, avg: pc.average_price, mult: 1 });
  }
  return out;
}

// A trade's TP / SL legs: { tps: [{id, price, qty}], sls: [...] }, qty in order units.
// The server pairs them lot by lot into OCO tranches (see protect.py).
const sideKey = (kind) => (kind === 'tp' ? 'tps' : 'sls');
const legUnit = () => lotUnit(S.chart.inst); // order units per lot (1 for stocks and MCX)
const legsQty = (arr) => arr.reduce((a, l) => a + l.qty, 0);
const newLegId = () => Math.random().toString(36).slice(2, 10);
const lotsLabel = (qty) => (isDeriv(S.chart.inst) ? `${+(qty / legUnit()).toFixed(2)}L` : `${qty} qty`);
const roundTick = (px) => { const tick = S.chart.inst.tick_size || 0.05; return +(Math.round(px / tick) * tick).toFixed(dp(S.chart.inst)); };

function serverLegs(product) {
  const prot = findProt(S.chart.inst, product);
  return { tps: (prot?.tps || []).map((l) => ({ ...l })), sls: (prot?.sls || []).map((l) => ({ ...l })) };
}
const currentLegs = (product) => S.chart.edits[product] || serverLegs(product);
const draftLegs = (product) => (S.chart.edits[product] ||= serverLegs(product));
const freeUnits = (t, legs, kind) => Math.abs(t.qty) - legsQty(legs[sideKey(kind)]);
function legsEqual(a, b) {
  const k = (x) => JSON.stringify(['tps', 'sls'].map((side) => x[side].map((l) => [l.id, l.price, l.qty]).sort()));
  return k(a) === k(b);
}

function desiredLevels() {
  const c = S.chart;
  const out = [];
  for (const t of chartTrades()) {
    const prot = findProt(c.inst, t.product);
    const legs = currentLegs(t.product);
    const free = { tp: freeUnits(t, legs, 'tp'), sl: freeUnits(t, legs, 'sl') };
    const lines = [];
    for (const kind of ['tp', 'sl']) {
      for (const leg of legs[sideKey(kind)]) {
        const server = prot?.[sideKey(kind)]?.find((l) => l.id === leg.id);
        const state = server && server.price === leg.price && server.qty === leg.qty ? 'active' : 'pending';
        lines.push({ id: `${t.product}:${kind}:${leg.id}`, kind, leg, t, price: leg.price, state, free: free[kind],
          count: legs[sideKey(kind)].length, mode: prot?.mode || protModeFor(t.product) });
      }
    }
    out.push({ id: `${t.product}:entry`, kind: 'entry', t, price: t.avg, free }, ...lines);
  }
  // Working orders (not TP / SL legs) as dashed lines: drag to change the price, ✕ to cancel.
  for (const o of S.orders) {
    if (o.exchange !== c.inst.exchange || o.tradingsymbol !== c.inst.tradingsymbol || !PENDING.has(o.status)) continue;
    if (o.tag === 'ktTP' || o.tag === 'ktSL' || o.order_type === 'MARKET') continue;
    const stop = o.order_type === 'SL' || o.order_type === 'SL-M';
    const price = c.orderDrag?.[o.order_id] ?? (stop ? o.trigger_price : o.price);
    if (price > 0) out.push({ id: `ord:${o.order_id}`, kind: 'order', o, price, stop });
  }
  return out;
}

function paintOrderLevel(lv) {
  const { o } = lv;
  const inst = S.chart.inst;
  const buy = o.transaction_type === 'BUY';
  const units = o.pending_quantity || o.quantity;
  const qty = isDeriv(inst) ? `${+(units / lotUnit(inst)).toFixed(2)}L` : `${units} qty`;
  const type = { LIMIT: 'LMT', SL: 'SL', 'SL-M': 'SL-M' }[o.order_type] || o.order_type;
  const hint = lv.dragging ? '<span class="hint">release to modify</span>' : lv.saving ? '<span class="hint">modifying…</span>' : '';
  const html = `<div class="cl-hit"></div><div class="cl-lead"></div><div class="cl-pill" title="Working order: drag to change its price">`
    + `<span class="grip hov">⋮⋮</span><span class="tag">${o.transaction_type} ${type}</span><b>${qty}</b>`
    + `<span class="px num">${fmt(lv.price, dp(inst))}</span>${hint}`
    + `<button data-lv="cancel-order" title="Cancel this order">✕</button></div>`;
  lv.el.className = `cl ord ${buy ? 'buy' : 'sell'}${lv.dragging ? ' dragging' : ''}`;
  lv.pl.applyOptions({ price: lv.price, color: cssVar(buy ? '--buy' : '--sell'), lineStyle: 2, lineWidth: 1, title: '' });
  if (lv.html !== html) { lv.el.innerHTML = html; lv.html = html; placeLabel(lv); }
}

async function cancelChartOrder(o) {
  try {
    await api(`/orders/${o.variety}/${o.order_id}`, { method: 'DELETE' });
    toast('success', `${o.transaction_type} order cancelled`, prettyKey(o), 2500);
  } catch (e) { toast('error', 'Could not cancel the order', e.message); }
  loadOrders().catch(() => {});
}

function startOrderDrag(lv, down) {
  const c = S.chart;
  const { o } = lv;
  const rect = $('#chart').getBoundingClientRect();
  const from = lv.price;
  const startY = c.series.priceToCoordinate(from);
  const pinned = lv.el.classList.contains('pin-up') || lv.el.classList.contains('pin-down');
  const grab = startY == null || pinned ? 0 : down.clientY - rect.top - startY;
  const auto = c.api.priceScale('right').options().autoScale;
  c.api.applyOptions({ handleScroll: false, handleScale: false });
  c.api.priceScale('right').applyOptions({ autoScale: false });
  c.orderDrag = c.orderDrag || {};
  lv.dragging = true;
  const move = (ev) => {
    const p = c.series.coordinateToPrice(ev.clientY - rect.top - grab);
    if (p == null || p <= 0) return;
    c.orderDrag[o.order_id] = roundTick(p);
    syncChartLevels();
  };
  const up = async () => {
    document.removeEventListener('pointermove', move);
    lv.dragging = false;
    c.api.applyOptions({ handleScroll: true, handleScale: true });
    c.api.priceScale('right').applyOptions({ autoScale: auto });
    const to = c.orderDrag[o.order_id];
    if (to == null || to === from) { delete c.orderDrag[o.order_id]; syncChartLevels(); return; }
    // A stop-limit keeps its gap between trigger and limit; a limit just moves.
    const body = { order_type: o.order_type, quantity: o.quantity, exchange: o.exchange, tradingsymbol: o.tradingsymbol };
    if (o.order_type === 'LIMIT') body.price = to;
    else {
      body.trigger_price = to;
      if (o.order_type === 'SL') body.price = roundTick(o.price + (to - o.trigger_price));
    }
    lv.saving = true;
    syncChartLevels();
    try {
      await api(`/orders/${o.variety}/${o.order_id}`, { method: 'PUT', body });
      toast('success', `${o.transaction_type} order moved to ${fmt(to)}`, prettyKey(o), 2500);
      await loadOrders().catch(() => {});
    } catch (e) {
      toast('error', 'Could not modify the order', e.message);
    } finally {
      lv.saving = false;
      delete c.orderDrag[o.order_id];
      syncChartLevels();
    }
  };
  document.addEventListener('pointermove', move);
  document.addEventListener('pointerup', up, { once: true });
}

function clearLevels() {
  for (const lv of LV.values()) { try { S.chart.series.removePriceLine(lv.pl); } catch { /* series reset */ } lv.el.remove(); }
  LV.clear();
}

function syncChartLevels() {
  const c = S.chart;
  if (!c.api || !c.inst || !c.loadedFor) { clearLevels(); return; }
  const want = desiredLevels();
  const ids = new Set(want.map((w) => w.id));
  for (const [id, lv] of LV) if (!ids.has(id)) { c.series.removePriceLine(lv.pl); lv.el.remove(); LV.delete(id); }
  for (const w of want) {
    let lv = LV.get(w.id);
    if (!lv) {
      const el = document.createElement('div');
      el.dataset.id = w.id;
      $('#chart-lines').append(el);
      lv = { el, pl: c.series.createPriceLine({ price: w.price, axisLabelVisible: true, lineWidth: 1 }) };
      LV.set(w.id, lv);
    }
    Object.assign(lv, w);
    paintLevel(lv);
  }
  positionLevels();
}

function paintLevel(lv) {
  if (lv.kind === 'order') { paintOrderLevel(lv); return; }
  const inst = S.chart.inst;
  const n = dp(inst);
  const t = lv.t;
  const long = t.qty > 0;
  const ltp = S.quotes[inst.key]?.last_price;
  const pnlAt = (px) => (px - t.avg) * t.qty * t.mult;
  let html;
  let klass = `cl ${lv.kind}`;
  if (lv.kind === 'entry') {
    klass += long ? ' long' : ' short';
    const pnl = ltp != null ? pnlAt(ltp) : null;
    html = `<div class="cl-pill"><span class="tag">${long ? 'LONG' : 'SHORT'} ${Math.abs(t.qty)}</span>
      <span class="muted">${esc(t.product)}${t.holding ? ' · holding' : ''}</span><span class="px num">@ ${fmt(t.avg, n)}</span>
      <span class="num ${cls(pnl)}">${pnl == null ? '' : signed(pnl)}</span>
      <span class="acts">${['tp', 'sl'].map((k) => {
        const free = lv.free[k];
        if (free <= 0) return '';
        const part = free < Math.abs(t.qty) && isDeriv(inst) ? ` ${lotsLabel(free)}` : '';
        return `<button class="add-${k}" data-lv="add-${k}" title="Add a ${k === 'tp' ? 'take-profit' : 'stop-loss'} line for the ${lotsLabel(free)} not yet covered">+ ${k.toUpperCase()}${part}</button>`;
      }).join('')}${
        isDeriv(inst) && Math.abs(t.qty) / lotUnit(inst) >= 2 ? '<button data-lv="book1" title="Book 1 lot at market">−1L</button><button data-lv="bookhalf" title="Book half the lots at market">½</button>' : ''
      }<button data-lv="exit" title="Exit at market">Exit</button></span></div>`;
    lv.pl.applyOptions({ price: lv.price, color: cssVar(long ? '--buy' : '--sell'), lineStyle: 0, lineWidth: 1, title: '' });
  } else {
    const label = lv.kind.toUpperCase();
    const leg = lv.leg;
    const unit = legUnit();
    const legLots = leg.qty / unit;
    const pnl = (lv.price - t.avg) * (long ? 1 : -1) * leg.qty * t.mult;
    const move = ((lv.price - t.avg) / t.avg) * 100 * (long ? 1 : -1);
    const bad = legProblem(t, lv.kind, lv.price, ltp);
    klass += ` ${lv.state}${bad ? ' invalid' : ''}${lv.dragging ? ' dragging' : ''}`;
    const pending = lv.state !== 'active';
    // Multi-lot controls only for F&O positions of 2+ lots; everything else keeps the single-line TP/SL.
    const multi = isDeriv(inst) && Math.abs(t.qty) / unit >= 2;
    const lots = !multi ? '' : pending ? `<span class="lots"><b>${lotsLabel(leg.qty)}</b></span>`
      : `<span class="lots"><button class="hov" data-lv="lot-minus" ${leg.qty <= unit ? 'disabled' : ''} title="One lot less">−</button><b>${lotsLabel(leg.qty)}</b><button class="hov" data-lv="lot-plus" ${lv.free < unit ? 'disabled' : ''} title="${lv.free < unit ? 'All lots already covered on this side' : 'One lot more'}">+</button></span>`;
    const split = multi && !pending && legLots >= 2 && Number.isInteger(legLots)
      ? `<button data-lv="split" title="Split this ${legLots}-lot ${label} into several lines">Split</button>` : '';
    const acts = pending ? '' : `${split}<span class="mode" title="Exit orders at the exchange, linked by this app (OCO)">${lv.mode.toUpperCase()}</span><button data-lv="cancel" title="Cancel this ${label} (${lotsLabel(leg.qty)})">✕</button>`;
    // Compact by default (tag, lots, price, P&L); the rest of the controls show on hover.
    html = `<div class="cl-hit"></div><div class="cl-lead"></div><div class="cl-pill" title="Drag to move"><span class="grip hov">⋮⋮</span><span class="tag">${label}</span>${lots}
      <span class="px num">${fmt(lv.price, n)}</span><span class="num ${cls(pnl)}">${signed(pnl)}<span class="faint hov">&nbsp;(${signed(move)}%)</span></span>
      ${bad ? `<span class="warn">${bad}</span>` : lv.dragging ? '<span class="hint">release to save</span>' : pending ? '<span class="hint">saving…</span>' : ''}
      ${acts ? `<span class="acts hov">${acts}</span>` : ''}</div>`;
    lv.pl.applyOptions({ price: lv.price, color: cssVar(lv.kind === 'tp' ? '--up' : '--down'),
      lineStyle: lv.state === 'active' ? 0 : 2, lineWidth: lv.state === 'active' ? 1 : 2, title: '' }); // the pill names it; titles crowd the price axis
  }
  lv.el.className = klass;
  if (lv.html !== html) {
    lv.el.innerHTML = html;
    lv.html = html;
    if (lv.kind !== 'entry') placeLabel(lv);
  }
}

const LABEL_GAP = 28; // px between stacked TP / SL labels
const LEVEL_REACH = 0.35; // autoscale pulls in lines within 35% of the candles' range beyond it
const PIN_EDGE = 14; // px from the top / bottom where off-screen lines are pinned

function placeLabel(lv) {
  const off = lv.labelOff || 0;
  const pill = lv.el.querySelector('.cl-pill');
  const lead = lv.el.querySelector('.cl-lead');
  if (pill) pill.style.top = `${off}px`;
  if (lead) { lead.style.top = `${Math.min(0, off)}px`; lead.style.height = `${Math.abs(off)}px`; }
}

function positionLevels() {
  const c = S.chart;
  if (!c.api || !LV.size) return;
  $('#chart-lines').style.right = c.api.priceScale('right').width() + 'px';
  const { h } = plotSize(c);
  const right = [];
  for (const lv of LV.values()) {
    const raw = c.series.priceToCoordinate(lv.price);
    lv.el.style.display = raw == null ? 'none' : '';
    if (raw == null) continue;
    // Outside the visible price range: keep the label on screen, pinned to the edge, marked ▲ / ▼.
    const pin = raw < 0 ? 'up' : raw > h ? 'down' : '';
    const y = pin === 'up' ? PIN_EDGE : pin === 'down' ? h - PIN_EDGE : raw;
    lv.el.classList.toggle('pin-up', pin === 'up');
    lv.el.classList.toggle('pin-down', pin === 'down');
    lv.el.style.transform = `translateY(${y}px)`;
    if (lv.kind !== 'entry') right.push({ lv, y });
  }
  // TP / SL labels whose lines are close together stack vertically by the price axis
  // (a short leader ties each to its line) instead of spreading over the candles.
  const sig = right.map((r) => `${r.lv.id}:${Math.round(r.y)}`).join('|');
  if (sig === positionLevels.sig) return;
  positionLevels.sig = sig;
  const groups = [];
  for (const r of right.sort((a, b) => a.y - b.y)) {
    groups.push({ items: [r], sum: r.y });
    // Merge while the newest group overlaps the one above it; each group is centred on its lines.
    while (groups.length > 1) {
      const g = groups[groups.length - 1];
      const prev = groups[groups.length - 2];
      const top = (x) => x.sum / x.items.length - ((x.items.length - 1) * LABEL_GAP) / 2;
      if (top(prev) + prev.items.length * LABEL_GAP <= top(g)) break;
      prev.items.push(...g.items); prev.sum += g.sum; groups.pop();
    }
  }
  for (const g of groups) {
    const top = g.sum / g.items.length - ((g.items.length - 1) * LABEL_GAP) / 2;
    g.items.forEach((r, k) => { r.lv.labelOff = top + k * LABEL_GAP - r.y; placeLabel(r.lv); });
  }
}

function levelsLoop() {
  if (S.view === 'chart' && LV.size) positionLevels(); // follows pans, zooms and price-scale drags
  requestAnimationFrame(levelsLoop);
}

function updateMarkers(c = S.chart) {
  if (!c.api || !c.bars?.length || !c.inst || !c.loadedFor) return;
  const times = c.bars.map((b) => b.time);
  const markers = [];
  for (const t of S.trades) {
    if (t.exchange !== c.inst.exchange || t.tradingsymbol !== c.inst.tradingsymbol) continue;
    // Fill times are IST wall-clock; bars use IST-as-UTC seconds, so parse as UTC.
    const ts = Date.parse(String(t.fill_timestamp || t.exchange_timestamp || '').replace(' ', 'T') + 'Z') / 1000;
    if (!isFinite(ts)) continue;
    let lo = 0; let hi = times.length - 1; let idx = -1;
    while (lo <= hi) { const mid = (lo + hi) >> 1; if (times[mid] <= ts) { idx = mid; lo = mid + 1; } else hi = mid - 1; }
    if (idx < 0) continue;
    const buy = t.transaction_type === 'BUY';
    markers.push({ time: times[idx], position: buy ? 'belowBar' : 'aboveBar', color: cssVar(buy ? '--buy' : '--sell'),
      shape: buy ? 'arrowUp' : 'arrowDown', text: `${buy ? 'B' : 'S'} ${t.quantity} @ ${fmt(t.average_price, dp(c.inst))}` });
  }
  markers.sort((a, b) => a.time - b.time);
  c.series.setMarkers(markers);
}

function refreshChartTrades() {
  if (S.view !== 'chart') return;
  syncChartLevels();
  updateMarkers();
  if (S.chartLayout === 2) updateMarkers(S.chart2);
}

function afterChartLoad() {
  const c = S.chart;
  syncChartLevels();
  updateMarkers();
  const product = c.pendingProtect;
  if (!product) return;
  c.pendingProtect = null;
  const t = chartTrades().find((x) => x.product === product);
  if (!t) { toast('info', 'No open trade to protect yet', 'TP / SL can be set once the position shows up.'); return; }
  const legs = draftLegs(product);
  for (const kind of ['tp', 'sl']) {
    const free = freeUnits(t, legs, kind);
    if (free > 0) legs[sideKey(kind)].push({ id: newLegId(), price: defaultLegPrice(t, kind, legs), qty: free });
  }
  normalizeEdits(product);
  if (c.edits[product]) { syncChartLevels(); saveProtection(product, 'TP / SL placed'); }
}

// Where a new line starts: beyond the farthest existing line of that side, else a
// target beyond both entry and market, a stop just beyond the market.
function defaultLegPrice(t, kind, legs) {
  const ltp = S.quotes[S.chart.inst.key]?.last_price ?? t.avg;
  const long = t.qty > 0;
  const up = (kind === 'tp') === long;
  const gap = isOptionInst(S.chart.inst) ? 0.05 : 0.01; // premiums move far more than stocks
  const existing = legs[sideKey(kind)].map((l) => l.price);
  let from;
  if (existing.length) from = up ? Math.max(...existing) : Math.min(...existing);
  else from = kind === 'tp' ? (long ? Math.max(ltp, t.avg) : Math.min(ltp, t.avg)) : ltp;
  return roundTick(from * (up ? 1 + gap : 1 - gap));
}

// TP / SL lines are live: every change is sent to the exchange straight away.
function addLevel(product, kind) {
  const t = chartTrades().find((x) => x.product === product);
  if (!t) return;
  const legs = draftLegs(product);
  const free = freeUnits(t, legs, kind);
  if (free <= 0) { normalizeEdits(product); return; }
  const price = defaultLegPrice(t, kind, legs);
  legs[sideKey(kind)].push({ id: newLegId(), price, qty: free });
  syncChartLevels();
  saveProtection(product, `${kind.toUpperCase()} ${lotsLabel(free)} placed at ${fmt(price)}`);
}

function changeLots(product, kind, id, delta) {
  const t = chartTrades().find((x) => x.product === product);
  const legs = draftLegs(product);
  const leg = legs[sideKey(kind)].find((l) => l.id === id);
  const unit = legUnit();
  if (!t || !leg) return;
  const next = leg.qty + delta * unit;
  if (next < unit || (delta > 0 && freeUnits(t, legs, kind) < unit)) { normalizeEdits(product); return; }
  leg.qty = next;
  syncChartLevels();
  saveProtection(product, `${kind.toUpperCase()} at ${fmt(leg.price)} now ${lotsLabel(next)}`);
}

// Lots shared out as evenly as possible, larger parts nearest the market (7 into 3 → 3, 2, 2).
const splitLots = (lots, n) => Array.from({ length: n }, (_, k) => Math.floor(lots / n) + (k < lots % n ? 1 : 0));

// Prices for the split lines: the first keeps the line's price, the rest step away from
// the market. Steps shrink as lines grow so 20 lines don't spread absurdly far.
function splitPrices(t, kind, price, n) {
  const up = (kind === 'tp') === (t.qty > 0);
  const option = isOptionInst(S.chart.inst);
  const tick = S.chart.inst.tick_size || 0.05;
  const step = Math.max(tick, Math.min(price * (option ? 0.03 : 0.005), (price * (option ? 0.15 : 0.03)) / Math.max(1, n - 1)));
  return Array.from({ length: n }, (_, k) => roundTick(price + (up ? 1 : -1) * step * k));
}

function splitLeg(product, kind, id, n) {
  const t = chartTrades().find((x) => x.product === product);
  const legs = draftLegs(product);
  const arr = legs[sideKey(kind)];
  const i = arr.findIndex((l) => l.id === id);
  if (!t || i < 0) return;
  const leg = arr[i];
  const unit = legUnit();
  const lots = Math.round(leg.qty / unit);
  n = Math.max(2, Math.min(n, lots));
  const prices = splitPrices(t, kind, leg.price, n);
  const parts = splitLots(lots, n).map((l, k) => ({ id: k ? newLegId() : leg.id, price: prices[k], qty: l * unit }));
  arr.splice(i, 1, ...parts);
  syncChartLevels();
  saveProtection(product, `${kind.toUpperCase()} ${lots}L split into ${n} lines (${parts.map((x) => `${lotsLabel(x.qty)} @ ${fmt(x.price)}`).join(', ')})`);
}

function askSplit(product, kind, id) {
  const t = chartTrades().find((x) => x.product === product);
  const leg = currentLegs(product)[sideKey(kind)].find((l) => l.id === id);
  if (!t || !leg) return;
  const lots = Math.round(leg.qty / legUnit());
  const max = Math.min(lots, 50);
  const presets = [...new Set([2, 3, 4, 5, 10, lots].filter((x) => x >= 2 && x <= max))].sort((a, b) => a - b);
  const label = kind.toUpperCase();
  const m = openModal(`<div class="dialog split-dlg" role="dialog">
    <h2>Split ${label} ${lots}L at ${fmt(leg.price)}</h2>
    <p>Into how many lines? Lots are shared out as evenly as possible, and prices step away from the market, ready to drag.</p>
    <div class="split-presets">${presets.map((n) => `<button type="button" data-n="${n}">${n === lots ? `${n} (1L each)` : n}</button>`).join('')}
      <input type="number" class="input split-n" min="2" max="${max}" step="1" value="${Math.min(max, presets.includes(lots) && lots <= 5 ? lots : presets[0])}" aria-label="Number of lines"></div>
    <div class="split-preview"></div>
    <div class="acts"><button class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-primary" data-ok>Split</button></div></div>`);
  const input = m.el.querySelector('.split-n');
  const count = () => Math.max(2, Math.min(max, Math.round(+input.value) || 2));
  const preview = () => {
    const n = count();
    const prices = splitPrices(t, kind, leg.price, n);
    m.el.querySelector('.split-preview').innerHTML = splitLots(lots, n).map((l, k) =>
      `<div><span class="chip ${kind === 'tp' ? 'ok' : 'bad'}">${label}</span><b class="num">${isDeriv(S.chart.inst) ? `${l}L` : l}</b><span class="num">@ ${fmt(prices[k])}</span></div>`).join('');
    m.el.querySelectorAll('[data-n]').forEach((b) => b.classList.toggle('active', +b.dataset.n === n));
  };
  const go = () => { const n = count(); m.close(); splitLeg(product, kind, id, n); };
  m.el.querySelector('.split-presets').addEventListener('click', (e) => {
    const b = e.target.closest('[data-n]');
    if (b) { input.value = b.dataset.n; preview(); }
  });
  input.addEventListener('input', preview);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); go(); } });
  m.el.querySelector('[data-ok]').onclick = go;
  preview();
  setTimeout(() => { input.focus(); input.select(); }, 30);
}

function cancelLeg(product, kind, id) {
  const before = JSON.parse(JSON.stringify(currentLegs(product)));
  const legs = draftLegs(product);
  const arr = legs[sideKey(kind)];
  const i = arr.findIndex((l) => l.id === id);
  if (i < 0) return;
  const [leg] = arr.splice(i, 1);
  syncChartLevels();
  saveProtection(product, `${kind.toUpperCase()} ${lotsLabel(leg.qty)} at ${fmt(leg.price)} cancelled`, { undo: before });
}

function normalizeEdits(product) {
  const c = S.chart;
  if (c.edits[product] && legsEqual(c.edits[product], serverLegs(product))) delete c.edits[product];
}

function startLevelDrag(lv, down) {
  const c = S.chart;
  const rect = $('#chart').getBoundingClientRect();
  const product = lv.t.product;
  const id = lv.leg.id;
  lv.dragging = true;
  const startY = c.series.priceToCoordinate(lv.price);
  // A pinned label (its line is off-screen) brings the line to the cursor; otherwise drag relative
  // to where the drag started, so a label stacked off its line doesn't make the line jump.
  const pinned = lv.el.classList.contains('pin-up') || lv.el.classList.contains('pin-down');
  const grab = startY == null || pinned ? 0 : down.clientY - rect.top - startY;
  const auto = c.api.priceScale('right').options().autoScale;
  c.api.applyOptions({ handleScroll: false, handleScale: false });
  c.api.priceScale('right').applyOptions({ autoScale: false }); // keep the axis still under the cursor
  const move = (ev) => {
    const p = c.series.coordinateToPrice(ev.clientY - rect.top - grab);
    if (p == null || p <= 0) return;
    const leg = draftLegs(product)[sideKey(lv.kind)].find((l) => l.id === id);
    if (leg) leg.price = roundTick(p);
    syncChartLevels();
  };
  const up = () => {
    lv.dragging = false;
    c.api.applyOptions({ handleScroll: true, handleScale: true });
    c.api.priceScale('right').applyOptions({ autoScale: auto }); // keep a zoom the user set
    document.removeEventListener('pointermove', move);
    normalizeEdits(product);
    syncChartLevels();
    const leg = c.edits[product]?.[sideKey(lv.kind)].find((l) => l.id === id);
    if (c.edits[product]) saveProtection(product, leg ? `${lv.kind.toUpperCase()} ${lotsLabel(leg.qty)} moved to ${fmt(leg.price)}` : 'TP / SL updated');
  };
  document.addEventListener('pointermove', move);
  document.addEventListener('pointerup', up, { once: true });
}

// Saves are serialised per trade; changes made while one is in flight go out
// right after it (a drag in progress is saved on drop).
function applySavedProtection(inst, product, rec) {
  const same = (p) => p.exchange === inst.exchange && p.tradingsymbol === inst.tradingsymbol && p.product === product;
  S.prot.items = [...S.prot.items.filter((p) => !same(p)), ...(rec && rec.key ? [rec] : [])];
  S.prot.sig = JSON.stringify(S.prot.items);
  renderCurrent();
  refreshChartTrades();
}

const isDragging = (product) => [...LV.values()].some((l) => l.dragging && l.t?.product === product);
const savingProt = new Map();
async function saveProtection(product, msg = 'TP / SL updated', opts = {}) {
  const c = S.chart;
  const queued = savingProt.get(product);
  if (queued) { queued.again = true; queued.msg = msg; queued.undo = opts.undo || queued.undo; return; }
  const job = { again: false, msg, undo: opts.undo };
  savingProt.set(product, job);
  const inst = c.inst;
  const name = isOptionInst(inst) ? optLabel(inst) : inst.tradingsymbol;
  try {
    do {
      job.again = false;
      if (S.chart.inst?.key !== inst.key || isDragging(product)) break;
      const draft = c.edits[product];
      const t = chartTrades().find((x) => x.product === product);
      if (!draft || !t) break;
      const sent = JSON.parse(JSON.stringify(draft));
      const forget = () => { if (c.edits[product] && legsEqual(c.edits[product], sent)) delete c.edits[product]; };
      const ltp = S.quotes[inst.key]?.last_price;
      const bad = [...sent.tps.map((l) => legProblem(t, 'tp', l.price, ltp)), ...sent.sls.map((l) => legProblem(t, 'sl', l.price, ltp))].find(Boolean);
      if (bad) { forget(); toast('error', 'TP / SL not changed', bad); continue; }
      const { msg: text, undo } = job;
      job.undo = null;
      try {
        const rec = await api('/protections', { method: 'POST', body: { exchange: inst.exchange, tradingsymbol: inst.tradingsymbol, product, tps: sent.tps, sls: sent.sls } });
        applySavedProtection(inst, product, rec);
        forget();
        loadProtections().catch(() => {});
        toast(undo ? 'info' : 'success', text, name, undo ? 6000 : 2500, undo ? {
          label: 'Undo',
          fn: () => {
            if (S.chart.inst?.key !== inst.key) { toast('info', 'Open that chart to undo'); return; }
            S.chart.edits[product] = undo;
            syncChartLevels();
            saveProtection(product, 'TP / SL restored');
          },
        } : null);
      } catch (e) {
        forget();
        toast('error', 'Could not update TP / SL', e.message);
        await loadProtections().catch(() => {});
      }
    } while (job.again || (c.edits[product] && !isDragging(product) && S.chart.inst?.key === inst.key));
  } finally {
    savingProt.delete(product);
    syncChartLevels();
    loadOrders().catch(() => {});
  }
}

function levelAction(lv, act) {
  if (lv.kind === 'order') { if (act === 'cancel-order') cancelChartOrder(lv.o); return; }
  const c = S.chart;
  const product = lv.t.product;
  const asPos = () => ({ exchange: c.inst.exchange, tradingsymbol: c.inst.tradingsymbol, product, quantity: lv.t.qty,
    average_price: lv.t.avg, multiplier: lv.t.mult, last_price: S.quotes[c.inst.key]?.last_price });
  if (act === 'add-tp' || act === 'add-sl') addLevel(product, act.slice(4));
  else if (act === 'lot-minus' || act === 'lot-plus') changeLots(product, lv.kind, lv.leg.id, act === 'lot-plus' ? 1 : -1);
  else if (act === 'split') askSplit(product, lv.kind, lv.leg.id);
  else if (act === 'cancel') cancelLeg(product, lv.kind, lv.leg.id);
  else if (act === 'book1') bookLots(asPos(), 1);
  else if (act === 'bookhalf') bookLots(asPos(), Math.floor(Math.abs(lv.t.qty) / lotUnit(c.inst) / 2));
  else if (act === 'exit') openOrder(c.inst, lv.t.qty > 0 ? 'SELL' : 'BUY', { units: Math.abs(lv.t.qty), product, orderType: 'MARKET' });
}

/* ========================================================== options trading */
const DERIV_EXCH = new Set(['NFO', 'BFO', 'MCX', 'CDS', 'BCD']);
const UNDERLYING_LABELS = { NIFTY: 'NIFTY', BANKNIFTY: 'BANK NIFTY', SENSEX: 'SENSEX' };
const isOptionInst = (i) => !!i && (i.instrument_type === 'CE' || i.instrument_type === 'PE');
const optLabel = (i) => `${i.name} ${+i.strike} ${i.instrument_type}`;
const lotUnit = (inst) => (!inst || qtyInLots(inst) ? 1 : inst.lot_size || 1);

S.instCache = new Map();
S.oc = { underlying: store.get('ocUnderlying', 'NIFTY'), expiry: null, data: null, range: store.get('ocRange', 12),
  keys: [], cells: new Map(), slot: null, loading: false, error: null, posRows: [] };
S.confirmBook = store.get('confirmBook', true);

function cacheInst(i) { if (i?.tradingsymbol) S.instCache.set(keyOf(i), i); }
function prettyKey(p) { const i = S.instCache.get(keyOf(p)); return isOptionInst(i) ? optLabel(i) : p.tradingsymbol; }
function lotsOf(p) { return Math.abs(p.quantity) / lotUnit(S.instCache.get(keyOf(p))); }
function livePnl(p) {
  const q = S.quotes[keyOf(p)];
  if (!q || p.buy_value == null) return p.pnl;
  return (p.sell_value - p.buy_value) + p.quantity * q.last_price * (p.multiplier || 1);
}

async function ensureInstCache(rows) {
  const missing = [...new Set(rows.filter((r) => DERIV_EXCH.has(r.exchange)).map(keyOf))].filter((k) => !S.instCache.has(k));
  if (!missing.length) return;
  missing.forEach((k) => S.instCache.set(k, null)); // don't refetch while pending
  try {
    const found = await api('/instruments/lookup?' + missing.map((k) => 'i=' + encodeURIComponent(k)).join('&'));
    Object.values(found).forEach(cacheInst);
    S.sigs = {};
    renderCurrent();
  } catch { missing.forEach((k) => S.instCache.delete(k)); }
}

/* ------------------------------------------------- partial profit booking */
function bookChoices(lots) {
  lots = Math.floor(lots);
  if (lots < 1) return [];
  const seen = new Set([lots]);
  const out = [];
  for (const [n, label] of [[1, '1 lot'], [Math.floor(lots / 4), '25%'], [Math.floor(lots / 2), '50%']]) {
    if (n >= 1 && !seen.has(n)) { seen.add(n); out.push({ n, label: label === '1 lot' ? label : `${label} · ${n}L` }); }
  }
  out.push({ n: lots, label: lots > 1 ? `All · ${lots}L` : 'Exit' });
  return out;
}
const bookButtons = (p, attr) => bookChoices(lotsOf(p)).map((c) =>
  `<button class="bk${c.n === Math.floor(lotsOf(p)) ? ' all' : ''}" ${attr}="${c.n}" title="${c.n === Math.floor(lotsOf(p)) ? 'Exit the whole position' : `Book ${c.n} lot(s) at market`}">${c.label}</button>`).join('');

const bookingBusy = new Set();
async function bookLots(p, n) {
  const busyKey = `${keyOf(p)}:${p.product}`;
  if (bookingBusy.has(busyKey)) return;
  const inst = await resolveInst(p);
  cacheInst(inst);
  const unit = lotUnit(inst);
  const open = Math.floor(Math.abs(p.quantity) / unit);
  n = Math.min(n, open);
  if (n < 1) return;
  const qty = n * unit;
  const side = p.quantity > 0 ? 'SELL' : 'BUY';
  const name = isOptionInst(inst) ? optLabel(inst) : p.tradingsymbol;
  const ltp = S.quotes[keyOf(p)]?.last_price ?? p.last_price;
  const all = n === open;
  if (S.confirmBook) {
    const est = (ltp - p.average_price) * (p.quantity > 0 ? 1 : -1) * qty * (p.multiplier || 1);
    const ok = await confirmDialog(all ? 'Exit position?' : `Book ${n} of ${open} lots?`,
      `${side} <b>${n} lot${n > 1 ? 's' : ''}</b> (${qty} qty) of <b>${esc(name)}</b> at market · ${esc(p.product)}
       <br><span class="muted">LTP ${fmt(ltp)} · est. P&amp;L on this part <span class="${cls(est)}">${signed(est)}</span>${all ? '' : ` · ${open - n} lot(s) stay open`}</span>`,
      all ? 'Exit' : `Book ${n}L`, all);
    if (!ok) return;
  }
  bookingBusy.add(busyKey);
  try {
    const r = await api('/orders/regular', { method: 'POST', body: {
      exchange: p.exchange, tradingsymbol: p.tradingsymbol, transaction_type: side, order_type: 'MARKET',
      product: p.product, quantity: qty, validity: 'DAY', tag: 'ktBook' } });
    toast('success', all ? `Exiting ${name}` : `Booking ${n}L of ${name}`, `${side} ${qty} qty at market · #${r.order_id}`);
  } catch (e) {
    toast('error', 'Booking failed', e.message);
  } finally {
    setTimeout(() => bookingBusy.delete(busyKey), 1500);
    loadOrders().catch(() => {});
    setTimeout(() => loadPortfolio().catch(() => {}), 800);
  }
}

async function exitAllDerivs() {
  // Buy back shorts first so hedged positions don't spike margin, then sell longs.
  const open = S.positions.filter((p) => p.quantity && DERIV_EXCH.has(p.exchange)).sort((a, b) => a.quantity - b.quantity);
  if (!open.length) return;
  const ok = await confirmDialog('Exit all F&O positions?',
    `Market orders for <b>${open.length}</b> position${open.length > 1 ? 's' : ''}:<br><span class="num" style="font-size:12.5px">${
      open.map((p) => `${p.quantity > 0 ? 'SELL' : 'BUY'} ${Math.abs(p.quantity)} × ${esc(prettyKey(p))} (${esc(p.product)})`).join('<br>')}</span>`,
    'Exit all', true);
  if (!ok) return;
  const failed = [];
  for (const p of open) {
    try {
      await api('/orders/regular', { method: 'POST', body: {
        exchange: p.exchange, tradingsymbol: p.tradingsymbol, transaction_type: p.quantity > 0 ? 'SELL' : 'BUY',
        order_type: 'MARKET', product: p.product, quantity: Math.abs(p.quantity), validity: 'DAY', tag: 'ktExit' } });
    } catch (e) { failed.push(`${prettyKey(p)}: ${e.message}`); }
  }
  if (failed.length) toast('error', `${failed.length} exit order(s) failed`, failed.join(' · '));
  else toast('success', 'Exit orders placed', `${open.length} position(s)`);
  loadOrders().catch(() => {});
  setTimeout(() => loadPortfolio().catch(() => {}), 800);
}

/* ------------------------------------------------------------ option chain */
async function loadChain() {
  const oc = S.oc;
  oc.loading = true; oc.error = null;
  renderCurrent('options');
  try {
    const d = await api(`/options/chain?underlying=${oc.underlying}${oc.expiry ? `&expiry=${oc.expiry}` : ''}`);
    d.strikes.forEach((s) => { cacheInst(s.CE); cacheInst(s.PE); });
    oc.data = d; oc.expiry = d.expiry;
  } catch (e) { oc.data = null; oc.error = e.message; }
  oc.loading = false; oc.slot = null; oc.scrollToAtm = true;
  renderCurrent('options');
  quotesSoon();
}

function daysTo(expiry) {
  const t = istNow(); t.setHours(0, 0, 0, 0);
  return Math.round((new Date(expiry + 'T00:00:00') - t) / 86400000);
}
function expiryLabel(e) {
  const d = daysTo(e);
  const wd = new Date(e + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'short' });
  return `${fmtExpiry(e)} ${wd} · ${d <= 0 ? 'expiry today' : d + 'd'}`;
}

function chainSlot() {
  const d = S.oc.data;
  const spot = S.quotes[d.spot]?.last_price;
  let atmI = Math.floor(d.strikes.length / 2);
  if (spot) {
    let best = Infinity;
    d.strikes.forEach((s, i) => { const diff = Math.abs(s.strike - spot); if (diff < best) { best = diff; atmI = i; } });
  }
  return { spot, atmI, slot: spot ? d.strikes.findIndex((s) => s.strike > spot) : -2 };
}

function renderOptions(el) {
  const oc = S.oc;
  const d = oc.data;
  const unders = d?.underlyings || Object.keys(UNDERLYING_LABELS);
  el.innerHTML = `
    <div class="view-head oc-head">
      <div><h1>Option chain</h1><p class="oc-spot" id="oc-spot">${d ? '' : '&nbsp;'}</p></div>
      <div class="oc-controls">
        <div class="seg-tabs">${unders.map((u) => `<button data-oc-u="${u}" class="${u === oc.underlying ? 'active' : ''}">${UNDERLYING_LABELS[u] || u}</button>`).join('')}</div>
        <select class="input oc-select" id="oc-expiry" ${d?.expiries?.length ? '' : 'disabled'} title="Expiry">
          ${(d?.expiries || []).slice(0, 12).map((e) => `<option value="${e}" ${e === oc.expiry ? 'selected' : ''}>${expiryLabel(e)}</option>`).join('')}
        </select>
        <div class="seg-tabs" title="Strikes around ATM">${[6, 12, 20].map((n) => `<button data-oc-range="${n}" class="${n === oc.range ? 'active' : ''}">±${n}</button>`).join('')}</div>
      </div>
    </div>
    <div class="oc-layout">
      <div class="table-wrap oc-wrap">
        <table class="oc">
          <thead>
            <tr class="oc-sides"><th colspan="3" class="calls">CALLS</th><th class="c">${d ? `Lot ${d.lot_size}` : ''}</th><th colspan="3" class="puts">PUTS</th></tr>
            <tr><th class="r">OI</th><th class="r">Chg %</th><th class="r">LTP</th><th class="c">Strike</th><th>LTP</th><th>Chg %</th><th>OI</th></tr>
          </thead>
          <tbody id="oc-body"></tbody>
        </table>
      </div>
      <aside class="card oc-side" id="oc-pos"></aside>
    </div>`;
  renderChainBody();
  renderOptPositions();
}

function chainSide(inst, side, itm, held) {
  if (!inst) return '<td></td><td></td><td></td>';
  const k = keyOf(inst);
  const h = held.get(k);
  const chip = h ? `<span class="chip ${h > 0 ? 'buy' : 'sell'} oc-held" title="Open position">${h > 0 ? '+' : ''}${h}L</span>` : '';
  const acts = `<span class="oc-acts"><button class="mini-btn b" data-oc-act="BUY" title="Buy 1 lot">B</button><button class="mini-btn s" data-oc-act="SELL" title="Sell 1 lot">S</button><button class="mini-btn" data-oc-act="chart" title="Chart">${I('chart')}</button></span>`;
  const c = itm ? ' itm' : '';
  const oi = `<td class="r oc-oi ${side.toLowerCase()}${c}" data-key="${k}" data-f="oi"><span class="num">—</span></td>`;
  const ch = `<td class="${side === 'CE' ? 'r ' : ''}oc-chg${c}" data-key="${k}" data-f="chg"><span class="num">—</span></td>`;
  const ltp = `<td class="${side === 'CE' ? 'r ' : ''}oc-ltp${c}" data-key="${k}" data-f="ltp">${side === 'CE' ? acts + chip : ''}<span class="num ltp">—</span>${side === 'PE' ? chip + acts : ''}</td>`;
  return side === 'CE' ? oi + ch + ltp : ltp + ch + oi;
}

function renderChainBody() {
  const oc = S.oc;
  const body = $('#oc-body');
  if (!body) return;
  oc.cells.clear();
  if (oc.loading && !oc.data) {
    body.innerHTML = `<tr><td colspan="7" style="padding:20px">${'<div class="skeleton" style="margin:10px 0"></div>'.repeat(6)}</td></tr>`;
    return;
  }
  if (!oc.data?.strikes?.length) {
    oc.keys = [];
    body.innerHTML = `<tr><td colspan="7">${emptyState('inbox', 'No option contracts found', `<div>${esc(oc.error || `No live ${oc.underlying} expiries in the instrument list. Make sure ${oc.data?.exchange || 'NFO / BFO'} is in KITE_EXCHANGES.`)}</div>`)}</td></tr>`;
    return;
  }
  const { spot, atmI, slot } = chainSlot();
  oc.slot = slot;
  const rows = oc.data.strikes.slice(Math.max(0, atmI - oc.range), atmI + oc.range + 1);
  oc.keys = rows.flatMap((r) => [r.CE, r.PE].filter(Boolean).map(keyOf));
  const held = new Map();
  for (const p of S.positions) if (p.quantity) held.set(keyOf(p), (held.get(keyOf(p)) || 0) + Math.round(p.quantity / lotUnit(S.instCache.get(keyOf(p)))));
  const atm = oc.data.strikes[atmI].strike;
  const spotRow = `<tr class="oc-spotrow"><td colspan="7"><span>${esc(UNDERLYING_LABELS[oc.underlying] || oc.underlying)} <b class="num" id="oc-spot-inline">${fmt(spot)}</b></span></td></tr>`;
  let html = '';
  let placed = !spot;
  for (const r of rows) {
    if (!placed && r.strike > spot) { html += spotRow; placed = true; }
    html += `<tr class="${r.strike === atm ? 'atm' : ''}">${chainSide(r.CE, 'CE', spot && r.strike < spot, held)}
      <td class="oc-strike num">${+r.strike}${r.strike === atm ? '<span class="atm-tag">ATM</span>' : ''}</td>${chainSide(r.PE, 'PE', spot && r.strike > spot, held)}</tr>`;
  }
  if (!placed) html += spotRow;
  body.innerHTML = html;
  if (oc.scrollToAtm && spot) {
    oc.scrollToAtm = false;
    const wrap = body.closest('.oc-wrap');
    const row = body.querySelector('tr.atm');
    if (wrap && row) wrap.scrollTop = row.offsetTop - wrap.clientHeight / 2 + row.offsetHeight;
  }
  $$('#oc-body td[data-key]').forEach((td) => {
    const c = oc.cells.get(td.dataset.key) || {};
    c[td.dataset.f] = td;
    oc.cells.set(td.dataset.key, c);
  });
  updateChain();
}

function updateChain() {
  const oc = S.oc;
  if (S.view !== 'options' || !oc.data?.strikes?.length || !$('#oc-body')) return;
  const sq = S.quotes[oc.data.spot];
  const { slot } = chainSlot();
  if (sq && slot !== oc.slot) { renderChainBody(); return; }
  let maxOI = 1; let ceOI = 0; let peOI = 0;
  for (const k of oc.keys) {
    const oi = S.quotes[k]?.oi || 0;
    maxOI = Math.max(maxOI, oi);
    if (k.endsWith('CE')) ceOI += oi; else peOI += oi;
  }
  for (const [k, c] of oc.cells) {
    const q = S.quotes[k];
    if (!q) continue;
    const ch = chg(q);
    const ltpEl = c.ltp.querySelector('.ltp');
    const txt = fmt(ch.ltp);
    if (ltpEl.textContent !== txt) { ltpEl.textContent = txt; flash(ltpEl, q._dir); }
    c.chg.innerHTML = `<span class="num ${cls(ch.ch)}">${pct(ch.p)}</span>`;
    if (q.oi != null) {
      c.oi.style.setProperty('--w', `${(q.oi / maxOI) * 100}%`);
      c.oi.firstElementChild.textContent = compact(q.oi);
    }
  }
  if (sq) {
    const c = chg(sq);
    const atm = oc.data.strikes[chainSlot().atmI].strike;
    const dte = daysTo(oc.expiry);
    $('#oc-spot').innerHTML = `${esc(UNDERLYING_LABELS[oc.underlying] || oc.underlying)} <b class="num ${cls(c.ch)}">${fmt(c.ltp)}</b>
      <span class="num ${cls(c.ch)}">${signed(c.ch)} (${pct(c.p)})</span> · ATM <b class="num">${+atm}</b> · Lot <b class="num">${oc.data.lot_size}</b>
      · ${dte <= 0 ? '<span class="chip warn">Expiry today</span>' : `<b class="num">${dte}</b> days to expiry`}${ceOI ? ` · PCR <b class="num">${(peOI / ceOI).toFixed(2)}</b>` : ''}`;
    const inline = $('#oc-spot-inline');
    if (inline) inline.textContent = fmt(c.ltp);
  }
  updateOptPositionsLive();
}

/* ------------------------------------------------------ F&O positions panel */
function renderOptPositions() {
  const el = $('#oc-pos');
  if (!el) return;
  const open = S.positions.filter((p) => p.quantity && DERIV_EXCH.has(p.exchange));
  const closed = S.positions.filter((p) => !p.quantity && DERIV_EXCH.has(p.exchange));
  const realised = sum(closed, (p) => p.pnl);
  S.oc.posRows = open;
  el.innerHTML = `<h3>${I('trend')} F&amp;O positions <span class="right num big-pnl" id="op-total"></span></h3>
    ${open.length ? open.map((p, i) => {
      const lots = lotsOf(p);
      const unit = lotUnit(S.instCache.get(keyOf(p)));
      return `<div class="op-row" data-op="${i}">
        <div class="op-top"><span class="sym">${esc(prettyKey(p))}</span>
          <span class="chip ${p.quantity > 0 ? 'buy' : 'sell'}">${p.quantity > 0 ? 'LONG' : 'SHORT'}</span><span class="chip">${esc(p.product)}</span>
          <span class="num op-pnl" data-op-pnl="${i}"></span></div>
        <div class="op-mid num"><b>${+lots.toFixed(2)} lot${lots === 1 ? '' : 's'}</b>${unit > 1 ? ` · ${Math.abs(p.quantity)} qty` : ''} · avg ${fmt(p.average_price)} · LTP <span data-op-ltp="${i}">${fmt(p.last_price)}</span></div>
        <div class="op-book"><span class="faint">Book</span>${bookButtons(p, 'data-op-book')}
          <button class="bk icon" data-op-chart title="Chart / TP-SL">${I('chart')}</button></div>
      </div>`;
    }).join('') : `<div class="muted" style="padding:18px 0;text-align:center;font-size:13px">No open F&amp;O positions.<br>Use <b>B</b> / <b>S</b> on the chain to trade 1 lot.</div>`}
    ${closed.length ? `<div class="kv"><span>Booked today · ${closed.length} closed</span><b class="num ${cls(realised)}">${signed(realised)}</b></div>` : ''}
    ${open.length ? `<button class="btn btn-outline btn-sm op-exit-all" data-op-exitall>${I('logout')} Exit all F&amp;O</button>` : ''}`;
  updateOptPositionsLive();
}

function updateOptPositionsLive() {
  const rows = S.oc.posRows;
  if (!rows?.length || !$('#op-total')) { const t = $('#op-total'); if (t) t.textContent = ''; return; }
  let total = 0;
  rows.forEach((p, i) => {
    const pnl = livePnl(p);
    total += pnl;
    const el = $(`[data-op-pnl="${i}"]`);
    if (el) { el.textContent = signed(pnl); el.className = `num op-pnl ${cls(pnl)}`; }
    const l = $(`[data-op-ltp="${i}"]`);
    const q = S.quotes[keyOf(p)];
    if (l && q) l.textContent = fmt(q.last_price);
  });
  const t = $('#op-total');
  t.textContent = signed(total);
  t.className = `right num big-pnl ${cls(total)}`;
}

/* ============================================================ order window */
async function openOrder(partial, side, opts = {}) {
  if (isIndex(partial)) { toast('info', 'Indices are not tradable', 'Trade index futures or options instead.'); return; }
  const inst = await resolveInst(partial);
  if (isIndex(inst)) { toast('info', 'Indices are not tradable', 'Trade index futures or options instead.'); return; }
  topModal()?._close();
  const modify = opts.mode === 'modify';
  const o = opts.order;
  const deriv = isDeriv(inst);
  const lot = inst.lot_size || 1;
  const units = modify ? o.quantity : opts.units;
  const qtyVal = units == null ? (deriv ? 1 : 1) : (deriv ? (qtyInLots(inst) ? units : Math.max(1, Math.round(units / lot))) : units);
  const products = deriv ? [['MIS', 'Intraday'], ['NRML', 'Overnight']] : [['MIS', 'Intraday'], ['CNC', 'Longterm'], ['MTF', 'MTF']];
  const product = (modify ? o.product : opts.product) || store.get(deriv ? 'lastProductDeriv' : 'lastProduct', deriv ? 'NRML' : 'CNC');
  const orderType = (modify ? o.order_type : opts.orderType) || 'MARKET';
  const ltp = S.quotes[inst.key]?.last_price;
  const tick = inst.tick_size || 0.05;
  const rawPrice = modify ? o.price : (opts.price ?? ltp);
  const price = rawPrice ? Math.round(rawPrice / tick) * tick : '';
  const n = dp(inst);
  const variety = modify ? o.variety : (opts.variety || 'regular');
  const checked = (a, b) => (a === b ? 'checked' : '');
  const dis = modify ? 'disabled' : '';

  S.order = { inst, side, mode: modify ? 'modify' : 'place', order: o, confirming: false };
  const m = openModal(`
    <form class="order ${side === 'SELL' ? 'sell' : ''}" id="o-form" novalidate autocomplete="off">
      <div class="order-head">
        <div class="t"><b>${modify ? 'Modify · ' : ''}${esc(isOptionInst(inst) ? optLabel(inst) : inst.tradingsymbol)} <span style="font-weight:500;opacity:.8;font-size:12px">${isOptionInst(inst) ? `${fmtExpiry(inst.expiry)} · ` : ''}${esc(inst.exchange)}</span></b>
          <span id="o-ltp">LTP —</span></div>
        ${modify ? '' : `<div class="side-toggle">BUY <button type="button" class="switch ${side === 'SELL' ? 'on' : ''}" id="o-side" title="Switch buy/sell"></button> SELL</div>`}
        <button type="button" class="icon-btn" data-close aria-label="Close">${I('x')}</button>
      </div>
      <div class="order-tabs">
        <label><input type="radio" name="variety" value="regular" ${checked(variety, 'regular')} ${dis}><span>Regular</span></label>
        <label><input type="radio" name="variety" value="amo" ${checked(variety, 'amo')} ${dis}><span>AMO</span></label>
      </div>
      <div class="order-body">
        <div class="order-form">
          <div><div class="row-label">Product</div><div class="seg">${products.map(([v, l]) =>
            `<label><input type="radio" name="product" value="${v}" ${checked(product, v)} ${dis}><span>${l} <em>${v}</em></span></label>`).join('')}</div></div>
          <div class="fields">
            <div class="field"><label for="o-qty">${deriv ? 'Lots' : 'Qty'} <em id="o-qty-hint">${deriv ? (qtyInLots(inst) ? `1 lot = ${lot}` : `${lot * qtyVal} qty (${qtyVal} × ${lot})`) : ''}</em></label>
              <div class="lot-input"><button type="button" class="step" data-step="-1" aria-label="Fewer">−</button>
                <input class="input" id="o-qty" name="qty" type="number" min="1" step="1" value="${qtyVal}" inputmode="numeric">
                <button type="button" class="step" data-step="1" aria-label="More">+</button></div>
              ${deriv ? `<div class="lot-chips">${[1, 2, 3, 5, 10].map((x) => `<button type="button" data-lots="${x}">${x}</button>`).join('')}</div>` : ''}</div>
            <div class="field"><label for="o-price">Price <em>tick ${inst.tick_size || 0.05}</em></label>
              <input class="input" id="o-price" name="price" type="number" min="0" step="${inst.tick_size || 0.05}" value="${price === '' ? '' : (+price).toFixed(n)}"></div>
            <div class="field"><label for="o-trigger">Trigger price</label>
              <input class="input" id="o-trigger" name="trigger" type="number" min="0" step="${inst.tick_size || 0.05}" value="${modify && o.trigger_price ? o.trigger_price : ''}"></div>
          </div>
          <div><div class="row-label">Order type</div><div class="seg">${[['MARKET', 'Market'], ['LIMIT', 'Limit'], ['SL', 'SL'], ['SL-M', 'SL-M']].map(([v, l]) =>
            `<label><input type="radio" name="order_type" value="${v}" ${checked(orderType, v)}><span>${l}</span></label>`).join('')}</div></div>
          <button type="button" class="more-toggle" id="o-more">More options ${I('chevron')}</button>
          <div class="hidden" id="o-more-box" style="display:flex;flex-direction:column;gap:14px">
            <div><div class="row-label">Validity</div><div class="seg">
              <label><input type="radio" name="validity" value="DAY" ${checked(modify ? o.validity : 'DAY', 'DAY')}><span>Day</span></label>
              <label><input type="radio" name="validity" value="IOC" ${checked(modify ? o.validity : 'DAY', 'IOC')}><span>Immediate <em>IOC</em></span></label></div></div>
            <div class="fields">
              ${deriv ? '' : `<div class="field"><label for="o-disc">Disclosed qty</label><input class="input" id="o-disc" name="disclosed" type="number" min="0" step="1" value="${modify && o.disclosed_quantity ? o.disclosed_quantity : ''}"></div>`}
              ${modify ? '' : '<div class="field"><label for="o-tag">Tag <em>optional</em></label><input class="input" id="o-tag" name="tag" maxlength="20" style="font-family:var(--font)"></div>'}
            </div>
          </div>
          <div class="form-note hidden" id="o-stop-note"></div>
          <div class="form-error hidden" id="o-err"></div>
        </div>
        <div class="order-side"><h4>Market depth</h4><div id="o-depth">${depthHTML(S.quotes[inst.key], inst, true)}</div></div>
      </div>
      <div class="order-foot">
        <div class="margin" id="o-margin">Margin required <b class="num" id="o-req">—</b><br>Available <b class="num" id="o-avail">—</b></div>
        <button type="button" class="btn btn-ghost" id="o-cancel">Cancel</button>
        <button type="submit" class="btn btn-side" id="o-submit"></button>
      </div>
    </form>`, () => { S.order = null; });

  const f = m.el.querySelector('#o-form');
  const syncFields = () => {
    const t = f.elements.order_type.value;
    const p = f.elements.price; const tr = f.elements.trigger;
    p.disabled = t === 'MARKET' || t === 'SL-M';
    tr.disabled = t === 'MARKET' || t === 'LIMIT';
    if (!p.disabled && !p.value) { const l = S.quotes[inst.key]?.last_price; const tk = inst.tick_size || 0.05; if (l) p.value = (Math.round(l / tk) * tk).toFixed(n); }
    stopNote();
    if (deriv && !qtyInLots(inst)) $('#o-qty-hint').textContent = `${lot * (+f.elements.qty.value || 0)} qty (${+f.elements.qty.value || 0} × ${lot})`;
  };
  // Mirrors the server (limit_as_stop in app.py): a limit through the market goes as a stop-limit.
  const stopNote = () => {
    const el = $('#o-stop-note');
    const l = S.quotes[inst.key]?.last_price;
    const px = parseFloat(f.elements.price.value);
    const buy = S.order?.side === 'BUY';
    const v = f.querySelector('input[name=variety]:checked')?.value;
    const val = f.querySelector('input[name=validity]:checked')?.value || 'DAY';
    const on = f.elements.order_type.value === 'LIMIT' && v === 'regular' && val === 'DAY' && l && px > l && buy;
    el.classList.toggle('hidden', !on);
    if (on) el.textContent = `Above LTP: sent as a stop-limit — buys only once the price rises to ${(+px).toFixed(n)} (trigger = limit = ${(+px).toFixed(n)}).`;
  };
  S.order.stopNote = stopNote;
  const resetConfirm = () => {
    if (!S.order?.confirming) return;
    S.order.confirming = false;
    $('#o-margin').innerHTML = 'Margin required <b class="num" id="o-req">—</b><br>Available <b class="num" id="o-avail">—</b>';
    setSubmitLabel();
    fetchMargin();
  };
  f.addEventListener('input', () => { syncFields(); resetConfirm(); $('#o-err').classList.add('hidden'); f.querySelectorAll('.invalid').forEach((x) => x.classList.remove('invalid')); fetchMargin(); });
  f.addEventListener('change', (e) => {
    if (e.target.name === 'product') store.set(deriv ? 'lastProductDeriv' : 'lastProduct', e.target.value);
  });
  for (const name of ['price', 'trigger']) {
    f.elements[name].addEventListener('blur', (e) => {
      const tick = inst.tick_size || 0.05; const v = parseFloat(e.target.value);
      if (isFinite(v) && v > 0) e.target.value = (Math.round(v / tick) * tick).toFixed(n);
    });
  }
  f.addEventListener('submit', (e) => { e.preventDefault(); submitOrder(); });
  f.addEventListener('click', (e) => {
    const b = e.target.closest('[data-step], [data-lots]');
    if (!b) return;
    const q = f.elements.qty;
    q.value = b.dataset.lots ? +b.dataset.lots : Math.max(1, (parseInt(q.value, 10) || 0) + +b.dataset.step);
    f.dispatchEvent(new Event('input'));
  });
  $('#o-cancel').onclick = () => (S.order?.confirming ? resetConfirm() : m.close());
  $('#o-more').onclick = (e) => { $('#o-more-box').classList.toggle('hidden'); e.currentTarget.classList.toggle('open'); };
  $('#o-side')?.addEventListener('click', () => {
    S.order.side = S.order.side === 'BUY' ? 'SELL' : 'BUY';
    f.classList.toggle('sell', S.order.side === 'SELL');
    $('#o-side').classList.toggle('on', S.order.side === 'SELL');
    resetConfirm(); setSubmitLabel(); fetchMargin(); syncFields();
  });
  $('#o-depth').addEventListener('click', (e) => {
    const tr = e.target.closest('tr[data-price]');
    if (!tr) return;
    if (f.elements.order_type.value === 'MARKET') f.querySelector('input[name=order_type][value=LIMIT]').checked = true;
    syncFields();
    f.elements.price.disabled = false;
    f.elements.price.value = (+tr.dataset.price).toFixed(n);
    f.dispatchEvent(new Event('input'));
  });
  setSubmitLabel();
  syncFields();
  updateOrderQuote();
  fetchMargin();
  quotesSoon();
  setTimeout(() => { f.elements.qty.focus(); f.elements.qty.select(); }, 30);
}

function setSubmitLabel() {
  const o = S.order;
  if (!o) return;
  const verb = o.mode === 'modify' ? 'Modify' : o.side === 'BUY' ? 'Buy' : 'Sell';
  $('#o-submit').textContent = o.confirming ? `Confirm ${verb.toLowerCase()}` : verb;
  $('#o-cancel').textContent = o.confirming ? 'Back' : 'Cancel';
}

function readOrderForm() {
  const o = S.order; const f = $('#o-form'); const inst = o.inst;
  const t = f.elements.order_type.value;
  const lots = Number(f.elements.qty.value);
  const quantity = isDeriv(inst) && !qtyInLots(inst) ? lots * (inst.lot_size || 1) : lots;
  const p = {
    variety: f.querySelector('input[name=variety]:checked')?.value || 'regular',
    exchange: inst.exchange, tradingsymbol: inst.tradingsymbol, transaction_type: o.side,
    order_type: t, product: f.querySelector('input[name=product]:checked')?.value, quantity,
    validity: f.querySelector('input[name=validity]:checked')?.value || 'DAY',
  };
  if (t === 'LIMIT' || t === 'SL') p.price = parseFloat(f.elements.price.value);
  if (t === 'SL' || t === 'SL-M') p.trigger_price = parseFloat(f.elements.trigger.value);
  const disc = f.elements.disclosed?.value; if (disc) p.disclosed_quantity = parseInt(disc, 10);
  const tag = f.elements.tag?.value.trim(); if (tag) p.tag = tag;
  return { p, lots };
}

function validateOrder({ p, lots }) {
  const f = $('#o-form');
  const bad = (name, msg) => { f.elements[name]?.classList.add('invalid'); f.elements[name]?.focus(); return msg; };
  if (!(lots > 0) || !Number.isInteger(lots)) return bad('qty', isDeriv(S.order.inst) ? 'Enter a whole number of lots.' : 'Quantity must be at least 1.');
  if ('price' in p && !(p.price > 0)) return bad('price', 'Enter a valid price.');
  if ('trigger_price' in p && !(p.trigger_price > 0)) return bad('trigger', 'Enter a trigger price.');
  if (p.order_type === 'SL') {
    if (p.transaction_type === 'BUY' && p.trigger_price > p.price) return bad('trigger', 'For a buy SL order, trigger price must be ≤ price.');
    if (p.transaction_type === 'SELL' && p.trigger_price < p.price) return bad('trigger', 'For a sell SL order, trigger price must be ≥ price.');
  }
  if (!p.product) return 'Choose a product.';
  return null;
}

async function submitOrder() {
  const o = S.order;
  if (!o || o.busy) return;
  const form = readOrderForm();
  const err = validateOrder(form);
  const errEl = $('#o-err');
  if (err) { errEl.textContent = err; errEl.classList.remove('hidden'); return; }
  const { p } = form;
  if (S.confirm && !o.confirming) {
    o.confirming = true;
    const px = p.order_type === 'MARKET' || p.order_type === 'SL-M' ? 'market price' : inr(p.price);
    $('#o-margin').innerHTML = `<div class="confirm-bar">${o.mode === 'modify' ? 'Modify to' : `<b>${o.side}</b>`} ${p.quantity} × <b>${esc(p.tradingsymbol)}</b> @ ${px}
      ${p.trigger_price ? ` · trigger ${inr(p.trigger_price)}` : ''}<br><span class="muted">${p.product} · ${p.order_type} · ${p.variety.toUpperCase()}</span></div>`;
    setSubmitLabel();
    $('#o-submit').focus();
    return;
  }
  o.busy = true;
  const btn = $('#o-submit');
  btn.disabled = true; btn.textContent = o.mode === 'modify' ? 'Modifying…' : 'Placing…';
  try {
    if (o.mode === 'modify') {
      const r = await api(`/orders/${o.order.variety}/${o.order.order_id}`, { method: 'PUT', body: p });
      toast('success', r?.as_stop ? 'Modified to a stop-limit' : 'Modification sent', `${p.tradingsymbol} · #${o.order.order_id}${r?.as_stop ? ` · triggers at ${fmt(p.price)} (LTP ${fmt(r.ltp)})` : ''}`);
    } else {
      const r = await api(`/orders/${p.variety}`, { method: 'POST', body: p });
      toast('success', r.as_stop ? `Stop-limit ${p.transaction_type.toLowerCase()} placed` : `${p.transaction_type} order placed`,
        `${p.tradingsymbol} · ${p.quantity} qty · #${r.order_id}${r.as_stop ? ` · triggers at ${fmt(p.price)} (LTP ${fmt(r.ltp)})` : ''}`);
    }
    topModal()?._close();
    loadOrders().catch(() => {});
  } catch (e) {
    o.busy = false; o.confirming = false;
    if (!S.order) return;
    btn.disabled = false;
    $('#o-margin').innerHTML = 'Margin required <b class="num" id="o-req">—</b><br>Available <b class="num" id="o-avail">—</b>';
    setSubmitLabel(); fetchMargin();
    errEl.textContent = e.message; errEl.classList.remove('hidden');
  }
}

const fetchMargin = debounce(async () => {
  const o = S.order;
  if (!o || o.confirming) return;
  const seg = o.inst.exchange === 'MCX' ? 'commodity' : 'equity';
  const avail = S.margins?.[seg]?.net;
  const availEl = $('#o-avail');
  if (availEl) availEl.textContent = inr(avail);
  const { p, lots } = readOrderForm();
  if (!(lots > 0) || ('price' in p && !(p.price > 0))) { $('#o-req') && ($('#o-req').textContent = '—'); return; }
  try {
    const r = await api('/margins/orders', { method: 'POST', body: [p] });
    if (S.order !== o || o.confirming) return;
    const req = r?.[0]?.total;
    const reqEl = $('#o-req');
    if (reqEl) {
      reqEl.textContent = inr(req);
      reqEl.className = `num ${avail != null && req > avail ? 'down' : ''}`;
      const charges = r?.[0]?.charges?.total;
      if (charges != null && !$('#o-charges')) reqEl.insertAdjacentHTML('afterend', ` <span class="faint" id="o-charges">+ charges ${inr(charges)}</span>`);
      else if (charges != null) $('#o-charges').textContent = `+ charges ${inr(charges)}`;
    }
  } catch { if ($('#o-req')) $('#o-req').textContent = '—'; }
}, 300);

function updateOrderQuote() {
  const o = S.order;
  const q = S.quotes[o.inst.key];
  const el = $('#o-ltp');
  if (!el || !q) return;
  const c = chg(q);
  el.innerHTML = `LTP <span class="num">${fmt(c.ltp, dp(o.inst))}</span> · <span class="num">${signed(c.ch)} (${pct(c.p)})</span>${isDeriv(o.inst) ? ` · Lot ${o.inst.lot_size}` : ''}`;
  $('#o-depth').innerHTML = depthHTML(q, o.inst, true);
  o.stopNote?.();
}

/* ============================================================= user menu */
function renderUserMenu() {
  const p = S.profile || {};
  $('#user-menu').innerHTML = `
    <div class="menu-head"><b>${esc(p.user_name || '—')}</b><span>${esc(p.user_id || '')}${p.email ? ' · ' + esc(p.email) : ''}</span></div>
    <button class="menu-item" data-menu="confirm">${I('shield')} Confirm before placing orders <span class="right switch ${S.confirm ? 'on' : ''}"></span></button>
    <button class="menu-item" data-menu="confirmBook">${I('shield')} Confirm quick profit booking <span class="right switch ${S.confirmBook ? 'on' : ''}"></span></button>
    <button class="menu-item" data-menu="theme">${I(currentTheme() === 'dark' ? 'sun' : 'moon')} ${currentTheme() === 'dark' ? 'Light' : 'Dark'} theme <span class="right"><kbd>T</kbd></span></button>
    <button class="menu-item" data-menu="shortcuts">${I('keyboard')} Keyboard shortcuts <span class="right"><kbd>?</kbd></span></button>
    <button class="menu-item danger" data-menu="logout">${I('logout')} Log out</button>`;
}

/* ================================================================ events */
function bindEvents() {
  $('#theme-toggle').onclick = () => applyTheme(currentTheme() === 'dark' ? 'light' : 'dark');
  $('#login-form').onsubmit = submitLogin;
  $('#shortcuts-btn').onclick = showShortcuts;
  $('#avatar').onclick = (e) => { e.stopPropagation(); renderUserMenu(); $('#user-menu').classList.toggle('hidden'); };
  $('#user-menu').addEventListener('click', (e) => {
    const a = e.target.closest('[data-menu]')?.dataset.menu;
    if (a === 'confirm') { S.confirm = !S.confirm; store.set('confirmOrders', S.confirm); renderUserMenu(); return; }
    if (a === 'confirmBook') { S.confirmBook = !S.confirmBook; store.set('confirmBook', S.confirmBook); renderUserMenu(); return; }
    $('#user-menu').classList.add('hidden');
    if (a === 'theme') applyTheme(currentTheme() === 'dark' ? 'light' : 'dark');
    else if (a === 'shortcuts') showShortcuts();
    else if (a === 'logout') logout();
  });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('#user-menu')) $('#user-menu').classList.add('hidden');
    if (!e.target.closest('.search')) hideSearch();
  });

  $('#nav').addEventListener('click', (e) => { const b = e.target.closest('[data-view]'); if (b) switchView(b.dataset.view); });
  $('#wl-tabs').addEventListener('click', (e) => { const b = e.target.closest('[data-list]'); if (b) switchList(+b.dataset.list); });

  $('#watchlist').addEventListener('click', (e) => {
    const row = e.target.closest('.wl-row');
    if (!row || e.target.closest('.wl-depth')) return;
    const idx = +row.dataset.idx;
    const it = currentList()[idx];
    const act = e.target.closest('[data-act]')?.dataset.act;
    selectRow(idx);
    if (act === 'buy' || act === 'sell') openOrder(it, act.toUpperCase());
    else if (act === 'chart') openChart(it);
    else if (act === 'remove') removeFromList(idx);
    else toggleDepth(it);
  });
  $('#watchlist').addEventListener('dblclick', (e) => {
    const row = e.target.closest('.wl-row');
    if (row && !e.target.closest('[data-act], .wl-depth')) openChart(currentList()[+row.dataset.idx]);
  });

  const search = $('#search');
  search.addEventListener('input', () => runSearch(search.value));
  search.addEventListener('focus', () => { if (search.value.trim()) runSearch(search.value); });
  search.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); moveSearch(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); moveSearch(-1); }
    else if (e.key === 'Enter' && searchItems[searchIdx]) { e.preventDefault(); searchAction(searchItems[searchIdx], 'add'); }
    else if (e.key === 'Escape') { search.value = ''; hideSearch(); search.blur(); }
  });
  $('#search-results').addEventListener('mousedown', (e) => e.preventDefault());
  $('#search-results').addEventListener('click', (e) => {
    const item = e.target.closest('.sr-item');
    if (item) searchAction(searchItems[+item.dataset.i], e.target.closest('[data-act]')?.dataset.act || 'add');
  });

  $('#main').addEventListener('change', (e) => {
    if (e.target.id === 'oc-expiry') { S.oc.expiry = e.target.value; loadChain(); }
  });
  $('#main').addEventListener('click', (e) => {
    const go = e.target.closest('[data-goto]');
    if (go) { e.preventDefault(); switchView(go.dataset.goto); return; }
    if (e.target.closest('[data-global="refresh"]')) {
      Promise.allSettled([loadMargins(), loadPortfolio(), loadOrders()]).then(() => toast('success', 'Refreshed', '', 1500));
      return;
    }
    const ocu = e.target.closest('[data-oc-u]');
    if (ocu) { S.oc.underlying = ocu.dataset.ocU; S.oc.expiry = null; S.oc.data = null; store.set('ocUnderlying', S.oc.underlying); loadChain(); return; }
    const ocr = e.target.closest('[data-oc-range]');
    if (ocr) { S.oc.scrollToAtm = true; S.oc.range = +ocr.dataset.ocRange; store.set('ocRange', S.oc.range); S.sigs.options = null; renderCurrent(); quotesSoon(); return; }
    const oca = e.target.closest('[data-oc-act]');
    if (oca) {
      const inst = S.instCache.get(oca.closest('td').dataset.key);
      if (inst) (oca.dataset.ocAct === 'chart' ? openChart(inst) : openOrder(inst, oca.dataset.ocAct));
      return;
    }
    const opRow = e.target.closest('[data-op]');
    if (opRow) {
      const pos = S.oc.posRows[+opRow.dataset.op];
      const bk = e.target.closest('[data-op-book]');
      if (pos && bk) bookLots(pos, +bk.dataset.opBook);
      else if (pos && e.target.closest('[data-op-chart]')) openChart(pos, { protect: pos.product });
      return;
    }
    if (e.target.closest('[data-op-exitall]')) { exitAllDerivs(); return; }
    const otab = e.target.closest('[data-otab]');
    if (otab) { S.ordersTab = otab.dataset.otab; renderCurrent(); return; }
    const paneOf = (n) => PANES[+(n.closest('.chart-pane')?.dataset.pane || 0)];
    const iv = e.target.closest('[data-interval]');
    if (iv) {
      const p = paneOf(iv);
      p.interval = iv.dataset.interval;
      store.set(p.idx ? 'chart2Interval' : 'chartInterval', p.interval);
      DRAW.pending = null;
      loadChart(p);
      return;
    }
    const ca = e.target.closest('[data-chart-act]');
    if (ca) { openOrder(paneOf(ca).inst, ca.dataset.chartAct); return; }
    const lay = e.target.closest('[data-layout]');
    if (lay) {
      S.chartLayout = +lay.dataset.layout;
      store.set('chartLayout', S.chartLayout);
      if (S.chartLayout === 1) S.chartFocus = 0;
      DRAW.selected = null;
      loadCharts();
      quotesSoon();
      return;
    }
    if (e.target.closest('[data-chart-swap]')) { swapCharts(); return; }
    const tool = e.target.closest('[data-tool]');
    if (tool) { setTool(tool.dataset.tool); return; }
    if (e.target.closest('[data-draw-clear]')) { clearDrawings(); return; }
    const th = e.target.closest('th.sortable');
    if (th) {
      const id = th.closest('table').dataset.table; const key = th.dataset.key; const st = S.sort[id];
      S.sort[id] = st?.key === key ? (st.dir === 1 ? { key, dir: -1 } : undefined) : { key, dir: 1 };
      if (!S.sort[id]) delete S.sort[id];
      renderCurrent(); return;
    }
    const btn = e.target.closest('[data-act]');
    const tr = e.target.closest('tr[data-row]');
    if (!btn || !tr) return;
    const id = tr.closest('table').dataset.table;
    const r = S.tableRows[id][+tr.dataset.row];
    const act = btn.dataset.act;
    if (act === 'modify') openOrder(r, r.transaction_type, { mode: 'modify', order: r });
    else if (act === 'cancel') cancelOrder(r);
    else if (act === 'repeat') openOrder(r, r.transaction_type, { units: r.quantity, product: r.product, orderType: r.order_type, price: r.price || undefined, variety: r.variety === 'amo' ? 'amo' : 'regular' });
    else if (act === 'exit') exitPosition(r);
    else if (act === 'add') openOrder(r, r.quantity > 0 ? 'BUY' : 'SELL', { product: r.product });
    else if (act === 'buy') openOrder(r, 'BUY', { product: 'CNC' });
    else if (act === 'sell') openOrder(r, 'SELL', { product: 'CNC', units: r.quantity + (r.t1_quantity || 0) });
    else if (act === 'chart') openChart(r);
    else if (act === 'protect') openChart(r, { protect: r.product || 'CNC' });
    else if (act === 'book') bookLots(r, +btn.dataset.n);
  });

  // Pills re-render with live P&L, so act on pointerdown rather than click.
  $('#chart-lines').addEventListener('pointerdown', (e) => {
    const el = e.target.closest('.cl');
    const lv = el && LV.get(el.dataset.id);
    if (!lv) return;
    e.preventDefault();
    const btn = e.target.closest('[data-lv]');
    if (btn) levelAction(lv, btn.dataset.lv);
    else if (lv.kind === 'order') startOrderDrag(lv, e);
    else if (lv.kind !== 'entry') startLevelDrag(lv, e);
  });

  let gAt = 0;
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const m = topModal();
      if (m) { e.preventDefault(); if (S.order?.confirming) $('#o-cancel').click(); else m._close(); return; }
      $('#user-menu').classList.add('hidden');
      if (S.view === 'chart' && (DRAW.tool !== 'cursor' || DRAW.selected)) { DRAW.selected = null; setTool('cursor'); }
      return;
    }
    const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName) || e.target.isContentEditable;
    if (S.loggedIn && S.view === 'chart' && !typing && !topModal()) {
      const k2 = e.key.toLowerCase();
      if (e.altKey && k2 === 't') { e.preventDefault(); setTool('trend'); return; }
      if (e.altKey && k2 === 'h') { e.preventDefault(); setTool('hline'); return; }
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedDrawing()) {
        e.preventDefault();
        const s2 = selectedDrawing();
        deleteDrawing(s2.p, s2.d);
        return;
      }
    }
    if (!S.loggedIn || e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target;
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName) || t.isContentEditable || topModal()) return;
    const k = e.key.toLowerCase();
    if (Date.now() - gAt < 1200) {
      const v = { d: 'dashboard', o: 'orders', p: 'positions', h: 'holdings', c: 'chart', x: 'options' }[k];
      gAt = 0;
      if (v) { switchView(v); return; }
    }
    const list = currentList();
    const it = list[S.selected];
    if (k === 'g') gAt = Date.now();
    else if (e.key === '/') { e.preventDefault(); $('#search').focus(); }
    else if (e.key === '?') showShortcuts();
    else if (k === 't') applyTheme(currentTheme() === 'dark' ? 'light' : 'dark');
    else if (e.key === 'ArrowDown') { e.preventDefault(); selectRow(S.selected + 1, true); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); selectRow(S.selected - 1, true); }
    else if (/^[1-5]$/.test(e.key)) switchList(+e.key - 1);
    else if (!it) return;
    else if (k === 'b') openOrder(it, 'BUY');
    else if (k === 's') openOrder(it, 'SELL');
    else if (k === 'd') toggleDepth(it);
    else if (k === 'c') openChart(it);
    else if (e.key === 'Delete' || e.key === 'Backspace') removeFromList(S.selected);
  });

  document.addEventListener('visibilitychange', () => { if (!document.hidden && S.loggedIn) quotesSoon(); });
}

bindEvents();
loadOrders = singleFlight(loadOrders);
loadPortfolio = singleFlight(loadPortfolio);
loadProtections = singleFlight(loadProtections);
loadMargins = singleFlight(loadMargins);
boot();
