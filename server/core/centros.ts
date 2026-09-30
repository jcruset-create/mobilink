/**
 * Talleres (centros) de una empresa: alta, cambio de nombre y baja.
 *
 * `app_centros` es la lista de talleres que usan Mobilink Cash (el taller de
 * cada caja), Central y Recepciones. Hasta ahora solo se creaba uno, el
 * «Centro principal», al dar de alta la empresa, y no había forma de añadir
 * otro sin tocar la base: para abrir una caja en un segundo taller no había
 * taller que elegir.
 *
 * Solo el SuperAdmin, desde Empresas y licencias. Nada se borra: un taller con
 * historia se da de baja, porque sus cajas y sus informes lo siguen nombrando.
 */

import type { PoolClient } from "pg";
import db from "../db.ts";

/** La base, o una conexión concreta (las pruebas usan un esquema propio). */
type Ejecutor = { query: PoolClient["query"] };

export type CentroAdmin = {
  id: string;
  nombre: string;
  direccion: string | null;
  activo: boolean;
  /** Cajas activas de Mobilink Cash en este taller. 0 si el módulo no está. */
  cajas: number;
};

export class ErrorCentro extends Error {
  constructor(
    message: string,
    public status: number
  ) {
    super(message);
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function exigirId(id: string, que: string) {
  if (!UUID.test(id)) throw new ErrorCentro(`${que} no existe.`, 404);
}

async function hayCajas(ej: Ejecutor): Promise<boolean> {
  const { rows } = await ej.query(`SELECT to_regclass('cash_registers') IS NOT NULL AS hay`);
  return Boolean(rows[0]?.hay);
}

export async function listarCentrosDeEmpresa(
  empresaId: string,
  ej: Ejecutor = db
): Promise<CentroAdmin[]> {
  exigirId(empresaId, "La empresa");
  const conCajas = await hayCajas(ej);
  const { rows } = await ej.query(
    `SELECT c.id, c.nombre, c.direccion, c.activo,
            ${
              conCajas
                ? `(SELECT COUNT(*)::int FROM cash_registers r WHERE r.centro_id = c.id AND r.activa)`
                : `0`
            } AS cajas
       FROM app_centros c
      WHERE c.empresa_id = $1
      ORDER BY c.activo DESC, c.nombre`,
    [empresaId]
  );
  return rows.map((r: { id: string; nombre: string; direccion: string | null; activo: boolean; cajas: number }) => ({
    id: r.id,
    nombre: r.nombre,
    direccion: r.direccion ?? null,
    activo: r.activo,
    cajas: Number(r.cajas),
  }));
}

function limpiarNombre(nombre: unknown): string {
  const n = String(nombre ?? "").trim().replace(/\s+/g, " ");
  if (n.length < 2) throw new ErrorCentro("El nombre del taller es demasiado corto.", 400);
  if (n.length > 80) throw new ErrorCentro("El nombre del taller es demasiado largo.", 400);
  return n;
}

/**
 * Dos talleres que se llaman igual en la misma empresa son el mismo taller
 * dado de alta dos veces. Sin mayúsculas ni espacios de más: «Agroreus» y
 * «agroreus » también lo son.
 */
async function exigirNombreLibre(ej: Ejecutor, empresaId: string, nombre: string, salvo: string | null) {
  const { rows } = await ej.query(
    `SELECT nombre FROM app_centros
      WHERE empresa_id = $1 AND lower(trim(nombre)) = lower($2)
        AND ($3::uuid IS NULL OR id <> $3)`,
    [empresaId, nombre, salvo]
  );
  if (rows.length > 0) {
    throw new ErrorCentro(`Ya hay un taller llamado «${rows[0].nombre}» en esta empresa.`, 409);
  }
}

export async function crearCentro(
  empresaId: string,
  datos: { nombre: unknown; direccion?: unknown },
  ej: Ejecutor = db
): Promise<CentroAdmin> {
  exigirId(empresaId, "La empresa");
  const nombre = limpiarNombre(datos.nombre);
  const direccion = String(datos.direccion ?? "").trim() || null;
  const { rows: empresa } = await ej.query(`SELECT id FROM app_empresas WHERE id = $1`, [empresaId]);
  if (empresa.length === 0) throw new ErrorCentro("La empresa no existe.", 404);
  await exigirNombreLibre(ej, empresaId, nombre, null);

  const { rows } = await ej.query(
    `INSERT INTO app_centros (empresa_id, nombre, direccion) VALUES ($1, $2, $3)
     RETURNING id, nombre, direccion, activo`,
    [empresaId, nombre, direccion]
  );
  return { ...rows[0], direccion: rows[0].direccion ?? null, cajas: 0 };
}

/**
 * Cambia el nombre, la dirección o si está activo.
 *
 * El nombre también está copiado en `cash_registers.centro`, que es lo que
 * leen los informes: se cambia en la misma transacción, o las cajas seguirían
 * saliendo con el nombre viejo.
 *
 * Dar de baja un taller con cajas activas se para: las cajas se quedarían en
 * un taller que no sale en ningún desplegable. Primero se dan de baja o se
 * mueven las cajas.
 */
export async function actualizarCentro(
  centroId: string,
  datos: { nombre?: unknown; direccion?: unknown; activo?: unknown },
  conexion?: PoolClient
): Promise<{ centro: CentroAdmin; empresaId: string }> {
  exigirId(centroId, "El taller");
  const cliente = conexion ?? (await db.connect());
  const conCajas = await hayCajas(cliente);
  try {
    await cliente.query("BEGIN");
    const { rows: actuales } = await cliente.query(
      `SELECT id, empresa_id, nombre FROM app_centros WHERE id = $1 FOR UPDATE`,
      [centroId]
    );
    if (actuales.length === 0) throw new ErrorCentro("El taller no existe.", 404);
    const actual = actuales[0];

    const campos: string[] = [];
    const valores: unknown[] = [];
    let nombreNuevo: string | null = null;

    if (datos.nombre !== undefined) {
      nombreNuevo = limpiarNombre(datos.nombre);
      if (nombreNuevo !== actual.nombre) {
        await exigirNombreLibre(cliente, actual.empresa_id, nombreNuevo, centroId);
        valores.push(nombreNuevo);
        campos.push(`nombre = $${valores.length}`);
      } else {
        nombreNuevo = null;
      }
    }
    if (datos.direccion !== undefined) {
      valores.push(String(datos.direccion ?? "").trim() || null);
      campos.push(`direccion = $${valores.length}`);
    }
    if (datos.activo !== undefined) {
      if (typeof datos.activo !== "boolean") throw new ErrorCentro("«activo» tiene que ser sí o no.", 400);
      if (!datos.activo && conCajas) {
        const { rows } = await cliente.query(
          `SELECT COUNT(*)::int AS n FROM cash_registers WHERE centro_id = $1 AND activa`,
          [centroId]
        );
        if (rows[0].n > 0) {
          throw new ErrorCentro(
            `El taller tiene ${rows[0].n} ${rows[0].n === 1 ? "caja activa" : "cajas activas"}. Dalas de baja o muévelas a otro taller antes.`,
            409
          );
        }
      }
      valores.push(datos.activo);
      campos.push(`activo = $${valores.length}`);
    }
    if (campos.length === 0) throw new ErrorCentro("Nada que cambiar.", 400);

    valores.push(centroId);
    await cliente.query(`UPDATE app_centros SET ${campos.join(", ")} WHERE id = $${valores.length}`, valores);

    if (nombreNuevo && conCajas) {
      await cliente.query(`UPDATE cash_registers SET centro = $2 WHERE centro_id = $1`, [centroId, nombreNuevo]);
    }
    await cliente.query("COMMIT");
  } catch (e) {
    await cliente.query("ROLLBACK");
    // Dos cajas con el mismo nombre en talleres que pasan a llamarse igual.
    if (String((e as Error)?.message).includes("duplicate key")) {
      throw new ErrorCentro("Con ese nombre, dos cajas quedarían repetidas en el mismo taller.", 409);
    }
    throw e;
  } finally {
    if (!conexion) cliente.release();
  }

  const ej: Ejecutor = conexion ?? db;
  const { rows } = await ej.query(`SELECT empresa_id FROM app_centros WHERE id = $1`, [centroId]);
  const empresaId = rows[0].empresa_id as string;
  const centro = (await listarCentrosDeEmpresa(empresaId, ej)).find((c) => c.id === centroId)!;
  return { centro, empresaId };
}
