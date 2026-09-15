/**
 * Meter un correo del proveedor en el módulo.
 *
 * Es el caso de uso central de la fase 2: llega un correo de Soledad y hay que
 * decidir si es un pedido nuevo, un albarán de un pedido que ya existe, algo
 * que ya se procesó, o algo que no se entiende y tiene que mirar una persona.
 *
 * ── Dos puertas, un camino ──────────────────────────────────────────────────
 *
 * El buzón IMAP y el `.eml` importado a mano acaban aquí, en `procesarCorreo`,
 * con los mismos campos. Y lo que crea son pedidos y albaranes por las MISMAS
 * funciones que el alta manual (`service.crearPedido`, `service.crearAlbaran`):
 * el correo no tiene una lógica de negocio propia, sólo lee y llama.
 *
 * ── La idempotencia ─────────────────────────────────────────────────────────
 *
 * El mismo correo dos veces tiene que dar exactamente lo mismo que una. La
 * garantía es el UNIQUE de `(empresa_id, message_id)` en `rcp_correos`, y
 * detrás los UNIQUE por número normalizado de pedidos y albaranes: aunque el
 * mismo pedido llegara con dos Message-ID distintos, el segundo sería
 * DUPLICADO y quedaría enlazado al pedido que ya existe.
 *
 * ── Cuando no se sabe, se pregunta ──────────────────────────────────────────
 *
 * Un albarán cuyo pedido no existe todavía no se inventa: queda
 * PENDIENTE_REVISION con el número que buscaba, y cuando llegue el pedido (el
 * correo del pedido puede entrar después que el del albarán) se reprocesa
 * solo. Un pedido sin líneas, o un correo que no se reconoce, también quedan
 * en revisión: lo que no se entiende no se convierte en un pedido a medias.
 */

import { createHash } from "node:crypto";
import { asumirExpedicionCompleta } from "./config.ts";
import { descripcionNormalizada } from "./domain/articulos.ts";
import { pendienteDeExpedir } from "./domain/cantidades.ts";
import { normalizar, parsearCorreo, remitenteReenviado, type CorreoParseado } from "./domain/correo/index.ts";
import { normalizarNumero } from "./domain/numero.ts";
import { ErrorRecepciones } from "./errors.ts";
import * as repo from "./repository.ts";
import * as servicio from "./service.ts";

export type AdjuntoPdf = { nombre: string; contenido: Buffer };

export type CorreoEntrante = {
  messageId: string;
  inReplyTo?: string | null;
  /** ISO. */
  fecha: string;
  de: string;
  asunto: string;
  /** El cuerpo entero. Se guarda tal cual y NUNCA se edita. */
  texto: string;
  adjuntosPdf?: AdjuntoPdf[];
  origen: "buzon" | "eml" | "api";
};

export type ResultadoIngesta = {
  correoId: string;
  resultado: repo.ResultadoCorreo;
  tipo: "PEDIDO" | "ALBARAN" | "DESCONOCIDO";
  motivo: string | null;
  pedidoId: string | null;
  pedidoNumero: string | null;
  albaranId: string | null;
  albaranNumero: string | null;
  avisos: string[];
};

/** El usuario «sistema» con el que se firman los altas que vienen del correo. */
const NOMBRE_SISTEMA = "Correo del proveedor";

function hashDeContenido(asunto: string, texto: string): string {
  return createHash("sha256").update(`${normalizar(asunto)}\n${normalizar(texto)}`).digest("hex");
}

/** ¿El remitente encaja con una de las direcciones o dominios admitidos? */
export function remitenteCasa(remitente: string, admitido: string): boolean {
  const r = remitente.toLowerCase().trim();
  const a = admitido.toLowerCase().trim().replace(/^@/, "");
  if (!r || !a) return false;
  if (a.includes("@")) return r === a;
  return r.endsWith(`@${a}`) || r.endsWith(`.${a}`);
}

