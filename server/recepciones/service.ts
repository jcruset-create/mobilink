/**
 * Casos de uso del módulo Recepciones.
 *
 * Aquí viven las transacciones. Cada caso de uso abre UNA y mete dentro todo
 * lo que tiene que entrar junto: la recepción, sus líneas, las incidencias,
 * los acumulados del albarán y del pedido, el histórico y la auditoría. Si
 * algo falla, no entra nada.
 *
 * ── Lo que este módulo NO hace ──────────────────────────────────────────────
 *
 * No escribe existencias. Cerrar una recepción registra qué llegó, quién lo
 * contó y cuándo; la entrada del albarán en GENES la sigue haciendo una
 * persona después, a mano. No hay ninguna llamada a `movimientos_stock` ni a
 * ninguna tabla del almacén en todo el módulo, y no debe haberla.
 *
 * ── El cierre y la concurrencia ─────────────────────────────────────────────
 *
 * Dos operarios pueden pulsar «RECEPCIÓN OK» sobre el mismo albarán a la vez.
 * El segundo espera en el `SELECT … FOR UPDATE` del albarán, y cuando le toca
 * relee las cantidades YA con la recepción del primero contada: lo pendiente
 * es cero y recibe un 409. Las cantidades que manda la pantalla sólo son la
 * intención del operario; las que valen se calculan aquí, dentro del cerrojo.
 */

import { registrarAuditoriaEnTransaccion } from "../core/auditoria.ts";
import { hashSecret, newSalt, verifySecret } from "../core/credentials.ts";
import { descripcionNormalizada, leerDescripcion } from "./domain/articulos.ts";
import { cantidad, diferencia, pendienteDeRecibir, redondear } from "./domain/cantidades.ts";
import {
  ALBARAN_RECIBIBLE,
  ETIQUETA_TIPO_INCIDENCIA,
  esEstadoIncidencia,
  esTipoIncidencia,
  estadoAlbaran,
  estadoPedido,
  type EstadoIncidencia,
  type TipoIncidencia,
} from "./domain/estados.ts";
import { normalizarNumero } from "./domain/numero.ts";
import { estaBloqueado, minutosRestantes, pinValido, trasFallo, PIN_MAX, PIN_MIN } from "./domain/pin.ts";
import { ErrorRecepciones } from "./errors.ts";
import * as repo from "./repository.ts";
import { generarDocumentoRecepcion, limpio } from "./documentos/generar.ts";
import { observacionesDelPdf } from "./documentos/observaciones.ts";
import { partirObservacion } from "./domain/observaciones.ts";
import { guardarDocumento, hashDeFichero, leerDocumento as leerDelAlmacen, rutaDocumento } from "./storage.ts";

/** `userId` es `null` cuando actúa el sistema (el correo del proveedor). */
export type Contexto = { empresaId: string; userId: string | null; userNombre: string; ip?: string };

/* ── Proveedores y mapeo ─────────────────────────────────────────────────── */

export async function crearProveedor(
  ctx: Contexto,
  datos: { codigo: string; nombre: string; nif?: string | null; remitentesCorreo?: string[] }
): Promise<repo.Proveedor> {
  const codigo = String(datos.codigo ?? "").trim().toUpperCase().replace(/[^A-Z0-9_-]/g, "");
  const nombre = String(datos.nombre ?? "").trim();
  if (!codigo) throw new ErrorRecepciones("CODIGO_REQUERIDO", "El proveedor necesita un código (p. ej. SOLEDAD).");
  if (!nombre) throw new ErrorRecepciones("NOMBRE_REQUERIDO", "El proveedor necesita un nombre.");
  try {
    return await repo.crearProveedor(ctx.empresaId, {
      codigo,
      nombre,
      nif: datos.nif?.trim() || null,
      remitentesCorreo: (datos.remitentesCorreo ?? []).map((s) => String(s).trim().toLowerCase()).filter(Boolean),
    });
  } catch (e) {
    if ((e as { code?: string }).code === "23505") {
      throw new ErrorRecepciones("PROVEEDOR_DUPLICADO", `Ya existe un proveedor con el código ${codigo}.`, 409);
    }
    throw e;
  }
}

/**
 * Editar un proveedor. Mismas reglas de forma que el alta —el código en
 * mayúsculas y sin adornos, los remitentes en minúsculas— para que no acaben
 * dos proveedores que sólo se distinguen en cómo se escribieron.
 *
 * El código SÍ se puede cambiar: un remitente mal escrito obliga a dar de alta
 * otro proveedor con un código libre («SOLEDAD1»), y sin poder editarlo esa
 * cicatriz se queda para siempre.
 */
export async function actualizarProveedor(
  ctx: Contexto,
  id: string,
  datos: { codigo?: string; nombre?: string; nif?: string | null; remitentesCorreo?: string[]; activo?: boolean }
): Promise<repo.Proveedor> {
  const codigo = datos.codigo === undefined ? undefined : String(datos.codigo).trim().toUpperCase().replace(/[^A-Z0-9_-]/g, "");
  if (codigo !== undefined && !codigo) throw new ErrorRecepciones("CODIGO_REQUERIDO", "El proveedor necesita un código (p. ej. SOLEDAD).");
  const nombre = datos.nombre === undefined ? undefined : String(datos.nombre).trim();
  if (nombre !== undefined && !nombre) throw new ErrorRecepciones("NOMBRE_REQUERIDO", "El proveedor necesita un nombre.");

  try {
    const proveedor = await repo.actualizarProveedor(ctx.empresaId, id, {
      codigo,
      nombre,
      nif: datos.nif === undefined ? undefined : datos.nif?.trim() || null,
      remitentesCorreo: datos.remitentesCorreo?.map((s) => String(s).trim().toLowerCase()).filter(Boolean),
      activo: datos.activo,
    });
    if (!proveedor) throw new ErrorRecepciones("PROVEEDOR_NO_ENCONTRADO", "Proveedor no encontrado.", 404);
    return proveedor;
  } catch (e) {
    if ((e as { code?: string }).code === "23505") {
      throw new ErrorRecepciones("PROVEEDOR_DUPLICADO", `Ya hay otro proveedor con el código ${codigo}.`, 409);
    }
    throw e;
  }
}

export async function confirmarMapeo(
  ctx: Contexto,
  datos: {
    proveedorId: string;
    descripcionProveedor: string;
    referenciaProveedor?: string | null;
    productoId?: string | null;
    productoTexto?: string | null;
    ean?: string | null;
  }
): Promise<repo.MapeoArticulo> {
  const proveedor = await repo.proveedorPorId(ctx.empresaId, datos.proveedorId);
  if (!proveedor) throw new ErrorRecepciones("PROVEEDOR_NO_ENCONTRADO", "Proveedor no encontrado.", 404);
  const descripcion = String(datos.descripcionProveedor ?? "").trim();
  if (!descripcion) throw new ErrorRecepciones("DESCRIPCION_REQUERIDA", "Falta la descripción del proveedor.");
  const productoTexto = String(datos.productoTexto ?? "").trim() || leerDescripcion(descripcion).bonito;
  return repo.enTransaccion(async (c) => {
    const mapeo = await repo.guardarMapeo(
      ctx.empresaId,
      {
        proveedorId: proveedor.id,
        referenciaProveedor: datos.referenciaProveedor?.trim() || null,
        descripcionProveedor: descripcion,
        descripcionNormalizada: descripcionNormalizada(descripcion),
        productoId: datos.productoId?.trim() || null,
        productoTexto,
        ean: datos.ean?.trim() || null,
        userId: ctx.userId,
        userNombre: ctx.userNombre,
      },
      c
    );
    await repo.aplicarMapeoALineas(ctx.empresaId, proveedor.id, mapeo, c);
    return mapeo;
  });
}

/* ── Operarios del muelle ────────────────────────────────────────────────── */

/**
 * Quién cuenta la mercancía, y cómo se prueba que es esa persona.
 *
 * El tablet del muelle lo abre un encargado por la mañana y por él pasan cinco
 * personas en el turno. Si la recepción la firmara la sesión, todas las
 * recepciones del día llevarían el mismo nombre y el papel no valdría para
 * responder a «¿quién contó esto?», que es justo para lo que existe.
 *
 * El PIN nunca se guarda: se hashea con `core/credentials.ts`, el mismo
 * PBKDF2 que usan los operarios de Connect Lite.
 */
export async function crearOperario(ctx: Contexto, datos: { nombre: string; centroId?: string | null; pin: string }): Promise<repo.Operario> {
  const nombre = String(datos.nombre ?? "").trim();
  if (!nombre) throw new ErrorRecepciones("NOMBRE_REQUERIDO", "El operario necesita un nombre.");
  const pin = String(datos.pin ?? "").trim();
  if (!pinValido(pin)) throw new ErrorRecepciones("PIN_INVALIDO", `El PIN son entre ${PIN_MIN} y ${PIN_MAX} dígitos.`);
  const salt = newSalt();
  try {
    return await repo.crearOperario(ctx.empresaId, {
      nombre,
      centroId: datos.centroId?.trim() || null,
      pinHash: hashSecret(pin, salt),
      pinSalt: salt,
      creadoPor: ctx.userId,
      creadoNombre: ctx.userNombre,
    });
  } catch (e) {
    if ((e as { code?: string }).code === "23505") {
      throw new ErrorRecepciones("OPERARIO_DUPLICADO", `Ya hay un operario que se llama ${nombre}.`, 409);
    }
    throw e;
  }
}

