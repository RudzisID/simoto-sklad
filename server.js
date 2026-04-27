const express = require('express');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const moduleRoot = __dirname;

const { initApi } = require('./lib/moysklad');
const { checkOrder, processBatch } = require('./lib/batch');
const { findOrderByShipmentNum, getOrderFull, getOrderFullForCreate, getDemand, changeOrderStatus } = require('./lib/order');
const { createPayment } = require('./lib/payment');
const { createDemand } = require('./lib/demand');
const { createReturn } = require('./lib/return');
const { cancelOrder } = require('./lib/cancel');
const wbOzonSync = require('./integrations/wb_ozon_sync');

// Незначительное изменение в третий раз
// In-memory store for abort signals
const abortSignals = new Map();

function generateAbortId() {
    return Math.random().toString(36).substring(2, 15);
}

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware для парсинга JSON
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
const LOG_DIR = path.join(moduleRoot, 'logs');
const LOG_DAYS_KEEP = 10;

// Удаление старых логов при запуске
function cleanOldLogs() {
    try {
        if (!fs.existsSync(LOG_DIR)) return;

        const files = fs.readdirSync(LOG_DIR);
        const now = Date.now();
        let deleted = 0;

        for (const file of files) {
            if (!file.startsWith('payments_') || !file.endsWith('.log')) continue;

            const filePath = path.join(LOG_DIR, file);
            const stats = fs.statSync(filePath);
            const ageDays = (now - stats.mtimeMs) / (1000 * 60 * 60 * 24);

            if (ageDays > LOG_DAYS_KEEP) {
                fs.unlinkSync(filePath);
                deleted++;
            }
        }

        console.log(`[Startup] Удалено старых логов: ${deleted}`);
    } catch (e) {
        console.error('[Startup] Ошибка очистки логов:', e.message);
    }
}

// Запускаем очистку при старте
cleanOldLogs();

// Логирование с подробностями
function log(message, details = null) {
    const now = new Date();
    const dateStr = now.toISOString().split('T')[0];
    const timeStr = now.toTimeString().split(' ')[0];

    let fullMessage = message;
    if (details) {
        if (typeof details === 'object') {
            fullMessage += ' | Данные: ' + JSON.stringify(details);
        } else {
            fullMessage += ' | ' + details;
        }
    }

    const logLine = `[${dateStr} ${timeStr}] ${fullMessage}\n`;
    const logFile = path.join(LOG_DIR, `payments_${dateStr}.log`);

    fs.appendFileSync(logFile, logLine);
    console.log(fullMessage);
}

// Health check
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', time: new Date().toISOString() });
});

// Abort endpoint - при отмене устанавливаем флаг
app.post('/api/abort', (req, res) => {
    const { abortId } = req.body;
    if (abortId) {
        abortSignals.set(abortId, true);
        log(`Abort requested for: ${abortId}`);
    }
    res.json({ success: true });
});

// Process numbers (check) - с поддержкой SSE streaming
app.post('/api/process', async (req, res) => {
    const { numbers } = req.body;
    const token = req.headers['x-api-token'];
    log('API: process/check, token present: ' + !!token);

    if (!token) {
        return res.json({ error: 'Требуется токен API' });
    }

    process.env.MOYSKLAD_TOKEN = token;
    initApi(token);

    if (!numbers || !Array.isArray(numbers)) {
        return res.json({ error: 'Некорректные данные' });
    }

    log(`=== Начало check ===`);
    log(`Количество: ${numbers.length}`);

    try {
        const result = await processBatch(numbers, 'check', log);
        log(`=== Завершено ===`);
        res.json(result);
    } catch (e) {
        log(`Ошибка: ${e.message}`);
        res.json({ error: e.message });
    }
});

