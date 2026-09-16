/**
 * Abre un PDF del módulo con la sesión puesta y lo imprime con el navegador.
 *
 * No hay infraestructura de impresión en el proyecto (todo es
 * `window.print()`), así que esto es lo que se puede hacer hoy: el PDF se pide
 * como Blob —un `<a href>` al servidor no llevaría la cabecera— y se enseña en
 * un iframe; «Imprimir» lanza el diálogo del sistema sobre ese iframe. En
 * móvil o tablet, «Abrir» lo manda al visor del sistema, que tiene Imprimir y
 * Compartir.
 *
 * ── Por qué en móvil no se imprime solo ─────────────────────────────────────
 *
 * En escritorio, `autoImprimir` lanza el diálogo en cuanto carga el PDF. En
 * móvil NO: imprimir un iframe no es fiable en Safari —no lanza el diálogo y
 * tampoco falla, así que no hay a qué agarrarse para caer al plan B—, y abrir
 * el visor del sistema sin que nadie haya tocado nada lo bloquea el navegador.
 * Antes eso dejaba la impresión en nada y sin decirlo. Ahora, cuando toca
 * imprimir y no se puede solo, sale un botón grande arriba: un toque en vez de
 * ninguno, pero visible.
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
  const [pendienteDeImprimir, setPendienteDeImprimir] = useState(false);

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
    setPendienteDeImprimir(false);
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
      {pendienteDeImprimir && (
        <button
          type="button"
          onClick={imprimir}
          className="flex h-16 w-full items-center justify-center gap-2 rounded-2xl bg-emerald-600 text-lg font-black text-white active:bg-emerald-500 print:hidden"
        >
          <Printer className="h-6 w-6" /> IMPRIMIR EL ALBARÁN
        </button>
      )}
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
              // En escritorio se lanza solo; en móvil se pide el toque, porque
              // ahí ni el iframe imprime ni el navegador deja abrir el visor
              // sin que nadie haya tocado nada.
              if (window.matchMedia("(min-width: 768px)").matches) imprimir();
              else setPendienteDeImprimir(true);
            }
          }}
        />
      )}
    </div>
  );
}