export async function actualizarOperario(
  ctx: Contexto,
  id: string,
  datos: { nombre?: string; centroId?: string | null; activo?: boolean; pin?: string }
): Promise<repo.Operario> {
  let pinHash: string | undefined;
  let pinSalt: string | undefined;
  if (datos.pin !== undefined) {
    const pin = String(datos.pin).trim();
    if (!pinValido(pin)) throw new ErrorRecepciones("PIN_INVALIDO", `El PIN son entre ${PIN_MIN} y ${PIN_MAX} dígitos.`);
    pinSalt = newSalt();
    pinHash = hashSecret(pin, pinSalt);
  }
  const operario = await repo.actualizarOperario(ctx.empresaId, id, {
    nombre: datos.nombre?.trim() || undefined,
    centroId: datos.centroId === undefined ? undefined : datos.centroId?.trim() || null,
    activo: datos.activo,
    pinHash,
    pinSalt,
  });
  if (!operario) throw new ErrorRecepciones("OPERARIO_NO_ENCONTRADO", "Operario no encontrado.", 404);
  return operario;
}

/**
 * Comprueba el PIN y devuelve quién firma. FUERA de la transacción del cierre
 * a propósito: si contara los fallos dentro, el rollback del error los
 * borraría y el freno a la fuerza bruta no frenaría nada.
 */
export async function verificarOperario(ctx: Contexto, operarioId: string, pin: string, centroId: string | null): Promise<repo.Operario> {
  const operario = await repo.operarioPorId(ctx.empresaId, operarioId);
  if (!operario || !operario.activo) throw new ErrorRecepciones("OPERARIO_NO_ENCONTRADO", "Ese operario no existe o está dado de baja.", 404);
  if (operario.centroId && centroId && operario.centroId !== centroId) {
    throw new ErrorRecepciones("OPERARIO_DE_OTRO_CENTRO", `${operario.nombre} no está asignado a este centro.`, 409);
  }
  const bloqueadoHasta = operario.bloqueadoHasta ? new Date(operario.bloqueadoHasta) : null;
  if (bloqueadoHasta && estaBloqueado(bloqueadoHasta)) {
    throw new ErrorRecepciones(
      "OPERARIO_BLOQUEADO",
      `Demasiados PIN fallidos. ${operario.nombre} puede volver a intentarlo en ${minutosRestantes(bloqueadoHasta)} minuto(s).`,
      429
    );
  }
  if (!verifySecret(String(pin ?? "").trim(), operario.pinHash, operario.pinSalt)) {
    await repo.anotarIntentoPin(ctx.empresaId, operario.id, trasFallo(operario.intentosFallidos));
    throw new ErrorRecepciones("PIN_INCORRECTO", "PIN incorrecto.", 401);
  }
  if (operario.intentosFallidos > 0 || bloqueadoHasta) {
    await repo.anotarIntentoPin(ctx.empresaId, operario.id, { intentos: 0, bloqueadoHasta: null });
  }
  return operario;
}

/* ── Pedidos ─────────────────────────────────────────────────────────────── */

export type LineaPedidoEntrante = {
  referenciaProveedor?: string | null;
  descripcionProveedor: string;
  cantidadPedida: number | string;
  precioUnitarioCentimos?: number | null;
};

export type PedidoEntrante = {
  proveedorId: string;
  numeroProveedor: string;
  fechaPedido?: string | null;
  usuarioPedido?: string | null;
  centroId?: string | null;
  centroNombre?: string | null;
  almacenOrigen?: string | null;
  transportista?: string | null;
  observaciones?: string | null;
  lineas: LineaPedidoEntrante[];
  origen?: "MANUAL" | "CORREO";
  externalMessageId?: string | null;
  sourceReceivedAt?: string | null;
  destinoTexto?: string | null;
  clienteProveedor?: string | null;
  /** El pedido se deduce de un albarán porque su correo no ha llegado. */
  derivadoDeAlbaran?: boolean;
};

export type FichaPedido = {
  pedido: repo.Pedido;
  lineas: repo.PedidoLinea[];
  albaranes: (repo.Albaran & { lineas: repo.AlbaranLinea[]; documentos: repo.Documento[] })[];
  recepciones: (repo.Recepcion & { lineas: repo.RecepcionLinea[] })[];
  incidencias: repo.Incidencia[];
  eventos: repo.Evento[];
};

/**
 * Alta de un pedido con sus líneas. Es la misma puerta por la que entrará el
 * correo de Soledad: `origen` y `externalMessageId` ya están, y el UNIQUE por
 * número normalizado garantiza que el mismo pedido no se crea dos veces
 * aunque llegue escrito de dos formas.
 */
export async function crearPedido(ctx: Contexto, datos: PedidoEntrante): Promise<FichaPedido> {
  const proveedor = await repo.proveedorPorId(ctx.empresaId, datos.proveedorId);
  if (!proveedor) throw new ErrorRecepciones("PROVEEDOR_NO_ENCONTRADO", "Proveedor no encontrado.", 404);

  const numeroProveedor = String(datos.numeroProveedor ?? "").trim();
  const numeroNormalizado = normalizarNumero(numeroProveedor);
  if (!numeroNormalizado) throw new ErrorRecepciones("NUMERO_REQUERIDO", "Falta el número de pedido del proveedor.");

  const lineas = (datos.lineas ?? []).map((l, i) => ({
    referenciaProveedor: l.referenciaProveedor?.trim() || null,
    descripcionProveedor: String(l.descripcionProveedor ?? "").trim(),
    cantidadPedida: cantidad(l.cantidadPedida, `Cantidad de la línea ${i + 1}`),
    precioUnitarioCentimos: centimos(l.precioUnitarioCentimos, i + 1),
  }));
  if (lineas.length === 0) throw new ErrorRecepciones("SIN_LINEAS", "Un pedido necesita al menos una línea.");
  for (const [i, l] of lineas.entries()) {
    if (!l.descripcionProveedor) {
      throw new ErrorRecepciones("DESCRIPCION_REQUERIDA", `Falta la descripción de la línea ${i + 1}.`);
    }
  }

  const centroNombre = String(datos.centroNombre ?? "").trim();
  const centroId = datos.centroId?.trim() || null;

  const pedidoId = await repo.enTransaccion(async (c) => {
    let pedido: repo.Pedido;
    try {
      pedido = await repo.crearPedido(
        ctx.empresaId,
        {
          proveedorId: proveedor.id,
          numeroProveedor,
          numeroNormalizado,
          fechaPedido: fechaISO(datos.fechaPedido, "La fecha del pedido"),
          usuarioPedido: datos.usuarioPedido?.trim() || null,
          centroId,
          centroNombre,
          almacenOrigen: datos.almacenOrigen?.trim() || null,
          transportista: datos.transportista?.trim() || null,
          observaciones: datos.observaciones?.trim() || null,
          origen: datos.origen ?? "MANUAL",
          externalMessageId: datos.externalMessageId ?? null,
          sourceReceivedAt: datos.sourceReceivedAt ?? null,
          destinoTexto: datos.destinoTexto?.trim() || null,
          clienteProveedor: datos.clienteProveedor?.trim() || null,
          derivadoDeAlbaran: datos.derivadoDeAlbaran === true,
          creadoPor: ctx.userId,
          creadoNombre: ctx.userNombre,
        },
        c
      );
    } catch (e) {
      if ((e as { code?: string }).code === "23505") {
        throw new ErrorRecepciones(
          "PEDIDO_DUPLICADO",
          `Ya existe el pedido ${numeroProveedor} de ${proveedor.nombre}.`,
          409
        );
      }
      throw e;
    }

    for (const [i, l] of lineas.entries()) {
      // Mapeo confirmado → artículo Mobilink; sin él, la línea nace SIN MAPEAR
      // y se recepciona igual por la descripción del proveedor.
      const mapeo = await repo.mapeoConfirmado(ctx.empresaId, proveedor.id, descripcionNormalizada(l.descripcionProveedor), c);
      await repo.crearPedidoLinea(
        ctx.empresaId,
        {
          pedidoId: pedido.id,
          numeroLinea: i + 1,
          referenciaProveedor: l.referenciaProveedor,
          descripcionProveedor: l.descripcionProveedor,
          productoId: mapeo?.productoId ?? null,
          productoTexto: mapeo?.productoTexto ?? null,
          mapeoId: mapeo?.id ?? null,
          cantidadPedida: l.cantidadPedida,
          precioUnitarioCentimos: l.precioUnitarioCentimos,
        },
        c
      );
      if (mapeo) await repo.contarUsoMapeo(mapeo.id, c);
    }

    await repo.anotarEvento(
      ctx.empresaId,
      {
        pedidoId: pedido.id,
        tipo: "PEDIDO_CREADO",
        usuarioId: ctx.userId,
        usuarioNombre: ctx.userNombre,
        datos: { numero: numeroProveedor, lineas: lineas.length, origen: datos.origen ?? "MANUAL", derivado: datos.derivadoDeAlbaran === true },
        descripcion: datos.derivadoDeAlbaran
          ? `Pedido ${numeroProveedor} de ${proveedor.nombre} DEDUCIDO de su albarán, con ${lineas.length} línea(s): el correo del pedido no había llegado.`
          : `Pedido ${numeroProveedor} de ${proveedor.nombre} creado con ${lineas.length} línea(s).`,
      },
      c
    );
    return pedido.id;
  });

  return (await fichaPedido(ctx, pedidoId))!;
}

