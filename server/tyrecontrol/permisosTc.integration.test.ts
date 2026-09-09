/**
 * ¿Qué es la clave de servicio para los permisos de TyreControl?
 *
 * ── Qué prueba esto y qué NO ────────────────────────────────────────────────
 *
 * Los RPC de escritura de TC deciden el permiso con `tc_is_superadmin()`,
 * `tc_is_admin()` y `tc_operador_ve_empresa()`, que se apoyan en `auth.uid()`.
 * El servidor de Assist se conecta con la clave de servicio, con la que
 * `auth.uid()` no está definido.
 *
 * Aquí se reproduce ese mecanismo EN LOCAL, con las mismas funciones copiadas
 * de `supabase/migrations/tyrecontrol_fase1/2.sql`, para comprobar qué pasa de
 * verdad cuando no hay usuario. Es la diferencia entre «lo deduzco leyendo el
 * código» y «lo he visto fallar».
 *
 * Lo que NO prueba: nada sobre el Supabase real del proyecto. Esta sesión no
 * tiene credenciales, así que la sonda contra producción (`/api/tyrecontrol/
 * auth-probe`) queda pendiente de ejecutar por alguien que sí las tenga.
 *
 * Solo con RUN_DB_TESTS=1 y DATABASE_URL a una base DESECHABLE.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";

const RUN = process.env.RUN_DB_TESTS === "1" && !!process.env.DATABASE_URL;

let db: typeof import("../db.ts").default;
const sufijo = String(process.hrtime.bigint()).slice(-9);

describe.skipIf(!RUN)("Permisos de TyreControl sin usuario autenticado", () => {
  beforeAll(async () => {
    db = (await import("../db.ts")).default;
    const { initDb } = await import("../db.ts");
    await initDb();

    /*
     * Reproducción mínima del modelo de permisos de TC. `auth.uid()` no existe
     * fuera de Supabase, así que se define devolviendo NULL: es exactamente lo
     * que devuelve cuando la petición llega con la clave de servicio y sin
     * usuario, que es el caso que se quiere medir.
     */
    await db.query(`
      CREATE SCHEMA IF NOT EXISTS auth;
      CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
        LANGUAGE sql STABLE AS $$ SELECT NULL::uuid $$;

      CREATE TABLE IF NOT EXISTS tc_usuarios_prueba_${sufijo} (
        id uuid PRIMARY KEY, nombre text, rol text, es_superadmin boolean DEFAULT false,
        empresa_id uuid
      );

      CREATE OR REPLACE FUNCTION tc_is_superadmin_${sufijo}() RETURNS boolean
        LANGUAGE sql STABLE AS $$
        SELECT coalesce((SELECT es_superadmin FROM tc_usuarios_prueba_${sufijo} WHERE id = auth.uid()), false)
      $$;
      CREATE OR REPLACE FUNCTION tc_is_admin_${sufijo}() RETURNS boolean
        LANGUAGE sql STABLE AS $$
        SELECT coalesce((SELECT rol = 'administrador' FROM tc_usuarios_prueba_${sufijo} WHERE id = auth.uid()), false)
      $$;
      CREATE OR REPLACE FUNCTION tc_auth_empresa_id_${sufijo}() RETURNS uuid
        LANGUAGE sql STABLE AS $$
        SELECT empresa_id FROM tc_usuarios_prueba_${sufijo} WHERE id = auth.uid()
      $$;
    `);

    // Un superadministrador de verdad, para que no se pueda decir que la tabla
    // estaba vacía.
    await db.query(
      `INSERT INTO tc_usuarios_prueba_${sufijo} (id, nombre, rol, es_superadmin, empresa_id)
       VALUES (gen_random_uuid(), 'Jefe', 'administrador', true, gen_random_uuid())`,
    );
  }, 60_000);

  afterAll(async () => {
    if (!RUN) return;
    await db.query(`DROP FUNCTION IF EXISTS tc_is_superadmin_${sufijo}()`).catch(() => {});
    await db.query(`DROP FUNCTION IF EXISTS tc_is_admin_${sufijo}()`).catch(() => {});
    await db.query(`DROP FUNCTION IF EXISTS tc_auth_empresa_id_${sufijo}()`).catch(() => {});
    await db.query(`DROP TABLE IF EXISTS tc_usuarios_prueba_${sufijo}`).catch(() => {});
  }, 30_000);

  /*
   * ÉSTA es la prueba que decide la fase siguiente. Si sale `false`, ninguna
   * escritura por RPC funcionará con la clave de servicio, y habrá que
   * autenticar un usuario de TC.
   */
  it("sin usuario, TC no reconoce a nadie", async () => {
    const r = await db.query(
      `SELECT tc_is_superadmin_${sufijo}() AS sup,
              tc_is_admin_${sufijo}() AS adm,
              tc_auth_empresa_id_${sufijo}() AS emp`,
    );
    expect(r.rows[0].sup).toBe(false);
    expect(r.rows[0].adm).toBe(false);
    expect(r.rows[0].emp).toBeNull();
  });

  /* Y con eso, la guarda que llevan todos los RPC de escritura cierra el paso. */
  it("la guarda de los RPC de escritura rechazaría la operación", async () => {
    const empresa = (await db.query(`SELECT empresa_id FROM tc_usuarios_prueba_${sufijo} LIMIT 1`)).rows[0].empresa_id;
    const r = await db.query(
      `SELECT (tc_is_superadmin_${sufijo}()
               OR (tc_is_admin_${sufijo}() AND $1::uuid = tc_auth_empresa_id_${sufijo}())) AS permitido`,
      [empresa],
    );
    expect(r.rows[0].permitido).toBe(false);
  });

  /*
   * Y al revés: con un usuario resuelto, la misma guarda deja pasar. O sea que
   * el problema no es la guarda, es la identidad — y por eso la solución es
   * autenticar, no saltarse los RPC.
   */
  it("con un usuario resuelto, la misma guarda deja pasar", async () => {
    const u = (await db.query(`SELECT id, empresa_id FROM tc_usuarios_prueba_${sufijo} LIMIT 1`)).rows[0];
    await db.query(
      `CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
         LANGUAGE sql STABLE AS $$ SELECT '${u.id}'::uuid $$`,
    );
    try {
      const r = await db.query(
        `SELECT (tc_is_superadmin_${sufijo}()
                 OR (tc_is_admin_${sufijo}() AND $1::uuid = tc_auth_empresa_id_${sufijo}())) AS permitido`,
        [u.empresa_id],
      );
      expect(r.rows[0].permitido).toBe(true);
    } finally {
      await db.query(
        `CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULL::uuid $$`,
      );
    }
  });
});
