/**
 * Carga un tarifario en un centro de control.
 *
 *   npm run tarifa:cargar -- --centro=1 --tarifario=seas2026-venta
 *   npm run tarifa:cargar -- --centro=1 --tarifario=seas2026-compra --publicar
 *
 * SEAS son DOS tarifarios, no uno: el documento publica una tabla de venta y
 * otra de compra, y no coinciden. El contrato de venta apunta al plan de venta
 * y el de compra al de compra.
 *
 * Sin `--publicar` el tarifario queda como BORRADOR y no factura nada. Es
 * deliberado: un fichero de datos no debe convertirse en tarifa activa por
 * ejecutar un comando, y menos por error.
 *
 * Volver a ejecutarlo es seguro: si la versión ya está publicada no se toca.
 */

import db from "../server/db.ts";
import { cargarTarifario, publicarVersion, type DefinicionTarifario } from "../server/connect/pricing/tarifario.ts";

const TARIFARIOS: Record<string, () => Promise<DefinicionTarifario>> = {
  "seas2026-venta": async () => (await import("../server/connect/pricing/tarifarios/seas2026.ts")).SEAS_2026_VENTA,
  "seas2026-compra": async () => (await import("../server/connect/pricing/tarifarios/seas2026.ts")).SEAS_2026_COMPRA,
};

function argumento(nombre: string): string | null {
  const p = process.argv.find((a) => a.startsWith(`--${nombre}=`));
  return p ? p.split("=").slice(1).join("=") : null;
}

async function main(): Promise<void> {
  const centro = Number(argumento("centro"));
  const cual = argumento("tarifario");
  const publicar = process.argv.includes("--publicar");

  if (!Number.isFinite(centro) || centro <= 0) {
    throw new Error("Falta --centro=<id del centro de control>");
  }
  const cargador = cual ? TARIFARIOS[cual] : undefined;
  if (!cargador) {
    throw new Error(`Falta --tarifario=<${Object.keys(TARIFARIOS).join("|")}>`);
  }

  const cc = await db.query(`SELECT name FROM connect_control_centers WHERE id = $1`, [centro]);
  if (!cc.rows[0]) throw new Error(`No existe el centro de control ${centro}`);

  const def = await cargador();
  console.log(`Cargando "${def.name}" versión ${def.version} en ${cc.rows[0].name}…`);
  console.log(`Origen de los datos: ${def.fuente}`);

  const r = await cargarTarifario(centro, def);

  if (r.status === "published") {
    console.log(`La versión ${def.version} ya está PUBLICADA y no se toca.`);
    console.log("Para corregir un precio hay que publicar una versión nueva:");
    console.log("cambiar un tarifario publicado alteraría asistencias ya facturadas.");
    return;
  }

  console.log(
    `Cargado como BORRADOR: ${r.reglas} reglas, ${r.extras} suplementos, ` +
    `${r.franjas} franjas, ${r.zonas} zonas, ${r.diasCalendario} días de calendario nuevos, ` +
    `${r.preciosNeumaticos} precios de neumático.`,
  );

  if (publicar) {
    const ok = await publicarVersion(r.tariffVersionId, null);
    console.log(ok ? "PUBLICADO: a partir de ahora factura." : "No se ha podido publicar.");
  } else {
    console.log("");
    console.log("NO factura todavía. Revisa los importes contra el documento original y publica con:");
    console.log(`  npm run tarifa:cargar -- --centro=${centro} --tarifario=${cual} --publicar`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => { console.error(e?.message ?? e); process.exit(1); });
