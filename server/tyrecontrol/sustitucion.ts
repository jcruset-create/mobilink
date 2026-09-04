/**
 * Sustitución de neumático: el modelo REAL de TyreControl.
 *
 * ── Lo que se esperaba y lo que hay ─────────────────────────────────────────
 *
 * La idea intuitiva de una sustitución es «quito el neumático A y pongo el B»,
 * con B identificado por su ficha. **TyreControl no funciona así.**
 *
 * `tc_sustituir_neumatico` recibe:
 *
 *   · `p_producto_almacen` — un PRODUCTO del almacén, no una ficha
 *   · `p_condicion` — `nuevo` o `usado`
 *   · `p_datos` — la identidad (RFID, número de serie, DOT…) del que se monta
 *   · `p_control_individual` — si esa unidad se lleva con ficha propia
 *
 * Y a partir de ahí decide sola:
 *
 *   · si `p_datos` trae RFID o número de serie, busca la ficha existente y la
 *     reengancha (`tc_buscar_neumatico_identificado`);
 *   · si es usado sin identificar, elige uno del almacén de usados;
 *   · si no, crea la ficha consumiendo stock del producto.
 *
 * Consecuencia para Assist: **no se puede «elegir el neumático entrante por su
 * id»**. Lo que se elige es el producto y, si se conoce, la identidad. Forzar
 * un id de ficha sería inventar una API que TC no tiene.
 *
 * ── Y algo que sí sale muy bien ─────────────────────────────────────────────
 *
 * El RPC es UNA función PL/pgSQL sin bloque de excepciones y sin COMMIT: todo
 * —historial, baja del saliente, operación, borrado del montaje, devolución a
 * stock y montaje del nuevo— ocurre en una sola transacción implícita. O pasa
 * entero o no pasa nada. Eso elimina el peor riesgo de una sustitución, que es
 * quedarse a medias con la rueda quitada y ninguna puesta.
 */

/**
 * Dónde va el neumático que se quita.
 *
 * Los valores son los del CHECK de `tc_neumaticos.estado`, porque el RPC
 * escribe `p_destino_retirado` DIRECTAMENTE en esa columna. Uno inventado no
 * daría un resultado raro: daría una violación de restricción.
 *
 * `montado` y `reservado` existen en la columna y no se ofrecen: no son
 * destinos de algo que se acaba de quitar.
 */
export const DESTINOS_RETIRADO = ["almacen", "reparacion", "descartado"] as const;
export type DestinoRetirado = (typeof DESTINOS_RETIRADO)[number];

export const ETIQUETA_DESTINO: Record<DestinoRetirado, string> = {
  almacen: "Al almacén (entra como usado)",
  reparacion: "A reparar",
  descartado: "De baja",
};

export function esDestinoRetirado(v: unknown): v is DestinoRetirado {
  return typeof v === "string" && (DESTINOS_RETIRADO as readonly string[]).includes(v);
}

/** Motivos del desmontaje, según el CHECK de `operaciones_neumaticos.motivo`. */
export const MOTIVOS_DESMONTAJE = [
  "desgaste", "pinchazo", "rotura", "preventivo", "desgaste_irregular",
  "cambio_estacional", "reparacion", "fin_vida", "error_montaje", "otro",
] as const;
export type MotivoDesmontaje = (typeof MOTIVOS_DESMONTAJE)[number];

export const ETIQUETA_MOTIVO: Record<MotivoDesmontaje, string> = {
  desgaste: "Desgaste", pinchazo: "Pinchazo", rotura: "Rotura",
  preventivo: "Preventivo", desgaste_irregular: "Desgaste irregular",
  cambio_estacional: "Cambio estacional", reparacion: "Para reparar",
  fin_vida: "Fin de vida", error_montaje: "Error de montaje", otro: "Otro",
};

export function esMotivoDesmontaje(v: unknown): v is MotivoDesmontaje {
  return typeof v === "string" && (MOTIVOS_DESMONTAJE as readonly string[]).includes(v);
}

/** `nuevo` o `usado`. Es lo que el RPC consume del almacén. */
export const CONDICIONES = ["nuevo", "usado"] as const;
export type Condicion = (typeof CONDICIONES)[number];

export function esCondicion(v: unknown): v is Condicion {
  return v === "nuevo" || v === "usado";
}

/* ── Identidad del entrante ──────────────────────────────────────────────── */

/**
 * Lo que va en `p_datos`.
 *
 * `tc_buscar_neumatico_identificado` solo mira RFID y número de serie —el DOT
 * no identifica una unidad, identifica una semana de fabricación—, así que solo
 * esos dos deciden si se reengancha una ficha existente. El resto se guarda en
 * la ficha nueva si se crea.
 */
export type IdentidadEntrante = {
  rfidEpc?: string | null;
  numeroSerie?: string | null;
  dot?: string | null;
  indiceCarga?: string | null;
  indiceVelocidad?: string | null;
  proveedor?: string | null;
};

/** ¿Trae identidad de verdad? Cadena vacía no es identidad. */
export function tieneIdentidad(i: IdentidadEntrante | null | undefined): boolean {
  const limpio = (v: unknown) => String(v ?? "").trim();
  return limpio(i?.rfidEpc) !== "" || limpio(i?.numeroSerie) !== "";
}

/** `p_datos` tal como lo espera el RPC. Solo lo que tiene valor. */
export function datosParaRpc(i: IdentidadEntrante | null | undefined): Record<string, string> {
  const d: Record<string, string> = {};
  const poner = (clave: string, v: unknown) => {
    const s = String(v ?? "").trim();
    if (s !== "") d[clave] = s;
  };
  poner("rfid_epc", i?.rfidEpc);
  poner("numero_serie", i?.numeroSerie);
  poner("dot", i?.dot);
  poner("indice_carga", i?.indiceCarga);
  poner("indice_velocidad", i?.indiceVelocidad);
  poner("proveedor", i?.proveedor);
  return d;
}

