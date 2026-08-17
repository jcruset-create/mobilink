/**
 * Miniaturas de las imágenes de los botones de cobro.
 *
 * La imagen que sube el usuario es la que tenga a mano: una foto, una captura,
 * el logotipo del banco a tamaño cartel. El botón la enseña a 32 píxeles de
 * alto, así que guardar el original solo sirve para que la pantalla de cobros
 * cargue lenta. Se reduce aquí, en el servidor, y se guarda ya en tamaño de
 * botón: el usuario no tiene que saber nada de píxeles.
 *
 * 240 px de alto son más del triple del alto del botón (72 px): nítido en una
 * pantalla retina, donde ese botón son 144 px reales, y aun así un fichero de
 * unas decenas de KB haga lo que haga el usuario con la cámara.
 */

import sharp from "sharp";
import { ErrorCaja } from "./errors.ts";

const ALTO_MAXIMO = 240;

export async function miniaturaBoton(original: Buffer): Promise<Buffer> {
  try {
    return await sharp(original)
      .resize({ height: ALTO_MAXIMO, withoutEnlargement: true })
      .png({ palette: true, colors: 128, effort: 7 })
      .toBuffer();
  } catch {
    // sharp no ha sabido leerla: no era una imagen de verdad, viniera con el
    // content-type que viniera.
    throw new ErrorCaja(
      "ENTRADA_NO_VALIDA",
      "El fichero no se ha podido leer como imagen. Prueba con un PNG o un JPG.",
      400
    );
  }
}
