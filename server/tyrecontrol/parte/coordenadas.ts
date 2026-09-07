/**
 * Dónde va cada dato del parte de servicio Conti360.
 *
 * TODAS las coordenadas van en puntos y MEDIDAS DESDE ARRIBA, que es como las
 * mide cualquier visor de PDF y como se ven al abrir la plantilla. pdf-lib
 * cuenta desde abajo, así que la conversión se hace UNA vez en el generador
 * (`aPdf`). Así ajustar un campo es mover el número que se lee en pantalla, no
 * hacer una resta mental cada vez.
 *
 * Salieron de la propia plantilla: se extrajo el texto con sus recuadros
 * (mupdf) y se colocó cada valor junto a su etiqueta, no midiendo a ojo sobre
 * una imagen. Los recuadros de las tablas sí están estimados a partir de la
 * cabecera y comprobados mirando el PDF generado.
 *
 * PARA AJUSTAR UN CAMPO: cambia su x/y aquí. No hace falta tocar el generador.
 */

/** Alto de la plantilla, en puntos. A4. */
export const ALTO = 842;
export const ANCHO = 595;

export interface Punto { x: number; y: number; tam?: number; ancho?: number }

/** Cabecera. */
export const CABECERA = {
  // Cabe poco: al ras del borde derecho se cortaba. Se ancla antes y se
  // deja que el generador lo encoja si el número es largo.
  numero:            { x: 520, y: 36, tam: 10, ancho: 66 },
  orden_flota:       { x: 366, y: 55, ancho: 120 },
  inicio_servicio:   { x: 345, y: 79 },
  inicio_mecanico:   { x: 345, y: 108 },
  fin_mecanico:      { x: 345, y: 133 },
  fin_servicio:      { x: 345, y: 162 },
  km_mecanico:       { x: 345, y: 186 },
  // Columna izquierda amarilla.
  flota:             { x: 72, y: 144, ancho: 155 },
  matricula:         { x: 72, y: 167, tam: 11, ancho: 155 },
  km:                { x: 72, y: 191, ancho: 155 },
  fecha:             { x: 72, y: 214, ancho: 155 },
} satisfies Record<string, Punto>;

/**
 * El recuadro de «Posición Ruedas».
 *
 * El diagrama impreso es el de Conti360, con su numeración 1IZI/2IZE. Nosotros
 * usamos el esquema de Mobilink —el tipo de vehículo y su plano—, así que se
 * TAPA y se pone encima la configuración real del vehículo. Enseñar dos
 * numeraciones distintas en el mismo papel es pedir que alguien apunte una
 * medición en la rueda equivocada.
 */
// El cuadro entero de la esquina superior derecha, LOGOS INCLUIDOS: se tapa en
// blanco y se vuelve a dibujar el marco y el rótulo. Los logos de Continental
// y Conti360 son de la plantilla de papel de Conti; el parte que emite
// Mobilink no los lleva, y quitarlos deja sitio para que el vehículo se vea
// grande, que es lo que se mira.
//
// Medido sobre la plantilla: el marco del cuadro de posiciones va de x 403,5 a
// 566,6 y de y 87,0 a 194,1, y los dos logos ocupan de y 52,4 a 86,5. Se tapa
// de 398 a 568 y de 44 a 194, y el cuadro nuevo ocupa todo ese hueco.
export const POSICION_RUEDAS_LIMPIAR = { x: 398, y: 44, ancho: 170, alto: 150 };
/** El marco del cuadro nuevo. El rótulo va dentro, arriba a la izquierda. */
export const POSICION_RUEDAS_MARCO = { x: 400, y: 46, ancho: 166, alto: 147.5 };
export const POSICION_RUEDAS_TITULO = { x: 403, y: 55, tam: 7 };
/** Dónde se dibuja el vehículo: todo el cuadro menos la línea del rótulo. */
export const POSICION_RUEDAS = { x: 402, y: 57, ancho: 162, alto: 134.5 };

/**
 * El cuadrado que se pinta al lado de cada rueda, con la cruz roja dentro si
 * esa posición se ha tocado, y el código de la posición debajo.
 */
export const CUADRO_POSICION = { lado: 13, separacion: 3, tamCruz: 11, tamCodigo: 5 };

/** Las tres casillas de dónde se hizo el servicio. */
export const LUGAR: Record<"taller" | "flota" | "carretera", Punto> = {
  taller:    { x: 85, y: 265 },
  flota:     { x: 187, y: 265 },
  carretera: { x: 282, y: 265 },
};

