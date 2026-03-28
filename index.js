const TelegramBot = require('node-telegram-bot-api');
const https = require('https');

const TOKEN = process.env.BOT_TOKEN;
const OWNER_ID = process.env.OWNER_ID;
const BIN_ID = '69c811585fdde574550b329a';
const BIN_KEY = '$2a$10$mKjpEH2VfuAAprcI6itLLevuVv1.PyilbivryoPx9fRLmjd5iVkSy';

const bot = new TelegramBot(TOKEN, { polling: true });
const userStates = {};

// ── JSONBIN ──
function binRequest(method, data) {
  return new Promise((resolve, reject) => {
    const body = data ? JSON.stringify(data) : null;
    const options = {
      hostname: 'api.jsonbin.io',
      path: `/v3/b/${BIN_ID}`,
      method,
      headers: {
        'X-Master-Key': BIN_KEY,
        'Content-Type': 'application/json',
        ...(body ? { 'Content-Length': Buffer.byteLength(body) } : {})
      }
    };
    const req = https.request(options, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { resolve({}); } });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function loadDB() {
  try {
    const res = await binRequest('GET');
    return res.record || { requests: {}, blocked: {}, counter: 1 };
  } catch (e) { return { requests: {}, blocked: {}, counter: 1 }; }
}

async function saveDB(db) {
  try { await binRequest('PUT', db); } catch (e) { console.error('Save error:', e.message); }
}

// ── HELPERS ──
function mainMenuKeyboard() {
  return { keyboard: [[{ text: 'ПОПОЛНЕНИЕ 📥' }, { text: 'ВЫВОД 📤' }]], resize_keyboard: true };
}

function backKeyboard() {
  return { keyboard: [[{ text: '◀️ Назад' }]], resize_keyboard: true };
}

function sendMainMenu(chatId, firstName) {
  bot.sendMessage(chatId,
    `🚀 Добро пожаловать${firstName ? ', ' + firstName : ''}!\n\n💰 Быстрые и безопасные финансовые операции:\n• Мгновенное пополнение счета\n• Надёжный вывод средств\n\n👨‍💼 Круглосуточная поддержка: @Xsomadmin\n\n🔒 Ваши транзакции защищены!`,
    { reply_markup: mainMenuKeyboard() }
  );
}

function sendWaitMsg(chatId, req) {
  const amount = req.type === 'deposit' ? (req.fee || req.amount) : req.amount;
  bot.sendMessage(chatId,
    `✅ Ваша заявка принята и находится на проверке!\n\n🆔 ID 1xBET: ${req.betId}\n💸 Сумма: ${amount} KGS\n\n⏳ Ожидайте ответа администратора.`,
    { reply_markup: { keyboard: [[{ text: '⬅️ Главное меню' }]], resize_keyboard: true } }
  );
}

// ── /start ──
bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;
  const db = await loadDB();
  if (db.blocked && db.blocked[String(chatId)]) {
    bot.sendMessage(chatId, `🚫 Ваш аккаунт заблокирован за нарушение правил.\n\nДля уточнения: @Xsomadmin`);
    return;
  }
  const active = Object.values(db.requests || {}).find(r => r && r.userId == chatId && r.status === 'pending');
  if (active) { sendWaitMsg(chatId, active); return; }
  userStates[chatId] = null;
  sendMainMenu(chatId, msg.from.first_name);
});

// ── /ban ──
bot.onText(/\/ban (.+)/, async (msg, match) => {
  if (String(msg.chat.id) !== String(OWNER_ID)) return;
  const targetId = match[1].trim();
  const db = await loadDB();
  db.blocked = db.blocked || {};
  db.blocked[targetId] = { userId: targetId, time: Date.now() };
  await saveDB(db);
  bot.sendMessage(msg.chat.id, `✅ Пользователь ${targetId} заблокирован.`);
  try { bot.sendMessage(targetId, `🚫 Ваш аккаунт заблокирован за нарушение правил.\n\nДля уточнения: @Xsomadmin`); } catch (e) {}
});

// ── /unban ──
bot.onText(/\/unban (.+)/, async (msg, match) => {
  if (String(msg.chat.id) !== String(OWNER_ID)) return;
  const targetId = match[1].trim();
  const db = await loadDB();
  db.blocked = db.blocked || {};
  delete db.blocked[targetId];
  await saveDB(db);
  bot.sendMessage(msg.chat.id, `✅ Пользователь ${targetId} разблокирован.`);
});

