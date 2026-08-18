/**
 * Registro de auditoría (`app_auditoria`).
 *
 * Vivía dentro de `core/auth.ts`, que además de esto resuelve tokens contra
 * Supabase Auth. Eso obligaba a cualquier módulo que solo quisiera auditar a
 * arrastrar el cliente de Supabase y a exigir `SUPABASE_URL` para poder
 * importarse: un servicio de caja no debería necesitar credenciales de Supabase
 * para escribir una línea de auditoría, y en las pruebas de integración
 * reventaba al cargar el módulo.
 *
 * Se separa aquí, que solo necesita la base de datos. `core/auth.ts` lo
 * reexporta, así que todo lo que ya lo importaba de allí sigue funcionando.
 */

import db from "../db.ts";

/** Registra una acción en app_auditoria (best-effort: nunca rompe la request). */
export async function registrarAuditoria(opts: {
  empresaId: string;
  userId?: string | null;
  accion: string;
  entidad?: string;
  entidadId?: string;
  detalle?: unknown;
  ip?: string;
}): Promise<void> {
  try {
    await db.query(
      `INSERT INTO app_auditoria (empresa_id, user_id, accion, entidad, entidad_id, detalle, ip)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        opts.empresaId,
        opts.userId ?? null,
        opts.accion,
        opts.entidad ?? null,
        opts.entidadId ?? null,
        opts.detalle ? JSON.stringify(opts.detalle) : null,
        opts.ip ?? null,
      ]
    );
  } catch (e) {
    console.error("registrarAuditoria error:", e);
  }
}
