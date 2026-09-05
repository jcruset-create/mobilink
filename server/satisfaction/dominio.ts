/**
 * Satisfaction: el dominio. Sin base de datos, sin Express, sin Twilio.
 *
 * ── Por qué un solo motor y no uno por destinatario ─────────────────────────
 *
 * La tentación es hacer «encuesta de conductor» y «encuesta de cliente». Son
 * dos formularios distintos, sí, pero todo lo demás es idéntico: el estado, la
 * caducidad, el token, la validación, las reglas de calidad. Duplicarlo
 * significa que el día que se añada el tercer destinatario —y Central Assist
 * Connect traerá plataforma, proveedor y subcontratado— hay que escribirlo
 * todo por tercera vez.
 *
 * Aquí el destinatario es un dato (`recipientRole`) y el formulario es una
 * plantilla versionada. Añadir un destinatario nuevo es añadir una fila, no
 * una migración.
 *
 * ── Y por qué las plantillas se versionan ───────────────────────────────────
 *
 * Una respuesta guarda `templateVersion`. Sin eso, editar la plantilla en
 * abril cambiaría el significado de lo contestado en marzo: la pregunta 3
 * pasaría a ser otra y las medias saldrían mezclando dos cosas distintas.
 */

/* ── Sistema de origen ───────────────────────────────────────────────────── */

/**
 * La misma terna que ya usan el diario, los documentos y el correo:
 * `(sourceSystem, tenantId, assistanceId)`. Se reutiliza el vocabulario, no se
 * estrena otro.
 */
export const SISTEMAS = ["assist", "central"] as const;
export type Sistema = (typeof SISTEMAS)[number];

/* ── Destinatarios ───────────────────────────────────────────────────────── */

/**
 * Quién contesta.
 *
 * V1 trae los dos de Mobilink Assist. La lista se amplía sin tocar tablas: es
 * una columna de texto con un CHECK que se puede extender, no un enum de
 * PostgreSQL —cambiar un enum obliga a un `ALTER TYPE` que bloquea— ni una
 * columna por destinatario.
 */
export const ROLES_DESTINATARIO = ["DRIVER", "CUSTOMER"] as const;
export type RolDestinatario = (typeof ROLES_DESTINATARIO)[number];

export function esRolDestinatario(v: unknown): v is RolDestinatario {
  return typeof v === "string" && (ROLES_DESTINATARIO as readonly string[]).includes(v);
}

/* ── Estados de la encuesta ──────────────────────────────────────────────── */

export const ESTADOS_ENCUESTA = [
  "CREATED", "QUEUED", "SENT", "DELIVERED", "STARTED", "COMPLETED",
  "EXPIRED", "FAILED", "CANCELLED",
] as const;
export type EstadoEncuesta = (typeof ESTADOS_ENCUESTA)[number];

/** Estados de los que ya no se sale. */
export const ESTADOS_FINALES: readonly EstadoEncuesta[] = ["COMPLETED", "CANCELLED"];

/**
 * Qué transición es válida.
 *
 * Tres decisiones que no son obvias:
 *
 *  1. **Se puede saltar hacia adelante.** `CREATED → STARTED` es válido: en
 *     1D el enlace se puede abrir antes de que llegue la confirmación de
 *     entrega de WhatsApp, y eso pasa de verdad. Prohibirlo obligaría a
 *     inventar un `DELIVERED` que nadie ha visto.
 *  2. **`EXPIRED` y `FAILED` no son finales.** Una encuesta caducada se puede
 *     cancelar al archivar la asistencia, y una fallida se reencola. Lo que no
 *     se puede es responderla: eso lo impide `puedeResponderse`, no la máquina.
 *  3. **`COMPLETED` sí es final.** Una encuesta contestada no vuelve atrás ni
 *     a `EXPIRED` por un worker despistado: la respuesta ya existe y caducarla
 *     dejaría una respuesta huérfana de una encuesta que dice no haberse
 *     contestado.
 */
