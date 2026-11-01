'use strict';

/**
 * TTM Massage Bot — Vercel Webhook version
 *
 * Vercel environment variables:
 *   BOT_TOKEN            — Telegram bot token from @BotFather
 *   CHANNEL_ID           — e.g. @pro_telo_niko (change without redeploy)
 *   GOOGLE_CLIENT_EMAIL  — service account email
 *   GOOGLE_PRIVATE_KEY   — service account private key (with \n as newlines)
 *   SHEET_ID             — Google Spreadsheet ID from URL
 *
 * Register webhook once after deploy:
 *   curl "https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://<project>.vercel.app/api/webhook"
 */

const TelegramBot = require('node-telegram-bot-api');

const CHANNEL = process.env.CHANNEL_ID || '@pro_telo_niko';

// Lazy-init bot — prevents crash when env vars aren't set at build time
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
    console.error(`isSubscribed check failed for channel ${CHANNEL}:`, err.message);
    return false;
  }
}

/* ─── Subscribe prompt ─── */
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

/* ─── Main menu inline keyboard (fallback) ─── */
const MAIN_INLINE = {
  reply_markup: {
    inline_keyboard: [
      [{ text: 'Записатись на прийом',   callback_data: 'book'  }],
      [{ text: 'Перевірити бонусний код', callback_data: 'promo' }],
    ]
  }
};

/* ══════════════════════════════════════
   BOOKING SESSION STATE
   Stored per chatId in memory.
   Resets on Vercel cold start — acceptable since
   each step is very fast (seconds, not minutes).
══════════════════════════════════════ */

/**
 * bookingState[chatId] = {
 *   step: 'date' | 'hour' | 'name' | 'phone',
 *   date: "DD.MM.YYYY",
 *   hour: 14,
 *   name: "Ім'я",
 *   dateOffset: 0   // pagination offset for date list
 * }
 */
const bookingState = {};

function clearBooking(chatId) {
  delete bookingState[chatId];
}

/* ─── State (for promo code flow) ─── */
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

/* ─── Send main menu ─── */
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
            `<p>ㅤ</p>`,
          media: [
            {
              id: 'menu_img',
              media: {
                type: 'photo',
                media: 'https://github.com/CakeBoxDeveloper/ttm_bot/blob/main/Slogan.png?raw=true'
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

/* ══════════════════════════════════════
   BOOKING FLOW HELPERS
══════════════════════════════════════ */

const DATES_PER_PAGE = 12;  // 4 колонки × 3 рядки
const DAY_NAMES = ['Нд','Пн','Вт','Ср','Чт','Пт','Сб'];

/**
 * Send date-picker via sendRichMessage — кнопки с цветом.
 * Зелёные (success) = есть свободные слоты, красные (danger) = всё занято.
 * Пагинация ◀ ▶
 */
async function sendDatePicker(bot, chatId, offset = 0) {
  const token = process.env.BOT_TOKEN;
  const { getDatePage } = getSheets();

  let page, total;
  try {
    const result = await getDatePage(offset, DATES_PER_PAGE);
    page  = result.dates;
    total = result.total;
  } catch (err) {
    console.error('getDatePage error:', err.message);
    await bot.sendMessage(chatId,
      '⚠️ Не вдалося завантажити розклад. Спробуй пізніше або запишись через @Olga_Dind',
      { reply_markup: { inline_keyboard: [[{ text: '🔙 Меню', callback_data: 'menu' }]] } }
    );
    return;
  }

  if (page.length === 0) {
    await bot.sendMessage(chatId,
      '😔 Вільних дат немає. Спробуй пізніше або запишись через @Olga_Dind',
      { reply_markup: { inline_keyboard: [[{ text: '🔙 Меню', callback_data: 'menu' }]] } }
    );
    return;
  }

  // Клавіатура: 4 кнопки в рядок, style: success/danger
  const keyboard = [];
  for (let i = 0; i < page.length; i += 4) {
    keyboard.push(
      page.slice(i, i + 4).map(({ dateStr, hasFree }) => {
        const parts  = dateStr.split('.');
        const jsDate = new Date(Number(parts[2]), Number(parts[1]) - 1, Number(parts[0]));
        const label  = `${DAY_NAMES[jsDate.getDay()]} ${parts[0]}.${parts[1]}`;
        return {
          text:          label,
          callback_data: `date:${dateStr}`,
          style:         hasFree ? 'success' : 'danger',
        };
      })
    );
  }

  // Навігація ◀ ▶
  const navRow = [];
  if (offset > 0) {
    navRow.push({ text: '◀', callback_data: `dates_page:${Math.max(0, offset - DATES_PER_PAGE)}`, style: 'primary' });
  }
  if (offset + DATES_PER_PAGE < total) {
    navRow.push({ text: '▶', callback_data: `dates_page:${offset + DATES_PER_PAGE}`, style: 'primary' });
  }
  if (navRow.length > 0) keyboard.push(navRow);
  keyboard.push([{ text: '🔙 Меню', callback_data: 'menu', style: 'secondary' }]);

  const pageNum  = Math.floor(offset / DATES_PER_PAGE) + 1;
  const totalPgs = Math.ceil(total / DATES_PER_PAGE);

  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendRichMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id:      chatId,
        rich_message: { html: `<p>📅 Оберіть дату (стор. ${pageNum}/${totalPgs}):</p>` },
        reply_markup: { inline_keyboard: keyboard },
      })
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.description);
  } catch (err) {
    console.error('sendDatePicker richMessage failed:', err.message);
    // fallback без кольору
    await bot.sendMessage(chatId,
      `📅 Оберіть дату (стор. ${pageNum}/${totalPgs}):`,
      { reply_markup: { inline_keyboard: keyboard } }
    );
  }
}