/* ── Aptitud ─────────────────────────────────────────────────────────────── */

export type MotivoNoApta =
  | "sin_marca" | "no_finalizada" | "sin_matricula" | "sin_vehiculo_tc"
  | "sin_mapping" | "empresa_no_por_mapping" | "fuera_de_alcance"
  | "sin_posicion" | "sin_producto" | "destino_invalido" | "motivo_invalido"
  | "condicion_invalida" | "desactivada";

export const EXPLICACION_SUSTITUCION: Record<MotivoNoApta, string> = {
  sin_marca: "La asistencia no está marcada como sustitución de neumático.",
  no_finalizada: "La asistencia todavía no está finalizada.",
  sin_matricula: "La asistencia no tiene matrícula.",
  sin_vehiculo_tc: "El vehículo no está en TyreControl.",
  sin_mapping: "El cliente no tiene empresa de TyreControl asignada.",
  empresa_no_por_mapping:
    "La empresa se dedujo porque la matrícula era única, no por una correspondencia declarada.",
  fuera_de_alcance: "Esta empresa todavía no está en el despliegue de TyreControl.",
  sin_posicion: "No se sabe en qué rueda se hizo la sustitución.",
  sin_producto:
    "No se ha elegido qué neumático se montó. TyreControl lo pide como producto de almacén, " +
    "no como una ficha suelta.",
  destino_invalido: "El destino del neumático retirado no es uno de los que admite TyreControl.",
  motivo_invalido: "El motivo del desmontaje no es uno de los que admite TyreControl.",
  condicion_invalida: "La condición del neumático montado debe ser «nuevo» o «usado».",
  desactivada: "La sincronización de sustituciones está desactivada.",
};

export type AptitudSustitucion =
  | {
      apta: true;
      productoAlmacenId: string;
      condicion: Condicion;
      destinoRetirado: DestinoRetirado;
      motivoDesmontaje: MotivoDesmontaje;
      identidad: IdentidadEntrante;
    }
  | { apta: false; motivo: MotivoNoApta };

/**
 * ¿Es esta asistencia una sustitución sincronizable?
 *
 * Solo mira lo que Assist sabe de sí misma. Lo de TyreControl —que la posición
 * siga igual, que haya stock— se comprueba después leyendo TC.
 */
export function evaluarAptitudSustitucion(a: {
  status?: unknown;
  tcOperacion?: unknown;
  plate?: unknown;
  tcPosicionCodigo?: unknown;
  tcProductoAlmacenId?: unknown;
  tcCondicion?: unknown;
  tcDestinoRetirado?: unknown;
  tcMotivoDesmontaje?: unknown;
  tcRfidEntrante?: unknown;
  tcSerieEntrante?: unknown;
  tcDotEntrante?: unknown;
}): AptitudSustitucion {
  if (String(a.status ?? "") !== "finalizada") return { apta: false, motivo: "no_finalizada" };
  if (String(a.tcOperacion ?? "") !== "sustitucion_neumatico") {
    return { apta: false, motivo: "sin_marca" };
  }
  if (!String(a.plate ?? "").trim()) return { apta: false, motivo: "sin_matricula" };

  /*
   * La posición es obligatoria y no hay alternativa. En una reparación bastaba
   * con el neumático; aquí no: el RPC entra por `p_montaje_actual`, que es la
   * pareja vehículo+posición. Sin saber la rueda no hay montaje que sustituir.
   */
  if (!String(a.tcPosicionCodigo ?? "").trim()) return { apta: false, motivo: "sin_posicion" };

  const producto = String(a.tcProductoAlmacenId ?? "").trim();
  if (!producto) return { apta: false, motivo: "sin_producto" };

  const condicion = a.tcCondicion ?? "nuevo";
  if (!esCondicion(condicion)) return { apta: false, motivo: "condicion_invalida" };

  const destino = a.tcDestinoRetirado ?? "almacen";
  if (!esDestinoRetirado(destino)) return { apta: false, motivo: "destino_invalido" };

  const motivo = a.tcMotivoDesmontaje ?? "desgaste";
  if (!esMotivoDesmontaje(motivo)) return { apta: false, motivo: "motivo_invalido" };

  return {
    apta: true,
    productoAlmacenId: producto,
    condicion,
    destinoRetirado: destino,
    motivoDesmontaje: motivo,
    identidad: {
      rfidEpc: a.tcRfidEntrante == null ? null : String(a.tcRfidEntrante),
      numeroSerie: a.tcSerieEntrante == null ? null : String(a.tcSerieEntrante),
      dot: a.tcDotEntrante == null ? null : String(a.tcDotEntrante),
    },
  };
}

/* ── El cerrojo propio de la sustitución ─────────────────────────────────── */

/**
 * Tres llaves, no dos.
 *
 * La sustitución lleva la suya además de la general, y **por defecto está
 * apagada aunque las otras estén puestas**. El motivo es concreto: activar la
 * escritura general para que funcionen las reparaciones no puede activar de
 * paso algo que mueve dos neumáticos y consume stock.
 */
export function sincronizacionSustitucionActiva(): boolean {
  const general = String(process.env.TYRE_CONTROL_WRITE_ENABLED ?? "").toLowerCase() === "true";
  const sustitucion =
    String(process.env.TYRE_CONTROL_REPLACEMENT_SYNC_ENABLED ?? "").toLowerCase() === "true";
  return general && sustitucion;
}
