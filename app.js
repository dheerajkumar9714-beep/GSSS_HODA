'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const store = require('./store');

const BUILD = 'Standalone Build 2026-11-24-V2 (mobile corrections applied)';
const sessions = new Map(); // token -> {role, loginId, name, srnoChildren}
const db = () => store.get();

function hashPw(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  const h = crypto.scryptSync(String(pw), salt, 32).toString('hex');
  return salt + ':' + h;
}
function checkPw(pw, stored) {
  if (!stored || !stored.includes(':')) return false;
  const [salt, h] = stored.split(':');
  const calc = crypto.scryptSync(String(pw), salt, 32).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(h), Buffer.from(calc));
}
function dobPw(dob) { return String(dob || '').replace(/-/g, ''); } // DD-MM-YYYY -> DDMMYYYY

function setupPasswords() {
  const s = db();
  let changed = false;
  for (const p of s.parents) {
    if (!p.passwordHash) { p.passwordHash = hashPw(p.tempPassword || dobPw((s.students.find(x => x.srno === p.children[0]) || {}).dob)); changed = true; }
  }
  for (const a of s.staffAccounts) {
    if (a.role === 'admin' && !a.passwordHash) {
      let pw = process.env.ADMIN_PASSWORD || '';
      if (!pw) {
        pw = 'Hoda-' + crypto.randomBytes(4).toString('hex').toUpperCase();
        try {
          fs.mkdirSync(store.DATA_DIR, { recursive: true });
          fs.writeFileSync(path.join(store.DATA_DIR, 'OWNER-SETUP.txt'),
            'Shala Darpan School Analytics — first Admin login\nLogin ID: admin@hoda.school\nOne-time password: ' + pw + '\nIs password ko pehle login ke baad My Account se badal dein. Password badalte hi ye file delete ho jayegi.\n(' + BUILD + ')\n');
        } catch (e) { /* serverless: env var is the documented route */ }
        console.log('[OWNER-SETUP] Admin one-time password generated (see data/OWNER-SETUP.txt locally, or set ADMIN_PASSWORD env).');
      }
      a.passwordHash = hashPw(pw); a.mustChange = true; changed = true;
    }
  }
  if (changed) store.persistNow();
}

function send(res, code, obj, type) {
  const body = type ? obj : JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': type || 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', c => { size += c.length; if (size > 30 * 1024 * 1024) { reject(new Error('Too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch (e) { resolve({ _raw: raw }); }
    });
    req.on('error', reject);
  });
}
function auth(req) {
  const cookie = req.headers.cookie || '';
  const m = cookie.match(/sd_session=([a-zA-Z0-9-]+)/);
  if (!m) return null;
  return sessions.get(m[1]) || null;
}
function requireRole(req, res, roles) {
  const u = auth(req);
  if (!u) { send(res, 401, { error: 'Login required' }); return null; }
  if (roles && !roles.includes(u.role)) { send(res, 403, { error: 'Only ' + roles.join('/') + ' can do this.' }); return null; }
  return u;
}
function audit(who, what) {
  const s = db();
  s.auditLog.push({ at: new Date().toISOString(), who, what });
  if (s.auditLog.length > 500) s.auditLog = s.auditLog.slice(-500);
}
function ageOf(dob, asOn) {
  if (!dob) return null;
  const [d, m, y] = dob.split('-').map(Number);
  const a = asOn ? new Date(asOn) : new Date();
  let age = a.getFullYear() - y;
  if (a.getMonth() + 1 < m || (a.getMonth() + 1 === m && a.getDate() < d)) age--;
  return age;
}
function studentBySrno(srno) { return db().students.find(x => x.srno === Number(srno)) || db().removedStudents.find(x => x.srno === Number(srno)); }
function activeStudents() { return db().students.filter(x => x.status === 'active'); }

function computeResult(exam, srno) {
  const rows = db().marks.filter(m => m.examId === exam.id && m.srno === Number(srno));
  if (!rows.length) return null;
  const marks = {}; let total = 0, maxTotal = 0;
  for (const sub of exam.subjects) {
    const r = rows.find(m => m.subject === sub.name);
    marks[sub.name] = r ? r.marks : null;
    if (r) total += r.marks;
    maxTotal += sub.max;
  }
  const pct = maxTotal ? Math.round((total / maxTotal) * 1000) / 10 : 0;
  const grade = pct >= 90 ? 'A+' : pct >= 80 ? 'A' : pct >= 70 ? 'B' : pct >= 60 ? 'C' : pct >= 50 ? 'D' : pct >= 33 ? 'E' : 'F';
  const division = pct >= 60 ? 'First' : pct >= 45 ? 'Second' : pct >= 33 ? 'Third' : 'Fail';
  return { marks, total, maxTotal, pct, grade, division, hasResult: rows.some(r => r.marks !== null) };
}
function boardResult(be, srno) {
  const e = db().boardEntries.find(x => x.boardExamId === be.id && x.srno === Number(srno));
  if (!e) return null;
  let total = 0, maxTotal = 0, any = false;
  const marks = {};
  for (const sub of be.subjects) {
    const v = e.marks && e.marks[sub.name] !== undefined ? e.marks[sub.name] : null;
    marks[sub.name] = v; maxTotal += sub.max;
    if (v !== null && v !== undefined) { total += v; any = true; }
  }
  const pct = maxTotal ? Math.round((total / maxTotal) * 1000) / 10 : 0;
  const division = !any ? '' : pct >= 60 ? 'First' : pct >= 45 ? 'Second' : pct >= 33 ? 'Third' : 'Fail';
  return { boardRollNo: e.boardRollNo || '', marks, total, maxTotal, pct, division, status: any ? (pct >= 33 ? 'Pass' : 'Fail') : '', hasResult: any };
}

const MINORITY_RELIGIONS = ['muslim', 'christian', 'sikh', 'jain', 'buddhist', 'parsi', 'other'];
function isMinority(s) { return MINORITY_RELIGIONS.includes(String(s.religion || '').toLowerCase()); }

function reportTables(students) {
  const cats = ['GEN', 'ST', 'SC', 'OBC', 'SBC'];
  function cell(list) {
    const b = list.filter(x => x.gender === 'M').length, g = list.filter(x => x.gender === 'F').length;
    return { b, g, t: b + g };
  }
  const classRows = [];
  for (let c = 1; c <= 12; c++) {
    const inClass = students.filter(x => x.classNum === c);
    const row = { classNum: c, cats: {}, total: cell(inClass), minority: cell(inClass.filter(isMinority)) };
    for (const cat of cats) row.cats[cat] = cell(inClass.filter(x => x.category === cat));
    classRows.push(row);
  }
  const totalRow = { classNum: 'TOTAL', cats: {}, total: cell(students), minority: cell(students.filter(isMinority)) };
  for (const cat of cats) totalRow.cats[cat] = cell(students.filter(x => x.category === cat));
  const groups = [['1-5', 1, 5], ['6-8', 6, 8], ['9-12', 9, 12]];
  const groupRows = groups.map(([label, lo, hi]) => {
    const inG = students.filter(x => x.classNum >= lo && x.classNum <= hi);
    const row = { label, cats: {}, total: cell(inG) };
    for (const cat of cats) row.cats[cat] = cell(inG.filter(x => x.category === cat));
    return row;
  });
  const grand = { label: '1-12 TOTAL', cats: {}, total: cell(students) };
  for (const cat of cats) grand.cats[cat] = cell(students.filter(x => x.category === cat));
  groupRows.push(grand);
  return { classRows, totalRow, groupRows };
}

