/**
 * Copia completa de la base. `npm run db:dump`
 *
 * Sustituye en la práctica a `backup:postgres`, que solo volcaba seis tablas
 * sin dinero. Aquella se deja porque hay quien la tenga en un cron; ésta es la
 * que hay que usar.
 */
import { copiar } from "../server/dbBackup.ts";

const fichero = await copiar(process.argv[2]);
console.log(`Copia creada: ${fichero}`);
