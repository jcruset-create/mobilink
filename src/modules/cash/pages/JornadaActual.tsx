/**
 * Jornada actual: el panel de mando del mostrador.
 *
 * Cuando no hay jornada abierta, esta pantalla ES la apertura. Y la apertura no
 * pide un importe: pide (o hereda) la composición exacta de piezas, que es de
 * lo que va todo el módulo.
 */

import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { HandCoins, Banknote, ArrowLeftRight, ClipboardCheck, Lock, PlayCircle } from "lucide-react";
import { useCash } from "../contexts/CashContext";
import DenominationGrid, { type CantidadesPorValor, lineasDesde } from "../components/DenominationGrid";
import { Aviso, BotonAccion, Cabecera, Card, ErrorBox } from "../components/ui";
import { euros, totalLineas } from "../utils/money";
import { ETIQUETA_ESTADO_SESION, ETIQUETA_FORMA_PAGO } from "../types";
import type { FormaPagoConfig, Operacion, SeccionConfig } from "../types";
import { AvisoPendientes } from "./CambioBanco";
import * as api from "../services/api";

export default function JornadaActual() {
  const { jornada, cajaId, refrescar, puede, cajas } = useCash();
  const navigate = useNavigate();

  if (!cajaId) {
    return (
      <Aviso tono="aviso">
        No hay ninguna caja dada de alta, y sin caja no se puede abrir jornada.{" "}
        {puede("cash.configure") ? (
          <button onClick={() => navigate("/cash/configuracion")} className="underline">
            Crea la primera en Configuración.
          </button>
        ) : (
          "Pídele a un responsable que dé de alta una en Configuración."
        )}
      </Aviso>
    );
  }

  if (!jornada) return <Apertura cajaId={cajaId} />;

  const s = jornada.sesion;
  const caja = cajas.find((c) => c.id === s.registerId);

  return (
    <div className="space-y-3">
      <Cabecera
        titulo="Jornada actual"
        descripcion={`${caja ? `${caja.centro ? `${caja.centro} · ` : ""}${caja.nombre} · ` : ""}${s.fecha} · ${ETIQUETA_ESTADO_SESION[s.estado]}`}
      />

      {/* Accesos rápidos: lo que se pulsa cien veces al día, arriba y grande. */}
      <div className="flex flex-wrap gap-2">
        {puede("cash.collection.create_manual") && (
          <BotonAccion tono="cobro" icono={<HandCoins className="h-5 w-5" />} onClick={() => navigate("/cash/cobros")}>
            Cobrar
          </BotonAccion>
        )}
        {puede("cash.payment.create") && (
          <BotonAccion tono="pago" icono={<Banknote className="h-5 w-5" />} onClick={() => navigate("/cash/pagos")}>
            Pago / salida
          </BotonAccion>
        )}
        {puede("cash.movement.create") && (
          <BotonAccion icono={<ArrowLeftRight className="h-5 w-5" />} onClick={() => navigate("/cash/movimientos")}>
            Movimiento
          </BotonAccion>
        )}
        {puede("cash.count.create") && (
          <BotonAccion icono={<ClipboardCheck className="h-5 w-5" />} onClick={() => navigate("/cash/arqueo")}>
            Arqueo
          </BotonAccion>
        )}
        {puede("cash.close_session") && (
          <BotonAccion tono="cierre" icono={<Lock className="h-5 w-5" />} onClick={() => navigate("/cash/cierre")}>
            Cerrar caja
          </BotonAccion>
        )}
      </div>

      {/* Dinero que no está en el cajón y se espera de vuelta. Va arriba a
          propósito: si falta y no se ve, el arqueo parece un descuadre. */}
      <AvisoPendientes compacto />

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <Card title="Efectivo teórico" value={euros(jornada.totalStockCentimos)} hint={`${jornada.piezas} piezas`} accent="text-emerald-400" />
        <Card title="Fondo inicial" value={euros(s.fondoInicialCentimos)} hint={s.fondoInicialHeredado ? "Heredado del cierre anterior" : "Introducido a mano"} />
        <Card title="Cobros" value={euros(jornada.cobros.totalCentimos)} hint={`ERP ${euros(jornada.cobros.erpCentimos)} · manual ${euros(jornada.cobros.manualCentimos)}`} />
        <Card title="Pagos" value={euros(jornada.pagos.totalCentimos)} hint={`ERP ${euros(jornada.pagos.erpCentimos)} · manual ${euros(jornada.pagos.manualCentimos)}`} accent="text-amber-300" />
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <div className="rounded-lg border border-slate-700 bg-slate-800 p-3">
          <div className="mb-2 text-[11px] font-bold uppercase tracking-wide text-slate-400">
            Por forma de pago
          </div>
          {jornada.porFormaPago.length === 0 ? (
            <p className="text-sm text-slate-500">Todavía no hay cobros ni pagos registrados.</p>
          ) : (
            <div className="flex flex-col gap-1">
              {jornada.porFormaPago.map((f) => (
                <div key={f.forma} className="flex items-center justify-between rounded-lg bg-slate-900/60 px-3 py-1.5">
                  <span className="text-sm text-slate-300">{ETIQUETA_FORMA_PAGO[f.forma] ?? f.forma}</span>
                  <span className="text-sm font-bold tabular-nums text-slate-100">{euros(f.importeCentimos)}</span>
                </div>
              ))}
            </div>
          )}
          <p className="mt-2 text-[11px] text-slate-500">
            Solo el efectivo mueve el inventario físico; las tarjetas se registran económicamente.
          </p>

          {/*
            Reparto por sección. Va aquí debajo y no como una tarjeta más
            arriba porque es del mismo tipo de dato: un desglose de lo que ya
            está contado, no una cifra nueva.
          */}
          {jornada.porSeccion.length > 1 && (
            <div className="mt-3 border-t border-slate-700 pt-2">
              <div className="mb-1 text-[11px] font-bold uppercase tracking-wide text-slate-400">
                Por sección
              </div>
              <div className="flex flex-col gap-1">
                {jornada.porSeccion.map((sec) => (
                  <div
                    key={sec.sectionId ?? "sin"}
                    className="flex items-center justify-between rounded-lg bg-slate-900/60 px-3 py-1.5"
                  >
                    <span className="text-sm text-slate-300">
                      {sec.nombre}{" "}
                      <span className="text-[10px] text-slate-500">
                        ({sec.operaciones} oper.)
                      </span>
                    </span>
                    <span className="text-sm font-bold tabular-nums text-slate-100">
                      {euros(sec.cobrosCentimos)}
                    </span>
                  </div>
                ))}
              </div>
              <p className="mt-2 text-[11px] text-slate-500">
                Es un desglose informativo: el cajón es uno solo y el arqueo también. Este dinero
                no está separado físicamente.
              </p>
            </div>
          )}
        </div>

        <div className="rounded-lg border border-slate-700 bg-slate-800 p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Otros movimientos</span>
            <button onClick={() => void refrescar()} className="text-[11px] text-slate-400 hover:text-white">
              ↺ Actualizar
            </button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Card title="Salidas" value={euros(jornada.salidasCentimos)} />
            <Card title="Entregas" value={euros(jornada.entregasCentimos)} />
            <Card title="Operaciones" value={String(jornada.operaciones)} />
            <Card
              title="Pendientes de ERP"
              value={String(jornada.pendientesErp)}
              accent={jornada.pendientesErp > 0 ? "text-amber-300" : undefined}
            />
          </div>
        </div>
      </div>

      <DetalleDelDia sessionId={s.id} />
    </div>
  );
}

