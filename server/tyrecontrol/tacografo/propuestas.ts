/**
 * Las propuestas de medida: qué se puede aceptar, con qué y qué no.
 *
 * El calibrado de un tacógrafo mide la circunferencia de rodadura, y el
 * informe del centro técnico anota la medida del neumático con la que lo
 * hizo. Eso es un dato de medida bueno, tomado por un tercero con el
 * vehículo delante, y de los 684 autobuses enlazados hay 43 que en
 * TyreControl no tienen medida habitual puesta. Esas 43 son el motivo de
 * esta fase.
 *
 * ── Esto NO escribe la medida de ningún neumático ───────────────────────────
 *
 * Aceptar una propuesta escribe `tc_vehiculos.medida_id` y nada más. No toca
 * `tc_montajes_actuales`, ni `tc_neumaticos`, ni `tc_vehiculo_ejes`, ni
 * `config_ejes_id`, ni `tc_vehiculos.km_actual`. La medida habitual del
 * vehículo es lo que se espera que lleve; lo que lleva montado ahora mismo
 * sale del montaje, y eso lo pone el taller, no un informe de tacógrafo.
 *
 * ── Y NO añade medidas al catálogo ──────────────────────────────────────────
 *
 * `medida_id` apunta a `tc_cat_medidas_neumatico`. Si la medida que dice el
 * tacógrafo no está en el catálogo, la propuesta **no se puede aceptar**: se
 * dice por qué y se deja al administrador darla de alta en «Medidas de
 * neumáticos», que es la pantalla que existe para eso. Dar de alta medidas
 * sola, a partir de un fichero de un tercero, es como se llena un catálogo de
 * `295/80R22,5` con coma y `295/80 R22.5` con espacio hasta que nadie se fía
 * de él.
 *
 * ── La «C», que es el caso de verdad ────────────────────────────────────────
 *
 * El catálogo de TyreControl no escribe el marcado de carga reforzada: tiene
 * `225/75R16`, no `225/75R16C`. El tacógrafo sí lo escribe. Si se exigiera
 * coincidencia exacta, las propuestas de esos vehículos quedarían todas
 * bloqueadas por «no está en el catálogo» teniendo su medida ahí delante.
 *
 * Así que se busca primero el valor exacto y, si no está, el mismo sin el
 * marcado. Cuando se resuelve por la segunda vía se devuelve `exacta: false`,
 * y la pantalla lo dice con palabras: «el tacógrafo dice 225/75R16C y se
 * guardará 225/75R16, que es como lo escribe el catálogo». Ni se calla la
 * diferencia ni se inventa una entrada nueva para que cuadre.
 */

import { sinMarcado, marcado } from "./medidas.ts";
import type { CasoMedida, PropuestaMedida } from "./simular.ts";

/** Una entrada del catálogo de medidas, con el valor ya canónico. */
export interface MedidaCatalogo {
  id: string;
  valor: string;
  activo: boolean;
}

/** Una propuesta tal y como está guardada, que es contra lo que se decide. */
export interface PropuestaGuardada {
  id: string;
  vehiculoId: string | null;
  matriculaNorm: string;
  caso: CasoMedida;
  medidaNorm: string;
  medidaOrigen: string | null;
  fecha: string | null;
  idOrigen: string | null;
  /** Lo que el vehículo tenía CUANDO se creó la propuesta. */
  medidaActual: string | null;
  medidaActualId: string | null;
  estado: string;
  seguraParaBloque: boolean;
}

export type MotivoBloqueo =
  /** No está enlazada a ningún vehículo: primero hay que enlazarla. */
  | "sin_vehiculo"
  /** La medida no está en el catálogo, ni con marcado ni sin él. */
  | "fuera_de_catalogo"
  /** Está en el catálogo pero dada de baja: darla de alta es una decisión. */
  | "medida_de_baja"
  /** Ya se aceptó o se rechazó. */
  | "ya_resuelta"
  /** Alguien cambió la medida del vehículo desde que se creó la propuesta. */
  | "el_vehiculo_cambio";

/** A qué entrada del catálogo apunta una medida del tacógrafo. */
export interface Resuelta {
  medida: MedidaCatalogo;
  /** `true` si coincide el valor entero; `false` si ha hecho falta quitar el marcado. */
  exacta: boolean;
  /** El marcado que se deja fuera, cuando `exacta` es `false`: `C`. */
  marcadoIgnorado: string | null;
}

/**
 * Busca la medida en el catálogo: primero igual, después sin el marcado.
 *
 * El catálogo puede tener la misma medida dos veces, activa y de baja. Se
 * prefiere SIEMPRE la activa: poner a un vehículo una medida dada de baja
 * deja la ficha enseñando algo que el resto del panel ya no ofrece.
 */
