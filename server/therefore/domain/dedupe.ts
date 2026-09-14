/**
 * Decidir si un correo que acaba de llegar es de un expediente que ya existe.
 *
 * Código PURO: entran el correo normalizado, los expedientes candidatos y los
 * pesos; sale una decisión con su puntuación y sus motivos. Sin base de datos:
 * la consulta que saca los candidatos vive en `repository.ts` y la transacción
 * que fusiona, en `ingesta.ts`.
 *
 * ── Qué se está evitando ────────────────────────────────────────────────────
 *
 * Therefore manda muchos correos por el mismo problema: la solicitud, el
 * recordatorio a los tres días, la reclamación a la semana, y la tarea vencida
 * cuando nadie la ha tocado. Si cada uno abriera expediente, la bandeja
 * tendría cuatro entradas del mismo trabajo y quien las cerrara tendría que
 * acordarse de cerrar las otras tres. Y al revés: fusionar dos incidencias
 * distintas del mismo proveedor esconde una de las dos, que es peor, porque
 * nadie echa de menos lo que no ve.
 *
 * De ahí que esto no sea un `if`: es una puntuación con umbrales, y la franja
 * de en medio **no decide, pregunta**. Un motor que siempre elige acierta el
 * 95 % y el 5 % restante se descubre en contabilidad semanas después.
 *
 * ── Dos desviaciones deliberadas del cuadro original ────────────────────────
 *
 * 1. **«Acción incompatible» no resta cuando el albarán coincide.** Con la
 *    tabla literal, `GRABAR 2028359553` seguido de `MODIFICAR 2028359553`
 *    puntuaba 45 + 10 + 20 − 40 = 35 → expediente nuevo. Pero eso no es otro
 *    problema: es la misma persona diciendo «ya no lo grabes, modifícalo». Un
 *    albarán conocido con otra acción es un CAMBIO DE INSTRUCCIÓN sobre el
 *    mismo expediente, y se trata como tal (ver `planDeFusion`). El −40 se
 *    reserva para la incompatibilidad de TIPO: una aprobación de factura y una
 *    incidencia de albarán no son el mismo trabajo aunque compartan factura.
 *
 * 2. **«Mismo hilo» suma 30 y no fusiona por sí solo.** El servidor de correo
 *    agrupa las reclamaciones en el hilo del primer mensaje, así que es la
 *    señal más barata y más fiable que hay. Pero 30 < 40: un hilo reutilizado
 *    para otra cosa —que pasa— no arrastra el correo a un expediente ajeno sin
 *    que nadie lo mire.
 *
 * ── La ventana no se comprueba aquí ─────────────────────────────────────────
 *
 * `dedupe.ventana_dias` la aplica la consulta de candidatos, que es donde
 * sirve de algo: filtrar en SQL lee menos filas. Esta función puntúa lo que le
 * den. Si se le da un candidato de hace dos años, lo puntuará; no es su
 * trabajo saber que no debería haber llegado.
 */

import type { EstadoExpediente, TipoAccion, TipoExpediente } from "./estados.ts";
import { estaAbierto } from "./estados.ts";

/* ── Pesos y umbrales ────────────────────────────────────────────────────── */

export type PesosDedupe = {
  mismaFactura: number;
  mismoAlbaran: number;
  mismoProveedor: number;
  mismoImporte: number;
  mismaEmpresa: number;
  mismoDocumento: number;
  mismaAccion: number;
  mismoHilo: number;
  /** Negativos. Se guardan con su signo para que la suma sea una suma. */
  facturaDiferente: number;
  proveedorDiferente: number;
  tipoIncompatible: number;
};

export const PESOS_DEDUPE_POR_DEFECTO: PesosDedupe = {
  mismaFactura: 50,
  mismoAlbaran: 45,
  mismoProveedor: 20,
  mismoImporte: 15,
  mismaEmpresa: 10,
  mismoDocumento: 10,
  mismaAccion: 10,
  mismoHilo: 30,
  facturaDiferente: -40,
  proveedorDiferente: -20,
  tipoIncompatible: -40,
};

export type UmbralesDedupe = {
  /** A partir de aquí se fusiona sin preguntar. */
  fusionar: number;
  /** Entre este y el anterior: lo mira una persona. */
  revisar: number;
};

