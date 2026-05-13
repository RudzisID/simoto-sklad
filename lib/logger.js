// Shared colored console logger for SiMOTO-sklad
// ANSI colors: works in Node.js on Windows 10+ (including ConEmu, Windows Terminal, VS Code terminal)

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

function colorize(msg, colorCode) {
  return colorCode + msg + colors.reset
}

// ── Convenience helpers ──

/** Green for success messages */
function success(msg) {
  console.log(colorize(msg, colors.green))
}

/** Red for errors */
function error(msg) {
  console.log(colorize(msg, colors.red))
}

/** Yellow for warnings */
function warn(msg) {
  console.log(colorize(msg, colors.yellow))
}

/** Cyan for informational messages */
function info(msg) {
  console.log(colorize(msg, colors.cyan))
}

/** Magenta for important/startup messages */
function important(msg) {
  console.log(colorize(msg, colors.magenta))
}

/** Blue for search/debug messages */
function debug(msg) {
  console.log(colorize(msg, colors.blue))
}

/** Green bold for big success banners */
function banner(msg) {
  console.log(colorize(msg, colors.bright + colors.green))
}

// ── Tag-based coloring ──
// Colors messages by their prefix tag, auto-detected

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
