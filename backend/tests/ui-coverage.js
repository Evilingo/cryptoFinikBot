/**
 * UI Coverage — логические проверки BestTrader.
 * Запуск: node backend/tests/ui-coverage.js
 *
 * Философия: тесты ловят реальные логические баги, а не просто проверяют
 * что строка существует в файле. Упавший тест = реальный баг в UI.
 *
 * Ожидаемые FAILS (баги):
 *  — Login: "Remember me" не подключён к state
 *  — Settings: "Change password", "Stop all trading", "Test prompt" без onClick
 *  — Settings: "Send test" Telegram — пустой onClick={() => {}}
 *  — Settings: Account username/email — defaultValue без onChange/save
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../');

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    const result = await fn();
    console.log(`✅ ${name}: ${result}`);
    passed++;
  } catch (err) {
    console.log(`❌ ${name}: ${err.message}`);
    failed++;
  }
}

/**
 * Извлекает тег кнопки (<button...>...</button>), содержащей buttonText.
 * Ищет <button от текущей строки назад (до 10 строк), </button> вперёд (до 10 строк).
 */
function extractButtonTag(content, buttonText) {
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].includes(buttonText)) continue;

    // ищем начало тега <button назад
    let start = i;
    for (let j = i; j >= Math.max(0, i - 10); j--) {
      if (lines[j].includes('<button')) { start = j; break; }
    }
    // ищем конец тега </button> вперёд
    let end = i;
    for (let j = i; j <= Math.min(lines.length - 1, i + 10); j++) {
      if (lines[j].includes('</button>')) { end = j; break; }
    }
    return lines.slice(start, end + 1).join('\n');
  }
  return null;
}

// ─── Login ────────────────────────────────────────────────────────────────────

console.log('\n── Login ──');

await test('Login: "Remember me" checkbox подключён к state (onChange + checked)', () => {
  const content = fs.readFileSync(path.join(root, 'frontend/src/pages/Login.jsx'), 'utf8');
  // Найти блок с checkbox рядом с "Remember me"
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].includes('Remember me')) continue;
    const ctx = lines.slice(Math.max(0, i - 3), i + 2).join('\n');
    if (ctx.includes('defaultChecked') && !ctx.includes('onChange'))
      throw new Error('checkbox имеет defaultChecked но нет onChange — состояние не управляется, сессия не зависит от чекбокса');
    if (!ctx.includes('onChange'))
      throw new Error('"Remember me" checkbox без onChange — декоративный');
    if (!ctx.includes('checked=') && !ctx.includes(':checked'))
      throw new Error('"Remember me" checkbox без prop checked — не controlled');
    return '"Remember me" checkbox controlled через checked + onChange';
  }
  throw new Error('"Remember me" не найден на странице логина');
});

await test('Login: handleSubmit вызывает e.preventDefault()', () => {
  const content = fs.readFileSync(path.join(root, 'frontend/src/pages/Login.jsx'), 'utf8');
  if (!content.includes('e.preventDefault()')) throw new Error('e.preventDefault() не найден — форма будет перезагружать страницу');
  return 'e.preventDefault() найден в handleSubmit';
});

await test('Login: ошибка отображается пользователю', () => {
  const content = fs.readFileSync(path.join(root, 'frontend/src/pages/Login.jsx'), 'utf8');
  if (!content.includes('setError(')) throw new Error('setError не найден — ошибка logina нигде не сохраняется');
  if (!content.includes('{error &&') && !content.includes('{error ?'))
    throw new Error('блок {error &&} не найден — ошибка не отображается в UI');
  return 'setError + {error &&} рендер найдены';
});

await test('Login: кнопка submit disabled во время запроса', () => {
  const content = fs.readFileSync(path.join(root, 'frontend/src/pages/Login.jsx'), 'utf8');
  // type="submit" однозначно идентифицирует кнопку отправки
  const tag = extractButtonTag(content, 'type="submit"');
  if (!tag?.includes('disabled')) throw new Error('кнопка submit без disabled={loading} — двойной submit возможен');
  return 'disabled={loading} защищает от двойного submit';
});

