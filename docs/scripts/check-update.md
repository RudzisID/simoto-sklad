# Check Update: Проверка обновлений

**Файл**: `scripts/check-update.js`

Простой скрипт для проверки наличия новой версии SiMOTO-sklad на GitHub.

## Использование

```bash
# Проверка обновлений
node scripts/check-update.js

# Или через launcher (simoto-sklad.bat)
# Он автоматически проверяет обновления при запуске
```

## Что делает

1. Читает текущую версию из `package.json`
2. Запрашивает последний релиз через GitHub API:
   ```
   GET https://api.github.com/repos/RudzisID/simoto-sklad/releases/latest
   ```
3. Сравнивает версии
4. Выводит результат

## Пример вывода

```
Latest: v1.0.1
You have latest version
```

Или при наличии обновления:
```
Latest: v1.0.2
New version available!
NEW_AVAILABLE=true
```

## Использование в launcher

Скрипт используется в `simoto-sklad.bat` для проверки обновлений при запуске:

```batch
node scripts/check-update.js
if %errorlevel% equ 0 (
  echo Обновление не требуется
) else (
  echo Доступно обновление!
)
```

## Особенности

- **Без аргументов** — версия берется из `package.json`
- **С аргументом** — можно передать версию вручную: `node scripts/check-update.js 1.0.0`
- **Тихий режим** — выводит только `NEW_AVAILABLE=true` при наличии обновления
- **Обработка ошибок** — при отсутствии сети выводит "No network connection"

## Требования

- Доступ к интернету (GitHub API)
- Репозиторий `RudzisID/simoto-sklad` должен существовать
