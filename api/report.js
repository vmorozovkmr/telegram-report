const TelegramBot = require('node-telegram-bot-api');
const crypto = require('crypto');

// ====================== Переменные окружения ======================
const BOT_TOKEN = process.env.BOT_TOKEN;
const TARGET_CHAT_ID = process.env.TARGET_CHAT_ID ? Number(process.env.TARGET_CHAT_ID) : null;
const TARGET_THREAD_ID = process.env.TARGET_THREAD_ID ? Number(process.env.TARGET_THREAD_ID) : null;
const REPLY_TO_MESSAGE_ID = process.env.REPLY_TO_MESSAGE_ID ? Number(process.env.REPLY_TO_MESSAGE_ID) : null;

const MAX_AUTH_AGE = 86400; // 24 часа

const bot = BOT_TOKEN ? new TelegramBot(BOT_TOKEN, { polling: false }) : null;

// ====================== Проверка initData ======================
function verifyInitData(initData, botToken) {
  try {
    if (!initData) return { ok: false, error: 'empty init_data' };

    const params = new URLSearchParams(initData);
    const receivedHash = params.get('hash');
    if (!receivedHash) return { ok: false, error: 'missing hash' };

    const dataCheckArr = [];
    for (const [key, value] of params.entries()) {
      if (key !== 'hash') {
        dataCheckArr.push(`${key}=${value}`);
      }
    }
    dataCheckArr.sort();
    const dataCheckString = dataCheckArr.join('\n');

    const secretKey = crypto
      .createHmac('sha256', 'WebAppData')
      .update(botToken)
      .digest();

    const computedHash = crypto
      .createHmac('sha256', secretKey)
      .update(dataCheckString)
      .digest('hex');

    if (computedHash !== receivedHash) {
      return { ok: false, error: 'hash mismatch' };
    }

    const authDate = Number(params.get('auth_date') || 0);
    const age = Math.floor(Date.now() / 1000) - authDate;
    if (age > MAX_AUTH_AGE) return { ok: false, error: `initData too old (${age}s)` };
    if (age < -60) return { ok: false, error: 'auth_date is in the future' };

    return { ok: true, params: Object.fromEntries(params) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ====================== Сборка текста отчёта ======================
function buildReportText(data, userName) {
  const esc = (v) => (v !== undefined && v !== null ? String(v) : '');

  const type = data.type || 'evening';

  if (type === 'morning') {
    return (
      `📊 <b>УТРЕННИЙ ОТЧЕТ</b>\n\n` +
      `💰 <b>Финансовый остаток:</b>\n` +
      `• 💵 В кассе денег: ${esc(data.cash || 0)} руб.\n` +
      `• 🖥 В 1С денег: ${esc(data.onec || 0)} руб.\n` +
      `• 💳 На карте денег: ${esc(data.card || 0)} руб.\n\n` +
      `👤 <b>Отчет сдал:</b> ${esc(userName)}`
    );
  }

  return (
    `📊 <b>ВЕЧЕРНИЙ ОТЧЕТ</b>\n\n` +
    `📂 <b>Документооборот и учет:</b>\n` +
    `• Кассовая книга: ${esc(data.kassa || '🔴 Нет')}\n` +
    `• Отчет ИИ: ${esc(data.ii || '🔴 Нет')}\n` +
    `• Реестр: ${esc(data.reestr || '🔴 Нет')}\n\n` +
    `📱 <b>Маркетинг и соцсети:</b>\n` +
    `• 📹 Размещено в ВК: ${esc(data.vk || 0)} постов\n` +
    `• ✈️🔖 Размещено в ТГ: ${esc(data.tg || 0)} постов\n` +
    `• 📺 Размещено в Макс: ${esc(data.max || 0)} постов\n\n` +
    `💰 <b>Финансовый остаток:</b>\n` +
    `• 💵 В кассе денег: ${esc(data.cash || 0)} руб.\n` +
    `• 🖥 В 1С денег: ${esc(data.onec || 0)} руб.\n` +
    `• 💳 На карте денег: ${esc(data.card || 0)} руб.\n\n` +
    `👤 <b>Отчет сдал:</b> ${esc(userName)}`
  );
}

// ====================== Главный обработчик ======================
module.exports = async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!BOT_TOKEN || !TARGET_CHAT_ID) {
    return res.status(500).json({ error: 'Server not configured' });
  }

  try {
    const body = req.body || {};

    // Проверяем initData
    const initData = body.tg_init_data;
    if (!initData) {
      return res.status(400).json({ error: 'Missing tg_init_data' });
    }

    const verification = verifyInitData(initData, BOT_TOKEN);
    if (!verification.ok) {
      console.log('initData verification failed:', verification.error);
      return res.status(403).json({ error: 'Invalid tg_init_data', details: verification.error });
    }

    // Получаем имя пользователя
    let userName = 'Сотрудник';
    let userChatId = null;

    try {
      const userStr = verification.params.user;
      if (userStr) {
        const userObj = JSON.parse(userStr);
        userName = userObj.first_name || userName;
        userChatId = userObj.id || null;
      }
    } catch (e) {}

    const data = body.data || {};
    const reportText = body.report_text;

    let finalText;
    if (reportText) {
      finalText = `<b>Отправил:</b> ${userName}\n\n${reportText}`;
    } else {
      finalText = buildReportText(data, userName);
    }

    // Параметры отправки
    const sendOptions = {
      parse_mode: 'HTML',
    };

    if (TARGET_THREAD_ID) {
      sendOptions.message_thread_id = TARGET_THREAD_ID;
    }
    if (REPLY_TO_MESSAGE_ID) {
      sendOptions.reply_to_message_id = REPLY_TO_MESSAGE_ID;
    }

    // Отправляем в рабочий чат
    console.log('Sending report to target chat...');
    await bot.sendMessage(TARGET_CHAT_ID, finalText, sendOptions);
    console.log('Report sent successfully');

    // Уведомление пользователю
    if (userChatId) {
      try {
        await bot.sendMessage(userChatId, '✅ Ваш отчет успешно отправлен в рабочий чат руководства!');
      } catch (e) {
        console.log('Failed to notify user:', e.message);
      }
    }

    return res.status(200).json({ ok: true });

  } catch (err) {
    console.error('Handler error:', err);
    return res.status(500).json({ error: err.message || 'Internal server error' });
  }
};
