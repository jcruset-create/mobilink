/**
 * Conciliación de flotas: qué vehículos del proveedor son cuáles de TyreControl.
 *
 * TyreControl es el sistema maestro. Un proveedor telemático informa, sugiere y
 * avisa; no da de alta, no da de baja y no sobrescribe nada. Todo lo que tiene
 * efecto en TyreControl sale de un clic de una persona, y este módulo solo
 * prepara la información sobre la que esa persona decide.
 *
 * ── Por qué la clasificación es una función pura ────────────────────────────
 *
 * Porque es donde están las decisiones delicadas —cuándo una coincidencia es
 * inequívoca, cuándo es ambigua, cuándo un enlace se ha quedado colgando— y
 * son justo las que hay que poder probar sin base de datos ni proveedor. El
 * servicio que la rodea trae los datos; aquí no se toca nada de fuera.
 */

import type { ProviderVehicle } from "./telematics.ts";

/** Cómo se estableció un vínculo. Va en el `metadata` del mapeo. */
export const METODOS_VINCULO = {
  /** La matrícula normalizada coincidía y había un único candidato. */
  MATRICULA_EXACTA: "plate_exact",
  /** Lo eligió una persona en la pantalla de conciliación. */
  MANUAL: "manual",
  /** El vehículo se creó en TyreControl a partir del proveedor. */
  CREADO_DESDE_PROVEEDOR: "created_from_provider",
} as const;

export type MetodoVinculo = (typeof METODOS_VINCULO)[keyof typeof METODOS_VINCULO];

/**
 * Un vehículo de TyreControl, con lo justo para conciliar.
 *
 * Deliberadamente pobre: el Hub no debe conocer la ficha de TyreControl. Quien
 * llama rellena esto desde `tc_vehiculos` y el Hub no sabe de dónde viene.
 */
export interface VehiculoInterno {
  /** `tc_vehiculos.id`. Es el `mobilink_id` del mapeo. */
  id: string;
  matricula: string;
  /** `numero_unidad`: el «número de flota». */
  numeroUnidad?: string | null;
  bastidor?: string | null;
  marca?: string | null;
  modelo?: string | null;
  activo: boolean;
  /**
   * Neumáticos montados ahora mismo.
   *
   * Se trae hasta aquí por una razón concreta: dar de baja un vehículo NO
   * desmonta sus gomas, y quien pulse el botón tiene que verlo antes.
   */
  neumaticosMontados: number;
}

/** Un enlace ya guardado, tal como lo devuelve `integration_mappings`. */
export interface EnlaceVehiculo {
  /** `tc_vehiculos.id`. */
  mobilinkId: string;
  /** Identificador del vehículo en el proveedor. */
  externalCode: string;
  activo: boolean;
  metodo?: string | null;
  /** Matrícula que tenía el vehículo externo cuando se enlazó. */
  matriculaSnapshot?: string | null;
  /** Nombre o alias que tenía el vehículo externo cuando se enlazó. */
  nombreSnapshot?: string | null;
  /** Última vez que ESTE vehículo apareció en el proveedor. Ver `last_seen_at_ms`. */
  ultimaVezVistoMs?: number | null;
}

/** Motivos por los que un caso no se puede resolver solo. */
export const MOTIVOS_DISCREPANCIA = {
  /** Hay enlace, pero la matrícula del proveedor ya no es la de TyreControl. */
  MATRICULA_DISTINTA: "plate_mismatch",
  /** Hay enlace, pero el vehículo externo ya no aparece en la cuenta. */
  EXTERNO_DESAPARECIDO: "external_missing",
  /** Hay enlace, pero el vehículo de TyreControl ya no está en esta empresa. */
  INTERNO_DESAPARECIDO: "internal_missing",
  /** Ni el externo ni el interno del enlace existen ya. */
  ENLACE_HUERFANO: "orphan_link",
  /** La matrícula del proveedor encaja con más de un vehículo de TyreControl. */
  CANDIDATOS_AMBIGUOS: "ambiguous_candidates",
  /** Dos vehículos del proveedor proponen el mismo vehículo de TyreControl. */
  EXTERNOS_DUPLICADOS: "duplicate_externals",
} as const;

