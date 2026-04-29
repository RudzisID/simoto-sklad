# Task Context: Fix Auto-Push Script

Session ID: 2026-04-29-fix-auto-push
Created: 2026-04-29T07:15:00+03:00
Status: in_progress

## Current Request
Исправить скрипт `scripts/auto-push.js`:
1. Добавить `git pull --rebase` перед пушем для синхронизации с удалённым репозиторием
2. Исправить логику отката версии в `package.json` при ошибке пуша
3. Добавить запуск тестов (`npm test`) перед созданием коммита
4. Исправить обработку ошибок в `gitExec` (error.stdout -> error.stderr)
5. Исправить синтаксис удаления тега
6. Обновить версию в заголовке скрипта

## Context Files (Standards to Follow)
- C:\distr\!OpenCode\sklad\SiMOTO-sklad\eslint.config.js (2 spaces indent, single quotes, no semicolons)
- C:\distr\!OpenCode\sklad\SiMOTO-sklad\.prettierrc (LF line endings, 100 print width)

## Reference Files (Source Material to Look At)
- C:\distr\!OpenCode\sklad\SiMOTO-sklad\scripts\auto-push.js (main file to fix)
- C:\distr\!OpenCode\sklad\SiMOTO-sklad\package.json (version management)

## External Docs Fetched
- None

## Components
1. `gitExec` function - fix error handling
2. `autoPush` function - add rebase logic, test execution, fix rollback
3. Tag creation logic - fix command syntax
4. Header - update version dynamically

## Constraints
- Follow ESLint config: 2 spaces, single quotes, no semicolons
- Use LF line endings (Prettier config)
- Keep backward compatibility with existing arguments

## Exit Criteria
- [ ] Added `git pull --rebase` before push with conflict detection
- [ ] Fixed rollback to restore `package.json` version on push failure
- [ ] Added `npm test` execution before commit
- [ ] Fixed `error.stdout` -> `error.stderr` in gitExec
- [ ] Fixed tag deletion command syntax
- [ ] Updated script header to show dynamic version
