/**
 * Lo que pasa después de cambiar el estado de una asistencia.
 *
 * ── Por qué existe este fichero ─────────────────────────────────────────────
 *
 * Había dos rutas que cambian el estado —la de la APK del operario y la de
 * oficina— y cada una llevaba su propia copia de los enganches posteriores.
 * Añadir algo a una y olvidarlo en la otra no rompe nada visible: sencillamente
 * la mitad de las asistencias no lo hacen, y nadie se entera hasta que alguien
 * mira por qué faltan datos.
 *
 * ── La divergencia que había, y que ya está corregida ──────────────────────
 *
 * Al juntarlas se vio que las dos rutas NO hacían lo mismo. La de la APK se
 * saltaba tres cosas que la de oficina sí hacía:
 *
 *   · `recalcularEstadoAdmin`            — el estado administrativo
 *   · `revisarDocumentacionAlFinalizar`  — programar que se pida el albarán
 *   · `registrarEvento`                  — la línea del diario, SERVICE_COMPLETED
 *
 * O sea que una asistencia cerrada desde la APK —el caso más frecuente— no
 * dejaba SERVICE_COMPLETED. Era un fallo, no una decisión, y ahora los dos
 * caminos ejecutan lo mismo.
 *
 * Lo que SÍ sigue siendo distinto es la auto-transición a «vuelta al taller»,
 * y ésa es una diferencia legítima: desde el panel se puede estar cerrando una
 * asistencia de hace tres días, y decir que el técnico está volviendo al
 * taller sería mentira. Vive en `prepararRespuestaTrasCambio` y depende de
 * `origen`; el resto ya no depende de nada.
 */

import { randomUUID } from "crypto";

import db from "../db.ts";
import { registrarEvento } from "../eventlog/servicio.ts";
import { tipoDesdeEstadoAssist } from "../eventlog/tipos.ts";
import { recalcularEstadoAdmin } from "../documentos/servicio.ts";
import { revisarDocumentacionAlFinalizar } from "../correo/index.ts";

/** Quién cambió el estado. Decide qué enganches corren, ver la cabecera. */
export type OrigenCambio = "operario" | "oficina";

export type ContextoCambio = {
  assistanceId: number;
  /** El estado al que se acaba de pasar. */
  estado: string;
  origen: OrigenCambio;
  tenantId?: string | number | null;
  /** Para el diario y para la línea de la auto-transición. */
  actorNombre?: string | null;
  /** Va en el payload del diario, igual que antes del refactor. */
  tecnico?: string | null;
  ahoraMs: number;
};

/* ── Elegibilidad ────────────────────────────────────────────────────────── */

/**
 * ¿Ha terminado el servicio?
 *
 * **Se mira `finishedAtMs`, nunca `status === "finalizada"`.** En la ruta de la
 * APK ese estado dura un instante: justo después una auto-transición deja la
 * asistencia en `en_camino_base`. Cualquier cosa que se despierte un segundo
 * más tarde y pregunte por el estado no encontraría ninguna asistencia
 * finalizada, y no porque no las haya.
 *
 * `finishedAtMs` se pone una vez y no se quita, así que es el hecho: el
 * servicio terminó a esa hora.
 */
export function estaFinalizada(a: { finishedAtMs?: unknown } | null | undefined): boolean {
  const ms = Number(a?.finishedAtMs ?? 0);
  return Number.isFinite(ms) && ms > 0;
}

/** La misma pregunta, contra la base. Devuelve `null` si la asistencia no existe. */
export async function asistenciaFinalizada(
  assistanceId: number, tenantId?: string | number | null,
): Promise<boolean | null> {
  const r = await db.query(
    `SELECT "finishedAtMs", "tallerId" FROM roadside_assistances WHERE id = $1`,
    [assistanceId],
  );
  const f = r.rows[0];
  if (!f) return null;
  // El taller se comprueba aquí y no en el SQL para poder distinguir «no
  // existe» de «no es tuya» arriba si algún día hace falta; hoy las dos
  // contestan lo mismo, que es lo correcto de cara afuera.
  if (tenantId != null && f.tallerId != null && String(f.tallerId) !== String(tenantId)) return null;
  return estaFinalizada({ finishedAtMs: f.finishedAtMs });
}

/* ── Antes de contestar ──────────────────────────────────────────────────── */

/**
 * Lo que cambia la fila que se va a devolver, así que tiene que ocurrir antes
 * de `res.json`.
 *
 * Devuelve la fila actualizada, o `null` si no ha tocado nada.
 */
