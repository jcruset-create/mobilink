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
  inicio_servicio:   { x: 366, y: 78 },
  inicio_mecanico:   { x: 366, y: 104 },
  fin_mecanico:      { x: 366, y: 133 },
  fin_servicio:      { x: 366, y: 159 },
  km_mecanico:       { x: 366, y: 184 },
  // Columna izquierda amarilla.
  flota:             { x: 72, y: 141, ancho: 390 },
  matricula:         { x: 72, y: 165, tam: 11 },
  km:                { x: 72, y: 189 },
  fecha:             { x: 72, y: 212 },
} satisfies Record<string, Punto>;

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
  columnas: Record<string, number>;
}

/** Desmontados / permutados. */
export const DESMONTADOS: Tabla = {
  primeraFila: 310,
  alturaFila: 15.6,
  filas: 9,
  columnas: { posicion: 32, descripcion: 60, bar: 214, serie: 250, mm: 327 },
};

/** Montados. */
export const MONTADOS: Tabla = {
  primeraFila: 484,
  alturaFila: 15.6,
  filas: 9,
  columnas: { posicion: 32, descripcion: 60, origen: 234, serie: 292, mm: 377 },
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
 * Las cuatro primeras filas del papel llevan Continental y Semperit
 * PREIMPRESAS con su logo: escribir encima taparía el logo y quedaría sucio.
 * Se empieza en la quinta, que es la primera en blanco. Caben tres marcas
 * distintas; con más, la cuarta y siguientes no se imprimen y el generador lo
 * avisa en vez de amontonarlas.
 */
export const NUEVOS: Tabla = {
  primeraFila: 738,
  alturaFila: 17.5,
  filas: 3,
  columnas: { marca: 33, dimension: 160, modelo: 290, unidades: 352 },
};

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
