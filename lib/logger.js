/**
 * @file Цветной консольный логгер с ANSI-цветами для SiMOTO-sklad.
 * Содержит набор функций для вывода сообщений с цветовой кодировкой
 * по типу (успех, ошибка, предупреждение, информация, отладка),
 * а также авто-определение цвета по содержимому сообщения.
 *
 * ANSI-цвета: работают в Node.js на Windows 10+
 * (ConEmu, Windows Terminal, VS Code terminal).
 */

const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
}

/**
 * Оборачивает сообщение в ANSI-цвет и добавляет сброс оформления.
 * @param {string} msg - Текст сообщения
 * @param {string} colorCode - ANSI-код цвета (из объекта colors)
 * @returns {string} Цветное сообщение с code + msg + reset
 */
function colorize(msg, colorCode) {
  return colorCode + msg + colors.reset
}

// ── Convenience helpers ──

/**
 * Выводит сообщение зелёным цветом (успех).
 * @param {string} msg - Текст сообщения
 * @returns {void}
 */
function success(msg) {
  console.log(colorize(msg, colors.green))
}

/**
 * Выводит сообщение красным цветом (ошибка).
 * @param {string} msg - Текст сообщения
 * @returns {void}
 */
function error(msg) {
  console.log(colorize(msg, colors.red))
}

/**
 * Выводит сообщение жёлтым цветом (предупреждение).
 * @param {string} msg - Текст сообщения
 * @returns {void}
 */
function warn(msg) {
  console.log(colorize(msg, colors.yellow))
}

/**
 * Выводит сообщение голубым цветом (информация).
 * @param {string} msg - Текст сообщения
 * @returns {void}
 */
function info(msg) {
  console.log(colorize(msg, colors.cyan))
}

/**
 * Выводит сообщение пурпурным цветом (важные/стартовые сообщения).
 * @param {string} msg - Текст сообщения
 * @returns {void}
 */
function important(msg) {
  console.log(colorize(msg, colors.magenta))
}

/**
 * Выводит сообщение синим цветом (поиск/отладка).
 * @param {string} msg - Текст сообщения
 * @returns {void}
 */
function debug(msg) {
  console.log(colorize(msg, colors.blue))
}

/**
 * Выводит сообщение ярко-зелёным цветом (большие баннеры успеха).
 * Комбинирует bright и green ANSI-коды.
 * @param {string} msg - Текст сообщения
 * @returns {void}
 */
function banner(msg) {
  console.log(colorize(msg, colors.bright + colors.green))
}

// ── Tag-based coloring ──
// Colors messages by their prefix tag, auto-detected

/**
 * Автоматически определяет цвет сообщения по его содержимому.
 * Правила определения:
 * - `[X]`, `Error`, `Ошибка`, `not found`, `failed` → красный (error)
 * - `[OK]`, `успешно`, `Found`, `Success`, `created` → зелёный (success)
 * - `[!]`, `Warn`, `skipped`, `Пропущен` → жёлтый (warn)
 * - `[i]`, `Search`, `Starting`, `Checking` → голубой (info)
 * - `===` → пурпурный (important)
 * - `[WB]`, `[Ozon]`, `[Market]` → синий (debug)
 * - Остальное → обычный вывод без цвета
 * @param {string} [msg] - Текст сообщения (если пусто — выводит пустую строку)
 * @returns {void}
 */
function auto(msg) {
  if (!msg) { console.log(); return }

  if (msg.includes('[X]') || msg.includes('Error') || msg.includes('Ошибка') || msg.includes('not found') || msg.includes('failed'))
    return error(msg)
  if (msg.includes('[OK]') || msg.includes('успешно') || msg.includes('Found') || msg.includes('Success') || msg.includes('created'))
    return success(msg)
  if (msg.includes('[!]') || msg.includes('Warn') || msg.includes('skipped') || msg.includes('Пропущен'))
    return warn(msg)
  if (msg.includes('[i]') || msg.includes('Search') || msg.includes('Starting') || msg.includes('Checking'))
    return info(msg)
  if (msg.includes('==='))
    return important(msg)
  if (msg.includes('[WB]') || msg.includes('[Ozon]') || msg.includes('[Market]'))
    return debug(msg)

  console.log(msg)
}

// ── Server startup banner ──

/**
 * Выводит стартовый баннер сервера с портом и PID.
 * Использует зелёный цвет с ярким выделением для названия.
 * @param {number|string} port - Номер порта, на котором запущен сервер
 * @returns {void}
 */
function serverStarted(port) {
  const line = '='.repeat(50)
  console.log(colorize(line, colors.green))
  console.log(colorize(`  Сервер запущен на http://localhost:${port}  `, colors.bright + colors.green))
  console.log(colorize(`  PID: ${process.pid}`, colors.green))
  console.log(colorize(line, colors.green))
}

module.exports = {
  colors,
  colorize,
  success,
  error,
  warn,
  info,
  important,
  debug,
  banner,
  auto,
  serverStarted,
}