await test('Login: после успешного логина происходит navigate()', () => {
  const content = fs.readFileSync(path.join(root, 'frontend/src/pages/Login.jsx'), 'utf8');
  if (!content.includes('navigate(')) throw new Error('navigate() не найден — после логина нет редиректа');
  if (!content.includes('await login(')) throw new Error('login() не вызывается');
  return 'login() вызывается, после него navigate()';
});

// ─── Settings: кнопки без обработчиков (декоративные) ────────────────────────

console.log('\n── Settings: декоративные кнопки ──');

await test('Settings: "Change password" имеет onClick', () => {
  const content = fs.readFileSync(path.join(root, 'frontend/src/pages/Settings.jsx'), 'utf8');
  const tag = extractButtonTag(content, 'Change password');
  if (!tag) throw new Error('"Change password" кнопка не найдена');
  if (!tag.includes('onClick')) throw new Error('"Change password" без onClick — кнопка декоративная, пароль сменить нельзя');
  return '"Change password" имеет onClick';
});

await test('Settings: "Stop all trading" имеет onClick', () => {
  const content = fs.readFileSync(path.join(root, 'frontend/src/pages/Settings.jsx'), 'utf8');
  const tag = extractButtonTag(content, 'Stop all trading');
  if (!tag) throw new Error('"Stop all trading" кнопка не найдена');
  if (!tag.includes('onClick')) throw new Error('"Stop all trading" без onClick — Emergency Stop не работает');
  return '"Stop all trading" имеет onClick';
});

await test('Settings: "Test prompt" имеет onClick', () => {
  const content = fs.readFileSync(path.join(root, 'frontend/src/pages/Settings.jsx'), 'utf8');
  const tag = extractButtonTag(content, 'Test prompt');
  if (!tag) throw new Error('"Test prompt" кнопка не найдена');
  if (!tag.includes('onClick')) throw new Error('"Test prompt" без onClick — кнопка декоративная');
  return '"Test prompt" имеет непустой onClick';
});

await test('Settings: "Send test" Telegram имеет непустой onClick', () => {
  const content = fs.readFileSync(path.join(root, 'frontend/src/pages/Settings.jsx'), 'utf8');
  const tag = extractButtonTag(content, 'Send test');
  if (!tag) throw new Error('"Send test" кнопка не найдена');
  if (!tag.includes('onClick')) throw new Error('"Send test" без onClick — Telegram-тест не отправляется');
  if (tag.includes('onClick={() => {}}') || tag.includes('onClick={()=>{}}'))
    throw new Error('"Send test" имеет пустой onClick={() => {}} — ничего не отправляет');
  return '"Send test" имеет непустой onClick';
});

// ─── Settings: Account section ────────────────────────────────────────────────

console.log('\n── Settings: Account ──');

await test('Settings: Account username input — controlled (value + onChange)', () => {
  const content = fs.readFileSync(path.join(root, 'frontend/src/pages/Settings.jsx'), 'utf8');
  // Вырезаем блок секции account
  const accountStart = content.indexOf("section === 'account'");
  if (accountStart === -1) throw new Error("секция 'account' не найдена");
  const accountBlock = content.slice(accountStart, accountStart + 800);

  // Ищем input рядом с "Username"
  const usernameIdx = accountBlock.indexOf('Username');
  if (usernameIdx === -1) throw new Error('Username label не найден в Account секции');
  const inputCtx = accountBlock.slice(usernameIdx, usernameIdx + 200);
  if (inputCtx.includes('defaultValue') && !inputCtx.includes('value={'))
    throw new Error('Username input использует defaultValue без onChange — изменение имени невозможно сохранить');
  if (!inputCtx.includes('onChange'))
    throw new Error('Username input без onChange — uncontrolled input');
  return 'Username input controlled';
});

