> ⚠️ **УСТАРЕЛ (аудит 2026-10-28).** KanbanBoard / KanbanColumn / KanbanCard не нужны — вид табличный.
> Компонент warehouse-stock-table.tsx и типы остаются актуальными.
> Handlers в outes/supplies/* — TODO, требуют реализации после API routes.

# PLAN-03: Фронтенд — React компоненты

> Дата: 2026-10-28
> Этап: Фронтенд (React UI)
> Зависимости: PLAN-01 (дизайн одобрен), PLAN-02 (бэкенд готов)
> Референс: `simoto_main/apps/backend/src/admin/routes/tasks/page.tsx` (канбан)

---

## 1. Структура файлов

```
apps/backend/src/admin/
├── routes/supplies/
│   ├── page.tsx                      ← redirect на /supplies/kanban
│   └── supplies/
│       └── page.tsx                  ← Канбан поставок
├── routes/warehouse/
│   └── page.tsx                      ← Склад (остатки)
└── components/supplies/
    ├── kanban-board.tsx              ← Контейнер канбана
    ├── kanban-column.tsx             ← Колонка
    ├── kanban-card.tsx               ← Карточка заказа
    ├── order-detail-modal.tsx        ← Детали заказа
    ├── progress-modal.tsx            ← Прогресс polling
    ├── scan-controls.tsx             ← Кнопка сканирования + фильтры
    ├── warehouse-stock-table.tsx     ← Таблица остатков
    ├── marketplace-badge.tsx         ← Бейдж WB/Ozon
    ├── action-toolbar.tsx            ← Кнопки действий (отгрузить/оплатить/вернуть)
    ├── use-supplies-polling.ts       ← Custom hook (polling)
    ├── use-kanban-realtime.ts        ← Custom hook (realtime через Redis)
    └── types.ts                      ← TypeScript типы для UI
```

---

## 2. Страница канбана (supplies/page.tsx)

### 2.1. Структура

```tsx
import { defineRouteConfig } from "@medusajs/admin-sdk"
import { Medusa } from "@medusajs/js-sdk"
import { useQuery } from "@tanstack/react-query"
import { useCallback, useState } from "react"
import { KanbanBoard } from "../../components/supplies/kanban-board"
import { ScanControls } from "../../components/supplies/scan-controls"
import { useSuppliesPolling } from "../../components/supplies/use-supplies-polling"

const sdk = new Medusa({ baseUrl: "/", auth: { type: "session" } })

export const config = defineRouteConfig({ label: "Канбан поставок", rank: 50 })

const COLUMNS = [
  { id: "new", title: "Новые", color: "zinc" },
  { id: "checking", title: "Проверяется", color: "amber" },
  { id: "can_ship", title: "К отгрузке", color: "sky" },
  { id: "shipped", title: "Отгружено", color: "indigo" },
  { id: "can_pay", title: "К оплате", color: "violet" },
  { id: "paid", title: "Оплачено", color: "emerald" },
  { id: "can_return", title: "К возврату", color: "orange" },
  { id: "returned", title: "Возвращено", color: "red" },
  { id: "cancelled", title: "Отменён", color: "zinc" },
  { id: "delayed", title: "Отложено", color: "amber" },
] as const

export default function SuppliesKanbanPage() {
  const [filters, setFilters] = useState<FilterState>({
    marketplace: undefined,
    storeId: undefined,
    dateFrom: undefined,
    dateTo: undefined,
  })

  // Polling — получение заказов канбана
  const { data: orders, isLoading, refetch } = useSuppliesPolling(filters)
  
  // Группировка по колонкам
  const columns = useMemo(() => {
    return COLUMNS.map(col => ({
      ...col,
      orders: orders?.filter(o => o.status === col.id) ?? [],
    }))
  }, [orders])

  // Drag-and-drop handler
  const handleDragEnd = useCallback(async (cardId: string, targetColumnId: string) => {
    await sdk.admin.supplies.updateStatus(cardId, targetColumnId)
    refetch()
  }, [refetch])

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold mb-4">Поставки</h1>
      
      <ScanControls
        filters={filters}
        onFiltersChange={setFilters}
        onScan={() => {/* запуск сканирования */}}
        onRefreshWb={() => {/* обновление WB */}}
        onRefreshOzon={() => {/* обновление Ozon */}
      />
      
      {isLoading ? (
        <LoadingSkeleton />
      ) : (
        <KanbanBoard columns={columns} onDragEnd={handleDragEnd} />
      )}
    </div>
  )
}
```

### 2.2. Polling hook

```tsx
// use-supplies-polling.ts
import { useQuery } from "@tanstack/react-query"
import { Medusa } from "@medusajs/js-sdk"

