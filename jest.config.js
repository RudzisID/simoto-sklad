module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/test/**/*.test.js'],
  collectCoverageFrom: ['lib/**/*.js', '!lib/api-utils.js'],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov'],
  moduleNameMapper: {
    '^moysklad$': '<rootDir>/test/mocks/moysklad-mock.js'
  }
}
