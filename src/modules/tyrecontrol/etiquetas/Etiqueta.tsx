import QRCode from "react-qr-code";
import { ETIQUETA, bloquesDeEtiqueta, type BloqueEtiqueta } from "./medidas";

/**
 * Una etiqueta de neumático, dibujada en MILÍMETROS.
 *
 * Todo va en mm y nada en píxeles: esto se imprime y se pega en una goma, y un
 * píxel no tiene tamaño físico —depende del DPI, del zoom y del driver—. Las
 * posiciones no se escriben aquí: salen de `medidas.ts`, que es el único sitio
 * donde están los números. Si la etiqueta física cambia, se cambian allí.
 *
 * ── Qué se imprime ──────────────────────────────────────────────────────────
 *
 * El número y su QR, y nada más. Ni «Nº SERIE», ni marcos, ni logotipos: la
 * etiqueta ya viene impresa y quien la mira sabe lo que es. Esas letras solo
 * le quitaban sitio al dato.
 *
 * Arriba —la parte que se queda en la rueda— el número va grande y el QR
 * debajo, también grande: es la que se lee agachado y de lejos. En las dos
 * subetiquetas troqueladas, que son bajas y anchas, van en fila.
 *
 * ── Qué lleva el QR ─────────────────────────────────────────────────────────
 *
 * SOLO EL NÚMERO DE SERIE, en crudo. No una URL. Lo pidió así el encargo, y la
 * razón es de uso: al montar la goma se escanea para RELLENAR el campo del
 * número de serie, y un QR con una URL obligaría a recortarla. El precio, que
 * conviene tener presente: un QR de números no se distingue de cualquier otro
 * QR de números, así que quien lo lea tiene que validar el formato y enseñar
 * lo leído antes de darlo por bueno.
 */

/** El texto del QR. Está en una función para que se vea que es SOLO el número. */
export const cargaQr = (serie: string): string => serie.trim();

function Bloque({ b, serie }: { b: BloqueEtiqueta; serie: string }) {
  return (
    <>
      <div
        style={{
          position: "absolute",
          left: `${b.numero.x}mm`, top: `${b.numero.y}mm`,
          width: `${b.numero.ancho}mm`, height: `${b.numero.alto}mm`,
          // Monoespaciada: los dígitos ocupan lo mismo, que es de donde sale
          // el cálculo del tamaño en medidas.ts.
          fontFamily: "'Roboto Mono', 'DejaVu Sans Mono', monospace",
          fontWeight: 700,
          fontSize: `${b.numero.tamano}mm`,
          lineHeight: `${b.numero.alto}mm`,
          textAlign: b.numero.centrado ? "center" : "left",
          whiteSpace: "nowrap",
          color: "#000",
        }}
      >
        {serie}
      </div>
      <div
        style={{
          position: "absolute",
          left: `${b.qr.x}mm`, top: `${b.qr.y}mm`,
          width: `${b.qr.ancho}mm`, height: `${b.qr.alto}mm`,
        }}
      >
        {/* El SVG se escala al 100% de la caja, que ya está en mm. */}
        <QRCode
          value={cargaQr(serie)}
          style={{ width: "100%", height: "100%" }}
          // M: aguanta suciedad y roce sin necesitar más módulos de los que
          // caben en el hueco.
          level="M"
          bgColor="transparent"
          fgColor="#000000"
        />
      </div>
    </>
  );
}

/**
 * La etiqueta completa: los tres bloques con el mismo número.
 *
 * Son tres porque la etiqueta física los tiene: la zona de arriba, que se
 * queda en la goma, y dos subetiquetas troqueladas que se arrancan para
 * pegarlas en el parte y en la ficha. El mismo número en los tres es justo el
 * punto.
 */
export function Etiqueta({ serie, marco = false }: { serie: string; marco?: boolean }) {
  const bloques = bloquesDeEtiqueta(Math.max(serie.trim().length, 1));
  return (
    <div
      className="etiqueta"
      style={{
        position: "relative",
        width: `${ETIQUETA.ancho}mm`,
        height: `${ETIQUETA.alto}mm`,
        // Sin fondo: la etiqueta ya es amarilla. Imprimir un fondo gastaría
        // tinta y taparía el papel.
        background: "transparent",
        // El marco solo existe para calibrar en pantalla y en la hoja de
        // prueba; en la tirada de verdad no se imprime nada más que el dato.
        outline: marco ? "0.2mm dashed #999" : "none",
        overflow: "hidden",
        pageBreakAfter: "always",
        breakAfter: "page",
      }}
    >
      {bloques.map((b, i) => (
        <Bloque key={i} b={b} serie={serie.trim()} />
      ))}
      {marco &&
        bloques.map((b, i) => (
          <div
            key={`m${i}`}
            style={{
              position: "absolute",
              left: `${b.caja.x}mm`, top: `${b.caja.y}mm`,
              width: `${b.caja.ancho}mm`, height: `${b.caja.alto}mm`,
              outline: "0.2mm dotted #c00",
            }}
          />
        ))}
    </div>
  );
}

export default Etiqueta;