export function resolverEnCatalogo(
  medidaNorm: string,
  catalogo: MedidaCatalogo[],
): Resuelta | null {
  const mejor = (candidatas: MedidaCatalogo[]): MedidaCatalogo | null =>
    candidatas.find((m) => m.activo) ?? candidatas[0] ?? null;

  const exactas = catalogo.filter((m) => m.valor === medidaNorm);
  const e = mejor(exactas);
  if (e) return { medida: e, exacta: true, marcadoIgnorado: null };

  const base = sinMarcado(medidaNorm);
  if (!base || base === medidaNorm) return null;

  const porBase = mejor(catalogo.filter((m) => m.valor === base));
  if (!porBase) return null;
  return { medida: porBase, exacta: false, marcadoIgnorado: marcado(medidaNorm) };
}

export interface Decision {
  puede: boolean;
  motivo?: MotivoBloqueo;
  /** Qué se escribiría en `tc_vehiculos.medida_id`. */
  resuelta?: Resuelta;
  /** Qué dice el motivo, para que la pantalla no tenga que traducirlo. */
  explicacion?: string;
}

/**
 * ¿Se puede aceptar esta propuesta, y escribiendo qué?
 *
 * `medidaVehiculoAhora` es la medida que el vehículo tiene EN ESTE MOMENTO,
 * leída justo antes de decidir. Se compara con la que la propuesta guardó:
 * si no coinciden, alguien la ha puesto por su cuenta mientras la propuesta
 * esperaba, y aceptarla pisaría una decisión humana con un dato de un
 * fichero. Eso se para y se dice.
 */
export function decidir(
  p: PropuestaGuardada,
  catalogo: MedidaCatalogo[],
  medidaVehiculoAhora: string | null,
): Decision {
  if (p.estado !== "pendiente") {
    return { puede: false, motivo: "ya_resuelta", explicacion: `La propuesta ya está «${p.estado}».` };
  }
  if (!p.vehiculoId) {
    return {
      puede: false, motivo: "sin_vehiculo",
      explicacion: `La matrícula ${p.matriculaNorm} no está enlazada a ningún vehículo. `
        + "Enlázala primero y la propuesta se podrá aceptar.",
    };
  }

  // Lo que había cuando se creó la propuesta, contra lo que hay ahora.
  const antes = p.medidaActual ?? null;
  const ahora = medidaVehiculoAhora ?? null;
  if (antes !== ahora) {
    return {
      puede: false, motivo: "el_vehiculo_cambio",
      explicacion: "La medida del vehículo ha cambiado desde que se creó la propuesta "
        + `(${antes ?? "sin medida"} → ${ahora ?? "sin medida"}). `
        + "Vuelve a importar o resuélvela a mano mirando el caso.",
    };
  }

  const r = resolverEnCatalogo(p.medidaNorm, catalogo);
  if (!r) {
    return {
      puede: false, motivo: "fuera_de_catalogo",
      explicacion: `«${p.medidaNorm}» no está en el catálogo de medidas. `
        + "Dala de alta en «Medidas de neumáticos» y vuelve aquí.",
    };
  }
  if (!r.medida.activo) {
    return {
      puede: false, motivo: "medida_de_baja", resuelta: r,
      explicacion: `«${r.medida.valor}» está en el catálogo pero dada de baja. `
        + "Reactívala si de verdad se usa.",
    };
  }

  // El caso `solo_marcado`: el catálogo no escribe la C y el vehículo ya
  // tiene esa misma entrada. Aceptar no cambia el dato, solo cierra la
  // propuesta. Decirlo evita que alguien busque qué va a cambiar y no lo
  // encuentre, y evita que lo rechace creyendo que iba a pisarle la medida.
  if (r.medida.id === p.medidaActualId) {
    return {
      puede: true, resuelta: r,
      explicacion: `Ya es la medida que tiene: el tacógrafo solo la escribe con la `
        + `${r.marcadoIgnorado ?? "designación completa"}. Aceptar no cambia el dato, `
        + "solo quita el aviso.",
    };
  }

  return {
    puede: true, resuelta: r,
    explicacion: r.exacta
      ? `Se pondrá «${r.medida.valor}» como medida habitual del vehículo.`
      : `El tacógrafo dice «${p.medidaNorm}» y se pondrá «${r.medida.valor}», `
        + `que es como lo escribe el catálogo (sin la ${r.marcadoIgnorado}).`,
  };
}

export interface Candidata {
  propuesta: PropuestaGuardada;
  decision: Decision;
}

