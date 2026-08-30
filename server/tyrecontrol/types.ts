/**
 * Lo que Assist ve de TyreControl.
 *
 * Es una traducción, no un reflejo: los nombres son los de Assist y los campos
 * se eligen uno a uno. Devolver las filas de TC tal cual ataría cada pantalla
 * de Assist al esquema de TC, y TC cambia por su cuenta.
 */

/** Cómo ha ido la resolución de una matrícula. Nunca «el primero que salga». */
export type ResultadoResolucion = "FOUND" | "NOT_FOUND" | "AMBIGUOUS" | "MAPPING_ERROR";

export type VehiculoTc = {
  tcVehicleId: string;
  empresaId: string;
  empresaNombre: string | null;
  matricula: string;
  tipoVehiculoId: string | null;
  tipoVehiculo: string | null;
  marca: string | null;
  modelo: string | null;
  kmActual: number | null;
  origenKm: string | null;
  activo: boolean;
  updatedAt: string | null;
};

/**
 * De dónde ha salido la empresa con la que se resolvió.
 *
 * Importa distinguirlo: `mapping` es una relación declarada por una persona;
 * `unica` es que solo había un vehículo con esa matrícula en toda la base, que
 * es un indicio bueno pero no una decisión. Quien encargue una escritura debe
 * poder exigir la primera.
 */
export type OrigenEmpresa = "mapping" | "unica" | "indicada";

export type Resolucion =
  | { estado: "FOUND"; vehiculo: VehiculoTc; origenEmpresa: OrigenEmpresa }
  /*
   * Los candidatos van con la resolución ambigua, no en un log: la misma
   * matrícula puede existir en varias empresas de TC —es única por empresa, no
   * globalmente— y quien tenga que desambiguar necesita ver entre qué elige.
   */
  | { estado: "AMBIGUOUS"; candidatos: VehiculoTc[] }
  | { estado: "NOT_FOUND" }
  /*
   * El mapeo apunta a una empresa que no existe o está de baja. NO se resuelve
   * por otra: sería actuar sobre el vehículo de un tercero por un error de
   * configuración que nadie ha visto.
   */
  | { estado: "MAPPING_ERROR"; motivo: string; tcEmpresaId: string };

export type EjeTc = {
  eje: number;
  ruedas: number | null;
  medida: string | null;
  tipoLlanta: string | null;
};

export type NeumaticoTc = {
  neumaticoId: string;
  marca: string | null;
  modelo: string | null;
  medida: string | null;
  dot: string | null;
  numeroSerie: string | null;
  rfid: string | null;
  estado: string;
  /*
   * Las DOS profundidades, separadas a propósito.
   *
   * `tc_neumaticos.profundidad_actual_mm` es el estado que mantiene TC;
   * `revisiones_neumaticos_detalle.profundidad_mm` es lo que se midió el día
   * de la revisión. Pueden diferir, y fundirlas en «la profundidad» inventaría
   * un dato que no existe y escondería justo la discrepancia que interesa.
   */
  profundidadActualMm: number | null;
  reesculturado: boolean | null;
  giradoEnLlanta: boolean | null;
};

export type RevisionPosicionTc = {
  fecha: string | null;
  profundidadMm: number | null;
  /*
   * TC no guarda una presión «actual» en el neumático: solo la medida en una
   * revisión. Se llama por su nombre para que nadie la lea como el estado de
   * hoy.
   */
  ultimaPresionBar: number | null;
  estadoVisual: string | null;
  alertaGenerada: boolean;
  noAccesible: boolean;
  neumaticoAusente: boolean;
  fotoUrl: string | null;
};

export type PosicionTc = {
  posicionId: string;
  codigoPosicion: string;
  nombre: string | null;
  eje: number | null;
  lado: string | null;
  interiorExterior: string | null;
  ordenVisual: number;
  /**
   * Testigo de cambio.
   *
   * `tc_montajes_actuales` tiene `unique(vehiculo_id, posicion_id)` y la fila
   * se borra al desmontar, así que un cambio en esta posición SIEMPRE produce
   * un id distinto. Es el dato con el que una fase posterior podrá saber si
   * alguien tocó la rueda desde TyreControl después de preparar el trabajo.
   */
  montajeActualId: string | null;
  neumatico: NeumaticoTc | null;
  fechaMontaje: string | null;
  kmMontaje: number | null;
  ultimaRevision: RevisionPosicionTc | null;
};

export type EstadoVehiculoTc = {
  vehiculo: VehiculoTc;
  ejes: EjeTc[];
  posiciones: PosicionTc[];
  resumen: {
    posiciones: number;
    montados: number;
    alertas: number;
    /** La menor de las profundidades que TC tiene como actuales. */
    profundidadMinimaMm: number | null;
    ultimaRevisionFecha: string | null;
  };
};
