import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useParams, useSearchParams } from "react-router-dom";
import { listarFotosLote, marcarImpresas, type FotoEtiqueta } from "../etiquetas/datos";
import { imprimible } from "../etiquetas/revision";
import { Etiqueta } from "../etiquetas/Etiqueta";
import { ETIQUETA } from "../etiquetas/medidas";
import { construirPdfEtiquetas, pngDelSvg } from "../etiquetas/pdf";

/**
 * La tirada de etiquetas.
 *
 * ── Por qué esto es una página y no un `window.open` con HTML escrito a mano
 *
 * Porque el QR lo dibuja un componente de React, y porque el tamaño tiene que
 * salir de `medidas.ts` y no de una plantilla copiada. Lo que sí se copia del
 * resto del panel es la idea: una vista que solo existe para imprimirse.
 *
 * ── El tamaño, y por qué hay dos caminos ────────────────────────────────────
 *
 * `@page { size: … }` es una PETICIÓN, no una orden: el navegador se la pasa
 * al driver y, si el driver no tiene definido un papel de esa medida, imprime
 * en el suyo. Con la Zebra GK420t pasa eso: la etiqueta sale colocada arriba
 * de una hoja más grande, con un palmo de blanco debajo.
 *
 * Por eso hay dos caminos, y el bueno es el primero:
 *
 *   · «Descargar PDF»: el PDF LLEVA DENTRO la página de 90 × 144 mm. El visor
 *     lo imprime a tamaño real y el driver recibe una hoja que mide lo que
 *     dice medir.
 *   · «Imprimir»: la página tal cual, que depende de que el navegador y el
 *     driver se pongan de acuerdo.
 *
 * Ninguno de los dos exime de decirle a una impresora térmica qué etiqueta
 * lleva puesta: eso se configura en el driver y no hay CSS que lo arregle.
 *
 * Solo se imprime lo CONFIRMADO por una persona. Una foto leída por la IA y no
 * revisada no llega aquí.
 */
