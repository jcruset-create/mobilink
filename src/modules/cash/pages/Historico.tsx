/**
 * Histórico de jornadas y de operaciones.
 *
 * El listado de operaciones muestra el origen (ERP o manual) y el número de
 * documento, que es lo que pedía el encargo: en un vistazo se distingue un
 * cobro que vino de una factura de otro que dio de alta alguien a mano.
 */

import { useCallback, useEffect, useState } from "react";
import { useCash } from "../contexts/CashContext";
import {
  BotonInforme,
  Aviso,
  Cabecera,
  Card,
  EmptyRow,
  ErrorBox,
  Modal,
  OrigenBadge,
  SyncBadge,
  TableWrap,
  thCls,
  tdCls,
  inputCls,
  btnDanger,
  btnSecondary,
} from "../components/ui";
import { euros, eurosConSigno, fechaJornada } from "../utils/money";
import {
  ETIQUETA_ESTADO_SESION,
  ETIQUETA_TIPO_OPERACION,
  type EstadoSesion,
  type Operacion,
} from "../types";
import Justificantes from "../components/Justificantes";
import * as api from "../services/api";

type FilaSesion = {
  id: number;
  fecha: string;
  estado: EstadoSesion;
  caja_nombre: string;
  caja_centro: string;
  fondo_inicial_centimos: string;
  contado_centimos: string | null;
  diferencia_centimos: string | null;
  denominaciones_cuadran: boolean | null;
  cambio_final_centimos: string | null;
  ingreso_bancario_centimos: string | null;
  /** Fondo fijo de la caja, para saber si el cierre se quedó corto. */
  caja_fondo_objetivo_centimos: string | null;
};

/**
 * Lo que le faltó a la caja para su fondo fijo al cerrar.
 *
 * Negativo a propósito: es lo que hay que reponer, y verlo en rojo con su
 * signo es la diferencia entre «cerró con 328,48 €» —que no dice nada— y
 * «cerró 21,52 € por debajo de su fondo», que es lo que hay que arreglar.
 *
 * `null` cuando no aplica: jornada sin cerrar, o caja sin fondo fijo, donde
 * hablar de déficit sería inventarse una deuda.
 */
function deficitDeCierre(s: FilaSesion): number | null {
  const objetivo = Number(s.caja_fondo_objetivo_centimos ?? 0);
  if (objetivo <= 0 || s.cambio_final_centimos == null) return null;
  const hueco = objetivo - Number(s.cambio_final_centimos);
  return hueco > 0 ? -hueco : null;
}