const sdk = new Medusa({ baseUrl: "/", auth: { type: "session" } })

export function useSuppliesPolling(filters: FilterState) {
  return useQuery({
    queryKey: ["supplies-orders", filters],
    queryFn: async () => {
      const { data } = await sdk.admin.supplies.list(filters)
      return data
    },
    refetchInterval: 5000,  // 5 секунд (как в tasks)
    staleTime: 2000,
  })
}

export function useScanProgress(enabled: boolean) {
  return useQuery({
    queryKey: ["supplies-scan-progress"],
    queryFn: async () => {
      const { data } = await sdk.admin.supplies.scanProgress()
      return data
    },
    refetchInterval: 1000,  // 1 секунда во время сканирования
    enabled,
  })
}
```

---

## 3. Компоненты

### 3.1. KanbanBoard

```tsx
// kanban-board.tsx
import { DndContext, DragEndEvent } from "@dnd-kit/core"
import { SortableContext } from "@dnd-kit/sortable"
import { KanbanColumn } from "./kanban-column"

export function KanbanBoard({ columns, onDragEnd }) {
  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over) return
    
    const cardId = active.id as string
    const targetColumnId = over.id as String
    
    // Перетаскивание в колонку
    if (columns.find(c => c.id === targetColumnId)) {
      onDragEnd(cardId, targetColumnId)
    }
  }

  return (
    <DndContext onDragEnd={handleDragEnd}>
      <div className="flex gap-4 overflow-x-auto pb-4">
        {columns.map(col => (
          <KanbanColumn
            key={col.id}
            id={col.id}
            title={col.title}
            count={col.orders.length}
            color={col.color}
            orders={col.orders}
          />
        ))}
      </div>
    </DndContext>
  )
}
```

### 3.2. KanbanColumn

```tsx
// kanban-column.tsx
import { useDroppable } from "@dnd-kit/core"
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable"
import { KanbanCard } from "./kanban-card"

