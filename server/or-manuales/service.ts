/**
 * Los casos de uso de OR Manuales: crear un bloc, entregarlo, recogerlo,
 * archivar una hoja, recontar y cerrar.
 *
 * Aquí se orquesta; las reglas puras están en `domain/` y las consultas en
 * `repository.ts`. La empresa llega SIEMPRE en el contexto, que el router saca
 * de la sesión: nunca del cuerpo de la petición.
 *
 * ── Qué va dentro de una transacción y por qué ──────────────────────────────
 *
 * Tres cosas no pueden quedar a medias:
 *
 *   · **Crear el bloc y sus 25 OR.** Un bloc sin sus OR es un bloc del que no
 *     se puede decir qué falta, que es justo para lo que existe el módulo.
 *   · **Archivar un documento.** Colgar la hoja de la OR, marcar la OR como
 *     escaneada y apuntar el evento son un solo hecho: si se guardara el
 *     documento y fallara el estado, la OR seguiría contando como pendiente
 *     con su papel ya dentro.
 *   · **Cerrar un bloc.** Se comprueba y se cierra con la fila bloqueada, para
 *     que dos cierres simultáneos no den los dos por bueno el mismo recuento.
 */

import { ErrorOrManuales } from "./errors.ts";
import * as repo from "./repository.ts";
import {
  comprobarBorrado,
  comprobarCierre,
  estadoCalculado,
  progresoDeBloc,
  rangosSolapan,
  siguienteNumeroBloc,
  validarNumeroBloc,
  validarRango,
  type Progreso,
} from "./domain/blocs.ts";
import type { EstadoBloc, MetodoDeteccion } from "./domain/estados.ts";
import { leerConfiguracion } from "./config.ts";

export type Contexto = {
  empresaId: string;
  userId: string;
  userNombre: string;
  ip?: string;
};

const hoy = () => new Date().toISOString().slice(0, 10);

/* ── Blocs ───────────────────────────────────────────────────────────────── */

export type FichaBloc = {
  bloc: repo.Bloc;
  ors: repo.Or[];
  progreso: Progreso;
  entregas: repo.Entrega[];
  eventos: repo.Evento[];
};

/**
 * Lo que propone la pantalla de «Nuevo bloc» al abrirse: el número que sigue
 * al último y la OR siguiente a la última dada de alta.
 *
 * Es una propuesta, no una imposición: los blocs de papel no siempre llegan
 * en orden y quien los da de alta tiene el taco delante.
 */
export async function proponerBloc(ctx: Contexto): Promise<{
  numeroBloc: string;
  orInicial: number | null;
  orFinal: number | null;
  cantidadOr: number;
}> {
  const [ultimoNumero, ultimaFinal, config] = await Promise.all([
    repo.ultimoNumeroBloc(ctx.empresaId),
    repo.ultimaOrFinal(ctx.empresaId),
    leerConfiguracion(ctx.empresaId),
  ]);
  const orInicial = ultimaFinal === null ? null : ultimaFinal + 1;
  return {
    numeroBloc: siguienteNumeroBloc(ultimoNumero),
    orInicial,
    orFinal: orInicial === null ? null : orInicial + config.orPorBloc - 1,
    cantidadOr: config.orPorBloc,
  };
}