const TRANSICIONES: Record<EstadoEncuesta, readonly EstadoEncuesta[]> = {
  CREATED:   ["QUEUED", "SENT", "DELIVERED", "STARTED", "COMPLETED", "EXPIRED", "FAILED", "CANCELLED"],
  QUEUED:    ["SENT", "DELIVERED", "STARTED", "COMPLETED", "EXPIRED", "FAILED", "CANCELLED"],
  SENT:      ["DELIVERED", "STARTED", "COMPLETED", "EXPIRED", "FAILED", "CANCELLED"],
  DELIVERED: ["STARTED", "COMPLETED", "EXPIRED", "FAILED", "CANCELLED"],
  STARTED:   ["COMPLETED", "EXPIRED", "FAILED", "CANCELLED"],
  COMPLETED: [],
  // Se reintenta o se archiva; nunca se responde (ver `puedeResponderse`).
  EXPIRED:   ["CANCELLED"],
  FAILED:    ["QUEUED", "SENT", "CANCELLED"],
  CANCELLED: [],
};

export function transicionValida(desde: EstadoEncuesta, hasta: EstadoEncuesta): boolean {
  return (TRANSICIONES[desde] ?? []).includes(hasta);
}

/** Los estados desde los que todavía se puede contestar. */
export function puedeResponderse(estado: EstadoEncuesta): boolean {
  return estado === "CREATED" || estado === "QUEUED" || estado === "SENT"
      || estado === "DELIVERED" || estado === "STARTED";
}

/** La columna de tiempo que corresponde a cada estado, si tiene una. */
export const COLUMNA_DE_ESTADO: Partial<Record<EstadoEncuesta, string>> = {
  QUEUED: "queuedAtMs",
  SENT: "sentAtMs",
  DELIVERED: "deliveredAtMs",
  STARTED: "startedAtMs",
  COMPLETED: "completedAtMs",
  CANCELLED: "cancelledAtMs",
  FAILED: "failedAtMs",
};

/* ── Preguntas ───────────────────────────────────────────────────────────── */

export type TipoPregunta = "rating" | "enum" | "multi" | "text";

export type Pregunta = {
  code: string;
  tipo: TipoPregunta;
  obligatoria: boolean;
  /** Para `rating`: el rango cerrado admitido. */
  min?: number;
  max?: number;
  /** Para `enum` y `multi`: los valores aceptados. */
  valores?: readonly string[];
  /** Para `text`: el máximo. */
  maxLongitud?: number;
  /**
   * Cuándo se enseña.
   *
   * Es una PISTA para la miniweb, no una regla de validación: el backend
   * acepta la respuesta aunque la condición no se cumpla, porque el usuario
   * pudo empezar con un 1, escribir los motivos y subir la nota a un 4 antes
   * de enviar. Rechazarlo perdería lo que ya había escrito por un tecnicismo.
   */
  visibleSi?: "valoracion_baja_o_no_resuelto";
};

export type Plantilla = {
  code: string;
  version: number;
  recipientRole: RolDestinatario;
  preguntas: readonly Pregunta[];
};

export const ESCALA_MIN = 1;
export const ESCALA_MAX = 5;
export const MAX_COMENTARIO = 2000;

export const RESOLUCION = ["YES", "PARTIAL", "NO"] as const;
export type Resolucion = (typeof RESOLUCION)[number];

/**
 * Motivos negativos.
 *
 * Comunes a los dos destinatarios a propósito: si el conductor y el cliente
 * usaran listas distintas no se podrían contar juntos, y «cuántas quejas hay
 * por tiempo de espera» es exactamente la pregunta que se va a hacer.
 */
export const MOTIVOS_NEGATIVOS = [
  "LONG_WAIT", "POOR_COMMUNICATION", "POOR_TREATMENT", "NOT_RESOLVED",
  "SERVICE_PROBLEM", "VEHICLE_DAMAGE", "OTHER",
] as const;
export type MotivoNegativo = (typeof MOTIVOS_NEGATIVOS)[number];

const RATING = (code: string, obligatoria = true): Pregunta =>
  ({ code, tipo: "rating", obligatoria, min: ESCALA_MIN, max: ESCALA_MAX });