async function proveedorDe(empresaId: string, remitente: string): Promise<repo.Proveedor | null> {
  const proveedores = (await repo.listarProveedores(empresaId)).filter((p) => p.activo);
  const porRemitente = proveedores.find((p) => p.remitentesCorreo.some((a) => remitenteCasa(remitente, a)));
  if (porRemitente) return porRemitente;
  // Sin lista de remitentes y un único proveedor: es él. Con varios sin
  // lista no se adivina.
  const sinLista = proveedores.filter((p) => p.remitentesCorreo.length === 0);
  if (proveedores.length === 1 && sinLista.length === 1) return sinLista[0];
  return null;
}

/* ── El caso de uso ──────────────────────────────────────────────────────── */

export async function procesarCorreo(ctx: { empresaId: string }, entrada: CorreoEntrante): Promise<ResultadoIngesta> {
  const { correo, nuevo } = await repo.registrarCorreo(ctx.empresaId, {
    messageId: entrada.messageId,
    inReplyTo: entrada.inReplyTo ?? null,
    hashContenido: hashDeContenido(entrada.asunto, entrada.texto),
    asunto: entrada.asunto,
    remitente: entrada.de || null,
    fecha: entrada.fecha,
    texto: entrada.texto,
    origen: entrada.origen,
  });

  // Ya procesado: exactamente lo mismo que la primera vez, sin tocar nada.
  if (!nuevo && (correo.resultado === "PROCESADO" || correo.resultado === "DUPLICADO" || correo.resultado === "IGNORADO")) {
    return {
      correoId: correo.id,
      resultado: "DUPLICADO",
      tipo: correo.tipo,
      motivo: "Este correo ya se había procesado.",
      pedidoId: correo.pedidoId,
      pedidoNumero: correo.pedidoNumero,
      albaranId: correo.albaranId,
      albaranNumero: correo.albaranNumero,
      avisos: [],
    };
  }

  return reprocesar(ctx, correo.id, entrada.adjuntosPdf ?? []);
}

/**
 * (Re)procesa un correo ya registrado a partir de lo guardado. Es lo que usa
 * el botón «Reprocesar» y lo que se dispara solo cuando llega el pedido que
 * un albarán esperaba. Nunca lanza: lo que falle queda escrito en el correo.
 */