export async function crearBloc(
  ctx: Contexto,
  datos: {
    numeroBloc?: unknown;
    orInicial: unknown;
    orFinal?: unknown;
    cantidadOr?: unknown;
    responsableId?: unknown;
    responsableNombre?: unknown;
    observaciones?: unknown;
  }
): Promise<FichaBloc> {
  const config = await leerConfiguracion(ctx.empresaId);
  const rango = validarRango({
    orInicial: datos.orInicial,
    orFinal: datos.orFinal,
    cantidadOr: datos.cantidadOr ?? config.orPorBloc,
  });

  const numeroBloc = texto(datos.numeroBloc) || siguienteNumeroBloc(await repo.ultimoNumeroBloc(ctx.empresaId));

  return repo.enTransaccion(async (cliente) => {
    /*
     * La comprobación de solape se hace aquí para poder decir CON QUÉ bloc
     * choca —«el 1043 ya está en el bloc 002»—, que es lo que necesita quien
     * está dando de alta el taco. Pero la garantía de verdad es el UNIQUE de
     * (empresa_id, numero_or): dos altas simultáneas pasarían las dos
     * comprobaciones y sólo el índice puede pararlas.
     */
    const solapan = (await repo.blocsQueSolapan(ctx.empresaId, rango.orInicial, rango.orFinal, cliente)).filter((b) =>
      rangosSolapan({ orInicial: b.orInicial, orFinal: b.orFinal, cantidadOr: b.cantidadOr }, rango)
    );
    if (solapan.length > 0) {
      const b = solapan[0];
      throw new ErrorOrManuales(
        "RANGO_OCUPADO",
        `El rango ${rango.orInicial}-${rango.orFinal} se pisa con el bloc ${b.numeroBloc} (${b.orInicial}-${b.orFinal}).`,
        409,
        { blocs: solapan.map((x) => ({ id: x.id, numeroBloc: x.numeroBloc, orInicial: x.orInicial, orFinal: x.orFinal })) }
      );
    }

    let bloc: repo.Bloc;
    try {
      bloc = await repo.insertarBloc(
        {
          empresaId: ctx.empresaId,
          numeroBloc,
          orInicial: rango.orInicial,
          orFinal: rango.orFinal,
          cantidadOr: rango.cantidadOr,
          responsableId: texto(datos.responsableId) || null,
          responsableNombre: texto(datos.responsableNombre) || null,
          observaciones: texto(datos.observaciones) || null,
          createdBy: ctx.userId,
        },
        cliente
      );
    } catch (e) {
      if (esUnico(e, "orm_blocs_empresa_id_numero_bloc_key")) {
        throw new ErrorOrManuales("BLOC_DUPLICADO", `Ya existe un bloc con el número ${numeroBloc}.`, 409);
      }
      throw e;
    }

    try {
      await repo.generarOrs(ctx.empresaId, bloc.id, rango.orInicial, rango.orFinal, cliente);
    } catch (e) {
      if (esUnico(e, "orm_or_empresa_id_numero_or_key")) {
        throw new ErrorOrManuales(
          "RANGO_OCUPADO",
          `Alguna OR del rango ${rango.orInicial}-${rango.orFinal} ya pertenece a otro bloc.`,
          409
        );
      }
      throw e;
    }

    await repo.registrarEvento(
      {
        empresaId: ctx.empresaId,
        blocId: bloc.id,
        accion: "BLOC_CREADO",
        detalle: { numeroBloc, orInicial: rango.orInicial, orFinal: rango.orFinal, cantidadOr: rango.cantidadOr },
        usuarioId: ctx.userId,
        usuarioNombre: ctx.userNombre,
      },
      cliente
    );

    const ors = await repo.listarOrsDeBloc(ctx.empresaId, bloc.id, cliente);
    return { bloc, ors, progreso: progresoDeBloc(ors), entregas: [], eventos: [] };
  });
}

export async function fichaBloc(ctx: Contexto, blocId: string): Promise<FichaBloc> {
  const bloc = await repo.blocPorId(ctx.empresaId, blocId);
  if (!bloc) throw new ErrorOrManuales("BLOC_NO_ENCONTRADO", "Bloc no encontrado.", 404);
  const [ors, entregas, eventos] = await Promise.all([
    repo.listarOrsDeBloc(ctx.empresaId, blocId),
    repo.listarEntregas(ctx.empresaId, blocId),
    repo.listarEventos(ctx.empresaId, { blocId, limite: 100 }),
  ]);
  return { bloc, ors, progreso: progresoDeBloc(ors), entregas, eventos };
}

/**
 * Editar el bloc: su responsable, sus observaciones y su NÚMERO.
 *
 * El número se puede cambiar porque los blocs se renumeran: se da de alta uno
 * de prueba, se borra, y el siguiente tiene que poder llamarse «001». Lo que
 * NO se toca nunca es el rango de OR: cambiarlo dejaría huérfanas las hojas ya
 * archivadas y rompería la regla de que una OR pertenece a un solo bloc. Un
 * rango mal puesto se arregla borrando el bloc y creándolo bien.
 */
export async function editarBloc(
  ctx: Contexto,
  blocId: string,
  datos: { numeroBloc?: unknown; responsableId?: unknown; responsableNombre?: unknown; observaciones?: unknown }
): Promise<FichaBloc> {
  const bloc = await repo.blocPorId(ctx.empresaId, blocId);
  if (!bloc) throw new ErrorOrManuales("BLOC_NO_ENCONTRADO", "Bloc no encontrado.", 404);
  if (bloc.estado === "CERRADO") {
    throw new ErrorOrManuales("BLOC_CERRADO", "Un bloc cerrado no se edita.", 409);
  }

  const cambios: Parameters<typeof repo.actualizarBloc>[2] = {};
  if (datos.numeroBloc !== undefined) cambios.numeroBloc = validarNumeroBloc(datos.numeroBloc);
  if (datos.responsableId !== undefined) cambios.responsableId = texto(datos.responsableId) || null;
  if (datos.responsableNombre !== undefined) cambios.responsableNombre = texto(datos.responsableNombre) || null;
  if (datos.observaciones !== undefined) cambios.observaciones = texto(datos.observaciones) || null;

  try {
    await repo.actualizarBloc(ctx.empresaId, blocId, cambios);
  } catch (e) {
    if (esUnico(e, "orm_blocs_empresa_id_numero_bloc_key")) {
      throw new ErrorOrManuales("BLOC_DUPLICADO", `Ya existe un bloc con el número ${cambios.numeroBloc}.`, 409);
    }
    throw e;
  }
  await repo.registrarEvento({
    empresaId: ctx.empresaId,
    blocId,
    accion: "BLOC_EDITADO",
    detalle: cambios,
    usuarioId: ctx.userId,
    usuarioNombre: ctx.userNombre,
  });
  return fichaBloc(ctx, blocId);
}

