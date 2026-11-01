'use strict';

/**
 * Google Sheets integration
 *
 * Vercel env vars needed:
 *   GOOGLE_CLIENT_EMAIL  — service account email
 *   GOOGLE_PRIVATE_KEY   — service account private key (with \n as newlines)
 *   SHEET_ID             — Google Spreadsheet ID (promo codes table)
 *   SCHEDULE_SHEET_ID    — Google Spreadsheet ID (schedule/booking table)
 */

const SHEET_ID          = process.env.SHEET_ID;
const SCHEDULE_SHEET_ID = process.env.SCHEDULE_SHEET_ID || process.env.SHEET_ID;
const CLIENT_EMAIL      = process.env.GOOGLE_CLIENT_EMAIL;
const PRIVATE_KEY       = process.env.GOOGLE_PRIVATE_KEY || '';

const SHEETS_BASE  = 'https://sheets.googleapis.com/v4/spreadsheets';

/* ─── JWT auth token (Google OAuth2) ─── */
let _cachedToken = null;
let _tokenExpiry = 0;

async function getAccessToken() {
  if (_cachedToken && Date.now() < _tokenExpiry - 30000) return _cachedToken;

  const now = Math.floor(Date.now() / 1000);
  const header  = { alg: 'RS256', typ: 'JWT' };
  const payload = {
    iss: CLIENT_EMAIL,
    scope: 'https://www.googleapis.com/auth/spreadsheets',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now,
  };

  const b64 = (obj) =>
    Buffer.from(JSON.stringify(obj)).toString('base64url');

  const sigInput = `${b64(header)}.${b64(payload)}`;

  // Sign with RSA-SHA256 using Node crypto
  const { createSign } = require('node:crypto');
  const sign = createSign('RSA-SHA256');
  sign.update(sigInput);
  const signature = sign.sign(PRIVATE_KEY, 'base64url');

  const jwt = `${sigInput}.${signature}`;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });

  const data = await res.json();
  console.log('[Sheets] token response:', data.access_token ? 'OK' : JSON.stringify(data));
  if (!data.access_token) throw new Error(`Google auth failed: ${JSON.stringify(data)}`);

  _cachedToken = data.access_token;
  _tokenExpiry = Date.now() + (data.expires_in || 3600) * 1000;
  return _cachedToken;
}

/* ─── Read sheet range ─── */
async function readRange(sheet, range) {
  return _readRange(SHEET_ID, sheet, range);
}

async function readRangeSchedule(sheet, range) {
  return _readRange(SCHEDULE_SHEET_ID, sheet, range);
}

async function _readRange(spreadsheetId, sheet, range) {
  const token = await getAccessToken();
  const url = `${SHEETS_BASE}/${spreadsheetId}/values/${encodeURIComponent(`${sheet}!${range}`)}`;
  console.log('[Sheets] readRange URL:', url);
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const text = await res.text();
  console.log('[Sheets] response status:', res.status, 'body preview:', text.slice(0, 500));
  if (!res.ok) throw new Error(`Sheets API error ${res.status}: ${text.slice(0, 500)}`);
  const data = JSON.parse(text);
  return data.values || [];
}

/* ─── Update single cell ─── */
async function updateCell(sheet, cell, value) {
  return _updateCell(SHEET_ID, sheet, cell, value);
}

async function updateCellSchedule(sheet, cell, value) {
  return _updateCell(SCHEDULE_SHEET_ID, sheet, cell, value);
}

async function _updateCell(spreadsheetId, sheet, cell, value) {
  const token = await getAccessToken();
  const url = `${SHEETS_BASE}/${spreadsheetId}/values/${encodeURIComponent(`${sheet}!${cell}`)}?valueInputOption=RAW`;
  console.log('[Sheets] updateCell URL:', url, '| value:', value);
  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ values: [[value]] }),
  });
  const text = await res.text();
  console.log('[Sheets] updateCell status:', res.status, 'body:', text.slice(0, 300));
  if (!res.ok) throw new Error(`Sheets write error ${res.status}: ${text.slice(0, 300)}`);
}

/* ══════════════════════════════════════
   PROMO CODES  (sheet: Promo)
   Columns: A=code  B=discount  C=desc  D=used
══════════════════════════════════════ */

/**
 * Look up a promo code.
 * Returns { discount, desc, rowIndex } or null if not found / already used.
 */
async function findPromo(code) {
  // Read all data rows (skip header row 1)
  const rows = await readRange('promo_codes', 'A2:D1000');

  for (let i = 0; i < rows.length; i++) {
    const [rowCode, discount, desc, active] = rows[i];
    if (!rowCode) continue;
    if (rowCode.trim().toUpperCase() !== code.toUpperCase()) continue;

    // Found — check if active (checkbox: TRUE = active, FALSE = used/inactive)
    const isActive = !active || active.toString().toUpperCase() === 'TRUE';
    if (!isActive) {
      return { found: true, used: true, discount, desc };
    }

    return { found: true, used: false, discount, desc, rowIndex: i + 2 };
  }

  return { found: false };
}

