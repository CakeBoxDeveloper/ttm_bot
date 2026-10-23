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
    `<tg-button type="url" style="success" url="${channelUrl}">Підписатись на канал</tg-button>` +
    `</tg-button-row>`;

  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendRichMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        rich_message: { html },
        // Inline keyboard UNDER message — green via style field (Bot API 10.3)
        reply_markup: {
          inline_keyboard: [[
            { text: 'Перевірити підписку', callback_data: 'check_sub', style: 'success' }
          ]]
        }
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

/* ─── Main menu inline keyboard ─── */
const MAIN_INLINE = {
  reply_markup: {
    inline_keyboard: [
      [{ text: 'Записатись на прийом',   callback_data: 'book'  }],
      [{ text: 'Перевірити бонусний код', callback_data: 'promo' }],
    ]
  }
};

/* ─── State (resets on cold start) ─── */
const waitingForCode = new Set();

/* ─── Load discount codes (legacy JSON fallback) ─── */
function loadCodes() {
  try { return require('./codes.json'); } catch { return {}; }
}

// Sheets module — lazy loaded
let _sheets = null;
function getSheets() {
  if (!_sheets) _sheets = require('./sheets');
  return _sheets;
}

/* ─── Send Rich Message helper ─── */
async function sendRichMsg(token, chatId, html, inlineButtons) {
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendRichMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        rich_message: { html },
        reply_markup: { inline_keyboard: inlineButtons }
      })
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.description);
  } catch (err) {
    console.error('sendRichMsg failed:', err.message);
  }
}

/* ─── Send main menu as Rich Message with colored buttons UNDER it ─── */
async function sendMainMenu(bot, chatId) {
  const token = process.env.BOT_TOKEN;

  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendRichMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        rich_message: {
          html:
            `<img src="tg://photo?id=menu_img" />` +
            `<p>👋 Привіт! Я бот студії масажу <b>Час для себе</b>.</p>` +
            `<p>Обери дію:</p>`,
          media: [
            {
              id: 'menu_img',
              media: {
                type: 'photo',
                media: 'https://github.com/CakeBoxDeveloper/ttm_bot/blob/main/Draw_watch_from_reference_20261023231355.jpg?raw=true'
              }
            }
          ]
        },
        reply_markup: {
          inline_keyboard: [
            [{ text: 'Записатись на прийом',   callback_data: 'book',  style: 'primary' }],
            [{ text: 'Перевірити бонусний код', callback_data: 'promo', style: 'danger'  }]
          ]
        }
      })
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.description);
  } catch (err) {
    console.error('sendRichMessage menu failed:', err.message);
    await bot.sendMessage(
      chatId,
      '👋 Привіт! Я бот студії масажу *Час для себе*.\n\nОбери дію 👇',
      { parse_mode: 'Markdown', ...MAIN_INLINE }
    );
  }
}

