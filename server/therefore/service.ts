/**
 * Los casos de uso del módulo: lo que pasa cuando alguien hace algo.
 *
 * Aquí vive el pegamento entre las reglas (que son puras y están en `domain/`)
 * y la base (que está en `repository.ts`). El router no decide nada y el
 * repositorio no sabe de reglas; en medio está esto.
 *
 * ── Una regla que gobierna el fichero ───────────────────────────────────────
 *
 * **El cambio, su histórico y el recálculo de prioridad van en la misma
 * transacción.** Si se partieran, quedaría un expediente resuelto sin constancia
 * de quién lo resolvió, o una prioridad que no se corresponde con los hechos.
 * Por eso `anotarEvento` lanza en vez de tragarse el error: o consta entero o
 * no consta.
 *
 * ── Y una decisión que se nota al usarlo ────────────────────────────────────
 *
 * El expediente se mueve solo cuando sus actuaciones lo dicen: empezar la
 * primera lo pone EN_PROCESO y resolver la última lo pone RESUELTO. Nadie tiene
 * que acordarse de cambiar el estado a mano, que es como se acaba teniendo una
 * bandeja llena de cosas terminadas.
 */

import { leerConfig, type ConfigTherefore } from "./config.ts";
import { claveAlbaran } from "./domain/albaran.ts";
import {
  actuacionCerrada,
  esEstadoExpediente,
  exigeMotivo,
  expedienteResoluble,
  puedeTransicionar,
  puedeTransicionarActuacion,
  type EstadoActuacion,
  type EstadoExpediente,
  type Prioridad,
} from "./domain/estados.ts";
import { calcularPrioridad, diasAbierto } from "./domain/prioridad.ts";
import { ErrorTherefore } from "./errors.ts";
import * as repo from "./repository.ts";

/** Quién hace la operación. Sale de `req.authCtx`, nunca del cuerpo. */
export type Contexto = {
  empresaId: string;
  userId: string | null;
  userNombre?: string | null;
};

const actor = (ctx: Contexto) => ({
  actorTipo: "usuario" as const,
  usuarioId: ctx.userId,
  usuarioNombre: ctx.userNombre ?? null,
});

/* ── Prioridad ───────────────────────────────────────────────────────────── */

/**
 * Recalcula la prioridad de un expediente a partir de sus hechos.
 *
 * Devuelve las columnas que hay que escribir, o `null` si no cambia nada. Que
 * devuelva los cambios en vez de escribirlos deja al que llama decidir si los
 * mete en su transacción —que es lo normal— o los descarta.
 */
export function cambiosDePrioridad(
  e: repo.Expediente,
  cfg: ConfigTherefore,
  ahora: Date = new Date()
): { prioridad: Prioridad; prioridad_score: number } | null {
  const r = calcularPrioridad(
    {
      diasAbierto: diasAbierto(new Date(e.fechaPrimeraNotificacion), ahora),
      reclamaciones: e.numeroReclamaciones,
      urgente: e.urgente,
      tareaVencida: e.tareaVencida,
    },
    { pesos: cfg.pesos, umbrales: cfg.umbrales, manual: e.prioridadManual }
  );
  if (r.prioridad === e.prioridad && r.score === e.prioridadScore) return null;
  return { prioridad: r.prioridad, prioridad_score: r.score };
}

/* ── Expedientes ─────────────────────────────────────────────────────────── */

export type Ficha = {
  expediente: repo.Expediente;
  actuaciones: repo.Actuacion[];
  eventos: repo.Evento[];
};

export async function fichaDe(ctx: Contexto, id: string): Promise<Ficha> {
  const expediente = await repo.obtenerExpediente(ctx.empresaId, id);
  // 404 y no 403: «no existe» y «no es tuyo» contestan igual.
  if (!expediente) throw noEncontrado();
  const [actuaciones, eventos] = await Promise.all([
    repo.listarActuaciones(ctx.empresaId, id),
    repo.listarEventos(ctx.empresaId, id),
  ]);
  return { expediente, actuaciones, eventos };
}

function noEncontrado(): ErrorTherefore {
  return new ErrorTherefore("EXPEDIENTE_NO_ENCONTRADO", "Expediente no encontrado.", 404);
}

