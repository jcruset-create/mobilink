/**
 * La ficha del pedido: líneas con las tres cantidades, sus albaranes (y el
 * alta manual de uno nuevo), sus recepciones, sus incidencias y la línea
 * temporal.
 */

import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, PackageCheck, Plus } from "lucide-react";
import * as api from "../services/api";
import { useRecepciones } from "../contexts/RecepcionesContext";
import { Aviso, ChipEstadoAlbaran, ChipEstadoIncidencia, ChipEstadoPedido, ChipResultado, Dato, ErrorBox, Modal, SinMapear, TextField, btnDanger, btnPrimary, btnSecondary, inputCls } from "../components/ui";
import Timeline from "../components/Timeline";
import { fmtCantidad, fmtEuros, type FichaPedido } from "../types";
import { fmtFecha, fmtFechaHora } from "../../administracion/types";

export default function Pedido() {
  const { id = "" } = useParams();
  const { puede, etiquetaTipoIncidencia, refrescar } = useRecepciones();
  const [ficha, setFicha] = useState<FichaPedido | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nuevoAlbaran, setNuevoAlbaran] = useState(false);
  const [cancelando, setCancelando] = useState(false);
  const [motivo, setMotivo] = useState("");

  const cargar = useCallback(async () => {
    try {
      setFicha(await api.fichaPedido(id));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se ha podido cargar el pedido");
    }
  }, [id]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  if (error && !ficha) return <ErrorBox>{error}</ErrorBox>;
  if (!ficha) return <p className="text-sm text-slate-400">Cargando…</p>;
  const { pedido } = ficha;
  const puedeAlbaran = puede("recepciones.albaran.create") && pedido.estado !== "CANCELADO" && pedido.estado !== "COMPLETADO" && pedido.estado !== "EXPEDIDO";

  async function cancelar() {
    try {
      await api.cancelarPedido(pedido.id, motivo);
      setCancelando(false);
      await Promise.all([cargar(), refrescar()]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se ha podido cancelar");
    }
  }

  return (
    <div className="mx-auto max-w-5xl">
      <Link to="/recepciones/pedidos" className="mb-2 inline-flex items-center gap-1 text-[12px] text-slate-400 hover:text-slate-200">
        <ArrowLeft className="h-3.5 w-3.5" /> Pedidos
      </Link>
      {error && <ErrorBox>{error}</ErrorBox>}

      <div className="rounded-2xl border border-slate-700 bg-slate-800 p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <div className="text-[11px] font-bold uppercase tracking-wide text-slate-400">{pedido.proveedorNombre}</div>
            <div className="text-2xl font-black">Pedido {pedido.numeroProveedor}</div>
          </div>
          <ChipEstadoPedido estado={pedido.estado} />
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Dato rotulo="Fecha" valor={fmtFecha(pedido.fechaPedido)} />
          <Dato rotulo="Centro destino" valor={pedido.centroNombre} />
          <Dato rotulo="Origen" valor={pedido.almacenOrigen} />
          <Dato rotulo="Transportista" valor={pedido.transportista} />
          <Dato rotulo="Usuario pedido" valor={pedido.usuarioPedido} />
          <Dato rotulo="Creado por" valor={pedido.creadoNombre} />
          <Dato rotulo="Origen del dato" valor={pedido.origen === "MANUAL" ? "Manual" : "Correo del proveedor"} />
          <Dato rotulo="Cliente (según proveedor)" valor={pedido.clienteProveedor} />
          <Dato rotulo="Dirección de destino" valor={pedido.destinoTexto ? <span className="whitespace-pre-line">{pedido.destinoTexto}</span> : null} />
          {pedido.canceladoMotivo && <Dato rotulo="Cancelado" valor={pedido.canceladoMotivo} />}
        </div>
        {/* Sin este aviso, «cantidad pedida» se lee como lo que se encargó, y
            en un pedido deducido es sólo lo que el proveedor dice haber
            expedido hasta ahora. */}
        {pedido.derivadoDeAlbaran && (
          <div className="mt-3">
            <Aviso tono="aviso">
              Este pedido no lo mandó el proveedor: se ha <b>deducido de su albarán</b> porque el correo del pedido no había llegado. La
              cantidad pedida es lo expedido hasta ahora, no lo que se encargó, y crecerá con cada albarán nuevo. Cuando llegue el correo del
              pedido se confirmará solo.
            </Aviso>
          </div>
        )}
        {pedido.observaciones && <p className="mt-2 text-[13px] text-slate-400">{pedido.observaciones}</p>}
        <div className="mt-3 flex flex-wrap gap-2">
          {puedeAlbaran && (
            <button className={`${btnPrimary} flex items-center gap-2`} onClick={() => setNuevoAlbaran(true)}>
              <Plus className="h-4 w-4" /> Asociar albarán
            </button>
          )}
          {puede("recepciones.pedido.create") && pedido.estado !== "CANCELADO" && ficha.recepciones.length === 0 && (
            <button className={btnDanger} onClick={() => setCancelando(true)}>
              Cancelar pedido
            </button>
          )}
        </div>
      </div>

      {/* Líneas: las tres cantidades */}
      <h2 className="mb-2 mt-5 text-sm font-bold uppercase tracking-wide text-slate-400">Líneas</h2>
      <div className="overflow-x-auto rounded-lg border border-slate-700 bg-slate-800">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[11px] uppercase text-slate-400">
              <th className="px-3 py-2 text-left">Producto</th>
              <th className="px-3 py-2 text-right">Pedida</th>
              <th className="px-3 py-2 text-right">Expedida</th>
              <th className="px-3 py-2 text-right">Recibida</th>
              <th className="px-3 py-2 text-right">Pdte. expedir</th>
              {puede("recepciones.pedido.create") && <th className="px-3 py-2 text-right">Precio</th>}
            </tr>
          </thead>
          <tbody>
            {ficha.lineas.map((l) => (
              <tr key={l.id} className="border-t border-slate-700/60">
                <td className="px-3 py-2">
                  <div className="font-semibold">{l.productoTexto ?? l.descripcionProveedor}</div>
                  <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
                    {l.productoTexto && l.productoTexto !== l.descripcionProveedor && <span>{l.descripcionProveedor}</span>}
                    {l.referenciaProveedor && <span>Ref. {l.referenciaProveedor}</span>}
                    {!l.productoId && !l.productoTexto && <SinMapear />}
                  </div>
                </td>
                <td className="px-3 py-2 text-right font-bold tabular-nums">{fmtCantidad(l.cantidadPedida)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{fmtCantidad(l.cantidadExpedida)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{fmtCantidad(l.cantidadRecibida)}</td>
                <td className={`px-3 py-2 text-right tabular-nums ${l.cantidadPedida - l.cantidadExpedida > 0 ? "text-sky-300" : "text-slate-500"}`}>
                  {fmtCantidad(Math.max(0, l.cantidadPedida - l.cantidadExpedida))}
                </td>
                {puede("recepciones.pedido.create") && <td className="px-3 py-2 text-right tabular-nums">{fmtEuros(l.precioUnitarioCentimos)}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Albaranes */}
      <h2 className="mb-2 mt-5 text-sm font-bold uppercase tracking-wide text-slate-400">Albaranes ({ficha.albaranes.length})</h2>
      {ficha.albaranes.length === 0 && <p className="text-sm text-slate-500">Todavía no hay ningún albarán: el pedido está pendiente de expedición.</p>}
      <div className="space-y-2">
        {ficha.albaranes.map((a) => (
          <div key={a.id} className="rounded-xl border border-slate-700 bg-slate-800 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <Link to={`/recepciones/albaranes/${a.id}`} className="text-lg font-black hover:underline">
                  Albarán {a.numeroProveedor}
                </Link>
                <div className="text-[12px] text-slate-400">
                  {fmtFecha(a.fechaExpedicion)} · {a.transportista ?? "—"} · {a.lineas.reduce((s, l) => s + l.cantidadExpedida, 0)} uds. expedidas ·{" "}
                  {a.lineas.reduce((s, l) => s + l.cantidadRecibida, 0)} recibidas
                  {a.documentos.some((d) => d.tipo === "ALBARAN_ORIGINAL") ? " · original adjunto" : ""}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <ChipEstadoAlbaran estado={a.estado} />
                {puede("recepciones.recibir") && (a.estado === "EN_TRANSITO" || a.estado === "PARCIALMENTE_RECIBIDO") && (
                  <Link to={`/recepciones/recibir/${a.id}`} className="inline-flex items-center gap-1 rounded-xl bg-emerald-600 px-3 py-1.5 text-[12px] font-bold text-white hover:bg-emerald-500">
                    <PackageCheck className="h-4 w-4" /> Recibir
                  </Link>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Recepciones */}
      {ficha.recepciones.length > 0 && (
        <>
          <h2 className="mb-2 mt-5 text-sm font-bold uppercase tracking-wide text-slate-400">Recepciones</h2>
          <div className="space-y-2">
            {ficha.recepciones.map((r) => (
              <Link key={r.id} to={`/recepciones/recepciones/${r.id}`} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-700 bg-slate-800 p-3 hover:bg-slate-700/40">
                <div>
                  <b>{r.numero}</b>
                  <div className="text-[12px] text-slate-400">
                    {fmtFechaHora(r.recibidoAt)} · {r.operarioNombre || r.recibidoNombre} · {r.lineas.reduce((s, l) => s + l.cantidadRecibida, 0)} uds.
                  </div>
                </div>
                <ChipResultado resultado={r.resultado} />
              </Link>
            ))}
          </div>
        </>
      )}

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

      <h2 className="mb-2 mt-5 text-sm font-bold uppercase tracking-wide text-slate-400">Historial</h2>
      <Timeline eventos={ficha.eventos} />

      {nuevoAlbaran && (
        <NuevoAlbaran
          ficha={ficha}
          onClose={() => setNuevoAlbaran(false)}
          onCreado={async () => {
            setNuevoAlbaran(false);
            await Promise.all([cargar(), refrescar()]);
          }}
        />
      )}

      {cancelando && (
        <Modal
          title="Cancelar pedido"
          onClose={() => setCancelando(false)}
          footer={
            <div className="flex justify-end gap-2">
              <button className={btnSecondary} onClick={() => setCancelando(false)}>
                Volver
              </button>
              <button className={btnDanger} disabled={!motivo.trim()} onClick={() => void cancelar()}>
                Cancelar el pedido
              </button>
            </div>
          }
        >
          <TextField label="Motivo" value={motivo} onChange={setMotivo} />
        </Modal>
      )}
    </div>
  );
}

function NuevoAlbaran({ ficha, onClose, onCreado }: { ficha: FichaPedido; onClose: () => void; onCreado: () => Promise<void> }) {
  const [numero, setNumero] = useState("");
  const [fecha, setFecha] = useState(new Date().toISOString().slice(0, 10));
  const [transportista, setTransportista] = useState(ficha.pedido.transportista ?? "");
  const [cantidades, setCantidades] = useState<Record<string, string>>(
    Object.fromEntries(ficha.lineas.map((l) => [l.id, String(Math.max(0, l.cantidadPedida - l.cantidadExpedida))]))
  );
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  async function guardar() {
    setGuardando(true);
    try {
      await api.crearAlbaran(ficha.pedido.id, {
        numeroProveedor: numero,
        fechaExpedicion: fecha || undefined,
        transportista: transportista || undefined,
        lineas: ficha.lineas
          .map((l) => ({ pedidoLineaId: l.id, cantidadExpedida: Number((cantidades[l.id] ?? "0").replace(",", ".")) || 0 }))
          .filter((l) => l.cantidadExpedida > 0),
      });
      await onCreado();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se ha podido crear el albarán");
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Modal
      title={`Asociar albarán al pedido ${ficha.pedido.numeroProveedor}`}
      onClose={onClose}
      footer={
        <div className="flex justify-end gap-2">
          <button className={btnSecondary} onClick={onClose}>
            Cancelar
          </button>
          <button className={btnPrimary} onClick={() => void guardar()} disabled={guardando || !numero.trim()}>
            {guardando ? "Guardando…" : "Asociar albarán · en tránsito"}
          </button>
        </div>
      }
    >
      {error && <ErrorBox>{error}</ErrorBox>}
      <p className="mb-3 text-sm text-slate-300">Al asociarlo, el albarán queda <b>EN TRÁNSITO</b> y aparece en Recepciones pendientes. Que el proveedor lo emita no significa que la mercancía esté aquí.</p>
      <div className="grid gap-3 sm:grid-cols-3">
        <TextField label="Número de albarán" value={numero} onChange={setNumero} placeholder="2028450461" />
        <TextField label="Fecha de expedición" value={fecha} onChange={setFecha} type="date" />
        <TextField label="Transportista" value={transportista} onChange={setTransportista} placeholder="TRANSAHER" />
      </div>
      <div className="mt-3">
        <div className="mb-1 text-[10px] font-semibold uppercase text-slate-400">Cantidades expedidas por línea</div>
        {ficha.lineas.map((l) => {
          const pendiente = Math.max(0, l.cantidadPedida - l.cantidadExpedida);
          return (
            <div key={l.id} className="mb-2 flex items-center justify-between gap-3 rounded-lg border border-slate-700 p-2">
              <div className="text-sm">
                <b>{l.productoTexto ?? l.descripcionProveedor}</b>
                <div className="text-[11px] text-slate-500">
                  Pedidas {fmtCantidad(l.cantidadPedida)} · ya expedidas {fmtCantidad(l.cantidadExpedida)} · pendientes {fmtCantidad(pendiente)}
                </div>
              </div>
              <input
                className={`${inputCls} w-24 text-center text-lg font-bold`}
                inputMode="decimal"
                value={cantidades[l.id] ?? ""}
                disabled={pendiente === 0}
                onChange={(e) => setCantidades((c) => ({ ...c, [l.id]: e.target.value }))}
              />
            </div>
          );
        })}
      </div>
    </Modal>
  );
}
