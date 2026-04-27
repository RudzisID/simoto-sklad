'use strict'

var moduleName = '../../have'

// workaround to solve cache problems
module.exports = function _require () {
  delete require.cache[require.resolve(moduleName)]
  return require(moduleName)
}