/* ── Custodia ────────────────────────────────────────────────────────────── */

export async function entregarBloc(
  ctx: Contexto,
  blocId: string,
  datos: { responsableId?: unknown; responsableNombre?: unknown; fechaEntrega?: unknown; observaciones?: unknown }
): Promise<FichaBloc> {
  const responsableNombre = texto(datos.responsableNombre);
  if (!responsableNombre) {
    throw new ErrorOrManuales("RESPONSABLE_REQUERIDO", "Hay que decir a quién se le entrega el bloc.");
  }
  const fechaEntrega = fecha(datos.fechaEntrega) ?? hoy();

  await repo.enTransaccion(async (cliente) => {
    const bloc = await repo.blocParaActualizar(ctx.empresaId, blocId, cliente);
    if (!bloc) throw new ErrorOrManuales("BLOC_NO_ENCONTRADO", "Bloc no encontrado.", 404);
    if (bloc.estado === "CERRADO") {
      throw new ErrorOrManuales("BLOC_CERRADO", "Este bloc está cerrado: no se puede entregar.", 409);
    }
    if (bloc.estado === "ENTREGADO") {
      throw new ErrorOrManuales(
        "BLOC_YA_ENTREGADO",
        `El bloc ${bloc.numeroBloc} ya lo tiene ${bloc.responsableNombre ?? "otra persona"}. Registra la devolución antes de volver a entregarlo.`,
        409
      );
    }

    await repo.insertarEntrega(
      {
        empresaId: ctx.empresaId,
        blocId,
        responsableId: texto(datos.responsableId) || null,
        responsableNombre,
        fechaEntrega,
        observaciones: texto(datos.observaciones) || null,
        usuarioRegistro: ctx.userId,
        usuarioRegistroNombre: ctx.userNombre,
      },
      cliente
    );

    await repo.actualizarBloc(
      ctx.empresaId,
      blocId,
      {
        estado: "ENTREGADO",
        responsableId: texto(datos.responsableId) || null,
        responsableNombre,
        fechaEntrega,
        fechaDevolucion: null,
      },
      cliente
    );

    await repo.registrarEvento(
      {
        empresaId: ctx.empresaId,
        blocId,
        accion: "BLOC_ENTREGADO",
        detalle: { responsableNombre, fechaEntrega, observaciones: texto(datos.observaciones) || null },
        usuarioId: ctx.userId,
        usuarioNombre: ctx.userNombre,
      },
      cliente
    );
  });

  return fichaBloc(ctx, blocId);
}

export async function devolverBloc(
  ctx: Contexto,
  blocId: string,
  datos: { fechaDevolucion?: unknown; observaciones?: unknown }
): Promise<FichaBloc> {
  const fechaDevolucion = fecha(datos.fechaDevolucion) ?? hoy();

  await repo.enTransaccion(async (cliente) => {
    const bloc = await repo.blocParaActualizar(ctx.empresaId, blocId, cliente);
    if (!bloc) throw new ErrorOrManuales("BLOC_NO_ENCONTRADO", "Bloc no encontrado.", 404);
    if (bloc.estado === "CERRADO") {
      throw new ErrorOrManuales("BLOC_CERRADO", "Este bloc está cerrado.", 409);
    }

    const entrega = await repo.entregaAbierta(ctx.empresaId, blocId, cliente);
    if (!entrega) {
      throw new ErrorOrManuales("SIN_ENTREGA_ABIERTA", "Este bloc no está entregado a nadie.", 409);
    }
    // Las dos son `AAAA-MM-DD` (ver la cabecera de las proyecciones en
    // `repository.ts`), así que compararlas como texto es comparar fechas.
    if (fechaDevolucion < entrega.fechaEntrega) {
      throw new ErrorOrManuales(
        "FECHA_INVALIDA",
        `No se puede devolver el ${fechaDevolucion} un bloc que se entregó el ${entrega.fechaEntrega}.`
      );
    }

    await repo.cerrarEntrega(ctx.empresaId, entrega.id, fechaDevolucion, texto(datos.observaciones) || null, cliente);
    await repo.actualizarBloc(ctx.empresaId, blocId, { estado: "DEVUELTO", fechaDevolucion }, cliente);
    await repo.registrarEvento(
      {
        empresaId: ctx.empresaId,
        blocId,
        accion: "BLOC_DEVUELTO",
        detalle: { fechaDevolucion, observaciones: texto(datos.observaciones) || null },
        usuarioId: ctx.userId,
        usuarioNombre: ctx.userNombre,
      },
      cliente
    );
  });

  /*
   * El estado definitivo lo pone el recálculo: un bloc devuelto sin nada
   * escaneado queda PENDIENTE_ESCANEO, uno a medias INCOMPLETO y uno completo
   * se queda COMPLETO. Decidirlo aquí a mano sería tener la regla en dos
   * sitios, y el recálculo también corre después de cada documento archivado.
   */
  await recalcularBloc(ctx, blocId);
  return fichaBloc(ctx, blocId);
}

