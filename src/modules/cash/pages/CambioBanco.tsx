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
import type { PedidoCambio, Pendientes, PropuestaPedido } from "../types";
import * as api from "../services/api";

const etiquetaDe = (valor: number) =>
  valor >= 100 ? `${valor / 100} €` : `${valor} c`;

export default function CambioBanco() {
  const { jornada, cajaId, refrescar, puede } = useCash();

  const [pedidos, setPedidos] = useState<PedidoCambio[]>([]);
  const [importeTexto, setImporteTexto] = useState("200,00");
  const [propuesta, setPropuesta] = useState<PropuestaPedido | null>(null);
  const [ajustes, setAjustes] = useState<Record<number, string>>({});
  const [error, setError] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [pedidoImpreso, setPedidoImpreso] = useState<PedidoCambio | null>(null);

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
      setAjustes(
        Object.fromEntries(p.lineas.map((l) => [l.valor, String(l.cartuchos || l.piezas)]))
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se ha podido calcular la propuesta");
    }
  }

  /** Lo que finalmente se le pide al banco, con los ajustes del cajero. */
  const solicitado = useMemo(() => {
    if (!propuesta) return [];
    return propuesta.lineas
      .map((l) => {
        const n = Number(ajustes[l.valor] ?? 0);
        if (!Number.isFinite(n) || n <= 0) return null;
        const porTubo = l.cartuchos > 0 ? l.piezas / l.cartuchos : 0;
        return porTubo > 0
          ? { valor: l.valor, cantidad: n * porTubo, cartuchos: n, motivo: l.motivo }
          : { valor: l.valor, cantidad: n, cartuchos: 0, motivo: l.motivo };
      })
      .filter((l): l is NonNullable<typeof l> => l !== null);
  }, [propuesta, ajustes]);

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
                    <th className={thCls}>Cuántos</th>
                    <th className={`${thCls} text-right`}>Importe</th>
                    <th className={thCls}>Por qué</th>
                  </tr>
                </thead>
                <tbody>
                  {propuesta.lineas.length === 0 && (
                    <EmptyRow cols={4} text="No hace falta reponer nada." />
                  )}
                  {propuesta.lineas.map((l) => {
                    const porTubo = l.cartuchos > 0 ? l.piezas / l.cartuchos : 0;
                    const n = Number(ajustes[l.valor] ?? 0);
                    return (
                      <tr key={l.valor}>
                        <td className={`${tdCls} font-bold text-slate-100`}>{etiquetaDe(l.valor)}</td>
                        <td className={tdCls}>
                          <div className="flex items-center gap-2">
                            <input
                              type="number"
                              min={0}
                              value={ajustes[l.valor] ?? ""}
                              onChange={(e) => setAjustes({ ...ajustes, [l.valor]: e.target.value })}
                              className={`${inputCls} w-20 text-right tabular-nums`}
                            />
                            <span className="text-[11px] text-slate-400">
                              {porTubo > 0 ? `tubos de ${porTubo}` : "piezas"}
                            </span>
                          </div>
                        </td>
                        <td className={`${tdCls} text-right tabular-nums text-slate-300`}>
                          {euros((porTubo > 0 ? n * porTubo : n) * l.valor)}
                        </td>
                        <td className={`${tdCls} text-[11px] text-slate-400`}>{l.motivo}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </TableWrap>

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
            </tr>
          </thead>
          <tbody>
            {pedidos.length === 0 && <EmptyRow cols={5} text="Todavía no se ha pedido cambio." />}
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
                </tr>
              ))}
          </tbody>
        </TableWrap>
      </section>

      {pedidoImpreso && (
        <HojaBanco pedido={pedidoImpreso} onCerrar={() => setPedidoImpreso(null)} />
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
  // Se arranca de lo pedido: lo normal es que el banco dé justo eso, y así el
  // cajero solo corrige lo que venga distinto.
  const [recibido, setRecibido] = useState<Record<number, string>>(() =>
    Object.fromEntries(pedido.solicitado.map((l) => [l.valor, String(l.cartuchos || l.cantidad)]))
  );
  const [motivo, setMotivo] = useState("");
  const [motivoCancelar, setMotivoCancelar] = useState("");
  const [cancelando, setCancelando] = useState(false);

  const lineas = pedido.solicitado
    .map((l) => {
      const n = Number(recibido[l.valor] ?? 0);
      if (!Number.isFinite(n) || n <= 0) return null;
      const porTubo = l.cartuchos > 0 ? l.cantidad / l.cartuchos : 0;
      return porTubo > 0
        ? { valor: l.valor, cantidad: n * porTubo, cartuchos: n }
        : { valor: l.valor, cantidad: n, cartuchos: 0 };
    })
    .filter((l): l is NonNullable<typeof l> => l !== null);

  const total = lineas.reduce((a, l) => a + l.cantidad * l.valor, 0);
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
          <div className="mt-1 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {pedido.solicitado.map((l) => {
              const porTubo = l.cartuchos > 0 ? l.cantidad / l.cartuchos : 0;
              return (
                <label key={l.valor} className="flex items-center gap-2">
                  <span className="w-16 shrink-0 text-sm font-bold text-slate-100">
                    {etiquetaDe(l.valor)}
                  </span>
                  <input
                    type="number"
                    min={0}
                    value={recibido[l.valor] ?? ""}
                    onChange={(e) => setRecibido({ ...recibido, [l.valor]: e.target.value })}
                    className={`${inputCls} w-20 text-right tabular-nums`}
                  />
                  <span className="text-[11px] text-slate-400">
                    {porTubo > 0 ? `tubos de ${porTubo}` : "piezas"}
                  </span>
                </label>
              );
            })}
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

// ── Hoja para llevar al banco ──────────────────────────────────────────────

function HojaBanco({ pedido, onCerrar }: { pedido: PedidoCambio; onCerrar: () => void }) {
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
          <div className="text-xs uppercase tracking-wide text-slate-500">Petición de cambio</div>
          <div className="font-mono text-sm">{pedido.numero}</div>
          {caja && <div className="text-sm text-slate-600">{caja.nombre}</div>}
        </div>

        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-slate-300">
              <th className="py-1 text-left">Denominación</th>
              <th className="py-1 text-right">Cantidad</th>
              <th className="py-1 text-right">Importe</th>
            </tr>
          </thead>
          <tbody>
            {pedido.solicitado.map((l) => (
              <tr key={l.valor} className="border-b border-slate-200">
                <td className="py-1">{etiquetaDe(l.valor)}</td>
                <td className="py-1 text-right tabular-nums">
                  {l.cartuchos > 0
                    ? `${l.cartuchos} ${l.cartuchos === 1 ? "cartucho" : "cartuchos"} (${l.cantidad} piezas)`
                    : `${l.cantidad} piezas`}
                </td>
                <td className="py-1 text-right tabular-nums">{euros(l.cantidad * l.valor)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td className="py-2 font-bold" colSpan={2}>
                Total a cambiar
              </td>
              <td className="py-2 text-right font-black tabular-nums">
                {euros(pedido.importeCentimos)}
              </td>
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
