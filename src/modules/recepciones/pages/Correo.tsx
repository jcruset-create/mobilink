/**
 * El correo del proveedor: el buzón, sus pasadas y cada correo con lo que se
 * hizo con él. Desde aquí se importa un .eml a mano, se fuerza una pasada, se
 * carga el histórico y se reprocesa lo que quedó en revisión.
 *
 * Los correos en PENDIENTE_REVISION son la cola de trabajo de esta pantalla:
 * un albarán cuyo pedido no ha llegado, un pedido sin líneas legibles… Lo que
 * el sistema no supo decidir solo.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Mail, RefreshCw, Upload } from "lucide-react";
import * as api from "../services/api";
import { useRecepciones } from "../contexts/RecepcionesContext";
import { Aviso, EmptyRow, ErrorBox, Modal, Pill, TableWrap, btnMini, btnPrimary, btnSecondary, inputCls, tdCls, thCls } from "../components/ui";
import { COLOR_RESULTADO_CORREO, ETIQUETA_RESULTADO_CORREO, type Correo as TCorreo, type EstadoBuzon } from "../types";
import { fmtFechaHora } from "../../administracion/types";

/** El resultado por correo de una pasada viene en minúsculas y abreviado. */
function colorDetalle(resultado: string): string {
  const clave = resultado === "revision" ? "PENDIENTE_REVISION" : resultado.toUpperCase();
  return COLOR_RESULTADO_CORREO[clave] ?? "bg-slate-600/40 text-slate-300";
}