function filterStudents(q) {
  let list = activeStudents();
  if (q.session && q.session !== db().currentSession) {
    const enr = db().enrolments.filter(e => e.session === q.session);
    const map = new Map(enr.map(e => [e.srno, e]));
    list = list.filter(s => map.has(s.srno)).map(s => ({ ...s, classNum: map.get(s.srno).classNum, section: map.get(s.srno).section, roll: map.get(s.srno).roll, enrolledSession: q.session }));
  }
  if (q.classNum) list = list.filter(s => s.classNum === Number(q.classNum));
  if (q.gender) list = list.filter(s => s.gender === q.gender);
  if (q.category) list = list.filter(s => s.category === q.category);
  if (q.religion) list = list.filter(s => (s.religion || '') === q.religion);
  if (q.bpl) list = list.filter(s => s.bpl === q.bpl);
  if (q.cwsn) list = list.filter(s => s.cwsn === q.cwsn);
  if (q.penStatus === 'with') list = list.filter(s => s.pen);
  if (q.penStatus === 'missing') list = list.filter(s => !s.pen);
  if (q.search) {
    const t = q.search.toLowerCase();
    list = list.filter(s => [s.name, s.father, s.mobile, s.pen, s.nicId, String(s.srno)].some(v => String(v || '').toLowerCase().includes(t)));
  }
  if (q.ageMin || q.ageMax || q.ageExact) {
    list = list.filter(s => {
      const a = ageOf(s.dob, q.ageAsOn || null); if (a === null) return false;
      if (q.ageExact && a !== Number(q.ageExact)) return false;
      if (q.ageMin && a < Number(q.ageMin)) return false;
      if (q.ageMax && a > Number(q.ageMax)) return false;
      return true;
    });
  }
  if (q.attMin || q.attMax) {
    list = list.filter(s => {
      const p = s.workingDays ? (s.presentDays / s.workingDays) * 100 : 0;
      if (q.attMin && p < Number(q.attMin)) return false;
      if (q.attMax && p > Number(q.attMax)) return false;
      return true;
    });
  }
  return list;
}


// ---------------- CSV helpers ----------------
function parseCsv(text) {
  const rows = []; let row = [], cur = '', inQ = false;
  text = String(text || '').replace(/^\ufeff/, '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"' && text[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') inQ = false;
      else cur += c;
    } else if (c === '"') inQ = true;
    else if (c === ',') { row.push(cur); cur = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cur); cur = '';
      if (row.some(v => String(v).trim() !== '')) rows.push(row);
      row = [];
    } else cur += c;
  }
  row.push(cur);
  if (row.some(v => String(v).trim() !== '')) rows.push(row);
  return rows;
}
function csvCell(v) { v = v === null || v === undefined ? '' : String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }
function toCsv(rows) { return rows.map(r => r.map(csvCell).join(',')).join('\n'); }

// ---------------- Shala Darpan sheet parsing (Layout A + B) ----------------
const SD_A_MAP = { 'H': 'Hindi', 'E': 'English', 'M': 'Maths', 'SST': 'Social Science', 'Science': 'Science' };
function normSubjectName(name) {
  let n = String(name || '').trim();
  n = n.replace(/\s*\((science|arts|commerce) stream\)\s*/i, '').replace(/\s*\(compulsory\)\s*/i, ' (Compulsory)').trim();
  return n;
}
function parseSdSheet(text) {
  const rows = parseCsv(text);
  if (rows.length < 2) throw new Error('Sheet me rows nahi mili.');
  const header = rows[0].map(h => String(h).trim());
  const lower = header.map(h => h.toLowerCase());
  const srnoIdx = header.findIndex(h => h === 'SRNO');
  if (srnoIdx < 0) throw new Error('SRNO column nahi mila.');
  const nameIdx = lower.findIndex(h => h.includes('student') && h.includes('name'));
  const isB = lower.some(h => h.startsWith('lang1'));
  const out = [];
  if (!isB) {
    // Layout A: fixed columns + Subject/OPT pair + HPE/Art/WorkExp
    const colFor = {};
    header.forEach((h, i) => {
      const m = h.match(/^([A-Za-z]+)_Mcq\/Wr\.Marks$/);
      if (m && SD_A_MAP[m[1]]) colFor[SD_A_MAP[m[1]]] = i;
      if (/^OPT_Mcq/i.test(h)) colFor['__OPT__'] = i;
      if (h === 'Subject') colFor['__SUBJ__'] = i;
      if (h === 'Health & Physical Education') colFor['Health & Physical Education'] = i;
      if (h === 'Art Education') colFor['Art Education'] = i;
      if (/^WorkExp/i.test(h)) colFor['WorkExp.'] = i;
    });
    for (const r of rows.slice(1)) {
      const srno = Number(r[srnoIdx]); if (!srno) continue;
      const marks = {};
      for (const [sub, idx] of Object.entries(colFor)) {
        if (sub.startsWith('__')) continue;
        const v = String(r[idx] === undefined ? '' : r[idx]).trim();
        if (v !== '') marks[sub] = Number(v);
      }
      if (colFor['__OPT__'] !== undefined && colFor['__SUBJ__'] !== undefined) {
        const v = String(r[colFor['__OPT__']] || '').trim();
        const subName = normSubjectName(r[colFor['__SUBJ__']]);
        if (v !== '' && subName) marks[subName] = Number(v);
      }
      out.push({ srno, name: nameIdx >= 0 ? r[nameIdx] : '', marks });
    }
    return { layout: 'A', rows: out };
  }
  // Layout B: Lang1/Lang2 name+marks, repeated Subject + OPTn pairs
  const pairs = []; // {nameIdx, marksIdx}
  header.forEach((h, i) => {
    if (/^Lang\d/i.test(h) && !/Marks/i.test(h)) {
      const mi = header.findIndex((x, j) => j > i && new RegExp('^' + h.split('/')[0] + '_Mcq', 'i').test(x));
      if (mi >= 0) pairs.push({ nameIdx: i, marksIdx: mi });
    }
    if (h === 'Subject') {
      const mi = header.findIndex((x, j) => j > i && /^OPT\d*_Mcq/i.test(x));
      if (mi >= 0) pairs.push({ nameIdx: i, marksIdx: mi });
    }
    if (/^Lang2\/OPT1/i.test(h)) { /* handled as Lang pair above */ }
  });
  for (const r of rows.slice(1)) {
    const srno = Number(r[srnoIdx]); if (!srno) continue;
    const marks = {};
    for (const p of pairs) {
      const subName = normSubjectName(r[p.nameIdx]);
      const v = String(r[p.marksIdx] === undefined ? '' : r[p.marksIdx]).trim();
      if (v !== '' && subName) marks[subName] = Number(v);
    }
    out.push({ srno, name: nameIdx >= 0 ? r[nameIdx] : '', marks });
  }
  return { layout: 'B', rows: out };
}