/* ─── Main handler ─── */
async function handleUpdate(update) {
  const bot = getBot();

  /* ── Callback query (inline button press) ── */
  if (update.callback_query) {
    const cq     = update.callback_query;
    const chatId = cq.message.chat.id;
    const userId = cq.from.id;

    /* Check subscription button */
    if (cq.data === 'check_sub') {
      const ok = await isSubscribed(userId);
      if (ok) {
        await bot.answerCallbackQuery(cq.id, { text: '✅ Підписку підтверджено!' });
        await sendMainMenu(bot, chatId);
      } else {
        await bot.answerCallbackQuery(cq.id, {
          text: '❌ Підписку не знайдено. Підпишись і спробуй ще раз.',
          show_alert: true
        });
      }
      return;
    }

    /* All other callbacks — check subscription first */
    const subOk = await isSubscribed(userId);
    if (!subOk) {
      await bot.answerCallbackQuery(cq.id);
      await subscribePrompt(chatId);
      return;
    }

    /* Noop — do nothing (used for display-only colored buttons) */
    if (cq.data === 'noop') {
      await bot.answerCallbackQuery(cq.id);
      return;
    }

    /* Book appointment */
    if (cq.data === 'book') {
      await bot.answerCallbackQuery(cq.id);
      await bot.sendMessage(
        chatId,
        '📅 Запис на прийом — функція скоро буде доступна.\n\nПоки що пиши нам напряму: @pro_telo_niko',
        MAIN_INLINE
      );
      return;
    }

    /* Promo code — ask to enter */
    if (cq.data === 'promo') {
      await bot.answerCallbackQuery(cq.id);
      waitingForCode.add(chatId);
      await bot.sendMessage(
        chatId,
        '🔑 Введи свій бонусний код:',
        {
          reply_markup: {
            inline_keyboard: [[
              { text: 'Скасувати', callback_data: 'cancel' }
            ]]
          }
        }
      );
      return;
    }

    /* Cancel */
    if (cq.data === 'cancel') {
      await bot.answerCallbackQuery(cq.id);
      waitingForCode.delete(chatId);
      await sendMainMenu(bot, chatId);
      return;
    }

    /* Back to menu */
    if (cq.data === 'menu') {
      await bot.answerCallbackQuery(cq.id);
      await sendMainMenu(bot, chatId);
      return;
    }

    await bot.answerCallbackQuery(cq.id);
    return;
  }

  /* ── Text messages ── */
  const msg = update.message || update.edited_message;
  if (!msg) return;

  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const text   = (msg.text || '').trim();

  /* /start */
  if (text === '/start') {
    console.log(`[/start] userId=${userId}`);
    const ok = await isSubscribed(userId);
    console.log(`[/start] isSubscribed=${ok}`);
    if (!ok) { await subscribePrompt(chatId); return; }
    await sendMainMenu(bot, chatId);
    return;
  }

  /* Check subscription for all other messages */
  const ok = await isSubscribed(userId);
  if (!ok) { await subscribePrompt(chatId); return; }

  /* Process promo code if waiting */
  if (waitingForCode.has(chatId)) {
    waitingForCode.delete(chatId);
    const code = text.toUpperCase();

    try {
      const { findPromo } = getSheets();
      const result = await findPromo(code);

      const token = process.env.BOT_TOKEN;

      if (!result.found) {
        await sendRichMsg(token, chatId,
          `<p>Промокод <b>${code}</b> не знайдено.</p>` +
          `<tg-button-row align="center">` +
          `<tg-button type="url" style="danger" url="https://t.me/${CHANNEL.replace('@', '')}">Код не знайдено. Зіграй у лотерею на сайті</tg-button>` +
          `</tg-button-row>`,
          [
            [{ text: 'Повернутись до меню',     callback_data: 'menu',  style: 'success' }],
            [{ text: 'Спробувати інший код',     callback_data: 'promo', style: 'primary' }],
          ]
        );
      } else if (result.used) {
        await sendRichMsg(token, chatId,
          `<p>Промокод <b>${code}</b> вже використано.</p>` +
          `<tg-button-row align="center">` +
          `<tg-button type="url" style="danger" url="https://t.me/${CHANNEL.replace('@', '')}">Цей код більше не активний</tg-button>` +
          `</tg-button-row>`,
          [
            [{ text: 'Повернутись до меню',     callback_data: 'menu',  style: 'success' }],
            [{ text: 'Спробувати інший код',     callback_data: 'promo', style: 'primary' }],
          ]
        );
      } else {
        const bonus = result.desc + (result.discount && /\d/.test(result.discount) ? ' — ' + result.discount : '');
        await sendRichMsg(token, chatId,
          `<p>Промокод <b>${code}</b> прийнято. Назви цей код майстру при записі.</p>` +
          `<tg-button-row align="center">` +
          `<tg-button type="url" style="success" url="https://t.me/${CHANNEL.replace('@', '')}">${bonus}</tg-button>` +
          `</tg-button-row>`,
          [[{ text: 'Записатись на прийом', callback_data: 'book', style: 'primary' }]]
        );
      }
    } catch (err) {
      console.error('Sheets error:', err.message);
      await bot.sendMessage(chatId, '⚠️ Помилка перевірки коду. Спробуй пізніше.', MAIN_INLINE);
    }
    return;
  }

  /* Fallback — show menu */
  await sendMainMenu(bot, chatId);

  // DEV: log sticker/emoji info
  if (msg.sticker) {
    console.log('[Sticker]', JSON.stringify(msg.sticker));
  }
}

module.exports = { handleUpdate };
