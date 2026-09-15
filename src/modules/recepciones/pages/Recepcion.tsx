/**
 * LA pantalla del operario: recepcionar un albarán.
 *
 * Prioridad absoluta: velocidad. Abrir, comprobar, pulsar RECEPCIÓN OK. Nada
 * que teclear: usuario, fecha y hora los pone el servidor. Sólo si hay
 * incidencia se despliega, línea a línea, la cantidad real (−/+ de 44 px, que
 * es lo mínimo cómodo con el dedo), el motivo y las observaciones.
 *
 * La `Idempotency-Key` se genera al abrir la pantalla: un doble toque en el
 * botón —o un reintento tras perder la red— devuelve la misma recepción.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { AlertTriangle, ArrowLeft, Check, Minus, Plus } from "lucide-react";
import * as api from "../services/api";
import { useRecepciones } from "../contexts/RecepcionesContext";
import { Aviso, ChipEstadoAlbaran, ErrorBox, SinMapear, inputCls } from "../components/ui";
import { fmtCantidad, fmtDiferencia, type FichaAlbaran, type TipoIncidencia } from "../types";

type Edicion = { cantidad: number; tipo: TipoIncidencia | ""; observaciones: string };

function claveIdempotencia(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export default function Recepcion() {
  const { albaranId = "" } = useParams();
  const navigate = useNavigate();
  const { puede, vocabulario, usuario } = useRecepciones();
  const [ficha, setFicha] = useState<FichaAlbaran | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [modoIncidencia, setModoIncidencia] = useState(false);
  const [edicion, setEdicion] = useState<Record<string, Edicion>>({});
  const [observaciones, setObservaciones] = useState("");
  const [confirmando, setConfirmando] = useState<"OK" | "CON_INCIDENCIA" | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [clave] = useState(claveIdempotencia);

  const cargar = useCallback(async () => {
    try {
      const f = await api.fichaAlbaran(albaranId);
      setFicha(f);
      setEdicion(Object.fromEntries(f.lineas.map((l) => [l.id, { cantidad: l.cantidadPendiente, tipo: "", observaciones: "" }])));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se ha podido cargar el albarán");
    }
  }, [albaranId]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const lineas = ficha?.lineas ?? [];
  const pendientes = useMemo(() => lineas.filter((l) => l.cantidadPendiente > 0), [lineas]);

  function fijar(id: string, cambio: Partial<Edicion>) {
    setEdicion((e) => ({ ...e, [id]: { ...e[id], ...cambio } }));
  }

  async function cerrar(resultado: "OK" | "CON_INCIDENCIA") {
    if (!ficha) return;
    setEnviando(true);
    try {
      const r = await api.cerrarRecepcion(
        ficha.albaran.id,
        {
          resultado,
          observaciones: observaciones || undefined,
          lineas:
            resultado === "CON_INCIDENCIA"
              ? pendientes.map((l) => {
                  const e = edicion[l.id];
                  return {
                    albaranLineaId: l.id,
                    cantidadRecibida: e.cantidad,
                    incidencia: e.tipo ? { tipo: e.tipo, observaciones: e.observaciones || undefined } : null,
                  };
                })
              : undefined,
        },
        clave
      );
      navigate(`/recepciones/recepciones/${r.recepcion.id}?imprimir=1`, { replace: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se ha podido cerrar la recepción");
      setConfirmando(null);
      // Si otro la cerró mientras tanto, la pantalla tiene que enseñar lo nuevo.
      void cargar();
    } finally {
      setEnviando(false);
    }
  }

  if (!puede("recepciones.recibir")) return <Aviso tono="aviso">Tu usuario no tiene permiso para recepcionar mercancía.</Aviso>;
  if (error && !ficha) return <ErrorBox>{error}</ErrorBox>;
  if (!ficha) return <p className="text-sm text-slate-400">Cargando…</p>;

  const { albaran } = ficha;
  const hayDiferencias = pendientes.some((l) => edicion[l.id]?.cantidad !== l.cantidadPendiente || edicion[l.id]?.tipo);

  return (
    <div className="mx-auto max-w-3xl pb-32">
      <Link to="/recepciones/bandeja" className="mb-2 inline-flex items-center gap-1 text-[12px] text-slate-400 hover:text-slate-200 print:hidden">
        <ArrowLeft className="h-3.5 w-3.5" /> Recepciones pendientes
      </Link>

      {/* Cabecera del albarán */}
      <div className="rounded-2xl border border-slate-700 bg-slate-800 p-4">
        <div className="text-[11px] font-bold uppercase tracking-wide text-slate-400">{albaran.proveedorNombre}</div>
        <div className="mt-1 text-3xl font-black leading-tight">Albarán {albaran.numeroProveedor}</div>
        <div className="mt-1 text-base text-slate-300">Pedido {albaran.pedidoNumero}</div>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-[13px] text-slate-300">
          <ChipEstadoAlbaran estado={albaran.estado} />
          {albaran.transportista && <span className="rounded-full bg-slate-700 px-2 py-0.5">{albaran.transportista}</span>}
          {albaran.centroNombre && <span className="rounded-full bg-slate-700 px-2 py-0.5">{albaran.centroNombre}</span>}
        </div>
        {usuario && <div className="mt-2 text-[12px] text-slate-500">Recibe: {usuario.nombre} · fecha y hora las pone el sistema al cerrar.</div>}
      </div>

      {error && <div className="mt-3"><ErrorBox>{error}</ErrorBox></div>}

      {!ficha.recibible && (
        <div className="mt-3">
          <Aviso tono="aviso">
            Este albarán ya no admite recepciones.{" "}
            <Link to={`/recepciones/albaranes/${albaran.id}`} className="underline">
              Ver la ficha
            </Link>
            .
          </Aviso>
        </div>
      )}

      {/* Líneas */}
      <div className="mt-3 space-y-3">
        {lineas.map((l) => {
          const e = edicion[l.id];
          const pendiente = l.cantidadPendiente;
          const editable = modoIncidencia && pendiente > 0 && ficha.recibible;
          const dif = e ? e.cantidad - pendiente : 0;
          return (
            <div key={l.id} className={`rounded-2xl border p-4 ${pendiente > 0 ? "border-slate-700 bg-slate-800" : "border-slate-800 bg-slate-900 opacity-60"}`}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <div className="text-xl font-black leading-tight">{l.articuloLeido}</div>
                  {l.articuloLeido !== l.descripcionProveedor && <div className="text-[12px] text-slate-400">{l.descripcionProveedor}</div>}
                </div>
                {l.sinMapear && <SinMapear />}
              </div>

              <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                <div className="rounded-xl bg-slate-900/60 p-2">
                  <div className="text-[10px] font-bold uppercase text-slate-500">Pedido</div>
                  <div className="text-2xl font-black tabular-nums">{fmtCantidad(l.cantidadPedida ?? l.cantidadExpedida)}</div>
                </div>
                <div className="rounded-xl bg-slate-900/60 p-2">
                  <div className="text-[10px] font-bold uppercase text-slate-500">Expedido</div>
                  <div className="text-2xl font-black tabular-nums">{fmtCantidad(l.cantidadExpedida)}</div>
                  {l.cantidadRecibida > 0 && <div className="text-[10px] text-slate-500">ya recibido {fmtCantidad(l.cantidadRecibida)}</div>}
                </div>
                <div className={`rounded-xl p-2 ${editable ? "bg-amber-500/10 ring-1 ring-amber-500/50" : "bg-emerald-500/10"}`}>
                  <div className="text-[10px] font-bold uppercase text-slate-500">Recibido</div>
                  {editable ? (
                    <div className="flex items-center justify-center gap-1">
                      <button type="button" aria-label="Menos" className="flex h-11 w-11 items-center justify-center rounded-lg bg-slate-700 text-slate-100 active:bg-slate-600" onClick={() => fijar(l.id, { cantidad: Math.max(0, e.cantidad - 1) })}>
                        <Minus className="h-5 w-5" />
                      </button>
                      <input
                        inputMode="decimal"
                        className="h-11 w-16 rounded-lg border border-slate-600 bg-slate-900 text-center text-2xl font-black tabular-nums text-slate-100"
                        value={e.cantidad}
                        onChange={(ev) => fijar(l.id, { cantidad: Math.max(0, Number(String(ev.target.value).replace(",", ".")) || 0) })}
                      />
                      <button type="button" aria-label="Más" className="flex h-11 w-11 items-center justify-center rounded-lg bg-slate-700 text-slate-100 active:bg-slate-600" onClick={() => fijar(l.id, { cantidad: e.cantidad + 1 })}>
                        <Plus className="h-5 w-5" />
                      </button>
                    </div>
                  ) : (
                    <div className="text-2xl font-black tabular-nums text-emerald-300">{fmtCantidad(pendiente > 0 ? (e?.cantidad ?? pendiente) : l.cantidadRecibida)}</div>
                  )}
                </div>
              </div>

              {editable && (
                <div className="mt-3 space-y-2">
                  <div className={`text-sm font-bold ${dif === 0 ? "text-emerald-300" : "text-rose-300"}`}>
                    Diferencia respecto al albarán: {fmtDiferencia(dif)}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {(vocabulario?.tiposIncidencia ?? []).map((t) => (
                      <button
                        key={t}
                        type="button"
                        onClick={() => fijar(l.id, { tipo: e.tipo === t ? "" : t })}
                        className={`h-10 rounded-lg px-3 text-[12px] font-bold ${e.tipo === t ? "bg-amber-500 text-slate-900" : "bg-slate-700 text-slate-200"}`}
                      >
                        {vocabulario?.etiquetas.tipoIncidencia[t] ?? t}
                      </button>
                    ))}
                  </div>
                  {(e.tipo || dif !== 0) && (
                    <textarea className={inputCls} rows={2} placeholder="Observaciones (p. ej. «Solo llega una cubierta»)" value={e.observaciones} onChange={(ev) => fijar(l.id, { observaciones: ev.target.value })} />
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {modoIncidencia && (
        <div className="mt-3">
          <textarea className={inputCls} rows={2} placeholder="Observaciones generales de la recepción (opcional)" value={observaciones} onChange={(e) => setObservaciones(e.target.value)} />
        </div>
      )}

      {/* Acciones: fijas abajo, grandes */}
      {ficha.recibible && (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t border-slate-700 bg-slate-900/95 p-3 backdrop-blur print:hidden">
          <div className="mx-auto flex max-w-3xl flex-col gap-2 sm:flex-row">
            {!modoIncidencia ? (
              <>
                <button type="button" disabled={enviando} onClick={() => setConfirmando("OK")} className="flex h-16 flex-1 items-center justify-center gap-2 rounded-2xl bg-emerald-600 text-lg font-black text-white active:bg-emerald-500 disabled:opacity-40">
                  <Check className="h-6 w-6" /> RECEPCIÓN OK
                </button>
                <button type="button" disabled={enviando} onClick={() => setModoIncidencia(true)} className="flex h-16 flex-1 items-center justify-center gap-2 rounded-2xl bg-amber-600 text-lg font-black text-white active:bg-amber-500 disabled:opacity-40">
                  <AlertTriangle className="h-6 w-6" /> HAY INCIDENCIA
                </button>
              </>
            ) : (
              <>
                <button type="button" disabled={enviando} onClick={() => setModoIncidencia(false)} className="flex h-16 flex-1 items-center justify-center rounded-2xl bg-slate-700 text-base font-bold text-slate-100 sm:max-w-[180px]">
                  Volver
                </button>
                <button
                  type="button"
                  disabled={enviando || !hayDiferencias}
                  onClick={() => setConfirmando("CON_INCIDENCIA")}
                  className="flex h-16 flex-1 items-center justify-center gap-2 rounded-2xl bg-amber-600 text-lg font-black text-white active:bg-amber-500 disabled:opacity-40"
                >
                  <AlertTriangle className="h-6 w-6" /> CERRAR CON INCIDENCIA
                </button>
              </>
            )}
          </div>
          {modoIncidencia && !hayDiferencias && <p className="mx-auto mt-1 max-w-3xl text-center text-[11px] text-slate-400">Cambia alguna cantidad o marca un motivo en una línea.</p>}
        </div>
      )}

      {/* Confirmación en dos toques: evita el toque accidental */}
      {confirmando && (
        <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/60 p-4 sm:items-center">
          <div className="w-full max-w-md rounded-2xl border border-slate-700 bg-slate-800 p-5">
            <div className="text-lg font-black">{confirmando === "OK" ? "¿Recepción OK?" : "¿Cerrar con incidencia?"}</div>
            <p className="mt-1 text-sm text-slate-300">
              {confirmando === "OK"
                ? `Se dan por recibidas las ${fmtCantidad(pendientes.reduce((s, l) => s + l.cantidadPendiente, 0))} unidades pendientes del albarán ${albaran.numeroProveedor}.`
                : "Se registran las cantidades indicadas y se abre una incidencia por cada diferencia."}
            </p>
            <p className="mt-1 text-[12px] text-slate-500">Quedará a nombre de {usuario?.nombre ?? "tu usuario"} con la fecha y hora del servidor, y se generará el albarán recepcionado para imprimir.</p>
            <div className="mt-4 flex gap-2">
              <button type="button" className="h-12 flex-1 rounded-xl bg-slate-700 font-bold" onClick={() => setConfirmando(null)} disabled={enviando}>
                Cancelar
              </button>
              <button
                type="button"
                className={`h-12 flex-1 rounded-xl font-black text-white ${confirmando === "OK" ? "bg-emerald-600" : "bg-amber-600"} disabled:opacity-50`}
                onClick={() => void cerrar(confirmando)}
                disabled={enviando}
              >
                {enviando ? "Cerrando…" : "Confirmar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
