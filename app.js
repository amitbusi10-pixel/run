'use strict';
/* על הדרך — GPS, צעדים, מפה, מסלולים, תוכנית אימונים. כל הנתונים נשמרים בטלפון. */

const $ = (s) => document.querySelector(s);
const ROSH_HAAYIN = [32.0956, 34.9566];
const dark = () => window.matchMedia('(prefers-color-scheme: dark)').matches;
const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

/* ---------------- עזרי תצוגה ---------------- */
const pad = (n) => String(n).padStart(2, '0');
function fmtClock(sec) { // 00:00 או 1:02:03
  sec = Math.max(0, Math.floor(sec));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}
function fmtDur(sec) { // 28:41 או 1:05:20
  sec = Math.max(0, Math.round(sec));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}
function fmtPace(spk) {
  if (!isFinite(spk) || spk <= 0 || spk > 30 * 60) return '--:--';
  spk = Math.round(spk);
  return `${Math.floor(spk / 60)}:${pad(spk % 60)}`;
}
const fmtKm = (m, d = 2) => (m / 1000).toFixed(d);
const kmh = (spk) => (isFinite(spk) && spk >= 60 && spk < 30 * 60 ? (3600 / spk).toFixed(1) : '');
const kmhTxt = (spk) => { const k = kmh(spk); return k ? ` · ${k} קמ״ש` : ''; };
const kmhLine = (spk) => { const k = kmh(spk); return k ? `${k} קמ״ש` : ''; };
const fmtGoal = (km) => String(Math.round(km * 10) / 10);
const fmtInt = (n) => Math.round(n).toLocaleString('he-IL');
function parseTime(str) { // "28:00", "1:05:00", "6" → שניות
  if (str == null) return NaN;
  const parts = String(str).trim().replace(/[.,]/g, ':').split(':').filter((x) => x !== '');
  if (!parts.length || parts.some((p) => !/^\d+$/.test(p))) return NaN;
  const n = parts.map(Number);
  if (n.length === 1) return n[0] * 60;
  if (n.length === 2) return n[1] < 60 ? n[0] * 60 + n[1] : NaN;
  if (n.length === 3) return n[1] < 60 && n[2] < 60 ? n[0] * 3600 + n[1] * 60 + n[2] : NaN;
  return NaN;
}
function fmtGap(sec) { // הפרש זמן לקריאה
  sec = Math.round(Math.abs(sec));
  return sec < 60 ? `${sec} שנ׳` : `${fmtDur(sec)} דק׳`;
}
function minutesText(sec) {
  const m = Math.round(sec / 60);
  if (m === 1) return 'דקה';
  if (m === 2) return '2 דקות';
  return `${m} דקות`;
}
const heDay = new Intl.DateTimeFormat('he-IL', { weekday: 'long', day: 'numeric', month: 'numeric' });
const heShort = new Intl.DateTimeFormat('he-IL', { day: 'numeric', month: 'numeric', year: '2-digit' });
const heTime = new Intl.DateTimeFormat('he-IL', { hour: '2-digit', minute: '2-digit' });
function runTitle(ts) {
  const h = new Date(ts).getHours();
  if (h >= 5 && h < 11) return 'ריצת בוקר';
  if (h >= 11 && h < 16) return 'ריצת צהריים';
  if (h >= 16 && h < 19) return 'ריצת אחר הצהריים';
  if (h >= 19 && h < 23) return 'ריצת ערב';
  return 'ריצת לילה';
}
function esc(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

let toastTimer;
function toast(msg, ms = 3200) {
  const t = $('#toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, ms);
}
const vibrate = (p) => { try { navigator.vibrate && navigator.vibrate(p); } catch (e) { /* לא נתמך */ } };

/* ---------------- גאוגרפיה ---------------- */
function hav(a, b) {
  const R = 6371000, toR = Math.PI / 180;
  const dLat = (b[0] - a[0]) * toR, dLon = (b[1] - a[1]) * toR;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * toR) * Math.cos(b[0] * toR) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}
function bearing(a, b) {
  const toR = Math.PI / 180;
  const y = Math.sin((b[1] - a[1]) * toR) * Math.cos(b[0] * toR);
  const x = Math.cos(a[0] * toR) * Math.sin(b[0] * toR) - Math.sin(a[0] * toR) * Math.cos(b[0] * toR) * Math.cos((b[1] - a[1]) * toR);
  return (Math.atan2(y, x) / toR + 360) % 360;
}
// זמן (שניות) שבו ריצה שמורה הגיעה למרחק d, לפי הנקודות [lat,lon,t,d]
function timeAtDist(points, d) {
  if (!points || !points.length || d > points[points.length - 1][3]) return null;
  let lo = 0, hi = points.length - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (points[mid][3] < d) lo = mid; else hi = mid; }
  const a = points[lo], b = points[hi];
  if (b[3] === a[3]) return a[2];
  return a[2] + (b[2] - a[2]) * ((d - a[3]) / (b[3] - a[3]));
}
function posAtTime(points, t) {
  if (!points || !points.length) return null;
  if (t >= points[points.length - 1][2]) return points[points.length - 1];
  let lo = 0, hi = points.length - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (points[mid][2] < t) lo = mid; else hi = mid; }
  const a = points[lo], b = points[hi], f = b[2] === a[2] ? 0 : (t - a[2]) / (b[2] - a[2]);
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
}
// הזמן הטוב ביותר למקטע של len מטרים בתוך ריצה
function bestEffort(points, len) {
  if (!points || points.length < 2 || points[points.length - 1][3] < len) return null;
  let best = Infinity, j = 0;
  for (let i = 0; i < points.length; i++) {
    while (j < points.length && points[j][3] - points[i][3] < len) j++;
    if (j >= points.length) break;
    const tEnd = timeAtDist(points, points[i][3] + len);
    if (tEnd != null) best = Math.min(best, tEnd - points[i][2]);
  }
  return isFinite(best) ? best : null;
}

/* ---------------- אחסון ---------------- */
const LS = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
  set(k, v) {
    try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { return false; }
    if ((k === 'settings' || k === 'plan' || k === 'goalKm') && window.__cloudMeta) window.__cloudMeta(); // גם לענן, אם נכנסו לחשבון
    return true;
  },
  del(k) { try { localStorage.removeItem(k); } catch (e) { /* */ } },
};
const DB = (() => {
  let dbp = null;
  function open() {
    if (!dbp) {
      dbp = new Promise((res, rej) => {
        const r = indexedDB.open('rosh-haayin-runner', 1);
        r.onupgradeneeded = () => {
          r.result.createObjectStore('runs', { keyPath: 'id' });
          r.result.createObjectStore('routes', { keyPath: 'id' });
        };
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      });
    }
    return dbp;
  }
  async function tx(store, mode, fn) {
    const db = await open();
    return new Promise((res, rej) => {
      const t = db.transaction(store, mode);
      const req = fn(t.objectStore(store));
      t.oncomplete = () => res(req ? req.result : undefined);
      t.onerror = () => rej(t.error);
      t.onabort = () => rej(t.error);
    });
  }
  return {
    all: (s) => tx(s, 'readonly', (st) => st.getAll()),
    put: (s, v) => tx(s, 'readwrite', (st) => st.put(v)),
    del: (s, id) => tx(s, 'readwrite', (st) => st.delete(id)),
  };
})();

const DEFAULTS = { pace: 360, tol: 15, week: 15, weight: 75, height: 175, vibeKm: true, vibeSeg: true, auto: true, map: 'auto' };
let S = Object.assign({}, DEFAULTS, LS.get('settings', {}));
let runs = [];    // ממוינות מהחדשה לישנה
let routes = [];
let plan = LS.get('plan', null);

async function loadData() {
  try {
    runs = await DB.all('runs');
    routes = await DB.all('routes');
  } catch (e) {
    runs = LS.get('runs-fallback', []);
    routes = LS.get('routes-fallback', []);
  }
  // עותק נוסף של המסלולים השמורים: אם הדפדפן מחק את מסד הנתונים, הם חוזרים מכאן
  const gone = LS.get('routes-gone', []);
  for (const rt of LS.get('routes-copy', [])) if (!routes.some((x) => x.id === rt.id) && !gone.includes(rt.id)) { routes.push(rt); DB.put('routes', rt).catch(() => {}); }
  copyRoutes();
  runs.sort((a, b) => b.start - a.start);
  try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) { /* */ } // מבקש מהדפדפן לא למחוק את הנתונים
}
function copyRoutes() { LS.set('routes-copy', routes); }
// fromCloud: השינוי הגיע מהענן, אז לא שולחים אותו בחזרה
async function saveRun(r, fromCloud) {
  const i = runs.findIndex((x) => x.id === r.id);
  if (i >= 0) runs[i] = r; else { runs.push(r); runs.sort((a, b) => b.start - a.start); }
  try { await DB.put('runs', r); } catch (e) { LS.set('runs-fallback', runs); }
  if (!fromCloud) cloudPut('runs', r);
}
async function deleteRun(id, fromCloud) {
  runs = runs.filter((r) => r.id !== id);
  try { await DB.del('runs', id); } catch (e) { LS.set('runs-fallback', runs); }
  if (!fromCloud) cloudDel('runs', id);
}
async function saveRoute(rt, fromCloud) {
  const i = routes.findIndex((x) => x.id === rt.id);
  if (i >= 0) routes[i] = rt; else routes.push(rt);
  try { await DB.put('routes', rt); } catch (e) { LS.set('routes-fallback', routes); }
  if (!fromCloud) cloudPut('routes', rt);
  copyRoutes();
}
async function deleteRoute(id, fromCloud) {
  routes = routes.filter((r) => r.id !== id);
  try { await DB.del('routes', id); } catch (e) { LS.set('routes-fallback', routes); }
  if (!fromCloud) cloudDel('routes', id);
  copyRoutes(); LS.set('routes-gone', LS.get('routes-gone', []).concat(id).slice(-200));
  for (const r of runs.filter((x) => x.routeId === id)) { r.routeId = null; await saveRun(r); }
}
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