export async function fichaPedido(ctx: Contexto, pedidoId: string): Promise<FichaPedido | null> {
  const pedido = await repo.pedidoPorId(ctx.empresaId, pedidoId);
  if (!pedido) return null;
  const [lineas, albaranes, recepciones, incidencias, eventos] = await Promise.all([
    repo.lineasDePedido(ctx.empresaId, pedidoId),
    repo.albaranesDePedido(ctx.empresaId, pedidoId),
    repo.recepcionesDePedido(ctx.empresaId, pedidoId),
    repo.listarIncidencias(ctx.empresaId, { pedidoId }),
    repo.eventosDePedido(ctx.empresaId, pedidoId),
  ]);
  return {
    pedido,
    lineas,
    albaranes: await Promise.all(
      albaranes.map(async (a) => ({
        ...a,
        lineas: await repo.lineasDeAlbaran(ctx.empresaId, a.id),
        documentos: await repo.documentosDeAlbaran(ctx.empresaId, a.id),
      }))
    ),
    recepciones: await Promise.all(
      recepciones.map(async (r) => ({ ...r, lineas: await repo.lineasDeRecepcion(ctx.empresaId, r.id) }))
    ),
    incidencias,
    eventos,
  };
}

export async function cancelarPedido(ctx: Contexto, pedidoId: string, motivo: string): Promise<repo.Pedido> {
  const userId = usuarioObligatorio(ctx);
  const motivoLimpio = String(motivo ?? "").trim();
  if (!motivoLimpio) throw new ErrorRecepciones("MOTIVO_REQUERIDO", "Cancelar un pedido necesita un motivo.");
  return repo.enTransaccion(async (c) => {
    const pedido = await repo.bloquearPedido(ctx.empresaId, pedidoId, c);
    if (!pedido) throw new ErrorRecepciones("PEDIDO_NO_ENCONTRADO", "Pedido no encontrado.", 404);
    if (pedido.estado === "CANCELADO") throw new ErrorRecepciones("PEDIDO_YA_CANCELADO", "El pedido ya está cancelado.", 409);
    const recepciones = await repo.recepcionesDePedido(ctx.empresaId, pedidoId, c);
    if (recepciones.length > 0) {
      throw new ErrorRecepciones("PEDIDO_CON_RECEPCIONES", "No se puede cancelar un pedido con recepciones registradas.", 409);
    }
    await repo.cancelarPedido(ctx.empresaId, pedidoId, { userId, motivo: motivoLimpio }, c);
    await repo.anotarEvento(
      ctx.empresaId,
      {
        pedidoId,
        tipo: "PEDIDO_CANCELADO",
        usuarioId: ctx.userId,
        usuarioNombre: ctx.userNombre,
        datos: { motivo: motivoLimpio },
        descripcion: `Pedido cancelado: ${motivoLimpio}`,
      },
      c
    );
    return (await repo.pedidoPorId(ctx.empresaId, pedidoId, c))!;
  });
}

/* ── Albaranes ───────────────────────────────────────────────────────────── */

export type LineaAlbaranEntrante = {
  /** Línea del pedido a la que corresponde. Si falta, es una línea fuera de pedido. */
  pedidoLineaId?: string | null;
  descripcionProveedor?: string | null;
  referenciaProveedor?: string | null;
  cantidadExpedida: number | string;
};

export type AlbaranEntrante = {
  numeroProveedor: string;
  fechaExpedicion?: string | null;
  transportista?: string | null;
  observaciones?: string | null;
  lineas: LineaAlbaranEntrante[];
  origen?: "MANUAL" | "CORREO";
  externalMessageId?: string | null;
  sourceReceivedAt?: string | null;
  enlacePdfProveedor?: string | null;
};

/**
 * Asocia un albarán del proveedor a un pedido. Nace EN_TRANSITO: que el
 * proveedor lo haya emitido no significa que la mercancía esté aquí.
 *
 * No se permite expedir más de lo pedido en una línea: una expedición por
 * encima del pedido es un error de captura o un problema con el proveedor,
 * y las dos cosas hay que verlas antes de que lleguen al muelle.
 */
/* ── Pedidos deducidos de un albarán ─────────────────────────────────────── */

export type LineaConocida = {
  descripcionProveedor: string;
  referenciaProveedor?: string | null;
  cantidad: number;
  precioUnitarioCentimos?: number | null;
};

/**
 * Completa un pedido que se dedujo de un albarán, con lo que se sepa de él
 * ahora. Dos llamadas, la misma operación:
 *
 *  · Llega OTRO albarán del mismo pedido. `definitivo: false`. Lo pedido sigue
 *    sin saberse, así que crece hasta cubrir lo que este albarán trae: si no,
 *    el servicio lo rechazaría por expedir más de lo pedido, que aquí no
 *    significa nada.
 *  · Llega el correo del PEDIDO. `definitivo: true`. Ahora sí se sabe: las
 *    cantidades son las suyas y el pedido deja de ser derivado.
 *
 * Las cantidades sólo SUBEN, nunca bajan de lo ya expedido: bajarlas dejaría
 * un pedido con más expedido que pedido. Y de la cabecera sólo se rellenan los
 * huecos, para no pisar lo que alguien haya corregido a mano; la excepción es
 * el número, porque el del albarán viene sin serie («5687439») y el del correo
 * del pedido la trae («B-2026-5687439»).
 *
 * No toca nada si el pedido no es derivado: quien mande es el pedido de verdad.
 */
export async function completarPedidoDerivado(
  ctx: Contexto,
  pedidoId: string,
  datos: {
    lineas: LineaConocida[];
    definitivo: boolean;
    numeroProveedor?: string | null;
    fechaPedido?: string | null;
    usuarioPedido?: string | null;
    centroId?: string | null;
    centroNombre?: string | null;
    almacenOrigen?: string | null;
    transportista?: string | null;
    destinoTexto?: string | null;
    clienteProveedor?: string | null;
  }
): Promise<{ completado: boolean; lineasNuevas: number; lineasAmpliadas: number }> {
  return repo.enTransaccion(async (c) => {
    const pedido = await repo.bloquearPedido(ctx.empresaId, pedidoId, c);
    if (!pedido) throw new ErrorRecepciones("PEDIDO_NO_ENCONTRADO", "Pedido no encontrado.", 404);
    if (!pedido.derivadoDeAlbaran) return { completado: false, lineasNuevas: 0, lineasAmpliadas: 0 };

    const lineasPedido = await repo.lineasDePedido(ctx.empresaId, pedidoId, c, true);
    const usadas = new Set<string>();
    let siguiente = lineasPedido.reduce((m, l) => Math.max(m, l.numeroLinea), 0);
    let nuevas = 0;
    let ampliadas = 0;

    for (const l of datos.lineas) {
      const descripcion = String(l.descripcionProveedor ?? "").trim();
      const cuanta = Number(l.cantidad);
      if (!descripcion || !Number.isFinite(cuanta) || cuanta <= 0) continue;
      const clave = descripcionNormalizada(descripcion);
      const lp = lineasPedido.find((x) => !usadas.has(x.id) && descripcionNormalizada(x.descripcionProveedor) === clave);

      if (!lp) {
        siguiente += 1;
        const mapeo = await repo.mapeoConfirmado(ctx.empresaId, pedido.proveedorId, clave, c);
        await repo.crearPedidoLinea(
          ctx.empresaId,
          {
            pedidoId,
            numeroLinea: siguiente,
            referenciaProveedor: l.referenciaProveedor?.trim() || null,
            descripcionProveedor: descripcion,
            productoId: mapeo?.productoId ?? null,
            productoTexto: mapeo?.productoTexto ?? null,
            mapeoId: mapeo?.id ?? null,
            cantidadPedida: cuanta,
            precioUnitarioCentimos: l.precioUnitarioCentimos ?? null,
          },
          c
        );
        if (mapeo) await repo.contarUsoMapeo(mapeo.id, c);
        nuevas += 1;
        continue;
      }

      usadas.add(lp.id);
      // Otro albarán: lo pedido es al menos lo ya expedido más lo que trae.
      // El correo del pedido: lo pedido es lo que él diga, nunca menos de lo expedido.
      const objetivo = datos.definitivo ? Math.max(cuanta, lp.cantidadExpedida) : redondear(lp.cantidadExpedida + cuanta);
      if (objetivo > lp.cantidadPedida) {
        await repo.subirCantidadPedida(ctx.empresaId, lp.id, objetivo, c);
        ampliadas += 1;
      }
    }

    await repo.rellenarCabeceraPedido(
      ctx.empresaId,
      pedidoId,
      {
        numeroProveedor: datos.definitivo ? (datos.numeroProveedor?.trim() || null) : null,
        fechaPedido: fechaISO(datos.fechaPedido, "La fecha del pedido"),
        usuarioPedido: datos.usuarioPedido?.trim() || null,
        centroId: datos.centroId?.trim() || null,
        centroNombre: datos.centroNombre?.trim() || null,
        almacenOrigen: datos.almacenOrigen?.trim() || null,
        transportista: datos.transportista?.trim() || null,
        destinoTexto: datos.destinoTexto?.trim() || null,
        clienteProveedor: datos.clienteProveedor?.trim() || null,
        derivadoDeAlbaran: datos.definitivo ? false : undefined,
      },
      c
    );

    await recalcularEstadoPedido(ctx.empresaId, pedidoId, c);
    await repo.anotarEvento(
      ctx.empresaId,
      {
        pedidoId,
        tipo: datos.definitivo ? "PEDIDO_CONFIRMADO" : "PEDIDO_AMPLIADO",
        usuarioId: ctx.userId,
        usuarioNombre: ctx.userNombre,
        datos: { lineasNuevas: nuevas, lineasAmpliadas: ampliadas },
        descripcion: datos.definitivo
          ? `Ha llegado el correo del pedido: deja de estar deducido del albarán (${nuevas} línea(s) nueva(s), ${ampliadas} ampliada(s)).`
          : `Pedido deducido ampliado con otro albarán: ${nuevas} línea(s) nueva(s), ${ampliadas} ampliada(s).`,
      },
      c
    );

    return { completado: true, lineasNuevas: nuevas, lineasAmpliadas: ampliadas };
  });
}

