/**
 * Posiciones de neumático a partir de la configuración de ejes.
 *
 * La configuración ya determina el resultado por completo ("2x4x2" = 3 ejes
 * con 2, 4 y 2 neumáticos), así que esto es aritmética, no una estimación:
 * no interviene ningún modelo de IA. Es instantáneo, gratis y siempre da lo
 * mismo para la misma entrada.
 *
 * Las coordenadas salen calcadas del patrón del semirremolque 2x2x2, que es
 * el que está bien calibrado a mano: así todos los planos se ven igual en la
 * tablet sin tener que recolocar las ruedas una a una.
 */

export interface PosicionGenerada {
  codigo_posicion: string;
  nombre: string;
  eje: number;
  lado: "izq" | "der";
  interior_exterior: "int" | "ext" | null;
  orden_visual: number;
  pos_x: number;
  pos_y: number;
  pos_w: number;
  pos_h: number;
}

// Valores MEDIDOS sobre los planos reales (lienzo 1536x1024 con el chasis
// centrado, que es el formato del plano del semirremolque): las ruedas caen
// entre el 34 y el 39 % a la izquierda y entre el 61 y el 64 % a la derecha.
// No se copian de las coordenadas guardadas de ningún tipo porque varias
// están desfasadas: apuntan al fondo, de cuando la imagen era otra.
const ANCHO = 7;
const ALTO = 11;
const X_SIMPLE = { izq: 34, der: 58.9 };
// En un eje gemelado caben cuatro, así que cada marca es más estrecha.
const ANCHO_GEMELO = 5;
const X_GEMELO = { izq_ext: 34.9, izq_int: 38.6, der_int: 56.4, der_ext: 60.1 };
// El reparto vertical es aproximado: cada plano coloca los ejes a su manera,
// así que esto deja las ruedas repartidas y ya se afinan arrastrándolas.
const Y_PRIMERO = 15;
const Y_ULTIMO = 78;

/** "2x4x2" → [2, 4, 2]. Devuelve [] si la etiqueta no es válida. */
export function ruedasPorEje(config: string | null | undefined): number[] {
  if (!config) return [];
  const partes = config.split(/x/i).map((p) => Number(p.trim()));
  // Solo 2 (rueda simple) y 4 (gemela) son válidos: cualquier otra cosa es
  // una etiqueta mal escrita y es mejor no inventarse un plano.
  if (!partes.length || partes.some((n) => n !== 2 && n !== 4)) return [];
  return partes;
}

export function generarPosiciones(config: string | null | undefined): PosicionGenerada[] {
  const ejes = ruedasPorEje(config);
  if (!ejes.length) return [];

  const posiciones: PosicionGenerada[] = [];
  let orden = 1;

  ejes.forEach((ruedas, i) => {
    const eje = i + 1;
    const y = ejes.length === 1
      ? (Y_PRIMERO + Y_ULTIMO) / 2
      : Y_PRIMERO + (i * (Y_ULTIMO - Y_PRIMERO)) / (ejes.length - 1);

    const ancho = ruedas === 2 ? ANCHO : ANCHO_GEMELO;
    const añadir = (sufijo: string, nombre: string, lado: "izq" | "der", ie: "int" | "ext" | null, x: number) => {
      posiciones.push({
        codigo_posicion: `E${eje}_${sufijo}`,
        nombre: `Eje ${eje} ${nombre}`,
        eje, lado, interior_exterior: ie,
        orden_visual: orden++,
        pos_x: x, pos_y: y, pos_w: ancho, pos_h: ALTO,
      });
    };

    if (ruedas === 2) {
      añadir("IZQ", "izquierda", "izq", null, X_SIMPLE.izq);
      añadir("DER", "derecha", "der", null, X_SIMPLE.der);
    } else {
      // Orden de fuera hacia dentro y luego hacia fuera, igual que el
      // recorrido de revisión que ya usaban los tipos existentes.
      añadir("IZQ_EXT", "izq. exterior", "izq", "ext", X_GEMELO.izq_ext);
      añadir("IZQ_INT", "izq. interior", "izq", "int", X_GEMELO.izq_int);
      añadir("DER_INT", "der. interior", "der", "int", X_GEMELO.der_int);
      añadir("DER_EXT", "der. exterior", "der", "ext", X_GEMELO.der_ext);
    }
  });

  return posiciones;
}