/* ---------------- מפה ---------------- */
const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services/';
const LAYERS = { // כל מפה: שכבת בסיס ושכבת שמות אופציונלית
  voyager: [['https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 20, maxNativeZoom: 19, attribution: '© OpenStreetMap' }]],
  dark: [['https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 20, maxNativeZoom: 19, attribution: '© OpenStreetMap', className: 'tiles-dark' }]],
  sat: [[ESRI + 'World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 20, maxNativeZoom: 19, attribution: '© Esri' }],
    [ESRI + 'Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}', { maxZoom: 20, maxNativeZoom: 19, opacity: 0.8 }]],
};
const LAYER_NAMES = { voyager: 'מפת רחובות בהירה', dark: 'מפת רחובות כהה', sat: 'מפת לוויין' };
if (!LAYERS[S.map] && S.map !== 'auto') S.map = 'auto';
const mapKey = () => (S.map === 'auto' ? (dark() ? 'dark' : 'voyager') : S.map);
function tileLayer(key) {
  return L.layerGroup(LAYERS[key].map(([u, o]) => L.tileLayer(u, Object.assign({ keepBuffer: 4, crossOrigin: true }, o))));
}

let map, baseLayer, currentLayerKey;
let meMarker, accCircle, casing, routeLayer, ghostLine, ghostMarker;
let follow = true;

function meIcon() {
  return L.divIcon({
    className: '',
    iconSize: [44, 44], iconAnchor: [22, 22],
    html: '<div class="me"><div class="me-halo"></div><svg class="me-arrow" viewBox="0 0 24 24"><path d="M12 2.5 19.5 21 12 16.8 4.5 21z"/></svg></div>',
  });
}
function initMap() {
  map = L.map('map', { zoomControl: false, attributionControl: true, zoomSnap: 0.25, inertia: true }).setView(ROSH_HAAYIN, 15);
  currentLayerKey = mapKey();
  baseLayer = tileLayer(currentLayerKey).addTo(map);
  casing = L.polyline([], { color: '#ffffff', weight: 10, opacity: 0.9, lineCap: 'round', lineJoin: 'round' }).addTo(map);
  routeLayer = L.layerGroup().addTo(map);
  map.on('dragstart', () => setFollow(false));
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (S.map === 'auto') switchLayer(mapKey()); });
}
function switchLayer(key) {
  if (key === currentLayerKey) return;
  map.removeLayer(baseLayer);
  baseLayer = tileLayer(key).addTo(map);
  currentLayerKey = key;
}
function setFollow(on) {
  follow = on;
  $('#btnFollow').classList.toggle('on', on);
  if (on && lastPos) map.flyTo(lastPos, Math.max(map.getZoom(), 16.5), { duration: 0.8 });
}

// תזוזה חלקה של הסמן בין קריאות GPS
let animFrom = null, animTo = null, animStart = 0, animDur = 900, animRaf = 0, lastPos = null, heading = null;
function moveMe(latlng, acc) {
  if (!meMarker) {
    meMarker = L.marker(latlng, { icon: meIcon(), interactive: false, zIndexOffset: 1000 }).addTo(map);
    accCircle = L.circle(latlng, { radius: acc, color: '#2f8cff', weight: 1, opacity: 0.4, fillColor: '#2f8cff', fillOpacity: 0.1, interactive: false }).addTo(map);
    lastPos = latlng;
    map.setView(latlng, 16.5);
    return;
  }
  animFrom = meMarker.getLatLng(); animTo = L.latLng(latlng); animStart = performance.now();
  cancelAnimationFrame(animRaf);
  const step = (now) => {
    const f = Math.min(1, (now - animStart) / animDur);
    const e = f < 0.5 ? 2 * f * f : 1 - Math.pow(-2 * f + 2, 2) / 2;
    const p = L.latLng(animFrom.lat + (animTo.lat - animFrom.lat) * e, animFrom.lng + (animTo.lng - animFrom.lng) * e);
    meMarker.setLatLng(p); accCircle.setLatLng(p);
    if (f < 1) animRaf = requestAnimationFrame(step);
  };
  animRaf = requestAnimationFrame(step);
  accCircle.setRadius(acc);
  if (follow && !$('#view-run').hidden) {
    const now = performance.now();
    if (now - (moveMe.lastPan || 0) > 700) map.panTo(latlng, { animate: true, duration: 0.6, easeLinearity: 0.5, noMoveStart: true });
    else { map.stop(); map.setView(latlng, map.getZoom(), { animate: false }); }
    moveMe.lastPan = now;
  }
  lastPos = latlng;
}
function setHeading(deg) {
  if (deg == null || isNaN(deg)) return;
  heading = deg;
  const el = meMarker && meMarker.getElement() && meMarker.getElement().querySelector('.me-arrow');
  if (el) el.style.transform = `rotate(${deg}deg)`;
}

// צבע מקטע במסלול לפי הקצב ביחס ליעד
function paceColor(spk, target) {
  if (!isFinite(spk)) return css('--good');
  const d = spk - target, tol = S.tol;
  if (d <= tol) return css('--good');
  if (d <= tol * 3) return css('--warn');
  return css('--bad');
}
let curSeg = null, curSegColor = null;
function drawPoint(latlng, color) {
  casing.addLatLng(latlng);
  if (!curSeg || color !== curSegColor) {
    const start = curSeg ? [curSeg.getLatLngs().slice(-1)[0], latlng] : [latlng];
    curSeg = L.polyline(start, { color, weight: 6, opacity: 1, lineCap: 'round', lineJoin: 'round' }).addTo(routeLayer);
    curSegColor = color;
  } else curSeg.addLatLng(latlng);
}
function clearTrack() {
  casing.setLatLngs([]); routeLayer.clearLayers(); curSeg = null; curSegColor = null;
}
function showGhostRoute(rt) {
  if (ghostLine) { map.removeLayer(ghostLine); ghostLine = null; }
  if (ghostMarker) { map.removeLayer(ghostMarker); ghostMarker = null; }
  if (!rt) return;
  ghostLine = L.polyline(rt.points, { color: css('--plum'), weight: 5, opacity: 0.55, dashArray: '2 10', lineCap: 'round' }).addTo(map);
  ghostLine.bringToBack();
  map.fitBounds(ghostLine.getBounds(), { padding: [30, 30] });
  setFollow(false);
}
function moveGhost(latlng) {
  if (!latlng) return;
  if (!ghostMarker) {
    ghostMarker = L.marker(latlng, { interactive: false, icon: L.divIcon({ className: '', iconSize: [20, 20], iconAnchor: [10, 10], html: '<div class="ghost-dot">שיא</div>' }) }).addTo(map);
  } else ghostMarker.setLatLng(latlng);
}

/* ---------------- מסנן קלמן פשוט ל־GPS ---------------- */
class GpsFilter {
  constructor() { this.v = -1; }
  reset() { this.v = -1; }
  process(lat, lon, acc, ts) {
    acc = Math.max(acc, 2);
    if (this.v < 0) { this.lat = lat; this.lon = lon; this.v = acc * acc; this.ts = ts; return [lat, lon]; }
    const dt = (ts - this.ts) / 1000;
    if (dt > 0) { this.v += dt * 3 * 3; this.ts = ts; } // 3 מ׳/שנ׳ — רעש תנועה של רץ
    const k = this.v / (this.v + acc * acc);
    this.lat += k * (lat - this.lat); this.lon += k * (lon - this.lon);
    this.v = (1 - k) * this.v;
    return [this.lat, this.lon];
  }
}

/* ---------------- מצב ריצה ---------------- */
const R = {
  status: 'idle', // idle | running | paused
  autoPaused: false,
  start: 0, elapsed: 0, lastTick: 0, elapsedAtMove: 0, lastMove: 0,
  dist: 0, points: [], last: null, jumps: 0,
  steps: 0, stepTimes: [], splits: [], kmNext: 1000, lastSplitT: 0,
  curPace: NaN, context: null, segIdx: -1, done: false,
};
const filter = new GpsFilter();
let watchId = null, tickTimer = null, wakeLock = null;

function targetPace() {
  const c = R.context;
  if (c && c.type === 'plan') {
    const w = c.workout;
    if (w.kind === 'intervals') { const seg = w.segments[R.segIdx]; return seg ? seg.pace : null; }
    return w.pace;
  }
  return S.pace;
}

/* ---------------- אפליקציית אנדרואיד ---------------- */
// כשהאתר נפתח בתוך אפליקציית האנדרואיד, ה־GPS עובר לשירות רקע של הטלפון: הוא ממשיך כשהמסך כבוי,
// ובמסך הנעילה יש התראה אחת קבועה עם שעון שרץ, מרחק, קצב והתקדמות ליעד. בדפדפן רגיל כל זה לא פעיל.
const CAP = window.Capacitor;
const NATIVE = !!(CAP && typeof CAP.isNativePlatform === 'function' && CAP.isNativePlatform());
const hasPlugin = (name) => NATIVE && (typeof CAP.isPluginAvailable === 'function' ? CAP.isPluginAvailable(name) : !!(CAP.Plugins || {})[name]);
function plug(name) {
  if (!hasPlugin(name)) return null;
  try { return CAP.registerPlugin ? CAP.registerPlugin(name) : CAP.Plugins[name]; } catch (e) { return (CAP.Plugins || {})[name] || null; }
}
const RT = plug('RunTracker');               // השירות החדש (מגרסה 1.7 של האפליקציה)
const BG = RT ? null : plug('BackgroundGeolocation'); // גרסאות ישנות של האפליקציה
const LN = RT ? null : plug('LocalNotifications');
const SH = plug('Share'), FSYS = plug('Filesystem');
if (NATIVE) console.info(`AL-HADERECH native ok: RT=${!!RT} BG=${!!BG} SH=${!!SH} FS=${!!FSYS}`);
const LIVE_ID = 4242;
let trackOn = false, trackStarting = false, bgWatch = null, liveLast = 0, lastFixTs = 0, rtListeners = false;

// לכל נקודה שהשירות קולט יש מספר רץ (seq). האפליקציה סופרת אותן: אם נקודה אחת התפספה (האפליקציה הייתה ברקע),
// היא מבקשת מהשירות את כל מה שחסר, לפי הסדר, ורק אז ממשיכה. כך אף קטע לא נדלג.
let syncTimer = null;
let nextSeq = 0, syncing = false, syncAgain = false, catchingUp = false;
function feedNative(loc) {
  if (!loc || !loc.time) return;
  if (loc.seq != null && loc.seq >= 0) {
    if (loc.seq < nextSeq) return;                       // כבר טופלה
    if (loc.seq > nextSeq && !catchingUp) { syncMissed(); return; } // התפספו נקודות: משלימים לפי הסדר
    nextSeq = loc.seq + 1;
  } else if (loc.time <= lastFixTs) return;              // בלי מספר (אפליקציה ישנה, או נקודה בזמן השהיה): לפי זמן
  lastFixTs = Math.max(lastFixTs, loc.time);
  onPosition({ coords: { latitude: loc.latitude, longitude: loc.longitude, accuracy: loc.accuracy, heading: loc.bearing, speed: loc.speed }, timestamp: loc.time });
  updateLive();
}
// נקודות שהשירות קלט כשהאפליקציה לא הספיקה לקבל אותן (למשל כשאנדרואיד השהה אותה)
async function syncMissed() {
  if (!RT || !trackOn) return;
  if (syncing) { syncAgain = true; return; }
  syncing = true;
  try {
    do {
      syncAgain = false;
      const r = await RT.getSince({ seq: nextSeq, time: lastFixTs });
      catchingUp = true;
      (r.points || []).forEach(feedNative);
      catchingUp = false;
    } while (syncAgain);
  } catch (e) { catchingUp = false; }
  syncing = false;
}
async function nativeTrackStart() {
  if (trackOn || trackStarting) return;
  trackStarting = true;
  if (watchId != null) { navigator.geolocation.clearWatch(watchId); watchId = null; }
  try {
    if (RT) {
      if (!rtListeners) {
        rtListeners = true;
        RT.addListener('location', feedNative);
        RT.addListener('action', (a) => { if (a.action === 'pause' && R.status === 'running') pauseRun(); else if (a.action === 'resume' && R.status === 'paused') resumeRun(); });
      }
      await RT.start({ goal: (R.goal || LS.get('goalKm', 5)) * 1000, title: '0.00 ק״מ', text: 'הריצה התחילה' });
      trackOn = true;
      if (!syncTimer) syncTimer = setInterval(() => { if (R.status === 'running') syncMissed(); }, 8000); // רשת ביטחון: אם הנקודה האחרונה התפספה
      askBatteryOnce();
    } else if (BG) {
      // גרסה ישנה של האפליקציה: התראה אחת קבועה בלבד. עדכון חי בה הקפיץ אותה מחדש כל פעם
      if (LN) LN.cancel({ notifications: [{ id: LIVE_ID }] }).catch(() => {});
      bgWatch = await BG.addWatcher({ backgroundTitle: 'הריצה התחילה', backgroundMessage: 'הזמן והמרחק נמדדים גם כשהמסך כבוי', requestPermissions: true, stale: false, distanceFilter: 0 },
        (loc, err) => { if (!err && loc) feedNative(loc); });
      trackOn = true;
    }
  } catch (e) {
    trackOn = false;
    setGps('bad', 'אין הרשאת מיקום. יש לאשר מיקום בהגדרות האפליקציה');
    startWebGps();
  }
  trackStarting = false;
}
async function nativeTrackStop() {
  try {
    if (RT) await RT.stop();
    else if (BG && bgWatch != null) { await BG.removeWatcher({ id: bgWatch }); if (LN) await LN.cancel({ notifications: [{ id: LIVE_ID }] }); }
  } catch (e) { /* */ }
  trackOn = false; bgWatch = null;
  startWebGps();
}
// סמסונג עוצרת אפליקציות ברקע כדי לחסוך סוללה. אפליקציות ריצה מבקשות פטור פעם אחת.
async function askBatteryOnce() {
  if (!RT || LS.get('batteryAsked', false)) return;
  try {
    const r = await RT.isBatteryExempt();
    if (r.granted) return;
    LS.set('batteryAsked', true);
    if (window.confirm('כדי שהמדידה לא תיעצר כשהמסך כבוי, כדאי לאשר לאפליקציה לפעול ברקע בלי הגבלת סוללה. לפתוח את האישור?')) await RT.requestBatteryExemption();
  } catch (e) { /* */ }
}
// ההתראה במסך הנעילה: מרחק, ושעון שהטלפון מריץ לבד. היא משתנה רק כשהמרחק משתנה, באותה התראה, בלי לקפוץ.
function updateLive(force) {
  if (!trackOn || R.status === 'idle' || !RT) return; // בגרסה הישנה של האפליקציה אין עדכונים חיים
  const now = Date.now();
  if (!force && now - liveLast < 2000) return;
  liveLast = now;
  const title = `${fmtKm(R.dist)} ק״מ`;
  let text = R.status === 'paused' ? `הריצה בהשהיה · ${fmtClock(R.elapsed)}` : 'הריצה התחילה';
  if (R.goal) text += R.goalHit ? ' · הגעת ליעד ✓' : ` · נשארו ${fmtKm(Math.max(0, R.goal * 1000 - R.dist))} ק״מ ליעד`;
  RT.update({ title, text, chip: `${fmtKm(R.dist, 1)} ק״מ`, elapsedMs: R.elapsed * 1000, paused: R.status === 'paused', dist: R.dist, goal: (R.goal || 0) * 1000 }).catch(() => {});
}
// שיתוף ושמירת קבצים בתוך האפליקציה (הדפדפן הפנימי לא תומך בשיתוף רגיל)
function blobToBase64(blob) {
  return new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(',')[1]); fr.onerror = rej; fr.readAsDataURL(blob); });
}
async function nativeShare({ title, text, url, blob, name }) {
  const opts = { title, text, url, dialogTitle: title };
  if (blob && FSYS) {
    const w = await FSYS.writeFile({ path: name, data: await blobToBase64(blob), directory: 'CACHE' });
    opts.files = [w.uri];
  }
  await SH.share(opts);
}

function startGps() {
  if (NATIVE && R.status !== 'idle') { nativeTrackStart(); return; }
  startWebGps();
}
function startWebGps() {
  if (!('geolocation' in navigator)) { setGps('bad', 'אין GPS במכשיר הזה'); return; }
  if (watchId != null || trackOn) return;
  watchId = navigator.geolocation.watchPosition(onPosition, (err) => {
    if (err.code === 1) setGps('bad', `אין הרשאת מיקום. יש לאשר מיקום בהגדרות ${NATIVE ? 'האפליקציה' : 'הדפדפן'}`);
    else setGps('bad', 'אין קליטת GPS');
  }, { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 });
}
function setGps(q, text) { $('#gpsChip').dataset.q = q; $('#gpsText').textContent = text; }

function onPosition(pos) {
  const c = pos.coords, ts = pos.timestamp || Date.now();
  curFixTs = ts;
  if (R.status === 'running' && !R.autoPaused) { const now = Date.now(); R.elapsed += (now - R.lastTick) / 1000; R.lastTick = now; }
  const acc = Math.round(c.accuracy);
  if (acc <= 10) setGps('good', `GPS מדויק, ±${acc} מ׳`);
  else if (acc <= 25) setGps('ok', `GPS בינוני, ±${acc} מ׳`);
  else setGps('bad', `קליטת GPS חלשה, ±${acc} מ׳`);

  const raw = [c.latitude, c.longitude];
  if (R.status !== 'running') {
    moveMe(raw, acc);
    if (c.heading != null && c.speed > 0.6) setHeading(c.heading);
    return;
  }
  if (acc > 30) return; // קריאה לא מדויקת — מדלגים
  if (R.last && ts - R.last.ts > 10000) filter.reset(); // אחרי הפסקה ארוכה מתחילים את הסינון מחדש
  const p = filter.process(c.latitude, c.longitude, acc, ts);
  moveMe(p, acc);
  if (c.heading != null && c.speed > 0.6) setHeading(c.heading);

  if (!R.last) { R.last = { p, ts }; addPoint(p); return; }
  const dd = hav(R.last.p, p), dt = (ts - R.last.ts) / 1000;
  if (dd < 4) return; // רעש במקום
  if (dt > 0 && dd / dt > 9) { // קפיצה לא הגיונית (מעל 32 קמ״ש)
    if (++R.jumps > 5) { R.last = { p, ts }; R.jumps = 0; }
    return;
  }
  R.jumps = 0;
  // האפליקציה לא הייתה פתוחה: משלימים את הקטע החסר בקו ישר
  if (dt > 15) { R.bridged = (R.bridged || 0) + dd; toast(`השלמתי ${Math.round(dd)} מ׳ מהזמן שהאפליקציה לא הייתה פתוחה`, 4500); }
  if (heading == null || !(c.heading != null && c.speed > 0.6)) setHeading(bearing(R.last.p, p));
  R.last = { p, ts };
  if (R.autoPaused) { R.autoPaused = false; R.lastTick = Date.now(); toast('ממשיכים'); }
  R.dist += dd;
  R.lastMove = Date.now();
  R.elapsedAtMove = R.elapsed;
  addPoint(p);
  checkSplits();
  checkWorkoutDistance();
  checkGoal();
}
function checkGoal() {
  if (!R.goal || R.goalHit || R.dist < R.goal * 1000) return;
  R.goalHit = true;
  vibrate([700, 150, 700, 150, 1000]);
  toast(`הגעת ליעד של ${fmtGoal(R.goal)} ק״מ. אפשר להמשיך לרוץ`, 7000);
}
let curFixTs = 0;
function addPoint(p) {
  // נקודה שהושלמה מהשירות (נמדדה לפני כמה שניות): הזמן שלה הוא הזמן שבו נמדדה, לא הרגע שבו התקבלה
  let el = R.elapsed;
  const late = Date.now() - curFixTs;
  if (curFixTs && late > 3000) el = Math.min(R.elapsed, Math.max(R.points.length ? R.points[R.points.length - 1][2] : 0, R.elapsed - late / 1000));
  R.points.push([+p[0].toFixed(6), +p[1].toFixed(6), +el.toFixed(1), +R.dist.toFixed(1)]);
  updateCurPace();
  drawPoint(p, paceColor(R.curPace, targetPace() || S.pace));
}
function updateCurPace() {
  const pts = R.points, n = pts.length;
  if (n < 2) return;
  const now = pts[n - 1];
  let i = n - 2;
  while (i > 0 && now[2] - pts[i][2] < 25) i--;
  const dd = now[3] - pts[i][3], dt = now[2] - pts[i][2];
  if (dd > 20 && dt > 0) {
    const p = (dt / dd) * 1000;
    R.curPace = isFinite(R.curPace) ? R.curPace * 0.6 + p * 0.4 : p;
  }
}
function checkSplits() {
  while (R.dist >= R.kmNext) {
    const t = timeAtDist(R.points, R.kmNext) ?? R.elapsed;
    const split = t - R.lastSplitT;
    R.splits.push(+split.toFixed(1));
    R.lastSplitT = t;
    if (S.vibeKm) vibrate(250);
    toast(`ק״מ ${R.kmNext / 1000}: ${fmtDur(split)}`);
    R.kmNext += 1000;
  }
}
function checkWorkoutDistance() {
  const c = R.context;
  if (!c || c.type !== 'plan' || R.done || c.workout.kind === 'intervals') return;
  if (R.dist >= c.workout.dist * 1000) {
    R.done = true;
    vibrate([300, 120, 300, 120, 300]);
    toast(`הגעת ל־${c.workout.dist} ק״מ. האימון הושלם, אפשר לסיים`, 6000);
  }
}