export const UMBRALES_DEDUPE_POR_DEFECTO: UmbralesDedupe = {
  fusionar: 70,
  revisar: 40,
};

/** Cuántos días atrás se buscan candidatos. Lo aplica la consulta, no esto. */
export const VENTANA_DIAS_POR_DEFECTO = 120;

/* ── Lo que entra ────────────────────────────────────────────────────────── */

export type ActuacionEntrante = {
  accion: TipoAccion;
  /** El núcleo, ya pasado por `claveAlbaran`. `null` si la acción no lleva. */
  albaranNormalizado: string | null;
};

/**
 * El correo, ya normalizado y sin una línea de texto libre.
 *
 * Lo que llega aquí son campos, no prosa: quién lo manda, de qué factura
 * habla, qué albaranes cita y qué hay que hacer con cada uno. Extraer eso del
 * cuerpo del correo es trabajo del parser, y el parser es otra pieza con sus
 * propias pruebas. Separarlos permite probar la deduplicación entera sin
 * depender de que el parser acierte, que es justo lo que no se puede dar por
 * supuesto todavía.
 */
export type CorreoNormalizado = {
  tipo: TipoExpediente;
  empresaCodigo: string | null;
  proveedorCodigo: string | null;
  proveedorNombre: string | null;
  facturaNumero: string | null;
  /** Céntimos con signo. Un abono viaja negativo. */
  importeCentimos: number | null;
  /** Identificador del hilo del servidor de correo, si lo hay. */
  hilo: string | null;
  /** Cabecera In-Reply-To, normalizada. */
  enRespuestaA: string | null;
  /** sha256 de cada adjunto. */
  hashesAdjuntos: string[];
  actuaciones: ActuacionEntrante[];
  urgente: boolean;
  /** Lo dice la categoría del correo, no una palabra suelta del cuerpo. */
  tareaVencida: boolean;
  /** El correo pide otra vez algo ya pedido (lo marca el parser). */
  reclamacion: boolean;
};

export type ActuacionCandidata = {
  id: string;
  accion: TipoAccion;
  albaranNormalizado: string | null;
  /** Una DESCARTADA no cuenta como instrucción vigente. */
  descartada: boolean;
};

export type ExpedienteCandidato = {
  id: string;
  numero: string;
  estado: EstadoExpediente;
  tipo: TipoExpediente;
  empresaCodigo: string | null;
  proveedorCodigo: string | null;
  proveedorNombre: string | null;
  facturaNumero: string | null;
  importeCentimos: number | null;
  /** ISO. Sólo para desempatar: la ventana la aplica la consulta. */
  fechaUltimaNotificacion: string;
  actuaciones: ActuacionCandidata[];
  hashesAdjuntos: string[];
  /** Hilos de sus notificaciones. */
  hilos: string[];
  /** Message-ID de sus notificaciones, para resolver el In-Reply-To. */
  messageIds: string[];
  numeroNotificaciones: number;
};

/* ── Lo que sale ─────────────────────────────────────────────────────────── */

export type MotivoPuntuacion = {
  /** Estable, para poder contarlos: `misma_factura`. */
  clave: string;
  puntos: number;
  /** Para la pantalla: «misma factura 0000123514». */
  texto: string;
};

export type CandidatoPuntuado = {
  id: string;
  numero: string;
  estado: EstadoExpediente;
  score: number;
  motivos: MotivoPuntuacion[];
};

/**
 * `RECLAMACION_SOBRE_RESUELTO` es una decisión y no una fusión a propósito: un
 * expediente resuelto NO se reabre solo. Puede que el trabajo esté hecho y el
 * correo sea el eco de un proceso que iba con retraso; reabrirlo por su cuenta
 * devolvería a la bandeja algo terminado y nadie sabría por qué.
 */
export type DecisionDedupe =
  | "FUSIONAR"
  | "POSIBLE_DUPLICADO"
  | "RECLAMACION_SOBRE_RESUELTO"
  | "CREAR";

export type ResultadoDedupe = {
  decision: DecisionDedupe;
  /** El mejor candidato, incluso cuando la decisión es CREAR. */
  mejor: CandidatoPuntuado | null;
  /** Ordenados de mayor a menor. Los que llegan al umbral de revisión. */
  candidatos: CandidatoPuntuado[];
};

