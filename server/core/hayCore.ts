/**
 * ¿Está Core en esta base?
 *
 * `sea_employees` la crean las migraciones de Supabase, no el arranque del
 * servidor: en una base del módulo sin ellas (pruebas, instalaciones sin Core)
 * no existe, y los módulos tienen que seguir funcionando con sus propios
 * datos. Además dice qué columnas opcionales hay ya, porque sus migraciones se
 * ejecutan a mano y el servidor se despliega antes o después:
 *
 *  · `numero`          — `numero_trabajador` (`core_numero_trabajador.sql`)
 *  · `telefonoEmpresa` — `telefono_empresa` (`core_telefono_empresa.sql`)
 *
 * Se mira cada vez (es una consulta al catálogo, barata) en vez de guardarlo:
 * la migración se ejecuta a mano con el servidor en marcha.
 */

type Consultor = { query: (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }> };

export type HayCore = { core: boolean; numero: boolean; telefonoEmpresa: boolean };

const tieneColumna = (columna: string) => `EXISTS (
              SELECT 1 FROM information_schema.columns
               WHERE table_name = 'sea_employees' AND column_name = '${columna}'
                 AND table_schema = ANY (current_schemas(false))
            )`;

export async function hayCore(cx: Consultor): Promise<HayCore> {
  const { rows } = await cx.query(
    `SELECT to_regclass('sea_employees') IS NOT NULL AS core,
            ${tieneColumna("numero_trabajador")} AS numero,
            ${tieneColumna("telefono_empresa")} AS telefono_empresa`
  );
  return {
    core: rows[0]?.core === true,
    numero: rows[0]?.numero === true,
    telefonoEmpresa: rows[0]?.telefono_empresa === true,
  };
}

/** El nombre completo de Core en SQL, sobre el alias `e`. */
export const NOMBRE_CORE_SQL = `NULLIF(trim(concat_ws(' ', e.nombre, e.apellidos)), '')`;
