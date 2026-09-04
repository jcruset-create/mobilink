/**
 * A qué empresa de TyreControl corresponde este cliente.
 *
 * ── Por qué esto se declara y no se adivina ─────────────────────────────────
 *
 * En TyreControl la matrícula es única DENTRO de una empresa, no en toda la
 * base. Sin saber de qué empresa hablamos, dos clientes con la misma matrícula
 * son indistinguibles, y actuar sobre el vehículo equivocado es exactamente lo
 * que no puede pasar.
 *
 * Comparar el nombre del cliente con el de la empresa acertaría casi siempre.
 * «Casi siempre» es la clase de acierto que falla sin avisar. Lo declara una
 * persona, una vez, y se acabó.
 *
 * Es configuración de oficina: no aparece en la pantalla del técnico ni le
 * añade ningún paso.
 */

import { useCallback, useEffect, useState } from "react";

import { API_BASE, getAdminHeaders } from "../modules/workshopApi";

type Empresa = { id: string; nombre: string; activa: boolean };
type Mapeo = { clienteId: number; tcEmpresaId: string; tcEmpresaNombre: string | null; activo: boolean };

async function pedir(ruta: string, init?: RequestInit) {
  const res = await fetch(`${API_BASE}${ruta}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...getAdminHeaders() },
  });
  const datos = await res.json().catch(() => null);
  if (!res.ok) throw new Error(datos?.error ?? "Error de servidor");
  return datos;
}

export default function MapeoTyreControl({ clienteId }: { clienteId: number }) {
  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [mapeo, setMapeo] = useState<Mapeo | null>(null);
  const [error, setError] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [recarga, setRecarga] = useState(0);
  /*
   * Si TyreControl no está disponible no se pinta nada: este bloque es una
   * comodidad para quien tenga los dos módulos, no un trozo de la ficha de
   * cliente que deba fallar si el otro sistema no contesta.
   */
  const [disponible, setDisponible] = useState(true);

  const recargar = useCallback(() => setRecarga((n) => n + 1), []);

  useEffect(() => {
    let vivo = true;
    Promise.all([
      pedir("/api/tyrecontrol/empresas"),
      pedir("/api/tyrecontrol/mapeos"),
    ])
      .then(([e, m]) => {
        if (!vivo) return;
        setEmpresas(e.data ?? []);
        setMapeo((m.data ?? []).find((x: Mapeo) => x.clienteId === clienteId) ?? null);
        setDisponible(true);
      })
      .catch(() => { if (vivo) setDisponible(false); });
    return () => { vivo = false; };
  }, [clienteId, recarga]);

  if (!disponible) return null;

  async function asignar(tcEmpresaId: string) {
    if (!tcEmpresaId) return;
    setOcupado(true);
    try {
      await pedir("/api/tyrecontrol/mapeos", {
        method: "PUT", body: JSON.stringify({ clienteId, tcEmpresaId }),
      });
      setError("");
      recargar();
    } catch (e: any) { setError(e.message); }
    finally { setOcupado(false); }
  }

  async function quitar() {
    if (!confirm("¿Quitar la correspondencia con TyreControl?\n\nLas matrículas de este cliente volverán a resolverse buscando en todas las empresas, y podrían quedar ambiguas.")) return;
    setOcupado(true);
    try {
      await pedir(`/api/tyrecontrol/mapeos/${clienteId}`, { method: "DELETE" });
      setError("");
      recargar();
    } catch (e: any) { setError(e.message); }
    finally { setOcupado(false); }
  }

  return (
    <div>
      <h3 className="mb-2 text-sm font-black uppercase tracking-wide text-slate-300">
        🛞 TyreControl
      </h3>

      {error && (
        <div className="mb-2 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-[13px] text-red-300">
          {error}
        </div>
      )}

      {mapeo ? (
        <div className="flex flex-wrap items-center gap-2 text-[13px]">
          <span className="text-slate-400">Empresa en TyreControl:</span>
          <span className="font-bold text-cyan-300">
            {mapeo.tcEmpresaNombre ?? mapeo.tcEmpresaId}
          </span>
          <button
            onClick={() => void quitar()} disabled={ocupado}
            className="rounded-lg border border-slate-600 px-2 py-1 text-[12px] font-bold text-slate-300 hover:bg-slate-700 disabled:opacity-50"
          >
            Quitar
          </button>
        </div>
      ) : (
        <div className="space-y-1">
          <select
            defaultValue="" disabled={ocupado}
            onChange={(e) => void asignar(e.target.value)}
            className="rounded-lg border border-slate-600 bg-slate-800 px-2 py-1.5 text-sm text-slate-200"
          >
            <option value="">Sin correspondencia</option>
            {empresas.filter((e) => e.activa).map((e) => (
              <option key={e.id} value={e.id}>{e.nombre}</option>
            ))}
          </select>
          <p className="text-[11px] text-slate-500">
            Sin esto, una matrícula que exista en varias empresas de TyreControl no se puede
            resolver y queda marcada como ambigua.
          </p>
        </div>
      )}
    </div>
  );
}
