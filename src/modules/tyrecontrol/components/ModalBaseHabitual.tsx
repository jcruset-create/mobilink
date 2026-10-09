import { useEffect, useState } from "react";
import { asignarBaseHabitual, calcularBaseHabitual, type BaseHabitual } from "../services/data";
import type { Empresa } from "../types";
import { Modal, TableWrap, tdCls, thCls, inputCls } from "./ui";

/**
 * Poner la base en la ficha de los vehículos a partir de dónde han estado.
 *
 * Primero se enseña lo que se haría —base propuesta, horas, porcentaje y la
 * segunda opción al lado— y solo después se pulsa «Asignar». Las decisiones
 * dudosas (reparte las noches entre dos bases, o lleva muy pocas horas
 * medidas) se enseñan pero no se asignan: eso lo decide una persona, no una
 * cuenta de horas.
 *
 * Por defecto solo se rellenan las fichas que están vacías. Lo que alguien
 * puso a mano manda; pisarlo es una casilla aparte.
 */
export default function ModalBaseHabitual({ empresas, empresaInicial, onClose, onAsignado }: {
  empresas: Empresa[];
  empresaInicial?: string;
  onClose: () => void;
  onAsignado: (msg: string) => void;
}) {
  const [empresaId, setEmpresaId] = useState(empresaInicial || empresas[0]?.id || "");
  const [dias, setDias] = useState(30);
  const [sobrescribir, setSobrescribir] = useState(false);
  const [filas, setFilas] = useState<BaseHabitual[]>([]);
  const [cargando, setCargando] = useState(false);
  const [asignando, setAsignando] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!empresaId) return;
    let vivo = true;
    setCargando(true); setError("");
    calcularBaseHabitual(empresaId, dias)
      .then((f) => { if (vivo) setFilas(f); })
      .catch((e: any) => { if (vivo) setError(e?.message || "No se ha podido calcular"); })
      .finally(() => { if (vivo) setCargando(false); });
    return () => { vivo = false; };
  }, [empresaId, dias]);

  // Lo que cambiaría de verdad con la casilla tal como está.
  const cambiaria = (f: BaseHabitual) =>
    f.decision === "clara" && f.base_propuesta_id !== f.base_actual_id && (!f.base_actual_id || sobrescribir);
  const nCambios = filas.filter(cambiaria).length;
  const nDudosas = filas.filter((f) => f.decision === "dudosa").length;
  const nSinDatos = filas.filter((f) => f.decision === "sin_datos").length;
  const nRespetadas = filas.filter((f) => f.decision === "clara" && f.base_actual_id && f.base_propuesta_id !== f.base_actual_id && !sobrescribir).length;

  async function asignar() {
    if (!window.confirm(`Se va a poner la base a ${nCambios} vehículo(s). ¿Seguir?`)) return;
    setAsignando(true); setError("");
    try {
      const r = await asignarBaseHabitual(empresaId, dias, sobrescribir, false);
      onAsignado(`✔ Base asignada a ${r.asignadas} vehículo(s)` + (r.dudosas ? ` · ${r.dudosas} dudosos sin tocar` : ""));
      onClose();
    } catch (e: any) { setError(e?.message || "No se ha podido asignar"); }
    finally { setAsignando(false); }
  }

  const pct = (c: number | null) => c == null ? "—" : `${Math.round(c * 100)} %`;
  const h = (n: number | null) => n == null ? "—" : `${Math.round(n)} h`;
  const colorDecision = { clara: "text-emerald-300", dudosa: "text-amber-300", sin_datos: "text-slate-500" } as const;
  const textoDecision = { clara: "Clara", dudosa: "Dudosa", sin_datos: "Sin datos" } as const;

  return (
    <Modal title="Base habitual por histórico de estancias" size="xl" onClose={onClose}
      footer={
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-xs text-slate-400">
            {cargando ? "Calculando…" : <>
              <span className="font-bold text-emerald-300">{nCambios}</span> a asignar
              {nRespetadas > 0 && <> · <span className="text-slate-300">{nRespetadas}</span> ya tienen otra base (no se tocan)</>}
              {nDudosas > 0 && <> · <span className="text-amber-300">{nDudosas}</span> dudosos</>}
              {nSinDatos > 0 && <> · {nSinDatos} sin datos</>}
            </>}
          </div>
          <div className="flex gap-2">
            <button onClick={onClose} className="rounded-lg border border-slate-600 px-3 py-2 text-sm text-slate-200 hover:bg-slate-700">Cerrar</button>
            <button onClick={asignar} disabled={asignando || cargando || nCambios === 0}
              className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-500 disabled:opacity-50">
              {asignando ? "Asignando…" : `Asignar a ${nCambios}`}
            </button>
          </div>
        </div>
      }>
      <p className="mb-3 text-xs text-slate-400">
        Se suma el tiempo que cada vehículo ha pasado en cada base según el barrido de presencia. Gana la base con más horas;
        se considera <span className="text-emerald-300">clara</span> cuando se lleva al menos el 60 % del tiempo en base y suma 24 h o más.
        Las <span className="text-amber-300">dudosas</span> se enseñan con la segunda opción al lado, pero no se asignan solas.
      </p>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <select className={`${inputCls} max-w-[260px]`} value={empresaId} onChange={(e) => setEmpresaId(e.target.value)}>
          {empresas.map((e) => <option key={e.id} value={e.id}>{e.nombre}</option>)}
        </select>
        <label className="flex items-center gap-1 text-xs text-slate-300">Últimos
          <select className={`${inputCls} w-auto`} value={dias} onChange={(e) => setDias(Number(e.target.value))}>
            {[7, 14, 30, 60, 90].map((d) => <option key={d} value={d}>{d} días</option>)}
          </select>
        </label>
        <label className="flex items-center gap-1 text-xs text-slate-300" title="Por defecto solo se rellenan las fichas sin base: lo que se puso a mano se respeta.">
          <input type="checkbox" checked={sobrescribir} onChange={(e) => setSobrescribir(e.target.checked)} />
          Cambiar también las que ya tienen base
        </label>
      </div>
      {error && <div className="mb-2 text-sm text-red-300">{error}</div>}
      <TableWrap>
        <table className="w-full text-sm">
          <thead><tr>
            <th className={thCls}>Matrícula</th><th className={thCls}>Base actual</th><th className={thCls}>Base propuesta</th>
            <th className={thCls}>Horas</th><th className={thCls}>%</th><th className={thCls}>Noches</th>
            <th className={thCls}>2ª opción</th><th className={thCls}>Decisión</th><th className={thCls}></th>
          </tr></thead>
          <tbody>
            {!cargando && filas.length === 0 && <tr><td colSpan={9} className={`${tdCls} text-slate-500`}>Sin vehículos activos.</td></tr>}
            {filas.map((f) => (
              <tr key={f.vehiculo_id} className={`border-t border-slate-700/60 ${cambiaria(f) ? "" : "text-slate-400"}`}>
                <td className={`${tdCls} font-mono`}>{f.matricula}</td>
                <td className={tdCls}>{f.base_actual ?? "—"}</td>
                <td className={`${tdCls} font-bold`}>{f.base_propuesta ?? "—"}</td>
                <td className={`${tdCls} tabular-nums`}>{h(f.horas)}</td>
                <td className={`${tdCls} tabular-nums`}>{pct(f.cuota)}</td>
                <td className={`${tdCls} tabular-nums`}>{f.estancias ?? "—"}</td>
                <td className={tdCls}>{f.segunda ? `${f.segunda} (${h(f.horas_segunda)})` : "—"}</td>
                <td className={`${tdCls} ${colorDecision[f.decision]}`}>{textoDecision[f.decision]}</td>
                <td className={`${tdCls} text-xs`}>
                  {cambiaria(f) ? <span className="text-emerald-300">→ se asigna</span>
                    : f.decision === "clara" && f.base_propuesta_id === f.base_actual_id ? "ya la tiene"
                    : f.decision === "clara" ? "tiene otra a mano"
                    : ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableWrap>
    </Modal>
  );
}
