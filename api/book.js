'use strict';

/**
 * POST /api/book
 * Body: { date, hour, name, phone, userId }
 *
 * Writes booking to Google Sheets, then sends Telegram confirmation.
 */

const BOT_TOKEN = process.env.BOT_TOKEN;

async function sendConfirmation(chatId, date, hour, name, phone) {
  const html =
    `<p><b>Запис підтверджено</b></p>` +
    `<p>${date} о ${hour}:00</p>` +
    `<p>${name}` + (phone ? `\n${phone}` : '') + `</p>` +
    `<blockquote>Чекаємо на вас</blockquote>` +
    `<tg-button-row align="center">` +
    `<tg-button type="url" style="success" url="https://t.me/Olga_Dind">Написати майстру Ользі</tg-button>` +
    `</tg-button-row>`;

  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendRichMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      rich_message: { html },
      reply_markup: {
        inline_keyboard: [[
          { text: 'Назад в меню', callback_data: 'menu', style: 'primary' }
        ]]
      }
    }),
  });
  const data = await res.json();
  if (!data.ok) {
    // Fallback to plain message
    console.error('[/api/book] sendRichMessage failed:', data.description);
    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: `Запис підтверджено!\n\n${date} о ${hour}:00\n${name}${phone ? '\n' + phone : ''}\n\nЧекаємо на вас!`,
      }),
    });
  }
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
    console.log(`[/api/book] booking: date="${date}" hour=${hour} name="${name}" userId=${userId}`);
    const result = await bookSlot(date, Number(hour), name, '', phone || '');
    console.log(`[/api/book] bookSlot result: ${result}`);

    if (result === 'ok') {
      await sendConfirmation(userId, date, hour, name, phone || '');
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