// SSE endpoint для realtime обновлений
app.get('/api/process/stream', (req, res) => {
    const token = req.query.token || req.headers['x-api-token'];
    const numbersParam = req.query.numbers;
    const abortId = req.query.abortId;
    
    if (!token) {
        return res.status(401).json({ error: 'Требуется токен API' });
    }
    
    if (!numbersParam) {
        return res.status(400).json({ error: 'Требуется массив numbers' });
    }
    
    const numbers = numbersParam.split(',').map(n => n.trim()).filter(n => n);
    
    if (numbers.length === 0) {
        return res.status(400).json({ error: 'Пустой массив numbers' });
    }

    // SSE заголовки
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // Отключаем nginx буферизацию
    
    log(`=== SSE: start check ${numbers.length} orders ===`);
    
    // Инициализируем API с токеном
    process.env.MOYSKLAD_TOKEN = token;
    initApi(token);
    
    // Callback для проверки отмены
    function checkAbort() {
        if (abortId && abortSignals.get(abortId)) {
            abortSignals.delete(abortId);
            return true;
        }
        return false;
    }
    
    // Callback для отправки каждого результата
    const onProgress = (result, index, total) => {
        const data = JSON.stringify({
            type: 'progress',
            index: index + 1,
            total: total,
            order: result
        });
        res.write(`data: ${data}\n\n`);
        
        // Flush для немедленной отправки
        if (res.flush) res.flush();
    };
    
    // Обрабатываем батч с callback и опциями abort
    processBatch(numbers, 'check', log, onProgress, { onAbort: checkAbort })
        .then(result => {
            // Если прервано - отправляем событие abort
            if (result.aborted) {
                res.write(`data: ${JSON.stringify({ type: 'aborted', processed: result.processed })}\n\n`);
                log(`=== SSE: aborted after ${result.processed} orders ===`);
            } else {
                // Отправляем завершение
                res.write(`data: ${JSON.stringify({ type: 'done', orders: result.orders })}\n\n`);
                log(`=== SSE: completed ${numbers.length} orders ===`);
            }
            res.end();
        })
        .catch(e => {
            log(`SSE error: ${e.message}`);
            res.write(`data: ${JSON.stringify({ type: 'error', error: e.message })}\n\n`);
            res.end();
        });
    
    // Cleanup при disconnect - устанавливаем флаг abort
    req.on('close', () => {
        log('SSE: client disconnected, setting abort flag');
        if (abortId) {
            abortSignals.set(abortId, true);
        }
    });
});

// Batch action
app.post('/api/batch', async (req, res) => {
    const { numbers, action } = req.body;
    const token = req.headers['x-api-token'];
    log('API: batch, action: ' + action + ', token present: ' + !!token);

    if (!token) {
        return res.json({ error: 'Требуется токен API' });
    }

    process.env.MOYSKLAD_TOKEN = token;
    initApi(token);

    if (!numbers || !Array.isArray(numbers)) {
        return res.json({ error: 'Некорректные данные' });
    }

    const validActions = ['demand', 'payment', 'return', 'cancel'];
    if (!validActions.includes(action)) {
        return res.json({ error: 'Некорректное действие. Доступно: ' + validActions.join(', ') });
    }

    log(`=== Начало batch: ${action} ===`);
    log(`Количество: ${numbers.length}`);

    try {
        const result = await processBatch(numbers, action, log);
        log(`=== Завершено ===`);
        res.json(result);
    } catch (e) {
        log(`Ошибка: ${e.message}`);
        res.json({ error: e.message });
    }
});