export async function prepararRespuestaTrasCambio(
  ctx: ContextoCambio,
): Promise<Record<string, unknown> | null> {
  if (ctx.estado !== "finalizada") return null;
  let fila: Record<string, unknown> | null = null;

  /*
   * El token del informe. Se genera una vez y se conserva: es el enlace que ya
   * se le ha mandado al cliente, y cambiarlo lo dejaría sin informe.
   */
  const rt = await db.query(
    `UPDATE roadside_assistances SET "reportToken" = $2
      WHERE id = $1 AND "reportToken" IS NULL
      RETURNING *`,
    [ctx.assistanceId, randomUUID()],
  );
  if (rt.rows.length) fila = rt.rows[0];

  /*
   * Auto-transición a «vuelta al taller», solo desde la APK.
   *
   * En oficina no se hace, y tiene sentido: quien cierra desde el panel puede
   * estar cerrando una asistencia de hace tres días, y decir que el técnico
   * está volviendo al taller sería mentira.
   */
  if (ctx.origen === "operario") {
    const cuando = ctx.ahoraMs + 1;
    await db.query(
      `INSERT INTO roadside_assistance_events ("assistanceId", status, note, "createdBy", "createdAtMs")
       VALUES ($1, 'en_camino_base', 'Vuelta al taller automática', $2, $3)`,
      [ctx.assistanceId, ctx.actorNombre ?? null, cuando],
    );
    const base = await db.query(
      `UPDATE roadside_assistances
          SET status = 'en_camino_base',
              "enCaminoBaseAtMs" = COALESCE("enCaminoBaseAtMs", $2),
              "updatedAtMs" = $2
        WHERE id = $1 RETURNING *`,
      [ctx.assistanceId, cuando],
    );
    if (base.rows.length) fila = base.rows[0];
  }

  return fila;
}

/* ── Después de contestar ────────────────────────────────────────────────── */

/**
 * Los enganches que no pueden hacer esperar a nadie.
 *
 * Ninguno se espera y ninguno puede tumbar la petición: el técnico ya ha visto
 * su cambio de estado y un problema en TyreControl, en el correo o en el diario
 * no puede deshacerlo. Cada uno traga su error y lo deja en el log.
 *
 * No es `async` a propósito: quien llama no debe poder esperarlo por descuido.
 */
export function engancharPosteriores(ctx: ContextoCambio): void {
  void ejecutarPosteriores(ctx)
    .catch((e) => console.error("[Cierre] enganches posteriores:", e?.message));
}

/**
 * El orden en que ocurren, y por qué ése.
 *
 * Van en serie y no en paralelo. Ninguno depende del anterior, pero cuatro
 * consultas simultáneas contra la misma fila por cada cambio de estado —y hay
 * muchos— es presión sobre la base que no compra nada: nadie está esperando
 * este resultado.
 *
 * Cada uno traga su error y sigue: que TyreControl esté caído no puede impedir
 * que se anote el diario. Lo que no se hace es tragarlo en silencio — todos
 * dejan su línea en el log, que es el mecanismo que el proyecto ya usa.
 */
