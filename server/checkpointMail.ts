/**
 * Lo del CheckPoint entra solo, por correo.
 *
 * Por este buzón llegan DOS cosas distintas, y este proceso las reparte:
 *
 *   · El informe semanal de Bridgestone, que viene en un .xlsx adjunto y se
 *     importa como revisiones (lo de siempre).
 *   · Los avisos de presión baja del arco: una plantilla de Goodyear, sin
 *     adjunto, que abre una incidencia sobre la rueda concreta.
 *
 * Lo primero que se hace con cada mensaje es decidir cuál de los dos es, y esa
 * decisión es explícita en los dos sentidos: un aviso no puede intentar
 * procesarse como informe ni al revés, y lo que no sea ninguno de los dos se
 * ignora sin ruido. Mismo molde que webfleetSync.ts: una función que hace UNA
 * pasada y se puede llamar a mano, y un temporizador que la repite.
 *
 * Está apagado mientras no haya credenciales. Un servicio a medio configurar
 * que se conecta a un buzón inexistente y llena el log de errores es peor que
 * uno que no arranca y lo dice una vez.
 *
 * Configuración (variables de entorno):
 *   CHECKPOINT_IMAP_HOST      imap.gmail.com, outlook.office365.com…
 *   CHECKPOINT_IMAP_PORT      993 por defecto
 *   CHECKPOINT_IMAP_USER      el buzón
 *   CHECKPOINT_IMAP_PASS      contraseña de aplicación, NO la del correo
 *   CHECKPOINT_IMAP_CARPETA   INBOX por defecto
 *   CHECKPOINT_IMAP_MIN       cada cuántos minutos mirar (15 por defecto)
 *   CHECKPOINT_AVISO_A        a quién avisar cuando algo no cuadre (tanto de
 *                             una importación como de un aviso de presión que
 *                             no se haya podido procesar)
 */
import { ImapFlow } from "imapflow";
import { simpleParser, type Attachment, type ParsedMail } from "mailparser";
import { supabase } from "./supabase.ts";
import { getMailTransport } from "./mail.ts";
import { filasDelExcel, importarCheckpoint, type ResultadoCheckpoint } from "./tyrecontrol/checkpointImport.ts";
import { esAdjuntoInforme } from "../src/modules/tyrecontrol/services/checkpoint.ts";
import { cuerpoDelCorreo, esAvisoPresion, leerAvisoPresion } from "./tyrecontrol/avisoPresion.ts";
import {
  avisoNoReconocido, avisoYaProcesado, procesarAvisoPresion, type CorreoAviso,
} from "./tyrecontrol/avisoPresionIncidencia.ts";

const MIN_POR_DEFECTO = 15;

function config() {
  const host = process.env.CHECKPOINT_IMAP_HOST;
  const user = process.env.CHECKPOINT_IMAP_USER;
  const pass = process.env.CHECKPOINT_IMAP_PASS;
  if (!host || !user || !pass) return null;
  return {
    host, user, pass,
    port: Number(process.env.CHECKPOINT_IMAP_PORT || 993),
    carpeta: process.env.CHECKPOINT_IMAP_CARPETA || "INBOX",
    minutos: Math.max(1, Number(process.env.CHECKPOINT_IMAP_MIN || MIN_POR_DEFECTO)),
    avisoA: process.env.CHECKPOINT_AVISO_A || "",
  };
}

export interface PasadaCheckpoint {
  correos: number;
  /** Informes semanales importados. */
  importados: number;
  /** Avisos de presión procesados (hayan abierto incidencia o no). */
  avisos: number;
  /** Incidencias abiertas por esos avisos. Las repeticiones no cuentan. */
  incidencias: number;
  errores: number;
}

/**
 * Una pasada: mira el buzón, procesa lo que no se haya procesado ya y deja
 * constancia de cada correo en tc_checkpoint_ejecuciones.
 */
