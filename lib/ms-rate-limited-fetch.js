/**
 * @file Планировщик запросов к API МойСклад (rate-limited fetch).
 * @description Обёртка над глобальным fetch для клиента moysklad.
 *  Реализует требования документации МойСклад (dev.moysklad.ru, ошибки 1049/1073, HTTP 429):
 *  - равномерное распределение запросов внутри окна `X-Lognex-Retry-TimeInterval`
 *    согласно `X-RateLimit-Limit` / `X-RateLimit-Remaining`;
 *  - ограничение количества параллельных запросов (защита от ошибки 1073);
 *  - автоматический повтор запроса при 429 с выдержкой `X-Lognex-Retry-After`.
 *
 *  Повторы безопасны для создания документов: 429 означает, что запрос НЕ был
 *  обработан сервером, поэтому повтор не создаёт дубликатов.
 *
 *  Логика вдохновлена moysklad-fetch-planner (официальная рекомендация автора
 *  библиотеки moysklad), но реализована как нативный CommonJS-модуль без
 *  внешних зависимостей (planner ESM-only, проект — CJS).
 * @module lib/ms-rate-limited-fetch
 */

// ─── Параметры по умолчанию (до первого ответа от МС) ───
const DEFAULT_LIMIT = 20 // количество запросов в окне
const DEFAULT_INTERVAL_MS = 3000 // длительность окна в мс
const MAX_PARALLEL = 3 // максимум одновременных запросов (защита от 1073)
const MAX_RETRIES = 5 // максимум повторов при 429 (ошибка 1049)
const RETRY_FALLBACK_MS = 3000 // ожидание при 429 без заголовка Retry-After

/**
 * Внутреннее состояние лимитов, обновляемое из заголовков ответов МС.
 */
const state = {
  limit: DEFAULT_LIMIT, // X-RateLimit-Limit
  intervalMs: DEFAULT_INTERVAL_MS, // X-Lognex-Retry-TimeInterval
  remaining: DEFAULT_LIMIT, // X-RateLimit-Remaining (локальный учёт)
  windowEndsAt: 0, // момент сброса окна (Date.now() + X-Lognex-Reset)
  lastRequestAt: 0 // время последнего отправленного запроса (для pacing)
}

/** @type {number} Число активных (незавершённых) запросов */
let activeRequests = 0

/** @type {Array<Function>} Очередь ожидания слота параллельности */
const slotWaiters = []

/**
 * Промитировать на указанное количество миллисекунд.
 * @param {number} ms - длительность ожидания в мс
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Занять слот параллельности (не более MAX_PARALLEL одновременных запросов).
 * @returns {Promise<void>}
 */
async function acquireSlot() {
  if (activeRequests >= MAX_PARALLEL) {
    await new Promise((resolve) => slotWaiters.push(resolve))
  }
  activeRequests++
}

/**
 * Освободить слот параллельности и разбудить следующего ожидающего.
 * @returns {void}
 */
function releaseSlot() {
  activeRequests--
  const next = slotWaiters.shift()
  if (next) next()
}

/**
 * Обновить внутреннее состояние лимитов из заголовков ответа API МойСклад.
 * Заголовки: X-RateLimit-Limit, X-Lognex-Retry-TimeInterval,
 * X-RateLimit-Remaining, X-Lognex-Reset.
 * @param {Response} res - ответ fetch API
 * @returns {void}
 */
function updateFromHeaders(res) {
  const h = res && res.headers
  if (!h || typeof h.get !== 'function') return

  const limit = parseInt(h.get('x-ratelimit-limit'), 10)
  const interval = parseInt(h.get('x-lognex-retry-timeinterval'), 10)
  const remaining = parseInt(h.get('x-ratelimit-remaining'), 10)
  const reset = parseInt(h.get('x-lognex-reset'), 10)

  if (Number.isFinite(limit) && limit > 0) state.limit = limit
  if (Number.isFinite(interval) && interval > 0) state.intervalMs = interval
  if (Number.isFinite(remaining)) {
    state.remaining = Math.max(remaining, 0)
    state.windowEndsAt = Date.now() + (Number.isFinite(reset) && reset > 0 ? reset : state.intervalMs)
  }
}

/**
 * Дождаться разрешения отправить запрос: равномерный pacing внутри окна
 * и ожидание сброса окна при исчерпании лимита.
 * @returns {Promise<void>}
 */
async function waitForQuota() {
  // Равномерный pacing: минимальная пауза между запросами = interval / limit
  const minGapMs = state.intervalMs / state.limit
  const sinceLast = Date.now() - state.lastRequestAt
  if (sinceLast < minGapMs) {
    await sleep(minGapMs - sinceLast)
  }

  // Если квота окна исчерпана — ждём сброса (по X-Lognex-Reset / Retry-After),
  // а если момент сброса неизвестен — полное дефолтное окно
  if (state.remaining <= 0) {
    const waitMs = state.windowEndsAt > 0
      ? Math.max(state.windowEndsAt - Date.now(), 50)
      : DEFAULT_INTERVAL_MS
    await sleep(waitMs)
    state.remaining = state.limit
  }

  state.lastRequestAt = Date.now()
  state.remaining = Math.max(state.remaining - 1, 0)
}

/**
 * Получить время ожидания после 429 из заголовка X-Lognex-Retry-After (мс).
 * @param {Response} res - ответ fetch API
 * @returns {number} количество миллисекунд ожидания
 */
function getRetryDelayMs(res) {
  const h = res && res.headers
  if (h && typeof h.get === 'function') {
    const retryAfter = parseInt(h.get('x-lognex-retry-after'), 10)
    if (Number.isFinite(retryAfter) && retryAfter > 0) return retryAfter
  }
  return RETRY_FALLBACK_MS
}

/**
 * Fetch с планированием запросов к API МойСклад.
 * Совместим с опцией `fetch` клиента moysklad: `ms({ token, fetch: rateLimitedFetch })`.
 * @param {string|URL|Request} url - адрес запроса
 * @param {Object} [options={}] - опции fetch (method, headers, body и т.д.)
 * @returns {Promise<Response>} ответ сервера (после повторов при 429)
 * @throws {Error} если запрос завершился 429 после MAX_RETRIES попыток —
 *   возвращается последний ответ 429 (без исключения), либо сетевая ошибка fetch
 */
async function rateLimitedFetch(url, options = {}) {
  for (let attempt = 0; ; attempt++) {
    await acquireSlot()
    let res
    try {
      await waitForQuota()
      res = await fetch(url, options)
    } finally {
      releaseSlot()
    }

    // Если fetch вернул не-Response (неожиданно) — пробрасываем как есть
    if (!res || typeof res.status !== 'number') return res

    updateFromHeaders(res)

    if (res.status === 429 && attempt < MAX_RETRIES) {
      const delayMs = getRetryDelayMs(res)
      // Ожидание выполнит waitForQuota на следующей попытке (без двойного сна)
      state.remaining = 0
      state.windowEndsAt = Date.now() + delayMs
      // Освобождаем соединение с непрочитанным телом ошибки
      if (res.body && typeof res.body.cancel === 'function') {
        res.body.cancel().catch(() => {})
      }
      continue
    }

    return res
  }
}

module.exports = { rateLimitedFetch }
