/**
 * Gestión de ingresos bancarios.
 *
 * Cada cierre de jornada aparta un importe "para el banco", pero al banco no
 * se va cada día: se acumulan cierres y luego un solo ingreso los agrupa. El
 * banco solo admite billetes, así que antes de ir se convierten las monedas
 * que se pueda, y las que no, **siguen pendientes de ingresar**: entran en el
 * ingreso siguiente o en el próximo canje. Y cuánto se ingresa lo decide quien
 * va al banco: si prefiere dejar también billetes para otro día, se quedan
 * igual de pendientes.
 *
 * Antes esas monedas se llamaban «remanente en tienda» y salían en un total
 * aparte. Era el mismo dinero con otro nombre, y dos totales que había que
 * sumar de cabeza. Ahora son parte de lo pendiente, con su línea en la lista.
 * Por debajo la cuenta de cada ingreso no cambia: la tabla la sigue guardando
 * en `remanente_nuevo_centimos`.
 *
 * La pantalla gira alrededor de una sola frase, que es como piensa quien la
 * usa: "Tenemos X, vamos a ingresar Y en billetes, quedan pendientes Z en
 * monedas". El importe que se ingresa lo decide el usuario —el sistema no
 * puede saber cuántas monedas se consiguieron convertir de verdad—, y lo que
 * queda pendiente se calcula solo y nunca puede ser negativo.
 */

