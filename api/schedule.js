'use strict';

/**
 * GET /api/schedule?month=YYYY-MM
 * Returns slot availability for the requested month.
 *
 * Response: { dates: { "DD.MM.YYYY": { slots: [{hour, free}] } } }
 */

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).end();

  const { month } = req.query; // "2026-11"
  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    return res.status(400).json({ error: 'month param required, format YYYY-MM' });
  }

  try {
    const { getMonthSlots } = require('../sheets');
    const data = await getMonthSlots(month);
    return res.status(200).json({ ok: true, dates: data });
  } catch (err) {
    console.error('[/api/schedule] error:', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
};