export async function cerrarBloc(ctx: Contexto, blocId: string, datos: { observaciones?: unknown }): Promise<FichaBloc> {
  await repo.enTransaccion(async (cliente) => {
    const bloc = await repo.blocParaActualizar(ctx.empresaId, blocId, cliente);
    if (!bloc) throw new ErrorOrManuales("BLOC_NO_ENCONTRADO", "Bloc no encontrado.", 404);

    const ors = await repo.listarOrsDeBloc(ctx.empresaId, blocId, cliente);
    const progreso = progresoDeBloc(ors);
    comprobarCierre(bloc.estado, progreso);

    const observaciones = texto(datos.observaciones);
    await repo.actualizarBloc(
      ctx.empresaId,
      blocId,
      {
        estado: "CERRADO",
        closedAt: new Date().toISOString(),
        closedBy: ctx.userId,
        ...(observaciones ? { observaciones: [bloc.observaciones, observaciones].filter(Boolean).join("\n") } : {}),
      },
      cliente
    );

    await repo.registrarEvento(
      {
        empresaId: ctx.empresaId,
        blocId,
        accion: "BLOC_CERRADO",
        detalle: { archivadas: progreso.archivadas, total: progreso.total, observaciones: observaciones || null },
        usuarioId: ctx.userId,
        usuarioNombre: ctx.userNombre,
      },
      cliente
    );
  });

  // Un bloc cerrado no tiene nada pendiente que avisar.
  await repo.resolverAvisosDeBloc(ctx.empresaId, blocId, "BLOC_INCOMPLETO");
  return fichaBloc(ctx, blocId);
}

/**
 * Borra el bloc entero: sus OR y, con ellas, su sitio en la numeración.
 *
 * Existe porque un alta equivocada —un rango mal tecleado, un taco de prueba—
 * no tenía arreglo desde el panel y había que entrar en la base a mano. Las
 * condiciones están en `comprobarBorrado`: un bloc cerrado no se borra nunca, y
 * si tiene hojas archivadas hay que confirmarlo sabiendo cuántas se retiran.
 *
 * Se anota en el histórico ANTES de borrar: el evento no tiene clave ajena, así
 * que sobrevive al bloc y queda constancia de qué se quitó y quién lo hizo.
 */
export async function eliminarBloc(
  ctx: Contexto,
  blocId: string,
  opciones: { confirmar?: boolean; motivo?: string } = {}
): Promise<{ numeroBloc: string; documentosRetirados: number }> {
  return repo.enTransaccion(async (cliente) => {
    const bloc = await repo.blocParaActualizar(ctx.empresaId, blocId, cliente);
    if (!bloc) throw new ErrorOrManuales("BLOC_NO_ENCONTRADO", "Bloc no encontrado.", 404);

    const ors = await repo.listarOrsDeBloc(ctx.empresaId, blocId, cliente);
    const progreso = progresoDeBloc(ors);
    comprobarBorrado(bloc.estado, progreso, Boolean(opciones.confirmar));

    const motivo = texto(opciones.motivo) || "bloc borrado desde el panel";

    await repo.registrarEvento(
      {
        empresaId: ctx.empresaId,
        blocId,
        accion: "BLOC_BORRADO",
        detalle: {
          numeroBloc: bloc.numeroBloc,
          orInicial: bloc.orInicial,
          orFinal: bloc.orFinal,
          archivadas: progreso.archivadas,
          motivo,
        },
        usuarioId: ctx.userId,
        usuarioNombre: ctx.userNombre,
      },
      cliente
    );

    const documentosRetirados = await repo.borrarBloc(ctx.empresaId, blocId, motivo, cliente);
    return { numeroBloc: bloc.numeroBloc, documentosRetirados };
  });
}

/* ── El recuento ─────────────────────────────────────────────────────────── */