export async function revisarBuzonCheckpoint(): Promise<PasadaCheckpoint | { error: string }> {
  const cfg = config();
  if (!cfg) return { error: "Sin configurar (faltan CHECKPOINT_IMAP_HOST/USER/PASS)" };

  const cliente = new ImapFlow({
    host: cfg.host, port: cfg.port, secure: true,
    auth: { user: cfg.user, pass: cfg.pass },
    logger: false,
  });

  const out: PasadaCheckpoint = { correos: 0, importados: 0, avisos: 0, incidencias: 0, errores: 0 };
  try {
    await cliente.connect();
    const lock = await cliente.getMailboxLock(cfg.carpeta);
    try {
      // Solo lo no leído: lo ya procesado se marca como leído al terminar, así
      // que el buzón mismo lleva la cuenta y no hay que recorrerlo entero cada
      // vez. El unique de message_id es la segunda red por si algo se relee.
      const sinLeer = await cliente.search({ seen: false });
      for (const uid of (sinLeer || []).slice(0, 20)) {
        out.correos++;
        const procesado = await procesarCorreo(cliente, uid);
        if (procesado === "error") out.errores++;
        else if (procesado === "importado") out.importados++;
        else if (procesado === "aviso" || procesado === "aviso_nuevo") {
          out.avisos++;
          if (procesado === "aviso_nuevo") out.incidencias++;
        }
        // Un correo que ha fallado se queda SIN leer. Si se marcase, el arreglo
        // del fallo llegaría tarde: el informe ya estaría descartado y habría
        // que pedirle a alguien que lo reenviara. Se reintenta en la siguiente
        // pasada, que es lo que uno espera de algo que falla por un motivo
        // pasajero.
        //
        // "Error" es SÓLO el fallo pasajero: la base de datos caída, el buzón
        // cortado. Un correo que no se entiende —plantilla cambiada, matrícula
        // que no existe— no es eso: reintentarlo mil veces da mil veces lo
        // mismo, así que ése se registra, se avisa una vez y se marca leído.
        // Si no, veinte avisos ilegibles taparían el informe semanal detrás de
        // ellos, porque aquí sólo se miran los veinte primeros no leídos.
        if (procesado !== "error") {
          await cliente.messageFlagsAdd({ uid: String(uid) }, ["\\Seen"], { uid: true });
        }
      }
    } finally {
      lock.release();
    }
  } catch (e: any) {
    console.error("CheckPoint IMAP:", e?.message || e);
    return { error: e?.message || "No se ha podido leer el buzón" };
  } finally {
    try { await cliente.logout(); } catch { /* el buzón ya se cerró */ }
  }
  return out;
}

type Resultado = "importado" | "aviso" | "aviso_nuevo" | "otro" | "error";

/**
 * Un correo: decidir qué es y mandarlo por su camino.
 *
 * El orden importa. El informe se reconoce por su adjunto, que es lo que ya
 * hacía; el aviso, por su asunto Y sus etiquetas, no por no llevar adjunto.
 * Reconocerlo por lo que le falta convertiría cualquier correo suelto en
 * candidato a aviso.
 */
async function procesarCorreo(cliente: ImapFlow, uid: number): Promise<Resultado> {
  const msg = await cliente.fetchOne(String(uid), { source: true }, { uid: true });
  if (!msg || !msg.source) return "otro";
  const correo = await simpleParser(msg.source);
  const messageId = correo.messageId || `uid-${uid}`;

  const adjunto = (correo.attachments || []).find((a) => esAdjuntoInforme(a.filename));
  if (adjunto) return await procesarInforme(correo, messageId, adjunto);

  const cuerpo = cuerpoDelCorreo(correo);
  if (esAvisoPresion(correo.subject, cuerpo)) return await procesarAviso(correo, messageId, cuerpo);

  // Ni informe ni aviso: publicidad, una respuesta, lo que sea. Se marca leído
  // y no se dice nada. Un correo por cada mensaje que no nos toca acabaría
  // tapando los que sí.
  return "otro";
}