export type MotivoDiscrepancia =
  (typeof MOTIVOS_DISCREPANCIA)[keyof typeof MOTIVOS_DISCREPANCIA];

/** A. Enlazado: hay mapeo activo y el vehículo externo sigue apareciendo. */
export interface FilaEnlazada {
  interno: VehiculoInterno;
  externo: ProviderVehicle;
  metodo?: string | null;
  ultimaVezVistoMs?: number | null;
}

/** B. Solo en el proveedor: sin enlace y sin correspondencia inequívoca. */
export interface FilaSoloProveedor {
  externo: ProviderVehicle;
  /**
   * Candidato único por matrícula, si lo hay. Es una PROPUESTA: nadie escribe
   * un enlace por el hecho de que coincida una matrícula.
   */
  propuesta?: VehiculoInterno;
}

/** C. Solo en TyreControl: sin correspondencia en la cuenta telemática. */
export interface FilaSoloTyreControl {
  interno: VehiculoInterno;
  /** Del último enlace conocido, aunque esté desactivado. */
  ultimaVezVistoMs?: number | null;
  /** Si alguna vez estuvo enlazado, con qué vehículo externo. */
  externoAnterior?: string | null;
}

/** D. Discrepancia: hay algo que no cuadra y lo resuelve una persona. */
export interface FilaDiscrepancia {
  motivo: MotivoDiscrepancia;
  interno?: VehiculoInterno;
  /** Cuando el motivo son varios candidatos, van todos aquí. */
  candidatos?: VehiculoInterno[];
  externo?: ProviderVehicle;
  /** Presente cuando la discrepancia nace de un enlace ya guardado. */
  enlace?: EnlaceVehiculo;
  /** Explicación en una línea, para la pantalla. */
  detalle: string;
}

export interface Cuadrantes {
  enlazados: FilaEnlazada[];
  soloProveedor: FilaSoloProveedor[];
  soloTyreControl: FilaSoloTyreControl[];
  discrepancias: FilaDiscrepancia[];
  /**
   * Vehículos de TyreControl sobre los que esta conciliación no dice nada.
   *
   * No es un cuadrante: es lo que queda fuera de los cuatro. Se cuenta para que
   * la suma cuadre y para poder decirlo en la pantalla, en vez de que parezca
   * que se han perdido vehículos por el camino.
   */
  noEvaluados: VehiculoInterno[];
}

/** Lo que hace falta para clasificar. Todo dato, ninguna conexión. */
export interface EntradaClasificacion {
  externos: ProviderVehicle[];
  internos: VehiculoInterno[];
  enlaces: EnlaceVehiculo[];
  /** Identificadores externos que alguien marcó como «no me interesa». */
  ignorados?: Set<string>;
  /**
   * Si se puede afirmar que un vehículo NO está en el proveedor.
   *
   * Solo cuando TODAS las cuentas consultadas han respondido. Con una caída,
   * un vehículo sin enlace podría estar perfectamente en la cuenta que no
   * contestó, y meterlo en «solo en TyreControl» es afirmar que ha desaparecido
   * cuando lo único que ha pasado es que no se ha podido preguntar.
   *
   * Por defecto `true`: quien no lo declara es porque tiene la respuesta
   * completa, que es el caso normal.
   */
  puedeAfirmarAusencias?: boolean;
  /** Normalizador de matrícula. Se inyecta para no duplicar el de TyreControl. */
  normalizarMatricula: (valor: unknown) => string;
}

/**
 * Reparte la flota en los cuatro cuadrantes.
 *
 * ── Las reglas, y por qué ───────────────────────────────────────────────────
 *
 * 1. Un enlace activo manda sobre cualquier coincidencia de matrícula. Si
 *    alguien vinculó a mano dos vehículos con matrículas distintas, sabía algo
 *    que nosotros no; volver a emparejar por matrícula deshace su trabajo.
 *
 * 2. Sin matrícula en el proveedor NO se propone nada. El contrato ya avisa de
 *    que la unidad puede llamarse `TSVETAN2`, que es un alias. Adivinar por
 *    alias es exactamente la clase de acierto que falla el día que importa.
 *
 * 3. Una propuesta no es un enlace. Se enseña y espera un clic.
 *
 * 4. Un vehículo de TyreControl que ya es la propuesta única de un vehículo
 *    externo NO se cuenta además como «solo en TyreControl»: es el mismo
 *    trabajo pendiente visto desde el otro lado, y contarlo dos veces infla
 *    los dos rótulos y hace pensar que falta el doble de lo que falta.
 */
