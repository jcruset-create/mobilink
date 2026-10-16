import { useEffect, useMemo, useState } from "react";
import { Link2, Loader2 } from "lucide-react";
import { API_BASE } from "../modules/workshopApi";
import { getAdminHeaders } from "../modules/adminHeaders";
import { esTecnicoDePrueba } from "../modules/tecnicosDePrueba";
import {
  cambiosPendientes,
  eleccionInicial,
  empleadosRepetidos,
  etiquetaDeCerteza,
  type PropuestaVinculo,
} from "../modules/vinculoCore";

/**
 * Vincula cada técnico con su empleado de Core.
 *
 * El servidor propone por nombre y aquí se confirma o se corrige. Solo se
 * guarda el id del empleado: el técnico sigue llamándose igual, el histórico
 * sigue yendo por nombre y la tablet entra como siempre.
 */

type Props = {
  onCerrar: () => void;
  /** Para refrescar la lista de técnicos al terminar. */
  onGuardado?: () => void;
};

export default function VinculoCoreModal({ onCerrar, onGuardado }: Props) {
  const [propuestas, setPropuestas] = useState<PropuestaVinculo[]>([]);
  const [empleados, setEmpleados] = useState<{ id: string; nombre: string }[]>([]);
  const [eleccion, setEleccion] = useState<Record<string, string>>({});
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");
  const [aviso, setAviso] = useState("");

  async function cargar() {
    setCargando(true);
    setError("");
    try {
      const res = await fetch(`${API_BASE}/api/techs/vinculo-core`, {
        headers: getAdminHeaders(),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error((body as any)?.error || `Error ${res.status}`);
      setPropuestas(
        ((body as any)?.propuestas ?? []).filter(
          (p: PropuestaVinculo) => !esTecnicoDePrueba(p.tech)
        )
      );
      setEmpleados((body as any)?.empleados ?? []);
      setEleccion({});
    } catch (e: any) {
      setError(e?.message || "No se pudieron cargar los empleados de Core.");
    } finally {
      setCargando(false);
    }
  }

  useEffect(() => {
    void cargar();
  }, []);

  const cambios = useMemo(() => cambiosPendientes(propuestas, eleccion), [propuestas, eleccion]);
  const repetidos = useMemo(() => empleadosRepetidos(propuestas, eleccion), [propuestas, eleccion]);
  const vinculados = propuestas.filter((p) => p.vinculadoA).length;

  async function guardar() {
    setGuardando(true);
    setError("");
    setAviso("");
    const fallos: string[] = [];
    // Primero las desvinculaciones: liberan empleados que otra fila puede
    // estar cogiendo, y si no el servidor diría que ya está ocupado.
    const orden = [...cambios].sort((a, b) => Number(!!a.employeeId) - Number(!!b.employeeId));
    for (const c of orden) {
      try {
        const res = await fetch(
          `${API_BASE}/api/techs/${encodeURIComponent(c.tech)}/vinculo-core`,
          {
            method: "PUT",
            headers: getAdminHeaders({ "Content-Type": "application/json" }),
            body: JSON.stringify({ employeeId: c.employeeId }),
          }
        );
        if (!res.ok) {
          const body = await res.json().catch(() => null);
          fallos.push(`${c.tech}: ${(body as any)?.error || `error ${res.status}`}`);
        }
      } catch {
        fallos.push(`${c.tech}: sin conexión`);
      }
    }
    setGuardando(false);
    if (fallos.length) setError(fallos.join(" · "));
    else setAviso(`Guardado: ${cambios.length} cambio(s).`);
    onGuardado?.();
    await cargar();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="flex max-h-full w-full max-w-3xl flex-col rounded-3xl bg-slate-800 p-6 text-slate-100 shadow-2xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="flex items-center gap-2 text-xl font-black">
              <Link2 className="h-5 w-5" /> Vincular con empleados de Core
            </h3>
            <p className="mt-1 text-sm text-slate-400">
              Cada técnico con su ficha de Core. No cambia su nombre, ni su PIN, ni su
              histórico: solo se apunta quién es. Las propuestas se confirman al guardar.
            </p>
          </div>
          {!cargando && (
            <span className="shrink-0 rounded-full bg-slate-700 px-3 py-1 text-xs font-bold text-slate-300">
              {vinculados}/{propuestas.length} vinculados
            </span>
          )}
        </div>

        {error && (
          <div className="mt-3 rounded-xl border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">
            {error}
          </div>
        )}
        {aviso && (
          <div className="mt-3 rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-300">
            {aviso}
          </div>
        )}

        <div className="mt-4 min-h-0 flex-1 overflow-auto">
          {cargando ? (
            <div className="flex items-center gap-2 py-8 text-sm text-slate-400">
              <Loader2 className="h-4 w-4 animate-spin" /> Cargando empleados de Core…
            </div>
          ) : (
            <div className="space-y-2">
              {propuestas.map((p) => {
                const valor = eleccion[p.tech] ?? eleccionInicial(p);
                const etiqueta = etiquetaDeCerteza(p);
                const repetido = valor && repetidos.has(valor);
                return (
                  <div
                    key={p.tech}
                    className={`flex flex-wrap items-center gap-2 rounded-2xl border p-3 ${
                      repetido ? "border-rose-500/50 bg-rose-500/10" : "border-slate-700"
                    }`}
                  >
                    <div className="min-w-[120px] font-bold">{p.tech}</div>
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${etiqueta.clase}`}>
                      {etiqueta.texto}
                    </span>
                    <select
                      value={valor}
                      onChange={(e) => setEleccion((prev) => ({ ...prev, [p.tech]: e.target.value }))}
                      className="ml-auto min-w-[220px] rounded-xl border border-slate-600 bg-slate-800 px-3 py-2 text-sm"
                    >
                      <option value="">— Sin vincular —</option>
                      {p.candidatos.length > 0 && (
                        <optgroup label="Posibles">
                          {p.candidatos.map((c) => (
                            <option key={`c-${c.id}`} value={c.id}>{c.nombre}</option>
                          ))}
                        </optgroup>
                      )}
                      <optgroup label="Todos los empleados">
                        {empleados.map((e) => (
                          <option key={e.id} value={e.id}>{e.nombre}</option>
                        ))}
                      </optgroup>
                    </select>
                    {repetido && (
                      <div className="w-full text-xs font-semibold text-rose-300">
                        Ese empleado está elegido para otro técnico.
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="mt-5 flex items-center justify-end gap-2">
          <span className="mr-auto text-xs text-slate-400">
            {cambios.length > 0 ? `${cambios.length} cambio(s) por guardar` : "Sin cambios"}
          </span>
          <button
            type="button"
            onClick={onCerrar}
            className="rounded-xl border border-slate-600 px-4 py-2 text-sm font-semibold"
          >
            Cerrar
          </button>
          <button
            type="button"
            disabled={guardando || cargando || cambios.length === 0 || repetidos.size > 0}
            onClick={() => void guardar()}
            className="rounded-xl bg-sky-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
          >
            {guardando ? "Guardando…" : "Guardar"}
          </button>
        </div>
      </div>
    </div>
  );
}
