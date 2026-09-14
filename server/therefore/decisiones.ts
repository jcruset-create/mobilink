/**
 * Lo que pasa cuando una persona resuelve una de las dudas del sistema.
 *
 * La ingesta deja aquí todo lo que no se ha atrevido a decidir sola: un correo
 * que puede ser de dos expedientes, una reclamación sobre algo ya resuelto, un
 * cambio de instrucción sobre una actuación que quizá alguien tiene a medias.
 * Esto es la otra mitad: la que aplica lo que se decida.
 *
 * ── Por qué no hay «decidir por defecto» ────────────────────────────────────
 *
 * Sería fácil poner un plazo y que al tercer día el sistema eligiera la opción
 * más probable. No se hace, y no por prudencia abstracta: las dos alternativas
 * fallan en direcciones opuestas y las dos son caras. Fusionar mal esconde
 * trabajo dentro de un expediente que alguien ya dio por entendido; duplicar lo
 * hace aparecer dos veces y se graba dos veces. Un plazo no elige mejor que una
 * persona, sólo elige más tarde.
 *
 * ── Lo que se aplica es lo MISMO que habría hecho el motor ──────────────────
 *
 * Fusionar por decisión humana llama a la misma función que fusiona el motor, y
 * crear, a la misma que crea. No hay una versión abreviada para este camino: de
 * eso salen dos comportamientos que se parecen hasta que dejan de parecerse, y
 * el que menos se usa es el que nadie prueba.
 */

import { leerConfig } from "./config.ts";
import { estaAbierto, type EstadoExpediente } from "./domain/estados.ts";
import { ErrorTherefore } from "./errors.ts";
import {
  crearDesdeCorreo,
  entradaGuardada,
  fusionarEnExpediente,
  normalizarEntrada,
  type CorreoEntrante,
  type ResultadoIngesta,
} from "./ingesta.ts";
import * as repo from "./repository.ts";
import { type Contexto } from "./service.ts";

/* ── El vocabulario de las respuestas ────────────────────────────────────── */

export const RESPUESTAS: Record<repo.TipoDecision, readonly string[]> = {
  POSIBLE_DUPLICADO: ["FUSIONAR", "CREAR_NUEVO"],
  RECLAMACION_SOBRE_RESUELTO: ["REABRIR", "CONFIRMAR_RESUELTO", "CREAR_RELACIONADO"],
  CAMBIO_INSTRUCCION: ["ACEPTAR", "MANTENER", "BLOQUEAR"],
  REQUIERE_REVISION: ["REVISADO"],
  ERROR_PARSER: ["IGNORAR"],
};

export type Respuesta = {
  /** Una de `RESPUESTAS[tipo]`. */
  decision: string;
  /** Para FUSIONAR: en cuál. Tiene que ser uno de los candidatos guardados. */
  expedienteId?: string | null;
  motivo?: string | null;
};

export type ResultadoDecision = {
  decision: repo.Decision;
  expedienteId: string | null;
  expedienteNumero: string | null;
  ingesta: ResultadoIngesta | null;
};

const actor = (ctx: Contexto) => ({
  actorTipo: "usuario" as const,
  usuarioId: ctx.userId,
  usuarioNombre: ctx.userNombre ?? null,
});

function noEncontrada(): ErrorTherefore {
  return new ErrorTherefore("NO_ENCONTRADA", "No se encuentra la decisión.", 404);
}

/* ── El caso de uso ──────────────────────────────────────────────────────── */

