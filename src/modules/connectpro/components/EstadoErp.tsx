/**
 * Estado de una ficha frente al ERP externo, para los listados de proveedores
 * y de clientes.
 *
 * Mientras no haya ERP conectado todas salen como "No sincronizado", que es
 * exactamente lo que pasa. El estado viene de integration_mappings, así que la
 * misma ficha puede estar en SAP y en Business Central a la vez: aquí se
 * enseña el mapeo más reciente, y el detalle completo va en la ficha.
 */

import { Badge } from "./ui";

export type SyncStatus = "not_synced" | "pending" | "syncing" | "synced" | "error";

export type DatosErp = {
  erpSystem?: string | null;
  erpCode?: string | null;
  erpSyncStatus?: SyncStatus | string | null;
  erpLastSyncAtMs?: number | null;
  erpLastSyncError?: string | null;
};

const ESTILOS: Record<SyncStatus, { texto: string; clase: string }> = {
  not_synced: { texto: "No sincronizado", clase: "border-slate-600 text-slate-500" },
  pending: { texto: "Pendiente", clase: "border-amber-500/40 bg-amber-500/10 text-amber-300" },
  syncing: { texto: "Sincronizando", clase: "border-sky-500/40 bg-sky-500/10 text-sky-300" },
  synced: { texto: "Sincronizado", clase: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300" },
  error: { texto: "Error", clase: "border-red-500/40 bg-red-500/10 text-red-300" },
};

export default function EstadoErp({ datos }: { datos: DatosErp }) {
  const estado = (datos.erpSyncStatus ?? "not_synced") as SyncStatus;
  const estilo = ESTILOS[estado] ?? ESTILOS.not_synced;

  // El título lleva el porqué: un "Error" sin motivo obliga a abrir la ficha.
  const detalle = [
    datos.erpSystem && `Sistema: ${datos.erpSystem}`,
    datos.erpCode && `Código: ${datos.erpCode}`,
    datos.erpLastSyncAtMs && `Última sincronización: ${new Date(datos.erpLastSyncAtMs).toLocaleString("es-ES")}`,
    datos.erpLastSyncError && `Error: ${datos.erpLastSyncError}`,
  ].filter(Boolean).join("\n");

  return (
    <span title={detalle || "Sin ERP conectado todavía"}>
      <Badge className={estilo.clase}>{estilo.texto}</Badge>
      {datos.erpCode && <span className="ml-1.5 text-[11px] text-slate-500">{datos.erpCode}</span>}
    </span>
  );
}
