/**
 * @file app.js — SPA-клиент SiMOTO-sklad
 * =======================================
 *
 * Основной модуль фронтенда: проверка заказов (скан), пакетная обработка,
 * сортировка, фильтрация, калькулятор сумм, SSE-потоки для realtime-обновлений.
 *
 * @module AppClient
 *
 * Зависимости:
 *   - sticker.js (глобальные функции: generateSticker, toggleStickerModal)
 *   - index.html (DOM-элементы: tableBody, statsOutput, numbersInput и др.)
 */

'use strict';

/** @type {Array<Object>} Массив данных заказов, загруженных со сканирования */
let ordersData = []

// Порядок статусов по жизненному циклу (для циклической сортировки)
const LIFECYCLE_STATUSES = [
  'Новый',
  'Предложение отправлено',
  'Подтверждён',
  'Оплачен',
  'Частично оплачен',
  'На отправке с отсрочкой платежа',
  'На отправку - оплачен',
  'Собран',
  'Ожидает отгрузки',
  'Сохранено',
  'Отправлен',
  'Доставляется',
  'Доставлен',
  'Отгружен',
  'С отсрочкой',
  'Возврат ожидает',
  'Возврат',
  'Возвращается',
  'Частичная отмена',
  'Отменён',
  'ОЖДАЕТ ОЗОН (КОМПЕНСИРОВАН)'
]

/**
 * Возвращает отсортированные статусы из жизненного цикла, присутствующие в текущих данных.
 * Сначала идут статусы из LIFECYCLE_STATUSES (в порядке цикла), затем остальные (по алфавиту).
 *
 * @returns {string[]} Массив названий статусов в порядке сортировки
 */
function getLifecycleStatuses() {
  const statusSet = new Set()
  ordersData.forEach((order) => {
    if (order.statusName) statusSet.add(order.statusName)
  })

  // Разделяем на статусы из жизненного цикла и остальные
  const inLifecycle = []
  const notInLifecycle = []

  statusSet.forEach((status) => {
    if (LIFECYCLE_STATUSES.includes(status)) {
      inLifecycle.push(status)
    } else {
      notInLifecycle.push(status)
    }
  })

  // Сортируем статусы из жизненного цикла по порядку в LIFECYCLE_STATUSES
  inLifecycle.sort((a, b) => LIFECYCLE_STATUSES.indexOf(a) - LIFECYCLE_STATUSES.indexOf(b))

  // Сортируем остальные статусы по алфавиту
  notInLifecycle.sort((a, b) => a.localeCompare(b, 'ru'))

  // Объединяем: сначала жизненный цикл, потом остальные
  return [...inLifecycle, ...notInLifecycle]
}

let currentPage = 0
const PAGE_SIZE = 1000
let ordersState = {}
// currentSort: column - текущая колонка, statusIndex - индекс в getLifecycleStatuses() (для статуса)
let currentSort = { column: 'shipmentNum', asc: true, statusIndex: 0 }
let dateFilter = { from: '', to: '' }
let drpState = { month: new Date().getMonth(), year: new Date().getFullYear() }
let currentController = null
let isWorking = false
let realtimeMode = false // Флаг для realtime добавления строк без перерисовки
let serverCheckTimer = null // Для cleanup таймера
let currentDuplicates = 0 // Счётчик дублей

/**
 * Показывает кастомный диалог подтверждения (модальное окно).
 * Возвращает Promise, который разрешается true (ОК) или false (Отмена/клик вне).
 *
 * @param {string} message - Текст сообщения
 * @param {string} [title='Подтверждение'] - Заголовок модалки
 * @returns {Promise<boolean>} true если пользователь нажал ОК
 */
function showConfirm(message, title = 'Подтверждение') {
  return new Promise((resolve) => {
    const modal = document.getElementById('confirmModal')
    const titleEl = document.getElementById('confirmTitle')
    const msgEl = document.getElementById('confirmMessage')
    const okBtn = document.getElementById('confirmOk')
    const cancelBtn = document.getElementById('confirmCancel')

    titleEl.textContent = title
    msgEl.textContent = message
    modal.classList.remove('hidden')

    const cleanup = (result) => {
      modal.classList.add('hidden')
      okBtn.removeEventListener('click', onOk)
      cancelBtn.removeEventListener('click', onCancel)
      modal.removeEventListener('click', onOverlayClick)
      resolve(result)
    }

    const onOk = () => cleanup(true)
    const onCancel = () => cleanup(false)
    const onOverlayClick = (e) => {
      if (e.target === modal) cleanup(false)
    }

    okBtn.addEventListener('click', onOk)
    cancelBtn.addEventListener('click', onCancel)
    modal.addEventListener('click', onOverlayClick)
  })
}

// ===== Секундомер =====
let operationTimer = null
let operationStartTime = null

/**
 * Запускает секундомер операции. Обновляет отображение каждую секунду.
 * Если таймер уже запущен, перезапускает его (сбрасывает).
 *
 * @returns {void}
 */
function startOperationTimer() {
  operationStartTime = Date.now()
  if (operationTimer) clearInterval(operationTimer)
  operationTimer = setInterval(() => {
    const elapsed = Math.floor((Date.now() - operationStartTime) / 1000)
    const mins = Math.floor(elapsed / 60)
    const secs = elapsed % 60
    updateTimerDisplay(`${mins}:${secs.toString().padStart(2, '0')}`)
  }, 1000)
}

/**
 * Останавливает секундомер и возвращает затраченное время в секундах.
 *
 * @returns {number} Затраченное время в секундах (0 если таймер не был запущен)
 */
function stopOperationTimer() {
  if (operationTimer) {
    clearInterval(operationTimer)
    operationTimer = null
  }
  if (operationStartTime) {
    const elapsed = Math.floor((Date.now() - operationStartTime) / 1000)
    operationStartTime = null
    return elapsed
  }
  return 0
}

/**
 * Обновляет отображение таймера в DOM-элементе #operationTimer.
 *
 * @param {string} timeStr - Строка времени в формате "М:СС"
 * @returns {void}
 */
function updateTimerDisplay(timeStr) {
  const timerEl = document.getElementById('operationTimer')
  if (timerEl) timerEl.textContent = timeStr
}

/**
 * Форматирует количество секунд в строку "М:СС".
 *
 * @param {number} seconds - Количество секунд
 * @returns {string} Отформатированное время
 */
function getFormattedTime(seconds) {
  const mins = Math.floor(seconds / 60)
  const secs = seconds % 60
  return `${mins}:${secs.toString().padStart(2, '0')}`
}

/**
 * Проверяет, был ли заказ уже обработан (создан платёж/отгрузка/возврат или отменён).
 *
 * @param {string} shipmentNum - Номер заказа
 * @returns {boolean} true если заказ уже обработан
 */
function isOrderProcessed(shipmentNum) {
  const state = ordersState[shipmentNum]
  if (!state || !state.lastAction) return false
  const processedActions = [
    'payment_created',
    'demand_created',
    'return_created',
    'order_cancelled'
  ]
  return processedActions.includes(state.lastAction)
}

// ===== Функции для блока "После действий" =====

/**
 * Отображает результаты массовой операции (создание отгрузок/платежей/возвратов/отмен).
 * Показывает количество созданных, пропущенных и ошибочных операций.
 *
 * @param {{ created: number, skipped: number, errors: number }} results - Результаты операции
 * @param {number} [elapsedTime=0] - Затраченное время в секундах
 * @returns {void}
 */
function showBatchResults(results, elapsedTime = 0) {
  const container = document.getElementById('statsFinalOutput')
  const header = document.getElementById('statsFinalHeader')
  if (!container) return

  // Показываем заголовок
  if (header) header.classList.remove('hidden')

  const { created = 0, skipped = 0, errors = 0 } = results
  const timeStr = getFormattedTime(elapsedTime)

  container.classList.remove('idle')
  container.innerHTML = `
        <div class="terminal-line info">Массовая операция завершена</div>
        <div class="terminal-line success">Создано: ${created}</div>
        <div class="terminal-line warning">Пропущено: ${skipped}</div>
        ${errors > 0 ? `<div class="terminal-line error">Ошибок: ${errors}</div>` : ''}
        <div class="terminal-line time-line">Затрачено: ${timeStr}</div>
        <div class="terminal-status">
            <div class="terminal-status-dot"></div>
            <span>Завершено</span>
        </div>
    `
}

/**
 * Отображает результаты сканирования (поиска заказов).
 * Показывает количество обработанных, найденных и ошибочных запросов.
 *
 * @param {{ processed: number, found: number, errors: number }} results - Результаты сканирования
 * @param {number} [elapsedTime=0] - Затраченное время в секундах
 * @returns {void}
 */
function showScanResults(results, elapsedTime = 0) {
  const container = document.getElementById('statsFinalOutput')
  const header = document.getElementById('statsFinalHeader')
  if (!container) return

  // Показываем заголовок
  if (header) header.classList.remove('hidden')

  const { processed = 0, found = 0, errors = 0 } = results
  const timeStr = getFormattedTime(elapsedTime)

  container.classList.remove('idle')
  container.innerHTML = `
        <div class="terminal-line info">Сканирование завершено</div>
        <div class="terminal-line">Обработано: ${processed}</div>
        <div class="terminal-line success">Найдено: ${found}</div>
        ${errors > 0 ? `<div class="terminal-line error">Ошибок: ${errors}</div>` : ''}
        <div class="terminal-line time-line">Затрачено: ${timeStr}</div>
        <div class="terminal-status">
            <div class="terminal-status-dot"></div>
            <span>Сканирование завершено</span>
        </div>
    `
}

/**
 * Скрывает или сбрасывает блок "После действий" (statsFinalOutput).
 * Если showTimer=true — показывает "Выполняется..." с таймером и анимацией.
 * Если showTimer=false — показывает "Ожидание массовой операции".
 *
 * @param {boolean} [showTimer=true] - Показывать таймер выполнения
 * @returns {void}
 */
function hideFinalStats(showTimer = true) {
  const container = document.getElementById('statsFinalOutput')
  const header = document.getElementById('statsFinalHeader')
  if (!container) return

  // Показываем заголовок
  if (header) header.classList.remove('hidden')

  container.classList.remove('idle')
  if (showTimer) {
    container.innerHTML = `
            <div class="terminal-line info">Выполняется...</div>
            <div class="terminal-line time-line">Время: <span id="operationTimer">0:00</span></div>
            <div class="terminal-status">
                <div class="terminal-status-dot pulse"></div>
                <span>Обработка</span>
            </div>
        `
  } else {
    container.classList.add('idle')
    container.innerHTML = `
            <div class="terminal-message">Ожидание массовой операции</div>
        `
    if (header) header.classList.add('hidden')
  }
}

/**
 * Загружает токен МойСклад из localStorage.
 * Пробует новый ключ 'ms_token', затем старый 'moyskladToken'.
 *
 * @returns {string} Токен авторизации или пустая строка
 */
function loadToken() {
  // Try new key first, then fallback to old key
  return localStorage.getItem('ms_token') || localStorage.getItem('moyskladToken') || ''
}

/**
 * Сохраняет токен МойСклад из поля #tokenInput в localStorage.
 * Сохраняется в оба ключа: 'ms_token' (новый) и 'moyskladToken' (старый для совместимости).
 *
 * @returns {string} Сохранённый токен или текущий из loadToken()
 */
function saveToken() {
  // This function is kept for compatibility, but token is now saved via modal
  const tokenInput = document.getElementById('tokenInput')
  if (tokenInput) {
    const token = tokenInput.value.trim()
    localStorage.setItem('ms_token', token)
    localStorage.setItem('moyskladToken', token) // Keep old key for compatibility
    showStatus('Токен сохранён')
    return token
  }
  return loadToken()
}

/**
 * Загружает состояние заказов (ordersState) с сервера через GET /api/orders-state.
 * Обновляет глобальную переменную ordersState.
 *
 * @async
 * @returns {Promise<void>}
 */
async function loadOrdersState() {
  try {
    const response = await fetch('/api/orders-state')
    ordersState = await response.json()
  } catch (e) {
    console.error('Error loading orders state:', e)
  }
}

/**
 * Сохраняет действие над заказом (платёж/отгрузка/возврат/отмена) на сервер.
 * POST /api/orders-state с информацией о выполненном действии.
 *
 * @async
 * @param {string} shipmentNum - Номер заказа
 * @param {string} action - Тип действия (payment_created, demand_created, etc.)
 * @param {string} result - Результат (имя документа или ошибка)
 * @param {Object} [extraData={}] - Дополнительные данные (returnSum, cancelledSum)
 * @returns {Promise<void>}
 */
async function saveOrderAction(shipmentNum, action, result, extraData = {}) {
  try {
    await fetch('/api/orders-state', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ shipmentNum, action, result, ...extraData })
    })
  } catch (e) {
    console.error('Error saving order action:', e)
  }
}

/**
 * Сохраняет текущие данные сканирования на сервер (заменяет предыдущее).
 * Убирает тяжёлые поля (orderFull, demand) перед отправкой.
 *
 * @async
 * @returns {Promise<void>}
 */
async function saveScanState() {
  if (!ordersData || ordersData.length === 0) {
    showStatus('Нет данных для сохранения')
    return
  }
  try {
    // Убираем тяжёлые поля перед отправкой
    const lightOrders = ordersData.map((order) => {
      const { orderFull, demand, ...light } = order
      return light
    })
    const response = await fetch('/api/orders-state', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orders: lightOrders })
    })
    if (!response.ok) {
      throw new Error('HTTP ' + response.status)
    }
    const contentType = response.headers.get('content-type')
    if (!contentType || !contentType.includes('application/json')) {
      const text = await response.text()
      throw new Error('Не JSON: ' + text.slice(0, 50))
    }
    const result = await response.json()
    showStatus('Сохранено: ' + (result.count || 0) + ' заказов')
  } catch (e) {
    showStatus('Ошибка сохранения: ' + e.message)
  }
}

/**
 * Сохраняет данные сканирования без уведомлений (тихо).
 * Не показывает статус, не выбрасывает ошибки.
 *
 * @async
 * @returns {Promise<void>}
 */
async function saveScanStateSilent() {
  if (!ordersData || ordersData.length === 0) return
  try {
    // Убираем тяжёлые поля перед отправкой
    const lightOrders = ordersData.map((order) => {
      const { orderFull, demand, ...light } = order
      return light
    })
    await fetch('/api/orders-state', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orders: lightOrders })
    })
  } catch (e) {
    // silence
  }
}

/**
 * Парсит номера из текстового поля ввода (#numbersInput).
 * Разбивает по строкам, обрезает пробелы, удаляет пустые, уникализирует.
 *
 * @returns {string[]} Массив уникальных номеров заказов
 */
function parseNumbers() {
  const text = document.getElementById('numbersInput').value
  return [
    ...new Set(
      text
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l)
    )
  ]
}

/**
 * Загружает сохранённые заказы из состояния сервера (ordersState)
 * и преобразует их в формат ordersData с вычисляемыми полями (canPayment, canDemand и т.д.).
 *
 * @async
 * @returns {Promise<Array<Object>>} Массив объектов заказов
 */
async function loadSavedOrders() {
  await loadOrdersState()
  if (Object.keys(ordersState).length === 0) {
    showStatus('Нет сохранённых данных')
    return []
  }
  showStatus('Загружено: ' + Object.keys(ordersState).length + ' заказов')

  const savedOrders = []
  for (const [shipmentNum, state] of Object.entries(ordersState)) {
    savedOrders.push({
      ...state,
      shipmentNum,
      enabled: true,
      canPayment: state.hasDemand && !state.hasPayment && !state.isCancelled && (!state.hasReturn || (state.returnSum && state.returnSum < state.sum)) && !state.returnType,
      canDemand: !state.hasDemand && !state.isCancelled,
      canReturn: state.hasDemand && !state.hasReturn && !state.isCancelled,
      canCancel: !state.hasDemand && !state.isCancelled,
      orderPositions: state.orderPositions || [],
      demandPositions: state.demandPositions || []
    })
  }
  return savedOrders
}

/**
 * Загружает сохранённые заказы и перерисовывает таблицу, статистику и тоталы.
 *
 * @returns {void}
 */
function loadSavedOrdersAndRender() {
  currentPage = 0
  loadSavedOrders().then(function (orders) {
    mismatchFilterOrders = null
    ordersData = orders
    renderTable()
    updateTotals()
    renderCurrentStats()
    saveLastActionStats()
  })
}

/**
 * Сортирует таблицу по указанной колонке.
 * Для колонки 'statusName' — циклическая сортировка по жизненному циклу статуса.
 * Для остальных колонок — стандартная asc/desc.
 *
 * @param {string} column - Имя колонки (shipmentNum, orderName, sum, statusName, и т.д.)
 * @returns {void}
 */
function sortTable(column) {
  if (column === 'statusName') {
    if (currentSort.column === column) {
      // Циклически переключаем статус: +1 по кругу
      const statuses = getLifecycleStatuses()
      if (statuses.length > 0) {
        currentSort.statusIndex = (currentSort.statusIndex + 1) % statuses.length
      }
    } else {
      // Первая сортировка по статусу - берем первый статус из жизненного цикла
      currentSort.column = column
      currentSort.statusIndex = 0
    }
  } else {
    // Для других колонок - стандартная логика asc/desc
    if (currentSort.column === column) {
      currentSort.asc = !currentSort.asc
    } else {
      currentSort.column = column
      currentSort.asc = true
    }
  }
  renderTable()
  updateSortIndicators()
}

/**
 * Обновляет визуальные индикаторы сортировки на заголовках таблицы (↑ ↓ цикл).
 * Для колонки статуса показывает текущий выбранный статус.
 *
 * @returns {void}
 */
function updateSortIndicators() {
  document.querySelectorAll('th').forEach((th) => {
    th.classList.remove('asc', 'desc', 'cycle')
    th.removeAttribute('data-cycle-status')
  })
  const th = document.querySelector(`th[onclick="sortTable('${currentSort.column}')"]`)
  if (th) {
    if (currentSort.column === 'statusName') {
      th.classList.add('cycle')
      const lifecycleStatuses = getLifecycleStatuses()
      const currentStatus = lifecycleStatuses[currentSort.statusIndex] || ''
      th.setAttribute('data-cycle-status', currentStatus)
    } else {
      th.classList.add(currentSort.asc ? 'asc' : 'desc')
    }
  }
}

/**
 * Возвращает отсортированную копию массива заказов согласно currentSort.
 * Поддерживает сортировку по статусу (жизненный цикл), булевым полям, числам и строкам.
 *
 * @param {Array<Object>} [data=ordersData] - Массив заказов для сортировки
 * @returns {Array<Object>} Отсортированный массив
 */
function getSortedOrders(data = ordersData) {
  const col = currentSort.column
  const asc = currentSort.asc

  return [...data].sort((a, b) => {
    let va, vb

    if (col === 'statusName') {
      // Циклическая сортировка по статусу (жизненный цикл)
      const lifecycleStatuses = getLifecycleStatuses()
      const targetStatus = lifecycleStatuses[currentSort.statusIndex] || ''

      // Группируем: выбранный статус наверху, остальные по порядку жизненного цикла
      const getStatusPriority = (statusName) => {
        if (statusName === targetStatus) return 0 // Выбранный статус - первый
        const idx = lifecycleStatuses.indexOf(statusName)
        return idx === -1 ? Number.MAX_SAFE_INTEGER : idx + 1 // Остальные по порядку
      }

      const priorityA = getStatusPriority(a[col] || '')
      const priorityB = getStatusPriority(b[col] || '')
      va = priorityA
      vb = priorityB
    } else if (
      col === 'hasDemand' ||
      col === 'hasPayment' ||
      col === 'hasReturn' ||
      col === 'isCancelled'
    ) {
      // Сортировка по булевым полям: false < true
      va = a[col] ? 1 : 0
      vb = b[col] ? 1 : 0
    } else if (col === 'sum' || col === 'paid' || col === 'returnSum') {
      va = Number(a[col]) || 0
      vb = Number(b[col]) || 0
    } else if (col === 'orderMoment') {
      // ISO 8601 сортируется лексикографически — null/пустые в конец
      va = a[col] || ''
      vb = b[col] || ''
    } else {
      va = String(a[col] || '').toLowerCase()
      vb = String(b[col] || '').toLowerCase()
    }

    if (va < vb) return asc ? -1 : 1
    if (va > vb) return asc ? 1 : -1
    return 0
  })
}

/**
 * Переключает чекбоксы всех видимых (прошедших фильтр) строк таблицы.
 *
 * @param {boolean} checked - Новое состояние чекбокса
 * @returns {void}
 */
function toggleAll(checked) {
  const filtered = getFilteredData()
  const filteredSet = new Set(filtered.map(o => o.shipmentNum))
  ordersData.forEach((o) => {
    if (filteredSet.has(o.shipmentNum)) o.enabled = checked
  })
  renderTable()
  updateTotals()
  renderCurrentStats()
}

/**
 * Переключает состояние enabled у заказа по индексу.
 * Добавляет CSS-анимацию bounce на чекбокс.
 *
 * @param {number} index - Индекс заказа в ordersData
 * @param {HTMLElement} el - DOM-элемент чекбокса
 * @returns {void}
 */
function toggleEnabled(index, el) {
  ordersData[index].enabled = !ordersData[index].enabled
  if (el && el.checked) {
    el.classList.add('checkbox-bounce')
    setTimeout(() => el.classList.remove('checkbox-bounce'), 350)
  }
  updateTotals(true)
  renderCurrentStats()
}

/**
 * Основная функция сканирования заказов по введённым номерам.
 * Читает номера из #numbersInput, проверяет дубли, подключается к SSE-потоку
 * /api/unified-search/stream и отображает результаты в realtime.
 * Поддерживает прерывание через abortCheck().
 *
 * @async
 * @returns {Promise<void>}
 */
