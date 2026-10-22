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

/* ─── Subscribe prompt — Rich Message with inline button ─── */
async function subscribePrompt(chatId) {
  const channelUrl = `https://t.me/${CHANNEL.replace('@', '')}`;
  const token = process.env.BOT_TOKEN;

  try {
    // Try Rich Message (Bot API 10.3) — button inside the message body
    const body = {
      chat_id: chatId,
      blocks: [
        {
          type: 'paragraph',
          text: {
            type: 'plain',
            text: '👋 Щоб скористатись ботом, підпишись на наш канал — це займе 5 секунд.'
          }
        },
        {
          type: 'buttons',
          align: 'center',
          buttons: [
            {
              text: { type: 'plain', text: '📢 Підписатись на канал' },
              style: 'primary',
              url: channelUrl
            }
          ]
        },
        {
          type: 'paragraph',
          text: {
            type: 'plain',
            text: 'Після підписки натисни /start'
          }
        }
      ]
    };

    const res = await fetch(`https://api.telegram.org/bot${token}/sendRichMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    const data = await res.json();
    if (!data.ok) throw new Error(data.description);

  } catch (err) {
    // Fallback to regular message if Rich Message fails
    console.error('sendRichMessage failed, falling back:', err.message);
    await getBot().sendMessage(
      chatId,
      `👋 Щоб скористатись ботом — підпишись на наш канал:\n\n${channelUrl}\n\nПісля підписки натисни /start`,
      {
        reply_markup: {
          inline_keyboard: [[
            { text: '📢 Підписатись', url: channelUrl }
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