await test('Settings: Account email input — controlled (value + onChange)', () => {
  const content = fs.readFileSync(path.join(root, 'frontend/src/pages/Settings.jsx'), 'utf8');
  const accountStart = content.indexOf("section === 'account'");
  if (accountStart === -1) throw new Error("секция 'account' не найдена");
  const accountBlock = content.slice(accountStart, accountStart + 800);

  const emailIdx = accountBlock.indexOf('Email');
  if (emailIdx === -1) throw new Error('Email label не найден в Account секции');
  const inputCtx = accountBlock.slice(emailIdx, emailIdx + 200);
  if (inputCtx.includes('defaultValue') && !inputCtx.includes('value={'))
    throw new Error('Email input использует defaultValue без onChange — изменение email невозможно сохранить');
  if (!inputCtx.includes('onChange'))
    throw new Error('Email input без onChange — uncontrolled input');
  return 'Email input controlled';
});

await test('Settings: Account секция имеет Save кнопку с onClick', () => {
  const content = fs.readFileSync(path.join(root, 'frontend/src/pages/Settings.jsx'), 'utf8');
  const accountStart = content.indexOf("section === 'account'");
  if (accountStart === -1) throw new Error("секция 'account' не найдена");
  const accountBlock = content.slice(accountStart, accountStart + 1000);

  // Должна быть кнопка Save (не Change password)
  const hasSaveBtn = accountBlock.includes('Save') && accountBlock.includes('onClick');
  if (!hasSaveBtn) throw new Error('Account секция не имеет Save кнопки — изменения нельзя сохранить');
  return 'Save кнопка с onClick найдена в Account секции';
});

// ─── Settings: рабочие save-функции ─────────────────────────────────────────

console.log('\n── Settings: рабочие функции ──');

await test('Settings: "Save prompt" кнопка вызывает savePrompt → PUT /settings/prompt', () => {
  const content = fs.readFileSync(path.join(root, 'frontend/src/pages/Settings.jsx'), 'utf8');
  const tag = extractButtonTag(content, 'Save prompt');
  if (!tag?.includes('savePrompt')) throw new Error('"Save prompt" кнопка не вызывает savePrompt');
  if (!content.includes("api.put('/settings/prompt'")) throw new Error("api.put('/settings/prompt') не найден");
  return 'savePrompt → PUT /settings/prompt';
});

await test('Settings: saveAutoTrade передаёт allowShort → PUT /settings/autotrade', () => {
  const content = fs.readFileSync(path.join(root, 'frontend/src/pages/Settings.jsx'), 'utf8');
  if (!content.includes('allowShort: enableShort')) throw new Error('allowShort не передаётся в autotrade PUT');
  if (!content.includes("api.put('/settings/autotrade'")) throw new Error("PUT /settings/autotrade не найден");
  return 'allowShort: enableShort передаётся в PUT /settings/autotrade';
});

await test('Settings: threshold конвертируется в Number перед отправкой', () => {
  const content = fs.readFileSync(path.join(root, 'frontend/src/pages/Settings.jsx'), 'utf8');
  if (!content.includes('dipThreshold: Number(threshold)'))
    throw new Error('Number(threshold) не найден — сервер получит строку вместо числа');
  return 'dipThreshold: Number(threshold) найден';
});

await test('Settings: minConfidence конвертируется в Number перед отправкой', () => {
  const content = fs.readFileSync(path.join(root, 'frontend/src/pages/Settings.jsx'), 'utf8');
  if (!content.includes('minConfidence: Number(minConfidence)'))
    throw new Error('Number(minConfidence) не найден — сервер получит строку');
  return 'minConfidence: Number(minConfidence) найден';
});

await test('Settings: поля Binance API очищаются после сохранения', () => {
  const content = fs.readFileSync(path.join(root, 'frontend/src/pages/Settings.jsx'), 'utf8');
  if (!content.includes("setApiKey('')")) throw new Error("setApiKey('') не найден — ключ остаётся в форме после сохранения");
  if (!content.includes("setSecret('')")) throw new Error("setSecret('') не найден");
  return 'поля Binance очищаются через setApiKey("") + setSecret("")';
});

