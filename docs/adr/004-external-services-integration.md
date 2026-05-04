# 004. Интеграция с МойСклад, Wildberries, Ozon

**Status**: proposed

**Date**: 2026-05-04

**Context**: integrations, data-layer | **Module**: integrations/, lib/

**Related Tasks**: V3 — Новые фичи, V4 — Инфраструктура (PLAN.md)

**Related ADRs**: 003 (Работа с токенами)

---

## Context

SiMOTO-sklad требует интеграции с тремя внешними API:
1. **МойСклад** (уже реализовано) — SDK `moysklad` (npm пакет), REST API 1.2
2. **Wildberries** (скелет в `integrations/wb_ozon_sync.js`) — требует реального клиента
3. **Ozon** (скелет в `integrations/wb_ozon_sync.js`) — требует реального клиента

Текущее состояние:
- МойСклад: рабочая интеграция через SDK, BATCH_CONCURRENCY=3, CHUNK_DELAY_MS=200
- WB/Ozon: mock данные, функции `fetchWBData()`, `fetchOzonData()` с `simulateDelay()`

Проблемы, которые нужно решить:
- Единообразие работы с разными API (разные форматы авторизации, эндпойнты)
- Кэширование данных (токены, справочники, результаты запросов)
- Обработка ошибок API (rate limits, таймауты, недоступность)
- Масштабируемость (добавление новых маркетплейсов)

## Decision

Принято решение использовать **адаптерный паттерн** для интеграции с внешними сервисами:

1. **Архитектура слоя данных**:
   - `integrations/` — клиенты API (low-level)
   - `lib/` — бизнес-логика (high-level, переиспользуемая)
   - `services/` — оркестрация (комбинирование данных из нескольких источников)

2. **Кэширование**:
   - In-memory кэш на сервере (TTL 5 минут для справочников)
   - Кэширование токенов в `localStorage` (клиент) и `.env` (сервер)
   - Кэш результатов поиска товаров (для WB/Ozon)

3. **Обработка ошибок**:
   - Retry логика с exponential backoff (для rate limits)
   - Централизованный error handler в `lib/api-utils.js`
   - SSE уведомления клиента о критических ошибках API

### Структура (планируется):
```
integrations/
├── moysklad-client.js   # Обертка над moysklad SDK
├── wb-client.js         # Wildberries API client
├── ozon-client.js       # Ozon API client
└── base-client.js       # Базовый класс с retry логикой

services/
├── product-sync.js      # Синхронизация товаров WB ↔ Ozon
├── order-service.js     # Работа с заказами (cross-platform)
└── stock-service.js     # Управление остатками

lib/
├── cache.js             # In-memory кэш с TTL
├── retry.js             # Retry логика с backoff
└── api-error-handler.js # Обработка ошибок API
```

## Alternatives Considered

### Option 1: Прямые вызовы API в lib/ (как сейчас для МойСклад)
- **Pros**: Просто, нет дополнительных абстракций
- **Cons**: Дублирование логики для WB/Ozon, сложно поддерживать
- **Why rejected**: При добавлении WB/Ozon потребуется дублирование обработки ошибок и retry

### Option 2: API Gateway паттерн (единая точка входа)
- **Pros**: Централизованная обработка, упрощает добавление новых сервисов
- **Cons**: Single point of failure, усложняет отладку
- **Why rejected**: Избыточно для внутреннего инструмента с 3 API

### Option 3: Адаптерный паттерн с базовым классом (Выбрано)
- **Pros**: Единообразие, переиспользование retry/error handling, легко добавлять новые API
- **Cons**: Дополнительный слой абстракции
- **Why chosen**: Баланс между структурой и сложностью

### Option 4: Использование очереди (Queue) для API запросов
- **Pros**: Защита от rate limits, гарантированная доставка
- **Cons**: Сложность реализации, избыточно для синхронных операций
- **Why rejected**: Текущий BATCH_CONCURRENCY=3 достаточен, очередь усложнит код

## Consequences

### Positive
- Единый подход к работе с разными API (retry, error handling, caching)
- Легкое добавление новых маркетплейсов (наследование от BaseClient)
- Кэширование снижает нагрузку на API и ускоряет ответы
- Централизованная обработка ошибок упрощает отладку

### Negative
- Дополнительный слой абстракции (адаптеры) усложняет код
- In-memory кэш сбрасывается при перезапуске сервера
- Retry логика может увеличить время ответа при проблемах с API

## Implementation Notes

### Базовый клиент (base-client.js):
```javascript
// integrations/base-client.js
export class BaseApiClient {
  constructor(baseUrl, defaultHeaders = {}) {
    this.baseUrl = baseUrl;
    this.defaultHeaders = defaultHeaders;
    this.cache = new Map(); // In-memory кэш
  }

  async request(endpoint, options = {}, { retry = 3, ttl = 300000 } = {}) {
    const cacheKey = `${endpoint}:${JSON.stringify(options)}`;
    const cached = this.cache.get(cacheKey);
    
    if (cached && Date.now() - cached.timestamp < ttl) {
      return cached.data;
    }

    for (let attempt = 1; attempt <= retry; attempt++) {
      try {
        const response = await fetch(`${this.baseUrl}${endpoint}`, {
          ...options,
          headers: { ...this.defaultHeaders, ...options.headers }
        });

        if (response.status === 429) { // Rate limit
          const delay = Math.min(1000 * Math.pow(2, attempt), 30000);
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }

        if (!response.ok) {
          throw new Error(`API error: ${response.status}`);
        }

        const data = await response.json();
        this.cache.set(cacheKey, { data, timestamp: Date.now() });
        return data;
      } catch (error) {
        if (attempt === retry) throw error;
        await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
      }
    }
  }
}
```

### Wildberries клиент (пример):
```javascript
// integrations/wb-client.js
import { BaseApiClient } from './base-client.js';

export class WildberriesClient extends BaseApiClient {
  constructor(apiKey) {
    super('https://suppliers-api.wildberries.ru', {
      'Authorization': apiKey,
      'Content-Type': 'application/json'
    });
  }

  async getProducts(codeList) {
    return this.request('/api/v3/stocks', {
      method: 'POST',
      body: JSON.stringify({ skus: codeList })
    });
  }
}
```

### Использование в сервере:
```javascript
// server.js
const { WildberriesClient } = require('./integrations/wb-client');
const wbClient = new WildberriesClient(process.env.WB_API_KEY);

app.post('/api/wb/products', async (req, res) => {
  try {
    const products = await wbClient.getProducts(req.body.codes);
    res.json(products);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
```

### Кэширование токенов (уже реализовано):
- Клиент: `localStorage.getItem('moyskladToken')`
- Сервер: `process.env.MOYSKLAD_TOKEN`
- Для WB/Ozon: аналогично (добавить в .env и localStorage)