/* ---------------- חיישן צעדים ---------------- */
const steps = { ok: false, base: 9.8, sm: 0, above: false, lastTs: 0 };
function onMotion(e) {
  const a = e.accelerationIncludingGravity;
  if (!a || a.x == null) return;
  steps.ok = true;
  const m = Math.hypot(a.x, a.y, a.z);
  steps.base += (m - steps.base) * 0.04;
  steps.sm += ((m - steps.base) - steps.sm) * 0.35;
  const now = performance.now();
  if (!steps.above && steps.sm > 1.1 && now - steps.lastTs > 250) {
    steps.above = true; steps.lastTs = now;
    if (R.status === 'running') { R.steps++; R.stepTimes.push(now); }
  } else if (steps.above && steps.sm < 0) steps.above = false;
}
const strideM = () => (S.height / 100) * 0.65;
function stepCount() { return steps.ok ? R.steps : Math.round(R.dist / strideM()); }
function cadence() {
  if (steps.ok) {
    const now = performance.now();
    R.stepTimes = R.stepTimes.filter((t) => now - t < 30000);
    return R.stepTimes.length * 2;
  }
  return isFinite(R.curPace) && R.status === 'running' ? Math.round((1000 / R.curPace) / strideM() * 60) : 0;
}

/* ---------------- שעון ---------------- */
function tick() {
  const now = Date.now();
  if (R.status === 'running' && !R.autoPaused) {
    R.elapsed += (now - R.lastTick) / 1000;
    if (S.auto && (NATIVE || !document.hidden) && R.dist > 0 && now - R.lastMove > 12000) {
      R.autoPaused = true; R.elapsed = R.elapsedAtMove;
      toast('השהיה אוטומטית: זיהיתי עצירה');
    }
  }
  R.lastTick = now;
  if (NATIVE) updateLive();
  if (R.status === 'running') { updateSegments(); if (now - (R.lastSave || 0) > 5000) { R.lastSave = now; persistActive(); } }
  renderRun();
}
function updateSegments() {
  const c = R.context;
  if (!c || c.type !== 'plan' || c.workout.kind !== 'intervals') return;
  const segs = c.workout.segments;
  let acc = 0, idx = segs.length;
  for (let i = 0; i < segs.length; i++) { if (R.elapsed < acc + segs[i].dur) { idx = i; break; } acc += segs[i].dur; }
  if (idx !== R.segIdx) {
    const first = R.segIdx === -1;
    R.segIdx = idx;
    if (!first) {
      if (idx >= segs.length) {
        R.done = true;
        vibrate([300, 120, 300, 120, 300]);
        toast('סיימת את כל הקטעים. האימון הושלם, אפשר לסיים', 6000);
      } else if (S.vibeSeg) vibrate(segs[idx].k === 'fast' ? [500, 150, 500] : [800]);
    }
  }
  R.segAcc = acc;
}

/* ---------------- תצוגת מסך הריצה ---------------- */
function renderRun() {
  $('#vDist').textContent = fmtKm(R.dist);
  $('#vTime').textContent = fmtClock(R.elapsed);
  $('#vPace').textContent = R.status === 'running' && !R.autoPaused ? fmtPace(R.curPace) : '--:--';
  const avgP = R.dist > 50 ? R.elapsed / (R.dist / 1000) : NaN;
  const curP = R.status === 'running' && !R.autoPaused ? R.curPace : NaN;
  $('#vAvg').textContent = fmtPace(avgP);
  $('#vPaceK').textContent = kmhLine(curP);
  $('#vAvgK').textContent = kmhLine(avgP);
  renderGoal();
  if (!$('#pocket').hidden) {
    $('#pkDist').textContent = fmtKm(R.dist);
    $('#pkTime').textContent = fmtClock(R.elapsed);
    $('#pkGoal').textContent = goalText(true);
    $('#pkPace').textContent = isFinite(avgP) ? `${fmtPace(avgP)} לק״מ${kmhTxt(avgP)}` : '';
  }
  $('#vSteps').textContent = fmtInt(stepCount());
  $('#vCad').textContent = cadence();
  $('#vCal').textContent = Math.round(S.weight * (R.dist / 1000) * 1.036);
  $('#mTime').textContent = fmtClock(R.elapsed);
  $('#mDist').textContent = fmtKm(R.dist);

  // קטעי אימון
  const c = R.context, segBox = $('#segment');
  if (c && c.type === 'plan' && c.workout.kind === 'intervals' && R.status !== 'idle') {
    const segs = c.workout.segments, seg = segs[R.segIdx];
    segBox.hidden = false;
    if (seg) {
      segBox.dataset.kind = seg.k;
      $('#segName').textContent = seg.n;
      const next = segs[R.segIdx + 1];
      $('#segNext').textContent = `קטע ${R.segIdx + 1} מתוך ${segs.length}` + (next ? ` · הבא: ${next.n}, ${fmtDur(next.dur)}` : '');
      $('#segLeft').textContent = fmtDur(R.segAcc + seg.dur - R.elapsed);
    } else {
      segBox.dataset.kind = 'rec';
      $('#segName').textContent = 'האימון הושלם';
      $('#segNext').textContent = 'אפשר לסיים ולשמור';
      $('#segLeft').textContent = '✓';
    }
  } else segBox.hidden = true;
  const mSeg = $('#mSeg');
  mSeg.hidden = segBox.hidden;
  if (!segBox.hidden) {
    mSeg.dataset.kind = segBox.dataset.kind;
    mSeg.textContent = `${$('#segName').textContent} · ${$('#segLeft').textContent}`;
  }

  // מאמן קצב
  const coach = $('#coach'), tp = targetPace();
  const seg = c && c.type === 'plan' && c.workout.kind === 'intervals' ? c.workout.segments[R.segIdx] : null;
  if (!tp || (seg && seg.k === 'rec')) {
    coach.dataset.state = 'idle';
    $('#coachText').innerHTML = seg && seg.k === 'rec' ? 'התאוששות: הליכה או ריצה איטית' : 'אין קצב יעד לקטע הזה';
    $('#coachGhost').textContent = '';
    $('#paceNeedle').style.right = '50%';
  } else {
    $('#coachText').innerHTML = `יעד: <b dir="ltr">${fmtPace(tp)}</b> לק״מ`;
    const running = R.status === 'running' && !R.autoPaused && isFinite(R.curPace);
    const delta = running ? R.curPace - tp : 0;
    coach.dataset.state = !running ? 'idle' : Math.abs(delta) <= S.tol ? 'good' : delta > 0 ? 'slow' : 'fast';
    // בימין „מהר“, בשמאל „איטי“: קצב איטי (הפרש חיובי) מזיז את המחוג שמאלה
    $('#paceNeedle').style.right = `${Math.max(3, Math.min(97, 50 + (delta / 60) * 45))}%`;
    renderGhost(tp);
  }
}
const planRun = () => R.context && R.context.type === 'plan';
function goalText(withUnit) {
  if (!R.goal) return withUnit ? 'ק״מ' : '';
  if (R.goalHit) return `${withUnit ? 'ק״מ · ' : ''}הגעת ליעד ✓`;
  return `${withUnit ? 'ק״מ · ' : ''}נשארו ${fmtKm(R.goal * 1000 - R.dist)} ק״מ ליעד`;
}
let goalDrawn = null;
function drawGoalScale(g) { // שנתות ומספרים לאורך הפס, לפי גודל היעד
  if (goalDrawn === g) return;
  goalDrawn = g;
  const step = g <= 10 ? 1 : g <= 21 ? 2 : g <= 50 ? 5 : 10;
  let ticks = '', lbls = '<span style="left:0">0</span>';
  for (let k = step; k < g - 1e-9; k += step) {
    const x = (k / g) * 100;
    ticks += `<i style="left:${x}%"></i>`;
    if (g - k >= step * 0.45) lbls += `<span style="left:${x}%">${k}</span>`;
  }
  lbls += `<span style="left:100%">${fmtGoal(g)}</span>`;
  $('#goalTicks').innerHTML = ticks;
  $('#goalLbls').innerHTML = lbls;
}
function renderGoal() {
  const idle = R.status === 'idle';
  $('#goalRow').hidden = planRun() || (!idle && !R.goal);
  const g = idle ? LS.get('goalKm', 5) : R.goal;
  if (!g) return;
  $('#goalVal').textContent = fmtGoal(g);
  drawGoalScale(g);
  $('#goalEdit').hidden = !idle;
  $('#goalLeft').hidden = idle;
  const f = idle ? 0 : Math.min(1, R.dist / (g * 1000));
  $('#goalFill').style.width = `${f * 100}%`;
  $('#goalDot').hidden = idle;
  $('#goalDot').style.left = `${f * 100}%`;
  $('#goalRow').classList.toggle('hit', !idle && R.goalHit);
  if (!idle) $('#goalLeft').textContent = goalText(false);
}
function renderGhost(tp) {
  const g = $('#coachGhost'), c = R.context;
  g.className = 'coach-ghost';
  if (R.dist < 100) { g.textContent = ''; return; }
  let diff = null, vs = 'מהיעד';
  if (c && c.type === 'route' && c.pr) {
    const prT = timeAtDist(c.pr.points, R.dist);
    if (prT != null) { diff = prT - R.elapsed; vs = 'מהשיא'; moveGhost(posAtTime(c.pr.points, R.elapsed)); }
  } else if (!(c && c.type === 'plan' && c.workout.kind === 'intervals')) {
    diff = (R.dist / 1000) * tp - R.elapsed;
  }
  if (diff == null) { g.textContent = ''; return; }
  if (Math.abs(diff) < 2) { g.textContent = `בדיוק בקצב ${vs === 'מהשיא' ? 'השיא' : 'היעד'}`; return; }
  g.textContent = diff > 0 ? `מהיר ${vs} ב־${fmtGap(diff)}` : `איטי ${vs} ב־${fmtGap(diff)}`;
  g.classList.add(diff > 0 ? 'ahead' : 'behind');
}
function renderContext() {
  const c = R.context, box = $('#runContext');
  if (!c) { box.hidden = true; return; }
  box.hidden = false;
  if (c.type === 'route') {
    const rt = routes.find((x) => x.id === c.routeId);
    $('#runContextText').textContent = `מסלול: ${rt ? rt.name : ''} · ${fmtKm(rt ? rt.dist : 0, 1)} ק״מ` + (c.pr ? ` · שיא ${fmtDur(c.pr.time)}` : '');
  } else {
    $('#runContextText').textContent = `אימון: ${c.workout.title} · ${c.workout.desc}`;
  }
  $('#btnClearContext').hidden = R.status !== 'idle';
}
function renderControls() {
  const st = R.status;
  $('#btnStart').hidden = st !== 'idle';
  $('#btnPause').hidden = st !== 'running';
  $('#btnResume').hidden = st !== 'paused';
  $('#btnStop').hidden = st === 'idle';
  $('#btnPocket').hidden = st === 'idle';
  $('#runHint').hidden = st !== 'idle';
  if (st === 'idle') $('#pocket').hidden = true;
  $('#btnStart').textContent = R.context && R.context.type === 'plan' ? 'התחל אימון' : 'התחל ריצה';
  $('#btnClearContext').hidden = st !== 'idle';
}

/* ---------------- התחלה, השהיה, סיום ---------------- */
async function requestWake() {
  try { if ('wakeLock' in navigator) { wakeLock = await navigator.wakeLock.request('screen'); } } catch (e) { /* לא חובה */ }
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && R.status !== 'idle') {
    requestWake();
    R.lastMove = Date.now(); // זמן חסד עד שה־GPS חוזר, כדי שלא תהיה השהיה אוטומטית מיד
    if (NATIVE) syncMissed();
  }
});