/* ── Normalización de las claves que se comparan ─────────────────────────── */

/**
 * Deja un identificador en lo comparable: mayúsculas, sólo letras y dígitos, y
 * sin ceros a la izquierda.
 *
 * Los ceros importan porque el mismo número de factura viaja como `0000123514`
 * en un correo y como `123514` en el siguiente, según quién lo escriba. Y NO se
 * trocea en tiradas de dígitos como se hace con los albaranes (`albaran.ts`):
 * ahí el troceo resuelve prefijos de proveedor (`ENT-100126-0806295`), pero
 * aplicado a una factura `FA-2026/001` dejaría el núcleo en `1`, que coincide
 * con cualquier cosa. Dos problemas parecidos con respuestas distintas.
 */
export function normalizarIdentificador(v: string | null | undefined): string | null {
  if (typeof v !== "string") return null;
  const limpio = v.toUpperCase().replace(/[^A-Z0-9]/g, "").replace(/^0+/, "");
  return limpio === "" ? null : limpio;
}

/**
 * Formas jurídicas que sobran al comparar dos nombres.
 *
 * Se quitan sólo por el FINAL, que es donde van. Borrarlas donde aparezcan
 * dejaría «TALLERES SA LAMANCA» en «TALLERES LAMANCA», y una «S» suelta en
 * medio de un nombre puede ser una inicial de verdad.
 */
const FORMAS_JURIDICAS = new Set([
  "S", "L", "A", "U", "SL", "SA", "SLU", "SAU", "SLNE", "CB", "SC", "SCP",
  "SOCIEDAD", "LIMITADA", "ANONIMA", "UNIPERSONAL",
]);

/** Un nombre de proveedor comparable: sin acentos, sin forma jurídica. */
export function normalizarNombre(v: string | null | undefined): string | null {
  if (typeof v !== "string") return null;
  const sinAcentos = v.normalize("NFD").replace(/[̀-ͯ]/g, "");
  const palabras = sinAcentos
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, " ")
    .split(/\s+/)
    .filter(Boolean);

  while (palabras.length > 1 && FORMAS_JURIDICAS.has(palabras[palabras.length - 1])) {
    palabras.pop();
  }

  const limpio = palabras.join(" ");
  return limpio === "" ? null : limpio;
}

/** La identidad del proveedor: el código si lo hay, y si no el nombre. */
function identidadProveedor(
  codigo: string | null,
  nombre: string | null
): { valor: string; porNombre: boolean } | null {
  const c = normalizarIdentificador(codigo);
  if (c) return { valor: c, porNombre: false };
  const n = normalizarNombre(nombre);
  if (n) return { valor: n, porNombre: true };
  return null;
}

function interseccion(a: readonly string[], b: readonly string[]): string[] {
  const enB = new Set(b);
  return [...new Set(a)].filter((x) => enB.has(x));
}

/* ── La puntuación (F.2) ─────────────────────────────────────────────────── */

/**
 * La terna que identifica una aprobación de factura sin lugar a dudas.
 *
 * Aquí no hace falta puntuar: una aprobación y sus tareas vencidas hablan de la
 * MISMA factura de la MISMA sociedad al MISMO proveedor. Cuando los tres
 * campos están y coinciden, es el mismo expediente y no hay nada que sopesar.
 * Si falta alguno se cae a la puntuación normal, que es lo que sabe apañarse
 * con información incompleta.
 */
function mismaTernaDeAprobacion(
  correo: CorreoNormalizado,
  cand: ExpedienteCandidato
): boolean {
  if (correo.tipo !== "APROBACION_FACTURA" || cand.tipo !== "APROBACION_FACTURA") return false;
  const empresa = normalizarIdentificador(correo.empresaCodigo);
  const proveedor = normalizarIdentificador(correo.proveedorCodigo);
  const factura = normalizarIdentificador(correo.facturaNumero);
  if (!empresa || !proveedor || !factura) return false;
  return (
    empresa === normalizarIdentificador(cand.empresaCodigo) &&
    proveedor === normalizarIdentificador(cand.proveedorCodigo) &&
    factura === normalizarIdentificador(cand.facturaNumero)
  );
}