export type ResultadoRecuento = { estado: EstadoBloc; progreso: Progreso; cambioEstado: boolean };

/**
 * Vuelve a contar el bloc y le pone el estado que le toca.
 *
 * Se llama después de CADA documento archivado y después de cada devolución.
 * No recibe la transacción del archivado a propósito: el documento ya está
 * guardado y confirmado cuando esto corre, así que un fallo aquí deja el
 * contador desactualizado un momento —lo arregla el siguiente recálculo o el
 * botón de recontar— pero nunca pierde la hoja escaneada, que es lo caro.
 */
export async function recalcularBloc(ctx: Contexto, blocId: string): Promise<ResultadoRecuento> {
  const bloc = await repo.blocPorId(ctx.empresaId, blocId);
  if (!bloc) throw new ErrorOrManuales("BLOC_NO_ENCONTRADO", "Bloc no encontrado.", 404);

  const ors = await repo.listarOrsDeBloc(ctx.empresaId, blocId);
  const progreso = progresoDeBloc(ors);
  const nuevo = estadoCalculado(bloc.estado, progreso);

  if (nuevo && nuevo !== bloc.estado) {
    await repo.actualizarBloc(ctx.empresaId, blocId, { estado: nuevo });
    await repo.registrarEvento({
      empresaId: ctx.empresaId,
      blocId,
      accion: "BLOC_ESTADO",
      detalle: { de: bloc.estado, a: nuevo, archivadas: progreso.archivadas, faltan: progreso.faltan },
      usuarioId: ctx.userId,
      usuarioNombre: ctx.userNombre,
    });
  }

  await sincronizarAviso(ctx, bloc, progreso, nuevo ?? bloc.estado);

  return { estado: nuevo ?? bloc.estado, progreso, cambioEstado: Boolean(nuevo && nuevo !== bloc.estado) };
}

/**
 * Abre o cierra el aviso de «este bloc está incompleto».
 *
 * El aviso lo crea el módulo solo, sin que nadie pulse nada, porque el valor
 * del módulo es enterarse de que faltan hojas ANTES de que alguien las busque.
 * Se resuelve solo también: en cuanto llegan las que faltaban, el aviso deja
 * de tener sentido y una lista de avisos resueltos que nadie cierra no la mira
 * nadie.
 */
async function sincronizarAviso(
  ctx: Contexto,
  bloc: repo.Bloc,
  progreso: Progreso,
  estado: EstadoBloc
): Promise<void> {
  const debeAvisar =
    estado !== "CERRADO" &&
    progreso.pendientes > 0 &&
    // Mientras el taller lo tiene, que falten hojas es lo normal.
    estado !== "DISPONIBLE" &&
    estado !== "ENTREGADO";

  if (!debeAvisar) {
    await repo.resolverAvisosDeBloc(ctx.empresaId, bloc.id, "BLOC_INCOMPLETO");
    return;
  }

  const faltan = progreso.faltan;
  const lista = faltan.length > 8 ? `${faltan.slice(0, 8).join(", ")}… (+${faltan.length - 8})` : faltan.join(", ");
  await repo.abrirAviso({
    empresaId: ctx.empresaId,
    blocId: bloc.id,
    tipo: "BLOC_INCOMPLETO",
    mensaje: `Bloc ${bloc.numeroBloc}: faltan ${faltan.length} de ${progreso.total} OR (${lista}).`,
    responsableId: bloc.responsableId,
    responsableNombre: bloc.responsableNombre,
  });
}

/* ── Archivar ────────────────────────────────────────────────────────────── */

export type ResultadoArchivado = {
  documento: repo.Documento;
  estado: "ARCHIVADO" | "REVISION" | "DUPLICADO" | "NO_IDENTIFICADO";
  numeroOr: number | null;
  blocId: string | null;
  /** El documento que ya ocupaba esa OR, si lo había. */
  existente: repo.Documento | null;
};

/**
 * Cuelga un documento ya guardado de la OR que le toca.
 *
 * Es el corazón del módulo y por eso está en una sola función: la llaman el
 * procesamiento automático, la asignación manual y el reproceso, y las tres
 * tienen que comportarse igual. Si cada una montara su propia lógica, «archivar
 * a mano» y «archivar solo» acabarían siendo dos reglas distintas.
 *
 * ── Los duplicados NO se sobrescriben ───────────────────────────────────────
 *
 * Si la OR ya tiene documento, éste se queda en DUPLICADO y el que estaba
 * sigue siendo el principal. Sustituir es una acción aparte, explícita y con
 * su traza: sobrescribir en silencio es perder un papel sin que nadie lo sepa.
 */