async function checkNumbers() {
  const text = document.getElementById('numbersInput').value

  // Подсчёт дублей (до уникализации)
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l)
  currentDuplicates = lines.length - new Set(lines).size

  const numbers = [...new Set(lines)]

  if (numbers.length === 0) {
    showStatus('Введите номера')
    return
  }

  await loadOrdersState()

  const checkBtn = document.querySelector('.btn-ms')
  const abortBtn = document.getElementById('abortBtn')
  if (checkBtn) checkBtn.style.display = 'none'
  abortBtn.style.display = 'flex'
  isWorking = true
  showProgress(true)

  // Сбрасываем блок "После действий" и запускаем секундомер
  hideFinalStats(true)
  startOperationTimer()

  // Добавляем анимацию сканирования
  document.querySelector('.stats-final').classList.add('scanning')

  // Очищаем таблицу перед добавлением
  const tbody = document.getElementById('tableBody')
  tbody.innerHTML = ''
  currentPage = 0
  ordersData = []

  // Сбрасываем статистику перед новым сканированием (чтобы показать 0)
  currentDuplicates = 0
  renderCurrentStats() // Показать 0 сразу

  // Включаем realtime режим
  realtimeMode = true

  // Таймаут на случай зависания fetch (iOS + самоподписанный HTTPS)
  let fetchTimeout = null
  window.__fetchTimeout = false

  try {
    // Создаём AbortController и AbortId для сервера
    currentController = new AbortController()
    const abortId = Math.random().toString(36).substring(2, 15)
    window.__currentAbortId = abortId // Сохраняем для abortCheck()

    // SSE URL с параметрами
    const msToken = loadToken() || ''
    const wbToken = localStorage.getItem('wb_token') || ''
    const ozonClientId = localStorage.getItem('ozon_client_id') || ''
    const ozonApiKey = localStorage.getItem('ozon_api_key') || ''
    const numbersParam = encodeURIComponent(numbers.join(','))
    const url = `/api/unified-search/stream?numbers=${numbersParam}&abortId=${abortId}`

    // Таймаут 10с — если сервер не ответил, прерываем
    fetchTimeout = setTimeout(() => {
      window.__fetchTimeout = true
      if (currentController) currentController.abort()
    }, 10000)

    const response = await fetch(url, {
      signal: currentController.signal,
      headers: {
        'x-api-token': msToken,
        'x-wb-token': wbToken,
        'x-ozon-client-id': ozonClientId,
        'x-ozon-api-key': ozonApiKey
      }
    })
    clearTimeout(fetchTimeout)
    fetchTimeout = null

    if (!response.ok) {
      const errData = await response.json()
      hideProgress(false, errData.error || 'Ошибка')
      document.querySelector('.stats-final')?.classList.remove('scanning')
      return
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })

      // Разбиваем на события (data: {...}\n\n)
      const lines = buffer.split('\n')
      buffer = lines.pop() || '' // Оставляем последнюю неполную строку

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const data = JSON.parse(line.slice(6))

            if (data.type === 'progress') {
              // Получен промежуточный результат
              const order = data.order

              const orderData = {
                ...order,
                enabled: true
              }

              ordersData.push(orderData)

              // Обновляем статус
              document.getElementById('statusText').textContent =
                `Загружено ${data.index}/${data.total}`

              // Добавляем строку в таблицу
              appendOrderRow(orderData)

              // Обновляем статистику после каждой строки (с force=true для realtime)
              updateTotals()
              renderCurrentStats(true)

              // Небольшая задержка для визуализации (30ms) — закомментировано для скорости
              // await new Promise(r => setTimeout(r, 30))
            } else if (data.type === 'done') {
              // Завершено
              console.log('SSE done, total:', data.orders?.length)

              // Останавливаем секундомер
              const elapsed = stopOperationTimer()

              // Отключаем realtime режим для обновления статистики
              realtimeMode = false

              updateTotals()
              renderCurrentStats()
              saveLastActionStats()
              hideProgress(true, 'Готово: ' + ordersData.length)

              // Сохраняем автоматически после сканирования
              if (ordersData.length > 0) {
                saveScanStateSilent()
              }

              // Показываем результаты сканирования в блоке "После действий"
              const totalNumbers = numbers.length
              const errors = data.errors || 0
              showScanResults(
                {
                  processed: totalNumbers,
                  found: ordersData.length,
                  errors: errors
                },
                elapsed
              )

              // Убираем анимацию сканирования
              document.querySelector('.stats-final').classList.remove('scanning')
            } else if (data.type === 'aborted') {
              // Прервано пользователем
              console.log('SSE aborted, processed:', data.processed)

              // Останавливаем секундомер
              const elapsed = stopOperationTimer()

              realtimeMode = false
              updateTotals()
              renderCurrentStats()
              hideProgress(false, 'Прервано. Обработано: ' + data.processed)
              showScanResults(
                {
                  processed: data.processed,
                  found: ordersData.length,
                  errors: 0
                },
                elapsed
              )

              // Убираем анимацию сканирования
              document.querySelector('.stats-final').classList.remove('scanning')
            } else if (data.type === 'error') {
              hideProgress(false, data.error)
              document.querySelector('.stats-final')?.classList.remove('scanning')
              return
            }
          } catch (e) {
            console.error('SSE parse error:', e)
          }
        }
      }
    }
  } catch (e) {
    clearTimeout(fetchTimeout)
    if (e.name === 'AbortError') {
      hideProgress(false, window.__fetchTimeout ? 'Таймаут: сервер не отвечает (30с)' : 'Прервано')
      stopOperationTimer()
    } else {
      hideProgress(false, 'Ошибка: ' + e.message)
      stopOperationTimer()
    }
  } finally {
    clearTimeout(fetchTimeout)
    stopOperationTimer()

    // Отключаем realtime режим
    realtimeMode = false
    renderTable()

    if (checkBtn) checkBtn.style.display = 'inline-flex'
    abortBtn.style.display = 'none'
    isWorking = false

    // Очищаем abortId
    window.__currentAbortId = null

    // Убираем анимацию сканирования (гарантированно)
    document.querySelector('.stats-final')?.classList.remove('scanning')
  }
}

/**
 * Форматирует число как сумму в рублях (с пробелами-разделителями).
 * Если n пустое или 0 — возвращает прочерк.
 *
 * @param {number|string} n - Число для форматирования
 * @returns {string} Отформатированная строка "1 234 ₽" или "-"
 */
function fmtSum(n) {
  return (n && Number(n) > 0 ? Number(n).toLocaleString() + ' ₽' : '-')
}

/**
 * Добавляет строку в таблицу для заказа (используется для возвратов WB/Ozon).
 * Создаёт и вставляет DOM-элемент tr в #tableBody.
 *
 * @param {Object} order - Данные заказа для отображения
 * @returns {void}
 */
function appendTableRow(order) {
  const tbody = document.getElementById('tableBody')
  const tr = document.createElement('tr')
  const isReturn = order.status === 'return' || order.hasReturn

  let cssClass = 'status-other'
  let displayText = order.statusName || '-'
  if (isReturn) {
    cssClass = 'status-return'
  } else if (order.status === 'sale') {
    cssClass = 'status-shipped'
    displayText = 'Продажа'
  }

  const returnDisplay = order.returnSum
    ? `<span class="payment-sum">${fmtSum(order.returnSum)}</span>`
    : (isReturn ? `<span class="payment-sum">${fmtSum(order.sum || 0)}</span>` : '<span class="status-no">—</span>')

  tr.innerHTML = `
     <td>${esc(order.shipmentNum || '')}</td>
     <td>${esc(order.orderName || '-')}</td>
     <td>${fmtSum(order.sum || 0)}</td>
     <td><span class="status-no">—</span></td>
     <td><span class="status-no">—</span></td>
     <td>${returnDisplay}</td>
     <td><span class="${cssClass}">${esc(displayText)}</span></td>
   `
  // Добавляем класс строки для возвратов
  if (isReturn) tr.classList.add('row-return')
  tbody.appendChild(tr)
}

/**
 * Поиск возврата Wildberries по коду стикера.
 * Цепочка: sticker → WB supplier/sales → srid → orderId → checkNumbers(orderId).
 * Использует SSE-поток /api/wb-return/stream.
 *
 * @async
 * @returns {Promise<void>}
 */
async function wbReturnSearch() {
  const text = document.getElementById('numbersInput').value

  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l)
  currentDuplicates = lines.length - new Set(lines).size

  const numbers = [...new Set(lines)]

  if (numbers.length === 0) {
    showStatus('Введите коды стикеров')
    return
  }

  const wbToken = localStorage.getItem('wb_token')
  if (!wbToken) {
    showStatus('Ошибка: WB токен не найден. Нажмите "Токены" в шапке.')
    return
  }

  const msToken = loadToken()
  if (!msToken) {
    showStatus('Ошибка: Токен МС не найден.')
    return
  }

  await loadOrdersState()

  const wbBtn = document.querySelector('.btn-wb')
  const abortBtn = document.getElementById('abortBtn')
  if (wbBtn) wbBtn.style.display = 'none'
  abortBtn.style.display = 'flex'
  isWorking = true
  showProgress(true)

  hideFinalStats(true)
  startOperationTimer()

  document.querySelector('.stats-final').classList.add('scanning')

  const tbody = document.getElementById('tableBody')
  tbody.innerHTML = ''
  currentPage = 0
  ordersData = []

  currentDuplicates = 0
  renderCurrentStats()
  realtimeMode = true

  try {
    currentController = new AbortController()
    const abortId = Math.random().toString(36).substring(2, 15)
    window.__currentAbortId = abortId

    const numbersParam = encodeURIComponent(numbers.join(','))
    const url = `/api/wb-return/stream?numbers=${numbersParam}&abortId=${abortId}`

    const response = await fetch(url, {
      signal: currentController.signal,
      headers: {
        'x-wb-token': wbToken,
        'x-api-token': msToken
      }
    })

    if (!response.ok) {
      const errData = await response.json()
      hideProgress(false, errData.error || 'Ошибка')
      document.querySelector('.stats-final')?.classList.remove('scanning')
      return
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })

      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const data = JSON.parse(line.slice(6))

            if (data.type === 'progress') {
              // WB rate limit (onWait) — обновляем статус, строку не добавляем
              document.getElementById('statusText').textContent =
                `⏳ ${data.order?.orderName || 'Ожидание...'}`
            } else if (data.type === 'search-ms') {
              document.getElementById('statusText').textContent =
                `⟳ Поиск в МС: ${data.msg || ''}`
            } else if (data.type === 'result') {
              const orderData = { ...data.order, enabled: true }
              ordersData.push(orderData)

              document.getElementById('statusText').textContent =
                `Загружено ${data.processed || ordersData.length}/${data.total || numbers.length}`

              appendOrderRow(orderData)
              updateTotals()
              renderCurrentStats(true)
            } else if (data.type === 'done') {
              const elapsed = stopOperationTimer()
              realtimeMode = false
              updateTotals()
              renderCurrentStats()
              saveLastActionStats()
              hideProgress(true, 'Готово: ' + ordersData.length)
              document.querySelector('.stats-final').classList.remove('scanning')
            } else if (data.type === 'aborted') {
              const elapsed = stopOperationTimer()
              realtimeMode = false
              updateTotals()
              renderCurrentStats()
              hideProgress(false, 'Прервано. Обработано: ' + data.processed)
              document.querySelector('.stats-final').classList.remove('scanning')
            } else if (data.type === 'error') {
              hideProgress(false, data.error)
              document.querySelector('.stats-final')?.classList.remove('scanning')
              return
            }
          } catch (e) {
            console.error('WB-Return SSE parse error:', e)
          }
        }
      }
    }
  } catch (e) {
    if (e.name === 'AbortError') {
      hideProgress(false, 'Прервано')
      stopOperationTimer()
    } else {
      hideProgress(false, 'Ошибка: ' + e.message)
      stopOperationTimer()
    }
  } finally {
    realtimeMode = false
    renderTable()

    if (wbBtn) wbBtn.style.display = 'inline-flex'
    abortBtn.style.display = 'none'
    isWorking = false
    window.__currentAbortId = null
    document.querySelector('.stats-final')?.classList.remove('scanning')
  }
}

/**
 * Поиск возврата Ozon по коду возврата (id или barcode).
 * Цепочка: код возврата → кэш Ozon returns → posting_number → заказ в МС.
 * Использует SSE-поток /api/ozon-return/stream.
 *
 * @async
 * @returns {Promise<void>}
 */
async function ozonReturnSearch() {
  const text = document.getElementById('numbersInput').value

  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l)
  currentDuplicates = lines.length - new Set(lines).size

  const numbers = [...new Set(lines)]

  if (numbers.length === 0) {
    showStatus('Введите коды возвратов Ozon')
    return
  }

  const ozonClientId = localStorage.getItem('ozon_client_id')
  const ozonApiKey = localStorage.getItem('ozon_api_key')

  if (!ozonClientId || !ozonApiKey) {
    showStatus('Ошибка: ключи Ozon не найдены. Нажмите "Токены" в шапке.')
    return
  }

  const msToken = loadToken()
  if (!msToken) {
    showStatus('Ошибка: Токен МС не найден.')
    return
  }

  await loadOrdersState()

  const ozonBtn = document.querySelector('.btn-ozon')
  const abortBtn = document.getElementById('abortBtn')
  if (ozonBtn) ozonBtn.style.display = 'none'
  abortBtn.style.display = 'flex'
  isWorking = true
  showProgress(true)

  hideFinalStats(true)
  startOperationTimer()

  document.querySelector('.stats-final')?.classList.add('scanning')

  const tbody = document.getElementById('tableBody')
  tbody.innerHTML = ''
  currentPage = 0
  ordersData = []

  currentDuplicates = 0
  renderCurrentStats()
  realtimeMode = true

  try {
    currentController = new AbortController()
    const abortId = Math.random().toString(36).substring(2, 15)
    window.__currentAbortId = abortId

    const numbersParam = encodeURIComponent(numbers.join(','))
    const url = `/api/ozon-return/stream?numbers=${numbersParam}&abortId=${abortId}`

    const response = await fetch(url, {
      signal: currentController.signal,
      headers: {
        'x-ozon-client-id': ozonClientId,
        'x-ozon-api-key': ozonApiKey,
        'x-api-token': msToken
      }
    })

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}))
      hideProgress(false, errData.error || `Ошибка: ${response.status}`)
      document.querySelector('.stats-final')?.classList.remove('scanning')
      return
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue
        try {
          const data = JSON.parse(line.slice(6))

          if (data.type === 'search-ms') {
            document.getElementById('statusText').textContent =
              `⟳ Поиск в МС: ${data.msg || ''}`
          } else if (data.type === 'result') {
            const orderData = { ...data.order, enabled: true }
            ordersData.push(orderData)
            appendOrderRow(orderData)
            updateTotals()
            renderCurrentStats(true)
          } else if (data.type === 'done') {
            const elapsed = stopOperationTimer()
            realtimeMode = false
            updateTotals()
            renderCurrentStats()
            saveLastActionStats()
            hideProgress(true, 'Готово: ' + ordersData.length)
            document.querySelector('.stats-final')?.classList.remove('scanning')
          } else if (data.type === 'aborted') {
            const elapsed = stopOperationTimer()
            realtimeMode = false
            updateTotals()
            renderCurrentStats()
            hideProgress(false, 'Прервано. Обработано: ' + (data.processed || 0))
            document.querySelector('.stats-final')?.classList.remove('scanning')
          } else if (data.type === 'error') {
            hideProgress(false, data.error || 'Ошибка')
            document.querySelector('.stats-final')?.classList.remove('scanning')
            return
          }
        } catch (e) {
          console.error('[Ozon Search] SSE parse error:', e)
        }
      }
    }
  } catch (e) {
    if (e.name === 'AbortError') {
      hideProgress(false, 'Прервано')
      stopOperationTimer()
    } else {
      hideProgress(false, 'Ошибка: ' + e.message)
      stopOperationTimer()
    }
  } finally {
    realtimeMode = false
    renderTable()

    if (ozonBtn) ozonBtn.style.display = 'inline-flex'
    abortBtn.style.display = 'none'
    isWorking = false
    window.__currentAbortId = null
    document.querySelector('.stats-final')?.classList.remove('scanning')
  }
}

/**
 * Прерывает текущую операцию поиска/сканирования.
 * Проверяет _unifiedAbort (новый механизм) и currentController (старый).
 * Уведомляет сервер через POST /api/abort.
 *
 * @returns {void}
 */
function abortCheck() {
  // Check if unified search is active first
  if (window._unifiedAbort) {
    window._unifiedAbort()
    return
  }

  // Supplies scan abort
  if (suppliesController) {
    suppliesController.abort()
    const abortId = window.__currentAbortId
    if (abortId) {
      fetch('/api/abort', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ abortId })
      }).catch(() => {})
    }
    return
  }

  // Legacy abort for currentController-based searches
  if (currentController) {
    currentController.abort()
    const abortId = window.__currentAbortId
    if (abortId) {
      fetch('/api/abort', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ abortId })
      }).catch(() => {})
    }
  }
}

/**
 * Формирует HTML-строку с кнопками действий для строки заказа.
 * Кнопки: отгрузка, платёж (в т.ч. частичный), возврат, отмена.
 * Состояние disabled определяется на основе свойств заказа.
 *
 * @param {Object} order - Данные заказа
 * @param {number} index - Индекс заказа в ordersData
 * @returns {string} HTML-строка с кнопками
 */
function getRowActions(order, index) {
  // Use properties directly from order (comes from server, verified in Moysklad)
  const hasD = order.hasDemand
  const hasPayment = order.hasPayment
  const hasMSReturn = order.hasReturn
  const hasMarketplaceReturn = !!(order.returnType)
  const hasReturn = hasMSReturn || hasMarketplaceReturn // для платежа — любой возврат блокирует
  const isCancelled = order.isCancelled

  let btns = '<div class="action-grid">'

  // Demand - создать отгрузку (если её нет и заказ не отменён)
  btns += `<button class="btn btn-demand action-btn" onclick="createDemandByNum('${order.shipmentNum}')" title="${hasD ? 'Отгрузка есть' : 'Создать отгрузку'}" ${hasD || isCancelled ? 'disabled' : ''}>📦</button>`

  // Payment - создать платёж
  // Если есть частичный возврат (returnSum < sum) → предлагаем частичный платёж
  let paymentBtn
  if (hasReturn && order.returnSum && order.returnSum < order.sum) {
    // Partial return → partial payment (not disabled)
    paymentBtn = `<button class="btn btn-payment action-btn" onclick="createPartialPaymentByNum('${order.shipmentNum}')" title="Создать платёж (частичный, без возврата)">💰</button>`
  } else {
    paymentBtn = `<button class="btn btn-payment action-btn" onclick="createPaymentByNum('${order.shipmentNum}')" title="${hasPayment ? 'Оплачено' : 'Создать платёж'}" ${hasPayment || isCancelled || !hasD || hasReturn ? 'disabled' : ''}>💰</button>`
  }
  btns += paymentBtn

  // Return - возврат (если есть отгрузка, возврат не создан, заказ не отменён)
  // Для маркетплейс-возвратов (returnType установлен) кнопка остаётся доступной,
  // чтобы можно было создать возврат в МС
  btns += `<button class="btn btn-return action-btn" onclick="createReturnByNum('${order.shipmentNum}')" title="${hasMSReturn ? 'Возврат есть' : 'Создать возврат'}" ${hasMSReturn || isCancelled || !hasD ? 'disabled' : ''}>↩</button>`

  // Cancel - отмена (только если нет отгрузки и не отменён)
  const canCancel = !hasD && !isCancelled
  btns += `<button class="btn btn-cancel action-btn" onclick="cancelOrderByNum('${order.shipmentNum}')" title="Отменить заказ" ${canCancel ? '' : 'disabled'}>✗</button>`

  btns += '</div>'
  return btns
}

/**
 * Форматирует ISO-дату в строку "ДД.ММ.ГГГГ<br>ЧЧ:ММ".
 * Если дата невалидна — возвращает исходную строку.
 *
 * @param {string} isoStr - ISO-строка даты
 * @returns {string} Отформатированная HTML-строка с датой
 */
function formatDate(isoStr) {
  if (!isoStr) return '<span class="status-no">—</span>'
  const d = new Date(isoStr)
  if (isNaN(d.getTime())) return isoStr
  const day = String(d.getDate()).padStart(2, '0')
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const year = d.getFullYear()
  const hours = String(d.getHours()).padStart(2, '0')
  const mins = String(d.getMinutes()).padStart(2, '0')
  return `${day}.${month}.${year}<br><span class="time-part">${hours}:${mins}</span>`
}

// ─── Date filter functions ────────────────────────────────────────────────────

/**
 * Возвращает отфильтрованные данные заказов на основе dateFilter и mismatchFilterOrders.
 * Применяет фильтр по дате (from/to) и фильтр расхождений.
 *
 * @returns {Array<Object>} Отфильтрованный массив заказов
 */
function getFilteredData() {
  let data = [...ordersData]
  if (dateFilter.from || dateFilter.to) {
    data = data.filter(order => {
      if (!order.orderMoment) return false
      const orderDate = order.orderMoment.substring(0, 10) // "YYYY-MM-DD"
      if (dateFilter.from && orderDate < dateFilter.from) return false
      if (dateFilter.to && orderDate > dateFilter.to) return false
      return true
    })
  }
  
  // ── Mismatch filter ──
  if (mismatchFilterOrders && mismatchFilterOrders.length > 0) {
    data = data.filter(o => mismatchFilterOrders.includes(o.shipmentNum))
  }
  
  return data
}

