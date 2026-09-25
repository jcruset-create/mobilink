/**
 * El buzón: los correos de Therefore entran solos.
 *
 * Molde de `server/checkpointMail.ts`, que lleva en producción desde el
 * CheckPoint: una función que hace UNA pasada y se puede llamar a mano, y un
 * temporizador que la repite. Apagado mientras no haya credenciales, y lo dice
 * una vez al arrancar en vez de llenar el log de reconexiones fallidas.
 *
 * Lo que este fichero NO hace es entender el correo. Parsea la estructura
 * (`parsearCorreo`), guarda los PDF y llama a `procesarCorreo`, que es la
 * MISMA puerta por la que entra un correo importado a mano desde el panel. Dos
 * puertas, un solo camino: si el buzón se equivocara, se equivocaría igual que
 * la importación manual, y eso ya está probado.
 *
 * ── Tres reglas del buzón ───────────────────────────────────────────────────
 *
 * · SÓLO LO NO LEÍDO Y POSTERIOR A LA ACTIVACIÓN. El buzón lleva la cuenta
 *   (lo procesado se marca como leído) y `buzon.activado_el` pone el suelo:
 *   lo que ya estaba dentro antes de activar el módulo no se procesa nunca
 *   solo. Un reinicio no cambia esa fecha. Si algún día se quiere cargar el
 *   histórico, se hace a propósito, no por accidente.
 *
 * · UN CORREO QUE FALLA SE QUEDA SIN LEER. Se reintenta en la siguiente
 *   pasada, que es lo que uno espera de un fallo pasajero (la base no
 *   contesta, el almacenamiento tarda). Marcarlo como leído sería descartarlo:
 *   el arreglo llegaría cuando ya nadie lo fuera a ver.
 *
 * · LO QUE NO ES DE THEREFORE SE IGNORA Y SE MARCA LEÍDO. Con la lista de
 *   remitentes puesta, cualquier otra cosa que caiga en el buzón —una
 *   respuesta de alguien, un reenvío— se cuenta como ignorada y se deja
 *   constancia en la pasada. Sin lista, se acepta todo y se avisa en el log.
 *
 * Configuración (variables de entorno, como el CheckPoint):
 *   THEREFORE_IMAP_HOST        servidor de entrada
 *   THEREFORE_IMAP_PORT        993 por defecto
 *   THEREFORE_IMAP_USER        el buzón
 *   THEREFORE_IMAP_PASS        su contraseña
 *   THEREFORE_IMAP_CARPETA     INBOX por defecto
 *   THEREFORE_IMAP_MIN         cada cuántos minutos mirar (5 por defecto)
 *   THEREFORE_IMAP_EMPRESA_ID  a qué empresa del SaaS van los expedientes
 *
 * La empresa va por variable porque el buzón es UNO y el SaaS tiene varias:
 * el correo dice la sociedad (007, 008…) pero no el tenant, y adivinarlo
 * abriría expedientes en la empresa equivocada sin que nada fallara.
 */

import { ImapFlow } from "imapflow";
import { simpleParser, type ParsedMail } from "mailparser";
import pool from "../db.ts";
import { fechaDeActivacion, leerRemitentes } from "./config.ts";
import { parsearCorreo } from "./domain/correo/index.ts";
import { cuerpoEnTexto, remitenteAceptado } from "./domain/correo/remitentes.ts";
import { motivoDelFallo } from "./domain/imap.ts";
import { aCorreoEntrante, procesarCorreo, type AdjuntoEntrante } from "./ingesta.ts";
import { guardarDocumento, hashDeFichero, rutaDocumento } from "./storage.ts";

const MIN_POR_DEFECTO = 5;
/** Cuántos correos por pasada. Cada uno puede traer PDF que hay que guardar. */
const LOTE = 20;

