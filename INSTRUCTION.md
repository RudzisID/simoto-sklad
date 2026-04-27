# Модуль создания входящих платежей

## Общее описание

Модуль для автоматизации создания входящих платежей в МойСклад по номерам отправлений Ozon.

### Возможности

- Загрузка списка номеров отправлений из буфера обмена
- Проверка каждого заказа: сумма, статус, оплата
- Отображение дублей в списке
- Редактирование перед созданием платежей
- Изменение статуса заказа ("На отправке с отсрочкой" → "Отгружен")
- Создание платежей с правильными данными
- Создание отгрузок (demand)
- Создание возвратов покупателей (salesreturn)
- Отмена заказов (сброс резерва в 0, статус "Отменен")
- Логирование всех действий
- Сохранение отчёта

---

## Документация МойСклад API

Официальная документация: `../ms-api-doc/md/documents/`

Основные разделы:
- Заказы покупателей: `_customerOrder.md`
- Отгрузки: `_demand.md`
- Возвраты покупателей: `_sales_return.md`
- Входящие платежи: `_payment_in.md`

---

## Установка

### Примечание по переопорежению структуры
- В рамках стратегии rename/core-app сейчас платежный модуль остаётся автономным, но проект переориентируется на единый главный вход core-app. Текущие файлы payment-module продолжают работать и используются как внутренняя реализация, однако планируется постепенный перенос под core-app.


### 1. Установка зависимостей

```bash
cd payment-module
npm install
```

### 2. Настройка токена

Открыть файл `.env` и указать токен:

```
MOYSKLAD_TOKEN=7b8cf2762052cfb9b87e6c0b525a462090b43ad2
```

---

## Запуск

```bash
cd payment-module
node server.js
```

Открыть в браузере: http://localhost:3000

---

## Использование

### Экран 1: Ввод номеров

1. Скопировать номера из Excel (столбиком)
2. Вставить в левое поле
3. Нажать "Проверить"

### Экран 2: Проверка и редактирование

**Таблица с данными:**
- № - номер отправления
- Заказ - номер заказа в МойСклад
- Сумма - сумма отгрузки
- Оплачено - сколько уже оплачено
- Статус - текущий статус заказа
- Действие - создавать/пропустить/ошибка

**Функции редактирования:**
- [Исключить] - не создавать платеж для этого номера
- [Изменить сумму] - редактировать сумму вручную

**Итоги:**
- Всего позиций
- К созданию
- Пропущено (уже оплачено)
- Общая сумма

### Экран 3: Подтверждение и выполнение

1. Нажать "Создать платежи"
2. Модуль выполняет:
   - Изменяет статусы ("На отправке с отсрочкой" → "Отгружен")
   - Создаёт платежи с привязкой к заказу
3. Показывает результаты

### Экран 4: Результаты

- Создано платежей
- Пропущено
- Ошибки
- Кнопка "Сохранить отчёт"

---

## Логика работы

###获取订单

Для каждого номера находим заказ в МойСклад:

```javascript
const orders = await API.GET('entity/customerorder?limit=10&filter=description~' + shipmentNum);
const order = orders.rows.find(o => o.description && o.description.includes(shipmentNum));
```

获取完整数据:

```javascript
const orderFull = await API.GET('entity/customerorder/' + order.id, {
    expand: 'demands,salesChannel,agent,organization,state'
});
```

获取отгрузку:

```javascript
const demand = await API.GET('entity/demand/' + demandId, {
    expand: 'salesChannel'
});
```

### Проверка статуса

| Текущий статус | ID | Действие |
|----------------|-----|----------|
| На отправке с отсрочкой платежа | 91cb9364-d7c5-11ed-0a80-05b5003aa5c4 | Изменить на "Отгружен" → создать платёж |
| Отгружен | e98e02bb-b1c2-11ed-0a80-004e000a8440 | Создать платёж |
| Другой | - | Пропустить, сообщить |

### Проверка оплаты

```javascript
if (demand.payedSum >= demand.sum) {
    // Уже оплачен - пропустить
}
```

### Изменение статуса

