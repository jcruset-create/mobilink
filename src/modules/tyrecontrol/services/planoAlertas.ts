/**
 * Dónde va el recuadro de cada rueda sobre la foto del chasis.
 *
 * ── Por qué no valen las coordenadas guardadas ──────────────────────────────
 *
 * `tc_posiciones_vehiculo.pos_x/pos_y` existe justo para esto, pero coloca el
 * RECUADRO GRANDE de la ficha, que lleva dentro marca, modelo, medida y dos
 * números. Están calibradas para que esas etiquetas no se pisen entre ellas,
 * así que se abren hacia los lados: en el autobús 2x4, de las seis posiciones
 * NINGUNA cae sobre la goma y dos se salen de la foto (E2_IZQ_EXT queda en el
 * −1,5 % del ancho de la imagen y E2_DER_EXT en el 100 %). Para un recuadro
 * pequeño encima de la rueda no sirven.
 *
 * ── De dónde salen entonces ─────────────────────────────────────────────────
 *
 * De medir las ruedas sobre la propia foto. Se hizo con un barrido de brillo
 * por filas y columnas (las gomas son el gris más claro sobre el fondo negro),
 * mirando solo los tercios laterales para que los largueros del bastidor no
 * ensucien la cuenta. Los valores de abajo son el centro de cada neumático en
 * fracción de la imagen, con el frente arriba.
 *
 * ── La tabla va por FOTO, no por número de ejes ────────────────────────────
 *
 * Es la lección de la furgoneta: su chasis está en una imagen APAISADA y con
 * el eje trasero en el 77 % del alto, mientras que el del autobús —dos ejes
 * también— está en el 60 %. Deducir la geometría del número de ejes habría
 * salido bien con las dos primeras fotos y mal con la tercera.
 *
 * La clave es el último tramo de la URL, que lleva el sello de tiempo de la
 * subida. Si alguien sube una foto nueva, la clave deja de casar y se cae a la
 * regla de reserva: se pierde el ajuste fino, pero las marcas siguen en el eje
 * y en el lado que les toca. Eso es mejor que seguir pintando sobre unas
 * medidas que ya no son de esa imagen.
 */

export interface RuedaDelPlano {
  codigo_posicion: string | null;
  eje: number | null;
  lado: string | null;
  interior_exterior: string | null;
}

export interface MarcaDelPlano {
  /** El `codigo_posicion` de la rueda, para casar con su fila. */
  codigo: string;
  /** En % del ancho y del alto de la imagen, para un `left`/`top` de CSS. */
  left: number;
  top: number;
}

/** El centro de las ruedas de un eje, en fracción de la imagen. */
interface EjeMedido {
  y: number;
  /** Eje sencillo: una rueda por lado. */
  simple?: number;
  /** Eje gemelo: la exterior y la interior del lado izquierdo. */
  ext?: number;
  int?: number;
}

/**
 * Lo medido sobre las fotos que hay subidas hoy. La clave es el nombre del
 * fichero dentro del bucket `tc-chasis`.
 */
const FOTOS_MEDIDAS: Record<string, EjeMedido[]> = {
  // Configuración «2X4 BUS» — 573 vehículos de Plana. 1023 × 1537.
  "1785514268172.png": [
    { y: 0.143, simple: 0.263 },
    { y: 0.600, ext: 0.258, int: 0.315 },
  ],
  // Configuración «2x4x2 Bus» — 110 vehículos. 984 × 1599.
  "1790189505870.png": [
    { y: 0.122, simple: 0.260 },
    { y: 0.489, ext: 0.250, int: 0.312 },
    { y: 0.745, simple: 0.256 },
  ],
  // Tipo «furgoneta» — 80 vehículos. 1755 × 1537, apaisada.
  "1785511664708-alineada.png": [
    { y: 0.190, simple: 0.340 },
    { y: 0.770, simple: 0.340 },
  ],
};

/**
 * Separaciones del recuadro respecto al centro de su rueda, en fracción de la
 * imagen. Son las que se validaron sobre el visual antes de programar.
 */
