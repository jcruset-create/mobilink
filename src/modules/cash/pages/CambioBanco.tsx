/**
 * Cambio del banco.
 *
 * El problema del mostrador: se acumulan billetes y se acaba la calderilla.
 * Alguien coge 200 € y va al banco. Entre que sale y vuelve pasan horas o días,
 * y ese hueco es lo que aquí se representa: el dinero **sale de la caja al
 * crear el pedido** y entra al recibirlo, así que el arqueo de la tarde cuadra
 * sin que nadie tenga que acordarse de nada.
 *
 * La propuesta de qué pedir no la inventa nadie: sale del consumo real de las
 * últimas jornadas, que el libro mayor registra moneda a moneda. Cada línea
 * viene con su porqué porque una propuesta que no se entiende no se corrige,
 * se ignora.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Landmark, Printer, RefreshCw } from "lucide-react";
import { useCash } from "../contexts/CashContext";
import {
  Aviso,
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
import type { Denominacion, PedidoCambio, Pendientes, PropuestaPedido } from "../types";
import {
  filasDeCambio,
  lineasDeFila,
  importeDeFila,
  piezasDeFormato,
  type Formato,
  type FilaCambio,
} from "../utils/cambio";
import * as api from "../services/api";

const etiquetaDe = (valor: number) =>
  valor >= 100 ? `${valor / 100} €` : `${valor} c`;

/** Las líneas de la propuesta, en la forma que espera `filasDeCambio`. */
const aConocidas = (lineas: readonly { valor: number; piezas: number; cartuchos: number; bolsas?: number; motivo: string }[]) =>
  lineas.map((l) => ({
    valor: l.valor,
    cantidad: l.piezas,
    cartuchos: l.cartuchos,
    bolsas: l.bolsas ?? 0,
    motivo: l.motivo,
  }));

/**
 * Una casilla de la rejilla de pedido: un formato de una denominación.
 *
 * Cuando esa denominación no viene en ese formato —una bolsa de billetes de
 * 10 €— la casilla no se pinta vacía sino con una raya: un hueco donde se puede
 * escribir invita a pedir algo que el banco no sirve.
 */
function Casilla({
  fila,
  formato,
  valor,
  onChange,
}: {
  fila: FilaCambio;
  formato: Formato;
  valor: string | undefined;
  onChange: (texto: string) => void;
}) {
  const piezas = piezasDeFormato(fila, formato);
  if (piezas <= 0) {
    return <td className={`${tdCls} text-center text-slate-600`}>—</td>;
  }

  return (
    <td className={`${tdCls} text-center`}>
      <input
        type="number"
        min={0}
        value={valor ?? ""}
        placeholder="0"
        aria-label={`${formato} de ${etiquetaDe(fila.valor)}`}
        onChange={(e) => onChange(e.target.value)}
        className={`${inputCls} w-20 text-right tabular-nums`}
      />
      {formato !== "sueltas" && (
        <div className="mt-0.5 text-[10px] text-slate-500">de {piezas}</div>
      )}
    </td>
  );
}