export async function resolver(
  ctx: Contexto,
  decisionId: string,
  respuesta: Respuesta
): Promise<ResultadoDecision> {
  const cfg = await leerConfig(ctx.empresaId);

  return repo.enTransaccion(async (c) => {
    /*
     * FOR UPDATE antes de mirar nada. Dos personas en la pantalla de revisión a
     * la vez es lo normal, y sin el bloqueo las dos verían PENDIENTE y las dos
     * aplicarían su respuesta: el correo acabaría fusionado en un expediente y
     * creado en otro.
     */
    const decision = await repo.obtenerDecisionBloqueada(ctx.empresaId, decisionId, c);
    if (!decision) throw noEncontrada();
    if (decision.estado === "DECIDIDA") {
      throw new ErrorTherefore(
        "DECISION_YA_TOMADA",
        `Esta decisión ya se resolvió (${decision.decision}).`,
        409
      );
    }

    const admitidas = RESPUESTAS[decision.tipo] ?? [];
    if (!admitidas.includes(respuesta.decision)) {
      throw new ErrorTherefore(
        "DECISION_NO_VALIDA",
        `«${respuesta.decision}» no es una respuesta de ${decision.tipo}. Se admiten: ${admitidas.join(", ")}.`,
        400
      );
    }

    const aplicada = await aplicar(ctx, c, cfg, decision, respuesta);

    const cerrada = await repo.cerrarDecision(
      ctx.empresaId,
      decisionId,
      {
        decision: respuesta.decision,
        motivo: respuesta.motivo ?? null,
        usuarioId: ctx.userId,
        usuarioNombre: ctx.userNombre ?? null,
      },
      c
    );
    if (!cerrada) throw noEncontrada();

    await repo.anotarEvento(
      ctx.empresaId,
      {
        expedienteId: aplicada.expedienteId ?? decision.expedienteId,
        notificacionId: decision.notificacionId,
        actuacionId: decision.actuacionId,
        tipo: "DECISION_TOMADA",
        ...actor(ctx),
        datosAnteriores: { tipo: decision.tipo },
        datosNuevos: { decision: respuesta.decision, motivo: respuesta.motivo ?? null },
        descripcion: descripcion(decision.tipo, respuesta, aplicada.expedienteNumero),
      },
      c
    );

    // Si el expediente ya no tiene nada pendiente de mirar, se le quita la
    // marca: dejarla puesta haría que la pestaña «Revisar» no se vaciara nunca.
    if (aplicada.expedienteId) {
      await limpiarRevision(ctx, c, aplicada.expedienteId);
    }
    if (decision.expedienteId && decision.expedienteId !== aplicada.expedienteId) {
      await limpiarRevision(ctx, c, decision.expedienteId);
    }

    return { ...aplicada, decision: cerrada };
  });
}

type Aplicada = {
  expedienteId: string | null;
  expedienteNumero: string | null;
  ingesta: ResultadoIngesta | null;
};

async function aplicar(
  ctx: Contexto,
  c: repo.Ejecutor,
  cfg: Awaited<ReturnType<typeof leerConfig>>,
  decision: repo.Decision,
  respuesta: Respuesta
): Promise<Aplicada> {
  switch (decision.tipo) {
    case "POSIBLE_DUPLICADO":
      return respuesta.decision === "FUSIONAR"
        ? fusionarPorDecision(ctx, c, cfg, decision, respuesta)
        : crearPorDecision(ctx, c, cfg, decision);

    case "RECLAMACION_SOBRE_RESUELTO":
      return reclamacionSobreResuelto(ctx, c, cfg, decision, respuesta);

    case "CAMBIO_INSTRUCCION":
      return cambioDeInstruccion(ctx, c, decision, respuesta);

    default:
      // REQUIERE_REVISION y ERROR_PARSER no mueven nada por sí solas: el
      // trabajo lo hace la persona con las pantallas que ya hay, y esto sólo
      // deja constancia de que lo ha mirado.
      return {
        expedienteId: decision.expedienteId,
        expedienteNumero: null,
        ingesta: null,
      };
  }
}

/* ── Posible duplicado ───────────────────────────────────────────────────── */

async function correoDe(
  ctx: Contexto,
  c: repo.Ejecutor,
  decision: repo.Decision
): Promise<{ notificacion: repo.Notificacion; correo: CorreoEntrante }> {
  if (!decision.notificacionId) {
    throw new ErrorTherefore(
      "SIN_CORREO",
      "Esta decisión no tiene un correo detrás, así que no hay nada que colocar.",
      409
    );
  }
  const notificacion = await repo.obtenerNotificacion(ctx.empresaId, decision.notificacionId, c);
  if (!notificacion) throw noEncontrada();

  const correo = entradaGuardada(notificacion);
  if (!correo) {
    /*
     * Sin la entrada guardada no se puede aplicar nada, y NO se reconstruye del
     * texto: eso sería inventarse los campos que el correo original traía. Se
     * dice, y quien lo lea sabrá que hay que reprocesar el correo.
     */
    throw new ErrorTherefore(
      "SIN_DATOS_DEL_CORREO",
      "No se guardó la lectura de este correo, así que no se puede volver a aplicar. Reprocésalo.",
      409
    );
  }
  return { notificacion, correo };
}

