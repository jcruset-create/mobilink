import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Check, Ruler, X } from "lucide-react";

import {
  propuestasTacografo, resolverPropuestaTacografo, aceptarBloqueTacografo, listarEmpresas,
  type CasoMedidaTacografo, type PropuestaTacografo, type PropuestasTacografo,
  type ResultadoBloqueTacografo,
} from "../services/data";
import type { Empresa } from "../types";
import { TableWrap, tdCls, thCls } from "../components/ui";

/**
 * Propuestas de medida del tacógrafo.
 *
 * El calibrado anota la medida del neumático con la que se hizo: un dato
 * tomado por un tercero con el vehículo delante. Esta pantalla lo ofrece y
 * NO lo aplica sola.
 *
 * ── Aceptar escribe la medida habitual del vehículo, y nada más ─────────────
 *
 * `tc_vehiculos.medida_id`. No toca montajes, ni neumáticos, ni ejes, ni
 * posiciones, ni el kilometraje. La medida habitual es lo que se espera que
 * lleve el vehículo; lo que lleva montado ahora lo pone el taller.
 *
 * ── El «aceptar todo» solo coge las que faltan, nunca los desacuerdos ───────
 *
 * Y no es la pantalla quien lo decide: el servidor vuelve a filtrar al
 * recibir la petición, así que mandarle a mano el id de una discrepancia la
 * devuelve excluida con su motivo. Aquí solo se enseña cuántas entran, para
 * que nadie pulse un botón sin saber sobre cuántas filas actúa.
 *
 * ── Y la decisión de si se puede aceptar viene del servidor ─────────────────
 *
 * Si esta pantalla decidiera por su cuenta qué es aceptable, tendría que
 * reimplementar la búsqueda en el catálogo de medidas y la comparación con la
 * medida actual del vehículo. El día que cambiara una de las dos, enseñaría
 * un botón que el servidor rechaza.
 */

const ETIQUETA_CASO: Record<CasoMedidaTacografo, string> = {
  sin_medida: "Falta la medida",
  discrepa: "No coinciden",
  solo_marcado: "Solo el marcado",
  sin_vehiculo: "Sin vehículo",
};

const EXPLICA_CASO: Record<CasoMedidaTacografo, string> = {
  sin_medida: "El vehículo no tiene medida habitual y el tacógrafo dice cuál es.",
  discrepa: "El tacógrafo y TyreControl dicen medidas distintas. Hay que mirar cada una.",
  solo_marcado: "La misma medida escrita con y sin el marcado de carga (la C).",
  sin_vehiculo: "La matrícula no está enlazada a ningún vehículo. Enlázala primero.",
};

const TONO_CASO: Record<CasoMedidaTacografo, string> = {
  sin_medida: "border-sky-500/30 bg-sky-500/5",
  discrepa: "border-amber-500/30 bg-amber-500/5",
  solo_marcado: "border-slate-600 bg-slate-800/40",
  sin_vehiculo: "border-rose-500/30 bg-rose-500/5",
};

const ORDEN: CasoMedidaTacografo[] = ["sin_medida", "discrepa", "solo_marcado", "sin_vehiculo"];

const fecha = (iso?: string | null) => {
  if (!iso) return "—";
  const [a, m, d] = String(iso).slice(0, 10).split("-");
  return a && m && d ? `${d}/${m}/${a}` : String(iso);
};

