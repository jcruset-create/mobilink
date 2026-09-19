/**
 * El buzón: los correos de Soledad entran solos.
 *
 * Molde de `server/therefore/buzon.ts`, que a su vez copia
 * `server/checkpointMail.ts`: una función que hace UNA pasada y se puede
 * llamar a mano, y un temporizador que la repite. Apagado mientras no haya
 * credenciales, y lo dice una vez al arrancar.
 *
 * Lo que este fichero NO hace es entender el correo. Parsea la estructura
 * MIME, saca los PDF adjuntos y llama a `procesarCorreo`, que es la MISMA
 * puerta por la que entra un `.eml` importado a mano desde el panel.
 *
 * ── Se lee sin escribir: el avance se lleva aparte ──────────────────────────
 *
 * El buzón es dedicado (`pedidos@…`, en cdmon; nadie trabaja dentro), pero aun
 * así este módulo NO escribe en él. Cuatro reglas:
 *
 * · NO SE TOCA NINGUNA BANDERA. El progreso va en `rcp_config`
 *   (`buzon.progreso.<carpeta>`): hasta qué UID se miró ya, junto con el
 *   UIDVALIDITY de la carpeta. Se hace así y no con `\Seen` porque el estado
 *   del buzón lo puede cambiar cualquiera —alguien que abra el webmail para
 *   comprobar si llegó un albarán deja «leído» lo que no se ha procesado, y
 *   basta un «marcar como no leído» para volver a procesarlo todo—, mientras
 *   que el UID sólo lo mueve este módulo. Además deja el buzón intacto el día
 *   que alguien mire, y no hace falta permiso de escritura.
 *   Si el servidor renumera la carpeta (UIDVALIDITY distinto), la marca se
 *   descarta y se vuelve a mirar desde el suelo de la activación: repetir es
 *   inofensivo porque el Message-ID ya identifica lo procesado, y perderse un
 *   albarán no lo es.
 * · SÓLO SE LEE LO POSTERIOR A LA ACTIVACIÓN (`buzon.activado_el`, que no
 *   cambia con un reinicio). Lo anterior se carga a propósito con la carga del
 *   histórico, nunca por accidente.
 * · UN CORREO QUE FALLA NO DEJA AVANZAR LA MARCA, así que se reintenta en la
 *   pasada siguiente. Los que vengan detrás sí se procesan; volver a pasarlos
 *   es inocuo (el UNIQUE de `message_id` los reconoce).
 * · SIN REMITENTES CONFIGURADOS NO SE PROCESA NADA. A un buzón dedicado
 *   también le llega publicidad y correo equivocado, y guardarlo sería meter
 *   en la base el cuerpo de correos que no son de nadie de aquí. Los
 *   remitentes admitidos viven en `rcp_proveedores.remitentes_correo`; el
 *   `.eml` importado a mano sí se acepta sin lista, porque lo trae una persona
 *   a propósito.
 *
 * Configuración (variables de entorno):
 *   RECEPCIONES_IMAP_HOST        servidor de entrada
 *   RECEPCIONES_IMAP_PORT        993 por defecto
 *   RECEPCIONES_IMAP_USER        el buzón
 *   RECEPCIONES_IMAP_PASS        su contraseña
 *   RECEPCIONES_IMAP_CARPETA     INBOX por defecto
 *   RECEPCIONES_IMAP_MIN         cada cuántos minutos mirar (5 por defecto)
 *   RECEPCIONES_IMAP_EMPRESA_ID  a qué empresa del SaaS van los pedidos
 */

import { ImapFlow } from "imapflow";
import { simpleParser, type ParsedMail } from "mailparser";
import { fechaDeActivacion, guardarProgresoBuzon, leerProgresoBuzon, type ProgresoBuzon } from "./config.ts";
import { procesarCorreo, remitenteCasa, type AdjuntoPdf, type ResultadoIngesta } from "./ingesta.ts";
import * as repo from "./repository.ts";

const MIN_POR_DEFECTO = 5;
const LOTE = 20;
const LOTE_HISTORICO = 200;
/** La cabecera `Date` la pone el reloj del remitente: cinco minutos de margen. */
const MARGEN_ACTIVACION_MS = 5 * 60_000;

