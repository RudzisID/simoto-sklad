/**
 * @file supplies/page.tsx
 * Redirect на /supplies/kanban.
 *
 * @route GET /app/supplies → /app/supplies/kanban
 */

import { redirect } from "react-router-dom"

export function loader() {
  return redirect("/supplies/kanban")
}

export default function SuppliesRedirectPage() {
  return null
}