/**
 * Закрывает попап фильтра по дате (скрывает оверлей и попап).
 *
 * @returns {void}
 */
function closeDateFilter() {
  document.getElementById('dateFilterOverlay').style.display = 'none'
  document.getElementById('dateFilterPopup').style.display = 'none'
}

// ─── Custom Date Range Picker ────────────────────────────────────────────────

/**
 * Обновляет отображение полей ввода даты (dfFromDisplay, dfToDisplay)
 * из текущего состояния dateFilter в формате "ДД.ММ.ГГГГ".
 *
 * @returns {void}
 */
function drpUpdateDisplay() {
  const fmt = (iso) => {
    if (!iso) return ''
    const [y, m, d] = iso.split('-')
    return `${d}.${m}.${y}`
  }
  const fromEl = document.getElementById('dfFromDisplay')
  const toEl = document.getElementById('dfToDisplay')
  if (fromEl) fromEl.value = fmt(dateFilter.from)
  if (toEl) toEl.value = fmt(dateFilter.to)
}

/**
 * Переключает календарь на предыдущий месяц.
 *
 * @returns {void}
 */
function drpPrevMonth() {
  drpState.month--
  if (drpState.month < 0) { drpState.month = 11; drpState.year-- }
  drpRender()
}

/**
 * Переключает календарь на следующий месяц.
 *
 * @returns {void}
 */
function drpNextMonth() {
  drpState.month++
  if (drpState.month > 11) { drpState.month = 0; drpState.year++ }
  drpRender()
}

/**
 * Выбирает дату в календаре date range picker.
 * При первом клике устанавливает "от", при втором — "до".
 * Если диапазон уже выбран — начинает новый.
 *
 * @param {string} dateStr - Дата в формате "YYYY-MM-DD"
 * @returns {void}
 */
function drpSelect(dateStr) {
  if (!dateFilter.from || (dateFilter.from && dateFilter.to)) {
    dateFilter.from = dateStr
    dateFilter.to = ''
  } else {
    dateFilter.to = dateStr
    if (dateFilter.to < dateFilter.from) {
      [dateFilter.from, dateFilter.to] = [dateFilter.to, dateFilter.from]
    }
  }
  drpUpdateDisplay()
  drpRender()
}

/**
 * Рендерит календарь date range picker в DOM.
 * Строит сетку дней для текущего месяца с подсветкой today,
 * выбранного диапазона и доступных дат из данных заказов.
 *
 * @returns {void}
 */