export function clasificarFlota(entrada: EntradaClasificacion): Cuadrantes {
  const { externos, internos, enlaces, normalizarMatricula } = entrada;
  const ignorados = entrada.ignorados ?? new Set<string>();

  const internosPorId = new Map(internos.map((v) => [v.id, v]));
  const externosPorId = new Map(externos.map((v) => [v.providerVehicleId, v]));

  // Los inactivos se guardan aparte: no enlazan, pero sí explican de dónde
  // viene un vehículo que hoy aparece como «solo en TyreControl».
  const enlacesActivos = enlaces.filter((e) => e.activo);
  const enlacesInactivos = enlaces.filter((e) => !e.activo);

  const cuadrantes: Cuadrantes = {
    enlazados: [],
    soloProveedor: [],
    soloTyreControl: [],
    discrepancias: [],
    noEvaluados: [],
  };
  const puedeAfirmarAusencias = entrada.puedeAfirmarAusencias !== false;

  const internosEnlazados = new Set<string>();
  const externosEnlazados = new Set<string>();

  // ── 1. Lo que ya está enlazado ────────────────────────────────────────────
  for (const enlace of enlacesActivos) {
    const interno = internosPorId.get(enlace.mobilinkId);
    const externo = externosPorId.get(enlace.externalCode);

    // Se marcan como tratados pase lo que pase: un enlace roto sigue siendo un
    // enlace, y su vehículo no debe reaparecer además en otro cuadrante como
    // si estuviera libre.
    if (interno) internosEnlazados.add(interno.id);
    if (externo) externosEnlazados.add(externo.providerVehicleId);

    if (!interno && !externo) {
      cuadrantes.discrepancias.push({
        motivo: MOTIVOS_DISCREPANCIA.ENLACE_HUERFANO,
        enlace,
        detalle:
          `El enlace apunta a un vehículo de TyreControl (${enlace.mobilinkId}) y a uno ` +
          `del proveedor (${enlace.externalCode}) que ya no existen.`,
      });
      continue;
    }
    if (!interno) {
      cuadrantes.discrepancias.push({
        motivo: MOTIVOS_DISCREPANCIA.INTERNO_DESAPARECIDO,
        externo,
        enlace,
        detalle:
          `El vehículo ${enlace.externalCode} del proveedor está enlazado con un vehículo ` +
          `de TyreControl que ya no está en esta empresa.`,
      });
      continue;
    }
    if (!externo) {
      cuadrantes.discrepancias.push({
        motivo: MOTIVOS_DISCREPANCIA.EXTERNO_DESAPARECIDO,
        interno,
        enlace,
        detalle:
          `${interno.matricula} está enlazado con ${enlace.externalCode}, que ya no ` +
          `aparece en esta cuenta del proveedor.`,
      });
      continue;
    }

    // Los dos están. ¿Siguen siendo el mismo vehículo?
    const matriculaExterna = normalizarMatricula(externo.plate);
    const matriculaInterna = normalizarMatricula(interno.matricula);
    if (matriculaExterna && matriculaInterna && matriculaExterna !== matriculaInterna) {
      cuadrantes.discrepancias.push({
        motivo: MOTIVOS_DISCREPANCIA.MATRICULA_DISTINTA,
        interno,
        externo,
        enlace,
        detalle:
          `TyreControl dice ${interno.matricula} y el proveedor dice ${externo.plate}. ` +
          `No se sobrescribe ninguno de los dos.`,
      });
      continue;
    }

    cuadrantes.enlazados.push({
      interno,
      externo,
      metodo: enlace.metodo ?? null,
      ultimaVezVistoMs: enlace.ultimaVezVistoMs ?? null,
    });
  }

  // ── 2. Externos sin enlace: buscar candidatos por matrícula ───────────────
  const librePorMatricula = new Map<string, VehiculoInterno[]>();
  for (const interno of internos) {
    if (internosEnlazados.has(interno.id)) continue;
    const clave = normalizarMatricula(interno.matricula);
    if (!clave) continue;
    const lista = librePorMatricula.get(clave);
    if (lista) lista.push(interno);
    else librePorMatricula.set(clave, [interno]);
  }

  // Primera pasada: candidatos por externo, sin decidir nada todavía.
  const pendientes: Array<{ externo: ProviderVehicle; candidatos: VehiculoInterno[] }> = [];
  for (const externo of externos) {
    if (externosEnlazados.has(externo.providerVehicleId)) continue;
    if (ignorados.has(externo.providerVehicleId)) continue;
    const clave = normalizarMatricula(externo.plate);
    // Sin matrícula no se adivina por alias (regla 2).
    const candidatos = clave ? (librePorMatricula.get(clave) ?? []) : [];
    pendientes.push({ externo, candidatos });
  }

  // Segunda pasada: dos externos que proponen el MISMO interno no pueden
  // proponerlo ninguno. Uno de los dos está mal y no sabemos cuál.
  const vecesPropuesto = new Map<string, number>();
  for (const p of pendientes) {
    if (p.candidatos.length === 1) {
      const id = p.candidatos[0].id;
      vecesPropuesto.set(id, (vecesPropuesto.get(id) ?? 0) + 1);
    }
  }

  const internosPropuestos = new Set<string>();
  for (const { externo, candidatos } of pendientes) {
    if (candidatos.length > 1) {
      cuadrantes.discrepancias.push({
        motivo: MOTIVOS_DISCREPANCIA.CANDIDATOS_AMBIGUOS,
        externo,
        candidatos,
        detalle:
          `La matrícula ${externo.plate} encaja con ${candidatos.length} vehículos de ` +
          `TyreControl. Hay que elegir a mano.`,
      });
      continue;
    }
    if (candidatos.length === 1 && (vecesPropuesto.get(candidatos[0].id) ?? 0) > 1) {
      cuadrantes.discrepancias.push({
        motivo: MOTIVOS_DISCREPANCIA.EXTERNOS_DUPLICADOS,
        externo,
        candidatos,
        detalle:
          `Varios vehículos del proveedor tienen la matrícula ${externo.plate} y apuntan ` +
          `al mismo vehículo de TyreControl.`,
      });
      continue;
    }
    if (candidatos.length === 1) {
      internosPropuestos.add(candidatos[0].id);
      cuadrantes.soloProveedor.push({ externo, propuesta: candidatos[0] });
      continue;
    }
    cuadrantes.soloProveedor.push({ externo });
  }

  // ── 3. Internos que no ha reclamado nadie ─────────────────────────────────
  const historicoPorInterno = new Map<string, EnlaceVehiculo>();
  for (const e of enlacesInactivos) {
    const previo = historicoPorInterno.get(e.mobilinkId);
    // El más reciente gana: es el que responde «¿cuándo se le vio por última vez?».
    if (!previo || (e.ultimaVezVistoMs ?? 0) > (previo.ultimaVezVistoMs ?? 0)) {
      historicoPorInterno.set(e.mobilinkId, e);
    }
  }

  for (const interno of internos) {
    if (internosEnlazados.has(interno.id)) continue;
    // Regla 4: si es la propuesta única de un externo, ese es su sitio.
    if (internosPropuestos.has(interno.id)) continue;
    // Sin respuesta completa no se puede decir que este vehículo no esté en el
    // proveedor: podría estar en la cuenta que falló. Se aparta.
    if (!puedeAfirmarAusencias) {
      cuadrantes.noEvaluados.push(interno);
      continue;
    }
    const historico = historicoPorInterno.get(interno.id);
    cuadrantes.soloTyreControl.push({
      interno,
      ultimaVezVistoMs: historico?.ultimaVezVistoMs ?? null,
      externoAnterior: historico?.externalCode ?? null,
    });
  }

  return cuadrantes;
}

