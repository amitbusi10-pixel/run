// Calculations for the dynamic budget. Shared by the app (window.BudgetCalc) and the Node tests.
// The budget is made of user-defined sections. Each section has a TYPE, and the type decides
// how its rows count: income, expense, loan, deposit, bank, saving, asset or future money.
(function (root) {
  'use strict';
  const num = v => { const n = typeof v === 'number' ? v : parseFloat(String(v == null ? '' : v).replace(/[,₪$\s]/g, '')); return isFinite(n) ? n : 0; };
  const r2 = x => Math.round((x + Number.EPSILON) * 100) / 100;
  const clone = o => JSON.parse(JSON.stringify(o));
  const uid = () => Math.random().toString(36).slice(2, 9);

  // Field: [key, label, kind, extra]. kind: text (default) | n (number, extra = currency sign) | chk | cat | calc | sel
  // keep: what a new month keeps from the previous one: 'all' (rows and amounts), 'names' (rows, amounts cleared), 'none'.
  const TYPES = {
    income: { label: 'הכנסה', hint: 'משכורת, הכנסות נוספות', keep: 'names', amount: 'amount',
      fields: [['name', 'מקור'], ['amount', 'סכום', 'n', '₪'], ['date', 'תאריך'], ['internal', 'העברה פנימית', 'chk']] },
    expense: { label: 'הוצאה', hint: 'כרטיסים, הוראות קבע, העברות', keep: 'names', amount: 'amount',
      fields: [['name', 'שם'], ['amount', 'סכום', 'n', '₪'], ['date', 'תאריך'], ['cat', 'קטגוריה', 'cat'], ['note', 'הערה']] },
    loan: { label: 'הלוואה', hint: 'תשלום חודשי ויתרה', keep: 'all', amount: 'monthly',
      fields: [['name', 'שם'], ['monthly', 'תשלום חודשי', 'n', '₪'], ['balance', 'יתרה', 'n', '₪'], ['left', 'נותרו', 'calc'], ['cat', 'קטגוריה', 'cat']] },
    deposit: { label: 'הפקדה לחיסכון/השקעה', hint: 'כסף מהעו"ש לשוק ההון או לחיסכון', keep: 'none', amount: 'amount',
      fields: [['name', 'לאן'], ['amount', 'סכום', 'n', '₪'], ['date', 'תאריך'], ['note', 'הערה']] },
    bank: { label: 'יתרה בבנק', hint: 'עו"ש', keep: 'all', amount: 'balance',
      fields: [['name', 'חשבון'], ['balance', 'יתרה', 'n', '₪']] },
    saving: { label: 'חיסכון/קרן', hint: 'פנסיה, השתלמות, גמל, פיקדון', keep: 'all', amount: 'balance',
      fields: [['name', 'שם'], ['monthly', 'הפקדה חודשית', 'n', '₪'], ['balance', 'יתרה', 'n', '₪'], ['fee', 'דמי ניהול']] },
    asset: { label: 'השקעה/נכס', hint: 'תיק השקעות, קריפטו, רכב', keep: 'all', amount: 'value',
      fields: [['name', 'נכס'], ['value', 'שווי', 'n', 'cur'], ['cur', 'מטבע', 'sel', [['ILS', '₪'], ['USD', '$']]]] },
    future: { label: 'כסף עתידי', hint: 'כסף שמגיע בעתיד', keep: 'all', amount: 'amount',
      fields: [['name', 'שם'], ['amount', 'סכום', 'n', '₪'], ['date', 'מועד צפוי'], ['inEquity', 'בהון העצמי', 'chk']] }
  };

  // The sections a new budget can start with (the wizard turns each on or off).
  const DEFAULT_SECTIONS = [
    { id: 'income', title: 'הכנסות', type: 'income', on: true },
    { id: 'fixed', title: 'הוראות קבע', type: 'expense', keep: 'all', on: true },
    { id: 'cards', title: 'כרטיסי אשראי', type: 'expense', keep: 'names', on: true },
    { id: 'other', title: 'הוצאות נוספות והעברות', type: 'expense', keep: 'none', on: true },
    { id: 'loans', title: 'הלוואות', type: 'loan', on: false },
    { id: 'deposits', title: 'הפקדות להשקעות', type: 'deposit', on: false },
    { id: 'bank', title: 'יתרה בבנק', type: 'bank', on: true },
    { id: 'savings', title: 'חסכונות וקרנות', type: 'saving', on: false },
    { id: 'assets', title: 'השקעות', type: 'asset', on: false },
    { id: 'future', title: 'כספים עתידיים', type: 'future', on: false }
  ];
  const DEFAULT_CATEGORIES = ['מזון וסופר', 'דיור וחשבונות', 'רכב ותחבורה', 'בריאות', 'ילדים', 'בילויים ומסעדות', 'ביגוד וקניות', 'ביטוחים', 'מנויים', 'אחר'];

  function newBudget(opts = {}) {
    const y = opts.year || new Date().getFullYear();
    return {
      app: 'budget-for-all', v: 1,
      profile: { payDay: opts.payDay || 10, chargeDay: opts.chargeDay || 10 },
      settings: { includeFuture: false },
      sections: clone(DEFAULT_SECTIONS),
      categories: DEFAULT_CATEGORIES.map(name => ({ id: uid(), name })),
      mappings: [], rules: [], updates: [],
      years: { [y]: { months: {} } }
    };
  }

  function newRow(type) {
    const r = { name: '' };
    TYPES[type].fields.forEach(([k, , kind]) => {
      if (k === 'name' || kind === 'calc') return;
      r[k] = kind === 'n' ? null : kind === 'chk' ? false : k === 'cur' ? 'ILS' : '';
    });
    if (type === 'future') r.inEquity = false;
    if (type === 'bank') r.manual = false;
    if (type === 'saving') { r.gain = 0; }
    return r;
  }
  function emptyMonth(S) {
    const rows = {};
    (S.sections || []).forEach(s => { rows[s.id] = []; });
    return { period: '', rate: 3.6, rows };
  }
  const active = S => (S.sections || []).filter(s => s.on !== false);
  const rowsOf = (m, id) => (m && m.rows && m.rows[id]) || [];
  const keepOf = s => s.keep || TYPES[s.type].keep;

  // Monthly totals.
  function calc(m, S) {
    const t = { income: 0, internal: 0, expense: 0, deposits: 0, debts: 0, bank: 0, savings: 0, assets: 0, assetsUsd: 0,
      future: 0, futureEq: 0, fundsMonthly: 0, bySec: {}, byCat: {} };
    const rate = num(m.rate);
    active(S).forEach(s => {
      let sec = 0;
      rowsOf(m, s.id).forEach(r => {
        switch (s.type) {
          case 'income': { const a = num(r.amount); if (r.internal) t.internal += a; else { t.income += a; sec += a; } break; }
          case 'expense': { const a = num(r.amount); t.expense += a; sec += a; addCat(t, r.cat, a); break; }
          case 'loan': { const a = num(r.monthly); t.expense += a; sec += a; t.debts += num(r.balance); addCat(t, r.cat, a); break; }
          case 'deposit': { const a = num(r.amount); t.deposits += a; sec += a; break; }
          case 'bank': { const a = num(r.balance); t.bank += a; sec += a; break; }
          case 'saving': { const a = num(r.balance); t.savings += a; sec += a; t.fundsMonthly += num(r.monthly); break; }
          case 'asset': { const usd = r.cur === 'USD', v = num(r.value) * (usd ? rate : 1); t.assets += v; if (usd) t.assetsUsd += num(r.value); sec += v; break; }
          case 'future': { const a = num(r.amount); t.future += a; if (r.inEquity) t.futureEq += a; sec += a; break; }
        }
      });
      t.bySec[s.id] = r2(sec);
    });
    t.net = t.income - t.expense;                     // נשאר בנטו
    t.depNet = Math.max(0, t.deposits - t.internal);  // a deposit funded by an internal transfer is not new money
    t.remain = t.net - t.depNet;                      // נשאר בפועל
    t.cashFlow = t.income + t.internal - t.expense - t.deposits; // the real change in the bank account
    t.futureIn = S.settings && S.settings.includeFuture ? t.future : t.futureEq;
    t.equity = t.bank + t.savings + t.assets - t.debts + t.futureIn;
    Object.keys(t).forEach(k => { if (typeof t[k] === 'number') t[k] = r2(t[k]); });
    return t;
  }
  function addCat(t, cat, a) { const k = cat || ''; t.byCat[k] = r2((t.byCat[k] || 0) + a); }

  // All months of all years, in time order: [{ y, k, m }]
  function chainMonths(S) {
    const out = [];
    Object.keys(S.years || {}).map(Number).sort((a, b) => a - b).forEach(y => {
      const ms = (S.years[y] || {}).months || {};
      Object.keys(ms).map(Number).sort((a, b) => a - b).forEach(k => out.push({ y, k, m: ms[k] }));
    });
    return out;
  }
  const isPrevMonth = (a, b) => (a.y === b.y && a.k === b.k - 1) || (a.y === b.y - 1 && a.k === 12 && b.k === 1);
  const nameKey = r => String(r && r.name != null ? r.name : '').trim();
  // For each row of section id in month m, the row with the same name (same occurrence) in month prev, or null.
  function matchRows(m, prev, id) {
    const used = new Set(), pr = rowsOf(prev, id);
    return rowsOf(m, id).map(r => {
      if (!prev) return null;
      const i = pr.findIndex((p, j) => !used.has(j) && nameKey(p) === nameKey(r));
      if (i < 0) return null;
      used.add(i); return pr[i];
    });
  }
  // The chain from month to month:
  //  - saving: balance = previous balance + monthly deposit + gain. A typed balance is kept by moving the difference into gain.
  //  - bank: the first bank row is automatic (previous balance + this month's cash flow) unless typed by hand (manual).
  function recompute(S) {
    const list = chainMonths(S);
    list.forEach((cur, idx) => {
      const p = idx > 0 && isPrevMonth(list[idx - 1], cur) ? list[idx - 1].m : null;
      let firstBank = true;
      (S.sections || []).forEach(s => {
        if (s.type !== 'saving' && s.type !== 'bank') return;
        const links = matchRows(cur.m, p, s.id);
        rowsOf(cur.m, s.id).forEach((r, i) => {
          const pr = links[i];
          if (s.type === 'bank') {
            const auto = firstBank && s.on !== false; firstBank = false;
            if (r.manual == null) r.manual = true;
            if (auto && !r.manual && pr) r.balance = r2(num(pr.balance) + calc(cur.m, S).cashFlow);
            return;
          }
          if (r.gain == null || r.gain === '') r.gain = 0;
          if (pr) { r.balance = r2(num(pr.balance) + num(r.monthly) + num(r.gain)); delete r.open; }
          else {
            if (r.open == null || r.open === '') r.open = r2(num(r.balance) - num(r.monthly) - num(r.gain));
            r.balance = r2(num(r.open) + num(r.monthly) + num(r.gain));
          }
        });
      });
    });
    return S;
  }
  function prevRow(S, y, k, id, i) {
    const list = chainMonths(S), idx = list.findIndex(x => x.y === +y && x.k === +k);
    if (idx <= 0 || !isPrevMonth(list[idx - 1], list[idx])) return null;
    return matchRows(list[idx].m, list[idx - 1].m, id)[i] || null;
  }
  // Typing a saving balance (from a statement): keep the chain, put the difference into gain.
  function setSavingBalance(S, y, k, id, i, balance) {
    const r = S.years[y].months[k].rows[id][i];
    const pr = prevRow(S, y, k, id, i);
    if (balance == null) { r.gain = 0; return recompute(S); }
    const start = pr ? num(pr.balance) : num(r.open);
    r.gain = r2(num(balance) - start - num(r.monthly));
    return recompute(S);
  }

  // Opening a month copies the previous one, section by section, by its keep rule.
  function deriveMonth(prev, S) {
    const m = emptyMonth(S);
    m.rate = prev.rate;
    (S.sections || []).forEach(s => {
      const src = rowsOf(prev, s.id), keep = keepOf(s);
      let rows;
      if (keep === 'none') rows = [];
      else if (s.type === 'income') rows = src.filter(r => !r.internal).map(r => Object.assign(clone(r), { amount: keep === 'all' ? r.amount : null, date: keep === 'all' ? r.date : '' }));
      else if (keep === 'names' && TYPES[s.type].amount === 'amount') rows = src.map(r => Object.assign(clone(r), { amount: null, date: '', note: '' }));
      else rows = clone(src);
      rows.forEach(r => {
        if (s.type === 'loan' && r.balance != null && r.balance !== '') r.balance = Math.max(0, r2(num(r.balance) - num(r.monthly)));
        if (s.type === 'saving') { r.gain = 0; delete r.open; }
        if (s.type === 'bank') r.manual = false;
      });
      m.rows[s.id] = rows;
    });
    return m;
  }

  // Loan: payments left = balance / monthly payment.
  function loanLeft(r) {
    if (r.balance == null || r.balance === '' || !(num(r.monthly) > 0)) return '';
    const n = Math.ceil(num(r.balance) / num(r.monthly) - 0.005);
    return n <= 0 ? 'שולמה' : n + ' חודשים';
  }

  // Is the budget month (y,k) still running on `today`? A month runs from payDay of month k to payDay of month k+1.
  function isEstimate(S, y, k, today) {
    if (!today) return false;
    const pd = Math.min(28, Math.max(1, num(S.profile && S.profile.payDay) || 1));
    return new Date(+y, k, pd) > today;
  }

  // Year summary.
  function yearSummary(S, y, today) {
    const yr = S.years[y] || { months: {} };
    const act = Object.keys(yr.months || {}).map(Number).sort((a, b) => a - b).map(k => {
      const m = yr.months[k], c = calc(m, S);
      return { k, m, c, est: isEstimate(S, y, k, today) };
    });
    const withData = act.filter(x => x.c.income || x.c.expense || x.c.deposits || x.c.equity);
    if (!withData.length) return { act: withData, empty: true };
    const sum = f => r2(withData.reduce((s, x) => s + f(x), 0));
    const byCat = {};
    withData.forEach(x => Object.keys(x.c.byCat).forEach(c => { byCat[c] = r2((byCat[c] || 0) + x.c.byCat[c]); }));
    const first = withData[0], last = withData[withData.length - 1];
    // assets: value per month and the market change (= change in value minus deposits of that month)
    let prev = yr.openAssets != null && yr.openAssets !== '' ? num(yr.openAssets) : null;
    const open = prev;
    const assets = withData.map(x => {
      const v = x.c.assets, dep = x.c.deposits;
      const gain = prev == null ? null : r2(v - prev - dep);
      const base = prev == null ? 0 : prev + dep;
      prev = v;
      return { k: x.k, value: v, dep, gain, pct: base ? gain / base * 100 : null, est: x.est };
    });
    const real = assets.filter(a => !a.est && a.gain != null);
    const gainReal = real.length ? r2(real.reduce((s, a) => s + a.gain, 0)) : null;
    return {
      act: withData, empty: false, first, last, byCat, assets, openAssets: open, gainReal,
      tInc: sum(x => x.c.income), tExp: sum(x => x.c.expense), tDep: sum(x => x.c.deposits),
      tNet: sum(x => x.c.net), tRemain: sum(x => x.c.remain), e0: first.c.equity, e1: last.c.equity
    };
  }

  // Changing a section: delete keeps nothing; rename/type changes stay in S.sections only.
  function addSection(S, title, type, opts = {}) {
    const id = 's' + uid();
    S.sections.push(Object.assign({ id, title, type, on: true }, opts));
    chainMonths(S).forEach(({ m }) => { m.rows = m.rows || {}; m.rows[id] = []; });
    return id;
  }
  function removeSection(S, id) {
    S.sections = S.sections.filter(s => s.id !== id);
    chainMonths(S).forEach(({ m }) => { if (m.rows) delete m.rows[id]; });
  }
  function sectionHasData(S, id) {
    return chainMonths(S).some(({ m }) => rowsOf(m, id).length > 0);
  }
  function removeCategory(S, catId) {
    S.categories = S.categories.filter(c => c.id !== catId);
    chainMonths(S).forEach(({ m }) => Object.values(m.rows || {}).forEach(rows => rows.forEach(r => { if (r.cat === catId) r.cat = ''; })));
  }

  const isValid = d => !!d && typeof d === 'object' && d.app === 'budget-for-all' && Array.isArray(d.sections) && !!d.years && typeof d.years === 'object';

  const api = { num, r2, clone, uid, TYPES, DEFAULT_SECTIONS, DEFAULT_CATEGORIES, newBudget, newRow, emptyMonth, active, rowsOf, keepOf,
    calc, chainMonths, recompute, prevRow, setSavingBalance, deriveMonth, loanLeft, isEstimate, yearSummary,
    addSection, removeSection, sectionHasData, removeCategory, isValid };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.BudgetCalc = api;
})(typeof window !== 'undefined' ? window : globalThis);