function countdown() {
  return new Promise((res) => {
    const box = $('#countdown'), num = $('#cdNum');
    let n = 3; box.hidden = false; num.textContent = n; vibrate(80);
    const iv = setInterval(() => {
      n--;
      if (n === 0) { clearInterval(iv); box.hidden = true; vibrate(300); res(); return; }
      num.textContent = n; num.style.animation = 'none'; void num.offsetWidth; num.style.animation = ''; vibrate(80);
    }, 1000);
  });
}
let runStarting = false;
async function startRun(opts) {
  if (typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function') {
    try { await DeviceMotionEvent.requestPermission(); } catch (e) { /* */ }
  }
  if (NATIVE) nativeTrackStart(); else startGps();
  requestWake();
  hideInstall();
  runStarting = true; $('#authSheet').hidden = true; // לא מקפיצים את חלון הענן באמצע ריצה
  const goal = planRun() ? 0 : LS.get('goalKm', 5);
  if (!(opts && opts.quick)) await countdown();
  runStarting = false; $('#authSheet').hidden = true;
  Object.assign(R, {
    goal, goalHit: false, bridged: 0,
    status: 'running', autoPaused: false, start: Date.now(), elapsed: 0, lastTick: Date.now(), elapsedAtMove: 0, lastMove: Date.now(),
    dist: 0, points: [], last: null, jumps: 0, steps: 0, stepTimes: [], splits: [], kmNext: 1000, lastSplitT: 0, curPace: NaN, segIdx: -1, done: false,
  });
  filter.reset();
  nextSeq = 0; lastFixTs = 0; // ריצה חדשה: השירות מתחיל לספור נקודות מאפס
  clearTrack();
  setFollow(true);
  lockTabs(true);
  renderControls(); renderContext();
}
function pauseRun() {
  R.status = 'paused'; R.last = null; filter.reset();
  persistActive(); renderControls(); if (NATIVE) updateLive(true);
}
function resumeRun() {
  R.status = 'running'; R.autoPaused = false; R.lastTick = Date.now(); R.lastMove = Date.now();
  requestWake(); renderControls();
  if (NATIVE) { nativeTrackStart(); updateLive(true); }
}
async function stopRun() {
  if (RT && trackOn) { try { await syncMissed(); } catch (e) { /* */ } } // לפני הסיכום: כל נקודה שהשירות קלט
  const wasPaused = R.status;
  R.status = 'paused';
  if (R.dist < 50) {
    toast('הריצה קצרה מ־50 מטר ולכן לא נשמרה');
    resetRun();
    return;
  }
  const run = {
    id: newId(), start: R.start, end: Date.now(), dist: Math.round(R.dist), time: Math.round(R.elapsed),
    steps: stepCount(), stepsEstimated: !steps.ok, splits: R.splits.slice(), points: downsample(R.points, 5),
    cal: Math.round(S.weight * (R.dist / 1000) * 1.036), note: '', routeId: null, workout: null,
    goal: R.goal || 0, bridged: Math.round(R.bridged || 0),
  };
  const c = R.context;
  let badge = null;
  if (c && c.type === 'route') {
    run.routeId = c.routeId;
    const rt = routes.find((x) => x.id === c.routeId);
    if (rt && run.dist >= rt.dist * 0.95) {
      if (!c.pr) badge = 'הריצה הראשונה שלך במסלול נשמרה כשיא';
      else if (run.time < c.pr.time) badge = `שיא חדש במסלול, מהיר ב־${fmtGap(c.pr.time - run.time)}`;
    }
  }
  if (c && c.type === 'plan') {
    const w = c.workout;
    const complete = w.kind === 'intervals' ? R.done : run.dist >= w.dist * 1000 * 0.9;
    run.workout = { planId: c.planId, key: w.key, title: w.title, complete };
    if (complete && plan && plan.id === c.planId) {
      plan.done[w.key] = run.id; LS.set('plan', plan);
      badge = `האימון „${w.title}“ הושלם`;
    }
  }
  if (!badge && R.goalHit) badge = `הגעת ליעד של ${fmtGoal(R.goal)} ק״מ`;
  await saveRun(run);
  console.info(`AL-HADERECH run saved dist=${run.dist} time=${run.time} points=${R.points.length}`);
  void wasPaused;
  resetRun();
  openDetail(run.id, { summary: true, badge });
}
function resetRun() {
  Object.assign(R, { status: 'idle', goal: 0, goalHit: false, bridged: 0, autoPaused: false, elapsed: 0, dist: 0, points: [], last: null, steps: 0, stepTimes: [], splits: [], curPace: NaN, segIdx: -1, done: false, context: null });
  LS.del('activeRun');
  clearTrack(); showGhostRoute(null);
  if (wakeLock) { wakeLock.release().catch(() => {}); wakeLock = null; }
  if (NATIVE) nativeTrackStop();
  lockTabs(false);
  renderControls(); renderContext(); renderRun();
}
function downsample(points, minGap) {
  if (points.length < 3) return points.slice();
  const out = [points[0]];
  for (let i = 1; i < points.length - 1; i++) if (points[i][3] - out[out.length - 1][3] >= minGap) out.push(points[i]);
  out.push(points[points.length - 1]);
  return out;
}
function persistActive() {
  if (R.status === 'idle') return;
  LS.set('activeRun', { R: Object.assign({}, R, { stepTimes: [], last: null, lastFixTs, nextSeq }), saved: Date.now() });
}
function restoreActive() {
  const a = LS.get('activeRun', null);
  if (!a || !a.R || !a.R.points) return;
  Object.assign(R, a.R, { status: 'paused', autoPaused: false, last: null, stepTimes: [] });
  if (R.context && R.context.type === 'route') showGhostRoute(routes.find((x) => x.id === R.context.routeId));
  const tp = targetPace() || S.pace;
  R.points.forEach((p) => drawPoint([p[0], p[1]], paceColor(NaN, tp)));
  lockTabs(true);
  renderControls(); renderContext(); renderRun();
  // באפליקציית האנדרואיד השירות אולי המשיך למדוד בזמן שהמסך נסגר: ממשיכים ממנו
  if (RT) {
    RT.status().then(async (st) => {
      if (!st.running) { toast('שחזרתי ריצה שלא הסתיימה. אפשר להמשיך או לסיים', 6000); return; }
      lastFixTs = a.R.lastFixTs || 0;
      nextSeq = a.R.nextSeq || 0;
      if (a.R.nextSeq == null) { // ריצה ששמורה מגרסה קודמת: מוצאים את המקום לפי הזמן
        try {
          const r = await RT.getSince({ time: lastFixTs });
          nextSeq = r.points && r.points.length && r.points[0].seq != null ? r.points[0].seq : (st.points || 0);
        } catch (e) { /* */ }
      }
      if (a.R.status === 'running' && !st.paused) {
        R.elapsed += (Date.now() - a.saved) / 1000;
        R.status = 'running'; R.lastTick = Date.now(); R.lastMove = Date.now();
      }
      // קודם כל הנקודות שהשירות שמר בזמן שהאפליקציה הייתה סגורה, ורק אחר כך נקודות חדשות
      await nativeTrackStart();
      await syncMissed();
      renderControls(); renderRun(); updateLive(true);
      toast('הריצה ממשיכה. כל מה שנמדד ברקע נשמר', 5000);
    }).catch(() => {});
    return;
  }
  toast('שחזרתי ריצה שלא הסתיימה. אפשר להמשיך או לסיים', 6000);
}
function lockTabs(on) { $('#tabs').classList.toggle('locked', on); }

/* ---------------- ניווט ---------------- */
const VIEWS = ['run', 'history', 'detail', 'routes', 'route', 'plan', 'settings'];
let currentView = 'run';
function show(v, { push = false } = {}) {
  VIEWS.forEach((x) => { $('#view-' + x).hidden = x !== v; });
  const tab = v === 'detail' ? 'history' : v === 'route' ? 'routes' : v;
  document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.v === tab));
  currentView = v;
  if (push) history.pushState({ v }, '');
  if (v === 'run') setTimeout(() => map.invalidateSize(), 50);
  if (v === 'history') renderHistory();
  if (v === 'routes') renderRoutes();
  if (v === 'plan') renderPlan();
  if (v === 'settings') fillSettings();
  $('#view-' + v).scrollTop = 0;
}
window.addEventListener('popstate', () => {
  if (currentView === 'detail') show(detailFrom || 'history');
  else if (currentView === 'route') show('routes');
});

