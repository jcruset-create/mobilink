import { Etiqueta } from "../etiquetas/Etiqueta";
import { ETIQUETA } from "../etiquetas/medidas";

/**
 * La hoja para comprobar que la impresora imprime a tamaño real.
 *
 * Es el paso que casi nadie hace y que después cuesta un rollo de etiquetas:
 * el navegador y el driver pueden escalar sin avisar, y un 96 % de escala se ve
 * perfecto en pantalla y deja los tres bloques fuera de su troquelado.
 *
 * Se imprime esto una vez, se mide la regla con una regla de verdad y, si los
 * 100 mm no miden 100 mm, se corrige la escala en el diálogo de impresión
 * —NUNCA los números de `medidas.ts`, que son los de la etiqueta física—.
 */
export default function EtiquetasCalibrar() {
  return (
    <div>
      <style>{`
        @page { size: ${ETIQUETA.ancho}mm ${ETIQUETA.alto}mm; margin: 0; }
        @media print {
          body * { visibility: hidden !important; }
          .calibracion, .calibracion * { visibility: visible !important; }
          .calibracion { position: absolute; left: 0; top: 0; }
        }
      `}</style>

      <div className="mb-3 no-print">
        <h1 className="text-lg font-black">Hoja de calibración</h1>
        <p className="mt-1 max-w-2xl text-sm text-slate-400">
          Imprime esta hoja con <b>escala 100 % («Tamaño real»)</b> y sin
          márgenes, y mide la regla vertical con una regla de verdad. Si los 100 mm no miden 100 mm
          exactos, la impresora está escalando: corrígelo ahí, no en el diseño
          de la etiqueta.
        </p>
        <p className="mt-1 max-w-2xl text-sm text-slate-400">
          El recuadro discontinuo es el borde de la etiqueta ({ETIQUETA.ancho} ×{" "}
          {ETIQUETA.alto} mm) y los punteados rojos son los tres bloques: la
          zona de arriba y las dos subetiquetas. Los dos de abajo tienen que
          caer dentro de sus troquelados.
        </p>
        <button
          onClick={() => window.print()}
          className="mt-3 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-500"
        >
          Imprimir la hoja
        </button>
      </div>

      <div className="calibracion inline-block bg-white">
        <div style={{ position: "relative", width: `${ETIQUETA.ancho}mm`, height: `${ETIQUETA.alto}mm` }}>
          {/* Con los marcos puestos: esta hoja existe para ver los límites. */}
          <Etiqueta serie="6162121986" marco />
          {/*
            La regla: 100 mm, EN VERTICAL. En horizontal no cabe —la etiqueta
            mide 90 mm de ancho— y una regla recortada no sirve para medir.
          */}
          <div
            style={{
              position: "absolute", left: `${ETIQUETA.ancho - 8}mm`, top: "20mm",
              width: "6mm", height: "100mm",
              borderTop: "0.3mm solid #000", borderBottom: "0.3mm solid #000",
              borderRight: "0.3mm solid #000",
            }}
          >
            {Array.from({ length: 11 }, (_, i) => (
              <div
                key={i}
                style={{
                  position: "absolute", right: 0, top: `${i * 10}mm`,
                  height: "0.3mm", width: i % 5 === 0 ? "5mm" : "3mm",
                  background: "#000",
                }}
              />
            ))}
            <div style={{ position: "absolute", left: 0, top: "0.5mm", fontSize: "2.2mm", color: "#000" }}>
              0
            </div>
            <div
              style={{
                position: "absolute", left: "-11mm", top: "96mm",
                fontSize: "2.2mm", color: "#000", whiteSpace: "nowrap",
              }}
            >
              100 mm
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
