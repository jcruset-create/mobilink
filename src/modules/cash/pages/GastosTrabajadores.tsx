/**
 * Gastos de trabajadores: liquidaciones de tickets.
 *
 * Un trabajador trae sus tickets —dietas, peajes, parking— y se le devuelve lo
 * que adelantó. Aquí se preparan, se revisan y se aprueban. Nada de esta
 * pantalla toca el cajón: una liquidación NO es un movimiento de caja, y el
 * dinero solo sale cuando se paga una aprobada.
 *
 * Cada ticket se lee solo si la lectura automática está configurada, y la
 * lectura únicamente rellena huecos. Lo que habilita el pago es que alguien
 * haya REVISADO la línea, no que una máquina la haya leído: si la lectura
 * falla o no existe, se pone a mano y se sigue.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ArrowLeft, Banknote, CheckCircle2, FileText, Plus, RefreshCw, Upload } from "lucide-react";
import { useCash } from "../contexts/CashContext";
import {
  Aviso,
  BotonInforme,
  Cabecera,
  EmptyRow,
  ErrorBox,
  Modal,
  Pill,
  TableWrap,
  btnDanger,
  btnMini,
  btnPrimary,
  btnSecondary,
  inputCls,
  tdCls,
  thCls,
} from "../components/ui";
import { MAXIMO_JUSTIFICANTE } from "../components/JustificantePrevio";
import PaymentMethodPicker from "../components/PaymentMethodPicker";
import DenominationGrid, {
  type CantidadesPorValor,
  cantidadesDesde,
  lineasDesde,
} from "../components/DenominationGrid";
import { AvisoCartuchos } from "../components/ui";
import { aCentimos, aTextoEditable, euros, fechaJornada, totalLineas } from "../utils/money";
import { esFallo } from "../utils/result";
import { TONO_ESTADO, accionesDisponibles, reglaParaRecordar } from "../utils/liquidacion";
import {
  ETIQUETA_ESTADO_LIQUIDACION,
  type AperturaCartucho,
  type ConceptoGasto,
  type DestinoGasto,
  type DetalleLiquidacion,
  type Empleado,
  type EstadoLiquidacion,
  type LineaLiquidacion,
  type Liquidacion,
} from "../types";
import * as api from "../services/api";

const periodo = (l: Liquidacion) =>
  l.periodoDesde
    ? l.periodoDesde === l.periodoHasta
      ? fechaJornada(l.periodoDesde)
      : `${fechaJornada(l.periodoDesde)} – ${fechaJornada(l.periodoHasta)}`
    : "—";

export default function GastosTrabajadores() {
  const { puede } = useCash();
  const [lista, setLista] = useState<Liquidacion[]>([]);
  const [filtro, setFiltro] = useState<"" | EstadoLiquidacion>("");
  const [abierta, setAbierta] = useState<number | null>(null);
  const [conceptos, setConceptos] = useState<ConceptoGasto[]>([]);
  const [destinos, setDestinos] = useState<DestinoGasto[]>([]);
  const [lectura, setLectura] = useState(false);
  const [empleados, setEmpleados] = useState<Empleado[] | null>(null);
  const [filtroPersona, setFiltroPersona] = useState<number | "">("");
  const [error, setError] = useState("");

  /*
   * `?numero=LG-26-001` abre esa directamente: es el enlace del Histórico,
   * donde el pago lleva el número de la liquidación como referencia.
   */
  const [params, setParams] = useSearchParams();
  const numeroPedido = params.get("numero");

  const cargar = useCallback(async () => {
    try {
      const r = (
        await api.liquidaciones({
          estado: filtro || undefined,
          expenseTargetId: filtroPersona === "" ? undefined : filtroPersona,
        })
      ).liquidaciones;
      setLista(r);
      if (numeroPedido) {
        const encontrada = r.find((x) => x.numero === numeroPedido);
        if (encontrada) setAbierta(encontrada.id);
        setParams({}, { replace: true });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se han podido cargar las liquidaciones");
    }
  }, [filtro, filtroPersona, numeroPedido, setParams]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  useEffect(() => {
    api
      .conceptosDeGasto()
      .then((r) => {
        setConceptos(r.conceptos);
        setDestinos(r.destinos);
      })
      .catch(() => {
        /* sin catálogo se puede mirar igual; el error saldrá al usarlo */
      });
    api
      .reglasGasto()
      .then((r) => setLectura(r.lecturaDisponible))
      .catch(() => setLectura(false));
    api
      .empleados()
      .then((r) => setEmpleados(r.disponible ? r.empleados : null))
      .catch(() => setEmpleados(null));
  }, []);

  if (abierta != null) {
    return (
      <DetalleDeLiquidacion
        id={abierta}
        conceptos={conceptos}
        destinos={destinos}
        lectura={lectura}
        onVolver={() => {
          setAbierta(null);
          void cargar();
        }}
      />
    );
  }

  return (
    <div className="space-y-3">
      <Cabecera
        titulo="Gastos de trabajadores"
        descripcion="Tickets que un trabajador ha pagado de su bolsillo: se revisan, se aprueban y se le devuelven."
      />
      {error && <ErrorBox>{error}</ErrorBox>}

      {puede("cash.expense_claim.create") && (
        <NuevaLiquidacion destinos={destinos} empleados={empleados} onCreada={(id) => setAbierta(id)} />
      )}

      <div className="flex items-center gap-2">
        <label className="text-[11px] uppercase text-slate-400">Estado</label>
        <select
          value={filtro}
          onChange={(e) => setFiltro(e.target.value as "" | EstadoLiquidacion)}
          className={`${inputCls} w-44`}
        >
          <option value="">Todas</option>
          {Object.entries(ETIQUETA_ESTADO_LIQUIDACION).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        <label className="ml-2 text-[11px] uppercase text-slate-400">Trabajador</label>
        <select
          value={filtroPersona}
          onChange={(e) => setFiltroPersona(e.target.value ? Number(e.target.value) : "")}
          className={`${inputCls} w-56`}
        >
          <option value="">Todos</option>
          {destinos
            .filter((d) => d.tipo === "PERSONA")
            .map((d) => (
              <option key={d.id} value={d.id}>
                {d.nombre}
              </option>
            ))}
        </select>
      </div>

      <TableWrap>
        <thead>
          <tr>
            <th className={thCls}>Número</th>
            <th className={thCls}>Trabajador</th>
            <th className={thCls}>Estado</th>
            <th className={thCls}>Periodo</th>
            <th className={`${thCls} text-right`}>Tickets</th>
            <th className={`${thCls} text-right`}>Total</th>
          </tr>
        </thead>
        <tbody>
          {lista.length === 0 && <EmptyRow cols={6} text="No hay liquidaciones con ese filtro." />}
          {lista.map((l) => (
            <tr
              key={l.id}
              onClick={() => setAbierta(l.id)}
              className="cursor-pointer border-t border-slate-700/60 hover:bg-slate-700/40"
            >
              <td className={`${tdCls} font-mono text-[11px] text-slate-300`}>{l.numero}</td>
              <td className={`${tdCls} font-medium text-slate-100`}>{l.empleadoNombre}</td>
              <td className={tdCls}>
                <Pill className={TONO_ESTADO[l.estado]}>{ETIQUETA_ESTADO_LIQUIDACION[l.estado]}</Pill>
              </td>
              <td className={`${tdCls} text-slate-400`}>{periodo(l)}</td>
              <td className={`${tdCls} text-right tabular-nums text-slate-300`}>{l.lineas ?? "—"}</td>
              {/* En borrador el total todavía no está fijado: se fija al presentar. */}
              <td className={`${tdCls} text-right font-bold tabular-nums`}>
                {l.estado === "BORRADOR" ? <span className="text-slate-500">—</span> : euros(l.totalCentimos)}
              </td>
            </tr>
          ))}
        </tbody>
      </TableWrap>
    </div>
  );
}

// ── Crear ──────────────────────────────────────────────────────────────────

export function NuevaLiquidacion({
  destinos,
  empleados,
  onCreada,
}: {
  destinos: DestinoGasto[];
  /** `null` = la instalación no tiene fichas de empleado: se elige la persona de Cash. */
  empleados: Empleado[] | null;
  onCreada: (id: number) => void;
}) {
  /*
   * Se elige al TRABAJADOR. Con fichas de empleado, por su ficha: es su
   * identidad, y Cash le busca —o le crea— su persona. Las personas de Cash
   * que todavía no tienen ficha siguen saliendo aparte, para no dejar a nadie
   * sin poder cobrar mientras se vinculan en Configuración.
   */
  const conFicha = new Set((empleados ?? []).map((e) => e.destinoId).filter((x): x is number => x != null));
  const sueltas = destinos.filter((d) => d.tipo === "PERSONA" && d.activo && !conFicha.has(d.id));
  const [eleccion, setEleccion] = useState("");
  const [notas, setNotas] = useState("");
  const [error, setError] = useState("");
  const [creando, setCreando] = useState(false);
  /** La persona suelta que se parece al empleado elegido: se pregunta antes de vincularla. */
  const [parecida, setParecida] = useState<{ id: number; nombre: string } | null>(null);

  const nombreDe = (e: Empleado) => [e.nombre, e.apellidos].filter(Boolean).join(" ");

  async function crear(vincularAntes?: number) {
    if (!eleccion) return;
    setCreando(true);
    setError("");
    try {
      const [tipo, valor] = [eleccion.slice(0, 1), eleccion.slice(2)];
      if (vincularAntes != null) await api.vincularPersona(vincularAntes, valor);
      const r = await api.crearLiquidacion(
        tipo === "e"
          ? { employeeId: valor, notas: notas.trim() || undefined }
          : { expenseTargetId: Number(valor), notas: notas.trim() || undefined }
      );
      setParecida(null);
      onCreada(r.liquidacion.id);
    } catch (e) {
      const detalle = (e as { codigo?: string; detalle?: { candidato?: { id: number; nombre: string } } }) ?? {};
      if (detalle.codigo === "DESTINO_SIN_VINCULAR" && detalle.detalle?.candidato) {
        setParecida(detalle.detalle.candidato);
      } else {
        setError(e instanceof Error ? e.message : "No se ha podido crear");
      }
    } finally {
      setCreando(false);
    }
  }

  const hayAlguien = (empleados?.length ?? 0) > 0 || sueltas.length > 0;

  return (
    <section className="rounded-xl border border-slate-700 bg-slate-800/60 p-3">
      <h2 className="mb-2 flex items-center gap-2 text-sm font-bold text-slate-100">
        <Plus className="h-4 w-4" /> Nueva liquidación
      </h2>
      {error && <ErrorBox>{error}</ErrorBox>}
      {!hayAlguien ? (
        <Aviso tono="aviso">
          No hay ningún trabajador disponible. Da de alta a la persona en Configuración → Conceptos de gasto → «A
          un operario».
        </Aviso>
      ) : (
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1">
            <span className="text-[10px] font-semibold uppercase text-slate-400">Trabajador</span>
            <select
              value={eleccion}
              onChange={(e) => {
                setEleccion(e.target.value);
                setParecida(null);
              }}
              className={`${inputCls} w-72`}
            >
              <option value="">Elige…</option>
              {empleados && empleados.length > 0 && (
                <optgroup label="Empleados">
                  {empleados.map((e) => (
                    <option key={e.id} value={`e:${e.id}`}>
                      {nombreDe(e)}
                      {e.codigo ? ` (${e.codigo})` : ""}
                    </option>
                  ))}
                </optgroup>
              )}
              {sueltas.length > 0 && (
                <optgroup label={empleados ? "Personas de Cash sin ficha de empleado" : "Personas"}>
                  {sueltas.map((d) => (
                    <option key={d.id} value={`d:${d.id}`}>
                      {d.nombre}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
          </label>
          <label className="flex flex-1 flex-col gap-1">
            <span className="text-[10px] font-semibold uppercase text-slate-400">Notas (opcional)</span>
            <input
              value={notas}
              onChange={(e) => setNotas(e.target.value)}
              placeholder="Viaje a Lleida, semana del 21"
              className={inputCls}
            />
          </label>
          <button onClick={() => void crear()} disabled={!eleccion || creando} className={btnPrimary}>
            {creando ? "Creando…" : "Crear"}
          </button>
        </div>
      )}
      {parecida && (
        <div className="mt-2">
          <Aviso tono="aviso">
            En Cash ya hay una persona llamada <strong>{parecida.nombre}</strong> sin ficha de empleado. ¿Es la
            misma persona?
            <div className="mt-2 flex flex-wrap gap-2">
              <button className={btnPrimary} disabled={creando} onClick={() => void crear(parecida.id)}>
                Sí: vincularla y crear
              </button>
              <button className={btnSecondary} disabled={creando} onClick={() => setParecida(null)}>
                No, cancelar
              </button>
            </div>
            <p className="mt-1 text-[11px] text-slate-400">
              Si no es la misma, cámbiale el nombre en Configuración para distinguirlas.
            </p>
          </Aviso>
        </div>
      )}
    </section>
  );
}

// ── Detalle ────────────────────────────────────────────────────────────────

function DetalleDeLiquidacion({
  id,
  conceptos,
  destinos,
  lectura,
  onVolver,
}: {
  id: number;
  conceptos: ConceptoGasto[];
  destinos: DestinoGasto[];
  lectura: boolean;
  onVolver: () => void;
}) {
  const { permisos, puede, refrescar } = useCash();
  const [d, setD] = useState<DetalleLiquidacion | null>(null);
  const [pagando, setPagando] = useState(false);
  const [error, setError] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [pidiendoMotivo, setPidiendoMotivo] = useState<"RECHAZAR" | "ANULAR" | null>(null);
  const entrada = useRef<HTMLInputElement>(null);

  const cargar = useCallback(async () => {
    try {
      setD(await api.liquidacion(id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se ha podido cargar la liquidación");
    }
  }, [id]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  /*
   * Mientras quede algún ticket leyéndose, se vuelve a pedir cada pocos
   * segundos: la lectura la hace el servidor por detrás y así los campos
   * aparecen solos sin que nadie tenga que recargar. En cuanto no queda
   * ninguno, se para.
   */
  const leyendo = Boolean(d?.lineas.some((x) => x.analisis === "PENDIENTE" || x.analisis === "ANALIZANDO"));
  useEffect(() => {
    if (!leyendo) return;
    const t = setInterval(() => void cargar(), 4000);
    return () => clearInterval(t);
  }, [leyendo, cargar]);

  async function accion(fn: () => Promise<unknown>) {
    setOcupado(true);
    setError("");
    try {
      await fn();
      await cargar();
    } catch (e) {
      setError(e instanceof Error ? e.message : "La acción ha fallado");
      await cargar();
    } finally {
      setOcupado(false);
    }
  }

  async function subir(ficheros: FileList | null) {
    if (!ficheros || ficheros.length === 0) return;
    await accion(async () => {
      // De uno en uno: si el tercero falla, los dos primeros ya están subidos.
      for (const f of Array.from(ficheros)) {
        if (f.size > MAXIMO_JUSTIFICANTE) {
          throw new Error(`«${f.name}» pesa ${(f.size / 1024 / 1024).toFixed(1)} MB y el máximo son 15 MB.`);
        }
        await api.subirTicket(id, f);
      }
    });
    if (entrada.current) entrada.current.value = "";
  }

  const acciones = useMemo(
    () => (d ? accionesDisponibles(d.liquidacion.estado, permisos, d.bloqueos.length) : new Set()),
    [d, permisos]
  );

  if (!d) {
    return (
      <div className="space-y-3">
        <button onClick={onVolver} className={btnSecondary}>
          <ArrowLeft className="mr-1 inline h-4 w-4" /> Volver
        </button>
        {error ? <ErrorBox>{error}</ErrorBox> : <p className="text-sm text-slate-400">Cargando…</p>}
      </div>
    );
  }

  const l = d.liquidacion;
  const editable = acciones.has("EDITAR");
  const incluidas = d.lineas.filter((x) => x.situacion === "INCLUIDA");
  const excluidas = d.lineas.filter((x) => x.situacion === "EXCLUIDA");

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={onVolver} className={btnSecondary}>
          <ArrowLeft className="mr-1 inline h-4 w-4" /> Volver
        </button>
        <h1 className="text-xl font-black text-slate-100">
          <span className="font-mono text-base text-slate-400">{l.numero}</span> · {l.empleadoNombre}
        </h1>
        <Pill className={TONO_ESTADO[l.estado]}>{ETIQUETA_ESTADO_LIQUIDACION[l.estado]}</Pill>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <BotonInforme ruta={`/expense-claims/${l.id}/report.pdf`} nombre={`liquidacion-${l.numero}`} className={btnSecondary}>
            PDF
          </BotonInforme>
          {acciones.has("PRESENTAR") && (
            <button disabled={ocupado} onClick={() => void accion(() => api.presentarLiquidacion(l.id))} className={btnPrimary}>
              Presentar
            </button>
          )}
          {acciones.has("APROBAR") && (
            <button disabled={ocupado} onClick={() => void accion(() => api.aprobarLiquidacion(l.id))} className={btnPrimary}>
              <CheckCircle2 className="mr-1 inline h-4 w-4" /> Aprobar
            </button>
          )}
          {acciones.has("RECHAZAR") && (
            <button disabled={ocupado} onClick={() => setPidiendoMotivo("RECHAZAR")} className={btnSecondary}>
              Rechazar
            </button>
          )}
          {l.estado === "APROBADA" && puede("cash.expense_claim.pay") && (
            <button disabled={ocupado} onClick={() => setPagando(true)} className={btnPrimary}>
              <Banknote className="mr-1 inline h-4 w-4" /> Pagar {euros(l.totalCentimos)}
            </button>
          )}
          {acciones.has("REABRIR") && (
            <button disabled={ocupado} onClick={() => void accion(() => api.reabrirLiquidacion(l.id))} className={btnSecondary}>
              Reabrir para corregir
            </button>
          )}
          {acciones.has("ANULAR") && (
            <button disabled={ocupado} onClick={() => setPidiendoMotivo("ANULAR")} className={btnDanger}>
              Anular
            </button>
          )}
        </div>
      </div>

      {error && <ErrorBox>{error}</ErrorBox>}

      {l.estado === "RECHAZADA" && l.rechazoMotivo && (
        <Aviso tono="mal">
          <strong>Rechazada:</strong> {l.rechazoMotivo}
        </Aviso>
      )}
      {l.estado === "BORRADOR" && l.rechazoMotivo && (
        <Aviso tono="aviso">
          <strong>La rechazaron por esto:</strong> {l.rechazoMotivo}
        </Aviso>
      )}
      {l.estado === "ANULADA" && <Aviso tono="mal">Anulada: {l.anuladaMotivo}</Aviso>}
      {l.estado === "APROBADA" && (
        <Aviso tono="info">
          Aprobada y pendiente de pago.{" "}
          {puede("cash.expense_claim.pay")
            ? "Al pagarla sale el dinero de la caja abierta y los tickets quedan como justificantes del pago."
            : "La paga un responsable."}
        </Aviso>
      )}
      {l.estado === "PAGADA" && (
        <Aviso tono="bien">
          Pagada en <strong>{l.pagoNumero}</strong>. Los tickets están colgados de ese pago y salen en el informe de
          cierre del día. Si el pago fue un error, se anula desde el Histórico y la liquidación vuelve a Aprobada.
        </Aviso>
      )}
      {l.notas && <p className="text-[12px] text-slate-400">Notas: {l.notas}</p>}

      <Totales d={d} />

      {editable && d.bloqueos.length > 0 && (
        <Aviso tono="aviso">
          <strong>Para presentarla falta:</strong>
          <ul className="mt-1 list-disc pl-5 text-[12px]">
            {d.bloqueos.map((b, i) => (
              <li key={i}>{b.mensaje}</li>
            ))}
          </ul>
        </Aviso>
      )}

      {editable && (
        <div className="flex items-center gap-2">
          <input
            ref={entrada}
            type="file"
            multiple
            accept="application/pdf,image/jpeg,image/png"
            className="hidden"
            onChange={(e) => void subir(e.target.files)}
          />
          <button disabled={ocupado} onClick={() => entrada.current?.click()} className={btnPrimary}>
            <Upload className="mr-1 inline h-4 w-4" /> {ocupado ? "Subiendo…" : "Subir tickets"}
          </button>
          <span className="text-[11px] text-slate-500">
            PDF, JPG o PNG. Varios a la vez.{" "}
            {lectura ? "Se leen solos: revisa lo que rellenen." : "Los datos se ponen a mano."}
          </span>
        </div>
      )}

      {d.lineas.length === 0 && (
        <p className="rounded-xl border border-dashed border-slate-700 p-6 text-center text-sm text-slate-500">
          Todavía no hay tickets.
        </p>
      )}

      <div className="space-y-2">
        {[...incluidas, ...excluidas].map((x, i) => (
          <LineaTicket
            key={`${x.id}-${x.analisis}-${x.revisada}-${x.situacion}-${x.duplicados.map((e) => e.resolucion).join()}`}
            claimId={l.id}
            linea={x}
            posicion={x.situacion === "INCLUIDA" ? i + 1 : null}
            conceptos={conceptos}
            destinos={destinos}
            editable={editable}
            aceptaDuplicados={acciones.has("ACEPTAR_DUPLICADO")}
            configura={puede("cash.configure")}
            lectura={lectura}
            ocupado={ocupado}
            onAccion={accion}
          />
        ))}
      </div>

      {pagando && (
        <PagarLiquidacion
          liquidacion={l}
          onCerrar={() => setPagando(false)}
          onPagada={async () => {
            setPagando(false);
            await cargar();
            await refrescar();
          }}
        />
      )}

      {pidiendoMotivo && (
        <PedirMotivo
          titulo={pidiendoMotivo === "RECHAZAR" ? `Rechazar ${l.numero}` : `Anular ${l.numero}`}
          explicacion={
            pidiendoMotivo === "RECHAZAR"
              ? "Quien la preparó verá este motivo al reabrirla para corregirla."
              : "Anular es definitivo. La liquidación y sus tickets se conservan, pero ya no se pagan."
          }
          onCancelar={() => setPidiendoMotivo(null)}
          onConfirmar={(motivo) => {
            const que = pidiendoMotivo;
            setPidiendoMotivo(null);
            void accion(() =>
              que === "RECHAZAR" ? api.rechazarLiquidacion(l.id, motivo) : api.anularLiquidacion(l.id, motivo)
            );
          }}
        />
      )}
    </div>
  );
}

// ── Pagar ──────────────────────────────────────────────────────────────────

/**
 * La ventana de pago: aquí, y solo aquí, sale dinero.
 *
 * Es la misma mecánica que Pagos —forma de pago, piezas que salen y vuelta—
 * con el importe FIJO: se paga lo aprobado, no lo que alguien teclee. La
 * clave de idempotencia nace al abrir la ventana y se repite si se reintenta,
 * así que un doble clic o una respuesta perdida no pagan dos veces.
 */
export function PagarLiquidacion({
  liquidacion,
  onCerrar,
  onPagada,
}: {
  liquidacion: Liquidacion;
  onCerrar: () => void;
  onPagada: () => Promise<void>;
}) {
  const { jornada, denominaciones, disponible, formasParaPagos } = useCash();
  const importe = liquidacion.totalCentimos;
  const [clave] = useState(() =>
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
  const efectivo = formasParaPagos.find((f) => f.afectaEfectivo) ?? null;
  const [forma, setForma] = useState(efectivo?.codigo ?? formasParaPagos[0]?.codigo ?? "");
  const [referencia, setReferencia] = useState("");
  const [entregado, setEntregado] = useState<CantidadesPorValor>({});
  const [vuelta, setVuelta] = useState<CantidadesPorValor>({});
  const [aperturas, setAperturas] = useState<AperturaCartucho[]>([]);
  const [aviso, setAviso] = useState("");
  const [error, setError] = useState("");
  const [pagando, setPagando] = useState(false);

  const formaElegida = formasParaPagos.find((f) => f.codigo === forma) ?? null;
  const esEfectivo = Boolean(formaElegida?.afectaEfectivo);
  const neto = totalLineas(lineasDesde(entregado)) - totalLineas(lineasDesde(vuelta));
  const faltaReferencia = Boolean(formaElegida?.pideReferencia) && !referencia.trim();

  const proponer = useCallback(async () => {
    if (!jornada || !esEfectivo) return;
    try {
      const r = await api.proponerCambio(jornada.sesion.id, importe);
      if (esFallo(r)) {
        setEntregado({});
        setAperturas([]);
        setAviso(r.mensaje);
      } else {
        setEntregado(cantidadesDesde(r.lineas));
        setVuelta({});
        setAperturas(r.aperturas ?? []);
        setAviso("");
      }
    } catch (e) {
      setAviso(e instanceof Error ? e.message : "No se ha podido proponer qué billetes sacar");
    }
  }, [jornada, esEfectivo, importe]);

  useEffect(() => {
    void proponer();
  }, [proponer]);

  async function pagar() {
    if (!jornada) return;
    setPagando(true);
    setError("");
    try {
      await api.pagarLiquidacion(
        liquidacion.id,
        {
          sessionId: jornada.sesion.id,
          importeCentimos: importe,
          formasPago: [{ forma, importe, referencia: referencia.trim() || null }],
          efectivoEntregado: esEfectivo ? lineasDesde(entregado) : [],
          efectivoRecibido: esEfectivo ? lineasDesde(vuelta) : [],
        },
        clave
      );
      await onPagada();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se ha podido pagar");
    } finally {
      setPagando(false);
    }
  }

  const puedePagar =
    Boolean(jornada) && Boolean(forma) && !faltaReferencia && (!esEfectivo || neto === importe) && !pagando;

  return (
    <Modal
      title={`Pagar ${liquidacion.numero} a ${liquidacion.empleadoNombre}`}
      onClose={onCerrar}
      wide
      footer={
        <div className="flex items-center justify-end gap-2">
          <button className={btnSecondary} onClick={onCerrar} disabled={pagando}>
            Cancelar
          </button>
          <button className={btnPrimary} onClick={() => void pagar()} disabled={!puedePagar}>
            {pagando ? "Pagando…" : `Confirmar pago de ${euros(importe)}`}
          </button>
        </div>
      }
    >
      <div className="space-y-3">
        {!jornada && <Aviso tono="aviso">No hay ninguna jornada abierta. Ábrela desde «Jornada actual» para pagar.</Aviso>}
        {error && <ErrorBox>{error}</ErrorBox>}
        <div className="flex items-baseline justify-between rounded-lg bg-slate-900/60 px-3 py-2">
          <span className="text-sm text-slate-400">Importe aprobado</span>
          <span className="text-2xl font-black tabular-nums text-slate-100">{euros(importe)}</span>
        </div>
        <div>
          <span className="mb-1 block text-[10px] font-semibold uppercase text-slate-400">Forma de pago</span>
          <PaymentMethodPicker
            formas={formasParaPagos}
            valor={forma}
            onChange={(v) => {
              setForma(v);
              setEntregado({});
              setVuelta({});
            }}
            permitirMixto={false}
            deshabilitado={pagando}
          />
        </div>
        {formaElegida?.pideReferencia && (
          <label className="block">
            <span className="mb-1 block text-[10px] font-semibold uppercase text-slate-400">
              Referencia (obligatoria)
            </span>
            <input value={referencia} onChange={(e) => setReferencia(e.target.value)} className={inputCls} />
          </label>
        )}
        {esEfectivo && jornada && (
          <>
            {aviso && <Aviso tono="mal">{aviso}</Aviso>}
            <AvisoCartuchos aperturas={aperturas} />
            <DenominationGrid
              titulo="Efectivo que sale de la caja"
              denominaciones={denominaciones}
              cantidades={entregado}
              onChange={setEntregado}
              disponible={disponible}
              mostrarDisponible
              objetivoCentimos={importe}
              deshabilitado={pagando}
            />
            <button onClick={() => void proponer()} className={btnSecondary}>
              <RefreshCw className="mr-1 inline h-3.5 w-3.5" /> Proponer composición
            </button>
            <DenominationGrid
              titulo="Vuelta que devuelve el trabajador"
              denominaciones={denominaciones}
              cantidades={vuelta}
              onChange={setVuelta}
              deshabilitado={pagando}
            />
            <div
              className={`flex items-baseline justify-between rounded-lg px-3 py-2 text-sm ${
                neto === importe ? "bg-emerald-500/10 text-emerald-200" : "bg-amber-500/10 text-amber-200"
              }`}
            >
              <span>Sale de la caja, descontada la vuelta</span>
              <span className="font-bold tabular-nums">{euros(neto)}</span>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

export function Totales({ d }: { d: DetalleLiquidacion }) {
  return (
    <section className="flex flex-wrap items-stretch gap-2">
      {d.totales.porConcepto.map((t) => (
        <div key={t.conceptoId ?? "sin"} className="rounded-lg bg-slate-800 px-3 py-2">
          <div className="text-[10px] font-bold uppercase text-slate-400">
            {t.nombre} <span className="text-slate-500">({t.lineas})</span>
          </div>
          <div className={`text-lg font-black tabular-nums ${t.conceptoId == null ? "text-amber-300" : "text-slate-100"}`}>
            {euros(t.importeCentimos)}
          </div>
        </div>
      ))}
      <div className="rounded-lg border border-sky-500/40 bg-sky-500/10 px-3 py-2">
        <div className="text-[10px] font-bold uppercase text-sky-300">Total</div>
        <div className="text-lg font-black tabular-nums text-sky-100">{euros(d.totales.totalCentimos)}</div>
      </div>
    </section>
  );
}

// ── Un ticket ──────────────────────────────────────────────────────────────

const TEXTO_ANALISIS: Record<LineaLiquidacion["analisis"], string> = {
  PENDIENTE: "Lectura pendiente",
  ANALIZANDO: "Leyendo…",
  LISTO: "Leído",
  FALLIDO: "No se ha podido leer",
  OMITIDO: "Datos a mano",
};

const TEXTO_COINCIDENCIA: Record<string, string> = {
  MISMO_FICHERO: "el mismo fichero",
  MISMA_CLAVE: "mismo establecimiento, día e importe",
  MISMO_NUMERO: "el mismo número, ya pagado",
};

export function LineaTicket({
  claimId,
  linea,
  posicion,
  conceptos,
  destinos,
  editable,
  aceptaDuplicados,
  configura = false,
  lectura = false,
  ocupado,
  onAccion,
}: {
  claimId: number;
  linea: LineaLiquidacion;
  posicion: number | null;
  conceptos: ConceptoGasto[];
  destinos: DestinoGasto[];
  editable: boolean;
  aceptaDuplicados: boolean;
  /** Puede crear reglas de concepto: se le ofrece recordar lo que elige a mano. */
  configura?: boolean;
  /** Hay lectura automática configurada: se ofrece volver a leer. */
  lectura?: boolean;
  ocupado: boolean;
  onAccion: (fn: () => Promise<unknown>) => Promise<void>;
}) {
  const [fecha, setFecha] = useState(linea.fecha ?? "");
  const [emisor, setEmisor] = useState(linea.emisorNombre);
  const [nif, setNif] = useState(linea.emisorNif ?? "");
  const [numero, setNumero] = useState(linea.numeroDocumento ?? "");
  const [importe, setImporte] = useState(linea.importeCentimos ? aTextoEditable(linea.importeCentimos) : "");
  const [base, setBase] = useState(linea.baseCentimos == null ? "" : aTextoEditable(linea.baseCentimos));
  const [iva, setIva] = useState(linea.ivaCentimos == null ? "" : aTextoEditable(linea.ivaCentimos));
  const [conceptoId, setConceptoId] = useState<number | "">(linea.expenseConceptId ?? "");
  const [destinoId, setDestinoId] = useState<number | "">(linea.expenseTargetId ?? "");
  const [motivo, setMotivo] = useState("");
  const [pidiendo, setPidiendo] = useState<null | "EXCLUIR" | { aceptar: number }>(null);
  const [recordada, setRecordada] = useState(false);

  const excluida = linea.situacion === "EXCLUIDA";
  const editableAqui = editable && !excluida;
  const concepto = conceptos.find((c) => c.id === conceptoId) ?? null;
  const centros = destinos.filter((d) => d.tipo === "CENTRO_COSTE" && d.activo);
  const pendientes = linea.duplicados.filter((e) => e.resolucion === "PENDIENTE");
  /*
   * La propuesta de concepto de la lectura, cuando no se ha aplicado sola —la
   * regla solo sugería, o la confianza no llegaba— y el concepto elegido es
   * otro o ninguno. Se enseña con su porqué y un botón; no se aplica sola.
   */
  const idPropuesto = linea.leido?.conceptoPropuesto.conceptoId ?? null;
  const propuesto =
    idPropuesto != null && idPropuesto !== conceptoId ? (conceptos.find((c) => c.id === idPropuesto && c.activo) ?? null) : null;

  // Aprender de lo elegido a mano: el próximo ticket igual saldrá solo.
  const recordar =
    configura && !excluida && !recordada && concepto?.activo
      ? reglaParaRecordar(linea.leido, concepto.id, { nombre: linea.emisorNombre, nif: linea.emisorNif })
      : null;

  const importeCent = importe.trim() ? aCentimos(importe) : 0;
  const importeMal = importe.trim() !== "" && (importeCent == null || importeCent < 0);

  /** Sin `revisada`, guardar no cambia quién la revisó ni cuándo. */
  function cambios(revisada?: boolean): api.CambiosLineaLiquidacion {
    const opcional = (t: string) => (t.trim() ? aCentimos(t) : null);
    return {
      fecha: fecha || null,
      emisorNombre: emisor,
      emisorNif: nif || null,
      numeroDocumento: numero || null,
      importeCentimos: importeCent ?? 0,
      baseCentimos: opcional(base),
      ivaCentimos: opcional(iva),
      expenseConceptId: conceptoId === "" ? null : conceptoId,
      expenseTargetId: concepto?.tipoDestino === "CENTRO_COSTE" && destinoId !== "" ? destinoId : null,
      ...(revisada === undefined ? {} : { revisada }),
    };
  }

  return (
    <article
      className={`rounded-xl border p-3 ${
        excluida
          ? "border-slate-800 bg-slate-900/40 opacity-70"
          : pendientes.length > 0
            ? "border-amber-500/50 bg-slate-800"
            : linea.revisada
              ? "border-emerald-600/40 bg-slate-800"
              : "border-slate-700 bg-slate-800"
      }`}
    >
      <header className="mb-2 flex flex-wrap items-center gap-2 text-[12px]">
        <span className="font-bold text-slate-200">{posicion != null ? `Ticket ${posicion}` : "Excluido"}</span>
        {linea.url ? (
          <a href={linea.url} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-sky-300 hover:underline">
            <FileText className="h-3.5 w-3.5" /> {linea.nombre}
          </a>
        ) : (
          <span className="text-slate-400">{linea.nombre}</span>
        )}
        <Pill className="bg-slate-700 text-slate-300">{TEXTO_ANALISIS[linea.analisis]}</Pill>
        {linea.revisada && !excluida && <Pill className="bg-emerald-500/20 text-emerald-200">Revisado</Pill>}
        {excluida && <Pill className="bg-slate-700 text-slate-400">No se paga: {linea.excluidaMotivo}</Pill>}
        <span className="ml-auto text-base font-black tabular-nums text-slate-100">
          {euros(linea.importeCentimos)}
          {linea.moneda !== "EUR" && <span className="ml-1 text-[11px] text-amber-300">{linea.moneda}</span>}
        </span>
      </header>

      {linea.analisis === "FALLIDO" && (
        <p className="mb-2 rounded-lg bg-rose-500/10 px-2 py-1 text-[12px] text-rose-200">
          No se ha podido leer{linea.analisisError ? `: ${linea.analisisError.replace(/\.+$/, "")}.` : "."} Pon los
          datos a mano; el ticket sirve igual.
        </p>
      )}
      {(linea.analisis === "PENDIENTE" || linea.analisis === "ANALIZANDO") && (
        <p className="mb-2 text-[12px] text-sky-300">Leyendo el ticket… los campos vacíos se rellenarán solos.</p>
      )}
      {/* Lo que ha dicho la lectura y conviene mirar: un abono, varios tickets en uno… */}
      {linea.leido && linea.leido.avisos.length > 0 && !excluida && (
        <ul className="mb-2 space-y-0.5">
          {linea.leido.avisos
            .filter((a) => a.codigo !== "SIN_EVIDENCIA_DE_PAGO" && a.codigo !== "TIPO_DE_DOCUMENTO")
            .map((a, i) => (
              <li key={i} className={`text-[11px] ${a.grave ? "text-amber-300" : "text-slate-400"}`}>
                {a.mensaje}
              </li>
            ))}
        </ul>
      )}
      {propuesto && editableAqui && (
        <p className="mb-2 flex flex-wrap items-center gap-2 text-[12px] text-sky-200">
          <span>
            Concepto propuesto: <strong>{propuesto.nombre}</strong>{" "}
            <span className="text-slate-400">({linea.leido!.conceptoPropuesto.motivo})</span>
          </span>
          <button className={btnMini} onClick={() => setConceptoId(propuesto.id)}>
            Usar
          </button>
        </p>
      )}

      {recordar && concepto && (
        <p className="mb-2 flex flex-wrap items-center gap-2 text-[12px] text-slate-300">
          <span>
            ¿Siempre así? Guardar que {recordar.que} van a <strong>{concepto.nombre}</strong>, para que los demás
            salgan solos.
          </span>
          <button
            className={btnMini}
            disabled={ocupado}
            onClick={() =>
              void onAccion(async () => {
                await api.guardarReglaGasto({ campo: recordar.campo, patron: recordar.patron, conceptoId: concepto.id });
                setRecordada(true);
                // Y los demás tickets ya leídos de esta liquidación, al momento.
                if (editable) await api.aplicarReglasDeConcepto(claimId);
              })
            }
          >
            Recordar
          </button>
        </p>
      )}
      {linea.duplicados.length > 0 && (
        <ul className="mb-2 space-y-1">
          {linea.duplicados.map((e) => (
            <li
              key={e.id}
              className={`flex flex-wrap items-center gap-2 rounded-lg px-2 py-1 text-[12px] ${
                e.resolucion === "PENDIENTE" ? "bg-amber-500/10 text-amber-200" : "bg-slate-900/50 text-slate-400"
              }`}
            >
              <span>
                Puede estar repetido: coincide con <strong>{e.referenciaNumero ?? e.referenciaTipo}</strong> (
                {TEXTO_COINCIDENCIA[e.tipo]}).
              </span>
              {e.resolucion === "ACEPTADA" && <span>· Se paga igualmente: {e.motivo}</span>}
              {e.resolucion === "EXCLUIDA" && <span>· Resuelto al excluir el ticket</span>}
              {e.resolucion === "DESCARTADA" && <span>· Ya no aplica: {e.motivo}</span>}
              {e.resolucion === "PENDIENTE" && editableAqui && (
                <span className="ml-auto flex gap-1">
                  <button
                    disabled={ocupado}
                    className={btnMini}
                    onClick={() =>
                      void onAccion(() =>
                        api.resolverDuplicadoLiquidacion(claimId, e.id, { resolucion: "EXCLUIDA", motivo: "" })
                      )
                    }
                  >
                    Sí, es repetido
                  </button>
                  {aceptaDuplicados && (
                    <button disabled={ocupado} className={btnMini} onClick={() => setPidiendo({ aceptar: e.id })}>
                      No lo es
                    </button>
                  )}
                </span>
              )}
            </li>
          ))}
          {pendientes.length > 0 && editableAqui && !aceptaDuplicados && (
            <li className="text-[11px] text-slate-500">Si no es un duplicado, lo tiene que decir un responsable.</li>
          )}
        </ul>
      )}

      {!excluida && (
        <div className="grid grid-cols-2 gap-2 md:grid-cols-6">
          <Campo etiqueta="Fecha">
            <input type="date" value={fecha} disabled={!editableAqui} onChange={(e) => setFecha(e.target.value)} className={inputCls} />
          </Campo>
          <Campo etiqueta="Establecimiento" ancho="md:col-span-2">
            <input value={emisor} disabled={!editableAqui} onChange={(e) => setEmisor(e.target.value)} className={inputCls} />
          </Campo>
          <Campo etiqueta="NIF">
            <input value={nif} disabled={!editableAqui} onChange={(e) => setNif(e.target.value)} className={inputCls} />
          </Campo>
          <Campo etiqueta="Nº ticket">
            <input value={numero} disabled={!editableAqui} onChange={(e) => setNumero(e.target.value)} className={inputCls} />
          </Campo>
          <Campo etiqueta="Importe">
            <input
              value={importe}
              disabled={!editableAqui}
              inputMode="decimal"
              placeholder="0,00"
              onChange={(e) => setImporte(e.target.value)}
              className={`${inputCls} text-right ${importeMal ? "border-rose-500" : ""}`}
            />
          </Campo>
          <Campo etiqueta="Concepto de gasto" ancho="md:col-span-2">
            <select
              value={conceptoId}
              disabled={!editableAqui}
              onChange={(e) => {
                setConceptoId(e.target.value ? Number(e.target.value) : "");
                // El centro de coste cuelga del concepto: cambiarlo lo invalida.
                setDestinoId("");
              }}
              className={inputCls}
            >
              <option value="">Elige…</option>
              {conceptos
                .filter((c) => c.activo || c.id === linea.expenseConceptId)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nombre}
                  </option>
                ))}
            </select>
          </Campo>
          {concepto?.tipoDestino === "CENTRO_COSTE" && (
            <Campo etiqueta="Centro de coste">
              <select
                value={destinoId}
                disabled={!editableAqui}
                onChange={(e) => setDestinoId(e.target.value ? Number(e.target.value) : "")}
                className={inputCls}
              >
                <option value="">Ninguno</option>
                {centros.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nombre}
                  </option>
                ))}
              </select>
            </Campo>
          )}
          <Campo etiqueta="Base (opcional)">
            <input value={base} disabled={!editableAqui} inputMode="decimal" onChange={(e) => setBase(e.target.value)} className={`${inputCls} text-right`} />
          </Campo>
          <Campo etiqueta="IVA (opcional)">
            <input value={iva} disabled={!editableAqui} inputMode="decimal" onChange={(e) => setIva(e.target.value)} className={`${inputCls} text-right`} />
          </Campo>
        </div>
      )}

      {editable && (
        <footer className="mt-2 flex flex-wrap items-center gap-2">
          {!excluida ? (
            <>
              <button
                disabled={ocupado || importeMal}
                className={btnPrimary}
                onClick={() => void onAccion(() => api.editarLineaLiquidacion(claimId, linea.id, cambios(true)))}
              >
                <CheckCircle2 className="mr-1 inline h-4 w-4" /> Guardar y dar por revisado
              </button>
              <button
                disabled={ocupado || importeMal}
                className={btnSecondary}
                onClick={() => void onAccion(() => api.editarLineaLiquidacion(claimId, linea.id, cambios()))}
              >
                Guardar
              </button>
              {lectura && (linea.analisis === "FALLIDO" || linea.analisis === "OMITIDO") && (
                <button
                  disabled={ocupado}
                  className={btnSecondary}
                  onClick={() => void onAccion(() => api.reintentarLecturaTicket(claimId, linea.id))}
                >
                  <RefreshCw className="mr-1 inline h-3.5 w-3.5" /> Volver a leer
                </button>
              )}
              <button disabled={ocupado} className={`${btnSecondary} ml-auto`} onClick={() => setPidiendo("EXCLUIR")}>
                No se paga…
              </button>
            </>
          ) : (
            <button
              disabled={ocupado}
              className={btnSecondary}
              onClick={() => void onAccion(() => api.incluirLineaLiquidacion(claimId, linea.id))}
            >
              Volver a incluir
            </button>
          )}
          {importeMal && <span className="text-[11px] text-rose-300">El importe no se entiende: escribe 12,50.</span>}
        </footer>
      )}

      {pidiendo && (
        <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg bg-slate-900/60 p-2">
          <input
            autoFocus
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            placeholder={pidiendo === "EXCLUIR" ? "Por qué no se paga (p. ej. copas)" : "Por qué no es un duplicado"}
            className={`${inputCls} flex-1`}
          />
          <button
            disabled={!motivo.trim() || ocupado}
            className={btnPrimary}
            onClick={() => {
              const p = pidiendo;
              setPidiendo(null);
              void onAccion(() =>
                p === "EXCLUIR"
                  ? api.excluirLineaLiquidacion(claimId, linea.id, motivo)
                  : api.resolverDuplicadoLiquidacion(claimId, p.aceptar, { resolucion: "ACEPTADA", motivo })
              );
            }}
          >
            Confirmar
          </button>
          <button className={btnSecondary} onClick={() => setPidiendo(null)}>
            Cancelar
          </button>
        </div>
      )}
    </article>
  );
}

function Campo({ etiqueta, ancho, children }: { etiqueta: string; ancho?: string; children: React.ReactNode }) {
  return (
    <label className={`flex flex-col gap-1 ${ancho ?? ""}`}>
      <span className="text-[10px] font-semibold uppercase text-slate-400">{etiqueta}</span>
      {children}
    </label>
  );
}

function PedirMotivo({
  titulo,
  explicacion,
  onCancelar,
  onConfirmar,
}: {
  titulo: string;
  explicacion: string;
  onCancelar: () => void;
  onConfirmar: (motivo: string) => void;
}) {
  const [motivo, setMotivo] = useState("");
  return (
    <Modal
      title={titulo}
      onClose={onCancelar}
      footer={
        <div className="flex justify-end gap-2">
          <button className={btnSecondary} onClick={onCancelar}>
            Cancelar
          </button>
          <button className={btnPrimary} disabled={!motivo.trim()} onClick={() => onConfirmar(motivo.trim())}>
            Confirmar
          </button>
        </div>
      }
    >
      <p className="mb-2 text-sm text-slate-300">{explicacion}</p>
      <textarea
        autoFocus
        rows={3}
        value={motivo}
        onChange={(e) => setMotivo(e.target.value)}
        placeholder="Motivo"
        className={inputCls}
      />
    </Modal>
  );
}