export async function crearExpediente(
  ctx: Contexto,
  datos: repo.DatosExpediente
): Promise<Ficha> {
  const cfg = await leerConfig(ctx.empresaId);

  const expediente = await repo.enTransaccion(async (c) => {
    const creado = await repo.crearExpediente(ctx.empresaId, ctx.userId, datos, c);

    // La prioridad se calcula al nacer: un expediente que llega ya urgente no
    // tiene por qué esperar al repaso diario para subir en la lista.
    const cambios = cambiosDePrioridad(creado, cfg);
    const conPrioridad = cambios
      ? await repo.actualizarExpediente(ctx.empresaId, creado.id, cambios, c)
      : creado;

    await repo.anotarEvento(
      ctx.empresaId,
      {
        expedienteId: creado.id,
        tipo: "EXPEDIENTE_CREADO",
        ...actor(ctx),
        datosNuevos: {
          numero: creado.numero,
          tipo: creado.tipo,
          facturaNumero: creado.facturaNumero,
          proveedorNombre: creado.proveedorNombre,
        },
        descripcion: `Expediente ${creado.numero} creado a mano.`,
      },
      c
    );
    return conPrioridad ?? creado;
  });

  return { expediente, actuaciones: [], eventos: await repo.listarEventos(ctx.empresaId, expediente.id) };
}

export type CambiosFicha = {
  asignadoUsuarioId?: string | null;
  prioridadManual?: Prioridad | null;
  observaciones?: string;
};

/** Asignar, fijar prioridad a mano y anotar observaciones. */
export async function editarExpediente(
  ctx: Contexto,
  id: string,
  cambios: CambiosFicha
): Promise<Ficha> {
  const cfg = await leerConfig(ctx.empresaId);

  await repo.enTransaccion(async (c) => {
    const antes = await repo.obtenerExpedienteBloqueado(ctx.empresaId, id, c);
    if (!antes) throw noEncontrado();

    const columnas: repo.CambiosExpediente = {};
    if (cambios.asignadoUsuarioId !== undefined) {
      columnas.asignado_usuario_id = cambios.asignadoUsuarioId;
    }
    if (cambios.prioridadManual !== undefined) columnas.prioridad_manual = cambios.prioridadManual;
    if (cambios.observaciones !== undefined) columnas.observaciones = cambios.observaciones;
    if (Object.keys(columnas).length === 0) return;

    const despues = (await repo.actualizarExpediente(ctx.empresaId, id, columnas, c))!;

    if (cambios.asignadoUsuarioId !== undefined && cambios.asignadoUsuarioId !== antes.asignadoUsuarioId) {
      await repo.anotarEvento(
        ctx.empresaId,
        {
          expedienteId: id,
          tipo: "USUARIO_ASIGNADO",
          ...actor(ctx),
          datosAnteriores: { asignadoUsuarioId: antes.asignadoUsuarioId },
          datosNuevos: { asignadoUsuarioId: cambios.asignadoUsuarioId },
          descripcion: cambios.asignadoUsuarioId ? "Expediente asignado." : "Expediente sin asignar.",
        },
        c
      );
    }

    if (cambios.prioridadManual !== undefined && cambios.prioridadManual !== antes.prioridadManual) {
      /*
       * Al fijar o quitar la prioridad manual hay que recalcular: quitarla tiene
       * que devolver el expediente a la que le toca por sus hechos, no dejarlo
       * con la que alguien puso hace un mes.
       */
      const recalculo = cambiosDePrioridad(despues, cfg);
      if (recalculo) await repo.actualizarExpediente(ctx.empresaId, id, recalculo, c);
      await repo.anotarEvento(
        ctx.empresaId,
        {
          expedienteId: id,
          tipo: "PRIORIDAD_MODIFICADA",
          ...actor(ctx),
          datosAnteriores: { prioridad: antes.prioridad, manual: antes.prioridadManual },
          datosNuevos: {
            prioridad: recalculo?.prioridad ?? despues.prioridad,
            manual: cambios.prioridadManual,
          },
          descripcion: cambios.prioridadManual
            ? `Prioridad fijada a mano en ${cambios.prioridadManual}.`
            : "Prioridad devuelta al cálculo automático.",
        },
        c
      );
    }

    if (cambios.observaciones !== undefined && cambios.observaciones !== antes.observaciones) {
      await repo.anotarEvento(
        ctx.empresaId,
        {
          expedienteId: id,
          tipo: "OBSERVACION_ANADIDA",
          ...actor(ctx),
          datosAnteriores: { observaciones: antes.observaciones },
          datosNuevos: { observaciones: cambios.observaciones },
          descripcion: "Observaciones actualizadas.",
        },
        c
      );
    }
  });

  return fichaDe(ctx, id);
}

