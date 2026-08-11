/**
 * El informe del CheckPoint entra solo, por correo.
 *
 * Bridgestone manda su informe semanal; se reenvía a un buzón propio y este
 * proceso lo mira cada pocos minutos, coge el .xlsx y lo importa. Mismo molde
 * que webfleetSync.ts: una función que hace UNA pasada y se puede llamar a
 * mano, y un temporizador que la repite.
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
 *   CHECKPOINT_AVISO_A        a quién avisar cuando algo no cuadre
 */
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { supabase } from "./supabase.ts";
import { getMailTransport } from "./mail.ts";
import { filasDelExcel, importarCheckpoint, type ResultadoCheckpoint } from "./tyrecontrol/checkpointImport.ts";
import { esAdjuntoInforme } from "../src/modules/tyrecontrol/services/checkpoint.ts";

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
  importados: number;
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

  const out: PasadaCheckpoint = { correos: 0, importados: 0, errores: 0 };
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
        // Leído: procesado o descartado, no hay que volver a mirarlo.
        await cliente.messageFlagsAdd({ uid: String(uid) }, ["\\Seen"], { uid: true });
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

async function procesarCorreo(cliente: ImapFlow, uid: number): Promise<"importado" | "sin_adjunto" | "error"> {
  const msg = await cliente.fetchOne(String(uid), { source: true }, { uid: true });
  if (!msg || !msg.source) return "sin_adjunto";
  const correo = await simpleParser(msg.source);

  const messageId = correo.messageId || `uid-${uid}`;
  const adjunto = (correo.attachments || []).find((a) => esAdjuntoInforme(a.filename));
  if (!adjunto) return "sin_adjunto";

  // ¿Ya procesado? El unique de message_id lo impediría de todas formas, pero
  // mejor no bajarse el fichero ni tocar nada.
  const { data: ya } = await supabase.from("tc_checkpoint_ejecuciones")
    .select("id").eq("message_id", messageId).maybeSingle();
  if (ya) return "sin_adjunto";

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
  void revisarBuzonCheckpoint();
  timer = setInterval(() => { void revisarBuzonCheckpoint(); }, cfg.minutos * 60 * 1000);
}