export default function CambioBanco() {
  const { jornada, cajaId, refrescar, puede, denominaciones } = useCash();

  const [pedidos, setPedidos] = useState<PedidoCambio[]>([]);
  const [importeTexto, setImporteTexto] = useState("200,00");
  const [propuesta, setPropuesta] = useState<PropuestaPedido | null>(null);
  /** Lo tecleado, por valor y formato: `ajustes[100].cartuchos === "2"`. */
  const [ajustes, setAjustes] = useState<Record<number, Partial<Record<Formato, string>>>>({});
  /** Hoja de la propuesta, antes de sacar el dinero. */
  const [propuestaImpresa, setPropuestaImpresa] = useState(false);
  const [error, setError] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [pedidoImpreso, setPedidoImpreso] = useState<PedidoCambio | null>(null);
  const [pedidoInforme, setPedidoInforme] = useState<PedidoCambio | null>(null);

  const importe = aCentimos(importeTexto) ?? 0;
  const gestiona = puede("cash.treasury.manage");

  const cargar = useCallback(async () => {
    if (!cajaId) return;
    try {
      const r = await api.tesoreria(cajaId);
      setPedidos(r.pedidos);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error cargando los pedidos");
    }
  }, [cajaId]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const pendientes = useMemo(() => pedidos.filter((p) => p.estado === "PENDIENTE"), [pedidos]);

  async function accion(fn: () => Promise<unknown>) {
    setOcupado(true);
    setError("");
    try {
      await fn();
      await cargar();
      await refrescar();
    } catch (e) {
      setError(e instanceof Error ? e.message : "La acción ha fallado");
    } finally {
      setOcupado(false);
    }
  }

  async function pedirPropuesta() {
    if (!jornada || importe <= 0) return;
    setError("");
    try {
      const p = await api.proponerPedidoCambio(jornada.sesion.id, importe);
      setPropuesta(p);
      // Las que el cálculo no propone quedan a cero, pero siguen en pantalla.
      setAjustes(
        Object.fromEntries(
          filasDeCambio(denominaciones, aConocidas(p.lineas)).map((f) => [
            f.valor,
            {
              sueltas: f.cantidades.sueltas > 0 ? String(f.cantidades.sueltas) : "",
              cartuchos: f.cantidades.cartuchos > 0 ? String(f.cantidades.cartuchos) : "",
              bolsas: f.cantidades.bolsas > 0 ? String(f.cantidades.bolsas) : "",
            },
          ])
        )
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se ha podido calcular la propuesta");
    }
  }

  /** Todas las denominaciones de cambio, con lo propuesto donde lo haya. */
  const filas = useMemo(
    () => filasDeCambio(denominaciones, aConocidas(propuesta?.lineas ?? [])),
    [denominaciones, propuesta]
  );

  /** Lo que finalmente se le pide al banco, con los ajustes del cajero. */
  const solicitado = useMemo(
    () => filas.flatMap((f) => lineasDeFila(f, ajustes[f.valor] ?? {})),
    [filas, ajustes]
  );

  /** Cambia una casilla sin pisar los otros dos formatos de la misma fila. */
  function fijar(valor: number, formato: Formato, texto: string) {
    setAjustes((prev) => ({ ...prev, [valor]: { ...prev[valor], [formato]: texto } }));
  }

  const totalSolicitado = solicitado.reduce((a, l) => a + l.cantidad * l.valor, 0);

  if (!jornada) {
    return <Aviso tono="aviso">No hay ninguna jornada abierta. Ábrela desde «Jornada actual».</Aviso>;
  }

  return (
    <div className="space-y-3">
      <Cabecera
        titulo="Cambio del banco"
        descripcion="Cambiar billetes grandes por calderilla, sin perder de vista el dinero mientras está fuera."
      />

      {error && <ErrorBox>{error}</ErrorBox>}

      {pendientes.length > 0 && (
        <Aviso tono="info">
          Hay {pendientes.length === 1 ? "un pedido" : `${pendientes.length} pedidos`} en el banco
          por {euros(pendientes.reduce((a, p) => a + p.importeCentimos, 0))}. Ese dinero ya no
          cuenta en la caja: cuando llegue, valídalo aquí abajo.
        </Aviso>
      )}

      {/* ── Pedidos pendientes ────────────────────────────────────────────── */}
      {pendientes.map((p) => (
        <PedidoPendiente
          key={p.id}
          pedido={p}
          sessionId={jornada.sesion.id}
          gestiona={gestiona}
          ocupado={ocupado}
          onAccion={accion}
          onImprimir={() => setPedidoImpreso(p)}
        />
      ))}

      {/* ── Pedido nuevo ──────────────────────────────────────────────────── */}
      {gestiona && (
        <div className="rounded-lg border border-slate-700 bg-slate-800 p-3">
          <div className="mb-2 text-[11px] font-bold uppercase tracking-wide text-slate-400">
            Necesito cambio
          </div>

          <div className="flex flex-wrap items-end gap-2">
            <label className="block">
              <span className="mb-1 block text-[10px] font-semibold uppercase text-slate-400">
                Importe a cambiar
              </span>
              <input
                value={importeTexto}
                onChange={(e) => setImporteTexto(e.target.value)}
                inputMode="decimal"
                className={`${inputCls} w-32 text-lg font-bold tabular-nums`}
              />
            </label>
            <button
              onClick={() => void pedirPropuesta()}
              disabled={importe <= 0 || ocupado}
              className="flex items-center gap-1 rounded-lg bg-slate-700 px-3 py-2 text-[12px] font-medium text-slate-200 hover:bg-slate-600 disabled:opacity-50"
            >
              <RefreshCw className="h-3.5 w-3.5" /> Calcular qué me hace falta
            </button>
          </div>

          {propuesta && (
            <div className="mt-3 space-y-2">
              {propuesta.aviso && <Aviso tono="aviso">{propuesta.aviso}</Aviso>}
              {!propuesta.salidaPosible && (
                <Aviso tono="mal">
                  No se puede componer ese importe con los billetes que hay en caja. Prueba con otra
                  cantidad.
                </Aviso>
              )}

              <TableWrap>
                <thead>
                  <tr>
                    <th className={thCls}>Pedir</th>
                    <th className={`${thCls} text-center`}>Unidades</th>
                    <th className={`${thCls} text-center`}>Cartuchos</th>
                    <th className={`${thCls} text-center`}>Bolsas</th>
                    <th className={`${thCls} text-right`}>Importe</th>
                    <th className={thCls}>Por qué</th>
                  </tr>
                </thead>
                <tbody>
                  {filas.length === 0 && (
                    <EmptyRow cols={6} text="No hay denominaciones de cambio activas." />
                  )}
                  {/*
                    Todas las denominaciones, propuestas o no. Las que el
                    cálculo no necesita salen vacías: están para poder pedir a
                    mano lo que uno sabe que va a hacer falta.
                  */}
                  {filas.map((f) => {
                    const tecleado = ajustes[f.valor] ?? {};
                    const importeFila = importeDeFila(f, tecleado);
                    return (
                      <tr key={f.valor} className={importeFila > 0 ? "" : "opacity-60"}>
                        <td className={`${tdCls} font-bold text-slate-100`}>{etiquetaDe(f.valor)}</td>
                        <Casilla
                          fila={f}
                          formato="sueltas"
                          valor={tecleado.sueltas}
                          onChange={(v) => fijar(f.valor, "sueltas", v)}
                        />
                        <Casilla
                          fila={f}
                          formato="cartuchos"
                          valor={tecleado.cartuchos}
                          onChange={(v) => fijar(f.valor, "cartuchos", v)}
                        />
                        <Casilla
                          fila={f}
                          formato="bolsas"
                          valor={tecleado.bolsas}
                          onChange={(v) => fijar(f.valor, "bolsas", v)}
                        />
                        <td className={`${tdCls} text-right tabular-nums text-slate-300`}>
                          {euros(importeFila)}
                        </td>
                        <td className={`${tdCls} text-[11px] text-slate-400`}>{f.motivo ?? ""}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </TableWrap>

              <p className="text-[11px] text-slate-500">
                «Unidades» son monedas o billetes sueltos; «cartuchos» y «bolsas», precintos
                enteros. Se pueden pedir a la vez —tres cartuchos y ocho monedas sueltas— porque el
                banco no siempre sirve lo que uno pediría. Las bolsas solo salen en las monedas que
                las tengan configuradas.
              </p>

              <div className="flex flex-wrap items-center justify-between gap-2">
                <span
                  className={`text-[12px] ${
                    totalSolicitado > importe ? "text-amber-300" : "text-slate-400"
                  }`}
                >
                  Se pide {euros(totalSolicitado)} de los {euros(importe)} que se cambian
                  {totalSolicitado < importe && (
                    <> · el resto vendrá en lo que el banco tenga</>
                  )}
                </span>

                {/*
                  Imprimir ANTES de sacar el dinero. La hoja se lleva al banco
                  para que den exactamente esto; esperar a confirmar el pedido
                  obligaba a sacar el dinero de la caja para poder imprimirla.
                */}
                <button
                  onClick={() => setPropuestaImpresa(true)}
                  disabled={solicitado.length === 0}
                  className="flex items-center gap-1 rounded-lg bg-slate-700 px-3 py-1.5 text-[12px] font-medium text-slate-200 hover:bg-slate-600 disabled:opacity-50"
                >
                  <Printer className="h-3.5 w-3.5" /> Imprimir para el banco
                </button>
              </div>

              <BotonAccion
                tono="cierre"
                icono={<Landmark className="h-5 w-5" />}
                onClick={() =>
                  void accion(async () => {
                    await api.crearPedidoCambio({
                      sessionId: jornada.sesion.id,
                      importeCentimos: importe,
                      solicitado,
                    });
                    setPropuesta(null);
                    setAjustes({});
                  })
                }
                disabled={ocupado || importe <= 0 || !propuesta.salidaPosible}
              >
                {ocupado ? "Sacando el dinero…" : `Sacar ${euros(importe)} e ir al banco`}
              </BotonAccion>

              <p className="text-[11px] text-slate-500">
                Al confirmar, los {euros(importe)} salen de la caja con su composición exacta de
                billetes y el pedido queda pendiente. Puedes cerrar la jornada con él abierto: el
                banco no siempre contesta el mismo día.
              </p>
            </div>
          )}
        </div>
      )}

      {/* ── Histórico ─────────────────────────────────────────────────────── */}
      <section className="space-y-2">
        <h2 className="text-[11px] font-bold uppercase tracking-wide text-slate-400">
          Pedidos anteriores
        </h2>
        <TableWrap>
          <thead>
            <tr>
              <th className={thCls}>Número</th>
              <th className={`${thCls} text-right`}>Salió</th>
              <th className={`${thCls} text-right`}>Volvió</th>
              <th className={thCls}>Estado</th>
              <th className={thCls}>Observaciones</th>
              <th className={`${thCls} text-right`}>Detalle</th>
            </tr>
          </thead>
          <tbody>
            {pedidos.length === 0 && <EmptyRow cols={6} text="Todavía no se ha pedido cambio." />}
            {pedidos
              .filter((p) => p.estado !== "PENDIENTE")
              .map((p) => (
                <tr key={p.id}>
                  <td className={`${tdCls} font-mono text-[11px] text-slate-300`}>{p.numero}</td>
                  <td className={`${tdCls} text-right tabular-nums`}>{euros(p.importeCentimos)}</td>
                  <td className={`${tdCls} text-right tabular-nums`}>
                    {p.importeRecibidoCentimos == null ? "—" : euros(p.importeRecibidoCentimos)}
                  </td>
                  <td className={tdCls}>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                        p.estado === "RECIBIDO"
                          ? "bg-emerald-500/20 text-emerald-300"
                          : "bg-slate-700 text-slate-400"
                      }`}
                    >
                      {p.estado === "RECIBIDO" ? "Recibido" : "Cancelado"}
                    </span>
                  </td>
                  <td className={`${tdCls} text-[11px] text-slate-400`}>
                    {p.diferenciaMotivo ?? "—"}
                  </td>
                  <td className={`${tdCls} text-right`}>
                    {/*
                      El importe que salió y el que volvió ya están en la fila;
                      lo que falta es EN QUÉ piezas, que es lo que se compara
                      contra la bolsa que trae el que ha ido al banco.
                    */}
                    <button
                      onClick={() => setPedidoInforme(p)}
                      className="rounded-lg bg-slate-700 px-2.5 py-1 text-[11px] font-medium text-slate-100 hover:bg-slate-600"
                    >
                      Ver informe
                    </button>
                  </td>
                </tr>
              ))}
          </tbody>
        </TableWrap>
      </section>

      {pedidoInforme && (
        <InformeCambio
          pedido={pedidoInforme}
          denominaciones={denominaciones}
          onCerrar={() => setPedidoInforme(null)}
        />
      )}

      {pedidoImpreso && (
        <HojaBanco
          titulo="Petición de cambio"
          referencia={pedidoImpreso.numero}
          lineas={pedidoImpreso.solicitado}
          totalCentimos={pedidoImpreso.importeCentimos}
          denominaciones={denominaciones}
          onCerrar={() => setPedidoImpreso(null)}
        />
      )}

      {propuestaImpresa && (
        <HojaBanco
          titulo="Cambio que necesitamos"
          referencia="Todavía sin número: el pedido no se ha confirmado"
          lineas={solicitado}
          totalCentimos={importe}
          denominaciones={denominaciones}
          onCerrar={() => setPropuestaImpresa(false)}
        />
      )}
    </div>
  );
}

// ── Un pedido pendiente, con su recepción ──────────────────────────────────

function PedidoPendiente({
  pedido,
  sessionId,
  gestiona,
  ocupado,
  onAccion,
  onImprimir,
}: {
  pedido: PedidoCambio;
  sessionId: number;
  gestiona: boolean;
  ocupado: boolean;
  onAccion: (fn: () => Promise<unknown>) => Promise<void>;
  onImprimir: () => void;
}) {
  const { denominaciones } = useCash();

  // Se arranca de lo pedido: lo normal es que el banco dé justo eso, y así el
  // cajero solo corrige lo que venga distinto.
  const [recibido, setRecibido] = useState<Record<number, Partial<Record<Formato, string>>>>(() =>
    Object.fromEntries(
      filasDeCambio(denominaciones, pedido.solicitado).map((f) => [
        f.valor,
        {
          sueltas: f.cantidades.sueltas > 0 ? String(f.cantidades.sueltas) : "",
          cartuchos: f.cantidades.cartuchos > 0 ? String(f.cantidades.cartuchos) : "",
          bolsas: f.cantidades.bolsas > 0 ? String(f.cantidades.bolsas) : "",
        },
      ])
    )
  );
  const [motivo, setMotivo] = useState("");
  const [motivoCancelar, setMotivoCancelar] = useState("");
  const [cancelando, setCancelando] = useState(false);

  /*
   * Todas las denominaciones, no solo las pedidas. El banco no siempre trae lo
   * que se le pide —se queda sin tubos de 20 c y compensa con los de 10— y sin
   * una casilla para lo que no se pidió, ese dinero no se podía registrar.
   */
  const filas = filasDeCambio(denominaciones, pedido.solicitado);

  const lineas = filas.flatMap((f) => lineasDeFila(f, recibido[f.valor] ?? {}));

  const total = lineas.reduce((a, l) => a + l.cantidad * l.valor, 0);

  const fijar = (valor: number, formato: Formato, texto: string) =>
    setRecibido((prev) => ({ ...prev, [valor]: { ...prev[valor], [formato]: texto } }));
  const cuadra = total === pedido.importeCentimos;

  return (
    <div className="rounded-lg border border-sky-500/40 bg-sky-500/5 p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div>
          <span className="font-mono text-[11px] text-slate-400">{pedido.numero}</span>
          <div className="text-lg font-black tabular-nums text-sky-300">
            {euros(pedido.importeCentimos)} en el banco
          </div>
        </div>
        <button
          onClick={onImprimir}
          className="flex items-center gap-1 rounded-lg bg-slate-700 px-3 py-1.5 text-[12px] font-medium text-slate-200 hover:bg-slate-600"
        >
          <Printer className="h-3.5 w-3.5" /> Hoja para el banco
        </button>
      </div>

      {gestiona && (
        <>
          <div className="text-[11px] font-bold uppercase tracking-wide text-slate-400">
            Cuenta lo que ha traído el banco
          </div>
          <div className="mt-1">
            <TableWrap>
              <thead>
                <tr>
                  <th className={thCls}>Denominación</th>
                  <th className={`${thCls} text-center`}>Unidades</th>
                  <th className={`${thCls} text-center`}>Cartuchos</th>
                  <th className={`${thCls} text-center`}>Bolsas</th>
                  <th className={`${thCls} text-right`}>Importe</th>
                </tr>
              </thead>
              <tbody>
                {filas.map((f) => {
                  const tecleado = recibido[f.valor] ?? {};
                  const importeFila = importeDeFila(f, tecleado);
                  return (
                    <tr key={f.valor} className={importeFila > 0 ? "" : "opacity-60"}>
                      <td className={`${tdCls} font-bold text-slate-100`}>{etiquetaDe(f.valor)}</td>
                      <Casilla
                        fila={f}
                        formato="sueltas"
                        valor={tecleado.sueltas}
                        onChange={(v) => fijar(f.valor, "sueltas", v)}
                      />
                      <Casilla
                        fila={f}
                        formato="cartuchos"
                        valor={tecleado.cartuchos}
                        onChange={(v) => fijar(f.valor, "cartuchos", v)}
                      />
                      <Casilla
                        fila={f}
                        formato="bolsas"
                        valor={tecleado.bolsas}
                        onChange={(v) => fijar(f.valor, "bolsas", v)}
                      />
                      <td className={`${tdCls} text-right tabular-nums text-slate-300`}>
                        {euros(importeFila)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </TableWrap>
          </div>

          <div className="mt-2 flex flex-wrap items-baseline justify-between gap-2">
            <span className="text-[11px] uppercase tracking-wide text-slate-400">Suma</span>
            <span
              className={`text-xl font-black tabular-nums ${
                cuadra ? "text-emerald-400" : "text-amber-300"
              }`}
            >
              {euros(total)}
            </span>
          </div>

          {!cuadra && (
            <label className="mt-2 block">
              <span className="mb-1 block text-[10px] font-semibold uppercase text-amber-300">
                Salieron {euros(pedido.importeCentimos)} y vuelven {euros(total)}: explica la
                diferencia
              </span>
              <input
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
                placeholder="El banco no tenía suelto suficiente"
                className={inputCls}
              />
            </label>
          )}

          <div className="mt-2 flex flex-wrap gap-2">
            <BotonAccion
              tono="cobro"
              onClick={() =>
                void onAccion(() =>
                  api.recibirPedidoCambio(pedido.id, {
                    sessionId,
                    recibido: lineas,
                    diferenciaMotivo: motivo || undefined,
                  })
                )
              }
              disabled={ocupado || total <= 0 || (!cuadra && !motivo.trim())}
            >
              Entrar el cambio en la caja
            </BotonAccion>

            {!cancelando ? (
              <button
                onClick={() => setCancelando(true)}
                className="rounded-lg bg-slate-700 px-3 py-1.5 text-[12px] font-medium text-slate-300 hover:bg-slate-600"
              >
                No he ido al banco
              </button>
            ) : (
              <div className="flex flex-wrap items-end gap-2">
                <input
                  value={motivoCancelar}
                  onChange={(e) => setMotivoCancelar(e.target.value)}
                  placeholder="Por qué se cancela"
                  className={inputCls}
                />
                <button
                  onClick={() =>
                    void onAccion(() =>
                      api.cancelarPedidoCambio(pedido.id, sessionId, motivoCancelar)
                    )
                  }
                  disabled={ocupado || !motivoCancelar.trim()}
                  className="rounded-lg bg-amber-600 px-3 py-1.5 text-[12px] font-bold text-white hover:bg-amber-500 disabled:opacity-50"
                >
                  Devolver el dinero a la caja
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ── Piezas de un cambio, en pantalla ───────────────────────────────────────

type LineaCambio = { valor: number; cantidad: number; cartuchos: number; bolsas?: number };

/** «3 cartuchos de 25» o «12 sueltas»: cómo se pide en la ventanilla. */
function comoSePide(l: LineaCambio, denominaciones: readonly Denominacion[]): string {
  const d = denominaciones.find((x) => x.valor === l.valor);
  if (l.cartuchos > 0) {
    return `${l.cartuchos} ${l.cartuchos === 1 ? "cartucho" : "cartuchos"} de ${d?.piezasPorCartucho ?? "?"}`;
  }
  if (l.bolsas && l.bolsas > 0) {
    return `${l.bolsas} ${l.bolsas === 1 ? "bolsa" : "bolsas"} de ${d?.piezasPorBolsa ?? "?"}`;
  }
  return `${l.cantidad} ${l.cantidad === 1 ? "suelta" : "sueltas"}`;
}

const sumaDe = (lineas: readonly LineaCambio[]) =>
  lineas.reduce((a, l) => a + l.valor * l.cantidad, 0);

/**
 * Una de las tres patas del informe: lo que salió, lo que se pidió, lo que
 * volvió. Las tres se leen igual porque son la misma pregunta —qué piezas y
 * cuánto suman— hecha en tres momentos distintos.
 */
function TablaCambio({
  lineas,
  denominaciones,
  vacio,
}: {
  lineas: readonly LineaCambio[];
  denominaciones: readonly Denominacion[];
  vacio: string;
}) {
  if (lineas.length === 0) {
    return <p className="py-1 text-sm italic text-slate-500">{vacio}</p>;
  }
  return (
    <table className="w-full border-collapse text-sm">
      <thead>
        <tr className="border-b border-slate-300 text-[11px] uppercase tracking-wide text-slate-500">
          <th className="py-1 text-left font-bold">Denominación</th>
          <th className="py-1 text-right font-bold">Cómo viene</th>
          <th className="py-1 text-right font-bold">Piezas</th>
          <th className="py-1 text-right font-bold">Importe</th>
        </tr>
      </thead>
      <tbody>
        {lineas.map((l, i) => (
          <tr key={`${l.valor}-${i}`} className="border-b border-slate-200">
            <td className="py-1">{etiquetaDe(l.valor)}</td>
            <td className="py-1 text-right">{comoSePide(l, denominaciones)}</td>
            <td className="py-1 text-right tabular-nums">{l.cantidad}</td>
            <td className="py-1 text-right tabular-nums">{euros(l.valor * l.cantidad)}</td>
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr>
          <td className="py-1.5 font-bold" colSpan={3}>
            Total
          </td>
          <td className="py-1.5 text-right font-black tabular-nums">{euros(sumaDe(lineas))}</td>
        </tr>
      </tfoot>
    </table>
  );
}

// ── Informe del cambio ─────────────────────────────────────────────────────

/**
 * Qué salió de la caja y qué volvió del banco, en una hoja.
 *
 * El histórico dice cuánto salió y cuánto volvió, y con eso basta para ver que
 * cuadra. Lo que no dice es EN QUÉ: se fueron dos billetes de 50 y volvieron
 * cuatro cartuchos de 2 € y cincuenta monedas de 20 céntimos. Eso es lo que
 * hay que comprobar contra la bolsa que trae el que ha ido al banco, y lo que
 * explica, meses después, por qué el stock de la caja cambió de forma ese día.
 *
 * Se ve en pantalla, no se descarga: es una comprobación de mostrador, de las
 * de mirar y cerrar. El botón de imprimir sigue ahí para quien quiera el papel.
 */
function InformeCambio({
  pedido,
  denominaciones,
  onCerrar,
}: {
  pedido: PedidoCambio;
  denominaciones: readonly Denominacion[];
  onCerrar: () => void;
}) {
  const { cajas, cajaId } = useCash();
  const caja = cajas.find((c) => c.id === cajaId);

  const salio = sumaDe(pedido.enviado);
  const volvio = sumaDe(pedido.recibido);
  /*
   * Un pedido cancelado no tiene líneas de RECIBIDO: el dinero vuelve a la
   * caja tal y como salió, sin pasar por la ventanilla. Decirlo con palabras
   * evita que un «volvió: nada» se lea como dinero perdido.
   */
  const cancelado = pedido.estado === "CANCELADO";
  const diferencia = cancelado ? 0 : volvio - salio;

  const fecha = (ms: number | null) =>
    ms == null ? "—" : new Date(ms).toLocaleString("es-ES", { dateStyle: "short", timeStyle: "short" });

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-auto bg-black/70 p-4 print:static print:bg-white print:p-0">
      <div className="w-full max-w-2xl rounded-xl bg-white p-6 text-slate-900 print:max-w-none print:rounded-none">
        <div className="mb-4 flex items-start justify-between print:hidden">
          <h2 className="text-lg font-black">Informe del cambio</h2>
          <div className="flex gap-2">
            <button
              onClick={() => window.print()}
              className="flex items-center gap-1 rounded-lg bg-slate-800 px-3 py-1.5 text-[12px] font-medium text-white"
            >
              <Printer className="h-3.5 w-3.5" /> Imprimir
            </button>
            <button
              onClick={onCerrar}
              className="rounded-lg bg-slate-200 px-3 py-1.5 text-[12px] font-medium text-slate-700"
            >
              Cerrar
            </button>
          </div>
        </div>

        <div className="mb-4 border-b border-slate-300 pb-3">
          <div className="font-mono text-base font-bold">{pedido.numero}</div>
          {caja && (
            <div className="text-sm text-slate-600">
              {caja.centro ? `${caja.centro} · ` : ""}
              {caja.nombre}
            </div>
          )}
          <div className="mt-1 text-[12px] text-slate-500">
            Salió el {fecha(pedido.creadoAtMs)}
            {" · "}
            {cancelado ? "Cancelado" : "Volvió"} el {fecha(pedido.cerradoAtMs)}
          </div>
        </div>

        <section className="mb-5">
          <h3 className="mb-1 text-[11px] font-bold uppercase tracking-wide text-slate-500">
            Salió de la caja
          </h3>
          <TablaCambio
            lineas={pedido.enviado}
            denominaciones={denominaciones}
            vacio="Sin desglose de lo que salió."
          />
        </section>

        <section className="mb-5">
          <h3 className="mb-1 text-[11px] font-bold uppercase tracking-wide text-slate-500">
            Se le pidió al banco
          </h3>
          <TablaCambio
            lineas={pedido.solicitado}
            denominaciones={denominaciones}
            vacio="Sin desglose de lo que se pidió."
          />
        </section>

        <section className="mb-5">
          <h3 className="mb-1 text-[11px] font-bold uppercase tracking-wide text-slate-500">
            Volvió del banco
          </h3>
          {cancelado ? (
            <p className="py-1 text-sm italic text-slate-600">
              El pedido se canceló: a la caja volvió el mismo dinero que había salido.
            </p>
          ) : (
            <TablaCambio
              lineas={pedido.recibido}
              denominaciones={denominaciones}
              vacio="Todavía no ha vuelto: el dinero sigue en el banco."
            />
          )}
        </section>

        <section className="rounded-lg bg-slate-100 p-3 text-sm">
          <div className="flex justify-between">
            <span>Salió</span>
            <span className="font-bold tabular-nums">{euros(salio)}</span>
          </div>
          <div className="flex justify-between">
            <span>Volvió</span>
            <span className="font-bold tabular-nums">{euros(cancelado ? salio : volvio)}</span>
          </div>
          <div
            className={`mt-1 flex justify-between border-t border-slate-300 pt-1 font-black ${
              diferencia === 0 ? "" : "text-red-700"
            }`}
          >
            <span>Diferencia</span>
            <span className="tabular-nums">{euros(diferencia)}</span>
          </div>
          {pedido.diferenciaMotivo && (
            <p className="mt-2 text-[12px] text-slate-600">{pedido.diferenciaMotivo}</p>
          )}
        </section>

        {pedido.notas && <p className="mt-3 text-[12px] text-slate-600">{pedido.notas}</p>}
      </div>
    </div>
  );
}

// ── Hoja para llevar al banco ──────────────────────────────────────────────

/**
 * Hoja imprimible del cambio.
 *
 * Sirve para las dos cosas: la propuesta que se lleva al banco antes de sacar
 * el dinero y el resguardo del pedido ya confirmado. Es la misma hoja porque
 * quien la lee —el del banco— necesita exactamente lo mismo en los dos casos.
 */
function HojaBanco({
  titulo,
  referencia,
  lineas,
  totalCentimos,
  denominaciones,
  onCerrar,
}: {
  titulo: string;
  referencia: string;
  lineas: readonly { valor: number; cantidad: number; cartuchos: number; bolsas?: number }[];
  totalCentimos: number;
  denominaciones: readonly Denominacion[];
  onCerrar: () => void;
}) {
  const { cajas, cajaId } = useCash();
  const caja = cajas.find((c) => c.id === cajaId);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-auto bg-black/70 p-4 print:static print:bg-white print:p-0">
      <div className="w-full max-w-lg rounded-xl bg-white p-6 text-slate-900 print:max-w-none print:rounded-none">
        <div className="mb-4 flex items-start justify-between print:hidden">
          <h2 className="text-lg font-black">Hoja para el banco</h2>
          <div className="flex gap-2">
            <button
              onClick={() => window.print()}
              className="flex items-center gap-1 rounded-lg bg-slate-800 px-3 py-1.5 text-[12px] font-medium text-white"
            >
              <Printer className="h-3.5 w-3.5" /> Imprimir
            </button>
            <button
              onClick={onCerrar}
              className="rounded-lg bg-slate-200 px-3 py-1.5 text-[12px] font-medium text-slate-700"
            >
              Cerrar
            </button>
          </div>
        </div>

        <div className="mb-3">
          <div className="text-xs uppercase tracking-wide text-slate-500">{titulo}</div>
          <div className="font-mono text-sm">{referencia}</div>
          {caja && <div className="text-sm text-slate-600">{caja.nombre}</div>}
        </div>

        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-slate-300">
              <th className="py-1 text-left">Denominación</th>
              <th className="py-1 text-right">Cantidad</th>
              <th className="py-1 text-right">Piezas</th>
              <th className="py-1 text-right">Importe</th>
            </tr>
          </thead>
          <tbody>
            {lineas.map((l, i) => (
              <tr key={`${l.valor}-${i}`} className="border-b border-slate-200">
                <td className="py-1">{etiquetaDe(l.valor)}</td>
                <td className="py-1 text-right tabular-nums">{comoSePide(l, denominaciones)}</td>
                <td className="py-1 text-right tabular-nums">{l.cantidad}</td>
                <td className="py-1 text-right tabular-nums">{euros(l.cantidad * l.valor)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td className="py-2 font-bold" colSpan={3}>
                Total a cambiar
              </td>
              <td className="py-2 text-right font-black tabular-nums">{euros(totalCentimos)}</td>
            </tr>
          </tfoot>
        </table>

        <div className="mt-6 grid grid-cols-2 gap-6 text-xs text-slate-500">
          <div className="border-t border-slate-400 pt-1">Entregado por</div>
          <div className="border-t border-slate-400 pt-1">Recibido por</div>
        </div>
      </div>
    </div>
  );
}

/** Resumen para la pantalla de jornada y la de cierre. */
export function AvisoPendientes({ compacto = false }: { compacto?: boolean }) {
  const { cajaId } = useCash();
  const [datos, setDatos] = useState<Pendientes | null>(null);

  useEffect(() => {
    if (!cajaId) return;
    let vivo = true;
    void api
      .pendientesTesoreria(cajaId)
      .then((d) => vivo && setDatos(d))
      .catch(() => {});
    return () => {
      vivo = false;
    };
  }, [cajaId]);

  if (!datos || datos.totalFueraCentimos === 0) return null;

  return (
    <div className="space-y-2">
      {datos.entregas.length > 0 && (
        <Aviso tono="aviso">
          <strong>Dinero en manos de alguien.</strong>{" "}
          {datos.entregas.map((e) => `${e.persona}, ${euros(e.importeCentimos)}`).join(" · ")}. No
          está en el cajón y sigue siendo de la empresa.
        </Aviso>
      )}
      {datos.pedidos.length > 0 && (
        <Aviso tono="info">
          {euros(datos.pedidos.reduce((a, p) => a + p.importeCentimos, 0))} en el banco esperando
          cambio.
        </Aviso>
      )}
      {!compacto && (
        <Card
          title="Fuera de la caja"
          value={euros(datos.totalFueraCentimos)}
          hint="pedidos de cambio y entregas sin liquidar"
          accent="text-amber-300"
        />
      )}
    </div>
  );
}
