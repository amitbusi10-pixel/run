// בדיקות בסיסיות: הקוד תקין תחבירית, וגרסת המטמון זהה בכל המקומות
// (אחרת הטלפון עלול להמשיך להציג גרסה ישנה).
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const root = path.join(__dirname, '..');
let fail = 0;
const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) fail++; };

for (const f of ['app.js', 'sw.js']) {
  try { execFileSync(process.execPath, ['--check', path.join(root, f)]); ok(true, `${f} syntax`); }
  catch (e) { ok(false, `${f} syntax\n${e.stderr}`); }
}
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const html = read('index.html'), sw = read('sw.js');
const swVer = (sw.match(/const VERSION = 'v(\d+)'/) || [])[1];
ok(!!swVer, `sw.js VERSION found (v${swVer})`);
const htmlVers = [...html.matchAll(/(?:styles\.css|app\.js)\?v=(\d+)/g)].map((m) => m[1]);
ok(htmlVers.length === 2 && htmlVers.every((v) => v === swVer), `index.html ?v= matches sw.js (${htmlVers.join(',')})`);
const swVers = [...sw.matchAll(/\?v=(\d+)/g)].map((m) => m[1]);
ok(swVers.length >= 2 && swVers.every((v) => v === swVer), 'sw.js SHELL_FILES ?v= matches VERSION');
for (const f of ['index.html', 'styles.css', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png']) ok(fs.existsSync(path.join(root, f)), `${f} exists`);
try { JSON.parse(read('manifest.webmanifest')); ok(true, 'manifest is valid JSON'); } catch (e) { ok(false, 'manifest is valid JSON'); }

console.log(fail ? `\n${fail} failed` : '\nall passed');
process.exit(fail ? 1 : 0);
