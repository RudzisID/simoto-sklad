# WB & Ozon Sync Module

> **Status**: 🚧 In Development (Skeleton)  
> **Location**: `integrations/wb_ozon_sync.js`  
> **Purpose**: Synchronization of product data between Wildberries and Ozon platforms

---

## Overview

This module provides a scaffold for fetching, comparing, and preparing product data from Wildberries (WB) and Ozon marketplaces. Currently implements **mock data** — real API integration is planned.

---

## Architecture

### Core Functions

| Function | Purpose | Status |
|----------|---------|--------|
| `fetchWBData(codeList)` | Fetch product data from Wildberries | 🔴 Mock (simulateDelay 100ms) |
| `fetchOzonData(codeList)` | Fetch product data from Ozon | 🔴 Mock (simulateDelay 100ms) |
| `compareAndAggregate(wbData, ozonData)` | Merge data by product code | ✅ Ready |
| `prepareAddForWB(merged)` | Transform data for WB import | ✅ Ready |
| `prepareAddForOZON(merged)` | Transform data for Ozon upload | ✅ Ready |

### Data Flow

```
codeList (array of product codes)
    ↓
┌─────────────────────┐
│  fetchWBData()      │ → WB mock data (code, title, price, stock)
└─────────────────────┘
┌─────────────────────┐
│  fetchOzonData()    │ → Ozon mock data (code, title, price, stock)
└─────────────────────┘
         ↓
┌─────────────────────┐
│ compareAndAggregate()│ → Merged data (prefer WB price, sum stocks)
└─────────────────────┘
         ↓
    ┌──────────────┬──────────────┐
    │ prepareAddForWB│ prepareAddForOZON │
    └──────────────┴──────────────┘
         ↓                    ↓
    WB payload         Ozon payload
```

---

## Mock Data Structure

### WB Product (mock)
```javascript
{
  code: "12345",
  title: "WB Product 12345",
  price: 100-200 (random),
  stock: 0-20 (random),
  site: 'Wildberries'
}
```

### Ozon Product (mock)
```javascript
{
  code: "12345",
  title: "OZON Product 12345",
  price: 90-210 (random),
  stock: 0-25 (random),
  site: 'OZON'
}
```

---

## Merge Logic (`compareAndAggregate`)

**Algorithm**:
1. Create `Map` keyed by product `code`
2. Insert WB data first
3. For Ozon data:
   - If code exists: **prefer WB price** (Math.min), **sum stocks**
   - If code missing: add Ozon data
4. Return array of merged products

**Result structure**:
```javascript
{
  code: "12345",
  title: "WB Product 12345",
  price: 105,          // WB price preferred
  stock: 15,           // WB stock + Ozon stock
  site: 'Wildberries',
  sources: ['WB', 'OZON']  // track data sources
}
```

---

## Transformation Functions

### `prepareAddForWB(merged)`
Converts merged data to WB import format:
```javascript
{ code, title, price, stock }
```

### `prepareAddForOZON(merged)`
Converts merged data to Ozon upload format:
```javascript
{ code, name, price, quantity }
```
(Note: Ozon uses `name` and `quantity` instead of `title` and `stock`)

---

## Integration Point

**Used in**: `server.js` (lines 23, 844-845)
```javascript
const wbOzonSync = require('./integrations/wb_ozon_sync')
// ...
const wbData = await wbOzonSync.fetchWBData(wbCodes)
const ozonData = await wbOzonSync.fetchOzonData(ozonCodes)
```

---

## TODO (Real API Implementation)

### Wildberries API
- [ ] Replace `fetchWBData()` mock with real WB API call
- [ ] Handle authentication (API key/token)
- [ ] Implement error handling & retries
- [ ] Map WB API response to standard format

### Ozon API
- [ ] Replace `fetchOzonData()` mock with real Ozon API call
- [ ] Handle Ozon authentication (Client ID, API Key)
- [ ] Implement rate limiting
- [ ] Map Ozon API response to standard format

### Common
- [ ] Replace `simulateDelay()` with real API calls
- [ ] Add logging for sync operations
- [ ] Implement incremental sync (only fetch updated products)
- [ ] Add configuration for API endpoints & credentials

---

## Dependencies

- No external dependencies (uses only built-in `Promise` and `Map`)
- Relies on `server.js` for orchestration

---

## Notes

- Module is **isolated** (Community 8 in graph, cohesion 0.38)
- All functions are **pure** except the mock API calls
- Data merging prefers WB pricing but sums inventory from both platforms
- Transformation functions prepare platform-specific payloads

---

**Last updated**: 2026-05-04  
**Next step**: Implement real WB/Ozon API clients when credentials are available