// SSE endpoint для realtime batch операций
app.get('/api/batch/stream', (req, res) => {
    const token = req.query.token || req.headers['x-api-token'];
    const numbersParam = req.query.numbers;
    const action = req.query.action;
    const abortId = req.query.abortId;
    
    if (!token) {
        return res.status(401).json({ error: 'Требуется токен API' });
    }
    
    if (!numbersParam) {
        return res.status(400).json({ error: 'Требуется массив numbers' });
    }
    
    const numbers = numbersParam.split(',').map(n => n.trim()).filter(n => n);
    const validActions = ['demand', 'payment', 'return', 'cancel'];
    
    if (!validActions.includes(action)) {
        return res.status(400).json({ error: 'Некорректное действие. Доступно: ' + validActions.join(', ') });
    }

    // SSE заголовки
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    
    log(`=== SSE: batch ${action} for ${numbers.length} orders ===`);
    
    // Инициализируем API с токеном
    process.env.MOYSKLAD_TOKEN = token;
    initApi(token);
    
    let stats = { created: 0, skipped: 0, errors: 0 };
    
    // Callback для проверки отмены
    function checkAbort() {
        if (abortId && abortSignals.get(abortId)) {
            abortSignals.delete(abortId);
            return true;
        }
        return false;
    }
    
    // Callback для отправки каждого результата
    const onProgress = (result, index, total) => {
        if (result.status === 'created') stats.created++;
        else if (result.status === 'skipped') stats.skipped++;
        else if (result.status === 'error') stats.errors++;
        
        const data = JSON.stringify({
            type: 'progress',
            index: index + 1,
            total: total,
            action: action,
            result: result,
            stats: stats
        });
        res.write(`data: ${data}\n\n`);
        
        if (res.flush) res.flush();
    };
    
    // Обрабатываем батч с callback и опциями abort
    processBatch(numbers, action, log, onProgress, { onAbort: checkAbort })
        .then(result => {
            // Если прервано - отправляем событие abort
            if (result.aborted) {
                res.write(`data: ${JSON.stringify({ type: 'aborted', processed: result.processed, stats: stats })}\n\n`);
                log(`=== SSE: batch ${action} aborted after ${result.processed} orders ===`);
            } else {
                res.write(`data: ${JSON.stringify({ type: 'done', stats: stats, orders: result.orders })}\n\n`);
                log(`=== SSE: batch ${action} completed - created:${stats.created}, skipped:${stats.skipped}, errors:${stats.errors} ===`);
            }
            res.end();
        })
        .catch(e => {
            log(`SSE batch error: ${e.message}`);
            res.write(`data: ${JSON.stringify({ type: 'error', error: e.message })}\n\n`);
            res.end();
        });
    
    // Cleanup при disconnect - устанавливаем флаг abort
    req.on('close', () => {
        log('SSE batch: client disconnected, setting abort flag');
        if (abortId) {
            abortSignals.set(abortId, true);
        }
    });
});

// Save report
app.post('/api/save-report', async (req, res) => {
    const { ordersData, resultsData } = req.body;
    const dateStr = new Date().toISOString().split('T')[0];
    const reportFile = path.join(moduleRoot, 'logs', `report_${dateStr}.json`);

    const report = {
        generated: new Date().toISOString(),
        results: resultsData,
        orders: ordersData
    };

    fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));
    log(`Отчёт сохранён: ${reportFile}`);

    res.json({ success: true, file: reportFile });
});

// Create single payment
app.post('/api/create-payment', async (req, res) => {
    const { shipmentNum } = req.body;
    const token = req.headers['x-api-token'];

    if (!token || !shipmentNum) {
        return res.json({ error: 'Требуется токен и номер отправления' });
    }

    initApi(token);
    log(`Создание платежа: ${shipmentNum}`, { token: token.slice(0, 8) + '...' });

    try {
        log(`Проверка заказа: ${shipmentNum}`);
        const checkResult = await checkOrder(shipmentNum, log);

        if (!checkResult.canPayment) {
            log(`Нельзя создать платёж: ${checkResult.statusName}`, { shipmentNum, status: checkResult.status });
            updateOrderState(shipmentNum, 'payment_check', 'skipped: ' + checkResult.statusName);
            return res.json({ error: 'Невозможно создать платёж: ' + checkResult.statusName });
        }

        log(`Заказ найден, создаю платёж: ${shipmentNum}`);
        const orderFull = await getOrderFullForCreate(checkResult.orderId);
        await changeOrderStatus(checkResult.orderId, orderFull);

        const demandId = orderFull.demands[0].meta.href.split('/').pop();
        const demand = await getDemand(demandId);

        const payment = await createPayment(orderFull, demand);
        log(`Платёж создан: ${payment.name}`, { shipmentNum });

        updateOrderState(shipmentNum, 'payment_created', payment.name, {
            orderName: orderFull.name,
            sum: demand.sum / 100,
            paid: demand.payedSum / 100,
            orderId: orderFull.id,
            orderUrl: `https://online.moysklad.ru/app/#customerorder/${orderFull.id}`
        });

        res.json({ success: true, paymentName: payment.name });
    } catch (e) {
        log(`Ошибка: ${e.message}`, { shipmentNum, stack: e.stack });
        updateOrderState(shipmentNum, 'payment_error', e.message);
        res.json({ error: e.message });
    }
});

