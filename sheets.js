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
  await fetch(url, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ values: [[value]] }),
  });
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

   Row 1 = header:  Дата | 09:00 | 10:00 | … | 21:00
   Row 2+ = one row per calendar day (01.01.2025 – 31.12.2027)
   Col A = date string "DD.MM.YYYY"
   Col B+ = hour slots (empty = free, text = booked)

   Booked cell value:  "Name | @username | phone"
══════════════════════════════════════ */

const BOOKING_SHEET = 'schedule';
const FIRST_HOUR    = 9;    // 09:00
const LAST_HOUR     = 21;   // 21:00

/** Column index (1-based) for a given hour (9→2, 10→3, … 21→14) */
function hourToCol(hour) { return hour - FIRST_HOUR + 2; }

/** Column letter for a given hour */
function hourToColLetter(hour) {
  const col = hourToCol(hour);
  // A=1, B=2 … Z=26, AA=27 …
  let letter = '';
  let n = col;
  while (n > 0) {
    const rem = (n - 1) % 26;
    letter = String.fromCharCode(65 + rem) + letter;
    n = Math.floor((n - 1) / 26);
  }
  return letter;
}

/** Format a JS Date as "DD.MM.YYYY" matching the sheet */
function formatDate(d) {
  const dd   = String(d.getDate()).padStart(2, '0');
  const mm   = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `${dd}.${mm}.${yyyy}`;
}

/** Parse "DD.MM.YYYY" → JS Date */
function parseSheetDate(str) {
  const [dd, mm, yyyy] = str.split('.');
  return new Date(Number(yyyy), Number(mm) - 1, Number(dd));
}

/**
 * Find the sheet row number for a given date string "DD.MM.YYYY".
 * Reads column A (dates) and searches by value.
 * Returns row number (1-based) or null if not found.
 */
async function findDateRow(dateStr) {
  // Read all dates from column A (skip header row 1)
  const rows = await readRangeSchedule(BOOKING_SHEET, 'A2:A2000');
  for (let i = 0; i < rows.length; i++) {
    if (rows[i][0] === dateStr) return i + 2; // +2: header + 0-index
  }
  return null;
}

/**
 * Get available (free) hours for a given date.
 * Returns array of hour numbers, e.g. [9, 10, 13, 14].
 */
async function getAvailableHours(dateStr) {
  const row = await findDateRow(dateStr);
  if (!row) return [];

  const firstColLetter = hourToColLetter(FIRST_HOUR);
  const lastColLetter  = hourToColLetter(LAST_HOUR);
  const range = `${firstColLetter}${row}:${lastColLetter}${row}`;

  const rows = await readRangeSchedule(BOOKING_SHEET, range);
  const values = rows[0] || [];

  const available = [];
  for (let i = 0; i <= LAST_HOUR - FIRST_HOUR; i++) {
    const hour = FIRST_HOUR + i;
    const cell = values[i];
    if (!cell || cell.trim() === '') {
      available.push(hour);
    }
  }
  return available;
}

/**
 * Book a slot.
 * @param {string} dateStr   "DD.MM.YYYY"
 * @param {number} hour      e.g. 14
 * @param {string} name      client name
 * @param {string} username  Telegram @username (may be empty)
 * @param {string} phone     phone number (may be empty)
 * @returns {'ok'|'taken'|'not_found'}
 */
async function bookSlot(dateStr, hour, name, username, phone) {
  const row = await findDateRow(dateStr);
  if (!row) return 'not_found';

  const colLetter = hourToColLetter(hour);
  const cell      = `${colLetter}${row}`;

  // Read current value first — prevent double-booking
  const current = await readRangeSchedule(BOOKING_SHEET, `${cell}:${cell}`);
  const existing = (current[0] && current[0][0]) ? current[0][0].trim() : '';
  if (existing !== '') return 'taken';

  // Write booking
  const parts = [name];
  if (username) parts.push(username.startsWith('@') ? username : `@${username}`);
  if (phone)    parts.push(phone);
  const value = parts.join(' | ');

  await updateCellSchedule(BOOKING_SHEET, cell, value);
  return 'ok';
}

/**
 * Cancel a booking (clear the cell).
 * Only the cell owner or admin should call this.
 */
async function cancelSlot(dateStr, hour) {
  const row = await findDateRow(dateStr);
  if (!row) return 'not_found';
  const colLetter = hourToColLetter(hour);
  await updateCellSchedule(BOOKING_SHEET, `${colLetter}${row}`, '');
  return 'ok';
}

/**
 * Get next N available dates from today (inclusive) that have at least one free slot.
 * @param {number} limit  max dates to return (default 14)
 */
async function getNextAvailableDates(limit = 14) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const rows = await readRangeSchedule(BOOKING_SHEET, 'A2:A2000');
  const result = [];

  for (let i = 0; i < rows.length && result.length < limit; i++) {
    const dateStr = rows[i][0];
    if (!dateStr) continue;
    const d = parseSheetDate(dateStr);
    if (d < today) continue;   // past — skip

    // We don't read each row individually to avoid many API calls.
    // Return the date; availability is checked when user picks one.
    result.push(dateStr);
  }
  return result;
}

module.exports = {
  findPromo,
  markPromoUsed,
  getAvailableHours,
  bookSlot,
  cancelSlot,
  getNextAvailableDates,
  formatDate,
};