export async function reprocesar(ctx: { empresaId: string }, correoId: string, adjuntosPdf: AdjuntoPdf[] = []): Promise<ResultadoIngesta> {
  const correo = await repo.correoPorId(ctx.empresaId, correoId);
  if (!correo) throw new ErrorRecepciones("CORREO_NO_ENCONTRADO", "Correo no encontrado.", 404);

  const terminar = async (
    datos: Omit<Partial<ResultadoIngesta>, "correoId"> & { resultado: repo.ResultadoCorreo; motivo: string | null },
    extra: { proveedorId?: string | null; tipo?: CorreoParseado["tipo"]; datosExtraidos?: unknown } = {}
  ): Promise<ResultadoIngesta> => {
    await repo.actualizarCorreo(ctx.empresaId, correoId, {
      proveedorId: extra.proveedorId ?? null,
      tipo: extra.tipo,
      resultado: datos.resultado,
      motivo: datos.motivo,
      datosExtraidos: extra.datosExtraidos,
      avisos: datos.avisos,
      pedidoId: datos.pedidoId ?? null,
      albaranId: datos.albaranId ?? null,
    });
    return {
      correoId,
      resultado: datos.resultado,
      tipo: extra.tipo ?? correo.tipo,
      motivo: datos.motivo,
      pedidoId: datos.pedidoId ?? null,
      pedidoNumero: datos.pedidoNumero ?? null,
      albaranId: datos.albaranId ?? null,
      albaranNumero: datos.albaranNumero ?? null,
      avisos: datos.avisos ?? [],
    };
  };

  try {
    // Si el correo llega reenviado por una persona, el remitente del sobre es
    // ella, no el proveedor: se mira también el «From:» del bloque reenviado.
    // Sólo para saber DE QUIÉN es; quién puede meter correo lo sigue
    // decidiendo el remitente del sobre, antes de llegar hasta aquí.
    const reenviadoPor = remitenteReenviado(correo.texto);
    const proveedor =
      (await proveedorDe(ctx.empresaId, correo.remitente ?? "")) ?? (reenviadoPor ? await proveedorDe(ctx.empresaId, reenviadoPor) : null);
    if (!proveedor) {
      const quien = reenviadoPor ? `${correo.remitente ?? "(vacío)"} (reenvía un correo de ${reenviadoPor})` : (correo.remitente ?? "(vacío)");
      return terminar({ resultado: "IGNORADO", motivo: `El remitente ${quien} no es de ningún proveedor conocido.` });
    }

    const leido = parsearCorreo(correo.asunto, correo.texto);
    const base = { proveedorId: proveedor.id, tipo: leido.tipo, datosExtraidos: leido };
    if (leido.tipo === "DESCONOCIDO") {
      return terminar({ resultado: "IGNORADO", motivo: "No se reconoce como pedido ni como albarán.", avisos: leido.avisos }, base);
    }

    const ctxSistema: servicio.Contexto = { empresaId: ctx.empresaId, userId: null, userNombre: NOMBRE_SISTEMA };

    /* ── Pedido ──────────────────────────────────────────────────────────── */
    if (leido.tipo === "PEDIDO" && leido.pedido) {
      const p = leido.pedido;
      const numeroNormalizado = normalizarNumero(p.numeroPedido);
      const lineas = p.lineas.filter((l) => l.descripcion && l.cantidad && l.cantidad > 0);
      if (!numeroNormalizado || lineas.length === 0) {
        return terminar(
          { resultado: "PENDIENTE_REVISION", motivo: !numeroNormalizado ? "El correo no trae número de pedido." : "El correo no trae líneas de producto legibles.", avisos: leido.avisos },
          base
        );
      }

      const existente = await repo.pedidoPorNumero(ctx.empresaId, proveedor.id, numeroNormalizado);
      if (existente) {
        const r = await terminar(
          { resultado: "DUPLICADO", motivo: `El pedido ${existente.numeroProveedor} ya existía.`, pedidoId: existente.id, pedidoNumero: existente.numeroProveedor, avisos: leido.avisos },
          base
        );
        await despertarAlbaranesEnEspera(ctx, numeroNormalizado);
        return r;
      }

      const centro = await centroDe(ctx.empresaId, p.destinoLocalidad);
      const ficha = await servicio.crearPedido(ctxSistema, {
        proveedorId: proveedor.id,
        numeroProveedor: p.numeroPedido!,
        fechaPedido: p.fecha,
        usuarioPedido: p.usuario,
        centroId: centro?.id ?? null,
        centroNombre: centro?.nombre ?? p.destinoLocalidad ?? "",
        almacenOrigen: p.almacenOrigen,
        transportista: p.transportista,
        destinoTexto: p.destino,
        clienteProveedor: p.cliente,
        lineas: lineas.map((l) => ({
          descripcionProveedor: l.descripcion!,
          referenciaProveedor: l.referencia,
          cantidadPedida: l.cantidad!,
          precioUnitarioCentimos: l.precioCentimos,
        })),
        origen: "CORREO",
        externalMessageId: correo.messageId,
        sourceReceivedAt: correo.fecha,
      });
      const r = await terminar(
        {
          resultado: "PROCESADO",
          motivo: centro ? null : p.destinoLocalidad ? `Centro «${p.destinoLocalidad}» sin correspondencia en app_centros.` : "Sin destino legible.",
          pedidoId: ficha.pedido.id,
          pedidoNumero: ficha.pedido.numeroProveedor,
          avisos: leido.avisos,
        },
        base
      );
      await despertarAlbaranesEnEspera(ctx, numeroNormalizado);
      return r;
    }

    /* ── Albarán ─────────────────────────────────────────────────────────── */
    if (leido.tipo === "ALBARAN" && leido.albaran) {
      const a = leido.albaran;
      const pedidoNormalizado = normalizarNumero(a.numeroPedido);
      const albaranNormalizado = normalizarNumero(a.numeroAlbaran);
      const datos = { ...leido, pedidoNormalizado, albaranNormalizado };
      const baseA = { ...base, datosExtraidos: datos };
      if (!pedidoNormalizado || !albaranNormalizado) {
        return terminar({ resultado: "PENDIENTE_REVISION", motivo: "El correo no trae número de pedido o de albarán.", avisos: leido.avisos }, baseA);
      }

      const pedido = await repo.pedidoPorNumero(ctx.empresaId, proveedor.id, pedidoNormalizado);
      if (!pedido) {
        return terminar(
          { resultado: "PENDIENTE_REVISION", motivo: `El pedido ${a.numeroPedido} no existe todavía. Se reprocesará cuando llegue.`, avisos: leido.avisos },
          baseA
        );
      }

      // ¿Ya está este albarán? Entonces el correo es un duplicado del que lo creó.
      const albaranes = await repo.albaranesDePedido(ctx.empresaId, pedido.id);
      const yaExiste = albaranes.find((x) => x.numeroNormalizado === albaranNormalizado);
      if (yaExiste) {
        await adjuntarOriginalSiFalta(ctxSistema, yaExiste.id, adjuntosPdf, a.enlacesPdf);
        return terminar(
          { resultado: "DUPLICADO", motivo: `El albarán ${yaExiste.numeroProveedor} ya existía.`, pedidoId: pedido.id, pedidoNumero: pedido.numeroProveedor, albaranId: yaExiste.id, albaranNumero: yaExiste.numeroProveedor, avisos: leido.avisos },
          baseA
        );
      }

      const lineasPedido = await repo.lineasDePedido(ctx.empresaId, pedido.id);
      const lineas = lineasDelAlbaran(a, lineasPedido, await asumirExpedicionCompleta(ctx.empresaId));
      if (lineas.length === 0) {
        return terminar(
          {
            resultado: "PENDIENTE_REVISION",
            motivo: lineasPedido.every((l) => pendienteDeExpedir(l.cantidadPedida, l.cantidadExpedida) === 0)
              ? `El pedido ${pedido.numeroProveedor} no tiene nada pendiente de expedir.`
              : "El correo no dice qué se ha expedido y no se asume la expedición completa.",
            pedidoId: pedido.id,
            pedidoNumero: pedido.numeroProveedor,
            avisos: leido.avisos,
          },
          baseA
        );
      }

      const ficha = await servicio.crearAlbaran(ctxSistema, pedido.id, {
        numeroProveedor: a.numeroAlbaran!,
        fechaExpedicion: a.fecha ?? (correo.fecha ? correo.fecha.slice(0, 10) : null),
        transportista: a.transportista,
        lineas,
        origen: "CORREO",
        externalMessageId: correo.messageId,
        sourceReceivedAt: correo.fecha,
        enlacePdfProveedor: a.enlacesPdf[0] ?? null,
      });
      const albaran = ficha.albaranes.find((x) => x.numeroNormalizado === albaranNormalizado)!;
      const avisoPdf = await adjuntarOriginalSiFalta(ctxSistema, albaran.id, adjuntosPdf, a.enlacesPdf);
      return terminar(
        {
          resultado: "PROCESADO",
          motivo: avisoPdf,
          pedidoId: pedido.id,
          pedidoNumero: pedido.numeroProveedor,
          albaranId: albaran.id,
          albaranNumero: albaran.numeroProveedor,
          avisos: leido.avisos,
        },
        baseA
      );
    }

    return terminar({ resultado: "IGNORADO", motivo: "Sin contenido que procesar.", avisos: leido.avisos }, base);
  } catch (e) {
    const mensaje = e instanceof Error ? e.message : String(e);
    console.error(`[Recepciones] correo ${correo.messageId}:`, mensaje);
    return terminar({ resultado: "ERROR", motivo: mensaje });
  }
}