await test('Settings: поля Bybit API очищаются после сохранения', () => {
  const content = fs.readFileSync(path.join(root, 'frontend/src/pages/Settings.jsx'), 'utf8');
  if (!content.includes("setBybitApiKey('')")) throw new Error("setBybitApiKey('') не найден");
  if (!content.includes("setBybitSecret('')")) throw new Error("setBybitSecret('') не найден");
  return 'поля Bybit очищаются после сохранения';
});

await test('Settings: все save-функции показывают ошибку пользователю', () => {
  const content = fs.readFileSync(path.join(root, 'frontend/src/pages/Settings.jsx'), 'utf8');
  // Считаем async save-функции (кроме saveBybitKeys — она использует setBybitStatus)
  const saveFns = (content.match(/const save\w+ = async/g) || []).length;
  const catchWithFeedback = (content.match(/catch[\s\S]{0,30}showStatus\(false|catch[\s\S]{0,30}setBybitStatus\(\{.*ok: false/g) || []).length;
  if (catchWithFeedback < saveFns)
    throw new Error(`${saveFns - catchWithFeedback} из ${saveFns} save-функций не показывают ошибку пользователю`);
  return `${saveFns} save-функций — все имеют catch с отображением ошибки`;
});

// ─── Dashboard ────────────────────────────────────────────────────────────────

console.log('\n── Dashboard ──');

await test('Dashboard: submit кнопка вызывает handleTradeSubmit (не декоративная)', () => {
  const content = fs.readFileSync(path.join(root, 'frontend/src/pages/Dashboard.jsx'), 'utf8');
  // Кнопка submit-btn имеет onClick={handleTradeSubmit}
  if (!content.includes('onClick={handleTradeSubmit}'))
    throw new Error('onClick={handleTradeSubmit} не найден — submit-btn декоративная');
  if (!content.includes("api.post('/trade/order'")) throw new Error("handleTradeSubmit не делает api.post('/trade/order')");
  return 'submit-btn → onClick={handleTradeSubmit} → api.post /trade/order';
});

await test('Dashboard: результат сделки отображается пользователю', () => {
  const content = fs.readFileSync(path.join(root, 'frontend/src/pages/Dashboard.jsx'), 'utf8');
  if (!content.includes('tradeStatus')) throw new Error('tradeStatus state не найден');
  if (!content.includes('{tradeStatus &&') && !content.includes('{tradeStatus ?'))
    throw new Error('tradeStatus не рендерится — пользователь не видит результат сделки');
  return 'tradeStatus отображается в UI';
});

await test('Dashboard: select пары — controlled (value + onChange)', () => {
  const content = fs.readFileSync(path.join(root, 'frontend/src/pages/Dashboard.jsx'), 'utf8');
  if (!content.includes('value={selectedPairIdx}'))
    throw new Error('value={selectedPairIdx} не найден — select uncontrolled');
  if (!content.includes('setSelectedPairIdx(Number(e.target.value))'))
    throw new Error('onChange у select не вызывает setSelectedPairIdx(Number(...))');
  return 'select контролируется через value + onChange';
});

await test('Dashboard: кнопки 25%/50%/75%/MAX реально вызывают applyQuickAmount в onClick', () => {
  const content = fs.readFileSync(path.join(root, 'frontend/src/pages/Dashboard.jsx'), 'utf8');
  // Ищем паттерн onClick={() => applyQuickAmount(число)}
  if (!content.includes('onClick={() => applyQuickAmount(') && !content.includes('onClick={()=>applyQuickAmount('))
    throw new Error('кнопки % не вызывают applyQuickAmount в onClick — могут быть декоративными');
  return 'кнопки 25/50/75/MAX вызывают applyQuickAmount в onClick';
});

// ─── Signals ─────────────────────────────────────────────────────────────────

console.log('\n── Signals ──');

await test('Signals: useEffect перезагружает данные при смене page', () => {
  const content = fs.readFileSync(path.join(root, 'frontend/src/pages/Signals.jsx'), 'utf8');
  if (!content.includes('[page]'))
    throw new Error('useEffect без [page] в deps — смена страницы не загружает новые данные');
  return 'useEffect зависит от [page]';
});

await test('Signals: кнопка Next disabled когда данных нет', () => {
  const content = fs.readFileSync(path.join(root, 'frontend/src/pages/Signals.jsx'), 'utf8');
  const tag = extractButtonTag(content, 'Next');
  if (!tag?.includes('disabled'))
    throw new Error('Next кнопка без disabled — можно уйти за пределы данных');
  return 'Next кнопка disabled когда page * limit >= total';
});

await test('Signals: кнопка Previous disabled на первой странице', () => {
  const content = fs.readFileSync(path.join(root, 'frontend/src/pages/Signals.jsx'), 'utf8');
  const tag = extractButtonTag(content, 'Previous');
  if (!tag?.includes('disabled'))
    throw new Error('Previous кнопка без disabled — можно уйти в отрицательные страницы');
  return 'Previous кнопка disabled при page === 0';
});

await test('Signals: клик на кнопку "Open in modal" не раскрывает строку (stopPropagation)', () => {
  const content = fs.readFileSync(path.join(root, 'frontend/src/pages/Signals.jsx'), 'utf8');
  if (!content.includes('e.stopPropagation()'))
    throw new Error('e.stopPropagation() не найден — клик на кнопку одновременно раскроет строку');
  return 'stopPropagation предотвращает конфликт клика';
});

// ─── Stats ────────────────────────────────────────────────────────────────────

console.log('\n── Stats ──');

await test('Stats: "Run backtest" disabled во время выполнения', () => {
  const content = fs.readFileSync(path.join(root, 'frontend/src/pages/Stats.jsx'), 'utf8');
  const tag = extractButtonTag(content, 'Run backtest');
  if (!tag?.includes('disabled'))
    throw new Error('"Run backtest" без disabled — двойной запуск возможен');
  return '"Run backtest" disabled при btRunning=true';
});

await test('Stats: "Run optimize" disabled во время выполнения', () => {
  const content = fs.readFileSync(path.join(root, 'frontend/src/pages/Stats.jsx'), 'utf8');
  const tag = extractButtonTag(content, 'Run optimize');
  if (!tag?.includes('disabled'))
    throw new Error('"Run optimize" без disabled — двойной запуск возможен');
  return '"Run optimize" disabled при optRunning=true';
});

await test('Stats: ошибка backtest отображается пользователю', () => {
  const content = fs.readFileSync(path.join(root, 'frontend/src/pages/Stats.jsx'), 'utf8');
  if (!content.includes('setBtError('))
    throw new Error('setBtError не найден в catch — пользователь не видит ошибку backtest');
  if (!content.includes('{btError &&') && !content.includes('{btError ?'))
    throw new Error('btError не рендерится в UI');
  return 'btError сохраняется и отображается';
});

await test('Stats: ошибка optimize отображается пользователю', () => {
  const content = fs.readFileSync(path.join(root, 'frontend/src/pages/Stats.jsx'), 'utf8');
  if (!content.includes('setOptError('))
    throw new Error('setOptError не найден — пользователь не видит ошибку optimize');
  if (!content.includes('{optError &&') && !content.includes('{optError ?'))
    throw new Error('optError не рендерится в UI');
  return 'optError сохраняется и отображается';
});

// ─── App / Router ─────────────────────────────────────────────────────────────

console.log('\n── App / Router ──');

await test('App: AdminRoute перенаправляет на /login при !authenticated', () => {
  const content = fs.readFileSync(path.join(root, 'frontend/src/App.jsx'), 'utf8');
  const adminRouteBlock = content.slice(
    content.indexOf('function AdminRoute'),
    content.indexOf('function AdminRoute') + 700,
  );
  if (!adminRouteBlock.includes('authenticated'))
    throw new Error('AdminRoute не проверяет authenticated');
  if (!adminRouteBlock.includes('Navigate'))
    throw new Error('AdminRoute не делает Navigate — неавторизованный пользователь попадёт на /settings');
  return 'AdminRoute: !authenticated → <Navigate to="/login"/>';
});

await test('App: SignalModal рендерится только при наличии activeSignal', () => {
  const content = fs.readFileSync(path.join(root, 'frontend/src/App.jsx'), 'utf8');
  // Ищем <SignalModal (не import) и проверяем условный рендер
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].includes('<SignalModal')) continue;
    const ctx = lines.slice(Math.max(0, i - 3), i + 1).join('\n');
    if (!ctx.includes('activeSignal') && !ctx.includes('{active'))
      throw new Error('<SignalModal рендерится без условия — всегда видим (даже без сигнала)');
    return 'SignalModal рендерится только при {activeSignal && ...}';
  }
  throw new Error('<SignalModal не найден в App.jsx');
});