/**
 * Mark a promo code as used.
 */
async function markPromoUsed(rowIndex) {
  await updateCell('promo_codes', `D${rowIndex}`, false);
}

/* ══════════════════════════════════════
   SCHEDULE / BOOKING  (sheet: schedule)

   NEW STRUCTURE (transposed):
   Row 1    = header: "Час" | "01.11.2026" | "02.11.2026" | ...
   Col A    = time slots: "09:00", "10:00", ... "21:00"
   Col B+   = one column per date
   Cell     = empty → free, text → booked ("Name | @user | phone")
══════════════════════════════════════ */

const BOOKING_SHEET = 'schedule';
const FIRST_HOUR    = 9;
const LAST_HOUR     = 21;
const TOTAL_HOURS   = LAST_HOUR - FIRST_HOUR + 1;  // 13

/** Convert number to column letter (1=A, 2=B, 27=AA …) */
function colLetter(n) {
  let s = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/** Format JS Date → "DD.MM.YYYY" */
function formatDate(d) {
  return `${String(d.getDate()).padStart(2,'0')}.${String(d.getMonth()+1).padStart(2,'0')}.${d.getFullYear()}`;
}

/** Parse "DD.MM.YYYY" → JS Date */
function parseSheetDate(str) {
  const [dd, mm, yyyy] = str.split('.');
  return new Date(Number(yyyy), Number(mm) - 1, Number(dd));
}

/** Row number for a given hour (9→2, 10→3, … 21→14) */
function hourToRow(hour) { return hour - FIRST_HOUR + 2; }

/**
 * Read header row to build a map: dateStr → column index (1-based).
 * Caches result in module scope (resets on cold start).
 */
let _colCache = null;
let _colCacheTime = 0;

async function getDateColMap() {
  // Cache for 5 minutes
  if (_colCache && Date.now() - _colCacheTime < 5 * 60 * 1000) return _colCache;

  // Read row 1 — up to 2000 columns
  const rows = await readRangeSchedule(BOOKING_SHEET, '1:1');
  const header = rows[0] || [];

  const map = {};
  for (let i = 1; i < header.length; i++) {
    const val = header[i];
    if (!val) continue;
    // Header cell may contain "Сб\n01.11.2026" — extract just the date part
    const dateMatch = val.trim().match(/(\d{2}\.\d{2}\.\d{4})/);
    if (dateMatch) map[dateMatch[1]] = i + 1;  // 1-based col index
  }

  _colCache = map;
  _colCacheTime = Date.now();
  console.log(`[Sheets] dateColMap loaded: ${Object.keys(map).length} dates`);
  return map;
}

/** Invalidate column cache after write */
function invalidateColCache() {
  _colCache = null;
}

/**
 * Find column index for a date string "DD.MM.YYYY".
 * Returns 1-based column number or null.
 */
async function findDateCol(dateStr) {
  const map = await getDateColMap();
  const col = map[dateStr];
  if (!col) console.log(`[Sheets] findDateCol: "${dateStr}" NOT FOUND in header`);
  else console.log(`[Sheets] findDateCol: "${dateStr}" → col ${col} (${colLetter(col)})`);
  return col || null;
}

/**
 * Get all hour slots for a date — single cell read.
 * Returns array of { hour, free: bool }
 */
async function getHourSlots(dateStr) {
  const col = await findDateCol(dateStr);
  if (!col) return [];

  const colL    = colLetter(col);
  const firstR  = hourToRow(FIRST_HOUR);
  const lastR   = hourToRow(LAST_HOUR);
  const rows    = await readRangeSchedule(BOOKING_SHEET, `${colL}${firstR}:${colL}${lastR}`);

  const result = [];
  for (let i = 0; i < TOTAL_HOURS; i++) {
    const val = rows[i] ? rows[i][0] : '';
    result.push({ hour: FIRST_HOUR + i, free: !val || val.trim() === '' });
  }
  return result;
}

/**
 * Get all slots for a full month — two API calls (header + data block).
 * Returns { "DD.MM.YYYY": { slots: [{hour, free}] } }
 */
async function getMonthSlots(month) {
  const [yyyy, mm] = month.split('-').map(Number);
  const map = await getDateColMap();

  // Find columns that belong to this month
  const monthDates = Object.keys(map).filter(ds => {
    const parts = ds.split('.');
    return Number(parts[2]) === yyyy && Number(parts[1]) === mm;
  });

  if (monthDates.length === 0) return {};

  // Find min/max column
  const cols = monthDates.map(ds => map[ds]);
  const minCol = Math.min(...cols);
  const maxCol = Math.max(...cols);

  const firstR = hourToRow(FIRST_HOUR);
  const lastR  = hourToRow(LAST_HOUR);

  // One read: entire block A:firstR to maxCol:lastR
  const rows = await readRangeSchedule(
    BOOKING_SHEET,
    `${colLetter(minCol)}${firstR}:${colLetter(maxCol)}${lastR}`
  );

  const result = {};
  for (const ds of monthDates) {
    const colOffset = map[ds] - minCol;  // 0-based within our read block
    const slots = [];
    for (let i = 0; i < TOTAL_HOURS; i++) {
      const val = rows[i] ? rows[i][colOffset] : '';
      slots.push({ hour: FIRST_HOUR + i, free: !val || val.trim() === '' });
    }
    result[ds] = { slots };
  }
  return result;
}

/**
 * Book a slot.
 * @returns {'ok'|'taken'|'not_found'}
 */
async function bookSlot(dateStr, hour, name, username, phone) {
  const col = await findDateCol(dateStr);
  if (!col) return 'not_found';

  const colL = colLetter(col);
  const row  = hourToRow(hour);
  const cell = `${colL}${row}`;

  // Check current value
  const current  = await readRangeSchedule(BOOKING_SHEET, `${cell}:${cell}`);
  const existing = current[0] && current[0][0] ? current[0][0].trim() : '';
  if (existing !== '') return 'taken';

  // Build booking string
  const parts = [name];
  if (username) parts.push(username.startsWith('@') ? username : `@${username}`);
  if (phone)    parts.push(phone);

  await updateCellSchedule(BOOKING_SHEET, cell, parts.join(' | '));
  invalidateColCache();
  return 'ok';
}

/**
 * Cancel a booking.
 */
async function cancelSlot(dateStr, hour) {
  const col = await findDateCol(dateStr);
  if (!col) return 'not_found';
  await updateCellSchedule(BOOKING_SHEET, `${colLetter(col)}${hourToRow(hour)}`, '');
  invalidateColCache();
  return 'ok';
}

/**
 * Get paginated date list with free/full status — one API call.
 */
async function getDatePage(offset = 0, count = 12) {
  const today = new Date(); today.setHours(0,0,0,0);
  const map   = await getDateColMap();

  const future = Object.keys(map)
    .filter(ds => parseSheetDate(ds) >= today)
    .sort((a, b) => parseSheetDate(a) - parseSheetDate(b));

  const page  = future.slice(offset, offset + count);
  const total = future.length;
  if (page.length === 0) return { dates: [], total, offset };

  // Read all hour rows for these columns in one call
  const cols   = page.map(ds => map[ds]);
  const minCol = Math.min(...cols);
  const maxCol = Math.max(...cols);
  const firstR = hourToRow(FIRST_HOUR);
  const lastR  = hourToRow(LAST_HOUR);

  const rows = await readRangeSchedule(
    BOOKING_SHEET,
    `${colLetter(minCol)}${firstR}:${colLetter(maxCol)}${lastR}`
  );

  const dates = page.map(ds => {
    const colOffset = map[ds] - minCol;
    const hasFree   = rows.some(row => {
      const val = row ? row[colOffset] : '';
      return !val || val.trim() === '';
    });
    return { dateStr: ds, hasFree };
  });

  return { dates, total, offset };
}

/**
 * Get available hours for a date (legacy helper).
 */
async function getAvailableHours(dateStr) {
  const slots = await getHourSlots(dateStr);
  return slots.filter(s => s.free).map(s => s.hour);
}


/* ══════════════════════════════════════
   SETTINGS  (sheet: settings, cell A1)
   Value: "1" = online booking enabled, "0" = disabled
══════════════════════════════════════ */

async function getScheduleEnabled() {
  try {
    // Uses main SHEET_ID — settings live in promo spreadsheet
    const rows = await readRange('settings', 'A1');
    const val  = rows[0] && rows[0][0];
    // Default to enabled if cell is empty or missing
    return val !== '0';
  } catch (err) {
    console.error('[Sheets] getScheduleEnabled error:', err.message);
    return true; // default: enabled
  }
}

async function setScheduleEnabled(enabled) {
  await updateCell('settings', 'A1', enabled ? '1' : '0');
}


module.exports = {
  findPromo,
  markPromoUsed,
  getAvailableHours,
  getHourSlots,
  bookSlot,
  cancelSlot,
  getDatePage,
  getMonthSlots,
  formatDate,
  getScheduleEnabled,
  setScheduleEnabled,
};