/**
 * Cambio de estado a mano.
 *
 * No se puede dar por resuelto un expediente con trabajo obligatorio por hacer.
 * Es la única forma de que «RESUELTO» signifique algo: si se pudiera marcar con
 * dos actuaciones pendientes, la bandeja quedaría limpia y los albaranes sin
 * grabar. Quien de verdad no tenga que hacer una actuación, la descarta.
 */
export async function cambiarEstado(
  ctx: Contexto,
  id: string,
  nuevo: EstadoExpediente,
  motivo: string
): Promise<Ficha> {
  if (!esEstadoExpediente(nuevo)) {
    throw new ErrorTherefore("ESTADO_INVALIDO", `Estado desconocido: ${nuevo}.`, 400);
  }

  await repo.enTransaccion(async (c) => {
    const antes = await repo.obtenerExpedienteBloqueado(ctx.empresaId, id, c);
    if (!antes) throw noEncontrado();

    if (antes.estado === nuevo) return;

    if (!puedeTransicionar(antes.estado, nuevo)) {
      throw new ErrorTherefore(
        "TRANSICION_INVALIDA",
        `Un expediente en ${antes.estado} no puede pasar a ${nuevo}.`,
        409
      );
    }

    if (exigeMotivo(antes.estado, nuevo) && !motivo.trim()) {
      throw new ErrorTherefore(
        "MOTIVO_REQUERIDO",
        "Hay que decir por qué: quien se encuentre el expediente mañana necesita saberlo.",
        400
      );
    }

    const actuaciones = await repo.listarActuaciones(ctx.empresaId, id, c);
    if (nuevo === "RESUELTO" && actuaciones.length > 0 && !expedienteResoluble(actuaciones)) {
      const pendientes = actuaciones.filter((a) => a.obligatoria && !actuacionCerrada(a.estado));
      throw new ErrorTherefore(
        "ACTUACIONES_PENDIENTES",
        `Quedan ${pendientes.length} actuaciones por resolver. Resuélvelas o descártalas antes de dar el expediente por resuelto.`,
        409,
        { pendientes: pendientes.map((a) => a.id) }
      );
    }

    await repo.actualizarExpediente(ctx.empresaId, id, cambiosDeEstado(antes, nuevo, ctx, motivo), c);

    await repo.anotarEvento(
      ctx.empresaId,
      {
        expedienteId: id,
        tipo: tipoDeEvento(antes.estado, nuevo),
        ...actor(ctx),
        datosAnteriores: { estado: antes.estado },
        datosNuevos: { estado: nuevo, motivo: motivo || null },
        descripcion: descripcionDeEstado(antes.estado, nuevo, motivo),
      },
      c
    );
  });

  return fichaDe(ctx, id);
}

function cambiosDeEstado(
  antes: repo.Expediente,
  nuevo: EstadoExpediente,
  ctx: Contexto,
  motivo: string
): repo.CambiosExpediente {
  const anterior = antes.estado;
  const cambios: repo.CambiosExpediente = { estado: nuevo };
  const ahora = new Date().toISOString();

  if (nuevo === "EN_PROCESO") cambios.fecha_inicio_gestion = ahora;
  if (nuevo === "RESUELTO") {
    cambios.fecha_resolucion = ahora;
    cambios.resuelto_por_usuario_id = ctx.userId;
  }
  if (nuevo === "CERRADO") cambios.fecha_cierre = ahora;

  /*
   * Reabrir borra las marcas de resolución. Dejarlas puestas haría que un
   * expediente abierto siguiera diciendo que lo resolvió Fulano el día 14, y
   * eso es justo lo que alguien leería sin mirar el estado.
   */
  if ((anterior === "RESUELTO" || anterior === "CERRADO") && nuevo === "PENDIENTE") {
    cambios.fecha_resolucion = null;
    cambios.resuelto_por_usuario_id = null;
    cambios.fecha_cierre = null;
  }

  /*
   * El motivo se AÑADE a las observaciones, no las sustituye.
   *
   * Sustituirlas borraría en silencio lo que alguien hubiera apuntado sobre el
   * expediente —el teléfono del proveedor, lo que dijo por correo— justo en el
   * momento de bloquearlo, que es cuando más falta hace. El motivo queda
   * además en el histórico, que es el registro permanente; esto es para poder
   * leerlo de un vistazo en la ficha.
   */
  const razon = motivo.trim();
  if (razon) {
    const previas = antes.observaciones.trim();
    cambios.observaciones = previas ? `${previas}\n${razon}` : razon;
  }
  return cambios;
}