const PREGUNTA_RESOLUCION: Pregunta =
  { code: "resolution", tipo: "enum", obligatoria: true, valores: RESOLUCION };

const PREGUNTA_MOTIVOS: Pregunta = {
  code: "negative_reasons", tipo: "multi", obligatoria: false,
  valores: MOTIVOS_NEGATIVOS, visibleSi: "valoracion_baja_o_no_resuelto",
};

const PREGUNTA_COMENTARIO: Pregunta =
  { code: "comment", tipo: "text", obligatoria: false, maxLongitud: MAX_COMENTARIO };

/* ── Plantillas V1 ───────────────────────────────────────────────────────── */

export const PLANTILLA_CONDUCTOR: Plantilla = {
  code: "assist_driver_v1",
  version: 1,
  recipientRole: "DRIVER",
  preguntas: [
    RATING("overall_rating"),
    RATING("professional_rating"),
    PREGUNTA_RESOLUCION,
    PREGUNTA_MOTIVOS,
    PREGUNTA_COMENTARIO,
  ],
};

export const PLANTILLA_CLIENTE: Plantilla = {
  code: "assist_customer_v1",
  version: 1,
  recipientRole: "CUSTOMER",
  preguntas: [
    RATING("overall_rating"),
    RATING("speed_rating"),
    RATING("tracking_rating"),
    PREGUNTA_RESOLUCION,
    PREGUNTA_MOTIVOS,
    PREGUNTA_COMENTARIO,
  ],
};

export const PLANTILLAS_V1: readonly Plantilla[] = [PLANTILLA_CONDUCTOR, PLANTILLA_CLIENTE];

export function plantillaDeRol(rol: RolDestinatario): Plantilla | null {
  return PLANTILLAS_V1.find((p) => p.recipientRole === rol) ?? null;
}

/* ── Validación ──────────────────────────────────────────────────────────── */

/**
 * Una respuesta tal y como llega de fuera. Sin tipar de más a propósito: lo
 * que llega por la red es `unknown` hasta que se valida.
 */
export type RespuestaEntrante = { code: string; value: unknown };

export type ErrorValidacion = {
  code: string;
  motivo:
    | "pregunta_desconocida" | "pregunta_duplicada" | "falta_obligatoria"
    | "fuera_de_escala" | "valor_invalido" | "demasiado_largo" | "tipo_invalido";
};

/**
 * El resultado de validar.
 *
 * Un solo objeto en vez de una unión discriminada, y no por gusto: el
 * `tsconfig.server.json` del proyecto va con `strict: false`, y sin
 * `strictNullChecks` TypeScript no estrecha la unión al comprobar `!v.ok`. La
 * alternativa era un cast en cada llamada, que es peor que esto.
 *
 * Además resulta útil: cuando falla, `valores` trae lo que sí se pudo leer, y
 * eso permite enseñar el formulario con lo que ya había puesto en vez de
 * vaciarlo.
 */
export type Validacion = {
  ok: boolean;
  valores: Map<string, string | number | string[]>;
  errores: ErrorValidacion[];
};

/**
 * Valida una respuesta completa contra su plantilla.
 *
 * Devuelve TODOS los errores, no el primero: quien está rellenando la encuesta
 * en el móvil merece verlos de una vez, no uno por intento.
 */
