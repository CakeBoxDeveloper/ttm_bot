# TTM Bot — Vercel Webhook

Telegram бот для студії масажу **Час для себе** — webhook режим для Vercel.

## Структура

```
bot-vercel/
  api/webhook.js   — Vercel serverless endpoint
  bot.js           — логіка бота 
  codes.json       — таблиця знижок (редагуй вручну)
  vercel.json      — конфіг Vercel
  package.json
```

## Деплой на Vercel

1. Зроби окремий GitHub репозиторій з цієї папки
2. Імпортуй в [vercel.com](https://vercel.com) → New Project → вибери репо
3. У Vercel Dashboard → Settings → Environment Variables додай:

| Key | Value |
|-----|-------|
| `BOT_TOKEN` | токен від @BotFather |
| `CHANNEL_ID` | `@pro_telo_niko` (можна змінити без редеплою) |
| `WEBHOOK_SECRET` | будь-який рядок, наприклад `my-secret-123` |

4. Після деплою зареєструй webhook (один раз):

```bash
curl "https://api.telegram.org/bot<BOT_TOKEN>/setWebhook\
?url=https://<твій-домен>.vercel.app/api/webhook\
&secret_token=<WEBHOOK_SECRET>"
```

## Управління кодами знижок

Редагуй `codes.json` і пуш в GitHub — Vercel автоматично перебудує.

```json
{
  "TTM1A0BTEST": { "discount": "10%", "desc": "Знижка 10% на будь-який сеанс" }
}
```

Щоб **видалити** використаний код — просто вилучи рядок і запуш.

## Логіка підписки

- При кожному `/start` — перевірка підписки на `CHANNEL_ID`
- Якщо не підписаний — кнопка підписатись, доступ заблоковано
- `CHANNEL_ID` — змінна оточення, змінюється без редеплою