// ── MESSAGES ──
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;
  if (!text || text.startsWith('/')) return;

  const db = await loadDB();

  if (db.blocked && db.blocked[String(chatId)]) {
    bot.sendMessage(chatId, `🚫 Ваш аккаунт заблокирован за нарушение правил.`);
    return;
  }

  if (text === '⬅️ Главное меню' || text === '◀️ Назад') {
    userStates[chatId] = null;
    sendMainMenu(chatId, msg.from.first_name);
    return;
  }

  const active = Object.values(db.requests || {}).find(r => r && r.userId == chatId && r.status === 'pending');
  if (active) { sendWaitMsg(chatId, active); return; }

  const state = userStates[chatId];

  // ══ ПОПОЛНЕНИЕ ══
  if (text === 'ПОПОЛНЕНИЕ 📥') {
    userStates[chatId] = { step: 'deposit_id' };
    await bot.sendMessage(chatId,
      `📨 Введите ID 1xBET:\n\n⚠️ ID должен содержать минимум 6 символов`,
      { reply_markup: backKeyboard() }
    );
    return;
  }

  if (state && state.step === 'deposit_id') {
    if (text.length < 6) {
      await bot.sendMessage(chatId, `⚠️ ID слишком короткий! Минимум 6 символов. Введите снова:`);
      return;
    }
    userStates[chatId] = { ...state, step: 'deposit_amount', betId: text };
    const amounts = [35, 50, 150, 200, 500, 1000, 2000, 5000, 10000, 50000];
    const rows = [];
    for (let i = 0; i < amounts.length; i += 4) rows.push(amounts.slice(i, i + 4).map(a => ({ text: String(a) })));
    rows.push([{ text: '◀️ Назад' }]);
    await bot.sendMessage(chatId,
      `💰 Введите сумму пополнения:\n\n🧪 Минимум: 35 сом\n🧴 Максимум: 90 000 сом`,
      { reply_markup: { keyboard: rows, resize_keyboard: true } }
    );
    return;
  }

  if (state && state.step === 'deposit_amount') {
    const amount = parseFloat(text);
    if (isNaN(amount) || amount < 35 || amount > 90000) {
      await bot.sendMessage(chatId, `⚠️ Введите сумму от 35 до 90 000 сом`);
      return;
    }
    userStates[chatId] = { ...state, step: 'deposit_payment', amount };
    const PAYMENT_METHODS = ['Мбанк', 'О деньги', 'Компаньон', 'Balance.Kg', 'Бакай', 'Оптима', 'Mega'];
    const btns = PAYMENT_METHODS.map(m => [{ text: m }]);
    btns.push([{ text: '◀️ Назад' }]);
    await bot.sendMessage(chatId, `💳 Выберите способ оплаты:`, { reply_markup: { keyboard: btns, resize_keyboard: true } });
    return;
  }

  if (state && state.step === 'deposit_payment') {
    const PAYMENT_METHODS = ['Мбанк', 'О деньги', 'Компаньон', 'Balance.Kg', 'Бакай', 'Оптима', 'Mega'];
    if (!PAYMENT_METHODS.includes(text)) {
      await bot.sendMessage(chatId, `⚠️ Выберите способ из списка`);
      return;
    }
    userStates[chatId] = { ...state, step: 'deposit_wallet', method: text };
    await bot.sendMessage(chatId, `📱 Пришлите номер своего кошелька:`, { reply_markup: backKeyboard() });
    return;
  }

  if (state && state.step === 'deposit_wallet') {
    const fee = (state.amount * 1.01).toFixed(2);
    userStates[chatId] = { ...state, step: 'deposit_receipt', wallet: text, fee };
    await bot.sendMessage(chatId,
      `📎 Оплатите и прикрепите скриншот чека\n\n💰 Сумма к оплате: <b>${fee} KGS</b>\n\n⏱ У вас есть 5 минут на оплату`,
      {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [{ text: 'Mbank ↗️', url: 'https://mbank.kg' }, { text: 'О деньги ↗️', url: 'https://o.kg' }],
            [{ text: 'Bakai ↗️', url: 'https://bakai.kg' }, { text: 'Mega ↗️', url: 'https://mega.kg' }],
            [{ text: '◀️ Отмена', callback_data: 'cancel' }]
          ]
        }
      }
    );
    return;
  }

  // ══ ВЫВОД ══
  if (text === 'ВЫВОД 📤') {
    userStates[chatId] = { step: 'withdrawal_qr' };
    await bot.sendMessage(chatId,
      `📸 Отправьте фото QR кода вашего кошелька:`,
      { reply_markup: backKeyboard() }
    );
    return;
  }

  if (state && state.step === 'withdrawal_wallet') {
    userStates[chatId] = { ...state, step: 'withdrawal_bet_id', wallet: text };
    await bot.sendMessage(chatId,
      `📨 Введите номер счёта, с которого выводите средства (1xBET ID):`,
      { reply_markup: backKeyboard() }
    );
    return;
  }

  if (state && state.step === 'withdrawal_bet_id') {
    if (text.length < 6) {
      await bot.sendMessage(chatId, `⚠️ ID слишком короткий! Минимум 6 символов. Введите снова:`);
      return;
    }
    userStates[chatId] = { ...state, step: 'withdrawal_code', betId: text };
    await bot.sendMessage(chatId,
      `Заходим ⬇️\n📍1. Настройки!\n📍2. Вывести со счета!\n📍3. Наличные\n📍4. Сумму для Вывода!\nГород: Жалал - Абад\nУлица: Xsom KG (24/7)\n📍5. Подтвердить\n📍6. Получить Код!\n📍7. Отправить его нам\n\n💳 Отправьте код в данном сообщении:`,
      { reply_markup: backKeyboard() }
    );
    return;
  }

  if (state && state.step === 'withdrawal_code') {
    const db2 = await loadDB();
    const reqId = String(db2.counter || 1);
    db2.counter = (db2.counter || 1) + 1;
    const req = {
      id: reqId, type: 'withdrawal',
      userId: chatId, betId: state.betId,
      wallet: state.wallet, code: text,
      qrPhotoId: state.qrPhotoId,
      amount: 0,
      status: 'pending', time: Date.now(),
      firstName: msg.from.first_name || '',
      username: msg.from.username || ''
    };
    if (!db2.requests) db2.requests = {};
    db2.requests[reqId] = req;
    await saveDB(db2);
    userStates[chatId] = null;

    try {
      const caption = `╔══════════════════════╗\n║  📤 ЗАЯВКА НА ВЫВОД #${reqId}  ║\n╚══════════════════════╝\n\n👤 @${req.username || 'нет'}\n🆔 Chat ID: <code>${chatId}</code>\n🎰 1xBET ID: <code>${req.betId}</code>\n👛 Кошелёк: <code>${req.wallet}</code>\n🔑 Код: <code>${text}</code>\n\n⏰ Ожидает решения`;
      if (state.qrPhotoId) {
        await bot.sendPhoto(OWNER_ID, state.qrPhotoId, {
          caption, parse_mode: 'HTML',
          reply_markup: { inline_keyboard: [[{ text: '✅ Одобрить', callback_data: `approve_${reqId}` }, { text: '❌ Отклонить', callback_data: `reject_${reqId}` }]] }
        });
      } else {
        await bot.sendMessage(OWNER_ID, caption, {
          parse_mode: 'HTML',
          reply_markup: { inline_keyboard: [[{ text: '✅ Одобрить', callback_data: `approve_${reqId}` }, { text: '❌ Отклонить', callback_data: `reject_${reqId}` }]] }
        });
      }
    } catch (e) { console.error(e.message); }

    sendWaitMsg(chatId, req);
    return;
  }
});

