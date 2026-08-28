/**
 * Adjuntar la factura y que la pantalla se rellene sola.
 *
 * Hace dos cosas con un solo gesto, que es como se vive en el mostrador:
 *
 * 1. Se queda el fichero en la mano para colgarlo del cobro cuando el cobro
 *    exista. Esa parte no cambia respecto a `JustificantePrevio`: el dinero y
 *    el papel siguen siendo dos pasos separados por dentro.
 * 2. Lo manda a analizar y devuelve una PROPUESTA a quien lo usa, que decide
 *    qué campos rellenar. Aquí no se cobra nada ni se toca ningún campo.
 *
 * Si el análisis falla, el fichero SE QUEDA. Un escáner que no ha sabido leer
 * la factura no es motivo para perder el adjunto ni para dejar el cobro sin
 * justificante: se rellena a mano y se sigue, que es lo que se hacía antes de
 * que esto existiera.
 */

import { useRef, useState } from "react";
import { FileText, Loader2, Paperclip, ScanText, X } from "lucide-react";
import { useCash } from "../contexts/CashContext";
import type { PropuestaEscaneo } from "../types";
import * as api from "../services/api";

/** El mismo tope que acepta el servidor. */
export const MAXIMO_FACTURA = 15 * 1024 * 1024;

const kb = (bytes: number) =>
  bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;

type Props = {
  fichero: File | null;
  onChange: (f: File | null) => void;
  /** La propuesta, para que la pantalla decida qué rellenar. */
  onPropuesta: (p: PropuestaEscaneo) => void;
  /** Al quitar el fichero se olvida lo propuesto, pero NO lo ya escrito. */
  onOlvidar: () => void;
  puedeAdjuntar: boolean;
  /** Se manda para poder atar el escaneo a la jornada en la auditoría. */
  sessionId: number | null;
  deshabilitado?: boolean;
  onError: (mensaje: string) => void;
};

type Estado = "VACIO" | "ANALIZANDO" | "LISTO" | "FALLIDO";