// Create demand (отгрузка) - see Skills/moysklad-demand.md
app.post('/api/create-demand', async (req, res) => {
    const { shipmentNum } = req.body;
    const token = req.headers['x-api-token'];

    if (!token || !shipmentNum) {
        return res.json({ error: 'Требуется токен и номер отправления' });
    }

    initApi(token);
    log(`Создание отгрузки: ${shipmentNum}`, { token: token.slice(0, 8) + '...' });

    try {
        log(`Поиск заказа: ${shipmentNum}`);
        const order = await findOrderByShipmentNum(shipmentNum, log);
        if (!order) {
            log(`Заказ не найден: ${shipmentNum}`);
            updateOrderState(shipmentNum, 'demand_check', 'order_not_found');
            return res.json({ error: 'Заказ не найден' });
        }

        log(`Получаю данные заказа: ${order.id}`);
        const orderFull = await getOrderFullForCreate(order.id);
        if (!orderFull) {
            log(`Ошибка получения данных заказа: ${shipmentNum}`, { orderId: order.id });
            updateOrderState(shipmentNum, 'demand_check', 'error_getting_order');
            return res.json({ error: 'Не удалось получить данные заказа' });
        }

        const hasDemand = orderFull.demands && orderFull.demands.length > 0;
        log(`Проверка отгрузки: ${shipmentNum}`, { hasDemand, demandsCount: orderFull.demands?.length || 0 });

        if (hasDemand) {
            log(`Отгрузка уже существует: ${shipmentNum}`);
            updateOrderState(shipmentNum, 'demand_check', 'already_exists');
            return res.json({ error: 'Отгрузка уже существует' });
        }

        log(`Создаю отгрузку: ${shipmentNum}`, { orderId: orderFull.id });
        const demand = await createDemand(orderFull);
        log(`Отгрузка создана: ${demand.name}`, { shipmentNum, demandId: demand.id });
        updateOrderState(shipmentNum, 'demand_created', demand.name, {
            orderName: orderFull.name,
            orderId: orderFull.id,
            orderUrl: `https://online.moysklad.ru/app/#customerorder/${orderFull.id}`
        });
        res.json({ success: true, demandName: demand.name });
    } catch (e) {
        log(`Ошибка создания отгрузки: ${e.message}`, { shipmentNum, stack: e.stack });
        updateOrderState(shipmentNum, 'demand_error', e.message);
        res.json({ error: e.message });
    }
});

