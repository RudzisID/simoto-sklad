// Test the unescapexml regex behavior
const encregex = /&(?:quot|apos|gt|lt|amp|#x?([\da-fA-F]+));/ig;

// Test cases
const tests = [
  '&#1044;&#1086;&#1089;',  // Cyrillic: Д, о, с
  '&#x414;&#x43E;&#x441;', // Same in hex
  '&#1044;',                // Single char
  '&#32;',                  // Space
];

for (const test of tests) {
  const result = test.replace(encregex, ($$, $1) => {
    const base = $$.indexOf('x') > -1 ? 16 : 10;
    const charCode = parseInt($1, base);
    const char = String.fromCharCode(charCode);
    console.log(`Input: ${$$} -> base=${base} code=${charCode} hex=0x${charCode.toString(16)} char=${JSON.stringify(char)} (codes: ${[...char].map(c => 'U+' + c.charCodeAt(0).toString(16).toUpperCase())})`);
    return char;
  });
  console.log(`  Result: ${JSON.stringify(result)}`);
  console.log(`  CharCodes: ${[...result].map(c => 'U+' + c.charCodeAt(0).toString(16).toUpperCase()).join(',')}`);
  console.log();
}
