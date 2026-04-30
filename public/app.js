// Frontend логика

let ordersData = []
let currentPage = 0
const PAGE_SIZE = 1000
let ordersState = {}
let currentSort = { column: 'shipmentNum', asc: true }
let currentController = null
let isWorking = false
let realtimeMode = false // Флаг для realtime добавления строк без перерисовки
let serverCheckTimer = null // Для cleanup таймера
let currentDuplicates = 0 // Счётчик дублей

// Custom confirm dialog
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

function updateTimerDisplay(timeStr) {
  const timerEl = document.getElementById('operationTimer')
  if (timerEl) timerEl.textContent = timeStr
}

function getFormattedTime(seconds) {
  const mins = Math.floor(seconds / 60)
  const secs = seconds % 60
  return `${mins}:${secs.toString().padStart(2, '0')}`
}

// Check if order was already processed
function isOrderProcessed(shipmentNum) {
  const state = ordersState[shipmentNum]
  if (!state || !state.lastAction) return false
  const processedActions = ['payment_created', 'demand_created', 'return_created', 'order_cancelled']
  return processedActions.includes(state.lastAction)
}

// ===== Функции для блока "После действий" =====

// Показать результаты массовой операции
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

// Показать результаты сканирования
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

// Скрыть блок "После действий"
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

// Load token
function loadToken() {
  const saved = localStorage.getItem('moyskladToken')
  if (saved) document.getElementById('tokenInput').value = saved
  return saved
}

function saveToken() {
  const token = document.getElementById('tokenInput').value.trim()
  localStorage.setItem('moyskladToken', token)
  showStatus('Токен сохранён')
  return token
}

// Load orders state
async function loadOrdersState() {
  try {
    const response = await fetch('/api/orders-state')
    ordersState = await response.json()
  } catch (e) {
    console.error('Error loading orders state:', e)
  }
}

// Save order action (payment, demand, return, cancel)
async function saveOrderAction(shipmentNum, action, result) {
  try {
    await fetch('/api/orders-state', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ shipmentNum, action, result })
    })
  } catch (e) {
    console.error('Error saving order action:', e)
  }
}