// Create return (возврат) - see Skills/moysklad-return.md
app.post('/api/create-return', async (req, res) => {
    const { shipmentNum } = req.body;
    const token = req.headers['x-api-token'];

    if (!token || !shipmentNum) {
        return res.json({ error: 'Требуется токен и номер отправления' });
    }

    initApi(token);
    log(`Создание возврата: ${shipmentNum}`, { token: token.slice(0, 8) + '...' });

    try {
        log(`Поиск заказа для возврата: ${shipmentNum}`);
        const order = await findOrderByShipmentNum(shipmentNum, log);
        if (!order) {
            log(`Заказ не найден для возврата: ${shipmentNum}`);
            updateOrderState(shipmentNum, 'return_check', 'order_not_found');
            return res.json({ error: 'Заказ не найден' });
        }

        log(`Получаю данные заказа для возврата: ${order.id}`);
        const orderFull = await getOrderFullForCreate(order.id);
        if (!orderFull) {
            log(`Ошибка получения данных заказа для возврата: ${shipmentNum}`);
            updateOrderState(shipmentNum, 'return_check', 'error_getting_order');
            return res.json({ error: 'Не удалось получить данные заказа' });
        }

        const hasDemand = orderFull.demands && orderFull.demands.length > 0;
        log(`Проверка отгрузки для возврата: ${shipmentNum}`, { hasDemand });

        if (!hasDemand) {
            log(`Нет отгрузки для возврата: ${shipmentNum}`);
            updateOrderState(shipmentNum, 'return_check', 'no_demand');
            return res.json({ error: 'Нет отгрузки для возврата' });
        }

        const demandId = orderFull.demands[0].meta.href.split('/').pop();
        log(`Создаю возврат: ${shipmentNum}`, { orderId: orderFull.id, demandId });
        const salesReturn = await createReturn(order.id, orderFull, demandId);
        log(`Возврат создан: ${salesReturn.name}`, { shipmentNum, returnId: salesReturn.id });
        updateOrderState(shipmentNum, 'return_created', salesReturn.name, {
            orderName: orderFull.name,
            orderId: orderFull.id,
            orderUrl: `https://online.moysklad.ru/app/#customerorder/${orderFull.id}`
        });
        res.json({ success: true, returnName: salesReturn.name });
    } catch (e) {
        log(`Ошибка создания возврата: ${e.message}`, { shipmentNum, stack: e.stack });
        updateOrderState(shipmentNum, 'return_error', e.message);
        res.json({ error: e.message });
    }
});

// Cancel order (отмена) - see Skills/moysklad-return.md (change status to "Отменён")
app.post('/api/cancel-order', async (req, res) => {
    const { shipmentNum } = req.body;
    const token = req.headers['x-api-token'];

    if (!token || !shipmentNum) {
        return res.json({ error: 'Требуется токен и номер отправления' });
    }

    initApi(token);
    log(`Отмена заказа: ${shipmentNum}`, { token: token.slice(0, 8) + '...' });

    try {
        log(`Поиск заказа для отмены: ${shipmentNum}`);
        const order = await findOrderByShipmentNum(shipmentNum, log);
        if (!order) {
            log(`Заказ не найден для отмены: ${shipmentNum}`);
            updateOrderState(shipmentNum, 'cancel_check', 'order_not_found');
            return res.json({ error: 'Заказ не найден' });
        }

        log(`Получаю данные заказа для отмены: ${order.id}`);
        const orderFull = await getOrderFullForCreate(order.id);
        if (!orderFull) {
            log(`Ошибка получения данных заказа для отмены: ${shipmentNum}`);
            updateOrderState(shipmentNum, 'cancel_check', 'error_getting_order');
            return res.json({ error: 'Не удалось получить данные заказа' });
        }

        const demandId = orderFull.demands?.length > 0
            ? orderFull.demands[0].meta.href.split('/').pop()
            : null;

        log(`Отменяю заказ: ${shipmentNum}`, { orderId: orderFull.id, demandId });
        const result = await cancelOrder(order.id, orderFull, demandId);
        log(`Заказ отменён: ${shipmentNum}`, { result });
        updateOrderState(shipmentNum, 'order_cancelled', 'success', {
            orderName: orderFull.name,
            orderId: orderFull.id,
            orderUrl: `https://online.moysklad.ru/app/#customerorder/${orderFull.id}`
        });
        res.json({ success: true, ...result });
    } catch (e) {
        log(`Ошибка: ${e.message}`);
        updateOrderState(shipmentNum, 'cancel_error', e.message);
        res.json({ error: e.message });
    }
});

// Graceful shutdown
let isShuttingDown = false;

