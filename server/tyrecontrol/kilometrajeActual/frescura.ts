/**
 * ¿Sirve esta lectura del odómetro para el formulario que se está abriendo?
 *
 * Código PURO: no consulta a nadie. Recibe lo que el Hub averiguó y decide qué
 * se le enseña al técnico.
 *
 * ── Por qué «vieja» no es lo mismo aquí que en la presencia en bases ────────
 *
 * `BasePresenceService` ya tiene un `antiguedadMaxMin` configurable, y la
 * tentación es reutilizar ese número. No se hace, y no es por capricho: allí
 * se pregunta «¿sigue el autobús donde dice?», y una POSICIÓN de hace tres
 * horas no contesta eso. Aquí se pregunta «¿cuántos kilómetros lleva?», y un
 * ODÓMETRO de hace tres horas de un autobús que ha estado en el taller es
 * exactamente igual de bueno que el de ahora: lo que no se ha movido no suma
 * kilómetros.
 *
 * Por eso son dos claves distintas en la misma configuración por cuenta
 * (`integration_connector_configs.config`), y por eso el umbral de aquí puede
 * —y suele— ser más ancho.
 *
 * ── Y por qué se enseña la antigüedad aunque sea buena ──────────────────────
 *
 * Porque el encargo lo pide y tiene razón: un número sin fecha invita a
 * creerse que es de ahora mismo. Enseñar «hace 4 minutos» cuesta lo mismo que
 * no enseñarlo y deja al técnico decidir.
 */

/**
 * Cuántos minutos puede tener una lectura y seguir valiendo como «actual».
 *
 * Dos horas. No sale de una medición como el de la presencia, sale de cómo se
 * trabaja: entre que el técnico abre el parte y lo cierra pueden pasar dos
 * horas largas, y durante ese rato el camión está en el foso. Un umbral corto
 * marcaría como dudoso justo el caso normal.
 *
 * Configurable por cuenta en `config.frescuraOdometroMin` para la flota que
 * tenga otro ritmo.
 */
export const FRESCURA_ODOMETRO_MIN = 120;

/** El estado de la lectura, tal como se le cuenta al técnico. */
export type EstadoLectura =
  /** Hay odómetro y es suficientemente reciente. */
  | "actualizado"
  /** Hay odómetro, pero es de hace rato. Se puede usar; se avisa. */
  | "lectura_anterior"
  /** El vehículo no está enlazado con ninguna cuenta de telemática. */
  | "sin_telematica"
  /** Está enlazado, pero el proveedor no da odómetro de este vehículo. */
  | "no_disponible"
  /** No se pudo preguntar: proveedor caído, credenciales, timeout. */
  | "error";

export interface LecturaOdometro {
  estado: EstadoLectura;
  /** Kilómetros. `null` en todos los estados que no son lectura. */
  km: number | null;
  /** Instante de la lectura según el proveedor. */
  capturadoAt: Date | null;
  /** Cuándo se preguntó. Distinto de lo anterior, y los dos importan. */
  consultadoAt: Date;
  /** Minutos transcurridos desde la lectura. */
  antiguedadMin: number | null;
  /** Conector: `movertis`, `webfleet`… Nunca el nombre en una pantalla. */
  proveedor: string | null;
  /** Identificador del vehículo EN el proveedor, para poder auditar. */
  externo: string | null;
  /**
   * De dónde saca el proveedor el odómetro. `gps` es distancia acumulada y NO
   * coincide con el salpicadero: se arrastra para poder avisar.
   */
  origenOdometro?: "vehicle" | "gps" | "unknown";
  /** Una línea en cristiano para la pantalla. Nunca un error técnico. */
  texto: string;
}

/** Cuánto tiempo hace, dicho como lo diría una persona. */
export function haceCuanto(minutos: number): string {
  if (minutos < 1) return "hace menos de un minuto";
  if (minutos === 1) return "hace 1 minuto";
  if (minutos < 60) return `hace ${minutos} minutos`;
  const horas = Math.floor(minutos / 60);
  if (horas < 24) return horas === 1 ? "hace 1 hora" : `hace ${horas} horas`;
  const dias = Math.floor(horas / 24);
  return dias === 1 ? "hace 1 día" : `hace ${dias} días`;
}

/**
 * El umbral de frescura de una cuenta, con su techo de cordura.
 *
 * Un valor absurdo en la configuración —cero, negativo, una semana— no puede
 * convertir en «actualizada» una lectura que no lo es, así que se acota.
 */
export function frescuraDeConfig(config: unknown): number {
  const v = Number((config as Record<string, unknown> | undefined)?.frescuraOdometroMin);
  if (!Number.isFinite(v) || v < 1) return FRESCURA_ODOMETRO_MIN;
  // Un día es ya muchísimo para llamar «actual» a una lectura.
  return Math.min(Math.floor(v), 24 * 60);
}

/**
 * El nombre del proveedor tal como se le enseña al técnico.
 *
 * Se escribe QUIÉN lo anotó, no «telemática» a secas: en el patio se sabe qué
 * vehículos llevan Webfleet y cuáles Movertis, y ver el nombre es lo que
 * permite decir «ese equipo lleva dos días sin reportar» en vez de desconfiar
 * del número sin saber de quién viene.
 *
 * Lo que no esté en la lista se capitaliza y ya: el día que se enlace una
 * plataforma nueva aparecerá con su nombre sin tocar esto, y peor sería que
 * saliera vacío o «unknown».
 */