// Save current scan to server (replaces previous)
async function saveScanState() {
  if (!ordersData || ordersData.length === 0) {
    showStatus('Нет данных для сохранения')
    return
  }
  try {
    // Убираем тяжёлые поля перед отправкой
    const lightOrders = ordersData.map(order => {
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

// Save silently - without alerts
async function saveScanStateSilent() {
  if (!ordersData || ordersData.length === 0) return
  try {
    // Убираем тяжёлые поля перед отправкой
    const lightOrders = ordersData.map(order => {
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

function parseNumbers() {
  const text = document.getElementById('numbersInput').value
  return [...new Set(text.split('\n').map(l => l.trim()).filter(l => l))]
}

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
      shipmentNum,
      enabled: true,
      orderName: state.orderName || null,
      sum: state.sum || 0,
      paid: state.paid || 0,
      status: state.status || 'saved',
      statusName: state.statusName || 'Сохранено',
      canCreate: state.canCreate || false,
      orderId: state.orderId || null,
      orderUrl: state.orderUrl || null,
      hasDemand: state.hasDemand || false,
      hasPayment: state.hasPayment || false,
      hasReturn: state.hasReturn || false,
      isCancelled: state.isCancelled || false,
      demandName: state.demandName || null,
      paymentName: state.paymentName || null,
      returnName: state.returnName || null,
      orderPositions: state.orderPositions || [],
      demandPositions: state.demandPositions || []
    })
  }
  return savedOrders
}

function loadSavedOrdersAndRender() {
  currentPage = 0
  loadOrdersState().then(() => {
    loadSavedOrders().then(function(orders) {
      ordersData = orders
      renderTable()
      updateTotals()
      renderCurrentStats()
      saveLastActionStats()
    })
  })
}

// Sort table
function sortTable(column) {
  if (currentSort.column === column) {
    currentSort.asc = !currentSort.asc
  } else {
    currentSort.column = column
    currentSort.asc = true
  }
  renderTable()
  updateSortIndicators()
}

function updateSortIndicators() {
  document.querySelectorAll('th').forEach(th => {
    th.classList.remove('asc', 'desc')
  })
  const th = document.querySelector(`th[onclick="sortTable('${currentSort.column}')"]`)
  if (th) th.classList.add(currentSort.asc ? 'asc' : 'desc')
}

function getSortedOrders() {
  const col = currentSort.column
  const asc = currentSort.asc

  return [...ordersData].sort((a, b) => {
    let va, vb

    if (col === 'hasDemand' || col === 'hasPayment' || col === 'hasReturn' || col === 'isCancelled') {
      // Сортировка по статусу: false < true
      va = a[col] ? 1 : 0
      vb = b[col] ? 1 : 0
    } else if (col === 'sum') {
      va = Number(a.sum) || 0
      vb = Number(b.sum) || 0
    } else {
      va = String(a[col] || '').toLowerCase()
      vb = String(b[col] || '').toLowerCase()
    }

    if (va < vb) return asc ? -1 : 1
    if (va > vb) return asc ? 1 : -1
    return 0
  })
}

// Toggle all checkboxes
function toggleAll(checked) {
  ordersData.forEach(o => o.enabled = checked)
  renderTable()
}

function toggleEnabled(index) {
  ordersData[index].enabled = !ordersData[index].enabled
  updateTotals()
}

// Check numbers
async function checkNumbers() {
  const text = document.getElementById('numbersInput').value
    
  // Подсчёт дублей (до уникализации)
  const lines = text.split('\n').map(l => l.trim()).filter(l => l)
  currentDuplicates = lines.length - new Set(lines).size
    
  const numbers = [...new Set(lines)]
    
  if (numbers.length === 0) { showStatus('Введите номера'); return }

  const token = loadToken()

  await loadOrdersState()

  const checkBtn = document.querySelector('#numbersInput + .button-row button')
  const abortBtn = document.getElementById('abortBtn')
  checkBtn.disabled = true
  checkBtn.textContent = ''
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

  try {
    // Создаём AbortController и AbortId для сервера
    currentController = new AbortController()
    const abortId = Math.random().toString(36).substring(2, 15)
    window.__currentAbortId = abortId // Сохраняем для abortCheck()
        
    // SSE URL с параметрами
    const numbersParam = encodeURIComponent(numbers.join(','))
    const url = `/api/process/stream?token=${encodeURIComponent(token)}&numbers=${numbersParam}&abortId=${abortId}`
        
    const response = await fetch(url, {
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
              console.log('SSE progress:', order.shipmentNum, 'positions:', order.orderPositions?.length)
                            
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

              // Небольшая задержка для визуализации (30ms)
              await new Promise(r => setTimeout(r, 30))
                            
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
               showScanResults({
                 processed: totalNumbers,
                 found: ordersData.length,
                 errors: errors
               }, elapsed)
               
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
               showScanResults({
                 processed: data.processed,
                 found: ordersData.length,
                 errors: 0
               }, elapsed)
               
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
    if (e.name === 'AbortError') {
      hideProgress(false, 'Прервано')
      stopOperationTimer()
    } else {
      hideProgress(false, 'Ошибка: ' + e.message)
      stopOperationTimer()
    }
} finally {
     // Отключаем realtime режим
     realtimeMode = false
     renderTable()
         
     checkBtn.disabled = false
     checkBtn.textContent = 'Сканировать'
     abortBtn.style.display = 'none'
     isWorking = false
         
     // Очищаем abortId
     window.__currentAbortId = null
         
     // Убираем анимацию сканирования (гарантированно)
     document.querySelector('.stats-final')?.classList.remove('scanning')
   }
}

function abortCheck() {
  if (currentController) {
    currentController.abort()
    // Также уведомляем сервер для быстрого прекращения
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

// Get action buttons for row
function getRowActions(order, index) {
  // Use properties directly from order (comes from server, verified in Moysklad)
  const hasD = order.hasDemand
  const hasPayment = order.hasPayment
  const hasR = order.hasReturn
  const isCancelled = order.isCancelled
    
  let btns = ''

  // Demand - создать отгрузку (если её нет и заказ не отменён)
  btns += `<button class="action-btn demand" onclick="createDemandByNum('${order.shipmentNum}')" title="${hasD ? 'Отгрузка есть' : 'Создать отгрузку'}" ${hasD || isCancelled ? 'disabled' : ''}>📦</button>`

  // Payment - создать платёж (если есть отгрузка, нет оплаты и нет возврата)
  btns += `<button class="action-btn success" onclick="createPaymentByNum('${order.shipmentNum}')" title="${hasPayment ? 'Оплачено' : 'Создать платёж'}" ${hasPayment || isCancelled || !hasD || hasR ? 'disabled' : ''}>💰</button>`

  // Return - возврат (если есть отгрузка, возврат не создан, заказ не отменён)
  btns += `<button class="action-btn return" onclick="createReturnByNum('${order.shipmentNum}')" title="${hasR ? 'Возврат есть' : 'Создать возврат'}" ${hasR || isCancelled || !hasD ? 'disabled' : ''}>↩</button>`

  // Cancel - отмена (только если нет отгрузки и не отменён)
  const canCancel = !hasD && !isCancelled
  btns += `<button class="action-btn cancel" onclick="cancelOrderByNum('${order.shipmentNum}')" title="Отменить заказ" ${canCancel ? '' : 'disabled'}>✗</button>`

  return btns
}

// Render table
function renderTable() {
  // Пропускаем если в realtime режиме - строки добавляются отдельно
  if (realtimeMode) {
    console.log('DEBUG renderTable skipped, realtimeMode=true')
    return
  }
    
  const tbody = document.getElementById('tableBody')
  if (!tbody) return
  tbody.innerHTML = ''

  const sorted = getSortedOrders()
  console.log('Rendering table, orders count:', sorted.length)
  const start = currentPage * PAGE_SIZE
  const end = start + PAGE_SIZE
  const pageOrders = sorted.slice(start, end)

  if (pageOrders.length === 0) {
    tbody.innerHTML = '<tr><td colspan="10" class="empty">Нет данных для текущей страницы</td></tr>'
    return
  }

  pageOrders.forEach((order, i) => {
    const tr = document.createElement('tr')
    // Используем индекс внутри всей таблицы
    const actualIndex = ordersData.findIndex(o => o.shipmentNum === order.shipmentNum)

    // Номера документов
    const demandDisplay = order.demandName ? `<span class="demand-code">${order.demandName}</span>` : '<span class="status-no">—</span>'
    const paymentDisplay = order.paymentName ? `<span class="doc-number">${order.paymentName}</span>` : '<span class="status-no">—</span>'
    const returnDisplay = order.returnName ? `<span class="doc-number">${order.returnName}</span>` : '<span class="status-no">—</span>'

    // Статус документа - показываем directly из API statusName
    let statusDisplay = ''
    const statusName = order.statusName || ''
    const status = order.status || ''

    // Просто показываем статус из API
    let cssClass = 'status-no'
    if (status === 'return' || statusName.includes('Возврат')) cssClass = 'status-return'
    else if (status === 'cancelled' || statusName.includes('Отмен')) cssClass = 'status-error'
    else if (status === 'shipped' || statusName.includes('Оплач') || statusName.includes('Отгруж')) cssClass = 'status-shipped'
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

    // Статус заказа
    let statusClass = 'status-other'
    let statusText = order.statusName || 'Новый'
    if (order.status === 'shipped') { statusClass = 'status-shipped'; statusText = 'Отгружен' }
    else if (order.status === 'delayed') { statusClass = 'status-delayed'; statusText = 'С отсрочкой' }
    else if (order.hasReturn) { statusClass = 'status-return'; statusText = 'Возврат' }
    else if (order.isCancelled) { statusClass = 'status-error'; statusText = 'Отменён' }
    else if (order.status === 'cancelled') { statusClass = 'status-error'; statusText = 'Отменён' }
    else if (order.statusName && order.statusName.includes('Отмен')) { statusClass = 'status-error'; statusText = 'Отменён' }
    else if (order.statusName && order.statusName.includes('Возврат')) { statusClass = 'status-return'; statusText = 'Возврат' }

    tr.innerHTML = `
            <td><input type="checkbox" ${order.enabled ? 'checked' : ''} onchange="toggleEnabled(${actualIndex})"></td>
            <td class="order-num">${order.extractedShipmentNum || order.shipmentNum}</td>
<td class="order-name-cell">${order.orderName || '—'}</td>
            <td>${order.sum} ₽</td>
            <td>${order.paid} ₽</td>
            <td>${demandDisplay}</td>
            <td>${paymentDisplay}</td>
            <td>${returnDisplay}</td>
            <td>${statusDisplay}</td>
            <td>${getRowActions(order, actualIndex)}</td>
        `

    tbody.appendChild(tr)

    // Дополнительная секция с деталями позиций заказа
    const orderPos = order.orderPositions || []
    const demandPos = order.demandPositions || []
    const allPositions = [...orderPos, ...demandPos]

    if (allPositions.length > 0) {
      const posTr = document.createElement('tr')
      posTr.className = 'positions-row'
      const cells = '<td colspan="10" class="positions-cell">' +
                 allPositions.map(p => {
                  const code = p.code ? `[${p.code}] ` : ''
                  const name = p.name || 'Наименование'
                  const price = p.price != null ? p.price : 0
                  const qty = p.quantity != null ? p.quantity : 0
                  const sum = p.sum != null ? p.sum : (price * qty)
                  const printBtn = p.code ?
                    `<button class="print-btn" onclick="printSticker('${(p.code || '').replace(/'/g, "\\'")}')" title="Печать стикера">🖨️</button>` : ''
                  return `<div>${code}${name} — ${price} ₽ × ${qty} = ${sum} ₽ ${printBtn}</div>`
                }).join('') + '</td>'
      posTr.innerHTML = cells
      tbody.appendChild(posTr)
    }
  })

  renderPaginationInfo(sorted.length)
}

// Добавить одну строку в таблицу (append mode для realtime)
function appendOrderRow(order) {
  console.log('DEBUG appendOrderRow called for:', order.shipmentNum)
  const tbody = document.getElementById('tableBody')
  if (!tbody) {
    console.error('tableBody not found!')
    return
  }
  console.log('DEBUG tbody rows before:', tbody.children.length)
  const actualIndex = ordersData.findIndex(o => o.shipmentNum === order.shipmentNum)

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
  else if (status === 'shipped' || statusName.includes('Оплач') || statusName.includes('Отгруж')) cssClass = 'status-shipped'
  else if (status === 'delayed' || statusName.includes('отсрочк')) cssClass = 'status-delayed'

  const demandDisplay = order.demandName ? `<span class="demand-code">${order.demandName}</span>` : '<span class="status-no">—</span>'
  const paymentDisplay = order.paymentName ? `<span class="doc-number">${order.paymentName}</span>` : '<span class="status-no">—</span>'
  const returnDisplay = order.returnName ? `<span class="doc-number">${order.returnName}</span>` : '<span class="status-no">—</span>'
  const displayText = statusName || 'Новый'
  const statusDisplay = '<span class="' + cssClass + '">' + displayText + '</span>'

  tr.innerHTML = `
        <td><input type="checkbox" ${order.enabled ? 'checked' : ''} onchange="toggleEnabled(${actualIndex})"></td>
        <td class="order-num">${order.extractedShipmentNum || order.shipmentNum}</td>
        <td class="order-name-cell">${order.orderName || '—'}</td>
        <td>${order.sum} ₽</td>
        <td>${order.paid} ₽</td>
        <td>${demandDisplay}</td>
        <td>${paymentDisplay}</td>
        <td>${returnDisplay}</td>
        <td>${statusDisplay}</td>
        <td>${getRowActions(order, actualIndex)}</td>
    `

  // Добавляем строку в конец таблицы
  tbody.appendChild(tr)

  // Дополнительная секция с деталями позиций заказа (для SSE режима)
  const orderPos = order.orderPositions || []
  const demandPos = order.demandPositions || []
  const allPositions = [...orderPos, ...demandPos]

  if (allPositions.length > 0) {
    const posTr = document.createElement('tr')
    posTr.className = 'positions-row'
    const cells = '<td colspan="10" class="positions-cell">' +
      allPositions.map(p => {
        const code = p.code ? `[${p.code}] ` : ''
        const name = p.name || 'Наименование'
        const price = p.price != null ? p.price : 0
        const qty = p.quantity != null ? p.quantity : 0
        const sum = p.sum != null ? p.sum : (price * qty)
        const printBtn = p.code ?
          `<button class="print-btn" onclick="printSticker('${(p.code || '').replace(/'/g, "\\'")}')" title="Печать стикера">🖨️</button>` : ''
        return `<div>${code}${name} — ${price} ₽ × ${qty} = ${sum} ₽ ${printBtn}</div>`
      }).join('') + '</td>'
    posTr.innerHTML = cells
    tbody.appendChild(posTr)
  }
}

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

function goPrevPage() {
  if (currentPage > 0) {
    currentPage--
    renderTable()
  }
}

function goNextPage() {
  const totalPages = Math.max(1, Math.ceil(ordersData.length / PAGE_SIZE))
  if (currentPage < totalPages - 1) {
    currentPage++
    renderTable()
  }
}

function updateTotals() {
  const enabled = ordersData.filter(o => o.enabled)
  const toCreate = enabled.filter(o => o.hasDemand && !o.hasPayment).length
  const totalSum = enabled.reduce((sum, o) => sum + (Number(o.sum) || 0), 0)

  const totalCountEl = document.getElementById('totalCount')
  const toCreateCountEl = document.getElementById('toCreateCount')
  const totalSumEl = document.getElementById('totalSum')
    
  if (totalCountEl) totalCountEl.textContent = enabled.length
  if (toCreateCountEl) toCreateCountEl.textContent = toCreate
  if (totalSumEl) totalSumEl.textContent = totalSum.toLocaleString() + ' ₽'
    
  // Не перерисовываем таблицу в realtime режиме
  if (!realtimeMode) renderTable()
}

// Calculate statistics
function calculateStats(orderList) {
  const list = orderList || ordersData
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
    cancelledSum_C: 0,
  }
    
  list.forEach(o => {
    const sum = Number(o.sum) || 0
    if (o.hasDemand) {
      stats.demandCount++
      stats.demandSum += sum
    }
    if (o.hasPayment) {
      stats.paymentCount++
      stats.paymentSum += sum
    }
    if (o.hasReturn) {
      stats.returnCount++
      stats.returnSum += sum
    }
    if (o.isCancelled) {
      stats.cancelledCount++
      stats.cancelledSum += sum
    }
    if (o.lastAction && o.lastAction.includes('_error')) {
      stats.errorCount++
    }
        
    // Вариант A: Раздельный (oba mogut byt true)
    if (o.hasReturn) {
      stats.returnCount_A++
      stats.returnSum_A += sum
    }
    if (o.isCancelled) {
      stats.cancelledCount_A++
      stats.cancelledSum_A += sum
    }
        
    // Вариант B: Return imeet prioritet
    if (o.hasReturn) {
      stats.returnCount_B++
      stats.returnSum_B += sum
    } else if (o.isCancelled) {
      stats.cancelledCount_B++
      stats.cancelledSum_B += sum
    }
        
    // Ваriant C: Otmena imeet prioritet
    if (o.isCancelled) {
      stats.cancelledCount_C++
      stats.cancelledSum_C += sum
    } else if (o.hasReturn) {
      stats.returnCount_C++
      stats.returnSum_C += sum
    }
  })
    
  return stats
}

// Render current stats
// force - принудительно обновить даже в realtime режиме
function renderCurrentStats(force = false) {
  // Не перерисовываем таблицу в realtime режиме (кроме случая force)
  if (realtimeMode && !force) return
    
  console.log('DEBUG renderCurrentStats called, ordersData length:', ordersData?.length)
  try {
    const stats = calculateStats()
    console.log('DEBUG stats:', stats)
    const container = document.getElementById('statsOutput')
    console.log('DEBUG container:', container)
    if (!container) {
      console.log('DEBUG: statsOutput not found')
      return
    }
        
    const fmt = n => n.toLocaleString()
    const fmtSum = n => (n && n > 0) ? fmt(n) + ' ₽' : '-'
    // Для Возвратов - всегда показывать сумму (без прочерка)
    const fmtReturnSum = n => n ? fmt(n) + ' ₽' : '-'
        
    const demandSum = stats.demandSum || 0
    const returnSum = stats.returnSum_C || 0
    const cancelledSum = stats.cancelledSum_C || 0
    const paymentSum = stats.paymentSum || 0
        
    const expectedPayment = demandSum - returnSum - cancelledSum
    const isMatch = Math.abs(paymentSum - expectedPayment) < 1
    const matchIcon = isMatch ? '✓' : '✗'
    const matchClass = isMatch ? 'success' : 'error'
        
    container.innerHTML = `
            <div class="stat-row"><span class="stat-label">Отгрузок:</span><span class="stat-value success">${stats.demandCount || 0}</span><span class="stat-sum">${fmtSum(demandSum)}</span></div>
            <div class="stat-row"><span class="stat-label">Оплачено:</span><span class="stat-value success">${stats.paymentCount || 0}</span><span class="stat-sum">${fmtSum(paymentSum)}</span></div>
            <div class="stat-row"><span class="stat-label">Возвратов:</span><span class="stat-value">${stats.returnCount_C || 0}</span><span class="stat-sum">${fmtReturnSum(returnSum)}</span></div>
            <div class="stat-row"><span class="stat-label">Отменено:</span><span class="stat-value error">${stats.cancelledCount_C || 0}</span><span class="stat-sum">${fmtSum(cancelledSum)}</span></div>
            <div class="stat-row"><span class="stat-label">Ошибок:</span><span class="stat-value error">${stats.errorCount || 0}</span><span class="stat-sum">-</span></div>
            ${currentDuplicates > 0 ? `<div class="stat-row"><span class="stat-label">Дублей:</span><span class="stat-value duplicates">${currentDuplicates}</span><span class="stat-sum">-</span></div>` : ''}
            <div class="calculator">
                <div class="calc-divider"></div>
                <div class="calc-formula">
                    <span class="calc-sum">${fmtSum(demandSum)}</span>
                    <span class="calc-op"> − </span>
                    <span class="calc-sum">${fmtSum(returnSum)}</span>
                    <span class="calc-op"> − </span>
                    <span class="calc-sum">${fmtSum(cancelledSum)}</span>
                </div>
                <div class="calc-formula">
                    <span class="calc-op">= </span>
                    <span class="calc-sum">${fmtSum(expectedPayment)}</span>
                    <span class="calc-op"> → </span>
                    <span class="calc-sum">${fmtSum(paymentSum)}</span>
                    <span class="calc-icon ${matchClass}">${matchIcon}</span>
                </div>
            </div>
        `
  } catch (e) {
    console.log('DEBUG renderCurrentStats error:', e.message, e.stack)
  }
}

// Last action stats for comparison
let lastActionStats = null

function saveLastActionStats() {
  lastActionStats = calculateStats()
}

function renderFinalStats() {
  const container = document.getElementById('statsFinalOutput')
  if (!container) return
    
  const now = calculateStats()
  const was = lastActionStats
    
  if (!was) {
    container.innerHTML = '<div class="stat-row"><span class="stat-label">Нет данных</span></div>'
    return
  }
    
  const fmt = n => n.toLocaleString()
    
  const diff = (label, wasVal, nowVal, isCount) => {
    const diffVal = nowVal - wasVal
    const cls = diffVal > 0 ? 'success' : (diffVal < 0 ? 'error' : '')
    const arrow = diffVal > 0 ? '↑' : (diffVal < 0 ? '↓' : '—')
    return `<div class="stat-row"><span class="stat-label">${label}:</span><span class="stat-value ${cls}">${fmt(wasVal)} → ${fmt(nowVal)} ${arrow}</span></div>`
  }
    
  container.innerHTML = `
        <div class="stat-section-title">Вариант А (Раздельный):</div>
        ${diff('Возвратов', was.returnCount_A, now.returnCount_A)}
        ${diff('Отменено', was.cancelledCount_A, now.cancelledCount_A)}
        
        <div class="stat-section-title">Вариант B (Return приоритет):</div>
        ${diff('Возвратов', was.returnCount_B, now.returnCount_B)}
        ${diff('Отменено', was.cancelledCount_B, now.cancelledCount_B)}
        
        <div class="stat-section-title">Вариант C (Отмена приоритет):</div>
        ${diff('Возвратов', was.returnCount_C, now.returnCount_C)}
        ${diff('Отменено', was.cancelledCount_C, now.cancelledCount_C)}
    `
}

// Single order actions
async function createPaymentByNum(shipmentNum) {
  await createSingleAction(shipmentNum, 'payment')
}

async function createDemandByNum(shipmentNum) {
  await createSingleAction(shipmentNum, 'demand')
}

async function createReturnByNum(shipmentNum) {
  await createSingleAction(shipmentNum, 'return')
}

async function cancelOrderByNum(shipmentNum) {
  await createSingleAction(shipmentNum, 'cancel')
}

// Print sticker for product by code
async function printSticker(code) {
  const token = document.getElementById('tokenInput').value.trim()
  
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

async function createSingleAction(shipmentNum, actionType) {
  const token = saveToken()
  if (!token) { alert('Введите токен API'); return }

  showProgress(true)

  // Правильное маппирование endpoint-ов
  const endpointMap = {
    demand: '/api/create-demand',
    payment: '/api/create-payment',
    return: '/api/create-return',
    cancel: '/api/cancel-order'  // ✅ Правильный endpoint для отмены
  }
  const endpoint = endpointMap[actionType] || `/api/create-${actionType}`

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Token': token },
      body: JSON.stringify({ shipmentNum })
    })

    const data = await response.json()

    if (data.error) {
      hideProgress(false, 'Ошибка')
      await saveOrderAction(shipmentNum, `${actionType}_error`, data.error)
      alert('Ошибка: ' + data.error)
    } else {
      const successNames = { payment: 'Платёж', demand: 'Отгрузка', return: 'Возврат', cancel: 'Заказ' }
      const resultName = data.paymentName || data.demandName || data.returnName || 'успешно'
      hideProgress(true, `${successNames[actionType]} создан`)
      await saveOrderAction(shipmentNum, `${actionType}_created`, resultName)

      // Обновляем статус заказа прямо в таблице
      const orderIndex = ordersData.findIndex(o => o.shipmentNum === shipmentNum)
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
          saveOrderAction(data.shipmentNum, 'return_created', data.returnName)
        } else if (actionType === 'cancel') {
          ordersData[orderIndex].isCancelled = true
          ordersData[orderIndex].statusName = 'Отменён'
          saveOrderAction(data.shipmentNum, 'order_cancelled', 'ok')
        }
        ordersData[orderIndex].lastAction = `${actionType}_created`
                
        // Сохраняем действие
        saveOrderAction(data.shipmentNum, `${actionType}_created`, data.returnName || data.demandName || 'ok')
                
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

// Refresh specific orders data after batch operation
async function refreshSpecificOrders(numbers) {
  const token = document.getElementById('tokenInput').value.trim()
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
              const index = ordersData.findIndex(o => o.shipmentNum === order.shipmentNum)
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

// Batch action with SSE streaming
async function batchAction(actionType) {
   const token = saveToken()
   if (!token) { alert('Введите токен API'); return }

   const actionNames = { demand: 'отгрузки', payment: 'платежи', return: 'возвраты', cancel: 'отмены' }
   if (!await showConfirm(`Создать ${actionNames[actionType]} для отмеченных?`)) return

   const orders = ordersData.filter(o => o.enabled)
   if (orders.length === 0) { alert('Нет отмеченных заказов'); return }

   showProgress(true)
   const numbers = orders.map(o => o.shipmentNum)
  
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
         
     // SSE URL с параметрами
     const numbersParam = encodeURIComponent(numbers.join(','))
     const url = `/api/batch/stream?token=${encodeURIComponent(token)}&numbers=${numbersParam}&action=${actionType}&abortId=${abortId}`
         
     const response = await fetch(url, {
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
              const orderIndex = ordersData.findIndex(o => o.shipmentNum === result.shipmentNum)
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
                  saveOrderAction(result.shipmentNum, 'return_created', result.returnName)
                } else if (actionType === 'cancel') {
                  ordersData[orderIndex].isCancelled = true
                  ordersData[orderIndex].statusName = 'Отменён'
                  ordersData[orderIndex].lastAction = 'order_cancelled'
                  saveOrderAction(result.shipmentNum, 'order_cancelled', 'success')
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

              // Небольшая задержка для визуализации
              await new Promise(r => setTimeout(r, 50))
                            
} else if (data.type === 'done') {
                const stats = data.stats || { created, skipped, errors }
                                
                // Останавливаем секундомер
                const elapsed = stopOperationTimer()
                                
                // Собираем все изменённые номера (успех + ошибки)
                const processedNumbers = data.orders
                  .filter(o => o.status === 'created' || o.status === 'error')
                  .map(o => o.shipmentNum)
                
                if (processedNumbers.length > 0) {
                  // Обновляем только изменённые заказы актуальными данными
                  await refreshSpecificOrders(processedNumbers)
                } else {
                  // Если нет изменённых, просто обновляем статистику
                  realtimeMode = false
                  updateTotals()
                  renderCurrentStats()
                }
                
                saveLastActionStats()
                hideProgress(true, `Создано: ${stats.created}, пропущено: ${stats.skipped}, ошибок: ${stats.errors}`)
                                
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

async function createAllDemands() { batchAction('demand') }
async function createAllPayments() { batchAction('payment') }

// Progress
function showProgress(working = true) {
  const container = document.getElementById('progressContainer')
  const bar = document.getElementById('progressBar')
  const statusText = document.getElementById('statusText')

  container.classList.add('active')
  bar.className = 'progress-bar' + (working ? ' working' : '')
  statusText.textContent = working ? 'Работает...' : 'Завершение...'
}

function showStatus(message) {
  const statusText = document.getElementById('statusText')
  statusText.textContent = message
  console.log('STATUS:', message)
}

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

// Start server (new console)
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

// Restart server
async function restartServer() {
  if (!await showConfirm('Перезапустить сервер?')) return

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

// Logs
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

    const lines = data.logs.split('\n').filter(l => l).slice(-50)
    consoleEl.innerHTML = lines.map(line => {
      const timeMatch = line.match(/^\[(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\]/)
      const time = timeMatch ? timeMatch[1] : ''
      let content = line.replace(/^\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\]\s*/, '')
      let cls = 'log-info'
      if (content.includes('error') || content.includes('Ошибка')) cls = 'log-error'
      else if (content.includes('создан') || content.includes('Завершено')) cls = 'log-success'
      else if (content.includes('===')) cls = 'log-warn'
      return `<div><span class="log-time">${time}</span> <span class="${cls}">${content}</span></div>`
    }).join('')

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
})

// Очистка сохранённых данных
async function clearSavedData() {
  if (!await showConfirm('Очистить все сохранённые данные?')) return
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
