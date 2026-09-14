/**
 * Meter un correo en la cola de trabajo.
 *
 * Es el caso de uso central del módulo: llega un correo de Therefore y hay que
 * decidir si es un expediente nuevo, uno que ya existe, o algo que no se sabe y
 * tiene que mirar una persona. Todo lo que pasa aquí pasa en UNA transacción:
 * el correo, el expediente, sus actuaciones, sus adjuntos y el histórico entran
 * juntos o no entra nada.
 *
 * ── Qué entra por aquí y qué no ─────────────────────────────────────────────
 *
 * Entra un `CorreoEntrante`: campos, no prosa. Quién lo manda, de qué factura
 * habla, qué albaranes cita y qué hay que hacer con cada uno.
 *
 * Sacar eso del cuerpo del correo es trabajo del PARSER, que es otra pieza y
 * llegará cuando haya correos reales con los que calibrarlo. La separación no
 * es burocracia: permite que todo esto —la idempotencia, la deduplicación, los
 * cambios de instrucción, los contadores de reclamaciones— esté probado y
 * funcionando antes de que exista una sola línea de parser, y que el día que
 * el parser se equivoque se sepa que el fallo es suyo.
 *
 * ── La idempotencia ─────────────────────────────────────────────────────────
 *
 * El mismo correo dos veces tiene que dar exactamente lo mismo que una: un
 * expediente, una actuación, una notificación. No es una elegancia: el buzón se
 * relee, las pasadas se solapan y un reproceso a mano es lo primero que se hace
 * cuando algo sale mal. La garantía es el UNIQUE de `(empresa_id, message_id)`
 * y no una comprobación previa, porque dos pasadas a la vez pasarían las dos
 * por un «¿ya existe?».
 *
 * ── Y la regla que gobierna las dudas ───────────────────────────────────────
 *
 * Cuando no se sabe, **se pregunta**. El correo se queda sin expediente, con
 * sus candidatos y la puntuación de cada uno guardados tal y como se
 * calcularon, esperando a que alguien diga. Es más lento y es lo correcto:
 * fusionar mal esconde trabajo, y duplicar lo hace aparecer dos veces.
 */

import { createHash } from "node:crypto";
import { leerConfig, type ConfigTherefore } from "./config.ts";
import { claveAlbaran } from "./domain/albaran.ts";
import {
  clasificarNotificacion,
  cuentaComoReclamacion,
  deduplicar,
  planDeFusion,
  type CorreoNormalizado,
  type ExpedienteCandidato,
  type TipoNotificacion,
} from "./domain/dedupe.ts";
import type { TipoAccion, TipoExpediente } from "./domain/estados.ts";
import { ErrorTherefore } from "./errors.ts";
import * as repo from "./repository.ts";
import { cambiosDePrioridad, type Contexto } from "./service.ts";

/* ── Lo que entra ────────────────────────────────────────────────────────── */

export type AccionEntrante = {
  accion: TipoAccion;
  /** Tal y como lo escribe el correo. Se conserva sin normalizar. */
  albaran?: string | null;
  importeCentimos?: number | null;
  /** Lo que venía pegado al albarán y no se interpreta: «T2». */
  indicador?: string | null;
  /** Del parser. Por debajo del umbral, el expediente pide revisión. */
  confianza?: number;
};

export type AdjuntoEntrante = {
  nombre?: string;
  mimeType?: string;
  tamanoBytes?: number | null;
  /** sha256 del fichero. Es lo que cruza el mismo documento entre correos. */
  hash: string;
  storagePath?: string | null;
};

