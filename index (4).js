const TelegramBot = require('node-telegram-bot-api');
const http = require('http');
const fs = require('fs');
const path = require('path');

const TOKEN = process.env.BOT_TOKEN;
const OWNER_ID = process.env.OWNER_ID;
const PORT = process.env.PORT || 3000;

const bot = new TelegramBot(TOKEN, { polling: true });

// ── ДАННЫЕ (файл вместо памяти — не пропадают при перезапуске) ──
const DATA_FILE = path.join(__dirname, 'data.json');

function loadData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    }
  } catch (e) {}
  return { requests: {}, blocked: {}, counter: 1 };
}

function saveData() {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));
  } catch (e) { console.error('Save error:', e.message); }
}

let db = loadData();

// Совместимость: activeRequests по userId
const userStates = {};

function getActiveReq(userId) {
  return Object.values(db.requests).find(r => r.userId == userId && r.status === 'pending');
}

// ── HTTP СЕРВЕР (для админ-панели) ──
const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost`);

  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  // GET /api/data — все заявки и заблокированные
  if (req.method === 'GET' && url.pathname === '/api/data') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      requests: Object.values(db.requests),
      blocked: Object.values(db.blocked)
    }));
    return;
  }

  // POST /api/action — одобрить / отклонить / заблокировать / разблокировать
  if (req.method === 'POST' && url.pathname === '/api/action') {
    let body = '';
    req.on('data', d => body += d);
    req.on('end', async () => {
      try {
        const { action, reqId, userId } = JSON.parse(body);

        if (action === 'approve') {
          const r = db.requests[reqId];
          if (!r) { res.writeHead(404); res.end('{}'); return; }
          r.status = 'approved';
          saveData();

          let msg = r.type === 'deposit'
            ? `Средства успешно зачислены на ваш счет💸\n${r.betId} «Счет успешно пополнен✅»\n\n${r.fee || r.amount} KGS\n\nЖдем вас снова 🫶🏻`
            : `Средства успешно выведены на ваш кошелек💸\n${r.betId} «Вывод успешно выполнен✅»\n\n${r.amount} KGS\n\nЖдем вас снова 🫶🏻`;

          try {
            await bot.sendMessage(r.userId, msg, {
              reply_markup: { keyboard: [[{ text: 'ПОПОЛНЕНИЕ 📥' }, { text: 'ВЫВОД 📤' }]], resize_keyboard: true }
            });
          } catch (e) { console.error('TG send error:', e.message); }

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true }));
          return;
        }

        if (action === 'reject') {
          const r = db.requests[reqId];
          if (!r) { res.writeHead(404); res.end('{}'); return; }
          r.status = 'rejected';
          saveData();

          try {
            await bot.sendMessage(r.userId,
              `🚫 Пополнение отклонено\n❗ Зафиксированы несоответствия в предоставленных данных. Использование фальшивых документов строго запрещено. Нарушения такого рода приводят к жёстким санкциям, вплоть до полной блокировки доступа. Рекомендуем соблюдать честность при операциях!`,
              { reply_markup: { keyboard: [[{ text: '🔄 Вызвать меню' }]], resize_keyboard: true }}
            );
          } catch (e) { console.error('TG send error:', e.message); }

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true }));
          return;
        }

        if (action === 'block') {
          const r = db.requests[reqId];
          if (!r) { res.writeHead(404); res.end('{}'); return; }

          db.blocked[r.userId] = { userId: r.userId, username: r.username, time: Date.now() };
          saveData();

          try {
            await bot.sendMessage(r.userId,
              `🚫 Ваш аккаунт заблокирован.\n\nДля уточнения деталей обратитесь в поддержку: @Xsomadmin`,
              { reply_markup: { keyboard: [[{ text: '🔄 Вызвать меню' }]], resize_keyboard: true }}
            );
          } catch (e) { console.error('TG send error:', e.message); }

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true }));
          return;
        }

        if (action === 'unblock') {
          delete db.blocked[userId];
          saveData();
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true }));
          return;
        }

        res.writeHead(400); res.end('{}');
      } catch (e) {
        console.error('API error:', e.message);
        res.writeHead(500); res.end('{}');
      }
    });
    return;
  }

  // GET / — отдаём admin.html
  if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/admin')) {
    const htmlPath = path.join(__dirname, 'admin.html');
    if (fs.existsSync(htmlPath)) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(fs.readFileSync(htmlPath));
    } else {
      res.writeHead(404); res.end('admin.html not found');
    }
    return;
  }

  res.writeHead(404); res.end('Not found');
});

server.listen(PORT, () => {
  console.log(`🌐 Веб-панель запущена на порту ${PORT}`);
});

// ── БОТ ──
const PAYMENT_METHODS = ['Мбанк', 'О деньги', 'Компаньон', 'Balance.Kg', 'Бакай', 'Оптима', 'Mega'];
const PAYMENT_LINKS = {
  'Мбанк': 'https://mbank.kg', 'О деньги': 'https://o.kg',
  'Компаньон': 'https://kompanion.kg', 'Balance.Kg': 'https://balance.kg',
  'Бакай': 'https://bakai.kg', 'Оптима': 'https://optima.kg', 'Mega': 'https://mega.kg',
};
const AMOUNTS = [35, 50, 150, 200, 500, 1000, 2000, 5000, 10000, 50000];

function sendMainMenu(chatId, firstName) {
  bot.sendMessage(chatId,
    `🚀 Добро пожаловать${firstName ? ', ' + firstName : ''}!\n\n` +
    `💰 Быстрые и безопасные финансовые операции:\n` +
    `• Мгновенное пополнение счета\n• Надёжный вывод средств\n\n` +
    `👨‍💼 Круглосуточная поддержка: @Xsomadmin\n\n` +
    `🔒 Ваши транзакции защищены опытной финансовой службой!\nНачните управлять своими финансами с нами уже сегодня!`,
    { reply_markup: { keyboard: [[{ text: 'ПОПОЛНЕНИЕ 📥' }, { text: 'ВЫВОД 📤' }]], resize_keyboard: true } }
  );
}

function sendActiveMsg(chatId, req) {
  const amount = req.type === 'deposit' ? req.fee : req.amount;
  bot.sendMessage(chatId,
    `✅ Ваша заявка на проверке!\n🆔 ID 1xbet: ${req.betId}\n💸 Сумма: ${amount}`,
    { reply_markup: { keyboard: [[{ text: '⬅️ Главное меню' }]], resize_keyboard: true } }
  );
}

async function sendAmountButtons(chatId, text) {
  const rows = [];
  for (let i = 0; i < AMOUNTS.length; i += 4) rows.push(AMOUNTS.slice(i, i + 4).map(a => ({ text: String(a) })));
  rows.push([{ text: '◀️ Отмена' }]);
  await bot.sendMessage(chatId, text, { reply_markup: { keyboard: rows, resize_keyboard: true } });
}

const delay = ms => new Promise(r => setTimeout(r, ms));

bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  // Проверяем заблокирован ли
  if (db.blocked[chatId]) {
    bot.sendMessage(chatId, `🚫 Ваш аккаунт заблокирован.\n\nДля уточнения деталей обратитесь в поддержку: @Xsomadmin`);
    return;
  }
  const active = getActiveReq(chatId);
  if (active) { sendActiveMsg(chatId, active); return; }
  userStates[chatId] = null;
  sendMainMenu(chatId, msg.from.first_name);
});

bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;
  const state = userStates[chatId];

  if (!text || text.startsWith('/')) return;

  // Заблокирован
  if (db.blocked[chatId]) {
    bot.sendMessage(chatId, `🚫 Ваш аккаунт заблокирован. Обратитесь: @Xsomadmin`);
    return;
  }

  if (text === '🔄 Вызвать меню') {
    userStates[chatId] = null;
    sendMainMenu(chatId, msg.from.first_name);
    return;
  }

  const active = getActiveReq(chatId);
  if (active) { sendActiveMsg(chatId, active); return; }

  if (text === '⬅️ Главное меню' || text === '◀️ Отмена') {
    userStates[chatId] = null;
    sendMainMenu(chatId, msg.from.first_name);
    return;
  }

  if (text === 'ПОПОЛНЕНИЕ 📥') {
    userStates[chatId] = { step: 'deposit_amount' };
    await sendAmountButtons(chatId,
      `💰 Отправьте сумму пополнения или выберите вариант ниже:\n\n10,000 + 1000 получи свой процент ✅\n\n🧪 Минимальный : 35с\n🧴 Максимально : 90000с`
    );
    return;
  }

  if (text === 'ВЫВОД 📤') {
    userStates[chatId] = { step: 'withdrawal_qr' };
    await bot.sendMessage(chatId, `❌ Не найдено ни одного запроса на выплату для этого пользователя.`,
      { reply_markup: { keyboard: [[{ text: '◀️ Отмена' }]], resize_keyboard: true } });
    await delay(500);
    await bot.sendMessage(chatId, `📸 Отправьте QR код вашего кошелька`,
      { reply_markup: { keyboard: [[{ text: '◀️ Отмена' }]], resize_keyboard: true } });
    return;
  }

  if (state && state.step === 'deposit_amount') {
    const amount = parseFloat(text);
    if (isNaN(amount) || amount < 35 || amount > 90000) { await bot.sendMessage(chatId, `⚠️ Введите сумму от 35 до 90,000 сом`); return; }
    userStates[chatId] = { step: 'deposit_id', amount };
    await bot.sendMessage(chatId,
      `🖥 <b>Пополнение счёта</b>\n\n<b>ПОПОЛНЕНИЕ СЧЁТА 1333085343</b>\n\n⚠️ Если ваш платёж задерживается, обратитесь на почту: processing@1xbet-team.com\n\n🤿 Введите номер счёта (1xBET ID):`,
      { parse_mode: 'HTML', reply_markup: { keyboard: [[{ text: '◀️ Отмена' }]], resize_keyboard: true } });
    return;
  }

  if (state && state.step === 'deposit_id') {
    userStates[chatId] = { ...state, step: 'deposit_payment', betId: text };
    const btns = PAYMENT_METHODS.map(m => [{ text: m }]);
    btns.push([{ text: '◀️ Отмена' }]);
    await bot.sendMessage(chatId, `📦 Выберите удобный для вас способ приёма оплаты! 👇`,
      { reply_markup: { keyboard: btns, resize_keyboard: true } });
    return;
  }

  if (state && state.step === 'deposit_payment' && PAYMENT_METHODS.includes(text)) {
    userStates[chatId] = { ...state, step: 'deposit_wallet', method: text };
    await bot.sendMessage(chatId, `📱 Пришлите номер своего кошелька:`,
      { reply_markup: { keyboard: [[{ text: '◀️ Отмена' }]], resize_keyboard: true } });
    return;
  }

  if (state && state.step === 'deposit_wallet') {
    const fee = (state.amount * 1.01).toFixed(2);
    userStates[chatId] = { ...state, step: 'deposit_receipt', wallet: text, fee };
    const link = PAYMENT_LINKS[state.method] || '#';
    await bot.sendMessage(chatId,
      `📎 Прикрепите скриншот чека «📎»\n\nСумма: ${fee} KGS✅\n\n❗️ Оплатите и отправьте скриншот чека в течении 5 минут, чек должен быть в формате картинки⚠️\n\n👇 Нажми оплатить чтобы перейти для оплаты в приложение`,
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
    await bot.sendMessage(chatId, `🏙 Выберите город:`, { reply_markup: { keyboard: [
      [{ text: 'Бишкек' }, { text: 'Жалал-Абад' }],
      [{ text: 'Ош' }, { text: 'Каракол' }],
      [{ text: '◀️ Отмена' }]
    ], resize_keyboard: true }});
    return;
  }

  if (state && state.step === 'withdrawal_city') {
    userStates[chatId] = { ...state, step: 'withdrawal_confirm', city: text };
    await bot.sendMessage(chatId,
      `✅ Подтвердите заявку на вывод:\n\n💰 Сумма: ${state.amount} KGS\n🏙 Город: ${text}\n🏪 Улица: Xsom KG (24/7)`,
      { reply_markup: { keyboard: [[{ text: '✅ Подтвердить' }], [{ text: '◀️ Отмена' }]], resize_keyboard: true }});
    return;
  }

  if (state && state.step === 'withdrawal_confirm' && text === '✅ Подтвердить') {
    userStates[chatId] = { ...state, step: 'withdrawal_bet_id' };
    await bot.sendMessage(chatId, `🖥 <b>Вывод средств</b>\n\n🤿 Введите ID 1XBET:`,
      { parse_mode: 'HTML', reply_markup: { keyboard: [[{ text: '◀️ Отмена' }]], resize_keyboard: true }});
    return;
  }

  if (state && state.step === 'withdrawal_bet_id') {
    const reqId = String(db.counter++);
    const req = {
      id: reqId, type: 'withdrawal', userId: chatId, betId: text,
      amount: state.amount, city: state.city, status: 'pending', time: Date.now(),
      firstName: msg.from.first_name || '', username: msg.from.username || ''
    };
    db.requests[reqId] = req;
    saveData();
    userStates[chatId] = null;

    try {
      await bot.sendMessage(OWNER_ID,
        `╔══════════════════════╗\n║  📤 <b>ЗАЯВКА НА ВЫВОД #${reqId}</b>  ║\n╚══════════════════════╝\n\n` +
        `👤 Пользователь: <code>${chatId}</code>${req.username ? ' @' + req.username : ''}\n` +
        `🆔 1xBET ID: <code>${text}</code>\n💰 Сумма: <b>${state.amount} KGS</b>\n🏙 Город: ${state.city}\n\n⏰ Ожидает решения`,
        { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[
          { text: '✅ Одобрить', callback_data: `approve_${reqId}` },
          { text: '❌ Отклонить', callback_data: `reject_${reqId}` }
        ]]}});
    } catch (e) { console.error(e.message); }

    sendActiveMsg(chatId, req);
    return;
  }
});