/* ---------------- היסטוריה ונתונים ---------------- */
function weekStart(ts) { const d = new Date(ts); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - d.getDay()); return d.getTime(); }
function thumbSvg(points) {
  if (!points || points.length < 2) return '<svg viewBox="0 0 54 54" aria-hidden="true"></svg>';
  let minLa = 90, maxLa = -90, minLo = 180, maxLo = -180;
  points.forEach((p) => { minLa = Math.min(minLa, p[0]); maxLa = Math.max(maxLa, p[0]); minLo = Math.min(minLo, p[1]); maxLo = Math.max(maxLo, p[1]); });
  const k = Math.cos(((minLa + maxLa) / 2) * Math.PI / 180);
  const w = (maxLo - minLo) * k || 1e-6, h = (maxLa - minLa) || 1e-6, s = 42 / Math.max(w, h);
  const ox = (54 - w * s) / 2, oy = (54 - h * s) / 2;
  const step = Math.max(1, Math.floor(points.length / 80));
  const d = points.filter((_, i) => i % step === 0 || i === points.length - 1)
    .map((p, i) => `${i ? 'L' : 'M'}${(ox + (p[1] - minLo) * k * s).toFixed(1)} ${(oy + (maxLa - p[0]) * s).toFixed(1)}`).join('');
  return `<svg viewBox="0 0 54 54" aria-hidden="true"><path d="${d}" fill="none" stroke="var(--accent)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}
function renderHistory() {
  // השבוע
  const ws = weekStart(Date.now());
  const wr = runs.filter((r) => r.start >= ws);
  const km = wr.reduce((s, r) => s + r.dist, 0) / 1000;
  const t = wr.reduce((s, r) => s + r.time, 0);
  $('#weekKm').textContent = km.toFixed(1);
  $('#weekGoal').textContent = S.week;
  $('#weekRuns').textContent = wr.length;
  $('#weekTime').textContent = fmtDur(t);
  $('#weekRing').style.strokeDashoffset = 314.16 * (1 - Math.min(1, km / S.week));
  $('#weekMsg').textContent = km >= S.week ? 'עמדת ביעד השבועי. כל הכבוד!' : `עוד ${(S.week - km).toFixed(1)} ק״מ ליעד השבועי`;

  // 8 שבועות
  const weeks = [];
  for (let i = 7; i >= 0; i--) {
    const s = ws - i * 7 * 864e5, e = s + 7 * 864e5;
    weeks.push({ s, km: runs.filter((r) => r.start >= s && r.start < e).reduce((a, r) => a + r.dist, 0) / 1000 });
  }
  const max = Math.max(S.week, ...weeks.map((w) => w.km), 1);
  const W = 320, H = 130, bw = 26, gap = (W - 30 - bw * 8) / 7;
  let svg = `<svg viewBox="0 0 ${W} ${H}" style="direction:ltr" role="img" aria-label="קילומטרים בכל שבוע">`;
  const gy = 100 - (S.week / max) * 85;
  svg += `<line x1="0" x2="${W}" y1="${gy}" y2="${gy}" stroke="var(--muted)" stroke-dasharray="3 4" stroke-width="1"/><text x="${W - 2}" y="${gy - 4}" text-anchor="end">יעד ${S.week}</text>`;
  weeks.forEach((w, i) => {
    const xi = 15 + i * (bw + gap); // השבוע הנוכחי בצד ימין
    const h = (w.km / max) * 85, y = 100 - h;
    const cur = i === 7;
    svg += `<rect x="${xi}" y="${y}" width="${bw}" height="${Math.max(h, 1)}" rx="4" fill="${cur ? 'var(--accent)' : 'color-mix(in srgb, var(--accent) 45%, var(--surface-2))'}"/>`;
    if (w.km > 0) svg += `<text x="${xi + bw / 2}" y="${y - 4}" text-anchor="middle">${w.km.toFixed(w.km < 10 ? 1 : 0)}</text>`;
    const d = new Date(w.s);
    svg += `<text x="${xi + bw / 2}" y="${H - 14}" text-anchor="middle">${d.getDate()}.${d.getMonth() + 1}</text>`;
  });
  svg += '</svg>';
  $('#weeksChart').innerHTML = svg;

  // שיאים
  const prs = [];
  const eff = (len, label) => {
    let best = null;
    runs.forEach((r) => { const v = bestEffort(r.points, len); if (v != null && (!best || v < best.v)) best = { v, r }; });
    prs.push({ label, val: best ? fmtDur(best.v) : '—', sub: best ? heShort.format(best.r.start) : 'עדיין אין' });
  };
  eff(1000, '1 ק״מ'); eff(3000, '3 ק״מ'); eff(5000, '5 ק״מ'); eff(10000, '10 ק״מ');
  const longest = runs.reduce((b, r) => (!b || r.dist > b.dist ? r : b), null);
  prs.push({ label: 'הריצה הארוכה ביותר (ק״מ)', val: longest ? fmtKm(longest.dist) : '—', sub: longest ? heShort.format(longest.start) : 'עדיין אין' });
  const paced = runs.filter((r) => r.dist >= 1000).reduce((b, r) => (!b || r.time / r.dist < b.time / b.dist ? r : b), null);
  prs.push({ label: 'הקצב הממוצע הטוב ביותר', val: paced ? fmtPace(paced.time / (paced.dist / 1000)) : '—', sub: paced ? heShort.format(paced.start) : 'בריצה של ק״מ ומעלה' });
  $('#prs').innerHTML = prs.map((p) => `<div class="pr"><span>${p.label}</span><b dir="ltr">${p.val}</b><em>${p.sub}</em></div>`).join('');

  // רשימה
  $('#histCount').textContent = runs.length ? `· ${runs.length}` : '';
  if (!runs.length) {
    $('#histList').innerHTML = '<div class="empty"><b>עדיין אין ריצות</b>כשתסיים את הריצה הראשונה, היא תופיע כאן עם המסלול, הזמן והקצב.</div>';
    return;
  }
  $('#histList').innerHTML = runs.map((r) => {
    const rt = r.routeId && routes.find((x) => x.id === r.routeId);
    const tag = r.workout ? `<span class="badge">${esc(r.workout.title)}</span>` : rt ? `<span class="badge">${esc(rt.name)}</span>` : '';
    return `<button class="run-item" data-id="${r.id}">${thumbSvg(r.points)}
      <div class="ri-main"><b dir="ltr">${fmtKm(r.dist)}</b> ק״מ ${tag}<span>${heDay.format(r.start)} · ${heTime.format(r.start)}</span></div>
      <div class="ri-side"><b dir="ltr">${fmtDur(r.time)}</b><span dir="ltr">${fmtPace(r.time / (r.dist / 1000))}</span> לק״מ</div></button>`;
  }).join('');
}
$('#histList').addEventListener('click', (e) => { const b = e.target.closest('.run-item'); if (b) openDetail(b.dataset.id); });

/* ---------------- פרטי ריצה ---------------- */
let dMap = null, dLayer = null, detailId = null, detailFrom = null, matchRoute = null;
function ensureMiniMap(id, existing) {
  if (existing) return existing;
  const m = L.map(id, { zoomControl: false, attributionControl: true, dragging: true, scrollWheelZoom: false });
  tileLayer(mapKey()).addTo(m);
  return m;
}
function drawRunOnMap(m, layer, r) {
  layer.clearLayers();
  const pts = r.points;
  if (!pts || pts.length < 2) { m.setView(ROSH_HAAYIN, 14); return; }
  const avg = r.time / (r.dist / 1000);
  L.polyline(pts.map((p) => [p[0], p[1]]), { color: '#fff', weight: 9, opacity: 0.9 }).addTo(layer);
  // צביעה לפי קצב ביחס לממוצע הריצה
  let seg = [[pts[0][0], pts[0][1]]], color = null;
  for (let i = 1; i < pts.length; i++) {
    let j = i; while (j > 0 && pts[i][3] - pts[j][3] < 100) j--;
    const pace = pts[i][3] > pts[j][3] ? ((pts[i][2] - pts[j][2]) / (pts[i][3] - pts[j][3])) * 1000 : avg;
    const c = pace <= avg - 10 ? css('--good') : pace <= avg + 10 ? css('--accent') : css('--bad');
    if (color && c !== color) { L.polyline(seg, { color, weight: 5, lineCap: 'round', lineJoin: 'round' }).addTo(layer); seg = [seg[seg.length - 1]]; }
    color = c; seg.push([pts[i][0], pts[i][1]]);
  }
  L.polyline(seg, { color, weight: 5, lineCap: 'round', lineJoin: 'round' }).addTo(layer);
  const pin = (p, cls) => L.marker([p[0], p[1]], { interactive: false, icon: L.divIcon({ className: '', iconSize: [14, 14], iconAnchor: [7, 7], html: `<div class="pin ${cls}"></div>` }) }).addTo(layer);
  pin(pts[0], 's'); pin(pts[pts.length - 1], 'e');
  setTimeout(() => { m.invalidateSize(); m.fitBounds(L.latLngBounds(pts.map((p) => [p[0], p[1]])), { padding: [20, 20] }); }, 60);
}
function openDetail(id, opts = {}) {
  const r = runs.find((x) => x.id === id);
  if (!r) return;
  detailId = id;
  detailFrom = opts.summary ? 'run' : 'history';
  show('detail', { push: true });
  $('#dTitle').textContent = opts.summary ? 'כל הכבוד, סיימת' : runTitle(r.start);
  $('#dSub').textContent = `${heDay.format(r.start)} · ${heTime.format(r.start)}` + (r.workout ? ` · ${r.workout.title}` : '');
  $('#dDist').textContent = fmtKm(r.dist);
  $('#dTime').textContent = fmtDur(r.time);
  $('#dPace').textContent = fmtPace(r.time / (r.dist / 1000));
  $('#dPaceK').textContent = kmhLine(r.time / (r.dist / 1000));
  stopReplay(false);
  $('#btnReplay').hidden = !(r.points && r.points.length > 3);
  $('#tipCard').hidden = !opts.summary;
  if (opts.summary) renderTip(r);
  $('#dSteps').textContent = fmtInt(r.steps);
  $('#dCad').textContent = r.time ? Math.round(r.steps / (r.time / 60)) : 0;
  $('#dBadge').hidden = !opts.badge; $('#dBadge').textContent = opts.badge || '';
  $('#dNote').value = r.note || '';
  $('#delConfirm').hidden = true;

  // שמירה כמסלול או שיוך למסלול קיים
  $('#saveRouteCard').hidden = true; $('#matchRouteCard').hidden = true; matchRoute = null;
  if (opts.summary && !r.routeId && r.points.length > 5) {
    matchRoute = routes.find((rt) => Math.abs(rt.dist - r.dist) / rt.dist < 0.08 && hav(rt.points[0], r.points[0]) < 150);
    if (matchRoute) {
      $('#matchTitle').textContent = `נראה שרצת במסלול „${matchRoute.name}“`;
      $('#matchRouteCard').hidden = false;
    } else {
      $('#routeName').value = '';
      $('#routeName').placeholder = `${runTitle(r.start)} ${fmtKm(r.dist, 1)} ק״מ`;
      $('#saveRouteCard').hidden = false;
    }
  }

  dMap = ensureMiniMap('dMap', dMap);
  if (!dLayer) dLayer = L.layerGroup().addTo(dMap);
  drawRunOnMap(dMap, dLayer, r);
  renderPaceChart(r);
  renderSplits(r);
}
function renderPaceChart(r) {
  const pts = r.points;
  if (!pts || pts.length < 4 || r.dist < 400) { $('#dChart').innerHTML = '<p class="muted">אין מספיק נתונים לגרף.</p>'; return; }
  const bucket = r.dist > 6000 ? 500 : 200;
  const vals = [];
  for (let d = bucket; d <= r.dist; d += bucket) {
    const t1 = timeAtDist(pts, d), t0 = timeAtDist(pts, d - bucket);
    if (t1 != null && t0 != null && t1 > t0) vals.push({ d, p: ((t1 - t0) / bucket) * 1000 });
  }
  if (vals.length < 2) { $('#dChart').innerHTML = '<p class="muted">אין מספיק נתונים לגרף.</p>'; return; }
  const avg = r.time / (r.dist / 1000);
  const sorted = vals.map((v) => v.p).sort((a, b) => a - b);
  const lo = Math.max(120, sorted[0] - 15), hi = Math.min(sorted[sorted.length - 1] + 15, avg * 1.8);
  const W = 320, H = 140, L0 = 36, B = 22;
  const x = (d) => L0 + (d / r.dist) * (W - L0 - 8);
  const y = (p) => 8 + ((Math.min(p, hi) - lo) / (hi - lo || 1)) * (H - B - 8); // מהיר = למעלה
  const line = vals.map((v, i) => `${i ? 'L' : 'M'}${x(v.d).toFixed(1)} ${y(v.p).toFixed(1)}`).join('');
  const area = `${line}L${x(vals[vals.length - 1].d).toFixed(1)} ${H - B}L${x(vals[0].d).toFixed(1)} ${H - B}Z`;
  let s = `<svg viewBox="0 0 ${W} ${H}" style="direction:ltr" role="img" aria-label="גרף קצב">`;
  [lo, (lo + hi) / 2, hi].forEach((p) => { s += `<line x1="${L0}" x2="${W}" y1="${y(p)}" y2="${y(p)}" stroke="var(--line)" stroke-width="1"/><text x="${L0 - 4}" y="${y(p) + 3}" text-anchor="end">${fmtPace(p)}</text>`; });
  s += `<path d="${area}" fill="color-mix(in srgb, var(--accent) 18%, transparent)"/>`;
  s += `<path d="${line}" fill="none" stroke="var(--accent)" stroke-width="2.2" stroke-linejoin="round"/>`;
  s += `<line x1="${L0}" x2="${W}" y1="${y(avg)}" y2="${y(avg)}" stroke="var(--fg)" stroke-dasharray="4 4" stroke-width="1"/>`;
  const kmMarks = Math.floor(r.dist / 1000);
  const every = kmMarks > 8 ? 2 : 1;
  for (let k = 1; k <= kmMarks; k += every) s += `<text x="${x(k * 1000)}" y="${H - 6}" text-anchor="middle">${k}</text>`;
  s += `<text x="${L0 - 4}" y="${H - 6}" text-anchor="end">ק״מ</text></svg>`;
  s += '<p class="muted">למעלה = מהר יותר. הקו המקווקו הוא הקצב הממוצע.</p>';
  $('#dChart').innerHTML = s;
}
function renderSplits(r) {
  const sp = r.splits || [];
  const rest = r.dist - sp.length * 1000;
  const restT = r.time - sp.reduce((a, b) => a + b, 0);
  if (!sp.length) { $('#dSplits').innerHTML = `<p class="muted">הריצה קצרה מק״מ אחד: ${fmtKm(r.dist)} ק״מ ב־${fmtDur(r.time)}.</p>`; return; }
  const min = Math.min(...sp), max = Math.max(...sp, rest > 100 ? (restT / rest) * 1000 : 0);
  let h = sp.map((t, i) => `<div class="split${t === min && sp.length > 1 ? ' best' : ''}"><span>${i + 1}</span><div class="bar"><i style="width:${(45 + 55 * (t / max)).toFixed(0)}%"></i></div><b dir="ltr">${fmtDur(t)}</b></div>`).join('');
  if (rest > 100) {
    const p = (restT / rest) * 1000;
    h += `<div class="split"><span dir="ltr">${(rest / 1000).toFixed(2)}</span><div class="bar"><i style="width:${(45 + 55 * (p / max)).toFixed(0)}%"></i></div><b dir="ltr">${fmtDur(restT)}</b></div>`;
    h += `<p class="muted">בשורה האחרונה: המרחק שנשאר אחרי הק״מ המלא האחרון.</p>`;
  }
  $('#dSplits').innerHTML = h;
}
$('#btnBack').onclick = () => history.back();
$('#dNote').addEventListener('change', async () => {
  const r = runs.find((x) => x.id === detailId); if (!r) return;
  r.note = $('#dNote').value.trim(); await saveRun(r); toast('ההערה נשמרה');
});
$('#btnCopy').onclick = async () => {
  const r = runs.find((x) => x.id === detailId); if (!r) return;
  const txt = `${runTitle(r.start)} · ${fmtKm(r.dist)} ק״מ · ${fmtDur(r.time)} · קצב ${fmtPace(r.time / (r.dist / 1000))} לק״מ · ${fmtInt(r.steps)} צעדים`;
  try { await navigator.clipboard.writeText(txt); toast('הסיכום הועתק'); } catch (e) { toast(txt, 6000); }
};
$('#btnDelete').onclick = () => { $('#delConfirm').hidden = false; };
$('#btnDelNo').onclick = () => { $('#delConfirm').hidden = true; };
$('#btnDelYes').onclick = async () => {
  const r = runs.find((x) => x.id === detailId);
  if (r && r.workout && plan && plan.done[r.workout.key] === r.id) { delete plan.done[r.workout.key]; LS.set('plan', plan); }
  await deleteRun(detailId); toast('הריצה נמחקה'); show('history');
};
$('#btnSaveRoute').onclick = async () => {
  const r = runs.find((x) => x.id === detailId); if (!r) return;
  const name = $('#routeName').value.trim() || $('#routeName').placeholder;
  const pts = downsample(r.points, 15).map((p) => [p[0], p[1]]);
  const rt = { id: newId(), name, dist: r.dist, points: pts, created: Date.now() };
  await saveRoute(rt);
  r.routeId = rt.id; await saveRun(r);
  $('#saveRouteCard').hidden = true;
  $('#dBadge').hidden = false; $('#dBadge').textContent = `המסלול „${name}“ נשמר. בפעם הבאה תוכל לרוץ מול השיא שלך`;
};
$('#btnSkipRoute').onclick = () => { $('#saveRouteCard').hidden = true; };
$('#btnMatchYes').onclick = async () => {
  const r = runs.find((x) => x.id === detailId); if (!r || !matchRoute) return;
  const prev = routePR(matchRoute.id);
  r.routeId = matchRoute.id; await saveRun(r);
  $('#matchRouteCard').hidden = true;
  $('#dBadge').hidden = false;
  $('#dBadge').textContent = !prev ? `הריצה שויכה למסלול „${matchRoute.name}“` : r.time < prev.time ? `שיא חדש במסלול „${matchRoute.name}“, מהיר ב־${fmtGap(prev.time - r.time)}` : `הריצה שויכה למסלול. השיא שלך בו: ${fmtDur(prev.time)}`;
};
$('#btnMatchNo').onclick = () => { $('#matchRouteCard').hidden = true; $('#saveRouteCard').hidden = false; };

/* ---------------- מסלולים ---------------- */
function routeRuns(id) { const rt = routes.find((x) => x.id === id); return runs.filter((r) => r.routeId === id && (!rt || r.dist >= rt.dist * 0.95)); }
function routePR(id) { return routeRuns(id).reduce((b, r) => (!b || r.time < b.time ? r : b), null); }
function renderRoutes() {
  if (!routes.length) {
    $('#routeList').innerHTML = '<div class="empty"><b>עדיין אין מסלולים שמורים</b>בסיום ריצה תוכל לשמור את הדרך שרצת כמסלול, ואז לרוץ בו שוב מול השיא שלך.</div>';
    return;
  }
  $('#routeList').innerHTML = routes.slice().sort((a, b) => b.created - a.created).map((rt) => {
    const pr = routePR(rt.id), n = routeRuns(rt.id).length;
    return `<button class="route-item" data-id="${rt.id}">${thumbSvg(rt.points)}
      <div><b class="nm">${esc(rt.name)}</b><span><span dir="ltr">${fmtKm(rt.dist, 1)}</span> ק״מ · ${n === 1 ? 'ריצה אחת' : `${n} ריצות`}</span></div>
      <div><span>שיא</span><b class="pr-t" dir="ltr">${pr ? fmtDur(pr.time) : '—'}</b></div></button>`;
  }).join('');
}
$('#routeList').addEventListener('click', (e) => { const b = e.target.closest('.route-item'); if (b) openRoute(b.dataset.id); });
let rMap = null, rLayer = null, routeId = null;
function drawRouteMap() {
  const rt = routes.find((x) => x.id === routeId); if (!rt || !rLayer) return;
  rLayer.clearLayers();
  L.polyline(rt.points, { color: '#fff', weight: 9 }).addTo(rLayer);
  L.polyline(rt.points, { color: css('--plum'), weight: 5, lineCap: 'round', lineJoin: 'round' }).addTo(rLayer);
  setTimeout(() => { rMap.invalidateSize(); rMap.fitBounds(L.latLngBounds(rt.points), { padding: [20, 20] }); }, 60);
}
function openRoute(id) {
  const rt = routes.find((x) => x.id === id); if (!rt) return;
  routeId = id;
  show('route', { push: true });
  const list = routeRuns(id).slice().sort((a, b) => b.start - a.start);
  const pr = routePR(id);
  $('#rTitle').textContent = rt.name;
  $('#rSub').textContent = `${fmtKm(rt.dist, 2)} ק״מ` + (pr ? ` · שיא ${fmtDur(pr.time)}` : '');
  $('#rRename').value = rt.name;
  $('#routeDelConfirm').hidden = true;
  rMap = ensureMiniMap('rMap', rMap);
  if (!rLayer) rLayer = L.layerGroup().addTo(rMap);
  stopReplay(false, 'route');
  drawRouteMap();
  if (!list.length) { $('#rRuns').innerHTML = '<p class="muted">עדיין אין ריצות מלאות במסלול הזה.</p>'; return; }
  const max = Math.max(...list.map((r) => r.time));
  $('#rRuns').innerHTML = list.map((r) => `<div class="rr${pr && r.id === pr.id ? ' best' : ''}"><span>${heShort.format(r.start)}</span><div class="bar"><i style="width:${(40 + 60 * (r.time / max)).toFixed(0)}%"></i></div><b dir="ltr">${fmtDur(r.time)}</b></div>`).join('')
    + '<p class="muted">בירוק: השיא שלך. פס קצר יותר = זמן מהיר יותר.</p>';
}
$('#btnRouteBack').onclick = () => history.back();
$('#btnRename').onclick = async () => {
  const rt = routes.find((x) => x.id === routeId); if (!rt) return;
  const n = $('#rRename').value.trim(); if (!n) { toast('יש לכתוב שם למסלול'); return; }
  rt.name = n; await saveRoute(rt); $('#rTitle').textContent = n; toast('השם נשמר');
};
$('#btnRouteDel').onclick = () => { $('#routeDelConfirm').hidden = false; };
$('#btnRouteDelNo').onclick = () => { $('#routeDelConfirm').hidden = true; };
$('#btnRouteDelYes').onclick = async () => { await deleteRoute(routeId); toast('המסלול נמחק'); show('routes'); };
$('#btnRunRoute').onclick = () => {
  if (R.status !== 'idle') { toast('יש לסיים את הריצה הנוכחית קודם'); return; }
  const rt = routes.find((x) => x.id === routeId); if (!rt) return;
  const pr = routePR(rt.id);
  R.context = { type: 'route', routeId: rt.id, pr: pr ? { time: pr.time, points: pr.points } : null };
  show('run');
  setTimeout(() => showGhostRoute(rt), 80);
  renderContext(); renderControls();
};

/* ---------------- תוכנית אימונים ---------------- */
const r5 = (s) => Math.round(s / 5) * 5;
const rHalf = (km) => Math.max(1, Math.round(km * 2) / 2);
function buildPlan(dist, time, days) {
  const P = time / dist, easy = r5(P + 70), long = r5(P + 55), fast = r5(P - 20), tgt = r5(P);
  const weeks = [];
  for (let w = 1; w <= 6; w++) {
    const fastDur = w <= 2 ? 60 : w <= 4 ? 120 : 180;
    const reps = w <= 2 ? 5 + (w - 1) : w <= 4 ? 4 + (w - 3) : 4;
    const intervals = { kind: 'intervals', title: 'מהר ולאט לסירוגין', reps, fast: fastDur, rec: 120, pace: fast, easy };
    const easyRun = { kind: 'easy', title: 'ריצה קלה', dist: rHalf(dist * (0.5 + 0.05 * w)), pace: easy };
    const tempo = { kind: 'tempo', title: 'ריצה בקצב היעד', dist: rHalf(dist * (0.35 + 0.07 * w)), pace: tgt };
    const longRun = { kind: 'long', title: 'ריצה ארוכה', dist: rHalf(Math.min(dist * 1.2, dist * (0.75 + 0.09 * (w - 1)))), pace: long };
    let list;
    if (days === 2) list = [intervals, w % 2 ? longRun : tempo];
    else if (days === 3) list = [w % 2 ? easyRun : tempo, intervals, longRun];
    else if (days === 4) list = [easyRun, intervals, w % 2 ? easyRun : tempo, longRun];
    else list = [easyRun, intervals, easyRun, tempo, longRun];
    if (w === 6) { // שבוע אחרון: קל יותר, ובסופו ריצת מבחן
      list = list.slice(0, -1).map((x) => (x.kind === 'long' || x.kind === 'tempo' ? Object.assign({}, easyRun, { dist: rHalf(dist * 0.5) }) : x));
      list.push({ kind: 'test', title: 'ריצת מבחן', dist, pace: tgt });
    }
    weeks.push(list.map((x, i) => Object.assign({}, x, { key: `${w}-${i}` })));
  }
  return { id: newId(), dist, time, days, created: Date.now(), weeks, done: {} };
}
function describe(w, p) {
  switch (w.kind) {
    case 'intervals': return `${w.reps} קטעים של ריצה מהירה, ${minutesText(w.fast)} כל אחד, בקצב ${fmtPace(w.pace)}. בין קטע לקטע 2 דקות של הליכה או ריצה איטית. כולל 5 דקות חימום ו־5 דקות שחרור`;
    case 'easy': return `${w.dist} ק״מ בקצב נינוח של ${fmtPace(w.pace)}. אמור להיות קל לדבר תוך כדי`;
    case 'tempo': return `${w.dist} ק״מ בקצב היעד, ${fmtPace(w.pace)}`;
    case 'long': return `${w.dist} ק״מ בקצב רגוע של ${fmtPace(w.pace)}`;
    case 'test': return `${w.dist} ק״מ. נסה לסיים ב־${fmtDur(p.time)}`;
    default: return '';
  }
}
function shortDesc(w) {
  if (w.kind === 'intervals') return `${w.reps} קטעים מהירים של ${minutesText(w.fast)}`;
  return `${w.dist} ק״מ בקצב ${fmtPace(w.pace)}`;
}
function workoutForRun(w) {
  const x = Object.assign({}, w, { desc: shortDesc(w) });
  if (w.kind === 'intervals') {
    const segs = [{ k: 'warm', n: 'חימום', dur: 300, pace: w.easy }];
    for (let i = 0; i < w.reps; i++) {
      segs.push({ k: 'fast', n: 'מהר', dur: w.fast, pace: w.pace });
      if (i < w.reps - 1) segs.push({ k: 'rec', n: 'לאט', dur: w.rec, pace: null });
    }
    segs.push({ k: 'cool', n: 'שחרור', dur: 300, pace: w.easy });
    x.segments = segs;
  }
  return x;
}
function planPreview() {
  const d = parseFloat($('#pDist').value), t = parseTime($('#pTime').value);
  const err = $('#pErr');
  if (!(d >= 1 && d <= 42.2) || !isFinite(t)) { $('#pPreview').textContent = ''; return null; }
  const p = t / d;
  if (p < 180 || p > 720) { err.hidden = false; err.textContent = `יוצא קצב של ${fmtPace(p)} לק״מ, וזה לא נראה סביר. כדאי לבדוק את הזמן ואת המרחק.`; $('#pPreview').textContent = ''; return null; }
  err.hidden = true;
  $('#pPreview').textContent = `קצב היעד: ${fmtPace(p)} לק״מ · 6 שבועות · מותאם למתחילים`;
  return { d, t };
}
['#pDist', '#pTime', '#pDays'].forEach((s) => $(s).addEventListener('input', planPreview));
$('#btnMakePlan').onclick = () => {
  const v = planPreview();
  if (!v) { if ($('#pErr').hidden) { $('#pErr').hidden = false; $('#pErr').textContent = 'יש למלא מרחק וזמן יעד, למשל 5 ו־30:00.'; } return; }
  if (plan && Object.keys(plan.done).length && !$('#btnMakePlan').dataset.sure) {
    $('#btnMakePlan').dataset.sure = '1';
    $('#btnMakePlan').textContent = 'לחץ שוב כדי להחליף את התוכנית הקיימת';
    return;
  }
  delete $('#btnMakePlan').dataset.sure;
  $('#btnMakePlan').textContent = 'בנה תוכנית';
  plan = buildPlan(v.d, v.t, parseInt($('#pDays').value, 10));
  LS.set('plan', plan);
  toast('התוכנית מוכנה');
  renderPlan();
};
function renderPlan() {
  const body = $('#planBody');
  if (plan) { $('#pDist').value = plan.dist; $('#pTime').value = fmtDur(plan.time); $('#pDays').value = plan.days; }
  planPreview();
  if (!plan) {
    body.innerHTML = '<div class="empty"><b>עדיין אין תוכנית</b>בחר מרחק, זמן יעד וכמה ימים בשבוע תרוץ, ואבנה לך תוכנית של 6 שבועות.</div>';
    return;
  }
  const curWeek = plan.weeks.findIndex((wk) => wk.some((w) => !plan.done[w.key]));
  let h = `<div class="card plan-head"><span>מטרה: <b dir="ltr">${plan.dist}</b> ק״מ ב־<b dir="ltr">${fmtDur(plan.time)}</b></span><span class="muted-i">קצב יעד <span dir="ltr">${fmtPace(plan.time / plan.dist)}</span> לק״מ</span></div>`;
  if (curWeek === -1) h += '<div class="note good">השלמת את כל התוכנית. כל הכבוד! אפשר לבנות תוכנית חדשה עם יעד שאפתני יותר.</div>';
  plan.weeks.forEach((wk, wi) => {
    const done = wk.filter((w) => plan.done[w.key]).length;
    h += `<div class="plan-week${wi === curWeek ? ' now' : ''}"><h3>שבוע ${wi + 1}${wi === curWeek ? ' (השבוע הנוכחי)' : ''}<span>${done} מתוך ${wk.length} הושלמו</span></h3>
      <div class="prog"><i style="width:${(done / wk.length) * 100}%"></i></div>`;
    wk.forEach((w) => {
      const isDone = !!plan.done[w.key];
      h += `<div class="wo${isDone ? ' done' : ''}"><span class="ck">${isDone ? '✓' : ''}</span><div><div class="t">${w.title}</div><div class="d">${describe(w, plan)}</div></div>
        ${isDone ? '' : `<button class="btn${wi === curWeek ? ' primary' : ''}" data-key="${w.key}">התחל</button>`}</div>`;
    });
    h += '</div>';
  });
  body.innerHTML = h;
}
$('#planBody').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-key]'); if (!b || !plan) return;
  if (R.status !== 'idle') { toast('יש לסיים את הריצה הנוכחית קודם'); return; }
  const w = plan.weeks.flat().find((x) => x.key === b.dataset.key); if (!w) return;
  R.context = { type: 'plan', planId: plan.id, workout: workoutForRun(w) };
  showGhostRoute(null);
  show('run'); renderContext(); renderControls(); renderRun();
});

/* ---------------- הגדרות ---------------- */
function fillSettings() {
  $('#sPace').value = fmtPace(S.pace); $('#sTol').value = S.tol; $('#sWeek').value = S.week;
  $('#sWeight').value = S.weight; $('#sHeight').value = S.height;
  $('#sVibeKm').checked = S.vibeKm; $('#sVibeSeg').checked = S.vibeSeg; $('#sAuto').checked = S.auto; $('#sMap').value = S.map;
  $('#savedMsg').hidden = true; calc();
}
$('#settingsForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const pace = parseTime($('#sPace').value);
  if (!isFinite(pace) || pace < 150 || pace > 900) { toast('קצב היעד צריך להיות בפורמט דקות:שניות, למשל 6:00'); $('#sPace').focus(); return; }
  const num = (id, lo, hi, d) => { const v = parseFloat($(id).value); return v >= lo && v <= hi ? v : d; };
  S = Object.assign(S, {
    pace, tol: num('#sTol', 5, 60, 15), week: num('#sWeek', 1, 300, 15), weight: num('#sWeight', 30, 200, 75), height: num('#sHeight', 120, 220, 175),
    vibeKm: $('#sVibeKm').checked, vibeSeg: $('#sVibeSeg').checked, auto: $('#sAuto').checked, map: $('#sMap').value,
  });
  LS.set('settings', S);
  switchLayer(mapKey());
  $('#savedMsg').hidden = false;
  renderRun();
});
function calc() {
  const d = parseFloat($('#cDist').value), t = parseTime($('#cTime').value);
  $('#cOut').textContent = d > 0 && isFinite(t) ? fmtPace(t / d) : '--:--';
}
$('#cDist').addEventListener('input', calc); $('#cTime').addEventListener('input', calc);
$('#cApply').onclick = () => {
  const v = $('#cOut').textContent;
  if (v === '--:--') { toast('יש למלא מרחק וזמן יעד'); return; }
  $('#sPace').value = v; toast('הקצב הועתק לשדה קצב היעד. לחץ על „שמור הגדרות“');
};
$('#btnExport').onclick = () => {
  const data = { app: 'rosh-haayin-runner', version: 1, exported: new Date().toISOString(), settings: S, plan, runs, routes };
  const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
  const d = new Date();
  if (NATIVE && SH) {
    nativeShare({ title: 'גיבוי הריצות', blob, name: `backup-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.json` })
      .then(() => { $('#backupMsg').textContent = `נוצר קובץ גיבוי עם ${runs.length} ריצות ו־${routes.length} מסלולים. שמור אותו בדרייב או שלח לעצמך.`; })
      .catch(() => {});
    return;
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `גיבוי-ריצות-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  $('#backupMsg').textContent = `נוצר קובץ גיבוי עם ${runs.length} ריצות ו־${routes.length} מסלולים.`;
};
$('#importFile').addEventListener('change', async (e) => {
  const f = e.target.files[0]; if (!f) return;
  try {
    const data = JSON.parse(await f.text());
    if (data.app !== 'rosh-haayin-runner') throw new Error('bad');
    let nr = 0, nrt = 0;
    for (const r of data.runs || []) if (!runs.some((x) => x.id === r.id)) { await saveRun(r); nr++; }
    for (const rt of data.routes || []) if (!routes.some((x) => x.id === rt.id)) { await saveRoute(rt); nrt++; }
    if (data.settings) { S = Object.assign({}, DEFAULTS, data.settings); LS.set('settings', S); fillSettings(); }
    if (data.plan && !plan) { plan = data.plan; LS.set('plan', plan); }
    $('#backupMsg').textContent = `יובאו ${nr} ריצות ו־${nrt} מסלולים.`;
  } catch (err) {
    $('#backupMsg').textContent = 'הקובץ לא נקרא. יש לבחור קובץ גיבוי שנוצר באפליקציה הזו.';
  }
  e.target.value = '';
});