function gracefulShutdown(signal) {
    if (isShuttingDown) return;
    isShuttingDown = true;

    log(`Получен сигнал ${signal}, завершаю работу...`);
    console.log(`\n[${signal}] Graceful shutdown...`);

    server.close(() => {
        log('Сервер остановлен');
        console.log('[Shutdown] Server closed');
        process.exit(0);
    });

    // Force exit after 10 seconds
    setTimeout(() => {
        log('Принудительная остановка');
        process.exit(1);
    }, 10000);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Restart server
const serverFile = process.argv[1];
const serverCommand = 'node "' + serverFile + '"';
const appRoot = path.dirname(process.argv[1]);

app.post('/api/restart', (req, res) => {
    log('Запрошен перезапуск сервера');
    res.json({ success: true, message: 'Перезапуск сервера...' });

    setTimeout(() => {
        const { spawn, exec } = require('child_process');
        const isWindows = process.platform === 'win32';
        const pid = process.pid;

        if (isWindows) {
            const startBatPath = path.join(appRoot, 'start.bat');
            spawn('cmd.exe', ['/c', 'start "" "' + startBatPath + '"'], {
                cwd: appRoot,
                detached: true,
                stdio: 'ignore',
                shell: true
            }).unref();

            // Ждём и убиваем текущий
            setTimeout(() => {
                exec('taskkill /PID ' + pid + ' /F', (err) => {
                    if (err) console.log('Kill error:', err);
                    else console.log('[Restart] Old process killed');
                });
            }, 2000);
        } else {
            spawn('node', [serverFile], {
                cwd: appRoot,
                detached: true,
                stdio: 'ignore'
            }).unref();
            setTimeout(() => process.exit(0), 500);
        }
    }, 1500);
});

// Check if server is running
app.get('/api/status', (req, res) => {
    res.json({
        running: !isShuttingDown,
        pid: process.pid,
        uptime: process.uptime()
    });
});

// Start server (open new console via start.bat)
app.post('/api/start', (req, res) => {
    const { spawn } = require('child_process');
    const isWindows = process.platform === 'win32';

    if (isWindows) {
        spawn('cmd.exe', ['/c', 'start "" "' + startBatPath + '"'], {
            cwd: appRoot,
            detached: true,
            stdio: 'ignore',
            shell: true
        }).unref();
        res.json({ success: true, message: 'Сервер запущен в новом окне' });
    } else {
        spawn('open', ['-a', 'Terminal', serverFile], {
            cwd: appRoot,
            detached: true
        }).unref();
        res.json({ success: true, message: 'Сервер запущен' });
    }
});

// Get logs
app.get('/api/logs', (req, res) => {
    const dateStr = new Date().toISOString().split('T')[0];
    const logFile = path.join(moduleRoot, 'logs', `payments_${dateStr}.log`);

    try {
        if (fs.existsSync(logFile)) {
            const content = fs.readFileSync(logFile, 'utf-8');
            const lines = content.split('\n').filter(l => l).slice(-100);
            res.json({ logs: lines.join('\n'), file: logFile });
        } else {
            res.json({ logs: '', file: logFile });
        }
    } catch (e) {
        res.json({ error: e.message });
    }
});

// Синхронизация товаров WB / OZON (скелет)
app.post('/api/sync-products', async (req, res) => {
    const { wbCodes, ozonCodes } = req.body || {};
    try {
        const wbData = await wbOzonSync.fetchWBData(Array.isArray(wbCodes) ? wbCodes : []);
        const ozonData = await wbOzonSync.fetchOzonData(Array.isArray(ozonCodes) ? ozonCodes : []);
        const merged = wbOzonSync.compareAndAggregate(wbData, ozonData);
        res.json({ success: true, merged });
    } catch (e) {
        log('Sync error: ' + e.message);
        res.json({ error: e.message });
    }
});

// Save orders state
const STATE_FILE = path.join(moduleRoot, 'logs', 'orders_state.json');

function loadOrdersState() {
    try {
        if (fs.existsSync(STATE_FILE)) {
            const data = JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
            console.log('Loaded orders state from file:', STATE_FILE, '- count:', Object.keys(data).length);
            return data;
        }
        console.log('Orders state file not found:', STATE_FILE);
    } catch (e) {
        console.error('Error loading state:', e);
    }
    return {};
}

function saveOrdersState(state) {
    try {
        fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
        console.log('Saved orders state to file:', STATE_FILE, '- count:', Object.keys(state).length);
    } catch (e) {
        console.error('Error saving state:', e);
    }
}

function updateOrderState(shipmentNum, action, result, extraData = {}) {
    const state = loadOrdersState();
    const now = new Date().toISOString();

    if (!state[shipmentNum]) {
        state[shipmentNum] = { history: [] };
    }

    // Ensure history array exists
    if (!state[shipmentNum].history) {
        state[shipmentNum].history = [];
    }

    state[shipmentNum].lastAction = action;
    state[shipmentNum].lastResult = result;
    state[shipmentNum].lastUpdate = now;

    // Сохраняем имена документов
    if (action === 'payment_created') {
        state[shipmentNum].paymentName = result;
    } else if (action === 'demand_created') {
        state[shipmentNum].demandName = result;
    } else if (action === 'return_created') {
        state[shipmentNum].returnName = result;
    }

    // Сохраняем дополнительные данные о заказе
    if (extraData.orderName) state[shipmentNum].orderName = extraData.orderName;
    if (extraData.sum) state[shipmentNum].sum = extraData.sum;
    if (extraData.paid) state[shipmentNum].paid = extraData.paid;
    if (extraData.orderId) state[shipmentNum].orderId = extraData.orderId;
    if (extraData.orderUrl) state[shipmentNum].orderUrl = extraData.orderUrl;

    state[shipmentNum].history.push({
        action,
        result,
        time: now
    });

    saveOrdersState(state);
    return state[shipmentNum];
}

app.get('/api/orders-state', (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    const state = loadOrdersState();
    res.json(state);
});

// Save entire scan (replaces previous)
app.post('/api/orders-state', (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    log('API: save scan, body keys: ' + (req.body?.orders?.length || 0));
    const { orders } = req.body;
    if (orders && Array.isArray(orders)) {
        // Full scan save - replace everything
        const state = {};
        for (const order of orders) {
            state[order.shipmentNum] = {
                orderName: order.orderName,
                sum: order.sum,
                paid: order.paid,
                status: order.status,
                statusName: order.statusName,
                canCreate: order.canCreate,
                orderId: order.orderId,
                orderUrl: order.orderUrl,
                hasDemand: order.hasDemand,
                hasPayment: order.hasPayment,
                hasReturn: order.hasReturn,
                isCancelled: order.isCancelled,
                demandName: order.demandName || null,
                paymentName: order.paymentName || null,
                returnName: order.returnName || null,
                savedAt: new Date().toISOString(),
                orderPositions: order.orderPositions || [],
                demandPositions: order.demandPositions || []
            };
        }
        saveOrdersState(state);
        log(`Сохранено последнее сканирование: ${orders.length} заказов`);
        return res.json({ success: true, count: orders.length });
    }

    // Single action update
    const { shipmentNum, action, result } = req.body;
    if (!shipmentNum || !action) {
        return res.json({ error: 'Требуется shipmentNum и action' });
    }
    const orderState = updateOrderState(shipmentNum, action, result);
    res.json({ success: true, state: orderState });
});

app.delete('/api/orders-state', (req, res) => {
    saveOrdersState({});
    res.json({ success: true });
});

// Debug: check state file
app.get('/api/debug-state', (req, res) => {
    const state = loadOrdersState();
    res.json({
        file: STATE_FILE,
        exists: fs.existsSync(STATE_FILE),
        count: Object.keys(state).length,
        keys: Object.keys(state).slice(0, 5),
        state: state
    });
});

// Serve static files from public folder
app.use(express.static(path.join(moduleRoot, 'public')));

// Main page
app.get('/', (req, res) => {
    res.sendFile(path.join(moduleRoot, 'public', 'index.html'));
});

// Start server
const server = app.listen(PORT, () => {
    log(`=== Сервер запущен на http://localhost:${PORT} ===`, { pid: process.pid, keepLogsDays: LOG_DAYS_KEEP });
    console.log(`Откройте http://localhost:${PORT} в браузере`);
});