/**
 * Margen al comparar la fecha del correo con la de activación.
 *
 * La cabecera `Date` la pone el RELOJ DEL REMITENTE, no el nuestro, y dos
 * servidores nunca van exactamente a la par. Sin margen, un correo enviado
 * treinta segundos antes de activar el buzón —o con el reloj del remitente
 * un minuto atrasado— se quedaría fuera para siempre sin que nadie lo viera.
 * Cinco minutos cubren cualquier desfase razonable y siguen dejando fuera
 * lo de esta mañana, que es lo que la activación quiere dejar fuera.
 */
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
  const host = process.env.THEREFORE_IMAP_HOST;
  const user = process.env.THEREFORE_IMAP_USER;
  const pass = process.env.THEREFORE_IMAP_PASS;
  const empresaId = process.env.THEREFORE_IMAP_EMPRESA_ID;
  if (!host || !user || !pass || !empresaId) return null;
  return {
    host,
    user,
    pass,
    empresaId,
    port: Number(process.env.THEREFORE_IMAP_PORT || 993),
    carpeta: process.env.THEREFORE_IMAP_CARPETA || "INBOX",
    minutos: Math.max(1, Number(process.env.THEREFORE_IMAP_MIN || MIN_POR_DEFECTO)),
  };
}

/**
 * Lo que se usa de ImapFlow, y nada más.
 *
 * Es un puerto: las pruebas meten un buzón falso con esta misma forma y
 * recorren el camino entero —parsear, guardar el PDF, abrir el expediente—
 * contra PostgreSQL de verdad, sin un servidor IMAP.
 */
export type ClienteBuzon = {
  connect(): Promise<unknown>;
  getMailboxLock(carpeta: string): Promise<{ release(): void }>;
  search(query: { seen?: boolean; since?: Date }, opciones: { uid: true }): Promise<number[] | false>;
  fetchOne(
    uid: string,
    campos: { source: true },
    opciones: { uid: true }
  ): Promise<{ source?: Buffer } | false>;
  messageFlagsAdd(rango: { uid: string }, flags: string[], opciones: { uid: true }): Promise<unknown>;
  logout(): Promise<unknown>;
  /**
   * Cierra el socket a las bravas. Opcional: el buzón de las pruebas no lo
   * necesita, pero ImapFlow sí lo tiene y hace falta cuando `logout()` no
   * puede hacerse porque la sesión nunca llegó a abrirse.
   */
  close?(): void;
};

export type ResultadoCorreo = "procesado" | "duplicado" | "ignorado" | "error";

export type DetalleCorreo = {
  messageId: string;
  asunto: string;
  resultado: ResultadoCorreo;
  expedienteNumero?: string;
  error?: string;
};

export type PasadaBuzon = {
  correos: number;
  procesados: number;
  ignorados: number;
  errores: number;
  detalle: DetalleCorreo[];
};

function clienteReal(cfg: ConfigBuzon): ClienteBuzon {
  return new ImapFlow({
    host: cfg.host,
    port: cfg.port,
    secure: true,
    auth: { user: cfg.user, pass: cfg.pass },
    logger: false,
  }) as unknown as ClienteBuzon;
}

function direccion(v: ParsedMail["from"]): string {
  return (v?.value?.[0]?.address ?? "").trim().toLowerCase();
}

// Las reglas puras —quién puede escribir y cómo se lee el cuerpo— viven en
// domain/, que no importa db.ts y por tanto se puede probar sin PostgreSQL.
// Se reexportan para que quien las importe de aquí no note el cambio.
export { cuerpoEnTexto, remitenteAceptado } from "./domain/correo/remitentes.ts";

async function guardarAdjuntos(empresaId: string, correo: ParsedMail): Promise<AdjuntoEntrante[]> {
  const salida: AdjuntoEntrante[] = [];
  for (const a of correo.attachments ?? []) {
    const contenido = a.content as Buffer;
    if (!contenido?.length) continue;
    const esPdf = a.contentType === "application/pdf" || (a.filename ?? "").toLowerCase().endsWith(".pdf");
    const hash = hashDeFichero(contenido);
    // Sólo los PDF se guardan; del resto queda el hash para deduplicar y el
    // nombre para saber que venía. Guardar cualquier cosa que adjunte alguien
    // es guardar cualquier cosa.
    let storagePath: string | null = null;
    if (esPdf) {
      const ruta = rutaDocumento(empresaId, hash);
      await guardarDocumento(ruta, contenido, "application/pdf");
      storagePath = ruta;
    }
    salida.push({
      nombre: a.filename ?? "",
      mimeType: a.contentType ?? "",
      tamanoBytes: contenido.length,
      hash,
      storagePath,
    });
  }
  return salida;
}