const SEPARACION = {
  /** Eje sencillo normal: el recuadro al lado de la rueda, hacia fuera. */
  ejeSencillo: 0.085,
  /**
   * Del TERCER eje en adelante, más despegado: ahí la foto lleva el motor, el
   * escape y el puente, y el recuadro pegado a la goma no se leía.
   *
   * Solo a partir del tercero, y no «todos menos el primero», que fue el
   * primer intento: a la furgoneta —dos ejes sencillos— le dejaba el recuadro
   * trasero flotando en el negro, lejos de su rueda. Se vio al pintar las tres
   * fotos de verdad una al lado de la otra.
   */
  terceroEnAdelante: 0.146,
  /** Eje gemelo: detrás de los neumáticos... */
  gemeloAtras: 0.145,
  /** ...y la exterior abierta hacia fuera, que encima no caben las dos. */
  gemeloExterior: 0.055,
};

/** Clave de una foto: el nombre del fichero, sin la ruta ni los parámetros. */
export function claveDeFoto(url: string | null | undefined): string {
  if (!url) return "";
  const sinParametros = url.split("?")[0];
  return sinParametros.substring(sinParametros.lastIndexOf("/") + 1);
}

/**
 * La geometría de reserva, cuando la foto no está medida: los ejes repartidos
 * a lo alto y las ruedas donde las tiene el autobús, que es la forma más común
 * de la flota. Aproxima; no inventa posiciones imposibles.
 */
function ejesDeReserva(numeroDeEjes: number, gemelos: boolean[]): EjeMedido[] {
  const primero = 0.16;
  const ultimo = 0.78;
  return Array.from({ length: numeroDeEjes }, (_, i) => {
    const y = numeroDeEjes === 1 ? 0.5 : primero + (i * (ultimo - primero)) / (numeroDeEjes - 1);
    return gemelos[i] ? { y, ext: 0.258, int: 0.315 } : { y, simple: 0.263 };
  });
}

/**
 * Los recuadros de un vehículo, listos para pintar sobre su foto.
 *
 * Las ruedas pueden venir en cualquier orden: lo que manda es `eje`, `lado` e
 * `interior_exterior`, que es lo que dice dónde está la rueda de verdad. El
 * `orden_visual` NO se usa a propósito: es geométrico (ext, int, int, ext) y
 * ya hizo bastante daño en el parte de papel.
 */
export function marcasDelPlano(ruedas: RuedaDelPlano[], fotoUrl: string | null | undefined): MarcaDelPlano[] {
  const conEje = ruedas.filter((r) => r.codigo_posicion && r.eje != null);
  if (conEje.length === 0) return [];

  const ejes = [...new Set(conEje.map((r) => r.eje as number))].sort((a, b) => a - b);
  const esGemelo = ejes.map((e) => conEje.some((r) => r.eje === e && r.interior_exterior != null));

  const medidas = FOTOS_MEDIDAS[claveDeFoto(fotoUrl)] ?? ejesDeReserva(ejes.length, esGemelo);

  const marcas: MarcaDelPlano[] = [];
  for (const rueda of conEje) {
    const indice = ejes.indexOf(rueda.eje as number);
    // Una foto medida para 3 ejes y un vehículo de 2 (o al revés) no casan:
    // antes que pintar la rueda en un sitio inventado, no se pinta.
    const medida = medidas[indice];
    if (!medida) continue;

    const izquierda = rueda.lado === "izq";
    const gemela = rueda.interior_exterior != null;

    let x: number;
    let y = medida.y;

    if (gemela) {
      const exterior = rueda.interior_exterior === "ext";
      const base = exterior ? medida.ext : medida.int;
      // La foto dice que ese eje es sencillo y la rueda es gemela: sin medida
      // fiable para el gemelo, se cae al centro del eje.
      const centro = base ?? medida.simple ?? 0.263;
      const haciaFuera = exterior ? SEPARACION.gemeloExterior : 0;
      x = izquierda ? centro - haciaFuera : 1 - centro + haciaFuera;
      y = medida.y + SEPARACION.gemeloAtras;
    } else {
      const centro = medida.simple ?? medida.ext ?? 0.263;
      const fuera = indice >= 2 ? SEPARACION.terceroEnAdelante : SEPARACION.ejeSencillo;
      x = izquierda ? centro - fuera : 1 - centro + fuera;
    }

    marcas.push({
      codigo: rueda.codigo_posicion as string,
      left: Math.round(x * 1000) / 10,
      top: Math.round(y * 1000) / 10,
    });
  }
  return marcas;
}
