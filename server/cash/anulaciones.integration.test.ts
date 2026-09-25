/**
 * Lo que queda después de anular una operación, contra PostgreSQL de verdad.
 *
 * Anular deja el original en REVERSED y crea una operación inversa del MISMO
 * tipo, confirmada y con la MISMA referencia. Esa inversa es rastro, no un
 * cobro ni un pago nuevo, y se ha colado dos veces donde no debía:
 *
 *   · en la estadística de gasto, como gasto «sin clasificar» (ver
 *     `gastos.integration.test.ts`);
 *   · en el control de duplicados: la factura cobrada y anulada ya no se
 *     podía volver a cobrar sin autorización, porque la inversa contaba como
 *     el cobro previo.
 *
 * Solo con RUN_DB_TESTS=1 y DATABASE_URL a una base DESECHABLE. Idempotente.
 */

import { beforeAll, describe, expect, it } from "vitest";

const RUN = process.env.RUN_DB_TESTS === "1" && !!process.env.DATABASE_URL;

process.env.CASH_STORAGE_LOCAL = "1";

let db: typeof import("../db.ts").default;
let servicio: typeof import("./service.ts");
let duplicados: typeof import("./duplicates.ts");

const EMPRESA = "00000000-0000-4000-a000-0000000000ec";
const ctx = { empresaId: EMPRESA, userId: null as string | null };
const sufijo = String(process.hrtime.bigint()).slice(-9);
let sesion = 0;

beforeAll(async () => {
  if (!RUN) return;
  db = (await import("../db.ts")).default;
  await (await import("./schema.ts")).initCash();
  servicio = await import("./service.ts");
  duplicados = await import("./duplicates.ts");
  const { rows } = await db.query(
    `INSERT INTO cash_registers (empresa_id, centro, nombre, activa, created_at_ms, updated_at_ms)
     VALUES ($1,'Centro',$2,true,$3,$3) RETURNING id`,
    [EMPRESA, `Anulaciones ${sufijo}`, Date.now()]
  );
  sesion = (await servicio.abrirJornada(ctx, { registerId: rows[0].id, fondoManual: [{ valor: 2000, cantidad: 10 }] })).sesion.id;
}, 180_000);

const operar = (tipo: "COLLECTION" | "PAYMENT", referencia: string) =>
  servicio.registrarOperacion(ctx, {
    sessionId: sesion,
    tipo,
    importeCentimos: 2000,
    formasPago: [{ forma: "CASH", importe: 2000 }],
    ...(tipo === "COLLECTION"
      ? { efectivoRecibido: [{ valor: 2000, cantidad: 1 }] }
      : { efectivoEntregado: [{ valor: 2000, cantidad: 1 }] }),
    referencia,
  });

describe.runIf(RUN)("después de anular", () => {
  it("una factura cobrada y anulada se vuelve a cobrar sin autorización", async () => {
    const ref = `B-ANUL-${sufijo}`;
    const primero = await operar("COLLECTION", ref);
    // Cobrada: el segundo cobro SÍ es un duplicado.
    await expect(operar("COLLECTION", ref)).rejects.toMatchObject({ codigo: "COBRO_DUPLICADO" });

    await servicio.anularOperacion(ctx, primero.operacionId, "cobrada al cliente equivocado");
    expect(await duplicados.cobroPrevioDeFactura(EMPRESA, ref)).toBeNull();
    const segundo = await operar("COLLECTION", ref);
    expect(segundo.numero).toBeTruthy();

    // Y ahora, con el cobro bueno vivo, vuelve a ser duplicado.
    expect((await duplicados.cobroPrevioDeFactura(EMPRESA, ref))?.operacionId).toBe(segundo.operacionId);
  });

  it("lo mismo con un pago: pagado y anulado no cuenta como ya pagado", async () => {
    const ref = `P-ANUL-${sufijo}`;
    const pago = await operar("PAYMENT", ref);
    expect((await duplicados.cobroPrevioDeFactura(EMPRESA, ref, db, null, "PAGO"))?.operacionId).toBe(pago.operacionId);
    await servicio.anularOperacion(ctx, pago.operacionId, "pagado dos veces");
    expect(await duplicados.cobroPrevioDeFactura(EMPRESA, ref, db, null, "PAGO")).toBeNull();
  });
});
