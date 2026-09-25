import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { ETIQUETA, bloquesDeEtiqueta, type Caja } from "./medidas";

/**
 * La tirada de etiquetas, en PDF y a tamaño exacto.
 *
 * ── Por qué no basta con imprimir la página ─────────────────────────────────
 *
 * Porque `@page { size: 90mm 144mm }` es una PETICIÓN, no una orden. El
 * navegador se la traslada al driver y, si el driver no tiene definido un
 * papel de esa medida, imprime en el suyo: la etiqueta sale colocada arriba de
 * una hoja más grande, con un palmo de blanco debajo. Es exactamente lo que
 * pasa con la Zebra GK420t, que trae sus propias medidas de etiqueta.
 *
 * Un PDF, en cambio, LLEVA DENTRO el tamaño de página. El visor lo imprime a
 * tamaño real y el driver recibe una hoja de 90 × 144 mm, no una carta con un
 * dibujo en una esquina.
 *
 * Esto NO sustituye a configurar la impresora —en una térmica hay que decirle
 * qué etiqueta lleva puesta—, pero quita del medio la mitad del problema: a
 * partir de aquí, lo que se manda mide lo que dice que mide.
 *
 * Las medidas salen de `medidas.ts`, las mismas que la vista: no se vuelven a
 * escribir aquí.
 */

const MM = 72 / 25.4;

/**
 * Traduce una caja nuestra —origen arriba a la izquierda, en mm— a lo que
 * entiende el PDF: puntos y origen abajo a la izquierda.
 *
 * Está aparte y exportada porque invertir la Y es el error clásico de generar
 * PDF, y sale a la primera o no sale: conviene poder probarlo.
 */
export function aPuntos(caja: Caja, altoPagina = ETIQUETA.alto) {
  return {
    x: caja.x * MM,
    // La Y del PDF mide desde abajo, y se refiere al borde INFERIOR de la caja.
    y: (altoPagina - caja.y - caja.alto) * MM,
    ancho: caja.ancho * MM,
    alto: caja.alto * MM,
  };
}

export interface EtiquetaAImprimir {
  serie: string;
  /** El QR ya dibujado, en PNG. */
  qrPng: Uint8Array;
}

/**
 * Convierte el QR que ya está en pantalla a PNG.
 *
 * Se reaprovecha el SVG que pinta `react-qr-code` en vez de calcular el código
 * otra vez con otra librería: si un día cambia la corrección de errores o el
 * contenido, cambia en un sitio y el PDF lo hereda.
 *
 * Se rasteriza a 600 px de lado para un cuadrado de 36 mm, que son unos
 * 420 ppp: por encima de lo que resuelve una térmica de 203 ppp, así que los
 * módulos salen limpios y no emborronados.
 */
export function pngDelSvg(svg: SVGElement, lado = 600): Promise<Uint8Array> {
  const texto = new XMLSerializer().serializeToString(svg);
  const url = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(texto)))}`;
  return new Promise((resolver, rechazar) => {
    const img = new Image();
    img.onload = () => {
      const lienzo = document.createElement("canvas");
      lienzo.width = lado;
      lienzo.height = lado;
      const ctx = lienzo.getContext("2d");
      if (!ctx) return rechazar(new Error("No se ha podido dibujar el QR"));
      // Fondo blanco: un QR sobre transparente se imprime sobre nada y el
      // lector necesita el contraste de la zona clara.
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, lado, lado);
      ctx.drawImage(img, 0, 0, lado, lado);
      const base64 = lienzo.toDataURL("image/png").split(",")[1];
      const bin = atob(base64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      resolver(bytes);
    };
    img.onerror = () => rechazar(new Error("No se ha podido convertir el QR"));
    img.src = url;
  });
}

/**
 * Una página por etiqueta, de 90 × 144 mm exactos.
 *
 * El número va en Courier negrita, monoespaciada como la de pantalla, y su
 * tamaño se ajusta MIDIENDO el texto con la fuente real en vez de fiarse del
 * ancho aproximado por dígito: en el papel, «no cabe por medio milímetro» es
 * un número cortado.
 */
export async function construirPdfEtiquetas(
  etiquetas: EtiquetaAImprimir[],
): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const fuente = await pdf.embedFont(StandardFonts.CourierBold);

  for (const e of etiquetas) {
    const pagina = pdf.addPage([ETIQUETA.ancho * MM, ETIQUETA.alto * MM]);
    const qr = await pdf.embedPng(e.qrPng);
    const serie = e.serie.trim();

    for (const b of bloquesDeEtiqueta(Math.max(serie.length, 1))) {
      const caja = aPuntos(b.numero);
      // Se parte del tamaño calculado y se encoge hasta que la fuente real
      // quepa. Nunca al revés: crecer se lo comería el borde.
      let tamano = b.numero.tamano * MM;
      while (tamano > 1 && fuente.widthOfTextAtSize(serie, tamano) > caja.ancho) {
        tamano -= 0.25;
      }
      const ancho = fuente.widthOfTextAtSize(serie, tamano);
      const alto = fuente.heightAtSize(tamano);

      pagina.drawText(serie, {
        x: b.numero.centrado ? caja.x + (caja.ancho - ancho) / 2 : caja.x,
        // Centrado en vertical dentro de su franja.
        y: caja.y + (caja.alto - alto) / 2 + alto * 0.18,
        size: tamano,
        font: fuente,
        color: rgb(0, 0, 0),
      });

      const cajaQr = aPuntos(b.qr);
      pagina.drawImage(qr, {
        x: cajaQr.x, y: cajaQr.y, width: cajaQr.ancho, height: cajaQr.alto,
      });
    }
  }

  return pdf.save();
}
