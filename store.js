'use strict';
// Data store: file mode (data/db.json) by default; Postgres mode when DATABASE_URL is set.
// Postgres mode stores the whole app state as one JSONB row (id=1) in table app_state —
// data genuinely persists in the external database (Neon), never on the local disk.
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const SEED_FILE = path.join(DATA_DIR, 'seed.json');

let state = null;
let pgPool = null;
let saveTimer = null;

function loadSeed() {
  return JSON.parse(fs.readFileSync(SEED_FILE, 'utf8'));
}

async function init() {
  if (process.env.DATABASE_URL) {
    const { Pool } = require('pg');
    pgPool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.PGSSL === 'disable' ? false : { rejectUnauthorized: false } });
    try { await pgPool.query('CREATE TABLE IF NOT EXISTS app_state (id int PRIMARY KEY, data jsonb)'); } catch (e) { /* table may already exist (concurrent cold starts) */ }
    const r = await pgPool.query('SELECT data FROM app_state WHERE id=1');
    if (r.rows.length) {
      state = r.rows[0].data;
    } else {
      state = loadSeed();
      await pgPool.query('INSERT INTO app_state (id, data) VALUES (1, $1)', [JSON.stringify(state)]);
    }
  } else {
    if (fs.existsSync(DB_FILE)) {
      state = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    } else {
      state = loadSeed();
      persistNow();
    }
  }
  return state;
}

function persistNow() {
  if (pgPool) {
    pgPool.query('INSERT INTO app_state (id, data) VALUES (1, $1) ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data', [JSON.stringify(state)]).catch(e => console.error('DB save failed:', e.message));
  } else {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = DB_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(state));
    fs.renameSync(tmp, DB_FILE);
  }
}

function save() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => { saveTimer = null; persistNow(); }, 250);
}

module.exports = { init, save, persistNow, get: () => state, DATA_DIR };
