'use strict'

let encode

// node
if (typeof process !== 'undefined' && process.version) {
  encode = function (value) {
    return Buffer.from(value).toString('base64')
  }
}

// browser
else if (typeof btoa !== 'undefined') {
  encode = function (value) {
    return btoa(value)
  }
}

// GAS
else if (typeof Utilities !== 'undefined' && Utilities.base64Encode) {
  encode = function (value) {
    return Utilities.base64Encode(value)
  }
}

// unknown context
else {
  throw new Error("base64encode: Can't determine environment")
}

module.exports = function base64encode(value) {
  return encode(String(value))
}
