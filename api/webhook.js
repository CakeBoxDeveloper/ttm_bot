'use strict';

const { handleUpdate } = require('../bot');

/**
 * Vercel serverless function — receives Telegram webhook POST
 */
module.exports = async (req, res) => {
  // Verify secret token
  const secret = req.headers['x-telegram-bot-api-secret-token'];
  if (process.env.WEBHOOK_SECRET && secret !== process.env.WEBHOOK_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (req.method !== 'POST') {
    return res.status(200).json({ ok: true });
  }

  try {
    await handleUpdate(req.body);
  } catch (err) {
    console.error('Bot error:', err);
    // Always return 200 to Telegram so it doesn't retry
  }

  res.status(200).json({ ok: true });
};