/* ── Ayudantes ───────────────────────────────────────────────────────────── */

/**
 * Qué líneas lleva el albarán, en este orden de preferencia:
 *   1. las líneas que detalla el correo, casadas con las del pedido por la
 *      descripción normalizada (las que no casan entran como fuera de pedido);
 *   2. una «cantidad expedida» total, si el pedido tiene una sola línea;
 *   3. todo lo pendiente de expedir del pedido, si la configuración lo asume.
 * Nunca más de lo pendiente en una línea: el resto lo rechazaría el servicio.
 */
export function lineasDelAlbaran(
  a: { lineas: { cantidad: number | null; descripcion: string | null; referencia: string | null }[]; cantidadExpedida: number | null },
  lineasPedido: repo.PedidoLinea[],
  asumirCompleta: boolean
): servicio.LineaAlbaranEntrante[] {
  const pendiente = (l: repo.PedidoLinea) => pendienteDeExpedir(l.cantidadPedida, l.cantidadExpedida);
  const conPendiente = lineasPedido.filter((l) => pendiente(l) > 0);

  const detalladas = a.lineas.filter((l) => l.cantidad && l.cantidad > 0);
  if (detalladas.length > 0) {
    const usadas = new Set<string>();
    return detalladas.map((l) => {
      const clave = l.descripcion ? descripcionNormalizada(l.descripcion) : "";
      const lp = lineasPedido.find((x) => !usadas.has(x.id) && clave && descripcionNormalizada(x.descripcionProveedor) === clave);
      if (lp) usadas.add(lp.id);
      const cantidad = lp ? Math.min(l.cantidad!, pendiente(lp)) : l.cantidad!;
      return { pedidoLineaId: lp?.id ?? null, descripcionProveedor: l.descripcion ?? lp?.descripcionProveedor ?? "", referenciaProveedor: l.referencia, cantidadExpedida: cantidad };
    }).filter((l) => l.cantidadExpedida > 0 && l.descripcionProveedor);
  }

  if (a.cantidadExpedida && a.cantidadExpedida > 0 && conPendiente.length === 1) {
    const lp = conPendiente[0];
    return [{ pedidoLineaId: lp.id, cantidadExpedida: Math.min(a.cantidadExpedida, pendiente(lp)) }];
  }

  if (asumirCompleta) {
    return conPendiente.map((lp) => ({ pedidoLineaId: lp.id, cantidadExpedida: pendiente(lp) }));
  }
  return [];
}