/**
 * Las que entran en una confirmación en bloque, y las que no, con el motivo.
 *
 * El acuerdo es explícito: en bloque solo las coincidencias seguras —vehículo
 * enlazado, ninguna fila con aviso y **ninguna medida previa que pisar**—.
 * Una discrepancia real no entra nunca en un «aceptar todo»: son 19 casos en
 * los que el tacógrafo y TyreControl dicen cosas distintas, y resolver 19
 * desacuerdos con un botón es decidir sin mirar.
 *
 * `seguraParaBloque` lo calcula `simular.ts` y se guarda con la propuesta,
 * para que lo que se acepta en bloque hoy sea lo mismo que se enseñó como
 * seguro cuando se importó.
 */
export function separarParaBloque(
  candidatas: Candidata[],
): { aceptables: Candidata[]; excluidas: Candidata[] } {
  const aceptables: Candidata[] = [];
  const excluidas: Candidata[] = [];
  for (const c of candidatas) {
    if (c.decision.puede && c.propuesta.seguraParaBloque && c.propuesta.caso === "sin_medida") {
      aceptables.push(c);
    } else {
      excluidas.push(c);
    }
  }
  return { aceptables, excluidas };
}

/** Una fila lista para insertarse en `tc_tacografo_medida_propuesta`. */
export interface PropuestaInsert {
  empresa_id: string;
  vehiculo_id: string | null;
  matricula_norm: string;
  caso: CasoMedida;
  intervencion_id: string | null;
  id_origen: string | null;
  fecha_intervencion: string | null;
  medida_origen: string | null;
  medida_norm: string;
  medida_actual_id: string | null;
  medida_actual: string | null;
  segura_para_bloque: boolean;
  estado: string;
  lote_id: string;
}

/** La clave con la que una propuesta es «la misma»: vehículo y medida. */
export function claveDe(matriculaNorm: string, medidaNorm: string): string {
  return `${matriculaNorm}|${medidaNorm}`;
}

/**
 * Las filas de propuesta que deja una importación.
 *
 * `intervencionPorIdOrigen` enlaza cada propuesta con la intervención que la
 * justifica, para que desde la pantalla se pueda ir a ver el parte entero.
 * Si una propuesta sale de una fila que al final no se insertó —porque ya
 * estaba, o porque se bloqueó— se queda sin ese enlace, y eso no la invalida:
 * la evidencia (medida, fecha e `id_origen`) va dentro de la propia fila.
 *
 * ── `yaExisten` incluye las RECHAZADAS, y es a propósito ────────────────────
 *
 * La tabla tiene un índice único sobre (empresa, matrícula, medida) **solo
 * para las pendientes**, así que filtrar únicamente por pendientes bastaría
 * para no chocar. No basta para que la pantalla sea usable: si alguien
 * rechaza «225/75R16C para el 1234ABC» y la exportación del mes que viene
 * trae la misma intervención, volvería a aparecer la misma propuesta que ya
 * dijo que no. Y la medida es la misma, así que no hay nada nuevo que
 * mirar. Una decisión tomada se respeta hasta que cambie el dato.
 *
 * (El índice es parcial y no se puede usar como `on conflict` desde
 * PostgREST, que solo acepta nombres de columna y no el `where`. Por eso el
 * filtro está aquí, donde además se puede probar sin base.)
 */
export function filasPropuesta(
  propuestas: PropuestaMedida[],
  op: {
    empresa: string;
    loteId: string;
    intervencionPorIdOrigen?: Map<string, string>;
    /** Claves de `claveDe` que ya tienen propuesta, en cualquier estado. */
    yaExisten?: Set<string>;
  },
): PropuestaInsert[] {
  const ya = op.yaExisten ?? new Set<string>();
  return propuestas
    .filter((p) => !ya.has(claveDe(p.matriculaNorm, p.medidaNorm)))
    .map((p) => ({
      empresa_id: op.empresa,
      vehiculo_id: p.vehiculoId,
      matricula_norm: p.matriculaNorm,
      caso: p.caso,
      intervencion_id: op.intervencionPorIdOrigen?.get(p.idOrigen) ?? null,
      id_origen: p.idOrigen,
      fecha_intervencion: p.fecha,
      medida_origen: p.medidaOrigen,
      medida_norm: p.medidaNorm,
      medida_actual_id: p.medidaActualId,
      medida_actual: p.medidaActual,
      segura_para_bloque: p.seguraParaBloque,
      estado: "pendiente",
      lote_id: op.loteId,
    }));
}

/** Cuántas hay de cada caso, para el resumen de la pantalla. */
export function porCaso(propuestas: PropuestaGuardada[]): Record<CasoMedida, number> {
  const r: Record<CasoMedida, number> = { sin_medida: 0, solo_marcado: 0, discrepa: 0, sin_vehiculo: 0 };
  for (const p of propuestas) r[p.caso] += 1;
  return r;
}