export type ConfigBuzon = {
  host: string;
  port: number;
  user: string;
  pass: string;
  carpeta: string;
  minutos: number;
  empresaId: string;
};

export function configBuzon(): ConfigBuzon | null {
  const host = process.env.RECEPCIONES_IMAP_HOST;
  const user = process.env.RECEPCIONES_IMAP_USER;
  const pass = process.env.RECEPCIONES_IMAP_PASS;
  const empresaId = process.env.RECEPCIONES_IMAP_EMPRESA_ID;
  if (!host || !user || !pass || !empresaId) return null;
  return {
    host,
    user,
    pass,
    empresaId,
    port: Number(process.env.RECEPCIONES_IMAP_PORT || 993),
    carpeta: process.env.RECEPCIONES_IMAP_CARPETA || "INBOX",
    minutos: Math.max(1, Number(process.env.RECEPCIONES_IMAP_MIN || MIN_POR_DEFECTO)),
  };
}

/**
 * Lo que se usa de ImapFlow, y nada más: las pruebas meten un buzón falso.
 *
 * No hay `messageFlagsAdd` a propósito: este módulo no escribe en el buzón.
 * `mailbox` lo expone ImapFlow una vez abierta la carpeta; es opcional para
 * que un buzón falso no tenga que fingirlo.
 */
export type ClienteBuzon = {
  connect(): Promise<unknown>;
  getMailboxLock(carpeta: string): Promise<{ release(): void }>;
  search(query: { seen?: boolean; since?: Date; uid?: string; header?: Record<string, string> }, opciones: { uid: true }): Promise<number[] | false>;
  fetchOne(uid: string, campos: { source: true }, opciones: { uid: true }): Promise<{ source?: Buffer } | false>;
  logout(): Promise<unknown>;
  readonly mailbox?: { uidValidity?: number | bigint } | false;
};

/**
 * Va al buzón a por el correo original y devuelve sus PDF adjuntos.
 *
 * Es lo que hace que «Reprocesar» sirva para algo en un correo cuyos datos
 * están en el adjunto. El adjunto se guarda desde que existe la columna
 * `rcp_documentos.correo_id`, pero los correos que entraron ANTES no lo
 * tienen, y sin esto no hay forma de arreglarlos desde la pantalla: había que
 * recargar el histórico entero o reenviar el correo a mano.
 *
 * Se busca por Message-ID, que es lo que identifica al correo, y NO se toca
 * nada del buzón: ni banderas, ni leídos. Nunca lanza: si el buzón no está,
 * no contesta o el correo ya no está en la carpeta, se devuelve una lista
 * vacía y reprocesar sigue con lo que tenga.
 */
export async function adjuntosDelOriginal(
  empresaId: string,
  messageId: string,
  opciones: { cliente?: ClienteBuzon; config?: ConfigBuzon } = {}
): Promise<AdjuntoPdf[]> {
  const cfg = opciones.config ?? configBuzon();
  if (!cfg || cfg.empresaId !== empresaId || !messageId) return [];
  const cliente = opciones.cliente ?? clienteReal(cfg);
  try {
    await cliente.connect();
    const cerrojo = await cliente.getMailboxLock(cfg.carpeta);
    try {
      const uids = (await cliente.search({ header: { "message-id": messageId } }, { uid: true })) || [];
      for (const uid of uids.slice(-1)) {
        const msg = await cliente.fetchOne(String(uid), { source: true }, { uid: true });
        if (!msg || !msg.source) continue;
        return adjuntosPdf(await simpleParser(msg.source));
      }
      return [];
    } finally {
      cerrojo.release();
    }
  } catch (e) {
    console.warn("[Recepciones] no se ha podido recuperar el correo original del buzón:", (e as Error).message);
    return [];
  } finally {
    await cliente.logout().catch(() => {});
  }
}

export type ResultadoCorreo = "procesado" | "duplicado" | "ignorado" | "revision" | "error";

export type DetalleCorreo = {
  messageId: string;
  asunto: string;
  resultado: ResultadoCorreo;
  tipo?: string;
  pedidoNumero?: string | null;
  albaranNumero?: string | null;
  error?: string;
};

