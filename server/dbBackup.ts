/**
 * Copia y restauración de la base completa.
 *
 * ## Por qué hacía falta esto
 *
 * El proyecto ya tenía `backup-postgres.ts`, y sigue estando: vuelca seis
 * tablas —`techs`, `jobs`, `logs`, `rules`, `quick_templates`,
 * `job_assignments`— a un JSON. **Ninguna de ellas tiene dinero.** En la base
 * hay 42 tablas `cash_*` y `central_*` y el respaldo cubría cero: ni una
 * jornada, ni un arqueo, ni un movimiento del libro mayor.
 *
 * No era un descuido evidente, y por eso costó verlo: la copia existe, se
 * ejecuta y termina bien. Simplemente no guarda lo que hoy importa.
 *
 * ## Por qué `pg_dump` y no ampliar la lista de tablas
 *
 * Se puede añadir cuarenta y dos nombres a un array. Lo que no se arregla así:
 *
 * · **Un volcado por filas no guarda el esquema.** Restaurar sobre una base
 *   vacía no reconstruye ni las tablas ni los índices ni los CHECK, y este
 *   módulo apoya invariantes en ellos —la ecuación del ingreso bancario, el
 *   índice único de la forma de pago en efectivo, la inmutabilidad de la
 *   auditoría—. Restaurar sin eso da una base que parece la misma y no lo es.
 * · **Insertar fila a fila respeta el orden de las claves ajenas o falla**, y
 *   con las dependencias de este esquema ese orden ya no cabe en la cabeza de
 *   nadie.
 * · **Las secuencias no vuelven a su sitio**, así que el primer documento
 *   emitido después de restaurar chocaría con uno que ya existe.
 *
 * `pg_dump --format=custom` guarda esquema, datos, índices y secuencias, y
 * `pg_restore` los devuelve en el orden correcto. Es la herramienta que ya
 * viene con PostgreSQL y no hay nada que mantener.
 *
 * ## Lo que esto NO es
 *
 * No es una política de respaldo. Ejecutar esto a mano de vez en cuando no
 * protege de nada: hace falta que corra solo, que la copia salga de la máquina
 * y que alguien **haya probado a restaurarla**. Lo tercero es lo que casi nunca
 * se hace, y una copia sin ensayo es una copia que no se sabe si sirve.
 */

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export const CARPETA = path.join(process.cwd(), "backups-postgres");

function urlDeLaBase(): string {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL no está configurada: no hay base que copiar.");
  return url;
}

/**
 * Ejecuta un programa y espera. Los mensajes de error se conservan enteros: un
 * fallo de respaldo que no dice por qué obliga a repetirlo a ciegas.
 */
function ejecutar(programa: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn(programa, args, { stdio: ["ignore", "inherit", "pipe"] });
    let error = "";
    p.stderr.on("data", (d) => {
      error += String(d);
    });
    p.on("error", (e) =>
      reject(new Error(`No se ha podido ejecutar ${programa}: ${e.message}`))
    );
    p.on("close", (codigo) =>
      codigo === 0
        ? resolve()
        : reject(new Error(`${programa} ha terminado con código ${codigo}. ${error.trim()}`))
    );
  });
}

/** Nombre con la fecha dentro: un fichero de respaldo sin fecha no vale. */
export function nombreDeCopia(ahora = new Date()): string {
  return `mobilink-${ahora.toISOString().replace(/:/g, "-").replace(/\..+/, "")}.dump`;
}

/** Copia completa: esquema, datos, índices y secuencias. */
export async function copiar(destino?: string): Promise<string> {
  fs.mkdirSync(CARPETA, { recursive: true });
  const fichero = destino ?? path.join(CARPETA, nombreDeCopia());

  await ejecutar("pg_dump", [
    urlDeLaBase(),
    "--format=custom",
    // Sin dueños ni permisos: la base restaurada casi nunca tiene los mismos
    // roles, y con ellos la restauración falla en la primera línea.
    "--no-owner",
    "--no-privileges",
    `--file=${fichero}`,
  ]);

  return fichero;
}

/**
 * Restaura sobre una base **que tiene que estar vacía**.
 *
 * No se restaura encima de una base con datos, y no es una limitación: es lo
 * correcto. `pg_restore --clean` borraría lo que hay antes de escribir, y si la
 * copia estuviera incompleta el resultado sería una base a medias sin la
 * original a la que volver. Se restaura en una base nueva y se cambia el
 * destino cuando se ha comprobado que está bien.
 */
export async function restaurar(fichero: string, urlDestino: string): Promise<void> {
  if (!fs.existsSync(fichero)) {
    throw new Error(`No existe el fichero de copia: ${fichero}`);
  }

  await ejecutar("pg_restore", [
    `--dbname=${urlDestino}`,
    "--no-owner",
    "--no-privileges",
    /*
     * Sin `--exit-on-error`, que es el comportamiento por defecto de
     * `pg_restore`: sigue con el resto aunque una orden falle. Parece laxo y no
     * lo es — pararse en la primera deja la base a medias sin saber qué más
     * habría fallado, y lo que decide si la copia sirve no es que no haya
     * habido ningún aviso, sino el recuento de después (`TABLAS_CRITICAS`).
     */
    fichero,
  ]);
}

/**
 * Comprueba que una copia restaurada contiene lo que debe.
 *
 * Es la parte que convierte una copia en una copia **de la que uno se fía**.
 * Compara el recuento de las tablas que llevan dinero, no de todas: si cuadran
 * los movimientos del libro mayor, las operaciones y las jornadas, lo demás es
 * accesorio.
 */
export const TABLAS_CRITICAS = [
  "cash_sessions",
  "cash_operations",
  "cash_denomination_movements",
  "cash_counts",
  "cash_bank_deposits",
  "app_auditoria",
] as const;
