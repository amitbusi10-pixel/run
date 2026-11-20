// The budget app: month screens, year summary, settings (sections, categories, backups). No network.
'use strict';
(function () {
  const C = window.BudgetCalc, Store = window.BudgetStore;
  const { num, r2, TYPES } = C;
  const MN = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];
  const UNDO_LIMIT = 200;
  // desktop column widths per section type (on phones every row wraps into two columns)
  const COLW = { income: '1.6fr 1fr .8fr 110px', expense: '1.5fr 1fr .8fr 1.1fr 1.2fr', loan: '1.5fr 1fr 1fr .9fr 1.1fr',
    deposit: '1.5fr 1fr .8fr 1.4fr', bank: '2fr 1fr', saving: '1.5fr 1fr 1fr .8fr', asset: '2fr 1fr 90px', future: '1.5fr 1fr 1fr 110px' };
  const KEEP = [['all', 'נשארות כולל הסכומים'], ['names', 'נשארות, הסכומים מתאפסים'], ['none', 'נמחקות']];

  const $ = s => document.querySelector(s);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const fmt = n => { const x = r2(n); return (x === 0 ? 0 : x).toLocaleString('he-IL', { maximumFractionDigits: 2 }); };
  const I = s => '⁦' + s + '⁩'; // keeps "-1,234" in order inside right-to-left text
  // summaries show whole shekels above 100; the input fields keep the exact agorot
  const money = n => I(Math.abs(n) >= 100 ? Math.round(n).toLocaleString('he-IL') : fmt(n)) + ' ₪';
  const usd = n => I((n < 0 ? '-$' : '$') + fmt(Math.abs(n)));
  const pct = v => I((Math.round(v * 10) / 10).toLocaleString('he-IL') + '%');
  const kpi = (l, v, cls = '', sub = '') => `<div class="kpi ${cls}"><small>${l}</small><b>${v}</b>${sub ? `<small class="sub">${sub}</small>` : ''}</div>`;
  const curWrap = (sign, inp) => `<span class="cur" data-cur="${sign}">${inp}</span>`;

  let S = null;
  const ui = { year: new Date().getFullYear(), tab: 'summary', open: {} };
  let notice = null, saveT = null, lastEdit = 0;
  const UNDO = [], REDO = [];

  /* ---------- dialogs ---------- */
  let dlgResolve = null;
  function ask(msg, opts = {}) {
    if (dlgResolve) dlgResolve(false);
    const m = $('#modal'), d = m.querySelector('.dlg');
    $('#dlgMsg').textContent = msg;
    $('#dlgBody').innerHTML = opts.html || '';
    $('#dlgOk').textContent = opts.ok || 'אישור';
    $('#dlgCancel').textContent = opts.cancel || 'ביטול';
    d.classList.toggle('alert', !!opts.alert);
    m.hidden = false;
    setTimeout(() => { const f = $('#dlgBody input,#dlgBody select'); (f || $('#dlgOk')).focus(); }, 0);
    return new Promise(res => { dlgResolve = res; });
  }
  const tell = msg => ask(msg, { alert: true, ok: 'סגור' });
  function closeDlg(v) {
    const r = dlgResolve; dlgResolve = null;
    // collect any fields of the dialog body before it closes
    const vals = {}; document.querySelectorAll('#dlgBody [name]').forEach(e => { vals[e.name] = e.type === 'checkbox' ? e.checked : e.value; });
    $('#modal').hidden = true;
    if (r) r(v ? (Object.keys(vals).length ? vals : true) : false);
  }
  $('#dlgOk').addEventListener('click', () => closeDlg(true));
  $('#dlgCancel').addEventListener('click', () => closeDlg(false));

  /* ---------- data helpers ---------- */
  const Y = () => S.years[ui.year];
  const curM = () => Y() && typeof ui.tab === 'number' ? Y().months[ui.tab] : null;
  const sec = id => S.sections.find(s => s.id === id);
  const catName = id => { const c = S.categories.find(x => x.id === id); return c ? c.name : 'ללא קטגוריה'; };
  const recompute = () => C.recompute(S);
  const calc = m => C.calc(m, S);
  const hasType = t => C.active(S).some(s => s.type === t);
  const usesUsd = () => C.active(S).some(s => s.type === 'asset');

  /* ---------- undo / redo ---------- */
  function pushUndo(force) {
    const now = Date.now();
    if (force || now - lastEdit > 1500) { UNDO.push(JSON.stringify(S)); if (UNDO.length > UNDO_LIMIT) UNDO.shift(); REDO.length = 0; }
    lastEdit = now; btns();
  }
  function restore(js) { S = JSON.parse(js); lastEdit = 0; ensureUi(); render(); queueSave(true); }
  function undo() { if (!UNDO.length) return; REDO.push(JSON.stringify(S)); restore(UNDO.pop()); }
  function redo() { if (!REDO.length) return; UNDO.push(JSON.stringify(S)); restore(REDO.pop()); }
  function btns() { $('#undo').disabled = !UNDO.length; $('#redo').disabled = !REDO.length; }

  /* ---------- saving (this device only) ---------- */
  let statusT = null;
  function setStatus(t, err) {
    const s = $('#status'); s.textContent = t; s.className = err ? 'err' : '';
    clearTimeout(statusT); if (!err) statusT = setTimeout(() => { s.textContent = ''; }, 2500);
  }
  function queueSave(now) { if (!S) return; clearTimeout(saveT); saveT = setTimeout(doSave, now ? 0 : 400); }
  function doSave() {
    saveT = null;
    const r = Store.save(S);
    if (r.ok) setStatus('נשמר במכשיר ✓'); else setStatus('⚠ השמירה נכשלה: ' + r.error, true);
  }
  function flushSave() { if (saveT) { clearTimeout(saveT); doSave(); } }
  window.addEventListener('beforeunload', flushSave);
  document.addEventListener('visibilitychange', () => { if (document.hidden) flushSave(); });

  function ensureUi() {
    const ys = Object.keys(S.years).map(Number).sort((a, b) => a - b);
    if (!ys.length) { S.years[ui.year] = { months: {} }; return; }
    if (!S.years[ui.year]) ui.year = ys[ys.length - 1];
    if (typeof ui.tab === 'number' && (ui.tab < 1 || ui.tab > 12)) ui.tab = 'summary';
  }
  function lastMonth() {
    const ks = Object.keys(Y().months || {}).map(Number).sort((a, b) => a - b);
    return ks.length ? ks[ks.length - 1] : null;
  }

  /* ---------- start ---------- */
  function start(data, opts = {}) {
    S = data;
    if (!S.settings) S.settings = { includeFuture: false };
    ['mappings', 'rules', 'updates', 'categories'].forEach(k => { if (!Array.isArray(S[k])) S[k] = []; });
    recompute();
    if (opts.year) ui.year = opts.year;
    ensureUi();
    const lm = lastMonth();
    ui.tab = opts.tab != null ? opts.tab : lm != null ? lm : 'summary';
    $('#hdr').hidden = false; $('#nav').hidden = false;
    render();
    queueSave(true);
    Store.persist();
  }
  function init() {
    if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
    const r = Store.load();
    if (r.error) { $('#main').innerHTML = `<section class="box"><h3>אי אפשר לשמור נתונים</h3><p>${esc(r.error)}</p></section>`; return; }
    if (r.message) notice = r.message;
    if (r.data && C.isValid(r.data)) { start(r.data); if (r.message) tell(r.message); return; }
    window.Wizard.show();
  }

  /* ---------- rendering: month ---------- */
  function field(sid, i, f, row, type) {
    const [key, lab, kind, extra] = f;
    const k = `${sid}|${i}|${key}`, v = row[key];
    let inp, cls = 'f';
    if (kind === 'sel') inp = `<select data-k="${k}">${extra.map(o => `<option value="${o[0]}"${v === o[0] ? ' selected' : ''}>${o[1]}</option>`).join('')}</select>`;
    else if (kind === 'cat') inp = `<select data-k="${k}"><option value="">ללא קטגוריה</option>${S.categories.map(c => `<option value="${c.id}"${v === c.id ? ' selected' : ''}>${esc(c.name)}</option>`).join('')}</select>`;
    else if (kind === 'calc') inp = `<span class="calc">${type === 'loan' ? C.loanLeft(row) || '—' : ''}</span>`;
    else if (kind === 'chk') { inp = `<input type="checkbox" data-k="${k}"${v ? ' checked' : ''}> <small>${lab}</small>`; cls += ' chkf'; }
    else if (kind === 'n') {
      inp = `<input inputmode="decimal" class="num" data-k="${k}" data-n="1" placeholder=" " value="${v == null || v === '' ? '' : esc(v)}" aria-label="${lab}">`;
      const sign = extra === 'cur' ? (row.cur === 'USD' ? '$' : '₪') : extra;
      if (sign) inp = curWrap(sign, inp);
    } else inp = `<input data-k="${k}" value="${esc(v)}" aria-label="${lab}"${key === 'name' ? ' placeholder="שם"' : ''}>`;
    if (key === 'name') cls += ' wide';
    return `<div class="${cls}">${kind === 'chk' ? '' : `<span class="lb">${lab}</span>`}${inp}</div>`;
  }
  function sectionTotal(s, c) {
    const v = c.bySec[s.id] || 0;
    if (s.type === 'asset') { const ru = C.rowsOf(curM(), s.id).some(r => r.cur === 'USD'); return money(v) + (ru ? ` · ${usd(c.assetsUsd)}` : ''); }
    return money(v);
  }
  function renderSection(s, m, c) {
    const T = TYPES[s.type], rows = C.rowsOf(m, s.id);
    const fields = T.fields.filter(f => f[2] !== 'cat' || S.categories.length);
    const cols = fields.length === T.fields.length ? COLW[s.type] : COLW[s.type].split(' ').slice(0, fields.length).join(' ');
    const open = ui.open[s.id] != null ? ui.open[s.id] : rows.length > 0;
    let h = `<details class="sec" data-sec="${s.id}"${open ? ' open' : ''}><summary><b>${esc(s.title)}</b><span class="tag">${T.label}</span><span class="tot">${sectionTotal(s, c)}</span></summary><div class="secBody">`;
    if (s.type === 'bank') h += `<p class="muted" style="margin:0 0 6px">היתרה של החשבון הראשון מחושבת לבד: יתרת החודש הקודם + מה שנכנס פחות מה שיצא. מקלידים יתרה אמיתית כדי לתקן, ומוחקים אותה כדי לחזור לחישוב.</p>`;
    if (s.type === 'saving') h += `<p class="muted" style="margin:0 0 6px">היתרה ממשיכה מהחודש הקודם + ההפקדה. מקלידים יתרה מהדוח, והחודשים שאחריו ימשיכו ממנה.</p>`;
    h += `<div class="hd" style="--c:${cols}">${fields.map(f => `<div>${f[1]}</div>`).join('')}<div></div></div><div class="rows">`;
    rows.forEach((r, i) => { h += `<div class="r" style="--c:${cols}">${fields.map(f => field(s.id, i, f, r, s.type)).join('')}<button class="del" title="מחק שורה" aria-label="מחק שורה" data-del="${s.id}|${i}">✕</button></div>`; });
    if (!rows.length) h += `<p class="muted" style="margin:4px 0">אין עדיין שורות.</p>`;
    h += `</div><div class="row"><button class="add" data-add="${s.id}">＋ הוסף שורה</button><button class="sm ghost" data-secedit="${s.id}" style="margin-top:8px">עריכת הסעיף</button></div></div></details>`;
    return h;
  }
  function monthKpis(c) {
    let h = '';
    if (c.remain < 0 && (hasType('income') || hasType('expense'))) h += `<div class="banner bad">החודש במינוס: ${money(c.remain)}${c.depNet ? ' אחרי ההפקדות' : ''}</div>`;
    const k = [];
    if (hasType('income')) k.push(kpi('הכנסות', money(c.income), '', c.internal ? 'לא כולל העברה פנימית ' + money(c.internal) : ''));
    if (hasType('expense') || hasType('loan')) k.push(kpi('הוצאות', money(c.expense)));
    if (hasType('income')) k.push(kpi('נשאר בנטו', money(c.net), c.net < 0 ? 'neg' : 'pos'));
    if (hasType('deposit')) k.push(kpi('נשאר בפועל', money(c.remain), c.remain < 0 ? 'neg' : 'pos', 'אחרי הפקדות ' + money(c.depNet)));
    if (hasType('bank') || hasType('saving')) k.push(kpi('חסכונות ובנק', money(c.bank + c.savings)));
    if (hasType('asset')) k.push(kpi('השקעות', money(c.assets), '', c.assetsUsd ? usd(c.assetsUsd) : ''));
    if (hasType('loan')) k.push(kpi('חובות', money(c.debts), c.debts ? 'neg' : ''));
    k.push(kpi('הון עצמי', money(c.equity), c.equity < 0 ? 'neg' : 'pos', 'כל מה שיש פחות החובות'));
    return h + `<div class="kpis">${k.join('')}</div>`;
  }
  function renderMonth(k) {
    const m = Y().months[k];
    if (!m) {
      const prevK = [...Array(k - 1).keys()].map(x => x + 1).reverse().find(x => Y().months[x]);
      const prevY = !prevK && S.years[ui.year - 1] ? S.years[ui.year - 1].months[12] : null;
      const from = prevK ? MN[prevK - 1] : prevY ? 'דצמבר ' + (ui.year - 1) : null;
      return `<section class="box"><h3>${MN[k - 1]} ${ui.year}: עוד לא נפתח</h3>
        <p class="muted">${from ? `החודש ייפתח כהעתק של ${from}: השורות נשארות, והסכומים מתעדכנים לפי ההגדרה של כל סעיף (למשל סכומי כרטיסים מתאפסים, יתרת הלוואה יורדת בתשלום).` : 'חודש ריק חדש, עם הסעיפים שלך.'}</p>
        <div class="row"><button class="pri" data-open="${k}">פתח את ${MN[k - 1]}</button><button class="ghost" data-open="${k}" data-thenimport="1">פתח וטען מסמכים</button></div></section>`;
    }
    const c = calc(m);
    let h = `<div class="top"><h2>${MN[k - 1]} ${ui.year}</h2><div class="det">
      <label>תקופה<input data-k="m:period" value="${esc(m.period)}" placeholder="10/01 – 09/02"></label>
      ${usesUsd() ? `<label>שער דולר${curWrap('₪', `<input class="num" data-k="m:rate" data-n="1" inputmode="decimal" placeholder=" " value="${m.rate == null ? '' : esc(m.rate)}">`)}</label>` : ''}
    </div></div>`;
    h += `<div id="sum">${monthKpis(c)}</div>`;
    C.active(S).forEach(s => { h += renderSection(s, m, c); });
    h += `<div class="row" style="margin-top:4px"><button class="add" id="addSec">＋ סעיף חדש</button><button class="ghost" id="importHere">⬆ טען מסמכים לחודש הזה</button><button class="ghost" data-reset="${k}">↺ אפס חודש</button></div>`;
    return h;
  }

  /* ---------- rendering: year summary ---------- */
  function lineChart(points, opts = {}) {
    const W = 760, H = 210, pad = 44, n = points.length;
    const vals = points.map(p => p.v).concat((opts.ref || []).filter(v => v != null));
    const lo = Math.min(...vals), hi = Math.max(...vals), rng = (hi - lo) || 1;
    const xs = i => n === 1 ? W / 2 : pad + i * (W - 2 * pad) / (n - 1), ys = v => H - 30 - ((v - lo) / rng) * (H - 62);
    const firstEst = points.findIndex(p => p.est), solidEnd = firstEst < 0 ? n : firstEst;
    const pts = (a, b) => points.slice(a, b).map((p, j) => xs(a + j) + ',' + ys(p.v)).join(' ');
    return `<svg viewBox="0 0 ${W} ${H}" width="100%" style="max-height:240px" role="img">
      ${opts.ref && opts.ref[0] != null ? `<polyline fill="none" stroke="var(--mut)" stroke-width="1.5" stroke-dasharray="5 4" points="${opts.ref.map((v, i) => xs(i) + ',' + ys(v)).join(' ')}"/>` : ''}
      <polyline fill="none" stroke="var(--pri)" stroke-width="2.5" points="${pts(0, solidEnd)}"/>
      ${firstEst > 0 ? `<polyline fill="none" stroke="var(--pri)" stroke-width="2.5" stroke-dasharray="3 5" points="${pts(firstEst - 1, n)}"/>` : ''}
      ${points.map((p, i) => `<circle cx="${xs(i)}" cy="${ys(p.v)}" r="3.5" fill="${p.est ? 'var(--card)' : 'var(--pri)'}" stroke="var(--pri)" stroke-width="1.5"><title>${p.label}: ${fmt(p.v)}${p.est ? ' (הערכה)' : ''}</title></circle><text x="${xs(i)}" y="${H - 8}" text-anchor="middle">${p.label.slice(0, 3)}</text>`).join('')}
      <text x="${xs(0)}" y="${ys(points[0].v) - 9}" text-anchor="middle">${I(Math.round(points[0].v / 1000) + 'K')}</text>
      ${n > 1 ? `<text x="${xs(n - 1)}" y="${ys(points[n - 1].v) - 9}" text-anchor="middle">${I(Math.round(points[n - 1].v / 1000) + 'K')}</text>` : ''}
    </svg>`;
  }
  function renderYear() {
    const y = C.yearSummary(S, ui.year, new Date());
    if (y.empty) {
      const lm = lastMonth();
      return `<section class="box"><h3>עוד אין נתונים ב-${ui.year}</h3><p class="muted">ממלאים חודש, והסיכום והגרפים יופיעו כאן.</p>
        <button class="pri" data-tab="${lm || 1}">${lm ? 'לחודש ' + MN[lm - 1] : 'לפתוח את ינואר'}</button></section>`;
    }
    const { act, tInc, tExp, tNet, tDep, e0, e1, first } = y;
    const real = act.filter(x => !x.est);
    let h = `<div class="kpis">
      ${kpi('הכנסות השנה', money(tInc), '', act.length + ' חודשים')}
      ${kpi('הוצאות השנה', money(tExp), '', act.length ? 'ממוצע ' + money(tExp / act.length) + ' לחודש' : '')}
      ${kpi('נשאר השנה', money(tNet), tNet < 0 ? 'neg' : 'pos', tInc ? pct(tNet / tInc * 100) + ' מההכנסות' : '')}
      ${hasType('deposit') ? kpi('הפקדתי לחיסכון והשקעה', money(tDep)) : ''}
      ${y.gainReal != null && hasType('asset') ? kpi('רווח מהשוק', money(y.gainReal), y.gainReal < 0 ? 'neg' : 'pos', 'שינוי השווי פחות ההפקדות') : ''}
      ${kpi('הון עצמי היום', money(e1), e1 < 0 ? 'neg' : 'pos', act.length > 1 ? (e1 >= e0 ? 'עלייה של ' : 'ירידה של ') + money(Math.abs(e1 - e0)) + ' מ' + MN[first.k - 1] : '')}
    </div>`;
    if (act.some(x => x.est)) h += `<p class="muted" style="margin:-4px 0 10px">${act.filter(x => x.est).map(x => MN[x.k - 1]).join(', ')}: החודש עוד לא נגמר, המספרים שלו הם הערכה.</p>`;
    h += `<section class="box"><h3>חודש אחרי חודש</h3><div class="scroll"><table>
      <thead><tr><th>חודש</th><th>הכנסות</th><th>הוצאות</th><th>נשאר</th><th style="width:16%"></th><th>הון עצמי</th></tr></thead><tbody>`;
    act.forEach(x => {
      const p = x.c.income > 0 ? x.c.net / x.c.income * 100 : 0;
      h += `<tr><td><button class="link" data-tab="${x.k}">${MN[x.k - 1]}</button>${x.est ? ' <span class="tag">הערכה</span>' : ''}</td><td>${money(x.c.income)}</td><td>${money(x.c.expense)}</td><td class="${x.c.net < 0 ? 'neg' : 'pos'}"><b>${money(x.c.net)}</b></td><td><div class="pbar"><i class="${p < 0 ? 'bad' : ''}" style="width:${Math.min(100, Math.abs(p))}%"></i></div></td><td>${money(x.c.equity)}</td></tr>`;
    });
    h += `<tr class="tot"><td>סה״כ</td><td>${money(tInc)}</td><td>${money(tExp)}</td><td class="${tNet < 0 ? 'neg' : 'pos'}">${money(tNet)}</td><td></td><td></td></tr></tbody></table></div></section>`;
    // categories
    const cats = Object.entries(y.byCat).filter(([, v]) => v).sort((a, b) => b[1] - a[1]);
    if (cats.length && S.categories.length) {
      const mx = cats[0][1];
      h += `<section class="box"><h3>לאן הלך הכסף</h3><table>${cats.map(([id, v]) => `<tr><td style="width:34%">${esc(catName(id))}</td><td style="width:36%"><div class="pbar"><i style="width:${Math.max(2, v / mx * 100)}%"></i></div></td><td>${money(v)}</td><td class="muted">${pct(v / tExp * 100)}</td></tr>`).join('')}</table>
        <p class="muted">לפי הקטגוריה של כל שורת הוצאה והלוואה. אפשר להוסיף ולשנות קטגוריות בהגדרות.</p></section>`;
    }
    h += `<section class="box"><h3>הון עצמי לאורך השנה</h3>${lineChart(act.map(x => ({ v: x.c.equity, label: MN[x.k - 1], est: x.est })))}
      <p class="muted">${S.settings.includeFuture ? 'כולל כל הכספים העתידיים' : 'בנק + חסכונות + השקעות − חובות'}</p></section>`;
    if (hasType('asset') && act.some(x => x.c.assets)) {
      let cum = y.openAssets;
      const put = y.assets.map(a => cum == null ? null : (cum += a.dep));
      h += `<section class="box"><h3>ההשקעות לאורך השנה</h3>${lineChart(y.assets.map(a => ({ v: a.value, label: MN[a.k - 1], est: a.est })), { ref: put })}
        <div class="muted legend"><span>שווי ההשקעות</span>${put[0] != null ? '<span class="dash">כמה הפקדתי (תחילת שנה + הפקדות)</span>' : ''}</div>
        <div class="det" style="margin-top:10px"><label>שווי ההשקעות בתחילת השנה${curWrap('₪', `<input class="num" data-k="y:openAssets" data-n="1" inputmode="decimal" placeholder=" " value="${Y().openAssets == null ? '' : esc(Y().openAssets)}">`)}</label></div>
        <p class="muted">רווח של כל חודש = שינוי השווי פחות ההפקדות של אותו חודש.${y.openAssets == null ? ' בלי שווי בתחילת השנה, החודש הראשון לא נכנס לרווח.' : ''}</p></section>`;
    }
    return h;
  }

  /* ---------- rendering: settings ---------- */
  function renderSecEditor() {
    const n = S.sections.length;
    let h = `<section class="box"><h3>הסעיפים שלך</h3><p class="muted">מדליקים רק מה שיש לך. אפשר לשנות שם, להזיז, למחוק וליצור סעיפים חדשים. סעיף כבוי לא מוצג ולא נספר, והנתונים שלו נשמרים.</p><div class="edl">`;
    S.sections.forEach((s, i) => {
      h += `<div class="edr${s.on === false ? ' off' : ''}">
        <label class="sw" title="${s.on === false ? 'כבוי' : 'פעיל'}"><input type="checkbox" data-secon="${s.id}"${s.on === false ? '' : ' checked'} aria-label="הצג את ${esc(s.title)}"><i></i></label>
        <div class="nm"><input data-sectitle="${s.id}" value="${esc(s.title)}" aria-label="שם הסעיף"><small>${TYPES[s.type].label}${TYPES[s.type].amount === 'amount' && s.type !== 'income' ? '' : ''} · בחודש חדש השורות ${KEEP.find(x => x[0] === C.keepOf(s))[1]}</small></div>
        <div class="ctl"><button data-secup="${s.id}" ${i === 0 ? 'disabled' : ''} aria-label="הזז למעלה">↑</button><button data-secdown="${s.id}" ${i === n - 1 ? 'disabled' : ''} aria-label="הזז למטה">↓</button><button data-secedit="${s.id}" aria-label="הגדרות הסעיף">⋯</button></div>
      </div>`;
    });
    h += `</div><button class="add" id="addSec">＋ סעיף חדש</button></section>`;
    return h;
  }
  function renderCatEditor() {
    let h = `<section class="box"><h3>קטגוריות להוצאות</h3><p class="muted">כל שורת הוצאה אפשר לשייך לקטגוריה, ובסיכום השנתי רואים כמה הלך על כל אחת.</p><div class="edl">`;
    S.categories.forEach(c => {
      h += `<div class="edr" style="grid-template-columns:minmax(0,1fr) auto"><div class="nm"><input data-catname="${c.id}" value="${esc(c.name)}" aria-label="שם הקטגוריה"></div><div class="ctl"><button data-catdel="${c.id}" aria-label="מחק קטגוריה">✕</button></div></div>`;
    });
    h += `</div><div class="row" style="margin-top:8px"><input id="newCat" placeholder="קטגוריה חדשה, למשל: חיות מחמד" style="flex:1;min-width:160px"><button class="pri" id="addCat">הוסף</button></div></section>`;
    return h;
  }
  function renderSettings() {
    const meta = Store.meta(), snaps = Store.snapshots();
    const ys = Object.keys(S.years).sort();
    return renderSecEditor() + renderCatEditor() + `
    <section class="box stack"><h3>החודש התקציבי</h3>
      <div class="det"><label>יום כניסת המשכורת<input type="number" min="1" max="28" data-k="p:payDay" value="${esc(S.profile.payDay)}"></label>
      <label>יום חיוב האשראי<input type="number" min="1" max="28" data-k="p:chargeDay" value="${esc(S.profile.chargeDay)}"></label></div>
      <p class="muted" style="margin:0">חודש מתחיל ביום המשכורת ונגמר יום לפני המשכורת הבאה. חודש שעוד לא נגמר מסומן "הערכה".</p>
      <label class="row"><input type="checkbox" id="incf" ${S.settings.includeFuture ? 'checked' : ''}> לכלול את כל הכספים העתידיים בהון העצמי (אחרת רק מה שסימנת "בהון העצמי")</label>
    </section>
    <section class="box stack"><h3>גיבוי ומעבר בין מכשירים</h3>
      <p class="muted" style="margin:0">הנתונים נשמרים רק בדפדפן הזה, במכשיר הזה. כדי לא לאבד אותם, ולהעביר אותם לטלפון או למחשב אחר, שומרים קובץ גיבוי (למשל ב-Drive או בוואטסאפ לעצמך) ופותחים אותו במכשיר השני.</p>
      <p class="muted" style="margin:0">גיבוי אחרון לקובץ: ${meta.backup ? new Date(meta.backup).toLocaleDateString('he-IL') : 'עוד לא נשמר'}</p>
      <div class="row"><button class="pri" id="doBackup">⬇ שמור גיבוי לקובץ</button><button class="ghost" id="doRestore">⬆ פתח קובץ גיבוי</button></div>
      ${snaps.length ? `<details><summary class="muted">עותקים אוטומטיים בדפדפן (${snaps.length})</summary><table>${snaps.map((s, i) => `<tr><td>${new Date(s.time).toLocaleString('he-IL')}</td><td><button class="sm" data-snap="${i}">שחזר</button></td></tr>`).join('')}</table></details>` : ''}
    </section>
    <section class="box stack"><h3>שנים</h3>
      <p class="muted" style="margin:0">שנים קיימות: ${ys.join(', ')}</p>
      <div class="row"><button class="ghost" id="newYear">＋ פתח שנה חדשה</button></div>
    </section>
    <section class="box stack"><h3>התחלה מחדש</h3>
      <p class="muted" style="margin:0">מוחק את כל הנתונים מהמכשיר הזה וחוזר לאשף הפתיחה. כדאי לשמור גיבוי לפני.</p>
      <div class="row"><button class="ghost" id="wipe" style="color:var(--bad)">מחק הכל והתחל מחדש</button></div>
    </section>
    <p class="small">תקציב שנתי הוא כלי מעקב אישי, לא ייעוץ פיננסי. הנתונים לא נשלחים לשום מקום.</p>`;
  }

  /* ---------- render ---------- */
  function render() {
    renderNav(); btns();
    const main = $('#main');
    const nb = notice ? `<div class="banner bad">${esc(notice)} <button class="sm" id="noticeX">הבנתי</button></div>` : '';
    const meta = Store.meta();
    const anyData = C.chainMonths(S).length > 0;
    if (!meta.first) Store.setMeta({ first: Date.now() });
    const used = Date.now() - (Store.meta().first || Date.now()) > 3 * 864e5;
    const remind = anyData && used && ui.tab !== 'settings' && (!meta.backup || Date.now() - meta.backup > 30 * 864e5) && meta.remindOff !== new Date().toISOString().slice(0, 7)
      ? `<div class="banner warn">${meta.backup ? 'עבר יותר מחודש מהגיבוי האחרון.' : 'עוד לא שמרת גיבוי.'} הנתונים שמורים רק במכשיר הזה. <button class="sm" id="doBackup">⬇ שמור גיבוי</button><button class="sm ghost" id="remindOff">לא עכשיו</button></div>` : '';
    if (ui.tab === 'summary') main.innerHTML = nb + remind + renderYear();
    else if (ui.tab === 'settings') main.innerHTML = nb + renderSettings();
    else main.innerHTML = nb + remind + renderMonth(ui.tab);
    document.querySelectorAll('details.sec').forEach(d => d.addEventListener('toggle', () => { ui.open[d.dataset.sec] = d.open; }));
  }
  function renderNav() {
    let h = `<button class="${ui.tab === 'summary' ? 'on' : ''}" data-tab="summary">סיכום</button>`;
    for (let k = 1; k <= 12; k++) { const has = !!Y().months[k]; h += `<button class="${ui.tab === k ? 'on' : ''}${has ? '' : ' empty'}" data-tab="${k}">${MN[k - 1]}</button>`; }
    h += `<button class="${ui.tab === 'settings' ? 'on' : ''}" data-tab="settings">⚙ הגדרות</button>`;
    $('#nav').innerHTML = h;
    const on = $('#nav .on'); if (on) on.scrollIntoView({ block: 'nearest', inline: 'center' });
    $('#yr').innerHTML = Object.keys(S.years).sort().map(y => `<option value="${y}"${+y === ui.year ? ' selected' : ''}>${y}</option>`).join('');
  }
  function refreshNumbers() {
    const m = curM(); if (!m) return;
    const c = calc(m);
    const s = $('#sum'); if (s) s.innerHTML = monthKpis(c);
    C.active(S).forEach(x => { const el = document.querySelector(`details[data-sec="${x.id}"] .tot`); if (el) el.innerHTML = sectionTotal(x, c); });
    // calculated values shown in other fields (bank, savings, loans left)
    C.active(S).forEach(x => {
      if (x.type === 'bank' || x.type === 'saving') C.rowsOf(m, x.id).forEach((r, i) => {
        const el = document.querySelector(`[data-k="${x.id}|${i}|balance"]`);
        if (!el || el === document.activeElement) return;
        const v = r.balance == null ? '' : String(r.balance);
        if (el.value !== v) { el.value = v; el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash'); }
      });
      if (x.type === 'loan') C.rowsOf(m, x.id).forEach((r, i) => { const el = document.querySelectorAll(`details[data-sec="${x.id}"] .r`)[i]; const cs = el && el.querySelector('.calc'); if (cs) cs.textContent = C.loanLeft(r) || '—'; });
    });
  }

  /* ---------- editing ---------- */
  function evalExpr(s) {
    s = String(s).replace(/,/g, '').replace(/\s+/g, '').replace(/×/g, '*').replace(/÷/g, '/');
    if (!/^[-+*/().\d]+$/.test(s) || !/\d[-+*/]|\)[-+*/(]/.test(s)) return null;
    let p = 0;
    const peek = () => s[p];
    function factor() {
      if (peek() === '-') { p++; return -factor(); }
      if (peek() === '+') { p++; return factor(); }
      if (peek() === '(') { p++; const v = expr(); if (s[p++] !== ')') throw 0; return v; }
      const m = /^\d*\.?\d+|^\d+\.?/.exec(s.slice(p)); if (!m) throw 0; p += m[0].length; return parseFloat(m[0]);
    }
    function term() { let v = factor(); while (peek() === '*' || peek() === '/') { const o = s[p++], b = factor(); v = o === '*' ? v * b : v / b; } return v; }
    function expr() { let v = term(); while (peek() === '+' || peek() === '-') { const o = s[p++], b = term(); v = o === '+' ? v + b : v - b; } return v; }
    try { const v = expr(); return p === s.length && isFinite(v) ? r2(v) : null; } catch (_) { return null; }
  }
  function applyEdit(el) {
    const k = el.dataset.k;
    let v;
    if (el.type === 'checkbox') v = el.checked;
    else if (el.dataset.n) { const t = el.value.trim(); v = t === '' ? null : (evalExpr(t) != null && document.activeElement !== el ? evalExpr(t) : num(t)); }
    else v = el.value;
    if (k.startsWith('y:')) { Y()[k.slice(2)] = v; return; }
    if (k.startsWith('p:')) { S.profile[k.slice(2)] = Math.min(28, Math.max(1, num(v) || 1)); return; }
    const m = curM(); if (!m) return;
    if (k.startsWith('m:')) { m[k.slice(2)] = v; recompute(); return; }
    const [sid, i, f] = k.split('|'), s = sec(sid), row = m.rows[sid][+i];
    if (s.type === 'saving' && f === 'balance') { C.setSavingBalance(S, ui.year, ui.tab, sid, +i, v); return; }
    if (s.type === 'bank' && f === 'balance') { if (v == null) row.manual = false; else { row.manual = true; row.balance = v; } recompute(); return; }
    row[f] = v;
    recompute();
  }
  document.addEventListener('input', e => {
    const el = e.target;
    if (!S || !el.dataset || !el.dataset.k || el.tagName === 'SELECT' || el.type === 'checkbox') return;
    pushUndo(); applyEdit(el); refreshNumbers(); queueSave();
  });
  document.addEventListener('change', e => {
    const el = e.target;
    if (!S) return;
    if (el.id === 'yr') { ui.year = +el.value; const lm = lastMonth(); ui.tab = lm || 'summary'; render(); return; }
    if (el.id === 'incf') { pushUndo(true); S.settings.includeFuture = el.checked; queueSave(true); return; }
    if (el.dataset.secon) { pushUndo(true); sec(el.dataset.secon).on = el.checked; recompute(); queueSave(true); render(); return; }
    if (el.dataset.sectitle) { pushUndo(true); sec(el.dataset.sectitle).title = el.value.trim() || sec(el.dataset.sectitle).title; queueSave(true); render(); return; }
    if (el.dataset.catname) { pushUndo(true); const c = S.categories.find(x => x.id === el.dataset.catname); if (el.value.trim()) c.name = el.value.trim(); queueSave(true); render(); return; }
    if (!el.dataset.k) return;
    if (el.tagName === 'SELECT' || el.type === 'checkbox') { pushUndo(true); applyEdit(el); queueSave(true); render(); return; }
    if (el.dataset.n) { const x = evalExpr(el.value); if (x != null) el.value = String(x); }
    applyEdit(el); queueSave(true);
    // re-render only where the layout depends on it; otherwise keep focus where the user moved to
    if (/^[yp]:/.test(el.dataset.k)) render(); else refreshNumbers();
  });
  document.addEventListener('keydown', e => {
    if (!$('#modal').hidden) {
      if (e.key === 'Escape') { e.preventDefault(); closeDlg(false); }
      else if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA') { e.preventDefault(); closeDlg(true); }
      return;
    }
    if (e.key === 'Enter' && e.target.id === 'newCat') { e.preventDefault(); addCategory(); return; }
    if (!(e.ctrlKey || e.metaKey) || e.altKey || !S) return;
    if (e.target.matches && e.target.matches('input,textarea') && !e.target.dataset.k) return;
    const k = e.key.toLowerCase();
    if ((k === 'z' || e.code === 'KeyZ') && !e.shiftKey) { e.preventDefault(); undo(); }
    else if (k === 'y' || e.code === 'KeyY' || ((k === 'z' || e.code === 'KeyZ') && e.shiftKey)) { e.preventDefault(); redo(); }
  });

  function typeOptions(sel) {
    return Object.entries(TYPES).map(([k, t]) => `<option value="${k}"${k === sel ? ' selected' : ''}>${t.label}: ${t.hint}</option>`).join('');
  }
  async function addSectionDlg() {
    const r = await ask('סעיף חדש', { ok: 'הוסף', html: `<div class="stack">
      <label class="stack" style="gap:3px"><span class="muted">שם הסעיף</span><input name="title" placeholder="למשל: רכב, ילדים, דירה להשקעה"></label>
      <label class="stack" style="gap:3px"><span class="muted">מה הוא?</span><select name="type">${typeOptions('expense')}</select></label>
      <p class="typehelp" style="margin:0">הסוג קובע איך הסעיף נספר: הוצאה מורידה מ"נשאר", הכנסה מוסיפה, חיסכון, השקעה ובנק נספרים בהון העצמי, והלוואה היא חוב.</p></div>` });
    if (!r || !r.title || !r.title.trim()) return;
    pushUndo(true);
    const id = C.addSection(S, r.title.trim(), r.type);
    ui.open[id] = true;
    queueSave(true); render();
    setStatus('הסעיף נוסף ✓');
  }
  async function editSectionDlg(id) {
    const s = sec(id);
    const has = C.sectionHasData(S, id);
    const keepSel = TYPES[s.type].amount === 'amount' || s.type === 'income';
    const r = await ask('עריכת הסעיף', { ok: 'שמור', html: `<div class="stack">
      <label class="stack" style="gap:3px"><span class="muted">שם</span><input name="title" value="${esc(s.title)}"></label>
      <label class="stack" style="gap:3px"><span class="muted">סוג</span><select name="type">${typeOptions(s.type)}</select></label>
      ${keepSel ? `<label class="stack" style="gap:3px"><span class="muted">כשפותחים חודש חדש, השורות של הסעיף</span><select name="keep">${KEEP.map(([k, l]) => `<option value="${k}"${C.keepOf(s) === k ? ' selected' : ''}>${l}</option>`).join('')}</select></label>` : ''}
      <label class="row"><input type="checkbox" name="on"${s.on === false ? '' : ' checked'}> להציג ולספור את הסעיף</label>
      <label class="row" style="color:var(--bad)"><input type="checkbox" name="del"> למחוק את הסעיף${has ? ' ואת כל השורות שלו בכל החודשים' : ''}</label></div>` });
    if (!r) return;
    if (r.del) {
      if (has && !(await ask(`למחוק את "${s.title}" עם כל השורות שלו בכל החודשים? אפשר לבטל מיד עם ↶.`, { ok: 'מחק' }))) return;
      pushUndo(true); C.removeSection(S, id); recompute(); queueSave(true); render(); setStatus('הסעיף נמחק'); return;
    }
    pushUndo(true);
    if (r.title && r.title.trim()) s.title = r.title.trim();
    if (r.type !== s.type) { s.type = r.type; delete s.keep; }
    if (r.keep && keepSel) s.keep = r.keep;
    s.on = !!r.on;
    recompute(); queueSave(true); render();
  }
  function moveSection(id, d) {
    const i = S.sections.findIndex(s => s.id === id), j = i + d;
    if (j < 0 || j >= S.sections.length) return;
    pushUndo(true);
    [S.sections[i], S.sections[j]] = [S.sections[j], S.sections[i]];
    queueSave(true); render();
  }
  function addCategory() {
    const el = $('#newCat'), v = el && el.value.trim();
    if (!v) return;
    if (S.categories.some(c => c.name === v)) { setStatus('הקטגוריה כבר קיימת'); return; }
    pushUndo(true); S.categories.push({ id: C.uid(), name: v }); queueSave(true); render();
    const n = $('#newCat'); if (n) n.focus();
  }
  function openMonth(k) {
    pushUndo(true);
    const prevK = [...Array(k - 1).keys()].map(x => x + 1).reverse().find(x => Y().months[x]);
    const prev = prevK ? Y().months[prevK] : S.years[ui.year - 1] && S.years[ui.year - 1].months[12];
    Y().months[k] = prev ? C.deriveMonth(prev, S) : C.emptyMonth(S);
    recompute(); queueSave(true);
    ui.tab = k; render(); scrollTo(0, 0);
  }

  document.addEventListener('click', async e => {
    const t = e.target.closest('button');
    if (!t || t.closest('#modal') || !S || t.closest('.wiz')) return;
    if (t.id === 'undo') return undo();
    if (t.id === 'redo') return redo();
    if (t.id === 'noticeX') { notice = null; render(); return; }
    if (t.id === 'remindOff') { Store.setMeta({ remindOff: new Date().toISOString().slice(0, 7) }); render(); return; }
    if (t.id === 'doBackup' || t.id === 'hdrBackup') { flushSave(); const r = await Store.exportFile(S); if (r.ok) { setStatus('הגיבוי נשמר ✓'); render(); } return; }
    if (t.id === 'doRestore') { $('#fileBackup').click(); return; }
    if (t.id === 'hdrImport' || t.id === 'importHere') { window.ImportUI.open(); return; }
    if (t.id === 'addSec') return addSectionDlg();
    if (t.id === 'addCat') return addCategory();
    if (t.id === 'newYear') return newYear();
    if (t.id === 'wipe') {
      if (await ask('למחוק את כל הנתונים מהמכשיר הזה? אי אפשר לבטל את זה. אם לא שמרת גיבוי, הנתונים יאבדו.', { ok: 'מחק הכל' })) {
        Store.clearAll(); location.reload();
      }
      return;
    }
    if (t.dataset.snap != null) {
      const s = Store.snapshots()[+t.dataset.snap];
      if (s && C.isValid(s.data) && await ask('לשחזר את העותק מ-' + new Date(s.time).toLocaleString('he-IL') + '? הנתונים הנוכחיים יוחלפו (אפשר לבטל עם ↶).', { ok: 'שחזר' })) { pushUndo(true); start(s.data, { tab: 'summary' }); setStatus('שוחזר ✓'); }
      return;
    }
    if (t.dataset.tab !== undefined) { ui.tab = /^\d+$/.test(t.dataset.tab) ? +t.dataset.tab : t.dataset.tab; render(); scrollTo(0, 0); return; }
    if (t.dataset.open) { openMonth(+t.dataset.open); if (t.dataset.thenimport) window.ImportUI.open(); return; }
    if (t.dataset.add) {
      const m = curM(); if (!m) return;
      pushUndo(true);
      const s = sec(t.dataset.add);
      (m.rows[s.id] = m.rows[s.id] || []).push(C.newRow(s.type));
      ui.open[s.id] = true;
      recompute(); queueSave(true); render();
      const rows = document.querySelectorAll(`details[data-sec="${s.id}"] .r`); const last = rows[rows.length - 1];
      if (last) { const f = last.querySelector('input'); if (f) f.focus(); }
      return;
    }
    if (t.dataset.del) {
      const m = curM(); if (!m) return;
      const [sid, i] = t.dataset.del.split('|'), r = m.rows[sid][+i];
      const label = r && r.name ? ` "${r.name}"` : '';
      if (await ask('למחוק את השורה' + label + '?', { ok: 'מחק' })) {
        if (curM() !== m || m.rows[sid][+i] !== r) return;
        pushUndo(true); m.rows[sid].splice(+i, 1); recompute(); queueSave(true); render();
      }
      return;
    }
    if (t.dataset.reset) {
      const k = +t.dataset.reset;
      if (await ask(`לאפס את ${MN[k - 1]}? כל השורות של החודש נמחקות, והוא ייפתח מחדש מהחודש הקודם. אפשר לבטל עם ↶.`, { ok: 'אפס' })) {
        pushUndo(true); delete Y().months[k]; openMonth(k);
      }
      return;
    }
    if (t.dataset.secedit) return editSectionDlg(t.dataset.secedit);
    if (t.dataset.secup) return moveSection(t.dataset.secup, -1);
    if (t.dataset.secdown) return moveSection(t.dataset.secdown, 1);
    if (t.dataset.catdel) {
      const c = S.categories.find(x => x.id === t.dataset.catdel);
      if (await ask(`למחוק את הקטגוריה "${c.name}"? שורות שהיו בה יעברו ל"ללא קטגוריה".`, { ok: 'מחק' })) { pushUndo(true); C.removeCategory(S, c.id); queueSave(true); render(); }
    }
  });

  $('#fileBackup').addEventListener('change', async e => {
    const f = e.target.files[0]; e.target.value = '';
    if (!f) return;
    let d;
    try { d = JSON.parse(String(await Store.readFile(f)).replace(/^﻿/, '')); } catch (_) { tell('הקובץ הזה אינו גיבוי של תקציב שנתי.'); return; }
    if (!C.isValid(d)) { tell('הקובץ הזה אינו גיבוי של תקציב שנתי.'); return; }
    if (S && !(await ask(`לפתוח את הגיבוי "${f.name}"? הנתונים שבמכשיר יוחלפו (אפשר לבטל עם ↶).`, { ok: 'פתח' }))) return;
    if (S) pushUndo(true);
    Store.setMeta({ backup: Date.now() });
    start(d, { tab: 'summary' });
    setStatus('הגיבוי נפתח ✓');
  });

  async function newYear() {
    const ys = Object.keys(S.years).map(Number);
    const ny = Math.max(...ys) + 1;
    if (!(await ask(`לפתוח את ${ny}? ינואר ייפתח כהעתק של החודש האחרון של ${ny - 1}.`, { ok: 'פתח' }))) return;
    pushUndo(true);
    const last = S.years[ny - 1];
    let base = null; for (let k = 12; k >= 1; k--) if (last.months[k]) { base = last.months[k]; break; }
    S.years[ny] = { months: { 1: base ? C.deriveMonth(base, S) : C.emptyMonth(S) } };
    recompute();
    ui.year = ny; ui.tab = 1; queueSave(true); render();
  }

  window.App = {
    get S() { return S; }, ui, MN, esc, money, fmt, I, ask, tell, setStatus, start, render, pushUndo, queueSave, recompute, curM, Y, openMonth,
    catName, sec, flushSave, get UNDO() { return UNDO; }, undo, redo, evalExpr
  };
  btns();
  // start once every script (wizard, import) has loaded
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else setTimeout(init, 0);
})();
