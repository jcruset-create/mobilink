import { useEffect, useState } from "react";
import {
  obtenerIdentificacionEmpresa, guardarIdentificacionEmpresa,
  listarIdentificacionMedida, guardarIdentificacionMedida, eliminarIdentificacionMedida,
  coberturaIdentificacion, pendientesIdentificar, listarMedidas,
} from "../services/data";
import type { IdentificacionMedida, MedidaNeumatico, ModoIdentificacion, PendienteIdentificar } from "../types";
import { MODO_IDENTIFICACION_LABELS } from "../types";
import { inputCls, TableWrap, tdCls, thCls } from "./ui";
import { useTyreAuth } from "../contexts/TyreAuthContext";

// Política de identificación de una empresa. Decide si un neumático se controla
// uno a uno (número de serie / RFID) o como unidad genérica de un producto.
//
// La resuelve el SERVIDOR en cada montaje (tc_identificacion_resuelve), no la
// app: así un cliente cambia de modo sin que nadie actualice la APK. Las
// pantallas que hoy mandan la casilla a mano siguen mandando, hasta que se
// migren a dejar decidir a la política.

// El listado de pendientes es informativo: con una flota grande puede tener
// cientos de filas y no aporta nada volcarlas todas en la ficha de la empresa.
const LIMITE_PENDIENTES = 25;

const MODOS: { valor: ModoIdentificacion; ayuda: string }[] = [
  { valor: "generico", ayuda: "Nada se identifica. Es como ha funcionado siempre." },
  { valor: "identificado", ayuda: "Toda goma lleva número de serie o RFID y se sigue una a una." },
  { valor: "mixto", ayuda: "Solo se identifican las medidas que añadas abajo." },
];