export default function EscanerFactura({
  fichero,
  onChange,
  onPropuesta,
  onOlvidar,
  puedeAdjuntar,
  sessionId,
  deshabilitado = false,
  onError,
}: Props) {
  const entrada = useRef<HTMLInputElement>(null);
  const [estado, setEstado] = useState<Estado>("VACIO");
  const [resumen, setResumen] = useState<PropuestaEscaneo | null>(null);

  if (!puedeAdjuntar) return null;

  async function elegir(f: File) {
    if (f.size > MAXIMO_FACTURA) {
      onError(`La factura pasa de ${kb(MAXIMO_FACTURA)}. Escanéala con menos resolución.`);
      return;
    }
    // El fichero se queda YA, antes de analizar: si el análisis falla, el
    // adjunto sigue ahí y el cobro no pierde su justificante.
    onChange(f);
    setResumen(null);
    setEstado("ANALIZANDO");
    try {
      const { propuesta } = await api.escanearFactura(f, sessionId);
      setResumen(propuesta);
      setEstado("LISTO");
      onPropuesta(propuesta);
    } catch (e) {
      setEstado("FALLIDO");
      onError(
        e instanceof Error
          ? `${e.message} La factura sigue adjunta: rellena el cobro a mano.`
          : "No se ha podido analizar la factura. Sigue adjunta: rellena el cobro a mano."
      );
    }
  }

  function quitar() {
    onChange(null);
    setResumen(null);
    setEstado("VACIO");
    onOlvidar();
  }

  return (
    <div className="mt-3 rounded-lg border border-slate-700 bg-slate-900/40 p-2.5">
      <span className="mb-1 block text-[10px] font-semibold uppercase text-slate-400">
        Factura o justificante{" "}
        <span className="font-normal normal-case text-slate-500">(opcional)</span>
      </span>

      <input
        ref={entrada}
        type="file"
        accept="application/pdf,image/jpeg,image/png"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          // Se vacía siempre: sin esto, volver a elegir el mismo fichero tras
          // quitarlo no dispara ningún evento y parece que la pantalla se ha
          // colgado.
          e.target.value = "";
          if (f) void elegir(f);
        }}
      />

      {!fichero ? (
        <>
          <button
            type="button"
            onClick={() => entrada.current?.click()}
            disabled={deshabilitado}
            className="flex items-center gap-2 rounded-lg border border-dashed border-slate-600 px-3 py-2 text-[12px] font-medium text-slate-300 hover:border-sky-500 hover:text-sky-200 disabled:opacity-50"
          >
            <Paperclip className="h-3.5 w-3.5" /> Adjuntar factura
          </button>
          <p className="mt-1 text-[11px] text-slate-500">
            PDF, JPG o PNG. Se lee sola y rellena la pantalla; tú revisas y confirmas.
          </p>
        </>
      ) : (
        <div className="space-y-2">
          <div className="flex items-center gap-2 rounded-lg bg-slate-800 px-2.5 py-1.5">
            <FileText className="h-4 w-4 shrink-0 text-slate-400" />
            <span className="min-w-0 flex-1 truncate text-[12px] text-slate-200">
              {fichero.name}
            </span>
            <span className="shrink-0 text-[11px] tabular-nums text-slate-500">
              {kb(fichero.size)}
            </span>
            <button
              type="button"
              onClick={quitar}
              disabled={deshabilitado || estado === "ANALIZANDO"}
              title="Quitar la factura"
              className="shrink-0 rounded p-1 text-slate-400 hover:bg-slate-700 hover:text-slate-200 disabled:opacity-40"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          {estado === "ANALIZANDO" && <Analizando />}

          {estado === "LISTO" && resumen && <Resultado propuesta={resumen} />}

          {estado === "FALLIDO" && (
            <p className="text-[12px] text-amber-300">
              No se ha podido leer. La factura sigue adjunta: rellena el cobro a mano.{" "}
              <button
                type="button"
                onClick={() => void elegir(fichero)}
                className="underline underline-offset-2 hover:text-amber-200"
              >
                Volver a intentarlo
              </button>
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Lo que está haciendo, mientras lo hace.
 *
 * Los pasos se enseñan quietos, no avanzando: el servidor devuelve el análisis
 * de una vez y no hay forma de saber por dónde va. Una barra que avanzara sola
 * estaría inventándose un progreso, y cuando tarde de más nadie volvería a
 * creérsela.
 */
function Analizando() {
  return (
    <div className="rounded-lg bg-slate-800/60 px-2.5 py-2">
      <div className="flex items-center gap-2 text-[12px] font-medium text-sky-200">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Analizando la factura…
      </div>
      <ul className="mt-1 space-y-0.5 text-[11px] text-slate-400">
        <li>· Identificando la factura</li>
        <li>· Leyendo el cliente</li>
        <li>· Buscando el total</li>
        <li>· Buscando el justificante de pago</li>
      </ul>
    </div>
  );
}

/** El resultado, en dos líneas: qué se ha leído y qué falta por decidir. */
function Resultado({ propuesta }: { propuesta: PropuestaEscaneo }) {
  const { formasPago } = useCash();
  const graves = propuesta.avisos.filter((a) => a.grave);
  const leves = propuesta.avisos.filter((a) => !a.grave);
  const recibo = propuesta.extra.recibo;

  /*
   * El nombre de la forma, no su código. El clasificador trabaja con códigos
   * —«CAIXABANK_CARD»— porque son los que no cambian; en el mostrador lo que
   * se lee es el mismo texto que hay en el botón.
   */
  const nombreForma =
    formasPago.find((f) => f.codigo === propuesta.formaCobro.formaPago)?.nombre ??
    propuesta.formaCobro.formaPago;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2 text-[12px] font-medium text-emerald-300">
        <ScanText className="h-3.5 w-3.5" /> Factura analizada
      </div>

      {recibo.detectado && (
        <div className="rounded-lg bg-slate-800/60 px-2.5 py-1.5 text-[11px] text-slate-300">
          <div className="font-bold text-slate-200">Pago con tarjeta detectado</div>
          <div className="mt-0.5 space-y-0.5">
            {propuesta.formaCobro.formaPago ? (
              <div>
                Forma propuesta: <strong>{nombreForma}</strong>
                {!propuesta.formaCobro.autoSeleccionar && " — pendiente de que la confirmes"}
              </div>
            ) : (
              <div className="text-amber-200">
                No se sabe de qué TPV es: elígelo tú. Se configura en Configuración → Reglas del
                escáner.
              </div>
            )}
            {propuesta.importeCuadra === true && (
              <div className="text-emerald-300">Importe del justificante: coincide con la factura</div>
            )}
            {recibo.tarjetaUltimos4 && <div>Tarjeta ···{recibo.tarjetaUltimos4}</div>}
            {recibo.adquirente && <div>{recibo.adquirente}</div>}
          </div>
        </div>
      )}

      {graves.map((a) => (
        <p key={a.codigo} className="rounded-lg bg-amber-500/15 px-2.5 py-1.5 text-[11px] text-amber-200">
          ⚠ {a.mensaje}
        </p>
      ))}
      {leves.map((a) =>
        /*
         * «No hay justificante» va en su propio recuadro, aunque no sea grave.
         * Es la frase que más fácil se lee al revés —de «no hay ticket» a «será
         * efectivo»— y leída de pasada, en gris pequeño, no la lee nadie.
         */
        a.codigo === "SIN_EVIDENCIA_DE_PAGO" ? (
          <p
            key={a.codigo}
            className="rounded-lg bg-slate-800/60 px-2.5 py-1.5 text-[11px] text-slate-300"
          >
            {a.mensaje}
          </p>
        ) : (
          <p key={a.codigo} className="px-0.5 text-[11px] text-slate-400">
            {a.mensaje}
          </p>
        )
      )}

      <p className="px-0.5 text-[11px] text-slate-500">
        Revisa lo que se ha rellenado antes de confirmar. Puedes cambiarlo todo.
      </p>
    </div>
  );
}
