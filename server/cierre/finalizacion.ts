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
 * ── Y una divergencia que YA existía ────────────────────────────────────────
 *
 * Al juntarlas salió a la luz que las dos rutas NO hacían lo mismo. La de la
 * APK se saltaba tres cosas que la de oficina sí hace:
 *
 *   · `recalcularEstadoAdmin`      — el estado administrativo
 *   · `revisarDocumentacionAlFinalizar` — programar que se pida el albarán
 *   · `registrarEventoAsistencia`  — la línea del diario, incluido
 *                                    SERVICE_COMPLETED
 *
 * O sea: **una asistencia cerrada desde la APK no deja SERVICE_COMPLETED en el
 * diario**, y es justo el caso más frecuente. Es un fallo real, no una
 * decisión.
 *
 * Aquí se reproduce TAL CUAL mediante `origen`, a propósito. Este cambio es un
 * refactor y un refactor que además arregla cosas no se puede demostrar
 * equivalente: si algo se rompiera, no se sabría si fue la extracción o el
 * arreglo. La divergencia queda documentada, con pruebas que la fijan, y se
 * corrige aparte.
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
  const { assistanceId, estado, origen, ahoraMs } = ctx;

  if (estado === "finalizada") {
    /*
     * Import perezoso, y no por gusto: `tyrecontrol/cierreAsistencia.ts`
     * arrastra el cliente de Supabase, que revienta al cargarse si no hay
     * SUPABASE_URL. Cargándolo estático, cambiar el estado de una asistencia
     * dependería de tener credenciales de TyreControl configuradas.
     */
    void import("../tyrecontrol/cierreAsistencia.ts")
      .then((m) => m.engancheCierreTyreControl(assistanceId))
      .catch((e) => console.error("[TyreControl] enganche de cierre:", e?.message));
  }

  /*
   * Lo que hoy solo hace la ruta de oficina. Ver la divergencia explicada en la
   * cabecera: se reproduce tal cual, no se arregla aquí.
   */
  if (origen !== "oficina") return;

  void recalcularEstadoAdmin("assist", assistanceId)
    .catch((e) => console.error("estado administrativo:", e?.message));

  if (estado === "finalizada") {
    void revisarDocumentacionAlFinalizar("assist", assistanceId, ctx.tenantId ?? null)
      .catch((e) => console.error("revisión de documentación:", e?.message));
  }

  const tipo = tipoDesdeEstadoAssist(estado);
  if (tipo) {
    void registrarEvento({
      system: "assist",
      tenantId: ctx.tenantId == null ? null : String(ctx.tenantId),
      assistanceId,
      eventType: tipo,
      actorType: "user",
      actorName: ctx.actorNombre ?? null,
      occurredAtMs: ahoraMs,
      payload: { estado, tecnico: ctx.tecnico ?? null },
      dedupeKey: `assist-estado-${assistanceId}-${estado}-${ahoraMs}`,
    });
  }
}