export async function archivarDocumento(
  ctx: Contexto,
  documentoId: string,
  numeroOr: number,
  opciones: { marcarRevision?: boolean; metodo?: MetodoDeteccion; confianza?: number | null; forzarDuplicado?: boolean } = {}
): Promise<ResultadoArchivado> {
  const resultado = await repo.enTransaccion(async (cliente) => {
    const documento = await repo.documentoPorId(ctx.empresaId, documentoId, cliente);
    if (!documento) throw new ErrorOrManuales("DOCUMENTO_NO_ENCONTRADO", "Documento no encontrado.", 404);
    if (documento.estadoProcesamiento === "ELIMINADO") {
      throw new ErrorOrManuales("DOCUMENTO_ELIMINADO", "Ese documento está eliminado.", 409);
    }

    const or = await repo.orParaActualizar(ctx.empresaId, numeroOr, cliente);
    if (!or) {
      throw new ErrorOrManuales(
        "OR_INEXISTENTE",
        `La OR ${numeroOr} no pertenece a ningún bloc dado de alta. Crea el bloc que la contenga y vuelve a intentarlo.`,
        404
      );
    }

    const bloc = await repo.blocPorId(ctx.empresaId, or.blocId, cliente);
    if (bloc?.estado === "CERRADO") {
      throw new ErrorOrManuales(
        "BLOC_CERRADO",
        `La OR ${numeroOr} es del bloc ${bloc.numeroBloc}, que está cerrado. Reábrelo si de verdad hay que cambiar su contenido.`,
        409
      );
    }

    const yaTiene = or.documentoPrincipalId && or.documentoPrincipalId !== documentoId;
    const existente = yaTiene ? await repo.documentoPorId(ctx.empresaId, or.documentoPrincipalId!, cliente) : null;

    if (yaTiene && existente && existente.estadoProcesamiento !== "ELIMINADO") {
      const doc = await repo.actualizarDocumento(
        ctx.empresaId,
        documentoId,
        {
          orId: or.id,
          blocId: or.blocId,
          estadoProcesamiento: "DUPLICADO",
          nombreArchivo: `OR_${numeroOr}${extension(documento.tipoArchivo)}`,
          ocrNumeroDetectado: numeroOr,
          ...(opciones.confianza !== undefined ? { ocrConfianza: opciones.confianza } : {}),
          ...(opciones.metodo ? { ocrMetodo: opciones.metodo } : {}),
        },
        cliente
      );
      await repo.actualizarOr(ctx.empresaId, or.id, { estado: "DUPLICADA" }, cliente);
      await repo.registrarEvento(
        {
          empresaId: ctx.empresaId,
          blocId: or.blocId,
          orId: or.id,
          documentoId,
          accion: "DOCUMENTO_DUPLICADO",
          detalle: { numeroOr, existente: existente.id },
          usuarioId: ctx.userId,
          usuarioNombre: ctx.userNombre,
        },
        cliente
      );
      return { documento: doc!, estado: "DUPLICADO" as const, numeroOr, blocId: or.blocId, existente };
    }

    const estadoDoc = opciones.marcarRevision ? ("REVISION" as const) : ("ARCHIVADO" as const);
    const doc = await repo.actualizarDocumento(
      ctx.empresaId,
      documentoId,
      {
        orId: or.id,
        blocId: or.blocId,
        estadoProcesamiento: estadoDoc,
        nombreArchivo: `OR_${numeroOr}${extension(documento.tipoArchivo)}`,
        ocrNumeroDetectado: numeroOr,
        errorMensaje: null,
        ...(opciones.confianza !== undefined ? { ocrConfianza: opciones.confianza } : {}),
        ...(opciones.metodo ? { ocrMetodo: opciones.metodo } : {}),
      },
      cliente
    );

    await repo.actualizarOr(
      ctx.empresaId,
      or.id,
      {
        estado: opciones.marcarRevision ? "REVISAR" : "ESCANEADA",
        documentoPrincipalId: documentoId,
        fechaEscaneo: new Date().toISOString(),
      },
      cliente
    );

    await repo.registrarEvento(
      {
        empresaId: ctx.empresaId,
        blocId: or.blocId,
        orId: or.id,
        documentoId,
        accion: "OR_ARCHIVADA",
        detalle: { numeroOr, metodo: opciones.metodo ?? documento.ocrMetodo, confianza: opciones.confianza ?? documento.ocrConfianza, revision: Boolean(opciones.marcarRevision) },
        usuarioId: ctx.userId,
        usuarioNombre: ctx.userNombre,
      },
      cliente
    );

    return { documento: doc!, estado: estadoDoc, numeroOr, blocId: or.blocId, existente: null };
  });

  // Fuera de la transacción: el papel ya está a salvo, y el recuento es un
  // derivado que se puede rehacer.
  await recalcularBloc(ctx, resultado.blocId!).catch((e) =>
    console.error("[OR Manuales] no se ha podido recalcular el bloc tras archivar:", e)
  );

  return resultado;
}