/* ---------------- שיתוף האפליקציה ---------------- */
const SHARE_URL = 'https://amitbusi10-pixel.github.io/run/';
const SHARE_TEXT = '„על הדרך“, אפליקציית ריצה עם GPS מדויק, ספירת צעדים, מסלולים ותוכנית אימונים. לפתוח את הקישור ב־Chrome ולבחור בתפריט ⋮ „הוספה למסך הבית“.';
async function copyShareUrl() {
  try { await navigator.clipboard.writeText(SHARE_URL); }
  catch (e) {
    const ta = document.createElement('textarea');
    ta.value = SHARE_URL; document.body.appendChild(ta); ta.select();
    document.execCommand('copy'); ta.remove();
  }
  toast('הקישור הועתק. אפשר להדביק אותו בוואטסאפ או בהודעה');
}
$('#btnShare').onclick = async () => {
  if (NATIVE && SH) { try { await nativeShare({ title: 'על הדרך', text: SHARE_TEXT, url: SHARE_URL }); } catch (e) { /* נסגר */ } return; }
  if (navigator.share) {
    try { await navigator.share({ title: 'על הדרך', text: SHARE_TEXT, url: SHARE_URL }); }
    catch (e) { /* המשתמש סגר את חלון השיתוף */ }
  } else copyShareUrl();
};
$('#btnCopyLink').onclick = copyShareUrl;
function loadScript(src) {
  return new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = src; s.onload = res; s.onerror = rej; document.head.appendChild(s);
  });
}
$('#btnQr').onclick = async () => {
  const box = $('#qrBox');
  if (!box.hidden) { box.hidden = true; $('#btnQr').textContent = 'הצג קוד לסריקה'; return; }
  try {
    if (!window.qrcode) await loadScript('https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js');
    const q = qrcode(0, 'M'); q.addData(SHARE_URL); q.make();
    $('#qr').innerHTML = q.createSvgTag({ cellSize: 6, margin: 3, scalable: true });
    $('#shareUrl').textContent = SHARE_URL;
    box.hidden = false; $('#btnQr').textContent = 'הסתר את הקוד';
  } catch (e) {
    toast('אין חיבור לאינטרנט, ולכן הקוד לא נטען. אפשר לשתף קישור במקום');
  }
};

/* ---------------- התקנה כאפליקציה ---------------- */
// באנדרואיד: חלון ההתקנה של הדפדפן. באייפון: הסבר קצר, כי Safari לא מאפשר חלון התקנה.
let installPrompt = null;
const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const APK_URL = 'https://github.com/amitbusi10-pixel/run-android/releases/latest/download/al-haderech.apk';
const isAndroid = /Android/.test(navigator.userAgent);
let installMode = null;
function showInstall(mode) {
  if ((NATIVE && mode !== 'update') || R.status !== 'idle') return;
  if (mode !== 'apk' && isStandalone()) return;
  const key = mode === 'update' ? 'updateDismissed' : mode === 'apk' ? 'apkDismissed' : 'installDismissed';
  if (Date.now() - LS.get(key, 0) < (mode === 'update' ? 864e5 : 3 * 864e5)) return; // אחרי סגירה, לא מציגים שוב 3 ימים
  installMode = mode;
  const hint = $('#installHint'), btn = $('#btnInstall');
  $('#ibTitle').textContent = mode === 'update' ? 'יש גרסה חדשה של „על הדרך“' : mode === 'apk' ? 'אפליקציית „על הדרך“ לאנדרואיד' : 'להוסיף את „על הדרך“ למסך הבית?';
  btn.textContent = mode === 'update' ? 'עדכון' : mode === 'apk' ? 'הורדה' : 'התקנה';
  if (mode === 'update') { hint.textContent = 'התראה קבועה במסך הנעילה עם הזמן והמרחק'; btn.hidden = false; }
  else if (mode === 'apk') { hint.textContent = 'ממשיכה למדוד גם כשהמסך נעול'; btn.hidden = false; }
  else if (mode === 'prompt') { hint.textContent = 'ככה היא תיפתח כמו כל אפליקציה, במסך מלא ובלי דפדפן'; btn.hidden = false; }
  else if (mode === 'ios') { hint.textContent = 'לוחצים על כפתור השיתוף ⬆ בתחתית Safari ובוחרים „הוספה למסך הבית“'; btn.hidden = true; }
  else { hint.textContent = 'בתפריט הדפדפן ⋮ בוחרים „התקנת אפליקציה“ או „הוספה למסך הבית“'; btn.hidden = true; }
  $('#installBar').hidden = false;
}
function hideInstall() { $('#installBar').hidden = true; }
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installPrompt = e; if (!isAndroid) showInstall('prompt'); });
window.addEventListener('appinstalled', () => { installPrompt = null; hideInstall(); toast('„על הדרך“ הותקנה. אפשר לפתוח אותה מהמסך הראשי'); });
function downloadApk() {
  if (NATIVE) location.href = APK_URL; // בתוך האפליקציה: הקישור נפתח בדפדפן של הטלפון, ושם ההורדה מתחילה
  else window.open(APK_URL, '_blank'); toast('ההורדה מתחילה. אחרי שהיא מסתיימת, פותחים את הקובץ ומאשרים התקנה', 6000); }
$('#btnApk').onclick = downloadApk;
$('#btnInstall').onclick = async () => {
  if (installMode === 'apk' || installMode === 'update') { hideInstall(); downloadApk(); return; }
  if (!installPrompt) return;
  installPrompt.prompt();
  await installPrompt.userChoice.catch(() => {});
  installPrompt = null; hideInstall();
};
$('#btnInstallX').onclick = () => { LS.set(installMode === 'update' ? 'updateDismissed' : installMode === 'apk' ? 'apkDismissed' : 'installDismissed', Date.now()); hideInstall(); };
// צילום מסך לחלון ההתקנה (?shot): ריצה לדוגמה בראש העין, בלי שום שמירה
async function demoShot() {
  S = Object.assign({}, S, { auto: false }); // רק בזיכרון, לא נשמר
  await startRun({ quick: true });
  const wp = [[32.0928, 34.9528], [32.0949, 34.9541], [32.0966, 34.9552], [32.0978, 34.9576], [32.0969, 34.9603], [32.0952, 34.9611]];
  let ts = Date.now();
  for (let i = 0; i < wp.length - 1; i++) {
    const [a, b] = [wp[i], wp[i + 1]], n = Math.round(hav(a, b) / 3.1);
    for (let k = 1; k <= n; k++) {
      ts += 1000;
      onPosition({ coords: { latitude: a[0] + (b[0] - a[0]) * k / n, longitude: a[1] + (b[1] - a[1]) * k / n, accuracy: 4, heading: null, speed: 3.1 }, timestamp: ts });
    }
  }
  R.elapsed = R.dist / 3.05; R.curPace = 1000 / 3.1; R.lastMove = Date.now(); R.status = 'running';
  persistActive = () => {};
  setFollow(false);
  renderRun();
  setTimeout(() => { map.stop(); map.fitBounds(L.latLngBounds(wp), { padding: [50, 50], animate: false }); }, 1500);
}
function scheduleInstallHint() {
  $('#apkCard').hidden = NATIVE || !isAndroid;
  if (NATIVE && !RT) { setTimeout(() => showInstall('update'), 1500); return; } // גרסה ישנה של האפליקציה
  if (NATIVE || /[?&]shot\b/.test(location.search)) return;
  if (isAndroid) { setTimeout(() => showInstall('apk'), 1500); return; }
  if (isStandalone()) return;
  if (isIOS) setTimeout(() => showInstall('ios'), 1500);
  else setTimeout(() => { if (!installPrompt && /Android/.test(navigator.userAgent)) showInstall('manual'); }, 5000);
}