async function fusionarPorDecision(
  ctx: Contexto,
  c: repo.Ejecutor,
  cfg: Awaited<ReturnType<typeof leerConfig>>,
  decision: repo.Decision,
  respuesta: Respuesta
): Promise<Aplicada> {
  const destino = respuesta.expedienteId;
  if (!destino) {
    throw new ErrorTherefore(
      "EXPEDIENTE_REQUERIDO",
      "Para fusionar hay que decir en qué expediente.",
      400
    );
  }

  /*
   * Sólo se admite uno de los candidatos que se le enseñaron a la persona.
   *
   * No es desconfianza: es que los candidatos se guardaron con la puntuación
   * que tenían, y ésa es la razón por la que se decidió. Admitir cualquier
   * expediente convertiría la pantalla de revisión en un «mueve esto donde
   * quieras» sin rastro de por qué.
   */
  const ofrecidos = decision.candidatos.map((x) => x.id);
  if (!ofrecidos.includes(destino)) {
    throw new ErrorTherefore(
      "EXPEDIENTE_NO_CANDIDATO",
      "Ese expediente no era uno de los candidatos de esta decisión.",
      400
    );
  }

  const { notificacion, correo } = await correoDe(ctx, c, decision);
  const candidato = await repo.candidatoPorId(ctx.empresaId, destino, c);
  if (!candidato) throw noEncontrada();

  const ingesta = await fusionarEnExpediente(
    ctx,
    c,
    cfg,
    correo,
    normalizarEntrada(correo),
    notificacion,
    candidato
  );
  return {
    expedienteId: ingesta.expedienteId,
    expedienteNumero: ingesta.expedienteNumero,
    ingesta,
  };
}

async function crearPorDecision(
  ctx: Contexto,
  c: repo.Ejecutor,
  cfg: Awaited<ReturnType<typeof leerConfig>>,
  decision: repo.Decision
): Promise<Aplicada> {
  const { notificacion, correo } = await correoDe(ctx, c, decision);
  const ingesta = await crearDesdeCorreo(ctx, c, cfg, correo, normalizarEntrada(correo), notificacion);
  return {
    expedienteId: ingesta.expedienteId,
    expedienteNumero: ingesta.expedienteNumero,
    ingesta,
  };
}

/* ── Reclamación sobre un expediente ya resuelto ─────────────────────────── */

async function reclamacionSobreResuelto(
  ctx: Contexto,
  c: repo.Ejecutor,
  cfg: Awaited<ReturnType<typeof leerConfig>>,
  decision: repo.Decision,
  respuesta: Respuesta
): Promise<Aplicada> {
  const { notificacion, correo } = await correoDe(ctx, c, decision);

  if (respuesta.decision === "CREAR_RELACIONADO") {
    const ingesta = await crearDesdeCorreo(ctx, c, cfg, correo, normalizarEntrada(correo), notificacion);
    // El cruce va en los DOS: desde el viejo se ve que hubo un rebrote, y desde
    // el nuevo, de dónde viene. Anotarlo sólo en uno deja la mitad del rastro.
    if (decision.expedienteId && ingesta.expedienteId) {
      await repo.anotarEvento(
        ctx.empresaId,
        {
          expedienteId: decision.expedienteId,
          notificacionId: notificacion.id,
          tipo: "EXPEDIENTE_RELACIONADO",
          ...actor(ctx),
          datosNuevos: { expedienteId: ingesta.expedienteId, numero: ingesta.expedienteNumero },
          descripcion: `La reclamación se ha abierto aparte, como ${ingesta.expedienteNumero}.`,
        },
        c
      );
      await repo.anotarEvento(
        ctx.empresaId,
        {
          expedienteId: ingesta.expedienteId,
          tipo: "EXPEDIENTE_RELACIONADO",
          ...actor(ctx),
          datosNuevos: { expedienteId: decision.expedienteId },
          descripcion: "Viene de una reclamación sobre un expediente ya resuelto.",
        },
        c
      );
    }
    return {
      expedienteId: ingesta.expedienteId,
      expedienteNumero: ingesta.expedienteNumero,
      ingesta,
    };
  }

  if (!decision.expedienteId) throw noEncontrada();
  const expediente = await repo.obtenerExpediente(ctx.empresaId, decision.expedienteId, c);
  if (!expediente) throw noEncontrada();

  if (respuesta.decision === "REABRIR") {
    if (!estaAbierto(expediente.estado)) {
      await repo.actualizarExpediente(
        ctx.empresaId,
        expediente.id,
        {
          estado: "PENDIENTE",
          fecha_resolucion: null,
          resuelto_por_usuario_id: null,
          fecha_cierre: null,
        },
        c
      );
      await repo.anotarEvento(
        ctx.empresaId,
        {
          expedienteId: expediente.id,
          notificacionId: notificacion.id,
          tipo: "EXPEDIENTE_REABIERTO",
          ...actor(ctx),
          datosAnteriores: { estado: expediente.estado },
          datosNuevos: { estado: "PENDIENTE" },
          descripcion: `Reabierto por una reclamación${respuesta.motivo ? `: ${respuesta.motivo}` : "."}`,
        },
        c
      );
    }
  }

  /*
   * Y en los dos casos —reabierto o confirmado resuelto— el correo se enlaza.
   *
   * Confirmar que está resuelto no significa que el correo no haya llegado:
   * llegó, cuenta como reclamación y sube el contador. Dejarlo fuera haría que
   * un expediente reclamado tres veces pareciera tranquilo.
   */
  const candidato = await repo.candidatoPorId(ctx.empresaId, expediente.id, c);
  if (!candidato) throw noEncontrada();
  const ingesta = await fusionarEnExpediente(
    ctx,
    c,
    cfg,
    { ...correo, reclamacion: true },
    { ...normalizarEntrada(correo), reclamacion: true },
    notificacion,
    candidato
  );

  return {
    expedienteId: ingesta.expedienteId,
    expedienteNumero: ingesta.expedienteNumero,
    ingesta,
  };
}