export async function crearAlbaran(ctx: Contexto, pedidoId: string, datos: AlbaranEntrante): Promise<FichaPedido> {
  const numeroProveedor = String(datos.numeroProveedor ?? "").trim();
  const numeroNormalizado = normalizarNumero(numeroProveedor);
  if (!numeroNormalizado) throw new ErrorRecepciones("NUMERO_REQUERIDO", "Falta el número de albarán.");
  if (!datos.lineas?.length) throw new ErrorRecepciones("SIN_LINEAS", "Un albarán necesita al menos una línea.");

  await repo.enTransaccion(async (c) => {
    const pedido = await repo.bloquearPedido(ctx.empresaId, pedidoId, c);
    if (!pedido) throw new ErrorRecepciones("PEDIDO_NO_ENCONTRADO", "Pedido no encontrado.", 404);
    if (pedido.estado === "CANCELADO") throw new ErrorRecepciones("PEDIDO_CANCELADO", "El pedido está cancelado.", 409);

    const lineasPedido = await repo.lineasDePedido(ctx.empresaId, pedidoId, c, true);
    const porId = new Map(lineasPedido.map((l) => [l.id, l]));

    let albaran: repo.Albaran;
    try {
      albaran = await repo.crearAlbaran(
        ctx.empresaId,
        {
          proveedorId: pedido.proveedorId,
          pedidoId,
          numeroProveedor,
          numeroNormalizado,
          fechaExpedicion: fechaISO(datos.fechaExpedicion, "La fecha de expedición"),
          transportista: datos.transportista?.trim() || pedido.transportista,
          observaciones: datos.observaciones?.trim() || null,
          origen: datos.origen ?? "MANUAL",
          externalMessageId: datos.externalMessageId ?? null,
          sourceReceivedAt: datos.sourceReceivedAt ?? null,
          enlacePdfProveedor: datos.enlacePdfProveedor ?? null,
          creadoPor: ctx.userId,
          creadoNombre: ctx.userNombre,
        },
        c
      );
    } catch (e) {
      if ((e as { code?: string }).code === "23505") {
        throw new ErrorRecepciones("ALBARAN_DUPLICADO", `Ya existe el albarán ${numeroProveedor} de este proveedor.`, 409);
      }
      throw e;
    }

    let n = 0;
    for (const l of datos.lineas) {
      const cantidadExpedida = cantidad(l.cantidadExpedida, `Cantidad expedida de la línea ${n + 1}`);
      const lineaPedido = l.pedidoLineaId ? porId.get(l.pedidoLineaId) : undefined;
      if (l.pedidoLineaId && !lineaPedido) {
        throw new ErrorRecepciones("LINEA_PEDIDO_NO_ENCONTRADA", "Una de las líneas no pertenece a este pedido.");
      }
      if (lineaPedido) {
        const pendiente = redondear(lineaPedido.cantidadPedida - lineaPedido.cantidadExpedida);
        if (cantidadExpedida > pendiente) {
          throw new ErrorRecepciones(
            "EXPEDICION_SUPERA_PEDIDO",
            `La línea «${lineaPedido.descripcionProveedor}» tiene ${pendiente} pendiente(s) de expedir y el albarán trae ${cantidadExpedida}.`,
            409,
            { pedidoLineaId: lineaPedido.id, pendiente, expedida: cantidadExpedida }
          );
        }
      }
      const descripcion = String(l.descripcionProveedor ?? lineaPedido?.descripcionProveedor ?? "").trim();
      if (!descripcion) throw new ErrorRecepciones("DESCRIPCION_REQUERIDA", `Falta la descripción de la línea ${n + 1}.`);
      n += 1;
      await repo.crearAlbaranLinea(
        ctx.empresaId,
        {
          albaranId: albaran.id,
          pedidoLineaId: lineaPedido?.id ?? null,
          numeroLinea: n,
          referenciaProveedor: l.referenciaProveedor?.trim() || lineaPedido?.referenciaProveedor || null,
          descripcionProveedor: descripcion,
          productoId: lineaPedido?.productoId ?? null,
          productoTexto: lineaPedido?.productoTexto ?? null,
          cantidadExpedida,
        },
        c
      );
    }

    await recalcularEstadoPedido(ctx.empresaId, pedidoId, c);

    await repo.anotarEvento(
      ctx.empresaId,
      {
        pedidoId,
        albaranId: albaran.id,
        tipo: "ALBARAN_CREADO",
        usuarioId: ctx.userId,
        usuarioNombre: ctx.userNombre,
        datos: { numero: numeroProveedor, lineas: n, transportista: albaran.transportista },
        descripcion: `Albarán ${numeroProveedor} asociado al pedido: en tránsito${albaran.transportista ? ` con ${albaran.transportista}` : ""}.`,
      },
      c
    );
  });

  return (await fichaPedido(ctx, pedidoId))!;
}

export type FichaAlbaran = {
  albaran: repo.Albaran;
  lineas: (repo.AlbaranLinea & { cantidadPendiente: number; articuloLeido: string; sinMapear: boolean })[];
  recepciones: (repo.Recepcion & { lineas: repo.RecepcionLinea[]; rectificaciones: repo.Rectificacion[] })[];
  incidencias: repo.Incidencia[];
  documentos: repo.Documento[];
  eventos: repo.Evento[];
  recibible: boolean;
};

export async function fichaAlbaran(ctx: Contexto, albaranId: string): Promise<FichaAlbaran | null> {
  const albaran = await repo.albaranPorId(ctx.empresaId, albaranId);
  if (!albaran) return null;
  const [lineas, recepciones, incidencias, documentos, eventos] = await Promise.all([
    repo.lineasDeAlbaran(ctx.empresaId, albaranId),
    repo.recepcionesDeAlbaran(ctx.empresaId, albaranId),
    repo.listarIncidencias(ctx.empresaId, { albaranId }),
    repo.documentosDeAlbaran(ctx.empresaId, albaranId),
    repo.eventosDeAlbaran(ctx.empresaId, albaranId),
  ]);
  return {
    albaran,
    lineas: lineas.map((l) => ({
      ...l,
      cantidadPendiente: pendienteDeRecibir(l.cantidadExpedida, l.cantidadRecibida),
      articuloLeido: l.productoTexto ?? leerDescripcion(l.descripcionProveedor).bonito,
      sinMapear: !l.productoId && !l.productoTexto,
    })),
    recepciones: await Promise.all(
      recepciones.map(async (r) => ({
        ...r,
        lineas: await repo.lineasDeRecepcion(ctx.empresaId, r.id),
        rectificaciones: await repo.rectificacionesDeRecepcion(ctx.empresaId, r.id),
      }))
    ),
    incidencias,
    documentos,
    eventos,
    recibible: ALBARAN_RECIBIBLE.includes(albaran.estado) && !albaran.cerradoAt,
  };
}

/* ── El cierre de una recepción ──────────────────────────────────────────── */

export type LineaRecibida = {
  albaranLineaId: string;
  cantidadRecibida: number | string;
  incidencia?: { tipo: TipoIncidencia | string; observaciones?: string | null } | null;
};

export type CierreEntrante = {
  resultado: "OK" | "CON_INCIDENCIA";
  /** Sólo con CON_INCIDENCIA. Las líneas que no vengan se dan por recibidas completas. */
  lineas?: LineaRecibida[];
  observaciones?: string | null;
  idempotencyKey?: string | null;
  /** Quién cuenta, y su PIN. Obligatorios si el centro tiene operarios dados de alta. */
  operarioId?: string | null;
  pin?: string | null;
};