```javascript
if (currentStateId === STATUS_DELAYED_ID) {
    await API.PUT('entity/customerorder/' + order.id, {
        state: {
            meta: {
                href: '.../metadata/states/' + STATUS_SHIPPED_ID,
                type: 'state'
            }
        },
        salesChannel: orderFull.salesChannel,
        attributes: orderFull.attributes
    });
}
```

### Создание платежа

```javascript
const payment = await API.POST('entity/paymentin', {
    agent: { meta: orderFull.agent.meta },
    organization: { meta: orderFull.organization.meta },
    sum: demand.sum,                              // Сумма
    vatSum: demand.vatSum,                       // НДС из отгрузки
    salesChannel: { meta: demand.salesChannel.meta }, // Канал продаж
    operations: [{
        meta: {
            href: 'https://api.moysklad.ru/api/remap/1.2/entity/customerorder/' + order.id,
            type: 'customerorder',
            mediaType: 'application/json'
        },
        linkedSum: demand.sum
    }],
    description: orderFull.description,
    organizationAccount: { meta: orderFull.organizationAccount.meta }
});
```

---

## Константы

| Параметр | ID |
|----------|-----|
| Токен API | 7b8cf2762052cfb9b87e6c0b525a462090b43ad2 |
| Статус "Отгружен" | e98e02bb-b1c2-11ed-0a80-004e000a8440 |
| Статус "На отправке с отсрочкой" | 91cb9364-d7c5-11ed-0a80-05b5003aa5c4 |
| Статус "Возврат" | 444c3246-91e8-11f0-0a80-11be007306ce |
| Статус "Отменен" | fb56e2b4-2e58-11e6-8a84-bae50000006f |
| Статус отгрузки "Отменён" | b1de4f91-a3ca-11ee-0a80-1547000a8e4c |
| Атрибут "Канал продаж" (demand) | eff314b1-d222-11ed-0a80-01240038ac64 |
| Атрибут "Канал продаж" (order) | ec686189-d214-11ed-0a80-0d7d00353a4e |

---

## Важные правила

1. **НЕ создавать дубли!** - проверять `demand.payedSum >= demand.sum`
2. **Копировать данные:**
   - `organizationAccount` - из заказа
   - `vatSum` - из отгрузки
   - `salesChannel` - из отгрузки
3. **Изменять статус** - только если "На отправке с отсрочкой"
4. **Привязывать к заказу** - через operations с linkedSum

---

## Структура файлов

```
payment-module/
├── INSTRUCTION.md          # Эта инструкция
├── package.json           # Зависимости
├── server.js              # Главный сервер
├── start.bat              # Запуск (Windows)
├── .env                  # Токен API (создать вручную)
├── lib/
│   ├── moysklad.js         # Работа с API МойСклад
│   └── payment.js           # Логика создания платежей
├── public/
│   ├── index.html           # Главная страница
│   ├── app.js              # Frontend логика
│   └── styles.css          # Стили (dark theme, bento)
└── logs/
    └── .gitkeep            # Папка для логов
```

---

## Зависимости (package.json)

```json
{
  "name": "payment-module",
  "version": "1.0.0",
  "description": "Модуль создания входящих платежей",
  "main": "server.js",
  "scripts": {
    "start": "node server.js"
  },
  "dependencies": {
    "express": "^4.18.2",
    "moysklad": "^1.0.0",
    "dotenv": "^16.3.1"
  }
}
```

---

## Тестирование

Для тестирования использовать команду:

```bash
node payment-module/server.js
```

Открыть http://localhost:3000

---

## Возможные ошибки

| Ошибка | Причина | Решение |
|-------|---------|---------|
| 401 Unauthorized | Неверный токен | Проверить .env |
| Заказ не найден | Номер не в МойСклад | Проверить номер |
| Нет доступа | Нужны права | Обратиться к админу |

---

## Текущие рабочие скрипты

Скопированы из оригиналов:
- `tmp/create_payments_batch.js` → `lib/payment.js` (нужна адаптация)
- Скилл `Skills/moysklad-payment-in.md` → в эту инструкцию