/** Los albaranes vigentes del expediente: las descartadas no cuentan. */
function albaranesVigentes(cand: ExpedienteCandidato): string[] {
  return cand.actuaciones
    .filter((a) => !a.descartada && a.albaranNormalizado)
    .map((a) => a.albaranNormalizado as string);
}

export function puntuar(
  correo: CorreoNormalizado,
  cand: ExpedienteCandidato,
  pesos: PesosDedupe = PESOS_DEDUPE_POR_DEFECTO
): CandidatoPuntuado {
  const motivos: MotivoPuntuacion[] = [];
  const anota = (clave: string, puntos: number, texto: string) => {
    if (puntos !== 0) motivos.push({ clave, puntos, texto });
  };

  const base = {
    id: cand.id,
    numero: cand.numero,
    estado: cand.estado,
  };

  if (mismaTernaDeAprobacion(correo, cand)) {
    return {
      ...base,
      score: 100,
      motivos: [
        {
          clave: "aprobacion_misma_terna",
          puntos: 100,
          texto: `aprobación de la misma factura ${correo.facturaNumero} del mismo proveedor y sociedad`,
        },
      ],
    };
  }

  const facturaCorreo = normalizarIdentificador(correo.facturaNumero);
  const facturaCand = normalizarIdentificador(cand.facturaNumero);
  const empresaCorreo = normalizarIdentificador(correo.empresaCodigo);
  const empresaCand = normalizarIdentificador(cand.empresaCodigo);

  // Misma factura exige también la misma sociedad: dos sociedades del grupo
  // pueden recibir facturas con la misma numeración de proveedores distintos.
  if (facturaCorreo && facturaCand && facturaCorreo === facturaCand) {
    if (!empresaCorreo || !empresaCand || empresaCorreo === empresaCand) {
      anota("misma_factura", pesos.mismaFactura, `misma factura ${correo.facturaNumero}`);
    }
  } else if (facturaCorreo && facturaCand) {
    anota(
      "factura_diferente",
      pesos.facturaDiferente,
      `factura distinta (${correo.facturaNumero} frente a ${cand.facturaNumero})`
    );
  }

  const albaranesCorreo = correo.actuaciones
    .filter((a) => a.albaranNormalizado)
    .map((a) => a.albaranNormalizado as string);
  const comunes = interseccion(albaranesCorreo, albaranesVigentes(cand));

  // Una vez aunque coincidan varios: dos albaranes comunes no son el doble de
  // prueba que uno, son la misma prueba —es el mismo expediente— y duplicarla
  // dispararía el score de cualquier reclamación por encima de todo lo demás.
  if (comunes.length > 0) {
    anota(
      "mismo_albaran",
      pesos.mismoAlbaran,
      comunes.length === 1
        ? `albarán ${comunes[0]} ya en ${cand.numero}`
        : `${comunes.length} albaranes ya en ${cand.numero} (${comunes.join(", ")})`
    );

    const mismaAccion = correo.actuaciones.some((a) =>
      cand.actuaciones.some(
        (c) =>
          !c.descartada &&
          c.albaranNormalizado === a.albaranNormalizado &&
          c.accion === a.accion
      )
    );
    if (mismaAccion) {
      anota("misma_accion", pesos.mismaAccion, "la misma acción sobre un albarán común");
    }
  }

  const provCorreo = identidadProveedor(correo.proveedorCodigo, correo.proveedorNombre);
  const provCand = identidadProveedor(cand.proveedorCodigo, cand.proveedorNombre);
  if (provCorreo && provCand) {
    if (provCorreo.valor === provCand.valor) {
      anota(
        "mismo_proveedor",
        pesos.mismoProveedor,
        `mismo proveedor ${correo.proveedorCodigo ?? correo.proveedorNombre}`
      );
    } else if (!provCorreo.porNombre && !provCand.porNombre) {
      /*
       * Sólo resta cuando los dos tienen CÓDIGO y difieren. Dos nombres
       * distintos pueden ser el mismo proveedor escrito de dos maneras, y
       * castigar eso separaría expedientes que sí van juntos.
       */
      anota(
        "proveedor_diferente",
        pesos.proveedorDiferente,
        `proveedor distinto (${correo.proveedorCodigo} frente a ${cand.proveedorCodigo})`
      );
    }
  }

  if (
    correo.importeCentimos !== null &&
    cand.importeCentimos !== null &&
    correo.importeCentimos === cand.importeCentimos
  ) {
    anota("mismo_importe", pesos.mismoImporte, "el mismo importe");
  }

  if (empresaCorreo && empresaCand && empresaCorreo === empresaCand) {
    anota("misma_empresa", pesos.mismaEmpresa, `misma sociedad ${correo.empresaCodigo}`);
  }

  const documentos = interseccion(correo.hashesAdjuntos, cand.hashesAdjuntos);
  if (documentos.length > 0) {
    anota("mismo_documento", pesos.mismoDocumento, "el mismo documento adjunto");
  }

  const mismoHilo =
    (correo.hilo !== null && cand.hilos.includes(correo.hilo)) ||
    (correo.enRespuestaA !== null && cand.messageIds.includes(correo.enRespuestaA));
  if (mismoHilo) {
    anota("mismo_hilo", pesos.mismoHilo, `respuesta en el hilo de ${cand.numero}`);
  }

  // Los tipos se comparan sólo entre los dos que son trabajo de verdad: OTRO
  // es el cajón de lo que no se ha sabido clasificar, y castigarlo separaría
  // un correo mal clasificado de su propio expediente.
  const tiposDeTrabajo: TipoExpediente[] = ["INCIDENCIA_ALBARAN", "APROBACION_FACTURA"];
  if (
    correo.tipo !== cand.tipo &&
    tiposDeTrabajo.includes(correo.tipo) &&
    tiposDeTrabajo.includes(cand.tipo)
  ) {
    anota(
      "tipo_incompatible",
      pesos.tipoIncompatible,
      `es ${correo.tipo} y ${cand.numero} es ${cand.tipo}`
    );
  }

  return {
    ...base,
    score: motivos.reduce((s, m) => s + m.puntos, 0),
    motivos,
  };
}