export default function PropuestasMedida() {
  const navigate = useNavigate();
  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [empresaId, setEmpresaId] = useState("");
  const [casos, setCasos] = useState<CasoMedidaTacografo[]>([]);
  const [d, setD] = useState<PropuestasTacografo | null>(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState("");
  const [trabajando, setTrabajando] = useState<string | null>(null);
  const [aviso, setAviso] = useState("");
  const [bloque, setBloque] = useState<ResultadoBloqueTacografo | null>(null);

  useEffect(() => {
    listarEmpresas()
      .then((e) => { setEmpresas(e); if (e.length) setEmpresaId((a) => a || e[0].id); })
      .catch((e) => setError(e.message));
  }, []);

  const cargar = useCallback(async () => {
    if (!empresaId) return;
    setCargando(true); setError("");
    try {
      setD(await propuestasTacografo(empresaId, "pendiente"));
    } catch (e: any) {
      setError(e.message); setD(null);
    } finally { setCargando(false); }
  }, [empresaId]);

  useEffect(() => { void cargar(); }, [cargar]);

  const visibles = useMemo(
    () => (d?.propuestas ?? []).filter((p) => casos.length === 0 || casos.includes(p.caso)),
    [d, casos],
  );

  async function resolver(p: PropuestaTacografo, accion: "aceptar" | "rechazar") {
    setTrabajando(p.id); setAviso(""); setError("");
    try {
      const r = await resolverPropuestaTacografo(empresaId, p.id, accion);
      setAviso(accion === "aceptar"
        ? `${p.matriculaNorm}: medida puesta en «${r.escrito?.medida}»`
          + (r.escrito?.exacta === false ? " (sin el marcado, que es como lo escribe el catálogo)" : "")
        : `${p.matriculaNorm}: propuesta rechazada. No se ha escrito nada.`);
      await cargar();
    } catch (e: any) {
      setError(e.message);
    } finally { setTrabajando(null); }
  }

  async function aceptarTodo() {
    if (!d) return;
    setTrabajando("bloque"); setAviso(""); setError(""); setBloque(null);
    try {
      setBloque(await aceptarBloqueTacografo(empresaId));
      await cargar();
    } catch (e: any) {
      setError(e.message);
    } finally { setTrabajando(null); }
  }

  const alternar = (c: CasoMedidaTacografo) =>
    setCasos((a) => a.includes(c) ? a.filter((x) => x !== c) : [...a, c]);

  return (
    <div className="p-4 text-slate-200">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="flex items-center gap-2 text-lg font-bold">
          <Ruler className="h-5 w-5" /> Propuestas de medida del tacógrafo
        </h1>
        {empresas.length > 1 && (
          <select
            value={empresaId}
            onChange={(e) => { setEmpresaId(e.target.value); setBloque(null); setAviso(""); }}
            className="rounded-lg border border-slate-600 bg-slate-900 px-3 py-1.5 text-xs text-slate-200"
            aria-label="Empresa"
          >
            {empresas.map((e) => <option key={e.id} value={e.id}>{e.nombre}</option>)}
          </select>
        )}
        {d && d.aceptablesEnBloque > 0 && (
          <button
            onClick={aceptarTodo}
            disabled={trabajando !== null}
            className="ml-auto flex items-center gap-1 rounded-lg border border-emerald-600 px-3 py-1.5
                       text-xs font-bold text-emerald-300 hover:bg-emerald-500/10 disabled:opacity-40"
          >
            <Check className="h-3.5 w-3.5" />
            {trabajando === "bloque"
              ? "Aceptando…"
              : `Aceptar las ${d.aceptablesEnBloque} que solo faltan`}
          </button>
        )}
      </div>

      <p className="mb-3 max-w-3xl text-[12px] text-slate-400">
        Aceptar una propuesta escribe la <strong className="text-slate-300">medida habitual</strong> del
        vehículo y nada más: no toca montajes, neumáticos, ejes ni posiciones. Si la medida del
        tacógrafo no está en el catálogo, la propuesta no se puede aceptar y lo dice: hay que darla
        de alta en «Medidas de neumáticos», porque dar de alta medidas a partir de un fichero
        ajeno es como se llena un catálogo de duplicados.
      </p>

      {error && <div className="mb-3 rounded-lg bg-rose-500/10 p-3 text-sm text-rose-300">{error}</div>}
      {aviso && <div className="mb-3 rounded-lg bg-emerald-500/10 p-3 text-sm text-emerald-300">{aviso}</div>}

      {bloque && (
        <div className="mb-3 rounded-lg border border-slate-700 bg-slate-800/60 p-3 text-[12px]">
          <div className="mb-1 font-bold text-slate-200">
            Confirmación en bloque: {bloque.aceptadas.length} aceptada(s)
            {bloque.falladas.length > 0 && `, ${bloque.falladas.length} fallida(s)`}
          </div>
          {bloque.falladas.length > 0 && (
            <ul className="mb-1 list-inside list-disc text-rose-300">
              {bloque.falladas.map((f) => <li key={f.id}>{f.matricula}: {f.motivo}</li>)}
            </ul>
          )}
          {bloque.excluidas.length > 0 && (
            <details>
              <summary className="cursor-pointer text-slate-400">
                {bloque.excluidas.length} quedaron fuera a propósito
              </summary>
              <ul className="mt-1 list-inside list-disc text-slate-400">
                {bloque.excluidas.map((x) => <li key={x.id}>{x.matricula}: {x.motivo}</li>)}
              </ul>
            </details>
          )}
          <button onClick={() => setBloque(null)} className="mt-2 text-slate-500 underline">
            Cerrar
          </button>
        </div>
      )}

      {/* Los cuatro casos. Pulsar filtra; los números son los pendientes. */}
      {d && (
        <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {ORDEN.map((c) => (
            <button
              key={c}
              onClick={() => alternar(c)}
              title={EXPLICA_CASO[c]}
              className={`rounded-xl border p-3 text-left transition
                ${TONO_CASO[c]} ${casos.includes(c) ? "ring-2 ring-sky-500" : ""}`}
            >
              <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">
                {ETIQUETA_CASO[c]}
              </div>
              <div className="text-2xl font-black tabular-nums text-slate-100">
                {(d.porCaso[c] ?? 0).toLocaleString("es-ES")}
              </div>
            </button>
          ))}
        </div>
      )}

      {d && (
        <>
          <p className="mb-2 text-xs text-slate-400">
            {visibles.length === d.total
              ? `${d.total} pendiente(s)`
              : `${visibles.length} de ${d.total} pendiente(s)`}
            {cargando && " · actualizando…"}
          </p>

          <TableWrap>
            <thead><tr>
              <th className={thCls}>Matrícula</th>
              <th className={thCls}>Caso</th>
              <th className={thCls}>Dice el tacógrafo</th>
              <th className={thCls}>Tiene TyreControl</th>
              <th className={thCls}>Se escribiría</th>
              <th className={thCls}>De la del</th>
              <th className={thCls}></th>
            </tr></thead>
            <tbody>
              {visibles.map((p) => (
                <tr key={p.id} className={p.puedeAceptar ? "" : "opacity-70"}>
                  <td className={`${tdCls} font-bold`}>
                    {p.vehiculoId ? (
                      <button
                        onClick={() => navigate(`/tyrecontrol/vehiculos/${p.vehiculoId}`)}
                        className="underline decoration-slate-600 hover:text-sky-300"
                      >
                        {p.matriculaNorm}
                      </button>
                    ) : p.matriculaNorm}
                  </td>
                  <td className={`${tdCls} text-[11px]`} title={EXPLICA_CASO[p.caso]}>
                    {ETIQUETA_CASO[p.caso]}
                    {p.entraEnBloque && (
                      <span className="ml-1 text-[10px] text-emerald-400" title="Entra en el «aceptar todo»">
                        ✓
                      </span>
                    )}
                  </td>
                  <td className={`${tdCls} font-semibold`}>
                    {p.medidaNorm}
                    {p.medidaOrigen && p.medidaOrigen !== p.medidaNorm && (
                      <div className="text-[10px] text-slate-500">en el informe: «{p.medidaOrigen}»</div>
                    )}
                  </td>
                  <td className={tdCls}>
                    {p.medidaActual ?? <span className="text-slate-500">sin medida</span>}
                  </td>
                  <td className={tdCls}>
                    {p.seEscribira ? (
                      <>
                        <span className="font-semibold text-sky-300">{p.seEscribira.valor}</span>
                        {!p.seEscribira.exacta && (
                          <div className="text-[10px] text-amber-300">
                            sin la {p.seEscribira.marcadoIgnorado}, que es como lo escribe el catálogo
                          </div>
                        )}
                      </>
                    ) : (
                      <span className="text-[11px] text-rose-300">{p.explicacion}</span>
                    )}
                  </td>
                  <td className={`${tdCls} text-[11px] text-slate-400`}>{fecha(p.fecha)}</td>
                  <td className={tdCls}>
                    <div className="flex gap-1">
                      <button
                        onClick={() => resolver(p, "aceptar")}
                        disabled={!p.puedeAceptar || trabajando !== null}
                        title={p.explicacion ?? undefined}
                        className="flex items-center gap-1 rounded border border-emerald-600 px-2 py-1
                                   text-[11px] font-bold text-emerald-300 hover:bg-emerald-500/10
                                   disabled:opacity-30"
                      >
                        <Check className="h-3 w-3" /> Aceptar
                      </button>
                      <button
                        onClick={() => resolver(p, "rechazar")}
                        disabled={trabajando !== null}
                        className="flex items-center gap-1 rounded border border-slate-600 px-2 py-1
                                   text-[11px] text-slate-300 hover:bg-slate-700 disabled:opacity-30"
                      >
                        <X className="h-3 w-3" /> No
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </TableWrap>

          {visibles.length === 0 && (
            <p className="mt-3 rounded-lg border border-slate-700 bg-slate-800/40 p-4 text-sm text-slate-400">
              {d.total === 0
                ? "No hay ninguna propuesta pendiente. Las propuestas salen de importar el informe "
                  + "del centro técnico, en «Importar»."
                : "Ninguna propuesta cumple ese filtro."}
            </p>
          )}

          <p className="mt-3 text-[11px] text-slate-500">
            Una propuesta rechazada no vuelve a aparecer aunque se reimporte el mismo informe: la
            medida sería la misma, así que no habría nada nuevo que mirar.
          </p>
        </>
      )}
    </div>
  );
}