/**
 * El aviso de presión: abre incidencia sobre la rueda concreta.
 *
 * Sólo se devuelve "error" —y por tanto sólo se deja el correo sin leer—
 * cuando el fallo es pasajero. Que la plantilla haya cambiado o que la
 * matrícula no exista no lo es: eso deja rastro, manda un correo y se da por
 * visto.
 */
async function procesarAviso(correo: ParsedMail, messageId: string, cuerpo: string): Promise<Resultado> {
  const base: CorreoAviso = {
    messageId,
    asunto: correo.subject ?? null,
    remitente: correo.from?.text ?? null,
    fechaCorreo: correo.date ? correo.date.toISOString() : null,
  };

  try {
    if (await avisoYaProcesado(messageId)) return "aviso";

    const leido = leerAvisoPresion(cuerpo, { fechaCorreo: correo.date ?? null });
    const r = leido.ok
      ? await procesarAvisoPresion(base, leido.aviso, { notas: leido.notas })
      : await avisoNoReconocido(base, cuerpo, leido.faltan);

    if (r.detalle) {
      await avisar(asuntoDelAviso(r.estado, r.matricula), r.detalle +
        `\n\nCorreo: ${base.asunto ?? "(sin asunto)"} · ${base.fechaCorreo ?? ""}`);
    }
    return r.estado === "creada" ? "aviso_nuevo" : "aviso";
  } catch (e: any) {
    // Aquí sólo llegan los fallos de verdad: la base de datos, la red. El
    // correo se queda sin leer y se reintenta en la siguiente pasada.
    console.error("CheckPoint aviso de presión:", e?.message || e);
    return "error";
  }
}

function asuntoDelAviso(estado: string, matricula: string | null): string {
  const quien = matricula ? ` (${matricula})` : "";
  switch (estado) {
    case "creada": return `Presión baja: incidencia nueva${quien}`;
    case "actualizada": return `Presión baja sin resolver${quien}`;
    case "sin_vehiculo": return `Aviso de presión de un vehículo desconocido${quien}`;
    case "vehiculo_ambiguo": return `Aviso de presión con matrícula repetida${quien}`;
    case "sin_posicion": return `Aviso de presión de una rueda que no existe en la ficha${quien}`;
    case "pendiente_confirmacion": return "Aviso de presión con la plantilla cambiada: confirmar a mano";
    default: return "Aviso de presión que no se ha podido leer";
  }
}