/* ── La decisión (F.4) ───────────────────────────────────────────────────── */

export function deduplicar(
  correo: CorreoNormalizado,
  candidatos: readonly ExpedienteCandidato[],
  pesos: PesosDedupe = PESOS_DEDUPE_POR_DEFECTO,
  umbrales: UmbralesDedupe = UMBRALES_DEDUPE_POR_DEFECTO
): ResultadoDedupe {
  const porFecha = new Map(candidatos.map((c) => [c.id, c.fechaUltimaNotificacion]));

  const puntuados = candidatos
    .map((c) => puntuar(correo, c, pesos))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      // Desempate: el más reciente. Si dos expedientes empatan es que el
      // correo encaja igual de bien en los dos, y el último es el que sigue
      // vivo en la cabeza de quien trabaja.
      return (porFecha.get(b.id) ?? "").localeCompare(porFecha.get(a.id) ?? "");
    });

  const mejor = puntuados[0] ?? null;
  const relevantes = puntuados.filter((c) => c.score >= umbrales.revisar);

  if (!mejor || mejor.score < umbrales.revisar) {
    return { decision: "CREAR", mejor, candidatos: [] };
  }

  if (mejor.score >= umbrales.fusionar) {
    return {
      decision: estaAbierto(mejor.estado) ? "FUSIONAR" : "RECLAMACION_SOBRE_RESUELTO",
      mejor,
      candidatos: relevantes,
    };
  }

  return { decision: "POSIBLE_DUPLICADO", mejor, candidatos: relevantes };
}

/* ── Qué hacer con las actuaciones al fusionar (F.5.4) ───────────────────── */

export type CambioInstruccion = {
  albaran: string;
  /** La actuación que ya estaba, y que NO se toca hasta que alguien decida. */
  actuacionId: string;
  accionAnterior: TipoAccion;
  accionNueva: TipoAccion;
};

export type PlanDeFusion = {
  /** Albaranes que el expediente no tenía: se crean tal cual. */
  nuevas: ActuacionEntrante[];
  /** Mismo albarán, otra acción: lo decide una persona. */
  cambiosInstruccion: CambioInstruccion[];
  /** Ya estaban, con la misma acción: no se hace nada. */
  repetidas: ActuacionEntrante[];
};