export type CorreoEntrante = {
  messageId: string;
  gmailMessageId?: string | null;
  gmailThreadId?: string | null;
  inReplyTo?: string | null;
  fecha: string;
  de?: string;
  para?: string;
  asunto?: string;
  /** El cuerpo entero. Se guarda tal cual y NUNCA se edita. */
  texto: string;

  tipo?: TipoExpediente;
  empresaCodigo?: string | null;
  empresaNombre?: string | null;
  proveedorCodigo?: string | null;
  proveedorNombre?: string | null;
  cuentaContable?: string | null;
  facturaNumero?: string | null;
  facturaFecha?: string | null;
  /** Céntimos CON SIGNO: un abono viaja negativo de punta a punta. */
  importeCentimos?: number | null;
  casoReferencia?: string | null;
  persona?: string | null;

  urgente?: boolean;
  tareaVencida?: boolean;
  reclamacion?: boolean;

  acciones?: AccionEntrante[];
  adjuntos?: AdjuntoEntrante[];

  /**
   * Números citados en el correo que NO se han sabido convertir en acción.
   *
   * Se guardan y NO se convierten en actuaciones. Es lo que impide que un
   * parser «listo» se invente una acción para no dejar nada fuera: un albarán
   * grabado con la acción equivocada cuesta más de arreglar que uno que se
   * quedó esperando a que alguien mirase el correo.
   */
  albaranesAmbiguos?: string[];
  /** Lo que entendió el parser, con sus confianzas. Es la evidencia. */
  parseado?: unknown;
};

/* ── Lo que sale ─────────────────────────────────────────────────────────── */

export type ResultadoIngesta = {
  /** El correo ya se había procesado: no se ha cambiado nada. */
  duplicado: boolean;
  notificacionId: string;
  resultado: "CREADO" | "FUSIONADO" | "PENDIENTE_DECISION";
  expedienteId: string | null;
  expedienteNumero: string | null;
  tipoNotificacion: TipoNotificacion;
  actuacionesCreadas: number;
  decisiones: { id: string; tipo: repo.TipoDecision }[];
};

/* ── Normalizar lo que entra ─────────────────────────────────────────────── */

/**
 * El hash del contenido: el mismo correo reenviado a mano llega con otro
 * Message-ID pero con el mismo cuerpo.
 *
 * Se normalizan los espacios antes de resumir porque los clientes de correo
 * reajustan los saltos de línea al reenviar, y un hash que cambiara por eso no
 * serviría para nada.
 */
export function hashDeContenido(asunto: string, texto: string): string {
  const normalizado = `${asunto}\n${texto}`.replace(/\s+/g, " ").trim().toLowerCase();
  return createHash("sha256").update(normalizado, "utf8").digest("hex");
}

function accionesDe(correo: CorreoEntrante): AccionEntrante[] {
  return (correo.acciones ?? []).filter((a) => a && a.accion);
}

/** La entrada sin el cuerpo, que ya vive en su propia columna. */
function sinTexto(correo: CorreoEntrante): Omit<CorreoEntrante, "texto"> {
  const { texto: _texto, ...resto } = correo;
  return resto;
}

/**
 * Recompone la entrada guardada al procesar el correo.
 *
 * Devuelve `null` si la notificación es de antes de que se guardara, o si el
 * JSON no tiene la forma esperada. Quien llama tiene que saber tratar ese
 * `null`: inventarse una entrada a partir del texto sería exactamente lo que
 * este módulo no hace.
 */
export function entradaGuardada(notificacion: repo.Notificacion): CorreoEntrante | null {
  const p = notificacion.parseado as { entrada?: Partial<CorreoEntrante> } | null;
  const entrada = p?.entrada;
  if (!entrada || typeof entrada !== "object" || !entrada.messageId) return null;
  return { ...(entrada as Omit<CorreoEntrante, "texto">), texto: notificacion.textoOriginal };
}

/**
 * Pasa la entrada a la forma que entiende el deduplicador.
 *
 * Exportada porque la resolución de decisiones tiene que normalizar el mismo
 * correo otra vez, días después, y con las mismas reglas.
 */
