/**
 * El PDF del escáner, elegido ANTES de confirmar la operación.
 *
 * La regla del módulo no cambia: un justificante se cuelga de una operación
 * que ya existe, nunca antes. Si se subiera primero y luego fallara el cobro,
 * quedaría un papel colgando de nada; y al revés, si se subiera dentro de la
 * misma petición, un fallo del almacenamiento tumbaría un cobro que el cliente
 * ya ha pagado.
 *
 * Lo que hace este componente es solo **guardar el fichero en la mano** mientras
 * se rellena el formulario. Quien confirma la operación lo sube después, con el
 * número ya asignado. Así el mostrador lo vive como un solo gesto —escaneo,
 * cobro, listo— sin renunciar a que el dinero y el papel sean dos pasos
 * separados por dentro.
 */

import { useRef } from "react";
import { FileText, Paperclip, X } from "lucide-react";

/** El mismo tope que acepta el servidor para un justificante. */
export const MAXIMO_JUSTIFICANTE = 15 * 1024 * 1024;

const kb = (bytes: number) =>
  bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;

type Props = {
  fichero: File | null;
  onChange: (f: File | null) => void;
  /** Sin permiso para adjuntar no se enseña nada. */
  puedeAdjuntar: boolean;
  deshabilitado?: boolean;
  onError: (mensaje: string) => void;
};

export default function JustificantePrevio({
  fichero,
  onChange,
  puedeAdjuntar,
  deshabilitado = false,
  onError,
}: Props) {
  const entrada = useRef<HTMLInputElement>(null);

  if (!puedeAdjuntar) return null;

  return (
    <div className="mt-3">
      <span className="mb-1 block text-[10px] font-semibold uppercase text-slate-400">
        Justificante escaneado{" "}
        <span className="font-normal normal-case text-slate-500">(opcional)</span>
      </span>

      <input
        ref={entrada}
        type="file"
        accept="application/pdf"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          // Se vacía siempre: sin esto, volver a elegir el mismo fichero tras
          // quitarlo no dispara el evento y parece que la pantalla se ha colgado.
          e.target.value = "";
          if (!f) return;
          if (f.type !== "application/pdf") {
            onError("El justificante tiene que ser un PDF. Escanéalo en PDF, no como imagen.");
            return;
          }
          if (f.size > MAXIMO_JUSTIFICANTE) {
            onError(
              `El PDF pesa ${kb(f.size)} y el máximo son 15 MB. Escanéalo con menos resolución.`
            );
            return;
          }
          onChange(f);
        }}
      />

      {fichero ? (
        <div className="flex items-center gap-2 rounded-lg border border-slate-600 bg-slate-900 px-3 py-2">
          <FileText className="h-4 w-4 shrink-0 text-sky-400" />
          <span className="min-w-0 flex-1 truncate text-sm text-slate-200">{fichero.name}</span>
          <span className="shrink-0 text-[11px] tabular-nums text-slate-500">{kb(fichero.size)}</span>
          <button
            type="button"
            onClick={() => onChange(null)}
            disabled={deshabilitado}
            title="Quitar el justificante"
            className="shrink-0 rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-white disabled:opacity-40"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => entrada.current?.click()}
          disabled={deshabilitado}
          className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-slate-600 px-3 py-2 text-[12px] text-slate-400 hover:border-slate-500 hover:text-slate-200 disabled:opacity-40"
        >
          <Paperclip className="h-4 w-4" /> Adjuntar el PDF del escáner
        </button>
      )}

      <p className="mt-1 text-[10px] text-slate-500">
        Se sube solo en cuanto se registre la operación, y entra en el informe de cierre.
      </p>
    </div>
  );
}