function drpRender() {
  const { month, year } = drpState
  const daysEl = document.getElementById('drpDays')
  if (!daysEl) return

  const months = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь']
  const titleEl = document.getElementById('drpTitle')
  if (titleEl) titleEl.textContent = `${months[month]} ${year}`

  const firstDay = new Date(year, month, 1).getDay()
  const startOffset = firstDay === 0 ? 6 : firstDay - 1
  const daysInMonth = new Date(year, month + 1, 0).getDate()

  const today = new Date()
  const todayStr = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`

  // Dates that exist in loaded table data
  const availSet = new Set()
  ordersData.forEach(o => {
    if (o.orderMoment) availSet.add(o.orderMoment.substring(0, 10))
  })

  const { from, to } = dateFilter

  let html = ''
  for (let i = 0; i < startOffset; i++) html += '<span class="drp-day drp-empty"></span>'

  for (let d = 1; d <= daysInMonth; d++) {
    const ds = `${year}-${String(month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`
    let cls = 'drp-day'
    if (ds === todayStr) cls += ' drp-today'
    if (availSet.has(ds)) cls += ' drp-has'
    if (ds === from) cls += ' drp-from'
    if (ds === to) cls += ' drp-to'
    if (from && to && ds > from && ds < to) cls += ' drp-range'
    html += `<span class="${cls}" data-date="${ds}">${d}</span>`
  }

  daysEl.innerHTML = html
}

// ─── Date Filter Popup ───────────────────────────────────────────────────────

/**
 * Переключает отображение попапа фильтра по дате.
 * Позиционирует попап под заголовком колонки "Дата".
 *
 * @returns {void}
 */
function toggleDateFilter() {
  const popup = document.getElementById('dateFilterPopup')
  if (popup.style.display === 'block') { closeDateFilter(); return }
  const th = document.querySelector('th.date-header')
  const rect = th.getBoundingClientRect()
  popup.style.top = rect.bottom + 'px'
  drpState.month = dateFilter.from
    ? parseInt(dateFilter.from.split('-')[1]) - 1
    : new Date().getMonth()
  drpState.year = dateFilter.from
    ? parseInt(dateFilter.from.split('-')[0])
    : new Date().getFullYear()
  drpUpdateDisplay()
  drpRender()
  document.getElementById('dateFilterOverlay').style.display = 'block'
  popup.style.display = 'block'
}

/**
 * Применяет фильтр по дате: обновляет отображение и перерисовывает таблицу.
 *
 * @returns {void}
 */
function applyDateFilter() {
  dateFilter.from = dateFilter.from
  dateFilter.to = dateFilter.to
  currentPage = 0
  closeDateFilter()
  updateFilterIndicator()
  renderTable()
  updateTotals()
  renderCurrentStats()
}

/**
 * Сбрасывает фильтр по дате (очищает from/to) и перерисовывает таблицу.
 *
 * @returns {void}
 */
function resetDateFilter() {
  dateFilter.from = ''
  dateFilter.to = ''
  drpUpdateDisplay()
  currentPage = 0
  closeDateFilter()
  updateFilterIndicator()
  renderTable()
  updateTotals()
  renderCurrentStats()
}

/**
 * Показывает или скрывает индикатор активного фильтра (#dateFilterBadge).
 *
 * @returns {void}
 */
function updateFilterIndicator() {
  const badge = document.getElementById('dateFilterBadge')
  if (!badge) return
  if (dateFilter.from || dateFilter.to) {
    badge.style.display = 'inline-block'
  } else {
    badge.style.display = 'none'
  }
}

// ───────────────────────────────────────────────────────────────────────────────

/**
 * Основная функция рендера таблицы заказов.
 * Получает отфильтрованные данные, сортирует, разбивает на страницы
 * и отрисовывает строки в #tableBody.
 * Пропускает рендер если включён realtimeMode.
 *
 * @returns {void}
 */
function renderTable() {
  // Пропускаем если в realtime режиме - строки добавляются отдельно
  if (realtimeMode) {
    return
  }

  const tbody = document.getElementById('tableBody')
  if (!tbody) return
  tbody.innerHTML = ''

  const filtered = getFilteredData()
  const sorted = getSortedOrders(filtered)
  console.log('Rendering table, orders count:', sorted.length, '(filtered from', filtered.length, ')')
  const start = currentPage * PAGE_SIZE
  const end = start + PAGE_SIZE
  const pageOrders = sorted.slice(start, end)
  updateFilterIndicator()

  // mismatch filter banner
  if (mismatchFilterOrders) {
    const banner = document.createElement('div')
    banner.className = 'mismatch-filter-banner'
    banner.innerHTML = '<span>Показано <strong>' + filtered.length + '</strong> заказов по фильтру расхождений</span>' +
      '<button onclick="clearMismatchFilter()" class="btn-small">✕ Сбросить</button>'
    const tableContainer = document.getElementById('tableContainer')
    if (tableContainer) tableContainer.insertBefore(banner, tableContainer.firstChild)
  }

  if (pageOrders.length === 0) {
    tbody.innerHTML = '<tr><td colspan="11" class="empty">Нет данных для текущей страницы</td></tr>'
    return
  }

  pageOrders.forEach((order, i) => {
    const tr = document.createElement('tr')
    // Используем индекс внутри всей таблицы
    const actualIndex = ordersData.findIndex((o) => o.shipmentNum === order.shipmentNum)

    // Номера документов и суммы
    const demandDisplay = order.demandName
      ? `<span class="doc-number">${order.demandName}</span>`
      : '<span class="status-no">—</span>'
    const paymentDisplay = order.paid
      ? `<span class="payment-sum">${order.paid} ₽</span>`
      : '<span class="status-no">—</span>'
    // Return column: MS return status (top) + Ozon return sum (bottom, smaller)
    let returnDisplay = ''
    if (order.hasReturn) {
      returnDisplay += `<span class="payment-sum">${order.returnSum} ₽</span>`
    } else {
      returnDisplay += '<span class="status-no">—</span>'
    }
    if (order.ozonReturnInfo && order.returnSum) {
      returnDisplay += `<br><span class="payment-sum" style="font-size:0.85em">${order.returnSum} ₽ (Ozon)</span>`
    }
    if (order.wbReturnInfo && order.returnSum) {
      returnDisplay += `<br><span class="payment-sum" style="font-size:0.85em">${order.returnSum} ₽ (WB)</span>`
    }

    // Статус документа - показываем directly из API statusName
    let statusDisplay = ''
    const statusName = order.statusName || ''
    const status = order.status || ''

    // Просто показываем статус из API
    let cssClass = 'status-no'
    if (status === 'return' || statusName.includes('Возврат')) cssClass = 'status-return'
    else if (status === 'cancelled' || statusName.includes('Отмен')) cssClass = 'status-error'
    else if (status === 'shipped' || statusName.includes('Оплач') || statusName.includes('Отгруж') || statusName.includes('Доставлен'))
      cssClass = 'status-shipped'
    else if (status === 'delayed' || statusName.includes('отсрочк')) cssClass = 'status-delayed'

    // Подсвечивать строку красным при ошибке
    if (order.lastAction && order.lastAction.includes('_error')) {
      cssClass = 'status-error'
      tr.classList.add('row-error')
    }

    // Визуальное отличие для заказов найденных по точному номеру заказа МС
    if (order.foundBy === 'name') {
      tr.classList.add('row-by-name')
    }

    const displayText = statusName || 'Новый'
    statusDisplay = '<span class="' + cssClass + '">' + displayText + '</span>'
    const ozonReturnLine = order.ozonReturnInfo
      ? `<br><span class="status-return" style="font-size:0.85em">${order.ozonReturnInfo}</span>`
      : ''
    const ozonStatusLine = order.ozonStatus
      ? `<br><span style="font-size:0.85em;${order.ozonStatus === 'Доставлен' ? 'color:var(--success)' : order.ozonStatus === 'Доставлен → Возврат' ? 'color:var(--warning)' : 'color:var(--text-muted)'}">${order.ozonStatus} (Ozon)</span>`
      : ''
    const wbLine = order.wbReturnInfo
      ? `<br><span class="status-return" style="font-size:0.85em">${order.wbReturnInfo}</span>`
      : ''

    const storeDisplay = order.storeName
      ? `<span>${esc(order.storeName)}</span>`
      : '<span class="status-no">—</span>'

    // Статус заказа
    let statusClass = 'status-other'
    let statusText = order.statusName || 'Новый'
    if (order.status === 'shipped') {
      statusClass = 'status-shipped'
      statusText = 'Отгружен'
    } else if (order.status === 'delayed') {
      statusClass = 'status-delayed'
      statusText = 'С отсрочкой'
    } else if (order.hasReturn) {
      statusClass = 'status-return'
      statusText = 'Возврат'
    } else if (order.isCancelled) {
      statusClass = 'status-error'
      statusText = 'Отменён'
    } else if (order.status === 'cancelled') {
      statusClass = 'status-error'
      statusText = 'Отменён'
    } else if (order.statusName && order.statusName.includes('Отмен')) {
      statusClass = 'status-error'
      statusText = 'Отменён'
    } else if (order.statusName && order.statusName.includes('Возврат')) {
      statusClass = 'status-return'
      statusText = 'Возврат'
    }

    // Sub-elements for № column
    let numSub = ''
    if (order.barcode) {
      numSub = `<br><span style="font-size:0.85em">Ozon: ${esc(order.barcode)}</span>`
    } else if (order.wbStickerId) {
      numSub = `<br><span style="font-size:0.85em">Стикер: ${esc(order.wbStickerId)}</span>`
    }

    tr.innerHTML = `
        <td><input type="checkbox" ${order.enabled ? 'checked' : ''} onchange="toggleEnabled(${actualIndex}, this)"></td>
        <td class="order-num">${esc(order.extractedShipmentNum || order.shipmentNum)}${numSub}</td>
        <td class="order-name-cell">${esc(order.orderName || '—')}</td>
            <td>${esc(order.sum)} ₽${order.wbForPay > 0 ? `<br><span class="price-wb">К выплате: ${esc(Number(order.wbForPay).toLocaleString('ru-RU'))} ₽</span>` : ''}</td>
            <td>${demandDisplay}</td>
            <td>${paymentDisplay}</td>
            <td>${returnDisplay}</td>
            <td>${statusDisplay}${ozonStatusLine}${ozonReturnLine}${wbLine}</td>
<td>${storeDisplay}</td>
            <td class="date-cell">${formatDate(order.orderMoment)}</td>
            <td class="action-cell">${getRowActions(order, actualIndex)}</td>
        `
    
    // Сохраняем srid и lastChangeDate как data-атрибуты для отладки
    if (order.srid) tr.dataset.srid = order.srid
    if (order.lastChangeDate) tr.dataset.lastChangeDate = order.lastChangeDate

    // Подсветка брака
    if (order.returnType === 'Брак') {
      tr.classList.add('row-defect')
    }

    tbody.appendChild(tr)

    // Дополнительная секция с деталями позиций заказа
    const orderPos = order.orderPositions || []
    const demandPos = order.demandPositions || []
    const allPositions = [...orderPos, ...demandPos]

    if (allPositions.length > 0) {
      const posTr = document.createElement('tr')
      posTr.className = 'positions-row'
      const cells =
      '<td colspan="11" class="positions-cell">' +
        allPositions
          .map((p) => {
            const safeCode = esc(p.code || '')
            const code = p.code
              ? `<a href="#" onclick="searchProductByOEM('${(p.code || '').replace(/'/g, '\\\'')}');return false;" style="color:var(--accent);text-decoration:underline;cursor:pointer;">[${safeCode}]</a> `
              : ''
            const name = esc(p.name || 'Наименование')
            const price = p.price != null ? p.price : 0
            const qty = p.quantity != null ? p.quantity : 0
            const sum = p.sum != null ? p.sum : price * qty
            const printBtn = p.code
              ? `<button class="print-btn" onclick="printSticker('${(p.code || '').replace(/'/g, '\\\'')}')" title="Печать стикера">🖨️</button>`
              : ''
            return `<div>${code}${name} — ${price} ₽ × ${qty} = ${sum} ₽ ${printBtn}</div>`
          })
          .join('') +
        '</td>'
      posTr.innerHTML = cells
      tbody.appendChild(posTr)
    }
  })

  renderPaginationInfo(sorted.length)
}

/**
 * Добавляет одну строку в таблицу (append mode для realtime/SSE).
 * Создаёт DOM-элемент tr с анимацией fadeInDown и вставляет в #tableBody.
 *
 * @param {Object} order - Данные заказа для отображения
 * @returns {void}
 */
function appendOrderRow(order) {
  const tbody = document.getElementById('tableBody')
  if (!tbody) {
    console.error('tableBody not found!')
    return
  }
  const actualIndex = ordersData.findIndex((o) => o.shipmentNum === order.shipmentNum)

  const tr = document.createElement('tr')
  tr.className = 'fadeInDown' // Магическая анимация из библиотеки
  // Явно устанавливаем анимацию для гарантии применения
  tr.style.animation = 'fadeInDown 0.3s ease-out forwards'
  tr.style.webkitAnimation = 'fadeInDown 0.3s ease-out forwards'

  // Статус
  const statusName = order.statusName || ''
  const status = order.status || ''
  let cssClass = 'status-no'
  if (status === 'return' || statusName.includes('Возврат')) cssClass = 'status-return'
  else if (status === 'cancelled' || statusName.includes('Отмен')) cssClass = 'status-error'
  else if (status === 'shipped' || statusName.includes('Оплач') || statusName.includes('Отгруж') || statusName.includes('Доставлен'))
    cssClass = 'status-shipped'
  else if (status === 'delayed' || statusName.includes('отсрочк')) cssClass = 'status-delayed'

  const demandDisplay = order.demandName
    ? `<span class="demand-code">${order.demandName}</span>`
    : '<span class="status-no">—</span>'
  const paymentDisplay = order.paid
    ? `<span class="payment-sum">${order.paid} ₽</span>`
    : '<span class="status-no">—</span>'
  // Return column: MS return status (top) + marketplace return sums (bottom, smaller)
  let returnDisplay = ''
  if (order.hasReturn) {
    returnDisplay += `<span class="payment-sum">${order.returnSum} ₽</span>`
  } else {
    returnDisplay += '<span class="status-no">—</span>'
  }
  if (order.ozonReturnInfo && order.returnSum) {
    returnDisplay += `<br><span class="payment-sum" style="font-size:0.85em">${order.returnSum} ₽ (Ozon)</span>`
  }
  if (order.wbReturnInfo && order.returnSum) {
    returnDisplay += `<br><span class="payment-sum" style="font-size:0.85em">${order.returnSum} ₽ (WB)</span>`
  }
  const displayText = statusName || 'Новый'
  const statusDisplay = '<span class="' + cssClass + '">' + displayText + '</span>'
  const ozonReturnLine = order.ozonReturnInfo
    ? `<br><span class="status-return" style="font-size:0.85em">${order.ozonReturnInfo}</span>`
    : ''
  const ozonStatusLine = order.ozonStatus
    ? `<br><span style="font-size:0.85em;${order.ozonStatus === 'Доставлен' ? 'color:var(--success)' : order.ozonStatus === 'Доставлен → Возврат' ? 'color:var(--warning)' : 'color:var(--text-muted)'}">${order.ozonStatus} (Ozon)</span>`
    : ''
  const wbLine = order.wbReturnInfo
    ? `<br><span class="status-return" style="font-size:0.85em">${order.wbReturnInfo}</span>`
    : ''

  const storeDisplay = order.storeName
    ? `<span>${esc(order.storeName)}</span>`
    : '<span class="status-no">—</span>'

  // WB article display (если есть — показываем рядом с orderName)
  const wbArticleDisplay = order.wbArticle
    ? `<span class="wb-badge" title="Артикул WB">WB: ${order.wbArticle}</span>`
    : ''
  const wbSubjectDisplay = order.wbSubjectName
    ? `<br><span class="wb-subject">${order.wbSubjectName}</span>`
    : ''
  const wbStatusDisplay = order.wbStatus
    ? `<span class="wb-status">[${order.wbStatus}]</span>`
    : ''

  // Дата: используем wbCompletedDt/wbOrderDt если нет orderMoment
  const displayDate = order.orderMoment || order.wbCompletedDt || order.wbOrderDt || ''

  // Sub-elements for № column
  let numSub = ''
  if (order.barcode) {
    numSub = `<br><span style="font-size:0.85em">Ozon: ${esc(order.barcode)}</span>`
  } else if (order.wbStickerId) {
    numSub = `<br><span style="font-size:0.85em">Стикер: ${esc(order.wbStickerId)}</span>`
  }

  tr.innerHTML = `
        <td><input type="checkbox" ${order.enabled ? 'checked' : ''} onchange="toggleEnabled(${actualIndex}, this)"></td>
        <td class="order-num">${esc(order.extractedShipmentNum || order.shipmentNum)}${numSub}</td>
        <td class="order-name-cell">${esc(order.orderName || '—')} ${wbArticleDisplay} ${wbStatusDisplay}${wbSubjectDisplay}</td>
        <td>${esc(order.sum)} ₽</td>
        <td>${demandDisplay}</td>
        <td>${paymentDisplay}</td>
        <td>${returnDisplay}</td>
        <td>${statusDisplay}${ozonStatusLine}${ozonReturnLine}${wbLine}</td>
        <td>${storeDisplay}</td>
        <td class="date-cell">${formatDate(displayDate)}</td>
        <td class="action-cell">${getRowActions(order, actualIndex)}</td>
    `

  // Сохраняем WB поля как data-атрибуты
  if (order.srid) tr.dataset.srid = order.srid
  if (order.lastChangeDate) tr.dataset.lastChangeDate = order.lastChangeDate
  if (order.wbStickerId) tr.dataset.wbStickerId = order.wbStickerId
  if (order.wbArticle) tr.dataset.wbArticle = order.wbArticle
  if (order.wbBarcode) tr.dataset.wbBarcode = order.wbBarcode

  // Подсветка брака
  if (order.returnType === 'Брак') {
    tr.classList.add('row-defect')
  }

  // Добавляем строку в конец таблицы
  tbody.appendChild(tr)

  // Дополнительная секция с деталями позиций заказа (для SSE режима)
  const orderPos = order.orderPositions || []
  const demandPos = order.demandPositions || []
  const allPositions = [...orderPos, ...demandPos]

  if (allPositions.length > 0) {
    const posTr = document.createElement('tr')
    posTr.className = 'positions-row'
    const cells =
      '<td colspan="12" class="positions-cell">' +
      allPositions
        .map((p) => {
          const safeCode = esc(p.code || '')
          const code = p.code
            ? `<a href="#" onclick="searchProductByOEM('${(p.code || '').replace(/'/g, '\\\'')}');return false;" style="color:var(--accent);text-decoration:underline;cursor:pointer;">[${safeCode}]</a> `
            : ''
          const name = esc(p.name || 'Наименование')
          const price = p.price != null ? p.price : 0
          const qty = p.quantity != null ? p.quantity : 0
          const sum = p.sum != null ? p.sum : price * qty
          const printBtn = p.code
            ? `<button class="print-btn" onclick="printSticker('${(p.code || '').replace(/'/g, '\\\'')}')" title="Печать стикера">🖨️</button>`
            : ''
          return `<div>${code}${name} — ${price} ₽ × ${qty} = ${sum} ₽ ${printBtn}</div>`
        })
        .join('') +
      '</td>'
    posTr.innerHTML = cells
    tbody.appendChild(posTr)
  }
}

/**
 * Отображает информацию о пагинации (текущая страница / всего страниц).
 * Скрывает пагинацию если записей меньше PAGE_SIZE.
 *
 * @param {number} total - Общее количество отфильтрованных заказов
 * @returns {void}
 */
function renderPaginationInfo(total) {
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const info = document.getElementById('pageInfo')
  const controls = document.getElementById('paginationControls')
  // Не показывать пагинацию если записей меньше чем PAGE_SIZE
  if (total <= PAGE_SIZE) {
    if (controls) controls.style.display = 'none'
    return
  }
  if (info) info.textContent = `Страница ${currentPage + 1} из ${totalPages}`
  if (controls) controls.style.display = 'block'
}

/**
 * Переключает на предыдущую страницу таблицы.
 *
 * @returns {void}
 */
function goPrevPage() {
  if (currentPage > 0) {
    currentPage--
    renderTable()
  }
}

/**
 * Переключает на следующую страницу таблицы.
 *
 * @returns {void}
 */
function goNextPage() {
  const totalPages = Math.max(1, Math.ceil(ordersData.length / PAGE_SIZE))
  if (currentPage < totalPages - 1) {
    currentPage++
    renderTable()
  }
}

/**
 * Обновляет отображение суммы и количества отмеченных заказов.
 * Выводит общее количество, количество к созданию и общую сумму.
 *
 * @param {boolean} [skipRender=false] - Если true, не перерисовывает таблицу
 * @returns {void}
 */
function updateTotals(skipRender = false) {
  const filtered = getFilteredData()
  const enabled = filtered.filter((o) => o.enabled)
  const toCreate = enabled.filter((o) => o.hasDemand && !o.hasPayment).length
  const totalSum = enabled.reduce((sum, o) => sum + (Number(o.sum) || 0), 0)

  const totalCountEl = document.getElementById('totalCount')
  const toCreateCountEl = document.getElementById('toCreateCount')
  const totalSumEl = document.getElementById('totalSum')

  if (totalCountEl) totalCountEl.textContent = enabled.length
  if (toCreateCountEl) toCreateCountEl.textContent = toCreate
  if (totalSumEl) totalSumEl.textContent = totalSum.toLocaleString() + ' ₽'

  // Не перерисовываем таблицу в realtime режиме или при skipRender
  if (!skipRender && !realtimeMode) renderTable()
}

/**
 * Рассчитывает статистику по заказам: количество и сумму отгрузок,
 * платежей, возвратов, отмен, ошибок. Также считает WB выплаты/возвраты
 * и три варианта комбинированного подсчёта (A/B/C).
 *
 * @param {Array<Object>} [orderList] - Список заказов. По умолч. ordersData
 * @returns {Object} Объект со статистикой (demandCount, paymentSum, returnSum, ...)
 */
function calculateStats(orderList) {
  const list = (orderList || ordersData).filter((o) => o.enabled)
  // Не перерисовываем таблицу тут - только считаем статистику
  const stats = {
    total: list.length,
    demandCount: 0,
    demandSum: 0,
    paymentCount: 0,
    paymentSum: 0,
    returnCount: 0,
    returnSum: 0,
    cancelledCount: 0,
    cancelledSum: 0,
    errorCount: 0,
    errorSum: 0,
    notFoundCount: 0,

    // WB выплаты (продажи) и возвраты
    wbPayoutCount: 0,
    wbPayoutSum: 0,
    wbReturnCount: 0,
    wbReturnSum: 0,

    // Вариант A: Раздельный подсчёт (оба могут быть)
    returnCount_A: 0,
    returnSum_A: 0,
    cancelledCount_A: 0,
    cancelledSum_A: 0,

    // Вариант B: Return приоритет
    returnCount_B: 0,
    returnSum_B: 0,
    cancelledCount_B: 0,
    cancelledSum_B: 0,

    // Вариант C: Отмена приоритет
    returnCount_C: 0,
    returnSum_C: 0,
    cancelledCount_C: 0,
    cancelledSum_C: 0
  }

  list.forEach((o) => {
    const sum = Number(o.sum) || 0
    if (o.hasDemand) {
      stats.demandCount++
      stats.demandSum += sum
    }
    if (o.paid > 0) {
      stats.paymentCount++
      stats.paymentSum += o.paid || 0
    }
    if (o.hasReturn) {
      stats.returnCount++
      // Используем только фактическую сумму возврата, без fallback на всю сумму заказа
      stats.returnSum += Number(o.returnSum) || 0
    } else if (o.isCancelled) {
      // Если есть возврат — не дублируем в отменах (иначе сумма заказа считается дважды)
      stats.cancelledCount++
      // Используем сумму отмены (если есть), иначе всю сумму заказа
      stats.cancelledSum += Number(o.cancelledSum) || sum
    }
    if (o.lastAction && o.lastAction.includes('_error')) {
      stats.errorCount++
      stats.errorSum += sum
    }
    if (o.status === 'not_found' || o.statusName === 'Не найден') {
      stats.notFoundCount++
    }

    // WB: выплаты (продажи) и возвраты
    const wbAmount = Number(o.wbForPay) || 0
    if (wbAmount > 0) {
      if (o.returnType) {
        stats.wbReturnCount++
        stats.wbReturnSum += wbAmount
      } else {
        stats.wbPayoutCount++
        stats.wbPayoutSum += wbAmount
      }
    }

    // Вариант A: Раздельный (oba mogut byt true)
    if (o.hasReturn) {
      stats.returnCount_A++
      stats.returnSum_A += Number(o.returnSum) || 0
    }
    if (o.isCancelled) {
      stats.cancelledCount_A++
      stats.cancelledSum_A += Number(o.cancelledSum) || sum
    }

    // Вариант B: Return имеет приоритет
    if (o.hasReturn) {
      stats.returnCount_B++
      stats.returnSum_B += Number(o.returnSum) || 0
    } else if (o.isCancelled) {
      stats.cancelledCount_B++
      stats.cancelledSum_B += Number(o.cancelledSum) || sum
    }

    // Вариант C: Отмена имеет приоритет
    if (o.isCancelled) {
      stats.cancelledCount_C++
      stats.cancelledSum_C += Number(o.cancelledSum) || sum
    } else if (o.hasReturn) {
      stats.returnCount_C++
      stats.returnSum_C += Number(o.returnSum) || 0
    }
  })

  return stats
}

/**
 * Рассчитывает расхождения между маркетплейсами и МойСклад.
 * Проверяет: возвраты на площадке без возврата в МС, возвраты в МС без площадки,
 * финансовые расхождения сумм возврата.
 *
 * @param {Array<Object>} [orderList] - Список заказов. По умолч. ordersData
 * @returns {Object} Объект с расхождениями (marketplaceReturnNoMs, msReturnNoMarketplace, ...)
 */
function calculateMismatches(orderList) {
  const list = (orderList || ordersData).filter(o => o.enabled)
  
  const result = {
    wbCount: 0,
    ozonCount: 0,
    marketplaceReturnNoMs: 0,
    marketplaceReturnNoMsOrders: [],
    msReturnNoMarketplace: 0,
    msReturnNoMarketplaceOrders: [],
    financialMismatchCount: 0,
    financialMismatchOrders: [],
    totalMismatches: 0
  }
  
  list.forEach(o => {
    const hasMarketplaceReturn = !!(o.wbReturnInfo || o.ozonReturnInfo)
    
    if (o.wbArticle || o.srid || o.wbStickerId) result.wbCount++
    if (o.offerId || o.ozonStatus) result.ozonCount++
    
    if (hasMarketplaceReturn && !o.hasReturn) {
      result.marketplaceReturnNoMs++
      if (o.shipmentNum) result.marketplaceReturnNoMsOrders.push(o.shipmentNum)
      result.totalMismatches++
    }
    
    if (o.hasReturn && !hasMarketplaceReturn) {
      result.msReturnNoMarketplace++
      if (o.shipmentNum) result.msReturnNoMarketplaceOrders.push(o.shipmentNum)
      result.totalMismatches++
    }
    
    // Financial mismatch: msReturnSum vs marketplaceReturnPrice
    const msRS = o.msReturnSum || 0
    const mpRP = o.marketplaceReturnPrice || 0
    if (msRS > 0 && mpRP > 0 && Math.abs(msRS - mpRP) > 1) {
      result.financialMismatchCount++
      if (o.shipmentNum) result.financialMismatchOrders.push(o.shipmentNum)
      result.totalMismatches++
    }
  })
  
  return result
}

/**
 * Отображает блок контроля статусов (расхождения) в правой колонке.
 * Показывает количество заказов WB/Ozon, расхождения возвратов.
 * Кликабельные строки фильтруют таблицу по выбранному расхождению.
 *
 * @returns {void}
 */
function renderMismatchStats() {
  const el = document.getElementById('mismatchOutput')
  if (!el) return
  
  mismatchData = calculateMismatches()
  const s = mismatchData
  const hasMismatches = s.totalMismatches > 0
  
  let html = '<div class="mismatch-body">'
  
  html += `<div class="stat-row">
    <span class="stat-label">Заказы WB:</span>
    <span class="stat-value">${s.wbCount}</span>
  </div>`
  html += `<div class="stat-row">
    <span class="stat-label">Заказы Ozon:</span>
    <span class="stat-value">${s.ozonCount}</span>
  </div>`
  
  html += '<div class="mismatch-separator"></div>'
  
  if (hasMismatches) {
    const mpOrdersAttr = encodeURIComponent(JSON.stringify(s.marketplaceReturnNoMsOrders))
    html += `<div class="stat-row mismatch-error" data-mismatch-type="mp-return-no-ms" data-orders="${mpOrdersAttr}">
      <span class="stat-label">↳ Возврат на площадке, нет в МС:</span>
      <span class="stat-value">${s.marketplaceReturnNoMs}</span>
    </div>`
    
    const msOrdersAttr = encodeURIComponent(JSON.stringify(s.msReturnNoMarketplaceOrders))
    html += `<div class="stat-row mismatch-warn" data-mismatch-type="ms-return-no-mp" data-orders="${msOrdersAttr}">
      <span class="stat-label">↳ Возврат в МС, нет на площадке:</span>
      <span class="stat-value">${s.msReturnNoMarketplace}</span>
    </div>`
    
    if (s.financialMismatchCount > 0) {
      const finOrdersAttr = encodeURIComponent(JSON.stringify(s.financialMismatchOrders))
      html += `<div class="stat-row mismatch-error" data-mismatch-type="financial" data-orders="${finOrdersAttr}">
        <span class="stat-label">↳ Сумма возврата не совпадает:</span>
        <span class="stat-value">${s.financialMismatchCount}</span>
      </div>`
    }
  } else {
    html += `<div class="stat-row">
      <span class="stat-value mismatch-ok-text">✓ Нет расхождений</span>
    </div>`
  }
  
  html += '</div>'
  el.innerHTML = html
}

/**
 * Инициализирует обработчик кликов по строкам блока расхождений.
 * При клике на строку расхождения — фильтрует таблицу по связанным заказам.
 *
 * @returns {void}
 */
function initMismatchClickHandler() {
  const container = document.getElementById('mismatchOutput')
  if (!container) return
  
  container.addEventListener('click', function(e) {
    const row = e.target.closest('[data-mismatch-type]')
    if (!row) return
    
    const type = row.dataset.mismatchType
    const ordersAttr = row.dataset.orders
    let orders = []
    
    if (ordersAttr) {
      try {
        orders = JSON.parse(decodeURIComponent(ordersAttr))
      } catch (err) {
        console.warn('mismatch: failed to parse orders attr', err)
      }
    }
    
    if (orders.length === 0) return
    
    const sameFilter = mismatchFilterOrders &&
      mismatchFilterOrders.length === orders.length &&
      mismatchFilterOrders.every((v, i) => v === orders[i])
    
    if (sameFilter) {
      mismatchFilterOrders = null
    } else {
      mismatchFilterOrders = orders
    }
    
    renderTable()
    highlightMismatchFilter(type)
  })
}

/**
 * Подсвечивает активный фильтр расхождений (обводка).
 *
 * @param {string|null} activeType - Тип активного расхождения или null
 * @returns {void}
 */
function highlightMismatchFilter(activeType) {
  document.querySelectorAll('#mismatchOutput [data-mismatch-type]').forEach(el => {
    el.style.outline = el.dataset.mismatchType === activeType && mismatchFilterOrders
      ? '1px solid var(--accent)'
      : 'none'
  })
}

/**
 * Сбрасывает фильтр расхождений и перерисовывает таблицу.
 *
 * @returns {void}
 */
function clearMismatchFilter() {
  mismatchFilterOrders = null
  highlightMismatchFilter(null)
  renderTable()
}

/**
 * Отображает текущую статистику (выполненные/оставшиеся действия)
 * в правой колонке, включая калькулятор сумм.
 * При force=true обновляет даже в realtime режиме.
 *
 * @param {boolean} [force=false] - Принудительное обновление в realtime
 * @returns {void}
 */
function renderCurrentStats(force = false) {
  // Не перерисовываем таблицу в realtime режиме (кроме случая force)
  if (realtimeMode && !force) return

  try {
    const stats = calculateStats(getFilteredData())
    const container = document.getElementById('statsOutput')
    if (!container) {
      return
    }

    const fmt = (n) => n.toLocaleString()
    const fmtSum = (n) => (n && n > 0 ? fmt(n) + ' ₽' : '-')
    // Для Возвратов - всегда показывать сумму (без прочерка)
    const fmtReturnSum = (n) => (n ? fmt(n) + ' ₽' : '-')

    const demandSum = stats.demandSum || 0
    const returnSum = stats.returnSum || 0
    const cancelledSum = stats.cancelledSum || 0
    const paymentSum = stats.paymentSum || 0
    const errorSum = stats.errorSum || 0
    const wbPayoutSum = stats.wbPayoutSum || 0
    const wbReturnSum = stats.wbReturnSum || 0

    const totalAccounted = paymentSum + returnSum + cancelledSum + errorSum
    const isMatch = Math.abs(demandSum - totalAccounted) < 1
    const matchIcon = isMatch ? '✓' : '✗'
    const matchClass = isMatch ? 'success' : 'error'

    container.innerHTML = `
            <div class="stat-row"><span class="stat-label">Отгрузок:</span><span class="stat-value success">${stats.demandCount || 0}</span><span class="stat-sum">${fmtSum(demandSum)}</span></div>
            <div class="stat-row"><span class="stat-label">Оплачено:</span><span class="stat-value success">${stats.paymentCount || 0}</span><span class="stat-sum">${fmtSum(paymentSum)}</span></div>
            <div class="stat-row"><span class="stat-label">Возвраты:</span><span class="stat-value">${stats.returnCount || 0}</span><span class="stat-sum">${fmtSum(returnSum)}</span></div>
            <div class="stat-row"><span class="stat-label">Отмены:</span><span class="stat-value">${stats.cancelledCount || 0}</span><span class="stat-sum">${fmtSum(cancelledSum)}</span></div>
            <div class="stat-row"><span class="stat-label">Ошибок:</span><span class="stat-value error">${stats.errorCount || 0}</span><span class="stat-sum">${fmtSum(errorSum)}</span></div>
            <div class="stat-row"><span class="stat-label">Не найден:</span><span class="stat-value">${stats.notFoundCount || 0}</span><span class="stat-sum">-</span></div>
            ${currentDuplicates > 0 ? `<div class="stat-row"><span class="stat-label">Дублей:</span><span class="stat-value duplicates">${currentDuplicates}</span><span class="stat-sum">-</span></div>` : ''}
            ${wbReturnSum > 0 ? `<div class="stat-row"><span class="stat-label">WB возврат:</span><span class="stat-value">${stats.wbReturnCount || 0}</span><span class="stat-sum wb-payout">${fmtSum(wbReturnSum)}</span></div>` : ''}
            ${wbPayoutSum > 0 ? `<div class="stat-row"><span class="stat-label">WB к выплате:</span><span class="stat-value">${stats.wbPayoutCount || 0}</span><span class="stat-sum wb-payout">${fmtSum(wbPayoutSum)}</span></div>` : ''}
            <div class="calculator">
                <div class="calc-divider"></div>
                <div class="calc-formula">
                    <span class="calc-sum">${fmtSum(paymentSum)}</span>
                    <span class="calc-op"> + </span>
                    <span class="calc-sum">${fmtSum(returnSum)}</span>
                    <span class="calc-op"> + </span>
                    <span class="calc-sum">${fmtSum(cancelledSum)}</span>
                    <span class="calc-op"> + </span>
                    <span class="calc-sum">${fmtSum(errorSum)}</span>
                </div>
                <div class="calc-formula">
                    <span class="calc-op">= </span>
                    <span class="calc-sum">${fmtSum(totalAccounted)}</span>
                    <span class="calc-op"> → </span>
                    <span class="calc-sum">${fmtSum(demandSum)}</span>
                    <span class="calc-icon ${matchClass}">${matchIcon}</span>
                </div>
                ${
  !isMatch
    ? `<div class="calc-formula">
                    <span class="calc-op">Разница: </span>
                    <span class="calc-sum">${fmtSum(Math.abs(demandSum - totalAccounted))} ₽</span>
                </div>`
    : ''
}
            </div>
        `
    // ── render mismatch stats ──
    renderMismatchStats()
  } catch (e) {
    // ignore render errors
  }
}

// Last action stats for comparison
let lastActionStats = null

// ─── Mismatch Control ─────────────────────────────────────────────
let mismatchData = null
let mismatchFilterOrders = null // null = no filter, array = shipmentNums to show

/**
 * Сохраняет текущую статистику как "до действия" для последующего сравнения.
 *
 * @returns {void}
 */
function saveLastActionStats() {
  lastActionStats = calculateStats()
}

/**
 * Отображает изменения статистики после выполненного действия
 * (сравнение "было → стало" для отгрузок, платежей, возвратов, отмен).
 *
 * @returns {void}
 */
function renderFinalStats() {
  const container = document.getElementById('statsFinalOutput')
  if (!container) return

  const now = calculateStats()
  const was = lastActionStats

  if (!was) {
    container.innerHTML = '<div class="stat-row"><span class="stat-label">Нет данных</span></div>'
    return
  }

  const fmt = (n) => n.toLocaleString()
  const fmtSum = (n) => (n && n > 0 ? fmt(n) + ' ₽' : '-')

  const diffCount = (label, wasVal, nowVal) => {
    const diffVal = nowVal - wasVal
    if (diffVal === 0) return ''
    const cls = diffVal > 0 ? 'success' : 'error'
    const arrow = diffVal > 0 ? '↑' : '↓'
    return `<div class="stat-row"><span class="stat-label">${label}:</span><span class="stat-value ${cls}">${fmt(wasVal)} → ${fmt(nowVal)} ${arrow}</span></div>`
  }

  const diffSum = (label, wasVal, nowVal) => {
    const diffVal = nowVal - wasVal
    if (diffVal === 0) return ''
    const cls = diffVal > 0 ? 'success' : 'error'
    const arrow = diffVal > 0 ? '↑' : '↓'
    return `<div class="stat-row"><span class="stat-label">${label}:</span><span class="stat-value ${cls}">${fmtSum(wasVal)} → ${fmtSum(nowVal)} ${arrow}</span></div>`
  }

  container.innerHTML = `
        <div class="stat-section-title">Изменения после действия:</div>
        ${diffCount('Отгрузок', was.demandCount, now.demandCount)}
        ${diffSum('Сумма отгрузок', was.demandSum, now.demandSum)}
        ${diffCount('Оплачено', was.paymentCount, now.paymentCount)}
        ${diffSum('Сумма оплат', was.paymentSum, now.paymentSum)}
        ${diffCount('Возвратов', was.returnCount, now.returnCount)}
        ${diffSum('Сумма возвратов', was.returnSum, now.returnSum)}
        ${diffCount('Отменено', was.cancelledCount, now.cancelledCount)}
        ${diffSum('Сумма отмен', was.cancelledSum, now.cancelledSum)}
    `
}

// Single order actions — передаём orderId (MC UUID из уже выполненного поиска)
/**
 * Создаёт платеж для заказа по номеру отгрузки.
 * Находит заказ в ordersData и делегирует createSingleAction.
 *
 * @async
 * @param {string} shipmentNum - Номер заказа
 * @returns {Promise<void>}
 */
async function createPaymentByNum(shipmentNum) {
  const order = ordersData.find(o => o.shipmentNum === shipmentNum)
  await createSingleAction(shipmentNum, 'payment', order?.orderId)
}

/**
 * Создаёт отгрузку для заказа по номеру отгрузки.
 *
 * @async
 * @param {string} shipmentNum - Номер заказа
 * @returns {Promise<void>}
 */
async function createDemandByNum(shipmentNum) {
  const order = ordersData.find(o => o.shipmentNum === shipmentNum)
  await createSingleAction(shipmentNum, 'demand', order?.orderId)
}

/**
 * Создаёт возврат для заказа по номеру отгрузки.
 *
 * @async
 * @param {string} shipmentNum - Номер заказа
 * @returns {Promise<void>}
 */
async function createReturnByNum(shipmentNum) {
  const order = ordersData.find(o => o.shipmentNum === shipmentNum)
  await createSingleAction(shipmentNum, 'return', order?.orderId)
}

/**
 * Отменяет заказ по номеру отгрузки.
 *
 * @async
 * @param {string} shipmentNum - Номер заказа
 * @returns {Promise<void>}
 */
async function cancelOrderByNum(shipmentNum) {
  const order = ordersData.find(o => o.shipmentNum === shipmentNum)
  await createSingleAction(shipmentNum, 'cancel', order?.orderId)
}

/**
 * Создаёт частичный платёж для заказа (если есть частичный возврат).
 *
 * @async
 * @param {string} shipmentNum - Номер заказа
 * @returns {Promise<void>}
 */
async function createPartialPaymentByNum(shipmentNum) {
  const order = ordersData.find(o => o.shipmentNum === shipmentNum)
  await createSingleAction(shipmentNum, 'partial_payment', order?.orderId)
}

/**
 * Печатает стикер для товара по коду (через API МойСклад).
 * Открывает PDF в новом окне или скачивает через blob URL.
 * Показывает таймер ожидания в блоке "После действий".
 *
 * @async
 * @param {string} code - Код товара в МойСклад
 * @returns {Promise<void>}
 */
async function printSticker(code) {
  const token = loadToken()
  if (!token) {
    showStatus('Ошибка: Токен не найден. Нажмите "Токены" в шапке.')
    return
  }

  // Show timer in "After action stats" block
  const statsOutput = document.getElementById('statsFinalOutput')
  const statsFinal = document.querySelector('.stats-final')
  if (statsOutput && statsFinal) {
    statsFinal.classList.remove('idle')
    statsOutput.innerHTML = `
      <div class="terminal-line info">Генерация PDF стикера...</div>
      <div class="terminal-line time-line">Время: <span id="pdfTimer">0:00</span></div>
      <div class="terminal-status">
        <div class="terminal-status-dot pulse"></div>
        <span>Ожидание МойСклад</span>
      </div>
    `

    // Start timer
    let seconds = 0
    const timerInterval = setInterval(() => {
      seconds++
      const minutes = Math.floor(seconds / 60)
      const secs = seconds % 60
      const timerEl = document.getElementById('pdfTimer')
      if (timerEl) {
        timerEl.textContent = `${minutes}:${secs < 10 ? '0' : ''}${secs}`
      }
    }, 1000)

    try {
      const response = await fetch('/api/print-sticker', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Token': token
        },
        body: JSON.stringify({ code })
      })

      clearInterval(timerInterval)

      // Check response type
      const contentType = response.headers.get('content-type') || ''

      if (contentType.includes('application/pdf')) {
        // Server returned PDF directly - create blob URL and open
        const blob = await response.blob()
        const pdfUrl = URL.createObjectURL(blob)
        window.open(pdfUrl, '_blank')

        // Clean up blob URL after some time
        setTimeout(() => URL.revokeObjectURL(pdfUrl), 60000)

        statsOutput.innerHTML = `
          <div class="terminal-line success">PDF стикера готов</div>
          <div class="terminal-line">Открыт в новом окне</div>
        `
        setTimeout(() => {
          statsFinal.classList.add('idle')
        }, 3000)
      } else {
        // Server returned JSON
        const data = await response.json()

        if (data.pdfUrl) {
          // Open PDF in new tab - MoySklad generates and hosts the file
          window.open(data.pdfUrl, '_blank')
          statsOutput.innerHTML = `
            <div class="terminal-line success">PDF стикера готов</div>
            <div class="terminal-line">Открыт в новом окне</div>
          `
          setTimeout(() => {
            statsFinal.classList.add('idle')
          }, 3000)
        } else {
          console.error('Print error:', data.error)
          statsOutput.innerHTML = `
            <div class="terminal-line error">Ошибка: ${data.error}</div>
          `
        }
      }
    } catch (e) {
      clearInterval(timerInterval)
      console.error('Network error printing sticker:', e.message)
      statsOutput.innerHTML = `
        <div class="terminal-line error">Сетевая ошибка: ${e.message}</div>
      `
    }
  } else {
    // Fallback if elements not found
    try {
      const response = await fetch('/api/print-sticker', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Token': token
        },
        body: JSON.stringify({ code })
      })

      // Check response type
      const contentType = response.headers.get('content-type') || ''

      if (contentType.includes('application/pdf')) {
        // Server returned PDF directly
        const blob = await response.blob()
        const pdfUrl = URL.createObjectURL(blob)
        window.open(pdfUrl, '_blank')
        setTimeout(() => URL.revokeObjectURL(pdfUrl), 60000)
      } else {
        // Server returned JSON
        const data = await response.json()

        if (data.pdfUrl) {
          window.open(data.pdfUrl, '_blank')
        } else {
          console.error('Print error:', data.error)
        }
      }
    } catch (e) {
      console.error('Network error printing sticker:', e.message)
    }
  }
}

/**
 * Выполняет единичное действие над заказом (платёж/отгрузка/возврат/отмена).
 * Отправляет POST-запрос на соответствующий endpoint и обновляет состояние
 * заказа в ordersData и DOM.
 *
 * @async
 * @param {string} shipmentNum - Номер заказа
 * @param {string} actionType - Тип действия (demand, payment, return, cancel, partial_payment)
 * @param {string} [orderId] - UUID заказа в МойСклад (опционально)
 * @returns {Promise<void>}
 */
async function createSingleAction(shipmentNum, actionType, orderId) {
  const token = saveToken()
  if (!token) {
    alert('Введите токен API')
    return
  }

  showProgress(true)

  // Правильное маппирование endpoint-ов
  const endpointMap = {
    demand: '/api/create-demand',
    payment: '/api/create-payment',
    return: '/api/create-return',
    cancel: '/api/cancel-order',
    partial_payment: '/api/create-partial-payment'
  }
  const endpoint = endpointMap[actionType] || `/api/create-${actionType}`

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Token': token },
      body: JSON.stringify({ shipmentNum, orderId })
    })

    const data = await response.json()

    if (data.error) {
      hideProgress(false, 'Ошибка')
      await saveOrderAction(shipmentNum, `${actionType}_error`, data.error)
      alert('Ошибка: ' + data.error)
    } else {
      const successNames = {
        payment: 'Платёж',
        demand: 'Отгрузка',
        return: 'Возврат',
        cancel: 'Заказ'
      }
      const resultName = data.paymentName || data.demandName || data.returnName || 'успешно'
      hideProgress(true, `${successNames[actionType]} создан`)
      await saveOrderAction(shipmentNum, `${actionType}_created`, resultName)

      // Обновляем статус заказа прямо в таблице
      const orderIndex = ordersData.findIndex((o) => o.shipmentNum === shipmentNum)
      if (orderIndex !== -1) {
        if (actionType === 'payment') {
          ordersData[orderIndex].hasPayment = true
          ordersData[orderIndex].statusName = 'Оплачен'
          ordersData[orderIndex].paid = ordersData[orderIndex].sum
        } else if (actionType === 'demand') {
          ordersData[orderIndex].hasDemand = true
          ordersData[orderIndex].statusName = 'Отгрузка создана'
          saveOrderAction(data.shipmentNum, 'demand_created', data.demandName)
        } else if (actionType === 'return') {
          ordersData[orderIndex].hasReturn = true
          ordersData[orderIndex].statusName = 'Возврат'
          ordersData[orderIndex].returnSum = data.returnSum || 0
          saveOrderAction(data.shipmentNum, 'return_created', data.returnName, {
            returnSum: data.returnSum || 0
          })
        } else if (actionType === 'cancel') {
          ordersData[orderIndex].isCancelled = true
          ordersData[orderIndex].statusName = 'Отменён'
          // Сохраняем сумму отмены (вся сумма заказа)
          ordersData[orderIndex].cancelledSum = ordersData[orderIndex].sum || 0
          saveOrderAction(data.shipmentNum, 'order_cancelled', 'ok', {
            cancelledSum: ordersData[orderIndex].sum || 0
          })
        } else if (actionType === 'partial_payment') {
          ordersData[orderIndex].hasPayment = true
          ordersData[orderIndex].statusName = 'Частично оплачен'
          ordersData[orderIndex].paid =
            data.paymentSum || ordersData[orderIndex].sum - (ordersData[orderIndex].returnSum || 0)
          ordersData[orderIndex].paymentName = data.paymentName || null
          saveOrderAction(data.shipmentNum, 'partial_payment_created', data.paymentName, {
            returnSum: ordersData[orderIndex].returnSum || 0
          })
        }
        ordersData[orderIndex].lastAction = `${actionType}_created`

        renderTable()
        updateTotals()
        renderCurrentStats()
        renderFinalStats()
      }
    }
  } catch (e) {
    hideProgress(false, 'Ошибка: ' + e.message)
  }
}

/**
 * Обновляет данные конкретных заказов после массовой операции.
 * Подключается к SSE-потоку /api/process/stream и заменяет устаревшие
 * данные в ordersData свежими с сервера.
 *
 * @async
 * @param {string[]} numbers - Массив номеров заказов для обновления
 * @returns {Promise<void>}
 */
async function refreshSpecificOrders(numbers) {
  const token = loadToken()
  if (!token || numbers.length === 0) return

  const numbersParam = encodeURIComponent(numbers.join(','))
  const url = `/api/process/stream?token=${encodeURIComponent(token)}&numbers=${numbersParam}`

  try {
    const response = await fetch(url)
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const data = JSON.parse(line.slice(6))
            if (data.type === 'progress') {
              const order = data.order
              // Заменяем в ordersData СВЕЖИМИ данными
              const index = ordersData.findIndex((o) => o.shipmentNum === order.shipmentNum)
              if (index !== -1) {
                ordersData[index] = { ...ordersData[index], ...order, enabled: true }
              }
            }
          } catch (e) {}
        }
      }
    }

    // Перерисовываем с актуальными данными
    realtimeMode = false
    renderTable()
    updateTotals()
    renderCurrentStats()
  } catch (e) {
    console.error('Refresh error:', e)
  }
}

/**
 * Массовая операция с SSE streaming (создание отгрузок/платежей/возвратов/отмен).
 * Отправляет POST /api/batch/stream с checkData, обрабатывает прогресс в realtime.
 * Содержит цикл чтения SSE-событий с обновлением статусов и перерисовкой.
 *
 * @async
 * @param {string} actionType - Тип действия (demand, payment, return, cancel)
 * @returns {Promise<void>}
 */
async function batchAction(actionType) {
  const token = saveToken()
  if (!token) {
    alert('Введите токен API')
    return
  }

  const actionNames = {
    demand: 'отгрузки',
    payment: 'платежи',
    return: 'возвраты',
    cancel: 'отмены'
  }
  if (!(await showConfirm(`Создать ${actionNames[actionType]} для отмеченных?`))) return

  const filtered = getFilteredData()
  const orders = filtered.filter((o) => o.enabled)
  if (orders.length === 0) {
    alert('Нет отмеченных заказов')
    return
  }

  showProgress(true)
  const numbers = orders.map((o) => o.shipmentNum)

  // Запускаем секундомер и показываем блок
  hideFinalStats(true)
  startOperationTimer()

  // Добавляем анимацию сканирования
  document.querySelector('.stats-final').classList.add('scanning')

  // Очищаем таблицу и показываем строки в реальном времени
  const tbody = document.getElementById('tableBody')
  tbody.innerHTML = ''
  currentPage = 0

  // Включаем realtime режим
  realtimeMode = true

  try {
    // Создаём AbortController и AbortId для сервера
    currentController = new AbortController()
    const abortId = Math.random().toString(36).substring(2, 15)
    window.__currentAbortId = abortId

    // ── POST с checkData (результаты первого сканирования) ──
    // Раньше был GET /api/batch/stream?numbers=...&action=...&abortId=...
    // Сервер делал повторный re-check всех заказов (~4-5 API-запросов на заказ).
    // Теперь POST передаёт checkData — данные уже получены при "Сканировать",
    // сервер использует их напрямую, экономя ~8000-10000 запросов на 2000 заказов.
    // POST вместо GET выбран из-за большого объёма checkData (не влезает в URL).
    const body = {
      token,
      numbers,
      action: actionType,
      abortId,
      checkData: orders.map((o) => ({
        shipmentNum: o.shipmentNum,
        orderId: o.orderId,
        statusName: o.statusName,
        canPayment: o.canPayment ?? (o.hasDemand && !o.hasPayment && !o.isCancelled && (!o.hasReturn || (o.returnSum && o.returnSum < o.sum)) && !o.returnType),
        canDemand: o.canDemand ?? (!o.hasDemand && !o.isCancelled),
        canReturn: o.canReturn ?? (o.hasDemand && !o.hasReturn && !o.isCancelled),
        canCancel: o.canCancel ?? (!o.hasDemand && !o.isCancelled),
        demandName: o.demandName,
        orderName: o.orderName,
        sum: o.sum,
        paid: o.paid
      }))
    }
    const url = '/api/batch/stream'

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: currentController.signal
    })

    if (!response.ok) {
      const errData = await response.json()
      hideProgress(false, errData.error || 'Ошибка')
      document.querySelector('.stats-final')?.classList.remove('scanning')
      return
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    let created = 0
    let skipped = 0
    let errors = 0

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })

      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const data = JSON.parse(line.slice(6))

            if (data.type === 'progress') {
              const result = data.result
              const orderIndex = ordersData.findIndex((o) => o.shipmentNum === result.shipmentNum)
              if (orderIndex === -1) continue

              if (result.status === 'created') {
                created++
                if (actionType === 'demand') {
                  ordersData[orderIndex].hasDemand = true
                  ordersData[orderIndex].statusName = 'Отгрузка создана'
                  ordersData[orderIndex].lastAction = 'demand_created'
                  ordersData[orderIndex].demandName = result.demandName || null
                  saveOrderAction(result.shipmentNum, 'demand_created', result.demandName)
                } else if (actionType === 'payment') {
                  ordersData[orderIndex].hasPayment = true
                  ordersData[orderIndex].statusName = 'Оплачен'
                  ordersData[orderIndex].paid = ordersData[orderIndex].sum
                  ordersData[orderIndex].lastAction = 'payment_created'
                  ordersData[orderIndex].paymentName = result.paymentName || null
                  saveOrderAction(result.shipmentNum, 'payment_created', result.paymentName)
                } else if (actionType === 'return') {
                  ordersData[orderIndex].hasReturn = true
                  ordersData[orderIndex].statusName = 'Возврат'
                  ordersData[orderIndex].lastAction = 'return_created'
                  ordersData[orderIndex].returnName = result.returnName || null
                  ordersData[orderIndex].returnSum = result.returnSum || 0
                  saveOrderAction(result.shipmentNum, 'return_created', result.returnName, {
                    returnSum: result.returnSum || 0
                  })
                } else if (actionType === 'cancel') {
                  ordersData[orderIndex].isCancelled = true
                  ordersData[orderIndex].statusName = 'Отменён'
                  ordersData[orderIndex].lastAction = 'order_cancelled'
                  ordersData[orderIndex].cancelledSum = ordersData[orderIndex].sum || 0
                  saveOrderAction(result.shipmentNum, 'order_cancelled', 'success', {
                    cancelledSum: ordersData[orderIndex].sum || 0
                  })
                } else if (actionType === 'partial_payment') {
                  ordersData[orderIndex].hasPayment = true
                  ordersData[orderIndex].statusName = 'Частично оплачен'
                  ordersData[orderIndex].paid =
                    result.paymentSum ||
                    ordersData[orderIndex].sum - (ordersData[orderIndex].returnSum || 0)
                  ordersData[orderIndex].lastAction = 'partial_payment_created'
                  ordersData[orderIndex].paymentName = result.paymentName || null
                  saveOrderAction(
                    result.shipmentNum,
                    'partial_payment_created',
                    result.paymentName
                  )
                }
              } else if (result.status === 'skipped') {
                skipped++
              } else if (result.status === 'error') {
                errors++
                ordersData[orderIndex].lastAction = actionType + '_error'
                ordersData[orderIndex].statusName = 'Ошибка'
                saveOrderAction(result.shipmentNum, actionType + '_error', result.error)
              }

              // Обновляем статус
              const stats = data.stats || { created, skipped, errors }
              document.getElementById('statusText').textContent =
                `Обработано ${data.index}/${data.total} (${stats.created} создано)`

              // Добавляем строку в таблицу
              appendOrderRow(ordersData[orderIndex])

              // Обновляем статистику после каждой строки (с force=true для realtime)
              renderCurrentStats(true)
            } else if (data.type === 'done') {
              const stats = data.stats || { created, skipped, errors }

              // Останавливаем секундомер
              const elapsed = stopOperationTimer()

              // Собираем все изменённые номера (успех + ошибки)
              const processedNumbers = data.orders
                .filter((o) => o.status === 'created' || o.status === 'error')
                .map((o) => o.shipmentNum)

              // Данные уже обновлены в SSE цикле (строки 1373-1398)
              // НЕ вызываем refreshSpecificOrders, чтобы избежать лишнего запроса и "замораживания" UI
              realtimeMode = false
              renderTable()
              updateTotals()
              renderCurrentStats()

              saveLastActionStats()
              // Сохраняем обновлённые статусы на сервер
              saveScanStateSilent()
              hideProgress(
                true,
                `Создано: ${stats.created}, пропущено: ${stats.skipped}, ошибок: ${stats.errors}`
              )

              // Показываем результаты в блоке "После действий"
              showBatchResults(stats, elapsed)

              // Убираем анимацию сканирования
              document.querySelector('.stats-final').classList.remove('scanning')
            } else if (data.type === 'aborted') {
              const stats = data.stats || { created, skipped, errors }

              // Останавливаем секундомер
              const elapsed = stopOperationTimer()

              realtimeMode = false
              renderTable()
              updateTotals()
              renderCurrentStats()

              saveLastActionStats()
              // Сохраняем обновлённые статусы на сервер
              saveScanStateSilent()
              // Показываем сообщение о прерывании (батч не завершён, часть заказов не обработана)
              hideProgress(
                false,
                `Прервано. Обработано: ${data.processed}, создано: ${stats.created}`
              )

              // Показываем результаты в блоке "После действий"
              showBatchResults(stats, elapsed)

              // Убираем анимацию сканирования
              document.querySelector('.stats-final').classList.remove('scanning')
            }
          } catch (e) {
            console.error('SSE parse error:', e)
          }
        }
      }
    }
  } catch (e) {
    hideProgress(false, 'Ошибка: ' + e.message)
    stopOperationTimer()
  } finally {
    realtimeMode = false
    stopOperationTimer()
    renderTable()

    // Убираем анимацию сканирования (гарантированно)
    document.querySelector('.stats-final')?.classList.remove('scanning')
  }
}

/**
 * Создаёт отгрузки для всех отмеченных заказов (массово).
 *
 * @async
 * @returns {Promise<void>}
 */
async function createAllDemands() {
  batchAction('demand')
}

/**
 * Создаёт платежи для всех отмеченных заказов (массово).
 *
 * @async
 * @returns {Promise<void>}
 */
async function createAllPayments() {
  batchAction('payment')
}

/**
 * Показывает/скрывает индикатор прогресса (progress bar + статус).
 * При working=true — анимация работы; false — завершение.
 *
 * @param {boolean} [working=true] - Состояние: работа / завершение
 * @returns {void}
 */
function showProgress(working = true) {
  const container = document.getElementById('progressContainer')
  const bar = document.getElementById('progressBar')
  const statusText = document.getElementById('statusText')

  container.classList.add('active')
  bar.className = 'progress-bar' + (working ? ' working' : '')
  statusText.textContent = working ? 'Работает...' : 'Завершение...'
}

/**
 * Устанавливает текст в элементе статуса #statusText.
 * Также дублирует в console.log.
 *
 * @param {string} message - Текст статуса
 * @returns {void}
 */
function showStatus(message) {
  const statusText = document.getElementById('statusText')
  statusText.textContent = message
  console.log('STATUS:', message)
}

/**
 * Скрывает индикатор прогресса с финальным состоянием (успех/ошибка).
 * Через 3 секунды скрывает контейнер полностью.
 *
 * @param {boolean} [success=true] - Успешно завершено или ошибка
 * @param {string} [message=''] - Финальное сообщение
 * @returns {void}
 */
function hideProgress(success = true, message = '') {
  const container = document.getElementById('progressContainer')
  const bar = document.getElementById('progressBar')
  const statusText = document.getElementById('statusText')

  bar.className = 'progress-bar ' + (success ? 'success' : 'error')
  statusText.textContent = message || (success ? 'Готово' : 'Ошибка')

  setTimeout(() => {
    container.classList.remove('active')
    bar.className = 'progress-bar'
  }, 3000)
}

/**
 * Запускает сервер (новую консоль/процесс).
 * Проверяет health, при необходимости вызывает /api/start.
 * Опрашивает /api/health до успешного запуска или таймаута.
 *
 * @async
 * @returns {Promise<void>}
 */
async function startServer() {
  // Очистить предыдущий таймер
  if (serverCheckTimer) {
    clearInterval(serverCheckTimer)
    serverCheckTimer = null
  }

  showProgress(true)
  document.getElementById('statusText').textContent = 'Запуск...'

  try {
    const healthResp = await fetch('/api/health').catch(() => null)

    if (healthResp && healthResp.ok) {
      hideProgress(true, 'Сервер уже запущен')
      document.getElementById('statusText').textContent = 'Сервер работает'
      return
    }

    // Start via API
    const resp = await fetch('/api/start', { method: 'POST' })
    const data = await resp.json()

    if (data.success) {
      // Wait for server to start
      let attempts = 0
      serverCheckTimer = setInterval(async () => {
        attempts++
        try {
          const r = await fetch('/api/health')
          if (r.ok) {
            clearInterval(serverCheckTimer)
            serverCheckTimer = null
            hideProgress(true, 'Сервер запущен')
            checkServerStatus()
          }
        } catch (e) {}
        if (attempts > 15) {
          clearInterval(serverCheckTimer)
          serverCheckTimer = null
          hideProgress(false, 'Не удалось запустить')
        }
      }, 1000)
    } else {
      hideProgress(false, 'Ошибка запуска')
    }
  } catch (e) {
    if (serverCheckTimer) {
      clearInterval(serverCheckTimer)
      serverCheckTimer = null
    }
    hideProgress(false, 'Ошибка: ' + e.message)
  }
}

/**
 * Перезапускает сервер. Вызывает /api/restart, затем ожидает
 * восстановления health с таймаутом 15 секунд.
 *
 * @async
 * @returns {Promise<void>}
 */
async function restartServer() {
  if (!(await showConfirm('Перезапустить сервер?'))) return

  // Очистить предыдущий таймер
  if (serverCheckTimer) {
    clearInterval(serverCheckTimer)
    serverCheckTimer = null
  }

  showProgress(true)
  document.getElementById('statusText').textContent = 'Перезапуск...'

  try {
    await fetch('/api/restart', { method: 'POST' })

    // Wait for new server
    let attempts = 0
    serverCheckTimer = setInterval(async () => {
      attempts++
      try {
        const r = await fetch('/api/health')
        if (r.ok) {
          clearInterval(serverCheckTimer)
          serverCheckTimer = null
          hideProgress(true, 'Сервер перезапущен')
          checkServerStatus()
        }
      } catch (e) {}
      if (attempts > 15) {
        clearInterval(serverCheckTimer)
        serverCheckTimer = null
        hideProgress(false, 'Не удалось перезапустить')
      }
    }, 1000)
  } catch (e) {
    if (serverCheckTimer) {
      clearInterval(serverCheckTimer)
      serverCheckTimer = null
    }
    hideProgress(false, 'Ошибка: ' + e.message)
  }
}

/**
 * Проверяет статус сервера через GET /api/health.
 * Обновляет индикатор статуса (зелёная точка при успехе).
 *
 * @async
 * @returns {Promise<void>}
 */
async function checkServerStatus() {
  const statusDot = document.getElementById('statusDot')
  const statusText = document.getElementById('statusText')
  try {
    const data = await (await fetch('/api/health')).json()
    if (data.status === 'ok') {
      statusDot.classList.add('ok')
      statusText.textContent = 'Сервер работает'
    }
  } catch (e) {
    statusText.textContent = 'Сервер недоступен'
  }
}

/**
 * Загружает и отображает логи сервера в консольном элементе.
 * Получает последние 50 строк лога через GET /api/logs.
 *
 * @async
 * @returns {Promise<void>}
 */
async function loadLogs() {
  const consoleEl = document.getElementById('consoleOutput')
  consoleEl.innerHTML = '<span class="log-info">Загрузка...</span>'

  try {
    const data = await (await fetch('/api/logs')).json()
    if (data.error) {
      consoleEl.innerHTML = `<span class="log-error">${data.error}</span>`
      return
    }
    if (!data.logs) {
      consoleEl.innerHTML = '<span class="log-time">Нет логов</span>'
      return
    }

    const lines = data.logs
      .split('\n')
      .filter((l) => l)
      .slice(-50)
    consoleEl.innerHTML = lines
      .map((line) => {
        const timeMatch = line.match(/^\[(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\]/)
        const time = timeMatch ? timeMatch[1] : ''
        let content = line.replace(/^\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\]\s*/, '')
        let cls = 'log-info'
        if (content.includes('error') || content.includes('Ошибка')) cls = 'log-error'
        else if (content.includes('создан') || content.includes('Завершено')) cls = 'log-success'
        else if (content.includes('===')) cls = 'log-warn'
        return `<div><span class="log-time">${time}</span> <span class="${cls}">${content}</span></div>`
      })
      .join('')

    consoleEl.scrollTop = consoleEl.scrollHeight
  } catch (e) {
    consoleEl.innerHTML = `<span class="log-error">${e.message}</span>`
  }
}

// Init
document.addEventListener('DOMContentLoaded', async () => {
  loadToken()
  checkServerStatus()

  // Загружаем сохранённые заказы при старте
  await loadSavedOrdersAndRender()

  // Загружаем сохранённые поставки при старте
  loadSavedSuppliesAndRender()

  // Инициализируем обработчик кликов для блока расхождений
  initMismatchClickHandler()

  // Делегированный клик по дням календаря (чтобы не откреплялся при innerHTML)
  const drpDays = document.getElementById('drpDays')
  if (drpDays) {
    drpDays.addEventListener('click', function (e) {
      const dayEl = e.target.closest('.drp-day:not(.drp-empty)')
      if (!dayEl) return
      const ds = dayEl.dataset.date
      if (!ds) return
      drpSelect(ds)
      e.stopPropagation()
    })
  }

  // Делегированный клик по дням календаря сканирования
  const drpDaysScan = document.getElementById('drpDaysScan')
  if (drpDaysScan) {
    drpDaysScan.addEventListener('click', function (e) {
      const dayEl = e.target.closest('.drp-day:not(.drp-empty)')
      if (!dayEl) return
      const ds = dayEl.dataset.date
      if (!ds) return
      drpSelectScan(ds)
      e.stopPropagation()
    })
  }
})

// Глобальный обработчик закрытия попапа фильтра по дате
document.addEventListener('click', function (e) {
  const popup = document.getElementById('dateFilterPopup')
  if (!popup || popup.style.display !== 'block') return
  const th = document.querySelector('th.date-header')
  if (th && th.contains(e.target)) return
  if (popup.contains(e.target)) return
  closeDateFilter()
})

document.addEventListener('keydown', function (e) {
  if (e.key !== 'Escape') return
  const popup = document.getElementById('dateFilterPopup')
  if (popup && popup.style.display === 'block') closeDateFilter()
  const popupSupplies = document.getElementById('dateFilterPopupSupplies')
  if (popupSupplies && popupSupplies.style.display === 'block') closeSuppliesDateFilter()
  if (scanCalendarOpen) closeScanCalendar()
})

// Скрывать попап даты при прокрутке
window.addEventListener('scroll', function () {
  const popup = document.getElementById('dateFilterPopup')
  if (popup && popup.style.display === 'block') closeDateFilter()
  const popupSupplies = document.getElementById('dateFilterPopupSupplies')
  if (popupSupplies && popupSupplies.style.display === 'block') closeSuppliesDateFilter()
  if (scanCalendarOpen) closeScanCalendar()
}, true)

// Глобальный обработчик закрытия supplies date filter
document.addEventListener('click', function(e) {
  const popup = document.getElementById('dateFilterPopupSupplies')
  if (!popup || popup.style.display !== 'block') return
  const th = document.querySelector('th.date-header')
  if (th && th.contains(e.target)) return
  if (popup.contains(e.target)) return
  closeSuppliesDateFilter()
})

// Глобальный обработчик закрытия календаря сканирования
document.addEventListener('click', function(e) {
  if (!scanCalendarOpen) return
  var cal = document.getElementById('drpCalendarScan')
  if (!cal || cal.style.display !== 'block') return
  var settings = document.querySelector('.supplies-scan-settings')
  if (settings && settings.contains(e.target)) return
  closeScanCalendar()
})

/**
 * Очищает все сохранённые данные заказов (через DELETE /api/orders-state).
 * После очистки перерисовывает таблицу и сбрасывает статистику.
 *
 * @async
 * @returns {Promise<void>}
 */
async function clearSavedData() {
  if (!(await showConfirm('Очистить все сохранённые данные?'))) return
  try {
    const response = await fetch('/api/orders-state', { method: 'DELETE' })
    const result = await response.json()
    ordersData = []
    renderTable()
    updateTotals()
    showStatus('Данные очищены')
  } catch (e) {
    showStatus('Ошибка: ' + e.message)
  }
}

// ===== Scanner (QR/Barcode) =====
/**
 * @file Модуль сканера QR-кодов и штрихкодов
 * Использует библиотеку html5-qrcode (CDN)
 * @module Scanner
 */

/** @type {Html5Qrcode|null} */
let html5QrCode = null
/** @type {boolean} */
let scannerFlashAvailable = false

/**
 * Запускает камеру и начинает сканирование QR/штрихкодов
 * Вызывается по нажатию кнопки "Сканировать" на мобильных/планшетах
 * @async
 * @returns {Promise<void>}
 */
async function startScan() {
  // Не запускать если уже идёт обработка
  if (isWorking) {
    showStatus('Дождитесь завершения текущей операции')
    return
  }

  // Проверка доступности камеры (HTTPS/localhost)
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    const statusEl = document.getElementById('scannerStatus')
    const errorEl = document.getElementById('scannerError')
    statusEl.classList.add('hidden')
    errorEl.textContent = 'Камера недоступна. Запустите через HTTPS или localhost.'
    errorEl.classList.remove('hidden')
    setTimeout(stopScanner, 4000)
    return
  }

  const modal = document.getElementById('scannerModal')
  const statusEl = document.getElementById('scannerStatus')
  const errorEl = document.getElementById('scannerError')
  const flashBtn = document.getElementById('scannerFlashBtn')

  statusEl.classList.remove('hidden')
  errorEl.classList.add('hidden')
  modal.classList.remove('hidden')

  try {
    const cameras = await Html5Qrcode.getCameras()
    if (!cameras || cameras.length === 0) {
      throw new Error('Камера не найдена на этом устройстве')
    }

    // Выбираем заднюю камеру (environment), иначе первую
    const rearCamera = cameras.find(function(c) {
      return c.label.toLowerCase().includes('back') ||
             c.label.toLowerCase().includes('environment') ||
             c.label.toLowerCase().includes('rear')
    }) || cameras[0]

    html5QrCode = new Html5Qrcode('scanner-viewfinder')

    await html5QrCode.start(
      rearCamera.id,
      {
        fps: 10,
        qrbox: { width: 250, height: 150 },
        formatsToSupport: [
          Html5QrcodeSupportedFormats.QR_CODE,
          Html5QrcodeSupportedFormats.CODE_128,
          Html5QrcodeSupportedFormats.CODE_39,
          Html5QrcodeSupportedFormats.EAN_13,
          Html5QrcodeSupportedFormats.EAN_8,
          Html5QrcodeSupportedFormats.UPC_A,
          Html5QrcodeSupportedFormats.UPC_E,
          Html5QrcodeSupportedFormats.DATA_MATRIX
        ]
      },
      onScanSuccess,
      onScanFailure
    )

    // Проверяем доступность фонарика
    try {
      scannerFlashAvailable = await html5QrCode.hasFlash()
    } catch (_) {
      scannerFlashAvailable = false
    }
    flashBtn.style.display = scannerFlashAvailable ? '' : 'none'

  } catch (err) {
    statusEl.classList.add('hidden')
    errorEl.classList.remove('hidden')

    if (err && err.name === 'NotReadableError') {
      // Камера занята другим приложением/вкладкой
      errorEl.textContent = 'Камера занята другим приложением. Закройте другие программы, использующие камеру, и попробуйте снова.'
      // Не закрываем автоматически — пользователь закроет сам кнопкой «Закрыть»
    } else if (err && err.name === 'NotAllowedError') {
      // Пользователь запретил доступ к камере
      errorEl.textContent = 'Доступ к камере запрещён. Разрешите доступ в настройках браузера и попробуйте снова.'
      // Не закрываем автоматически
    } else {
      // Все остальные ошибки — с авто-закрытием
      errorEl.textContent = 'Ошибка: ' + (err && err.message ? err.message : String(err))
      setTimeout(stopScanner, 4000)
    }
  }
}

/**
 * Колбэк успешного распознавания QR/штрихкода
 * Вставляет результат в поле ввода и запускает поиск
 * @param {string} decodedText - Распознанный текст
 * @param {Object} decodedResult - Детальная информация о результате
 * @returns {void}
 */
function onScanSuccess(decodedText, decodedResult) {
  // Звуковой сигнал
  playScanBeep()

  const text = decodedText.trim()
  if (!text) return

  // Остановить камеру и закрыть модалку
  stopScanner()

  // Вставить текст и запустить поиск
  document.getElementById('numbersInput').value = text

  // Небольшая задержка для закрытия модалки перед поиском
  setTimeout(function() {
    checkNumbers()
  }, 100)
}

/**
 * Колбэк ошибки сканирования кадра
 * Вызывается для каждого нераспознанного кадра — игнорируется
 * @param {string} error - Текст ошибки
 * @returns {void}
 */
function onScanFailure(error) {
  // Игнорируем — библиотека вызывает на каждый кадр
}

/**
 * Останавливает камеру и закрывает модалку сканера
 * @returns {void}
 */
function stopScanner() {
  if (html5QrCode) {
    try {
      html5QrCode.stop().catch(function() {})
      html5QrCode.clear().catch(function() {})
    } catch (_) {}
    html5QrCode = null
  }
  document.getElementById('scannerModal').classList.add('hidden')
  scannerFlashAvailable = false
}

/**
 * Включает/выключает фонарик (если доступен на устройстве)
 * @async
 * @returns {Promise<void>}
 */
async function toggleScannerFlash() {
  if (!html5QrCode) return
  try {
    var isOn = await html5QrCode.toggleFlash()
    var btn = document.getElementById('scannerFlashBtn')
    btn.textContent = isOn ? '🔦 Выкл.' : '🔦 Фонарик'
  } catch (_) {}
}

/**
 * Генерирует короткий звуковой сигнал через Web Audio API
 * @returns {void}
 */
function playScanBeep() {
  try {
    var ctx = new (window.AudioContext || window.webkitAudioContext)()
    var osc = ctx.createOscillator()
    var gain = ctx.createGain()
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.frequency.value = 880
    osc.type = 'sine'
    gain.gain.setValueAtTime(0.3, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.15)
    osc.start(ctx.currentTime)
    osc.stop(ctx.currentTime + 0.15)
  } catch (_) {
    // Web Audio API может быть недоступен — тихий fallback
  }
}

// ===== Supplies Tab =====
/**
 * @file Модуль вкладки "Поставки" — сканирование поставок, массовые и одиночные действия.
 * @module SuppliesTab
 */

/** @type {Array<Object>} Массив данных поставок */
let suppliesData = []
/** @type {boolean} Флаг выполнения операции поставок */
let suppliesIsWorking = false
/** @type {{ column: string, asc: boolean }} Текущая сортировка таблицы поставок */
let suppliesSortCol = 'orderMoment'
let suppliesSortAsc = false
/** @type {{ from: string, to: string }} Фильтр дат для поставок (отдельный от склада) */
let dateFilterSupplies = { from: '', to: '' }
/** @type {{ month: number, year: number }} Состояние календаря date range picker для поставок */
let drpStateSupplies = { month: new Date().getMonth(), year: new Date().getFullYear() }
/** @type {Object|null} Последняя статистика фильтрации сканирования поставок */
let suppliesFilterStats = null

/** Константа для ключа localStorage */
const SUPPLIES_STORAGE_KEY = 'sklad_supplies_data'

/**
 * Сохраняет текущие данные поставок в localStorage.
 * Убирает тяжёлые поля перед сохранением.
 * @returns {void}
 */
function saveSuppliesState() {
  try {
    if (!suppliesData || suppliesData.length === 0) return
    var light = suppliesData.map(function(o) {
      return {
        orderId: o.orderId,
        orderName: o.orderName,
        description: o.description,
        orderMoment: o.orderMoment,
        sum: o.sum,
        shipmentNum: o.shipmentNum,
        marketplace: o.marketplace,
        storeId: o.storeId,
        storeName: o.storeName,
        hasDemand: o.hasDemand,
        hasCancel: o.hasCancel,
        canDemand: o.canDemand,
        canCancel: o.canCancel,
        enabled: o.enabled,
        recommendation: o.recommendation,
        recommendationType: o.recommendationType,
        marketplaceStatus: o.marketplaceStatus,
        marketplaceFound: o.marketplaceFound,
        marketplaceIsCancelled: o.marketplaceIsCancelled,
        marketplaceIsDelivered: o.marketplaceIsDelivered,
        marketplaceIsReturn: o.marketplaceIsReturn
      }
    })
    localStorage.setItem(SUPPLIES_STORAGE_KEY, JSON.stringify(light))
  } catch (e) {
    console.error('Supplies: save state error:', e)
  }
}

/**
 * Загружает сохранённые данные поставок из localStorage и восстанавливает таблицу.
 * @returns {void}
 */
function loadSavedSuppliesAndRender() {
  try {
    var saved = localStorage.getItem(SUPPLIES_STORAGE_KEY)
    if (!saved) return
    var parsed = JSON.parse(saved)
    if (!Array.isArray(parsed) || parsed.length === 0) return
    suppliesData = parsed
    renderSuppliesTable()
    renderSuppliesStats()
    renderSuppliesMismatchStats()
    buildStoreFilterDropdown()
    // Показываем статус
    var statusEl = document.getElementById('statusText')
    if (statusEl) statusEl.textContent = 'Сканирование от ' + new Date().toLocaleDateString() + ': ' + parsed.length + ' поставок'
  } catch (e) {
    console.error('Supplies: load state error:', e)
  }
}

/**
 * Инициализирует настройки сканирования: устанавливает даты по умолчанию (последние 2 дня)
 * в display-поля и suppliesScanDates, загружает список складов из API.
 * Вызывается один раз (lazy-init) при первом открытии вкладки.
 * @returns {void}
 */
function initSuppliesScanSettings() {
  // ─── Даты: lazy-init ───
  var fromDisplayEl = document.getElementById('scanDateFromDisplay')
  if (fromDisplayEl && fromDisplayEl.value) {
    // Уже было инициализировано — только загружаем склады
    loadScanStores()
    return
  }

  var today = new Date()
  var twoDaysAgo = new Date(today)
  twoDaysAgo.setDate(twoDaysAgo.getDate() - 2)

  var fmtISO = function(d) {
    return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0')
  }
  var fmtDisplay = function(d) {
    return String(d.getDate()).padStart(2,'0') + '.' + String(d.getMonth()+1).padStart(2,'0') + '.' + d.getFullYear()
  }

  // Сохраняем в JS-состояние
  suppliesScanDates.from = fmtISO(twoDaysAgo)
  suppliesScanDates.to = fmtISO(today)

  // Отображаем в полях
  if (fromDisplayEl) fromDisplayEl.value = fmtDisplay(twoDaysAgo)
  var toDisplayEl = document.getElementById('scanDateToDisplay')
  if (toDisplayEl) toDisplayEl.value = fmtDisplay(today)

  // Скрытые поля (на случай если JS-состояние недоступно)
  var fromHidden = document.getElementById('scanDateFrom')
  var toHidden = document.getElementById('scanDateTo')
  if (fromHidden) fromHidden.value = suppliesScanDates.from
  if (toHidden) toHidden.value = suppliesScanDates.to

  // Загружаем склады
  loadScanStores()
}

/**
 * Загружает список складов из API в select#scanStoreSelect.
 * @returns {void}
 */
function loadScanStores() {
  var token = loadToken()
  if (!token) return
  fetch('/api/supplies/stores?token=' + encodeURIComponent(token))
    .then(function(r) { return r.json() })
    .then(function(data) {
      var select = document.getElementById('scanStoreSelect')
      if (!select) return
      while (select.options.length > 1) select.remove(1)
      ;(data.stores || []).forEach(function(s) {
        var opt = document.createElement('option')
        opt.value = s.id
        opt.textContent = s.name
        select.appendChild(opt)
      })
    })
    .catch(function(e) { console.error('Supplies: load stores error:', e) })
}

/** @type {AbortController|null} Контроллер для прерывания SSE-потока поставок */
let suppliesController = null
/** @type {boolean} Режим realtime для таблицы поставок */
let suppliesRealtimeMode = false

/** @type {{ from: string, to: string }} Даты сканирования поставок (ISO: YYYY-MM-DD) */
let suppliesScanDates = { from: '', to: '' }
/** @type {{ month: number, year: number }} Состояние календаря сканирования */
let drpStateScan = { month: new Date().getMonth(), year: new Date().getFullYear() }
/** @type {boolean} Флаг открытия календаря сканирования */
let scanCalendarOpen = false

// ─── Supplies Scan Date Calendar ───

/**
 * Переключает отображение календаря для выбора дат сканирования.
 * @returns {void}
 */
function toggleScanCalendar() {
  var cal = document.getElementById('drpCalendarScan')
  if (!cal) return
  if (cal.style.display === 'block') { closeScanCalendar(); return }
  // Синхронизируем месяц/год с выбранной датой from или с сегодня
  drpStateScan.month = suppliesScanDates.from
    ? parseInt(suppliesScanDates.from.split('-')[1]) - 1
    : new Date().getMonth()
  drpStateScan.year = suppliesScanDates.from
    ? parseInt(suppliesScanDates.from.split('-')[0])
    : new Date().getFullYear()
  drpRenderScan()
  cal.style.display = 'block'
  scanCalendarOpen = true
}

/**
 * Закрывает календарь выбора дат сканирования.
 * @returns {void}
 */
function closeScanCalendar() {
  var cal = document.getElementById('drpCalendarScan')
  if (cal) cal.style.display = 'none'
  scanCalendarOpen = false
}

/**
 * Отрисовывает календарь выбора дат сканирования в #drpDaysScan.
 * Аналогичен drpRender() на вкладке Склад и drpRenderSupplies() для табличного фильтра.
 * @returns {void}
 */
function drpRenderScan() {
  var daysEl = document.getElementById('drpDaysScan')
  if (!daysEl) return
  var month = drpStateScan.month
  var year = drpStateScan.year
  var months = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь']
  var titleEl = document.getElementById('drpTitleScan')
  if (titleEl) titleEl.textContent = months[month] + ' ' + year

  var firstDay = new Date(year, month, 1).getDay()
  var startOffset = firstDay === 0 ? 6 : firstDay - 1
  var daysInMonth = new Date(year, month + 1, 0).getDate()
  var today = new Date()
  var todayStr = today.getFullYear() + '-' + String(today.getMonth()+1).padStart(2,'0') + '-' + String(today.getDate()).padStart(2,'0')

  var from = suppliesScanDates.from
  var to = suppliesScanDates.to

  var html = ''
  for (var i = 0; i < startOffset; i++) html += '<span class="drp-day drp-empty"></span>'
  for (var d = 1; d <= daysInMonth; d++) {
    var ds = year + '-' + String(month+1).padStart(2,'0') + '-' + String(d).padStart(2,'0')
    var cls = 'drp-day'
    if (ds === todayStr) cls += ' drp-today'
    if (ds === from) cls += ' drp-from'
    if (ds === to) cls += ' drp-to'
    if (from && to && ds > from && ds < to) cls += ' drp-range'
    html += '<span class="' + cls + '" data-date="' + ds + '">' + d + '</span>'
  }
  daysEl.innerHTML = html
}

/**
 * Обрабатывает выбор даты в календаре сканирования.
 * Первый клик — from, второй — to (авто-свап если to < from).
 * @param {string} dateStr - Дата в формате YYYY-MM-DD
 * @returns {void}
 */
function drpSelectScan(dateStr) {
  if (!suppliesScanDates.from || (suppliesScanDates.from && suppliesScanDates.to)) {
    suppliesScanDates.from = dateStr
    suppliesScanDates.to = ''
  } else {
    suppliesScanDates.to = dateStr
    if (suppliesScanDates.to < suppliesScanDates.from) {
      var tmp = suppliesScanDates.from
      suppliesScanDates.from = suppliesScanDates.to
      suppliesScanDates.to = tmp
    }
  }
  drpUpdateDisplayScan()
  drpRenderScan()
}

/**
 * Обновляет display-поля для дат сканирования из suppliesScanDates.
 * @returns {void}
 */
function drpUpdateDisplayScan() {
  var fmt = function(iso) {
    if (!iso) return ''
    var p = iso.split('-')
    return p[2] + '.' + p[1] + '.' + p[0]
  }
  var fromEl = document.getElementById('scanDateFromDisplay')
  var toEl = document.getElementById('scanDateToDisplay')
  if (fromEl) fromEl.value = fmt(suppliesScanDates.from)
  if (toEl) toEl.value = fmt(suppliesScanDates.to)
  // Скрытые поля (резерв)
  var fromHidden = document.getElementById('scanDateFrom')
  var toHidden = document.getElementById('scanDateTo')
  if (fromHidden) fromHidden.value = suppliesScanDates.from
  if (toHidden) toHidden.value = suppliesScanDates.to
}

/**
 * Переключает календарь на предыдущий месяц.
 * @returns {void}
 */
function drpPrevMonthScan() {
  drpStateScan.month--
  if (drpStateScan.month < 0) { drpStateScan.month = 11; drpStateScan.year-- }
  drpRenderScan()
}

/**
 * Переключает календарь на следующий месяц.
 * @returns {void}
 */
function drpNextMonthScan() {
  drpStateScan.month++
  if (drpStateScan.month > 11) { drpStateScan.month = 0; drpStateScan.year++ }
  drpRenderScan()
}

/**
 * Применяет выбранные даты сканирования: обновляет display-поля и скрывает календарь.
 * @returns {void}
 */
function applyScanDates() {
  drpUpdateDisplayScan()
  closeScanCalendar()
}

/**
 * Сбрасывает даты сканирования на значения по умолчанию:
 * from = 2 дня назад, to = сегодня.
 * @returns {void}
 */
function resetScanDates() {
  var today = new Date()
  var twoDaysAgo = new Date(today)
  twoDaysAgo.setDate(twoDaysAgo.getDate() - 2)

  var fmt = function(d) {
    return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0')
  }

  suppliesScanDates.from = fmt(twoDaysAgo)
  suppliesScanDates.to = fmt(today)

  drpUpdateDisplayScan()
  drpRenderScan()
  closeScanCalendar()
}

// ─── End Supplies Scan Calendar ───

/**
 * Сортирует таблицу поставок по указанной колонке.
 * Для даты — стандартная asc/desc сортировка.
 * @param {string} column - Название колонки для сортировки
 * @returns {void}
 */
function sortSuppliesTable(col) {
  if (suppliesSortCol === col) {
    suppliesSortAsc = !suppliesSortAsc
  } else {
    suppliesSortCol = col
    suppliesSortAsc = true
  }
  renderSuppliesTable()
  renderSuppliesStats()
}

/**
 * Полностью перерисовывает таблицу поставок с учётом сортировки и разделителей дней.
 * @returns {void}
 */
function renderSuppliesTable() {
  const tbody = document.getElementById('suppliesTableBody')
  if (!tbody) return
  tbody.innerHTML = ''

  if (suppliesData.length === 0) {
    tbody.innerHTML = '<tr><td colspan="10" class="empty">Нажмите "Сканировать поставки" для поиска новых заказов</td></tr>'
    return
  }

  // Получаем отфильтрованные данные
  const filtered = getFilteredSuppliesData()

  // Копия и сортировка
  const col = suppliesSortCol
  const asc = suppliesSortAsc
  const sorted = [...filtered].sort((a, b) => {
    let va = a[col] || ''
    let vb = b[col] || ''
    if (col === 'orderMoment') {
      // ISO 8601 — лексикографически
      if (va < vb) return asc ? -1 : 1
      if (va > vb) return asc ? 1 : -1
      return 0
    }
    if (typeof va === 'number' || col === 'sum') {
      va = Number(a[col]) || 0
      vb = Number(b[col]) || 0
      if (va < vb) return asc ? -1 : 1
      if (va > vb) return asc ? 1 : -1
      return 0
    }
    va = String(va).toLowerCase()
    vb = String(vb).toLowerCase()
    if (va < vb) return asc ? -1 : 1
    if (va > vb) return asc ? 1 : -1
    return 0
  })

  // Рендер с разделителями дней
  let lastDate = ''
  sorted.forEach(function(order) {
    // Разделитель дней
    var orderDate = order.orderMoment ? order.orderMoment.substring(0, 10) : ''
    if (orderDate && orderDate !== lastDate) {
      lastDate = orderDate
      var parts = orderDate.split('-')
      var dateLabel = parts[2] + '.' + parts[1] + '.' + parts[0]
      var sepTr = document.createElement('tr')
      sepTr.className = 'day-separator'
      sepTr.innerHTML = '<td colspan="10"><span>' + dateLabel + '</span></td>'
      tbody.appendChild(sepTr)
    }
    // Сама строка
    var tr = createSuppliesRow(order)
    if (tr) tbody.appendChild(tr)
  })

  // Обновить индикаторы сортировки на заголовках
  document.querySelectorAll('#tableContainerSupplies th.sortable').forEach(function(th) {
    th.classList.remove('sort-asc', 'sort-desc')
  })
  var activeTh = document.querySelector('#tableContainerSupplies th.sortable[data-col="' + col + '"]')
  if (activeTh) activeTh.classList.add(asc ? 'sort-asc' : 'sort-desc')
}

/**
 * Сканирует поставки через SSE-поток /api/supplies/stream.
 * Читает токены из localStorage, открывает SSE, обрабатывает события
 * progress/order/done/error/aborted, отображает строки в таблице поставок.
 *
 * @async
 * @returns {Promise<void>}
 */
async function scanSupplies() {
  const msToken = loadToken()
  if (!msToken) {
    showStatus('Ошибка: Токен МС не найден.')
    return
  }

  const wbToken = localStorage.getItem('wb_token') || ''
  const ozonClientId = localStorage.getItem('ozon_client_id') || ''
  const ozonApiKey = localStorage.getItem('ozon_api_key') || ''

  const scanBtn = document.getElementById('scanSuppliesBtn')
  const abortBtn = document.getElementById('abortSuppliesBtn')
  if (scanBtn) scanBtn.style.display = 'none'
  if (abortBtn) abortBtn.style.display = 'flex'
  suppliesIsWorking = true

  showProgress(true)
  hideFinalStatsSupplies(true)
  startOperationTimer()

  suppliesData = []

  const tbody = document.getElementById('suppliesTableBody')
  if (tbody) tbody.innerHTML = ''

  let fetchTimeout = null
  window.__fetchTimeout = false

  try {
    suppliesController = new AbortController()
    const abortId = Math.random().toString(36).substring(2, 15)
    window.__currentAbortId = abortId

    // Параметры сканирования из настроек
    var params = new URLSearchParams()
    params.set('abortId', abortId)
    var storeId = document.getElementById('scanStoreSelect')?.value || '_all'
    if (storeId !== '_all') params.set('storeId', storeId)
    // Даты сканирования из suppliesScanDates (установлены в initSuppliesScanSettings или через календарь)
    if (suppliesScanDates.from) params.set('dateFrom', suppliesScanDates.from)
    if (suppliesScanDates.to) params.set('dateTo', suppliesScanDates.to)
    const url = `/api/supplies/stream?${params.toString()}`

    // Таймаут 10с
    fetchTimeout = setTimeout(() => {
      window.__fetchTimeout = true
      if (suppliesController) suppliesController.abort()
    }, 10000)

    const response = await fetch(url, {
      signal: suppliesController.signal,
      headers: {
        'x-api-token': msToken,
        'x-wb-token': wbToken,
        'x-ozon-client-id': ozonClientId,
        'x-ozon-api-key': ozonApiKey
      }
    })
    clearTimeout(fetchTimeout)
    fetchTimeout = null

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}))
      hideProgress(false, errData.error || 'Ошибка')
      return
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })

      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const data = JSON.parse(line.slice(6))

            if (data.type === 'progress') {
              document.getElementById('statusText').textContent =
                `Обработано ${data.index}/${data.total}: ${data.msg || ''}`
            } else if (data.type === 'order') {
              const orderData = { ...data.order, enabled: true }
              suppliesData.push(orderData)

              document.getElementById('statusText').textContent =
                `Загружено ${data.index}/${data.total}`

              appendSuppliesRow(orderData)
              applySuppliesMarketplaceFilter()
            } else if (data.type === 'done') {
              const elapsed = stopOperationTimer()
              suppliesRealtimeMode = false

              // Сохраняем статистику фильтрации с сервера
              if (data.stats && data.stats.filterStats) {
                suppliesFilterStats = data.stats.filterStats
              }

              // Старые заказы, не попавшие в новый скан, НЕ добавляем
              // (чтобы при рескане не показывались устаревшие/обработанные заказы)

              // Сохраняем результат сканирования (чтобы не пропадал при обновлении страницы)
              saveSuppliesState()

              hideProgress(true, 'Готово: ' + suppliesData.length)
              showFinalStatsSupplies({ total: suppliesData.length, filterStats: data.stats ? data.stats.filterStats : null }, elapsed)

              renderSuppliesStats()
              renderSuppliesTable()
              renderSuppliesMismatchStats()
              buildStoreFilterDropdown()

              showStatus('Сканирование поставок завершено')
            } else if (data.type === 'aborted') {
              const elapsed = stopOperationTimer()
              suppliesRealtimeMode = false

              hideProgress(false, 'Прервано. Обработано: ' + (data.processed || 0))
              showFinalStatsSupplies({ total: data.processed || 0 }, elapsed)
            } else if (data.type === 'error') {
              hideProgress(false, data.error || 'Ошибка')
              return
            }
          } catch (e) {
            console.error('Supplies SSE parse error:', e)
          }
        }
      }
    }
  } catch (e) {
    clearTimeout(fetchTimeout)
    if (e.name === 'AbortError') {
      hideProgress(false, window.__fetchTimeout ? 'Таймаут: сервер не отвечает' : 'Прервано')
      stopOperationTimer()
    } else {
      hideProgress(false, 'Ошибка: ' + e.message)
      stopOperationTimer()
    }
  } finally {
    clearTimeout(fetchTimeout)
    stopOperationTimer()
    suppliesRealtimeMode = false

    if (scanBtn) scanBtn.style.display = 'inline-flex'
    if (abortBtn) abortBtn.style.display = 'none'
    suppliesIsWorking = false
    window.__currentAbortId = null
  }
}

/**
 * Создаёт DOM-элемент строки таблицы поставок.
 * @param {Object} order - Данные поставки
 * @returns {HTMLTableRowElement|null} Созданный элемент tr
 */
function createSuppliesRow(order) {
  const tr = document.createElement('tr')
  tr.className = order.recommendationType ? 'row-' + order.recommendationType : ''
  tr.dataset.storeId = order.storeId || '_'

  const marketplaceIcon = order.marketplace === 'wb'
    ? '<span class="marketplace-tag wb-tag">WB</span>'
    : '<span class="marketplace-tag ozon-tag">Ozon</span>'

  let actionsHtml = '<div class="action-grid">'
  if (order.canDemand) actionsHtml += '<button class="btn btn-demand action-btn" onclick="supplySingleAction(\'' + order.shipmentNum + '\',\'demand\')" title="Создать отгрузку">📦</button>'
  if (order.canCancel) actionsHtml += '<button class="btn btn-cancel action-btn" onclick="supplySingleAction(\'' + order.shipmentNum + '\',\'cancel\')" title="Отменить">✗</button>'
  // Если кнопок нет — показываем индикатор статуса
  if (!order.canDemand && !order.canCancel) {
    var recType = order.recommendationType || ''
    if (recType === 'ok' || recType === 'action_cancel_demand') {
      actionsHtml += '<span class="status-ok-icon" title="' + esc(order.recommendation || '') + '">✅</span>'
    } else if (recType === 'waiting') {
      actionsHtml += '<span class="status-wait-icon" title="' + esc(order.recommendation || '') + '">⏳</span>'
    } else {
      actionsHtml += '<span class="status-no">—</span>'
    }
  }
  actionsHtml += '</div>'

  // Перевод статуса маркетплейса
  function translateStatus(status) {
    if (!status) return '—'
    var map = {
      'cancel': 'Отменён', 'cancelled': 'Отменён',
      'sale': 'Продан', 'delivered': 'Доставлен',
      'return': 'Возврат', 'returning': 'Возвращается',
      'returned': 'Возвращён',
      'awaiting_delivery': 'Ожидает доставки',
      'awaiting_packaging': 'Ожидает упаковки',
      'awaiting_deliver': 'Ожидает отгрузки',
      'delivering': 'Доставляется',
      'accepted': 'Принят'
    }
    return map[status.toLowerCase()] || status
  }

  /**
   * Возвращает читаемый статус заказа поставки для отображения в таблице.
   *
   * Согласован с decision matrix в lib/supplies.js:
   *   - Отменён → всегда "Отменён", рекомендация укажет действие
   *   - Доставлен + demand = "Принят" (поставка уже создана в МС)
   *   - Доставлен + нет demand = "Доставлен" (ждёт оформления отгрузки)
   *   - Возврат → "Возврат"
   *   - Есть demand + не отменён/не возврат → "Принят"
   *   - Найден, но без статуса → "В обработке"
   *   - Не найден → "Не найден"
   *
   * @param {Object} order - Объект поставки
   * @returns {string} Текст статуса
   */
  function getSuppliesStatusText(order) {
    // Отменён на маркете
    if (order.marketplaceIsCancelled) return 'Отменён'

    // Возврат (выше приоритет, чем "Доставлен")
    if (order.marketplaceIsReturn) return 'Возврат'

    // Доставлен/реализован на маркете
    if (order.marketplaceIsDelivered) {
      if (order.hasDemand) return 'Принят'
      return 'Доставлен'
    }

    // Найден в кэше маркета — если уже есть demand, считаем принятым
    if (order.marketplaceFound) {
      if (order.hasDemand) return 'Принят'
      return 'В обработке'
    }

    // Заказ не найден в кэшах маркета, но demand есть
    if (order.hasDemand) return 'Принят'

    // Не найден в кэшах маркета
    return 'Не найден'
  }

  // Отображаем только номер заказа МС и номер маркета второй строкой
  var orderName = order.orderName || '-'
  var marketplaceNum = order.shipmentNum || ''
  var descSub = marketplaceNum ? '<br><span style="font-size:0.85em;opacity:0.7">' + esc(marketplaceNum) + '</span>' : ''
  var displayDesc = esc(orderName)

  // Индекс для обработчика чекбокса
  var supplyIdx = suppliesData.indexOf(order)
  tr.innerHTML = `
    <td><input type="checkbox" class="supply-checkbox" data-shipment="${esc(order.shipmentNum)}" data-index="${supplyIdx}" ${order.enabled !== false ? 'checked' : ''} onchange="toggleSupplyEnabled(${supplyIdx}, this)"></td>
    <td>${esc(displayDesc)}${descSub}</td>
    <td>${marketplaceIcon}</td>
    <td>${esc(order.storeName || '—')}</td>
    <td>${fmtSum(order.sum)}</td>
    <td class="date-cell">${formatDate(order.orderMoment)}</td>
    <td>${order.hasDemand ? esc(order.demandName || 'Есть') : '<span class="status-no">—</span>'}</td>
    <td>${esc(getSuppliesStatusText(order))}</td>
    <td class="rec-cell" title="${esc(order.recommendation)}">${esc(order.recommendation)}</td>
    <td class="action-cell">${actionsHtml}</td>
  `
  return tr
}

/**
 * Добавляет строку с поставкой в таблицу (append mode для SSE).
 * @param {Object} order - Данные поставки
 * @returns {void}
 */
function appendSuppliesRow(order) {
  const tbody = document.getElementById('suppliesTableBody')
  if (!tbody) return
  var tr = createSuppliesRow(order)
  if (tr) tbody.appendChild(tr)
}

/**
 * Рассчитывает статистику поставок по отфильтрованным данным (с учётом фильтров).
 * Включает суммы отгрузок, возвратов, отмен и калькулятор.
 * @returns {{ total: number, wb: number, ozon: number, withDemand: number, withoutDemand: number,
 *            demandSum: number, returnSum: number, cancelSum: number, errorSum: number,
 *            paymentSum: number }}
 */
function calculateSuppliesStats() {
  var data = getFilteredSuppliesData()
  var stats = {
    total: data.length, wb: 0, ozon: 0,
    withDemand: 0, withoutDemand: 0,
    demandSum: 0, returnSum: 0, cancelSum: 0,
    errorSum: 0, paymentSum: 0
  }
  data.forEach(function(o) {
    if (o.marketplace === 'wb') stats.wb++
    else if (o.marketplace === 'ozon') stats.ozon++
    var sum = Number(o.sum) || 0
    if (o.hasDemand) {
      stats.withDemand++
      stats.demandSum += sum
    } else {
      stats.withoutDemand++
    }
    // Для поставок считаем потенциальные суммы:
    // Если рекомендуется отмена — cancelSum
    if (o.recommendationType === 'action_cancel') {
      stats.cancelSum += sum
    }
    // Если рекомендуется возврат — returnSum
    if (o.recommendationType === 'action_return') {
      stats.returnSum += sum
    }
    // Если рекомендуется отгрузка — demandSum уже учтена выше
  })
  return stats
}

/**
 * Рассчитывает расхождения для поставок.
 * @returns {{ wbCount: number, ozonCount: number, cancelledOnMarketplace: number, deliveredOnMarketplace: number, totalMismatches: number }}
 */
function calculateSuppliesMismatches() {
  var data = getFilteredSuppliesData()
  var result = { wbCount: 0, ozonCount: 0, cancelledOnMarketplace: 0, deliveredOnMarketplace: 0, totalMismatches: 0 }
  data.forEach(function(o) {
    if (o.marketplace === 'wb') result.wbCount++
    else if (o.marketplace === 'ozon') result.ozonCount++
    // Отменённые на маркете, но ещё не отменённые в МС
    if (o.marketplaceIsCancelled && !o.hasDemand && !o.isCancelled) {
      result.cancelledOnMarketplace++
      result.totalMismatches++
    }
    // Доставленные на маркете, но без отгрузки в МС
    if (o.marketplaceIsDelivered && !o.hasDemand) {
      result.deliveredOnMarketplace++
      result.totalMismatches++
    }
  })
  return result
}

/**
 * Отображает блок контроля статусов для поставок.
 * @returns {void}
 */
function renderSuppliesMismatchStats() {
  const el = document.getElementById('suppliesMismatchOutput')
  if (!el) return
  var s = calculateSuppliesMismatches()

  var html = '<div class="mismatch-body">'
  html += '<div class="stat-row"><span class="stat-label">Заказы WB:</span><span class="stat-value">' + s.wbCount + '</span></div>'
  html += '<div class="stat-row"><span class="stat-label">Заказы Ozon:</span><span class="stat-value">' + s.ozonCount + '</span></div>'
  html += '<div class="mismatch-separator"></div>'

  if (s.totalMismatches > 0) {
    html += '<div class="stat-row mismatch-error"><span class="stat-label">↳ Отменён на маркете, ждёт в МС:</span><span class="stat-value">' + s.cancelledOnMarketplace + '</span></div>'
    html += '<div class="stat-row mismatch-warn"><span class="stat-label">↳ Доставлен на маркете, нет отгрузки:</span><span class="stat-value">' + s.deliveredOnMarketplace + '</span></div>'
  } else {
    html += '<div class="stat-row"><span class="stat-value mismatch-ok-text">✓ Нет расхождений</span></div>'
  }
  html += '</div>'
  el.innerHTML = html
}

/**
 * Отображает статистику поставок в элементе suppliesStatsOutput с калькулятором сумм.
 * Рассчитывает данные из calculateSuppliesStats().
 * @returns {void}
 */
function renderSuppliesStats() {
  const el = document.getElementById('suppliesStatsOutput')
  if (!el) return
  var stats = calculateSuppliesStats()

  var fmt = function(n) { return (n || 0).toLocaleString() }
  var fmtSum = function(n) { return n ? fmt(n) + ' ₽' : '-' }

  var html = ''
  html += '<div class="stat-row"><span class="stat-label">Всего:</span><span class="stat-value">' + stats.total + '</span></div>'
  html += '<div class="stat-row"><span class="stat-label">WB:</span><span class="stat-value">' + stats.wb + '</span></div>'
  html += '<div class="stat-row"><span class="stat-label">Ozon:</span><span class="stat-value">' + stats.ozon + '</span></div>'
  html += '<div class="stat-row"><span class="stat-label">С отгрузкой:</span><span class="stat-value">' + stats.withDemand + '</span><span class="stat-sum">' + fmtSum(stats.demandSum) + '</span></div>'
  html += '<div class="stat-row"><span class="stat-label">Без отгрузки:</span><span class="stat-value">' + stats.withoutDemand + '</span></div>'

  // Калькулятор
  var totalAccounted = stats.demandSum + stats.returnSum + stats.cancelSum + stats.errorSum
  var isMatch = totalAccounted > 0
  html += '<div class="calculator">'
  html += '<div class="calc-divider"></div>'
  html += '<div class="calc-formula">'
  html += '<span class="calc-sum">' + fmtSum(stats.demandSum) + '</span>'
  if (stats.returnSum > 0) html += '<span class="calc-op"> + </span><span class="calc-sum">' + fmtSum(stats.returnSum) + '</span>'
  if (stats.cancelSum > 0) html += '<span class="calc-op"> + </span><span class="calc-sum">' + fmtSum(stats.cancelSum) + '</span>'
  html += '</div>'

  el.innerHTML = html

  renderSuppliesMismatchStats()
}

// ─── Supplies Date Filter ───

/**
 * Переключает отображение попапа фильтра по дате для поставок.
 * @returns {void}
 */
function toggleSuppliesDateFilter() {
  const popup = document.getElementById('dateFilterPopupSupplies')
  if (!popup) return
  if (popup.style.display === 'block') { closeSuppliesDateFilter(); return }
  // Позиционирование как на складе (fixed, центрирован)
  popup.style.position = 'fixed'
  popup.style.top = ''
  popup.style.left = ''
  var th = document.querySelector('#tab-supplies .date-header')
  if (th) {
    var rect = th.getBoundingClientRect()
    popup.style.top = rect.bottom + 'px'
  }
  drpStateSupplies.month = dateFilterSupplies.from
    ? parseInt(dateFilterSupplies.from.split('-')[1]) - 1
    : new Date().getMonth()
  drpStateSupplies.year = dateFilterSupplies.from
    ? parseInt(dateFilterSupplies.from.split('-')[0])
    : new Date().getFullYear()
  drpUpdateDisplaySupplies()
  drpRenderSupplies()
  var overlay = document.getElementById('dateFilterOverlaySupplies')
  if (overlay) overlay.style.display = 'block'
  popup.style.display = 'block'
}

/**
 * Закрывает попап фильтра дат для поставок.
 * @returns {void}
 */
function closeSuppliesDateFilter() {
  const popup = document.getElementById('dateFilterPopupSupplies')
  const overlay = document.getElementById('dateFilterOverlaySupplies')
  if (popup) popup.style.display = 'none'
  if (overlay) overlay.style.display = 'none'
}

/**
 * Рендерит календарь date range picker для поставок.
 * @returns {void}
 */
function drpRenderSupplies() {
  const daysEl = document.getElementById('drpDaysSupplies')
  if (!daysEl) return
  var month = drpStateSupplies.month
  var year = drpStateSupplies.year
  var months = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь']
  var titleEl = document.getElementById('drpTitleSupplies')
  if (titleEl) titleEl.textContent = months[month] + ' ' + year
  
  var firstDay = new Date(year, month, 1).getDay()
  var startOffset = firstDay === 0 ? 6 : firstDay - 1
  var daysInMonth = new Date(year, month + 1, 0).getDate()
  var today = new Date()
  var todayStr = today.getFullYear() + '-' + String(today.getMonth()+1).padStart(2,'0') + '-' + String(today.getDate()).padStart(2,'0')
  
  // Даты из suppliesData
  var availSet = new Set()
  suppliesData.forEach(function(o) {
    if (o.orderMoment) availSet.add(o.orderMoment.substring(0, 10))
  })
  
  var from = dateFilterSupplies.from
  var to = dateFilterSupplies.to
  
  var html = ''
  for (var i = 0; i < startOffset; i++) html += '<span class="drp-day drp-empty"></span>'
  for (var d = 1; d <= daysInMonth; d++) {
    var ds = year + '-' + String(month+1).padStart(2,'0') + '-' + String(d).padStart(2,'0')
    var cls = 'drp-day'
    if (ds === todayStr) cls += ' drp-today'
    if (availSet.has(ds)) cls += ' drp-has'
    if (ds === from) cls += ' drp-from'
    if (ds === to) cls += ' drp-to'
    if (from && to && ds > from && ds < to) cls += ' drp-range'
    html += '<span class="' + cls + '" data-date="' + ds + '">' + d + '</span>'
  }
  daysEl.innerHTML = html
}

function drpPrevMonthSupplies() {
  drpStateSupplies.month--
  if (drpStateSupplies.month < 0) { drpStateSupplies.month = 11; drpStateSupplies.year-- }
  drpRenderSupplies()
}

function drpNextMonthSupplies() {
  drpStateSupplies.month++
  if (drpStateSupplies.month > 11) { drpStateSupplies.month = 0; drpStateSupplies.year++ }
  drpRenderSupplies()
}

function drpSelectSupplies(dateStr) {
  if (!dateFilterSupplies.from || (dateFilterSupplies.from && dateFilterSupplies.to)) {
    dateFilterSupplies.from = dateStr
    dateFilterSupplies.to = ''
  } else {
    dateFilterSupplies.to = dateStr
    if (dateFilterSupplies.to < dateFilterSupplies.from) {
      var tmp = dateFilterSupplies.from
      dateFilterSupplies.from = dateFilterSupplies.to
      dateFilterSupplies.to = tmp
    }
  }
  drpUpdateDisplaySupplies()
  drpRenderSupplies()
}

function drpUpdateDisplaySupplies() {
  var fmt = function(iso) {
    if (!iso) return ''
    var parts = iso.split('-')
    return parts[2] + '.' + parts[1] + '.' + parts[0]
  }
  var fromEl = document.getElementById('dfFromDisplaySupplies')
  var toEl = document.getElementById('dfToDisplaySupplies')
  if (fromEl) fromEl.value = fmt(dateFilterSupplies.from)
  if (toEl) toEl.value = fmt(dateFilterSupplies.to)
}

function applySuppliesDateFilter() {
  closeSuppliesDateFilter()
  renderSuppliesTable()
  renderSuppliesStats()
  var badge = document.getElementById('dateFilterBadgeSupplies')
  if (badge) badge.style.display = dateFilterSupplies.from || dateFilterSupplies.to ? 'inline-block' : 'none'
}

function resetSuppliesDateFilter() {
  dateFilterSupplies.from = ''
  dateFilterSupplies.to = ''
  drpUpdateDisplaySupplies()
  closeSuppliesDateFilter()
  renderSuppliesTable()
  renderSuppliesStats()
  var badge = document.getElementById('dateFilterBadgeSupplies')
  if (badge) badge.style.display = 'none'
}

/**
 * Обновляет блок "После сканирования" на вкладке Поставки (statsFinalOutputSupplies).
 * Показывает выполнение с таймером.
 * @param {boolean} [showTimer=true] - Показывать таймер выполнения
 * @returns {void}
 */
function hideFinalStatsSupplies(showTimer = true) {
  const container = document.getElementById('statsFinalOutputSupplies')
  if (!container) return
  if (showTimer) {
    container.classList.remove('idle')
    container.innerHTML = `
      <div class="terminal-line info">Сканирование поставок...</div>
      <div class="terminal-line time-line">Время: <span id="operationTimer">0:00</span></div>
      <div class="terminal-status">
        <div class="terminal-status-dot pulse"></div>
        <span>Обработка</span>
      </div>
    `
  } else {
    container.classList.add('idle')
    container.innerHTML = '<div class="terminal-message">Ожидание сканирования</div>'
  }
}

/**
 * Показывает результаты сканирования поставок в блоке statsFinalOutputSupplies.
 * @param {{ total?: number, created?: number, errors?: number }} stats - Статистика
 * @param {number} [elapsedTime=0] - Затраченное время в секундах
 * @returns {void}
 */
function showFinalStatsSupplies(stats = {}, elapsedTime = 0) {
  const container = document.getElementById('statsFinalOutputSupplies')
  if (!container) return
  const total = stats.total || 0
  const errors = stats.errors || 0
  const timeStr = getFormattedTime(elapsedTime)
  container.classList.remove('idle')

  var filterHtml = ''
  if (stats.filterStats) {
    filterHtml = `
    <div class="terminal-line" style="font-size:0.85em;opacity:0.7;border-top:1px solid rgba(255,255,255,0.1);padding-top:4px;margin-top:4px">
      Всего из API: ${stats.filterStats.totalFromAPI}
      | Не прошли статус: ${stats.filterStats.skippedStatus}
      | Не прошли описание: ${stats.filterStats.skippedDesc}
    </div>`
  }

  container.innerHTML = `
    <div class="terminal-line info">Сканирование завершено</div>
    <div class="terminal-line success">Найдено: ${total}</div>
    ${errors > 0 ? `<div class="terminal-line error">Ошибок: ${errors}</div>` : ''}
    <div class="terminal-line time-line">Затрачено: ${timeStr}</div>
    ${filterHtml}
    <div class="terminal-status">
      <div class="terminal-status-dot"></div>
      <span>Готово</span>
    </div>
  `
}

/**
 * Переключает индивидуальный чекбокс поставки по индексу в suppliesData.
 * @param {number} index - Индекс в suppliesData
 * @param {HTMLElement} el - DOM-элемент чекбокса
 * @returns {void}
 */
function toggleSupplyEnabled(index, el) {
  if (index >= 0 && index < suppliesData.length) {
    suppliesData[index].enabled = el.checked
  }
  renderSuppliesStats()
}

/**
 * Устанавливает состояние чекбоксов только для отфильтрованных (видимых) строк поставок.
 * Как toggleAll на вкладке Склад.
 * @param {boolean} checked - Новое состояние чекбокса
 * @returns {void}
 */
function toggleAllSupplies(checked) {
  const filtered = getFilteredSuppliesData()
  const filteredSet = new Set(filtered.map(function(o) { return o.shipmentNum }))
  suppliesData.forEach(function(o) {
    if (filteredSet.has(o.shipmentNum)) o.enabled = checked
  })
  renderSuppliesTable()
  renderSuppliesStats()
}

// ─── Фильтры таблицы поставок ───

/** @type {Object<string, boolean>} Состояние фильтра складов: storeId → true/false */
let suppliesStoreFilterActive = false
let suppliesStoreFilterState = {}

/**
 * Применяет фильтр маркетплейсов (WB/Ozon) к таблице поставок.
 * Скрывает строки, у которых маркетплейс отключён в чекбоксах.
 * @returns {void}
 */
function applySuppliesMarketplaceFilter() {
  renderSuppliesTable()
  renderSuppliesStats()
}

/**
 * Строит список чекбоксов складов в выпадающем фильтре.
 * Собирает уникальные storeId из suppliesData и обновляет #storeFilterDropdown.
 * @returns {void}
 */
function buildStoreFilterDropdown() {
  const el = document.getElementById('storeFilterDropdown')
  if (!el) return

  // Текущий фильтр маркетплейсов
  const showWb = document.getElementById('filterWb').checked
  const showOzon = document.getElementById('filterOzon').checked

  // Собираем уникальные склады только с учётом фильтра маркетплейсов
  /** @type {Object<string, {name: string, count: number}>} */
  const stores = {}
  suppliesData.forEach(function(o) {
    // Пропускаем заказы скрытые фильтром маркетплейса
    if ((o.marketplace === 'wb' && !showWb) || (o.marketplace === 'ozon' && !showOzon)) return
    const id = o.storeId || '_'
    if (!stores[id]) stores[id] = { name: o.storeName || '—', count: 0 }
    stores[id].count++
  })

  // Если фильтр ещё не инициализирован — включить все
  if (!suppliesStoreFilterActive) {
    suppliesStoreFilterState = {}
    Object.keys(stores).forEach(function(id) { suppliesStoreFilterState[id] = true })
    suppliesStoreFilterActive = true
  }

  // Сортируем: сначала WB/Ozon (по названию), потом остальные
  const sorted = Object.entries(stores).sort(function(a, b) { return a[1].name.localeCompare(b[1].name) })

  let html = '<div class="store-filter-header">Фильтр по складам</div>'
  sorted.forEach(function(entry) {
    const id = entry[0]
    const info = entry[1]
    const checked = suppliesStoreFilterState[id] !== false
    html += '<label class="store-filter-item"><input type="checkbox" data-store-id="' + id + '" ' +
      (checked ? 'checked' : '') + ' onchange="applySuppliesStoreFilter()"> ' +
      esc(info.name) + ' (' + info.count + ')</label>'
  })

  el.innerHTML = html
}

/**
 * Переключает видимость выпадающего фильтра складов.
 * @returns {void}
 */
function toggleStoreFilter() {
  const el = document.getElementById('storeFilterDropdown')
  if (!el) return
  const visible = el.style.display !== 'none'
  if (!visible) buildStoreFilterDropdown()
  el.style.display = visible ? 'none' : 'block'
}

/**
 * Возвращает отфильтрованные данные поставок (по маркетплейсу, складу, дате).
 * @returns {Array<Object>} Отфильтрованный массив
 */
function getFilteredSuppliesData() {
  var data = [...suppliesData]
  
  // Фильтр маркетплейсов
  var showWb = document.getElementById('filterWb').checked
  var showOzon = document.getElementById('filterOzon').checked
  data = data.filter(function(o) {
    if (o.marketplace === 'wb' && !showWb) return false
    if (o.marketplace === 'ozon' && !showOzon) return false
    return true
  })
  
  // Фильтр складов
  data = data.filter(function(o) {
    var storeId = o.storeId || '_'
    return suppliesStoreFilterState[storeId] !== false
  })
  
  // Фильтр даты (отдельный от склада — dateFilterSupplies)
  if (dateFilterSupplies.from || dateFilterSupplies.to) {
    data = data.filter(function(order) {
      if (!order.orderMoment) return false
      var orderDate = order.orderMoment.substring(0, 10)
      if (dateFilterSupplies.from && orderDate < dateFilterSupplies.from) return false
      if (dateFilterSupplies.to && orderDate > dateFilterSupplies.to) return false
      return true
    })
  }
  
  return data
}

/**
 * Применяет фильтр складов к таблице поставок.
 * Скрывает строки с отключёнными складами.
 * @returns {void}
 */
function applySuppliesStoreFilter() {
  // Собираем текущее состояние чекбоксов
  document.querySelectorAll('#storeFilterDropdown input[data-store-id]').forEach(function(cb) {
    suppliesStoreFilterState[cb.dataset.storeId] = cb.checked
  })
  renderSuppliesTable()
  renderSuppliesStats()
}

// Клик вне дропдауна складов — закрыть
document.addEventListener('click', function(e) {
  const dd = document.getElementById('storeFilterDropdown')
  if (dd && dd.style.display !== 'none') {
    const trigger = document.querySelector('.store-filter-trigger')
    if (!e.target.closest('.store-header')) {
      dd.style.display = 'none'
    }
  }
})

/**
 * Выполняет массовую операцию над выбранными поставками.
 * Собирает отмеченные shipment-ы и отправляет POST /api/batch/stream.
 *
 * @async
 * @param {string} action - Тип действия ('demand' | 'cancel' | 'return')
 * @returns {Promise<void>}
 */
async function supplyBatchAction(action) {
  const token = loadToken()
  if (!token) {
    showStatus('Ошибка: Токен МС не найден.')
    return
  }

  // Берём только отфильтрованные + отмеченные чекбоксами (как в Складе)
  let filtered = getFilteredSuppliesData().filter(function(o) { return o.enabled !== false })

  // Для массовой отгрузки Озон — пропускаем заказы со статусом "Ожидает упаковки"
  if (action === 'demand') {
    filtered = filtered.filter(function(o) {
      return !(o.marketplace === 'ozon' && o.marketplaceStatus === 'awaiting_packaging')
    })
  }

  // Отправляем только те заказы, которые реально можно обработать (уже проверено decision matrix supplies.js).
  // Сервер всё равно перепроверяет через checkOrder, но это избегает лишних API-запросов
  // и путаницы, когда на сервере заказ не находится по номеру отправления.
  if (action === 'cancel') {
    filtered = filtered.filter(function(o) { return o.canCancel === true })
  } else if (action === 'demand') {
    filtered = filtered.filter(function(o) { return o.canDemand === true })
  }

  const numbers = filtered.map(function(o) { return o.shipmentNum })

  if (numbers.length === 0) {
    showStatus('Нет отмеченных поставок')
    return
  }

  showProgress(true)
  startOperationTimer()

  const abortId = Math.random().toString(36).substring(2, 15)

  try {
    const response = await fetch('/api/batch/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: token,
        numbers: numbers,
        action: action,
        abortId: abortId
      })
    })

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}))
      hideProgress(false, errData.error || 'Ошибка')
      return
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const data = JSON.parse(line.slice(6))

            if (data.type === 'progress') {
              document.getElementById('statusText').textContent =
                `Обработано ${data.index}/${data.total}`
            } else if (data.type === 'done') {
              const elapsed = stopOperationTimer()
              const stats = data.stats || { created: 0, skipped: 0, errors: 0 }
              hideProgress(true, 'Готово: ' + stats.created)
              // Показываем результат в панели поставок (не в statsFinalOutput Склада)
              var suppliesFinalEl = document.getElementById('statsFinalOutputSupplies')
              if (suppliesFinalEl) {
                suppliesFinalEl.classList.remove('idle')
                suppliesFinalEl.innerHTML =
                  '<div class="terminal-line info">Массовая операция: ' + (stats.created > 0 ? 'выполнена' : 'завершена') + '</div>' +
                  '<div class="terminal-line success">Создано: ' + stats.created + '</div>' +
                  '<div class="terminal-line warning">Пропущено: ' + stats.skipped + '</div>' +
                  (stats.errors > 0 ? '<div class="terminal-line error">Ошибок: ' + stats.errors + '</div>' : '') +
                  '<div class="terminal-line time-line">Затрачено: ' + getFormattedTime(elapsed) + '</div>'
              }
              // Обновить статистику поставок после массовой операции
              renderSuppliesStats()
            } else if (data.type === 'aborted') {
              const elapsed = stopOperationTimer()
              hideProgress(false, 'Прервано')
            } else if (data.type === 'error') {
              hideProgress(false, data.error || 'Ошибка')
              return
            }
          } catch (e) {
            console.error('Supply batch SSE parse error:', e)
          }
        }
      }
    }
  } catch (e) {
    hideProgress(false, 'Ошибка: ' + e.message)
    stopOperationTimer()
  }
}

/**
 * Выполняет одиночное действие над поставкой (отгрузка/отмена/возврат).
 * Отправляет POST /api/batch/stream с одним номером или вызывает
 * соответствующий эндпоинт.
 *
 * @async
 * @param {string} shipmentNum - Номер отгрузки
 * @param {string} action - Тип действия ('demand' | 'cancel' | 'return')
 * @returns {Promise<void>}
 */
async function supplySingleAction(shipmentNum, action) {
  const token = loadToken()
  if (!token) {
    showStatus('Ошибка: Токен МС не найден.')
    return
  }

  showProgress(true)
  startOperationTimer()

  try {
    const response = await fetch('/api/batch/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: token,
        numbers: [shipmentNum],
        action: action
      })
    })

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}))
      hideProgress(false, errData.error || 'Ошибка')
      return
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const data = JSON.parse(line.slice(6))

            if (data.type === 'progress') {
              document.getElementById('statusText').textContent =
                `Обработка: ${shipmentNum} — ${data.result?.status || ''}`
            } else if (data.type === 'done') {
              const elapsed = stopOperationTimer()
              const stats = data.stats || { created: 0, skipped: 0, errors: 0 }
              hideProgress(true, 'Готово')
              showBatchResults(stats, elapsed)

              // Заказ обработан — удаляем из таблицы поставок и обновляем UI
              if (stats.errors === 0 && suppliesData.length > 0) {
                var actionLabel = action === 'cancel' ? 'Отменён' : action === 'demand' ? 'Отгружен' : 'Обработан'
                suppliesData = suppliesData.filter(function(o) {
                  return o.shipmentNum !== shipmentNum
                })
                saveSuppliesState()
                renderSuppliesTable()
                renderSuppliesStats()

                var statusEl = document.getElementById('statusText')
                if (statusEl) statusEl.textContent = 'Заказ ' + shipmentNum + ' ' + actionLabel.toLowerCase() + '. Осталось: ' + suppliesData.length
              }
            } else if (data.type === 'aborted') {
              stopOperationTimer()
              hideProgress(false, 'Прервано')
            } else if (data.type === 'error') {
              hideProgress(false, data.error || 'Ошибка')
              stopOperationTimer()
              return
            }
          } catch (e) {
            console.error('Supply single SSE parse error:', e)
          }
        }
      }
    }
  } catch (e) {
    hideProgress(false, 'Ошибка: ' + e.message)
    stopOperationTimer()
  }
}

