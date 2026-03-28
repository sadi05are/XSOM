const TelegramBot = require('node-telegram-bot-api');
const https = require('https');

const TOKEN = process.env.BOT_TOKEN;
const OWNER_ID = process.env.OWNER_ID;
const BIN_ID = '69c811585fdde574550b329a';
const BIN_KEY = '$2a$10$mKjpEH2VfuAAprcI6itLLevuVv1.PyilbivryoPx9fRLmjd5iVkSy';

const bot = new TelegramBot(TOKEN, { polling: true });
const userStates = {};

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

const PAYMENT_METHODS = ['Мбанк', 'О деньги', 'Компаньон', 'Balance.Kg', 'Бакай', 'Оптима', 'Mega'];
const PAYMENT_LINKS = {
  'Мбанк': 'https://mbank.kg', 'О деньги': 'https://o.kg',
  'Компаньон': 'https://kompanion.kg', 'Balance.Kg': 'https://balance.kg',
  'Бакай': 'https://bakai.kg', 'Оптима': 'https://optima.kg', 'Mega': 'https://mega.kg',
};
const AMOUNTS = [35, 50, 150, 200, 500, 1000, 2000, 5000, 10000, 50000];

function sendMainMenu(chatId, firstName) {
  bot.sendMessage(chatId,
    `🚀 Добро пожаловать${firstName ? ', ' + firstName : ''}!\n\n💰 Быстрые и безопасные финансовые операции:\n• Мгновенное пополнение счета\n• Надёжный вывод средств\n\n👨‍💼 Круглосуточная поддержка: @Xsomadmin\n\n🔒 Ваши транзакции защищены!`,
    { reply_markup: { keyboard: [[{ text: 'ПОПОЛНЕНИЕ 📥' }, { text: 'ВЫВОД 📤' }]], resize_keyboard: true } }
  );
}

function sendActiveMsg(chatId, req) {
  const amount = req.type === 'deposit' ? req.fee : req.amount;
  bot.sendMessage(chatId, `✅ Ваша заявка на проверке!\n🆔 ID 1xbet: ${req.betId}\n💸 Сумма: ${amount}`,
    { reply_markup: { keyboard: [[{ text: '⬅️ Главное меню' }]], resize_keyboard: true } });
}

async function sendAmountButtons(chatId, text) {
  const rows = [];
  for (let i = 0; i < AMOUNTS.length; i += 4) rows.push(AMOUNTS.slice(i, i + 4).map(a => ({ text: String(a) })));
  rows.push([{ text: '◀️ Отмена' }]);
  await bot.sendMessage(chatId, text, { reply_markup: { keyboard: rows, resize_keyboard: true } });
}

const delay = ms => new Promise(r => setTimeout(r, ms));

bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;
  const db = await loadDB();
  if (db.blocked && db.blocked[chatId]) { bot.sendMessage(chatId, `🚫 Ваш аккаунт заблокирован. Обратитесь: @Xsomadmin`); return; }
  const active = Object.values(db.requests || {}).find(r => r && r.userId == chatId && r.status === 'pending');
  if (active) { sendActiveMsg(chatId, active); return; }
  userStates[chatId] = null;
  sendMainMenu(chatId, msg.from.first_name);
});

bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;
  const state = userStates[chatId];
  if (!text || text.startsWith('/')) return;

  const db = await loadDB();
  if (db.blocked && db.blocked[chatId]) { bot.sendMessage(chatId, `🚫 Ваш аккаунт заблокирован.`); return; }
  if (text === '🔄 Вызвать меню') { userStates[chatId] = null; sendMainMenu(chatId, msg.from.first_name); return; }
  const active = Object.values(db.requests || {}).find(r => r && r.userId == chatId && r.status === 'pending');
  if (active) { sendActiveMsg(chatId, active); return; }
  if (text === '⬅️ Главное меню' || text === '◀️ Отмена') { userStates[chatId] = null; sendMainMenu(chatId, msg.from.first_name); return; }

  if (text === 'ПОПОЛНЕНИЕ 📥') {
    userStates[chatId] = { step: 'deposit_amount' };
    await sendAmountButtons(chatId, `💰 Отправьте сумму пополнения:\n\n🧪 Минимальный : 35с\n🧴 Максимально : 90000с`);
    return;
  }

  if (text === 'ВЫВОД 📤') {
    userStates[chatId] = { step: 'withdrawal_qr' };
    await bot.sendMessage(chatId, `❌ Не найдено ни одного запроса на выплату.`, { reply_markup: { keyboard: [[{ text: '◀️ Отмена' }]], resize_keyboard: true } });
    await delay(500);
    await bot.sendMessage(chatId, `📸 Отправьте QR код вашего кошелька`, { reply_markup: { keyboard: [[{ text: '◀️ Отмена' }]], resize_keyboard: true } });
    return;
  }

  if (state && state.step === 'deposit_amount') {
    const amount = parseFloat(text);
    if (isNaN(amount) || amount < 35 || amount > 90000) { await bot.sendMessage(chatId, `⚠️ Введите сумму от 35 до 90,000 сом`); return; }
    userStates[chatId] = { step: 'deposit_id', amount };
    await bot.sendMessage(chatId, `🖥 <b>Пополнение счёта</b>\n\n🤿 Введите номер счёта (1xBET ID):`, { parse_mode: 'HTML', reply_markup: { keyboard: [[{ text: '◀️ Отмена' }]], resize_keyboard: true } });
    return;
  }

  if (state && state.step === 'deposit_id') {
    userStates[chatId] = { ...state, step: 'deposit_payment', betId: text };
    const btns = PAYMENT_METHODS.map(m => [{ text: m }]);
    btns.push([{ text: '◀️ Отмена' }]);
    await bot.sendMessage(chatId, `📦 Выберите способ оплаты:`, { reply_markup: { keyboard: btns, resize_keyboard: true } });
    return;
  }

  if (state && state.step === 'deposit_payment' && PAYMENT_METHODS.includes(text)) {
    userStates[chatId] = { ...state, step: 'deposit_wallet', method: text };
    await bot.sendMessage(chatId, `📱 Пришлите номер своего кошелька:`, { reply_markup: { keyboard: [[{ text: '◀️ Отмена' }]], resize_keyboard: true } });
    return;
  }

  if (state && state.step === 'deposit_wallet') {
    const fee = (state.amount * 1.01).toFixed(2);
    userStates[chatId] = { ...state, step: 'deposit_receipt', wallet: text, fee };
    const link = PAYMENT_LINKS[state.method] || '#';
    await bot.sendMessage(chatId,
      `📎 Прикрепите скриншот чека\n\nСумма: ${fee} KGS✅\n\n❗️ Оплатите и отправьте скриншот чека в течении 5 минут`,
      { reply_markup: { inline_keyboard: [
        [{ text: 'Mbank ↗️', url: link }, { text: 'О деньги ↗️', url: 'https://o.kg' }],
        [{ text: 'Bakai ↗️', url: 'https://bakai.kg' }, { text: 'Mega ↗️', url: 'https://mega.kg' }],
        [{ text: '◀️ Отмена', callback_data: 'cancel' }]
      ]}});
    return;
  }

  if (state && state.step === 'withdrawal_amount') {
    const amount = parseFloat(text);
    if (isNaN(amount) || amount < 150) { await bot.sendMessage(chatId, `⚠️ Минимальная сумма вывода 150 KGS`); return; }
    userStates[chatId] = { ...state, step: 'withdrawal_city', amount };
    await bot.sendMessage(chatId, `🏙 Выберите город:`, { reply_markup: { keyboard: [[{ text: 'Бишкек' }, { text: 'Жалал-Абад' }], [{ text: 'Ош' }, { text: 'Каракол' }], [{ text: '◀️ Отмена' }]], resize_keyboard: true }});
    return;
  }

  if (state && state.step === 'withdrawal_city') {
    userStates[chatId] = { ...state, step: 'withdrawal_confirm', city: text };
    await bot.sendMessage(chatId, `✅ Подтвердите заявку:\n\n💰 Сумма: ${state.amount} KGS\n🏙 Город: ${text}`, { reply_markup: { keyboard: [[{ text: '✅ Подтвердить' }], [{ text: '◀️ Отмена' }]], resize_keyboard: true }});
    return;
  }

  if (state && state.step === 'withdrawal_confirm' && text === '✅ Подтвердить') {
    userStates[chatId] = { ...state, step: 'withdrawal_bet_id' };
    await bot.sendMessage(chatId, `🖥 <b>Вывод средств</b>\n\n🤿 Введите ID 1XBET:`, { parse_mode: 'HTML', reply_markup: { keyboard: [[{ text: '◀️ Отмена' }]], resize_keyboard: true }});
    return;
  }

  if (state && state.step === 'withdrawal_bet_id') {
    const db2 = await loadDB();
    const reqId = String(db2.counter || 1);
    db2.counter = (db2.counter || 1) + 1;
    const req = { id: reqId, type: 'withdrawal', userId: chatId, betId: text, amount: state.amount, city: state.city, status: 'pending', time: Date.now(), firstName: msg.from.first_name || '', username: msg.from.username || '' };
    if (!db2.requests) db2.requests = {};
    db2.requests[reqId] = req;
    await saveDB(db2);
    userStates[chatId] = null;

    try {
      await bot.sendMessage(OWNER_ID,
        `╔══════════════════════╗\n║  📤 <b>ЗАЯВКА НА ВЫВОД #${reqId}</b>  ║\n╚══════════════════════╝\n\n👤 Пользователь: <code>${chatId}</code>${req.username ? ' @' + req.username : ''}\n🆔 1xBET ID: <code>${text}</code>\n💰 Сумма: <b>${state.amount} KGS</b>\n🏙 Город: ${state.city}\n\n⏰ Ожидает решения`,
        { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: '✅ Одобрить', callback_data: `approve_${reqId}` }, { text: '❌ Отклонить', callback_data: `reject_${reqId}` }]] }});
    } catch (e) { console.error(e.message); }

    sendActiveMsg(chatId, req);
    return;
  }
});

