/**
 * La ficha del albarán: líneas con expedido/recibido/pendiente, el original
 * del proveedor (subirlo si no está), sus recepciones con sus documentos,
 * sus incidencias, el cierre con diferencia aceptada y el historial.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, Download, FileText, PackageCheck, Upload } from "lucide-react";
import * as api from "../services/api";
import { useRecepciones } from "../contexts/RecepcionesContext";
import { Aviso, ChipEstadoAlbaran, ChipEstadoIncidencia, ChipResultado, Dato, ErrorBox, Modal, SinMapear, TextField, btnPrimary, btnSecondary } from "../components/ui";
import Timeline from "../components/Timeline";
import VisorDocumento from "../components/VisorDocumento";
import { fmtCantidad, type FichaAlbaran } from "../types";
import { fmtFecha, fmtFechaHora } from "../../administracion/types";

export default function AlbaranDetalle() {
  const { id = "" } = useParams();
  const { puede, etiquetaTipoIncidencia, refrescar } = useRecepciones();
  const [ficha, setFicha] = useState<FichaAlbaran | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [verDoc, setVerDoc] = useState<string | null>(null);
  const [subiendo, setSubiendo] = useState(false);
  const [cerrando, setCerrando] = useState(false);
  const [motivo, setMotivo] = useState("");
  const input = useRef<HTMLInputElement>(null);

  const cargar = useCallback(async () => {
    try {
      setFicha(await api.fichaAlbaran(id));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se ha podido cargar el albarán");
    }
  }, [id]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  if (error && !ficha) return <ErrorBox>{error}</ErrorBox>;
  if (!ficha) return <p className="text-sm text-slate-400">Cargando…</p>;
  const { albaran } = ficha;
  const original = ficha.documentos.find((d) => d.tipo === "ALBARAN_ORIGINAL") ?? null;
  const pendienteTotal = ficha.lineas.reduce((s, l) => s + l.cantidadPendiente, 0);

  async function subir(f: File) {
    setSubiendo(true);
    try {
      await api.subirOriginal(albaran.id, f);
      await cargar();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se ha podido subir el original");
    } finally {
      setSubiendo(false);
    }
  }

  async function descargar() {
    setSubiendo(true);
    try {
      await api.descargarOriginal(albaran.id);
      await cargar();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se ha podido descargar el original");
    } finally {
      setSubiendo(false);
    }
  }

  async function cerrarConDiferencia() {
    try {
      await api.cerrarAlbaranConDiferencia(albaran.id, motivo);
      setCerrando(false);
      await Promise.all([cargar(), refrescar()]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se ha podido cerrar");
    }
  }

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-2 flex flex-wrap gap-3">
        <Link to="/recepciones/bandeja" className="inline-flex items-center gap-1 text-[12px] text-slate-400 hover:text-slate-200">
          <ArrowLeft className="h-3.5 w-3.5" /> Recepciones pendientes
        </Link>
        <Link to={`/recepciones/pedidos/${albaran.pedidoId}`} className="text-[12px] text-slate-400 hover:text-slate-200">
          Pedido {albaran.pedidoNumero}
        </Link>
      </div>
      {error && <ErrorBox>{error}</ErrorBox>}

      <div className="rounded-2xl border border-slate-700 bg-slate-800 p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <div className="text-[11px] font-bold uppercase tracking-wide text-slate-400">{albaran.proveedorNombre}</div>
            <div className="text-2xl font-black">Albarán {albaran.numeroProveedor}</div>
          </div>
          <div className="flex items-center gap-2">
            <ChipEstadoAlbaran estado={albaran.estado} />
            {puede("recepciones.recibir") && ficha.recibible && (
              <Link to={`/recepciones/recibir/${albaran.id}`} className="inline-flex items-center gap-1 rounded-xl bg-emerald-600 px-3 py-1.5 text-[12px] font-bold text-white hover:bg-emerald-500">
                <PackageCheck className="h-4 w-4" /> Recibir
              </Link>
            )}
          </div>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Dato rotulo="Pedido" valor={albaran.pedidoNumero} />
          {/* Sólo si se sabe: un pedido deducido de su albarán no tiene fecha. */}
          {albaran.pedidoFecha && <Dato rotulo="Fecha del pedido" valor={fmtFecha(albaran.pedidoFecha)} />}
          <Dato rotulo="Expedición" valor={fmtFecha(albaran.fechaExpedicion)} />
          <Dato rotulo="Transportista" valor={albaran.transportista} />
          <Dato rotulo="Centro destino" valor={albaran.centroNombre} />
          <Dato rotulo="Origen del dato" valor={albaran.origen === "CORREO" ? "Correo del proveedor" : "Manual"} />
          {albaran.cerradoMotivo && <Dato rotulo="Cerrado con diferencia" valor={albaran.cerradoMotivo} />}
        </div>
      </div>

      <h2 className="mb-2 mt-5 text-sm font-bold uppercase tracking-wide text-slate-400">Líneas</h2>
      <div className="overflow-x-auto rounded-lg border border-slate-700 bg-slate-800">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[11px] uppercase text-slate-400">
              <th className="px-3 py-2 text-left">Producto</th>
              <th className="px-3 py-2 text-right">Pedida</th>
              <th className="px-3 py-2 text-right">Expedida</th>
              <th className="px-3 py-2 text-right">Recibida</th>
              <th className="px-3 py-2 text-right">Pendiente</th>
            </tr>
          </thead>
          <tbody>
            {ficha.lineas.map((l) => (
              <tr key={l.id} className="border-t border-slate-700/60">
                <td className="px-3 py-2">
                  <div className="font-semibold">{l.articuloLeido}</div>
                  <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
                    {l.articuloLeido !== l.descripcionProveedor && <span>{l.descripcionProveedor}</span>}
                    {l.sinMapear && <SinMapear />}
                  </div>
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{fmtCantidad(l.cantidadPedida)}</td>
                <td className="px-3 py-2 text-right font-bold tabular-nums">{fmtCantidad(l.cantidadExpedida)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{fmtCantidad(l.cantidadRecibida)}</td>
                <td className={`px-3 py-2 text-right font-bold tabular-nums ${l.cantidadPendiente > 0 ? "text-amber-300" : "text-emerald-300"}`}>{fmtCantidad(l.cantidadPendiente)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Original */}
      <h2 className="mb-2 mt-5 text-sm font-bold uppercase tracking-wide text-slate-400">Albarán original del proveedor</h2>
      {original ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-700 bg-slate-800 p-3">
          <div className="flex items-center gap-2 text-sm">
            <FileText className="h-4 w-4 text-sky-300" />
            <div>
              <b>{original.nombreFichero}</b>
              <div className="text-[11px] text-slate-500">
                {(original.tamanoBytes / 1024).toFixed(0)} KB · SHA-256 {original.hashSha256.slice(0, 12)}… · {original.subidoNombre ?? ""} · {fmtFechaHora(original.createdAt)}
              </div>
            </div>
          </div>
          <button className={btnSecondary} onClick={() => setVerDoc(verDoc === original.id ? null : original.id)}>
            {verDoc === original.id ? "Ocultar" : "Ver"}
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-dashed border-slate-600 bg-slate-800/50 p-3">
          <span className="text-sm text-slate-400">Sin PDF original. La recepción se puede hacer igual; el recepcionado llevará sólo la hoja del sello.</span>
          {puede("recepciones.albaran.create") && (
            <div className="flex flex-wrap gap-2">
              {albaran.enlacePdfProveedor && (
                <button className={`${btnSecondary} flex items-center gap-2`} onClick={() => void descargar()} disabled={subiendo} title={albaran.enlacePdfProveedor}>
                  <Download className="h-4 w-4" /> {subiendo ? "Descargando…" : "Descargar del enlace del proveedor"}
                </button>
              )}
              <input ref={input} type="file" accept="application/pdf" className="hidden" onChange={(e) => e.target.files?.[0] && void subir(e.target.files[0])} />
              <button className={`${btnPrimary} flex items-center gap-2`} onClick={() => input.current?.click()} disabled={subiendo}>
                <Upload className="h-4 w-4" /> {subiendo ? "Subiendo…" : "Subir PDF original"}
              </button>
            </div>
          )}
        </div>
      )}
      {verDoc && original && verDoc === original.id && (
        <div className="mt-2">
          <VisorDocumento documentoId={original.id} nombre={original.nombreFichero} alto="60vh" />
        </div>
      )}

      {/* Recepciones */}
      <h2 className="mb-2 mt-5 text-sm font-bold uppercase tracking-wide text-slate-400">Recepciones ({ficha.recepciones.length})</h2>
      {ficha.recepciones.length === 0 && <p className="text-sm text-slate-500">Todavía no se ha recibido nada de este albarán.</p>}
      <div className="space-y-2">
        {ficha.recepciones.map((r) => (
          <Link key={r.id} to={`/recepciones/recepciones/${r.id}`} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-700 bg-slate-800 p-3 hover:bg-slate-700/40">
            <div>
              <b>{r.numero}</b>
              <div className="text-[12px] text-slate-400">
                {fmtFechaHora(r.recibidoAt)} · {r.operarioNombre || r.recibidoNombre} · {fmtCantidad(r.lineas.reduce((s, l) => s + l.cantidadRecibida, 0))} uds.
                {r.rectificaciones.length > 0 ? ` · ${r.rectificaciones.length} rectificación(es)` : ""}
                {r.documentoEstado !== "GENERADO" ? ` · documento ${r.documentoEstado.toLowerCase()}` : ""}
              </div>
            </div>
            <ChipResultado resultado={r.resultado} />
          </Link>
        ))}
      </div>

      {ficha.incidencias.length > 0 && (
        <>
          <h2 className="mb-2 mt-5 text-sm font-bold uppercase tracking-wide text-slate-400">Incidencias</h2>
          <div className="space-y-2">
            {ficha.incidencias.map((i) => (
              <div key={i.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-700 bg-slate-800 p-3">
                <div className="text-sm">
                  <b>{i.descripcionProducto}</b> · {etiquetaTipoIncidencia(i.tipo)} · esperadas {fmtCantidad(i.cantidadEsperada)}, recibidas {fmtCantidad(i.cantidadRecibida)}
                  {i.observaciones && <div className="text-[12px] italic text-slate-400">«{i.observaciones}»</div>}
                </div>
                <ChipEstadoIncidencia estado={i.estado} />
              </div>
            ))}
          </div>
        </>
      )}

      {puede("recepciones.incidencia.manage") && pendienteTotal > 0 && ficha.recepciones.length > 0 && !albaran.cerradoAt && (
        <div className="mt-4">
          <Aviso tono="aviso">
            Quedan {fmtCantidad(pendienteTotal)} unidades pendientes de recibir. Si el proveedor no las va a mandar (abono, diferencia aceptada), el albarán se puede cerrar con esa diferencia.{" "}
            <button className="underline" onClick={() => setCerrando(true)}>
              Cerrar con diferencia aceptada
            </button>
          </Aviso>
        </div>
      )}

      <h2 className="mb-2 mt-5 text-sm font-bold uppercase tracking-wide text-slate-400">Historial</h2>
      <Timeline eventos={ficha.eventos} />

      {cerrando && (
        <Modal
          title="Cerrar albarán con diferencia aceptada"
          onClose={() => setCerrando(false)}
          footer={
            <div className="flex justify-end gap-2">
              <button className={btnSecondary} onClick={() => setCerrando(false)}>
                Volver
              </button>
              <button className={btnPrimary} disabled={!motivo.trim()} onClick={() => void cerrarConDiferencia()}>
                Cerrar albarán
              </button>
            </div>
          }
        >
          <p className="mb-3 text-sm text-slate-300">El albarán quedará <b>recibido con incidencia</b> y dejará de aparecer en pendientes. Las incidencias abiertas siguen siendo tuyas hasta que las resuelvas.</p>
          <TextField label="Motivo" value={motivo} onChange={setMotivo} placeholder="Abono del proveedor por las 2 unidades que faltan" />
        </Modal>
      )}
    </div>
  );
}