export function normalizarEntrada(correo: CorreoEntrante): CorreoNormalizado {
  return {
    tipo: correo.tipo ?? "INCIDENCIA_ALBARAN",
    empresaCodigo: correo.empresaCodigo ?? null,
    proveedorCodigo: correo.proveedorCodigo ?? null,
    proveedorNombre: correo.proveedorNombre ?? null,
    facturaNumero: correo.facturaNumero ?? null,
    importeCentimos: correo.importeCentimos ?? null,
    hilo: correo.gmailThreadId ?? null,
    enRespuestaA: correo.inReplyTo ?? null,
    hashesAdjuntos: (correo.adjuntos ?? []).map((a) => a.hash),
    actuaciones: accionesDe(correo).map((a) => ({
      accion: a.accion,
      albaranNormalizado: claveAlbaran(a.albaran ?? null),
    })),
    urgente: Boolean(correo.urgente),
    tareaVencida: Boolean(correo.tareaVencida),
    reclamacion: Boolean(correo.reclamacion),
  };
}

/**
 * ¿Hay algo que una persona tenga que mirar aunque el correo se haya colocado?
 *
 * Dos motivos, y los dos son «el sistema no está seguro», no «el sistema ha
 * fallado»: un número citado que no se ha sabido a qué acción asociar, y una
 * acción que el parser ha extraído con poca confianza. Colocar el correo y
 * callarse sería peor, porque el expediente parecería completo.
 */
function motivoDeRevision(correo: CorreoEntrante, umbral: number): string | null {
  const ambiguos = correo.albaranesAmbiguos ?? [];
  if (ambiguos.length > 0) {
    return `El correo cita ${ambiguos.join(", ")} sin decir qué hay que hacer con ${
      ambiguos.length === 1 ? "él" : "ellos"
    }.`;
  }
  const flojas = accionesDe(correo).filter(
    (a) => a.confianza !== undefined && a.confianza < umbral
  );
  if (flojas.length > 0) {
    return `${flojas.length} ${
      flojas.length === 1 ? "acción se ha leído" : "acciones se han leído"
    } con poca confianza.`;
  }
  return null;
}

/** El umbral por debajo del cual una acción leída no se da por buena. */
const UMBRAL_CONFIANZA = 0.8;

/* ── El caso de uso ──────────────────────────────────────────────────────── */