export default function IdentificacionEmpresa({ empresaId }: { empresaId: string }) {
  const { perfil } = useTyreAuth();
  const puedeEditar = !!(perfil?.es_superadmin || perfil?.rol === "administrador");

  const [modo, setModo] = useState<ModoIdentificacion>("generico");
  const [exigir, setExigir] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [msg, setMsg] = useState("");

  const [excepciones, setExcepciones] = useState<IdentificacionMedida[]>([]);
  const [medidas, setMedidas] = useState<MedidaNeumatico[]>([]);
  const [nuevaMedida, setNuevaMedida] = useState("");

  const [cobertura, setCobertura] = useState<{ total: number; conIdentidad: number } | null>(null);
  const [pendientes, setPendientes] = useState<PendienteIdentificar[]>([]);

  async function cargar() {
    const [c, exc, meds, cob, pend] = await Promise.all([
      obtenerIdentificacionEmpresa(empresaId).catch(() => null),
      listarIdentificacionMedida(empresaId).catch(() => [] as IdentificacionMedida[]),
      listarMedidas().catch(() => [] as MedidaNeumatico[]),
      coberturaIdentificacion(empresaId).catch(() => null),
      pendientesIdentificar(empresaId).catch(() => [] as PendienteIdentificar[]),
    ]);
    if (c) { setModo(c.modo); setExigir(c.exigir_identidad); }
    setExcepciones(exc);
    setMedidas(meds);
    setCobertura(cob);
    setPendientes(pend);
  }
  useEffect(() => { void cargar(); /* eslint-disable-next-line */ }, [empresaId]);

  async function guardar() {
    setGuardando(true); setMsg("");
    try {
      await guardarIdentificacionEmpresa(empresaId, { modo, exigir_identidad: exigir });
      // El modo decide qué se reclama, así que la lista de pendientes cambia.
      setPendientes(await pendientesIdentificar(empresaId).catch(() => []));
      setMsg("✔ Política guardada");
    } catch (e: any) { setMsg(e?.message || "Error al guardar"); } finally { setGuardando(false); }
  }

  async function anadirExcepcion() {
    if (!nuevaMedida) return;
    setMsg("");
    try {
      await guardarIdentificacionMedida(empresaId, nuevaMedida, true);
      setNuevaMedida("");
      setExcepciones(await listarIdentificacionMedida(empresaId));
    } catch (e: any) { setMsg(e?.message || "Error al guardar la medida"); }
  }

  async function alternar(m: IdentificacionMedida) {
    await guardarIdentificacionMedida(empresaId, m.medida, !m.identificable);
    setExcepciones(await listarIdentificacionMedida(empresaId));
  }

  async function borrar(medida: string) {
    if (!window.confirm(`¿Quitar la excepción de la medida ${medida}?`)) return;
    await eliminarIdentificacionMedida(empresaId, medida);
    setExcepciones(await listarIdentificacionMedida(empresaId));
  }

  const pct = cobertura && cobertura.total > 0
    ? Math.round((cobertura.conIdentidad / cobertura.total) * 100) : 0;

  return (
    <div className="rounded-lg bg-slate-800 p-3">
      <div className="mb-1 text-[11px] font-bold uppercase text-slate-400">Identificación de neumáticos</div>
      <div className="mb-3 text-[11px] text-slate-500">
        Decide si las gomas de esta empresa se siguen una a una (número de serie o RFID) o como
        unidades genéricas de un producto. Lo resuelve el servidor en cada montaje, así que cambiar
        de modo no obliga a actualizar la APK.
      </div>

      {/* Modo */}
      <div className="grid gap-2 sm:grid-cols-3">
        {MODOS.map((m) => (
          <label key={m.valor}
            className={`cursor-pointer rounded p-2 ${modo === m.valor ? "bg-slate-900 ring-1 ring-sky-500" : "bg-slate-900/50"} ${puedeEditar ? "" : "opacity-60"}`}>
            <div className="flex items-center gap-2">
              <input type="radio" name={`modo-${empresaId}`} checked={modo === m.valor} disabled={!puedeEditar}
                onChange={() => setModo(m.valor)} />
              <span className="text-[12px] font-semibold text-slate-200">{MODO_IDENTIFICACION_LABELS[m.valor]}</span>
            </div>
            <div className="mt-1 text-[11px] text-slate-500">{m.ayuda}</div>
          </label>
        ))}
      </div>

      {modo !== "generico" && (
        <label className="mt-2 flex items-center gap-2 text-[12px] text-slate-200">
          <input type="checkbox" checked={exigir} disabled={!puedeEditar} onChange={(e) => setExigir(e.target.checked)} />
          Exigir identidad para poder montar
          <span className="text-[11px] text-slate-500">
            (sin marcar, la goma que no se pueda leer se monta como genérica y queda pendiente de identificar)
          </span>
        </label>
      )}

      {puedeEditar && (
        <div className="mt-2 flex items-center gap-3">
          <button onClick={guardar} disabled={guardando}
            className="rounded bg-emerald-600 px-3 py-1.5 text-[12px] font-bold text-white disabled:opacity-50">
            {guardando ? "Guardando…" : "Guardar política"}
          </button>
          {msg && <span className={`text-[12px] ${msg.startsWith("✔") ? "text-emerald-400" : "text-rose-300"}`}>{msg}</span>}
        </div>
      )}

      {/* Excepciones por medida: solo tienen sentido en mixto */}
      {modo === "mixto" && (
        <>
          <div className="mt-4 mb-2 text-[11px] font-bold uppercase text-slate-400">Medidas que se identifican</div>
          <div className="mb-2 text-[11px] text-slate-500">
            Ej.: identificar las de camión (315/70R22.5) y dejar genéricas las de furgoneta. La medida se compara
            por su base, así que da igual si lleva los índices de carga y velocidad detrás.
          </div>

          {puedeEditar && (
            <div className="mb-2 flex flex-wrap items-end gap-2">
              <div className="min-w-[180px]">
                <div className="mb-1 text-[11px] text-slate-400">Medida</div>
                <select className={inputCls} value={nuevaMedida} onChange={(e) => setNuevaMedida(e.target.value)}>
                  <option value="">Selecciona…</option>
                  {medidas.map((m) => <option key={m.id} value={m.valor}>{m.valor}</option>)}
                </select>
              </div>
              <button onClick={anadirExcepcion} className="rounded bg-sky-600 px-3 py-1.5 text-[12px] font-bold text-white">
                Añadir
              </button>
            </div>
          )}

          <TableWrap>
            <thead className="bg-slate-900"><tr>
              <th className={thCls}>Medida</th><th className={thCls}>Se identifica</th><th className={thCls}></th>
            </tr></thead>
            <tbody>
              {excepciones.length === 0
                ? <tr><td className={tdCls + " text-slate-500"} colSpan={3}>Sin medidas marcadas: en mixto, eso significa que nada se identifica todavía.</td></tr>
                : excepciones.map((m) => (
                  <tr key={m.medida} className="border-t border-slate-700/60">
                    <td className={tdCls + " font-semibold text-slate-200"}>{m.medida}</td>
                    <td className={tdCls}>
                      {puedeEditar
                        ? <button onClick={() => alternar(m)} className={m.identificable ? "text-emerald-400 hover:underline" : "text-slate-500 hover:underline"}>
                            {m.identificable ? "Sí" : "No"}
                          </button>
                        : <span className={m.identificable ? "text-emerald-400" : "text-slate-500"}>{m.identificable ? "Sí" : "No"}</span>}
                    </td>
                    <td className={tdCls}>{puedeEditar && <button onClick={() => borrar(m.medida)} className="text-rose-400 hover:underline">Eliminar</button>}</td>
                  </tr>
                ))}
            </tbody>
          </TableWrap>
        </>
      )}

      {/* Cobertura real: control_individual sin RFID ni serie no sirve de nada */}
      {cobertura && cobertura.total > 0 && (
        <div className="mt-3 rounded bg-slate-900 p-2 text-[11px] text-slate-400">
          <b className="text-slate-200">{cobertura.conIdentidad}</b> de {cobertura.total} neumáticos activos
          llevan número de serie o RFID ({pct}%).
          {pct < 100 && " El resto se irá identificando al montarlos."}
        </div>
      )}

      {/* Pendientes: solo lo que la política reclama de verdad. En genérico
          esta lista está vacía por definición. */}
      {pendientes.length > 0 && (
        <div className="mt-3">
          <div className="mb-1 text-[11px] font-bold uppercase text-slate-400">
            Pendientes de identificar ({pendientes.length})
          </div>
          <div className="mb-2 text-[11px] text-slate-500">
            Su medida debería llevar identidad y no la tienen. El técnico puede ponérsela desde la APK,
            en la ficha de la rueda, sin desmontarla.
          </div>
          <TableWrap>
            <thead className="bg-slate-900"><tr>
              <th className={thCls}>Neumático</th><th className={thCls}>Medida</th>
              <th className={thCls}>Dónde está</th><th className={thCls}>mm</th>
            </tr></thead>
            <tbody>
              {pendientes.slice(0, LIMITE_PENDIENTES).map((p) => (
                <tr key={p.neumatico_id} className="border-t border-slate-700/60">
                  <td className={tdCls + " font-semibold text-slate-200"}>{p.numero_interno ?? "—"}</td>
                  <td className={tdCls + " text-slate-400"}>{p.medida ?? "—"}</td>
                  <td className={tdCls + " text-slate-400"}>
                    {p.matricula ? `${p.matricula} · ${p.codigo_posicion ?? "?"}` : "En almacén"}
                  </td>
                  <td className={tdCls + " text-slate-400"}>{p.profundidad_actual_mm ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
          {pendientes.length > LIMITE_PENDIENTES && (
            <div className="mt-1 text-[11px] text-slate-500">
              Se muestran las {LIMITE_PENDIENTES} primeras de {pendientes.length}.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