export function KanbanColumn({ id, title, count, color, orders }) {
  const { setNodeRef, isOver } = useDroppable({ id })

  const colorClasses = {
    zinc: "bg-zinc-500",
    amber: "bg-amber-500",
    sky: "bg-sky-500",
    indigo: "bg-indigo-500",
    violet: "bg-violet-500",
    emerald: "bg-emerald-500",
    orange: "bg-orange-500",
    red: "bg-red-500",
  }

  return (
    <div
      ref={setNodeRef}
      className={`flex-shrink-0 w-72 rounded-lg border ${isOver ? "border-blue-400" : "border-zinc-200"} bg-zinc-50`}
    >
      {/* Заголовок колонки */}
      <div className="p-3 border-b border-zinc-200">
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${colorClasses[color]}`} />
          <span className="font-medium text-sm">{title}</span>
          <span className="text-xs text-zinc-500">({count})</span>
        </div>
      </div>

      {/* Список карточек */}
      <div className="p-2 space-y-2 max-h-[calc(100vh-200px)] overflow-y-auto">
        <SortableContext items={orders.map(o => o.id)} strategy={verticalListSortingStrategy}>
          {orders.map(order => (
            <KanbanCard key={order.id} order={order} />
          ))}
        </SortableContext>
      </div>
    </div>
  )
}
```

### 3.3. KanbanCard

```tsx
// kanban-card.tsx
import { useSortable } from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { CSSProperties, useState } from "react"
import { DropdownMenu } from "@medusajs/ui"
import { MarketplaceBadge } from "./marketplace-badge"

export function KanbanCard({ order }) {
  const [showDetail, setShowDetail] = useState(false)
  
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: order.id })

  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

  // Контекстные действия
  const actions = [
    { label: "Просмотр", onClick: () => setShowDetail(true), always: true },
    { label: "Отгрузить", onClick: () => handleDemand(order.id), show: order.can_demand },
    { label: "Оплатить", onClick: () => handlePayment(order.id), show: order.can_payment },
    { label: "Вернуть", onClick: () => handleReturn(order.id), show: order.can_return },
    { label: "Отменить", onClick: () => handleCancel(order.id), show: order.can_cancel },
  ]

  return (
    <>
      <div
        ref={setNodeRef}
        style={style}
        {...attributes}
        {...listeners}
        className="bg-white rounded-md shadow-sm border border-zinc-200 p-3 cursor-grab active:cursor-grabbing hover:shadow-md transition-shadow"
      >
        <div className="flex items-start justify-between mb-2">
          <div className="flex items-center gap-2">
            {order.thumbnail_url && (
              <img src={order.thumbnail_url} className="w-8 h-8 rounded object-cover" />
            )}
            <span className="font-mono text-sm font-medium">{order.shipment_number}</span>
          </div>
          
          <DropdownMenu>
            <DropdownMenu.Trigger>
              <Button variant="ghost" size="small">⋯</Button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Content>
              {actions.filter(a => a.always || a.show).map(a => (
                <DropdownMenu.Item key={a.label} onClick={a.onClick}>
                  {a.label}
                </DropdownMenu.Item>
              ))}
            </DropdownMenu.Content>
          </DropdownMenu>
        </div>
        
        <div className="flex items-center justify-between text-sm">
          <span className="font-medium">{formatRubles(order.order_sum)}</span>
          <span className="text-zinc-500">{order.positions?.length ?? 0} поз.</span>
        </div>
        
        <div className="flex items-center gap-2 mt-2 text-xs text-zinc-500">
          <MarketplaceBadge marketplace={order.marketplace} />
          <span>{formatDate(order.ms_order_moment)}</span>
        </div>

        {/* Action buttons при hover */}
        <div className="flex gap-1 mt-2 opacity-0 group-hover:opacity-100 transition-opacity">
          {order.can_demand && <ActionButton icon="📦" title="Отгрузить" onClick={() => handleDemand(order.id)} />}
          {order.can_payment && <ActionButton icon="💰" title="Оплатить" onClick={() => handlePayment(order.id)} />}
          {order.can_return && <ActionButton icon="↩️" title="Вернуть" onClick={() => handleReturn(order.id)} />}
        </div>
      </div>

      {/* Order Detail Modal */}
      {showDetail && (
        <OrderDetailModal
          orderId={order.id}
          onClose={() => setShowDetail(false)}
        />
      )}
    </>
  )
}
```

### 3.4. OrderDetailModal

```tsx
// order-detail-modal.tsx
import { FocusModal, toast } from "@medusajs/ui"
import { useQuery, useMutation } from "@tanstack/react-query"
import { Medusa } from "@medusajs/js-sdk"

const sdk = new Medusa({ baseUrl: "/", auth: { type: "session" } })

export function OrderDetailModal({ orderId, onClose }) {
  const { data: order } = useQuery({
    queryKey: ["supplies-order", orderId],
    queryFn: () => sdk.admin.supplies(orderId).get(),
  })

  const demandMutation = useMutation({
    mutationFn: () => sdk.admin.supplies(orderId).demand.create(),
    onSuccess: () => { toast.success("Отгрузка создана"); onClose() },
    onError: (err) => { toast.error(`Ошибка: ${err.message}`) },
  })

  const paymentMutation = useMutation({
    mutationFn: () => sdk.admin.supplies(orderId).payment.create(),
    onSuccess: () => { toast.success("Платёж создан"); onClose() },
    onError: (err) => { toast.error(`Ошибка: ${err.message}`) },
  })

  const returnMutation = useMutation({
    mutationFn: () => sdk.admin.supplies(orderId).return.create(),
    onSuccess: () => { toast.success("Возврат создан"); onClose() },
    onError: (err) => { toast.error(`Ошибка: ${err.message}`) },
  })

  const cancelMutation = useMutation({
    mutationFn: () => sdk.admin.supplies(orderId).cancel.create(),
    onSuccess: () => { toast.success("Заказ отменён"); onClose() },
    onError: (err) => { toast.error(`Ошибка: ${err.message}`) },
  })

  return (
    <FocusModal open onOpenChange={onClose}>
      <FocusModal.Content>
        <FocusModal.Header>
          <h2>Заказ {order?.shipment_number}</h2>
        </FocusModal.Header>
        <FocusModal.Body>
          {/* Основная информация */}
          <div className="grid grid-cols-2 gap-4 mb-6">
            <InfoRow label="Заказ МС" value={order?.ms_order_name} />
            <InfoRow label="Сумма" value={formatRubles(order?.order_sum)} />
            <InfoRow label="Оплачено" value={formatRubles(order?.paid_sum)} />
            <InfoRow label="Отгружено" value={formatRubles(order?.shipped_sum)} />
            <InfoRow label="Статус" value={order?.status} />
            <InfoRow label="Площадка" value={<MarketplaceBadge marketplace={order?.marketplace} />} />
            <InfoRow label="Склад" value={order?.store_name} />
            <InfoRow label="Дата" value={formatDate(order?.ms_order_moment)} />
          </div>

          {/* Позиции */}
          <h3 className="font-medium mb-2">Позиции</h3>
          <DataTable
            columns={[
              { header: "OEM", accessor: "code" },
              { header: "Наименование", accessor: "name" },
              { header: "Кол-во", accessor: "quantity" },
              { header: "Цена", accessor: "price", cell: (v) => formatRubles(v) },
            ]}
            data={order?.positions ?? []}
          />

          {/* История */}
          <h3 className="font-medium mb-2 mt-4">История</h3>
          <div className="space-y-1">
            {order?.actions?.map(a => (
              <div key={a.id} className="text-sm text-zinc-600">
                {formatDate(a.created_at)} — {a.action_type} ({a.actor_name})
              </div>
            ))}
          </div>

          {/* Action Buttons */}
          <div className="flex gap-2 mt-6">
            {order?.can_demand && (
              <Button onClick={() => demandMutation.mutate()} loading={demandMutation.isPending}>
                📦 Отгрузить
              </Button>
            )}
            {order?.can_payment && (
              <Button onClick={() => paymentMutation.mutate()} loading={paymentMutation.isPending}>
                💰 Оплатить
              </Button>
            )}
            {order?.can_return && (
              <Button variant="secondary" onClick={() => returnMutation.mutate()} loading={returnMutation.isPending}>
                ↩️ Вернуть
              </Button>
            )}
            {order?.can_cancel && (
              <Button variant="danger" onClick={() => cancelMutation.mutate()} loading={cancelMutation.isPending}>
                ✕ Отменить
              </Button>
            )}
          </div>
        </FocusModal.Body>
      </FocusModal.Content>
    </FocusModal>
  )
}
```

### 3.5. ProgressModal

```tsx
// progress-modal.tsx
import { FocusModal, ProgressBar } from "@medusajs/ui"
import { useScanProgress } from "./use-supplies-polling"

export function ProgressModal({ isOpen, onClose }) {
  const { data: progress } = useScanProgress(isOpen)
  
  if (!progress) return null
  
  const percent = progress.total > 0 ? (progress.processed / progress.total) * 100 : 0

  return (
    <FocusModal open={isOpen} onOpenChange={onClose}>
      <FocusModal.Content>
        <FocusModal.Header>
          <h2>🔄 Сканирование поставок</h2>
        </FocusModal.Header>
        <FocusModal.Body>
          <ProgressBar value={percent} />
          <p className="mt-2 text-sm text-zinc-600">
            Проверено {progress.processed} из {progress.total} заказов
          </p>
          <p className="text-xs text-zinc-500">
            WB: {progress.wb} | Ozon: {progress.ozon}
          </p>
          
          {progress.status === "running" && (
            <Button variant="secondary" onClick={() => cancelScan()} className="mt-4">
              Отменить
            </Button>
          )}
          
          {progress.status === "completed" && (
            <p className="mt-4 text-emerald-600 font-medium">✅ Сканирование завершено</p>
          )}
        </FocusModal.Body>
      </FocusModal.Content>
    </FocusModal>
  )
}
```

### 3.6. ScanControls

```tsx
// scan-controls.tsx
import { Button, DropdownMenu, Input } from "@medusajs/ui"

export function ScanControls({ filters, onFiltersChange, onScan, onRefreshWb, onRefreshOzon }) {
  return (
    <div className="flex items-center gap-3 mb-4">
      {/* Сканировать */}
      <Button onClick={onScan} variant="primary">
        🔄 Сканировать
      </Button>
      
      {/* Обновление кэшей */}
      <Button variant="secondary" onClick={onRefreshWb}>
        🔄 WB кэш
      </Button>
      <Button variant="secondary" onClick={onRefreshOzon}>
        🔄 Ozon кэш
      </Button>
      
      {/* Фильтры */}
      <DropdownMenu>
        <DropdownMenu.Trigger>
          <Button variant="secondary">Площадка: {filters.marketplace ?? "Все"}</Button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Content>
          <DropdownMenu.Item onClick={() => onFiltersChange({...filters, marketplace: undefined})}>
            Все
          </DropdownMenu.Item>
          <DropdownMenu.Item onClick={() => onFiltersChange({...filters, marketplace: "wb"})}>
            Wildberries
          </DropdownMenu.Item>
          <DropdownMenu.Item onClick={() => onFiltersChange({...filters, marketplace: "ozon"})}>
            Ozon
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu>
      
      <DropdownMenu>
        <DropdownMenu.Trigger>
          <Button variant="secondary">Склад: {filters.storeId ?? "Все"}</Button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Content>
          <DropdownMenu.Item onClick={() => onFiltersChange({...filters, storeId: undefined})}>
            Все
          </DropdownMenu.Item>
          {/* Склады из API */}
        </DropdownMenu.Content>
      </DropdownMenu>
      
      {/* Даты */}
      <Input
        type="date"
        value={filters.dateFrom ?? ""}
        onChange={(e) => onFiltersChange({...filters, dateFrom: e.target.value})}
      />
      <Input
        type="date"
        value={filters.dateTo ?? ""}
        onChange={(e) => onFiltersChange({...filters, dateTo: e.target.value})}
      />
    </div>
  )
}
```

### 3.7. MarketplaceBadge

```tsx
// marketplace-badge.tsx
import { Badge } from "@medusajs/ui"

const CONFIG = {
  wb: { label: "WB", className: "bg-violet-100 text-violet-800" },
  ozon: { label: "Ozon", className: "bg-blue-100 text-blue-800" },
  unknown: { label: "?", className: "bg-zinc-100 text-zinc-800" },
}

export function MarketplaceBadge({ marketplace }) {
  const { label, className } = CONFIG[marketplace] ?? CONFIG.unknown
  return <Badge className={className}>{label}</Badge>
}
```

---

## 4. Страница склада (warehouse/page.tsx)

```tsx
import { defineRouteConfig } from "@medusajs/admin-sdk"
import { useQuery } from "@tanstack/react-query"
import { Medusa } from "@medusajs/js-sdk"
import { useState } from "react"
import { DataTable, Button, Input, DropdownMenu, Badge } from "@medusajs/ui"

const sdk = new Medusa({ baseUrl: "/", auth: { type: "session" } })

export const config = defineRouteConfig({ label: "Склад", rank: 51 })

export default function WarehousePage() {
  const [filters, setFilters] = useState({ storeId: undefined, brand: undefined, oem: "", lowStock: false })
  
  const { data: stock, refetch } = useQuery({
    queryKey: ["warehouse-stock", filters],
    queryFn: () => sdk.admin.supplies.warehouse.get(filters),
  })

  const handleExport = async () => {
    // Экспорт в XLSX (как в текущем app.js)
    const xlsx = await sdk.admin.supplies.warehouse.export(filters)
    downloadFile(xlsx, "stock.xlsx")
  }

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold mb-4">Склад</h1>
      
      {/* Toolbar */}
      <div className="flex items-center gap-3 mb-4">
        <Button onClick={() => refetch()}>🔄 Обновить</Button>
        <Button variant="secondary" onClick={handleExport}>📥 Экспорт XLSX</Button>
        
        <Input
          placeholder="Поиск по OEM..."
          value={filters.oem}
          onChange={(e) => setFilters({...filters, oem: e.target.value})}
        />
        
        <DropdownMenu>
          <DropdownMenu.Trigger>
            <Button variant="secondary">Склад: {filters.storeId ?? "Все"}</Button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Content>
            <DropdownMenu.Item onClick={() => setFilters({...filters, storeId: undefined})}>
              Все
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu>
        
        <Button
          variant={filters.lowStock ? "primary" : "secondary"}
          onClick={() => setFilters({...filters, lowStock: !filters.lowStock})}
        >
          ⚠️ Малый остаток
        </Button>
      </div>
      
      {/* Таблица */}
      <DataTable
        columns={[
          { header: "OEM", accessor: "code" },
          { header: "Наименование", accessor: "name" },
          { header: "Бренд", accessor: "article" },
          { header: "Склад", accessor: "storeName" },
          {
            header: "Остаток",
            accessor: "stock",
            cell: (v, row) => (
              <span className={v === 0 ? "text-red-600 font-bold" : v < 5 ? "text-amber-600" : ""}>
                {v}
              </span>
            ),
          },
          { header: "Резерв", accessor: "reserve" },
          { header: "В пути", accessor: "inTransit" },
          { header: "Цена", accessor: "salePrice", cell: (v) => formatRubles(v) },
        ]}
        data={stock?.items ?? []}
        isLoading={!stock}
      />
    </div>
  )
}
```

---

## 5. TypeScript типы (types.ts)

```tsx
export interface SuppliesOrder {
  id: string
  tenant_id: string
  ms_order_href: string
  ms_order_name: string | null
  ms_order_moment: string | null
  shipment_number: string
  marketplace: "wb" | "ozon" | "unknown"
  order_sum: number
  paid_sum: number
  shipped_sum: number
  status: string
  lifecycle_status: string | null
  can_demand: boolean
  can_payment: boolean
  can_return: boolean
  can_cancel: boolean
  demand_href: string | null
  payment_href: string | null
  return_href: string | null
  positions: Array<{
    code: string
    name: string
    quantity: number
    price: number
    assortment_href: string
  }> | null
  last_checked_at: string | null
  last_action: string | null
  last_action_at: string | null
  last_action_by: string | null
  thumbnail_url?: string | null
}

export interface KanbanColumn {
  id: string
  title: string
  color: string
  orders: SuppliesOrder[]
}

export interface FilterState {
  marketplace?: "wb" | "ozon"
  storeId?: string
  dateFrom?: string
  dateTo?: string
}

export interface ScanProgress {
  processed: number
  total: number
  wb: number
  ozon: number
  status: "idle" | "running" | "completed" | "cancelled"
}

export interface WarehouseStockItem {
  assortment_href: string
  name: string
  code: string
  article: string | null
  stock: number
  reserve: number
  inTransit: number
  price: number | null
  salePrice: number | null
}
```

---

## 6. Realtime (Redis pub/sub polling)

```tsx
// use-kanban-realtime.ts
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useEffect } from "react"

export function useKanbanRealtime(tenantId: string) {
  const queryClient = useQueryClient()
  
  // Polling каждые 5 секунд
  const { data: realtimeEvent } = useQuery({
    queryKey: ["supplies-realtime", tenantId],
    queryFn: async () => {
      const response = await fetch(`/admin/supplies/realtime?tenant_id=${tenantId}`)
      return response.json()
    },
    refetchInterval: 5000,
  })
  
  // При получении события — invalidate queries
  useEffect(() => {
    if (realtimeEvent) {
      queryClient.invalidateQueries({ queryKey: ["supplies-orders"] })
      queryClient.invalidateQueries({ queryKey: ["supplies-scan-progress"] })
    }
  }, [realtimeEvent, queryClient])
}
```

---

## 7. Регистрация routes

```tsx
// routes/supplies/supplies/page.tsx
import { defineRouteConfig } from "@medusajs/admin-sdk"

export const config = defineRouteConfig({
  label: "Канбан поставок",
  rank: 50,
})