/* ── Cambio de instrucción ───────────────────────────────────────────────── */

async function cambioDeInstruccion(
  ctx: Contexto,
  c: repo.Ejecutor,
  decision: repo.Decision,
  respuesta: Respuesta
): Promise<Aplicada> {
  if (!decision.expedienteId || !decision.actuacionId) throw noEncontrada();
  const expediente = await repo.obtenerExpediente(ctx.empresaId, decision.expedienteId, c);
  if (!expediente) throw noEncontrada();

  const detalle = (decision.detalle ?? {}) as {
    albaran?: string;
    accionAnterior?: string;
    accionNueva?: string;
  };

  if (respuesta.decision === "BLOQUEAR") {
    if (!respuesta.motivo?.trim()) {
      throw new ErrorTherefore(
        "MOTIVO_REQUERIDO",
        "Dejar el expediente bloqueado exige decir a qué se está esperando.",
        400
      );
    }
    // Se queda como está, bloqueado. La decisión se cierra porque ya se ha
    // respondido; lo que sigue abierto es el expediente, que es lo correcto.
    return { expedienteId: expediente.id, expedienteNumero: expediente.numero, ingesta: null };
  }

  if (respuesta.decision === "ACEPTAR") {
    const anterior = await repo.obtenerActuacion(ctx.empresaId, decision.actuacionId, c);
    if (!anterior) throw noEncontrada();

    /*
     * El orden importa: primero se descarta la vieja y DESPUÉS se crea la
     * nueva. Al revés, el índice único de (expediente, acción, albarán) vería
     * dos vivas sobre el mismo albarán y rechazaría la nueva.
     */
    await repo.actualizarActuacion(
      ctx.empresaId,
      anterior.id,
      { estado: "DESCARTADA", resultado: "Sustituida por un cambio de instrucción." },
      c
    );
    await repo.anotarEvento(
      ctx.empresaId,
      {
        expedienteId: expediente.id,
        actuacionId: anterior.id,
        tipo: "ACTUACION_DESCARTADA",
        ...actor(ctx),
        datosAnteriores: { estado: anterior.estado, tipoAccion: anterior.tipoAccion },
        datosNuevos: { estado: "DESCARTADA" },
        descripcion: `${anterior.tipoAccion} ${anterior.albaranSolicitado ?? ""} se descarta: el correo pidió ${detalle.accionNueva}.`,
      },
      c
    );

    const nueva = await repo.crearActuacion(
      ctx.empresaId,
      expediente.id,
      {
        tipoAccion: (detalle.accionNueva ?? "OTRO") as never,
        albaranSolicitado: anterior.albaranSolicitado,
        importeCentimos: anterior.importeCentimos,
        indicadorAdicional: anterior.indicadorAdicional,
        origenNotificacionId: decision.notificacionId,
      },
      c
    );
    if (nueva) {
      await repo.anotarEvento(
        ctx.empresaId,
        {
          expedienteId: expediente.id,
          actuacionId: nueva.id,
          notificacionId: decision.notificacionId,
          tipo: "ACTUACION_ANADIDA",
          ...actor(ctx),
          datosNuevos: { tipoAccion: nueva.tipoAccion, albaran: nueva.albaranSolicitado },
          descripcion: `Actuación ${nueva.tipoAccion}${nueva.albaranSolicitado ? ` ${nueva.albaranSolicitado}` : ""}, del cambio de instrucción.`,
        },
        c
      );
    }
  }

  // ACEPTAR y MANTENER desbloquean: la duda que bloqueaba está resuelta.
  await desbloquearSiProcede(ctx, c, expediente.id, expediente.estado, decision.id);

  return { expedienteId: expediente.id, expedienteNumero: expediente.numero, ingesta: null };
}