export default function EtiquetasImprimir() {
  const { loteId = "" } = useParams();
  const [params] = useSearchParams();
  const [fotos, setFotos] = useState<FotoEtiqueta[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");
  const [marcadas, setMarcadas] = useState(false);
  const [haciendoPdf, setHaciendoPdf] = useState(false);

  const pedidas = useMemo(() => {
    const ids = (params.get("ids") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    return new Set(ids);
  }, [params]);

  useEffect(() => {
    (async () => {
      try {
        const fs = await listarFotosLote(loteId);
        // Dos filtros, y los dos hacen falta: los que se han pedido, y de
        // esos, solo los que una persona ha confirmado.
        setFotos(fs.filter((f) => (pedidas.size === 0 || pedidas.has(f.id)) && imprimible(f)));
      } catch (e: any) {
        setError(e?.message || "No se han podido leer las etiquetas");
      } finally {
        setCargando(false);
      }
    })();
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [loteId, params]);

  async function imprimir() {
    window.print();
    // Se marcan después de mandar a imprimir, y no antes: si el diálogo se
    // cancela, quedarían como impresas sin haberlo sido. Aun así es el
    // operador el que lo confirma con el botón, porque el navegador no dice
    // si el papel salió.
    try {
      await marcarImpresas(fotos.map((f) => f.id));
      setMarcadas(true);
    } catch {
      /* que no se pueda marcar no invalida la impresión */
    }
  }

  /**
   * Construye el PDF con los QR que ya están pintados en la pantalla y lo abre.
   *
   * Se abre en otra pestaña en vez de descargarlo a ciegas: así se ve antes de
   * gastar etiquetas, y desde el visor se imprime con «Tamaño real».
   */
  async function descargarPdf() {
    setHaciendoPdf(true);
    setError("");
    try {
      const etiquetas = [];
      for (const f of fotos) {
        const nodo = document.getElementById(`etiqueta-${f.id}`);
        const svg = nodo?.querySelector("svg");
        if (!svg) throw new Error("No se ha podido leer el QR de la pantalla");
        etiquetas.push({ serie: f.serie_confirmada!, qrPng: await pngDelSvg(svg) });
      }
      const bytes = await construirPdfEtiquetas(etiquetas);
      const url = URL.createObjectURL(
        new Blob([bytes as unknown as BlobPart], { type: "application/pdf" }),
      );
      window.open(url, "_blank");
      // Se suelta al rato: si se revoca ya, la pestaña nueva se queda en blanco.
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e: any) {
      setError(e?.message || "No se ha podido generar el PDF");
    } finally {
      setHaciendoPdf(false);
    }
  }

  return (
    <div>
      <style>{`
        @page { size: ${ETIQUETA.ancho}mm ${ETIQUETA.alto}mm; margin: 0; }
        @media print {
          /*
           * Al imprimir, la aplicación entera DESAPARECE del documento, y no
           * solo de la vista.
           *
           * Antes esto era \`visibility: hidden\`, y ahí estaba el fallo: lo
           * invisible SIGUE OCUPANDO SITIO. El panel —menú lateral incluido—
           * mide bastante más que los 90 mm del papel, así que la página
           * resultaba más ancha que la hoja y Chrome lo encogía TODO para que
           * cupiera, etiqueta incluida. Salía a dos tercios de su tamaño y
           * pegada arriba a la izquierda, con el papel y el driver bien
           * configurados.
           *
           * Con \`display: none\` no queda nada que medir, y la tirada —que se
           * pinta fuera de #root, en el body— se queda sola en una página que
           * mide exactamente lo que dice \`@page\`.
           */
          #root { display: none !important; }
          html, body {
            width: ${ETIQUETA.ancho}mm !important;
            margin: 0 !important; padding: 0 !important;
            background: #fff !important;
          }
          .tirada { position: absolute; left: 0; top: 0; }
          .etiqueta { break-after: page; page-break-after: always; }
          .etiqueta:last-child { break-after: auto; page-break-after: auto; }
        }
        /* Fuera de la impresión, la tirada se enseña dentro de la pantalla. */
        @media screen { .tirada { position: static; } }
      `}</style>

      <div className="mb-3 no-print">
        <h1 className="text-lg font-black">Imprimir etiquetas</h1>
        <p className="mt-1 max-w-2xl text-sm text-slate-400">
          {fotos.length} {fotos.length === 1 ? "etiqueta" : "etiquetas"}, una por
          página de {ETIQUETA.ancho} × {ETIQUETA.alto} mm.
        </p>
        <div className="mt-2 max-w-2xl rounded-lg border border-slate-700 bg-slate-800/60 p-3 text-sm text-slate-300">
          <b>Si sale descolocada o con blanco debajo</b>, no es el diseño: es
          que la impresora está usando su papel y no el de la etiqueta.
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-slate-400">
            <li>
              Usa <b>«Descargar PDF»</b>: lleva dentro la página de{" "}
              {ETIQUETA.ancho} × {ETIQUETA.alto} mm.
            </li>
            <li>
              En el driver de la impresora (Windows → Impresoras → tu Zebra →
              Preferencias), define el tamaño de etiqueta{" "}
              <b>{ETIQUETA.ancho} × {ETIQUETA.alto} mm</b>.
            </li>
            <li>
              En el diálogo de impresión: <b>escala «Tamaño real» (100 %)</b>,
              márgenes <b>ninguno</b> y sin encabezados ni pies de página.
            </li>
          </ol>
        </div>
        {error && <div className="mt-2 text-sm text-rose-400">{error}</div>}
        {marcadas && <div className="mt-2 text-sm text-emerald-400">Marcadas como impresas.</div>}
        <div className="mt-3 flex gap-2">
          <button
            onClick={descargarPdf}
            disabled={cargando || fotos.length === 0 || haciendoPdf}
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-500 disabled:opacity-40"
          >
            {haciendoPdf ? "Generando…" : "Descargar PDF"}
          </button>
          <button
            onClick={imprimir}
            disabled={cargando || fotos.length === 0}
            className="rounded-lg border border-slate-600 px-4 py-2 text-sm font-bold text-slate-300 hover:bg-slate-700 disabled:opacity-40"
          >
            Imprimir la página
          </button>
        </div>
      </div>

      {cargando ? (
        <div className="text-slate-500">Cargando…</div>
      ) : fotos.length === 0 ? (
        <div className="rounded-2xl border border-slate-700 bg-slate-800 p-8 text-center text-slate-400 no-print">
          No hay nada confirmado que imprimir. Un número leído por la IA y no
          revisado por una persona no se imprime.
        </div>
      ) : (
        // Se pinta FUERA de #root, directamente en el body: es lo que permite
        // esconder la aplicación entera al imprimir sin esconder la tirada.
        // Fondo blanco: así se ve en pantalla lo que va a salir por la
        // impresora, que es tinta negra sobre papel amarillo.
        createPortal(
          <div className="tirada inline-block bg-white">
            {fotos.map((f) => (
              // El id lo usa «Descargar PDF» para coger el QR ya dibujado.
              <div key={f.id} id={`etiqueta-${f.id}`}>
                <Etiqueta serie={f.serie_confirmada!} />
              </div>
            ))}
          </div>,
          document.body,
        )
      )}
    </div>
  );
}
