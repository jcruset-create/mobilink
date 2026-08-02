import { useCallback, useEffect, useState } from "react";
import { RefreshCw, ClipboardList } from "lucide-react";

/**
 * Pedidos ERP — bandeja de pedidos de venta de Business Central (SPEC §2, It.2).
 *
 * El pedido nace en BC (sistema maestro) y baja al Hub por sincronización; aquí se
 * consulta la copia local y se gestiona el estado operativo (planificación), que es
 * de WorkPlanner y nunca viaja a BC. Esta página no llama a Business Central: todo
 * va contra /api/v1 del Integration Hub.
 */

type OrderRow = {
  id: number;
  bc_number: string;
  customer_name: string;
  customer_number: string | null;
  ship_to_address: string | null;
  requested_date: string | null;
  bc_status: string | null;
  wp_status: string;
  num_lineas: number;
  updated_at_ms: number;
};

type OrderLine = {
  id: number;
  bc_line_no: number | null;
  tipo: string | null;
  bc_item_number: string | null;
  descripcion: string;
  qty_prevista: string | number | null;
  um: string | null;
  precio_bc: string | number | null;
  importe_bc: string | number | null;
  origen: string;
  aviso_divergencia: string | null;
};

const WP_STATUS_META: Record<string, { label: string; clase: string }> = {
  nueva: { label: "Nueva", clase: "bg-sky-500/15 text-sky-300" },
  planificada: { label: "Planificada", clase: "bg-violet-500/15 text-violet-300" },
  en_curso: { label: "En curso", clase: "bg-amber-500/15 text-amber-300" },
  finalizada: { label: "Finalizada", clase: "bg-emerald-500/15 text-emerald-300" },
  cancelada_por_erp: { label: "Cancelada en ERP", clase: "bg-rose-500/15 text-rose-300" },
};

/** Transiciones operativas permitidas desde la bandeja. */
const SIGUIENTE_ESTADO: Record<string, { a: string; label: string }> = {
  nueva: { a: "planificada", label: "Marcar planificada" },
  planificada: { a: "en_curso", label: "Iniciar trabajo" },
  en_curso: { a: "finalizada", label: "Finalizar" },
};

function tenantActual(): string {
  return localStorage.getItem("mobilink-tenant-id") || "default";
}

async function hubApi<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "x-tenant-id": tenantActual(),
      "x-admin-token": encodeURIComponent(localStorage.getItem("sea-admin-token") ?? ""),
      ...(init?.headers ?? {}),
    },
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error((body as any)?.message || (body as any)?.error || `Error ${res.status}`);
  return body as T;
}