/**
 * Una tabla de neumáticos: dónde empieza la primera fila, cuánto baja cada
 * una, cuántas caben y en qué x va cada columna.
 */
export interface Tabla {
  primeraFila: number;
  alturaFila: number;
  filas: number;
  /** Dónde EMPIEZA el texto de cada columna (las anchas, alineadas a la izquierda). */
  columnas: Record<string, number>;
  /**
   * Las columnas ESTRECHAS, con su caja real [izquierda, derecha].
   *
   * Bar, Mm, Ps y Origen miden entre 14 y 29 puntos en la plantilla. Puestas a
   * la izquierda con un ancho inventado, el texto se salía por encima de la
   * raya de al lado — se veía «almacen» pisando el filete y el «14.0» tocando
   * el borde. Con la caja de verdad, el texto se centra y se encoge para
   * caber, que es lo que hace una persona rellenando el papel a mano.
   */
  cajas?: Record<string, [number, number]>;
}

/**
 * La casilla «Ps», ENSANCHADA.
 *
 * En el papel de Conti ahí va un número del diagrama (1, 2, 3…) y mide 14
 * puntos. Los códigos de Mobilink son E1_IZQ, E1_DER…, que necesitan 28: no
 * caben, y se salían por encima del filete.
 *
 * Así que el filete se MUEVE: se tapa el de 42 y se pinta uno nuevo en 60. La
 * columna de la descripción pierde 18 puntos de los 170 que tenía, y ahí sigue
 * cabiendo «385/65R22.5 158L Hankook TH31+» de sobra.
 *
 * Al tapar el filete viejo se borra también el trocito de cada raya horizontal
 * que lo cruza, así que hay que volver a pintarlas: por eso están aquí las «y»
 * de la rejilla, leídas de la plantilla.
 */
export const SEPARADOR_PS = 60;

/** Las rayas horizontales de cada tabla, para recomponerlas al mover el filete. */
export const RAYAS_DESMONTADOS = [
  292.97, 304.25, 322.49, 340.61, 358.73, 376.85, 395.09, 413.23, 431.35, 449.59,
];
export const RAYAS_MONTADOS = [
  462.21, 475.73, 492.74, 509.75, 526.75, 543.76, 560.77, 577.78, 594.78, 611.79,
];

/*
 * Las dos tablas, MEDIDAS SOBRE LA PLANTILLA, no estimadas.
 *
 * Antes iban a ojo (primera fila 310, altura 15,6, nueve filas) y el resultado
 * era el que se veía en el papel: la primera línea se metía debajo de la
 * cabecera y la segunda salía tachada por la raya de la rejilla, porque el
 * texto bajaba 15,6 y la rejilla 18,1 — cada fila se desviaba un poco más.
 *
 * Los números de aquí abajo salen de leer los rectángulos de la propia
 * plantilla (parte_conti360.pdf):
 *
 *   Desmontados: cabecera 292,97–304,25; ocho filas de 18,15 desde 304,25.
 *   Montados:    cabecera 462,21–475,73; ocho filas de 17,01 desde 475,73.
 *
 * `primeraFila` es la LÍNEA BASE del texto, no el borde de la casilla: se
 * centra en la fila (borde + (alto + altura de mayúscula) / 2, con la
 * mayúscula de Helvetica a 8 pt ≈ 5,7).
 *
 * Y son OCHO filas, no nueve: la novena caía fuera de la rejilla, encima del
 * rótulo «Neumáticos Montados». Lo que no cabe pasa a la página siguiente,
 * que para eso está.
 */

/**
 * Desmontados / permutados.
 * Columnas medidas: 28,32 | 42,24 | 212,21 | 226,25 | 325,75 | 339,91.
 */
export const DESMONTADOS: Tabla = {
  primeraFila: 316.2,
  alturaFila: 18.15,
  filas: 8,
  columnas: { descripcion: 64, serie: 230 },
  cajas: {
    posicion: [28.32, SEPARADOR_PS],
    descripcion: [SEPARADOR_PS, 212.21],
    bar: [212.21, 226.25],
    serie: [226.25, 325.75],
    mm: [325.75, 339.91],
  },
};

/**
 * Montados.
 * Columnas medidas: 27,71 | 41,72 | 228,66 | 257,60 | 372,18 | 387,00.
 */
