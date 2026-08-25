/**
 * Restaura una copia en OTRA base. `npm run db:restore -- <fichero> <url>`
 *
 * Nunca sobre la base de producción: se restaura en una nueva, se comprueba y
 * se cambia el destino después. Ver el porqué en server/dbBackup.ts.
 */
import { restaurar } from "../server/dbBackup.ts";

const [fichero, destino] = process.argv.slice(2);
if (!fichero || !destino) {
  console.error("Uso: npm run db:restore -- <fichero.dump> <postgres://…/base_nueva>");
  process.exit(1);
}

await restaurar(fichero, destino);
console.log(`Restaurada ${fichero} en ${destino.replace(/:[^:@]*@/, ":***@")}`);
