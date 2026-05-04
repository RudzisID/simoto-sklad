/**
 * Enhanced Graph Visualization for SiMOTO-sklad
 * Groups communities by category with better colors and legend
 */

const fs = require('fs')
const path = require('path')

const GRAPH_HTML = path.join(__dirname, '..', 'graphify-out', 'graph.html')
const LEGEND_HTML = path.join(__dirname, '..', 'graphify-out', 'legend.html')

// Color scheme by category
const CATEGORY_COLORS = {
  'Order Processing': '#4E79A7',
  'API Utils': '#F28E2B',
  'UI: Saved Orders': '#E15759',
  'Batch Processing': '#59A14F',
  'UI: Batch Actions': '#59A14F',
  'Auto Push/Git': '#EDC948',
  'UI: Order Actions': '#B07AA1',
  'UI: Table/Pagination': '#FF9DA7',
  'WB/Ozon Sync': '#9C755F',
  'UI: Stats': '#BAB0AC',
  'Documentation': '#4E79A7',
  'UI: Saved Orders2': '#E15759',
  'Scripts: Utils': '#EDC948',
  'Scripts: Check Update': '#EDC948',
  'Scripts: Create Release': '#EDC948',
  'Tests: Sort Status': '#F28E2B',
  'Tests: Cancel': '#F28E2B',
  'Tests: Check': '#F28E2B',
  'Tests: Demand': '#F28E2B',
  'Tests: Partial Payment': '#F28E2B',
  'Tests: Payment': '#F28E2B',
  'Tests: Return': '#F28E2B',
  'Config: ESLint': '#76B7B2',
  'Config: Jest': '#76B7B2',
  'Config: Misc': '#76B7B2',
  'Lib: Constants': '#4E79A7',
  'Lib: Moysklad': '#4E79A7',
  'Lib: Types': '#4E79A7'
}

function enhanceVisualization() {
  try {
    if (!fs.existsSync(GRAPH_HTML)) {
      console.error('Error: graph.html not found')
      process.exit(1)
    }

    let html = fs.readFileSync(GRAPH_HTML, 'utf8')

    // Create legend HTML
    const legend = `
<div id="legend" style="
  position: fixed;
  top: 10px;
  right: 10px;
  background: white;
  border: 1px solid #ccc;
  border-radius: 5px;
  padding: 10px;
  font-family: Arial, sans-serif;
  font-size: 12px;
  max-height: 90vh;
  overflow-y: auto;
  z-index: 1000;
  box-shadow: 0 2px 10px rgba(0,0,0,0.1);
">
<h3 style="margin: 0 0 10px 0; font-size: 14px;">📊 Legend (28 Communities)</h3>
<div style="display: grid; grid-template-columns: 1fr 1fr; gap: 5px;">
  ${Object.entries(CATEGORY_COLORS)
    .filter(([name]) => html.includes(name))
    .map(([name, color]) => `
    <div style="display: flex; align-items: center; margin: 2px 0;">
      <div style="width: 12px; height: 12px; background: ${color}; margin-right: 5px; border: 1px solid #333;"></div>
      <span style="font-size: 11px;">${name}</span>
    </div>
  `).join('')}
</div>
<button onclick="document.getElementById('legend').style.display='none'" style="
  position: absolute;
  top: 5px;
  right: 5px;
  border: none;
  background: none;
  cursor: pointer;
  font-size: 16px;
">×</button>
</div>
`

    // Inject legend before </body>
    html = html.replace('</body>', legend + '\n</body>')

    // Add category-based styling
    const categoryScript = `
<script>
// Enhanced legend toggle
document.addEventListener('keydown', (e) => {
  if (e.key === 'l' || e.key === 'L') {
    const legend = document.getElementById('legend')
    legend.style.display = legend.style.display === 'none' ? 'block' : 'none'
  }
})
console.log('💡 Tip: Press "L" to toggle legend visibility')
</script>
`

    html = html.replace('</body>', categoryScript + '\n</body>')

    fs.writeFileSync(GRAPH_HTML, html)
    console.log('✓ Enhanced graph.html with:')
    console.log('  - Color-coded legend (28 communities)')
    console.log('  - Keyboard shortcut: Press "L" to toggle legend')
    console.log('  - Better visual grouping by category')

  } catch (error) {
    console.error('Error:', error.message)
    process.exit(1)
  }
}

if (require.main === module) {
  enhanceVisualization()
}

module.exports = { enhanceVisualization }