/**
 * Procesa un correo a partir de su fuente MIME. Devuelve qué pasó; nunca lanza.
 *
 * Es la pieza que comparten las tres puertas —el temporizador, la carga del
 * histórico y el .eml importado a mano— y por eso recibe los bytes y no un
 * cliente IMAP. `desde` en `null` significa «sin suelo de fecha»: es lo que
 * usa la carga del histórico, que existe justamente para lo anterior a la
 * activación.
 */
export async function procesarFuente(
  source: Buffer,
  cfg: Pick<ConfigBuzon, "empresaId">,
  remitentes: readonly string[],
  desde: Date | null,
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

  // `since` en IMAP es por DÍA; aquí se afina al instante, con margen.
  if (desde && correo.date && correo.date.getTime() < desde.getTime() - MARGEN_ACTIVACION_MS) {
    return { messageId, asunto, resultado: "ignorado", error: "Anterior a la activación del buzón" };
  }
  if (!remitenteAceptado(de, remitentes)) {
    return { messageId, asunto, resultado: "ignorado", error: `Remitente no admitido: ${de}` };
  }

  const texto = cuerpoEnTexto(correo);
  if (!texto.trim()) {
    return { messageId, asunto, resultado: "ignorado", error: "Sin cuerpo" };
  }

  try {
    const adjuntos = await guardarAdjuntos(cfg.empresaId, correo);
    const leido = parsearCorreo(asunto, texto);
    const entrada = aCorreoEntrante(leido, {
      messageId,
      gmailMessageId: null,
      gmailThreadId: null,
      inReplyTo: correo.inReplyTo ?? null,
      fecha: (correo.date ?? new Date()).toISOString(),
      de,
      para: direccion(Array.isArray(correo.to) ? correo.to[0] : correo.to),
      asunto,
      texto,
    });
    entrada.adjuntos = adjuntos;

    const r = await procesarCorreo({ empresaId: cfg.empresaId, userId: null }, entrada);
    return {
      messageId,
      asunto,
      resultado: r.duplicado ? "duplicado" : "procesado",
      expedienteNumero: r.expedienteNumero ?? undefined,
    };
  } catch (e) {
    return { messageId, asunto, resultado: "error", error: (e as Error).message };
  }
}

/** Baja UN correo del buzón y lo procesa. */
async function procesarUno(
  cliente: ClienteBuzon,
  uid: number,
  cfg: Pick<ConfigBuzon, "empresaId">,
  remitentes: readonly string[],
  desde: Date | null
): Promise<DetalleCorreo> {
  let msg: { source?: Buffer } | false;
  try {
    msg = await cliente.fetchOne(String(uid), { source: true }, { uid: true });
  } catch (e) {
    return { messageId: `uid-${uid}`, asunto: "", resultado: "error", error: (e as Error).message };
  }
  if (!msg || !msg.source) return { messageId: `uid-${uid}`, asunto: "", resultado: "ignorado", error: "Sin contenido" };
  return procesarFuente(msg.source, cfg, remitentes, desde, `uid-${uid}`);
}

export type OpcionesPasada = {
  /** Un buzón falso, para las pruebas. */
  cliente?: ClienteBuzon;
  /** Configuración explícita, para las pruebas. Sin ella se lee del entorno. */
  config?: ConfigBuzon;
  origen?: "temporizador" | "manual" | "historico";
  ahora?: Date;
  /**
   * La carga del histórico: TODO lo que haya desde esa fecha, leído o no, y
   * sin el suelo de la activación. Es la única forma de procesar lo anterior
   * a activar el módulo, y es a propósito que sea una acción aparte que hay
   * que pedir: lo que ya estaba en el buzón no entra nunca por accidente.
   */
  historico?: { desde: Date };
};