export default function Correo() {
  const { puede, refrescar } = useRecepciones();
  const [estado, setEstado] = useState<EstadoBuzon | null>(null);
  const [correos, setCorreos] = useState<TCorreo[]>([]);
  const [filtro, setFiltro] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [detalle, setDetalle] = useState<TCorreo | null>(null);
  const [historicoDesde, setHistoricoDesde] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const puedeOperar = puede("recepciones.correo.importar");

  const cargar = useCallback(async () => {
    try {
      const [e, c] = await Promise.all([api.estadoBuzon(), api.listarCorreos({ resultado: filtro || undefined })]);
      setEstado(e);
      setCorreos(c.correos);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se ha podido cargar el correo");
    }
  }, [filtro]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  async function ejecutar(accion: () => Promise<string>) {
    setOcupado(true);
    setAviso(null);
    try {
      setAviso(await accion());
      await Promise.all([cargar(), refrescar()]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se ha podido completar la acción");
    } finally {
      setOcupado(false);
    }
  }

  const resumenPasada = (r: { correos: number; procesados: number; ignorados: number; errores: number }) =>
    `${r.correos} correo(s): ${r.procesados} procesado(s), ${r.ignorados} ignorado(s), ${r.errores} error(es).`;

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h1 className="text-xl font-black text-slate-100">Correo del proveedor</h1>
          <p className="text-[12px] text-slate-400">Los avisos de pedido y de albarán de Soledad entran solos por el buzón; aquí se ve qué llegó y qué se hizo con cada uno.</p>
        </div>
        {puedeOperar && (
          <div className="flex flex-wrap gap-2">
            <input ref={input} type="file" accept=".eml,message/rfc822" className="hidden" onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) void ejecutar(async () => {
                const r = await api.importarEml(f);
                return `${r.asunto || f.name}: ${r.resultado}${r.error ? ` · ${r.error}` : ""}${r.pedidoNumero ? ` · pedido ${r.pedidoNumero}` : ""}${r.albaranNumero ? ` · albarán ${r.albaranNumero}` : ""}`;
              });
            }} />
            <button className={`${btnSecondary} flex items-center gap-2`} onClick={() => input.current?.click()} disabled={ocupado}>
              <Upload className="h-4 w-4" /> Importar .eml
            </button>
            {estado?.configurado && (
              <button className={`${btnPrimary} flex items-center gap-2`} disabled={ocupado} onClick={() => void ejecutar(async () => `Pasada terminada. ${resumenPasada(await api.revisarBuzon())}`)}>
                <RefreshCw className={`h-4 w-4 ${ocupado ? "animate-spin" : ""}`} /> Revisar buzón ahora
              </button>
            )}
          </div>
        )}
      </div>

      {error && <ErrorBox>{error}</ErrorBox>}
      {aviso && <div className="mb-3"><Aviso tono="info">{aviso}</Aviso></div>}

      {/* Estado del buzón */}
      <div className="mb-4 grid gap-3 md:grid-cols-3">
        <div className="rounded-xl border border-slate-700 bg-slate-800 p-3">
          <div className="text-[10px] font-bold uppercase text-slate-400">Buzón</div>
          {estado?.configurado ? (
            <>
              <div className="mt-1 flex items-center gap-2 text-sm"><Mail className="h-4 w-4 text-emerald-400" /> {estado.usuario}</div>
              <div className="text-[12px] text-slate-400">cada {estado.cadaMinutos} min · activado {estado.activadoEl ? fmtFechaHora(estado.activadoEl) : "en la primera pasada"}</div>
            </>
          ) : (
            <div className="mt-1 text-sm text-amber-300">Apagado: faltan las credenciales IMAP en el servidor (RECEPCIONES_IMAP_*). Los correos se pueden importar a mano como .eml.</div>
          )}
        </div>
        <div className="rounded-xl border border-slate-700 bg-slate-800 p-3">
          <div className="text-[10px] font-bold uppercase text-slate-400">Remitentes admitidos</div>
          <div className="mt-1 text-sm">{estado?.remitentes.length ? estado.remitentes.join(", ") : <span className="text-amber-300">Ninguno: se acepta todo. Ponlos en la ficha del proveedor.</span>}</div>
          {estado && (
            <label className="mt-2 flex cursor-pointer items-center gap-2 text-[12px] text-slate-300">
              <input type="checkbox" className="h-4 w-4 accent-emerald-500" checked={estado.asumirExpedicionCompleta} disabled={!puedeOperar || ocupado}
                onChange={(e) => void ejecutar(async () => { await api.guardarConfigCorreo({ asumirExpedicionCompleta: e.target.checked }); return "Configuración guardada."; })} />
              Si el albarán no detalla cantidades, dar por expedido todo lo pendiente del pedido
            </label>
          )}
        </div>
        <div className="rounded-xl border border-slate-700 bg-slate-800 p-3">
          <div className="text-[10px] font-bold uppercase text-slate-400">Última pasada</div>
          {estado?.pasadas[0] ? (
            <>
              <div className="mt-1 text-sm">{fmtFechaHora(estado.pasadas[0].iniciada_at)} · {estado.pasadas[0].origen}</div>
              <div className={`text-[12px] ${estado.pasadas[0].error ? "text-rose-300" : "text-slate-400"}`}>{estado.pasadas[0].error ?? resumenPasada(estado.pasadas[0])}</div>
              {/* Correo a correo. Un correo descartado por remitente o por
                  fecha no llega a la tabla de abajo, así que éste es el único
                  sitio donde se puede ver POR QUÉ no se procesó. */}
              {estado.pasadas[0].detalle.length > 0 && (
                <ul className="mt-2 max-h-40 space-y-1 overflow-auto border-t border-slate-700 pt-2">
                  {estado.pasadas[0].detalle.map((d, i) => (
                    <li key={`${d.messageId}-${i}`} className="text-[11px] leading-tight">
                      <Pill className={colorDetalle(d.resultado)}>{d.resultado}</Pill>{" "}
                      <span className="text-slate-300">{d.asunto || "(sin asunto)"}</span>
                      {d.error && <div className="text-slate-500">{d.error}</div>}
                    </li>
                  ))}
                </ul>
              )}
            </>
          ) : (
            <div className="mt-1 text-sm text-slate-500">Todavía ninguna.</div>
          )}
          {(estado?.enRevision ?? 0) > 0 && <div className="mt-1 text-[12px] font-bold text-amber-300">{estado!.enRevision} correo(s) pendientes de revisión</div>}
        </div>
      </div>

      {puedeOperar && estado?.configurado && (
        <div className="mb-4 flex flex-wrap items-end gap-2 rounded-lg border border-dashed border-slate-700 p-3 text-[12px] text-slate-400">
          <span>Cargar el histórico anterior a la activación (a propósito, con fecha):</span>
          <input type="date" className={`${inputCls} max-w-[170px]`} value={historicoDesde} onChange={(e) => setHistoricoDesde(e.target.value)} />
          <button className={btnMini} disabled={ocupado || !historicoDesde} onClick={() => void ejecutar(async () => `Histórico cargado. ${resumenPasada(await api.cargarHistorico(historicoDesde))}`)}>
            Cargar desde esa fecha
          </button>
        </div>
      )}

      {/* Correos */}
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <select className={`${inputCls} max-w-[240px]`} value={filtro} onChange={(e) => setFiltro(e.target.value)}>
          <option value="">Todos los correos</option>
          <option value="PENDIENTE_REVISION">Pendientes de revisión</option>
          <option value="ERROR">Con error</option>
          <option value="PROCESADO">Procesados</option>
          <option value="DUPLICADO">Duplicados</option>
          <option value="IGNORADO">Ignorados</option>
        </select>
      </div>
      <TableWrap>
        <thead>
          <tr>
            <th className={thCls}>Recibido</th>
            <th className={thCls}>Asunto / remitente</th>
            <th className={thCls}>Tipo</th>
            <th className={thCls}>Resultado</th>
            <th className={thCls}>Pedido / albarán</th>
            <th className={thCls}></th>
          </tr>
        </thead>
        <tbody>
          {correos.length === 0 && <EmptyRow cols={6} text="Ningún correo todavía." />}
          {correos.map((c) => (
            <tr key={c.id} className="border-t border-slate-700/60 align-top hover:bg-slate-700/30">
              <td className={`${tdCls} whitespace-nowrap`}>
                <div>{fmtFechaHora(c.fecha ?? c.createdAt)}</div>
                <div className="text-[11px] text-slate-500">{c.origen}</div>
              </td>
              <td className={tdCls}>
                <button className="text-left font-semibold hover:underline" onClick={() => setDetalle(c)}>{c.asunto || "(sin asunto)"}</button>
                <div className="text-[11px] text-slate-500">{c.remitente ?? "—"}{c.proveedorNombre ? ` · ${c.proveedorNombre}` : ""}</div>
                {c.motivo && <div className={`text-[12px] ${c.resultado === "ERROR" || c.resultado === "PENDIENTE_REVISION" ? "text-amber-300" : "text-slate-400"}`}>{c.motivo}</div>}
              </td>
              <td className={tdCls}>{c.tipo === "DESCONOCIDO" ? "—" : c.tipo === "PEDIDO" ? "Pedido" : "Albarán"}</td>
              <td className={tdCls}><Pill className={COLOR_RESULTADO_CORREO[c.resultado] ?? "bg-slate-700 text-slate-300"}>{ETIQUETA_RESULTADO_CORREO[c.resultado] ?? c.resultado}</Pill></td>
              <td className={tdCls}>
                {c.pedidoId && <Link to={`/recepciones/pedidos/${c.pedidoId}`} className="text-sky-300 hover:underline">Pedido {c.pedidoNumero}</Link>}
                {c.albaranId && <div><Link to={`/recepciones/albaranes/${c.albaranId}`} className="text-sky-300 hover:underline">Albarán {c.albaranNumero}</Link></div>}
              </td>
              <td className={`${tdCls} whitespace-nowrap text-right`}>
                {puedeOperar && (c.resultado === "PENDIENTE_REVISION" || c.resultado === "ERROR" || c.resultado === "RECIBIDO") && (
                  <button className={btnMini} disabled={ocupado} onClick={() => void ejecutar(async () => { const r = await api.reprocesarCorreo(c.id); return `${c.asunto}: ${ETIQUETA_RESULTADO_CORREO[r.resultado] ?? r.resultado}${r.motivo ? ` · ${r.motivo}` : ""}`; })}>
                    Reprocesar
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </TableWrap>

      {detalle && (
        <Modal title={detalle.asunto || "Correo"} onClose={() => setDetalle(null)} wide>
          <div className="mb-2 text-[12px] text-slate-400">
            {detalle.remitente} · {fmtFechaHora(detalle.fecha ?? detalle.createdAt)} · {detalle.messageId}
          </div>
          {detalle.avisos.length > 0 && (
            <div className="mb-2"><Aviso tono="aviso">{detalle.avisos.join(" ")}</Aviso></div>
          )}
          <pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap rounded-lg border border-slate-700 bg-slate-900 p-3 text-[12px] text-slate-200">{detalle.texto}</pre>
        </Modal>
      )}
    </div>
  );
}
