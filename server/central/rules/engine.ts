/**
 * Motor de reglas de MC Central.
 *
 * Sin base de datos y sin red: recibe las reglas y el estado de una caja, y
 * dice qué incidencias hay. Es el mismo patrón que el motor de la caja
 * (`cash/domain/`), y por el mismo motivo: una regla que decide si alguien
 * recibe un aviso a las tres de la mañana tiene que poder probarse en un
 * milisegundo y sin montar nada.
 *
 * **La jerarquía: gana la regla MÁS ESPECÍFICA.** Una regla de la caja tapa la
 * de su taller, que tapa la de su zona, que tapa la de la empresa. No se suman
 * ni se promedian: mandan una sola, la de abajo.
 *
 * Es lo que hace falta de verdad en una red: la empresa dice «avisad de
 * descuadres de más de 20 €», pero la gasolinera, que mueve diez veces más
 * dinero, necesita 100 € o el aviso salta cada día y deja de leerse. Sin
 * jerarquía solo caben dos malas salidas: un umbral demasiado alto que no
 * detecta nada, o uno demasiado bajo que nadie mira.
 *
 * Y **una regla apagada abajo apaga el aviso**, aunque arriba esté encendida.
 * Es la misma regla de especificidad: si no valiera para desactivar, la única
 * forma de silenciar una caja concreta sería apagarla para toda la empresa.
 */

/** Dónde se aplica una regla. De lo general a lo concreto. */
export type Ambito = "EMPRESA" | "ZONA" | "CENTRO" | "CAJA";

/** Cuanto mayor, más específico. Es todo el criterio de resolución. */
const ESPECIFICIDAD: Record<Ambito, number> = {
  EMPRESA: 0,
  ZONA: 1,
  CENTRO: 2,
  CAJA: 3,
};

/**
 * Qué se vigila.
 *
 * Cada tipo mira UNA cosa medible que Central ya conoce. No hay reglas
 * genéricas con expresiones: una condición que hay que interpretar es una
 * condición que nadie sabe si está bien escrita hasta que falla.
 */
export type TipoRegla =
  /** El arqueo o el cierre descuadra más de X céntimos, en valor absoluto. */
  | "DESCUADRE"
  /** Dinero fuera del cajón más de X días. */
  | "TRANSITO_DIAS"
  /** Una caja lleva más de X días sin cerrar. */
  | "SIN_CERRAR_DIAS"
  /** Cierres sin llevar al banco desde hace más de X días. */
  | "PENDIENTE_BANCO_DIAS"
  /** La caja baja de X céntimos en monedas. */
  | "CALDERILLA_MINIMA"
  /**
   * A la caja le quedan menos de X días de cambio, según la predicción.
   *
   * Es distinto de `CALDERILLA_MINIMA` y las dos hacen falta: un importe fijo
   * no sabe si esa caja gasta 5 € o 50 € al día, así que el mismo umbral avisa
   * tarde en una y da la lata en otra. Los días de autonomía sí lo saben.
   */
  | "AUTONOMIA_DIAS"
  /**
   * Una cola de envío lleva X minutos atascada.
   *
   * La única avería que este módulo puede tener sin que nadie se entere: la
   * caja sigue cobrando, las pantallas siguen pintando, y lo único que pasa es
   * que Central se queda atrás.
   */
  | "COLA_ATASCADA_MINUTOS";

export type Regla = {
  id: string;
  tipo: TipoRegla;
  ambito: Ambito;
  /** A qué zona, centro o caja apunta. Vacío en el ámbito de empresa. */
  ambitoId: string | null;
  umbral: number;
  activa: boolean;
};

/** El estado de una caja, con lo que hace falta para evaluar las reglas. */
export type EstadoCaja = {
  registerId: number;
  centroId: string | null;
  zonaId: string | null;
  /** Descuadre del último arqueo, en céntimos. Positivo o negativo. */
  descuadreCentimos?: number | null;
  sessionId?: number | null;
  /** Días que lleva fuera el tránsito más antiguo sin cerrar. */
  transitoDias?: number | null;
  transitoCentimos?: number | null;
  /** Días desde el último cierre. */
  diasSinCerrar?: number | null;
  /** Días que lleva esperando el cierre más antiguo sin ingresar. */
  pendienteDias?: number | null;
  pendienteCentimos?: number | null;
  /** Céntimos en monedas. */
  calderillaCentimos?: number | null;
  /** Días que aguanta el cambio según la predicción. `null` si no se puede predecir. */
  autonomiaDias?: number | null;
  /** Minutos que lleva esperando lo más viejo de las colas de envío. */
  colaRetrasoMinutos?: number | null;
};

export type Incidencia = {
  tipo: TipoRegla;
  registerId: number;
  reglaId: string;
  umbral: number;
  /** El valor que ha disparado la regla. */
  valor: number;
  /** Clave de deduplicación: identifica ESTE hecho, no la regla. */
  clave: string;
  detalle: Record<string, unknown>;
};

/**
 * ¿Alcanza la regla a esta caja?
 *
 * Una regla de zona alcanza a la caja si la caja está en esa zona; una de
 * centro, si está en ese centro. La de empresa alcanza a todas.
 */
