'use strict';

/**
 * POST /api/book
 * Body: { date, hour, name, phone, userId, firstName }
 *
 * Writes booking to Google Sheets, then sends Telegram confirmation.
 */

const BOT_TOKEN = process.env.BOT_TOKEN;

async function sendTelegramMessage(chatId, text) {
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown' }),
  });
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const { date, hour, name, phone, userId } = req.body || {};

  if (!date || !hour || !name || !userId) {
    return res.status(400).json({ ok: false, error: 'date, hour, name, userId required' });
  }

  try {
    const { bookSlot } = require('../sheets');
    const result = await bookSlot(date, Number(hour), name, '', phone || '');

    if (result === 'ok') {
      // Send confirmation back into Telegram chat
      const txt =
        `✅ *Запис підтверджено!*\n\n` +
        `📅 ${date} о ${hour}:00\n` +
        `👤 ${name}` +
        (phone ? `\n📞 ${phone}` : '') +
        `\n\nЧекаємо на вас! 💆`;
      await sendTelegramMessage(userId, txt);
      return res.status(200).json({ ok: true });
    }

    if (result === 'taken') {
      return res.status(409).json({ ok: false, error: 'taken' });
    }

    return res.status(404).json({ ok: false, error: 'not_found' });
  } catch (err) {
    console.error('[/api/book] error:', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
};
