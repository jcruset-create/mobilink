/**
 * Las facturas que ya han llegado solas, esperando a que alguien las cobre.
 *
 * El bloque es deliberadamente pequeño. AutoScan no cambia cómo se cobra: el
 * dinero se sigue contando igual y lo confirma la misma persona. Lo único que
 * cambia es de dónde sale el papel — de un escáner del mostrador en vez de un
 * `<input type="file">`—, así que ocupa el sitio de un adjunto, no el de una
 * pantalla.
 *
 * ## Por qué se esconde
 *
 * Si el centro no tiene ningún escáner dado de alta, este bloque no existe.
 * Un contador a cero permanente en una pantalla que se usa cien veces al día
 * es ruido, y el ruido se deja de mirar — incluido el día que sí diga algo.
 *
 * ## Abrir un documento no cuesta dinero
 *
 * El análisis se hizo una vez, cuando el documento llegó, y está guardado.
 * Pinchar en una factura para verla —o pincharla, cambiar de idea y pinchar
 * otra— no vuelve a llamar a la IA. Eso vive en el servidor
 * (`propuestaDeEscaneo` reconstruye lo ya analizado), pero conviene saberlo
 * aquí: es la razón de que no haya ninguna confirmación antes de elegir.
 */

import { useCallback, useEffect, useState } from "react";
import { FileText, Inbox, Loader2, RefreshCw, ScanLine, Trash2, TriangleAlert } from "lucide-react";
import type { DocumentoAutoScan, PropuestaEscaneo, ResumenAutoScan } from "../types";
import * as api from "../services/api";

/**
 * Cada cuánto se vuelve a preguntar: 20 segundos.
 *
 * El worker mira la cola cada 15, así que preguntar más a menudo solo daría
 * la misma respuesta. Y no hay que ganarle tiempo a nadie: la factura llegó
 * mientras el cliente venía andando desde el taller.
 */
const CADA_MS = 20_000;

const kb = (bytes: number) =>
  bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;

