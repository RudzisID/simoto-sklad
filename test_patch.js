// Test: load the patched browser xlsx.full.min.js in Node.js
// This simulates what the browser does after the patch

const fs = require('fs');
const path = require('path');

// Patch: remove require('cptable') from the xlsx file so it loads cleanly in Node.js
// In Node.js, the browser xlsx.full.min.js tries to require('cptable') which doesn't exist
// So we use the Node.js xlsx (which works) to test the actual behavior
const XLSX = require('xlsx');

// Read the patched browser file to verify it's different from stock
const patchedContent = fs.readFileSync('public/lib/xlsx.full.min.js', 'utf-8');
const origContent = fs.readFileSync('node_modules/xlsx/dist/xlsx.full.min.js', 'utf-8');
console.log('Patched has false)a=cptable:', patchedContent.includes('false)a=cptable'));
console.log('Original has false)a=cptable:', origContent.includes('false)a=cptable'));

// Now - let's understand the xlsx behavior by reading an actual Ozon XLSX
// We need to find or create one.

// First, let's understand how xlsx handles t="str" inline strings
// by reading the source code and finding the relevant handler

// Search for how xlsx reads cells with t="str"
const xlsxSource = fs.readFileSync(require.resolve('xlsx'), 'utf-8');
// Find inline string handling
const idx = xlsxSource.indexOf('t="str"');
if (idx >= 0) {
  console.log('\n--- xlsx.js t="str" context ---');
  console.log(xlsxSource.substring(Math.max(0, idx - 200), idx + 400));
}

// Also look for the make_xlsx_lib function to see how a=cptable works
const makeIdx = xlsxSource.indexOf('make_xlsx_lib');
if (makeIdx >= 0) {
  console.log('\n--- make_xlsx_lib context ---');
  console.log(xlsxSource.substring(makeIdx, makeIdx + 2000));
}