export type ResultadoCierre = {
  recepcion: repo.Recepcion;
  lineas: repo.RecepcionLinea[];
  incidencias: repo.Incidencia[];
  albaran: repo.Albaran;
  /** `true` si esta llamada no creó nada porque la clave ya se había usado. */
  repetida: boolean;
};

/**
 * Resuelve quién firma esta recepción, o explica por qué no se puede cerrar.
 *
 * La regla no tiene interruptor: si el centro del albarán tiene operarios
 * dados de alta, uno de ellos tiene que confirmarse con su PIN. Un módulo
 * recién estrenado no tiene ninguno, y entonces firma la sesión: así se puede
 * usar desde el primer día y el día que se dé de alta al primer operario la
 * regla entra sola, sin tocar configuración.
 */
async function quienFirma(ctx: Contexto, albaranId: string, datos: CierreEntrante): Promise<repo.Operario | null> {
  const albaran = await repo.albaranPorId(ctx.empresaId, albaranId);
  const centroId = albaran ? (await repo.pedidoPorId(ctx.empresaId, albaran.pedidoId))?.centroId ?? null : null;
  const disponibles = await repo.listarOperarios(ctx.empresaId, { centroId, soloActivos: true });

  const operarioId = datos.operarioId?.trim() || null;
  if (!operarioId) {
    if (disponibles.length === 0) return null;
    throw new ErrorRecepciones("OPERARIO_REQUERIDO", "Elige quién recibe la mercancía y confirma con su PIN.", 400, {
      operarios: disponibles.map((o) => ({ id: o.id, nombre: o.nombre })),
    });
  }
  return verificarOperario(ctx, operarioId, String(datos.pin ?? ""), centroId);
}

export async function cerrarRecepcion(ctx: Contexto, albaranId: string, datos: CierreEntrante): Promise<ResultadoCierre> {
  const userId = usuarioObligatorio(ctx);
  if (datos.resultado !== "OK" && datos.resultado !== "CON_INCIDENCIA") {
    throw new ErrorRecepciones("RESULTADO_INVALIDO", "El resultado tiene que ser OK o CON_INCIDENCIA.");
  }
  const clave = datos.idempotencyKey?.trim() || null;

  // Quién firma. Se resuelve ANTES de abrir la transacción: verificar el PIN
  // escribe (los fallos acumulados) y eso no puede irse con el rollback del
  // cierre. El padrón manda: si hay operarios para este centro, hay que elegir
  // uno; si no hay ninguno todavía, firma la sesión y el módulo sigue usable.
  const operario = await quienFirma(ctx, albaranId, datos);

  const resultado = await repo.enTransaccion(async (c) => {
    // 1. El cerrojo. Todo lo que sigue se lee con el albarán bloqueado.
    const albaran = await repo.bloquearAlbaran(ctx.empresaId, albaranId, c);
    if (!albaran) throw new ErrorRecepciones("ALBARAN_NO_ENCONTRADO", "Albarán no encontrado.", 404);

    // 2. Un doble toque con la misma clave devuelve lo que ya se creó.
    if (clave) {
      const previa = await repo.recepcionPorIdempotencia(ctx.empresaId, clave, c);
      if (previa) {
        return {
          recepcion: previa,
          lineas: await repo.lineasDeRecepcion(ctx.empresaId, previa.id, c),
          incidencias: await repo.listarIncidencias(ctx.empresaId, { recepcionId: previa.id }, c),
          albaran,
          repetida: true,
        };
      }
    }

    if (!ALBARAN_RECIBIBLE.includes(albaran.estado) || albaran.cerradoAt) {
      throw new ErrorRecepciones(
        "ALBARAN_NO_RECIBIBLE",
        `El albarán ${albaran.numeroProveedor} ya no admite recepciones (estado ${albaran.estado}).`,
        409
      );
    }

    // 3. Lo pendiente se calcula con lo que hay en la base AHORA, no con lo que
    //    vio la pantalla al abrirse.
    const lineasAlbaran = await repo.lineasDeAlbaran(ctx.empresaId, albaranId, c, true);
    const totalPendiente = lineasAlbaran.reduce((s, l) => s + pendienteDeRecibir(l.cantidadExpedida, l.cantidadRecibida), 0);
    if (totalPendiente <= 0) {
      throw new ErrorRecepciones(
        "NADA_PENDIENTE",
        `El albarán ${albaran.numeroProveedor} ya está recibido por completo.`,
        409
      );
    }

    // 4. Qué cantidad se da por recibida en cada línea.
    const recibidas = new Map<string, { cantidad: number; incidencia: LineaRecibida["incidencia"] }>();
    if (datos.resultado === "CON_INCIDENCIA") {
      for (const l of datos.lineas ?? []) {
        if (!lineasAlbaran.some((x) => x.id === l.albaranLineaId)) {
          throw new ErrorRecepciones("LINEA_NO_ENCONTRADA", "Una de las líneas no pertenece a este albarán.");
        }
        if (l.incidencia && !esTipoIncidencia(l.incidencia.tipo)) {
          throw new ErrorRecepciones("TIPO_INCIDENCIA_INVALIDO", `Tipo de incidencia no válido: ${l.incidencia.tipo}.`);
        }
        recibidas.set(l.albaranLineaId, {
          cantidad: cantidad(l.cantidadRecibida, "La cantidad recibida", { permitirCero: true }),
          incidencia: l.incidencia ?? null,
        });
      }
    }

    const pedido = await repo.pedidoPorId(ctx.empresaId, albaran.pedidoId, c);
    const numero = await repo.siguienteNumero(ctx.empresaId, "REC", c);

    // 5. La recepción: usuario y hora los pone el servidor.
    const recepcion = await repo.crearRecepcion(
      ctx.empresaId,
      {
        numero,
        albaranId,
        pedidoId: albaran.pedidoId,
        proveedorId: albaran.proveedorId,
        centroId: pedido?.centroId ?? null,
        centroNombre: pedido?.centroNombre ?? "",
        resultado: datos.resultado,
        recibidoPor: userId,
        recibidoNombre: ctx.userNombre,
        operarioId: operario?.id ?? null,
        operarioNombre: operario?.nombre ?? null,
        observaciones: datos.observaciones?.trim() || null,
        idempotencyKey: clave,
      },
      c
    );

    const lineasRecepcion: repo.RecepcionLinea[] = [];
    const incidencias: repo.Incidencia[] = [];
    let hayIncidencia = false;

    for (const l of lineasAlbaran) {
      const pendiente = pendienteDeRecibir(l.cantidadExpedida, l.cantidadRecibida);
      const entrada = recibidas.get(l.id);
      // En OK se recibe lo pendiente; con incidencia, lo que diga la pantalla
      // para esa línea y lo pendiente para las que no mencione.
      const recibida = entrada ? entrada.cantidad : pendiente;
      const dif = diferencia(pendiente, recibida);
      const linea = await repo.crearRecepcionLinea(
        ctx.empresaId,
        {
          recepcionId: recepcion.id,
          albaranLineaId: l.id,
          descripcionProveedor: l.descripcionProveedor,
          productoTexto: l.productoTexto,
          cantidadExpedida: l.cantidadExpedida,
          cantidadEsperada: pendiente,
          cantidadRecibida: recibida,
          diferencia: dif,
        },
        c
      );
      lineasRecepcion.push(linea);

      // Incidencia: si la pantalla la marcó, o si las cantidades no cuadran
      // aunque no la marcara (FALTA o SOBRA). Nunca se pierde una diferencia.
      const tipoDeclarado = entrada?.incidencia?.tipo as TipoIncidencia | undefined;
      const tipo: TipoIncidencia | null = tipoDeclarado ?? (dif < 0 ? "FALTA_MERCANCIA" : dif > 0 ? "SOBRA_MERCANCIA" : null);
      if (tipo) {
        hayIncidencia = true;
        const descripcionProducto = l.productoTexto ?? leerDescripcion(l.descripcionProveedor).bonito;
        const incidencia = await repo.crearIncidencia(
          ctx.empresaId,
          {
            recepcionId: recepcion.id,
            recepcionLineaId: linea.id,
            albaranId,
            albaranLineaId: l.id,
            pedidoId: albaran.pedidoId,
            proveedorId: albaran.proveedorId,
            centroId: pedido?.centroId ?? null,
            centroNombre: pedido?.centroNombre ?? "",
            transportista: albaran.transportista,
            tipo,
            descripcionProducto,
            cantidadEsperada: pendiente,
            cantidadRecibida: recibida,
            diferencia: dif,
            observaciones: entrada?.incidencia?.observaciones?.trim() || null,
            userId,
            userNombre: ctx.userNombre,
          },
          c
        );
        incidencias.push(incidencia);
        await repo.anotarEvento(
          ctx.empresaId,
          {
            pedidoId: albaran.pedidoId,
            albaranId,
            recepcionId: recepcion.id,
            incidenciaId: incidencia.id,
            tipo: "INCIDENCIA_ABIERTA",
            usuarioId: ctx.userId,
            usuarioNombre: ctx.userNombre,
            datos: { tipo, esperada: pendiente, recibida, diferencia: dif, producto: descripcionProducto },
            descripcion: `Incidencia ${ETIQUETA_TIPO_INCIDENCIA[tipo]} en ${descripcionProducto}: esperadas ${pendiente}, recibidas ${recibida} (${dif > 0 ? "+" : ""}${dif}).`,
          },
          c
        );
      }
    }

    if (datos.resultado === "OK" && hayIncidencia) {
      // No puede pasar (en OK se recibe lo pendiente), pero si pasara, el
      // resultado guardado tiene que decir la verdad.
      throw new ErrorRecepciones("RESULTADO_INCOHERENTE", "Una recepción OK no puede llevar incidencias.");
    }

    // 6. Acumulados y estados derivados.
    await repo.recalcularLineasAlbaran(ctx.empresaId, albaranId, c);
    const lineasTras = await repo.lineasDeAlbaran(ctx.empresaId, albaranId, c);
    const conIncidencia = hayIncidencia || (await repo.albaranTieneIncidencias(ctx.empresaId, albaranId, c));
    const nuevoEstado = estadoAlbaran(
      lineasTras.map((l) => ({ expedida: l.cantidadExpedida, recibida: l.cantidadRecibida })),
      { conIncidencia, cerrado: Boolean(albaran.cerradoAt) }
    );
    await repo.fijarEstadoAlbaran(ctx.empresaId, albaranId, nuevoEstado, c);
    await recalcularEstadoPedido(ctx.empresaId, albaran.pedidoId, c);

    // 7. Histórico y auditoría, dentro de la transacción: o consta entero o no consta.
    await repo.anotarEvento(
      ctx.empresaId,
      {
        pedidoId: albaran.pedidoId,
        albaranId,
        recepcionId: recepcion.id,
        tipo: datos.resultado === "OK" ? "RECEPCION_OK" : "RECEPCION_CON_INCIDENCIA",
        usuarioId: ctx.userId,
        usuarioNombre: ctx.userNombre,
        datos: {
          numero,
          resultado: datos.resultado,
          lineas: lineasRecepcion.map((l) => ({ albaranLineaId: l.albaranLineaId, esperada: l.cantidadEsperada, recibida: l.cantidadRecibida })),
          estadoAlbaran: nuevoEstado,
          operario: operario ? { id: operario.id, nombre: operario.nombre } : null,
          sesion: ctx.userNombre,
        },
        // Quién contó primero, y desde qué sesión se registró después: el
        // histórico responde a las dos preguntas sin tener que cruzar tablas.
        descripcion:
          `Recepción ${numero}: ${datos.resultado === "OK" ? "OK, mercancía recibida conforme al albarán" : `CON INCIDENCIA (${incidencias.length})`}. ` +
          `Recibido por ${operario ? operario.nombre : ctx.userNombre}` +
          `${operario ? ` (PIN confirmado; registrado desde la sesión de ${ctx.userNombre})` : ""}.`,
      },
      c
    );
    await registrarAuditoriaEnTransaccion(c, {
      empresaId: ctx.empresaId,
      userId: ctx.userId,
      accion: "recepciones.cerrar",
      entidad: "rcp_recepciones",
      entidadId: recepcion.id,
      detalle: {
        numero,
        albaran: albaran.numeroProveedor,
        pedido: albaran.pedidoNumero,
        resultado: datos.resultado,
        incidencias: incidencias.length,
        operario: operario?.nombre ?? null,
      },
      ip: ctx.ip,
    });

    return {
      recepcion,
      lineas: lineasRecepcion,
      incidencias,
      albaran: (await repo.albaranPorId(ctx.empresaId, albaranId, c))!,
      repetida: false,
    };
  });

  // 8. El documento, DESPUÉS del COMMIT. Que falle el PDF no puede deshacer
  //    una recepción que ya se ha hecho en el muelle: se marca ERROR y se
  //    regenera desde la ficha.
  if (!resultado.repetida) {
    await generarDocumentoSinLanzar(ctx, resultado.recepcion.id);
    resultado.recepcion = (await repo.recepcionPorId(ctx.empresaId, resultado.recepcion.id)) ?? resultado.recepcion;
  }
  return resultado;
}