async function ejecutarPosteriores(ctx: ContextoCambio): Promise<void> {
  const { assistanceId, estado } = ctx;

  /*
   * El taller sale de la ASISTENCIA, no de quien la cerró.
   *
   * La sesión de la APK no lleva taller —el operario se identifica por nombre
   * y código— así que sin esto lo que se escribiera desde la APK iría sin
   * tenant. Y en oficina pasaba algo parecido: se usaba el taller del usuario,
   * que es `null` cuando cierra un administrador. Dos asistencias del mismo
   * taller acababan con tenants distintos según quién las cerrara.
   *
   * El taller de la asistencia es siempre el mismo, lo cierre quien lo cierre.
   */
  let tenantId = ctx.tenantId ?? null;
  let finishedAtMs = 0;
  try {
    const r = await db.query(
      `SELECT "tallerId", "finishedAtMs" FROM roadside_assistances WHERE id = $1`,
      [assistanceId],
    );
    const f = r.rows[0];
    if (f) {
      if (tenantId == null && f.tallerId != null) tenantId = String(f.tallerId);
      finishedAtMs = Number(f.finishedAtMs ?? 0);
    }
  } catch (e: unknown) {
    console.error("[Cierre] no se pudo leer la asistencia:",
      e instanceof Error ? e.message : e);
  }

  const conTenant: ContextoCambio = { ...ctx, tenantId };

  // 1 · TyreControl. Import perezoso, y no por gusto:
  // `tyrecontrol/cierreAsistencia.ts` arrastra el cliente de Supabase, que
  // revienta al cargarse si no hay SUPABASE_URL. Estático, cambiar el estado
  // de una asistencia dependería de tener credenciales de TyreControl.
  if (estado === "finalizada") {
    await import("../tyrecontrol/cierreAsistencia.ts")
      .then((m) => m.engancheCierreTyreControl(assistanceId))
      .catch((e) => console.error("[TyreControl] enganche de cierre:", e?.message));
  }

  // 2 · Estado administrativo. En TODO cambio de estado, no solo al finalizar:
  // depende de si el servicio ha terminado y hay que recalcularlo siempre.
  await recalcularEstadoAdmin("assist", assistanceId)
    .catch((e) => console.error("estado administrativo:", e?.message));

  // 3 · Documentación pendiente, solo al terminar.
  if (estado === "finalizada") {
    await revisarDocumentacionAlFinalizar("assist", assistanceId, tenantId)
      .catch((e) => console.error("revisión de documentación:", e?.message));
  }

  // 4 · El diario. Antes que Satisfaction: si crear la encuesta fallara, la
  // línea que reconstruye qué pasó ya está escrita.
  await anotarDiario(conTenant, finishedAtMs)
    .catch((e) => console.error("[Diario] no se pudo anotar:", e?.message));

  /*
   * 5 · Satisfaction. El último, y solo si el servicio terminó de verdad.
   *
   * La condición es `finishedAtMs`, no el estado: para cuando esto corre, la
   * ruta de la APK ya ha dejado la asistencia en `en_camino_base`.
   *
   * El módulo se carga perezoso y no lanza nunca: una encuesta que no se crea
   * es un problema, pero no uno que pueda estropear un cierre ya guardado.
   */
  if (estado === "finalizada" && finishedAtMs > 0) {
    await import("../satisfaction/postFinalizacion.ts")
      .then((m) => m.procesarSatisfactionTrasFinalizacion({
        assistanceId, tenantId, ahoraMs: ctx.ahoraMs,
      }))
      .catch((e) => console.error("[Satisfaction] tras la finalización:", e?.message));
  }
}

/**
 * La línea del diario, con una clave de deduplicación que aguanta reintentos.
 *
 * ── Por qué la clave no puede llevar la hora ────────────────────────────────
 *
 * La original era `assist-estado-{id}-{estado}-{ahora}`. Con la hora dentro,
 * dos intentos de anotar la MISMA finalización con un milisegundo de
 * diferencia son dos claves distintas, así que el índice único no ve ningún
 * conflicto y el diario acaba con dos SERVICE_COMPLETED del mismo servicio.
 * Ahora que las dos rutas anotan, eso pasa de ser teórico a ser probable.
 *
 * Para la finalización hay una clave natural: `finishedAtMs`. Se pone con un
 * COALESCE, o sea una vez y para siempre, así que identifica el hecho y no el
 * intento. Dos anotaciones de la misma finalización dan la misma clave y la
 * segunda choca contra el índice único.
 *
 * Para los demás estados se conserva la hora, y también a propósito: una
 * asistencia puede ir y volver entre «en camino» y «en punto», y esas dos
 * líneas tienen que salir las dos porque pasaron las dos.
 */
async function anotarDiario(ctx: ContextoCambio, finishedAtMs: number): Promise<void> {
  const tipo = tipoDesdeEstadoAssist(ctx.estado);
  if (!tipo) return;

  const clave = ctx.estado === "finalizada" && finishedAtMs > 0
    ? `assist-estado-${ctx.assistanceId}-finalizada-${finishedAtMs}`
    : `assist-estado-${ctx.assistanceId}-${ctx.estado}-${ctx.ahoraMs}`;

  await registrarEvento({
    system: "assist",
    tenantId: ctx.tenantId == null ? null : String(ctx.tenantId),
    assistanceId: ctx.assistanceId,
    eventType: tipo,
    actorType: "user",
    actorName: ctx.actorNombre ?? null,
    occurredAtMs: ctx.ahoraMs,
    payload: { estado: ctx.estado, tecnico: ctx.tecnico ?? null },
    dedupeKey: clave,
  });
}
