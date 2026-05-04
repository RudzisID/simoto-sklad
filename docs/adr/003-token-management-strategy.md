# 003. Работа с токенами авторизации для внешних сервисов

**Status**: proposed

**Date**: 2026-05-04

**Context**: authentication, security | **Module**: public/components/token-input.js, server.js

**Related Tasks**: V3 — Новые фичи, интеграция WB/Ozon (PLAN.md)

**Related ADRs**: 001 (Навигация вкладок), 002 (Общие компоненты)

---

## Context

SiMOTO-sklad взаимодействует с тремя внешними API:
1. **МойСклад** (уже реализовано) — токен передается через `X-API-TOKEN` заголовок или query параметр
2. **Wildberries** (планируется) — требует API Key
3. **Ozon** (планируется) — требует Client ID + API Key

Текущая реализация (МойСклад):
- Токен хранится в `localStorage` под ключом `moyskladToken`
- Передается с каждым запросом к серверу
- Сервер использует токен из `.env` (для бэкенда) или от клиента

Проблемы текущего подхода:
- Токен в localStorage доступен через XSS
- Нет валидации токена перед использованием
- Нет автообновления (для WB/Ozon могут потребоваться refresh token)
- Смешивание хранения на клиенте и сервере

## Decision

Принято решение использовать гибридную стратегию управления токенами:

1. **Хранение**: 
   - Клиент: `localStorage` для быстрого доступа (с защитой через CSP)
   - Сервер: `.env` для фоновых задач (синхронизация WB/Ozon)
   - База состояний: `logs/orders_state.json` НЕ используется для токенов

2. **Передача**:
   - Клиент → Сервер: заголовок `X-API-TOKEN-{SERVICE}` (например, `X-API-TOKEN-WB`)
   - Сервер → API: зависит от сервиса (заголовки WB/Ozon отличаются)

3. **Обновление**:
   - МойСклад: токен статичен (ручное обновление)
   - WB/Ozon: поддержка refresh token (если API позволяет), иначе уведомление пользователя

4. **Валидация**:
   - Клиент: проверка формата при вводе
   - Сервер: проверка валидности через "пробный" запрос при сохранении

## Alternatives Considered

### Option 1: Хранение только на сервере (.env)
- **Pros**: Безопасно, токен не доступен на клиенте
- **Cons**: Нет возможности пользователю менять токен через UI, требуется перезапуск сервера
- **Why rejected**: Пользователи должны иметь возможность менять токены самостоятельно

### Option 2: HttpOnly cookies
- **Pros**: Защита от XSS, токен недоступен через JavaScript
- **Cons**: Сложнее реализация для SSE (Server-Sent Events), CORS ограничения
- **Why rejected**: SSE соединения используют query параметры для токена, cookies неудобны

### Option 3: Единое хранилище на клиенте + сервере (Выбрано)
- **Pros**: Гибкость, пользователь может менять токены, сервер имеет fallback в .env
- **Cons**: Токен в localStorage уязвим для XSS
- **Why chosen**: Баланс между удобством и безопасностью для внутреннего инструмента

### Option 4: Использование refresh token автоматически
- **Pros**: Бесшовный опыт для пользователя
- **Cons**: Не все API поддерживают (МойСклад — нет), сложная логика обновления
- **Why rejected**: МойСклад не поддерживает refresh token, усложнение неоправданно

## Consequences

### Positive
- Пользователи могут управлять токенами через UI (вкладка Settings)
- Сервер имеет резервные токены в .env для фоновых задач
- Поддержка разных типов авторизации (header, query, body) для разных API
- Валидация токенов при сохранении предотвращает ошибки

### Negative
- Токены в localStorage уязвимы для XSS (нужно использовать CSP)
- Дублирование токенов (клиент + сервер) может привести к рассинхронизации
- Нет автоматического обновления токенов (требуется ручное вмешательство)

## Implementation Notes

### Заголовки для разных сервисов:
```javascript
// server.js - проксирование токенов
function getServiceToken(req, service) {
  // 1. Пробуем из заголовка запроса
  const headerToken = req.headers[`x-api-token-${service}`];
  if (headerToken) return headerToken;
  
  // 2. Fallback на .env
  const envTokens = {
    'moysklad': process.env.MOYSKLAD_TOKEN,
    'wb': process.env.WB_API_KEY,
    'ozon': process.env.OZON_API_KEY
  };
  return envTokens[service];
}
```

### WB API (пример):
```javascript
// integrations/wb_client.js
async function wbRequest(endpoint, token) {
  const response = await fetch(`https://suppliers-api.wildberries.ru${endpoint}`, {
    headers: {
      'Authorization': token,  // WB использует Authorization header
      'Content-Type': 'application/json'
    }
  });
  return response.json();
}
```

### Ozon API (пример):
```javascript
// integrations/ozon_client.js
async function ozonRequest(endpoint, clientId, apiKey) {
  const response = await fetch(`https://api-seller.ozon.ru${endpoint}`, {
    headers: {
      'Client-Id': clientId,
      'Api-Key': apiKey,
      'Content-Type': 'application/json'
    }
  });
  return response.json();
}
```

### Валидация на клиенте:
```javascript
// components/token-input.js
function validateToken(service, token) {
  const patterns = {
    'moysklad': /^.{32,}$/,  // МойСклад: минимум 32 символа
    'wb': /^.{20,}$/,        // WB: API Key
    'ozon': /^.{20,}$/       // Ozon: API Key
  };
  return patterns[service]?.test(token) ?? false;
}
```