async function generarDocumentoSinLanzar(ctx: Contexto, recepcionId: string): Promise<void> {
  try {
    await generarDocumentoRecepcion(ctx, recepcionId);
  } catch (e) {
    console.error("[Recepciones] no se ha podido generar el documento de la recepción:", e);
    await repo
      .fijarDocumentoRecepcion(ctx.empresaId, recepcionId, {
        documentoId: null,
        estado: "ERROR",
        error: e instanceof Error ? e.message : String(e),
      })
      .catch(() => {});
  }
}

/** Vuelve a generar el documento de una recepción (tras un ERROR, o tras rectificar). */
export async function regenerarDocumento(ctx: Contexto, recepcionId: string): Promise<repo.Recepcion> {
  const recepcion = await repo.recepcionPorId(ctx.empresaId, recepcionId);
  if (!recepcion) throw new ErrorRecepciones("RECEPCION_NO_ENCONTRADA", "Recepción no encontrada.", 404);
  await generarDocumentoSinLanzar(ctx, recepcionId);
  return (await repo.recepcionPorId(ctx.empresaId, recepcionId))!;
}

/* ── Rectificaciones ─────────────────────────────────────────────────────── */

export type RectificacionEntrante = {
  motivo: string;
  lineas: { recepcionLineaId: string; cantidadRecibida: number | string }[];
};

/**
 * Corrige las cantidades de una recepción cerrada SIN tocar la recepción
 * original en lo que dijo: queda una rectificación numerada con quién, cuándo,
 * por qué y de qué cantidad a cuál. Los acumulados del albarán y del pedido se
 * recalculan con la cantidad corregida, que es la que vale a partir de ahora.
 */
export async function rectificarRecepcion(ctx: Contexto, recepcionId: string, datos: RectificacionEntrante): Promise<repo.Rectificacion> {
  const userId = usuarioObligatorio(ctx);
  const motivo = String(datos.motivo ?? "").trim();
  if (!motivo) throw new ErrorRecepciones("MOTIVO_REQUERIDO", "Una rectificación necesita un motivo.");
  if (!datos.lineas?.length) throw new ErrorRecepciones("SIN_LINEAS", "Indica qué líneas se corrigen.");

  const rectificacion = await repo.enTransaccion(async (c) => {
    const recepcion = await repo.recepcionPorId(ctx.empresaId, recepcionId, c);
    if (!recepcion) throw new ErrorRecepciones("RECEPCION_NO_ENCONTRADA", "Recepción no encontrada.", 404);
    const albaran = await repo.bloquearAlbaran(ctx.empresaId, recepcion.albaranId, c);
    if (!albaran) throw new ErrorRecepciones("ALBARAN_NO_ENCONTRADO", "Albarán no encontrado.", 404);

    const lineas = await repo.lineasDeRecepcion(ctx.empresaId, recepcionId, c);
    const porId = new Map(lineas.map((l) => [l.id, l]));
    const cambios: { recepcionLineaId: string; albaranLineaId: string; cantidadAnterior: number; cantidadNueva: number }[] = [];
    for (const l of datos.lineas) {
      const linea = porId.get(l.recepcionLineaId);
      if (!linea) throw new ErrorRecepciones("LINEA_NO_ENCONTRADA", "Una de las líneas no pertenece a esta recepción.");
      const nueva = cantidad(l.cantidadRecibida, "La cantidad corregida", { permitirCero: true });
      if (nueva === linea.cantidadRecibida) continue;
      cambios.push({ recepcionLineaId: linea.id, albaranLineaId: linea.albaranLineaId, cantidadAnterior: linea.cantidadRecibida, cantidadNueva: nueva });
    }
    if (cambios.length === 0) throw new ErrorRecepciones("SIN_CAMBIOS", "Las cantidades indicadas son las que ya constan.");

    const numero = await repo.siguienteNumero(ctx.empresaId, "RECT", c);
    const r = await repo.crearRectificacion(
      ctx.empresaId,
      { numero, recepcionId, albaranId: albaran.id, motivo, userId, userNombre: ctx.userNombre, lineas: cambios },
      c
    );
    for (const ch of cambios) {
      await repo.rectificarLineaRecepcion(ctx.empresaId, ch.recepcionLineaId, ch.cantidadNueva, c);
    }

    await repo.recalcularLineasAlbaran(ctx.empresaId, albaran.id, c);
    const lineasTras = await repo.lineasDeAlbaran(ctx.empresaId, albaran.id, c);
    const conIncidencia = await repo.albaranTieneIncidencias(ctx.empresaId, albaran.id, c);
    const nuevoEstado = estadoAlbaran(
      lineasTras.map((l) => ({ expedida: l.cantidadExpedida, recibida: l.cantidadRecibida })),
      { conIncidencia, cerrado: Boolean(albaran.cerradoAt) }
    );
    await repo.fijarEstadoAlbaran(ctx.empresaId, albaran.id, nuevoEstado, c);
    await recalcularEstadoPedido(ctx.empresaId, albaran.pedidoId, c);

    await repo.anotarEvento(
      ctx.empresaId,
      {
        pedidoId: albaran.pedidoId,
        albaranId: albaran.id,
        recepcionId,
        tipo: "RECTIFICACION",
        usuarioId: ctx.userId,
        usuarioNombre: ctx.userNombre,
        datos: { numero, motivo, cambios, estadoAlbaran: nuevoEstado },
        descripcion: `Rectificación ${numero} de ${recepcion.numero}: ${motivo}. ${cambios
          .map((ch) => `${ch.cantidadAnterior} → ${ch.cantidadNueva}`)
          .join(", ")}.`,
      },
      c
    );
    await registrarAuditoriaEnTransaccion(c, {
      empresaId: ctx.empresaId,
      userId: ctx.userId,
      accion: "recepciones.rectificar",
      entidad: "rcp_recepciones",
      entidadId: recepcionId,
      detalle: { numero, motivo, cambios },
      ip: ctx.ip,
    });
    return r;
  });

  // El documento se vuelve a generar con las cantidades corregidas y la nota
  // de rectificación. El anterior se conserva: nunca se sobrescribe un fichero.
  await generarDocumentoSinLanzar(ctx, recepcionId);
  return rectificacion;
}

