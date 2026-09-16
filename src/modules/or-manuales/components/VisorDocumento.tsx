/**
 * Enseña un documento archivado con la sesión puesta.
 *
 * El fichero se pide como Blob —un `<a href>` al servidor no llevaría la
 * cabecera `Authorization`— y se enseña en un iframe si es PDF o en una imagen
 * si es JPG o PNG: las OR escaneadas llegan de las dos formas.
 *
 * «Descargar» guarda el fichero con su nombre lógico (`OR_1043.pdf`), que es
 * con el que la gente lo busca después en su equipo.
 */

import { useEffect, useState } from "react";
import { Download, ExternalLink } from "lucide-react";
import * as api from "../services/api";
import { btnSecondary } from "./ui";

export default function VisorDocumento({
  documentoId,
  nombre,
  tipo = "application/pdf",
  alto = "68vh",
}: {
  documentoId: string;
  nombre: string;
  tipo?: string;
  alto?: string;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    let creada: string | null = null;
    setUrl(null);
    setError(null);
    void (async () => {
      try {
        const blob = await api.contenidoDocumento(documentoId);
        if (!vivo) return;
        creada = URL.createObjectURL(blob);
        setUrl(creada);
      } catch (e) {
        if (vivo) setError(e instanceof Error ? e.message : "No se ha podido abrir el documento");
      }
    })();
    return () => {
      vivo = false;
      // El enlace temporal se suelta al cerrar: mantenerlo vivo dejaría el
      // documento colgando en memoria toda la sesión.
      if (creada) URL.revokeObjectURL(creada);
    };
  }, [documentoId]);

  function descargar() {
    if (!url) return;
    const a = document.createElement("a");
    a.href = url;
    a.download = nombre;
    a.click();
  }

  if (error) {
    return <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-4 text-sm text-rose-300">{error}</div>;
  }

  if (!url) {
    return <div className="py-10 text-center text-sm text-slate-400">Abriendo el documento…</div>;
  }

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <button type="button" onClick={descargar} className={`${btnSecondary} flex items-center gap-2`}>
          <Download className="h-4 w-4" /> Descargar
        </button>
        <a href={url} target="_blank" rel="noreferrer" className={`${btnSecondary} flex items-center gap-2`}>
          <ExternalLink className="h-4 w-4" /> Abrir aparte
        </a>
        <span className="truncate text-[12px] text-slate-400">{nombre}</span>
      </div>
      {tipo.startsWith("image/") ? (
        <img src={url} alt={nombre} className="mx-auto max-h-[68vh] rounded-lg border border-slate-700" />
      ) : (
        <iframe title={nombre} src={url} className="w-full rounded-lg border border-slate-700 bg-white" style={{ height: alto }} />
      )}
    </div>
  );
}