function fmtFecha(ms: number | null): string {
  if (!ms) return "—";
  return new Date(Number(ms)).toLocaleString("es-ES", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export default function PedidosErpPage() {
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [lastSyncMs, setLastSyncMs] = useState<number | null>(null);
  const [sel, setSel] = useState<{ order: OrderRow; lines: OrderLine[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sincronizando, setSincronizando] = useState(false);
  const [filtroEstado, setFiltroEstado] = useState("");
  const [busqueda, setBusqueda] = useState("");

  const cargar = useCallback(async () => {
    setError(null);
    try {
      const params = new URLSearchParams();
      if (filtroEstado) params.set("estado", filtroEstado);
      if (busqueda.trim()) params.set("search", busqueda.trim());
      const data = await hubApi<{ orders: OrderRow[]; lastSyncMs: number | null }>(
        `/api/v1/erp/sales-orders?${params}`
      );
      setOrders(data.orders);
      setLastSyncMs(data.lastSyncMs);
    } catch (e: any) {
      setError(e.message);
    }
  }, [filtroEstado, busqueda]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const abrir = async (id: number) => {
    try {
      setSel(await hubApi(`/api/v1/erp/sales-orders/${id}`));
    } catch (e: any) {
      setError(e.message);
    }
  };

  const sincronizar = async () => {
    setSincronizando(true);
    setError(null);
    try {
      await hubApi(`/api/v1/admin/sales-orders/sync`, { method: "POST", body: "{}" });
      await cargar();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSincronizando(false);
    }
  };

  const cambiarEstado = async (order: OrderRow, nuevo: string) => {
    try {
      await hubApi(`/api/v1/erp/sales-orders/${order.id}/planning`, {
        method: "PATCH",
        body: JSON.stringify({ wpStatus: nuevo }),
      });
      await cargar();
      if (sel?.order.id === order.id) await abrir(order.id);
    } catch (e: any) {
      setError(e.message);
    }
  };

  return (
    <div className="mx-auto max-w-6xl p-4">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <h1 className="flex items-center gap-2 text-base font-black">
          <ClipboardList className="h-5 w-5 text-sky-400" /> Pedidos ERP
        </h1>
        <span className="text-[11px] text-slate-500">
          {lastSyncMs ? `Última sync: ${fmtFecha(lastSyncMs)}` : "Sin sincronizar todavía"}
        </span>
        <button
          onClick={sincronizar}
          disabled={sincronizando}
          className="ml-auto flex items-center gap-1.5 rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-sky-500 disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${sincronizando ? "animate-spin" : ""}`} />
          {sincronizando ? "Sincronizando…" : "Sincronizar"}
        </button>
      </div>

      {error && <div className="mb-3 rounded-lg bg-rose-500/10 p-2 text-xs text-rose-300">{error}</div>}

      <div className="mb-3 flex flex-wrap gap-2">
        <select
          value={filtroEstado}
          onChange={(e) => setFiltroEstado(e.target.value)}
          className="rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-xs text-slate-200"
        >
          <option value="">Todos los estados</option>
          {Object.entries(WP_STATUS_META).map(([k, v]) => (
            <option key={k} value={k}>{v.label}</option>
          ))}
        </select>
        <input
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          placeholder="Buscar por nº o cliente…"
          className="w-56 rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-xs text-slate-200"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Bandeja */}
        <div className="overflow-x-auto rounded-xl border border-slate-700">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-800/80 text-slate-300">
              <tr>
                <th className="px-3 py-2">Pedido</th>
                <th className="px-3 py-2">Cliente</th>
                <th className="px-3 py-2">Líneas</th>
                <th className="px-3 py-2">Estado</th>
              </tr>
            </thead>
            <tbody>
              {orders.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-3 py-6 text-center text-slate-500">
                    No hay pedidos sincronizados. Pulsa «Sincronizar» para traerlos de Business Central.
                  </td>
                </tr>
              )}
              {orders.map((o) => {
                const meta = WP_STATUS_META[o.wp_status] ?? { label: o.wp_status, clase: "bg-slate-500/15 text-slate-300" };
                return (
                  <tr
                    key={o.id}
                    onClick={() => void abrir(o.id)}
                    className={`cursor-pointer border-t border-slate-800 hover:bg-slate-800/50 ${sel?.order.id === o.id ? "bg-slate-800/70" : ""}`}
                  >
                    <td className="px-3 py-2 font-mono text-sky-300">{o.bc_number}</td>
                    <td className="px-3 py-2">{o.customer_name}</td>
                    <td className="px-3 py-2 text-slate-400">{o.num_lineas}</td>
                    <td className="px-3 py-2">
                      <span className={`rounded px-2 py-0.5 text-[10px] font-bold ${meta.clase}`}>{meta.label}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Detalle */}
        <div className="rounded-xl border border-slate-700 bg-slate-800/40 p-4">
          {!sel ? (
            <div className="py-10 text-center text-sm text-slate-500">Selecciona un pedido para ver el detalle.</div>
          ) : (
            <div>
              <div className="mb-2 flex items-start justify-between gap-2">
                <div>
                  <div className="font-mono text-sm font-black text-sky-300">{sel.order.bc_number}</div>
                  <div className="text-sm">{sel.order.customer_name}</div>
                  {sel.order.ship_to_address && (
                    <div className="text-xs text-slate-400">{sel.order.ship_to_address}</div>
                  )}
                  {sel.order.requested_date && (
                    <div className="text-xs text-slate-500">Fecha solicitada: {sel.order.requested_date}</div>
                  )}
                </div>
                {SIGUIENTE_ESTADO[sel.order.wp_status] && (
                  <button
                    onClick={() => void cambiarEstado(sel.order, SIGUIENTE_ESTADO[sel.order.wp_status].a)}
                    className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-500"
                  >
                    {SIGUIENTE_ESTADO[sel.order.wp_status].label}
                  </button>
                )}
              </div>

              <table className="w-full text-left text-xs">
                <thead className="text-slate-500">
                  <tr>
                    <th className="py-1">Artículo</th>
                    <th className="py-1">Descripción</th>
                    <th className="py-1 text-right">Cant.</th>
                    <th className="py-1 text-right">Precio BC</th>
                  </tr>
                </thead>
                <tbody>
                  {sel.lines.map((l) => (
                    <tr key={l.id} className="border-t border-slate-800">
                      <td className="py-1.5 font-mono text-slate-300">{l.bc_item_number ?? "—"}</td>
                      <td className="py-1.5">
                        {l.descripcion}
                        {l.aviso_divergencia && (
                          <div className="text-[10px] text-amber-400">⚠ {l.aviso_divergencia}</div>
                        )}
                      </td>
                      <td className="py-1.5 text-right">
                        {l.qty_prevista != null ? Number(l.qty_prevista) : "—"} {l.um ?? ""}
                      </td>
                      <td className="py-1.5 text-right">
                        {l.precio_bc != null ? `${Number(l.precio_bc).toFixed(2)} €` : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-3 text-[10px] text-slate-500">
                Precios e impuestos los fija Business Central. La planificación (técnicos, fechas) es local
                y no viaja al ERP.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