/* ── Incidencias y cierre de albarán ─────────────────────────────────────── */

export async function cambiarEstadoIncidencia(
  ctx: Contexto,
  incidenciaId: string,
  datos: { estado: string; resolucion?: string | null }
): Promise<repo.Incidencia> {
  const userId = usuarioObligatorio(ctx);
  if (!esEstadoIncidencia(datos.estado)) throw new ErrorRecepciones("ESTADO_INVALIDO", `Estado no válido: ${datos.estado}.`);
  const estado: EstadoIncidencia = datos.estado;
  const resolucion = datos.resolucion?.trim() || null;
  if ((estado === "RESUELTA" || estado === "CANCELADA") && !resolucion) {
    throw new ErrorRecepciones("RESOLUCION_REQUERIDA", "Resolver o cancelar una incidencia necesita explicar cómo.");
  }
  return repo.enTransaccion(async (c) => {
    const incidencia = await repo.incidenciaPorId(ctx.empresaId, incidenciaId, c);
    if (!incidencia) throw new ErrorRecepciones("INCIDENCIA_NO_ENCONTRADA", "Incidencia no encontrada.", 404);
    if (incidencia.estado === "RESUELTA" || incidencia.estado === "CANCELADA") {
      throw new ErrorRecepciones("INCIDENCIA_CERRADA", "La incidencia ya está cerrada.", 409);
    }
    await repo.cambiarEstadoIncidencia(ctx.empresaId, incidenciaId, { estado, resolucion, userId, userNombre: ctx.userNombre }, c);
    await repo.anotarEvento(
      ctx.empresaId,
      {
        pedidoId: incidencia.pedidoId,
        albaranId: incidencia.albaranId,
        recepcionId: incidencia.recepcionId,
        incidenciaId,
        tipo: `INCIDENCIA_${estado}`,
        usuarioId: ctx.userId,
        usuarioNombre: ctx.userNombre,
        datos: { anterior: incidencia.estado, nuevo: estado, resolucion },
        descripcion:
          estado === "RESUELTA"
            ? `Incidencia resuelta: ${resolucion}`
            : estado === "CANCELADA"
              ? `Incidencia cancelada: ${resolucion}`
              : `Incidencia en gestión.`,
      },
      c
    );
    return (await repo.incidenciaPorId(ctx.empresaId, incidenciaId, c))!;
  });
}

/**
 * Da un albarán por terminado con unidades de menos: la diferencia se ha
 * aceptado (abono, no va a llegar). Es una decisión de gestor, no del muelle,
 * y deja el albarán RECIBIDO_CON_INCIDENCIA, que es lo que fue.
 */
export async function cerrarAlbaranConDiferencia(ctx: Contexto, albaranId: string, motivo: string): Promise<repo.Albaran> {
  const userId = usuarioObligatorio(ctx);
  const motivoLimpio = String(motivo ?? "").trim();
  if (!motivoLimpio) throw new ErrorRecepciones("MOTIVO_REQUERIDO", "Cerrar un albarán con diferencia necesita un motivo.");
  return repo.enTransaccion(async (c) => {
    const albaran = await repo.bloquearAlbaran(ctx.empresaId, albaranId, c);
    if (!albaran) throw new ErrorRecepciones("ALBARAN_NO_ENCONTRADO", "Albarán no encontrado.", 404);
    if (albaran.cerradoAt) throw new ErrorRecepciones("ALBARAN_YA_CERRADO", "El albarán ya está cerrado.", 409);
    const lineas = await repo.lineasDeAlbaran(ctx.empresaId, albaranId, c);
    if (!lineas.some((l) => l.cantidadRecibida > 0)) {
      throw new ErrorRecepciones("ALBARAN_SIN_RECEPCION", "No se puede cerrar un albarán del que no se ha recibido nada.", 409);
    }
    await repo.cerrarAlbaran(ctx.empresaId, albaranId, { userId, motivo: motivoLimpio }, c);
    const nuevoEstado = estadoAlbaran(
      lineas.map((l) => ({ expedida: l.cantidadExpedida, recibida: l.cantidadRecibida })),
      { conIncidencia: true, cerrado: true }
    );
    await repo.fijarEstadoAlbaran(ctx.empresaId, albaranId, nuevoEstado, c);
    await recalcularEstadoPedido(ctx.empresaId, albaran.pedidoId, c);
    await repo.anotarEvento(
      ctx.empresaId,
      {
        pedidoId: albaran.pedidoId,
        albaranId,
        tipo: "ALBARAN_CERRADO_CON_DIFERENCIA",
        usuarioId: ctx.userId,
        usuarioNombre: ctx.userNombre,
        datos: { motivo: motivoLimpio },
        descripcion: `Albarán cerrado con diferencia aceptada: ${motivoLimpio}`,
      },
      c
    );
    return (await repo.albaranPorId(ctx.empresaId, albaranId, c))!;
  });
}

/* ── El PDF original del proveedor ───────────────────────────────────────── */

/**
 * Guarda el PDF original de un albarán, byte a byte y por hash. Sólo uno por
 * albarán: un segundo es 409, no una sustitución. Misma puerta para la subida
 * manual, el adjunto del correo y la descarga del enlace.
 */
export async function adjuntarOriginal(
  ctx: Contexto,
  albaranId: string,
  contenido: Buffer,
  origen: "SUBIDA_MANUAL" | "CORREO" | "DESCARGA_PROVEEDOR"
): Promise<repo.Documento> {
  if (contenido.subarray(0, 5).toString() !== "%PDF-") throw new ErrorRecepciones("NO_ES_PDF", "El albarán original tiene que ser un PDF.");
  const albaran = await repo.albaranPorId(ctx.empresaId, albaranId);
  if (!albaran) throw new ErrorRecepciones("ALBARAN_NO_ENCONTRADO", "Albarán no encontrado.", 404);
  if (await repo.originalDeAlbaran(ctx.empresaId, albaran.id)) {
    throw new ErrorRecepciones("ORIGINAL_YA_EXISTE", "Este albarán ya tiene su original. No se sobrescribe.", 409);
  }
  const hash = hashDeFichero(contenido);
  const ruta = rutaDocumento(ctx.empresaId, hash);
  await guardarDocumento(ruta, contenido);
  const documento = await repo.crearDocumento(ctx.empresaId, {
    tipo: "ALBARAN_ORIGINAL",
    albaranId: albaran.id,
    recepcionId: null,
    nombreFichero: `${albaran.proveedorCodigo}_${limpio(albaran.numeroProveedor)}_ORIGINAL.pdf`,
    storagePath: ruta,
    hashSha256: hash,
    tamanoBytes: contenido.length,
    mime: "application/pdf",
    origen,
    generadoDesdeHash: null,
    subidoPor: ctx.userId,
    subidoNombre: ctx.userNombre,
  });
  // El PDF dice, después de la línea de gestión de NFU, PARA QUIÉN viene la
  // mercancía («TALLER», «JORGE PLANA», «PEDRO 610473077»). Es el dato que
  // decide dónde se deja el palé, y sólo viaja en el papel: el correo no lo
  // trae. Nunca lanza: un PDF ilegible no puede impedir guardar el albarán.
  const observaciones = observacionesDelPdf(contenido);
  // El móvil sale a su propia columna: dentro de la frase no sirve para avisar
  // a nadie, y aparte es con lo que se podrá mandar el WhatsApp al recibir.
  const partidas = observaciones.map(partirObservacion);
  const texto = partidas.map((o) => o.texto).filter(Boolean).join(" · ") || null;
  const telefono = partidas.find((o) => o.telefono)?.telefono ?? null;
  if (texto || telefono) {
    await repo.anotarObservacionesAlbaran(ctx.empresaId, albaran.id, { texto, telefono });
  }

  await repo.anotarEvento(ctx.empresaId, {
    pedidoId: albaran.pedidoId,
    albaranId: albaran.id,
    tipo: "ORIGINAL_ADJUNTADO",
    actorTipo: ctx.userId ? "usuario" : "sistema",
    usuarioId: ctx.userId,
    usuarioNombre: ctx.userNombre,
    datos: { documentoId: documento.id, hash, origen, observaciones, telefono },
    descripcion:
      `PDF original del albarán ${albaran.numeroProveedor} guardado (${documento.nombreFichero}, ${origen === "SUBIDA_MANUAL" ? "subido a mano" : origen === "CORREO" ? "adjunto del correo" : "descargado del enlace del proveedor"}).` +
      (observaciones.length > 0 ? ` Observaciones del albarán: ${observaciones.join(" · ")}.` : ""),
  });
  return documento;
}

