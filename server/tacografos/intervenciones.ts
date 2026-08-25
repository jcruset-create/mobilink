/**
 * Traer los datos de una intervención de taller para no teclearlos otra vez.
 *
 * **Supuesto explícito, porque no es evidente:** las tablas `tc_*` de
 * TyreControl no llevan columna de inquilino. Su `empresa_id` apunta a
 * `tc_empresas`, que es la empresa de transportes CLIENTE, no el centro que usa
 * Mobilink; el aislamiento allí lo hace RLS contra `tc_usuarios`, un mecanismo
 * distinto del `app_usuario_modulos` de este módulo. No hay, por tanto, forma
 * de filtrar `tc_intervenciones` por el `empresaId` de la sesión.
 *
 * Por eso el autorrelleno **sólo se ofrece a quien tiene licencia de
 * `tyrecontrol`**: si el centro tiene TyreControl contratado, esos datos ya son
 * suyos y los ve en su propio módulo. Sin esa licencia no se consulta nada, que
 * es lo correcto para un centro que compró sólo Tacógrafos —y que además no
 * tendrá esas tablas—.
 */

import pool from "../db.ts";
import { licenciaActiva } from "../core/auth.ts";

export type Sugerencia = {
  intervencionId: string;
  numero: string | null;
  fecha: string | null;
  matricula: string;
  bastidor: string;
  empresaCliente: string;
  tecnico: string;
};

let tablasPresentes: boolean | null = null;

/**
 * ¿Existen las tablas de TyreControl en esta base?
 *
 * Se comprueba una vez y se recuerda: un centro que compró sólo este módulo no
 * las tiene, y preguntarlo en cada búsqueda sería una consulta al catálogo por
 * cada tecla. No se invalida nunca porque las tablas no aparecen a mitad de la
 * vida del proceso: las crea el arranque.
 */
async function hayTyreControl(): Promise<boolean> {
  if (tablasPresentes !== null) return tablasPresentes;
  const { rows } = await pool.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN ('tc_intervenciones','tc_vehiculos','tc_empresas')`
  );
  tablasPresentes = Number(rows[0]?.n) === 3;
  return tablasPresentes;
}

/** Sólo para las pruebas: olvida lo aprendido sobre el esquema. */
export function olvidarEsquema(): void {
  tablasPresentes = null;
}

/**
 * ¿Puede este centro traer datos del taller? Licencia de `tyrecontrol` vigente
 * y tablas presentes. Se expone para que la pantalla no enseñe un buscador que
 * nunca va a devolver nada.
 */
export async function autorrellenoDisponible(empresaId: string): Promise<boolean> {
  if (!(await hayTyreControl())) return false;
  try {
    return await licenciaActiva(empresaId, "tyrecontrol");
  } catch {
    return false;
  }
}

/** Fecha `DATE` a `aaaa-mm-dd` con los componentes locales. Mismo motivo que en
 * `repository.aIso`: `toISOString()` corre el día en las zonas al este de UTC. */
function aIso(v: Date | string | null): string | null {
  if (!v) return null;
  if (typeof v === "string") return v.slice(0, 10);
  const dos = (n: number) => String(n).padStart(2, "0");
  return `${v.getFullYear()}-${dos(v.getMonth() + 1)}-${dos(v.getDate())}`;
}

/**
 * Intervenciones recientes que encajan con el texto: matrícula, nº de parte o
 * nombre de la empresa cliente.
 */
export async function buscar(empresaId: string, texto: string): Promise<Sugerencia[]> {
  if (!texto.trim() || !(await autorrellenoDisponible(empresaId))) return [];

  const patron = `%${texto.trim().toLowerCase()}%`;
  const { rows } = await pool.query(
    `SELECT i.id, i.numero, i.fecha,
            COALESCE(v.matricula, '') AS matricula,
            COALESCE(v.bastidor, '')  AS bastidor,
            COALESCE(e.nombre, '')    AS empresa_cliente,
            COALESCE(u.nombre, '')    AS tecnico
       FROM tc_intervenciones i
       LEFT JOIN tc_vehiculos v ON v.id = i.vehiculo_id
       LEFT JOIN tc_empresas  e ON e.id = i.empresa_id
       LEFT JOIN tc_usuarios  u ON u.id = i.tecnico_id
      WHERE LOWER(COALESCE(v.matricula, '')) LIKE $1
         OR LOWER(COALESCE(i.numero, ''))    LIKE $1
         OR LOWER(COALESCE(e.nombre, ''))    LIKE $1
      ORDER BY i.fecha DESC, i.created_at DESC
      LIMIT 20`,
    [patron]
  );

  return rows.map((r) => ({
    intervencionId: r.id,
    numero: r.numero,
    fecha: aIso(r.fecha),
    matricula: String(r.matricula).toUpperCase(),
    bastidor: r.bastidor,
    empresaCliente: r.empresa_cliente,
    tecnico: r.tecnico,
  }));
}