/**
 * Send hour-picker via sendRichMessage — зелені/червоні кнопки.
 */
async function sendHourPicker(bot, chatId, dateStr) {
  const token = process.env.BOT_TOKEN;
  const { getHourSlots } = getSheets();

  let slots;
  try {
    slots = await getHourSlots(dateStr);
  } catch (err) {
    console.error('getHourSlots error:', err.message);
    await bot.sendMessage(chatId,
      '⚠️ Не вдалося завантажити слоти. Спробуй пізніше.',
      { reply_markup: { inline_keyboard: [[{ text: '🔙 Меню', callback_data: 'menu' }]] } }
    );
    return;
  }

  if (slots.length === 0) {
    await bot.sendMessage(chatId,
      `😔 Дата ${dateStr} не знайдена в розкладі.`,
      { reply_markup: { inline_keyboard: [[{ text: '📅 Інша дата', callback_data: 'book_online' }, { text: '🔙 Меню', callback_data: 'menu' }]] } }
    );
    return;
  }

  // 4 кнопки в рядок, style: success/danger
  const keyboard = [];
  for (let i = 0; i < slots.length; i += 4) {
    keyboard.push(
      slots.slice(i, i + 4).map(({ hour, free }) => ({
        text:          `${hour}:00`,
        callback_data: free ? `hour:${hour}` : `hour_taken:${hour}`,
        style:         free ? 'success' : 'danger',
      }))
    );
  }
  keyboard.push([
    { text: '📅 Інша дата', callback_data: 'book_online', style: 'primary' },
    { text: '🔙 Меню',      callback_data: 'menu',        style: 'secondary' },
  ]);

  const parts   = dateStr.split('.');
  const jsDate  = new Date(Number(parts[2]), Number(parts[1]) - 1, Number(parts[0]));
  const dayLabel = `${DAY_NAMES[jsDate.getDay()]}, ${dateStr}`;

  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendRichMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id:      chatId,
        rich_message: { html: `<p>🕐 <b>${dayLabel}</b> — оберіть час:</p>` },
        reply_markup: { inline_keyboard: keyboard },
      })
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.description);
  } catch (err) {
    console.error('sendHourPicker richMessage failed:', err.message);
    await bot.sendMessage(chatId,
      `🕐 ${dayLabel} — оберіть час:`,
      { reply_markup: { inline_keyboard: keyboard } }
    );
  }
}