bot.on('photo', async (msg) => {
  const chatId = msg.chat.id;
  const state = userStates[chatId];
  const db = await loadDB();
  if (db.blocked && db.blocked[chatId]) { bot.sendMessage(chatId, `🚫 Ваш аккаунт заблокирован.`); return; }
  const active = Object.values(db.requests || {}).find(r => r && r.userId == chatId && r.status === 'pending');
  if (active) { sendActiveMsg(chatId, active); return; }

  if (state && state.step === 'withdrawal_qr') {
    userStates[chatId] = { step: 'withdrawal_amount', qrPhotoId: msg.photo[msg.photo.length - 1].file_id };
    await sendAmountButtons(chatId, `💰 Отправьте сумму вывода:\n\n🧪 Минимальный : 150с\n🧴 Максимально : 90000с`);
    return;
  }

  if (state && state.step === 'deposit_receipt') {
    const photoId = msg.photo[msg.photo.length - 1].file_id;
    let photoUrl = null;
    try { const fi = await bot.getFile(photoId); photoUrl = `https://api.telegram.org/file/bot${TOKEN}/${fi.file_path}`; } catch (e) {}

    const db2 = await loadDB();
    const reqId = String(db2.counter || 1);
    db2.counter = (db2.counter || 1) + 1;
    const req = { id: reqId, type: 'deposit', userId: chatId, betId: state.betId, method: state.method, wallet: state.wallet, amount: state.amount, fee: state.fee, photoUrl, status: 'pending', time: Date.now(), firstName: msg.from.first_name || '', username: msg.from.username || '' };
    if (!db2.requests) db2.requests = {};
    db2.requests[reqId] = req;
    await saveDB(db2);
    userStates[chatId] = null;

    try {
      await bot.sendPhoto(OWNER_ID, photoId, {
        caption: `╔══════════════════════╗\n║  📥 <b>ЗАЯВКА НА ПОПОЛНЕНИЕ #${reqId}</b>  ║\n╚══════════════════════╝\n\n👤 Пользователь: <code>${chatId}</code>${req.username ? ' @' + req.username : ''}\n🆔 1xBET ID: <code>${req.betId}</code>\n💳 Способ: ${req.method}\n📱 Кошелёк: <code>${req.wallet}</code>\n💰 Сумма: <b>${req.fee} KGS</b>`,
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: [[{ text: '✅ Одобрить', callback_data: `approve_${reqId}` }, { text: '❌ Отклонить', callback_data: `reject_${reqId}` }]] }
      });
    } catch (e) { console.error(e.message); }

    sendActiveMsg(chatId, req);
    return;
  }
});

bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  const msgId = query.message.message_id;
  const data = query.data;

  if (data === 'cancel') { await bot.answerCallbackQuery(query.id); userStates[chatId] = null; sendMainMenu(chatId); return; }

  if (data.startsWith('approve_')) {
    const reqId = data.replace('approve_', '');
    const db = await loadDB();
    const req = db.requests && db.requests[reqId];
    if (!req) { await bot.answerCallbackQuery(query.id, { text: '❌ Заявка не найдена' }); return; }
    req.status = 'approved';
    await saveDB(db);
    await bot.answerCallbackQuery(query.id, { text: '✅ Одобрено!' });
    const m = req.type === 'deposit' ? `Средства успешно зачислены💸\n${req.betId} «Счет успешно пополнен✅»\n\n${req.fee || req.amount} KGS\n\nЖдем вас снова 🫶🏻` : `Средства успешно выведены💸\n${req.betId} «Вывод успешно выполнен✅»\n\n${req.amount} KGS\n\nЖдем вас снова 🫶🏻`;
    try { await bot.sendMessage(req.userId, m, { reply_markup: { keyboard: [[{ text: 'ПОПОЛНЕНИЕ 📥' }, { text: 'ВЫВОД 📤' }]], resize_keyboard: true } }); } catch (e) {}
    try { await bot.editMessageCaption(`✅ <b>ОДОБРЕНО</b>`, { chat_id: chatId, message_id: msgId, parse_mode: 'HTML' }); } catch (e) { try { await bot.editMessageText(`✅ <b>ОДОБРЕНО</b>`, { chat_id: chatId, message_id: msgId, parse_mode: 'HTML' }); } catch (e2) {} }
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
    try { await bot.sendMessage(req.userId, `🚫 Пополнение отклонено\n❗ Зафиксированы несоответствия в данных.`, { reply_markup: { keyboard: [[{ text: '🔄 Вызвать меню' }]], resize_keyboard: true } }); } catch (e) {}
    try { await bot.editMessageCaption(`❌ <b>ОТКЛОНЕНО</b>`, { chat_id: chatId, message_id: msgId, parse_mode: 'HTML' }); } catch (e) { try { await bot.editMessageText(`❌ <b>ОТКЛОНЕНО</b>`, { chat_id: chatId, message_id: msgId, parse_mode: 'HTML' }); } catch (e2) {} }
    return;
  }
});

console.log('🤖 XsomKG бот запущен...');
