'use strict';

/**
 * TTM Massage Bot — Vercel Webhook version
 *
 * Vercel environment variables needed:
 *   BOT_TOKEN    — Telegram bot token from @BotFather
 *   CHANNEL_ID   — e.g. @pro_telo_niko (can change without redeploy)
 *   WEBHOOK_SECRET — any random string, set same in Telegram webhook setup
 *
 * Deploy:
 *   1. Push this folder as a separate GitHub repo
 *   2. Import into Vercel — it auto-detects api/webhook.js
 *   3. Set env vars in Vercel dashboard
 *   4. Register webhook once:
 *      curl "https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://<your-vercel-url>/api/webhook&secret_token=<WEBHOOK_SECRET>"
 */

const TelegramBot = require('node-telegram-bot-api');

const TOKEN   = process.env.BOT_TOKEN;
const CHANNEL = process.env.CHANNEL_ID || '@pro_telo_niko';

const bot = new TelegramBot(TOKEN); // no polling — webhook mode

/* ─── Check subscription ─── */
async function isSubscribed(userId) {
  try {
    const m = await bot.getChatMember(CHANNEL, userId);
    return ['member', 'administrator', 'creator'].includes(m.status);
  } catch {
    return true; // if bot can't check — let through
  }
}

/* ─── Subscribe prompt ─── */
function subscribePrompt(chatId) {
  return bot.sendMessage(
    chatId,
    `👋 Щоб скористатись ботом — підпишись на наш канал:\n\n${CHANNEL}\n\nПісля підписки натисни /start`,
    {
      reply_markup: {
        inline_keyboard: [[
          { text: '📢 Підписатись', url: `https://t.me/${CHANNEL.replace('@', '')}` },
        ]],
      },
    }
  );
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

/* ─── In-memory state (resets on cold start — OK for simple bot) ─── */
const waitingForCode = new Set();

/* ─── Load discount codes ─── */
function loadCodes() {
  try {
    // codes.json sits next to this file
    return require('./codes.json');
  } catch {
    return {};
  }
}

/* ─── Handle update ─── */
async function handleUpdate(update) {
  const msg = update.message || update.edited_message;
  if (!msg) return;

  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const text   = (msg.text || '').trim();

  // /start — check subscription then greet
  if (text === '/start') {
    const ok = await isSubscribed(userId);
    if (!ok) { await subscribePrompt(chatId); return; }

    await bot.sendMessage(
      chatId,
      '👋 Привіт! Я бот студії масажу *Час для себе*.\n\nОбери дію 👇',
      { parse_mode: 'Markdown', ...MAIN_KB }
    );
    return;
  }

  // All other messages — check subscription first
  const ok = await isSubscribed(userId);
  if (!ok) { await subscribePrompt(chatId); return; }

  // ── Check discount code button ──
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

  if (text === '❌ Скасувати') {
    waitingForCode.delete(chatId);
    await bot.sendMessage(chatId, '↩️ Скасовано.', MAIN_KB);
    return;
  }

  // ── Code check ──
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

  // Default
  await bot.sendMessage(chatId, '👇 Обери дію:', MAIN_KB);
}

module.exports = { handleUpdate };