export type PasadaBuzon = { correos: number; procesados: number; ignorados: number; errores: number; detalle: DetalleCorreo[] };

function clienteReal(cfg: ConfigBuzon): ClienteBuzon {
  return new ImapFlow({ host: cfg.host, port: cfg.port, secure: true, auth: { user: cfg.user, pass: cfg.pass }, logger: false }) as unknown as ClienteBuzon;
}

function direccion(v: ParsedMail["from"]): string {
  return (v?.value?.[0]?.address ?? "").trim().toLowerCase();
}

/** El cuerpo en texto plano; si sólo hay HTML, se le quitan las etiquetas. */
export function cuerpoEnTexto(correo: Pick<ParsedMail, "text" | "html">): string {
  if (correo.text?.trim()) return correo.text;
  if (typeof correo.html === "string" && correo.html.trim()) {
    return correo.html
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|tr|li|h\d|td|th)>/gi, "\n")
      .replace(/<[^>]+>/g, "")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"');
  }
  return "";
}

/** Una fecha legible y sin ambigüedad de huso, para los motivos. */
function enUtc(d: Date): string {
  return `${d.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

function adjuntosPdf(correo: ParsedMail): AdjuntoPdf[] {
  const salida: AdjuntoPdf[] = [];
  for (const a of correo.attachments ?? []) {
    const contenido = a.content as Buffer;
    if (!contenido?.length) continue;
    const esPdf = a.contentType === "application/pdf" || (a.filename ?? "").toLowerCase().endsWith(".pdf") || contenido.subarray(0, 5).toString() === "%PDF-";
    if (esPdf) salida.push({ nombre: a.filename ?? "albaran.pdf", contenido });
  }
  return salida;
}

/** El UIDVALIDITY de la carpeta abierta, si el cliente lo expone. */
function uidValidityDe(cliente: ClienteBuzon): number | null {
  const v = cliente.mailbox && typeof cliente.mailbox === "object" ? cliente.mailbox.uidValidity : undefined;
  if (v === undefined || v === null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function aDetalle(messageId: string, asunto: string, r: ResultadoIngesta): DetalleCorreo {
  const resultado: ResultadoCorreo =
    r.resultado === "PROCESADO" ? "procesado" : r.resultado === "DUPLICADO" ? "duplicado" : r.resultado === "IGNORADO" ? "ignorado" : r.resultado === "ERROR" ? "error" : "revision";
  return { messageId, asunto, resultado, tipo: r.tipo, pedidoNumero: r.pedidoNumero, albaranNumero: r.albaranNumero, error: r.motivo ?? undefined };
}

/**
 * Procesa un correo a partir de su fuente MIME. Nunca lanza. Es la pieza que
 * comparten el temporizador, la carga del histórico y el `.eml` importado.
 */
export async function procesarFuente(
  source: Buffer,
  cfg: Pick<ConfigBuzon, "empresaId">,
  remitentes: readonly string[],
  desde: Date | null,
  origen: "buzon" | "eml" = "buzon",
  messageIdPorDefecto = "sin-message-id"
): Promise<DetalleCorreo> {
  let correo: ParsedMail;
  let messageId = messageIdPorDefecto;
  try {
    correo = await simpleParser(source);
    messageId = correo.messageId || messageId;
  } catch (e) {
    return { messageId, asunto: "", resultado: "error", error: (e as Error).message };
  }

  const asunto = correo.subject ?? "";
  const de = direccion(correo.from);

  // Los motivos dicen además qué hacer: son lo único que se ve en pantalla
  // cuando un correo no entra, y «ignorado» a secas no se puede diagnosticar.
  if (desde && correo.date && correo.date.getTime() < desde.getTime() - MARGEN_ACTIVACION_MS) {
    return {
      messageId,
      asunto,
      resultado: "ignorado",
      error: `Anterior a la activación del buzón (${enUtc(desde)}). Para traerlo, «Cargar el histórico anterior a la activación».`,
    };
  }
  if (remitentes.length > 0 && !remitentes.some((r) => remitenteCasa(de, r))) {
    return {
      messageId,
      asunto,
      resultado: "ignorado",
      error: `Remitente no admitido: ${de || "(sin remitente)"}. Los admitidos son ${remitentes.join(", ")}; se ponen en la ficha del proveedor.`,
    };
  }
  const texto = cuerpoEnTexto(correo);
  if (!texto.trim()) return { messageId, asunto, resultado: "ignorado", error: "Sin cuerpo" };

  try {
    const r = await procesarCorreo(
      { empresaId: cfg.empresaId },
      { messageId, inReplyTo: correo.inReplyTo ?? null, fecha: (correo.date ?? new Date()).toISOString(), de, asunto, texto, adjuntosPdf: adjuntosPdf(correo), origen }
    );
    return aDetalle(messageId, asunto, r);
  } catch (e) {
    return { messageId, asunto, resultado: "error", error: (e as Error).message };
  }
}

async function procesarUno(cliente: ClienteBuzon, uid: number, cfg: Pick<ConfigBuzon, "empresaId">, remitentes: readonly string[], desde: Date | null): Promise<DetalleCorreo> {
  let msg: { source?: Buffer } | false;
  try {
    msg = await cliente.fetchOne(String(uid), { source: true }, { uid: true });
  } catch (e) {
    return { messageId: `uid-${uid}`, asunto: "", resultado: "error", error: (e as Error).message };
  }
  if (!msg || !msg.source) return { messageId: `uid-${uid}`, asunto: "", resultado: "ignorado", error: "Sin contenido" };
  return procesarFuente(msg.source, cfg, remitentes, desde, "buzon", `uid-${uid}`);
}

export type OpcionesPasada = {
  cliente?: ClienteBuzon;
  config?: ConfigBuzon;
  origen?: "temporizador" | "manual" | "historico";
  ahora?: Date;
  /** Lo anterior a la activación, a propósito y con fecha. */
  historico?: { desde: Date };
};

/** Una pasada: mira el buzón, procesa lo nuevo y deja constancia. Nunca lanza. */
export async function revisarBuzon(opciones: OpcionesPasada = {}): Promise<PasadaBuzon | { error: string }> {
  const cfg = opciones.config ?? configBuzon();
  if (!cfg) return { error: "Sin configurar (faltan RECEPCIONES_IMAP_HOST/USER/PASS/EMPRESA_ID)" };

  const pasada: PasadaBuzon = { correos: 0, procesados: 0, ignorados: 0, errores: 0, detalle: [] };
  const pasadaId = await repo.abrirPasada(cfg.empresaId, opciones.origen ?? (opciones.historico ? "historico" : "temporizador"));
  const cerrar = (error: string | null) =>
    repo.cerrarPasada(pasadaId, {
      ...pasada,
      error,
      // El asunto sí; el cuerpo no. La pasada dice QUÉ llegó, no qué decía.
      detalle: pasada.detalle.map((d) => ({ ...d, asunto: d.asunto.slice(0, 200) })),
    });

  const remitentes = (await repo.remitentesAdmitidos(cfg.empresaId)).map((r) => r.remitente);
  if (remitentes.length === 0) {
    const motivo =
      "Ningún proveedor tiene remitentes de correo configurados. El buzón no procesa nada mientras sea así: " +
      "aceptar todo lo que llegue guardaría también la publicidad y el correo equivocado. Ponlos en la ficha del proveedor.";
    console.warn("[Recepciones] buzón:", motivo);
    await cerrar(motivo);
    return { error: motivo };
  }

  const cliente = opciones.cliente ?? clienteReal(cfg);
  try {
    const activacion = await fechaDeActivacion(cfg.empresaId, opciones.ahora);
    const historico = opciones.historico ?? null;
    const desde = historico ? null : activacion;

    await cliente.connect();
    const lock = await cliente.getMailboxLock(cfg.carpeta);
    try {
      // La marca de progreso: hasta qué UID se miró ya. El histórico la ignora
      // (se está pidiendo justamente lo de antes) y tampoco la mueve.
      const guardado = await leerProgresoBuzon(cfg.empresaId, cfg.carpeta);
      const uidValidity = uidValidityDe(cliente);
      const renumerada = guardado.ultimoUid > 0 && uidValidity !== null && guardado.uidValidity !== null && guardado.uidValidity !== uidValidity;
      if (renumerada) {
        console.warn(`[Recepciones] la carpeta ${cfg.carpeta} se ha renumerado (UIDVALIDITY ${guardado.uidValidity} → ${uidValidity}): se vuelve a mirar desde la activación.`);
      }
      const ultimoVisto = historico || renumerada ? 0 : guardado.ultimoUid;

      const encontrados = historico
        ? await cliente.search({ since: historico.desde }, { uid: true })
        : await cliente.search(ultimoVisto > 0 ? { uid: `${ultimoVisto + 1}:*`, since: activacion } : { since: activacion }, { uid: true });

      // `uid: "N:*"` devuelve además el último mensaje de la carpeta aunque su
      // UID sea menor que N, así que el filtro no sobra.
      const uids = (encontrados || [])
        .filter((uid) => historico || uid > ultimoVisto)
        .sort((a, b) => a - b)
        .slice(0, historico ? LOTE_HISTORICO : LOTE);

      let tope = ultimoVisto;
      let huboError = false;
      for (const uid of uids) {
        pasada.correos++;
        const d = await procesarUno(cliente, uid, cfg, remitentes, desde);
        pasada.detalle.push(d);
        if (d.resultado === "error") {
          pasada.errores++;
          huboError = true; // la marca no pasa de aquí: se reintenta
          continue;
        }
        if (d.resultado === "ignorado") pasada.ignorados++;
        else pasada.procesados++;
        if (!huboError) tope = uid;
      }

      // El histórico no mueve la marca: lo suyo es lo viejo, y lo nuevo lo
      // sigue trayendo el temporizador.
      if (!historico && (tope > ultimoVisto || renumerada || guardado.uidValidity !== uidValidity)) {
        await guardarProgresoBuzon(cfg.empresaId, cfg.carpeta, { uidValidity, ultimoUid: tope } satisfies ProgresoBuzon);
      }
    } finally {
      lock.release();
    }
  } catch (e) {
    const motivo = (e as Error)?.message || "No se ha podido leer el buzón";
    console.error("[Recepciones] buzón:", motivo);
    await cerrar(motivo);
    return { error: motivo };
  } finally {
    try {
      await cliente.logout();
    } catch {
      /* el buzón ya se cerró */
    }
  }

  await cerrar(null);
  return pasada;
}

/** Un correo importado a mano como `.eml`: misma puerta, su propia pasada. */
export async function importarEml(empresaId: string, source: Buffer): Promise<DetalleCorreo> {
  const pasadaId = await repo.abrirPasada(empresaId, "eml", 1);
  const d = await procesarFuente(source, { empresaId }, [], null, "eml");
  await repo.cerrarPasada(pasadaId, {
    correos: 1,
    procesados: d.resultado === "procesado" || d.resultado === "duplicado" || d.resultado === "revision" ? 1 : 0,
    ignorados: d.resultado === "ignorado" ? 1 : 0,
    errores: d.resultado === "error" ? 1 : 0,
    error: null,
    detalle: [{ ...d, asunto: d.asunto.slice(0, 200) }],
  });
  return d;
}

let temporizador: ReturnType<typeof setInterval> | null = null;

export function startRecepcionesBuzon(): void {
  const cfg = configBuzon();
  if (!cfg) {
    console.log("Recepciones buzón: apagado (faltan las credenciales del buzón)");
    return;
  }
  if (temporizador) return;
  console.log(`Recepciones buzón: ${cfg.user} cada ${cfg.minutos} min`);
  void revisarBuzon().then(traza("primera pasada", true));
  temporizador = setInterval(() => void revisarBuzon().then(traza("pasada", false)), cfg.minutos * 60_000);
  temporizador.unref?.();
}

export function stopRecepcionesBuzon(): void {
  if (!temporizador) return;
  clearInterval(temporizador);
  temporizador = null;
}

function traza(que: string, siempre: boolean) {
  return (r: PasadaBuzon | { error: string }) => {
    if ("error" in r) return;
    if (!siempre && !r.correos) return;
    console.log(`Recepciones buzón: ${que} — ${r.correos} correo(s), ${r.procesados} procesado(s), ${r.ignorados} ignorado(s), ${r.errores} error(es)`);
  };
}