// ── ФОТО ──
bot.on('photo', async (msg) => {
  const chatId = msg.chat.id;
  const state = userStates[chatId];
  const db = await loadDB();

  if (db.blocked && db.blocked[String(chatId)]) {
    bot.sendMessage(chatId, `🚫 Ваш аккаунт заблокирован.`);
    return;
  }

  const active = Object.values(db.requests || {}).find(r => r && r.userId == chatId && r.status === 'pending');
  if (active) { sendWaitMsg(chatId, active); return; }

  if (state && state.step === 'withdrawal_qr') {
    const qrPhotoId = msg.photo[msg.photo.length - 1].file_id;
    userStates[chatId] = { ...state, step: 'withdrawal_wallet', qrPhotoId };
    await bot.sendMessage(chatId, `📱 Пришлите номер своего кошелька:`, { reply_markup: backKeyboard() });
    return;
  }

  if (state && state.step === 'deposit_receipt') {
    const photoId = msg.photo[msg.photo.length - 1].file_id;
    let photoUrl = null;
    try { const fi = await bot.getFile(photoId); photoUrl = `https://api.telegram.org/file/bot${TOKEN}/${fi.file_path}`; } catch (e) {}

    const db2 = await loadDB();
    const reqId = String(db2.counter || 1);
    db2.counter = (db2.counter || 1) + 1;
    const req = {
      id: reqId, type: 'deposit',
      userId: chatId, betId: state.betId,
      method: state.method, wallet: state.wallet,
      amount: state.amount, fee: state.fee,
      photoUrl, status: 'pending', time: Date.now(),
      firstName: msg.from.first_name || '',
      username: msg.from.username || ''
    };
    if (!db2.requests) db2.requests = {};
    db2.requests[reqId] = req;
    await saveDB(db2);
    userStates[chatId] = null;

    try {
      await bot.sendPhoto(OWNER_ID, photoId, {
        caption: `╔══════════════════════╗\n║  📥 ЗАЯВКА НА ПОПОЛНЕНИЕ #${reqId}  ║\n╚══════════════════════╝\n\n👤 @${req.username || 'нет'}\n🆔 Chat ID: <code>${chatId}</code>\n🎰 1xBET ID: <code>${req.betId}</code>\n💳 Способ: ${req.method}\n📱 Кошелёк: <code>${req.wallet}</code>\n💰 Сумма: <b>${req.fee} KGS</b>\n\n⏰ Ожидает решения`,
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: [[{ text: '✅ Одобрить', callback_data: `approve_${reqId}` }, { text: '❌ Отклонить', callback_data: `reject_${reqId}` }]] }
      });
    } catch (e) { console.error(e.message); }

    sendWaitMsg(chatId, req);
    return;
  }
});

