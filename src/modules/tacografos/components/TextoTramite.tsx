/**
 * Texto para pegar en la petición genérica de la Generalitat.
 *
 * Lo compone el servidor a partir de las plantillas versionadas, no esta
 * pantalla: si el trámite cambia de redacción, cambia en un sitio. Aquí sólo se
 * enseña y se copia.
 */

import { useEffect, useState } from "react";
import { Clipboard, ClipboardCheck, ExternalLink } from "lucide-react";
import * as api from "../services/api";
import type { TextoTramite as Texto } from "../types";

export default function TextoTramite({ expedienteId }: { expedienteId: string }) {
  const [t, setT] = useState<Texto | null>(null);
  const [copiado, setCopiado] = useState(false);

  useEffect(() => {
    let vivo = true;
    void (async () => {
      try {
        const r = await api.textoTramite(expedienteId);
        if (vivo) setT(r);
      } catch {
        // Que no se pueda componer el texto no debe tapar el resto de la ficha.
      }
    })();
    return () => {
      vivo = false;
    };
  }, [expedienteId]);

  if (!t) return null;

  async function copiar() {
    if (!t) return;
    try {
      await navigator.clipboard.writeText(t.exposo);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      // Sin permiso de portapapeles queda el texto a la vista para copiarlo a
      // mano, que es de donde veníamos.
    }
  }

  return (
    <section className="mb-4 overflow-hidden rounded-xl border border-slate-800">
      <h2 className="bg-slate-800/70 px-3 py-2 text-[12px] font-bold uppercase tracking-wide text-slate-200">
        Trámite telemático (Generalitat)
      </h2>
      <div className="space-y-2 p-3 text-[13px]">
        <p>
          <span className="text-slate-400">Assumpte: </span>
          {t.assumpte}
        </p>
        <p>
          <span className="text-slate-400">Nom del fitxer: </span>
          {t.nomFitxer}
        </p>
        <p className="rounded-lg border border-slate-700 bg-slate-900/60 p-2 text-slate-200">
          {t.exposo}
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => void copiar()}
            className="flex items-center gap-1.5 rounded-lg border border-slate-600 px-3 py-1.5 text-slate-300 hover:bg-slate-800"
          >
            {copiado ? <ClipboardCheck className="h-4 w-4" /> : <Clipboard className="h-4 w-4" />}
            {copiado ? "Copiado" : "Copiar el texto"}
          </button>
          {t.urlTramite && (
            <a
              href={t.urlTramite}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sky-400 hover:bg-slate-800"
            >
              <ExternalLink className="h-4 w-4" /> Petició genèrica
            </a>
          )}
          {t.urlOvt && (
            <a
              href={t.urlOvt}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sky-400 hover:bg-slate-800"
            >
              <ExternalLink className="h-4 w-4" /> Formulari OVT
            </a>
          )}
        </div>
      </div>
    </section>
  );
}