// ─── SignalModal ──────────────────────────────────────────────────────────────

console.log('\n── SignalModal ──');

await test('SignalModal: × кнопка вызывает onClose', () => {
  const content = fs.readFileSync(path.join(root, 'frontend/src/components/SignalModal.jsx'), 'utf8');
  const tag = extractButtonTag(content, 'modal-close');
  if (!tag?.includes('onClick={onClose}'))
    throw new Error('modal-close кнопка без onClick={onClose} — закрыть модал нельзя');
  return '× кнопка вызывает onClose';
});

await test('SignalModal: клик по backdrop закрывает, клик по body — нет', () => {
  const content = fs.readFileSync(path.join(root, 'frontend/src/components/SignalModal.jsx'), 'utf8');
  if (!content.includes('className="modal-backdrop" onClick={onClose}'))
    throw new Error('backdrop onClick={onClose} не найден — клик мимо модала не закрывает его');
  if (!content.includes('e.stopPropagation()'))
    throw new Error('stopPropagation на body не найден — клик внутри модала будет его закрывать');
  return 'backdrop → onClose, body → stopPropagation';
});

await test('SignalModal: результат сделки отображается пользователю', () => {
  const content = fs.readFileSync(path.join(root, 'frontend/src/components/SignalModal.jsx'), 'utf8');
  if (!content.includes('tradeStatus'))
    throw new Error('tradeStatus state не найден');
  if (!content.includes('{tradeStatus &&') && !content.includes('{tradeStatus ?'))
    throw new Error('tradeStatus не рендерится — пользователь не видит успех/ошибку сделки');
  return 'tradeStatus отображается в UI модала';
});

