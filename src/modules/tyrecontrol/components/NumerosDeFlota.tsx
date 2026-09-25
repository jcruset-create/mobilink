import { useState } from "react";
import { Hash, TriangleAlert } from "lucide-react";
import {
  aplicarNumerosDeFlota, numerosDeFlota,
  type CambioNumeroFlota, type CuentaTelematica,
} from "../services/conciliacion";

/**
 * El número de bus que el proveedor lleva en el nombre, puesto en la ficha.
 *
 * Movertis nombra la flota poniendo el número delante de la matrícula —«1807
 * 7523-NNB»—, y en TyreControl ese campo estaba vacío en media flota porque el
 * alta desde el proveedor nunca lo rellenaba. Esto es el repaso: mira qué
 * buses ya enlazados cambiarían, lo enseña, y escribe solo lo que se marque.
 *
 * ── Por qué los conflictos van aparte ───────────────────────────────────────
 *
 * Pisar un número que ya está escrito se pidió a propósito, pero no es lo
 * mismo que rellenar un hueco: si alguien lo corrigió a mano porque el
 * proveedor lo tenía mal, aplicar esto se lo lleva por delante. Van en su
 * propio bloque, en ámbar, con el valor de antes al lado del de después y sin
 * marcar de salida — «marcar todos» marca los huecos, no los conflictos.
 */
