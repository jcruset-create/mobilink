/**
 * Justificantes escaneados de una operación.
 *
 * El escáner del mostrador saca un PDF y aquí se cuelga del cobro o del pago.
 * Después, el informe de cierre los lleva todos dentro.
 *
 * Se sube **después** de que la operación exista, nunca antes: si el
 * almacenamiento falla, el dinero ya está contado y solo queda reintentar. Por
 * eso el error que se enseña dice justamente eso y no "no se ha podido
 * registrar el cobro", que sería mentira y llevaría a cobrar dos veces.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { FileText, Paperclip, X } from "lucide-react";
import type { DocumentoOperacion } from "../types";
import * as api from "../services/api";

const kb = (bytes: number) =>
  bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;

type Props = {
  operationId: number;
  /** Puede colgar documentos. */
  puedeAdjuntar: boolean;
  /** Puede retirarlos: es de responsable. */
  puedeAnular?: boolean;
  /** Compacto para las tablas del histórico. */
  compacto?: boolean;
};

export default function Justificantes({
  operationId,
  puedeAdjuntar,
  puedeAnular = false,
  compacto = false,
}: Props) {
  const [documentos, setDocumentos] = useState<DocumentoOperacion[]>([]);
  const [error, setError] = useState("");
  const [subiendo, setSubiendo] = useState(false);
  const entrada = useRef<HTMLInputElement>(null);

  const cargar = useCallback(async () => {
    try {
      const r = await api.documentosDeOperacion(operationId);
      setDocumentos(r.documentos);
    } catch {
      // Sin justificantes que enseñar no se estropea la pantalla: la operación
      // y su dinero son lo importante.
    }
  }, [operationId]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  async function subir(fichero: File | undefined) {
    if (!fichero) return;
    setSubiendo(true);
    setError("");
    try {
      await api.adjuntarDocumento(operationId, fichero);
      await cargar();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se ha podido adjuntar el documento");
    } finally {
      setSubiendo(false);
    }
  }

  async function retirar(d: DocumentoOperacion) {
    const motivo = window.prompt(`¿Por qué se retira "${d.nombre}"?`);
    if (!motivo?.trim()) return;
    setError("");
    try {
      await api.anularDocumento(d.id, motivo.trim());
      await cargar();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se ha podido retirar el documento");
    }
  }

  return (
    <div className={compacto ? "" : "space-y-1"}>
      <div className="flex flex-wrap items-center gap-1.5">
        {documentos.map((d) => (
          <span
            key={d.id}
            className="flex items-center gap-1 rounded-full bg-slate-700 px-2 py-0.5 text-[11px] text-slate-200"
          >
            <FileText className="h-3 w-3 shrink-0" />
            {d.url ? (
              <a
                href={d.url}
                target="_blank"
                rel="noopener noreferrer"
                className="max-w-[140px] truncate hover:underline"
                title={`${d.nombre} · ${kb(d.tamanoBytes)}`}
              >
                {d.nombre}
              </a>
            ) : (
              <span className="max-w-[140px] truncate">{d.nombre}</span>
            )}
            {puedeAnular && (
              <button
                onClick={() => void retirar(d)}
                className="text-slate-400 hover:text-red-300"
                title="Retirar este justificante"
                aria-label={`Retirar ${d.nombre}`}
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </span>
        ))}

        {puedeAdjuntar && (
          <button
            onClick={() => entrada.current?.click()}
            disabled={subiendo}
            className="flex items-center gap-1 rounded-full border border-dashed border-slate-600 px-2 py-0.5 text-[11px] text-slate-400 hover:border-sky-500 hover:text-sky-300 disabled:opacity-50"
          >
            <Paperclip className="h-3 w-3" />
            {subiendo ? "Subiendo…" : documentos.length > 0 ? "Otro" : "Adjuntar escaneo"}
          </button>
        )}

        {!puedeAdjuntar && documentos.length === 0 && (
          <span className="text-[11px] text-slate-600">Sin justificante</span>
        )}
      </div>

      <input
        ref={entrada}
        type="file"
        accept="application/pdf,image/jpeg,image/png"
        className="hidden"
        onChange={(e) => {
          void subir(e.target.files?.[0]);
          e.target.value = "";
        }}
      />

      {error && <p className="text-[11px] text-red-300">{error}</p>}
    </div>
  );
}