/**
 * Compara actuación a actuación, que es lo que impide dos errores opuestos.
 *
 * El primero es duplicar: la reclamación repite los mismos albaranes y, sin
 * esto, el expediente acabaría con dos «grabar 806295». El índice único de la
 * base lo rechazaría, pero un error de clave única no es una respuesta: hay
 * que saber que la actuación ya estaba y seguir.
 *
 * El segundo es perder trabajo: si el correo cita un albarán NUEVO junto a los
 * de siempre, tratar el correo entero como repetido lo dejaría fuera.
 *
 * Y el caso que no es ni uno ni otro: mismo albarán con otra acción. Ahí la
 * actuación existente **no se toca**. Cambiarla automáticamente sería decidir
 * por alguien que quizá ya la tenía a medias, y descartarla borraría trabajo.
 * Se levanta una decisión y el expediente queda bloqueado hasta que se resuelva.
 */
export function planDeFusion(
  correo: CorreoNormalizado,
  cand: ExpedienteCandidato
): PlanDeFusion {
  const plan: PlanDeFusion = { nuevas: [], cambiosInstruccion: [], repetidas: [] };
  const vigentes = cand.actuaciones.filter((a) => !a.descartada);

  for (const entrante of correo.actuaciones) {
    if (!entrante.albaranNormalizado) {
      /*
       * Sin albarán no hay con qué comparar, así que se crea. Es una acción
       * suelta («gestionar», «aprobar»), y el índice único de la base tampoco
       * la cubre —sólo mira las que tienen albarán—, de modo que la única
       * manera de no duplicarla sería adivinar, y adivinar aquí es perderla.
       */
      plan.nuevas.push(entrante);
      continue;
    }

    const mismoAlbaran = vigentes.filter(
      (a) => a.albaranNormalizado === entrante.albaranNormalizado
    );
    if (mismoAlbaran.length === 0) {
      plan.nuevas.push(entrante);
      continue;
    }

    if (mismoAlbaran.some((a) => a.accion === entrante.accion)) {
      plan.repetidas.push(entrante);
      continue;
    }

    for (const anterior of mismoAlbaran) {
      plan.cambiosInstruccion.push({
        albaran: entrante.albaranNormalizado,
        actuacionId: anterior.id,
        accionAnterior: anterior.accion,
        accionNueva: entrante.accion,
      });
    }
  }

  return plan;
}

/* ── Qué clase de correo es, una vez enlazado (F.5.2) ────────────────────── */

export const TIPOS_NOTIFICACION = [
  "SOLICITUD",
  "RECORDATORIO",
  "RECLAMACION",
  "TAREA_VENCIDA",
  "CAMBIO_INSTRUCCION",
  "APROBACION",
  "OTRO",
] as const;
export type TipoNotificacion = (typeof TIPOS_NOTIFICACION)[number];

/**
 * Clasifica el correo dentro del expediente al que se acaba de enlazar.
 *
 * El orden importa. Un cambio de instrucción manda sobre todo lo demás porque
 * es lo único que hace falta atender YA; una tarea vencida la marca la propia
 * categoría del correo; y a partir del tercero se considera reclamación aunque
 * nadie use la palabra, porque pedir tres veces lo mismo ES reclamar.
 *
 * Esa cuenta es la que alimenta `numero_reclamaciones`, y de ahí la prioridad.
 * Si dependiera sólo de que el texto dijera «reclamación», un proveedor
 * educado que insiste cinco veces sin quejarse nunca subiría en la cola.
 */
export function clasificarNotificacion(
  correo: CorreoNormalizado,
  opciones: { hayCambioInstruccion: boolean; notificacionesPrevias: number }
): TipoNotificacion {
  if (opciones.hayCambioInstruccion) return "CAMBIO_INSTRUCCION";
  if (correo.tareaVencida) return "TAREA_VENCIDA";
  if (opciones.notificacionesPrevias === 0) {
    return correo.tipo === "APROBACION_FACTURA" ? "APROBACION" : "SOLICITUD";
  }
  if (correo.reclamacion || correo.urgente || opciones.notificacionesPrevias >= 2) {
    return "RECLAMACION";
  }
  return "RECORDATORIO";
}

/** ¿Este tipo de notificación sube el contador de reclamaciones? */
export function cuentaComoReclamacion(tipo: TipoNotificacion): boolean {
  return tipo === "RECLAMACION" || tipo === "TAREA_VENCIDA";
}
