/**
 * Gestión de ingresos bancarios.
 *
 * Cada cierre de jornada aparta un importe "para el banco", pero al banco no
 * se va cada día: se acumulan cierres y luego un solo ingreso los agrupa. El
 * banco solo admite billetes, así que antes de ir se convierten las monedas
 * que se pueda y lo que no, se queda en tienda como remanente, que arrastra
 * al ingreso siguiente.
 *
 * La pantalla gira alrededor de una sola frase, que es como piensa quien la
 * usa: "Tenemos X, vamos a ingresar Y, quedan en tienda Z". El importe que se
 * ingresa lo decide el usuario —el sistema no puede saber cuántas monedas se
 * consiguieron convertir de verdad—, y el remanente se calcula solo y nunca
 * puede ser negativo.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { PiggyBank, Undo2 } from "lucide-react";
import { useCash } from "../contexts/CashContext";
import {
  Aviso,
  BotonInforme,
  BotonAccion,
  Cabecera,
  Card,
  EmptyRow,
  ErrorBox,
  TableWrap,
  thCls,
  tdCls,
  inputCls,
} from "../components/ui";
import { euros, aCentimos } from "../utils/money";
import type {
  CierrePendiente,
  LineaDenominacion,
  IngresoBancario,
  PanelIngresos,
  PropuestaCanjeIngreso,
} from "../types";
import * as api from "../services/api";

const fechaCorta = (iso: string) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString("es-ES", { day: "2-digit", month: "2-digit", year: "2-digit" });

/** 1 día es normal; 2–3 avisa; más de 3 pide atención. */
function BadgeDias({ dias }: { dias: number }) {
  const clase =
    dias > 3
      ? "bg-red-500/20 text-red-300"
      : dias >= 2
        ? "bg-amber-500/20 text-amber-300"
        : "bg-slate-700 text-slate-400";
  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold tabular-nums ${clase}`}>
      {dias} {dias === 1 ? "día" : "días"}
    </span>
  );
}

export default function IngresosBancarios() {
  const { cajaId, puede } = useCash();

  const [panel, setPanel] = useState<PanelIngresos | null>(null);
  const [seleccion, setSeleccion] = useState<Set<number>>(new Set());
  const [error, setError] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [ultimoCreado, setUltimoCreado] = useState<IngresoBancario | null>(null);

  const gestiona = puede("cash.treasury.manage");

  const cargar = useCallback(async () => {
    if (!cajaId) return;
    try {
      const r = await api.panelIngresos(cajaId);
      setPanel(r);
      // La selección solo conserva cierres que sigan pendientes.
      setSeleccion((prev) => {
        const validos = new Set(r.pendientes.map((c) => c.sessionId));
        return new Set([...prev].filter((id) => validos.has(id)));
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error cargando los ingresos");
    }
  }, [cajaId]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  async function accion(fn: () => Promise<unknown>) {
    setOcupado(true);
    setError("");
    try {
      await fn();
      await cargar();
    } catch (e) {
      setError(e instanceof Error ? e.message : "La acción ha fallado");
    } finally {
      setOcupado(false);
    }
  }

  if (!cajaId) {
    return <Aviso tono="aviso">No hay ninguna caja seleccionada.</Aviso>;
  }
  if (!panel) {
    return <p className="text-sm text-slate-500">Cargando…</p>;
  }

  const seleccionados = panel.pendientes.filter((c) => seleccion.has(c.sessionId));
  const masAntiguo = panel.pendientes[0] ?? null;

  return (
    <div className="space-y-3">
      <Cabecera
        titulo="Ingresos bancarios"
        descripcion="Los cierres se acumulan hasta que se llevan al banco. El banco solo admite billetes: las monedas que no se convierten quedan en tienda como remanente."
      />

      {error && <ErrorBox>{error}</ErrorBox>}

      {ultimoCreado && (
        <Aviso tono="bien">
          <div className="flex flex-wrap items-center gap-2">
            <span>
              Ingreso <strong>{ultimoCreado.numero}</strong> registrado:{" "}
              <strong>{euros(ultimoCreado.importeCentimos)}</strong> al banco y{" "}
              <strong>{euros(ultimoCreado.remanenteNuevoCentimos)}</strong> de remanente en tienda.
            </span>
            {/* El resguardo se imprime AHORA, que es cuando se mete el dinero
                en la bolsa y se le da a quien lo lleva. */}
            <BotonInforme
              ruta={`/bank-deposits/${ultimoCreado.id}/report.pdf`}
              nombre={`ingreso-${ultimoCreado.numero}`}
              className="flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-[12px] font-bold text-white hover:bg-emerald-500"
            >
              Resguardo para el banco
            </BotonInforme>
          </div>
        </Aviso>
      )}

      {/* ── Resumen ── */}
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <Card
          title="Pendiente de ingresar"
          value={euros(panel.totalPendienteCentimos)}
          hint={`${panel.pendientes.length} ${panel.pendientes.length === 1 ? "cierre" : "cierres"} sin conciliar`}
          accent="text-sky-300"
        />
        <Card
          title="Remanente en tienda"
          value={euros(panel.remanenteCentimos)}
          hint="monedas del último ingreso"
          accent="text-amber-300"
        />
        <Card
          title="Bajo control"
          value={euros(panel.totalPendienteCentimos + panel.remanenteCentimos)}
          hint="cierres + remanente"
          accent="text-emerald-400"
        />
        <Card
          title="Más antiguo"
          value={masAntiguo ? fechaCorta(masAntiguo.fecha) : "—"}
          hint={masAntiguo ? `${masAntiguo.dias} ${masAntiguo.dias === 1 ? "día" : "días"} pendiente` : "nada pendiente"}
          accent={masAntiguo && masAntiguo.dias > 3 ? "text-red-300" : undefined}
        />
      </div>

      {/* ── Cierres pendientes ── */}
      <section className="space-y-2">
        <h2 className="text-[11px] font-bold uppercase tracking-wide text-slate-400">
          Cierres pendientes de ingresar
        </h2>
        <TableWrap>
          <thead>
            <tr>
              {gestiona && <th className={thCls}></th>}
              <th className={thCls}>Fecha</th>
              <th className={thCls}>Cerró</th>
              <th className={`${thCls} text-right`}>Importe</th>
              <th className={thCls}>Pendiente</th>
            </tr>
          </thead>
          <tbody>
            {panel.pendientes.length === 0 && (
              <EmptyRow cols={gestiona ? 5 : 4} text="No hay ningún cierre pendiente: todo está en el banco." />
            )}
            {panel.pendientes.map((c) => (
              <FilaPendiente
                key={c.sessionId}
                cierre={c}
                seleccionable={gestiona}
                marcado={seleccion.has(c.sessionId)}
                onMarcar={(v) =>
                  setSeleccion((prev) => {
                    const s = new Set(prev);
                    if (v) s.add(c.sessionId);
                    else s.delete(c.sessionId);
                    return s;
                  })
                }
              />
            ))}
          </tbody>
        </TableWrap>
        {gestiona && panel.pendientes.length > 1 && (
          <button
            onClick={() => setSeleccion(new Set(panel.pendientes.map((c) => c.sessionId)))}
            className="text-[12px] text-sky-400 hover:underline"
          >
            Seleccionar todos
          </button>
        )}
      </section>

      {/* ── Preparar ingreso ── */}
      {gestiona && seleccionados.length > 0 && (
        <PrepararIngreso
          registerId={cajaId}
          seleccionados={seleccionados}
          remanenteAnterior={panel.remanenteCentimos}
          ocupado={ocupado}
          onCrear={(datos) =>
            accion(async () => {
              const r = await api.crearIngresoBancario(datos);
              setUltimoCreado(r.ingreso);
              setSeleccion(new Set());
            })
          }
        />
      )}

      {/* ── Historial ── */}
      <Historial ingresos={panel.ingresos} gestiona={gestiona} ocupado={ocupado} onAccion={accion} />
    </div>
  );
}

function FilaPendiente({
  cierre,
  seleccionable,
  marcado,
  onMarcar,
}: {
  cierre: CierrePendiente;
  seleccionable: boolean;
  marcado: boolean;
  onMarcar: (v: boolean) => void;
}) {
  return (
    <tr className={marcado ? "bg-sky-500/5" : ""}>
      {seleccionable && (
        <td className={tdCls}>
          <input
            type="checkbox"
            checked={marcado}
            onChange={(e) => onMarcar(e.target.checked)}
            aria-label={`Incluir el cierre del ${fechaCorta(cierre.fecha)}`}
            className="h-4 w-4 accent-sky-500"
          />
        </td>
      )}
      <td className={`${tdCls} font-medium text-slate-100`}>{fechaCorta(cierre.fecha)}</td>
      <td className={`${tdCls} text-slate-400`}>{cierre.cerradaPorNombre ?? "—"}</td>
      <td className={`${tdCls} text-right font-bold tabular-nums`}>{euros(cierre.importeCentimos)}</td>
      <td className={tdCls}>
        <BadgeDias dias={cierre.dias} />
      </td>
    </tr>
  );
}

// ── Preparar el ingreso ────────────────────────────────────────────────────

function PrepararIngreso({
  registerId,
  seleccionados,
  remanenteAnterior,
  ocupado,
  onCrear,
}: {
  registerId: number;
  seleccionados: CierrePendiente[];
  remanenteAnterior: number;
  ocupado: boolean;
  onCrear: (datos: {
    registerId: number;
    sessionIds: number[];
    importeCentimos: number;
    fechaIngreso?: string;
    referencia?: string;
    observaciones?: string;
  }) => Promise<void>;
}) {
  const { refrescar } = useCash();
  const totalCierres = seleccionados.reduce((a, c) => a + c.importeCentimos, 0);
  const disponible = remanenteAnterior + totalCierres;

  /*
   * Lo que se puede ingresar sale del DESGLOSE del montón, no de redondear el
   * total: son los billetes que hay de verdad en la bolsa.
   *
   * Antes esto era `Math.floor(disponible / 500) * 500`, y daba por hecho que
   * los euros redondos estaban en billetes. Con 105,69 € proponía ingresar
   * 105,00 € cuando en billetes solo había 95 € —los otros 10 estaban en
   * monedas de 2 y de 1— así que en la ventanilla del banco faltaban 10 €.
   *
   * El redondeo se queda solo como red mientras la propuesta carga.
   */
  const [propuesta, setPropuesta] = useState<PropuestaCanjeIngreso | null>(null);
  const sugerido = propuesta
    ? Math.min(disponible, propuesta.ingresableCentimos)
    : Math.floor(disponible / 500) * 500;
  const [importeTexto, setImporteTexto] = useState(() => (sugerido / 100).toFixed(2).replace(".", ","));
  const [fecha, setFecha] = useState("");
  const [referencia, setReferencia] = useState("");
  const [observaciones, setObservaciones] = useState("");

  // Si cambia la selección, la sugerencia se recalcula.
  useEffect(() => {
    setImporteTexto((sugerido / 100).toFixed(2).replace(".", ","));
  }, [sugerido]);

  const sessionIds = seleccionados.map((c) => c.sessionId);
  const claveSeleccion = sessionIds.join(",");

  /*
   * El desglose y el canje se piden al servidor cada vez que cambia la
   * selección de cierres: son el montón de esos cierres y solo de esos.
   */
  const recargarPropuesta = useCallback(async () => {
    try {
      setPropuesta(await api.proponerCanjeIngreso(registerId, claveSeleccion.split(",").filter(Boolean).map(Number)));
    } catch {
      // Si falla, la pantalla sigue siendo usable con el importe a mano.
      setPropuesta(null);
    }
    /*
     * Y la jornada compartida: el canje acaba de mover el cajón de verdad
     * (sale el billete, entran las monedas), así que el stock que pintan las
     * demás pantallas y la cabecera tiene que enterarse ya, no en la próxima
     * navegación.
     */
    await refrescar();
  }, [registerId, claveSeleccion, refrescar]);

  useEffect(() => {
    void recargarPropuesta();
  }, [recargarPropuesta]);

  const importe = aCentimos(importeTexto) ?? 0;
  const remanenteNuevo = disponible - importe;
  const valido = importe > 0 && remanenteNuevo >= 0;

  const resumen = useMemo(
    () => [
      { texto: "Remanente anterior", valor: remanenteAnterior },
      { texto: `Cierres seleccionados (${seleccionados.length})`, valor: totalCierres },
      { texto: "Efectivo bajo control", valor: disponible, destacado: true },
    ],
    [remanenteAnterior, seleccionados.length, totalCierres, disponible]
  );

  return (
    <div className="rounded-lg border border-sky-500/40 bg-sky-500/5 p-4">
      <div className="mb-2 text-[11px] font-bold uppercase tracking-wide text-slate-400">
        Preparar ingreso bancario
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div>
          <div className="space-y-1">
            {resumen.map((f) => (
              <div key={f.texto} className="flex items-baseline justify-between gap-2 text-sm">
                <span className={f.destacado ? "font-bold text-slate-200" : "text-slate-400"}>{f.texto}</span>
                <span className={`tabular-nums ${f.destacado ? "text-lg font-black text-slate-100" : "font-bold text-slate-200"}`}>
                  {euros(f.valor)}
                </span>
              </div>
            ))}
          </div>

          {propuesta && <DesgloseYCanje
            propuesta={propuesta}
            registerId={registerId}
            sessionIds={sessionIds}
            onCanjeado={recargarPropuesta}
          />}

          <label className="mt-3 block">
            <span className="mb-1 block text-[10px] font-semibold uppercase text-slate-400">
              Se ingresa en billetes
            </span>
            <input
              value={importeTexto}
              onChange={(e) => setImporteTexto(e.target.value)}
              inputMode="decimal"
              className={`${inputCls} text-2xl font-black tabular-nums`}
            />
          </label>

          <div className="mt-2 flex items-baseline justify-between gap-2 border-t border-slate-700 pt-2">
            <span className="text-[11px] font-bold uppercase tracking-wide text-slate-400">
              Quedan en tienda (monedas)
            </span>
            <span
              className={`text-2xl font-black tabular-nums ${remanenteNuevo < 0 ? "text-red-300" : "text-amber-300"}`}
            >
              {euros(remanenteNuevo)}
            </span>
          </div>
          {remanenteNuevo < 0 && (
            <p className="mt-1 text-[12px] text-red-300">
              No se puede ingresar más de lo que hay: el máximo son {euros(disponible)}.
            </p>
          )}
        </div>

        <div className="space-y-2">
          <label className="block">
            <span className="mb-1 block text-[10px] font-semibold uppercase text-slate-400">
              Fecha real del ingreso
            </span>
            <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} className={inputCls} />
          </label>
          <label className="block">
            <span className="mb-1 block text-[10px] font-semibold uppercase text-slate-400">
              Referencia bancaria
            </span>
            <input value={referencia} onChange={(e) => setReferencia(e.target.value)} placeholder="Opcional" className={inputCls} />
          </label>
          <label className="block">
            <span className="mb-1 block text-[10px] font-semibold uppercase text-slate-400">
              Observaciones
            </span>
            <input value={observaciones} onChange={(e) => setObservaciones(e.target.value)} placeholder="Opcional" className={inputCls} />
          </label>
        </div>
      </div>

      <div className="mt-3">
        <BotonAccion
          tono="cierre"
          icono={<PiggyBank className="h-5 w-5" />}
          onClick={() =>
            void onCrear({
              registerId,
              sessionIds: seleccionados.map((c) => c.sessionId),
              importeCentimos: importe,
              fechaIngreso: fecha || undefined,
              referencia: referencia || undefined,
              observaciones: observaciones || undefined,
            })
          }
          disabled={ocupado || !valido}
        >
          {ocupado
            ? "Registrando…"
            : `Confirmar: ${euros(importe)} al banco, ${euros(Math.max(0, remanenteNuevo))} quedan en tienda`}
        </BotonAccion>
        <p className="mt-2 max-w-xl text-[11px] text-slate-500">
          Tenemos {euros(disponible)}, ingresamos {euros(importe)} y quedan {euros(Math.max(0, remanenteNuevo))} en
          monedas. Los {seleccionados.length === 1 ? "cierre seleccionado deja" : "cierres seleccionados dejan"} de
          estar pendientes y el próximo ingreso arrancará del nuevo remanente.
        </p>
      </div>
    </div>
  );
}

// ── Historial ──────────────────────────────────────────────────────────────

function Historial({
  ingresos,
  gestiona,
  ocupado,
  onAccion,
}: {
  ingresos: IngresoBancario[];
  gestiona: boolean;
  ocupado: boolean;
  onAccion: (fn: () => Promise<unknown>) => Promise<void>;
}) {
  const [abierto, setAbierto] = useState<number | null>(null);
  const [motivo, setMotivo] = useState("");

  return (
    <section className="space-y-2">
      <h2 className="text-[11px] font-bold uppercase tracking-wide text-slate-400">
        Historial de ingresos
      </h2>
      <TableWrap>
        <thead>
          <tr>
            <th className={thCls}>Número</th>
            <th className={thCls}>Fecha ingreso</th>
            <th className={`${thCls} text-right`}>Cierres</th>
            <th className={`${thCls} text-right`}>Ingresado</th>
            <th className={`${thCls} text-right`}>Remanente</th>
            <th className={thCls}>Estado</th>
            <th className={thCls}></th>
          </tr>
        </thead>
        <tbody>
          {ingresos.length === 0 && <EmptyRow cols={7} text="Todavía no se ha registrado ningún ingreso." />}
          {ingresos.map((i) => (
            <>
              <tr
                key={i.id}
                onClick={() => setAbierto(abierto === i.id ? null : i.id)}
                className={`cursor-pointer hover:bg-slate-700/30 ${i.estado === "ANULADO" ? "opacity-50" : ""}`}
              >
                <td className={`${tdCls} font-mono text-[11px] text-slate-300`}>{i.numero}</td>
                <td className={tdCls}>{i.fechaIngreso ? fechaCorta(i.fechaIngreso) : "—"}</td>
                <td className={`${tdCls} text-right tabular-nums text-slate-400`}>
                  {i.cierres.length} · {euros(i.totalCierresCentimos)}
                </td>
                <td className={`${tdCls} text-right font-bold tabular-nums`}>{euros(i.importeCentimos)}</td>
                <td className={`${tdCls} text-right tabular-nums text-amber-300`}>
                  {euros(i.remanenteNuevoCentimos)}
                </td>
                <td className={tdCls}>
                  {i.estado === "ANULADO" ? (
                    <span className="rounded-full bg-slate-700 px-2 py-0.5 text-[10px] font-bold text-slate-400" title={i.anuladoMotivo ?? ""}>
                      Anulado
                    </span>
                  ) : (
                    <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] font-bold text-emerald-300">
                      Confirmado
                    </span>
                  )}
                </td>
                <td className={tdCls} onClick={(e) => e.stopPropagation()}>
                  <BotonInforme
                    ruta={`/bank-deposits/${i.id}/report.pdf`}
                    nombre={`ingreso-${i.numero}`}
                    className="flex items-center gap-1 rounded-lg bg-slate-700 px-2 py-1 text-[11px] font-medium text-slate-200 hover:bg-slate-600"
                  >
                    Resguardo
                  </BotonInforme>
                </td>
              </tr>
              {abierto === i.id && (
                <tr key={`${i.id}-detalle`}>
                  <td colSpan={7} className="bg-slate-900/40 px-4 py-3">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div>
                        <div className="mb-1 text-[10px] font-semibold uppercase text-slate-400">
                          Cierres incluidos
                        </div>
                        {i.cierres.map((c) => (
                          <div key={c.sessionId} className="flex justify-between gap-2 text-sm">
                            <span className="text-slate-300">{fechaCorta(c.fecha)}</span>
                            <span className="tabular-nums text-slate-200">{euros(c.importeCentimos)}</span>
                          </div>
                        ))}
                      </div>
                      <div className="text-sm">
                        {/* La ecuación completa, para que el ingreso se explique solo. */}
                        <div className="flex justify-between gap-2"><span className="text-slate-400">Remanente anterior</span><span className="tabular-nums">{euros(i.remanenteAnteriorCentimos)}</span></div>
                        <div className="flex justify-between gap-2"><span className="text-slate-400">+ Total cierres</span><span className="tabular-nums">{euros(i.totalCierresCentimos)}</span></div>
                        <div className="flex justify-between gap-2"><span className="text-slate-400">− Ingresado</span><span className="tabular-nums">{euros(i.importeCentimos)}</span></div>
                        <div className="mt-1 flex justify-between gap-2 border-t border-slate-700 pt-1 font-bold"><span>= Remanente nuevo</span><span className="tabular-nums text-amber-300">{euros(i.remanenteNuevoCentimos)}</span></div>
                        {i.referencia && (
                          <div className="mt-2 text-[12px] text-slate-400">Referencia: {i.referencia}</div>
                        )}
                        {i.observaciones && (
                          <div className="text-[12px] text-slate-400">{i.observaciones}</div>
                        )}
                        {i.anuladoMotivo && (
                          <div className="mt-2 text-[12px] text-red-300">Anulado: {i.anuladoMotivo}</div>
                        )}

                        {gestiona && i.estado === "CONFIRMADO" && i.esUltimo && (
                          <div className="mt-3 flex flex-wrap items-end gap-2">
                            <input
                              value={motivo}
                              onChange={(e) => setMotivo(e.target.value)}
                              placeholder="Motivo de la anulación"
                              className={inputCls}
                            />
                            <button
                              onClick={() =>
                                void onAccion(async () => {
                                  await api.anularIngresoBancario(i.id, motivo);
                                  setMotivo("");
                                  setAbierto(null);
                                })
                              }
                              disabled={ocupado || !motivo.trim()}
                              className="flex items-center gap-1 rounded-lg bg-amber-600 px-3 py-1.5 text-[12px] font-bold text-white hover:bg-amber-500 disabled:opacity-50"
                            >
                              <Undo2 className="h-3.5 w-3.5" /> Anular ingreso
                            </button>
                          </div>
                        )}
                        {gestiona && i.estado === "CONFIRMADO" && !i.esUltimo && (
                          <p className="mt-3 text-[11px] text-slate-500">
                            Solo se puede anular el último ingreso: los siguientes arrancaron de su remanente.
                          </p>
                        )}
                      </div>
                    </div>
                  </td>
                </tr>
              )}
            </>
          ))}
        </tbody>
      </TableWrap>
      <p className="text-[11px] text-slate-500">
        Cada ingreso guarda la cuenta completa: remanente anterior + cierres − ingresado = remanente nuevo. Anular no
        borra nada: devuelve los cierres a pendientes, restaura el remanente anterior y deja quién, cuándo y por qué.
      </p>
    </section>
  );
}

/**
 * Desglose del montón pendiente y, si cabe, el canje que lo mejora.
 *
 * Es la pieza que cambia la pantalla de «un número que hay que creerse» a «esto
 * es lo que hay en la bolsa»: se ven los billetes y las monedas por separado,
 * porque al banco solo van los billetes.
 */
function DesgloseYCanje({
  propuesta,
  registerId,
  sessionIds,
  onCanjeado,
}: {
  propuesta: PropuestaCanjeIngreso;
  registerId: number;
  sessionIds: number[];
  onCanjeado: () => Promise<void>;
}) {
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState("");
  const { canje } = propuesta;

  async function canjear() {
    if (!canje) return;
    setOcupado(true);
    setError("");
    try {
      await api.registrarCanjeIngreso({
        registerId,
        sessionIds,
        monedasEntregadas: canje.monedasEntregadas,
        billetesEntregados: canje.billetesEntregados,
        billetesRecibidos: canje.billetesRecibidos,
      });
      await onCanjeado();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se ha podido registrar el canje");
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div className="mt-3 space-y-2 rounded-lg border border-slate-700 bg-slate-900/40 p-3">
      <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">
        Qué hay en la bolsa
      </div>

      <TablaPiezas
        titulo="En billetes · van al banco"
        lineas={propuesta.pendiente.billetes}
        total={propuesta.ingresableCentimos}
        tono="text-sky-300"
      />
      <TablaPiezas
        titulo="En monedas · no las admite el banco"
        lineas={propuesta.pendiente.monedas}
        total={propuesta.enMonedasCentimos}
        tono="text-amber-300"
      />

      {error && <ErrorBox>{error}</ErrorBox>}

      {canje && (
        <div className="space-y-2 rounded-lg border border-emerald-600/40 bg-emerald-950/20 p-2">
          <p className="text-[12px] text-slate-200">
            Se pueden convertir <strong>{euros(canje.valorMonedasCentimos)}</strong> en monedas
            cambiándolos por billetes de la caja.
          </p>

          <TablaPiezas
            titulo="Entregas a la caja"
            lineas={[...canje.monedasEntregadas, ...canje.billetesEntregados].sort(
              (a, b) => b.valor - a.valor
            )}
            total={canje.valorCanjeCentimos}
            tono="text-slate-200"
          />
          <TablaPiezas
            titulo="Te llevas de la caja"
            lineas={canje.billetesRecibidos}
            total={canje.valorCanjeCentimos}
            tono="text-emerald-300"
          />
          <button
            onClick={() => void canjear()}
            disabled={ocupado}
            className="rounded-lg bg-emerald-600 px-3 py-1.5 text-[12px] font-bold text-white hover:bg-emerald-500 disabled:opacity-50"
          >
            {ocupado ? "Registrando…" : `Canjear y subir el ingreso a ${euros(propuesta.ingresableCentimos + canje.valorMonedasCentimos)}`}
          </button>
        </div>
      )}

      {!canje && propuesta.enMonedasCentimos > 0 && (
        <Aviso tono="aviso">
          {propuesta.sinJornadaAbierta
            ? "Con la caja cerrada no se puede canjear: el cambio sale del cajón. Abre la jornada y vuelve aquí."
            : "Ahora mismo la caja no tiene billetes con los que cambiar estas monedas. Se ingresan los billetes y las monedas esperan aquí: en cuanto la caja tenga el billete que hace falta, aparecerá la propuesta."}
        </Aviso>
      )}
    </div>
  );
}

/**
 * Piezas en tabla, con la foto de cada billete y cada moneda.
 *
 * Antes iban en una línea de texto —«50,00 € × 1, 20,00 € × 2, 5,00 € × 1»—
 * que hay que leer entera para saber qué hay. Puesto en filas, con la imagen
 * del catálogo delante, se compara de un vistazo con lo que uno tiene en la
 * mano, que es lo que se hace de verdad con la bolsa encima del mostrador.
 *
 * La foto solo sale si está subida en Configuración; sin ella queda la
 * etiqueta, que es la que manda.
 */
function TablaPiezas({
  titulo,
  lineas,
  total,
  tono,
}: {
  titulo: string;
  lineas: readonly LineaDenominacion[];
  total: number;
  tono: string;
}) {
  const { denominaciones } = useCash();
  if (lineas.length === 0) return null;

  const imagenDe = (valor: number) =>
    denominaciones.find((d) => d.valor === valor)?.imagenUrl ?? null;

  return (
    <div className="rounded-lg border border-slate-700/60 bg-slate-900/40">
      <div className="flex items-baseline justify-between gap-2 border-b border-slate-700/60 px-2 py-1">
        <span className="text-[10px] font-bold uppercase tracking-wide text-slate-400">
          {titulo}
        </span>
        <span className={`text-sm font-black tabular-nums ${tono}`}>{euros(total)}</span>
      </div>
      <table className="w-full text-left text-[12px]">
        <tbody>
          {lineas.map((l) => {
            const url = imagenDe(l.valor);
            return (
              <tr key={l.valor} className="border-t border-slate-800">
                <td className="w-12 px-2 py-1">
                  {url ? (
                    <img src={url} alt="" className="h-6 w-10 object-contain" />
                  ) : (
                    <span className="block h-6 w-10" />
                  )}
                </td>
                <td className="px-1 py-1 font-bold tabular-nums text-slate-200">
                  {euros(l.valor)}
                </td>
                <td className="px-1 py-1 text-right tabular-nums text-slate-300">×{l.cantidad}</td>
                <td className="px-2 py-1 text-right tabular-nums text-slate-400">
                  {euros(l.valor * l.cantidad)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