// ── Estado de la sincronización ─────────────────────────────────────────────

/**
 * Cómo fue la lectura del proveedor.
 *
 * `[]` no puede significar a la vez «el proveedor no tiene vehículos» y «el
 * proveedor no contestó». La diferencia es la que separa una flota vacía de
 * una baja masiva por error, así que va explícita y no se deduce del tamaño de
 * ninguna lista.
 */
export type EstadoSincronizacion = "complete" | "incomplete" | "error";

/** Qué pasó con una cuenta concreta del proveedor. */
export interface ResultadoCuenta {
  connectorKey: string;
  accountKey: string;
  ok: boolean;
  /** Vehículos leídos. Solo significa algo si `ok`. */
  vehiculos: number;
  /** Mensaje del fallo, cuando lo hubo. */
  error?: string;
}

export interface ResumenConciliacion {
  status: EstadoSincronizacion;
  startedAt: string;
  completedAt: string;
  /** Una entrada por cuenta consultada, hayan ido bien o mal. */
  cuentas: ResultadoCuenta[];
  providerVehicleCount: number;
  tyrecontrolVehicleCount: number;
  /**
   * Vehículos de TyreControl sobre los que esta conciliación NO dice nada.
   *
   * Son los que están enlazados a una cuenta que falló. No se clasifican en
   * ningún cuadrante a propósito: meterlos en «solo en TyreControl» sería
   * afirmar que han desaparecido, y lo único que ha pasado es que no se ha
   * podido preguntar. Se cuentan aquí para que la suma de los cuadrantes no
   * parezca que se ha perdido vehículos por el camino.
   */
  tyrecontrolUnknownCount: number;
  linkedCount: number;
  providerOnlyCount: number;
  tyrecontrolOnlyCount: number;
  discrepancyCount: number;
  /**
   * Si se pueden ofrecer bajas a partir de esta conciliación.
   *
   * Falso en cuanto una cuenta falla. Que un proveedor no conteste no es que
   * sus vehículos hayan desaparecido, y la pantalla no debe invitar a darlos
   * de baja mientras no se sepa.
   */
  bajasPermitidas: boolean;
}