/** El informe semanal: lo de siempre, tal cual estaba. */
async function procesarInforme(correo: ParsedMail, messageId: string, adjunto: Attachment): Promise<Resultado> {
  // ¿Ya procesado CON ÉXITO? Sólo entonces se salta. Una fila en 'error' es
  // constancia de un intento fallido, no de un correo consumido: si se tratara
  // igual, arreglar la causa no serviría de nada porque el informe ya estaría
  // dado por visto.
  const { data: ya } = await supabase.from("tc_checkpoint_ejecuciones")
    .select("id, estado").eq("message_id", messageId).maybeSingle();
  if (ya && ya.estado !== "error") return "otro";
  // El unique de message_id impediría insertar el reintento, así que se retira
  // la constancia del intento anterior justo antes de volver a probar.
  if (ya) await supabase.from("tc_checkpoint_ejecuciones").delete().eq("id", ya.id);

  const base = {
    message_id: messageId,
    asunto: correo.subject ?? null,
    remitente: correo.from?.text ?? null,
    fecha_correo: correo.date ? correo.date.toISOString() : null,
    fichero: adjunto.filename ?? null,
  };

  let r: ResultadoCheckpoint;
  try {
    r = await importarCheckpoint(filasDelExcel(adjunto.content as Buffer));
  } catch (e: any) {
    await supabase.from("tc_checkpoint_ejecuciones").insert({
      ...base, estado: "error", error: e?.message || String(e),
    });
    await avisar(`No se ha podido importar el informe del CheckPoint`,
      `Fichero: ${base.fichero}\nAsunto: ${base.asunto}\n\nError: ${e?.message || e}`);
    return "error";
  }

  const conAvisos = r.avisos.length > 0;
  await supabase.from("tc_checkpoint_ejecuciones").insert({
    ...base,
    empresa_id: r.empresaId,
    mediciones: r.mediciones, revisiones: r.revisiones,
    altas: r.altas.length, ya_cargados: r.yaCargados.length, sin_medir: r.sinMedir.length,
    avisos: r.avisos,
    estado: conAvisos ? "con_avisos" : "ok",
    aviso_enviado: conAvisos,
  });

  // Solo se escribe cuando hay algo que mirar. Un correo por cada pasada
  // correcta acabaría en la carpeta de "ya lo leeré".
  if (conAvisos || r.altas.length) {
    await avisar(
      `CheckPoint: ${r.mediciones} mediciones cargadas${r.avisos.length ? `, ${r.avisos.length} avisos` : ""}`,
      [
        `Fichero: ${base.fichero}`,
        `Mediciones: ${r.mediciones} · Revisiones: ${r.revisiones}`,
        r.altas.length ? `Vehículos dados de alta (${r.altas.length}): ${r.altas.join(", ")}` : "",
        r.sinMedir.length ? `Sin cruzar el arco: ${r.sinMedir.length}` : "",
        "",
        r.avisos.length ? "Avisos:" : "",
        ...r.avisos.map((a) => ` · ${a}`),
      ].filter(Boolean).join("\n"),
    );
  }
  return "importado";
}

async function avisar(asunto: string, cuerpo: string): Promise<void> {
  const para = process.env.CHECKPOINT_AVISO_A;
  const transport = getMailTransport();
  if (!para || !transport) return; // sin destinatario o sin SMTP: queda en la tabla
  try {
    await transport.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to: para, subject: `[TyreControl] ${asunto}`, text: cuerpo,
    });
  } catch (e: any) {
    console.error("CheckPoint aviso:", e?.message || e);
  }
}

let timer: ReturnType<typeof setInterval> | null = null;

export function startCheckpointMail(): void {
  const cfg = config();
  if (!cfg) {
    console.log("CheckPoint por correo: apagado (faltan las credenciales del buzón)");
    return;
  }
  if (timer) return;
  console.log(`CheckPoint por correo: ${cfg.user} cada ${cfg.minutos} min`);

  // Una primera pasada al arrancar, y luego el ritmo.
  //
  // La primera se registra pase lo que pase: la línea de arriba solo dice que
  // hay credenciales, no que el buzón las acepte, y "no ha salido ningún error"
  // es una forma pésima de enterarse de que algo funciona. Las siguientes solo
  // hablan cuando hay algo que contar; una línea cada 15 minutos diciendo que
  // no había correo es ruido que acaba tapando la que sí importa.
  void revisarBuzonCheckpoint().then(traza("primera pasada", true));
  timer = setInterval(
    () => { void revisarBuzonCheckpoint().then(traza("pasada", false)); },
    cfg.minutos * 60 * 1000,
  );
}

function traza(qué: string, siempre: boolean) {
  return (r: PasadaCheckpoint | { error: string }) => {
    // El error ya lo ha escrito revisarBuzonCheckpoint con su causa.
    if ("error" in r) return;
    if (!siempre && !r.correos && !r.errores) return;
    console.log(
      `CheckPoint por correo: ${qué} — ${r.correos} correo(s), ` +
      `${r.importados} informe(s), ${r.avisos} aviso(s) de presión` +
      `${r.incidencias ? ` (${r.incidencias} incidencia(s) nueva(s))` : ""}, ` +
      `${r.errores} error(es)`,
    );
  };
}
