/**
 * El documento, derecho y lleno, como si lo hubieran escaneado.
 *
 * ── Por qué no se lo pedimos a un modelo de imagen ─────────────────────────
 *
 * Un modelo de imagen «recorta» REDIBUJANDO: devuelve píxeles nuevos. En una
 * foto de vacaciones da igual; en un DNI significa que el número que acaba en
 * la ficha puede no ser el que había en el documento, y nadie lo notaría
 * hasta el día que hiciera falta. Aquí no se genera ni un píxel: el modelo
 * solo dice DÓNDE están las cuatro esquinas, y cada punto de la imagen final
 * se muestrea de la foto original.
 *
 * ── Por qué cuatro esquinas y no un rectángulo ─────────────────────────────
 *
 * Una foto de un carnet sobre la mesa nunca es un rectángulo: es un trapecio,
 * porque el móvil está inclinado. Con un recuadro recto hay que elegir entre
 * cortar una esquina o dejar media mesa dentro. Con las cuatro esquinas se
 * endereza de verdad, que es lo que hace que parezca escaneado.
 *
 * Y el giro sale gratis: si el documento está tumbado, su esquina superior
 * izquierda está a la izquierda DEL DOCUMENTO, no de la foto, así que la
 * transformación lo pone derecho sin pedir ningún ángulo aparte.
 */

export type Punto = { x: number; y: number };

/** Las esquinas DEL DOCUMENTO, en proporciones de la foto (0 a 1). */
export type Esquinas = {
  supIzq: Punto;
  supDer: Punto;
  infDer: Punto;
  infIzq: Punto;
};

export const ESQUEMA_ESQUINAS = {
  type: "object",
  additionalProperties: false,
  required: ["encontrado", "esquinas", "nota"],
  properties: {
    encontrado: { type: "boolean" },
    esquinas: {
      type: "object",
      additionalProperties: false,
      required: ["supIzq", "supDer", "infDer", "infIzq"],
      properties: {
        supIzq: punto(),
        supDer: punto(),
        infDer: punto(),
        infIzq: punto(),
      },
    },
    nota: { type: "string" },
  },
} as const;

function punto() {
  return {
    type: "object",
    additionalProperties: false,
    required: ["x", "y"],
    properties: { x: { type: "number" }, y: { type: "number" } },
  } as const;
}

export const INSTRUCCIONES_ESQUINAS = [
  "En la foto hay un documento de identidad (DNI, NIE o permiso de conducción)",
  "apoyado en una mesa, en una mano o sobre cualquier fondo, y casi siempre",
  "fotografiado de forma un poco inclinada.",
  "",
  "Devuelve las CUATRO ESQUINAS del documento, en proporciones de la imagen:",
  "0,0 es la esquina superior izquierda de la FOTO y 1,1 la inferior derecha.",
  "",
  "Importante: las esquinas son las DEL DOCUMENTO, no las de la foto.",
  "- supIzq es la esquina del documento que queda arriba a la izquierda CUANDO",
  "  el documento se lee derecho.",
  "- supDer la de arriba a la derecha leyéndolo, infDer la de abajo a la",
  "  derecha e infIzq la de abajo a la izquierda.",
  "",
  "Si el documento está tumbado o del revés en la foto, eso se nota en el",
  "orden de las esquinas: dalas según se lee el documento, no según la foto.",
  "",
  "Si no hay ningún documento, o no se distinguen sus bordes, `encontrado`",
  "falso y lo explicas en `nota`. No te inventes esquinas.",
].join("\n");

/** Lo más ancho que se guarda: un documento a 1600 px se lee de sobra. */
export const ANCHO_MAXIMO = 1600;

const dist = (a: Punto, b: Punto) => Math.hypot(a.x - b.x, a.y - b.y);

/** Área del cuadrilátero (fórmula del cordón), en proporción de la foto. */
export function areaDeEsquinas(e: Esquinas): number {
  const p = [e.supIzq, e.supDer, e.infDer, e.infIzq];
  let s = 0;
  for (let i = 0; i < 4; i++) {
    const a = p[i];
    const b = p[(i + 1) % 4];
    s += a.x * b.y - b.x * a.y;
  }
  return Math.abs(s) / 2;
}

/**
 * ¿Se puede enderezar con estas esquinas?
 *
 * Lo que se descarta y por qué:
 *  · puntos que no son números, o muy fuera de la foto — el modelo ha
 *    contestado en píxeles, o se lo ha inventado;
 *  · un cuadrilátero de menos del 10 % de la foto — eso no es un documento
 *    en primer plano, es una tarjeta perdida en una mesa;
 *  · lados que se cruzan — las esquinas vienen desordenadas, y enderezar con
 *    ellas da una imagen del revés o doblada.
 */
export function esquinasValidas(e: Esquinas | null | undefined): e is Esquinas {
  if (!e) return false;
  const p = [e.supIzq, e.supDer, e.infDer, e.infIzq];
  if (p.some((q) => !q || typeof q.x !== "number" || typeof q.y !== "number")) return false;
  if (p.some((q) => !Number.isFinite(q.x) || !Number.isFinite(q.y))) return false;
  // Un poco fuera se tolera: una esquina puede quedar justo en el borde.
  if (p.some((q) => q.x < -0.1 || q.x > 1.1 || q.y < -0.1 || q.y > 1.1)) return false;
  if (areaDeEsquinas(e) < 0.1) return false;

  // Convexo y en orden: los cuatro productos vectoriales con el mismo signo.
  let signo = 0;
  for (let i = 0; i < 4; i++) {
    const a = p[i];
    const b = p[(i + 1) % 4];
    const c = p[(i + 2) % 4];
    const cruz = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (Math.abs(cruz) < 1e-9) return false;
    const s = Math.sign(cruz);
    if (signo === 0) signo = s;
    else if (s !== signo) return false;
  }
  return true;
}