/** Cuántos correos por pasada de histórico. Se puede repetir hasta vaciar. */
const LOTE_HISTORICO = 200;

/**
 * Ejecuta un paso del buzón contando QUÉ paso era si falla.
 *
 * Los tres primeros —conectar, abrir la carpeta, buscar— fallan igual de
 * pronto y con el mismo «Command failed» de ImapFlow, y sin saber cuál era
 * no se puede ni empezar a mirar: una contraseña mal y una carpeta que no
 * existe se arreglan en sitios distintos.
 */
async function conPaso<T>(paso: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    throw new Error(motivoDelFallo(e, paso));
  }
}

/**
 * Una pasada: mira el buzón, procesa lo nuevo y deja constancia.
 *
 * Nunca lanza. Un buzón que no se puede abrir devuelve `{ error }` y también
 * queda en `thf_buzon_pasadas`, que es donde el panel lo enseña.
 */
export async function revisarBuzon(opciones: OpcionesPasada = {}): Promise<PasadaBuzon | { error: string }> {
  const cfg = opciones.config ?? configBuzon();
  if (!cfg) return { error: "Sin configurar (faltan THEREFORE_IMAP_HOST/USER/PASS/EMPRESA_ID)" };

  const pasada: PasadaBuzon = { correos: 0, procesados: 0, ignorados: 0, errores: 0, detalle: [] };
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO thf_buzon_pasadas (empresa_id, origen) VALUES ($1, $2) RETURNING id`,
    [cfg.empresaId, opciones.origen ?? (opciones.historico ? "historico" : "temporizador")]
  );
  const pasadaId = rows[0].id;

  const cerrar = async (error: string | null) => {
    await pool.query(
      `UPDATE thf_buzon_pasadas
          SET terminada_at = now(), correos = $2, procesados = $3, ignorados = $4,
              errores = $5, error = $6, detalle = $7
        WHERE id = $1`,
      [
        pasadaId,
        pasada.correos,
        pasada.procesados,
        pasada.ignorados,
        pasada.errores,
        error,
        // El asunto sí; el cuerpo no. La pasada dice QUÉ llegó, no qué decía.
        JSON.stringify(pasada.detalle.map((d) => ({ ...d, asunto: d.asunto.slice(0, 200) }))),
      ]
    ).catch((e) => console.error("[Therefore] no se ha podido cerrar la pasada:", (e as Error).message));
  };

  const cliente = opciones.cliente ?? clienteReal(cfg);
  try {
    const remitentes = await leerRemitentes(cfg.empresaId);
    if (remitentes.length === 0) {
      console.warn("[Therefore] buzón sin lista de remitentes: se acepta todo lo que llegue");
    }
    const activacion = await fechaDeActivacion(cfg.empresaId, opciones.ahora);
    const historico = opciones.historico ?? null;
    // En el histórico no hay suelo: se está pidiendo justamente lo anterior.
    const desde = historico ? null : activacion;

    await conPaso("conectar con el servidor de correo", () => cliente.connect());
    const lock = await conPaso(`abrir la carpeta ${cfg.carpeta}`, () => cliente.getMailboxLock(cfg.carpeta));
    try {
      const uids = await conPaso("buscar los correos nuevos", () =>
        historico
          ? cliente.search({ since: historico.desde }, { uid: true })
          : cliente.search({ seen: false, since: activacion }, { uid: true })
      );
      for (const uid of (uids || []).slice(0, historico ? LOTE_HISTORICO : LOTE)) {
        pasada.correos++;
        const d = await procesarUno(cliente, uid, cfg, remitentes, desde);
        pasada.detalle.push(d);
        if (d.resultado === "error") {
          pasada.errores++;
          continue; // sin leer: se reintenta en la siguiente pasada
        }
        if (d.resultado === "ignorado") pasada.ignorados++;
        else pasada.procesados++;
        await cliente.messageFlagsAdd({ uid: String(uid) }, ["\\Seen"], { uid: true });
      }
    } finally {
      lock.release();
    }
  } catch (e) {
    const motivo = (e as Error)?.message || motivoDelFallo(e, "leer el buzón");
    console.error("[Therefore] buzón:", motivo);
    await cerrar(motivo);
    return { error: motivo };
  } finally {
    /*
     * Cerrar SIEMPRE, y por las bravas si hace falta.
     *
     * `logout()` manda el comando LOGOUT, y eso sólo se puede cuando la
     * sesión llegó a abrirse: si falló el LOGIN, o el servidor cortó, lanza
     * y —sin el `close()`— el socket se quedaba abierto. Una pasada cada
     * cinco minutos que deja un socket colgado acaba dando «Maximum number
     * of connections from user+IP exceeded», que es un buzón que deja de
     * leerse sin que nadie haya tocado nada.
     */
    try {
      await cliente.logout();
    } catch {
      try {
        cliente.close?.();
      } catch {
        /* ya estaba cerrado */
      }
    }
  }

  await cerrar(null);
  return pasada;
}

/**
 * Un correo importado a mano, como fichero .eml.
 *
 * Misma puerta que el buzón —`procesarFuente`— y su propia fila de pasada con
 * origen 'eml', para que en el panel se vea que alguien lo trajo a mano. Sin
 * suelo de fecha ni filtro de remitente: quien lo importa ya ha decidido que
 * es de Therefore, y un .eml exportado de otro buzón puede llevar cualquier
 * fecha.
 */
export async function importarEml(empresaId: string, source: Buffer): Promise<DetalleCorreo> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO thf_buzon_pasadas (empresa_id, origen, correos) VALUES ($1, 'eml', 1) RETURNING id`,
    [empresaId]
  );
  const d = await procesarFuente(source, { empresaId }, [], null);
  await pool.query(
    `UPDATE thf_buzon_pasadas
        SET terminada_at = now(), procesados = $2, ignorados = $3, errores = $4, detalle = $5
      WHERE id = $1`,
    [
      rows[0].id,
      d.resultado === "procesado" || d.resultado === "duplicado" ? 1 : 0,
      d.resultado === "ignorado" ? 1 : 0,
      d.resultado === "error" ? 1 : 0,
      JSON.stringify([{ ...d, asunto: d.asunto.slice(0, 200) }]),
    ]
  ).catch((e) => console.error("[Therefore] no se ha podido cerrar la pasada del .eml:", (e as Error).message));
  return d;
}

