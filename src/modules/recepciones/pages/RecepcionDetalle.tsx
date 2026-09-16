/**
 * Una recepción cerrada: el sello, el documento (con Imprimir), las
 * incidencias y las rectificaciones. Es adonde llega el operario tras cerrar
 * (con `?imprimir=1` se lanza la impresión del navegador al cargar).
 */

import { useCallback, useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { ArrowLeft, RefreshCw } from "lucide-react";
import * as api from "../services/api";
import { useRecepciones } from "../contexts/RecepcionesContext";
import { Aviso, ChipEstadoIncidencia, ChipResultado, Dato, ErrorBox, Modal, btnMini, btnSecondary, inputCls } from "../components/ui";
import VisorDocumento from "../components/VisorDocumento";
import { fmtCantidad, fmtDiferencia, type FichaRecepcion } from "../types";
import { fmtFechaHora } from "../../administracion/types";

export default function RecepcionDetalle() {
  const { id = "" } = useParams();
  const [params] = useSearchParams();
  const { puede, etiquetaTipoIncidencia } = useRecepciones();
  const [ficha, setFicha] = useState<FichaRecepcion | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rectificando, setRectificando] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [cantidades, setCantidades] = useState<Record<string, number>>({});
  const [guardando, setGuardando] = useState(false);

  const cargar = useCallback(async () => {
    try {
      const f = await api.fichaRecepcion(id);
      setFicha(f);
      setCantidades(Object.fromEntries(f.lineas.map((l) => [l.id, l.cantidadRecibida])));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se ha podido cargar la recepción");
    }
  }, [id]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  if (error && !ficha) return <ErrorBox>{error}</ErrorBox>;
  if (!ficha) return <p className="text-sm text-slate-400">Cargando…</p>;

  const { recepcion, albaran } = ficha;
  const documento = ficha.documentos.filter((d) => d.tipo === "ALBARAN_RECEPCION").at(-1) ?? null;
  const ok = recepcion.resultado === "OK";
  const fh = fmtFechaHora(recepcion.recibidoAt);

  async function regenerar() {
    setGuardando(true);
    try {
      await api.regenerarDocumento(recepcion.id);
      await cargar();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se ha podido regenerar");
    } finally {
      setGuardando(false);
    }
  }

  async function rectificar() {
    setGuardando(true);
    try {
      await api.rectificar(recepcion.id, {
        motivo,
        lineas: ficha!.lineas.map((l) => ({ recepcionLineaId: l.id, cantidadRecibida: cantidades[l.id] })),
      });
      setRectificando(false);
      setMotivo("");
      await cargar();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se ha podido rectificar");
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-2 flex flex-wrap items-center gap-3 print:hidden">
        <Link to="/recepciones/bandeja" className="inline-flex items-center gap-1 text-[12px] text-slate-400 hover:text-slate-200">
          <ArrowLeft className="h-3.5 w-3.5" /> Recepciones pendientes
        </Link>
        {albaran && (
          <Link to={`/recepciones/albaranes/${albaran.id}`} className="text-[12px] text-slate-400 hover:text-slate-200">
            Ficha del albarán {albaran.numeroProveedor}
          </Link>
        )}
      </div>

      {error && <ErrorBox>{error}</ErrorBox>}

      {/* El sello en pantalla, con la misma información que el PDF */}
      <div className={`rounded-2xl border-2 p-5 ${ok ? "border-emerald-500/60 bg-emerald-500/5" : "border-amber-500/60 bg-amber-500/5"}`}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Recepción Mobilink</div>
            <div className="text-2xl font-black">{recepcion.numero}</div>
          </div>
          <div className={`rounded-2xl px-6 py-3 text-3xl font-black text-white ${ok ? "bg-emerald-600" : "bg-amber-600"}`}>{ok ? "OK" : "CON INCIDENCIA"}</div>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Dato rotulo="Proveedor" valor={albaran?.proveedorNombre} />
          <Dato rotulo="Pedido" valor={albaran?.pedidoNumero} />
          <Dato rotulo="Albarán" valor={albaran?.numeroProveedor} />
          <Dato rotulo="Transportista" valor={albaran?.transportista} />
          <Dato rotulo="Recibido por" valor={<b>{recepcion.operarioNombre || recepcion.recibidoNombre}</b>} />
          {/* Quién contó y desde qué sesión se registró son dos cosas: si no
              coinciden, las dos se enseñan. */}
          {recepcion.operarioNombre && <Dato rotulo="Registrado desde" valor={recepcion.recibidoNombre} />}
          <Dato rotulo="Fecha y hora" valor={fh} />
          <Dato rotulo="Centro" valor={recepcion.centroNombre} />
          <Dato rotulo="Resultado" valor={<ChipResultado resultado={recepcion.resultado} />} />
        </div>
        <p className="mt-3 text-sm text-slate-300">{ok ? "Mercancía recibida conforme al albarán." : "La mercancía recibida no coincide con el albarán."}</p>

        <table className="mt-4 w-full text-sm">
          <thead>
            <tr className="text-[11px] uppercase text-slate-400">
              <th className="py-1 text-left">Producto</th>
              <th className="py-1 text-right">Albarán</th>
              <th className="py-1 text-right">Recibido</th>
              <th className="py-1 text-right">Dif.</th>
            </tr>
          </thead>
          <tbody>
            {ficha.lineas.map((l) => (
              <tr key={l.id} className="border-t border-slate-700/60">
                <td className="py-1.5 font-semibold">
                  {l.productoTexto ?? l.descripcionProveedor}
                  {l.productoTexto && l.productoTexto !== l.descripcionProveedor && <div className="text-[11px] font-normal text-slate-500">{l.descripcionProveedor}</div>}
                </td>
                <td className="py-1.5 text-right tabular-nums">{fmtCantidad(l.cantidadEsperada)}</td>
                <td className="py-1.5 text-right tabular-nums">{fmtCantidad(l.cantidadRecibida)}</td>
                <td className={`py-1.5 text-right font-bold tabular-nums ${l.diferencia === 0 ? "text-emerald-300" : "text-rose-300"}`}>{fmtDiferencia(l.diferencia)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {ficha.incidencias.length > 0 && (
          <div className="mt-4 space-y-2">
            {ficha.incidencias.map((i) => (
              <div key={i.id} className="rounded-xl border border-amber-500/40 bg-slate-900/50 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <b>{i.descripcionProducto}</b>
                  <ChipEstadoIncidencia estado={i.estado} />
                </div>
                <div className="mt-1 text-[13px] text-slate-300">
                  Albarán {fmtCantidad(i.cantidadEsperada)} · Recibidas {fmtCantidad(i.cantidadRecibida)} · Diferencia <b>{fmtDiferencia(i.diferencia)}</b> · {etiquetaTipoIncidencia(i.tipo)}
                </div>
                {i.observaciones && <div className="mt-1 text-[13px] italic text-slate-400">«{i.observaciones}»</div>}
              </div>
            ))}
          </div>
        )}

        {ficha.rectificaciones.length > 0 && (
          <div className="mt-4 rounded-xl border border-rose-500/40 bg-slate-900/50 p-3">
            <div className="text-[11px] font-bold uppercase text-rose-300">Rectificaciones</div>
            {ficha.rectificaciones.map((r) => (
              <div key={r.id} className="mt-1 text-[13px] text-slate-300">
                <b>{r.numero}</b> · {fmtFechaHora(r.rectificadoAt)} · {r.rectificadoNombre} · {r.motivo} ·{" "}
                {r.lineas.map((l) => `${fmtCantidad(l.cantidadAnterior)} → ${fmtCantidad(l.cantidadNueva)}`).join(", ")}
              </div>
            ))}
          </div>
        )}

        {recepcion.observaciones && <p className="mt-3 text-[13px] text-slate-400">Observaciones: {recepcion.observaciones}</p>}

        <div className="mt-4 flex flex-wrap gap-2 print:hidden">
          {puede("recepciones.rectificar") && (
            <button className={btnSecondary} onClick={() => setRectificando(true)}>
              Rectificar cantidades
            </button>
          )}
          {puede("recepciones.rectificar") && (
            <button className={`${btnMini} flex items-center gap-1`} onClick={() => void regenerar()} disabled={guardando}>
              <RefreshCw className="h-3 w-3" /> Regenerar documento
            </button>
          )}
        </div>
      </div>

      {/* El documento */}
      <div className="mt-4">
        <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-slate-400">Albarán recepcionado</h2>
        {recepcion.documentoEstado === "ERROR" && (
          <Aviso tono="mal">
            No se ha podido generar el documento: {recepcion.documentoError ?? "error desconocido"}. La recepción está registrada; regenera el documento cuando puedas.
          </Aviso>
        )}
        {recepcion.documentoEstado === "PENDIENTE" && <Aviso tono="info">El documento se está generando…</Aviso>}
        {documento && <VisorDocumento documentoId={documento.id} nombre={documento.nombreFichero} autoImprimir={params.get("imprimir") === "1"} />}
        <p className="mt-2 text-[11px] text-slate-500">
          Este papel es el justificante de la recepción. La entrada del albarán en GENES se hace después, a mano, con él delante.
        </p>
      </div>

      {rectificando && (
        <Modal
          title={`Rectificar ${recepcion.numero}`}
          onClose={() => setRectificando(false)}
          footer={
            <div className="flex justify-end gap-2">
              <button className={btnSecondary} onClick={() => setRectificando(false)}>
                Cancelar
              </button>
              <button className="rounded-xl bg-rose-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50" disabled={guardando || !motivo.trim()} onClick={() => void rectificar()}>
                Registrar rectificación
              </button>
            </div>
          }
        >
          <p className="mb-3 text-sm text-slate-300">
            La recepción original no cambia: queda una rectificación numerada con tu nombre, la hora, el motivo y la corrección. Los acumulados del albarán y del pedido pasan a usar la cantidad corregida.
          </p>
          <label className="mb-3 block">
            <span className="mb-1 block text-[10px] font-semibold uppercase text-slate-400">Motivo</span>
            <input className={inputCls} value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Error de conteo" />
          </label>
          {ficha.lineas.map((l) => (
            <div key={l.id} className="mb-2 flex items-center justify-between gap-3 rounded-lg border border-slate-700 p-2">
              <div className="text-sm">
                <b>{l.productoTexto ?? l.descripcionProveedor}</b>
                <div className="text-[11px] text-slate-500">Consta {fmtCantidad(l.cantidadRecibida)} · albarán {fmtCantidad(l.cantidadEsperada)}</div>
              </div>
              <input
                inputMode="decimal"
                className="h-10 w-20 rounded-lg border border-slate-600 bg-slate-900 text-center text-lg font-bold tabular-nums"
                value={cantidades[l.id] ?? 0}
                onChange={(e) => setCantidades((c) => ({ ...c, [l.id]: Math.max(0, Number(String(e.target.value).replace(",", ".")) || 0) }))}
              />
            </div>
          ))}
        </Modal>
      )}
    </div>
  );
}
