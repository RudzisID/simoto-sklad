---
source: Official Wildberries Documentation + Web Search
library: Wildberries Seller API
package: wildberries-api
topic: endpoints
fetched: 2026-05-04T12:00:00Z
official_docs: https://dev.wildberries.ru/en/openapi/work-with-products/
---

# Wildberries Seller API - Основные эндпоинты

## 1. Товары (Product Management / Content API)

**Базовый URL**: `https://content-api.wildberries.ru`

### Справочники
- `GET /content/v2/object/parent/all` — Родительские категории товаров
- `GET /content/v2/object/all` — Список предметов (subjects)
- `GET /content/v2/object/charcs/{subjectId}` — Характеристики предмета
- `GET /content/v2/directory/colors` — Цвета
- `GET /content/v2/directory/kinds` — Пол (gender)
- `GET /content/v2/directory/countries` — Страны происхождения
- `GET /content/v2/directory/seasons` — Сезоны
- `GET /content/v2/directory/vat` — Ставки НДС
- `GET /content/v2/directory/tnved` — Коды ТН ВЭД
- `GET /api/content/v1/brands` — Бренды

### Управление карточками товаров
- `POST /content/v2/cards/upload` — Создание карточек товаров
- `POST /content/v2/cards/upload/add` — Создание карточек с объединением
- `POST /content/v2/get/cards/list` — Список карточек товаров
- `POST /content/v2/cards/error/list` — Список ошибочных карточек
- `POST /content/v2/cards/update` — Обновление карточек товаров
- `POST /content/v2/cards/moveNm` — Объединение или разделение карточек
- `POST /content/v2/cards/delete/trash` — Перемещение карточки в корзину
- `POST /content/v2/cards/recover` — Восстановление карточки из корзины
- `POST /content/v2/get/cards/trash` — Список карточек в корзине

### Цены и остатки
- `POST /api/v2/upload/task` — Установка цен и скидок
- `POST /api/v2/upload/task/size` — Установка цен на размеры
- `POST /api/v2/upload/task/club-discount` — Установка скидок клуба
- `GET /api/v2/list/goods/filter` — Получение товаров с ценами
- `POST /api/v2/list/goods/filter` — Получение товаров с ценами по артикулам
- `GET /api/v2/list/goods/size/nm` — Получение размеров товаров с ценами
- `GET /api/v2/quarantine/goods` — Товары в карантине

### Статусы загрузки
- `GET /api/v2/history/tasks` — Состояние обработанных загрузок
- `GET /api/v2/history/goods/task` — Детали обработанной загрузки
- `GET /api/v2/buffer/tasks` — Состояние необработанных загрузок
- `GET /api/v2/buffer/goods/task` — Детали необработанной загрузки

## 2. Заказы (Marketplace API - FBS, DBS, FBW)

**Базовый URL**: `https://marketplace-api.wildberries.ru`

### FBS (Fulfillment by Seller) — Заказы от продавца
- `POST /api/v3/test/fbs/orders/make` — Создание тестового FBS заказа (sandbox)
- `PATCH /api/v3/test/fbs/orders/{orderId}/decline` — Уведомление об отмене заказа покупателем (sandbox)
- `PATCH /api/v3/test/fbs/supplies/{supplyId}/close` — Закрытие поставки (sandbox)
- `PATCH /api/v3/test/fbs/orders/{orderId}/deliver` — Уведомление о прибытии заказа в ПВЗ (sandbox)
- `PATCH /api/v3/test/fbs/orders/{orderId}/receive` — Уведомление о получении заказа покупателем (sandbox)
- `PATCH /api/v3/test/fbs/orders/{orderId}/reject` — Уведомление об отказе покупателя (sandbox)
- `PATCH /api/v3/test/fbs/orders/{orderId}/defect` — Уведомление о дефекте (sandbox)

### DBS (Delivery by Seller) — Доставка продавцом
- `POST /api/v3/test/dbs/orders/make` — Создание тестового DBS заказа (sandbox)
- `PATCH /api/v3/test/dbs/orders/{orderId}/decline` — Уведомление об отмене (sandbox)

### In-Store Pickup (Заказы в магазине)
- `POST /api/v3/test/click-collect/orders/make` — Создание тестового заказа (sandbox)
- `PATCH /api/v3/test/click-collect/orders/{orderId}/decline` — Уведомление об отмене (sandbox)

### FBW (Fulfillment by Wildberries) — Поставки
- Управление поставками на склады WB