/* ══════════════════════════════════════
   MAIN HANDLER
══════════════════════════════════════ */
async function handleUpdate(update) {
  const bot = getBot();

  /* ── Callback query (inline button press) ── */
  if (update.callback_query) {
    const cq     = update.callback_query;
    const chatId = cq.message.chat.id;
    const userId = cq.from.id;
    const data   = cq.data;

    /* Check subscription button */
    if (data === 'check_sub') {
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

    /* Noop — display-only colored buttons */
    if (data === 'noop') {
      await bot.answerCallbackQuery(cq.id);
      return;
    }

    /* ── BOOKING: start — show date picker ── */
    if (data === 'book') {
      await bot.answerCallbackQuery(cq.id);
      clearBooking(chatId);
      bookingState[chatId] = { step: 'date', dateOffset: 0 };

      const token = process.env.BOT_TOKEN;
      try {
        // Show booking image + message first
        const res = await fetch(`https://api.telegram.org/bot${token}/sendRichMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            rich_message: {
              html:
                `<img src="tg://photo?id=book_img" />` +
                `<p>⚠️ Наш датацентр наразі працює під великим навантаженням через обстріли.</p>` +
                `<p>Але ви завжди можете записатись <b>особисто</b> — напишіть майстру напряму 👇</p>`,
              media: [
                {
                  id: 'book_img',
                  media: {
                    type: 'photo',
                    media: 'https://github.com/CakeBoxDeveloper/ttm_bot/blob/main/BotQuery.png?raw=true'
                  }
                }
              ]
            },
            reply_markup: {
              inline_keyboard: [
                [{ text: '💬 Записатись до Ольги', url: 'https://t.me/Olga_Dind', style: 'success' }],
                [{ text: '📅 Онлайн-запис', web_app: { url: `https://${process.env.VERCEL_URL || process.env.APP_URL}/book` }, style: 'primary' }],
                [{ text: '🔙 Повернутись до меню', callback_data: 'menu', style: 'secondary' }]
              ]
            }
          })
        });
        const d = await res.json();
        if (!d.ok) throw new Error(d.description);
      } catch (err) {
        console.error('book sendRichMessage failed:', err.message);
        await bot.sendMessage(chatId,
          '⚠️ Наш датацентр наразі під великим навантаженням через обстріли.\n\nАле можна записатись особисто — напишіть майстру: @Olga_Dind',
          {
            reply_markup: {
              inline_keyboard: [
                [{ text: '💬 Записатись до Ольги', url: 'https://t.me/Olga_Dind' }],
                [{ text: '📅 Онлайн-запис', web_app: { url: `https://${process.env.APP_URL || 'ttmbot.vercel.app'}/book` } }],
                [{ text: '🔙 Повернутись до меню', callback_data: 'menu' }]
              ]
            }
          }
        );
      }
      return;
    }

    /* ── BOOKING ONLINE: show date picker ── */
    if (data === 'book_online') {
      await bot.answerCallbackQuery(cq.id);
      clearBooking(chatId);
      bookingState[chatId] = { step: 'date', dateOffset: 0 };
      await sendDatePicker(bot, chatId, 0);
      return;
    }

    /* ── BOOKING: more dates (pagination) ── */
    if (data.startsWith('dates_page:')) {
      await bot.answerCallbackQuery(cq.id);
      const offset = parseInt(data.split(':')[1], 10) || 0;
      if (bookingState[chatId]) bookingState[chatId].dateOffset = offset;
      await sendDatePicker(bot, chatId, offset);
      return;
    }

    /* ── BOOKING: date selected ── */
    if (data.startsWith('date:')) {
      await bot.answerCallbackQuery(cq.id);
      const dateStr = data.slice(5);   // "DD.MM.YYYY"
      bookingState[chatId] = { ...(bookingState[chatId] || {}), step: 'hour', date: dateStr };
      await sendHourPicker(bot, chatId, dateStr);
      return;
    }

    /* ── BOOKING: hour selected ── */
    if (data.startsWith('hour:')) {
      await bot.answerCallbackQuery(cq.id);
      const hour = parseInt(data.split(':')[1], 10);
      const state = bookingState[chatId];
      if (!state || !state.date) {
        await sendDatePicker(bot, chatId, 0);
        return;
      }
      bookingState[chatId] = { ...state, step: 'name', hour };
      await bot.sendMessage(chatId,
        `✅ ${state.date} о ${hour}:00\n\nВведіть ваше ім'я:`,
        { reply_markup: { inline_keyboard: [[{ text: '❌ Скасувати', callback_data: 'cancel_booking' }]] } }
      );
      return;
    }

    /* ── BOOKING: hour already taken ── */
    if (data.startsWith('hour_taken:')) {
      await bot.answerCallbackQuery(cq.id, {
        text: '🔴 Цей час вже зайнятий. Оберіть інший.',
        show_alert: true
      });
      return;
    }

    /* ── BOOKING: cancel ── */
    if (data === 'cancel_booking') {
      await bot.answerCallbackQuery(cq.id);
      clearBooking(chatId);
      await sendMainMenu(bot, chatId);
      return;
    }

    /* Promo code — ask to enter */
    if (data === 'promo') {
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

    /* Cancel promo */
    if (data === 'cancel') {
      await bot.answerCallbackQuery(cq.id);
      waitingForCode.delete(chatId);
      await sendMainMenu(bot, chatId);
      return;
    }

    /* Back to menu */
    if (data === 'menu') {
      await bot.answerCallbackQuery(cq.id);
      clearBooking(chatId);
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
    clearBooking(chatId);
    waitingForCode.delete(chatId);
    const ok = await isSubscribed(userId);
    console.log(`[/start] isSubscribed=${ok}`);
    if (!ok) { await subscribePrompt(chatId); return; }
    await sendMainMenu(bot, chatId);
    return;
  }

  /* Check subscription for all other messages */
  const ok = await isSubscribed(userId);
  if (!ok) { await subscribePrompt(chatId); return; }

  /* ── BOOKING: collect name ── */
  const state = bookingState[chatId];
  if (state && state.step === 'name') {
    bookingState[chatId] = { ...state, step: 'phone', name: text };
    await bot.sendMessage(chatId,
      `📝 Ім'я: *${text}*\n\nВведіть номер телефону (або натисніть «Пропустити»):`,
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '➡️ Пропустити', callback_data: 'skip_phone' }],
            [{ text: '❌ Скасувати', callback_data: 'cancel_booking' }]
          ]
        }
      }
    );
    return;
  }

  /* ── BOOKING: collect phone ── */
  if (state && state.step === 'phone') {
    await finishBooking(bot, chatId, cq, msg, text);
    return;
  }

  /* ── PROMO: process promo code ── */
  if (waitingForCode.has(chatId)) {
    waitingForCode.delete(chatId);
    const code = text.toUpperCase();

    try {
      const { findPromo } = getSheets();
      const result = await findPromo(code);
      const token  = process.env.BOT_TOKEN;

      if (!result.found) {
        await sendRichMsg(token, chatId,
          `<tg-button-row align="center">` +
          `<tg-button type="url" style="danger" url="https://t.me/${CHANNEL.replace('@', '')}">Код ${code} не знайдено. Зіграй у лотерею на сайті</tg-button>` +
          `</tg-button-row>`,
          [
            [{ text: 'Повернутись до меню',  callback_data: 'menu',  style: 'success' }],
            [{ text: 'Спробувати інший код', callback_data: 'promo', style: 'primary' }],
          ]
        );
      } else if (result.used) {
        await sendRichMsg(token, chatId,
          `<tg-button-row align="center">` +
          `<tg-button type="url" style="danger" url="https://t.me/${CHANNEL.replace('@', '')}">Код ${code} вже використано</tg-button>` +
          `</tg-button-row>`,
          [
            [{ text: 'Повернутись до меню',  callback_data: 'menu',  style: 'success' }],
            [{ text: 'Спробувати інший код', callback_data: 'promo', style: 'primary' }],
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

  if (msg.sticker) {
    console.log('[Sticker]', JSON.stringify(msg.sticker));
  }
}

/* ══════════════════════════════════════
   FINISH BOOKING — called after name+phone collected
   Also handles 'skip_phone' callback
══════════════════════════════════════ */
async function finishBooking(bot, chatId, cq, msg, phone) {
  const state = bookingState[chatId];
  if (!state || !state.date || !state.hour || !state.name) {
    clearBooking(chatId);
    await sendMainMenu(bot, chatId);
    return;
  }

  clearBooking(chatId);

  const { date, hour, name } = state;
  const username = msg ? (msg.from.username ? `@${msg.from.username}` : '') : '';
  const phoneStr = (phone && phone !== 'skip') ? phone : '';

  try {
    const { bookSlot } = getSheets();
    const result = await bookSlot(date, hour, name, username, phoneStr);

    if (result === 'ok') {
      await bot.sendMessage(chatId,
        `✅ Запис підтверджено!\n\n📅 ${date} о ${hour}:00\n👤 ${name}${phoneStr ? '\n📞 ' + phoneStr : ''}\n\nЧекаємо на вас! 💆`,
        {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [[{ text: '🔙 Головне меню', callback_data: 'menu' }]]
          }
        }
      );
    } else if (result === 'taken') {
      await bot.sendMessage(chatId,
        `😔 На жаль, ${date} о ${hour}:00 вже зайнято.\n\nОберіть інший час:`,
        {
          reply_markup: {
            inline_keyboard: [
              [{ text: '🕐 Інший час',  callback_data: `date:${date}` }],
              [{ text: '📅 Інша дата',  callback_data: 'book_online'  }],
              [{ text: '🔙 Меню',       callback_data: 'menu'         }]
            ]
          }
        }
      );
    } else {
      await bot.sendMessage(chatId,
        `⚠️ Дата ${date} не знайдена в розкладі. Спробуй інший варіант.`,
        {
          reply_markup: {
            inline_keyboard: [
              [{ text: '📅 Обрати дату', callback_data: 'book_online' }],
              [{ text: '🔙 Меню',        callback_data: 'menu'         }]
            ]
          }
        }
      );
    }
  } catch (err) {
    console.error('bookSlot error:', err.message);
    await bot.sendMessage(chatId,
      '⚠️ Помилка при записі. Спробуй ще раз або запишись через @Olga_Dind',
      {
        reply_markup: { inline_keyboard: [[{ text: '🔙 Меню', callback_data: 'menu' }]] }
      }
    );
  }
}

/* ══════════════════════════════════════
   Handle 'skip_phone' callback — wired into handleUpdate
══════════════════════════════════════ */
const _origHandleUpdate = handleUpdate;

// Patch: handle skip_phone inline callback inside the callback_query branch
// We do this by augmenting handleUpdate post-definition via a wrapper.
// (skip_phone arrives as a callback_query, not a text message)
const handleUpdateWithSkip = async (update) => {
  if (
    update.callback_query &&
    update.callback_query.data === 'skip_phone'
  ) {
    const cq     = update.callback_query;
    const chatId = cq.message.chat.id;
    const userId = cq.from.id;

    // Subscription check
    const subOk = await isSubscribed(userId);
    if (!subOk) {
      await getBot().answerCallbackQuery(cq.id);
      await subscribePrompt(chatId);
      return;
    }

    const state = bookingState[chatId];
    if (!state || state.step !== 'phone') {
      await getBot().answerCallbackQuery(cq.id);
      await sendMainMenu(getBot(), chatId);
      return;
    }

    await getBot().answerCallbackQuery(cq.id);
    // Move to finishBooking with empty phone
    await finishBooking(getBot(), chatId, null, cq.message, '');
    return;
  }

  return _origHandleUpdate(update);
};

module.exports = { handleUpdate: handleUpdateWithSkip };