function tipoDeEvento(anterior: EstadoExpediente, nuevo: EstadoExpediente): string {
  if (nuevo === "RESUELTO") return "EXPEDIENTE_RESUELTO";
  if (nuevo === "CERRADO") return "EXPEDIENTE_CERRADO";
  if ((anterior === "RESUELTO" || anterior === "CERRADO") && nuevo === "PENDIENTE") {
    return "EXPEDIENTE_REABIERTO";
  }
  return "ESTADO_MODIFICADO";
}

function descripcionDeEstado(
  anterior: EstadoExpediente,
  nuevo: EstadoExpediente,
  motivo: string
): string {
  const cola = motivo.trim() ? ` Motivo: ${motivo.trim()}` : "";
  if (nuevo === "RESUELTO") return `Expediente resuelto.${cola}`;
  if (nuevo === "CERRADO") return `Expediente cerrado.${cola}`;
  if ((anterior === "RESUELTO" || anterior === "CERRADO") && nuevo === "PENDIENTE") {
    return `Expediente reabierto.${cola}`;
  }
  return `Estado: ${anterior} → ${nuevo}.${cola}`;
}

/* ── Actuaciones ─────────────────────────────────────────────────────────── */

/**
 * Añade una actuación al expediente.
 *
 * `nueva: false` significa que ya existía esa misma acción sobre ese mismo
 * albarán y no se ha duplicado. No es un error: es exactamente lo que tiene que
 * pasar cuando una reclamación repite los albaranes de siempre.
 */
export async function anadirActuacion(
  ctx: Contexto,
  expedienteId: string,
  datos: repo.DatosActuacion
): Promise<{ ficha: Ficha; actuacion: repo.Actuacion; nueva: boolean }> {
  const resultado = await repo.enTransaccion(async (c) => {
    const expediente = await repo.obtenerExpedienteBloqueado(ctx.empresaId, expedienteId, c);
    if (!expediente) throw noEncontrado();

    /*
     * A un expediente terminado no se le cuelga trabajo nuevo sin decirlo: eso
     * lo dejaría resuelto y con una actuación pendiente dentro, invisible en la
     * bandeja. Quien quiera añadirla, que lo reabra primero.
     */
    if (expediente.estado === "RESUELTO" || expediente.estado === "CERRADO") {
      throw new ErrorTherefore(
        "EXPEDIENTE_TERMINADO",
        `El expediente ${expediente.numero} está ${expediente.estado.toLowerCase()}. Reábrelo antes de añadirle actuaciones.`,
        409
      );
    }

    const creada = await repo.crearActuacion(ctx.empresaId, expedienteId, datos, c);
    if (!creada) return null;

    await repo.anotarEvento(
      ctx.empresaId,
      {
        expedienteId,
        actuacionId: creada.id,
        tipo: "ACTUACION_ANADIDA",
        ...actor(ctx),
        datosNuevos: {
          tipoAccion: creada.tipoAccion,
          albaran: creada.albaranSolicitado,
          importeCentimos: creada.importeCentimos,
        },
        descripcion: descripcionDeActuacion(creada),
      },
      c
    );
    return creada;
  });

  const ficha = await fichaDe(ctx, expedienteId);

  if (resultado) return { ficha, actuacion: resultado, nueva: true };

  // Ya existía: se devuelve la que hay, para que la pantalla la pueda señalar.
  const existente = ficha.actuaciones.find(
    (a) =>
      a.tipoAccion === datos.tipoAccion &&
      a.albaranNormalizado != null &&
      a.albaranNormalizado === claveAlbaran(datos.albaranSolicitado) &&
      a.estado !== "DESCARTADA"
  );
  if (!existente) {
    // No debería pasar: el índice sólo rechaza si hay una viva.
    throw new ErrorTherefore(
      "ACTUACION_NO_CREADA",
      "No se ha podido añadir la actuación.",
      500
    );
  }
  return { ficha, actuacion: existente, nueva: false };
}

function descripcionDeActuacion(a: repo.Actuacion): string {
  const albaran = a.albaranSolicitado ? ` ${a.albaranSolicitado}` : "";
  return `Actuación ${a.tipoAccion}${albaran}.`;
}