export async function procesarCorreo(
  ctx: Contexto,
  correo: CorreoEntrante
): Promise<ResultadoIngesta> {
  if (!correo.messageId?.trim()) {
    throw new ErrorTherefore(
      "MESSAGE_ID_REQUERIDO",
      "El correo no trae Message-ID, y sin él no se puede garantizar que no se procese dos veces.",
      400
    );
  }
  if (!correo.texto?.trim()) {
    throw new ErrorTherefore(
      "TEXTO_REQUERIDO",
      "El correo llega sin cuerpo. El texto original es la única prueba de qué se pidió.",
      400
    );
  }

  const cfg = await leerConfig(ctx.empresaId);
  const normalizado = normalizarEntrada(correo);
  const hashContenido = hashDeContenido(correo.asunto ?? "", correo.texto);

  return repo.enTransaccion(async (c) => {
    const { notificacion, yaEstaba } = await repo.registrarNotificacion(
      ctx.empresaId,
      {
        messageId: correo.messageId.trim(),
        gmailMessageId: correo.gmailMessageId ?? null,
        gmailThreadId: correo.gmailThreadId ?? null,
        inReplyTo: correo.inReplyTo ?? null,
        fechaEmail: correo.fecha,
        remitente: correo.de ?? "",
        destinatario: correo.para ?? "",
        asunto: correo.asunto ?? "",
        textoOriginal: correo.texto,
        urgenteDetectado: Boolean(correo.urgente),
        personaSolicitante: correo.persona ?? null,
        hashContenido,
        /*
         * Se guarda la ENTRADA entera, no sólo lo que dijera el parser.
         *
         * Por dos motivos. El primero es que es la evidencia: cuando alguien
         * pregunte por qué existe esta actuación, la respuesta está aquí.
         *
         * El segundo es que un correo que queda esperando una decisión hay que
         * poder volver a aplicarlo cuando alguien decida, días después, y para
         * eso hacen falta sus campos. Sin esto habría que reconstruirlos del
         * texto con un parser que entonces podría no dar el mismo resultado.
         *
         * El texto no se duplica: ya está en `texto_original`, que es la
         * columna que no se toca nunca.
         */
        parseado: { entrada: sinTexto(correo), parser: correo.parseado ?? null },
      },
      c
    );

    /*
     * Ya procesado. Se devuelve dónde acabó la primera vez y NO se toca nada:
     * ni contadores, ni prioridad, ni histórico. Una segunda pasada que
     * subiera el contador de reclamaciones convertiría un reproceso rutinario
     * en una escalada de prioridad falsa.
     */
    if (yaEstaba) {
      const exp = notificacion.expedienteId
        ? await repo.obtenerExpediente(ctx.empresaId, notificacion.expedienteId, c)
        : null;
      return {
        duplicado: true,
        notificacionId: notificacion.id,
        resultado:
          notificacion.estadoProceso === "PENDIENTE_DECISION"
            ? ("PENDIENTE_DECISION" as const)
            : notificacion.expedienteId
              ? ("FUSIONADO" as const)
              : ("PENDIENTE_DECISION" as const),
        expedienteId: notificacion.expedienteId,
        expedienteNumero: exp?.numero ?? null,
        tipoNotificacion: notificacion.tipoNotificacion,
        actuacionesCreadas: 0,
        decisiones: [],
      };
    }

    for (const a of correo.adjuntos ?? []) {
      if (!a?.hash) continue;
      await repo.registrarAdjunto(
        ctx.empresaId,
        notificacion.id,
        null,
        {
          nombreArchivo: a.nombre ?? "",
          mimeType: a.mimeType ?? "",
          tamanoBytes: a.tamanoBytes ?? null,
          tipoDocumento: tipoDeAdjunto(a),
          hashArchivo: a.hash,
          storagePath: a.storagePath ?? null,
        },
        c
      );
    }

    const candidatos = await repo.candidatosDedupe(
      ctx.empresaId,
      {
        facturaNumero: normalizado.facturaNumero,
        albaranes: normalizado.actuaciones
          .map((a) => a.albaranNormalizado)
          .filter((x): x is string => x !== null),
        hashesAdjuntos: normalizado.hashesAdjuntos,
        hilo: normalizado.hilo,
        enRespuestaA: normalizado.enRespuestaA,
        hashContenido,
        ventanaDias: cfg.dedupe.ventanaDias,
      },
      c
    );

    const veredicto = deduplicar(
      normalizado,
      candidatos,
      cfg.dedupe.pesos,
      cfg.dedupe.umbrales
    );

    if (veredicto.decision === "FUSIONAR" && veredicto.mejor) {
      const candidato = candidatos.find((x) => x.id === veredicto.mejor!.id)!;
      return fusionarEnExpediente(ctx, c, cfg, correo, normalizado, notificacion, candidato);
    }

    if (veredicto.decision === "CREAR") {
      return crearDesdeCorreo(ctx, c, cfg, correo, normalizado, notificacion);
    }

    // POSIBLE_DUPLICADO y RECLAMACION_SOBRE_RESUELTO: el correo se queda
    // esperando, sin expediente. Es la única forma de no elegir por alguien.
    const decision = await repo.crearDecision(
      ctx.empresaId,
      {
        tipo:
          veredicto.decision === "RECLAMACION_SOBRE_RESUELTO"
            ? "RECLAMACION_SOBRE_RESUELTO"
            : "POSIBLE_DUPLICADO",
        notificacionId: notificacion.id,
        expedienteId:
          veredicto.decision === "RECLAMACION_SOBRE_RESUELTO" ? veredicto.mejor!.id : null,
        candidatos: veredicto.candidatos,
        detalle: { asunto: correo.asunto ?? "", facturaNumero: correo.facturaNumero ?? null },
      },
      c
    );

    await repo.actualizarNotificacion(
      ctx.empresaId,
      notificacion.id,
      { estadoProceso: "PENDIENTE_DECISION" },
      c
    );

    await repo.anotarEvento(
      ctx.empresaId,
      {
        notificacionId: notificacion.id,
        expedienteId: veredicto.mejor?.id ?? null,
        tipo: "DECISION_PENDIENTE",
        actorTipo: "sistema",
        datosNuevos: { decision: veredicto.decision, candidatos: veredicto.candidatos },
        descripcion:
          veredicto.decision === "RECLAMACION_SOBRE_RESUELTO"
            ? `Reclamación sobre ${veredicto.mejor!.numero}, que está ${veredicto.mejor!.estado.toLowerCase()}. No se reabre sin que alguien lo diga.`
            : `Puede ser el mismo asunto que ${veredicto.candidatos
                .map((x) => x.numero)
                .join(", ")}. Se deja a decidir.`,
      },
      c
    );

    return {
      duplicado: false,
      notificacionId: notificacion.id,
      resultado: "PENDIENTE_DECISION" as const,
      expedienteId: null,
      expedienteNumero: null,
      tipoNotificacion: notificacion.tipoNotificacion,
      actuacionesCreadas: 0,
      decisiones: decision ? [{ id: decision.id, tipo: decision.tipo }] : [],
    };
  });
}