// Фото
bot.on('photo', async (msg) => {
  const chatId = msg.chat.id;
  const state = userStates[chatId];

  if (db.blocked[chatId]) { bot.sendMessage(chatId, `🚫 Ваш аккаунт заблокирован.`); return; }

  const active = getActiveReq(chatId);
  if (active) { sendActiveMsg(chatId, active); return; }

  if (state && state.step === 'withdrawal_qr') {
    userStates[chatId] = { step: 'withdrawal_amount', qrPhotoId: msg.photo[msg.photo.length - 1].file_id };
    await sendAmountButtons(chatId, `💰 Отправьте сумму вывода или выберите вариант:\n\n🧪 Минимальный : 150с\n🧴 Максимально : 90000с`);
    return;
  }

  if (state && state.step === 'deposit_receipt') {
    // Скачиваем фото для передачи в панель
    const photoId = msg.photo[msg.photo.length - 1].file_id;
    let photoUrl = null;
    try {
      const fileInfo = await bot.getFile(photoId);
      photoUrl = `https://api.telegram.org/file/bot${TOKEN}/${fileInfo.file_path}`;
    } catch (e) {}

    const reqId = String(db.counter++);
    const req = {
      id: reqId, type: 'deposit', userId: chatId, betId: state.betId,
      method: state.method, wallet: state.wallet,
      amount: state.amount, fee: state.fee,
      photoId, photoUrl, status: 'pending', time: Date.now(),
      firstName: msg.from.first_name || '', username: msg.from.username || ''
    };
    db.requests[reqId] = req;
    saveData();
    userStates[chatId] = null;

    try {
      await bot.sendPhoto(OWNER_ID, photoId, {
        caption:
          `╔══════════════════════╗\n║  📥 <b>ЗАЯВКА НА ПОПОЛНЕНИЕ #${reqId}</b>  ║\n╚══════════════════════╝\n\n` +
          `👤 Пользователь: <code>${chatId}</code>${req.username ? ' @' + req.username : ''}\n` +
          `🆔 1xBET ID: <code>${req.betId}</code>\n💳 Способ: ${req.method}\n` +
          `📱 Кошелёк: <code>${req.wallet}</code>\n💰 Сумма: <b>${req.fee} KGS</b>`,
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: [[
          { text: '✅ Одобрить', callback_data: `approve_${reqId}` },
          { text: '❌ Отклонить', callback_data: `reject_${reqId}` }
        ]]}
      });
    } catch (e) { console.error(e.message); }

    sendActiveMsg(chatId, req);
    return;
  }
});