function alcanza(regla: Regla, caja: EstadoCaja): boolean {
  switch (regla.ambito) {
    case "EMPRESA":
      return true;
    case "ZONA":
      return !!caja.zonaId && caja.zonaId === regla.ambitoId;
    case "CENTRO":
      return !!caja.centroId && caja.centroId === regla.ambitoId;
    case "CAJA":
      return String(caja.registerId) === String(regla.ambitoId);
  }
}

/**
 * La regla que manda para un tipo y una caja, o `null` si no hay ninguna.
 *
 * Con dos reglas de la misma especificidad —dos de zona sobre la misma caja, lo
 * que solo pasa si alguien las ha creado a mano mal— gana la primera por id, de
 * forma estable. Podría ser cualquiera, pero **no puede ser una cada vez**: un
 * aviso que aparece y desaparece según el orden de una consulta es peor que no
 * tener aviso.
 */
export function reglaAplicable(
  reglas: readonly Regla[],
  tipo: TipoRegla,
  caja: EstadoCaja
): Regla | null {
  const candidatas = reglas
    .filter((r) => r.tipo === tipo && alcanza(r, caja))
    .sort((a, b) => {
      const d = ESPECIFICIDAD[b.ambito] - ESPECIFICIDAD[a.ambito];
      return d !== 0 ? d : a.id.localeCompare(b.id);
    });

  return candidatas[0] ?? null;
}

/** El valor que mira cada tipo de regla, y `null` si no hay dato. */
function valorDe(tipo: TipoRegla, c: EstadoCaja): number | null {
  switch (tipo) {
    case "DESCUADRE":
      return c.descuadreCentimos == null ? null : Math.abs(c.descuadreCentimos);
    case "TRANSITO_DIAS":
      return c.transitoDias ?? null;
    case "SIN_CERRAR_DIAS":
      return c.diasSinCerrar ?? null;
    case "PENDIENTE_BANCO_DIAS":
      return c.pendienteDias ?? null;
    case "CALDERILLA_MINIMA":
      return c.calderillaCentimos ?? null;
    case "AUTONOMIA_DIAS":
      return c.autonomiaDias ?? null;
    case "COLA_ATASCADA_MINUTOS":
      return c.colaRetrasoMinutos ?? null;
  }
}

/**
 * ¿Se ha pasado del umbral?
 *
 * `CALDERILLA_MINIMA` es la única que salta por DEBAJO: quedarse sin monedas es
 * el problema, tener muchas no lo es.
 */
/**
 * Los dos que saltan por DEBAJO son los que miden lo que queda: quedarse sin
 * monedas es el problema, tener muchas no lo es; y lo mismo con los días de
 * cambio que aguanta la caja.
 */
const SALTAN_POR_DEBAJO = new Set<TipoRegla>(["CALDERILLA_MINIMA", "AUTONOMIA_DIAS"]);

function supera(tipo: TipoRegla, valor: number, umbral: number): boolean {
  return SALTAN_POR_DEBAJO.has(tipo) ? valor < umbral : valor > umbral;
}

/**
 * La clave de deduplicación.
 *
 * Identifica **el hecho**, no la regla, y de ahí salen dos comportamientos que
 * hacen falta:
 *
 * · El descuadre lleva la jornada: dos descuadres de días distintos son dos
 *   incidencias, y hay que verlos los dos.
 * · Lo que se mide en días NO la lleva: un tránsito que lleva cinco días fuera
 *   es el mismo problema que ayer, cuando llevaba cuatro. Si la clave cambiara
 *   con el valor, cada evaluación abriría una incidencia nueva y la bandeja se
 *   llenaría del mismo aviso repetido.
 */
function claveDe(tipo: TipoRegla, c: EstadoCaja): string {
  return tipo === "DESCUADRE"
    ? `DESCUADRE:${c.registerId}:${c.sessionId ?? 0}`
    : `${tipo}:${c.registerId}`;
}

/** Evalúa todas las reglas contra el estado de una caja. */
export function evaluarCaja(reglas: readonly Regla[], caja: EstadoCaja): Incidencia[] {
  const tipos: TipoRegla[] = [
    "DESCUADRE",
    "TRANSITO_DIAS",
    "SIN_CERRAR_DIAS",
    "PENDIENTE_BANCO_DIAS",
    "CALDERILLA_MINIMA",
    "AUTONOMIA_DIAS",
    "COLA_ATASCADA_MINUTOS",
  ];

  const incidencias: Incidencia[] = [];

  for (const tipo of tipos) {
    const regla = reglaAplicable(reglas, tipo, caja);
    // Sin regla no hay aviso, y una regla desactivada abajo apaga la de arriba:
    // es la misma especificidad, aplicada también para callar.
    if (!regla || !regla.activa) continue;

    const valor = valorDe(tipo, caja);
    if (valor == null) continue;
    if (!supera(tipo, valor, regla.umbral)) continue;

    incidencias.push({
      tipo,
      registerId: caja.registerId,
      reglaId: regla.id,
      umbral: regla.umbral,
      valor,
      clave: claveDe(tipo, caja),
      detalle: {
        centroId: caja.centroId,
        zonaId: caja.zonaId,
        sessionId: caja.sessionId ?? null,
        ambitoRegla: regla.ambito,
      },
    });
  }

  return incidencias;
}

/** Evalúa la red entera. */
export function evaluarRed(reglas: readonly Regla[], cajas: readonly EstadoCaja[]): Incidencia[] {
  return cajas.flatMap((c) => evaluarCaja(reglas, c));
}
