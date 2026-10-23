'use strict';

/**
 * Google Sheets integration
 *
 * Vercel env vars needed:
 *   GOOGLE_CLIENT_EMAIL  — service account email
 *   GOOGLE_PRIVATE_KEY   — service account private key (with \n as newlines)
 *   SHEET_ID             — Google Spreadsheet ID from URL
 */

const SHEET_ID     = process.env.SHEET_ID;
const CLIENT_EMAIL = process.env.GOOGLE_CLIENT_EMAIL;
const PRIVATE_KEY = process.env.GOOGLE_PRIVATE_KEY || '';

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
  if (!data.access_token) throw new Error(`Google auth failed: ${JSON.stringify(data)}`);

  _cachedToken = data.access_token;
  _tokenExpiry = Date.now() + (data.expires_in || 3600) * 1000;
  return _cachedToken;
}

/* ─── Read sheet range ─── */
async function readRange(sheet, range) {
  const token = await getAccessToken();
  const url = `${SHEETS_BASE}/${SHEET_ID}/values/${encodeURIComponent(`${sheet}!${range}`)}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await res.json();
  return data.values || [];
}

/* ─── Update single cell ─── */
async function updateCell(sheet, cell, value) {
  const token = await getAccessToken();
  const url = `${SHEETS_BASE}/${SHEET_ID}/values/${encodeURIComponent(`${sheet}!${cell}`)}?valueInputOption=RAW`;
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

module.exports = { findPromo, markPromoUsed };
