# Task Context: Code Cleanup and Documentation Update

Session ID: 2026-04-29-code-cleanup-docs
Created: 2026-04-29T12:07:00+03:00
Status: in_progress

## Current Request
Аккуратно причесать код и обновить документацию, ничего не сломав:
1. Исправить баг в `scripts/check-update.js` (ложное "New version available!" при недоступности сети)
2. Удалить отладочные `console.log` из `lib/order.js` (строки 171-208)
3. Обновить JSDoc в `lib/batch.js` (убрать упоминания несуществующих функций)
4. Исправить `scripts/docs-generator.js` (названия функций в MODULE_PATTERNS не совпадают с реальными)

## Context Files (Standards to Follow)
- C:\distr\!OpenCode\sklad\SiMOTO-sklad\eslint.config.js (2 spaces indent, single quotes, no semicolons)
- C:\distr\!OpenCode\sklad\SiMOTO-sklad\.prettierrc (LF line endings, 100 print width)

## Reference Files (Source Material to Look At)
- C:\distr\!OpenCode\sklad\SiMOTO-sklad\scripts\check-update.js (bug fix)
- C:\distr\!OpenCode\sklad\SiMOTO-sklad\lib\order.js (debug logs cleanup)
- C:\distr\!OpenCode\sklad\SiMOTO-sklad\lib\batch.js (JSDoc fix)
- C:\distr\!OpenCode\sklad\SiMOTO-sklad\scripts\docs-generator.js (MODULE_PATTERNS fix)

## External Docs Fetched
- None

## Components
1. `check-update.js` - fix network error handling
2. `order.js` - remove debug console.log statements
3. `batch.js` - update JSDoc to match actual exports
4. `docs-generator.js` - fix function names in MODULE_PATTERNS

## Constraints
- Follow ESLint config: 2 spaces, single quotes, no semicolons
- Use LF line endings (Prettier config)
- Make minimal, surgical changes
- Do not break existing functionality
- Test after each change

## Exit Criteria
- [ ] `check-update.js` correctly handles API errors (no false "New version available!")
- [ ] All debug `console.log` removed from `order.js`
- [ ] JSDoc in `batch.js` matches actual exports
- [ ] `docs-generator.js` has correct function names in MODULE_PATTERNS
- [ ] `npm test` passes after changes
