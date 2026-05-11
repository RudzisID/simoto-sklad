/**
 * Rename Communities in graph.json and graph.html
 * Adds human-readable names to graph visualization
 * Safe: preserves original 'community' field for graphify compatibility
 */

const fs = require('fs')
const path = require('path')

const GRAPH_JSON = path.join(__dirname, '..', 'graphify-out', 'graph.json')
const GRAPH_HTML = path.join(__dirname, '..', 'graphify-out', 'graph.html')

// Community mapping (based on GRAPH_REPORT.md analysis + 28 communities)
const COMMUNITY_NAMES = {
  // Core libraries (0-10)
  0: 'Order Processing',      // lib\check.js, order.js, print.js, product.js
  1: 'API Utils',              // lib\api-utils.js, cancel.js, demand.js, payment.js, return.js
  2: 'UI: Saved Orders',      // public\app.js - load/save functions
  3: 'Batch Processing',       // lib\batch.js, server.js - processBatch, checkAbort
  4: 'UI: Batch Actions',     // public\app.js - batchAction, checkNumbers
  5: 'Auto Push/Git',         // scripts\auto-push.js
  6: 'UI: Order Actions',    // public\app.js - createDemandByNum, etc.
  7: 'UI: Table/Pagination',// public\app.js - renderTable, sortTable
  8: 'WB/Ozon Sync',          // integrations\wb_ozon_sync.js
  9: 'UI: Stats',             // public\app.js - calculateStats, renderStats
  10: 'Documentation',          // scripts\docs-generator.js

  // UI: Saved Orders (additional - 11)
  11: 'UI: Saved Orders (2)',     // public\app.js - clearSavedData, showConfirm

  // Scripts (12, 19, 27)
  12: 'Scripts: Utils',        // scripts\rename-communities.js
  19: 'Scripts: Check Update',  // scripts\check-update.js
  27: 'Scripts: Create Release',// scripts\create-release.js

  // Tests (13, 20-25)
  13: 'Tests: Sort Status',    // test\sort-status.test.js
  20: 'Tests: Cancel',         // test\cancel.test.js
  21: 'Tests: Check',          // test\check.test.js
  22: 'Tests: Demand',         // test\demand.test.js
  23: 'Tests: Partial Payment', // test\partialial-payment.test.js
  24: 'Tests: Payment',        // test\payment.test.js
  25: 'Tests: Return',         // test\return.test.js

  // Config files (14, 15, 26)
  14: 'Config: ESLint',        // eslint.config.js
  15: 'Config: Jest',          // jest.config.js
  26: 'Config: Misc',          // package.json, .gitignore, etc.

  // Lib: Core (16-18)
  16: 'Lib: Constants',       // lib\constants.js
  17: 'Lib: Moysklad',        // lib\moysklad.js
  18: 'Lib: Types',           // lib\types.js
}

function renameCommunities() {
  try {
    // 1. Read graph.json
    if (!fs.existsSync(GRAPH_JSON)) {
      console.error('Error: graph.json not found. Run "graphify update ." first.')
      process.exit(1)
    }

    const graph = JSON.parse(fs.readFileSync(GRAPH_JSON, 'utf8'))
    
    // 2. Add community_name to each node
    let renamedCount = 0
    if (graph.nodes && Array.isArray(graph.nodes)) {
      graph.nodes.forEach(node => {
        if (node.community !== undefined && COMMUNITY_NAMES[node.community]) {
          node.community_name = COMMUNITY_NAMES[node.community]
          renamedCount++
        }
      })
    }

    // 3. Write updated graph.json
    fs.writeFileSync(GRAPH_JSON, JSON.stringify(graph, null, 2))
    console.log(`✓ Updated graph.json: added community_name to ${renamedCount} nodes`)

    // 4. Update graph.html to use community_name
    if (fs.existsSync(GRAPH_HTML)) {
      let html = fs.readFileSync(GRAPH_HTML, 'utf8')
      
      // Replace community labels in HTML
      // Pattern: "Community 0", "Community 1", etc.
      Object.entries(COMMUNITY_NAMES).forEach(([num, name]) => {
        const regex = new RegExp(`Community ${num}`, 'g')
        html = html.replace(regex, name)
      })

      fs.writeFileSync(GRAPH_HTML, html)
      console.log(`✓ Updated graph.html: replaced community numbers with names`)
    } else {
      console.warn('⚠ graph.html not found, skipping HTML update')
    }

    console.log('\n✅ Community renaming complete!')
    console.log('Next time you run "graphify update .", run this script again to apply names.')

  } catch (error) {
    console.error('Error:', error.message)
    process.exit(1)
  }
}

// Run if called directly
if (require.main === module) {
  renameCommunities()
}

module.exports = { renameCommunities, COMMUNITY_NAMES }