/**
 * Devuelve el expediente a la cola si ya no le queda ningún cambio de
 * instrucción sin decidir.
 *
 * La comprobación es necesaria porque un correo puede cambiar la instrucción de
 * tres albaranes: desbloquear al resolver el primero dejaría al equipo
 * trabajando con dos versiones todavía en disputa.
 */
async function desbloquearSiProcede(
  ctx: Contexto,
  c: repo.Ejecutor,
  expedienteId: string,
  estado: EstadoExpediente,
  decisionQueSeCierra: string
): Promise<void> {
  if (estado !== "BLOQUEADO") return;

  const pendientes = await repo.listarDecisiones(
    ctx.empresaId,
    { estado: "PENDIENTE", expedienteId },
    c
  );
  const quedan = pendientes.filter(
    (d) => d.tipo === "CAMBIO_INSTRUCCION" && d.id !== decisionQueSeCierra
  );
  if (quedan.length > 0) return;

  await repo.actualizarExpediente(ctx.empresaId, expedienteId, { estado: "PENDIENTE" }, c);
  await repo.anotarEvento(
    ctx.empresaId,
    {
      expedienteId,
      tipo: "ESTADO_MODIFICADO",
      ...actor(ctx),
      datosAnteriores: { estado: "BLOQUEADO" },
      datosNuevos: { estado: "PENDIENTE" },
      descripcion: "Desbloqueado: ya no quedan cambios de instrucción por decidir.",
    },
    c
  );
}

async function limpiarRevision(
  ctx: Contexto,
  c: repo.Ejecutor,
  expedienteId: string
): Promise<void> {
  const pendientes = await repo.listarDecisiones(
    ctx.empresaId,
    { estado: "PENDIENTE", expedienteId },
    c
  );
  if (pendientes.length > 0) return;
  await repo.actualizarExpediente(ctx.empresaId, expedienteId, { requiere_revision: false }, c);
}

/* ── Auxiliares ──────────────────────────────────────────────────────────── */

function descripcion(
  tipo: repo.TipoDecision,
  respuesta: Respuesta,
  numero: string | null
): string {
  const cola = respuesta.motivo ? ` ${respuesta.motivo}` : "";
  switch (tipo) {
    case "POSIBLE_DUPLICADO":
      return respuesta.decision === "FUSIONAR"
        ? `Se decide que es el mismo asunto que ${numero ?? "otro expediente"}.${cola}`
        : `Se decide que es un asunto nuevo: ${numero ?? ""}.${cola}`;
    case "RECLAMACION_SOBRE_RESUELTO":
      if (respuesta.decision === "REABRIR") return `Se reabre por la reclamación.${cola}`;
      if (respuesta.decision === "CREAR_RELACIONADO")
        return `Se abre ${numero ?? "un expediente"} aparte.${cola}`;
      return `Se confirma que está resuelto.${cola}`;
    case "CAMBIO_INSTRUCCION":
      if (respuesta.decision === "ACEPTAR") return `Se acepta la nueva instrucción.${cola}`;
      if (respuesta.decision === "MANTENER") return `Se mantiene la instrucción anterior.${cola}`;
      return `Se deja bloqueado.${cola}`;
    default:
      return `Revisado.${cola}`;
  }
}