/** El centro de `app_centros` cuyo nombre coincide con la localidad del destino. */
async function centroDe(empresaId: string, localidad: string | null): Promise<repo.Centro | null> {
  if (!localidad) return null;
  const centros = await repo.listarCentros(empresaId);
  const l = normalizar(localidad);
  return centros.find((c) => c.activo && normalizar(c.nombre) === l) ?? centros.find((c) => c.activo && (normalizar(c.nombre).includes(l) || l.includes(normalizar(c.nombre)))) ?? null;
}

/**
 * El PDF original: primero el adjunto del correo, si lo hay; si no, el
 * enlace. Nunca lanza: devuelve un aviso si no se pudo, y el albarán guarda el
 * enlace para reintentarlo desde la ficha.
 */
async function adjuntarOriginalSiFalta(ctx: servicio.Contexto, albaranId: string, adjuntos: AdjuntoPdf[], enlaces: string[]): Promise<string | null> {
  if (await repo.originalDeAlbaran(ctx.empresaId, albaranId)) return null;
  const pdf = adjuntos.find((x) => x.contenido.subarray(0, 5).toString() === "%PDF-");
  if (pdf) {
    await servicio.adjuntarOriginal(ctx, albaranId, pdf.contenido, "CORREO");
    return null;
  }
  if (enlaces.length === 0) return "El correo no trae el PDF del albarán (ni adjunto ni enlace).";
  try {
    await servicio.descargarOriginal(ctx, albaranId, enlaces[0]);
    return null;
  } catch (e) {
    return `No se ha podido descargar el PDF del albarán: ${e instanceof Error ? e.message : String(e)}`;
  }
}

/** Reprocesa los correos de albarán que esperaban a este pedido. */
async function despertarAlbaranesEnEspera(ctx: { empresaId: string }, numeroPedidoNormalizado: string): Promise<void> {
  for (const c of await repo.correosDeAlbaranEnEspera(ctx.empresaId, numeroPedidoNormalizado)) {
    await reprocesar(ctx, c.id);
  }
}