export default function Historico() {
  const { cajas, puede } = useCash();
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");
  const [registerId, setRegisterId] = useState<number | "">("");
  const [estado, setEstado] = useState("");
  const [sesiones, setSesiones] = useState<FilaSesion[]>([]);
  const [detalle, setDetalle] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [cargando, setCargando] = useState(false);

  const buscar = useCallback(async () => {
    setCargando(true);
    setError("");
    try {
      const r = await api.historico({
        desde: desde || undefined,
        hasta: hasta || undefined,
        registerId: registerId === "" ? undefined : registerId,
        estado: estado || undefined,
      });
      setSesiones(r.sesiones as unknown as FilaSesion[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error consultando el histórico");
    } finally {
      setCargando(false);
    }
  }, [desde, hasta, registerId, estado]);

  useEffect(() => {
    void buscar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="space-y-3">
      <Cabecera titulo="Histórico" descripcion="Jornadas anteriores con su arqueo, su cierre y sus operaciones." />

      {error && <ErrorBox>{error}</ErrorBox>}

      <div className="flex flex-wrap items-end gap-2 rounded-lg border border-slate-700 bg-slate-800 p-3">
        <label className="block">
          <span className="mb-1 block text-[10px] font-semibold uppercase text-slate-400">Desde</span>
          <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} className={inputCls} />
        </label>
        <label className="block">
          <span className="mb-1 block text-[10px] font-semibold uppercase text-slate-400">Hasta</span>
          <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} className={inputCls} />
        </label>
        <label className="block">
          <span className="mb-1 block text-[10px] font-semibold uppercase text-slate-400">Caja</span>
          <select
            value={registerId}
            onChange={(e) => setRegisterId(e.target.value === "" ? "" : Number(e.target.value))}
            className={inputCls}
          >
            <option value="">Todas</option>
            {cajas.map((c) => (
              <option key={c.id} value={c.id}>
                {c.centro ? `${c.centro} · ` : ""}
                {c.nombre}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-[10px] font-semibold uppercase text-slate-400">Estado</span>
          <select value={estado} onChange={(e) => setEstado(e.target.value)} className={inputCls}>
            <option value="">Todos</option>
            {(Object.keys(ETIQUETA_ESTADO_SESION) as EstadoSesion[]).map((e) => (
              <option key={e} value={e}>
                {ETIQUETA_ESTADO_SESION[e]}
              </option>
            ))}
          </select>
        </label>
        <button onClick={() => void buscar()} className={btnSecondary}>
          {cargando ? "Buscando…" : "Buscar"}
        </button>
      </div>

      <TableWrap>
        <thead>
          <tr>
            <th className={thCls}>Fecha</th>
            <th className={thCls}>Caja</th>
            <th className={thCls}>Estado</th>
            <th className={`${thCls} text-right`}>Fondo inicial</th>
            <th className={`${thCls} text-right`}>Contado</th>
            <th className={`${thCls} text-right`}>Diferencia</th>
            <th className={`${thCls} text-right`}>Cambio final</th>
            <th className={`${thCls} text-right`}>Ingreso</th>
            <th className={thCls}></th>
          </tr>
        </thead>
        <tbody>
          {sesiones.length === 0 && <EmptyRow cols={9} text={cargando ? "Buscando…" : "No hay jornadas con esos filtros."} />}
          {sesiones.map((s) => {
            const dif = s.diferencia_centimos == null ? null : Number(s.diferencia_centimos);
            const deficit = deficitDeCierre(s);
            return (
              <tr
                key={s.id}
                onClick={() => setDetalle(s.id)}
                className="cursor-pointer border-t border-slate-700 hover:bg-slate-700/40"
              >
                <td className={tdCls}>{fechaJornada(s.fecha)}</td>
                <td className={tdCls}>
                  {s.caja_centro ? `${s.caja_centro} · ` : ""}
                  {s.caja_nombre}
                </td>
                <td className={tdCls}>
                  <span className="text-[11px] text-slate-400">{ETIQUETA_ESTADO_SESION[s.estado]}</span>
                  {s.denominaciones_cuadran === false && (
                    <span className="ml-1 text-[10px] text-amber-300">denominaciones ≠</span>
                  )}
                </td>
                <td className={`${tdCls} text-right tabular-nums`}>{euros(Number(s.fondo_inicial_centimos))}</td>
                <td className={`${tdCls} text-right tabular-nums`}>
                  {s.contado_centimos == null ? "—" : euros(Number(s.contado_centimos))}
                </td>
                <td
                  className={`${tdCls} text-right font-bold tabular-nums ${
                    dif == null ? "" : dif === 0 ? "text-emerald-400" : dif > 0 ? "text-sky-300" : "text-rose-400"
                  }`}
                >
                  {dif == null ? "—" : eurosConSigno(dif)}
                </td>
                <td className={`${tdCls} text-right tabular-nums`}>
                  {s.cambio_final_centimos == null ? (
                    "—"
                  ) : (
                    <>
                      {euros(Number(s.cambio_final_centimos))}
                      {deficit != null && (
                        <span
                          className="ml-1 font-bold text-rose-400"
                          title={`La caja cerró por debajo de su fondo fijo de ${euros(
                            Number(s.caja_fondo_objetivo_centimos)
                          )}. Se repone desde Ingresos bancarios, con el dinero pendiente de ingresar.`}
                        >
                          {eurosConSigno(deficit)}
                        </span>
                      )}
                    </>
                  )}
                </td>
                <td className={`${tdCls} text-right tabular-nums`}>
                  {s.ingreso_bancario_centimos == null ? "—" : euros(Number(s.ingreso_bancario_centimos))}
                </td>
                {/*
                  El informe de cierre sin pasar por el detalle: la fila entera
                  abre el modal, así que el botón corta la propagación. Solo en
                  jornadas cerradas, que son las únicas con cierre que informar.
                */}
                <td className={tdCls} onClick={(e) => e.stopPropagation()}>
                  {s.estado === "CLOSED" && (
                    <BotonInforme
                      ruta={`/sessions/${s.id}/report.pdf`}
                      nombre={`cierre-${s.fecha.slice(0, 10)}`}
                      className="flex items-center gap-1 rounded-lg bg-slate-700 px-2 py-1 text-[11px] font-medium text-slate-200 hover:bg-slate-600 disabled:opacity-50"
                    >
                      Informe
                    </BotonInforme>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </TableWrap>

      {detalle && (
        <DetalleJornada
          sessionId={detalle}
          onCerrar={() => setDetalle(null)}
          puedeAnular={puede("cash.operation.reverse")}
        />
      )}
    </div>
  );
}

function DetalleJornada({
  sessionId,
  onCerrar,
  puedeAnular,
}: {
  sessionId: number;
  onCerrar: () => void;
  puedeAnular: boolean;
}) {
  const { puede } = useCash();
  const [datos, setDatos] = useState<Awaited<ReturnType<typeof api.detalleJornada>> | null>(null);
  const [error, setError] = useState("");
  const [anulando, setAnulando] = useState<Operacion | null>(null);
  const [motivo, setMotivo] = useState("");

  const cargar = useCallback(async () => {
    try {
      setDatos(await api.detalleJornada(sessionId));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error cargando la jornada");
    }
  }, [sessionId]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  async function anular() {
    if (!anulando) return;
    try {
      await api.anularOperacion(anulando.id, motivo);
      setAnulando(null);
      setMotivo("");
      await cargar();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se ha podido anular");
    }
  }

  return (
    <Modal title={`Jornada ${sessionId}`} onClose={onCerrar} wide>
      {error && <ErrorBox>{error}</ErrorBox>}
      {!datos ? (
        <p className="text-sm text-slate-500">Cargando…</p>
      ) : (
        <div className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-4">
            <Card title="Efectivo teórico" value={euros(datos.totalStockCentimos)} />
            <Card title="Cobros" value={euros(datos.cobros.totalCentimos)} />
            <Card title="Pagos" value={euros(datos.pagos.totalCentimos)} />
            <Card title="Operaciones" value={String(datos.operaciones)} />
          </div>

          <div>
            <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
              <span className="text-[11px] font-bold uppercase tracking-wide text-slate-400">
                Operaciones
              </span>
              {/* Todo el papeleo del día en un PDF, con los escaneos dentro. */}
              <BotonInforme
                ruta={`/sessions/${sessionId}/report.pdf`}
                nombre={`cierre-${(datos?.sesion.fecha ?? String(sessionId)).slice(0, 10)}`}
                className="flex items-center gap-1 rounded-lg bg-slate-700 px-3 py-1.5 text-[12px] font-medium text-slate-200 hover:bg-slate-600 disabled:opacity-50"
              >
                Informe de cierre
              </BotonInforme>
            </div>
            <TableWrap>
              <thead>
                <tr>
                  <th className={thCls}>Número</th>
                  <th className={thCls}>Tipo</th>
                  <th className={thCls}>Origen</th>
                  <th className={thCls}>Documento</th>
                  <th className={thCls}>Concepto</th>
                  <th className={thCls}>Justificante</th>
                  <th className={`${thCls} text-right`}>Importe</th>
                  <th className={thCls}></th>
                </tr>
              </thead>
              <tbody>
                {datos.operaciones.length === 0 && <EmptyRow cols={8} text="Sin operaciones." />}
                {datos.operaciones.map((o) => (
                  <tr key={o.id} className={`border-t border-slate-700 ${o.estado === "REVERSED" ? "opacity-50" : ""}`}>
                    <td className={`${tdCls} font-mono text-[11px]`}>{o.numero}</td>
                    <td className={tdCls}>{ETIQUETA_TIPO_OPERACION[o.tipo] ?? o.tipo}</td>
                    <td className={tdCls}>
                      <OrigenBadge origen={o.origen} />
                    </td>
                    <td className={`${tdCls} text-[11px] text-slate-400`}>
                      {o.externalDocumentReference ?? o.externalDocumentId ?? "—"}
                      <div>
                        <SyncBadge estado={o.erpSyncStatus} />
                      </div>
                    </td>
                    <td className={tdCls}>
                      {o.concepto}
                      {o.partyNombre && <div className="text-[11px] text-slate-500">{o.partyNombre}</div>}
                    </td>
                    {/* Adjuntar más tarde: la factura del proveedor muchas
                        veces aparece después del pago. */}
                    <td className={tdCls}>
                      <Justificantes
                        operationId={o.id}
                        puedeAdjuntar={puede("cash.document.attach")}
                        puedeAnular={puede("cash.document.void")}
                        compacto
                      />
                    </td>
                    <td className={`${tdCls} text-right font-bold tabular-nums`}>{euros(o.importeCentimos)}</td>
                    <td className={tdCls}>
                      {puedeAnular && o.estado === "CONFIRMED" && (
                        <button onClick={() => setAnulando(o)} className="text-[11px] text-rose-300 hover:underline">
                          Anular
                        </button>
                      )}
                      {o.estado === "REVERSED" && <span className="text-[10px] text-slate-500">Anulada</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          </div>

          <Aviso tono="info">
            Las operaciones no se borran. Anular asienta el movimiento inverso y deja las dos
            enlazadas, de forma que el rastro del efectivo se conserva entero.
          </Aviso>
        </div>
      )}

      {anulando && (
        <Modal
          title={`Anular ${anulando.numero}`}
          onClose={() => setAnulando(null)}
          footer={
            <div className="flex justify-end gap-2">
              <button onClick={() => setAnulando(null)} className={btnSecondary}>
                Cancelar
              </button>
              <button onClick={() => void anular()} disabled={!motivo.trim()} className={btnDanger}>
                Anular con reversión
              </button>
            </div>
          }
        >
          <p className="mb-2 text-sm text-slate-300">
            Se creará una operación inversa por {euros(anulando.importeCentimos)}. El efectivo
            volverá al estado anterior y ambas quedarán en el histórico.
          </p>
          <input
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            placeholder="Motivo de la anulación (obligatorio)"
            className={inputCls}
          />
        </Modal>
      )}
    </Modal>
  );
}