function tipoDeAdjunto(a: AdjuntoEntrante): repo.TipoDocumentoAdjunto {
  const nombre = (a.nombre ?? "").toLowerCase();
  const mime = (a.mimeType ?? "").toLowerCase();
  if (mime.includes("xml") || nombre.endsWith(".xml")) return "XML_FACTURA";
  if (mime.includes("pdf") || nombre.endsWith(".pdf")) return "PDF_FACTURA";
  return "OTRO";
}

/* ── Crear (F.4, rama «score < umbral de revisión») ──────────────────────── */

/**
 * Exportada porque la usa también la resolución de decisiones.
 *
 * Cuando una persona dice «no, esto es nuevo», tiene que pasar EXACTAMENTE lo
 * mismo que si el motor lo hubiera decidido: mismo expediente, mismos eventos,
 * misma prioridad. Escribir una segunda versión más corta para ese camino es
 * cómo acaban divergiendo, y el que menos se usa es el que se rompe.
 */
export async function crearDesdeCorreo(
  ctx: Contexto,
  c: repo.Ejecutor,
  cfg: ConfigTherefore,
  correo: CorreoEntrante,
  normalizado: CorreoNormalizado,
  notificacion: repo.Notificacion
): Promise<ResultadoIngesta> {
  const expediente = await repo.crearExpediente(
    ctx.empresaId,
    ctx.userId,
    {
      tipo: normalizado.tipo,
      empresaCodigo: correo.empresaCodigo ?? "",
      empresaNombre: correo.empresaNombre ?? "",
      proveedorCodigo: correo.proveedorCodigo ?? null,
      proveedorNombre: correo.proveedorNombre ?? null,
      cuentaContable: correo.cuentaContable ?? null,
      facturaNumero: correo.facturaNumero ?? null,
      facturaFecha: correo.facturaFecha ?? null,
      importeCentimos: correo.importeCentimos ?? null,
      moneda: "EUR",
      casoReferencia: correo.casoReferencia ?? null,
      urgente: Boolean(correo.urgente),
      tareaVencida: Boolean(correo.tareaVencida),
      observaciones: "",
      // La antigüedad se cuenta desde que Therefore lo pidió, no desde que la
      // fila se creó: un correo del histórico lleva abierto desde su fecha.
      fechaPrimeraNotificacion: correo.fecha,
    },
    c
  );

  await repo.actualizarExpediente(
    ctx.empresaId,
    expediente.id,
    { numero_notificaciones: 1, fecha_ultima_notificacion: correo.fecha },
    c
  );

  await repo.anotarEvento(
    ctx.empresaId,
    {
      expedienteId: expediente.id,
      notificacionId: notificacion.id,
      tipo: "EXPEDIENTE_CREADO",
      actorTipo: "sistema",
      datosNuevos: {
        numero: expediente.numero,
        tipo: expediente.tipo,
        facturaNumero: expediente.facturaNumero,
        messageId: notificacion.messageId,
      },
      descripcion: `Expediente ${expediente.numero} abierto desde el correo «${correo.asunto ?? ""}».`,
    },
    c
  );

  const creadas = await crearActuaciones(ctx, c, correo, expediente.id, notificacion.id);

  const tipoNotificacion = clasificarNotificacion(normalizado, {
    hayCambioInstruccion: false,
    notificacionesPrevias: 0,
  });
  await repo.actualizarNotificacion(
    ctx.empresaId,
    notificacion.id,
    { expedienteId: expediente.id, tipoNotificacion, estadoProceso: "PROCESADA" },
    c
  );
  await repo.asignarAdjuntosAExpediente(ctx.empresaId, notificacion.id, expediente.id, c);

  const decisiones = await pedirRevisionSiHaceFalta(
    ctx,
    c,
    correo,
    notificacion.id,
    expediente.id
  );

  await refrescarPrioridad(ctx, c, cfg, expediente.id);

  return {
    duplicado: false,
    notificacionId: notificacion.id,
    resultado: "CREADO",
    expedienteId: expediente.id,
    expedienteNumero: expediente.numero,
    tipoNotificacion,
    actuacionesCreadas: creadas,
    decisiones,
  };
}