export function validarRespuesta(
  plantilla: Plantilla,
  respuestas: readonly RespuestaEntrante[],
): Validacion {
  const errores: ErrorValidacion[] = [];
  const valores = new Map<string, string | number | string[]>();
  const porCodigo = new Map(plantilla.preguntas.map((p) => [p.code, p]));
  const vistas = new Set<string>();

  for (const r of respuestas) {
    const code = String(r.code ?? "");
    const pregunta = porCodigo.get(code);
    if (!pregunta) { errores.push({ code, motivo: "pregunta_desconocida" }); continue; }
    if (vistas.has(code)) { errores.push({ code, motivo: "pregunta_duplicada" }); continue; }
    vistas.add(code);

    // Un valor vacío es «no contestada», no un error: lo decide la
    // comprobación de obligatorias de más abajo, en un solo sitio.
    if (r.value == null || r.value === "") continue;

    switch (pregunta.tipo) {
      case "rating": {
        const n = Number(r.value);
        if (!Number.isInteger(n) || n < (pregunta.min ?? ESCALA_MIN) || n > (pregunta.max ?? ESCALA_MAX)) {
          errores.push({ code, motivo: "fuera_de_escala" });
        } else valores.set(code, n);
        break;
      }
      case "enum": {
        const s = String(r.value);
        if (!(pregunta.valores ?? []).includes(s)) errores.push({ code, motivo: "valor_invalido" });
        else valores.set(code, s);
        break;
      }
      case "multi": {
        if (!Array.isArray(r.value)) { errores.push({ code, motivo: "tipo_invalido" }); break; }
        const lista = r.value.map((v) => String(v));
        const malos = lista.filter((v) => !(pregunta.valores ?? []).includes(v));
        if (malos.length) errores.push({ code, motivo: "valor_invalido" });
        // Se quitan los repetidos en vez de rechazar: marcar dos veces la misma
        // casilla es un fallo de la pantalla, no del que responde.
        else valores.set(code, [...new Set(lista)]);
        break;
      }
      case "text": {
        const s = String(r.value);
        if (s.length > (pregunta.maxLongitud ?? MAX_COMENTARIO)) {
          errores.push({ code, motivo: "demasiado_largo" });
        } else valores.set(code, s);
        break;
      }
    }
  }

  for (const p of plantilla.preguntas) {
    if (p.obligatoria && !valores.has(p.code)) {
      errores.push({ code: p.code, motivo: "falta_obligatoria" });
    }
  }

  return { ok: errores.length === 0, valores, errores };
}

/* ── Reglas de calidad ───────────────────────────────────────────────────── */

export const PRIORIDADES = ["NORMAL", "HIGH", "CRITICAL"] as const;
export type Prioridad = (typeof PRIORIDADES)[number];

const PESO: Record<Prioridad, number> = { NORMAL: 0, HIGH: 1, CRITICAL: 2 };

export const MOTIVOS_CASO = ["VEHICLE_DAMAGE", "NOT_RESOLVED", "LOW_RATING"] as const;
export type MotivoCaso = (typeof MOTIVOS_CASO)[number];

/** El umbral por debajo del cual una valoración abre caso. */
export const UMBRAL_VALORACION_NEGATIVA = 2;

export type Veredicto =
  | { abreCaso: false }
  | { abreCaso: true; motivo: MotivoCaso; prioridad: Prioridad };

/**
 * ¿Esta respuesta abre un caso de calidad, y con qué prioridad?
 *
 * Función pura: recibe los valores ya validados y no toca nada. Es lo que
 * permite probar las ocho combinaciones sin base de datos.
 *
 * **Un caso como mucho por respuesta.** Si alguien marca cuatro motivos no se
 * abren cuatro expedientes: se abre uno, con el motivo más grave, y los demás
 * quedan en la respuesta, que es donde se pueden contar. Cuatro expedientes
 * del mismo servicio son cuatro personas mirando lo mismo.
 *
 * El motivo se elige por gravedad, no por el orden en que se marcaron:
 * daños > no resuelto > valoración baja.
 */
export function evaluarCalidad(valores: Map<string, string | number | string[]>): Veredicto {
  const general = valores.get("overall_rating");
  const resolucion = valores.get("resolution");
  const motivos = valores.get("negative_reasons");
  const lista = Array.isArray(motivos) ? motivos : [];

  const hayDanos = lista.includes("VEHICLE_DAMAGE");
  const noResuelto = resolucion === "NO";
  const valoracionBaja = typeof general === "number" && general <= UMBRAL_VALORACION_NEGATIVA;

  if (!hayDanos && !noResuelto && !valoracionBaja) return { abreCaso: false };

  /*
   * La prioridad se calcula por separado del motivo y se queda con la más
   * alta. Así unos daños con un 5 y todo resuelto siguen siendo CRITICAL: la
   * nota es la percepción, el golpe es un hecho.
   */
  let prioridad: Prioridad = "NORMAL";
  const subir = (p: Prioridad) => { if (PESO[p] > PESO[prioridad]) prioridad = p; };
  if (valoracionBaja) subir("HIGH");
  if (noResuelto) subir("HIGH");
  if (hayDanos) subir("CRITICAL");

  const motivo: MotivoCaso = hayDanos ? "VEHICLE_DAMAGE" : noResuelto ? "NOT_RESOLVED" : "LOW_RATING";
  return { abreCaso: true, motivo, prioridad };
}