// ── CALLBACK ──
bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  const msgId = query.message.message_id;
  const data = query.data;

  if (data === 'cancel') {
    await bot.answerCallbackQuery(query.id);
    userStates[chatId] = null;
    sendMainMenu(chatId);
    return;
  }

  if (data.startsWith('approve_')) {
    const reqId = data.replace('approve_', '');
    const db = await loadDB();
    const req = db.requests && db.requests[reqId];
    if (!req) { await bot.answerCallbackQuery(query.id, { text: '❌ Заявка не найдена' }); return; }
    req.status = 'approved';
    await saveDB(db);
    await bot.answerCallbackQuery(query.id, { text: '✅ Одобрено!' });
    const m = req.type === 'deposit'
      ? `✅ Средства успешно зачислены на ваш счёт💸\n\n🎰 ${req.betId} — Счёт успешно пополнен\n💰 ${req.fee || req.amount} KGS\n\nЖдём вас снова 🫶`
      : `✅ Средства успешно выведены💸\n\n🎰 ${req.betId} — Вывод выполнен\n\nЖдём вас снова 🫶`;
    try { await bot.sendMessage(req.userId, m, { reply_markup: mainMenuKeyboard() }); } catch (e) {}
    try { await bot.editMessageCaption(`✅ ОДОБРЕНО`, { chat_id: chatId, message_id: msgId }); } catch (e) {
      try { await bot.editMessageText(`✅ ОДОБРЕНО`, { chat_id: chatId, message_id: msgId }); } catch (e2) {}
    }
    return;
  }

  if (data.startsWith('reject_')) {
    const reqId = data.replace('reject_', '');
    const db = await loadDB();
    const req = db.requests && db.requests[reqId];
    if (!req) { await bot.answerCallbackQuery(query.id, { text: '❌ Заявка не найдена' }); return; }
    req.status = 'rejected';
    await saveDB(db);
    await bot.answerCallbackQuery(query.id, { text: '❌ Отклонено' });
    try { await bot.sendMessage(req.userId, `🚫 Заявка отклонена\n❗ Зафиксированы несоответствия в данных. Рекомендуем соблюдать честность при операциях!`, { reply_markup: mainMenuKeyboard() }); } catch (e) {}
    try { await bot.editMessageCaption(`❌ ОТКЛОНЕНО`, { chat_id: chatId, message_id: msgId }); } catch (e) {
      try { await bot.editMessageText(`❌ ОТКЛОНЕНО`, { chat_id: chatId, message_id: msgId }); } catch (e2) {}
    }
    return;
  }
});

console.log('🤖 XsomKG бот запущен...');