/* ── Fusionar (F.5) ──────────────────────────────────────────────────────── */

/** Exportada por el mismo motivo que `crearDesdeCorreo`. */
export async function fusionarEnExpediente(
  ctx: Contexto,
  c: repo.Ejecutor,
  cfg: ConfigTherefore,
  correo: CorreoEntrante,
  normalizado: CorreoNormalizado,
  notificacion: repo.Notificacion,
  candidato: ExpedienteCandidato
): Promise<ResultadoIngesta> {
  /*
   * FOR UPDATE, y no una lectura normal.
   *
   * Los contadores se leen aquí y se escriben más abajo
   * (`numeroNotificaciones + 1`). Dos correos del mismo expediente procesados a
   * la vez —que es exactamente lo que pasa cuando el buzón trae una tanda—
   * leerían los dos el mismo valor y el segundo pisaría al primero: un correo
   * recibido que no cuenta, y con él una reclamación que no sube la prioridad.
   */
  const expediente = await repo.obtenerExpedienteBloqueado(ctx.empresaId, candidato.id, c);
  if (!expediente) throw new ErrorTherefore("NO_ENCONTRADO", "No se encuentra.", 404);

  const plan = planDeFusion(normalizado, candidato);
  const tipoNotificacion = clasificarNotificacion(normalizado, {
    hayCambioInstruccion: plan.cambiosInstruccion.length > 0,
    notificacionesPrevias: expediente.numeroNotificaciones,
  });

  await repo.actualizarNotificacion(
    ctx.empresaId,
    notificacion.id,
    { expedienteId: expediente.id, tipoNotificacion, estadoProceso: "PROCESADA" },
    c
  );
  await repo.asignarAdjuntosAExpediente(ctx.empresaId, notificacion.id, expediente.id, c);

  const creadas = await crearActuaciones(
    ctx,
    c,
    { ...correo, acciones: accionesQueCorresponden(correo, plan.nuevas) },
    expediente.id,
    notificacion.id
  );

  const decisiones: { id: string; tipo: repo.TipoDecision }[] = [];
  for (const cambio of plan.cambiosInstruccion) {
    const decision = await repo.crearDecision(
      ctx.empresaId,
      {
        tipo: "CAMBIO_INSTRUCCION",
        notificacionId: notificacion.id,
        expedienteId: expediente.id,
        actuacionId: cambio.actuacionId,
        detalle: {
          albaran: cambio.albaran,
          accionAnterior: cambio.accionAnterior,
          accionNueva: cambio.accionNueva,
        },
      },
      c
    );
    if (decision) decisiones.push({ id: decision.id, tipo: decision.tipo });

    await repo.anotarEvento(
      ctx.empresaId,
      {
        expedienteId: expediente.id,
        actuacionId: cambio.actuacionId,
        notificacionId: notificacion.id,
        tipo: "CAMBIO_INSTRUCCION",
        actorTipo: "sistema",
        datosAnteriores: { accion: cambio.accionAnterior },
        datosNuevos: { accion: cambio.accionNueva },
        descripcion: `El correo pide ${cambio.accionNueva} sobre el albarán ${cambio.albaran}, que estaba como ${cambio.accionAnterior}. La actuación no se toca hasta que alguien decida.`,
      },
      c
    );
  }

  /*
   * Los contadores. `numero_notificaciones` siempre; el de reclamaciones sólo
   * cuando el correo lo es, porque de él sale la prioridad y un recordatorio
   * educado no es una reclamación.
   */
  const reclama = cuentaComoReclamacion(tipoNotificacion);
  const cambios: repo.CambiosExpediente = {
    numero_notificaciones: expediente.numeroNotificaciones + 1,
    fecha_ultima_notificacion: correo.fecha,
  };
  if (reclama) cambios.numero_reclamaciones = expediente.numeroReclamaciones + 1;
  // Las banderas sólo suben: un recordatorio que no repite la palabra
  // «urgente» no desactiva la urgencia que ya se había reconocido.
  if (correo.urgente && !expediente.urgente) cambios.urgente = true;
  if (correo.tareaVencida && !expediente.tareaVencida) cambios.tarea_vencida = true;

  /*
   * Un cambio de instrucción bloquea el expediente: hay dos versiones de lo que
   * hay que hacer y seguir trabajando con la vieja es trabajar para nada.
   * El expediente NO retrocede por recibir correo en ningún otro caso.
   */
  if (plan.cambiosInstruccion.length > 0 && expediente.estado !== "BLOQUEADO") {
    cambios.estado = "BLOQUEADO";
  }

  await repo.actualizarExpediente(ctx.empresaId, expediente.id, cambios, c);

  await repo.anotarEvento(
    ctx.empresaId,
    {
      expedienteId: expediente.id,
      notificacionId: notificacion.id,
      tipo: reclama ? "RECLAMACION_RECIBIDA" : "EMAIL_RECIBIDO",
      actorTipo: "sistema",
      datosNuevos: {
        tipoNotificacion,
        messageId: notificacion.messageId,
        actuacionesNuevas: creadas,
      },
      descripcion: `${etiqueta(tipoNotificacion)} «${correo.asunto ?? ""}»${
        creadas > 0 ? `, con ${creadas} actuación${creadas === 1 ? "" : "es"} nueva${creadas === 1 ? "" : "s"}` : ""
      }.`,
    },
    c
  );

  const revision = await pedirRevisionSiHaceFalta(
    ctx,
    c,
    correo,
    notificacion.id,
    expediente.id
  );

  await refrescarPrioridad(ctx, c, cfg, expediente.id);

  return {
    duplicado: false,
    notificacionId: notificacion.id,
    resultado: "FUSIONADO",
    expedienteId: expediente.id,
    expedienteNumero: expediente.numero,
    tipoNotificacion,
    actuacionesCreadas: creadas,
    decisiones: [...decisiones, ...revision],
  };
}

