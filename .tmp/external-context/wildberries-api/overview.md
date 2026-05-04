---
source: Official Wildberries Documentation + Web Search
library: Wildberries Seller API
package: wildberries-api
topic: overview
fetched: 2026-05-04T12:00:00Z
official_docs: https://dev.wildberries.ru
---

# Wildberries Seller API - Обзор

## Официальная документация
- **Главный портал**: https://dev.wildberries.ru
- **База знаний**: https://dev.wildberries.ru/en/news/301 (KB launch article)
- **FAQ**: https://dev.wildberries.ru/en/faq

## Описание
Wildberries API предоставляет продавцам инструменты для управления магазином и получения информации в реальном времени через HTTP REST API протокол. Основное преимущество API — возможность автоматизации процессов через интеграцию с информационными системами продавца (ERP, WMS, OMS, CRM).

## Основные возможности
- Автоматизация рутинных процессов
- Доступ к актуальной информации
- Оптимизация управления запасами
- Управление товарами, заказами, складами, отчетами

## Формат документации
Документация предоставляется в формате **Swagger OpenAPI**, что позволяет:
- Импортировать в инструменты вроде Postman
- Генерировать клиентский код на различных языках программирования с помощью Swagger CodeGen

## Домены API (основные)
- `content-api.wildberries.ru` — Контент (товары, карточки)
- `marketplace-api.wildberries.ru` — Маркетплейс (FBS, DBS, заказы)
- `seller-analytics-api.wildberries.ru` — Аналитика
- `discounts-prices-api.wildberries.ru` — Цены и скидки
- `feedbacks-api.wildberries.ru` — Отзывы и вопросы
- `finance-api.wildberries.ru` — Финансы
- `common-api.wildberries.ru` — Общие данные (тарифы, новости, инфо о продавце)
- `documents-api.wildberries.ru` — Документы
- `returns-api.wildberries.ru` — Возвраты
- `user-management-api.wildberries.ru` — Управление пользователями

## Песочница (Sandbox)
Для тестирования доступны sandbox-версии API:
- `content-api-sandbox.wildberries.ru`
- `marketplace-api-sandbox.wildberries.ru`
- `discounts-prices-api-sandbox.wildberries.ru`
- `advert-api-sandbox.wildberries.ru`
- `feedbacks-api-sandbox.wildberries.ru`

## Категории данных (Data Categories)
При создании токена нужно выбрать категории данных:
1. **Контент** — управление карточками товаров, ценами и остатками
2. **Маркетплейс** — получение и управление заказами и поставками
3. **Статистика** — аналитика продаж и товаров
4. **Аналитика** — поисковые запросы, отчеты по складу
5. **Цены и скидки** — управление ценами и скидками
6. **Вопросы и отзывы** — работа с отзывами и вопросами покупателей
7. **Чат с покупателем** — коммуникация с покупателями
8. **Поставки** — управление поставками (FBW)
9. **Возвраты** — работа с возвратами
10. **Документы** — баланс, отчеты о продажах
11. **Тарифы** — стоимость доставки, подписки
12. **Продвижение** — рекламные кампании

## Полезные ссылки
- [Официальная документация](https://dev.wildberries.ru)
- [База знаний WB API](https://dev.wildberries.ru/en/news/301)
- [Swagger UI](https://dev.wildberries.ru/swagger/wbd) (для WBD - Wildberries Digital)
- [Инструкции для продавцов](https://seller.wildberries.ru/instructions/ru/ru/material/api-integration-with-token)