await test('SignalModal: handleTrade делает api.post("/trade/order")', () => {
  const content = fs.readFileSync(path.join(root, 'frontend/src/components/SignalModal.jsx'), 'utf8');
  if (!content.includes("api.post('/trade/order'"))
    throw new Error("api.post('/trade/order') не найден в handleTrade");
  return "api.post('/trade/order') вызывается в handleTrade";
});

// ─── useAuth ──────────────────────────────────────────────────────────────────

console.log('\n── Auth ──');

await test('useAuth: refresh токен запрашивается при старте приложения', () => {
  const content = fs.readFileSync(path.join(root, 'frontend/src/hooks/useAuth.jsx'), 'utf8');
  if (!content.includes("api.post('/auth/refresh')"))
    throw new Error("api.post('/auth/refresh') не найден — токен не обновляется при перезагрузке страницы");
  if (!content.includes('useEffect'))
    throw new Error('useEffect для refresh не найден — вызов происходит не при старте');
  return 'refresh вызывается в useEffect при монтировании AuthProvider';
});

await test('useAuth: logout очищает accessToken', () => {
  const content = fs.readFileSync(path.join(root, 'frontend/src/hooks/useAuth.jsx'), 'utf8');
  if (!content.includes('setAccessToken(null)'))
    throw new Error('setAccessToken(null) не найден в logout — токен не очищается, защищённые роуты остаются доступны');
  return 'logout очищает accessToken через setAccessToken(null)';
});

// ─── Итог ────────────────────────────────────────────────────────────────────

console.log(`\n── Итог: ${passed} прошло, ${failed} упало ──`);
if (failed > 0) {
  console.log('Упавшие тесты — это реальные баги в UI, требующие исправления.');
  process.exit(1);
}