function etiqueta(t: TipoNotificacion): string {
  switch (t) {
    case "RECLAMACION":
      return "Reclamación:";
    case "TAREA_VENCIDA":
      return "Tarea vencida:";
    case "RECORDATORIO":
      return "Recordatorio:";
    case "CAMBIO_INSTRUCCION":
      return "Cambio de instrucción:";
    case "APROBACION":
      return "Aprobación:";
    default:
      return "Correo recibido:";
  }
}

/**
 * Las acciones originales que corresponden a las del plan.
 *
 * El plan trabaja con albaranes ya normalizados, y lo que hay que guardar es el
 * número TAL Y COMO lo escribió el correo. Sin esto se perdería «0501234» y en
 * la pantalla aparecería «501234», que no es lo que nadie escribió.
 */
function accionesQueCorresponden(
  correo: CorreoEntrante,
  nuevas: readonly { accion: TipoAccion; albaranNormalizado: string | null }[]
): AccionEntrante[] {
  const pendientes = [...nuevas];
  const salida: AccionEntrante[] = [];
  for (const a of accionesDe(correo)) {
    const clave = claveAlbaran(a.albaran ?? null);
    const i = pendientes.findIndex(
      (n) => n.accion === a.accion && n.albaranNormalizado === clave
    );
    if (i >= 0) {
      pendientes.splice(i, 1);
      salida.push(a);
    }
  }
  return salida;
}