import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { Landmark, Mail, Paperclip, PiggyBank, Undo2, Upload } from "lucide-react";
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
  btnSecondary,
} from "../components/ui";
import { euros, aCentimos } from "../utils/money";
import { ETIQUETA_ESTADO_INGRESO, estadoIngreso } from "../types";
import type {
  CuentaBancariaConfig,
  DocumentoOperacion,
  CierrePendiente,
  LineaDenominacion,
  IngresoBancario,
  PanelIngresos,
  PropuestaCanjeIngreso,
  PropuestaReposicion,
  ReposicionPendiente,
  CanjePreparado,
} from "../types";
import * as api from "../services/api";
import ContarRemanente from "../components/ContarRemanente";
import { type Cantidades, cambioParaElCajon, cantidadesDe, lineasDe, valorDe } from "../utils/cambioConCajon";

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
  /** Todo lo que falta por llevar al banco: cierres, menos lo repuesto, más las monedas de antes. */
  const pendienteTotal = panel.totalPendienteCentimos + panel.remanenteCentimos;
  /** De qué ingreso vienen las monedas que siguen pendientes: el último confirmado. */
  const ingresoDeLasMonedas = panel.ingresos.find((i) => i.estado === "CONFIRMADO") ?? null;

  return (
    <div className="space-y-3">
      <Cabecera
        titulo="Ingresos bancarios"
        descripcion="Los cierres se acumulan hasta que se llevan al banco. El banco solo admite billetes: las monedas que no se cambian por billetes siguen pendientes de ingresar."
      />

      {error && <ErrorBox>{error}</ErrorBox>}

      {ultimoCreado && (
        <Aviso tono="bien">
          <div className="flex flex-wrap items-center gap-2">
            <span>
              Ingreso <strong>{ultimoCreado.numero}</strong> registrado:{" "}
              <strong>{euros(ultimoCreado.importeCentimos)}</strong> al banco
              {ultimoCreado.remanenteNuevoCentimos > 0 && (
                <>
                  {" "}y <strong>{euros(ultimoCreado.remanenteNuevoCentimos)}</strong> siguen pendientes de ingresar
                </>
              )}
              .
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
        {/*
          Un solo total: lo que falta por llevar al banco, monedas incluidas.
          Antes eran tres —pendiente, remanente y «bajo control»— y había que
          sumar de cabeza para saber lo que de verdad faltaba.
        */}
        <Card
          title="Pendiente de ingresar"
          value={euros(pendienteTotal)}
          hint={
            `${panel.pendientes.length} ${panel.pendientes.length === 1 ? "cierre" : "cierres"} sin conciliar` +
            (panel.remanenteCentimos > 0 ? ` + ${euros(panel.remanenteCentimos)} que no se ingresaron la última vez` : "") +
            (panel.reposiciones.length > 0 ? ", menos lo repuesto al cajón" : "")
          }
          accent="text-sky-300"
        />
        <Card
          title="Más antiguo"
          value={masAntiguo ? fechaCorta(masAntiguo.fecha) : "—"}
          hint={masAntiguo ? `${masAntiguo.dias} ${masAntiguo.dias === 1 ? "día" : "días"} pendiente` : "nada pendiente"}
          accent={masAntiguo && masAntiguo.dias > 3 ? "text-red-300" : undefined}
        />
      </div>

      {/*
        El fondo de la caja, antes que nada: si el cajón va corto, eso se
        arregla con este dinero y hay que verlo antes de decidir cuánto se
        lleva al banco.
      */}
      <ReponerFondo
        registerId={cajaId}
        sessionIds={panel.pendientes.map((c) => c.sessionId)}
        gestiona={gestiona}
        onRepuesto={cargar}
      />

      {/*
        Canjear va aquí y no dentro de «Preparar ingreso»: cambiar las monedas
        y llevar el dinero al banco son dos gestos distintos y en dos días
        distintos. Trabaja sobre TODOS los cierres pendientes, no sobre lo que
        esté marcado.
      */}
      <PendienteYCambio
        registerId={cajaId}
        sessionIds={panel.pendientes.map((c) => c.sessionId)}
        pendienteCentimos={pendienteTotal}
        gestiona={gestiona}
        onCambiado={cargar}
      />

      <CanjesPreparados canjes={panel.canjes} gestiona={gestiona} onDeshecho={cargar} />

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
            {panel.pendientes.length === 0 && panel.reposiciones.length === 0 && panel.remanenteCentimos === 0 && (
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
            {panel.remanenteCentimos > 0 && (
              <FilaMonedasPendientes
                importe={panel.remanenteCentimos}
                ingreso={ingresoDeLasMonedas}
                seleccionable={gestiona}
              />
            )}
            {panel.reposiciones.map((r) => (
              <FilaReposicion key={`rep-${r.id}`} reposicion={r} seleccionable={gestiona} />
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
          repuesto={panel.reposiciones.reduce((a, r) => a + r.importeCentimos, 0)}
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
      <Historial
        ingresos={panel.ingresos}
        gestiona={gestiona}
        puedeAdjuntar={puede("cash.document.attach")}
        ocupado={ocupado}
        onAccion={accion}
        onRecargar={() => void cargar()}
      />
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

/**
 * Lo que no fue al banco en el último ingreso —las monedas, y los billetes que
 * se decidiera dejar—: sigue pendiente.
 *
 * No se marca: entra SIEMPRE en el ingreso siguiente, junto a los cierres que
 * se elijan (y ahí se decide otra vez cuánto se lleva), o las monedas se
 * cambian antes por billetes con el canje. Aparece en la
 * lista para que la columna de importes sume lo que de verdad falta por
 * llevar al banco.
 */
function FilaMonedasPendientes({
  importe,
  ingreso,
  seleccionable,
}: {
  importe: number;
  ingreso: IngresoBancario | null;
  seleccionable: boolean;
}) {
  return (
    <tr className="bg-sky-500/5">
      {seleccionable && <td className={tdCls}></td>}
      <td className={`${tdCls} font-medium text-slate-100`}>
        {ingreso?.fechaIngreso ? fechaCorta(ingreso.fechaIngreso) : "—"}
      </td>
      <td className={`${tdCls} text-sky-200`}>
        Sin ingresar del {ingreso?.numero ?? "ingreso anterior"}
      </td>
      <td className={`${tdCls} text-right font-bold tabular-nums`}>{euros(importe)}</td>
      <td className={`${tdCls} text-[11px] text-slate-400`}>van en el próximo ingreso</td>
    </tr>
  );
}

/**
 * Una reposición de fondo, en la misma lista que los cierres y restando.
 *
 * No se puede marcar: no es un cierre que se elija llevar al banco, es dinero
 * que ya salió de la bolsa. Aparece aquí —y no en una nota aparte— para que la
 * columna de importes sume lo que de verdad se va a ingresar; si no, la lista
 * dice un total y el servidor acepta otro.
 */
function FilaReposicion({
  reposicion,
  seleccionable,
}: {
  reposicion: ReposicionPendiente;
  seleccionable: boolean;
}) {
  return (
    <tr className="bg-amber-500/5">
      {seleccionable && <td className={tdCls}></td>}
      <td className={`${tdCls} font-medium text-slate-100`}>{fechaCorta(reposicion.fecha)}</td>
      <td className={`${tdCls} text-amber-300`}>Reposición del fondo</td>
      <td className={`${tdCls} text-right font-bold tabular-nums text-amber-300`}>
        −{euros(reposicion.importeCentimos)}
      </td>
      <td className={`${tdCls} text-[11px] text-slate-400`}>devuelto al cajón</td>
    </tr>
  );
}

// ── Preparar el ingreso ────────────────────────────────────────────────────

function PrepararIngreso({
  registerId,
  seleccionados,
  remanenteAnterior,
  repuesto,
  ocupado,
  onCrear,
}: {
  registerId: number;
  seleccionados: CierrePendiente[];
  remanenteAnterior: number;
  /** Lo ya devuelto al cajón desde este montón: no se puede ingresar. */
  repuesto: number;
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
  /*
   * Lo repuesto se RESTA aquí igual que lo resta el servidor. Sin esto la
   * pantalla decía tener 73,13 € cuando en la bolsa quedaban 51,61 €, y el
   * «quedan en tienda» mentía por los 21,52 € que ya estaban en el cajón.
   */
  const disponible = remanenteAnterior + totalCierres - repuesto;

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
      ...(remanenteAnterior > 0
        ? [{ texto: "Sin ingresar la última vez", valor: remanenteAnterior }]
        : []),
      { texto: `Cierres seleccionados (${seleccionados.length})`, valor: totalCierres },
      ...(repuesto > 0
        ? [{ texto: "Repuesto al cajón", valor: -repuesto }]
        : []),
      { texto: "Pendiente de ingresar", valor: disponible, destacado: true },
    ],
    [remanenteAnterior, seleccionados.length, totalCierres, repuesto, disponible]
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

          {propuesta && (
            <DesgloseDeLaBolsa
              propuesta={propuesta}
              pendienteCentimos={disponible}
              contar={
                <ContarRemanente
                  registerId={registerId}
                  importeCentimos={propuesta.remanenteCentimos ?? 0}
                  onHecho={recargarPropuesta}
                />
              }
            />
          )}

          <label className="mt-3 block">
            <span className="mb-1 block text-[10px] font-semibold uppercase text-slate-400">
              Se ingresa en billetes
            </span>
            <span className="mb-1 block text-[11px] text-slate-500">
              Se propone todo lo que hay en billetes. Pon menos si quieres dejar más pendiente para otro día.
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
              Siguen pendientes de ingresar
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
            : remanenteNuevo > 0
              ? `Confirmar: ${euros(importe)} al banco, ${euros(remanenteNuevo)} siguen pendientes`
              : `Confirmar: ${euros(importe)} al banco`}
        </BotonAccion>
        <p className="mt-2 max-w-xl text-[11px] text-slate-500">
          Tenemos {euros(disponible)} pendientes, ingresamos {euros(importe)} en billetes
          {remanenteNuevo > 0 && <> y {euros(remanenteNuevo)} siguen pendientes de ingresar: van en el próximo ingreso, y las monedas se pueden cambiar antes por billetes con el canje</>}.
          {" "}Los {seleccionados.length === 1 ? "cierre seleccionado deja" : "cierres seleccionados dejan"} de estar pendientes.
        </p>
      </div>
    </div>
  );
}

// ── Historial ──────────────────────────────────────────────────────────────

function Historial({
  ingresos,
  gestiona,
  puedeAdjuntar,
  ocupado,
  onAccion,
  onRecargar,
}: {
  ingresos: IngresoBancario[];
  gestiona: boolean;
  puedeAdjuntar: boolean;
  ocupado: boolean;
  onAccion: (fn: () => Promise<unknown>) => Promise<void>;
  onRecargar: () => void;
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
            <th className={`${thCls} text-right`}>Quedó pendiente</th>
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
                {/*
                  Verde solo cuando el dinero ESTÁ en el banco. Registrar el
                  ingreso y hacerlo son dos momentos distintos, y pintar los dos
                  igual escondía el hueco entre ellos: el único sitio donde el
                  efectivo puede perderse sin que nadie lo note.
                */}
                <td className={tdCls}>
                  {(() => {
                    const estado = estadoIngreso(i);
                    const pinta = {
                      ANULADO: "bg-slate-700 text-slate-400",
                      PENDIENTE_CONFIRMAR: "bg-amber-500/20 text-amber-300",
                      CONFIRMADO: "bg-emerald-500/20 text-emerald-300",
                    }[estado];
                    return (
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${pinta}`}
                        title={
                          estado === "ANULADO"
                            ? (i.anuladoMotivo ?? "")
                            : estado === "PENDIENTE_CONFIRMAR"
                              ? "Registrado en la aplicación, pero todavía sin la fecha real del banco"
                              : `Ingresado en el banco el ${i.fechaIngreso}`
                        }
                      >
                        {ETIQUETA_ESTADO_INGRESO[estado]}
                      </span>
                    );
                  })()}
                </td>
                <td className={tdCls} onClick={(e) => e.stopPropagation()}>
                  {/*
                    Enviar solo cuando el ingreso está confirmado en el banco:
                    el correo dice «ya está ingresado», y mandarlo antes de
                    volver del banco sería afirmar algo que aún no ha pasado.
                  */}
                  {gestiona && estadoIngreso(i) === "CONFIRMADO" && (
                    <EnviarALaCentral ingreso={i} />
                  )}
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
                        <div className="flex justify-between gap-2"><span className="text-slate-400">Pendiente de antes</span><span className="tabular-nums">{euros(i.remanenteAnteriorCentimos)}</span></div>
                        <div className="flex justify-between gap-2"><span className="text-slate-400">+ Total cierres</span><span className="tabular-nums">{euros(i.totalCierresCentimos)}</span></div>
                        <div className="flex justify-between gap-2"><span className="text-slate-400">− Ingresado</span><span className="tabular-nums">{euros(i.importeCentimos)}</span></div>
                        <div className="mt-1 flex justify-between gap-2 border-t border-slate-700 pt-1 font-bold"><span>= Quedó pendiente</span><span className="tabular-nums text-amber-300">{euros(i.remanenteNuevoCentimos)}</span></div>
                        {i.banco && (
                          <div className="mt-2 text-[12px] text-slate-300">
                            {i.banco} · <span className="font-mono">···{(i.iban ?? "").slice(-4)}</span>
                          </div>
                        )}
                        {i.referencia && (
                          <div className="text-[12px] text-slate-400">Referencia: {i.referencia}</div>
                        )}
                        {i.observaciones && (
                          <div className="text-[12px] text-slate-400">{i.observaciones}</div>
                        )}
                        {i.anuladoMotivo && (
                          <div className="mt-2 text-[12px] text-red-300">Anulado: {i.anuladoMotivo}</div>
                        )}

                        {/*
                          Los datos que da el banco AL HACER el ingreso: la
                          fecha real y la referencia llegan con el resguardo,
                          después de registrarlo aquí. Y el comprobante
                          escaneado se cuelga del ingreso, no de una jornada:
                          el papel del banco cubre los cierres de varios días.
                        */}
                        <DatosDelBanco ingreso={i} editable={gestiona} onGuardado={onRecargar} />
                        <ComprobantesDelIngreso depositId={i.id} puedeAdjuntar={puedeAdjuntar} />

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
                            Solo se puede anular el último ingreso: los siguientes arrancaron de lo que éste dejó pendiente.
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
        Cada ingreso guarda la cuenta completa: pendiente de antes + cierres − ingresado = queda pendiente. Anular no
        borra nada: devuelve los cierres a pendientes, restaura lo que quedaba pendiente antes y deja quién, cuándo y por qué.
      </p>
    </section>
  );
}

/**
 * Reponer el fondo de la caja con el dinero que espera para ir al banco.
 *
 * Cuando una jornada cierra por debajo del fondo fijo, ese dinero no se ha
 * perdido: está en la bolsa del banco. Devolverlo al cajón es un traspaso
 * entre dos bolsillos de la tienda, y por eso se hace desde aquí y no de los
 * cobros del día siguiente —con los cobros, parte de la caja dejaría de ser
 * venta y no cuadraría el cierre que se pasa a la ERP—.
 *
 * A mano, como el canje: mover dinero entre bolsillos sin que nadie lo pulse
 * es de las cosas que después no sabe explicar nadie.
 */
/**
 * Lo pendiente de ingresar pieza a pieza, y el cambio con el cajón.
 *
 * Siempre a la vista, aunque no haya ningún cierre marcado: antes el desglose
 * solo salía al preparar un ingreso, y con cero cierres (solo lo que quedó la
 * última vez) no había forma de ver qué monedas eran ni de cambiarlas.
 *
 * El cambio va en los dos sentidos y con cualquier pieza: lo que sale de lo
 * pendiente entra en el cajón y al revés, y las dos partes tienen que sumar lo
 * mismo. Por debajo es el canje de siempre —una operación de la jornada
 * abierta, apuntada contra todos los cierres pendientes—, así que se deshace
 * igual, desde «Canjes preparados», mientras no se haya hecho el ingreso.
 */
function PendienteYCambio({
  registerId,
  sessionIds,
  pendienteCentimos,
  gestiona,
  onCambiado,
}: {
  registerId: number;
  sessionIds: number[];
  /** Lo pendiente según la cuenta: las piezas tienen que sumar esto. */
  pendienteCentimos: number;
  gestiona: boolean;
  onCambiado: () => Promise<void>;
}) {
  const { jornada, denominaciones, refrescar } = useCash();
  const [datos, setDatos] = useState<PropuestaCanjeIngreso | null>(null);
  const [modo, setModo] = useState<"monedas" | "cajon" | "mano">("monedas");
  const [dePendiente, setDePendiente] = useState<Cantidades>({});
  const [deCajon, setDeCajon] = useState<Cantidades>({});
  const [error, setError] = useState("");
  const [aviso, setAviso] = useState("");
  const [ocupado, setOcupado] = useState(false);

  const clave = sessionIds.join(",");
  const cargar = useCallback(async () => {
    try {
      setDatos(await api.proponerCanjeIngreso(registerId, clave.split(",").filter(Boolean).map(Number)));
    } catch {
      setDatos(null);
    }
  }, [registerId, clave]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const esBillete = useCallback(
    (valor: number) => denominaciones.find((d) => d.valor === valor)?.tipo === "BILLETE",
    [denominaciones]
  );
  const pendiente = useMemo(
    () => (datos ? [...datos.pendiente.billetes, ...datos.pendiente.monedas].sort((a, b) => b.valor - a.valor) : []),
    [datos]
  );
  const cajon = useMemo(
    () => (jornada?.stock ?? []).filter((l) => l.cantidad > 0).sort((a, b) => b.valor - a.valor),
    [jornada]
  );

  /*
   * Cada modo rellena las dos columnas con su propuesta; después se puede
   * retocar con − y +, que es lo mismo que pasarse a «A mano».
   */
  const aplicarModo = useCallback(
    (m: "monedas" | "cajon" | "mano") => {
      setModo(m);
      setAviso("");
      if (m === "mano") {
        setDePendiente({});
        setDeCajon({});
        return;
      }
      if (m === "monedas") {
        const c = datos?.canje;
        if (!c) {
          setDePendiente({});
          setDeCajon({});
          setAviso(
            "Ahora mismo no hay un billete del cajón que se pueda formar con las monedas de lo pendiente."
          );
          return;
        }
        setDePendiente(cantidadesDe([...c.monedasEntregadas, ...c.billetesEntregados]));
        setDeCajon(cantidadesDe(c.billetesRecibidos));
        return;
      }
      const r = cambioParaElCajon(pendiente, cajon, esBillete);
      if (!r) {
        setDePendiente({});
        setDeCajon({});
        setAviso("No hay ningún billete del cajón que se pueda pagar con piezas más pequeñas de lo pendiente.");
        return;
      }
      setDePendiente(r.dePendiente);
      setDeCajon(r.deCajon);
    },
    [datos, pendiente, cajon, esBillete]
  );

  // La propuesta de monedas se pone sola al llegar los datos.
  useEffect(() => {
    if (datos) aplicarModo("monedas");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [datos]);

  if (!datos) return null;

  const sinDesglose = datos.remanenteCentimos ?? 0;
  const faltan = datos.pendiente.faltan ?? [];
  const totalPiezas = datos.ingresableCentimos + datos.enMonedasCentimos + sinDesglose;
  const nada = pendiente.length === 0 && sinDesglose === 0;
  if (nada) return null;

  const entregaPendiente = valorDe(dePendiente);
  const entregaCajon = valorDe(deCajon);
  const cuadra = entregaPendiente > 0 && entregaPendiente === entregaCajon;

  const despues = (() => {
    const m = cantidadesDe(pendiente);
    for (const [v, n] of Object.entries(dePendiente)) m[Number(v)] = (m[Number(v)] ?? 0) - n;
    for (const [v, n] of Object.entries(deCajon)) m[Number(v)] = (m[Number(v)] ?? 0) + n;
    return lineasDe(m);
  })();
  const despuesBilletes = despues.filter((l) => esBillete(l.valor));
  const despuesMonedas = despues.filter((l) => !esBillete(l.valor));

  async function cambiar() {
    setOcupado(true);
    setError("");
    try {
      await api.registrarCanjeIngreso({
        registerId,
        sessionIds: clave.split(",").filter(Boolean).map(Number),
        monedasEntregadas: lineasDe(dePendiente),
        billetesEntregados: [],
        billetesRecibidos: lineasDe(deCajon),
      });
      await cargar();
      await onCambiado();
      // El cajón se acaba de mover de verdad: la cabecera y las demás
      // pantallas tienen que enterarse ya.
      await refrescar();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se ha podido hacer el cambio");
    } finally {
      setOcupado(false);
    }
  }

  return (
    <section className="space-y-2">
      <h2 className="text-[11px] font-bold uppercase tracking-wide text-slate-400">
        Qué hay pendiente de ingresar, pieza a pieza
      </h2>
      <div className="grid gap-2 lg:grid-cols-2">
        <TablaPiezas
          titulo="En billetes · van al banco"
          lineas={datos.pendiente.billetes}
          total={datos.ingresableCentimos}
          tono="text-sky-300"
          vacio="Ninguno"
        />
        <TablaPiezas
          titulo="En monedas · el banco no las admite"
          lineas={datos.pendiente.monedas}
          total={datos.enMonedasCentimos + sinDesglose}
          tono="text-amber-300"
          vacio="Ninguna"
          extra={
            sinDesglose > 0
              ? {
                  texto: "Sin desglose, del último ingreso",
                  valor: sinDesglose,
                  accion: <ContarRemanente registerId={registerId} importeCentimos={sinDesglose} onHecho={cargar} />,
                }
              : undefined
          }
        />
      </div>

      {totalPiezas !== pendienteCentimos && (
        <Aviso tono="aviso">
          Las piezas suman <strong>{euros(totalPiezas)}</strong> y lo pendiente de ingresar son{" "}
          <strong>{euros(pendienteCentimos)}</strong>
          {faltan.length > 0 && (
            <>
              : se sacaron{" "}
              {faltan.map((l, i) => (
                <span key={l.valor}>
                  {i > 0 && ", "}
                  {l.cantidad} × {euros(l.valor)}
                </span>
              ))}{" "}
              que, según los cierres, no estaban
            </>
          )}
          . Cuenta lo que hay y fíate de lo contado.
        </Aviso>
      )}

      {sinDesglose > 0 && (
        <p className="text-[12px] text-slate-400">
          Para cambiar lo que quedó del último ingreso hay que saber qué piezas son: cuéntalas una
          vez con «Contar».
        </p>
      )}

      {gestiona && pendiente.length > 0 && (
        <div className="space-y-2 rounded-xl border border-sky-700 bg-sky-950/30 p-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <div className="text-[14px] font-bold text-slate-100">Cambiar con el cajón</div>
              <p className="max-w-2xl text-[12px] text-slate-400">
                Lo que sale de lo pendiente entra en el cajón, y al revés. Las dos partes tienen que
                sumar lo mismo: lo pendiente no cambia de importe, solo de piezas. Se apunta en la
                jornada abierta y se puede deshacer mientras no se haga el ingreso.
              </p>
            </div>
            {jornada && (
              <span className="rounded-md bg-slate-700 px-2 py-0.5 text-[11px] text-slate-200">
                Caja abierta · {euros(jornada.totalStockCentimos)} en el cajón
              </span>
            )}
          </div>

          {!jornada ? (
            <Aviso tono="aviso">
              Con la caja cerrada no se puede cambiar: el cajón tiene que moverse de verdad. Abre la
              jornada y vuelve aquí.
            </Aviso>
          ) : (
            <>
              <div className="flex flex-wrap gap-1.5">
                {(
                  [
                    ["monedas", "Monedas → billete"],
                    ["cajon", "Cambio para el cajón"],
                    ["mano", "A mano"],
                  ] as const
                ).map(([m, texto]) => (
                  <button
                    key={m}
                    onClick={() => aplicarModo(m)}
                    className={`rounded-full border px-3 py-1 text-[12px] ${
                      modo === m
                        ? "border-sky-600 bg-sky-700 font-bold text-white"
                        : "border-slate-600 text-slate-300 hover:bg-slate-800"
                    }`}
                  >
                    {texto}
                  </button>
                ))}
              </div>
              <p className="text-[11px] text-slate-500">
                {modo === "monedas"
                  ? "Junta monedas de lo pendiente para llevarte billetes del cajón, que son los que admite el banco."
                  : modo === "cajon"
                    ? "Para cuando al cajón le falta cambio: da un billete grande y recibe piezas más pequeñas de lo pendiente."
                    : "Elige cualquier combinación con − y +."}
              </p>
              {aviso && <p className="text-[12px] text-amber-300">{aviso}</p>}

              <div className="grid gap-2 lg:grid-cols-2">
                <ColumnaCambio
                  titulo="Sale de lo pendiente → al cajón"
                  disponibles={pendiente}
                  elegidas={dePendiente}
                  onChange={(c) => {
                    setDePendiente(c);
                    setModo("mano");
                  }}
                  tono="text-amber-300"
                />
                <ColumnaCambio
                  titulo="Sale del cajón → a lo pendiente"
                  disponibles={cajon}
                  elegidas={deCajon}
                  onChange={(c) => {
                    setDeCajon(c);
                    setModo("mano");
                  }}
                  tono="text-sky-300"
                />
              </div>

              {error && <ErrorBox>{error}</ErrorBox>}

              <div
                className={`flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 text-[13px] ${
                  cuadra
                    ? "border-emerald-600 bg-emerald-950/60 text-emerald-200"
                    : "border-slate-600 bg-slate-900/60 text-slate-300"
                }`}
              >
                <span>
                  {cuadra
                    ? `✓ Cuadra: ${euros(entregaPendiente)} por ${euros(entregaCajon)}. Lo pendiente sigue siendo ${euros(pendienteCentimos)}.`
                    : entregaPendiente === 0 && entregaCajon === 0
                      ? "Elige qué sale de cada lado."
                      : `No cuadra: de lo pendiente salen ${euros(entregaPendiente)} y del cajón ${euros(entregaCajon)}.`}
                </span>
                <button
                  onClick={() => void cambiar()}
                  disabled={!cuadra || ocupado}
                  className="rounded-lg bg-sky-600 px-4 py-2 text-[13px] font-bold text-white hover:bg-sky-500 disabled:opacity-40"
                >
                  {ocupado ? "Cambiando…" : "Hacer el cambio"}
                </button>
              </div>
              {cuadra && (
                <p className="text-[12px] text-slate-400">
                  Después del cambio, lo pendiente queda en{" "}
                  <strong className="text-slate-200">
                    {despuesBilletes.length
                      ? despuesBilletes.map((l) => `${l.cantidad} × ${euros(l.valor)}`).join(", ")
                      : "ningún billete"}
                  </strong>{" "}
                  en billetes y{" "}
                  <strong className="text-slate-200">
                    {euros(despuesMonedas.reduce((a, l) => a + l.valor * l.cantidad, 0) + sinDesglose)}
                  </strong>{" "}
                  en monedas.
                </p>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}

/** Una columna del cambio: cada pieza con cuántas hay y los botones − y +. */
function ColumnaCambio({
  titulo,
  disponibles,
  elegidas,
  onChange,
  tono,
}: {
  titulo: string;
  disponibles: readonly LineaDenominacion[];
  elegidas: Cantidades;
  onChange: (c: Cantidades) => void;
  tono: string;
}) {
  const { denominaciones } = useCash();
  const imagenDe = (valor: number) => denominaciones.find((d) => d.valor === valor)?.imagenUrl ?? null;
  const poner = (valor: number, n: number) => onChange({ ...elegidas, [valor]: Math.max(0, n) });
  const total = valorDe(elegidas);

  return (
    <div className="rounded-lg border border-slate-700 bg-slate-900/60 p-2">
      <div className="px-1 pb-1 text-[12px] font-bold text-slate-200">{titulo}</div>
      {disponibles.length === 0 && <p className="px-1 text-[12px] text-slate-500">Nada.</p>}
      {disponibles.map((l) => {
        const n = elegidas[l.valor] ?? 0;
        const url = imagenDe(l.valor);
        return (
          <div
            key={l.valor}
            className={`flex items-center gap-2 rounded-md px-1 py-0.5 ${n > 0 ? "bg-sky-900/40" : ""}`}
          >
            {url ? (
              <img src={url} alt="" className="h-6 w-10 flex-none object-contain" />
            ) : (
              <span className="block h-6 w-10 flex-none" />
            )}
            <span className="min-w-[64px] text-[13px] font-bold tabular-nums text-slate-100">{euros(l.valor)}</span>
            <span className="text-[11px] text-slate-500">hay {l.cantidad}</span>
            <span className="ml-auto flex items-center gap-1.5">
              <button
                onClick={() => poner(l.valor, n - 1)}
                disabled={n === 0}
                className="h-7 w-7 rounded-md border border-slate-600 bg-slate-800 font-bold text-slate-100 disabled:opacity-30"
                aria-label={`Una pieza menos de ${euros(l.valor)}`}
              >
                −
              </button>
              <span className="w-6 text-center text-[13px] font-bold tabular-nums">{n}</span>
              <button
                onClick={() => poner(l.valor, n + 1)}
                disabled={n >= l.cantidad}
                className="h-7 w-7 rounded-md border border-slate-600 bg-slate-800 font-bold text-slate-100 disabled:opacity-30"
                aria-label={`Una pieza más de ${euros(l.valor)}`}
              >
                +
              </button>
            </span>
          </div>
        );
      })}
      <div className={`mt-1 border-t border-slate-700 px-1 pt-1 text-right text-[12px] ${tono}`}>
        Entrega <strong>{euros(total)}</strong>
      </div>
    </div>
  );
}

/**
 * Los canjes ya hechos que todavía esperan al ingreso.
 *
 * No llevan importe en la lista de cierres porque un canje NO cambia el valor
 * del montón, solo su composición: entra y sale lo mismo. Lo que hay que ver
 * es que ya está hecho —para no volver a cambiarlo— y contra qué cierres, que
 * es lo que decide qué ingreso se lo llevará.
 */
function CanjesPreparados({
  canjes,
  gestiona,
  onDeshecho,
}: {
  canjes: CanjePreparado[];
  gestiona: boolean;
  onDeshecho: () => Promise<void>;
}) {
  const { refrescar } = useCash();
  const [ocupado, setOcupado] = useState<number | null>(null);
  const [error, setError] = useState("");

  if (canjes.length === 0) return null;

  async function deshacer(id: number) {
    setOcupado(id);
    setError("");
    try {
      await api.deshacerCanjeIngreso(id);
      await onDeshecho();
      await refrescar();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se ha podido deshacer el canje");
    } finally {
      setOcupado(null);
    }
  }

  return (
    <div className="rounded-lg border border-slate-600 bg-slate-800/60 p-3">
      <div className="text-[11px] font-bold uppercase tracking-wide text-slate-400">
        Canje preparado, pendiente de ingresar
      </div>
      {error && <div className="mt-1 text-[12px] text-rose-300">{error}</div>}
      <ul className="mt-1 space-y-1">
        {canjes.map((c) => (
          <li key={c.id} className="flex flex-wrap items-center gap-2 text-[12px] text-slate-300">
            <span className="tabular-nums text-slate-400">{fechaCorta(c.fecha)}</span>
            <span>
              <strong className="text-emerald-300">{euros(c.valorCentimos)}</strong> en monedas
              cambiados por billetes
            </span>
            <span className="text-[11px] text-slate-500">
              {c.sessionIds.length === 1
                ? "de un cierre"
                : `de ${c.sessionIds.length} cierres`}
              , se ingresarán juntos
            </span>
            {gestiona && (
              <button
                onClick={() => void deshacer(c.id)}
                disabled={ocupado === c.id}
                className="ml-auto rounded-lg border border-slate-600 px-2 py-0.5 text-[11px] font-bold text-slate-300 hover:bg-slate-700 disabled:opacity-50"
              >
                {ocupado === c.id ? "Deshaciendo…" : "Deshacer"}
              </button>
            )}
          </li>
        ))}
      </ul>
      <p className="mt-1 text-[11px] text-slate-500">
        Deshacer no borra nada: asienta el canje al revés en la jornada de hoy, así que hace falta
        tenerla abierta.
      </p>
    </div>
  );
}

/** Un desglose de piezas en línea, con su rótulo. */
function Piezas({
  titulo,
  lineas,
  tono,
}: {
  titulo: string;
  lineas: LineaDenominacion[];
  tono: string;
}) {
  return (
    <div className="mt-1">
      <div className="text-[11px] uppercase tracking-wide text-slate-400">{titulo}</div>
      <ul className={`mt-0.5 flex flex-wrap gap-2 text-[11px] tabular-nums ${tono}`}>
        {lineas.map((l) => (
          <li key={l.valor} className="rounded bg-slate-800 px-2 py-0.5">
            {l.cantidad} × {euros(l.valor)}
          </li>
        ))}
      </ul>
    </div>
  );
}

function ReponerFondo({
  registerId,
  sessionIds,
  gestiona,
  onRepuesto,
}: {
  registerId: number;
  sessionIds: number[];
  gestiona: boolean;
  onRepuesto: () => Promise<void>;
}) {
  const [datos, setDatos] = useState<PropuestaReposicion | null>(null);
  const [error, setError] = useState("");
  const [ocupado, setOcupado] = useState(false);

  const clave = sessionIds.join(",");
  const cargar = useCallback(async () => {
    try {
      setDatos(await api.proponerReposicionFondo(registerId, clave.split(",").filter(Boolean).map(Number)));
    } catch {
      // Sin propuesta la pantalla sigue sirviendo para ingresar, que es lo
      // que la gente viene a hacer aquí.
      setDatos(null);
    }
  }, [registerId, clave]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  if (!datos || datos.deficitCentimos <= 0) return null;

  /*
   * A partir del tercer cierre seguido por debajo del fondo el aviso cambia de
   * tono. Un día corto se arregla solo en cuanto haya dinero pendiente; tres
   * seguidos quieren decir que nadie lo está mirando.
   */
  const insistente = datos.cierresConDeficit >= 3;

  async function reponer() {
    if (!datos?.reposicion) return;
    setOcupado(true);
    setError("");
    try {
      await api.reponerFondo({
        registerId,
        sessionIds: clave.split(",").filter(Boolean).map(Number),
        sacar: datos.reposicion.sacar,
        devolver: datos.reposicion.devolver,
      });
      await cargar();
      await onRepuesto();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se ha podido reponer el fondo");
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div
      className={`rounded-lg border p-3 ${
        insistente ? "border-rose-500/50 bg-rose-500/10" : "border-amber-500/40 bg-amber-500/10"
      }`}
    >
      <div className={`text-[13px] font-bold ${insistente ? "text-rose-200" : "text-amber-200"}`}>
        La caja va con {euros(datos.deficitCentimos)} menos de su fondo de{" "}
        {euros(datos.fondoObjetivoCentimos)}
        {insistente && ` — van ${datos.cierresConDeficit} cierres seguidos`}
      </div>

      {error && <div className="mt-1 text-[12px] text-rose-300">{error}</div>}

      {!datos.reposicion ? (
        <p className="mt-1 text-[12px] text-slate-300">
          {datos.montonCentimos === 0
            ? "No hay dinero pendiente de ingresar con el que reponerlo. Se podrá después del próximo cierre."
            : "El dinero pendiente no tiene piezas con las que llegar, ni dando vuelta desde el cajón. Se podrá después del próximo cierre."}
        </p>
      ) : (
        <>
          <p className="mt-1 text-[12px] text-slate-300">
            Se devuelven <strong>{euros(datos.reposicion.netoCentimos)}</strong> del dinero pendiente
            de ingresar al cajón. No es un cobro: el efectivo total de la tienda no cambia.
          </p>
          <Piezas
            titulo="Sale del dinero pendiente"
            lineas={datos.reposicion.sacar}
            tono="text-slate-300"
          />
          {/*
            La vuelta, cuando la bolsa no tiene las piezas justas: se saca de
            más y el cajón devuelve la diferencia, como en un canje. Se enseña
            aparte porque quien lo hace tiene que contar dos montones, no uno.
          */}
          {datos.reposicion.devolver.length > 0 && (
            <Piezas
              titulo="Vuelve del cajón a la bolsa"
              lineas={datos.reposicion.devolver}
              tono="text-amber-200"
            />
          )}
          {datos.reposicion.netoCentimos < datos.deficitCentimos && (
            <p className="mt-1 text-[11px] text-slate-400">
              Con esto se repone lo que se puede; quedarán{" "}
              {euros(datos.deficitCentimos - datos.reposicion.netoCentimos)} pendientes para el
              próximo cierre.
            </p>
          )}
          {datos.sinJornadaAbierta ? (
            <p className="mt-2 text-[12px] text-slate-400">
              Hace falta una jornada abierta: la reposición mete dinero en el cajón.
            </p>
          ) : (
            gestiona && (
              <button
                onClick={() => void reponer()}
                disabled={ocupado}
                className="mt-2 rounded-lg bg-amber-600 px-3 py-1.5 text-[12px] font-bold text-white hover:bg-amber-500 disabled:opacity-50"
              >
                Reponer {euros(datos.reposicion.netoCentimos)} en el cajón
              </button>
            )
          )}
        </>
      )}
    </div>
  );
}

/**
 * Desglose del montón pendiente: billetes y monedas por separado.
 *
 * Es la pieza que cambia la pantalla de «un número que hay que creerse» a «esto
 * es lo que hay en la bolsa»: se ven los billetes y las monedas por separado,
 * porque al banco solo van los billetes.
 */
function DesgloseDeLaBolsa({
  propuesta,
  pendienteCentimos,
  contar,
}: {
  propuesta: PropuestaCanjeIngreso;
  /** Lo pendiente de ingresar según la cuenta: la bolsa tiene que sumar esto. */
  pendienteCentimos: number;
  /** Botón para contar a mano lo que quedó sin desglose. */
  contar?: ReactNode;
}) {
  const { canje } = propuesta;
  /*
   * Lo que quedó sin ingresar la última vez también está en la bolsa. Si el
   * ingreso guardó sus piezas, ya vienen dentro de las monedas; si no (los
   * ingresos de antes de guardarlas), va en su propia fila, con un botón para
   * contarlas una vez.
   */
  const remanente = propuesta.remanenteCentimos ?? 0;
  const faltan = propuesta.pendiente.faltan ?? [];
  const valorFaltan = faltan.reduce((a, l) => a + l.valor * l.cantidad, 0);
  const totalBolsa = propuesta.ingresableCentimos + propuesta.enMonedasCentimos + remanente;

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
        total={propuesta.enMonedasCentimos + remanente}
        tono="text-amber-300"
        extra={
          remanente > 0
            ? { texto: "Sin ingresar de ingresos anteriores (sin desglose)", valor: remanente, accion: contar }
            : undefined
        }
      />

      {/*
        La bolsa tiene que sumar lo pendiente. Cuando no, casi siempre es que
        una reposición o un canje sacó una pieza que según los cierres no
        estaba, y el desglose enseña de más justo ese valor. Se dice con las
        piezas en vez de pintar una bolsa que no existe: lo contado manda.
      */}
      {totalBolsa !== pendienteCentimos && (
        <Aviso tono="aviso">
          El desglose suma <strong>{euros(totalBolsa)}</strong> y lo pendiente de ingresar son{" "}
          <strong>{euros(pendienteCentimos)}</strong>
          {valorFaltan > 0 && (
            <>
              : se sacaron de la bolsa{" "}
              {faltan.map((l, i) => (
                <span key={l.valor}>
                  {i > 0 && ", "}
                  {l.cantidad} × {euros(l.valor)}
                </span>
              ))}{" "}
              que, según los cierres, no estaban
            </>
          )}
          . Cuenta la bolsa y fíate de lo contado: en «Se ingresa en billetes» pon los billetes
          que tengas de verdad, y lo demás sigue pendiente de ingresar.
        </Aviso>
      )}

      {/*
        Aquí ya NO se canjea: el botón vive arriba, en su propio panel. Esto es
        el desglose de la bolsa, que es lo que hay que mirar para decidir
        cuánto se ingresa —al banco solo van los billetes— y sigue siendo justo
        donde hace falta.
      */}
      {canje && (
        <p className="text-[12px] text-slate-400">
          Se pueden convertir <strong>{euros(canje.valorMonedasCentimos)}</strong> de esas monedas
          en billetes desde el panel de canje, arriba.
        </p>
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
  extra,
  vacio,
}: {
  titulo: string;
  lineas: readonly LineaDenominacion[];
  total: number;
  tono: string;
  /** Una fila sin pieza concreta, como lo que quedó de ingresos anteriores. */
  extra?: { texto: string; valor: number; accion?: ReactNode };
  /** Texto cuando no hay piezas. Sin él, la tabla vacía no se pinta. */
  vacio?: string;
}) {
  const { denominaciones } = useCash();
  if (lineas.length === 0 && !extra && !vacio) return null;

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
          {lineas.length === 0 && !extra && vacio && (
            <tr className="border-t border-slate-800">
              <td colSpan={4} className="px-2 py-1.5 text-slate-500">
                {vacio}
              </td>
            </tr>
          )}
          {extra && (
            <tr className="border-t border-slate-800">
              <td className="w-12 px-2 py-1" />
              <td colSpan={2} className="px-1 py-1 text-slate-300">
                <span className="mr-2">{extra.texto}</span>
                {extra.accion}
              </td>
              <td className="px-2 py-1 text-right tabular-nums text-slate-400">{euros(extra.valor)}</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Fecha real y referencia del banco.
 *
 * El ingreso se registra en la tienda al preparar la bolsa, pero estos dos
 * datos los da el banco DESPUÉS, cuando alguien vuelve con el resguardo. Antes
 * solo se podían poner al crear el ingreso —y si aún no se sabían, que es lo
 * normal, se quedaban en «—» para siempre—.
 */
function DatosDelBanco({
  ingreso,
  editable,
  onGuardado,
}: {
  ingreso: IngresoBancario;
  editable: boolean;
  onGuardado: () => void;
}) {
  const [abierto, setAbierto] = useState(false);
  const [fecha, setFecha] = useState(ingreso.fechaIngreso ?? "");
  const [referencia, setReferencia] = useState(ingreso.referencia ?? "");
  const [cuentaId, setCuentaId] = useState<number | "">(ingreso.bankAccountId ?? "");
  const [cuentas, setCuentas] = useState<CuentaBancariaConfig[]>([]);
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState("");

  // Las cuentas solo se piden al abrir el formulario: no hacen falta para
  // pintar la fila, y son una petición por ingreso desplegado.
  useEffect(() => {
    if (!abierto) return;
    void api
      .cuentasBancarias()
      .then((r) => setCuentas(r.cuentas))
      .catch(() => setCuentas([]));
  }, [abierto]);

  if (!editable || ingreso.estado !== "CONFIRMADO") return null;

  async function guardar() {
    setOcupado(true);
    setError("");
    try {
      await api.completarIngreso(ingreso.id, {
        fechaIngreso: fecha || null,
        referencia,
        bankAccountId: cuentaId === "" ? null : cuentaId,
      });
      setAbierto(false);
      onGuardado();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se han podido guardar los datos");
    } finally {
      setOcupado(false);
    }
  }

  if (!abierto) {
    return (
      <button
        onClick={() => setAbierto(true)}
        className="mt-3 flex items-center gap-1 rounded-lg bg-sky-700 px-3 py-1.5 text-[12px] font-bold text-white hover:bg-sky-600"
      >
        <Landmark className="h-3.5 w-3.5" />
        {ingreso.fechaIngreso || ingreso.referencia ? "Editar datos del banco" : "Confirmar en el banco"}
      </button>
    );
  }

  return (
    <div className="mt-3 rounded-lg border border-slate-700 bg-slate-900/60 p-2">
      {error && <div className="mb-1 text-[11px] text-rose-300">{error}</div>}
      <div className="flex flex-wrap items-end gap-2">
        <label className="block">
          <span className="mb-1 block text-[10px] font-semibold uppercase text-slate-400">
            Banco y cuenta
          </span>
          <select
            value={cuentaId}
            onChange={(e) => setCuentaId(e.target.value === "" ? "" : Number(e.target.value))}
            className={inputCls}
          >
            <option value="">Sin especificar</option>
            {/*
              Las de baja solo salen si son LA de este ingreso: el dinero pudo
              ir a una cuenta que después se cerró, y quitarla del desplegable
              borraría ese dato en cuanto alguien tocara la fecha.
            */}
            {cuentas
              .filter((c) => c.activa || c.id === ingreso.bankAccountId)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.banco}
                  {c.alias ? ` · ${c.alias}` : ""} · ···{c.iban.slice(-4)}
                  {c.activa ? "" : " (de baja)"}
                </option>
              ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 flex items-center gap-2 text-[10px] font-semibold uppercase text-slate-400">
            Fecha real del ingreso
            {/*
              Casi siempre se confirma el mismo día que se vuelve del banco, y
              teclear dd/mm/aaaa para poner hoy es el tipo de fricción que hace
              que el campo se quede vacío.
            */}
            <button
              type="button"
              onClick={() => setFecha(new Date().toLocaleDateString("sv-SE"))}
              className="rounded bg-slate-700 px-1.5 py-0.5 text-[10px] font-bold normal-case text-slate-200 hover:bg-slate-600"
              title="Poner la fecha de hoy"
            >
              Hoy
            </button>
          </span>
          <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} className={inputCls} />
        </label>
        <label className="block">
          <span className="mb-1 block text-[10px] font-semibold uppercase text-slate-400">
            Referencia bancaria
          </span>
          <input
            value={referencia}
            onChange={(e) => setReferencia(e.target.value)}
            placeholder="Nº de resguardo"
            className={inputCls}
          />
        </label>
        <button
          onClick={() => void guardar()}
          disabled={ocupado}
          className="rounded-lg bg-emerald-600 px-3 py-1.5 text-[12px] font-bold text-white hover:bg-emerald-500 disabled:opacity-50"
        >
          {ocupado ? "Guardando…" : "Guardar"}
        </button>
        <button onClick={() => setAbierto(false)} className={btnSecondary}>
          Cancelar
        </button>
      </div>
    </div>
  );
}

/**
 * El comprobante escaneado que da el banco.
 *
 * Cuelga del INGRESO y no de una jornada: el resguardo cubre el ingreso
 * entero, que junta los cierres de varios días, y elegir uno de ellos sería
 * arbitrario. Por eso tampoco sale en el informe de cierre de ninguno.
 */
function ComprobantesDelIngreso({
  depositId,
  puedeAdjuntar,
}: {
  depositId: number;
  puedeAdjuntar: boolean;
}) {
  const [docs, setDocs] = useState<DocumentoOperacion[]>([]);
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState("");

  const cargar = useCallback(async () => {
    try {
      setDocs((await api.documentosDeIngreso(depositId)).documentos);
    } catch {
      /* que no se caiga el detalle entero por esto */
    }
  }, [depositId]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  async function subir(fichero: File) {
    setOcupado(true);
    setError("");
    try {
      await api.adjuntarDocumentoAIngreso(depositId, fichero);
      await cargar();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se ha podido subir el comprobante");
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div className="mt-3">
      <div className="mb-1 text-[10px] font-semibold uppercase text-slate-400">
        Comprobante del banco
      </div>
      {error && <div className="mb-1 text-[11px] text-rose-300">{error}</div>}

      {docs.length === 0 && !puedeAdjuntar && (
        <p className="text-[12px] text-slate-500">Todavía no se ha subido ninguno.</p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {docs.map((d) => (
          <a
            key={d.id}
            href={d.url ?? "#"}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1 rounded-lg bg-slate-700 px-2 py-1 text-[11px] text-slate-200 hover:bg-slate-600"
          >
            <Paperclip className="h-3 w-3" /> {d.nombre}
          </a>
        ))}

        {puedeAdjuntar && (
          <label className="flex cursor-pointer items-center gap-1 rounded-lg bg-slate-700 px-3 py-1.5 text-[12px] font-medium text-slate-200 hover:bg-slate-600">
            <Upload className="h-3.5 w-3.5" />
            {ocupado ? "Subiendo…" : docs.length > 0 ? "Añadir otro" : "Subir comprobante"}
            <input
              type="file"
              accept="application/pdf,image/jpeg,image/png"
              className="hidden"
              disabled={ocupado}
              onChange={(e) => {
                const f = e.target.files?.[0];
                // El valor se limpia para poder volver a elegir el MISMO fichero
                // si la primera subida falló.
                e.target.value = "";
                if (f) void subir(f);
              }}
            />
          </label>
        )}
      </div>
    </div>
  );
}

/**
 * Manda el resguardo a la central, con el comprobante escaneado adjunto.
 *
 * El taller ingresa y la central concilia; entre las dos cosas había un correo
 * a mano que es justo el paso que se olvida cuando el día viene torcido.
 */
function EnviarALaCentral({ ingreso }: { ingreso: IngresoBancario }) {
  const [estado, setEstado] = useState<"listo" | "enviando" | "enviado">("listo");
  const [error, setError] = useState("");

  async function enviar() {
    setEstado("enviando");
    setError("");
    try {
      const r = await api.enviarResguardoALaCentral(ingreso.id);
      setEstado("enviado");
      // Quién lo ha recibido, no solo «enviado»: es lo que se comprueba
      // cuando en la central dicen que no les ha llegado.
      setError("");
      setDestinos(r.destinatarios.join(", "));
    } catch (e) {
      setEstado("listo");
      setError(e instanceof Error ? e.message : "No se ha podido enviar");
    }
  }

  const [destinos, setDestinos] = useState("");

  return (
    <div className="inline-flex flex-col items-end">
      <button
        onClick={() => void enviar()}
        disabled={estado !== "listo"}
        title={
          estado === "enviado"
            ? `Enviado a ${destinos}`
            : "Mandar el resguardo y el comprobante a la central"
        }
        className="mr-1 inline-flex items-center gap-1 rounded-lg bg-slate-700 px-2 py-1 text-[11px] font-medium text-slate-200 hover:bg-slate-600 disabled:opacity-50"
      >
        <Mail className="h-3.5 w-3.5" />
        {estado === "enviando" ? "Enviando…" : estado === "enviado" ? "Enviado" : "Enviar"}
      </button>
      {error && <span className="mt-0.5 max-w-[220px] text-right text-[10px] text-rose-300">{error}</span>}
    </div>
  );
}