const hora = (ms: number) =>
  new Date(ms).toLocaleString("es-ES", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

type Props = {
  /** El documento que la pantalla está usando ahora, si es de la bandeja. */
  elegido: number | null;
  /** Se ha elegido una factura: la propuesta ya analizada viene con ella. */
  onElegir: (documento: DocumentoAutoScan, propuesta: PropuestaEscaneo) => void;
  /** Se ha soltado la factura elegida sin cobrarla. */
  onSoltar: () => void;
  /** Puede descartar y reintentar. Ver es suficiente para elegir. */
  puedeGestionar: boolean;
  deshabilitado?: boolean;
  onError: (mensaje: string) => void;
};

export default function BandejaAutoScan({
  elegido,
  onElegir,
  onSoltar,
  puedeGestionar,
  deshabilitado = false,
  onError,
}: Props) {
  const [documentos, setDocumentos] = useState<DocumentoAutoScan[]>([]);
  const [resumen, setResumen] = useState<ResumenAutoScan | null>(null);
  const [abierta, setAbierta] = useState(false);
  const [cargandoId, setCargandoId] = useState<number | null>(null);

  const refrescar = useCallback(async () => {
    try {
      const r = await api.bandejaAutoScan();
      setDocumentos(r.documentos);
      setResumen(r.resumen);
    } catch {
      /*
       * En silencio. Que la bandeja no conteste no puede sacar un error rojo
       * encima de un cobro a medio hacer: el cobro no depende de esto.
       */
    }
  }, []);

  useEffect(() => {
    void refrescar();
    const t = setInterval(() => void refrescar(), CADA_MS);
    return () => clearInterval(t);
  }, [refrescar]);

  // El centro no tiene escáneres: aquí no hay nada que enseñar.
  if (!resumen?.hayDispositivos) return null;

  async function elegir(d: DocumentoAutoScan) {
    setCargandoId(d.id);
    try {
      const { documento, propuesta } = await api.documentoAutoScan(d.id);
      if (!propuesta) {
        onError("Ese documento todavía no está analizado. Espera un momento y vuelve a probar.");
        return;
      }
      onElegir(documento, propuesta);
      setAbierta(false);
    } catch (e) {
      onError(e instanceof Error ? e.message : "No se ha podido abrir el documento.");
    } finally {
      setCargandoId(null);
    }
  }

  async function descartar(d: DocumentoAutoScan) {
    setCargandoId(d.id);
    try {
      await api.descartarAutoScan(d.id);
      if (elegido === d.id) onSoltar();
      await refrescar();
    } catch (e) {
      onError(e instanceof Error ? e.message : "No se ha podido descartar el documento.");
    } finally {
      setCargandoId(null);
    }
  }

  async function reintentar(d: DocumentoAutoScan) {
    setCargandoId(d.id);
    try {
      await api.reintentarAutoScan(d.id);
      await refrescar();
    } catch (e) {
      onError(e instanceof Error ? e.message : "No se ha podido reintentar el análisis.");
    } finally {
      setCargandoId(null);
    }
  }

  const elegida = documentos.find((d) => d.id === elegido) ?? null;

  return (
    <div className="mt-3 rounded-lg border border-slate-700 bg-slate-900/40 p-2.5">
      <button
        type="button"
        onClick={() => setAbierta((v) => !v)}
        className="flex w-full items-center gap-2 text-left"
      >
        <Inbox className="h-4 w-4 shrink-0 text-slate-400" />
        <span className="text-[11px] font-bold uppercase tracking-wide text-slate-400">
          Facturas escaneadas
        </span>
        <Contador resumen={resumen} />
        <span className="ml-auto text-[11px] text-slate-500">{abierta ? "Ocultar" : "Ver"}</span>
      </button>

      {/*
        La factura elegida se ve SIEMPRE, con la bandeja abierta o cerrada. Es
        lo que se va a colgar del cobro que se está confirmando, y no saberlo
        es la forma de acabar adjuntando la factura de otro coche.
      */}
      {elegida && (
        <div className="mt-2 flex items-center gap-2 rounded-lg border border-sky-700/60 bg-sky-950/40 px-2.5 py-1.5">
          <ScanLine className="h-4 w-4 shrink-0 text-sky-300" />
          <span className="min-w-0 flex-1 truncate text-[12px] text-sky-100">
            {elegida.nombreOriginal}
          </span>
          <button
            type="button"
            onClick={onSoltar}
            disabled={deshabilitado}
            className="shrink-0 text-[11px] text-sky-300 underline underline-offset-2 hover:text-sky-200 disabled:opacity-40"
          >
            Soltar
          </button>
        </div>
      )}

      {abierta && (
        <div className="mt-2 space-y-1.5">
          {documentos.length === 0 && (
            <p className="text-[11px] text-slate-500">
              No hay ninguna factura esperando. Las que deje el escáner aparecerán aquí solas.
            </p>
          )}

          {documentos.map((d) => (
            <Fila
              key={d.id}
              documento={d}
              elegido={elegido === d.id}
              ocupado={cargandoId === d.id}
              deshabilitado={deshabilitado || cargandoId != null}
              puedeGestionar={puedeGestionar}
              onElegir={() => void elegir(d)}
              onDescartar={() => void descartar(d)}
              onReintentar={() => void reintentar(d)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * El contador.
 *
 * Enseña lo que se puede usar YA en verde, y lo que aún no en gris. Un solo
 * número —«3 esperando»— haría que alguien abriera la bandeja para descubrir
 * que las tres están analizándose todavía.
 */
function Contador({ resumen }: { resumen: ResumenAutoScan }) {
  const { listos, analizando, fallidos } = resumen;
  if (listos === 0 && analizando === 0 && fallidos === 0) {
    return <span className="text-[11px] text-slate-500">al día</span>;
  }
  return (
    <span className="flex items-center gap-1.5">
      {listos > 0 && (
        <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-[11px] font-bold text-emerald-300">
          {listos} {listos === 1 ? "lista" : "listas"}
        </span>
      )}
      {analizando > 0 && (
        <span className="rounded-full bg-slate-700 px-2 py-0.5 text-[11px] font-medium text-slate-300">
          {analizando} analizando
        </span>
      )}
      {fallidos > 0 && (
        <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-[11px] font-medium text-amber-300">
          {fallidos} sin leer
        </span>
      )}
    </span>
  );
}

function Fila({
  documento: d,
  elegido,
  ocupado,
  deshabilitado,
  puedeGestionar,
  onElegir,
  onDescartar,
  onReintentar,
}: {
  documento: DocumentoAutoScan;
  elegido: boolean;
  ocupado: boolean;
  deshabilitado: boolean;
  puedeGestionar: boolean;
  onElegir: () => void;
  onDescartar: () => void;
  onReintentar: () => void;
}) {
  const usable = d.estado === "LISTO";

  return (
    <div
      className={`rounded-lg px-2.5 py-1.5 ${
        elegido ? "bg-sky-950/40 ring-1 ring-sky-700/60" : "bg-slate-800"
      }`}
    >
      <div className="flex items-center gap-2">
        {ocupado ? (
          <Loader2 className="h-4 w-4 shrink-0 animate-spin text-slate-400" />
        ) : (
          <FileText className="h-4 w-4 shrink-0 text-slate-400" />
        )}
        <span className="min-w-0 flex-1 truncate text-[12px] text-slate-200">
          {d.nombreOriginal}
        </span>

        {usable ? (
          <button
            type="button"
            onClick={onElegir}
            disabled={deshabilitado || elegido}
            className="shrink-0 rounded-lg bg-sky-600 px-2.5 py-1 text-[11px] font-bold text-white hover:bg-sky-500 disabled:opacity-40"
          >
            {elegido ? "Elegida" : "Usar"}
          </button>
        ) : (
          <Estado documento={d} />
        )}

        {puedeGestionar && d.estado === "FALLIDO" && (
          <button
            type="button"
            onClick={onReintentar}
            disabled={deshabilitado}
            title="Volver a analizarla"
            className="shrink-0 rounded p-1 text-slate-400 hover:bg-slate-700 hover:text-slate-200 disabled:opacity-40"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
        )}
        {puedeGestionar && (
          <button
            type="button"
            onClick={onDescartar}
            disabled={deshabilitado}
            title="Descartar: no es una factura que haya que cobrar"
            className="shrink-0 rounded p-1 text-slate-400 hover:bg-slate-700 hover:text-rose-300 disabled:opacity-40"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-slate-500">
        <span>{hora(d.recibidoAtMs)}</span>
        {d.deviceNombre && <span>· {d.deviceNombre}</span>}
        <span>· {kb(d.tamanoBytes)}</span>
        {/*
          Lo antiguo se avisa, no se esconde ni se borra: una factura de hace
          cinco semanas sin cobrar es exactamente lo que hay que mirar.
        */}
        {d.esAntiguo && (
          <span className="flex items-center gap-1 text-amber-400">
            <TriangleAlert className="h-3 w-3" /> lleva más de 30 días
          </span>
        )}
      </div>

      {d.estado === "FALLIDO" && d.error && (
        <p className="mt-0.5 text-[11px] text-amber-300">{d.error}</p>
      )}
    </div>
  );
}

function Estado({ documento: d }: { documento: DocumentoAutoScan }) {
  if (d.estado === "ANALIZANDO") {
    return <span className="shrink-0 text-[11px] text-slate-400">analizando…</span>;
  }
  if (d.estado === "PENDIENTE") {
    return <span className="shrink-0 text-[11px] text-slate-500">en cola</span>;
  }
  if (d.estado === "FALLIDO") {
    return <span className="shrink-0 text-[11px] text-amber-300">no se ha podido leer</span>;
  }
  return null;
}

/**
 * Al cerrar la jornada: las facturas que llegaron y nadie cobró.
 *
 * **No bloquea el cierre**, y es a propósito. Puede haber una factura en la
 * bandeja que no sea de hoy, que se pague por transferencia o que sea un
 * albarán que alguien escaneó por error. Impedir cerrar la caja por eso
 * pararía el taller por un papel; lo que hace falta es que quien cierra lo
 * vea, porque es el único momento del día en que alguien mira la caja entera.
 */
export function AvisoAutoScanPendiente() {
  const [resumen, setResumen] = useState<ResumenAutoScan | null>(null);

  useEffect(() => {
    let vivo = true;
    void api
      .resumenAutoScan()
      .then((r) => vivo && setResumen(r))
      .catch(() => {});
    return () => {
      vivo = false;
    };
  }, []);

  if (!resumen?.hayDispositivos || resumen.pendientes === 0) return null;

  return (
    <div className="rounded-lg border border-amber-700/60 bg-amber-950/30 px-3 py-2 text-[13px] text-amber-200">
      <strong>
        {resumen.pendientes === 1
          ? "Queda 1 factura escaneada sin cobrar"
          : `Quedan ${resumen.pendientes} facturas escaneadas sin cobrar`}
      </strong>
      . Se puede cerrar igual —puede que no sean de hoy o que no haya que
      cobrarlas—, pero mañana seguirán ahí.
      {resumen.antiguos > 0 && (
        <>
          {" "}
          {resumen.antiguos === 1 ? "Una lleva" : `${resumen.antiguos} llevan`} más de 30 días
          esperando.
        </>
      )}
    </div>
  );
}
