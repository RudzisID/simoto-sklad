// Mock для библиотеки moysklad
const mockApi = {
  GET: jest.fn(),
  POST: jest.fn(),
  PUT: jest.fn(),
  DELETE: jest.fn()
}

function ms({ token }) {
  return mockApi
}

module.exports = ms
module.exports.mockApi = mockApi