export type ResultadoRelectura = {
  revisados: number;
  completados: number;
  sinObservaciones: number;
  errores: number;
  detalle: { albaran: string; observaciones: string | null; telefono: string | null; error?: string }[];
};

/**
 * Relee los PDF ya guardados y rellena la observación y el teléfono donde
 * falten.
 *
 * Hace falta porque la lectura del papel ocurre al GUARDARLO, y los albaranes
 * que entraron antes de que el módulo supiera leer esa parte se quedaron sin
 * ella. Volver a adjuntar el PDF no vale: el original no se sobrescribe, y con
 * razón.
 *
 * Sólo RELLENA huecos —lo escrito a mano no se pisa, y lo que ya tiene valor
 * se queda—, así que repetirla es inofensivo. Un PDF que falle no para al
 * resto: se cuenta y se sigue.
 */
export async function releerObservaciones(ctx: Contexto, limite = 200): Promise<ResultadoRelectura> {
  const pendientes = await repo.albaranesSinObservaciones(ctx.empresaId, limite);
  const r: ResultadoRelectura = { revisados: 0, completados: 0, sinObservaciones: 0, errores: 0, detalle: [] };

  for (const a of pendientes) {
    r.revisados += 1;
    try {
      const pdf = await leerDelAlmacen(a.storagePath);
      if (!pdf) {
        r.errores += 1;
        r.detalle.push({ albaran: a.numeroProveedor, observaciones: null, telefono: null, error: "El PDF no está en el almacén." });
        continue;
      }
      const partidas = observacionesDelPdf(pdf).map(partirObservacion);
      const texto = partidas.map((o) => o.texto).filter(Boolean).join(" · ") || null;
      const telefono = partidas.find((o) => o.telefono)?.telefono ?? null;
      if (!texto && !telefono) {
        r.sinObservaciones += 1;
        continue;
      }
      await repo.anotarObservacionesAlbaran(ctx.empresaId, a.id, { texto, telefono });
      r.completados += 1;
      r.detalle.push({ albaran: a.numeroProveedor, observaciones: texto, telefono });
    } catch (e) {
      r.errores += 1;
      r.detalle.push({ albaran: a.numeroProveedor, observaciones: null, telefono: null, error: (e as Error).message });
    }
  }

  // La auditoría la deja la ruta, como el resto de acciones sin transacción.
  return r;
}

const DESCARGA_TIMEOUT_MS = 20_000;
const DESCARGA_MAX_BYTES = 15 * 1024 * 1024;

/**
 * Descarga el PDF del albarán desde el enlace que trae el correo del
 * proveedor y lo guarda como original. Sin enlace explícito, usa el que quedó
 * en el albarán. Sólo HTTPS/HTTP, con tiempo y tamaño acotados, y sólo si lo
 * que vuelve es un PDF de verdad: un portal que devuelva una página de login
 * no se guarda como albarán.
 */
export async function descargarOriginal(ctx: Contexto, albaranId: string, enlace?: string | null): Promise<repo.Documento> {
  const albaran = await repo.albaranPorId(ctx.empresaId, albaranId);
  if (!albaran) throw new ErrorRecepciones("ALBARAN_NO_ENCONTRADO", "Albarán no encontrado.", 404);
  const url = (enlace ?? "").trim() || (await enlaceGuardado(ctx.empresaId, albaranId));
  if (!url) throw new ErrorRecepciones("SIN_ENLACE", "El albarán no tiene enlace al PDF del proveedor.");
  if (!/^https?:\/\//i.test(url)) throw new ErrorRecepciones("ENLACE_INVALIDO", "El enlace tiene que ser http(s).");

  const controlador = new AbortController();
  const temporizador = setTimeout(() => controlador.abort(), DESCARGA_TIMEOUT_MS);
  let contenido: Buffer;
  try {
    const r = await fetch(url, { signal: controlador.signal, redirect: "follow", headers: { Accept: "application/pdf,*/*" } });
    if (!r.ok) throw new ErrorRecepciones("DESCARGA_FALLIDA", `El proveedor ha contestado ${r.status} al pedir el PDF.`, 502);
    const largo = Number(r.headers.get("content-length") ?? 0);
    if (largo > DESCARGA_MAX_BYTES) throw new ErrorRecepciones("PDF_DEMASIADO_GRANDE", "El PDF supera los 15 MB.", 502);
    const bytes = Buffer.from(await r.arrayBuffer());
    if (bytes.length > DESCARGA_MAX_BYTES) throw new ErrorRecepciones("PDF_DEMASIADO_GRANDE", "El PDF supera los 15 MB.", 502);
    contenido = bytes;
  } catch (e) {
    if (e instanceof ErrorRecepciones) throw e;
    throw new ErrorRecepciones("DESCARGA_FALLIDA", `No se ha podido descargar el PDF: ${e instanceof Error ? e.message : String(e)}`, 502);
  } finally {
    clearTimeout(temporizador);
  }
  if (contenido.subarray(0, 5).toString() !== "%PDF-") {
    throw new ErrorRecepciones("NO_ES_PDF", "Lo que devuelve el enlace no es un PDF (¿pide sesión en el portal del proveedor?).", 502);
  }
  return adjuntarOriginal(ctx, albaranId, contenido, "DESCARGA_PROVEEDOR");
}

async function enlaceGuardado(empresaId: string, albaranId: string): Promise<string | null> {
  const { rows } = await (await import("../db.ts")).default.query<{ enlace: string | null }>(
    `SELECT enlace_pdf_proveedor AS enlace FROM rcp_albaranes WHERE empresa_id = $1 AND id = $2`,
    [empresaId, albaranId]
  );
  return rows[0]?.enlace ?? null;
}

/* ── Ayudantes ───────────────────────────────────────────────────────────── */

function usuarioObligatorio(ctx: Contexto): string {
  if (!ctx.userId) throw new ErrorRecepciones("USUARIO_REQUERIDO", "Esta operación necesita un usuario autenticado.", 401);
  return ctx.userId;
}

/**
 * Recalcula los acumulados del pedido y su estado a partir de sus albaranes.
 * Un albarán cerrado con diferencia aceptada cuenta como si lo que falta se
 * hubiera recibido A EFECTOS DEL PEDIDO: el proveedor ya no lo va a mandar.
 */
async function recalcularEstadoPedido(empresaId: string, pedidoId: string, c: repo.Ejecutor): Promise<void> {
  // Primero los acumulados de las líneas (suma de albaranes)…
  await repo.recalcularLineasPedido(empresaId, pedidoId, c);
  // …y con ellos el estado derivado.
  const pedido = await repo.pedidoPorId(empresaId, pedidoId, c);
  const lineas = await repo.lineasDePedido(empresaId, pedidoId, c);
  const albaranes = await repo.albaranesDePedido(empresaId, pedidoId, c);
  const cerrados = new Set(albaranes.filter((a) => a.cerradoAt).map((a) => a.id));
  let ajustadas = lineas.map((l) => ({ pedida: l.cantidadPedida, expedida: l.cantidadExpedida, recibida: l.cantidadRecibida }));
  if (cerrados.size > 0) {
    const porLinea = new Map(lineas.map((l) => [l.id, { ...l }]));
    for (const a of albaranes) {
      if (!cerrados.has(a.id)) continue;
      for (const al of await repo.lineasDeAlbaran(empresaId, a.id, c)) {
        const lp = al.pedidoLineaId ? porLinea.get(al.pedidoLineaId) : undefined;
        if (lp) lp.cantidadRecibida = redondear(lp.cantidadRecibida + pendienteDeRecibir(al.cantidadExpedida, al.cantidadRecibida));
      }
    }
    ajustadas = [...porLinea.values()].map((l) => ({ pedida: l.cantidadPedida, expedida: l.cantidadExpedida, recibida: l.cantidadRecibida }));
  }
  const estado = estadoPedido(ajustadas, pedido?.estado === "CANCELADO" || Boolean(pedido?.canceladoAt));
  await repo.fijarEstadoPedido(empresaId, pedidoId, estado, c);
}

function fechaISO(v: unknown, campo: string): string | null {
  const s = typeof v === "string" ? v.trim() : "";
  if (!s) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new ErrorRecepciones("FECHA_INVALIDA", `${campo} no es válida: ${s}. Se espera aaaa-mm-dd.`);
  return s;
}

function centimos(v: unknown, linea: number): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v));
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) {
    throw new ErrorRecepciones("IMPORTE_INVALIDO", `El precio de la línea ${linea} tiene que venir en céntimos enteros.`);
  }
  return n;
}