/**
 * Mueve una actuación y arrastra al expediente cuando toca.
 *
 * Es el único sitio donde el expediente cambia de estado sin que nadie lo pida:
 * empezar la primera actuación lo pone EN_PROCESO y resolver la última
 * obligatoria lo pone RESUELTO. Lo contrario —que haya que acordarse— es como
 * se acumulan expedientes terminados en la bandeja.
 */
export async function moverActuacion(
  ctx: Contexto,
  actuacionId: string,
  nuevo: EstadoActuacion,
  datos: { resultado?: string | null; erpReferencia?: string | null; motivo?: string } = {}
): Promise<Ficha> {
  const expedienteId = await repo.enTransaccion(async (c) => {
    const antes = await repo.obtenerActuacion(ctx.empresaId, actuacionId, c);
    if (!antes) {
      throw new ErrorTherefore("ACTUACION_NO_ENCONTRADA", "Actuación no encontrada.", 404);
    }
    const expediente = await repo.obtenerExpedienteBloqueado(ctx.empresaId, antes.expedienteId, c);
    if (!expediente) throw noEncontrado();

    if (antes.estado === nuevo) return antes.expedienteId;

    if (!puedeTransicionarActuacion(antes.estado, nuevo)) {
      throw new ErrorTherefore(
        "TRANSICION_INVALIDA",
        antes.estado === "DESCARTADA"
          ? "Una actuación descartada no vuelve: si hay que hacerla, se añade de nuevo."
          : `Una actuación en ${antes.estado} no puede pasar a ${nuevo}.`,
        409
      );
    }

    const motivo = (datos.motivo ?? "").trim();
    if ((nuevo === "BLOQUEADA" || nuevo === "DESCARTADA") && !motivo) {
      throw new ErrorTherefore(
        "MOTIVO_REQUERIDO",
        "Hay que decir por qué se bloquea o se descarta.",
        400
      );
    }

    const ahora = new Date().toISOString();
    const cambios: repo.CambiosActuacion = { estado: nuevo };
    if (datos.resultado !== undefined) cambios.resultado = datos.resultado;
    if (datos.erpReferencia !== undefined) cambios.erp_referencia = datos.erpReferencia;
    if (motivo) cambios.observaciones = motivo;

    if (nuevo === "EN_PROCESO" && !antes.iniciadaAt) {
      cambios.iniciada_at = ahora;
      cambios.iniciada_por_usuario_id = ctx.userId;
    }
    if (nuevo === "RESUELTA") {
      cambios.resuelta_at = ahora;
      cambios.resuelta_por_usuario_id = ctx.userId;
    }
    if (nuevo === "PENDIENTE") {
      cambios.resuelta_at = null;
      cambios.resuelta_por_usuario_id = null;
    }

    await repo.actualizarActuacion(ctx.empresaId, actuacionId, cambios, c);

    await repo.anotarEvento(
      ctx.empresaId,
      {
        expedienteId: antes.expedienteId,
        actuacionId,
        tipo: EVENTO_ACTUACION[nuevo],
        ...actor(ctx),
        datosAnteriores: { estado: antes.estado },
        datosNuevos: {
          estado: nuevo,
          resultado: datos.resultado ?? null,
          erpReferencia: datos.erpReferencia ?? null,
          motivo: motivo || null,
        },
        descripcion: `${antes.tipoAccion}${antes.albaranSolicitado ? ` ${antes.albaranSolicitado}` : ""}: ${
          TEXTO_ACTUACION[nuevo]
        }${motivo ? ` Motivo: ${motivo}` : ""}`,
      },
      c
    );

    await arrastrarExpediente(ctx, expediente, c);
    return antes.expedienteId;
  });

  return fichaDe(ctx, expedienteId);
}

const EVENTO_ACTUACION: Record<EstadoActuacion, string> = {
  PENDIENTE: "ACTUACION_REABIERTA",
  EN_PROCESO: "ACTUACION_INICIADA",
  BLOQUEADA: "ACTUACION_BLOQUEADA",
  RESUELTA: "ACTUACION_RESUELTA",
  DESCARTADA: "ACTUACION_DESCARTADA",
};

const TEXTO_ACTUACION: Record<EstadoActuacion, string> = {
  PENDIENTE: "vuelve a estar pendiente.",
  EN_PROCESO: "iniciada.",
  BLOQUEADA: "bloqueada.",
  RESUELTA: "resuelta.",
  DESCARTADA: "descartada.",
};