export default function NumerosDeFlota({
  empresaId,
  cuenta,
}: {
  empresaId: string;
  cuenta: CuentaTelematica | null;
}) {
  const [cambios, setCambios] = useState<CambioNumeroFlota[] | null>(null);
  const [marcados, setMarcados] = useState<Set<string>>(new Set());
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");

  const huecos = (cambios ?? []).filter((c) => c.tipo === "rellena");
  const conflictos = (cambios ?? []).filter((c) => c.tipo === "conflicto");

  async function buscar() {
    if (!cuenta) return;
    setOcupado(true); setError(""); setMsg("");
    try {
      const r = await numerosDeFlota({
        empresaId, connectorKey: cuenta.connectorKey, accountKey: cuenta.accountKey,
      });
      setCambios(r.cambios);
      // Los huecos vienen marcados: es lo que se viene a hacer. Los conflictos
      // no, que son los que hay que mirar uno a uno.
      setMarcados(new Set(r.cambios.filter((c) => c.tipo === "rellena").map((c) => c.vehiculoId)));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setOcupado(false);
    }
  }

  async function aplicar() {
    if (!cuenta || marcados.size === 0) return;
    const nConflictos = conflictos.filter((c) => marcados.has(c.vehiculoId)).length;
    if (
      nConflictos > 0 &&
      !confirm(
        `${nConflictos} de los marcados YA tienen número de flota y se les va a cambiar ` +
          `por el de ${cuenta.connectorKey}. Si alguno se corrigió a mano, se pierde. ¿Seguir?`,
      )
    ) return;

    setOcupado(true); setError(""); setMsg("");
    try {
      const r = await aplicarNumerosDeFlota({
        empresaId,
        connectorKey: cuenta.connectorKey,
        accountKey: cuenta.accountKey,
        vehiculoIds: [...marcados],
      });
      setMsg(
        `${r.aplicados.length} número(s) de flota escritos.` +
          (r.fallidos.length ? ` ${r.fallidos.length} fallaron.` : "") +
          (r.omitidos.length ? ` ${r.omitidos.length} ya no salían en la propuesta.` : ""),
      );
      await buscar();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setOcupado(false);
    }
  }

  function alternar(id: string) {
    setMarcados((antes) => {
      const s = new Set(antes);
      if (s.has(id)) s.delete(id); else s.add(id);
      return s;
    });
  }

  function Fila({ c }: { c: CambioNumeroFlota }) {
    return (
      <label className="flex cursor-pointer items-center gap-3 border-t border-slate-700 px-3 py-2 hover:bg-slate-700/30">
        <input
          type="checkbox"
          className="h-4 w-4"
          checked={marcados.has(c.vehiculoId)}
          onChange={() => alternar(c.vehiculoId)}
        />
        <div className="min-w-0 flex-1">
          <div className="font-black text-slate-100">{c.matricula}</div>
          <div className="truncate font-mono text-xs text-slate-500">{c.nombreProveedor}</div>
        </div>
        <div className="shrink-0 text-right text-sm">
          {c.numeroActual !== null && (
            <span className="mr-2 text-slate-500 line-through">{c.numeroActual}</span>
          )}
          <span className={c.tipo === "conflicto" ? "font-black text-amber-300" : "font-black text-emerald-300"}>
            {c.numeroPropuesto}
          </span>
        </div>
      </label>
    );
  }

  return (
    <div className="mb-3 rounded-2xl border border-slate-700 bg-slate-800 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="flex items-center gap-2 font-bold">
            <Hash className="h-4 w-4 text-sky-400" />
            Números de flota desde el proveedor
          </div>
          <p className="text-xs text-slate-500">
            El número que {cuenta?.connectorKey ?? "el proveedor"} lleva delante de la matrícula, puesto
            en «Nº de unidad». Solo sobre vehículos ya enlazados, y solo lo que marques.
          </p>
        </div>
        <button
          onClick={() => void buscar()}
          disabled={!cuenta || ocupado}
          className="rounded-lg border border-sky-600 px-3 py-2 text-xs font-bold text-sky-300 hover:bg-sky-500/10 disabled:opacity-40"
        >
          {ocupado ? "Mirando…" : "Buscar números"}
        </button>
      </div>

      {error && <div className="mt-3 rounded-lg bg-red-500/10 p-3 text-sm text-red-300">{error}</div>}
      {msg && <div className="mt-3 rounded-lg bg-emerald-500/10 p-3 text-sm text-emerald-300">{msg}</div>}

      {cambios !== null && cambios.length === 0 && (
        <div className="mt-3 text-sm text-slate-400">
          No hay nada que cambiar: todos los enlazados tienen ya el número que dice el proveedor,
          o el proveedor no lo dice en su nombre.
        </div>
      )}

      {cambios !== null && cambios.length > 0 && (
        <>
          {huecos.length > 0 && (
            <div className="mt-3 overflow-hidden rounded-xl border border-slate-700">
              <div className="bg-slate-900/60 px-3 py-2 text-xs font-bold text-slate-300">
                SIN NÚMERO ({huecos.length}) · se rellenan
              </div>
              {huecos.map((c) => <Fila key={c.vehiculoId} c={c} />)}
            </div>
          )}

          {conflictos.length > 0 && (
            <div className="mt-3 overflow-hidden rounded-xl border border-amber-700">
              <div className="flex items-center gap-2 bg-amber-500/10 px-3 py-2 text-xs font-bold text-amber-300">
                <TriangleAlert className="h-3.5 w-3.5" />
                YA TIENEN OTRO NÚMERO ({conflictos.length}) · se les pisa
              </div>
              {conflictos.map((c) => <Fila key={c.vehiculoId} c={c} />)}
            </div>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              onClick={() => setMarcados(new Set(huecos.map((c) => c.vehiculoId)))}
              className="rounded-lg border border-slate-600 px-3 py-1.5 text-xs font-bold text-slate-300 hover:bg-slate-700"
            >
              Marcar los {huecos.length} huecos
            </button>
            <button
              onClick={() => setMarcados(new Set())}
              className="rounded-lg border border-slate-600 px-3 py-1.5 text-xs font-bold text-slate-300 hover:bg-slate-700"
            >
              Desmarcar todo
            </button>
            <button
              onClick={() => void aplicar()}
              disabled={ocupado || marcados.size === 0}
              className="rounded-lg border border-emerald-700 px-3 py-1.5 text-xs font-bold text-emerald-300 hover:bg-emerald-500/10 disabled:opacity-40"
            >
              Aplicar a {marcados.size}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