### Метаданные заказов
- `POST /api/marketplace/v3/orders/meta` — Получение метаданных заказов (будет удален 30.04.2026)

## 3. Склады и поставки (Analytics API)

**Базовый URL**: `https://seller-analytics-api.wildberries.ru`

### Остатки на складах WB
- `POST /api/analytics/v1/stocks-report/wb-warehouses` — Текущие остатки на складах WB (новый метод, обновление каждые 30 минут)
- `GET /api/v1/supplier/stocks` — Остатки (будет отключен 23.06.2026)

### Аналитика и отчеты
- Различные методы для получения отчетов по продажам, складу, поисковым запросам

## 4. Отчеты (Reports API)

**Базовый URL**: `https://seller-analytics-api.wildberries.ru` (или отдельный reports API)

### Типы отчетов
- Отчеты по товарам
- Отчеты по холдбэкам (удержаниям)
- Отчеты по расходам на приемку
- Отчеты по платному хранению
- Отчеты о продажах

### Лимиты на создание отчетов
- Обычно: 1 запрос в минуту (Burst: 1-10 запросов)
- Для некоторых отчетов: 1 запрос в 5 секунд или 1 запрос в 10 секунд
- Максимальный период отчета: 8-31 дней (в зависимости от типа)

## 5. Финансы (Finance API)

**Базовый URL**: `https://finance-api.wildberries.ru`

- Баланс, отчеты о продажах, документооборот

## 6. Отзывы и вопросы (Feedbacks API)

**Базовый URL**: `https://feedbacks-api.wildberries.ru`

### Вопросы
- `GET /api/v1/new-feedbacks-questions` — Непрочитанные отзывы и вопросы
- `GET /api/v1/questions/count-unanswered` — Неотвеченные вопросы
- `GET /api/v1/questions/count` — Количество вопросов
- `GET /api/v1/questions` — Список вопросов (макс. 10,000 за запрос)
- `PATCH /api/v1/questions` — Работа с вопросами
- `GET /api/v1/question` — Вопрос по ID

### Отзывы
- `GET /api/v1/feedbacks/count-unanswered` — Непрочитанные отзывы
- `GET /api/v1/feedbacks/count` — Количество отзывов
- `GET /api/v1/feedbacks` — Список отзывов
- `POST /api/v1/feedbacks/answer` — Ответ на отзыв
- `PATCH /api/v1/feedbacks/answer` — Редактирование ответа
- `GET /api/v1/feedback` — Отзыв по ID
- `POST /api/feedbacks/v1/pins` — Закрепить отзыв
- `GET /api/feedbacks/v1/pins/count` — Количество закрепленных отзывов
- `GET /api/feedbacks/v1/pins` — Список закрепленных отзывов

### Чат с покупателями
- `GET /api/v1/chats` — Список чатов
- `POST /api/v1/seller/message` — Отправка сообщения

## 7. Общая информация (Common API)

**Базовый URL**: `https://common-api.wildberries.ru`

- `GET /api/communications/v2/news` — Новости портала продавца
- `GET /api/v1/seller-info` — Информация о продавце (включая TIN/INN)
- `GET /api/common/v1/rating` — Рейтинг продавца
- `GET /api/common/v1/subscriptions` — Информация о подписке Jam
- `GET /api/v1/users` — Список пользователей продавца (активных и приглашенных)

## 8. Управление пользователями (User Management API)

**Базовый URL**: `https://user-management-api.wildberries.ru`

- Методы для управления пользователями, приглашениями и правами доступа

## 9. Wildberries Digital (WBD) API

**Базовый URL**: `https://devapi-digital.wildberries.ru`

### Товары (Digital content)
- `GET /api/v1/offers/author` — Список ваших предложений
- `GET /api/v1/catalog` — Категории и подкатегории
- `POST /api/v1/content/upload/init` — Инициализация загрузки контента
- `POST /api/v1/content/upload/chunk` — Загрузка файла контента
- `PATCH /api/v1/content/author/{content_id}` — Редактирование контента
- `GET /api/v1/content/author/{content_id}` — Информация о контенте
- `GET /api/v1/content/author` — Список вашего контента

## Примечания
- Для sandbox используйте `-sandbox` в домене (например, `marketplace-api-sandbox.wildberries.ru`)
- Лимиты запросов указаны в документации к каждому методу
- Многие методы требуют конкретных категорий данных в токене