/* ---------------- יעד להיום ---------------- */
function bumpGoal(d) {
  const g = Math.max(0.5, Math.min(100, Math.round((LS.get('goalKm', 5) + d) * 2) / 2));
  LS.set('goalKm', g); renderGoal();
}
$('#goalMinus').onclick = () => bumpGoal(-0.5);
$('#goalPlus').onclick = () => bumpGoal(0.5);

/* ---------------- מצב כיס ---------------- */
// מסך שחור עם זמן ומרחק. האפליקציה נשארת פתוחה, ולכן ה־GPS ממשיך לעקוב. לחיצות בכיס לא עושות כלום.
let pocketHold = 0;
$('#btnPocket').onclick = () => { $('#pocket').hidden = false; renderRun(); requestWake(); };
function pocketRelease() { clearTimeout(pocketHold); $('#pkUnlock').classList.remove('holding'); }
$('#pkUnlock').addEventListener('pointerdown', (e) => {
  e.preventDefault();
  $('#pkUnlock').classList.add('holding');
  pocketHold = setTimeout(() => { pocketRelease(); $('#pocket').hidden = true; vibrate(60); }, 2000);
});
['pointerup', 'pointercancel', 'pointerleave'].forEach((ev) => $('#pkUnlock').addEventListener(ev, pocketRelease));
$('#pocket').addEventListener('contextmenu', (e) => e.preventDefault());

/* ---------------- המלצה ומתיחות אחרי ריצה ---------------- */
const STICK = 'stroke="currentColor" stroke-width="3.2" stroke-linecap="round" fill="none"';
const STRETCHES = {
  calf: {
    n: 'מתיחת שוק', d: '30 שניות לכל רגל',
    how: 'ידיים על קיר, רגל אחת אחורה וישרה, והעקב צמוד לרצפה.',
    svg: `<line x1="70" y1="6" x2="70" y2="78" stroke="var(--line)" stroke-width="3"/>
      <g class="anim" style="--a:7deg;transform-origin:20px 76px">
        <circle cx="54" cy="16" r="6" ${STICK}/><line x1="51" y1="22" x2="38" y2="46" ${STICK}/>
        <polyline points="48,28 60,34 69,30" ${STICK}/><polyline points="38,46 50,60 50,76" ${STICK}/>
        <line x1="38" y1="46" x2="20" y2="76" class="hl" ${STICK}/></g>`,
  },
  quad: {
    n: 'מתיחת ירך קדמית', d: '30 שניות לכל רגל',
    how: 'בעמידה, תחזיק את כף הרגל מאחור ותקרב אותה לישבן. אפשר להישען על קיר.',
    svg: `<circle cx="40" cy="12" r="6" ${STICK}/><line x1="40" y1="18" x2="40" y2="46" ${STICK}/>
      <line x1="40" y1="46" x2="40" y2="76" ${STICK}/><line x1="40" y1="26" x2="52" y2="40" ${STICK}/>
      <line x1="40" y1="46" x2="36" y2="62" class="hl" ${STICK}/>
      <g class="anim" style="--a:150deg;transform-origin:36px 62px"><line x1="36" y1="62" x2="36" y2="77" class="hl" ${STICK}/></g>`,
  },
  ham: {
    n: 'מתיחת ירך אחורית', d: '30 שניות לכל רגל',
    how: 'עקב על מדרגה נמוכה, רגל ישרה, ותתכופף לאט קדימה מהמותניים.',
    svg: `<rect x="56" y="62" width="20" height="14" rx="2" fill="none" stroke="var(--line)" stroke-width="3"/>
      <line x1="32" y1="46" x2="32" y2="76" ${STICK}/><line x1="32" y1="46" x2="62" y2="62" class="hl" ${STICK}/>
      <g class="anim" style="--a:42deg;transform-origin:32px 46px">
        <line x1="32" y1="46" x2="32" y2="20" ${STICK}/><circle cx="32" cy="13" r="6" ${STICK}/>
        <line x1="32" y1="26" x2="44" y2="38" ${STICK}/></g>`,
  },
};
function renderTip(r) {
  const km = r.dist / 1000, pace = r.time / km, min = r.time / 60;
  const parts = [];
  const prev = runs.filter((x) => x.id !== r.id && x.dist >= 1000 && x.time > 0).slice(0, 5);
  if (prev.length >= 2 && km >= 1) {
    const avg = prev.reduce((a, x) => a + x.time / (x.dist / 1000), 0) / prev.length;
    const d = avg - pace;
    if (d > 15) parts.push(`רצת מהר מהממוצע שלך ב־${Math.round(d)} שנ׳ לק״מ, אז כדאי שהריצה הבאה תהיה קלה ואיטית.`);
    else if (d < -30) parts.push('הקצב היום היה רגוע מהרגיל, וזה מצוין לבניית סיבולת.');
  }
  if (km < 2) parts.push('אחרי ריצה קצרה מספיקות 2–3 דקות הליכה ושתייה.');
  else if (km >= 8 || min >= 50) parts.push('ריצה ארוכה: תשתה מים, תאכל בשעה הקרובה משהו עם חלבון ופחמימות, ומחר יום מנוחה או ריצה קלה.');
  else parts.push('תסיים ב־3–5 דקות הליכה רגועה כדי להוריד את הדופק, ותשתה מים.');
  $('#tipTxt').textContent = parts.join(' ');
  const pick = km < 2 ? ['calf'] : km <= 6 ? ['calf', 'quad'] : ['calf', 'ham'];
  $('#stretches').innerHTML = pick.map((k) => {
    const s = STRETCHES[k];
    return `<div class="stretch"><svg viewBox="0 0 80 80" aria-hidden="true">${s.svg}</svg>
      <div><b>${s.n}</b><span class="st-d">${s.d}</span><span class="st-how">${s.how}</span></div></div>`;
  }).join('');
}

/* ---------------- שחזור מהיר של המסלול ---------------- */
const PLAY_ICON = 'M8 5v14l11-7z', STOP_ICON = 'M6 6h12v12H6z';
// שני נגנים: אחד בסיכום ריצה ואחד במסך מסלול שמור
const REPLAYS = {
  detail: { raf: 0, end: 0, on: false, btn: '#btnReplay', txt: '#replayTxt', icon: '#replayIcon', chip: '#replayChip',
    map: () => dMap, layer: () => dLayer, redraw: () => { const r = runs.find((x) => x.id === detailId); if (r) drawRunOnMap(dMap, dLayer, r); } },
  route: { raf: 0, end: 0, on: false, btn: '#rReplay', txt: '#rReplayTxt', icon: '#rReplayIcon', chip: '#rReplayChip',
    map: () => rMap, layer: () => rLayer, redraw: () => drawRouteMap() },
};
function stopReplay(redraw = true, which = 'detail') {
  const P = REPLAYS[which];
  cancelAnimationFrame(P.raf); clearTimeout(P.end);
  const was = P.on;
  P.on = false;
  $(P.txt).textContent = 'שחזור מהיר';
  $(P.icon).setAttribute('d', PLAY_ICON);
  $(P.chip).hidden = true;
  if (was && redraw) P.redraw();
}
// צבע לכל נקודה לפי הקצב ביחס לממוצע הריצה: ירוק מהיר, כתום בקצב, אדום איטי
function paceColors(r) {
  const pts = r.points, avg = r.time / (r.dist / 1000), out = [css('--accent')];
  for (let i = 1; i < pts.length; i++) {
    let j = i; while (j > 0 && pts[i][3] - pts[j][3] < 100) j--;
    const pace = pts[i][3] > pts[j][3] ? ((pts[i][2] - pts[j][2]) / (pts[i][3] - pts[j][3])) * 1000 : avg;
    out.push(pace <= avg - 10 ? css('--good') : pace <= avg + 10 ? css('--accent') : css('--bad'));
  }
  return out;
}
// pts: [lat, lng, שניות?, מטרים?]. cols: צבע לכל נקודה. הקו נבנה מההתחלה עד הסוף ב־5 עד 10 שניות.
function playReplay(which, pts, cols) {
  const P = REPLAYS[which];
  if (P.on) { stopReplay(true, which); return; }
  if (!pts || pts.length < 2) { toast('אין מספיק נקודות כדי לשחזר את המסלול'); return; }
  const map = P.map(), layer = P.layer();
  const n = pts.length, ll = pts.map((p) => [p[0], p[1]]);
  const hasTime = pts[0].length >= 4;
  let cum = [0];
  if (!hasTime) for (let i = 1; i < n; i++) cum.push(cum[i - 1] + hav(ll[i - 1], ll[i]));
  layer.clearLayers();
  L.polyline(ll, { color: css('--fg'), weight: 4, opacity: 0.18, dashArray: '2 8' }).addTo(layer);
  const casing = L.polyline([ll[0]], { color: '#fff', weight: 10, opacity: 0.9, lineCap: 'round', lineJoin: 'round' }).addTo(layer);
  const segGroup = L.layerGroup().addTo(layer);
  L.marker(ll[0], { interactive: false, icon: L.divIcon({ className: '', iconSize: [14, 14], iconAnchor: [7, 7], html: '<div class="pin s"></div>' }) }).addTo(layer);
  const dot = L.circleMarker(ll[0], { radius: 8, color: '#fff', weight: 3, fillColor: '#2f8cff', fillOpacity: 1 }).addTo(layer);
  map.invalidateSize();
  map.fitBounds(L.latLngBounds(ll), { padding: [28, 28], animate: false });
  P.on = true;
  $(P.txt).textContent = 'עצור';
  $(P.icon).setAttribute('d', STOP_ICON);
  $(P.chip).hidden = false;
  const dur = Math.max(5000, Math.min(10000, n * 25));
  const t0 = performance.now();
  let drawn = 0, seg = null, segColor = null;
  const addTo = (i) => { // מוסיף נקודה לקו, ומתחיל קטע חדש כשהצבע משתנה
    if (cols[i] !== segColor) {
      const from = seg ? seg.getLatLngs()[seg.getLatLngs().length - 1] : L.latLng(ll[i - 1] || ll[i]);
      seg = L.polyline([from], { color: cols[i], weight: 6, lineCap: 'round', lineJoin: 'round' }).addTo(segGroup);
      segColor = cols[i];
    }
    seg.addLatLng(ll[i]);
  };
  const frame = (now) => {
    if (!P.on) return;
    const f = Math.max(0, Math.min(1, (now - t0) / dur)); // הפריים הראשון יכול להגיע עם זמן קצת לפני t0
    const pos = f * (n - 1), i = Math.min(Math.floor(pos), n - 1), k = pos - i;
    if (seg && seg._head) { const a = seg.getLatLngs(); a.pop(); seg.setLatLngs(a); seg._head = false; }
    const ca = casing.getLatLngs(); if (casing._head) { ca.pop(); casing._head = false; }
    while (drawn < i) { drawn++; addTo(drawn); ca.push(L.latLng(ll[drawn])); }
    const a = pts[i], b = pts[Math.min(i + 1, n - 1)];
    const head = L.latLng(a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k);
    if (seg) { seg.addLatLng(head); seg._head = true; }
    ca.push(head); casing._head = true; casing.setLatLngs(ca);
    dot.setLatLng(head);
    const j = Math.min(i + 1, n - 1);
    $(P.chip).textContent = hasTime
      ? `${fmtKm(a[3] + (b[3] - a[3]) * k)} ק״מ · ${fmtDur(a[2] + (b[2] - a[2]) * k)}`
      : `${fmtKm(cum[i] + (cum[j] - cum[i]) * k)} ק״מ`;
    if (f < 1) P.raf = requestAnimationFrame(frame);
    else P.end = setTimeout(() => stopReplay(true, which), 1800);
  };
  P.raf = requestAnimationFrame(frame);
}
$('#btnReplay').onclick = () => {
  if (REPLAYS.detail.on) { stopReplay(true, 'detail'); return; }
  const r = runs.find((x) => x.id === detailId);
  if (!r) return;
  playReplay('detail', r.points, paceColors(r));
};
// במסך מסלול שמור: משחזרים את הריצה האחרונה במסלול, ואם אין, את הדרך עצמה
$('#rReplay').onclick = () => {
  if (REPLAYS.route.on) { stopReplay(true, 'route'); return; }
  const rt = routes.find((x) => x.id === routeId); if (!rt) return;
  const last = routeRuns(routeId).filter((r) => r.points && r.points.length > 3).sort((a, b) => b.start - a.start)[0];
  if (last) playReplay('route', last.points, paceColors(last));
  else playReplay('route', rt.points, rt.points.map(() => css('--plum')));
};

