const { defineConfig } = require('eslint/config')

module.exports = defineConfig([
  {
    languageOptions: {
      ecmaVersion: 2020,
      sourceType: 'script',
      globals: {
        ...require('globals').node,
        ...require('globals').jest
      }
    },
    rules: {
      // Отступы 2 пробела
      'indent': ['error', 2],
      // Одинарные кавычки
      'quotes': ['error', 'single'],
      // Точка с запятой не требуется
      'semi': ['error', 'never'],
      // Разрешить console.log для отладки
      'no-console': 'off',
      // Пропускать точку с запятой в конце блоков
      'no-extra-semi': 'error',
      // Предупреждение о неиспользуемых переменных
      'no-unused-vars': ['warn', { 'argsIgnorePattern': '^_' }]
    }
  }
])