/* ── Estados del caso de calidad ─────────────────────────────────────────── */

export const ESTADOS_CASO = [
  "NEW", "IN_REVIEW", "PENDING_PROVIDER", "PENDING_CUSTOMER", "RESOLVED", "CLOSED",
] as const;
export type EstadoCaso = (typeof ESTADOS_CASO)[number];

/**
 * Transiciones del expediente.
 *
 * `RESOLVED → IN_REVIEW` existe a propósito: un caso dado por resuelto que
 * vuelve —el cliente contesta que no, aparece una factura de daños— se reabre.
 * `CLOSED` no vuelve: cerrar es la decisión de que ya no se toca, y si hay que
 * volver se abre un caso nuevo que enlaza al anterior.
 */
const TRANSICIONES_CASO: Record<EstadoCaso, readonly EstadoCaso[]> = {
  NEW:              ["IN_REVIEW", "PENDING_PROVIDER", "PENDING_CUSTOMER", "RESOLVED", "CLOSED"],
  IN_REVIEW:        ["PENDING_PROVIDER", "PENDING_CUSTOMER", "RESOLVED", "CLOSED"],
  PENDING_PROVIDER: ["IN_REVIEW", "PENDING_CUSTOMER", "RESOLVED", "CLOSED"],
  PENDING_CUSTOMER: ["IN_REVIEW", "PENDING_PROVIDER", "RESOLVED", "CLOSED"],
  RESOLVED:         ["CLOSED", "IN_REVIEW"],
  CLOSED:           [],
};

export function transicionCasoValida(desde: EstadoCaso, hasta: EstadoCaso): boolean {
  return (TRANSICIONES_CASO[desde] ?? []).includes(hasta);
}

/** Conclusiones al cerrar. Texto libre acotado, no un enum de PostgreSQL. */
export const RESOLUCIONES_CASO = [
  "SERVICE_OK_PERCEPTION", "SLA_BREACH", "PROVIDER_INCIDENT", "COMMUNICATION_ISSUE",
  "TECHNICAL_NOT_RESOLVED", "DAMAGE_CONFIRMED", "DAMAGE_NOT_CONFIRMED",
  "INTERNAL_ERROR", "OTHER",
] as const;

export const ACCIONES_CASO = [
  "NONE", "PROVIDER_WARNING", "PROVIDER_REVIEW", "COMPENSATION",
  "PROCESS_CHANGE", "TRAINING", "ESCALATED_TO_CLAIM", "OTHER",
] as const;

/* ── Entregas ────────────────────────────────────────────────────────────── */

export const CANALES = ["WHATSAPP", "SMS", "EMAIL"] as const;
export type Canal = (typeof CANALES)[number];

export const TIPOS_MENSAJE = ["INVITATION", "REMINDER"] as const;
export type TipoMensaje = (typeof TIPOS_MENSAJE)[number];

export const ESTADOS_ENTREGA = ["PENDING", "SENT", "DELIVERED", "FAILED", "SKIPPED"] as const;
export type EstadoEntrega = (typeof ESTADOS_ENTREGA)[number];

/* ── Valores por defecto ─────────────────────────────────────────────────── */

/**
 * Lo mínimo para que 1B funcione. La configuración de verdad —global y por
 * cliente— llega en 1C, cuando se sepa a quién se puede escribir.
 */
export const CADUCIDAD_POR_DEFECTO_MS = 14 * 24 * 60 * 60 * 1000;