/* ---------------- שיתוף סיכום הריצה ---------------- */
function rrect(g, x, y, w, h, r) { g.beginPath(); if (g.roundRect) g.roundRect(x, y, w, h, r); else g.rect(x, y, w, h); g.fill(); }
async function runImage(r) {
  const W = 1080, H = 1350, c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  try { await Promise.all([document.fonts.load('700 80px "Barlow Condensed"'), document.fonts.load('500 40px Rubik'), document.fonts.load('700 40px Rubik')]); } catch (e) { /* */ }
  const UI = 'Rubik, "Segoe UI", sans-serif', NUM = '"Barlow Condensed", Rubik, sans-serif';
  g.fillStyle = '#0e1622'; g.fillRect(0, 0, W, H);
  g.direction = 'rtl'; g.textAlign = 'right';
  g.fillStyle = '#ff7a45'; g.font = `700 44px ${UI}`; g.fillText('על הדרך', W - 70, 100);
  g.fillStyle = '#eef3f9'; g.font = `700 60px ${UI}`; g.fillText(runTitle(r.start), W - 70, 180);
  g.fillStyle = '#8ea1b8'; g.font = `400 36px ${UI}`; g.fillText(`${heDay.format(r.start)} · ${heTime.format(r.start)}`, W - 70, 232);
  // המסלול
  const bx = 70, by = 280, bw = W - 140, bh = 620;
  g.fillStyle = '#162131'; rrect(g, bx, by, bw, bh, 36);
  const pts = r.points || [];
  if (pts.length > 1) {
    const cos = Math.cos(pts[0][0] * Math.PI / 180);
    const xs = pts.map((p) => p[1] * cos), ys = pts.map((p) => -p[0]);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    const pd = 70, sc = Math.min((bw - pd * 2) / (maxX - minX || 1e-9), (bh - pd * 2) / (maxY - minY || 1e-9));
    const ox = bx + (bw - (maxX - minX) * sc) / 2, oy = by + (bh - (maxY - minY) * sc) / 2;
    const P = (i) => [ox + (xs[i] - minX) * sc, oy + (ys[i] - minY) * sc];
    g.lineCap = 'round'; g.lineJoin = 'round';
    [['#ffffff', 22], ['#ff7a45', 12]].forEach(([col, w]) => {
      g.strokeStyle = col; g.lineWidth = w; g.beginPath();
      pts.forEach((_, i) => { const [x, y] = P(i); if (i) g.lineTo(x, y); else g.moveTo(x, y); });
      g.stroke();
    });
    [[0, '#3ccf8e'], [pts.length - 1, '#ff5468']].forEach(([i, col]) => {
      const [x, y] = P(i);
      g.fillStyle = '#fff'; g.beginPath(); g.arc(x, y, 20, 0, 7); g.fill();
      g.fillStyle = col; g.beginPath(); g.arc(x, y, 13, 0, 7); g.fill();
    });
  }
  // נתונים
  const pace = r.time / (r.dist / 1000);
  const cells = [['מרחק', fmtKm(r.dist), 'ק״מ'], ['זמן', fmtDur(r.time), 'בתנועה'], ['קצב ממוצע', fmtPace(pace), 'לק״מ'], ['מהירות', kmh(pace) || '--', 'קמ״ש']];
  const cw = (W - 140 - 30) / 2;
  cells.forEach(([lbl, val, unit], i) => {
    const x = W - 70 - (i % 2) * (cw + 30), y = 950 + Math.floor(i / 2) * 175;
    g.fillStyle = '#162131'; rrect(g, x - cw, y, cw, 150, 28);
    g.direction = 'rtl'; g.textAlign = 'right'; g.fillStyle = '#8ea1b8'; g.font = `400 32px ${UI}`;
    g.fillText(lbl, x - 30, y + 50); g.fillText(unit, x - 30, y + 122);
    g.direction = 'ltr'; g.textAlign = 'left'; g.fillStyle = '#eef3f9'; g.font = `700 96px ${NUM}`;
    g.fillText(val, x - cw + 30, y + 120);
  });
  g.direction = 'ltr'; g.textAlign = 'center'; g.fillStyle = '#8ea1b8'; g.font = `400 30px ${UI}`;
  g.fillText('amitbusi10-pixel.github.io/run', W / 2, H - 40);
  return new Promise((res) => c.toBlob(res, 'image/png'));
}
$('#btnShareRun').onclick = async () => {
  const r = runs.find((x) => x.id === detailId); if (!r) return;
  const text = `${runTitle(r.start)}: ${fmtKm(r.dist)} ק״מ ב־${fmtDur(r.time)}, קצב ${fmtPace(r.time / (r.dist / 1000))} לק״מ.\nרצתי עם „על הדרך“: ${SHARE_URL}`;
  try {
    const blob = await runImage(r);
    if (NATIVE && SH) { await nativeShare({ title: 'הריצה שלי', text, blob, name: 'run.png' }); return; }
    const file = new File([blob], 'ריצה.png', { type: 'image/png' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], text }); return; }
    if (navigator.share) { await navigator.share({ text }); return; }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = 'ריצה.png'; document.body.appendChild(a); a.click(); a.remove();
    toast('התמונה נשמרה בהורדות');
  } catch (e) { if (e && e.name !== 'AbortError' && !/cancel/i.test(e.message || '')) toast('השיתוף לא הצליח. אפשר להשתמש ב„העתק סיכום“ בתחתית המסך'); }
};

/* ---------------- חשבון וסנכרון בענן (Firebase) ---------------- */
// כל משתמש שומר רק אצלו: users/{uid}/runs, users/{uid}/routes, והגדרות במסמך users/{uid}.
// כלל האבטחה ב־Firestore מאפשר לכל משתמש לקרוא ולכתוב רק את המסמכים שלו.
const FB_CONFIG = {
  apiKey: 'AIzaSyDKRbZhj1faVEmFTStDkaVGzSCWSnI5BhM',
  authDomain: 'al-haderech-f33d8.firebaseapp.com',
  projectId: 'al-haderech-f33d8',
  storageBucket: 'al-haderech-f33d8.firebasestorage.app',
  messagingSenderId: '338596621840',
  appId: '1:338596621840:web:f1096c562ccad347d56495',
};
const GOOGLE_WEB_CLIENT_ID = '338596621840-cme577vn4bgehpsqe26gikrr6ng0ebj3.apps.googleusercontent.com';
const FB_V = '13.3.0';
const GA = plug('GoogleAuth'); // כניסה עם Google בתוך אפליקציית האנדרואיד
const cloud = { ready: false, user: null, fb: null, db: null, auth: null, syncing: false, lastSync: 0, error: '' };

async function cloudInit() {
  if (cloud.fb) return cloud.fb;
  const base = `https://www.gstatic.com/firebasejs/${FB_V}/`;
  const [appM, authM, fsM] = await Promise.all([import(base + 'firebase-app.js'), import(base + 'firebase-auth.js'), import(base + 'firebase-firestore.js')]);
  const app = appM.initializeApp(FB_CONFIG);
  cloud.auth = authM.getAuth(app);
  try { cloud.db = fsM.initializeFirestore(app, { localCache: fsM.persistentLocalCache() }); } catch (e) { cloud.db = fsM.getFirestore(app); }
  cloud.fb = { authM, fsM };
  authM.onAuthStateChanged(cloud.auth, (u) => {
    cloud.user = u; cloud.ready = true;
    LS.set('cloudUser', !!u); LS.del('cloudPending');
    renderAccount();
    if (u) cloudSync();
  });
  return cloud.fb;
}
const userRef = (...p) => cloud.fb.fsM.doc(cloud.db, 'users', cloud.user.uid, ...p);
const userCol = (name) => cloud.fb.fsM.collection(cloud.db, 'users', cloud.user.uid, name);
// Firestore לא שומר מערך בתוך מערך, אז את הנקודות שומרים כטקסט
const toDoc = (o) => { const d = Object.assign({}, o, { pointsJson: JSON.stringify(o.points || []), updated: Date.now() }); delete d.points; return d; };
const fromDoc = (d) => { const o = Object.assign({}, d); try { o.points = JSON.parse(d.pointsJson || '[]'); } catch (e) { o.points = []; } delete o.pointsJson; delete o.updated; return o; };

async function cloudSignIn() {
  try {
    const { authM } = await cloudInit();
    if (GA) {
      const r = await GA.signIn({ clientId: GOOGLE_WEB_CLIENT_ID });
      await authM.signInWithCredential(cloud.auth, authM.GoogleAuthProvider.credential(r.idToken));
    } else {
      const provider = new authM.GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      try { await authM.signInWithPopup(cloud.auth, provider); }
      catch (e) {
        if (e && /popup-blocked/.test(e.code || '')) { toast('הדפדפן חסם את חלון הכניסה של Google. כדאי לאשר חלונות קופצים לאתר ולנסות שוב', 6000); return; }
        throw e;
      }
    }
    LS.set('authAsked', true);
  } catch (e) {
    const code = (e && (e.code || e.message)) || '';
    if (!/cancel|closed-by-user|popup-closed|16:|canceled/i.test(code)) toast('הכניסה לא הצליחה. כדאי לבדוק את החיבור לאינטרנט ולנסות שוב');
  }
}
async function cloudSignOut() {
  try {
    const { authM } = await cloudInit();
    await authM.signOut(cloud.auth);
    if (GA) GA.signOut().catch(() => {});
    toast('יצאת מהחשבון. הריצות נשארו גם בטלפון');
  } catch (e) { /* */ }
}

// סנכרון מלא: מה שיש רק בענן יורד לטלפון, ומה שיש רק בטלפון עולה לענן. מחיקה מסומנת, כדי שלא תחזור.
async function cloudSync() {
  if (!cloud.user || cloud.syncing) return;
  cloud.syncing = true; cloud.error = ''; renderAccount();
  const { fsM } = cloud.fb;
  try {
    for (const kind of ['runs', 'routes']) {
      const snap = await fsM.getDocs(userCol(kind));
      const remote = new Map();
      snap.forEach((d) => remote.set(d.id, d.data()));
      const local = kind === 'runs' ? runs : routes;
      for (const [id, d] of remote) {
        const have = local.find((x) => x.id === id);
        if (d.deleted) { if (have) { if (kind === 'runs') await deleteRun(id, true); else await deleteRoute(id, true); } continue; }
        if (!have) { const o = fromDoc(d); if (kind === 'runs') await saveRun(o, true); else await saveRoute(o, true); }
      }
      for (const o of local.slice()) if (!remote.has(o.id)) await fsM.setDoc(fsM.doc(userCol(kind), o.id), toDoc(o));
    }
    // הגדרות, תוכנית ויעד: הגרסה החדשה יותר מנצחת
    const meta = await fsM.getDoc(userRef());
    const m = meta.exists() ? meta.data() : null;
    if (m && (m.updated || 0) > LS.get('metaUpdated', 0)) {
      if (m.settings) { S = Object.assign({}, DEFAULTS, m.settings); localStorage.setItem('settings', JSON.stringify(S)); fillSettings(); }
      if ('plan' in m) { plan = m.plan || null; localStorage.setItem('plan', JSON.stringify(plan)); }
      if (m.goalKm) localStorage.setItem('goalKm', JSON.stringify(m.goalKm));
      localStorage.setItem('metaUpdated', JSON.stringify(m.updated));
    } else await cloudPushMeta();
    cloud.lastSync = Date.now();
    renderRun(); if (currentView === 'history') renderHistory(); if (currentView === 'routes') renderRoutes(); if (currentView === 'plan') renderPlan();
  } catch (e) {
    cloud.error = 'הסנכרון לא הושלם. ננסה שוב בפתיחה הבאה';
  }
  cloud.syncing = false; renderAccount();
}
async function cloudPushMeta() {
  if (!cloud.user) return;
  const updated = Date.now();
  localStorage.setItem('metaUpdated', JSON.stringify(updated));
  try { await cloud.fb.fsM.setDoc(userRef(), { settings: S, plan: plan || null, goalKm: LS.get('goalKm', 5), updated }); } catch (e) { /* ייכתב כשיחזור החיבור */ }
}
let metaTimer = 0;
window.__cloudMeta = () => { if (!cloud.user) return; clearTimeout(metaTimer); metaTimer = setTimeout(cloudPushMeta, 1500); };
function cloudPut(kind, o) {
  if (!cloud.user) return;
  const { fsM } = cloud.fb;
  fsM.setDoc(fsM.doc(userCol(kind), o.id), toDoc(o)).catch(() => {});
}
function cloudDel(kind, id) {
  if (!cloud.user) return;
  const { fsM } = cloud.fb;
  fsM.setDoc(fsM.doc(userCol(kind), id), { deleted: true, updated: Date.now() }).catch(() => {});
}

// כרטיס החשבון במסך ההגדרות
function renderAccount() {
  const out = $('#accOut'), inn = $('#accIn');
  if (!out) return;
  const u = cloud.user;
  out.hidden = !!u; inn.hidden = !u;
  if (!u) return;
  $('#accName').textContent = u.displayName || 'החשבון שלי';
  $('#accEmail').textContent = u.email || '';
  const av = $('#accAvatar');
  if (u.photoURL) { av.style.backgroundImage = `url("${u.photoURL}")`; av.textContent = ''; }
  else { av.style.backgroundImage = ''; av.textContent = (u.displayName || u.email || '?').trim().charAt(0); }
  const st = $('#accStatus');
  st.classList.toggle('bad', !!cloud.error);
  st.textContent = cloud.error || (cloud.syncing ? 'מסנכרן…' : `מסונכרן · ${runs.length} ריצות, ${routes.length} מסלולים`);
}
$('#btnSignIn').onclick = cloudSignIn;
$('#btnSignOut').onclick = cloudSignOut;
$('#authYes').onclick = () => { $('#authSheet').hidden = true; cloudSignIn(); };
$('#authNo').onclick = () => { $('#authSheet').hidden = true; LS.set('authAsked', true); };
// בפתיחה הראשונה: הצעה להיכנס, פעם אחת בלבד
function scheduleAuthPrompt() {
  if (LS.get('authAsked', false) || /[?&]shot\b/.test(location.search)) return;
  setTimeout(() => {
    if (cloud.user || R.status !== 'idle' || runStarting || LS.get('authAsked', false)) return;
    if (!$('#installBar').hidden) { setTimeout(scheduleAuthPrompt, 15000); return; }
    $('#authSheet').hidden = false;
    console.info('AL-HADERECH auth sheet shown');
  }, 4000);
}
// מתחברים לענן רק אם כבר נכנסו בעבר, כדי לא להאט את הפתיחה של מי שלא משתמש בזה
function startCloud() {
  if (LS.get('cloudUser', false) || LS.get('cloudPending', false)) cloudInit().catch(() => {});
}

/* ---------------- חיבור כפתורים ---------------- */
$('#btnStart').onclick = startRun;
$('#btnPause').onclick = pauseRun;
$('#btnResume').onclick = resumeRun;
$('#btnStop').onclick = stopRun;
$('#btnFollow').onclick = () => setFollow(!follow);
// מפה במסך מלא: מסתיר את לוח הנתונים והתפריט, ומשאיר תיבה קטנה עם זמן ומרחק
function setFullMap(on) {
  document.body.classList.toggle('fullmap', on);
  $('#btnFull').title = on ? 'חזרה לתצוגה הרגילה' : 'מפה במסך מלא';
  $('#btnFull').setAttribute('aria-label', $('#btnFull').title);
  $('#fullIcon').setAttribute('d', on
    ? 'M9 4v5H4V7h3V4zm6 0h2v3h3v2h-5zM4 15h5v5H7v-3H4zm11 0h5v2h-3v3h-2z'
    : 'M4 9V4h5v2H6v3zm11-5h5v5h-2V6h-3zM6 15v3h3v2H4v-5zm12 0h2v5h-5v-2h3z');
  LS.set('fullmap', on);
  setTimeout(() => { map.invalidateSize(); if (follow && lastPos) map.panTo(lastPos, { animate: false }); }, 60);
}
$('#btnFull').onclick = () => setFullMap(!document.body.classList.contains('fullmap'));
$('#mini').onclick = () => setFullMap(false);
$('#btnLayer').onclick = () => {
  const order = ['voyager', 'dark', 'sat'];
  const next = order[(order.indexOf(currentLayerKey) + 1) % order.length];
  switchLayer(next);
  toast(LAYER_NAMES[next], 1500);
};
$('#btnClearContext').onclick = () => { R.context = null; showGhostRoute(null); setFollow(true); renderContext(); renderControls(); renderRun(); };
document.querySelectorAll('#tabs button').forEach((b) => { b.onclick = () => show(b.dataset.v); });

/* ---------------- הפעלה ---------------- */
(async function init() {
  initMap();
  await loadData();
  window.addEventListener('devicemotion', onMotion);
  startGps();
  restoreActive();
  if (LS.get('fullmap', false)) setFullMap(true);
  renderControls(); renderContext(); renderRun();
  tickTimer = setInterval(tick, 250);
  scheduleInstallHint();
  startCloud(); renderAccount(); scheduleAuthPrompt();
  if (/[?&]shot\b/.test(location.search)) { setTimeout(demoShot, 800); return; }
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();

// לבדיקות בלבד: הדמיית קריאת GPS
window.__simGps = (lat, lon, acc = 5) => onPosition({ coords: { latitude: lat, longitude: lon, accuracy: acc, heading: null, speed: null }, timestamp: Date.now() });