export interface ResultadoConciliacion extends Cuadrantes {
  resumen: ResumenConciliacion;
  /**
   * Identificadores de TODO lo que devolvieron las cuentas que contestaron.
   *
   * No se deduce de los cuadrantes: los ignorados no aparecen en ninguno, y sin
   * ellos una lista de externos «vistos» se quedaría corta y el proceso
   * quincenal los contaría como bajas cada quince días. Aquí está la respuesta
   * cruda del proveedor, que es lo único con lo que tiene sentido comparar una
   * pasada con la siguiente.
   */
  externosVistos: string[];
}

/** Cuenta los cuadrantes y decide si la conciliación es de fiar. */
export function resumir(params: {
  cuadrantes: Cuadrantes;
  cuentas: ResultadoCuenta[];
  internos: number;
  externos: number;
  /** Internos apartados por pertenecer a una cuenta que falló. */
  desconocidos?: number;
  startedAt: Date;
  completedAt: Date;
}): ResumenConciliacion {
  const { cuadrantes, cuentas } = params;
  const buenas = cuentas.filter((c) => c.ok).length;
  const status: EstadoSincronizacion =
    cuentas.length === 0 || buenas === 0 ? "error" : buenas === cuentas.length ? "complete" : "incomplete";

  return {
    status,
    startedAt: params.startedAt.toISOString(),
    completedAt: params.completedAt.toISOString(),
    cuentas,
    providerVehicleCount: params.externos,
    tyrecontrolVehicleCount: params.internos,
    tyrecontrolUnknownCount: params.desconocidos ?? 0,
    linkedCount: cuadrantes.enlazados.length,
    providerOnlyCount: cuadrantes.soloProveedor.length,
    tyrecontrolOnlyCount: cuadrantes.soloTyreControl.length,
    discrepancyCount: cuadrantes.discrepancias.length,
    bajasPermitidas: status === "complete",
  };
}
