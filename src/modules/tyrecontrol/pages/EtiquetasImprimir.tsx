import { useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { listarFotosLote, marcarImpresas, type FotoEtiqueta } from "../etiquetas/datos";
import { imprimible } from "../etiquetas/revision";
import { Etiqueta } from "../etiquetas/Etiqueta";
import { ETIQUETA } from "../etiquetas/medidas";

/**
 * La tirada de etiquetas.
 *
 * ── Por qué esto es una página y no un `window.open` con HTML escrito a mano
 *
 * Porque el QR lo dibuja un componente de React, y porque el tamaño tiene que
 * salir de `medidas.ts` y no de una plantilla copiada. Lo que sí se copia del
 * resto del panel es la idea: una vista que solo existe para imprimirse.
 *
 * ── El tamaño ───────────────────────────────────────────────────────────────
 *
 * `@page { size: 90mm 143.9mm; margin: 0 }` y una etiqueta por página. Sin
 * márgenes: el margen ya lo pone el troquelado del papel. Y hay que decirle al
 * navegador que NO escale —«Tamaño real», no «Ajustar a la página»—, porque
 * ajustar a la página es exactamente lo que descoloca los tres bloques.
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

  return (
    <div>
      <style>{`
        @page { size: ${ETIQUETA.ancho}mm ${ETIQUETA.alto}mm; margin: 0; }
        @media print {
          /* Solo las etiquetas: ni menú, ni cabecera, ni botones. */
          body * { visibility: hidden !important; }
          .tirada, .tirada * { visibility: visible !important; }
          .tirada { position: absolute; left: 0; top: 0; }
          .etiqueta { break-after: page; page-break-after: always; }
          .etiqueta:last-child { break-after: auto; page-break-after: auto; }
        }
      `}</style>

      <div className="mb-3 no-print">
        <h1 className="text-lg font-black">Imprimir etiquetas</h1>
        <p className="mt-1 max-w-2xl text-sm text-slate-400">
          {fotos.length} {fotos.length === 1 ? "etiqueta" : "etiquetas"}, una por
          página de {ETIQUETA.ancho} × {ETIQUETA.alto} mm. En el diálogo de
          impresión: <b>escala «Tamaño real» (100 %)</b> y sin márgenes. Si se
          imprime «ajustando a la página», los bloques no caen en su troquelado.
        </p>
        {error && <div className="mt-2 text-sm text-rose-400">{error}</div>}
        {marcadas && <div className="mt-2 text-sm text-emerald-400">Marcadas como impresas.</div>}
        <button
          onClick={imprimir}
          disabled={cargando || fotos.length === 0}
          className="mt-3 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-500 disabled:opacity-40"
        >
          Imprimir
        </button>
      </div>

      {cargando ? (
        <div className="text-slate-500">Cargando…</div>
      ) : fotos.length === 0 ? (
        <div className="rounded-2xl border border-slate-700 bg-slate-800 p-8 text-center text-slate-400 no-print">
          No hay nada confirmado que imprimir. Un número leído por la IA y no
          revisado por una persona no se imprime.
        </div>
      ) : (
        // Fondo blanco en pantalla: así se ve lo que va a salir por la
        // impresora, que es tinta negra sobre papel amarillo.
        <div className="tirada inline-block bg-white">
          {fotos.map((f) => (
            <Etiqueta key={f.id} serie={f.serie_confirmada!} />
          ))}
        </div>
      )}
    </div>
  );
}
