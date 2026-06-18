/**
 * @file Синхронизирует public/data/versions.json с новой версией.
 * Вызывается из github-push.bat после обновления package.json.
 *
 * Использование: node scripts/sync-version.js <версия> [описание]
 * Пример:       node scripts/sync-version.js 1.8.12 "Исправлен баг; Добавлена фича"
 *
 * Описание передаётся одной строкой, несколько пунктов через ";"
 */

const fs = require('fs')
const path = require('path')

const version = process.argv[2]
if (!version) {
  console.error('Usage: node sync-version.js <version> [description]')
  process.exit(1)
}

const versionsPath = path.join(__dirname, '..', 'public', 'data', 'versions.json')

if (!fs.existsSync(versionsPath)) {
  console.log('⚠️  versions.json не найден, пропускаем')
  process.exit(0)
}

const versions = JSON.parse(fs.readFileSync(versionsPath, 'utf8'))
const alreadyHasEntry = versions.some(function(v) { return v.version === version })

if (alreadyHasEntry) {
  console.log('✅ Запись для v' + version + ' уже есть в versions.json')
  process.exit(0)
}

const changesArg = process.argv[3]
const entry = {
  version: version,
  date: new Date().toISOString().slice(0, 10),
  changes: changesArg ? changesArg.split(';').map(s => s.trim()) : ['Автоматическое обновление']
}

versions.unshift(entry)
// Ограничение: не более 10 записей
while (versions.length > 10) versions.pop()

fs.writeFileSync(versionsPath, JSON.stringify(versions, null, 2) + '\n', 'utf8')
console.log('📝 Добавлена запись v' + version + ' в versions.json')
