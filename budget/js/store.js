// Saving in this browser only (localStorage), automatic snapshots, and backup files. Nothing is sent anywhere.
(function (root) {
  'use strict';
  const KEY = 'budget4all.data', SNAP = 'budget4all.snap.', META = 'budget4all.meta', SNAPS = 14;

  const meta = () => { try { return JSON.parse(localStorage.getItem(META) || '{}'); } catch (_) { return {}; } };
  const setMeta = o => { try { localStorage.setItem(META, JSON.stringify(Object.assign(meta(), o))); } catch (_) { /* ignore */ } };

  function load() {
    let txt = null;
    try { txt = localStorage.getItem(KEY); } catch (e) { return { error: 'הדפדפן חוסם שמירה (אולי חלון גלישה בסתר).' }; }
    if (!txt) return { data: null };
    try { return { data: JSON.parse(txt) }; }
    catch (e) {
      // damaged: keep it aside and come back from the newest snapshot
      try { localStorage.setItem(KEY + '.damaged', txt); } catch (_) { /* ignore */ }
      const s = snapshots()[0];
      return { data: s ? s.data : null, message: 'הנתונים השמורים נפגמו, ולכן נטען העותק האוטומטי האחרון' + (s ? ' (' + new Date(s.time).toLocaleString('he-IL') + ')' : '') + '.' };
    }
  }
  function save(S) {
    try {
      localStorage.setItem(KEY, JSON.stringify(S));
      setMeta({ saved: Date.now() });
      snapshotDaily(S);
      return { ok: true };
    } catch (e) { return { ok: false, error: e.name === 'QuotaExceededError' ? 'אין מקום בדפדפן. שמור גיבוי לקובץ.' : e.message }; }
  }
  // one automatic snapshot per day, the last SNAPS days are kept
  function snapshotDaily(S) {
    const day = new Date().toISOString().slice(0, 10);
    if (meta().snapDay === day) return;
    try {
      localStorage.setItem(SNAP + day, JSON.stringify({ time: Date.now(), data: S }));
      setMeta({ snapDay: day });
      const keys = Object.keys(localStorage).filter(k => k.startsWith(SNAP)).sort();
      keys.slice(0, Math.max(0, keys.length - SNAPS)).forEach(k => localStorage.removeItem(k));
    } catch (_) { /* a missing snapshot is not fatal */ }
  }
  function snapshots() {
    try {
      return Object.keys(localStorage).filter(k => k.startsWith(SNAP)).sort().reverse()
        .map(k => { try { return JSON.parse(localStorage.getItem(k)); } catch (_) { return null; } }).filter(Boolean);
    } catch (_) { return []; }
  }
  function clearAll() {
    try { Object.keys(localStorage).filter(k => k.startsWith('budget4all.')).forEach(k => localStorage.removeItem(k)); } catch (_) { /* ignore */ }
  }
  // Ask the browser not to clear our data when space runs low.
  function persist() { try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (_) { /* ignore */ } }

  function backupName() {
    const d = new Date(), p = n => String(n).padStart(2, '0');
    return `תקציב-גיבוי-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}.json`;
  }
  // Save a backup file: share sheet on phones (WhatsApp, Drive…), download elsewhere.
  async function exportFile(S) {
    const name = backupName(), txt = JSON.stringify(S, null, 1);
    const blob = new Blob([txt], { type: 'application/json' });
    try {
      const file = new File([blob], name, { type: 'application/json' });
      if (navigator.canShare && navigator.canShare({ files: [file] }) && /Android|iPhone|iPad/i.test(navigator.userAgent)) {
        await navigator.share({ files: [file], title: name });
        setMeta({ backup: Date.now() });
        return { ok: true, shared: true, name };
      }
    } catch (e) { if (e && e.name === 'AbortError') return { canceled: true }; }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    setMeta({ backup: Date.now() });
    return { ok: true, name };
  }
  function readFile(file) {
    return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsText(file); });
  }
  root.BudgetStore = { load, save, snapshots, clearAll, persist, exportFile, readFile, meta, setMeta };
})(window);