async function crearActuaciones(
  ctx: Contexto,
  c: repo.Ejecutor,
  correo: CorreoEntrante,
  expedienteId: string,
  notificacionId: string
): Promise<number> {
  let creadas = 0;
  for (const a of accionesDe(correo)) {
    const actuacion = await repo.crearActuacion(
      ctx.empresaId,
      expedienteId,
      {
        tipoAccion: a.accion,
        albaranSolicitado: a.albaran ?? null,
        importeCentimos: a.importeCentimos ?? null,
        indicadorAdicional: a.indicador ?? null,
        confianza: a.confianza ?? 1,
        origenNotificacionId: notificacionId,
      },
      c
    );
    // `null` = ya estaba. No es un error: es una reclamación repitiendo lo de
    // siempre, que es justo lo que el índice único está ahí para absorber.
    if (!actuacion) continue;
    creadas++;
    await repo.anotarEvento(
      ctx.empresaId,
      {
        expedienteId,
        actuacionId: actuacion.id,
        notificacionId,
        tipo: "ACTUACION_ANADIDA",
        actorTipo: "sistema",
        datosNuevos: {
          tipoAccion: actuacion.tipoAccion,
          albaran: actuacion.albaranSolicitado,
          importeCentimos: actuacion.importeCentimos,
        },
        descripcion: `Actuación ${actuacion.tipoAccion}${
          actuacion.albaranSolicitado ? ` ${actuacion.albaranSolicitado}` : ""
        }, del correo.`,
      },
      c
    );
  }
  return creadas;
}

async function pedirRevisionSiHaceFalta(
  ctx: Contexto,
  c: repo.Ejecutor,
  correo: CorreoEntrante,
  notificacionId: string,
  expedienteId: string
): Promise<{ id: string; tipo: repo.TipoDecision }[]> {
  const motivo = motivoDeRevision(correo, UMBRAL_CONFIANZA);
  if (!motivo) return [];

  const decision = await repo.crearDecision(
    ctx.empresaId,
    {
      tipo: "REQUIERE_REVISION",
      notificacionId,
      expedienteId,
      detalle: {
        motivo,
        albaranesAmbiguos: correo.albaranesAmbiguos ?? [],
      },
    },
    c
  );

  await repo.actualizarExpediente(ctx.empresaId, expedienteId, { requiere_revision: true }, c);
  await repo.anotarEvento(
    ctx.empresaId,
    {
      expedienteId,
      notificacionId,
      tipo: "REVISION_SOLICITADA",
      actorTipo: "sistema",
      datosNuevos: { motivo, albaranesAmbiguos: correo.albaranesAmbiguos ?? [] },
      descripcion: motivo,
    },
    c
  );

  return decision ? [{ id: decision.id, tipo: decision.tipo }] : [];
}

async function refrescarPrioridad(
  ctx: Contexto,
  c: repo.Ejecutor,
  cfg: ConfigTherefore,
  expedienteId: string
): Promise<void> {
  const actual = await repo.obtenerExpediente(ctx.empresaId, expedienteId, c);
  if (!actual) return;
  const cambios = cambiosDePrioridad(actual, cfg);
  if (!cambios) return;

  await repo.actualizarExpediente(ctx.empresaId, expedienteId, cambios, c);
  await repo.anotarEvento(
    ctx.empresaId,
    {
      expedienteId,
      tipo: "PRIORIDAD_MODIFICADA",
      actorTipo: "sistema",
      datosAnteriores: { prioridad: actual.prioridad, score: actual.prioridadScore },
      datosNuevos: { prioridad: cambios.prioridad, score: cambios.prioridad_score },
      descripcion: `Prioridad ${cambios.prioridad} (${cambios.prioridad_score} puntos).`,
    },
    c
  );
}