// ── Detalle del día ────────────────────────────────────────────────────────

/**
 * Lo cobrado y lo pagado del día, en dos listas enfrentadas.
 *
 * Las tarjetas de arriba dan totales, y un total no sirve para repasar el día:
 * cuando el arqueo no cuadra, o cuando hay que buscar una factura concreta,
 * hace falta ver operación por operación con qué se cobró. Eso es esto.
 *
 * Se piden aparte y no en el arranque porque son datos de una jornada
 * concreta, no de la configuración: si cambia la jornada, cambia la lista.
 */
function DetalleDelDia({ sessionId }: { sessionId: number }) {
  const { formasPago, secciones, puede, refrescar } = useCash();
  const [operaciones, setOperaciones] = useState<Operacion[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");

  const cargar = useCallback(async () => {
    setCargando(true);
    setError("");
    try {
      const r = await api.detalleJornada(sessionId);
      setOperaciones(r.operaciones);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se ha podido cargar el detalle del día");
    } finally {
      setCargando(false);
    }
  }, [sessionId]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  /*
   * Por orden de entrada, del primero al último. La consulta los devuelve al
   * revés —el histórico enseña lo último arriba— pero repasar un día se hace
   * como pasó, de la mañana a la tarde.
   */
  const enOrden = [...operaciones].filter((o) => o.estado !== "CANCELLED").sort((a, b) => a.id - b.id);
  const cobros = enOrden.filter((o) => o.tipo === "COLLECTION");
  const pagos = enOrden.filter((o) => o.tipo === "PAYMENT" || o.tipo === "MANUAL_OUT");

  /**
   * Cambia la sección de una operación.
   *
   * Se pinta el cambio en el acto y luego se recarga: en el mostrador, un
   * desplegable que tarda medio segundo en reflejar lo elegido se vuelve a
   * pulsar, y acabas con dos peticiones.
   */
  async function cambiarSeccion(operationId: number, sectionId: number | null) {
    setOperaciones((prev) =>
      prev.map((o) =>
        o.id === operationId
          ? { ...o, sectionId, seccionNombre: secciones.find((s) => s.id === sectionId)?.nombre ?? null }
          : o
      )
    );
    try {
      await api.cambiarSeccionOperacion(operationId, sectionId);
      // El reparto por sección de las tarjetas de arriba sale del resumen.
      await refrescar();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se ha podido cambiar la sección");
      await cargar();
    }
  }

  if (error) return <ErrorBox>{error}</ErrorBox>;

  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <ListaOperaciones
        titulo="Cobros del día"
        vacio="Todavía no hay ningún cobro registrado."
        operaciones={cobros}
        formasPago={formasPago}
        secciones={secciones}
        puedeReclasificar={puede("cash.configure")}
        onSeccion={cambiarSeccion}
        cargando={cargando}
        onActualizar={() => void cargar()}
      />
      <ListaOperaciones
        titulo="Pagos y salidas"
        vacio="Todavía no hay ningún pago ni salida."
        operaciones={pagos}
        formasPago={formasPago}
        secciones={secciones}
        puedeReclasificar={puede("cash.configure")}
        onSeccion={cambiarSeccion}
        cargando={cargando}
        onActualizar={() => void cargar()}
        tonoImporte="text-amber-300"
      />
    </div>
  );
}

function ListaOperaciones({
  titulo,
  vacio,
  operaciones,
  formasPago,
  secciones,
  puedeReclasificar,
  onSeccion,
  cargando,
  onActualizar,
  tonoImporte = "text-slate-100",
}: {
  titulo: string;
  vacio: string;
  operaciones: Operacion[];
  formasPago: FormaPagoConfig[];
  secciones: SeccionConfig[];
  puedeReclasificar: boolean;
  onSeccion: (operationId: number, sectionId: number | null) => void;
  cargando: boolean;
  onActualizar: () => void;
  tonoImporte?: string;
}) {
  const total = operaciones.reduce((a, o) => a + o.importeCentimos, 0);

  return (
    <div className="rounded-lg border border-slate-700 bg-slate-800">
      <div className="flex items-center justify-between border-b border-slate-700 px-3 py-2">
        <span className="text-[11px] font-bold uppercase tracking-wide text-slate-400">
          {titulo} <span className="text-slate-500">({operaciones.length})</span>
        </span>
        <div className="flex items-center gap-3">
          <span className={`text-sm font-bold tabular-nums ${tonoImporte}`}>{euros(total)}</span>
          <button onClick={onActualizar} className="text-[11px] text-slate-400 hover:text-white">
            ↺
          </button>
        </div>
      </div>

      {cargando && operaciones.length === 0 ? (
        <p className="px-3 py-4 text-sm text-slate-500">Cargando…</p>
      ) : operaciones.length === 0 ? (
        <p className="px-3 py-4 text-sm text-slate-500">{vacio}</p>
      ) : (
        <div className="divide-y divide-slate-700/60">
          {operaciones.map((o) => (
            <div key={o.id} className="flex items-start gap-2 px-3 py-2">
              <div className="min-w-0 flex-1">
                {/*
                  Arriba y grande, LA FACTURA. Es el dato con el que se busca:
                  el cliente muchas veces no se rellena —con cola delante nadie
                  teclea un nombre— y una lista de «Sin cliente» repetido no
                  sirve para encontrar nada. El nombre baja a la segunda línea,
                  donde suma cuando está y no estorba cuando falta.
                */}
                <div className="truncate text-sm font-medium tabular-nums text-slate-200">
                  {o.referencia || o.concepto || "Sin factura"}
                </div>
                <div className="mt-0.5 flex flex-wrap items-center gap-1 text-[10px] text-slate-500">
                  <span className="tabular-nums">{hora(o.createdAtMs)}</span>
                  <span>·</span>
                  <span className="tabular-nums">{o.numero}</span>
                  {o.partyNombre && (
                    <>
                      <span>·</span>
                      <span className="truncate">{o.partyNombre}</span>
                    </>
                  )}
                  {/*
                    La sección, editable en el sitio. Reclasificar es corregir
                    un despiste de mostrador —se cobró gasolinera con el taller
                    puesto— y obligar a irse a otra pantalla para eso garantiza
                    que no se corrija nunca. No mueve dinero, solo a qué
                    negocio se imputa, y queda auditado.
                  */}
                  {puedeReclasificar && secciones.length > 0 ? (
                    <select
                      value={o.sectionId ?? ""}
                      onChange={(e) =>
                        onSeccion(o.id, e.target.value === "" ? null : Number(e.target.value))
                      }
                      aria-label={`Sección de ${o.numero}`}
                      title="Cambiar la sección"
                      className={`rounded border-0 px-1 py-px text-[9px] font-bold uppercase tracking-wide outline-none focus:ring-1 focus:ring-sky-500 ${
                        o.sectionId == null
                          ? "bg-amber-500/20 text-amber-300"
                          : "bg-slate-700/60 text-slate-300"
                      }`}
                    >
                      <option value="">Sin sección</option>
                      {secciones.map((sec) => (
                        <option key={sec.id} value={sec.id}>
                          {sec.nombre}
                        </option>
                      ))}
                    </select>
                  ) : (
                    o.seccionNombre && (
                      <span className="rounded bg-slate-700/60 px-1.5 py-px text-[9px] font-bold uppercase tracking-wide text-slate-300">
                        {o.seccionNombre}
                      </span>
                    )
                  )}
                </div>

                {/* Con qué se cobró. Un mixto trae varias, y verlas es justo el
                    motivo de esta lista: el total de arriba no lo cuenta. */}
                <div className="mt-1 flex flex-wrap items-center gap-1">
                  {o.formas.map((f, i) => (
                    <Etiqueta
                      key={`${f.forma}-${i}`}
                      codigo={f.forma}
                      importe={o.formas.length > 1 ? f.importe : null}
                      formasPago={formasPago}
                    />
                  ))}
                </div>
              </div>

              <span className={`shrink-0 text-sm font-bold tabular-nums ${tonoImporte}`}>
                {euros(o.importeCentimos)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * La forma de pago, con su imagen si la tiene.
 *
 * Misma imagen que el botón con el que se cobró: reconocer «CaixaBank» de un
 * vistazo en una lista de treinta líneas es más rápido leyendo el logotipo que
 * el texto, que es la razón de haberlas subido.
 */
function Etiqueta({
  codigo,
  importe,
  formasPago,
}: {
  codigo: string;
  importe: number | null;
  formasPago: FormaPagoConfig[];
}) {
  const forma = formasPago.find((f) => f.codigo === codigo);
  const nombre = forma?.nombre ?? ETIQUETA_FORMA_PAGO[codigo] ?? codigo;

  return (
    <span
      title={nombre}
      className="inline-flex items-center gap-1 rounded bg-slate-900/70 px-1.5 py-0.5 text-[10px] text-slate-300"
    >
      {forma?.imagenUrl ? (
        <img src={forma.imagenUrl} alt={nombre} className="h-4 w-6 rounded-[2px] object-cover" />
      ) : null}
      <span>{nombre}</span>
      {importe != null && <span className="tabular-nums text-slate-400">{euros(importe)}</span>}
    </span>
  );
}

/** La hora del reloj, que es como se busca una operación al repasar el día. */
function hora(ms: number): string {
  return new Date(ms).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
}

// ── Apertura ───────────────────────────────────────────────────────────────

/** Hoy en `YYYY-MM-DD` y en hora local: `toISOString` daría el día de ayer de madrugada. */
function hoyLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function Apertura({ cajaId }: { cajaId: number }) {
  const { denominaciones, refrescar, puede } = useCash();
  const [cantidades, setCantidades] = useState<CantidadesPorValor>({});
  const [cartuchos, setCartuchos] = useState<CantidadesPorValor>({});
  const [notas, setNotas] = useState("");
  const [fecha, setFecha] = useState(hoyLocal());
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");
  /** Guarda el "abrir igualmente" cuando el día ya tiene jornada. */
  const [repetirFecha, setRepetirFecha] = useState(false);

  const hoy = hoyLocal();
  const atrasada = fecha !== "" && fecha < hoy;

  const lineas = lineasDesde(cantidades);
  const lineasCartuchos = lineasDesde(cartuchos);
  // Un tubo de 1 € son 25 monedas: el fondo inicial no cuadraría si se contara
  // como una pieza suelta.
  const piezasPorCartucho = new Map(
    denominaciones.filter((d) => d.piezasPorCartucho).map((d) => [d.valor, d.piezasPorCartucho as number])
  );
  const totalCartuchos = lineasCartuchos.reduce(
    (a, l) => a + l.cantidad * (piezasPorCartucho.get(l.valor) ?? 0) * l.valor,
    0
  );
  const total = totalLineas(lineas) + totalCartuchos;

  if (!puede("cash.open_session")) {
    return <Aviso tono="aviso">La caja está cerrada y no tienes permiso para abrirla.</Aviso>;
  }

  async function abrir(heredar: boolean) {
    setGuardando(true);
    setError("");
    try {
      // Sin composición manual, el servidor hereda la del cierre anterior. Con
      // composición, se toma la indicada y queda auditado como corrección.
      await api.abrirJornada({
        registerId: cajaId,
        fondoManual: heredar ? [] : lineas,
        fondoCartuchos: heredar ? [] : lineasCartuchos,
        fecha: fecha || undefined,
        permitirFechaRepetida: repetirFecha || undefined,
        notas: notas || undefined,
      });
      await refrescar();
    } catch (e) {
      // Un día que ya tiene jornada no es un error de teclado: se ofrece
      // confirmarlo en vez de dejar al usuario adivinando.
      if (e instanceof api.ErrorApiCaja && e.codigo === "FECHA_YA_TIENE_JORNADA") {
        setRepetirFecha(true);
      }
      setError(e instanceof Error ? e.message : "No se ha podido abrir la caja");
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="space-y-3">
      <Cabecera
        titulo="Abrir caja"
        descripcion="El fondo inicial no es un importe: es la composición exacta de billetes y monedas."
      />

      {error && <ErrorBox>{error}</ErrorBox>}

      <Aviso tono="info">
        Si la caja se cerró antes, puedes heredar el cambio final del día anterior con su
        composición exacta. Indica las piezas a mano solo si es la primera jornada o si hay que
        corregir el fondo: esa corrección queda auditada.
      </Aviso>

      <label className="block max-w-xs">
        <span className="mb-1 block text-[10px] font-semibold uppercase text-slate-400">
          Fecha de la jornada
        </span>
        <input
          type="date"
          value={fecha}
          max={hoy}
          onChange={(e) => {
            setFecha(e.target.value);
            // Otra fecha, otra decisión: la confirmación no se arrastra.
            setRepetirFecha(false);
            setError("");
          }}
          disabled={guardando}
          className="w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:ring-2 focus:ring-sky-500"
        />
      </label>

      {atrasada && (
        <Aviso tono="aviso">
          Vas a abrir una jornada del <strong>{fecha.split("-").reverse().join("/")}</strong>, no de
          hoy. Los cobros y pagos que metas contarán como de ese día. Mete los días atrasados en
          orden, de más antiguo a más reciente, para que el cambio pase de uno al siguiente igual
          que pasó en el mostrador.
        </Aviso>
      )}

      {repetirFecha && (
        <Aviso tono="aviso">
          Esa caja ya tiene una jornada ese día. Comprueba que no la metiste ya; si de verdad
          quieres una segunda, vuelve a pulsar el botón de abrir y se creará.
        </Aviso>
      )}

      <div className="flex flex-wrap gap-2">
        <BotonAccion tono="cierre" icono={<PlayCircle className="h-5 w-5" />} onClick={() => void abrir(true)} disabled={guardando}>
          {guardando ? "Abriendo…" : "Abrir heredando el cambio anterior"}
        </BotonAccion>
        <BotonAccion onClick={() => void abrir(false)} disabled={guardando || total === 0}>
          Abrir con el fondo indicado ({euros(total)})
        </BotonAccion>
      </div>

      <DenominationGrid
        titulo="Fondo inicial contado a mano"
        denominaciones={denominaciones}
        cantidades={cantidades}
        onChange={setCantidades}
        cartuchos={cartuchos}
        onCartuchosChange={setCartuchos}
        deshabilitado={guardando}
      />

      <label className="block">
        <span className="mb-1 block text-[10px] font-semibold uppercase text-slate-400">
          Notas de apertura
        </span>
        <input
          value={notas}
          onChange={(e) => setNotas(e.target.value)}
          placeholder="Opcional"
          className="w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:ring-2 focus:ring-sky-500"
        />
      </label>
    </div>
  );
}