/** Deja el documento en la bandeja de pendientes, sin tocar ninguna OR. */
export async function dejarPendiente(
  ctx: Contexto,
  documentoId: string,
  motivo: { numeroDetectado?: number | null; confianza?: number | null; metodo?: MetodoDeteccion; texto?: string | null }
): Promise<repo.Documento> {
  const doc = await repo.actualizarDocumento(ctx.empresaId, documentoId, {
    estadoProcesamiento: "NO_IDENTIFICADO",
    ocrNumeroDetectado: motivo.numeroDetectado ?? null,
    ocrConfianza: motivo.confianza ?? null,
    ocrMetodo: motivo.metodo ?? "NINGUNO",
    ocrTexto: motivo.texto ?? null,
  });
  if (!doc) throw new ErrorOrManuales("DOCUMENTO_NO_ENCONTRADO", "Documento no encontrado.", 404);
  return doc;
}

/**
 * Asignación manual: alguien mira la hoja y dice de qué OR es.
 *
 * Se archiva SIN marca de revisión aunque el OCR hubiera fallado: lo ha visto
 * una persona, que es la fuente más fiable que tiene el módulo.
 */
export async function asignarManual(ctx: Contexto, documentoId: string, numeroOr: number): Promise<ResultadoArchivado> {
  const r = await archivarDocumento(ctx, documentoId, numeroOr, { metodo: "MANUAL", confianza: 100 });
  await repo.registrarEvento({
    empresaId: ctx.empresaId,
    blocId: r.blocId,
    documentoId,
    accion: "ASIGNACION_MANUAL",
    detalle: { numeroOr, resultado: r.estado },
    usuarioId: ctx.userId,
    usuarioNombre: ctx.userNombre,
  });
  return r;
}

/** Confirma un documento que estaba en revisión: pasa a archivado sin más. */
export async function confirmarDocumento(ctx: Contexto, documentoId: string): Promise<repo.Documento> {
  const documento = await repo.documentoPorId(ctx.empresaId, documentoId);
  if (!documento) throw new ErrorOrManuales("DOCUMENTO_NO_ENCONTRADO", "Documento no encontrado.", 404);
  if (!documento.orId) {
    throw new ErrorOrManuales("DOCUMENTO_SIN_OR", "Este documento todavía no está asignado a ninguna OR.", 409);
  }

  await repo.actualizarDocumento(ctx.empresaId, documentoId, { estadoProcesamiento: "ARCHIVADO" });
  await repo.actualizarOr(ctx.empresaId, documento.orId, { estado: "ESCANEADA" });
  await repo.registrarEvento({
    empresaId: ctx.empresaId,
    blocId: documento.blocId,
    orId: documento.orId,
    documentoId,
    accion: "OCR_CONFIRMADO",
    detalle: { numeroOr: documento.numeroOr, confianza: documento.ocrConfianza },
    usuarioId: ctx.userId,
    usuarioNombre: ctx.userNombre,
  });
  if (documento.blocId) await recalcularBloc(ctx, documento.blocId);
  return (await repo.documentoPorId(ctx.empresaId, documentoId))!;
}

/**
 * Sustituye el documento principal de una OR por otro.
 *
 * El que estaba NO se borra: pasa a SUSTITUIDO y conserva su fichero. Es el
 * versionado que pide el encargo, hecho con lo que ya hay —una fila por
 * documento y un puntero en la OR— en vez de con una tabla de versiones que
 * habría que mantener aparte.
 */
export async function sustituirDocumento(ctx: Contexto, documentoId: string): Promise<ResultadoArchivado> {
  const nuevo = await repo.documentoPorId(ctx.empresaId, documentoId);
  if (!nuevo) throw new ErrorOrManuales("DOCUMENTO_NO_ENCONTRADO", "Documento no encontrado.", 404);

  const numeroOr = nuevo.numeroOr ?? nuevo.ocrNumeroDetectado;
  if (!numeroOr) {
    throw new ErrorOrManuales("DOCUMENTO_SIN_OR", "No se sabe a qué OR sustituye este documento.", 409);
  }

  const or = await repo.orPorNumero(ctx.empresaId, numeroOr);
  if (!or) throw new ErrorOrManuales("OR_INEXISTENTE", `La OR ${numeroOr} no existe.`, 404);

  const anterior = or.documentoPrincipalId && or.documentoPrincipalId !== documentoId
    ? await repo.documentoPorId(ctx.empresaId, or.documentoPrincipalId)
    : null;

  if (anterior) {
    await repo.actualizarDocumento(ctx.empresaId, anterior.id, { estadoProcesamiento: "SUSTITUIDO" });
    await repo.actualizarDocumento(ctx.empresaId, documentoId, { sustituyeA: anterior.id });
    await repo.registrarEvento({
      empresaId: ctx.empresaId,
      blocId: or.blocId,
      orId: or.id,
      documentoId,
      accion: "DOCUMENTO_SUSTITUIDO",
      detalle: { numeroOr, anterior: anterior.id },
      usuarioId: ctx.userId,
      usuarioNombre: ctx.userNombre,
    });
    // El puntero se suelta para que `archivarDocumento` no lo vea como duplicado.
    await repo.actualizarOr(ctx.empresaId, or.id, { documentoPrincipalId: null });
  }

  return archivarDocumento(ctx, documentoId, numeroOr, { metodo: "MANUAL", confianza: 100 });
}