export const MONTADOS: Tabla = {
  primeraFila: 487.1,
  alturaFila: 17.01,
  filas: 8,
  columnas: { descripcion: 64, serie: 261 },
  cajas: {
    posicion: [27.71, SEPARADOR_PS],
    descripcion: [SEPARADOR_PS, 228.66],
    origen: [228.66, 257.60],
    serie: [257.60, 372.18],
    mm: [372.18, 387.00],
  },
};


/**
 * Las diez casillas de «Razón de Sustitución», por código de motivo.
 * La x es la del centro de la columna; la y la pone la fila.
 */
export const RAZON_X: Record<string, number> = {
  desgaste:            345,
  cambio_posicion:     357,
  pinchazo:            370,
  dano_golpe:          382,
  desgaste_irregular:  395,
  cortes:              407,
  roces_flanco:        420,
  dano_banda_rodadura: 432,
  rodaje_sin_presion:  445,
  robo:                457,
};

/** Las siete de «Destino del Neumático». */
export const DESTINO_X: Record<string, number> = {
  comprada_taller:     481,
  almacen_flota:       493,
  carcasa_continental: 506,
  desechado:           518,
  reclamacion:         530,
  almacen_taller:      543,
  montada_vehiculo:    556,
};

/** Neumáticos nuevos montados: marca, dimensión, modelo, unidades. */
/**
 * Neumáticos nuevos montados.
 *
 * Las cuatro primeras filas del papel vienen con Continental y Semperit
 * PREIMPRESAS sobre un fondo amarillo y otro gris. El parte de Mobilink no
 * vende una marca concreta: se tapan esos cuatro rellenos en blanco, se vuelve
 * a trazar la rejilla y se usan las SEIS filas, empezando por la primera.
 */
export const NUEVOS: Tabla = {
  primeraFila: 670,
  alturaFila: 17.02,
  filas: 6,
  columnas: { marca: 33, dimension: 160, modelo: 290, unidades: 352 },
};

/**
 * Los rellenos de color de las cuatro filas de marca, medidos sobre los
 * vectores de la plantilla. Se tapan en blanco.
 */
export const NUEVOS_FONDOS = [
  { x: 27.71, y: 661.10, ancho: 359.29, alto: 17.01 },
  { x: 27.71, y: 678.11, ancho: 359.29, alto: 17.00 },
  { x: 27.71, y: 694.96, ancho: 359.29, alto: 17.01 },
  { x: 27.71, y: 712.23, ancho: 359.29, alto: 17.01 },
] as const;

/**
 * Y la rejilla que hay que devolver encima: las mismas cuatro filas y la línea
 * que separa la columna de Unidades, tal como están trazadas en la plantilla.
 */
export const NUEVOS_REJILLA = {
  x: 27.7,
  ancho: 359.3,
  columnaUnidades: 330.7,
  grosor: 0.5,
  filas: [
    { y: 661.2, alto: 17.0 },
    { y: 678.2, alto: 17.0 },
    { y: 695.2, alto: 17.0 },
    { y: 712.2, alto: 17.0 },
  ],
} as const;

/** Servicios realizados: la y de cada línea y la x de la cantidad. */
export const SERVICIOS_X_CANTIDAD = 556;
export const SERVICIOS_Y: Record<string, number> = {
  desmontar_montar_cubierta: 484,
  quitar_poner_rueda:        499,
  equilibrado:               516,
  pinchazo:                  533,
  rayados:                   550,
  alineacion_standard:       564,   // la casilla de Standard
  alineacion_compleja:       564,   // la de Compleja, otra x
  salida_servicio_movil:     580,
  km_recorridos:             598,
  horas_oficial_1a:          613,
  valvulas:                  627,
  alargaderas:               644,
};
/** Las dos casillas de alineación no van en la columna de cantidad. */
export const ALINEACION_X = { standard: 461, compleja: 506 };

/** Firmas. */
export const FIRMAS = {
  cliente_nombre: { x: 33, y: 786 },
  cliente_dni:    { x: 33, y: 816 },
  cliente_firma:  { x: 280, y: 778, ancho: 250, alto: 60 },
  tecnico_nombre: { x: 430, y: 786 },
  tecnico_firma:  { x: 430, y: 812, ancho: 140, alto: 40 },
};

/** De «desde arriba» a lo que pdf-lib espera. */
export function aPdf(y: number): number {
  return ALTO - y;
}
