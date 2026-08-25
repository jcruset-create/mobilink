/**
 * Esquema de la auditoría: existencia, inmutabilidad e integridad.
 *
 * Tres cosas que no estaban, y las tres se descubrieron mirando en vez de
 * suponiendo:
 *
 * 1. **La tabla podía no existir.** `app_auditoria` la crea la migración de la
 *    fundación SaaS, que se aplica a mano. En una base sin ella, las 35
 *    llamadas del módulo de caja fallaban en silencio —`registrarAuditoria`
 *    traga sus errores— y nadie se enteraba. Aquí se asegura al arrancar, como
 *    todo lo demás del módulo.
 *
 * 2. **Se podía modificar y borrar.** Las políticas RLS solo permitían leer e
 *    insertar, pero el servidor no pasa por RLS: se conecta con `pg` y las
 *    salta. Un `UPDATE` sobre una línea de auditoría era perfectamente posible.
 *    Ahora lo impide un disparador, que sí alcanza a todo el mundo.
 *
 * 3. **No se podía demostrar que una línea no había cambiado.** Cada fila
 *    guarda ahora la huella de su contenido.
 *
 * Sobre la huella, y conviene ser exacto con lo que hace y lo que no: es una
 * huella **por fila**, no una cadena que encadene cada línea con la anterior.
 * Una cadena detectaría también un borrado, pero obligaría a serializar TODAS
 * las escrituras de auditoría de la instalación —cada una tendría que leer la
 * huella de la anterior con la fila bloqueada— y la auditoría se escribe en
 * cada operación de cada módulo. El borrado ya lo impide el disparador; la
 * huella cubre lo otro: que alguien cambie el contenido por fuera.
 */

import pool from "../db.ts";

export async function initAuditoria(): Promise<void> {
  /*
   * Sin clave ajena a `app_empresas`, y es un cambio deliberado respecto a la
   * migración original.
   *
   * La auditoría pasa a escribirse DENTRO de la transacción que mueve el dinero
   * (ver `registrarAuditoriaEnTransaccion`), y eso cambia las reglas: cualquier
   * cosa que pueda hacer fallar este INSERT deshace un cobro que ya ocurrió
   * físicamente. Una clave ajena es exactamente eso.
   *
   * Además, una auditoría que no admite una línea porque su empresa ya no está
   * es una auditoría que se pierde justo cuando más falta hace. El registro
   * sobrevive a su sujeto: para eso está.
   */
  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_auditoria (
      id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      empresa_id UUID NOT NULL,
      user_id UUID,
      accion TEXT NOT NULL,
      entidad TEXT,
      entidad_id TEXT,
      detalle JSONB,
      ip INET,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_app_auditoria_empresa_fecha
      ON app_auditoria(empresa_id, created_at DESC);

    ALTER TABLE app_auditoria ADD COLUMN IF NOT EXISTS huella TEXT;
  `);

  /*
   * La huella se calcula en la base de datos y no en Node a propósito: así vale
   * también para las líneas que escriba cualquier otro módulo, hoy o mañana, sin
   * que tengan que acordarse de nada.
   */
  await pool.query(`
    CREATE OR REPLACE FUNCTION app_auditoria_huella() RETURNS TRIGGER AS $$
    BEGIN
      NEW.huella := encode(sha256(convert_to(
        COALESCE(NEW.empresa_id::text,'') || '|' ||
        COALESCE(NEW.user_id::text,'')    || '|' ||
        NEW.accion                        || '|' ||
        COALESCE(NEW.entidad,'')          || '|' ||
        COALESCE(NEW.entidad_id,'')       || '|' ||
        COALESCE(NEW.detalle::text,'')    || '|' ||
        COALESCE(NEW.ip::text,'')         || '|' ||
        NEW.created_at::text,
        'UTF8')), 'hex');
      RETURN NEW;
    END $$ LANGUAGE plpgsql;

    DROP TRIGGER IF EXISTS app_auditoria_huella_trg ON app_auditoria;
    CREATE TRIGGER app_auditoria_huella_trg
      BEFORE INSERT ON app_auditoria
      FOR EACH ROW EXECUTE FUNCTION app_auditoria_huella();
  `);

  /*
   * Y el candado. Un mensaje que explica QUÉ hacer en vez de solo negarse:
   * quien se encuentra con esto casi siempre quería corregir algo, y lo que
   * corrige una línea de auditoría equivocada es otra línea, nunca un UPDATE.
   */
  await pool.query(`
    CREATE OR REPLACE FUNCTION app_auditoria_solo_insertar() RETURNS TRIGGER AS $$
    BEGIN
      RAISE EXCEPTION
        'app_auditoria es inmutable: no se puede % una linea de auditoria. Una correccion se registra como una linea nueva.',
        TG_OP;
    END $$ LANGUAGE plpgsql;

    DROP TRIGGER IF EXISTS app_auditoria_inmutable_trg ON app_auditoria;
    CREATE TRIGGER app_auditoria_inmutable_trg
      BEFORE UPDATE OR DELETE ON app_auditoria
      FOR EACH ROW EXECUTE FUNCTION app_auditoria_solo_insertar();
  `);
}