// Minimal XLSX reader (zip + shared strings + first sheet), enough for SD sheets.
const zlib = require('zlib');
function unzipEntries(buf) {
  const entries = {};
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i--) { if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; } }
  if (eocd < 0) throw new Error('XLSX padhi nahi ja saki.');
  let off = buf.readUInt32LE(eocd + 16);
  while (off < buf.length && buf.readUInt32LE(off) === 0x02014b50) {
    const method = buf.readUInt16LE(off + 10);
    const csize = buf.readUInt32LE(off + 20);
    const nlen = buf.readUInt16LE(off + 28), elen = buf.readUInt16LE(off + 30), clen = buf.readUInt16LE(off + 32);
    const name = buf.toString('utf8', off + 46, off + 46 + nlen);
    const lho = buf.readUInt32LE(off + 42);
    const lnlen = buf.readUInt16LE(lho + 26), lelen = buf.readUInt16LE(lho + 28);
    const dataStart = lho + 30 + lnlen + lelen;
    const raw = buf.slice(dataStart, dataStart + csize);
    entries[name] = method === 8 ? zlib.inflateRawSync(raw) : raw;
    off += 46 + nlen + elen + clen;
  }
  return entries;
}
function xlsxToCsvText(b64) {
  const buf = Buffer.from(b64, 'base64');
  const entries = unzipEntries(buf);
  const strings = [];
  const ss = entries['xl/sharedStrings.xml'];
  if (ss) {
    const xml = ss.toString('utf8');
    for (const m of xml.matchAll(/<si>([\s\S]*?)<\/si>/g)) {
      strings.push([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(x => x[1].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')).join(''));
    }
  }
  const sheetName = Object.keys(entries).find(k => /xl\/worksheets\/sheet1\.xml$/.test(k)) || Object.keys(entries).find(k => k.startsWith('xl/worksheets/'));
  const xml = entries[sheetName].toString('utf8');
  const rows = [];
  for (const rm of xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells = {}; let max = -1;
    for (const cm of rm[1].matchAll(/<c r="([A-Z]+)\d+"([^>]*)>(?:<v>([\s\S]*?)<\/v>|<is><t[^>]*>([\s\S]*?)<\/t><\/is>)?<\/c>/g)) {
      let col = 0; for (const ch of cm[1]) col = col * 26 + (ch.charCodeAt(0) - 64);
      col -= 1;
      let val = cm[3] !== undefined ? cm[3] : (cm[4] !== undefined ? cm[4] : '');
      if (/t="s"/.test(cm[2])) val = strings[Number(val)] || '';
      cells[col] = String(val).replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
      if (col > max) max = col;
    }
    const row = []; for (let i = 0; i <= max; i++) row.push(cells[i] || '');
    rows.push(row);
  }
  return toCsv(rows);
}

function sdTemplateCsv(examLike, classNum, section, students, boardRolls) {
  const isB = classNum >= 11;
  const rows = [];
  if (!isB) {
    rows.push(['SrNo', 'SRNO', 'Student Name', 'H_Mcq/Wr.Marks', 'E_Mcq/Wr.Marks', 'M_Mcq/Wr.Marks', 'SST_Mcq/Wr.Marks', 'Science_Mcq/Wr.Marks', 'Subject', 'OPT_Mcq/Wr.Marks', 'Health & Physical Education', 'Art Education', 'WorkExp.']);
    students.forEach((s, i) => rows.push([i + 1, s.srno, s.name, '', '', '', '', '', classNum >= 9 && classNum <= 10 ? 'Sanskrit' : '', '', '', '', '']));
  } else {
    rows.push(['SrNo', 'SRNO', 'Student Name', 'Lang1', 'Lang1_Mcq/Wr.Marks', 'Lang2/OPT1', 'Lang2_Mcq/Wr.Marks', 'Subject', 'OPT1_Mcq/Wr.Marks', 'Subject', 'OPT2_Mcq/Wr.Marks', 'Subject', 'OPT3_Mcq/Wr.Marks']);
    students.forEach((s, i) => rows.push([i + 1, s.srno, s.name, 'English (Compulsory)', '', 'Hindi (Compulsory)', '', 'Physics (Science Stream)', '', 'Chemistry (Science Stream)', '', 'Biology (Science Stream)', '']));
  }
  if (boardRolls) { /* board template keeps the same portal layout; rolls are matched by SRNO on the site */ }
  return toCsv(rows);
}


// ---------------- Routes ----------------
async function handle(req, res) {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  const q = Object.fromEntries(url.searchParams.entries());
  try {
    if (p === '/' || p === '/index.html') {
      const html = fs.readFileSync(path.join(__dirname, 'public', 'index.html'));
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); return res.end(html);
    }
    if (p === '/api/home') return send(res, 200, { content: db().homeContent, school: db().school, staff: db().teachers.filter(t => t.showOnHome !== false).map(t => ({ name: t.name, post: t.post, subject: t.subject })), build: BUILD });

    if (p === '/api/login' && req.method === 'POST') {
      const b = await readBody(req);
      const loginId = String(b.loginId || '').trim();
      const pw = String(b.password || '');
      const s = db();
      const staff = s.staffAccounts.find(a => a.loginId.toLowerCase() === loginId.toLowerCase());
      if (staff) {
        if (!staff.active) return send(res, 403, { error: 'This login has been deactivated by the school.' });
        if (!staff.passwordHash) return send(res, 403, { error: 'Is staff login ka password Admin ne abhi set nahi kiya hai. Admin se sampark karein.' });
        if (!checkPw(pw, staff.passwordHash)) return send(res, 401, { error: 'Galat password. Dobara koshish karein.' });
        const token = crypto.randomBytes(18).toString('hex');
        sessions.set(token, { role: staff.role, loginId: staff.loginId, name: staff.name, mustChange: !!staff.mustChange });
        res.setHeader('Set-Cookie', 'sd_session=' + token + '; Path=/; HttpOnly; SameSite=Lax');
        return send(res, 200, { role: staff.role, name: staff.name, loginId: staff.loginId, mustChange: !!staff.mustChange });
      }
      const parent = s.parents.find(a => a.loginId.toLowerCase() === loginId.toLowerCase());
      if (parent) {
        if (!parent.active) return send(res, 403, { error: 'This login has been deactivated by the school.' });
        if (!checkPw(pw, parent.passwordHash)) return send(res, 401, { error: 'Galat password. Dobara koshish karein.' });
        const token = crypto.randomBytes(18).toString('hex');
        sessions.set(token, { role: 'parent', loginId: parent.loginId, name: parent.guardianName, children: parent.children.slice() });
        res.setHeader('Set-Cookie', 'sd_session=' + token + '; Path=/; HttpOnly; SameSite=Lax');
        return send(res, 200, { role: 'parent', name: parent.guardianName, loginId: parent.loginId, mustChange: !!parent.mustChange });
      }
      return send(res, 401, { error: 'Login ID ya password galat hai.' });
    }
    if (p === '/api/logout' && req.method === 'POST') {
      const cookie = req.headers.cookie || ''; const m = cookie.match(/sd_session=([a-zA-Z0-9-]+)/);
      if (m) sessions.delete(m[1]);
      res.setHeader('Set-Cookie', 'sd_session=; Path=/; Max-Age=0');
      return send(res, 200, { ok: true });
    }
    if (p === '/api/me') {
      const u = auth(req); if (!u) return send(res, 401, { error: 'Login required' });
      return send(res, 200, { role: u.role, name: u.name, loginId: u.loginId, mustChange: !!u.mustChange, currentSession: db().currentSession, sessions: db().sessions });
    }
    if (p === '/api/change-password' && req.method === 'POST') {
      const u = requireRole(req, res); if (!u) return;
      const b = await readBody(req);
      const s = db();
      const acct = u.role === 'parent' ? s.parents.find(a => a.loginId === u.loginId) : s.staffAccounts.find(a => a.loginId === u.loginId);
      if (!acct || !checkPw(String(b.current || ''), acct.passwordHash)) return send(res, 400, { error: 'Current password galat hai.' });
      if (!b.next || String(b.next).length < 6) return send(res, 400, { error: 'Naya password kam se kam 6 characters ka ho.' });
      acct.passwordHash = hashPw(String(b.next)); acct.mustChange = false; u.mustChange = false;
      if (u.role === 'admin') { try { fs.unlinkSync(path.join(store.DATA_DIR, 'OWNER-SETUP.txt')); } catch (e) {} }
      store.save(); audit(u.loginId, 'Password changed');
      return send(res, 200, { ok: true });
    }

    // ---------- Staff: dashboard / students ----------
    if (p === '/api/dashboard') {
      const u = requireRole(req, res, ['admin', 'teacher']); if (!u) return;
      const list = filterStudents(q);
      const all = q.session && q.session !== db().currentSession ? list : activeStudents();
      const attPcts = list.map(s => s.workingDays ? (s.presentDays / s.workingDays) * 100 : 0);
      const avgAtt = attPcts.length ? Math.round(attPcts.reduce((a, b) => a + b, 0) / attPcts.length * 10) / 10 : 0;
      const byClass = {}; const byCat = {}; const byGender = { M: 0, F: 0 };
      for (const s of list) {
        byClass[s.classNum] = (byClass[s.classNum] || 0) + 1;
        byCat[s.category] = (byCat[s.category] || 0) + 1;
        byGender[s.gender] = (byGender[s.gender] || 0) + 1;
      }
      const atRisk = list.map(s => ({ srno: s.srno, name: s.name, classNum: s.classNum, pct: s.workingDays ? Math.round(s.presentDays / s.workingDays * 1000) / 10 : 0 })).filter(x => x.pct < 75).sort((a, b) => a.pct - b.pct).slice(0, 40);
      return send(res, 200, {
        total: list.length, totalAll: activeStudents().length, boys: byGender.M || 0, girls: byGender.F || 0,
        staff: db().teachers.length, avgAtt, below75: attPcts.filter(x => x < 75).length, below50: attPcts.filter(x => x < 50).length,
        byClass, byCat, atRisk, reports: reportTables(list),
        dataQuality: { missingAadhaar: list.filter(s => !s.nicId).length, missingAddress: list.filter(s => !s.address).length, missingPen: list.filter(s => !s.pen).length, bpl: list.filter(s => s.bpl === 'Y').length, cwsn: list.filter(s => s.cwsn === 'Y').length }
      });
    }
    if (p === '/api/students' && req.method === 'GET') {
      const u = requireRole(req, res, ['admin', 'teacher']); if (!u) return;
      const list = filterStudents(q).slice().sort((a, b) => a.classNum - b.classNum || String(a.roll).localeCompare(String(b.roll), undefined, { numeric: true }));
      return send(res, 200, { total: list.length, students: list });
    }
    if (p === '/api/students' && req.method === 'POST') {
      const u = requireRole(req, res, ['admin']); if (!u) return;
      const b = await readBody(req);
      const s = db();
      if (s.students.some(x => x.srno === Number(b.srno)) || s.removedStudents.some(x => x.srno === Number(b.srno))) return send(res, 400, { error: 'Is SRNO ka student pehle se hai.' });
      const st = { srno: Number(b.srno), name: b.name || '', classNum: Number(b.classNum) || 1, section: b.section || 'A', gender: b.gender || 'M', dob: b.dob || '', doa: b.doa || '', father: b.father || '', mother: b.mother || '', category: b.category || 'GEN', religion: b.religion || '', mobile: b.mobile || '', address: b.address || '', roll: b.roll || '', bpl: 'N', cwsn: 'N', income: '', distance: '', pen: '', nicId: '', aadhaarAuth: '', workingDays: 0, presentDays: 0, status: 'active', removedReason: '', removedDate: '', tcNumber: '', removedNote: '', remark: '' };
      s.students.push(st);
      if (st.mobile) {
        let par = s.parents.find(x => x.mobile === st.mobile);
        if (!par) { par = { loginId: 'HODA' + st.srno, guardianName: st.father, mobile: st.mobile, children: [], tempPassword: dobPw(st.dob), passwordHash: hashPw(dobPw(st.dob)), active: true, mustChange: false }; s.parents.push(par); }
        if (!par.children.includes(st.srno)) par.children.push(st.srno);
      }
      store.save(); audit(u.loginId, 'Student added SRNO ' + st.srno);
      return send(res, 200, { ok: true });
    }
    const stuMatch = p.match(/^\/api\/student\/(\d+)(\/(remove|restore|remark))?$/);
    if (stuMatch) {
      const srno = Number(stuMatch[1]); const action = stuMatch[3];
      if (req.method === 'GET') {
        const u = requireRole(req, res); if (!u) return;
        const st = studentBySrno(srno); if (!st) return send(res, 404, { error: 'Student nahi mila.' });
        if (u.role === 'parent' && !u.children.includes(srno)) return send(res, 403, { error: 'Ye student aapke account se linked nahi hai.' });
        const enrol = db().enrolments.filter(e => e.srno === srno).sort((a, b) => a.session.localeCompare(b.session));
        return send(res, 200, { student: st, enrolments: enrol });
      }
      if (req.method === 'PUT' && !action) {
        const u = requireRole(req, res, ['admin', 'teacher']); if (!u) return;
        const b = await readBody(req); const st = db().students.find(x => x.srno === srno);
        if (!st) return send(res, 404, { error: 'Student nahi mila.' });
        for (const k of ['name', 'classNum', 'section', 'gender', 'dob', 'doa', 'father', 'mother', 'category', 'religion', 'mobile', 'address', 'roll', 'bpl', 'cwsn', 'income', 'pen', 'nicId', 'aadhaarAuth']) if (b[k] !== undefined) st[k] = b[k];
        store.save(); audit(u.loginId, 'Student updated SRNO ' + srno);
        return send(res, 200, { ok: true });
      }
      if (req.method === 'POST' && action === 'remark') {
        const u = requireRole(req, res, ['admin', 'teacher']); if (!u) return;
        const b = await readBody(req); const st = db().students.find(x => x.srno === srno);
        if (!st) return send(res, 404, { error: 'Student nahi mila.' });
        st.remark = String(b.remark || ''); store.save();
        return send(res, 200, { ok: true });
      }
      if (req.method === 'POST' && action === 'remove') {
        const u = requireRole(req, res, ['admin', 'teacher']); if (!u) return;
        const b = await readBody(req); const s = db();
        const idx = s.students.findIndex(x => x.srno === srno);
        if (idx < 0) return send(res, 404, { error: 'Student nahi mila.' });
        const st = s.students.splice(idx, 1)[0];
        st.status = 'removed'; st.removedReason = b.reason || 'TC Issued'; st.removedDate = b.date || ''; st.tcNumber = b.tcNumber || ''; st.removedNote = b.note || ''; st.historical = false;
        s.removedStudents.push(st);
        for (const par of s.parents) if (par.children.includes(srno) && !par.children.some(c => s.students.some(x => x.srno === c))) par.active = false;
        store.save(); audit(u.loginId, 'Student removed SRNO ' + srno + ' (' + st.removedReason + ')');
        return send(res, 200, { ok: true });
      }
      if (req.method === 'POST' && action === 'restore') {
        const u = requireRole(req, res, ['admin']); if (!u) return;
        const s = db();
        const idx = s.removedStudents.findIndex(x => x.srno === srno);
        if (idx < 0) return send(res, 404, { error: 'Removed record nahi mila.' });
        const st = s.removedStudents.splice(idx, 1)[0];
        if (st.historical && !st.dob) return send(res, 400, { error: 'Ye historical record hai — iske paas puri student details nahi hain. Pehle Students me iska record banayein.' });
        st.status = 'active'; st.removedReason = ''; st.removedDate = ''; st.tcNumber = ''; st.removedNote = ''; delete st.historical;
        if (!st.workingDays && st.workingDays !== 0) { st.workingDays = 0; st.presentDays = 0; }
        s.students.push(st);
        if (st.mobile) {
          let par = s.parents.find(x => x.children.includes(srno));
          if (!par) { par = { loginId: 'HODA' + srno, guardianName: st.father, mobile: st.mobile, children: [srno], tempPassword: dobPw(st.dob), passwordHash: hashPw(dobPw(st.dob)), active: true, mustChange: false }; s.parents.push(par); }
          par.active = true;
        }
        store.save(); audit(u.loginId, 'Student restored SRNO ' + srno);
        return send(res, 200, { ok: true });
      }
    }
    if (p === '/api/removed') {
      const u = requireRole(req, res, ['admin', 'teacher']); if (!u) return;
      const list = db().removedStudents.slice().sort((a, b) => String(b.removedDate).localeCompare(String(a.removedDate)));
      return send(res, 200, { total: list.length, tc: list.filter(x => x.removedReason === 'TC Issued').length, nso: list.filter(x => x.removedReason.startsWith('NSO')).length, students: list });
    }
    // ---------- Teachers ----------
    if (p === '/api/teachers') {
      const u = requireRole(req, res, ['admin', 'teacher']); if (!u) return;
      if (req.method === 'GET') return send(res, 200, { teachers: db().teachers });
      const a = requireRole(req, res, ['admin']); if (!a) return;
      const b = await readBody(req);
      if (req.method === 'POST') {
        if (db().teachers.some(t => t.employeeId === b.employeeId)) return send(res, 400, { error: 'Employee ID pehle se hai.' });
        db().teachers.push({ name: b.name || '', employeeId: b.employeeId || '', fatherName: '', gender: b.gender || '', dob: '', post: b.post || '', subject: b.subject || '', joining: '', address: '', mobileMasked: '', bloodGroup: '', showOnHome: true });
      } else if (req.method === 'PUT') {
        const t = db().teachers.find(x => x.employeeId === b.employeeId); if (!t) return send(res, 404, { error: 'Teacher nahi mila.' });
        for (const k of ['name', 'post', 'subject', 'gender', 'showOnHome']) if (b[k] !== undefined) t[k] = b[k];
      } else if (req.method === 'DELETE') {
        const s = db(); s.teachers = s.teachers.filter(x => x.employeeId !== b.employeeId);
      }
      store.save(); audit(a.loginId, 'Teachers updated');
      return send(res, 200, { ok: true });
    }
    // ---------- PEN ----------
    if (p === '/api/pen-sheet') {
      const u = requireRole(req, res, ['admin', 'teacher']); if (!u) return;
      const cls = Number(q.classNum || 0);
      let list = activeStudents().slice().sort((a, b) => a.classNum - b.classNum || String(a.roll).localeCompare(String(b.roll), undefined, { numeric: true }));
      if (cls) list = list.filter(s => s.classNum === cls);
      if (q.section) list = list.filter(s => s.section === q.section);
      const missing = activeStudents().filter(s => !s.pen).map(s => ({ srno: s.srno, name: s.name, classNum: s.classNum }));
      return send(res, 200, { total: list.length, withPen: list.filter(s => s.pen).length, students: list.map(s => ({ srno: s.srno, name: s.name, classNum: s.classNum, section: s.section, gender: s.gender, father: s.father, mother: s.mother, dob: s.dob, pen: s.pen, nicId: s.nicId, aadhaarAuth: s.aadhaarAuth })), missing });
    }
    if (p === '/api/pen-save' && req.method === 'POST') {
      const u = requireRole(req, res, ['admin', 'teacher']); if (!u) return;
      const b = await readBody(req);
      const seen = new Map();
      for (const s of db().students) if (s.pen) seen.set(s.pen, s.srno);
      for (const row of b.rows || []) {
        const pen = String(row.pen || '').trim();
        if (pen && !/^\d{11}$/.test(pen)) return send(res, 400, { error: 'PEN 11 digits ka hona chahiye (SRNO ' + row.srno + ').' });
        if (pen && seen.has(pen) && seen.get(pen) !== Number(row.srno)) return send(res, 400, { error: 'Ye PEN pehle se SRNO ' + seen.get(pen) + ' ke paas hai.' });
      }
      for (const row of b.rows || []) {
        const st = db().students.find(x => x.srno === Number(row.srno)); if (!st) continue;
        st.pen = String(row.pen || '').trim(); st.nicId = String(row.nicId || '').trim(); st.aadhaarAuth = String(row.aadhaarAuth || '').trim();
      }
      store.save(); audit(u.loginId, 'PEN sheet saved');
      return send(res, 200, { ok: true });
    }


    // ---------- Exams / Results ----------
    const DEFAULT_SUBJECTS = {
      9: [['Hindi', 100], ['English', 100], ['Maths', 100], ['Social Science', 100], ['Science', 100], ['Sanskrit', 100]],
      10: [['Hindi', 100], ['English', 100], ['Maths', 100], ['Social Science', 100], ['Science', 100], ['Sanskrit', 100]],
      11: [['English (Compulsory)', 100], ['Hindi (Compulsory)', 100], ['Physics', 100], ['Chemistry', 100], ['Biology', 100]],
      12: [['English (Compulsory)', 100], ['Hindi (Compulsory)', 100], ['Physics', 100], ['Chemistry', 100], ['Biology', 100]]
    };
    if (p === '/api/default-subjects') {
      const u = requireRole(req, res, ['admin', 'teacher']); if (!u) return;
      const d = DEFAULT_SUBJECTS[Number(q.classNum)] || [['Hindi', 100], ['English', 100], ['Maths', 100], ['Science', 100], ['Social Science', 100]];
      return send(res, 200, { subjects: d.map(([name, max]) => ({ name, max })) });
    }
    if (p === '/api/exams' && req.method === 'GET') {
      const u = requireRole(req, res, ['admin', 'teacher']); if (!u) return;
      const list = db().exams.map(e => ({ ...e, marksEntered: db().marks.filter(m => m.examId === e.id).length, studentCount: activeStudents().filter(s => s.classNum === e.classNum).length }));
      return send(res, 200, { exams: list });
    }
    if (p === '/api/exams' && req.method === 'POST') {
      const u = requireRole(req, res, ['admin', 'teacher']); if (!u) return;
      const b = await readBody(req); const s = db();
      const id = Math.max(0, ...s.exams.map(e => e.id)) + 1;
      const exam = { id, name: b.name || 'Exam', classNum: Number(b.classNum) || 1, section: b.section || 'A', session: b.session || s.currentSession, published: false, subjects: (b.subjects && b.subjects.length ? b.subjects : (DEFAULT_SUBJECTS[Number(b.classNum)] || []).map(([name, max]) => ({ name, max }))) };
      s.exams.push(exam); store.save(); audit(u.loginId, 'Exam created: ' + exam.name);
      return send(res, 200, { ok: true, exam });
    }
    const examMatch = p.match(/^\/api\/exams\/(\d+)(\/(publish|grid|marks|delete-results|template))?$/);
    if (examMatch) {
      const exam = db().exams.find(e => e.id === Number(examMatch[1]));
      if (!exam) return send(res, 404, { error: 'Exam nahi mila.' });
      const action = examMatch[3];
      if (req.method === 'DELETE' && !action) {
        const u = requireRole(req, res, ['admin']); if (!u) return;
        const b = await readBody(req);
        if (String(b.confirmName || '') !== exam.name) return send(res, 400, { error: 'Exam ka exact naam type karein.' });
        const s = db();
        const marksCount = s.marks.filter(m => m.examId === exam.id).length;
        s.marks = s.marks.filter(m => m.examId !== exam.id);
        s.documents = s.documents.filter(d => d.examId !== exam.id);
        s.exams = s.exams.filter(e => e.id !== exam.id);
        store.save(); audit(u.loginId, 'Exam DELETED: ' + exam.name + ' (' + marksCount + ' marks)');
        return send(res, 200, { ok: true });
      }
      if (action === 'publish' && req.method === 'POST') {
        const u = requireRole(req, res, ['admin']); if (!u) return;
        const b = await readBody(req); exam.published = !!b.published; store.save(); audit(u.loginId, 'Exam ' + (exam.published ? 'published' : 'unpublished') + ': ' + exam.name);
        return send(res, 200, { ok: true });
      }
      if (action === 'grid' && req.method === 'GET') {
        const u = requireRole(req, res, ['admin', 'teacher']); if (!u) return;
        const studs = activeStudents().filter(s => s.classNum === exam.classNum).sort((a, b) => String(a.roll).localeCompare(String(b.roll), undefined, { numeric: true }));
        return send(res, 200, { exam, students: studs.map(s => ({ srno: s.srno, name: s.name, roll: s.roll, result: computeResult(exam, s.srno) })) });
      }
      if (action === 'marks' && req.method === 'POST') {
        const u = requireRole(req, res, ['admin', 'teacher']); if (!u) return;
        const b = await readBody(req); const s = db();
        for (const row of b.rows || []) {
          for (const [sub, val] of Object.entries(row.marks || {})) {
            const subj = exam.subjects.find(x => x.name === sub);
            if (!subj) continue;
            const existing = s.marks.find(m => m.examId === exam.id && m.srno === Number(row.srno) && m.subject === sub);
            if (val === null || val === '' || val === undefined) { if (existing) s.marks.splice(s.marks.indexOf(existing), 1); continue; }
            const v = Number(val);
            if (isNaN(v) || v < 0 || v > subj.max) return send(res, 400, { error: 'Marks limit se bahar: SRNO ' + row.srno + ' ' + sub + ' (max ' + subj.max + ')' });
            if (existing) existing.marks = v; else s.marks.push({ examId: exam.id, srno: Number(row.srno), subject: sub, marks: v });
          }
        }
        store.save(); audit(u.loginId, 'Marks saved: ' + exam.name);
        return send(res, 200, { ok: true });
      }
      if (action === 'delete-results' && req.method === 'POST') {
        const u = requireRole(req, res, ['admin']); if (!u) return;
        const s = db();
        const n = s.marks.filter(m => m.examId === exam.id).length;
        s.marks = s.marks.filter(m => m.examId !== exam.id);
        const wasPublished = exam.published; exam.published = false;
        store.save(); audit(u.loginId, 'Exam results deleted + unpublished: ' + exam.name + ' (' + n + ' marks)');
        return send(res, 200, { ok: true, deleted: n, unpublished: wasPublished });
      }
      if (action === 'template' && req.method === 'GET') {
        const u = requireRole(req, res, ['admin', 'teacher']); if (!u) return;
        const studs = activeStudents().filter(s => s.classNum === exam.classNum && s.section === exam.section).sort((a, b) => String(a.roll).localeCompare(String(b.roll), undefined, { numeric: true }));
        res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="blank-sheet-class-' + exam.classNum + '.csv"' });
        return res.end(sdTemplateCsv(exam, exam.classNum, exam.section, studs, false));
      }
    }
    if (p === '/api/student-result-delete' && req.method === 'POST') {
      const u = requireRole(req, res, ['admin']); if (!u) return;
      const b = await readBody(req); const s = db();
      s.marks = s.marks.filter(m => !(m.examId === Number(b.examId) && m.srno === Number(b.srno)));
      store.save(); audit(u.loginId, 'One student result deleted: exam ' + b.examId + ' SRNO ' + b.srno);
      return send(res, 200, { ok: true });
    }
    // ---------- Board Results ----------
    if (p === '/api/board-exams' && req.method === 'GET') {
      const u = requireRole(req, res, ['admin', 'teacher']); if (!u) return;
      const list = db().boardExams.map(e => ({ ...e, rollCount: db().boardEntries.filter(x => x.boardExamId === e.id && x.boardRollNo).length, resultCount: db().boardEntries.filter(x => x.boardExamId === e.id && x.marks && Object.values(x.marks).some(v => v !== null && v !== undefined)).length }));
      return send(res, 200, { boardExams: list });
    }
    if (p === '/api/board-exams' && req.method === 'POST') {
      const u = requireRole(req, res, ['admin']); if (!u) return;
      const b = await readBody(req); const s = db();
      if (![5, 8, 10, 12].includes(Number(b.classNum))) return send(res, 400, { error: 'Board classes sirf 5, 8, 10, 12 hain.' });
      if (s.boardExams.some(e => e.classNum === Number(b.classNum) && e.session === (b.session || s.currentSession))) return send(res, 400, { error: 'Is class ka board exam is session me pehle se hai.' });
      const id = Math.max(0, ...s.boardExams.map(e => e.id)) + 1;
      const be = { id, classNum: Number(b.classNum), session: b.session || s.currentSession, published: false, subjects: b.subjects && b.subjects.length ? b.subjects : (Number(b.classNum) === 12 ? DEFAULT_SUBJECTS[12].map(([name, max]) => ({ name, max })) : [['Hindi', 100], ['English', 100], ['Mathematics', 100], ['Science', 100], ['Social Science', 100], ['Sanskrit', 100]].map(([name, max]) => ({ name, max }))) };
      s.boardExams.push(be);
      for (const st of activeStudents().filter(x => x.classNum === be.classNum)) s.boardEntries.push({ boardExamId: id, srno: st.srno, boardRollNo: '', marks: {} });
      store.save(); audit(u.loginId, 'Board exam created: Class ' + be.classNum);
      return send(res, 200, { ok: true, boardExam: be });
    }
    const boardMatch = p.match(/^\/api\/board-exams\/(\d+)(\/(publish|grid|rolls|marks|delete-results|template))?$/);
    if (boardMatch) {
      const be = db().boardExams.find(e => e.id === Number(boardMatch[1]));
      if (!be) return send(res, 404, { error: 'Board exam nahi mila.' });
      const action = boardMatch[3];
      if (req.method === 'DELETE' && !action) {
        const u = requireRole(req, res, ['admin']); if (!u) return;
        const b = await readBody(req);
        const label = 'Class ' + be.classNum + ' Board ' + be.session;
        if (String(b.confirmName || '') !== label) return send(res, 400, { error: 'Exact label type karein: ' + label });
        const s = db();
        s.boardEntries = s.boardEntries.filter(x => x.boardExamId !== be.id);
        s.boardExams = s.boardExams.filter(e => e.id !== be.id);
        store.save(); audit(u.loginId, 'Board exam DELETED: ' + label);
        return send(res, 200, { ok: true });
      }
      if (action === 'publish' && req.method === 'POST') {
        const u = requireRole(req, res, ['admin']); if (!u) return;
        const b = await readBody(req); be.published = !!b.published; store.save(); audit(u.loginId, 'Board exam ' + (be.published ? 'published' : 'unpublished') + ': Class ' + be.classNum);
        return send(res, 200, { ok: true });
      }
      if (action === 'grid' && req.method === 'GET') {
        const u = requireRole(req, res, ['admin', 'teacher']); if (!u) return;
        const studs = activeStudents().filter(s => s.classNum === be.classNum).sort((a, b) => a.name.localeCompare(b.name));
        return send(res, 200, { boardExam: be, students: studs.map(s => ({ srno: s.srno, name: s.name, result: boardResult(be, s.srno) || { boardRollNo: '', marks: {}, hasResult: false } })) });
      }
      if ((action === 'rolls' || action === 'marks') && req.method === 'POST') {
        const u = requireRole(req, res, ['admin', 'teacher']); if (!u) return;
        const b = await readBody(req); const s = db();
        for (const row of b.rows || []) {
          let e = s.boardEntries.find(x => x.boardExamId === be.id && x.srno === Number(row.srno));
          if (!e) { e = { boardExamId: be.id, srno: Number(row.srno), boardRollNo: '', marks: {} }; s.boardEntries.push(e); }
          if (action === 'rolls') {
            const roll = String(row.boardRollNo || '').trim();
            if (roll && s.boardEntries.some(x => x.boardExamId === be.id && x.boardRollNo === roll && x.srno !== Number(row.srno))) return send(res, 400, { error: 'Roll number ' + roll + ' pehle se kisi aur ke paas hai.' });
            e.boardRollNo = roll;
          } else {
            for (const [sub, val] of Object.entries(row.marks || {})) {
              const subj = be.subjects.find(x => x.name === sub); if (!subj) continue;
              if (val === null || val === '') { delete e.marks[sub]; continue; }
              const v = Number(val);
              if (isNaN(v) || v < 0 || v > subj.max) return send(res, 400, { error: 'Marks limit se bahar: SRNO ' + row.srno + ' ' + sub });
              e.marks[sub] = v;
            }
          }
        }
        store.save(); audit(u.loginId, 'Board ' + action + ' saved: Class ' + be.classNum);
        return send(res, 200, { ok: true });
      }
      if (action === 'delete-results' && req.method === 'POST') {
        const u = requireRole(req, res, ['admin']); if (!u) return;
        for (const e of db().boardEntries.filter(x => x.boardExamId === be.id)) e.marks = {};
        const wasPublished = be.published; be.published = false;
        store.save(); audit(u.loginId, 'Board results deleted + unpublished: Class ' + be.classNum);
        return send(res, 200, { ok: true, unpublished: wasPublished });
      }
      if (action === 'template' && req.method === 'GET') {
        const u = requireRole(req, res, ['admin', 'teacher']); if (!u) return;
        const studs = activeStudents().filter(s => s.classNum === be.classNum).sort((a, b) => a.name.localeCompare(b.name));
        res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="blank-board-sheet-class-' + be.classNum + '.csv"' });
        return res.end(sdTemplateCsv(be, be.classNum, 'A', studs, true));
      }
    }
    // ---------- SD sheet parse/apply ----------
    if (p === '/api/sd-parse' && req.method === 'POST') {
      const u = requireRole(req, res, ['admin', 'teacher']); if (!u) return;
      const b = await readBody(req);
      let text = b.csvText || '';
      if (b.xlsxBase64) text = xlsxToCsvText(b.xlsxBase64);
      if (!text && b._raw) text = b._raw;
      const parsed = parseSdSheet(text);
      const exam = b.boardExamId ? db().boardExams.find(e => e.id === Number(b.boardExamId)) : db().exams.find(e => e.id === Number(b.examId));
      if (!exam) return send(res, 404, { error: 'Exam nahi mila.' });
      const rows = parsed.rows.map(r => {
        const st = activeStudents().find(s => s.srno === r.srno);
        const entry = b.boardExamId ? db().boardEntries.find(x => x.boardExamId === exam.id && x.srno === r.srno) : null;
        const unknownSubjects = Object.keys(r.marks).filter(sub => !exam.subjects.some(x => x.name === sub));
        return { srno: r.srno, name: r.name, matched: !!st, studentName: st ? st.name : '', boardRollNo: entry ? entry.boardRollNo : undefined, marks: r.marks, unknownSubjects };
      });
      return send(res, 200, { layout: parsed.layout, rows });
    }
    if (p === '/api/sd-apply' && req.method === 'POST') {
      const u = requireRole(req, res, ['admin', 'teacher']); if (!u) return;
      const b = await readBody(req); const s = db();
      if (b.boardExamId) {
        const be = s.boardExams.find(e => e.id === Number(b.boardExamId)); if (!be) return send(res, 404, { error: 'Board exam nahi mila.' });
        let applied = 0;
        for (const row of b.rows || []) {
          if (!row.matched) continue;
          let e = s.boardEntries.find(x => x.boardExamId === be.id && x.srno === Number(row.srno));
          if (!e) { e = { boardExamId: be.id, srno: Number(row.srno), boardRollNo: '', marks: {} }; s.boardEntries.push(e); }
          for (const [sub, val] of Object.entries(row.marks || {})) if (be.subjects.some(x => x.name === sub) && val !== null && val !== '') { e.marks[sub] = Number(val); applied++; }
        }
        store.save(); audit(u.loginId, 'SD board sheet applied: Class ' + be.classNum + ' (' + applied + ' cells)');
        return send(res, 200, { ok: true, applied });
      }
      const exam = s.exams.find(e => e.id === Number(b.examId)); if (!exam) return send(res, 404, { error: 'Exam nahi mila.' });
      for (const add of b.addSubjects || []) if (!exam.subjects.some(x => x.name === add.name)) exam.subjects.push({ name: add.name, max: Number(add.max) || 100 });
      let applied = 0;
      for (const row of b.rows || []) {
        if (!row.matched) continue;
        for (const [sub, val] of Object.entries(row.marks || {})) {
          if (!exam.subjects.some(x => x.name === sub) || val === null || val === '') continue;
          const existing = s.marks.find(m => m.examId === exam.id && m.srno === Number(row.srno) && m.subject === sub);
          if (existing) existing.marks = Number(val); else s.marks.push({ examId: exam.id, srno: Number(row.srno), subject: sub, marks: Number(val) });
          applied++;
        }
      }
      store.save(); audit(u.loginId, 'SD sheet applied: ' + exam.name + ' (' + applied + ' cells)');
      return send(res, 200, { ok: true, applied });
    }


    // ---------- Attendance ----------
    if (p === '/api/attendance/daily' && req.method === 'GET') {
      const u = requireRole(req, res, ['admin', 'teacher']); if (!u) return;
      const studs = activeStudents().filter(s => s.classNum === Number(q.classNum)).sort((a, b) => a.name.localeCompare(b.name));
      const saved = db().dailyAttendance.find(d => d.classNum === Number(q.classNum) && d.date === q.date);
      return send(res, 200, { students: studs.map(s => ({ srno: s.srno, name: s.name, present: saved ? saved.marks[String(s.srno)] !== 'A' : true })) });
    }
    if (p === '/api/attendance/daily' && req.method === 'POST') {
      const u = requireRole(req, res, ['admin', 'teacher']); if (!u) return;
      const b = await readBody(req); const s = db();
      let rec = s.dailyAttendance.find(d => d.classNum === Number(b.classNum) && d.date === b.date);
      if (!rec) { rec = { classNum: Number(b.classNum), date: b.date, marks: {} }; s.dailyAttendance.push(rec); }
      rec.marks = b.marks || {};
      store.save(); audit(u.loginId, 'Daily attendance saved: Class ' + b.classNum + ' ' + b.date);
      return send(res, 200, { ok: true });
    }
    if (p === '/api/attendance/monthly' && req.method === 'GET') {
      const u = requireRole(req, res, ['admin', 'teacher']); if (!u) return;
      const studs = activeStudents().filter(s => s.classNum === Number(q.classNum)).sort((a, b) => a.name.localeCompare(b.name));
      const recs = db().monthlyAttendance.filter(m => m.month === q.month);
      return send(res, 200, { students: studs.map(s => { const r = recs.find(x => x.srno === s.srno); return { srno: s.srno, name: s.name, workingDays: r ? r.workingDays : '', presentDays: r ? r.presentDays : '' }; }) });
    }
    if (p === '/api/attendance/monthly' && req.method === 'POST') {
      const u = requireRole(req, res, ['admin', 'teacher']); if (!u) return;
      const b = await readBody(req); const s = db();
      for (const row of b.rows || []) {
        let r = s.monthlyAttendance.find(x => x.srno === Number(row.srno) && x.month === b.month);
        if (!r) { r = { srno: Number(row.srno), month: b.month, workingDays: 0, presentDays: 0 }; s.monthlyAttendance.push(r); }
        r.workingDays = Number(row.workingDays) || 0; r.presentDays = Number(row.presentDays) || 0;
      }
      store.save(); audit(u.loginId, 'Monthly attendance saved: ' + b.month);
      return send(res, 200, { ok: true });
    }
    // ---------- Accounts (Admin) ----------
    if (p === '/api/accounts') {
      const u = requireRole(req, res, ['admin']); if (!u) return;
      if (req.method === 'GET') {
        const parents = db().parents.map(par => ({ loginId: par.loginId, guardianName: par.guardianName, mobile: par.mobile, active: par.active, children: par.children.map(srno => { const st = studentBySrno(srno); return st ? { srno, name: st.name, classNum: st.classNum, status: st.status } : { srno, name: '(missing)', classNum: '', status: '' }; }) }));
        const staff = db().staffAccounts.map(a => ({ loginId: a.loginId, role: a.role, name: a.name, active: a.active, hasPassword: !!a.passwordHash }));
        return send(res, 200, { parents, staff });
      }
      const b = await readBody(req); const s = db();
      if (b.action === 'link') {
        const par = s.parents.find(x => x.loginId === b.loginId); const st = s.students.find(x => x.srno === Number(b.srno));
        if (!par || !st) return send(res, 404, { error: 'Parent ya student nahi mila.' });
        if (!par.children.includes(st.srno)) par.children.push(st.srno);
        par.active = true;
      } else if (b.action === 'unlink') {
        const par = s.parents.find(x => x.loginId === b.loginId); if (!par) return send(res, 404, { error: 'Parent nahi mila.' });
        par.children = par.children.filter(c => c !== Number(b.srno));
        if (!par.children.length) par.active = false;
      } else if (b.action === 'reset-parent') {
        const par = s.parents.find(x => x.loginId === b.loginId); if (!par) return send(res, 404, { error: 'Parent nahi mila.' });
        const child = s.students.find(x => x.srno === par.children[0]);
        par.passwordHash = hashPw(dobPw(child ? child.dob : '')); par.mustChange = false;
      } else if (b.action === 'set-staff-password') {
        const a = s.staffAccounts.find(x => x.loginId === b.loginId); if (!a) return send(res, 404, { error: 'Staff account nahi mila.' });
        if (!b.password || String(b.password).length < 6) return send(res, 400, { error: 'Password kam se kam 6 characters ka ho.' });
        a.passwordHash = hashPw(String(b.password)); a.mustChange = true;
      } else if (b.action === 'set-active') {
        const par = s.parents.find(x => x.loginId === b.loginId); const a = s.staffAccounts.find(x => x.loginId === b.loginId);
        if (a && a.role === 'admin') return send(res, 400, { error: 'Admin apna account band nahi kar sakta.' });
        if (par) par.active = !!b.active; if (a) a.active = !!b.active;
      } else if (b.action === 'create-parent') {
        if (s.parents.some(x => x.mobile === b.mobile)) return send(res, 400, { error: 'Is mobile ka parent account pehle se hai.' });
        const st = s.students.find(x => x.srno === Number(b.srno));
        const loginId = 'HODA' + (st ? st.srno : Math.floor(1000 + Math.random() * 9000));
        s.parents.push({ loginId, guardianName: b.guardianName || '', mobile: b.mobile || '', children: st ? [st.srno] : [], tempPassword: st ? dobPw(st.dob) : '12345678', passwordHash: hashPw(st ? dobPw(st.dob) : '12345678'), active: true, mustChange: false });
        return send(res, 200, { ok: true, loginId });
      }
      store.save(); audit(u.loginId, 'Accounts: ' + b.action);
      return send(res, 200, { ok: true });
    }
    // ---------- Admit Cards ----------
    if (p === '/api/admit-cards' && req.method === 'GET') {
      const u = requireRole(req, res); if (!u) return;
      let cards = db().admitCards;
      if (u.role === 'parent') cards = cards.filter(c => u.children.includes(c.srno));
      return send(res, 200, { cards: cards.map(c => { const st = studentBySrno(c.srno); return { ...c, studentName: st ? st.name : '', classNum: st ? st.classNum : '', studentStatus: st ? st.status : '', hasFile: !!c.dataBase64 }; }) });
    }
    if (p === '/api/admit-cards' && req.method === 'POST') {
      const u = requireRole(req, res, ['admin']); if (!u) return;
      const b = await readBody(req); const s = db();
      const st = s.students.find(x => x.srno === Number(b.srno));
      if (!st) return send(res, 404, { error: 'Student nahi mila (sirf Active students).' });
      if (!/\.pdf$/i.test(b.fileName || '')) return send(res, 400, { error: 'Only PDF files can be uploaded as an admit card. Please choose a PDF file.' });
      const label = String(b.examLabel || '');
      const existing = s.admitCards.findIndex(c => c.srno === st.srno && c.examLabel === label);
      const card = { id: existing >= 0 ? s.admitCards[existing].id : Math.max(0, ...s.admitCards.map(c => c.id)) + 1, srno: st.srno, examLabel: label, fileName: b.fileName, uploadedDate: new Date().toISOString().slice(0, 10), dataBase64: b.dataBase64 || '' };
      if (existing >= 0) s.admitCards[existing] = card; else s.admitCards.push(card);
      store.save(); audit(u.loginId, 'Admit card uploaded: SRNO ' + st.srno + ' (' + label + ')');
      return send(res, 200, { ok: true, replaced: existing >= 0, id: card.id });
    }
    const cardFile = p.match(/^\/api\/admit-cards\/(\d+)\/file$/);
    if (cardFile) {
      const u = requireRole(req, res); if (!u) return;
      const card = db().admitCards.find(c => c.id === Number(cardFile[1]));
      if (!card) return send(res, 404, { error: 'Card nahi mila.' });
      if (u.role === 'parent' && !u.children.includes(card.srno)) return send(res, 403, { error: "This document belongs to another student's parent account." });
      if (!card.dataBase64) return send(res, 404, { error: 'Is record ki PDF file standalone package me nahi hai (sirf record aaya hai). Admin dobara upload kar sakta hai.' });
      res.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Disposition': 'inline; filename="' + card.fileName + '"' });
      return res.end(Buffer.from(card.dataBase64, 'base64'));
    }
    if (p === '/api/admit-cards' && req.method === 'DELETE') {
      const u = requireRole(req, res, ['admin']); if (!u) return;
      const b = await readBody(req); const s = db();
      s.admitCards = s.admitCards.filter(c => c.id !== Number(b.id));
      store.save(); audit(u.loginId, 'Admit card deleted: ' + b.id);
      return send(res, 200, { ok: true });
    }
    // ---------- Parent ----------
    if (p === '/api/my-children') {
      const u = requireRole(req, res, ['parent']); if (!u) return;
      const kids = u.children.map(srno => studentBySrno(srno)).filter(Boolean);
      return send(res, 200, { children: kids });
    }
    const childMatch = p.match(/^\/api\/child\/(\d+)$/);
    if (childMatch) {
      const u = requireRole(req, res, ['parent']); if (!u) return;
      const srno = Number(childMatch[1]);
      if (!u.children.includes(srno)) return send(res, 403, { error: 'Ye student aapke account se linked nahi hai.' });
      const st = studentBySrno(srno); if (!st) return send(res, 404, { error: 'Student nahi mila.' });
      const s = db();
      const results = s.exams.filter(e => e.published && e.classNum === st.classNum).map(e => ({ exam: { id: e.id, name: e.name, session: e.session, subjects: e.subjects }, result: computeResult(e, srno) }));
      const board = s.boardExams.filter(e => e.published && e.classNum === st.classNum).map(e => ({ boardExam: { id: e.id, classNum: e.classNum, session: e.session, subjects: e.subjects }, result: boardResult(e, srno) }));
      const monthly = s.monthlyAttendance.filter(m => m.srno === srno);
      const cards = s.admitCards.filter(c => c.srno === srno).map(c => ({ id: c.id, examLabel: c.examLabel, fileName: c.fileName, uploadedDate: c.uploadedDate, hasFile: !!c.dataBase64 }));
      return send(res, 200, { student: st, results, board, monthly, admitCards: cards });
    }
    // ---------- Home CMS ----------
    if (p === '/api/home-content' && req.method === 'PUT') {
      const u = requireRole(req, res, ['admin']); if (!u) return;
      const b = await readBody(req);
      db().homeContent = b.content; store.save(); audit(u.loginId, 'Home page content updated');
      return send(res, 200, { ok: true });
    }
    if (p === '/api/home-staff-visibility' && req.method === 'POST') {
      const u = requireRole(req, res, ['admin']); if (!u) return;
      const b = await readBody(req);
      const t = db().teachers.find(x => x.employeeId === b.employeeId); if (!t) return send(res, 404, { error: 'Teacher nahi mila.' });
      t.showOnHome = !!b.show; store.save();
      return send(res, 200, { ok: true });
    }
    // ---------- Import Centre (basic CSV) ----------
    if (p === '/api/import' && req.method === 'POST') {
      const u = requireRole(req, res, ['admin', 'teacher']); if (!u) return;
      const b = await readBody(req); const s = db();
      const rows = parseCsv(b.csvText || '');
      if (rows.length < 2) return send(res, 400, { error: 'CSV me rows nahi mili.' });
      const header = rows[0].map(h => String(h).trim().toLowerCase());
      let applied = 0; const errors = [];
      if (b.kind === 'pen') {
        const iSrno = header.indexOf('srno'), iPen = header.indexOf('pen'), iNic = header.findIndex(h => h.includes('nic'));
        for (const r of rows.slice(1)) {
          const st = s.students.find(x => x.srno === Number(r[iSrno]));
          if (!st) { errors.push('SRNO ' + r[iSrno] + ' nahi mila'); continue; }
          if (iPen >= 0) st.pen = String(r[iPen] || '').trim();
          if (iNic >= 0) st.nicId = String(r[iNic] || '').trim();
          applied++;
        }
      } else if (b.kind === 'attendance') {
        const iSrno = header.indexOf('srno'), iM = header.indexOf('month'), iW = header.findIndex(h => h.includes('working')), iP = header.findIndex(h => h.includes('present'));
        for (const r of rows.slice(1)) {
          const srno = Number(r[iSrno]); if (!s.students.some(x => x.srno === srno)) { errors.push('SRNO ' + r[iSrno] + ' nahi mila'); continue; }
          let rec = s.monthlyAttendance.find(x => x.srno === srno && x.month === r[iM]);
          if (!rec) { rec = { srno, month: r[iM], workingDays: 0, presentDays: 0 }; s.monthlyAttendance.push(rec); }
          rec.workingDays = Number(r[iW]) || 0; rec.presentDays = Number(r[iP]) || 0; applied++;
        }
      } else if (b.kind === 'students') {
        const iSrno = header.indexOf('srno'), iName = header.findIndex(h => h.includes('name')), iClass = header.indexOf('class');
        for (const r of rows.slice(1)) {
          const srno = Number(r[iSrno]); if (!srno) continue;
          if (s.students.some(x => x.srno === srno) || s.removedStudents.some(x => x.srno === srno)) { errors.push('SRNO ' + srno + ' pehle se hai'); continue; }
          s.students.push({ srno, name: r[iName] || '', classNum: Number(r[iClass]) || 1, section: 'A', gender: 'M', dob: '', doa: '', father: '', mother: '', category: 'GEN', religion: '', mobile: '', address: '', roll: '', bpl: 'N', cwsn: 'N', income: '', distance: '', pen: '', nicId: '', aadhaarAuth: '', workingDays: 0, presentDays: 0, status: 'active', removedReason: '', removedDate: '', tcNumber: '', removedNote: '', remark: '' });
          applied++;
        }
      } else {
        return send(res, 400, { error: 'Unknown import kind' });
      }
      store.save(); audit(u.loginId, 'Import ' + b.kind + ': ' + applied + ' rows');
      return send(res, 200, { ok: true, applied, errors: errors.slice(0, 20) });
    }
    // ---------- Exports ----------
    if (p === '/api/export/students.csv') {
      const u = requireRole(req, res, ['admin', 'teacher']); if (!u) return;
      const list = filterStudents(q);
      const rows = [['SRNO', 'Name', 'Class', 'Section', 'Roll', 'Gender', 'Category', 'DOB', 'Father', 'Mobile', 'PEN', 'NIC Id']];
      for (const s of list) rows.push([s.srno, s.name, s.classNum, s.section, s.roll, s.gender, s.category, s.dob, s.father, s.mobile, s.pen, s.nicId]);
      res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="students.csv"' });
      return res.end(toCsv(rows));
    }
    if (p === '/api/export/pen.csv') {
      const u = requireRole(req, res, ['admin', 'teacher']); if (!u) return;
      const cls = Number(q.classNum || 0);
      let list = activeStudents().slice().sort((a, b) => a.classNum - b.classNum || String(a.roll).localeCompare(String(b.roll), undefined, { numeric: true }));
      if (cls) list = list.filter(s => s.classNum === cls);
      const rows = [['SRNO', 'Student Name', 'Class', 'Section', 'Gender', 'Father', 'Mother', 'DOB', 'NIC Id', 'Aadhaar Auth', 'PEN']];
      for (const s of list) rows.push([s.srno, s.name, s.classNum, s.section, s.gender, s.father, s.mother, s.dob, s.nicId, s.aadhaarAuth, s.pen]);
      res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="pen-export.csv"' });
      return res.end(toCsv(rows));
    }
    if (p === '/api/audit') {
      const u = requireRole(req, res, ['admin']); if (!u) return;
      return send(res, 200, { log: db().auditLog.slice(-100).reverse() });
    }
    return send(res, 404, { error: 'Not found: ' + p });
  } catch (e) {
    console.error(e);
    return send(res, 500, { error: 'Server error: ' + e.message });
  }
}

async function createServer() {
  await store.init();
  setupPasswords();
  return http.createServer((req, res) => { handle(req, res); });
}
module.exports = { createServer, handler: (req, res) => { handle(req, res); }, init: async () => { await store.init(); setupPasswords(); } };