/** Las últimas pasadas, para la pantalla de configuración. */
export async function ultimasPasadas(empresaId: string, limite = 10): Promise<Record<string, unknown>[]> {
  const { rows } = await pool.query(
    `SELECT id, iniciada_at, terminada_at, correos, procesados, ignorados, errores, error, origen, detalle
       FROM thf_buzon_pasadas WHERE empresa_id = $1
      ORDER BY iniciada_at DESC LIMIT $2`,
    [empresaId, limite]
  );
  return rows;
}

let temporizador: ReturnType<typeof setInterval> | null = null;

export function startThereforeBuzon(): void {
  const cfg = configBuzon();
  if (!cfg) {
    console.log("Therefore buzón: apagado (faltan las credenciales del buzón)");
    return;
  }
  if (temporizador) return;
  console.log(`Therefore buzón: ${cfg.user} cada ${cfg.minutos} min`);

  // La primera pasada se cuenta siempre: que haya credenciales no significa
  // que el buzón las acepte. Las siguientes sólo hablan cuando hay algo.
  void revisarBuzon().then(traza("primera pasada", true));
  temporizador = setInterval(() => void revisarBuzon().then(traza("pasada", false)), cfg.minutos * 60_000);
  temporizador.unref?.();
}

export function stopThereforeBuzon(): void {
  if (!temporizador) return;
  clearInterval(temporizador);
  temporizador = null;
}

function traza(que: string, siempre: boolean) {
  return (r: PasadaBuzon | { error: string }) => {
    if ("error" in r) return; // ya escrito con su causa
    if (!siempre && !r.correos) return;
    console.log(
      `Therefore buzón: ${que} — ${r.correos} correo(s), ${r.procesados} procesado(s), ${r.ignorados} ignorado(s), ${r.errores} error(es)`
    );
  };
}