// Callback (кнопки прямо в Telegram — тоже работают)
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
    const req = db.requests[reqId];
    if (!req) { await bot.answerCallbackQuery(query.id, { text: '❌ Заявка не найдена' }); return; }
    req.status = 'approved';
    saveData();
    await bot.answerCallbackQuery(query.id, { text: '✅ Одобрено!' });

    const msg = req.type === 'deposit'
      ? `Средства успешно зачислены на ваш счет💸\n${req.betId} «Счет успешно пополнен✅»\n\n${req.fee || req.amount} KGS\n\nЖдем вас снова 🫶🏻`
      : `Средства успешно выведены на ваш кошелек💸\n${req.betId} «Вывод успешно выполнен✅»\n\n${req.amount} KGS\n\nЖдем вас снова 🫶🏻`;

    try { await bot.sendMessage(req.userId, msg, { reply_markup: { keyboard: [[{ text: 'ПОПОЛНЕНИЕ 📥' }, { text: 'ВЫВОД 📤' }]], resize_keyboard: true } }); }
    catch (e) {}

    try { await bot.editMessageCaption(`✅ <b>ОДОБРЕНО</b>\n\nПользователь уведомлён`, { chat_id: chatId, message_id: msgId, parse_mode: 'HTML' }); }
    catch (e) { try { await bot.editMessageText(`✅ <b>ОДОБРЕНО</b>\n\nПользователь уведомлён`, { chat_id: chatId, message_id: msgId, parse_mode: 'HTML' }); } catch (e2) {} }
    return;
  }

  if (data.startsWith('reject_')) {
    const reqId = data.replace('reject_', '');
    const req = db.requests[reqId];
    if (!req) { await bot.answerCallbackQuery(query.id, { text: '❌ Заявка не найдена' }); return; }
    req.status = 'rejected';
    saveData();
    await bot.answerCallbackQuery(query.id, { text: '❌ Отклонено' });

    try {
      await bot.sendMessage(req.userId,
        `🚫 Пополнение отклонено\n❗ Зафиксированы несоответствия в предоставленных данных. Использование фальшивых документов строго запрещено.`,
        { reply_markup: { keyboard: [[{ text: '🔄 Вызвать меню' }]], resize_keyboard: true } });
    } catch (e) {}

    try { await bot.editMessageCaption(`❌ <b>ОТКЛОНЕНО</b>\n\nПользователь уведомлён`, { chat_id: chatId, message_id: msgId, parse_mode: 'HTML' }); }
    catch (e) { try { await bot.editMessageText(`❌ <b>ОТКЛОНЕНО</b>\n\nПользователь уведомлён`, { chat_id: chatId, message_id: msgId, parse_mode: 'HTML' }); } catch (e2) {} }
    return;
  }
});

console.log('🤖 XsomKG бот запущен...');