export function nombreProveedor(codigo: string | null | undefined): string | null {
  const c = (codigo ?? "").trim();
  if (!c) return null;
  const conocidos: Record<string, string> = {
    webfleet: "Webfleet",
    movertis: "Movertis",
  };
  return conocidos[c.toLowerCase()] ?? c.charAt(0).toUpperCase() + c.slice(1);
}

/**
 * Convierte lo que averiguó el Hub en lo que ve el técnico.
 *
 * Los cuatro estados del servicio NO se colapsan: «no hay lectura» y «no se
 * pudo preguntar» piden cosas distintas —uno se resuelve tecleando los km, el
 * otro reintentando— y decirle lo mismo al técnico en los dos casos le hace
 * reintentar cuando no sirve de nada.
 */
export function clasificarLectura(params: {
  /** Lo que devolvió `kilometrajeEnOperacion`, ya desestructurado. */
  resultado:
    | { estado: "encontrado"; km: number; capturadoAt: Date; proveedor: string;
        externo: string; origenOdometro?: "vehicle" | "gps" | "unknown" }
    | { estado: "sin_lectura" }
    | { estado: "sin_telematica" }
    | { estado: "no_disponible" };
  ahora: Date;
  frescuraMin?: number;
}): LecturaOdometro {
  const { resultado, ahora } = params;
  const frescuraMin = params.frescuraMin ?? FRESCURA_ODOMETRO_MIN;
  const base = {
    km: null, capturadoAt: null, consultadoAt: ahora, antiguedadMin: null,
    proveedor: null, externo: null,
  } as const;

  switch (resultado.estado) {
    case "sin_telematica":
      return { ...base, estado: "sin_telematica",
        texto: "Este vehículo no está enlazado con ninguna telemática." };
    case "sin_lectura":
      return { ...base, estado: "no_disponible",
        texto: "Su equipo no está dando el cuentakilómetros ahora mismo." };
    case "no_disponible":
      return { ...base, estado: "error",
        texto: "No se ha podido consultar la telemática." };
    case "encontrado": {
      const antiguedadMin = Math.max(
        0, Math.round((ahora.getTime() - resultado.capturadoAt.getTime()) / 60_000));
      // Una lectura del FUTURO (reloj del proveedor adelantado) no se rechaza:
      // se trata como recién tomada, que es lo que casi seguro es.
      const reciente = antiguedadMin <= frescuraMin;
      const porGps = resultado.origenOdometro === "gps"
        ? " Ojo: es distancia calculada por GPS, no el cuentakilómetros." : "";
      return {
        estado: reciente ? "actualizado" : "lectura_anterior",
        km: resultado.km,
        capturadoAt: resultado.capturadoAt,
        consultadoAt: ahora,
        antiguedadMin,
        proveedor: resultado.proveedor,
        externo: resultado.externo,
        origenOdometro: resultado.origenOdometro,
        // Quién lo anotó va DELANTE, que es lo que se pidió y lo que primero
        // mira quien lee la pantalla: «anotados por Movertis».
        texto: (() => {
          const quien = nombreProveedor(resultado.proveedor);
          const firma = quien ? `Anotados por ${quien}. ` : "";
          return reciente
            ? `${firma}Lectura de ${haceCuanto(antiguedadMin)}.${porGps}`
            : `${firma}Última lectura ${haceCuanto(antiguedadMin)}: puede haber rodado desde entonces.${porGps}`;
        })(),
      };
    }
  }
}

/**
 * ¿Hay que volver a preguntar antes de cerrar el parte?
 *
 * Solo si la que se tiene ya NO cumple el umbral. Preguntar por preguntar
 * gasta cupo del proveedor —que es limitado y compartido con el barrido de
 * bases— sin cambiar el número.
 */
export function tocaRefrescar(lectura: LecturaOdometro, ahora: Date, frescuraMin = FRESCURA_ODOMETRO_MIN): boolean {
  if (lectura.capturadoAt === null) return true;
  const antiguedadMin = Math.round((ahora.getTime() - lectura.capturadoAt.getTime()) / 60_000);
  return antiguedadMin > frescuraMin;
}

/**
 * ¿Es razonable este kilometraje comparado con el que ya teníamos?
 *
 * NO bloquea: avisa. Un odómetro más bajo que el último confirmado puede ser
 * un cambio de cuadro, una corrección del contador o un error del proveedor, y
 * negarse a trabajar por eso dejaría el camión sin parte. Un salto enorme,
 * igual: existen los vehículos que hacen 3.000 km en una semana.
 */
export function avisoDeSalto(params: {
  km: number;
  kmAnterior: number | null;
  /** Días entre una lectura y otra, si se sabe. */
  dias?: number | null;
}): string | null {
  const { km, kmAnterior } = params;
  if (kmAnterior === null || kmAnterior <= 0) return null;
  if (km < kmAnterior) {
    return `El cuentakilómetros (${Math.round(km)} km) es MENOR que el último confirmado ` +
      `(${Math.round(kmAnterior)} km). Puede ser un cambio de equipo o una corrección; compruébalo.`;
  }
  const dias = params.dias && params.dias > 0 ? params.dias : 1;
  // 2.000 km al día es más de lo que hace un camión en ruta continua: por
  // encima de eso casi siempre es un dedazo o una unidad equivocada.
  const porDia = (km - kmAnterior) / dias;
  if (porDia > 2000) {
    return `Son ${Math.round(km - kmAnterior)} km más que la última vez. Compruébalo antes de confirmar.`;
  }
  return null;
}
