/**
 * Abre un PDF del módulo con la sesión puesta y lo imprime con el navegador.
 *
 * No hay infraestructura de impresión en el proyecto (todo es
 * `window.print()`), así que esto es lo que se puede hacer hoy: el PDF se pide
 * como Blob —un `<a href>` al servidor no llevaría la cabecera— y se enseña en
 * un iframe; «Imprimir» lanza el diálogo del sistema sobre ese iframe. En
 * móvil o tablet, «Abrir» lo manda al visor del sistema, que tiene Imprimir y
 * Compartir.
 */

import { useEffect, useRef, useState } from "react";
import { ExternalLink, Printer } from "lucide-react";
import * as api from "../services/api";
import { btnPrimary, btnSecondary } from "./ui";

export default function VisorDocumento({ documentoId, nombre, autoImprimir = false, alto = "70vh" }: { documentoId: string; nombre: string; autoImprimir?: boolean; alto?: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const iframe = useRef<HTMLIFrameElement>(null);
  const impreso = useRef(false);

  useEffect(() => {
    let vivo = true;
    let creada: string | null = null;
    impreso.current = false;
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
      if (creada) URL.revokeObjectURL(creada);
    };
  }, [documentoId]);

  function imprimir() {
    const w = iframe.current?.contentWindow;
    if (w) {
      try {
        w.focus();
        w.print();
        return;
      } catch {
        /* algunos visores móviles no dejan: se abre aparte */
      }
    }
    if (url) window.open(url, "_blank");
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2 print:hidden">
        <button type="button" className={`${btnPrimary} flex items-center gap-2`} onClick={imprimir} disabled={!url}>
          <Printer className="h-4 w-4" /> Imprimir
        </button>
        {url && (
          <a className={`${btnSecondary} flex items-center gap-2`} href={url} target="_blank" rel="noreferrer" download={nombre}>
            <ExternalLink className="h-4 w-4" /> Abrir / guardar
          </a>
        )}
        <span className="text-[12px] text-slate-400">{nombre}</span>
      </div>
      {error && <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">{error}</div>}
      {url && (
        <iframe
          ref={iframe}
          title={nombre}
          src={url}
          className="w-full rounded-xl border border-slate-700 bg-white"
          style={{ height: alto }}
          onLoad={() => {
            if (autoImprimir && !impreso.current) {
              impreso.current = true;
              // Sólo en escritorio: en móvil el diálogo de impresión sobre un
              // iframe no es fiable y el operario ya tiene el botón.
              if (window.matchMedia("(min-width: 768px)").matches) imprimir();
            }
          }}
        />
      )}
    </div>
  );
}
