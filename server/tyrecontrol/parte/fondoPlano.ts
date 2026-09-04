import sharp from "sharp";

/**
 * Quitarle el fondo negro al plano del chasis.
 *
 * Los planos de Mobilink son renders sobre fondo negro. Metidos tal cual en el
 * parte, dejan un rectángulo negro en medio de un papel blanco: se ve el
 * recuadro del render, no el camión.
 *
 * ── POR QUÉ RELLENO DESDE EL BORDE Y NO UN UMBRAL ───────────────────────────
 *
 * Lo evidente sería «pinta de blanco todo lo oscuro». Sería un desastre: en un
 * plano de un camión lo más oscuro son LAS RUEDAS, que es justo lo que hay que
 * conservar. Un umbral se las come.
 *
 * Así que se rellena desde los bordes hacia dentro, como el bote de pintura:
 * solo se aclara lo oscuro que está CONECTADO con el borde de la imagen, que
 * es el fondo. Una rueda oscura en medio del chasis no toca el borde y se
 * queda. Una que sí llegue al filo se protege con el umbral, que es estrecho a
 * propósito: el fondo de estos renders es negro de verdad y el caucho no.
 *
 * ── Y SI SALE MAL, NO SE TOCA ───────────────────────────────────────────────
 *
 * Si al terminar no queda prácticamente nada opaco, la imagen no era un plano
 * sobre fondo negro sino algo oscuro entero, y lo que habría quedado es un
 * papel en blanco. En ese caso se devuelve el original: un plano con fondo
 * negro es feo; uno borrado es una mentira sobre el camión.
 *
 * El corte NO puede ir por «cuánto fondo hay»: en un render de un remolque el
 * fondo se lleva de largo la mayor parte de la imagen y sigue estando bien.
 * Lo que importa es cuánto vehículo QUEDA.
 */

/** Un píxel de fondo: oscuro de verdad, no un gris de caucho. */
const UMBRAL = 42;

/** Si tras aclarar queda menos de esto opaco, no había vehículo que salvar. */
const MINIMO_QUE_QUEDA = 0.03;

export async function quitarFondoNegro(bytes: Uint8Array): Promise<Uint8Array> {
  try {
    const img = sharp(Buffer.from(bytes));
    const { width: w, height: h } = await img.metadata();
    if (!w || !h || w * h > 12_000_000) return bytes; // desmesurada: ni se toca

    const { data } = await img.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const n = w * h;

    // Relleno por anchura desde todo el borde. Cola de índices de píxel, no de
    // coordenadas: una imagen de 4K son 8 millones de píxeles y un array de
    // objetos ahí dentro se come la memoria.
    const visto = new Uint8Array(n);
    const cola = new Int32Array(n);
    let cabeza = 0, cola_ = 0;

    const oscuro = (i: number) => {
      const p = i * 4;
      return data[p] <= UMBRAL && data[p + 1] <= UMBRAL && data[p + 2] <= UMBRAL;
    };
    const empujar = (i: number) => {
      if (visto[i] || !oscuro(i)) return;
      visto[i] = 1;
      cola[cola_++] = i;
    };

    for (let x = 0; x < w; x++) { empujar(x); empujar((h - 1) * w + x); }
    for (let y = 0; y < h; y++) { empujar(y * w); empujar(y * w + w - 1); }

    while (cabeza < cola_) {
      const i = cola[cabeza++];
      const x = i % w, y = (i / w) | 0;
      if (x > 0) empujar(i - 1);
      if (x < w - 1) empujar(i + 1);
      if (y > 0) empujar(i - w);
      if (y < h - 1) empujar(i + w);
    }

    if ((n - cola_) / n < MINIMO_QUE_QUEDA) return bytes;

    // Transparente, no blanco: así el plano se posa sobre el papel sin dejar
    // un recuadro, y si algún día el recuadro tuviera color, seguiría bien.
    for (let k = 0; k < cola_; k++) data[cola[k] * 4 + 3] = 0;

    const salida = await sharp(data, { raw: { width: w, height: h, channels: 4 } })
      .png().toBuffer();
    return new Uint8Array(salida);
  } catch {
    // Un plano que no se deja procesar entra tal cual: con fondo, pero entra.
    return bytes;
  }
}
