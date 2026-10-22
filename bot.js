'use strict';

/**
 * TTM Massage Bot — Vercel Webhook version
 *
 * Vercel environment variables:
 *   BOT_TOKEN   — Telegram bot token from @BotFather
 *   CHANNEL_ID  — e.g. @pro_telo_niko (change without redeploy)
 *
 * Register webhook once after deploy:
 *   curl "https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://<project>.vercel.app/api/webhook"
 */

const TelegramBot = require('node-telegram-bot-api');

const CHANNEL = process.env.CHANNEL_ID || '@pro_telo_niko';

// Lazy-init: bot created on first request, not at module load
// This prevents crash when env vars aren't set at build time
let _bot = null;
function getBot() {
  if (!_bot) {
    const token = process.env.BOT_TOKEN;
    if (!token) throw new Error('BOT_TOKEN is not set in Vercel environment variables');
    _bot = new TelegramBot(token);
  }
  return _bot;
}

/* ─── Check subscription ─── */
async function isSubscribed(userId) {
  try {
    const m = await getBot().getChatMember(CHANNEL, userId);
    return ['member', 'administrator', 'creator'].includes(m.status);
  } catch (err) {
    // Log error — most likely bot is not an admin of the channel
    console.error(`isSubscribed check failed for channel ${CHANNEL}:`, err.message);
    // Return false so users are prompted to subscribe (not true/bypassed)
    // Change back to `return true` if you want to bypass check during development
    return false;
  }
}

/* ─── Subscribe prompt — Rich Message with inline button in text ─── */
async function subscribePrompt(chatId) {
  const channelUrl = `https://t.me/${CHANNEL.replace('@', '')}`;
  const token = process.env.BOT_TOKEN;

  const html =
    `👋 Привіт! Це бот студії масажу <b>Час для себе</b>.\n\n` +
    `Для роботи бота потрібна підписка на наш канал.\n` +
    `<tg-button-row align="center">` +
    `<tg-button type="url" style="success" url="${channelUrl}">📢 Підписатись на канал</tg-button>` +
    `</tg-button-row>` +
    `<tg-button-row align="center">` +
    `<tg-button type="callback_data" style="success" data="check_sub">✅ Перевірити підписку</tg-button>` +
    `</tg-button-row>`;

  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendRichMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        rich_message: { html }
      })
    });

    const data = await res.json();
    if (!data.ok) throw new Error(data.description);

  } catch (err) {
    console.error('sendRichMessage failed, falling back:', err.message);
    await getBot().sendMessage(
      chatId,
      `👋 Для роботи бота потрібна підписка на канал:\n\n${channelUrl}`,
      {
        reply_markup: {
          inline_keyboard: [[
            { text: '📢 Підписатись', url: channelUrl }
          ], [
            { text: '✅ Перевірити підписку', callback_data: 'check_sub' }
          ]]
        }
      }
    );
  }
}

/* ─── Main keyboard ─── */
const MAIN_KB = {
  reply_markup: {
    keyboard: [
      [{ text: '🎟 Перевірити код знижки' }],
    ],
    resize_keyboard: true,
    one_time_keyboard: false,
  },
};

/* ─── State (resets on cold start) ─── */
const waitingForCode = new Set();

/* ─── Load discount codes ─── */
function loadCodes() {
  try {
    return require('./codes.json');
  } catch {
    return {};
  }
}

/* ─── Main handler ─── */
async function handleUpdate(update) {
  // Handle callback query (inline button press)
  if (update.callback_query) {
    const cq     = update.callback_query;
    const chatId = cq.message.chat.id;
    const userId = cq.from.id;
    const bot    = getBot();

    if (cq.data === 'check_sub') {
      await bot.answerCallbackQuery(cq.id); // dismiss loading spinner
      const ok = await isSubscribed(userId);
      if (ok) {
        await bot.sendMessage(
          chatId,
          '✅ Підписку підтверджено!\n\n👋 Привіт! Я бот студії масажу *Час для себе*.\n\nОбери дію 👇',
          { parse_mode: 'Markdown', ...MAIN_KB }
        );
      } else {
        await bot.answerCallbackQuery(cq.id, {
          text: '❌ Підписку не знайдено. Підпишись і спробуй ще раз.',
          show_alert: true
        });
      }
    }
    return;
  }

  const msg = update.message || update.edited_message;
  if (!msg) return;

  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const text   = (msg.text || '').trim();
  const bot    = getBot();

  /* /start */
  if (text === '/start') {
    console.log(`[/start] userId=${userId} chatId=${chatId}`);
    const ok = await isSubscribed(userId);
    console.log(`[/start] isSubscribed=${ok} for userId=${userId}`);
    if (!ok) { await subscribePrompt(chatId); return; }
    await bot.sendMessage(
      chatId,
      '👋 Привіт! Я бот студії масажу *Час для себе*.\n\nОбери дію 👇',
      { parse_mode: 'Markdown', ...MAIN_KB }
    );
    return;
  }

  /* All other — check subscription first */
  console.log(`[msg] text="${text}" userId=${userId}`);
  const ok = await isSubscribed(userId);
  console.log(`[msg] isSubscribed=${ok} for userId=${userId}`);
  if (!ok) { await subscribePrompt(chatId); return; }

  /* Enter code check mode */
  if (text === '🎟 Перевірити код знижки') {
    waitingForCode.add(chatId);
    await bot.sendMessage(chatId, '🔑 Введи свій код зі скретч-картки:', {
      reply_markup: {
        keyboard: [[{ text: '❌ Скасувати' }]],
        resize_keyboard: true,
      },
    });
    return;
  }

  /* Cancel */
  if (text === '❌ Скасувати') {
    waitingForCode.delete(chatId);
    await bot.sendMessage(chatId, '↩️ Скасовано.', MAIN_KB);
    return;
  }

  /* Process code */
  if (waitingForCode.has(chatId)) {
    waitingForCode.delete(chatId);
    const code  = text.toUpperCase();
    const codes = loadCodes();

    if (codes[code]) {
      const { discount, desc } = codes[code];
      await bot.sendMessage(
        chatId,
        `✅ Код *${code}* дійсний!\n\n🎉 Знижка: *${discount}*\n_${desc}_\n\nНазви цей код при записі.`,
        { parse_mode: 'Markdown', ...MAIN_KB }
      );
    } else {
      await bot.sendMessage(
        chatId,
        `❌ Код *${code}* не знайдено або вже використано.\n\nСпробуй ще раз або зіграй у лотерею на сайті.`,
        { parse_mode: 'Markdown', ...MAIN_KB }
      );
    }
    return;
  }

  /* Fallback */
  await bot.sendMessage(chatId, '👇 Обери дію:', MAIN_KB);
}

module.exports = { handleUpdate };
