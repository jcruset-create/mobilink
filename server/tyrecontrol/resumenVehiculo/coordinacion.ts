/**
 * Coordinación de resúmenes equivalentes entre instancias.
 *
 * ── El problema ─────────────────────────────────────────────────────────────
 *
 * Dos personas pulsan «Resumen IA» en la misma ficha a la vez. Dentro de un
 * proceso eso se resuelve con un Map de promesas, y así estaba. Pero el Map
 * no cruza procesos: hoy `render.yaml` declara UNA instancia en plan free,
 * solo que subir de plan añade instancias sin tocar código, y durante un
 * despliegue conviven el proceso viejo y el nuevo unos segundos. Dos llamadas
 * pagadas para el mismo resumen.
 *
 * ── Arrendamiento, no cerrojo ───────────────────────────────────────────────
 *
 * Quien consigue insertar su fila en `ia_resumen_en_curso` es el que llama al
 * proveedor. El resto NO se queda esperando a nadie: mira la caché cada poco
 * hasta que el resumen aparece, y si no aparece contesta que se está
 * generando.
 *
 * Es un arrendamiento con caducidad justamente para que la muerte de una
 * instancia no bloquee la ficha: si el que llamaba se cae a medias, su fila
 * caduca y el siguiente la toma. Un `pg_advisory_lock` no serviría aquí, y no
 * por capricho: habría que mantener la transacción abierta mientras se espera
 * a OpenAI, con una conexión del pool secuestrada medio minuto. Eso no se
 * hace.
 *
 * Todas las operaciones son de una sola sentencia. Aquí no se abre ninguna
 * transacción.
 */
import { hostname } from "node:os";

/** Quién soy, solo para diagnóstico. */
export const INSTANCIA =
  process.env.RENDER_INSTANCE_ID || `${hostname()}:${process.pid}`;

async function pool() {
  return (await import("../../db.ts")).default;
}

function avisar(que: string, e: unknown) {
  console.warn(JSON.stringify({
    service: "mobilink-ai",
    operation: "resumen.coordinacion." + que,
    status: "degradado",
    error: String((e as Error)?.message ?? e).slice(0, 200),
  }));
}

export type Arrendamiento = "mio" | "ajeno" | "sin_coordinacion";

/**
 * Intenta quedarse con la generación de esta clave.
 *
 * - `mio`: adelante, llama al proveedor.
 * - `ajeno`: otro la está generando ahora mismo; no llames.
 * - `sin_coordinacion`: la base no contestó. Se devuelve por separado para
 *   que el llamante decida; no se finge que hay coordinación cuando no la hay.
 */
export async function tomar(
  clave: string, empresaId: string, vehiculoId: string, vidaMs: number,
): Promise<Arrendamiento> {
  try {
    const p = await pool();
    const r = await p.query(
      `insert into ia_resumen_en_curso (clave, empresa_id, vehiculo_id, instancia, caduca_at)
       values ($1, $2, $3, $4, now() + ($5::text || ' milliseconds')::interval)
       on conflict (clave) do update
          set instancia = excluded.instancia,
              iniciado_at = now(),
              caduca_at = excluded.caduca_at
        -- Solo se le quita a quien ya lo tenía si su arrendamiento ha caducado:
        -- así una instancia muerta no deja la ficha bloqueada.
        where ia_resumen_en_curso.caduca_at < now()
       returning clave`,
      [clave, empresaId, vehiculoId, INSTANCIA, String(Math.round(vidaMs))]);
    return (r.rowCount ?? 0) > 0 ? "mio" : "ajeno";
  } catch (e) {
    avisar("tomar", e);
    return "sin_coordinacion";
  }
}

/** Suelta el arrendamiento. Solo borra el propio. Nunca lanza. */
export async function soltar(clave: string): Promise<void> {
  try {
    const p = await pool();
    // El propio, y de paso los que dejó colgando alguna instancia que se
    // murió a media llamada: ya están caducados y no los va a soltar nadie.
    await p.query(
      `delete from ia_resumen_en_curso
        where (clave = $1 and instancia = $2) or caduca_at < now()`,
      [clave, INSTANCIA]);
  } catch (e) {
    avisar("soltar", e);
  }
}

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Espera a que el que tiene el arrendamiento guarde el resultado.
 *
 * No espera a una promesa de otro proceso —no se puede—: mira la caché cada
 * `pasoMs` hasta `limiteMs`. Devuelve lo que encuentre, o null si se agota.
 */
export async function esperarResultado<T>(
  buscar: () => Promise<T | null>, limiteMs: number, pasoMs = 500,
): Promise<T | null> {
  const hasta = Date.now() + limiteMs;
  while (Date.now() < hasta) {
    await esperar(pasoMs);
    const hay = await buscar().catch(() => null);
    if (hay) return hay;
  }
  return null;
}