/**
 * El tamaño de la imagen final.
 *
 * Se toma el lado más largo de cada par —arriba/abajo e izquierda/derecha—
 * para no encoger el documento al enderezarlo: lo que está más lejos del
 * objetivo sale más pequeño en la foto, y estirar es mejor que recortar.
 */
export function tamanoDeSalida(
  e: Esquinas,
  ancho: number,
  alto: number,
  anchoMaximo = ANCHO_MAXIMO
): { ancho: number; alto: number } {
  const px = (p: Punto) => ({ x: p.x * ancho, y: p.y * alto });
  const a = px(e.supIzq);
  const b = px(e.supDer);
  const c = px(e.infDer);
  const d = px(e.infIzq);

  const w = Math.max(dist(a, b), dist(d, c));
  const h = Math.max(dist(a, d), dist(b, c));
  if (!(w > 0) || !(h > 0)) return { ancho: 0, alto: 0 };

  const escala = Math.min(1, anchoMaximo / w);
  return {
    ancho: Math.max(32, Math.round(w * escala)),
    alto: Math.max(32, Math.round(h * escala)),
  };
}

/**
 * Los ocho coeficientes que llevan el cuadrado unidad al cuadrilátero.
 *
 * Es la forma cerrada de Heckbert: evita montar y resolver un sistema de 8x8
 * para cada foto, y es la misma matemática. Con ellos, cada punto (u,v) de la
 * imagen final sabe de qué punto de la foto original se copia.
 */
export function coeficientesHomografia(
  e: Esquinas,
  ancho: number,
  alto: number
): { a: number; b: number; c: number; d: number; e: number; f: number; g: number; h: number } {
  const x0 = e.supIzq.x * ancho, y0 = e.supIzq.y * alto;
  const x1 = e.supDer.x * ancho, y1 = e.supDer.y * alto;
  const x2 = e.infDer.x * ancho, y2 = e.infDer.y * alto;
  const x3 = e.infIzq.x * ancho, y3 = e.infIzq.y * alto;

  const dx1 = x1 - x2, dx2 = x3 - x2, dx3 = x0 - x1 + x2 - x3;
  const dy1 = y1 - y2, dy2 = y3 - y2, dy3 = y0 - y1 + y2 - y3;

  let g = 0;
  let h = 0;
  const den = dx1 * dy2 - dx2 * dy1;
  if (Math.abs(dx3) > 1e-9 || Math.abs(dy3) > 1e-9) {
    if (Math.abs(den) > 1e-9) {
      g = (dx3 * dy2 - dx2 * dy3) / den;
      h = (dx1 * dy3 - dx3 * dy1) / den;
    }
  }

  return {
    a: x1 - x0 + g * x1,
    b: x3 - x0 + h * x3,
    c: x0,
    d: y1 - y0 + g * y1,
    e: y3 - y0 + h * y3,
    f: y0,
    g,
    h,
  };
}

/**
 * Endereza el documento: por cada píxel de salida, de dónde se copia.
 *
 * Muestreo bilineal —la media ponderada de los cuatro píxeles vecinos— para
 * que el texto pequeño del documento no salga dentado. Trabaja sobre el búfer
 * crudo que da `sharp`, así que no depende de ninguna librería de imagen.
 */
export function enderezar(
  origen: Buffer,
  ancho: number,
  alto: number,
  canales: number,
  esquinas: Esquinas,
  salida: { ancho: number; alto: number }
): Buffer {
  const m = coeficientesHomografia(esquinas, ancho, alto);
  const destino = Buffer.alloc(salida.ancho * salida.alto * canales);

  for (let py = 0; py < salida.alto; py++) {
    const v = (py + 0.5) / salida.alto;
    for (let px = 0; px < salida.ancho; px++) {
      const u = (px + 0.5) / salida.ancho;

      const w = m.g * u + m.h * v + 1;
      const sx = (m.a * u + m.b * v + m.c) / w;
      const sy = (m.d * u + m.e * v + m.f) / w;

      // Fuera de la foto: negro. Solo pasa en los bordes de un cuadrilátero
      // que asomaba por fuera, y es mejor un borde negro que un píxel al azar.
      const base = (py * salida.ancho + px) * canales;
      if (sx < 0 || sy < 0 || sx > ancho || sy > alto) continue;

      /*
       * Medio píxel de desplazamiento, y no es un detalle menor: (0,0) es la
       * ESQUINA de la foto y el centro del primer píxel está en (0.5, 0.5).
       * Sin restarlo, enderezar un documento ya derecho devolvía la imagen
       * emborronada medio píxel, que en el texto pequeño de un DNI se nota.
       */
      const ix = Math.min(ancho - 1, Math.max(0, sx - 0.5));
      const iy = Math.min(alto - 1, Math.max(0, sy - 0.5));

      const x0 = Math.floor(ix);
      const y0 = Math.floor(iy);
      const x1 = Math.min(x0 + 1, ancho - 1);
      const y1 = Math.min(y0 + 1, alto - 1);
      const fx = ix - x0;
      const fy = iy - y0;

      const i00 = (y0 * ancho + x0) * canales;
      const i10 = (y0 * ancho + x1) * canales;
      const i01 = (y1 * ancho + x0) * canales;
      const i11 = (y1 * ancho + x1) * canales;

      for (let c = 0; c < canales; c++) {
        const arriba = origen[i00 + c] * (1 - fx) + origen[i10 + c] * fx;
        const abajo = origen[i01 + c] * (1 - fx) + origen[i11 + c] * fx;
        destino[base + c] = Math.round(arriba * (1 - fy) + abajo * fy);
      }
    }
  }

  return destino;
}
