// Opening wizard: welcome → budget month → what you have → how to fill the first month.
'use strict';
(function () {
  const C = window.BudgetCalc;
  const $ = s => document.querySelector(s);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const MN = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];
  const ICON = { income: '💼', fixed: '🔁', cards: '💳', other: '🧾', loans: '🏦', deposits: '📈', bank: '🏧', savings: '🐖', assets: '📊', future: '⏳' };
  const HINT = { income: 'משכורת, קצבאות, הכנסות נוספות', fixed: 'שכירות, ביטוחים, מנויים', cards: 'לכל כרטיס: 4 ספרות אחרונות מספיקות',
    other: 'העברות, ביט, מזומן', loans: 'תשלום חודשי ויתרה', deposits: 'כסף מהעו"ש לתיק השקעות או לחיסכון', bank: 'יתרת העו"ש',
    savings: 'פנסיה, השתלמות, גמל, פיקדון', assets: 'תיק השקעות, קריפטו, נכס', future: 'כסף שמגיע בעתיד, כמו פיקדון או מענק' };
  const PH = { income: 'משכורת', fixed: 'שכר דירה', cards: 'כרטיס 1234', other: 'דלק', loans: 'הלוואת רכב', deposits: 'תיק השקעות', bank: 'עו"ש', savings: 'קרן פנסיה', assets: 'תיק השקעות', future: 'פיקדון' };

  const now = new Date();
  let st = null;
  function reset() {
    const S = C.newBudget({ year: now.getFullYear() });
    st = { step: 0, S, year: now.getFullYear(), month: now.getMonth() + 1, payDay: 10, chargeDay: 10, fill: 'docs',
      names: { income: ['משכורת'], bank: ['עו"ש'] } };
  }

  function bar(n) { return `<div class="step">שלב ${n} מתוך 3</div><div class="bar"><i style="width:${n / 3 * 100}%"></i></div>`; }
  function view() {
    const s = st;
    if (s.step === 0) return `<div class="welcome-hero"><img class="logo" src="icon.svg" alt=""></div>
      <h2 style="text-align:center">תקציב שנתי</h2>
      <p class="lead" style="text-align:center">בונים תקציב שנתי מהמסמכים שלך: הכנסות, הוצאות, חסכונות והון עצמי, חודש אחרי חודש.</p>
      <div class="banner info">🔒 הכל נשמר רק במכשיר שלך. שום דבר לא נשלח לשום מקום.</div>
      <div class="grow"></div>
      <button class="big pri" data-w="new">התחל תקציב חדש</button>
      <button class="big" data-w="open">פתח קובץ גיבוי</button>
      <button class="big" data-w="demo">נסה עם נתוני דוגמה</button>
      <p class="small">כלי מעקב אישי, לא ייעוץ פיננסי</p>`;
    if (s.step === 1) {
      const days = sel => [...Array(28).keys()].map(i => `<option${i + 1 === sel ? ' selected' : ''}>${i + 1}</option>`).join('');
      return bar(1) + `<h2>מתי החודש שלך מתחיל?</h2>
      <p class="lead">חודש תקציבי מתחיל ביום שהמשכורת נכנסת, כך שההכנסה וההוצאות של אותו מחזור יושבות יחד.</p>
      <label class="f2"><span>שנה</span><select data-wf="year">${[now.getFullYear() - 1, now.getFullYear(), now.getFullYear() + 1].map(y => `<option${y === s.year ? ' selected' : ''}>${y}</option>`).join('')}</select></label>
      <label class="f2"><span>יום כניסת המשכורת</span><select data-wf="payDay">${days(s.payDay)}</select></label>
      <label class="f2"><span>יום חיוב האשראי</span><select data-wf="chargeDay">${days(s.chargeDay)}</select></label>
      <label class="f2"><span>חודש ראשון למילוי</span><select data-wf="month">${MN.map((m, i) => `<option value="${i + 1}"${i + 1 === s.month ? ' selected' : ''}>${m}</option>`).join('')}</select></label>
      <div class="grow"></div>
      <div class="row"><button class="big pri" data-w="next" style="flex:2">המשך</button><button class="big" data-w="back" style="flex:1">חזרה</button></div>`;
    }
    if (s.step === 2) {
      let h = bar(2) + `<h2>מה יש לך?</h2><p class="lead">מדליקים רק מה שרלוונטי. אפשר להוסיף שמות עכשיו (למשל הכרטיסים), או אחר כך. הכל ניתן לשינוי בהמשך, כולל סעיפים חדשים משלך.</p>`;
      s.S.sections.forEach(x => {
        const names = s.names[x.id] || [];
        h += `<div class="have${x.on ? ' on' : ''}"><div class="hh"><span style="font-size:22px">${ICON[x.id] || '•'}</span><b>${esc(x.title)}<small>${HINT[x.id] || ''}</small></b>
          <label class="sw"><input type="checkbox" data-won="${x.id}"${x.on ? ' checked' : ''} aria-label="${esc(x.title)}"><i></i></label></div>
          ${x.on ? `<div class="chips">${names.map((n, i) => `<span class="chip">${esc(n)}<button data-wdel="${x.id}|${i}" aria-label="הסר">✕</button></span>`).join('')}<input data-wadd="${x.id}" placeholder="+ ${PH[x.id] || 'שם'}" enterkeyhint="done"></div>` : ''}</div>`;
      });
      h += `<p class="muted">לכרטיס אשראי מספיקות 4 ספרות אחרונות. לא רושמים מספר כרטיס מלא.</p>
        <div class="row"><button class="big pri" data-w="next" style="flex:2">המשך</button><button class="big" data-w="back" style="flex:1">חזרה</button></div>`;
      return h;
    }
    return bar(3) + `<h2>איך למלא את ${MN[s.month - 1]}?</h2>
      <button class="opt${s.fill === 'docs' ? ' on' : ''}" data-fill="docs"><span class="ic">📄</span><span><b>העלאת מסמכים</b><span class="muted">עו"ש ופירוטי אשראי מהבנק (אקסל או CSV). האפליקציה קוראת אותם במכשיר, ממלאת, ואתה מאשר מה שלא ברור.</span></span></button>
      <button class="opt${s.fill === 'manual' ? ' on' : ''}" data-fill="manual"><span class="ic">⌨️</span><span><b>הזנה ידנית</b><span class="muted">מקלידים את הסכומים בעצמך. אפשר לעבור למסמכים בכל חודש.</span></span></button>
      <div class="grow"></div>
      <div class="row"><button class="big pri" data-w="finish" style="flex:2">סיום והתחלה</button><button class="big" data-w="back" style="flex:1">חזרה</button></div>`;
  }
  function draw() {
    $('#hdr').hidden = true; $('#nav').hidden = true;
    $('#main').innerHTML = `<div class="wiz"><div class="card">${view()}</div></div>`;
  }
  function addName(id, v) {
    v = String(v || '').trim(); if (!v) return;
    if (id === 'cards' && /\d{9,}/.test(v.replace(/[\s-]/g, ''))) { window.App.tell('לא רושמים מספר כרטיס מלא. מספיקות 4 הספרות האחרונות, למשל "כרטיס 1234".'); return; }
    (st.names[id] = st.names[id] || []).push(v);
  }
  function finish() {
    const s = st, S = s.S;
    S.profile.payDay = s.payDay; S.profile.chargeDay = s.chargeDay;
    S.years = { [s.year]: { months: {} } };
    const m = C.emptyMonth(S);
    S.sections.forEach(x => {
      m.rows[x.id] = (s.names[x.id] || []).map(n => Object.assign(C.newRow(x.type), { name: n }));
      if (x.type === 'bank') m.rows[x.id].forEach(r => { r.manual = true; });
    });
    S.years[s.year].months[s.month] = m;
    window.App.start(S, { year: s.year, tab: s.month });
    if (s.fill === 'docs') window.ImportUI.open();
  }

  document.addEventListener('click', e => {
    const t = e.target.closest('.wiz button'); if (!t) return;
    const w = t.dataset.w;
    if (w === 'new') { st.step = 1; draw(); scrollTo(0, 0); return; }
    if (w === 'open') return $('#fileBackup').click();
    if (w === 'demo') { const y = now.getFullYear(); window.App.start(window.BudgetDemo.demoBudget(y, now.getMonth() + 1), { year: y, tab: 'summary' }); window.App.setStatus('נתוני דוגמה (מומצאים). אפשר להתחיל מחדש בהגדרות.'); return; }
    if (w === 'next') { if (st.step === 2) document.querySelectorAll('[data-wadd]').forEach(i => addName(i.dataset.wadd, i.value)); st.step++; draw(); scrollTo(0, 0); return; }
    if (w === 'back') { st.step--; draw(); scrollTo(0, 0); return; }
    if (w === 'finish') return finish();
    if (t.dataset.fill) { st.fill = t.dataset.fill; return draw(); }
    if (t.dataset.wdel) { const [id, i] = t.dataset.wdel.split('|'); st.names[id].splice(+i, 1); return draw(); }
  });
  document.addEventListener('change', e => {
    const el = e.target; if (!el.closest || !el.closest('.wiz')) return;
    if (el.dataset.wf) { st[el.dataset.wf] = +el.value; return; }
    if (el.dataset.won) { st.S.sections.find(x => x.id === el.dataset.won).on = el.checked; draw(); return; }
  });
  document.addEventListener('keydown', e => {
    const el = e.target;
    if (e.key === 'Enter' && el.dataset && el.dataset.wadd) {
      e.preventDefault();
      const id = el.dataset.wadd;
      addName(id, el.value); draw();
      const n = document.querySelector(`[data-wadd="${id}"]`); if (n) n.focus();
    }
  });

  window.Wizard = { show() { reset(); draw(); } };
})();
