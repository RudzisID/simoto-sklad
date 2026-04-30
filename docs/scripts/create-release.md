# Create Release: Создание GitHub релиза

**Файл**: `scripts/create-release.js`

Минималистичный скрипт для создания GitHub Release через API.

## Использование

```bash
# Создание релиза для указанной версии
node scripts/create-release.js <version>

# Пример
node scripts/create-release.js 1.0.1
```

## Что делает

1. Читает `GH_TOKEN` из файла `.env`
2. Создает релиз через GitHub API:
   ```
   POST https://api.github.com/repos/RudzisID/simoto-sklad/releases
   ```
3. Выводит статус операции

## Пример вывода

```
Release: v1.0.1
Status: 201
OK! v1.0.1 created
```

## Формат запроса

```json
{
  "tag_name": "v1.0.1",
  "name": "SiMOTO v1.0.1",
  "draft": false
}
```

## Использование в npm scripts

Скрипт вызывается автоматически через `auto-push.js` при создании релиза, но может использоваться и отдельно.

## Требования

1. **GitHub токен** в `.env`:
   ```env
   GH_TOKEN=ghp_xxxxxxxxxxxx
   ```

2. **Права токена**: `repo` (полный доступ к репозиториям)

## Отличие от auto-push

| Скрипт | Назначение |
|--------|------------|
| `auto-push.js` | Полный цикл: коммит → пуш → тег → релиз |
| `create-release.js` | Только создание релиза (тег должен существовать) |

## Примечание

⚠️ **Внимание**: Скрипт не создает тег автоматически. Тег должен быть создан заранее (или использовать `auto-push.js`).
