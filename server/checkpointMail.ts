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
import {
  clasificar, procesarAvisoGoodyear, seMarcaLeido,
  type Procesado as ProcesadoGoodyear,
} from "./tyrecontrol/goodyear/ingesta.ts";

const MIN_POR_DEFECTO = 15;

/**
 * Cuántos correos se miran por pasada.
 *
 * Nació pensado para un informe semanal. Con los avisos de presión llegando a
 * cualquier hora siguen sobrando —son 1.920 al día a 15 minutos la pasada—,
 * pero ahora los que se quedan fuera se cuentan y salen en el resultado.
 */
const TOPE_POR_PASADA = 20;

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
  /** Avisos de presión de Goodyear: nuevos, repetidos y sin casar. */
  alertas: number;
  repetidos: number;
  sinCasar: number;
  /** Correos que no son ni informe ni aviso: se cuentan y se marcan leídos. */
  ignorados: number;
  /**
   * Los que se han quedado fuera del tope de esta pasada.
   *
   * Antes no se contaban, así que un buzón con más correos de los que cabe
   * mirar de una vez se veía igual que uno al día. Con el informe semanal daba
   * lo mismo; con avisos de presión llegando a cualquier hora, no.
   */
  pendientes: number;
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

  const out: PasadaCheckpoint = {
    correos: 0, importados: 0, errores: 0,
    alertas: 0, repetidos: 0, sinCasar: 0, ignorados: 0, pendientes: 0,
  };
  try {
    await cliente.connect();
    const lock = await cliente.getMailboxLock(cfg.carpeta);
    try {
      // Solo lo no leído: lo ya procesado se marca como leído al terminar, así
      // que el buzón mismo lleva la cuenta y no hay que recorrerlo entero cada
      // vez. El unique de message_id es la segunda red por si algo se relee.
      const sinLeer = (await cliente.search({ seen: false })) || [];
      out.pendientes = Math.max(0, sinLeer.length - TOPE_POR_PASADA);
      for (const uid of sinLeer.slice(0, TOPE_POR_PASADA)) {
        out.correos++;
        const procesado = await procesarCorreo(cliente, uid);
        if (procesado === "error") out.errores++;
        else if (procesado === "importado") out.importados++;
        else if (procesado === "alerta") out.alertas++;
        else if (procesado === "repetido") out.repetidos++;
        else if (procesado === "no_casado") out.sinCasar++;
        else out.ignorados++;
        // Un correo que ha fallado se queda SIN leer. Si se marcase, el arreglo
        // del fallo llegaría tarde: el informe ya estaría descartado y habría
        // que pedirle a alguien que lo reenviara. Se reintenta en la siguiente
        // pasada, que es lo que uno espera de algo que falla por un motivo
        // pasajero.
        //
        // Todo lo demás se marca leído, el `no_casado` incluido: volver a
        // pasarlo daría lo mismo, y no se pierde porque queda en
        // `tc_goodyear_avisos` con su motivo y con lo que se entendió.
        if (seMarcaLeido(procesado)) {
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

type Procesado = "importado" | ProcesadoGoodyear;

async function procesarCorreo(cliente: ImapFlow, uid: number): Promise<Procesado> {
  const msg = await cliente.fetchOne(String(uid), { source: true }, { uid: true });
  if (!msg || !msg.source) return "ignorado";
  const correo = await simpleParser(msg.source);

  const messageId = correo.messageId || `uid-${uid}`;
  const adjunto = (correo.attachments || []).find((a) => esAdjuntoInforme(a.filename));

  /*
   * ── El reparto ────────────────────────────────────────────────────────────
   *
   * A este buzón llegan DOS cosas distintas del mismo remitente. El informe de
   * la flota lo manda `proactivesolutions-alerts@ps.goodyear.com` desde agosto
   * —91 de las 94 importaciones registradas— y los avisos de presión los manda
   * esa misma dirección, así que repartir por remitente es imposible.
   *
   * Se mira primero el adjunto, que es lo que ya hacía `esAdjuntoInforme`: con
   * informe, el camino de siempre, sin un solo cambio de comportamiento. Sin
   * informe, se intenta leer como aviso de presión.
   *
   * Antes de esto, un correo sin adjunto se marcaba como leído y desaparecía
   * sin dejar rastro: los avisos de Goodyear que cayeran aquí se perdían.
   */
  if (!adjunto) {
    const r = await procesarAvisoGoodyear({
      messageId,
      asunto: correo.subject ?? null,
      html: typeof correo.html === "string" ? correo.html : null,
      texto: correo.text ?? null,
      remitente: correo.from?.text ?? null,
      fecha: correo.date ?? null,
    });
    if (r.estado === "error") console.error("Goodyear:", r.motivo);
    if (r.estado === "no_casado") console.warn("Goodyear, aviso sin casar:", r.motivo);
    return clasificar(r);
  }

  // ¿Ya procesado CON ÉXITO? Sólo entonces se salta. Una fila en 'error' es
  // constancia de un intento fallido, no de un correo consumido: si se tratara
  // igual, arreglar la causa no serviría de nada porque el informe ya estaría
  // dado por visto.
  const { data: ya } = await supabase.from("tc_checkpoint_ejecuciones")
    .select("id, estado").eq("message_id", messageId).maybeSingle();
  if (ya && ya.estado !== "error") return "repetido";
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
        // El kilometraje se dice SIEMPRE que haya revisiones nuevas, aunque
        // salga a cero. Quedarse callado cuando no se ha podido poner ninguno
        // haría pasar por normal lo que puede ser una telemática caída o una
        // flota sin enlazar en la conciliación.
        r.revisiones
          ? `Con kilometraje: ${r.conKilometraje} de ${r.revisiones}` +
            (r.sinKilometraje.length ? ` · sin kilometraje: ${r.sinKilometraje.length}` : "")
          : "",
        r.altas.length ? `Vehículos dados de alta (${r.altas.length}): ${r.altas.join(", ")}` : "",
        r.sinMedir.length ? `Sin cruzar el arco: ${r.sinMedir.length}` : "",
        "",
        r.avisos.length ? "Avisos:" : "",
        ...r.avisos.map((a) => ` · ${a}`),
        // Los motivos de los kilometrajes que faltan van al final y recortados:
        // con la flota entera sin enlazar serían doscientas líneas iguales, y
        // lo que hace falta saber es el motivo, no repetirlo.
        ...(r.sinKilometraje.length
          ? ["", "Revisiones sin kilometraje:", ...r.sinKilometraje.slice(0, 10).map((m) => ` · ${m}`),
             r.sinKilometraje.length > 10 ? ` · … y ${r.sinKilometraje.length - 10} más` : ""]
          : []),
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
    // Lo que no ha pasado no se dice: una línea con seis ceros cada quince
    // minutos acaba tapando la que sí importa. Pero `sinCasar` y `pendientes`
    // se dicen SIEMPRE que no sean cero, porque son los dos avisos de que algo
    // se está quedando fuera.
    console.log(
      [
        `CheckPoint por correo: ${qué} — ${r.correos} correo(s)`,
        r.importados ? `${r.importados} informe(s)` : "",
        r.alertas ? `${r.alertas} alerta(s) de presión` : "",
        r.repetidos ? `${r.repetidos} repetido(s)` : "",
        r.sinCasar ? `${r.sinCasar} SIN CASAR` : "",
        r.ignorados ? `${r.ignorados} ignorado(s)` : "",
        r.errores ? `${r.errores} error(es)` : "",
        r.pendientes ? `${r.pendientes} PENDIENTES para la próxima pasada` : "",
      ].filter(Boolean).join(", "),
    );
  };
}