/** Lleva el expediente a donde digan sus actuaciones, si es que cambia. */
async function arrastrarExpediente(
  ctx: Contexto,
  expediente: repo.Expediente,
  c: repo.Ejecutor
): Promise<void> {
  const actuaciones = await repo.listarActuaciones(ctx.empresaId, expediente.id, c);
  const ahora = new Date().toISOString();

  if (expedienteResoluble(actuaciones)) {
    if (expediente.estado === "RESUELTO" || expediente.estado === "CERRADO") return;
    if (!puedeTransicionar(expediente.estado, "RESUELTO")) return;
    await repo.actualizarExpediente(
      ctx.empresaId,
      expediente.id,
      { estado: "RESUELTO", fecha_resolucion: ahora, resuelto_por_usuario_id: ctx.userId },
      c
    );
    await repo.anotarEvento(
      ctx.empresaId,
      {
        expedienteId: expediente.id,
        tipo: "EXPEDIENTE_RESUELTO",
        ...actor(ctx),
        datosAnteriores: { estado: expediente.estado },
        datosNuevos: { estado: "RESUELTO" },
        descripcion: "Resuelto: no quedan actuaciones obligatorias por hacer.",
      },
      c
    );
    return;
  }

  // Alguien ha empezado a trabajar: el expediente lo dice sin que haya que
  // cambiarlo a mano. No se toca un BLOQUEADO, que espera a otra cosa.
  const enProceso = actuaciones.some((a) => a.estado === "EN_PROCESO");
  if (enProceso && (expediente.estado === "NUEVO" || expediente.estado === "PENDIENTE")) {
    await repo.actualizarExpediente(
      ctx.empresaId,
      expediente.id,
      {
        estado: "EN_PROCESO",
        fecha_inicio_gestion: expediente.fechaInicioGestion ?? ahora,
      },
      c
    );
    await repo.anotarEvento(
      ctx.empresaId,
      {
        expedienteId: expediente.id,
        tipo: "ESTADO_MODIFICADO",
        ...actor(ctx),
        datosAnteriores: { estado: expediente.estado },
        datosNuevos: { estado: "EN_PROCESO" },
        descripcion: "En proceso: se ha empezado la primera actuación.",
      },
      c
    );
    return;
  }

  /*
   * Y al revés: un expediente que estaba RESUELTO y al que se le reabre una
   * actuación vuelve a la cola. Si no, quedaría trabajo pendiente escondido
   * dentro de algo que la bandeja da por terminado.
   */
  if (expediente.estado === "RESUELTO" && !expedienteResoluble(actuaciones)) {
    await repo.actualizarExpediente(
      ctx.empresaId,
      expediente.id,
      { estado: "PENDIENTE", fecha_resolucion: null, resuelto_por_usuario_id: null },
      c
    );
    await repo.anotarEvento(
      ctx.empresaId,
      {
        expedienteId: expediente.id,
        tipo: "EXPEDIENTE_REABIERTO",
        ...actor(ctx),
        datosAnteriores: { estado: "RESUELTO" },
        datosNuevos: { estado: "PENDIENTE" },
        descripcion: "Reabierto: vuelve a haber una actuación por hacer.",
      },
      c
    );
  }
}

/* ── Bandeja ─────────────────────────────────────────────────────────────── */

export type FilaBandeja = repo.Expediente & {
  actuaciones: repo.Actuacion[];
  diasAbierto: number;
};

export async function bandeja(
  ctx: Contexto,
  filtro: repo.FiltroExpedientes
): Promise<{ expedientes: FilaBandeja[]; total: number; contadores: Record<string, number> }> {
  const [{ expedientes, total }, contadores] = await Promise.all([
    repo.listarExpedientes(ctx.empresaId, filtro),
    repo.contarPestanas(ctx.empresaId),
  ]);

  const porExpediente = await repo.actuacionesDe(
    ctx.empresaId,
    expedientes.map((e) => e.id)
  );
  const ahora = new Date();

  return {
    expedientes: expedientes.map((e) => ({
      ...e,
      actuaciones: porExpediente.get(e.id) ?? [],
      // Se calcula al servir y no se guarda: cambia solo con el paso del tiempo
      // y guardarlo obligaría a reescribir cada fila todas las noches.
      diasAbierto: diasAbierto(new Date(e.fechaPrimeraNotificacion), ahora),
    })),
    total,
    contadores,
  };
}