/**
 * Borrado lógico: la relación se suelta, el fichero se queda.
 *
 * El encargo pide que los documentos archivados sigan siendo recuperables, y
 * un DELETE de la fila haría imposible responder «qué había aquí» cuando
 * alguien elimine lo que no debía.
 */
export async function eliminarDocumento(ctx: Contexto, documentoId: string, motivo: string | null): Promise<void> {
  const documento = await repo.documentoPorId(ctx.empresaId, documentoId);
  if (!documento) throw new ErrorOrManuales("DOCUMENTO_NO_ENCONTRADO", "Documento no encontrado.", 404);

  if (documento.orId) {
    const or = await repo.orPorId(ctx.empresaId, documento.orId);
    if (or?.documentoPrincipalId === documentoId) {
      await repo.actualizarOr(ctx.empresaId, or.id, {
        estado: "PENDIENTE",
        documentoPrincipalId: null,
        fechaEscaneo: null,
      });
    }
  }

  await repo.actualizarDocumento(ctx.empresaId, documentoId, { estadoProcesamiento: "ELIMINADO", errorMensaje: motivo });
  await repo.registrarEvento({
    empresaId: ctx.empresaId,
    blocId: documento.blocId,
    orId: documento.orId,
    documentoId,
    accion: "DOCUMENTO_ELIMINADO",
    detalle: { numeroOr: documento.numeroOr, motivo },
    usuarioId: ctx.userId,
    usuarioNombre: ctx.userNombre,
  });

  if (documento.blocId) await recalcularBloc(ctx, documento.blocId);
}

/* ── Búsqueda ────────────────────────────────────────────────────────────── */

export type ResultadoBusqueda = {
  or: repo.Or | null;
  bloc: repo.Bloc | null;
  documento: repo.Documento | null;
  blocs: repo.FilaBloc[];
};

/**
 * Escribir «1043» y llegar a su hoja.
 *
 * Es el caso de uso que el encargo pone como criterio, y por eso la búsqueda
 * mira primero si lo escrito es un número de OR: si lo es, se devuelve la OR,
 * su bloc y su documento de una sola vez, sin que nadie tenga que saber en qué
 * bloc cae el 1043.
 */
export async function buscar(ctx: Contexto, termino: string): Promise<ResultadoBusqueda> {
  const limpio = termino.trim();
  const vacio: ResultadoBusqueda = { or: null, bloc: null, documento: null, blocs: [] };
  if (!limpio) return vacio;

  const n = Number(limpio);
  if (Number.isInteger(n) && n > 0) {
    const or = await repo.orPorNumero(ctx.empresaId, n);
    if (or) {
      const [bloc, documento] = await Promise.all([
        repo.blocPorId(ctx.empresaId, or.blocId),
        or.documentoPrincipalId ? repo.documentoPorId(ctx.empresaId, or.documentoPrincipalId) : Promise.resolve(null),
      ]);
      return { or, bloc, documento, blocs: [] };
    }
  }

  return { ...vacio, blocs: await repo.listarBlocs(ctx.empresaId, { texto: limpio }) };
}

/* ── Utilidades ──────────────────────────────────────────────────────────── */

function texto(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

/** Una fecha `YYYY-MM-DD` o nada. Se rechaza lo que no lo sea. */
function fecha(v: unknown): string | null {
  const s = texto(v);
  if (!s) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(new Date(s).getTime())) {
    throw new ErrorOrManuales("FECHA_INVALIDA", `«${s}» no es una fecha válida (formato AAAA-MM-DD).`);
  }
  return s;
}

function extension(mime: string): string {
  if (mime === "image/jpeg") return ".jpg";
  if (mime === "image/png") return ".png";
  return ".pdf";
}

function esUnico(e: unknown, restriccion: string): boolean {
  const err = e as { code?: string; constraint?: string };
  return err?.code === "23505" && (err?.constraint === restriccion || !err?.constraint);
}
