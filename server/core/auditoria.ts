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

import type { PoolClient } from "pg";
import db from "../db.ts";

const INSERTAR = `INSERT INTO app_auditoria
   (empresa_id, user_id, accion, entidad, entidad_id, detalle, ip)
 VALUES ($1, $2, $3, $4, $5, $6, $7)`;

type Auditable = {
  empresaId: string;
  userId?: string | null;
  accion: string;
  entidad?: string;
  entidadId?: string;
  detalle?: unknown;
  ip?: string;
};

const parametros = (o: Auditable) => [
  o.empresaId,
  o.userId ?? null,
  o.accion,
  o.entidad ?? null,
  o.entidadId ?? null,
  o.detalle ? JSON.stringify(o.detalle) : null,
  o.ip ?? null,
];

/**
 * Registra una acción DENTRO de una transacción en curso, y **no traga el
 * error**: si la línea de auditoría no se puede escribir, la operación entera
 * se deshace.
 *
 * Es lo contrario de `registrarAuditoria`, y es deliberado. Para lo que mueve
 * dinero, «la operación se guardó pero no se sabe quién la hizo» no es un
 * estado aceptable: era el riesgo R2 de la auditoría inicial. O consta entero
 * o no consta.
 *
 * Que esto sea seguro depende de que este INSERT no pueda fallar por los datos,
 * y por eso la tabla no tiene ni clave ajena ni CHECK (ver `auditoriaSchema.ts`).
 * Lo único que puede rechazarlo es que la base esté caída, y entonces el cobro
 * tampoco se habría guardado.
 */
export async function registrarAuditoriaEnTransaccion(
  client: PoolClient,
  opts: Auditable
): Promise<void> {
  await client.query(INSERTAR, parametros(opts));
}

/**
 * Registra una acción (best-effort: nunca rompe la request).
 *
 * Sigue siendo lo correcto para lo que no mueve dinero —un cambio de
 * configuración, un listado consultado— donde perder la traza es malo pero
 * tumbar la operación es peor.
 */
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
    await db.query(INSERTAR, parametros(opts));
  } catch (e) {
    console.error("registrarAuditoria error:", e);
  }
}
