# PLAN-05: Docker и Deployment

> Дата: 2026-10-28
> Этап: Docker
> Зависимости: PLAN-04 (интеграция завершена)
> Контекст: simoto_main уже имеет Docker-инфраструктурой

---

## 1. Стратегия

SiMOTO-sklad **не имеет отдельного Docker**. Он интегрируется в существующую инфраструктуру simoto_main:

```
simoto_brand/
├── Dockerfile              ← Dev (node:24-alpine)
├── Dockerfile.backend      ← Production multi-stage ← основной
├── Dockerfile.storefront   ← Storefront
└── tenants/
    ├── _TEMPLATE/
    │   └── docker-compose.yml  ← Per-tenant compose
    ├── atvspb/
    │   └── docker-compose.yml
    └── ...
```

Модуль `supplies-warehouse` собирается как часть `Dockerfile.backend` — отдельный образ не нужен.

---

## 2. Dockerfile.backend (существующий — не менять)

```dockerfile
# simoto_brand/Dockerfile.backend
# Multi-stage build для Medusa backend

FROM node:24-alpine AS deps
# ... (установка зависимостей)

FROM node:24-alpine AS builder
# ... (сборка TypeScript, включая supplies-warehouse модуль)

FROM node:24-alpine AS runner
# ... (копирование built files)
# Entrypoint: npx medusa start
```

> **Никаких изменений в Dockerfile.backend** — модуль supplies-warehouse включается автоматически через TypeScript сборку Turborepo.

---

## 3. Environment Variables

Удалить из `.env` следующие переменные (теперь в БД):

```diff
- MS_TOKEN=...
- WB_TOKEN=...
- OZON_CLIENT_ID=...
- OZON_API_KEY=...
- GH_TOKEN=...
- PORT=3000
- PORT_HTTPS=3433
```

Оставить (уже есть в simoto_main):

```env
# Уже в simoto_main:
DATABASE_URL=postgresql://...
REDIS_URL=redis://...
MOYSKLAD_ENCRYPTION_KEY=64hex_chars
JWT_SECRET=...
COOKIE_SECRET=...

# Новые (опционально, для initial bootstrap):
# SUPPLIES_AUTO_SCAN_INTERVAL=30  (минут)
```

---

## 4. docker-compose (per-tenant)

Взять за основу `tenants/_TEMPLATE/docker-compose.yml`:

```yaml
version: "3.8"

services:
  backend:
    build:
      context: ../../
      dockerfile: Dockerfile.backend
    environment:
      - DATABASE_URL=postgresql://user:pass@postgres:5432/simoto
      - REDIS_URL=redis://redis:6379
      - MOYSKLAD_ENCRYPTION_KEY=${MOYSKLAD_ENCRYPTION_KEY}
      - JWT_SECRET=${JWT_SECRET}
      - COOKIE_SECRET=${COOKIE_SECRET}
      - SIMOTO_TENANT_ID=${TENANT_ID}
    ports:
      - "9000:9000"
    depends_on:
      - postgres
      - redis
    restart: unless-stopped

  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: simoto
      POSTGRES_USER: user
      POSTGRES_PASSWORD: pass
    volumes:
      - postgres_data:/var/lib/postgresql/data
    ports:
      - "5432:5432"

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"

volumes:
  postgres_data:
```

---

## 5. Volumes (Docker)

Удалить (больше не нужны):

```
- ./logs:/app/logs          ← файловое состояние заказов
- ./cache:/app/cache        ← файловые кэши WB/Ozon
- ./cert:/app/cert          ← самоподписанные сертификаты
```

Оставить (через PostgreSQL/Redis volumes):

```
- postgres_data             ← все данные, включая supplies_order, wb_cache, ozon_cache
- redis_data                ← realtime events, locks, progress
```

---

## 6. Health check (Docker)

```dockerfile
# В Dockerfile.backend (runner stage)
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:9000/health || exit 1
```

---

## 7. Background Jobs в Docker

Вариант A — через Medusa Scheduler (если доступен):

```ts
// medusa-config.ts
modules: [
  {
    resolve: "./src/modules/supplies-warehouse",
    options: {
      auto_scan_interval_minutes: 30,
    },
  },
]
```

Вариант B — через отдельный cron-контейнер:

```yaml
# docker-compose.yml
services:
  supplies-worker:
    build:
      context: ../../
      dockerfile: Dockerfile.backend
    command: npx medusa jobs:run supplies-auto-scan
    environment:
      - DATABASE_URL=...
      - REDIS_URL=...
    depends_on:
      - postgres
      - redis
    restart: unless-stopped
```

---

## 8. Nginx (reverse proxy)

В `tenants/_TEMPLATE/nginx.tenant.conf.example`:

```nginx
# Добавить proxy для supplies routes (опционально, если нужен внешний доступ)

location /admin/supplies {
    proxy_pass http://backend:9000;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    
    # WebSocket для realtime polling
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
}
```

---

## 9. Build & Deploy

```bash
# Локальная сборка
docker build -f Dockerfile.backend -t simoto-backend .

# Per-tenant deploy
cd tenants/atvspb
docker compose up -d --build

# Миграции (при первом запуске)
docker compose exec backend npx medusa db:migrate

# Проверка
docker compose logs backend
curl http://localhost:9000/admin/supplies
```

---

## 10. Очистка после миграции

После успешного переноса в simoto_main, в SiMOTO-sklad:

- [ ] Удалить `routes/` (api.js, sse.js, market.js, debug.js)
- [ ] Удалить `lib/` (api-utils.js, ms-rate-limited-fetch.js, order.js, check.js, demand.js, payment.js, return.js, cancel.js, product.js, server-utils.js, sort-utils.js, sse-helper.js, TtlMap.js, constants.js, types.js, supplies.js, wb.js, ozon.js, print.js)
- [ ] Удалить `integrations/wb_ozon_sync.js`
- [ ] Удалить `public/` (index.html, app.js, styles.css, sticker.js, data/versions.json, images/, lib/)
- [ ] Удалить `scripts/` (auto-push.js, check-update.js, create-release.js, sync-version.js, update.js, backfill-wb-data.js, import-wb-orders-xlsx.js, merge-cache-logs.js, docs-generator.js)
- [ ] Удалить `cert/`, `logs/`, `cache/`
- [ ] Удалить `server.js`
- [ ] Удалить `github-push.bat`, `simoto-sklad.bat`
- [ ] Переместить `market-push-for-future.js` в `archive/`
- [ ] Обновить `package.json` (оставить только dev-зависимости для разработки)
- [ ] Обновить `README.md` (описать как часть simoto_main)
- [ ] Создать `INTEGRATION.md` (подробнейшая инструкция для агента)
