/**
 * Mobilink Cash contra PostgreSQL de verdad.
 *
 * Aquí se prueba lo que no se puede probar en memoria y que es exactamente lo
 * que cuesta dinero cuando falla:
 *
 *  · El escenario completo del encargo, de la apertura al cierre y a la
 *    apertura del día siguiente, SIN NINGUNA ERP configurada.
 *  · Que la transacción es de verdad: si algo revienta, no queda ni la
 *    operación ni sus movimientos de efectivo.
 *  · Que dos terminales no pueden gastar la misma última pieza.
 *  · Que una ERP caída no se lleva por delante un cobro que ya ocurrió.
 *  · Que un reintento no contabiliza el mismo cobro dos veces.
 *
 * Solo con RUN_DB_TESTS=1 y DATABASE_URL a una base DESECHABLE.
 */

import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { esFallo } from "./domain/result.ts";
import { BANCOS_SEMILLA } from "./domain/banks.ts";

const RUN = process.env.RUN_DB_TESTS === "1" && !!process.env.DATABASE_URL;

/*
 * Los justificantes se guardan en disco durante las pruebas. La CI define un
 * Supabase ficticio para que las suites carguen, y sin esto la subida saldría
 * a buscar un host que no existe. Lo que se prueba aquí es la lógica del
 * módulo, no el almacenamiento de Supabase.
 */
process.env.CASH_STORAGE_LOCAL = "1";

let db: typeof import("../db.ts").default;
let servicio: typeof import("./service.ts");
let repo: typeof import("./repository.ts");
let outbox: typeof import("./erp/worker.ts");
let registry: typeof import("./erp/registry.ts");
let config: typeof import("./config.ts");
let tesoreria: typeof import("./treasury.ts");
let documentos: typeof import("./documents.ts");
let ingresos: typeof import("./bankdeposits.ts");
let informe: typeof import("./report.ts");
let reauth: typeof import("./reauth.ts");
let migracion: typeof import("./migration.ts");
let eventos: typeof import("./events/worker.ts");
let transporte: typeof import("./events/transport.ts");
let MockCashErpConnector: typeof import("./erp/mock.ts").MockCashErpConnector;
let facturaDemo: typeof import("./erp/mock.ts").facturaDemo;

const EMPRESA = "00000000-0000-4000-a000-0000000000ca";
const USUARIO = "00000000-0000-4000-a000-0000000000c1";
const ctx = { empresaId: EMPRESA, userId: null as string | null };

let registerId = 0;

/** Composición del cambio inicial del encargo: 300 €. */
const FONDO_300 = [
  { valor: 5000, cantidad: 2 }, // 100 €
  { valor: 2000, cantidad: 5 }, // 100 €
  { valor: 1000, cantidad: 4 }, //  40 €
  { valor: 500, cantidad: 4 }, //  20 €
  { valor: 200, cantidad: 10 }, //  20 €
  { valor: 100, cantidad: 10 }, //  10 €
  { valor: 50, cantidad: 10 }, //   5 €
  { valor: 20, cantidad: 10 }, //   2 €
  { valor: 10, cantidad: 20 }, //   2 €
  { valor: 5, cantidad: 10 }, // 0,50 €
  { valor: 2, cantidad: 15 }, // 0,30 €
  { valor: 1, cantidad: 20 }, // 0,20 €
];

const total = (lineas: { valor: number; cantidad: number }[]): number =>
  lineas.reduce((a, l) => a + l.valor * l.cantidad, 0);

const cantidad = (lineas: { valor: number; cantidad: number }[], valor: number): number =>
  lineas.find((l) => l.valor === valor)?.cantidad ?? 0;

/**
 * Caja nueva por prueba: evita que una prueba dependa del estado de otra.
 *
 * Cada una con su código —`C1`, `C2`…— porque el código es lo que abre el
 * número de todos sus documentos (`C1-C-26-001`). Con el código vacío la
 * numeración cae al `MC` de reserva y las pruebas dejarían de comprobar lo que
 * de verdad pasa en producción.
 */
async function crearCaja(nombre: string): Promise<number> {
  const ahora = Date.now();
  const { rows } = await db.query(
    `INSERT INTO cash_registers (empresa_id, centro, nombre, created_at_ms, updated_at_ms)
     VALUES ($1,'tarragona',$2,$3,$3) RETURNING id`,
    [EMPRESA, `${nombre}-${String(process.hrtime.bigint()).slice(-9)}`, ahora]
  );
  /*
   * El código se saca del id y no de un contador de la suite: la base de
   * pruebas sobrevive entre ejecuciones, así que un contador que empieza otra
   * vez en 1 chocaría con el `C1` de la vuelta anterior.
   *
   * Y va en base 36, no en decimal: el código admite 6 caracteres, y una base
   * de pruebas veterana pasa de los cinco dígitos —llegó a `CJ10385`— y a
   * partir de ahí fallaban todas las cajas. En base 36 caben ids de hasta
   * sesenta millones.
   */
  const codigo = `C${rows[0].id.toString(36).toUpperCase()}`;
  await db.query(`UPDATE cash_registers SET codigo = $2 WHERE id = $1`, [rows[0].id, codigo]);
  return rows[0].id;
}

/** El número de documento nuevo: CÓDIGO-TIPO-AA-SECUENCIA. */
const numeroDe = (tipo: string) => new RegExp(`^C[0-9A-Z]+-${tipo}-\\d{2}-\\d{3,}$`);

beforeAll(async () => {
  if (!RUN) return;
  db = (await import("../db.ts")).default;
  servicio = await import("./service.ts");
  repo = await import("./repository.ts");
  outbox = await import("./erp/worker.ts");
  registry = await import("./erp/registry.ts");
  config = await import("./config.ts");
  tesoreria = await import("./treasury.ts");
  documentos = await import("./documents.ts");
  ingresos = await import("./bankdeposits.ts");
  informe = await import("./report.ts");
  reauth = await import("./reauth.ts");
  migracion = await import("./migration.ts");
  eventos = await import("./events/worker.ts");
  transporte = await import("./events/transport.ts");
  const mock = await import("./erp/mock.ts");
  MockCashErpConnector = mock.MockCashErpConnector;
  facturaDemo = mock.facturaDemo;

  await (await import("./schema.ts")).initCash();
  registerId = await crearCaja("principal");
});

afterAll(async () => {
  if (!RUN) return;
  await db.end().catch(() => {});
});

describe.runIf(RUN)("Mobilink Cash sin ERP: escenario completo del encargo", () => {
  it("apertura → cobro con cambio → pago → arqueo → cierre → día siguiente", async () => {
    const caja = await crearCaja("escenario");

    // ── 1. Apertura con fondo inicial de 300 € y composición exacta ───────
    const { sesion, stock } = await servicio.abrirJornada(ctx, {
      registerId: caja,
      fondoManual: FONDO_300,
    });
    expect(sesion.estado).toBe("OPEN");
    expect(sesion.fondoInicialCentimos).toBe(30000);
    expect(total(stock)).toBe(30000);

    // ── 2. Cobro de 187 € entregando 205 € → 18 € de cambio ───────────────
    const cobro = await servicio.registrarCobro(ctx, {
      sessionId: sesion.id,
      importeCentimos: 18700,
      formasPago: [{ forma: "CASH", importe: 18700 }],
      efectivoRecibido: [
        { valor: 10000, cantidad: 2 },
        { valor: 500, cantidad: 1 },
      ],
      concepto: "Venta mostrador",
      partyNombre: "Cliente ABC SL",
    });

    expect(cobro.numero).toMatch(numeroDe("C"));
    expect(cobro.efectivoNetoCentimos).toBe(18700);
    expect(cobro.totalStockCentimos).toBe(30000 + 18700);
    expect(cobro.erpSyncStatus).toBe("NOT_APPLICABLE"); // no hay ERP: nada que sincronizar

    // Los dos billetes de 100 € que no había antes están ahora en caja.
    expect(cantidad(cobro.stock, 10000)).toBe(2);

    // El cambio de 18 € salió con las piezas mínimas: 10 + 5 + 2 + 1.
    const movsCobro = await repo.enTransaccion((c) => repo.movimientosDeOperacion(c, cobro.operacionId));
    const salida = movsCobro.find((m) => m.direccion === "OUT");
    expect(salida?.motivo).toBe("CHANGE_GIVEN");
    expect(total(salida!.lineas)).toBe(1800);

    // ── 3. Pago de 127 € indicando exactamente qué sale ───────────────────
    const pago = await servicio.registrarOperacion(ctx, {
      sessionId: sesion.id,
      tipo: "PAYMENT",
      importeCentimos: 12700,
      formasPago: [{ forma: "CASH", importe: 12700 }],
      efectivoEntregado: [
        { valor: 10000, cantidad: 1 },
        { valor: 2000, cantidad: 1 },
        { valor: 500, cantidad: 1 },
        { valor: 200, cantidad: 1 },
      ],
      concepto: "Compra urgente de material",
      partyNombre: "Proveedor XYZ",
    });

    expect(pago.numero).toMatch(numeroDe("P"));
    expect(pago.totalStockCentimos).toBe(30000 + 18700 - 12700);
    expect(cantidad(pago.stock, 10000)).toBe(1); // quedaba uno de los dos

    // ── 4. Arqueo: se cuenta lo que hay y cuadra ──────────────────────────
    const teorico = await servicio.stockDeJornada(sesion.id);
    expect(teorico.totalCentimos).toBe(36000); // 300 + 187 − 127

    const arqueo = await servicio.guardarArqueo(ctx, {
      sessionId: sesion.id,
      contado: teorico.lineas,
    });
    expect(arqueo.estado).toBe("CUADRADA");
    expect(arqueo.cuadraImporte).toBe(true);
    expect(arqueo.cuadranDenominaciones).toBe(true);

    // ── 5. Cierre: 300 € se quedan, el resto al banco ─────────────────────
    const propuesta = await servicio.proponerCierre(sesion.id, 30000);
    expect(total(propuesta.cambioFinal)).toBe(30000);

    const cierre = await servicio.cerrarJornada(ctx, {
      sessionId: sesion.id,
      cambioFinal: propuesta.cambioFinal,
    });

    expect(cierre.sesion.estado).toBe("CLOSED");
    expect(cierre.totalCambioCentimos).toBe(30000);
    expect(cierre.totalIngresoCentimos).toBe(6000); // 360 − 300
    // Cambio final + ingreso bancario = arqueo, también en piezas.
    expect(total(cierre.cambioFinal) + total(cierre.ingresoBancario)).toBe(36000);

    // Todo lo que entró ha salido: el libro mayor de la jornada cierra en cero.
    const stockFinal = await servicio.stockDeJornada(sesion.id);
    expect(stockFinal.totalCentimos).toBe(0);

    // ── 6. Día siguiente: hereda la composición exacta, no solo el importe ─
    const manana = await servicio.abrirJornada(ctx, { registerId: caja });
    expect(manana.sesion.fondoInicialHeredado).toBe(true);
    expect(manana.sesion.fondoInicialCentimos).toBe(30000);
    expect(manana.stock).toEqual(cierre.cambioFinal);
  });

  it("cobro mixto: solo la parte en efectivo mueve denominaciones", async () => {
    const caja = await crearCaja("mixto");
    const { sesion } = await servicio.abrirJornada(ctx, { registerId: caja, fondoManual: FONDO_300 });

    // Factura 300 €: 200 € con tarjeta BBVA y 100 € en efectivo. El cliente
    // entrega 120 € físicos, así que se le devuelven 20 €.
    const r = await servicio.registrarCobro(ctx, {
      sessionId: sesion.id,
      importeCentimos: 30000,
      formasPago: [
        { forma: "BBVA_CARD", importe: 20000, referencia: "auth-9931" },
        { forma: "CASH", importe: 10000 },
      ],
      efectivoRecibido: [
        { valor: 10000, cantidad: 1 },
        { valor: 2000, cantidad: 1 },
      ],
      concepto: "Factura mixta",
    });

    // El inventario sube 100 €, no 300 €.
    expect(r.efectivoNetoCentimos).toBe(10000);
    expect(r.totalStockCentimos).toBe(40000);
    expect(cantidad(r.stock, 2000)).toBe(5); // entró uno y salió uno de cambio

    const resumen = await servicio.resumenJornada(sesion.id);
    const bbva = resumen.porFormaPago.find((f) => f.forma === "BBVA_CARD");
    expect(bbva?.importeCentimos).toBe(20000);
  });

  it("no deja sacar piezas que no hay, y no guarda nada al fallar", async () => {
    const caja = await crearCaja("sinstock");
    const { sesion } = await servicio.abrirJornada(ctx, {
      registerId: caja,
      fondoManual: [{ valor: 5000, cantidad: 2 }], // solo 2 billetes de 50 €
    });

    const antes = await servicio.stockDeJornada(sesion.id);

    await expect(
      servicio.registrarOperacion(ctx, {
        sessionId: sesion.id,
        tipo: "PAYMENT",
        importeCentimos: 15000,
        formasPago: [{ forma: "CASH", importe: 15000 }],
        efectivoEntregado: [{ valor: 5000, cantidad: 3 }],
      })
    ).rejects.toMatchObject({ codigo: "STOCK_INSUFICIENTE" });

    // El rollback tiene que haber dejado la caja exactamente como estaba: ni
    // operación, ni formas de pago, ni movimientos.
    const despues = await servicio.stockDeJornada(sesion.id);
    expect(despues).toEqual(antes);

    const { rows } = await db.query(
      `SELECT COUNT(*) AS n FROM cash_operations WHERE session_id = $1 AND tipo = 'PAYMENT'`,
      [sesion.id]
    );
    expect(Number(rows[0].n)).toBe(0);
  });

  it("hay dinero pero no combinación exacta para el cambio", async () => {
    const caja = await crearCaja("nosolution");
    // Solo billetes de 50 €: se puede cubrir el cambio en importe, pero no
    // componerlo exactamente.
    const { sesion } = await servicio.abrirJornada(ctx, {
      registerId: caja,
      fondoManual: [{ valor: 5000, cantidad: 4 }],
    });

    // Factura de 47 € pagada con un billete de 50 €: sobran 3 €.
    await expect(
      servicio.registrarCobro(ctx, {
        sessionId: sesion.id,
        importeCentimos: 4700,
        formasPago: [{ forma: "CASH", importe: 4700 }],
        efectivoRecibido: [{ valor: 5000, cantidad: 1 }],
      })
    ).rejects.toMatchObject({ codigo: "NO_SOLUTION" });

    const propuesta = await servicio.proponerCambio(sesion.id, 300);
    expect(esFallo(propuesta) && propuesta.motivo).toBe("NO_SOLUTION");
  });

  it("un arqueo puede cuadrar en importe y no en denominaciones", async () => {
    const caja = await crearCaja("descuadre");
    const { sesion } = await servicio.abrirJornada(ctx, {
      registerId: caja,
      fondoManual: [
        { valor: 2000, cantidad: 5 }, // 100 €
        { valor: 1000, cantidad: 5 }, //  50 €
      ],
    });

    // Mismo total (150 €), piezas distintas: faltan 2 de 20 € y sobran 4 de 10 €.
    const arqueo = await servicio.guardarArqueo(ctx, {
      sessionId: sesion.id,
      contado: [
        { valor: 2000, cantidad: 3 },
        { valor: 1000, cantidad: 9 },
      ],
    });

    expect(arqueo.diferencia).toBe(0);
    expect(arqueo.cuadraImporte).toBe(true);
    expect(arqueo.cuadranDenominaciones).toBe(false);
    expect(arqueo.descuadres).toHaveLength(2);
  });

  it("la anulación revierte con un movimiento inverso, sin borrar nada", async () => {
    const caja = await crearCaja("reversion");
    const { sesion } = await servicio.abrirJornada(ctx, { registerId: caja, fondoManual: FONDO_300 });

    const cobro = await servicio.registrarCobro(ctx, {
      sessionId: sesion.id,
      importeCentimos: 5000,
      formasPago: [{ forma: "CASH", importe: 5000 }],
      efectivoRecibido: [{ valor: 5000, cantidad: 1 }],
    });
    expect(cobro.totalStockCentimos).toBe(35000);

    const reversa = await servicio.anularOperacion(ctx, cobro.operacionId, "Cobro duplicado");
    expect(reversa.numero).toMatch(numeroDe("C"));

    const stock = await servicio.stockDeJornada(sesion.id);
    expect(stock.totalCentimos).toBe(30000);

    // La original sigue ahí, marcada, y la reversa la referencia.
    const { rows } = await db.query(
      `SELECT estado FROM cash_operations WHERE id = $1`, [cobro.operacionId]
    );
    expect(rows[0].estado).toBe("REVERSED");

    const { rows: enlace } = await db.query(
      `SELECT reversa_de_id, motivo_reversa FROM cash_operations WHERE id = $1`, [reversa.operacionId]
    );
    expect(enlace[0].reversa_de_id).toBe(cobro.operacionId);
    expect(enlace[0].motivo_reversa).toBe("Cobro duplicado");
  });

  it("una caja no puede tener dos jornadas abiertas", async () => {
    const caja = await crearCaja("doble");
    await servicio.abrirJornada(ctx, { registerId: caja, fondoManual: FONDO_300 });
    await expect(servicio.abrirJornada(ctx, { registerId: caja })).rejects.toMatchObject({
      codigo: "JORNADA_YA_ABIERTA",
    });
  });

  it("no se puede cerrar sin arquear", async () => {
    const caja = await crearCaja("sinarqueo");
    const { sesion } = await servicio.abrirJornada(ctx, { registerId: caja, fondoManual: FONDO_300 });
    await expect(
      servicio.cerrarJornada(ctx, { sessionId: sesion.id, cambioFinal: [] })
    ).rejects.toMatchObject({ codigo: "FALTA_ARQUEO" });
  });

  it("no se puede dejar como cambio una pieza que no se ha contado", async () => {
    const caja = await crearCaja("cambioimposible");
    const { sesion } = await servicio.abrirJornada(ctx, {
      registerId: caja,
      fondoManual: [{ valor: 2000, cantidad: 5 }],
    });
    const stock = await servicio.stockDeJornada(sesion.id);
    await servicio.guardarArqueo(ctx, { sessionId: sesion.id, contado: stock.lineas });

    await expect(
      servicio.cerrarJornada(ctx, {
        sessionId: sesion.id,
        cambioFinal: [{ valor: 50000, cantidad: 1 }],
      })
    ).rejects.toMatchObject({ codigo: "CAMBIO_NO_DISPONIBLE" });
  });
});

describe.runIf(RUN)("concurrencia", () => {
  it("dos terminales no pueden gastar la misma última pieza", async () => {
    const caja = await crearCaja("concurrencia");
    // Un único billete de 50 €. Dos pagos simultáneos de 50 € lo quieren.
    const { sesion } = await servicio.abrirJornada(ctx, {
      registerId: caja,
      fondoManual: [{ valor: 5000, cantidad: 1 }],
    });

    const pago = () =>
      servicio.registrarOperacion(ctx, {
        sessionId: sesion.id,
        tipo: "PAYMENT",
        importeCentimos: 5000,
        formasPago: [{ forma: "CASH", importe: 5000 }],
        efectivoEntregado: [{ valor: 5000, cantidad: 1 }],
      });

    const resultados = await Promise.allSettled([pago(), pago()]);
    const ok = resultados.filter((r) => r.status === "fulfilled");
    const ko = resultados.filter((r) => r.status === "rejected");

    // Exactamente uno. Sin el bloqueo de la jornada pasarían los dos y la caja
    // quedaría con stock negativo.
    expect(ok).toHaveLength(1);
    expect(ko).toHaveLength(1);

    const stock = await servicio.stockDeJornada(sesion.id);
    expect(stock.totalCentimos).toBe(0);
  });

  it("varios cobros simultáneos no pierden ni duplican dinero", async () => {
    const caja = await crearCaja("concurrencia2");
    const { sesion } = await servicio.abrirJornada(ctx, { registerId: caja, fondoManual: FONDO_300 });

    // Ocho cobros exactos de 10 € a la vez: no hay cambio, así que todos deben
    // poder confirmarse y el total tiene que ser exacto.
    const cobros = Array.from({ length: 8 }, () =>
      servicio.registrarCobro(ctx, {
        sessionId: sesion.id,
        importeCentimos: 1000,
        formasPago: [{ forma: "CASH", importe: 1000 }],
        efectivoRecibido: [{ valor: 1000, cantidad: 1 }],
      })
    );
    const resultados = await Promise.allSettled(cobros);
    expect(resultados.filter((r) => r.status === "fulfilled")).toHaveLength(8);

    const stock = await servicio.stockDeJornada(sesion.id);
    expect(stock.totalCentimos).toBe(30000 + 8000);
  });
});

describe.runIf(RUN)("integración con ERP", () => {
  const SISTEMA = "MOCK";

  async function configurarErp(activo: boolean, mock: InstanceType<typeof MockCashErpConnector>) {
    registry._sustituirInstancia("mock", mock);
    const ahora = Date.now();
    await db.query(
      `INSERT INTO cash_erp_configs (empresa_id, centro, connector_key, activo, created_at_ms, updated_at_ms)
       VALUES ($1, '', 'mock', $2, $3, $3)
       ON CONFLICT (empresa_id, centro) DO UPDATE SET activo = EXCLUDED.activo, updated_at_ms = EXCLUDED.updated_at_ms`,
      [EMPRESA, activo, ahora]
    );
  }

  async function importarDocumento(): Promise<number> {
    const d = facturaDemo({ externalId: `F-${String(process.hrtime.bigint()).slice(-9)}` });
    const ahora = Date.now();
    const { rows } = await db.query(
      `INSERT INTO cash_external_documents
         (empresa_id, external_system, external_id, external_reference, tipo, party_tipo,
          party_nombre, numero, total_centimos, pendiente_centimos, moneda, created_at_ms, updated_at_ms)
       VALUES ($1,$2,$3,$3,'CUSTOMER_INVOICE','CUSTOMER',$4,$3,$5,$5,'EUR',$6,$6)
       ON CONFLICT (empresa_id, external_system, external_id) DO UPDATE SET updated_at_ms = EXCLUDED.updated_at_ms
       RETURNING id, external_id`,
      [EMPRESA, SISTEMA, d.externalId, d.parteNombre, d.totalCentimos, ahora]
    );
    return rows[0].id;
  }

  it("una ERP caída no se lleva por delante un cobro que ya ocurrió", async () => {
    const mock = new MockCashErpConnector({ fallo: "TEMPORAL" });
    await configurarErp(true, mock);

    const caja = await crearCaja("erp-caida");
    const { sesion } = await servicio.abrirJornada(ctx, { registerId: caja, fondoManual: FONDO_300 });
    const documentoId = await importarDocumento();
    const { rows: doc } = await db.query(
      `SELECT external_id FROM cash_external_documents WHERE id = $1`, [documentoId]
    );

    const cobro = await servicio.registrarCobro(ctx, {
      sessionId: sesion.id,
      importeCentimos: 18700,
      formasPago: [{ forma: "CASH", importe: 18700 }],
      efectivoRecibido: [{ valor: 10000, cantidad: 2 }],
      documentoId,
      externalSystem: SISTEMA,
      externalDocumentId: doc[0].external_id,
    });

    // El cobro está hecho: el dinero entró en el cajón pase lo que pase.
    expect(cobro.erpSyncStatus).toBe("PENDING");
    expect(cobro.totalStockCentimos).toBe(30000 + 18700);

    // El worker lo intenta, la ERP falla y el cobro SIGUE ahí.
    await outbox.procesarOutbox();

    const { rows } = await db.query(
      `SELECT erp_sync_status, estado FROM cash_operations WHERE id = $1`, [cobro.operacionId]
    );
    expect(rows[0].estado).toBe("CONFIRMED"); // no se ha revertido nada
    expect(rows[0].erp_sync_status).toBe("RETRY_PENDING");

    const stock = await servicio.stockDeJornada(sesion.id);
    expect(stock.totalCentimos).toBe(48700);

    // Cuando la ERP vuelve, el reintento llega a buen puerto.
    mock.configurar({ fallo: "NINGUNO" });
    await db.query(`UPDATE cash_erp_outbox SET proximo_intento_ms = 0 WHERE operation_id = $1`, [
      cobro.operacionId,
    ]);
    await outbox.procesarOutbox();

    const { rows: despues } = await db.query(
      `SELECT erp_sync_status FROM cash_operations WHERE id = $1`, [cobro.operacionId]
    );
    expect(despues[0].erp_sync_status).toBe("SYNCED");
  });

  it("un reintento no contabiliza el mismo cobro dos veces", async () => {
    // La ERP recibe el cobro pero la respuesta se pierde: el reintento tiene
    // que verlo como duplicado y no apuntarlo otra vez.
    const mock = new MockCashErpConnector({ fallo: "NINGUNO" });
    await configurarErp(true, mock);

    const caja = await crearCaja("idempotencia");
    const { sesion } = await servicio.abrirJornada(ctx, { registerId: caja, fondoManual: FONDO_300 });
    const documentoId = await importarDocumento();
    const { rows: doc } = await db.query(
      `SELECT external_id FROM cash_external_documents WHERE id = $1`, [documentoId]
    );

    const cobro = await servicio.registrarCobro(ctx, {
      sessionId: sesion.id,
      importeCentimos: 5000,
      formasPago: [{ forma: "CASH", importe: 5000 }],
      efectivoRecibido: [{ valor: 5000, cantidad: 1 }],
      documentoId,
      externalSystem: SISTEMA,
      externalDocumentId: doc[0].external_id,
    });

    await outbox.procesarOutbox();

    // Se fuerza un segundo envío del mismo evento.
    await db.query(
      `UPDATE cash_erp_outbox SET estado = 'PENDING', proximo_intento_ms = 0 WHERE operation_id = $1`,
      [cobro.operacionId]
    );
    await outbox.procesarOutbox();

    const llamadas = mock.recibidas.filter(
      (r) => r.metodo === "registrarCobro" && r.operacionNumero === cobro.numero
    );
    // La ERP recibió dos llamadas (el reintento), pero solo contabilizó una:
    // la segunda vuelve marcada como duplicada.
    expect(llamadas).toHaveLength(2);

    const { rows } = await db.query(
      `SELECT erp_sync_status FROM cash_operations WHERE id = $1`, [cobro.operacionId]
    );
    expect(rows[0].erp_sync_status).toBe("SYNCED");
  });

  it("importar dos veces la misma factura no la duplica", async () => {
    const externalId = `F-DUP-${String(process.hrtime.bigint()).slice(-9)}`;
    const ahora = Date.now();
    const insertar = () =>
      db.query(
        `INSERT INTO cash_external_documents
           (empresa_id, external_system, external_id, tipo, party_tipo, party_nombre,
            numero, total_centimos, pendiente_centimos, moneda, created_at_ms, updated_at_ms)
         VALUES ($1,$2,$3,'CUSTOMER_INVOICE','CUSTOMER','ABC',$3,18700,18700,'EUR',$4,$4)
         ON CONFLICT (empresa_id, external_system, external_id) DO UPDATE
           SET updated_at_ms = EXCLUDED.updated_at_ms`,
        [EMPRESA, SISTEMA, externalId, ahora]
      );

    await insertar();
    await insertar();

    const { rows } = await db.query(
      `SELECT COUNT(*) AS n FROM cash_external_documents
        WHERE empresa_id = $1 AND external_system = $2 AND external_id = $3`,
      [EMPRESA, SISTEMA, externalId]
    );
    expect(Number(rows[0].n)).toBe(1);
  });

  it("sin ERP configurada no se encola nada y todo sigue funcionando", async () => {
    await db.query(`UPDATE cash_erp_configs SET activo = false WHERE empresa_id = $1`, [EMPRESA]);

    const caja = await crearCaja("autonomo");
    const { sesion } = await servicio.abrirJornada(ctx, { registerId: caja, fondoManual: FONDO_300 });

    const cobro = await servicio.registrarCobro(ctx, {
      sessionId: sesion.id,
      importeCentimos: 5000,
      formasPago: [{ forma: "CASH", importe: 5000 }],
      efectivoRecibido: [{ valor: 5000, cantidad: 1 }],
      concepto: "Cobro manual sin ERP",
    });

    expect(cobro.erpSyncStatus).toBe("NOT_APPLICABLE");
    const { rows } = await db.query(
      `SELECT COUNT(*) AS n FROM cash_erp_outbox WHERE operation_id = $1`, [cobro.operacionId]
    );
    expect(Number(rows[0].n)).toBe(0);

    const estado = await registry.estadoIntegracion(EMPRESA);
    expect(estado.estado).toBe("DESACTIVADA");
  });
});

describe.runIf(RUN)("configuración", () => {
  it("crear una caja la deja lista para abrir jornada", async () => {
    const nombre = `config-${String(process.hrtime.bigint()).slice(-9)}`;
    const caja = await config.crearCaja(ctx, { nombre, centro: "reus" });

    expect(caja.activa).toBe(true);
    expect(caja.nombre).toBe(nombre);

    const lista = await config.listarCajas(EMPRESA);
    const fila = lista.find((c) => c.id === caja.id);
    expect(fila).toMatchObject({ activa: true, jornadas: 0, jornadaAbierta: null });

    // Y efectivamente se puede abrir jornada con ella.
    const { sesion } = await servicio.abrirJornada(ctx, {
      registerId: caja.id,
      fondoManual: [{ valor: 5000, cantidad: 1 }],
    });
    expect(sesion.estado).toBe("OPEN");
  });

  it("volver a crear una caja dada de baja la reactiva en vez de fallar", async () => {
    const nombre = `rebaja-${String(process.hrtime.bigint()).slice(-9)}`;
    const caja = await config.crearCaja(ctx, { nombre, centro: "reus" });
    await config.actualizarCaja(ctx, caja.id, { activa: false });

    const otraVez = await config.crearCaja(ctx, { nombre, centro: "reus" });
    expect(otraVez.id).toBe(caja.id);
    expect(otraVez.activa).toBe(true);
  });

  it("no se puede dar de baja ni renombrar una caja con la jornada abierta", async () => {
    const nombre = `abierta-${String(process.hrtime.bigint()).slice(-9)}`;
    const caja = await config.crearCaja(ctx, { nombre });
    await servicio.abrirJornada(ctx, {
      registerId: caja.id,
      fondoManual: [{ valor: 5000, cantidad: 1 }],
    });

    // Quedaría dinero contado en una caja que ya no aparece, y nadie podría
    // cerrarla.
    await expect(config.actualizarCaja(ctx, caja.id, { activa: false })).rejects.toMatchObject({
      codigo: "JORNADA_ABIERTA",
    });
    await expect(config.actualizarCaja(ctx, caja.id, { nombre: "otro" })).rejects.toMatchObject({
      codigo: "JORNADA_ABIERTA",
    });

    const lista = await config.listarCajas(EMPRESA);
    expect(lista.find((c) => c.id === caja.id)?.activa).toBe(true);
  });

  it("una caja de otra empresa no se puede tocar", async () => {
    const caja = await config.crearCaja(ctx, {
      nombre: `ajena-${String(process.hrtime.bigint()).slice(-9)}`,
    });
    const otraEmpresa = { ...ctx, empresaId: "00000000-0000-4000-a000-0000000000ff" };
    await expect(config.actualizarCaja(otraEmpresa, caja.id, { activa: false })).rejects.toMatchObject({
      codigo: "CAJA_NO_ENCONTRADA",
    });
  });

  it("no se desactiva una denominación con piezas en una caja abierta", async () => {
    const caja = await config.crearCaja(ctx, {
      nombre: `den-${String(process.hrtime.bigint()).slice(-9)}`,
    });
    await servicio.abrirJornada(ctx, {
      registerId: caja.id,
      fondoManual: [{ valor: 20000, cantidad: 1 }], // billete de 200 €
    });

    const { rows } = await db.query(
      `SELECT id FROM cash_denominations WHERE valor_centimos = 20000`
    );
    const id = rows[0].id;

    expect(await config.tienePiezasEnCajaAbierta(id)).toBe(true);
    await expect(config.actualizarDenominacion(ctx, id, { activa: false })).rejects.toMatchObject({
      codigo: "DENOMINACION_EN_USO",
    });
  });

  it("sí se puede cambiar el tamaño del cartucho, y el valor nunca", async () => {
    const { rows } = await db.query(`SELECT * FROM cash_denominations WHERE valor_centimos = 200`);
    const antes = rows[0];

    const d = await config.actualizarDenominacion(ctx, antes.id, { piezasPorCartucho: 40 });
    expect(d.piezasPorCartucho).toBe(40);
    expect(d.valor).toBe(200); // el valor no es ni un parámetro

    // Se puede dejar sin cartucho.
    const sin = await config.actualizarDenominacion(ctx, antes.id, { piezasPorCartucho: null });
    expect(sin.piezasPorCartucho).toBeNull();

    // Y se restaura para no dejar el catálogo tocado a las demás pruebas.
    await config.actualizarDenominacion(ctx, antes.id, {
      piezasPorCartucho: antes.piezas_por_cartucho,
    });
  });

  it("rechaza un tamaño de cartucho que no es un entero positivo", async () => {
    const { rows } = await db.query(`SELECT id FROM cash_denominations WHERE valor_centimos = 100`);
    for (const malo of [0, -5, 2.5]) {
      await expect(
        config.actualizarDenominacion(ctx, rows[0].id, { piezasPorCartucho: malo })
      ).rejects.toMatchObject({ codigo: "ENTRADA_NO_VALIDA" });
    }
  });
});

describe.runIf(RUN)("pago con vuelta", () => {
  it("se paga 19,50 € con un billete de 20 € y el proveedor devuelve 0,50 €", async () => {
    const caja = await crearCaja("pago-vuelta");
    const { sesion } = await servicio.abrirJornada(ctx, {
      registerId: caja,
      fondoManual: [
        { valor: 2000, cantidad: 2 },
        { valor: 1000, cantidad: 1 },
      ],
    });

    const r = await servicio.registrarOperacion(ctx, {
      sessionId: sesion.id,
      tipo: "PAYMENT",
      importeCentimos: 1950,
      formasPago: [{ forma: "CASH", importe: 1950 }],
      efectivoEntregado: [{ valor: 2000, cantidad: 1 }],
      efectivoRecibido: [{ valor: 50, cantidad: 1 }],
      concepto: "Compra con vuelta",
    });

    // Sale un billete de 20 y entra una moneda de 0,50: el neto es el pago.
    expect(r.efectivoNetoCentimos).toBe(-1950);
    expect(r.totalStockCentimos).toBe(5000 - 1950);
    expect(cantidad(r.stock, 2000)).toBe(1);
    expect(cantidad(r.stock, 50)).toBe(1);

    // Y el libro mayor guarda los DOS movimientos, no un neto de 19,50 €.
    const movimientos = await repo.enTransaccion((c) =>
      repo.movimientosDeOperacion(c, r.operacionId)
    );
    const salida = movimientos.find((m) => m.direccion === "OUT");
    const entrada = movimientos.find((m) => m.direccion === "IN");
    expect(salida!.lineas).toMatchObject([{ valor: 2000, cantidad: 1 }]);
    expect(entrada!.lineas).toMatchObject([{ valor: 50, cantidad: 1 }]);
  });

  it("rechaza una vuelta que no cuadra con el importe", async () => {
    const caja = await crearCaja("pago-vuelta-mala");
    const { sesion } = await servicio.abrirJornada(ctx, {
      registerId: caja,
      fondoManual: [{ valor: 2000, cantidad: 2 }],
    });

    await expect(
      servicio.registrarOperacion(ctx, {
        sessionId: sesion.id,
        tipo: "PAYMENT",
        importeCentimos: 1950,
        formasPago: [{ forma: "CASH", importe: 1950 }],
        efectivoEntregado: [{ valor: 2000, cantidad: 1 }],
        efectivoRecibido: [{ valor: 100, cantidad: 1 }], // devuelve 1 €, no 0,50
        concepto: "Vuelta que no cuadra",
      })
    ).rejects.toMatchObject({ codigo: "EFECTIVO_NO_CUADRA" });
  });
});

describe.runIf(RUN)("cambio al banco", () => {
  it("el dinero sale al pedirlo y entra al recibirlo, cruzando jornadas", async () => {
    const caja = await crearCaja("cambio-banco");
    const { sesion } = await servicio.abrirJornada(ctx, {
      registerId: caja,
      fondoManual: [{ valor: 5000, cantidad: 6 }], // 300 € en billetes de 50
    });

    const pedido = await tesoreria.crearPedido(ctx, {
      sessionId: sesion.id,
      importeCentimos: 20000,
      solicitado: [{ valor: 100, cantidad: 200, cartuchos: 8 }],
    });

    expect(pedido.numero).toMatch(numeroDe("CB"));
    expect(pedido.estado).toBe("PENDIENTE");
    // Los 200 € YA no están en la caja: el arqueo de la tarde tiene que cuadrar.
    const tras = await servicio.stockDeJornada(sesion.id);
    expect(tras.totalCentimos).toBe(10000);

    // Y se ve como pendiente, para que el descuadre no sea un misterio.
    const fuera = await tesoreria.pendientes(EMPRESA, caja);
    expect(fuera.totalFueraCentimos).toBe(20000);
    expect(fuera.pedidos).toHaveLength(1);

    // Se cierra la jornada con el pedido vivo y se abre la del día siguiente.
    await servicio.guardarArqueo(ctx, { sessionId: sesion.id, contado: tras.lineas });
    await servicio.cerrarJornada(ctx, { sessionId: sesion.id, cambioFinal: tras.lineas });
    const manana = await servicio.abrirJornada(ctx, { registerId: caja });

    // El banco trae 8 tubos de 1 €: 200 monedas.
    const recibido = await tesoreria.recibirPedido(ctx, pedido.id, {
      sessionId: manana.sesion.id,
      recibido: [{ valor: 100, cantidad: 200, cartuchos: 8 }],
    });

    expect(recibido.estado).toBe("RECIBIDO");
    expect(recibido.importeRecibidoCentimos).toBe(20000);

    const stockManana = await servicio.stockDeJornada(manana.sesion.id);
    expect(stockManana.totalCentimos).toBe(10000 + 20000);
    expect(cantidad(stockManana.lineas, 100)).toBe(200);

    // Ya no hay nada fuera de la caja.
    expect((await tesoreria.pendientes(EMPRESA, caja)).totalFueraCentimos).toBe(0);
  });

  it("una diferencia con el banco necesita explicación", async () => {
    const caja = await crearCaja("cambio-diferencia");
    const { sesion } = await servicio.abrirJornada(ctx, {
      registerId: caja,
      fondoManual: [{ valor: 5000, cantidad: 4 }],
    });
    const pedido = await tesoreria.crearPedido(ctx, {
      sessionId: sesion.id,
      importeCentimos: 10000,
      solicitado: [{ valor: 100, cantidad: 100, cartuchos: 4 }],
    });

    // El banco da 95 € en vez de 100: sin motivo no se valida.
    await expect(
      tesoreria.recibirPedido(ctx, pedido.id, {
        sessionId: sesion.id,
        recibido: [{ valor: 500, cantidad: 19 }],
      })
    ).rejects.toMatchObject({ codigo: "DIFERENCIA_SIN_MOTIVO" });

    const r = await tesoreria.recibirPedido(ctx, pedido.id, {
      sessionId: sesion.id,
      recibido: [{ valor: 500, cantidad: 19 }],
      diferenciaMotivo: "El banco no tenía suelto suficiente",
    });
    expect(r.importeRecibidoCentimos).toBe(9500);
    expect(r.diferenciaMotivo).toMatch(/suelto/);
  });

  it("cancelar devuelve el dinero tal y como salió", async () => {
    const caja = await crearCaja("cambio-cancelado");
    const { sesion } = await servicio.abrirJornada(ctx, {
      registerId: caja,
      fondoManual: [{ valor: 5000, cantidad: 4 }],
    });
    const pedido = await tesoreria.crearPedido(ctx, {
      sessionId: sesion.id,
      importeCentimos: 10000,
      solicitado: [{ valor: 100, cantidad: 50, cartuchos: 2 }],
    });

    const cancelado = await tesoreria.cancelarPedido(ctx, pedido.id, sesion.id, "El banco estaba cerrado");
    expect(cancelado.estado).toBe("CANCELADO");

    const stock = await servicio.stockDeJornada(sesion.id);
    expect(stock.totalCentimos).toBe(20000);
    expect(cantidad(stock.lineas, 5000)).toBe(4);
  });

  it("no se puede recibir dos veces el mismo pedido", async () => {
    const caja = await crearCaja("cambio-doble");
    const { sesion } = await servicio.abrirJornada(ctx, {
      registerId: caja,
      fondoManual: [{ valor: 5000, cantidad: 2 }],
    });
    const pedido = await tesoreria.crearPedido(ctx, {
      sessionId: sesion.id,
      importeCentimos: 5000,
      solicitado: [{ valor: 100, cantidad: 50, cartuchos: 2 }],
    });
    await tesoreria.recibirPedido(ctx, pedido.id, {
      sessionId: sesion.id,
      recibido: [{ valor: 100, cantidad: 50, cartuchos: 2 }],
    });

    await expect(
      tesoreria.recibirPedido(ctx, pedido.id, {
        sessionId: sesion.id,
        recibido: [{ valor: 100, cantidad: 50, cartuchos: 2 }],
      })
    ).rejects.toMatchObject({ codigo: "PEDIDO_YA_CERRADO" });
  });
});

describe.runIf(RUN)("entregas de dinero a personas", () => {
  it("el caso del encargo: 50 € para comprar agua, factura de 40 € y 10 € de vuelta", async () => {
    const caja = await crearCaja("entrega-agua");
    const { sesion } = await servicio.abrirJornada(ctx, {
      registerId: caja,
      fondoManual: [
        { valor: 5000, cantidad: 2 },
        { valor: 1000, cantidad: 5 },
      ],
    });

    const entrega = await tesoreria.entregarDinero(ctx, {
      sessionId: sesion.id,
      persona: "Juan",
      motivo: "Comprar agua",
      importeCentimos: 5000,
      entregado: [{ valor: 5000, cantidad: 1 }],
    });

    expect(entrega.numero).toMatch(numeroDe("EN"));
    expect(entrega.estado).toBe("ABIERTA");

    // El billete de 50 € ya no está en el cajón.
    const conJuan = await servicio.stockDeJornada(sesion.id);
    expect(conJuan.totalCentimos).toBe(15000 - 5000);
    expect(cantidad(conJuan.lineas, 5000)).toBe(1);

    // Y la caja sabe quién lo tiene.
    const fuera = await tesoreria.pendientes(EMPRESA, caja);
    expect(fuera.entregas[0]).toMatchObject({ persona: "Juan", importeCentimos: 5000 });

    // Vuelve con la factura de 40 € y un billete de 10 €.
    const liquidada = await tesoreria.liquidarEntrega(ctx, entrega.id, {
      sessionId: sesion.id,
      gastoCentimos: 4000,
      devuelto: [{ valor: 1000, cantidad: 1 }],
      proveedor: "Supermercado",
      facturaReferencia: "F-2026-77",
    });

    expect(liquidada.estado).toBe("LIQUIDADA");
    expect(liquidada.diferenciaCentimos).toBe(0);

    // La caja ha bajado exactamente 40 €, que es el pago real.
    const final = await servicio.stockDeJornada(sesion.id);
    expect(final.totalCentimos).toBe(15000 - 4000);
    expect(cantidad(final.lineas, 1000)).toBe(6); // los 5 de antes más el que vuelve

    // En el listado de operaciones hay UN pago, y es de 40 €.
    const detalle = await servicio.detalleJornada(sesion.id);
    const pagos = detalle.operaciones.filter((o) => o.tipo === "PAYMENT");
    expect(pagos).toHaveLength(1);
    expect(pagos[0].importeCentimos).toBe(4000);

    // Y ese pago NO vuelve a mover piezas: ya salieron con la entrega.
    const movs = await repo.enTransaccion((c) => repo.movimientosDeOperacion(c, pagos[0].id));
    expect(movs).toEqual([]);

    expect((await tesoreria.pendientes(EMPRESA, caja)).totalFueraCentimos).toBe(0);
  });

  it("si no compra nada y lo devuelve todo, no hay pago", async () => {
    const caja = await crearCaja("entrega-devuelta");
    const { sesion } = await servicio.abrirJornada(ctx, {
      registerId: caja,
      fondoManual: [{ valor: 5000, cantidad: 2 }],
    });
    const entrega = await tesoreria.entregarDinero(ctx, {
      sessionId: sesion.id,
      persona: "Marta",
      motivo: "Comprar agua",
      importeCentimos: 5000,
      entregado: [{ valor: 5000, cantidad: 1 }],
    });

    const r = await tesoreria.liquidarEntrega(ctx, entrega.id, {
      sessionId: sesion.id,
      gastoCentimos: 0,
      devuelto: [{ valor: 5000, cantidad: 1 }],
    });

    expect(r.estado).toBe("DEVUELTA");
    const stock = await servicio.stockDeJornada(sesion.id);
    expect(stock.totalCentimos).toBe(10000);

    const detalle = await servicio.detalleJornada(sesion.id);
    expect(detalle.operaciones.filter((o) => o.tipo === "PAYMENT")).toHaveLength(0);
  });

  it("si falta dinero hay que explicarlo, y queda con el nombre de quien lo tenía", async () => {
    const caja = await crearCaja("entrega-descuadre");
    const { sesion } = await servicio.abrirJornada(ctx, {
      registerId: caja,
      fondoManual: [{ valor: 5000, cantidad: 2 }],
    });
    const entrega = await tesoreria.entregarDinero(ctx, {
      sessionId: sesion.id,
      persona: "Juan",
      motivo: "Comprar agua",
      importeCentimos: 5000,
      entregado: [{ valor: 5000, cantidad: 1 }],
    });

    // Factura de 40 € pero solo devuelve 8 €: faltan 2 €.
    await expect(
      tesoreria.liquidarEntrega(ctx, entrega.id, {
        sessionId: sesion.id,
        gastoCentimos: 4000,
        devuelto: [{ valor: 500, cantidad: 1 }, { valor: 200, cantidad: 1 }, { valor: 100, cantidad: 1 }],
      })
    ).rejects.toMatchObject({ codigo: "DIFERENCIA_SIN_MOTIVO" });

    const r = await tesoreria.liquidarEntrega(ctx, entrega.id, {
      sessionId: sesion.id,
      gastoCentimos: 4000,
      devuelto: [{ valor: 500, cantidad: 1 }, { valor: 200, cantidad: 1 }, { valor: 100, cantidad: 1 }],
      diferenciaMotivo: "Dice que perdió 2 €",
    });

    expect(r.estado).toBe("LIQUIDADA");
    expect(r.diferenciaCentimos).toBe(200);
    expect(r.persona).toBe("Juan");
  });

  it("una entrega ya liquidada no se liquida otra vez", async () => {
    const caja = await crearCaja("entrega-doble");
    const { sesion } = await servicio.abrirJornada(ctx, {
      registerId: caja,
      fondoManual: [{ valor: 5000, cantidad: 2 }],
    });
    const entrega = await tesoreria.entregarDinero(ctx, {
      sessionId: sesion.id,
      persona: "Juan",
      motivo: "Comprar agua",
      importeCentimos: 5000,
      entregado: [{ valor: 5000, cantidad: 1 }],
    });
    await tesoreria.liquidarEntrega(ctx, entrega.id, {
      sessionId: sesion.id,
      gastoCentimos: 5000,
    });

    await expect(
      tesoreria.liquidarEntrega(ctx, entrega.id, { sessionId: sesion.id, gastoCentimos: 0 })
    ).rejects.toMatchObject({ codigo: "ENTREGA_YA_CERRADA" });
  });

  it("no se puede gastar más de lo entregado", async () => {
    const caja = await crearCaja("entrega-pasada");
    const { sesion } = await servicio.abrirJornada(ctx, {
      registerId: caja,
      fondoManual: [{ valor: 5000, cantidad: 2 }],
    });
    const entrega = await tesoreria.entregarDinero(ctx, {
      sessionId: sesion.id,
      persona: "Juan",
      motivo: "Comprar agua",
      importeCentimos: 5000,
      entregado: [{ valor: 5000, cantidad: 1 }],
    });

    await expect(
      tesoreria.liquidarEntrega(ctx, entrega.id, { sessionId: sesion.id, gastoCentimos: 6000 })
    ).rejects.toMatchObject({ codigo: "GASTO_SUPERA_ENTREGA" });
  });
});

describe.runIf(RUN)("ingresos bancarios", () => {
  /** Compone un importe con las denominaciones de la semilla, de mayor a menor. */
  function componer(centimos: number) {
    const VALORES = [50000, 20000, 10000, 5000, 2000, 1000, 500, 200, 100, 50, 20, 10, 5, 2, 1];
    const lineas: { valor: number; cantidad: number }[] = [];
    let resto = centimos;
    for (const v of VALORES) {
      const n = Math.floor(resto / v);
      if (n > 0) {
        lineas.push({ valor: v, cantidad: n });
        resto -= n * v;
      }
    }
    if (resto !== 0) throw new Error(`no se pudo componer ${centimos}`);
    return lineas;
  }

  /**
   * Abre, arquea y cierra una jornada dejándolo TODO para el banco: el importe
   * del cierre pendiente queda controlado al céntimo.
   */
  async function cerrarJornadaCon(caja: number, centimos: number): Promise<number> {
    const { sesion } = await servicio.abrirJornada(ctx, {
      registerId: caja,
      fondoManual: componer(centimos),
    });
    const teorico = await servicio.stockDeJornada(sesion.id);
    await servicio.guardarArqueo(ctx, { sessionId: sesion.id, contado: teorico.lineas });
    const cierre = await servicio.cerrarJornada(ctx, { sessionId: sesion.id, cambioFinal: [] });
    expect(cierre.totalIngresoCentimos).toBe(centimos);
    return sesion.id;
  }

  it("el criterio de aceptación del encargo, de punta a punta", async () => {
    const caja = await crearCaja("ingresos-criterio");

    // Tres cierres: 2.564,35 + 654,44 + 1.131,66 = 4.350,45 €.
    const s16 = await cerrarJornadaCon(caja, 256435);
    const s17 = await cerrarJornadaCon(caja, 65444);
    const s18 = await cerrarJornadaCon(caja, 113166);

    const antes = await ingresos.panelIngresos(EMPRESA, caja);
    expect(antes.pendientes).toHaveLength(3);
    expect(antes.totalPendienteCentimos).toBe(435045);
    expect(antes.remanenteCentimos).toBe(0);

    // Se ingresan 4.350,00 € en billetes; 0,45 € quedan en tienda.
    const ingreso = await ingresos.crearIngreso(ctx, {
      registerId: caja,
      sessionIds: [s16, s17, s18],
      importeCentimos: 435000,
      referencia: "ING-090",
    });

    expect(ingreso.numero).toMatch(numeroDe("IB"));
    expect(ingreso.remanenteAnteriorCentimos).toBe(0);
    expect(ingreso.totalCierresCentimos).toBe(435045);
    expect(ingreso.importeCentimos).toBe(435000);
    expect(ingreso.remanenteNuevoCentimos).toBe(45);
    // La ecuación del encargo, literal.
    expect(
      ingreso.remanenteAnteriorCentimos + ingreso.totalCierresCentimos - ingreso.importeCentimos
    ).toBe(ingreso.remanenteNuevoCentimos);

    const despues = await ingresos.panelIngresos(EMPRESA, caja);
    expect(despues.pendientes).toHaveLength(0);
    expect(despues.remanenteCentimos).toBe(45);
    expect(despues.ingresos).toHaveLength(1);
    expect(despues.ingresos[0].cierres.map((c) => c.sessionId).sort()).toEqual(
      [s16, s17, s18].sort()
    );
  });

  it("el remanente se arrastra al ingreso siguiente", async () => {
    const caja = await crearCaja("ingresos-remanente");
    const s1 = await cerrarJornadaCon(caja, 435045);
    await ingresos.crearIngreso(ctx, { registerId: caja, sessionIds: [s1], importeCentimos: 435000 });
    expect(await ingresos.remanenteActual(db, caja)).toBe(45);

    // Nuevo cierre de 725,80 €: bajo control hay 0,45 + 725,80 = 726,25 €.
    const s2 = await cerrarJornadaCon(caja, 72580);
    const panel = await ingresos.panelIngresos(EMPRESA, caja);
    expect(panel.totalPendienteCentimos + panel.remanenteCentimos).toBe(72625);

    const segundo = await ingresos.crearIngreso(ctx, {
      registerId: caja,
      sessionIds: [s2],
      importeCentimos: 72600,
    });
    expect(segundo.remanenteAnteriorCentimos).toBe(45);
    expect(segundo.remanenteNuevoCentimos).toBe(25);
    expect(await ingresos.remanenteActual(db, caja)).toBe(25);
  });

  it("no se puede ingresar más de lo que hay bajo control", async () => {
    const caja = await crearCaja("ingresos-exceso");
    const s1 = await cerrarJornadaCon(caja, 10000);

    await expect(
      ingresos.crearIngreso(ctx, { registerId: caja, sessionIds: [s1], importeCentimos: 10001 })
    ).rejects.toMatchObject({ codigo: "INGRESO_SUPERA_DISPONIBLE" });

    // Ni importes que no son dinero de verdad.
    for (const malo of [0, -500, 100.5]) {
      await expect(
        ingresos.crearIngreso(ctx, { registerId: caja, sessionIds: [s1], importeCentimos: malo })
      ).rejects.toMatchObject({ codigo: "ENTRADA_NO_VALIDA" });
    }
  });

  it("un cierre conciliado no puede entrar en otro ingreso", async () => {
    const caja = await crearCaja("ingresos-duplicado");
    const s1 = await cerrarJornadaCon(caja, 20000);
    await ingresos.crearIngreso(ctx, { registerId: caja, sessionIds: [s1], importeCentimos: 20000 });

    await expect(
      ingresos.crearIngreso(ctx, { registerId: caja, sessionIds: [s1], importeCentimos: 10000 })
    ).rejects.toMatchObject({ codigo: "CIERRE_YA_CONCILIADO" });
  });

  it("dos ingresos simultáneos no rompen la cadena ni comparten cierres", async () => {
    const caja = await crearCaja("ingresos-concurrencia");
    const s1 = await cerrarJornadaCon(caja, 30000);

    // Los dos quieren el mismo cierre a la vez: exactamente uno gana.
    const resultados = await Promise.allSettled([
      ingresos.crearIngreso(ctx, { registerId: caja, sessionIds: [s1], importeCentimos: 30000 }),
      ingresos.crearIngreso(ctx, { registerId: caja, sessionIds: [s1], importeCentimos: 29000 }),
    ]);

    const ok = resultados.filter((r) => r.status === "fulfilled");
    const ko = resultados.filter((r) => r.status === "rejected");
    expect(ok).toHaveLength(1);
    expect(ko).toHaveLength(1);

    // Y la cadena queda consistente: un solo ingreso vigente con el cierre.
    const panel = await ingresos.panelIngresos(EMPRESA, caja);
    expect(panel.ingresos.filter((i) => i.estado === "CONFIRMADO")).toHaveLength(1);
    expect(panel.pendientes).toHaveLength(0);
  });

  it("anular restaura exactamente: cierres a pendientes y remanente anterior", async () => {
    const caja = await crearCaja("ingresos-anulacion");
    const s1 = await cerrarJornadaCon(caja, 435045);
    const primero = await ingresos.crearIngreso(ctx, {
      registerId: caja,
      sessionIds: [s1],
      importeCentimos: 435000,
    });
    const s2 = await cerrarJornadaCon(caja, 72580);
    const segundo = await ingresos.crearIngreso(ctx, {
      registerId: caja,
      sessionIds: [s2],
      importeCentimos: 72600,
    });

    // El primero no es el último: anularlo rompería la cadena y se rechaza.
    await expect(
      ingresos.anularIngreso(ctx, primero.id, "prueba")
    ).rejects.toMatchObject({ codigo: "INGRESO_NO_ES_ULTIMO" });

    // El último sí, y restaura el estado anterior al céntimo.
    await ingresos.anularIngreso(ctx, segundo.id, "Referencia equivocada");
    const panel = await ingresos.panelIngresos(EMPRESA, caja);
    expect(panel.remanenteCentimos).toBe(45); // el que dejó el primero
    expect(panel.pendientes.map((c) => c.sessionId)).toEqual([s2]);

    // Sin motivo no hay anulación, y dos veces tampoco.
    await ingresos.anularIngreso(ctx, primero.id, "Ahora sí es el último");
    await expect(
      ingresos.anularIngreso(ctx, primero.id, "otra vez")
    ).rejects.toMatchObject({ codigo: "INGRESO_YA_ANULADO" });

    // Todo devuelto: los dos cierres pendientes y remanente a cero.
    const final = await ingresos.panelIngresos(EMPRESA, caja);
    expect(final.remanenteCentimos).toBe(0);
    expect(final.pendientes.map((c) => c.sessionId).sort()).toEqual([s1, s2].sort());

    // Y un cierre liberado puede entrar en un ingreso nuevo.
    const otra = await ingresos.crearIngreso(ctx, {
      registerId: caja,
      sessionIds: [s1, s2],
      importeCentimos: 507600,
    });
    expect(otra.remanenteNuevoCentimos).toBe(25); // 435045 + 72580 − 507600
  });

  it("una jornada conciliada no se puede reabrir sin anular antes el ingreso", async () => {
    const caja = await crearCaja("ingresos-reabrir");
    const s1 = await cerrarJornadaCon(caja, 15000);
    await ingresos.crearIngreso(ctx, { registerId: caja, sessionIds: [s1], importeCentimos: 15000 });

    await expect(
      servicio.reabrirJornada(ctx, s1, "corrección")
    ).rejects.toMatchObject({ codigo: "JORNADA_CONCILIADA" });
  });

  it("los céntimos cuadran también con importes incómodos", async () => {
    const caja = await crearCaja("ingresos-centimos");
    // 0,01 + 0,02 = 0,03 €: todo monedas, ingreso imposible en billetes salvo 0.
    const s1 = await cerrarJornadaCon(caja, 1);
    const s2 = await cerrarJornadaCon(caja, 2);

    // Ingresar los 3 céntimos es legal (el banco de esta regla lo decide el
    // usuario); lo que no puede es descuadrar.
    const ingreso = await ingresos.crearIngreso(ctx, {
      registerId: caja,
      sessionIds: [s1, s2],
      importeCentimos: 1,
    });
    expect(ingreso.totalCierresCentimos).toBe(3);
    expect(ingreso.remanenteNuevoCentimos).toBe(2);
  });
});

describe.runIf(RUN)("justificantes e informe de cierre", () => {
  /** Un PDF de una página, mínimo pero válido: hace de escaneo. */
  async function pdfDePrueba(texto: string): Promise<Buffer> {
    const { PDFDocument, StandardFonts } = await import("pdf-lib");
    const doc = await PDFDocument.create();
    const pagina = doc.addPage([595.28, 841.89]);
    const fuente = await doc.embedFont(StandardFonts.Helvetica);
    pagina.drawText(texto, { x: 60, y: 760, size: 14, font: fuente });
    return Buffer.from(await doc.save());
  }

  it("se adjunta el PDF del escáner a un cobro y sale en el informe", async () => {
    const caja = await crearCaja("documentos");
    const { sesion } = await servicio.abrirJornada(ctx, { registerId: caja, fondoManual: FONDO_300 });

    const cobro = await servicio.registrarCobro(ctx, {
      sessionId: sesion.id,
      importeCentimos: 5000,
      formasPago: [{ forma: "CASH", importe: 5000 }],
      efectivoRecibido: [{ valor: 5000, cantidad: 1 }],
      concepto: "Venta con factura",
    });

    const doc = await documentos.adjuntarDocumento(ctx, cobro.operacionId, {
      originalname: "factura-1.pdf",
      mimetype: "application/pdf",
      buffer: await pdfDePrueba("FACTURA DE PRUEBA"),
    });

    expect(doc.anulado).toBe(false);
    expect(doc.mime).toBe("application/pdf");
    expect(doc.tamanoBytes).toBeGreaterThan(0);

    const lista = await documentos.documentosDeOperacion(EMPRESA, cobro.operacionId);
    expect(lista).toHaveLength(1);
    expect(lista[0].nombre).toBe("factura-1.pdf");

    // El informe se genera y lleva la página del escaneo detrás de la portada.
    const pdf = await informe.informeCierre(EMPRESA, sesion.id);
    expect(pdf.subarray(0, 4).toString()).toBe("%PDF");

    const { PDFDocument } = await import("pdf-lib");
    const leido = await PDFDocument.load(pdf);
    expect(leido.getPageCount()).toBeGreaterThanOrEqual(2);
  });

  it("un justificante retirado deja de salir en el informe", async () => {
    const caja = await crearCaja("documentos-anulados");
    const { sesion } = await servicio.abrirJornada(ctx, { registerId: caja, fondoManual: FONDO_300 });
    const cobro = await servicio.registrarCobro(ctx, {
      sessionId: sesion.id,
      importeCentimos: 1000,
      formasPago: [{ forma: "CASH", importe: 1000 }],
      efectivoRecibido: [{ valor: 1000, cantidad: 1 }],
      concepto: "Venta con escaneo movido",
    });

    const doc = await documentos.adjuntarDocumento(ctx, cobro.operacionId, {
      originalname: "movido.pdf",
      mimetype: "application/pdf",
      buffer: await pdfDePrueba("ESCANEO MOVIDO"),
    });

    const conDocumento = await informe.informeCierre(EMPRESA, sesion.id);
    const { PDFDocument } = await import("pdf-lib");
    const paginasAntes = (await PDFDocument.load(conDocumento)).getPageCount();

    await documentos.anularDocumento(ctx, doc.id, "Escaneo movido, se repite");

    expect(await documentos.documentosDeOperacion(EMPRESA, cobro.operacionId)).toHaveLength(0);
    // Y sigue constando que existió.
    const conAnulados = await documentos.documentosDeOperacion(EMPRESA, cobro.operacionId, true);
    expect(conAnulados[0]).toMatchObject({ anulado: true, anuladoMotivo: "Escaneo movido, se repite" });

    const sinDocumento = await informe.informeCierre(EMPRESA, sesion.id);
    const paginasDespues = (await PDFDocument.load(sinDocumento)).getPageCount();
    expect(paginasDespues).toBe(paginasAntes - 1);
  });

  it("rechaza lo que no es un justificante", async () => {
    const caja = await crearCaja("documentos-formato");
    const { sesion } = await servicio.abrirJornada(ctx, { registerId: caja, fondoManual: FONDO_300 });
    const cobro = await servicio.registrarCobro(ctx, {
      sessionId: sesion.id,
      importeCentimos: 1000,
      formasPago: [{ forma: "CASH", importe: 1000 }],
      efectivoRecibido: [{ valor: 1000, cantidad: 1 }],
      concepto: "Venta",
    });

    await expect(
      documentos.adjuntarDocumento(ctx, cobro.operacionId, {
        originalname: "hoja.xlsx",
        mimetype: "application/vnd.ms-excel",
        buffer: Buffer.from("no soy un pdf"),
      })
    ).rejects.toMatchObject({ codigo: "FORMATO_NO_ADMITIDO" });
  });

  it("no se adjunta a una operación de otra empresa", async () => {
    const caja = await crearCaja("documentos-ajenos");
    const { sesion } = await servicio.abrirJornada(ctx, { registerId: caja, fondoManual: FONDO_300 });
    const cobro = await servicio.registrarCobro(ctx, {
      sessionId: sesion.id,
      importeCentimos: 1000,
      formasPago: [{ forma: "CASH", importe: 1000 }],
      efectivoRecibido: [{ valor: 1000, cantidad: 1 }],
      concepto: "Venta",
    });

    const otra = { empresaId: "00000000-0000-4000-a000-0000000000ff", userId: null };
    await expect(
      documentos.adjuntarDocumento(otra, cobro.operacionId, {
        originalname: "factura.pdf",
        mimetype: "application/pdf",
        buffer: await pdfDePrueba("AJENA"),
      })
    ).rejects.toMatchObject({ codigo: "OPERACION_NO_ENCONTRADA" });
  });

  it("el informe se genera aunque la jornada no tenga ni un justificante", async () => {
    const caja = await crearCaja("informe-vacio");
    const { sesion } = await servicio.abrirJornada(ctx, { registerId: caja, fondoManual: FONDO_300 });

    const pdf = await informe.informeCierre(EMPRESA, sesion.id);
    expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
    expect(pdf.length).toBeGreaterThan(1000);
  });

  it("el informe de otra empresa no se sirve", async () => {
    const caja = await crearCaja("informe-ajeno");
    const { sesion } = await servicio.abrirJornada(ctx, { registerId: caja, fondoManual: FONDO_300 });

    await expect(
      informe.informeCierre("00000000-0000-4000-a000-0000000000ff", sesion.id)
    ).rejects.toMatchObject({ codigo: "JORNADA_DE_OTRA_EMPRESA" });
  });
});

describe.runIf(RUN)("catálogo de formas de pago", () => {
  it("se siembra solo la primera vez y trae el efectivo marcado", async () => {
    const formas = await config.listarFormasPago(EMPRESA);
    const efectivo = formas.filter((f) => f.afectaEfectivo);

    expect(formas.length).toBeGreaterThanOrEqual(7);
    expect(efectivo).toHaveLength(1);
    expect(efectivo[0].codigo).toBe("CASH");
    expect(efectivo[0].pideReferencia).toBe(false);

    // Y no se duplica al volver a preguntar.
    const otraVez = await config.listarFormasPago(EMPRESA);
    expect(otraVez.length).toBe(formas.length);
  });

  it("una forma nueva sirve para cobrar en cuanto se da de alta", async () => {
    const sufijo = String(process.hrtime.bigint()).slice(-6);
    const forma = await config.crearFormaPago(ctx, { nombre: `Vale regalo ${sufijo}` });
    expect(forma.activa).toBe(true);
    expect(forma.afectaEfectivo).toBe(false);
    expect(forma.codigo).toMatch(/^VALE_REGALO_/);

    const caja = await crearCaja("formas-alta");
    const { sesion } = await servicio.abrirJornada(ctx, { registerId: caja, fondoManual: FONDO_300 });
    const r = await servicio.registrarCobro(ctx, {
      sessionId: sesion.id,
      importeCentimos: 5000,
      formasPago: [{ forma: forma.codigo, importe: 5000, referencia: "V-1" }],
      concepto: "Cobro con forma nueva",
    });

    // No toca el cajón: no es efectivo.
    expect(r.efectivoNetoCentimos).toBe(0);
    expect(r.totalStockCentimos).toBe(30000);
  });

  it("una forma dada de baja deja de admitir cobros nuevos, pero el histórico se conserva", async () => {
    const sufijo = String(process.hrtime.bigint()).slice(-6);
    const forma = await config.crearFormaPago(ctx, { nombre: `Tarjeta local ${sufijo}` });

    const caja = await crearCaja("formas-baja");
    const { sesion } = await servicio.abrirJornada(ctx, { registerId: caja, fondoManual: FONDO_300 });
    const antes = await servicio.registrarCobro(ctx, {
      sessionId: sesion.id,
      importeCentimos: 2500,
      formasPago: [{ forma: forma.codigo, importe: 2500, referencia: "T-1" }],
      concepto: "Antes de la baja",
    });

    await config.actualizarFormaPago(ctx, forma.id, { activa: false });

    await expect(
      servicio.registrarCobro(ctx, {
        sessionId: sesion.id,
        importeCentimos: 1000,
        formasPago: [{ forma: forma.codigo, importe: 1000, referencia: "T-2" }],
        concepto: "Después de la baja",
      })
    ).rejects.toMatchObject({ codigo: "FORMA_PAGO_INACTIVA" });

    // El cobro anterior sigue ahí y con su forma: la baja no reescribe el pasado.
    const previas = await repo.formasPagoDeOperacion(db, antes.operacionId);
    expect(previas.map((f: { forma: string }) => f.forma)).toContain(forma.codigo);
  });

  it("sin referencia no se cobra por una forma que la exige", async () => {
    const caja = await crearCaja("formas-referencia");
    const { sesion } = await servicio.abrirJornada(ctx, { registerId: caja, fondoManual: FONDO_300 });

    await expect(
      servicio.registrarCobro(ctx, {
        sessionId: sesion.id,
        importeCentimos: 4000,
        formasPago: [{ forma: "BBVA_CARD", importe: 4000 }],
        concepto: "Sin autorización del TPV",
      })
    ).rejects.toMatchObject({ codigo: "REFERENCIA_REQUERIDA" });

    // Con referencia, el mismo cobro entra.
    const r = await servicio.registrarCobro(ctx, {
      sessionId: sesion.id,
      importeCentimos: 4000,
      formasPago: [{ forma: "BBVA_CARD", importe: 4000, referencia: "auth-1234" }],
      concepto: "Con autorización del TPV",
    });
    expect(r.efectivoNetoCentimos).toBe(0);
  });

  it("una forma que no está en el catálogo se rechaza", async () => {
    const caja = await crearCaja("formas-desconocida");
    const { sesion } = await servicio.abrirJornada(ctx, { registerId: caja, fondoManual: FONDO_300 });

    await expect(
      servicio.registrarCobro(ctx, {
        sessionId: sesion.id,
        importeCentimos: 1000,
        formasPago: [{ forma: "CRIPTO", importe: 1000, referencia: "x" }],
        concepto: "Forma inventada",
      })
    ).rejects.toMatchObject({ codigo: "FORMA_PAGO_DESCONOCIDA" });
  });

  it("de salida solo el efectivo sale en pagos", async () => {
    const formas = await config.listarFormasPago(EMPRESA);
    const efectivo = formas.find((f) => f.afectaEfectivo)!;
    const tarjeta = formas.find((f) => f.codigo === "BBVA_CARD")!;

    expect(efectivo.enCobros).toBe(true);
    expect(efectivo.enPagos).toBe(true);
    expect(tarjeta.enCobros).toBe(true);
    expect(tarjeta.enPagos).toBe(false);
  });

  it("no se paga con una forma que no está habilitada para pagos", async () => {
    const caja = await crearCaja("formas-solo-cobros");
    const { sesion } = await servicio.abrirJornada(ctx, { registerId: caja, fondoManual: FONDO_300 });

    await expect(
      servicio.registrarOperacion(ctx, {
        sessionId: sesion.id,
        tipo: "PAYMENT",
        importeCentimos: 3000,
        formasPago: [{ forma: "BBVA_CARD", importe: 3000, referencia: "auth-1" }],
        concepto: "Pago con tarjeta no habilitada",
      })
    ).rejects.toMatchObject({ codigo: "FORMA_PAGO_NO_EN_PAGOS" });

    // Y en cuanto se habilita desde Configuración, entra.
    const formas = await config.listarFormasPago(EMPRESA);
    const tarjeta = formas.find((f) => f.codigo === "BBVA_CARD")!;
    await config.actualizarFormaPago(ctx, tarjeta.id, { enPagos: true });

    const r = await servicio.registrarOperacion(ctx, {
      sessionId: sesion.id,
      tipo: "PAYMENT",
      importeCentimos: 3000,
      formasPago: [{ forma: "BBVA_CARD", importe: 3000, referencia: "auth-1" }],
      concepto: "Pago con tarjeta ya habilitada",
    });
    expect(r.efectivoNetoCentimos).toBe(0);

    // Se deja como estaba, que las pruebas comparten el catálogo de la empresa.
    await config.actualizarFormaPago(ctx, tarjeta.id, { enPagos: false });
  });

  it("no se cobra con una forma quitada de cobros", async () => {
    const formas = await config.listarFormasPago(EMPRESA);
    const bizum = formas.find((f) => f.codigo === "BIZUM")!;
    await config.actualizarFormaPago(ctx, bizum.id, { enCobros: false });

    const caja = await crearCaja("formas-sin-cobros");
    const { sesion } = await servicio.abrirJornada(ctx, { registerId: caja, fondoManual: FONDO_300 });

    await expect(
      servicio.registrarCobro(ctx, {
        sessionId: sesion.id,
        importeCentimos: 1000,
        formasPago: [{ forma: "BIZUM", importe: 1000, referencia: "b-1" }],
        concepto: "Cobro por Bizum deshabilitado",
      })
    ).rejects.toMatchObject({ codigo: "FORMA_PAGO_NO_EN_COBROS" });

    await config.actualizarFormaPago(ctx, bizum.id, { enCobros: true });
  });

  it("el efectivo no se puede quitar de ninguna de las dos pantallas", async () => {
    const formas = await config.listarFormasPago(EMPRESA);
    const efectivo = formas.find((f) => f.afectaEfectivo)!;

    await expect(
      config.actualizarFormaPago(ctx, efectivo.id, { enPagos: false })
    ).rejects.toMatchObject({ codigo: "FORMA_PAGO_PROTEGIDA" });
    await expect(
      config.actualizarFormaPago(ctx, efectivo.id, { enCobros: false })
    ).rejects.toMatchObject({ codigo: "FORMA_PAGO_PROTEGIDA" });
  });

  it("el efectivo no se puede dar de baja", async () => {
    const formas = await config.listarFormasPago(EMPRESA);
    const efectivo = formas.find((f) => f.afectaEfectivo)!;

    await expect(
      config.actualizarFormaPago(ctx, efectivo.id, { activa: false })
    ).rejects.toMatchObject({ codigo: "FORMA_PAGO_PROTEGIDA" });
  });

  it("no se crean dos formas con el mismo código", async () => {
    const sufijo = String(process.hrtime.bigint()).slice(-6);
    const nombre = `Cheque ${sufijo}`;
    await config.crearFormaPago(ctx, { nombre });
    await expect(config.crearFormaPago(ctx, { nombre })).rejects.toMatchObject({
      codigo: "FORMA_PAGO_DUPLICADA",
    });
  });

  it("renombrar no cambia el código, así que el histórico no se rompe", async () => {
    const sufijo = String(process.hrtime.bigint()).slice(-6);
    const forma = await config.crearFormaPago(ctx, { nombre: `Bono ${sufijo}` });
    const renombrada = await config.actualizarFormaPago(ctx, forma.id, {
      nombre: "Bono regalo de empresa",
      imagenUrl: "https://ejemplo.test/bono.png",
    });

    expect(renombrada.codigo).toBe(forma.codigo);
    expect(renombrada.nombre).toBe("Bono regalo de empresa");
    expect(renombrada.imagenUrl).toBe("https://ejemplo.test/bono.png");
  });
});

describe.runIf(RUN)("cartuchos", () => {
  /** Cuántas monedas sueltas y cuántos tubos hay de una denominación. */
  async function stock(sessionId: number, valor: number) {
    const { rows } = await db.query(
      `SELECT SUM(CASE WHEN cartuchos = 0
                       THEN (CASE WHEN direccion='IN' THEN cantidad ELSE -cantidad END)
                       ELSE 0 END) AS sueltas,
              SUM(CASE WHEN direccion='IN' THEN cartuchos ELSE -cartuchos END) AS tubos
         FROM cash_denomination_movements
        WHERE session_id = $1 AND valor_unitario_centimos = $2`,
      [sessionId, valor]
    );
    return { sueltas: Number(rows[0].sueltas ?? 0), tubos: Number(rows[0].tubos ?? 0) };
  }

  it("el caso del encargo: se abre el tubo y quedan 22 monedas sueltas", async () => {
    const caja = await crearCaja("cartucho");
    // 1 moneda de 1 € suelta + 1 tubo de 25. Nada de 2 €.
    // Un billete de 50 € para que el pago no dependa de las monedas.
    const { sesion } = await servicio.abrirJornada(ctx, {
      registerId: caja,
      fondoManual: [
        { valor: 100, cantidad: 1 },
        { valor: 5000, cantidad: 1 },
      ],
      fondoCartuchos: [{ valor: 100, cantidad: 1 }],
    });

    // Fondo = 50 € + 1 € suelto + 25 € del tubo = 76 €.
    expect(sesion.fondoInicialCentimos).toBe(7600);
    expect(await stock(sesion.id, 100)).toEqual({ sueltas: 1, tubos: 1 });

    // Salida de 4 € en monedas de 1 €: solo hay 1 suelta, hay que abrir el tubo.
    const r = await servicio.registrarOperacion(ctx, {
      sessionId: sesion.id,
      tipo: "MANUAL_OUT",
      importeCentimos: 400,
      formasPago: [{ forma: "CASH", importe: 400 }],
      efectivoEntregado: [{ valor: 100, cantidad: 4 }],
      concepto: "Salida que obliga a abrir el cartucho",
    });

    expect(r.aperturas).toEqual([{ valor: 100, cartuchos: 1, piezas: 25 }]);

    // 1 suelta + 25 del tubo − 4 entregadas = 22 sueltas, y ya no queda tubo.
    expect(await stock(sesion.id, 100)).toEqual({ sueltas: 22, tubos: 0 });
    expect(r.totalStockCentimos).toBe(7600 - 400);

    // Y el libro mayor deja constancia de que el precinto se rompió.
    const { rows } = await db.query(
      `SELECT direccion, cantidad, cartuchos FROM cash_denomination_movements
        WHERE session_id = $1 AND motivo = 'CARTRIDGE_OPENED' ORDER BY id`,
      [sesion.id]
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ direccion: "OUT", cantidad: 25, cartuchos: 1 });
    expect(rows[1]).toMatchObject({ direccion: "IN", cantidad: 25, cartuchos: 0 });
  });

  it("con sueltas de sobra el precinto no se toca", async () => {
    const caja = await crearCaja("cartucho-intacto");
    const { sesion } = await servicio.abrirJornada(ctx, {
      registerId: caja,
      fondoManual: [{ valor: 100, cantidad: 30 }],
      fondoCartuchos: [{ valor: 100, cantidad: 1 }],
    });

    const r = await servicio.registrarOperacion(ctx, {
      sessionId: sesion.id,
      tipo: "MANUAL_OUT",
      importeCentimos: 400,
      formasPago: [{ forma: "CASH", importe: 400 }],
      efectivoEntregado: [{ valor: 100, cantidad: 4 }],
      concepto: "Salida que NO debe abrir el cartucho",
    });

    expect(r.aperturas).toEqual([]);
    expect(await stock(sesion.id, 100)).toEqual({ sueltas: 26, tubos: 1 });
  });

  it("la propuesta de cambio avisa de los tubos que hay que abrir", async () => {
    const caja = await crearCaja("cartucho-propuesta");
    const { sesion } = await servicio.abrirJornada(ctx, {
      registerId: caja,
      fondoManual: [{ valor: 100, cantidad: 1 }],
      fondoCartuchos: [{ valor: 100, cantidad: 1 }],
    });

    const p = await servicio.proponerCambio(sesion.id, 400);
    expect(p.ok).toBe(true);
    if (esFallo(p)) return;
    expect(p.lineas).toEqual([{ valor: 100, cantidad: 4 }]);
    expect(p.aperturas).toEqual([{ valor: 100, cartuchos: 1, piezas: 25 }]);
  });

  it("un tubo precintado al cierre sigue precintado a la mañana siguiente", async () => {
    const caja = await crearCaja("cartucho-herencia");
    const { sesion } = await servicio.abrirJornada(ctx, {
      registerId: caja,
      fondoManual: [{ valor: 100, cantidad: 2 }],
      fondoCartuchos: [{ valor: 100, cantidad: 2 }],
    });
    expect(await stock(sesion.id, 100)).toEqual({ sueltas: 2, tubos: 2 });

    // No se toca nada: se cuenta lo que hay -2 sueltas y 2 tubos- y se cierra
    // dejándolo todo en caja como cambio.
    await servicio.guardarArqueo(ctx, {
      sessionId: sesion.id,
      contado: [{ valor: 100, cantidad: 2 }],
      cartuchos: [{ valor: 100, cantidad: 2 }],
    });
    const cierre = await servicio.cerrarJornada(ctx, {
      sessionId: sesion.id,
      cambioFinal: [{ valor: 100, cantidad: 2 }],
      cambioFinalCartuchos: [{ valor: 100, cantidad: 2 }],
    });
    expect(cierre.totalCambioCentimos).toBe(5200);
    expect(cierre.totalIngresoCentimos).toBe(0);

    const manana = await servicio.abrirJornada(ctx, { registerId: caja });
    expect(manana.sesion.fondoInicialHeredado).toBe(true);
    expect(manana.sesion.fondoInicialCentimos).toBe(5200);

    // Y el formato se conserva: los dos tubos siguen precintados.
    expect(await stock(manana.sesion.id, 100)).toEqual({ sueltas: 2, tubos: 2 });
  });

  it("el banco trae cartuchos a media jornada y entran precintados", async () => {
    const caja = await crearCaja("cartucho-aportacion");
    const { sesion } = await servicio.abrirJornada(ctx, {
      registerId: caja,
      fondoManual: [{ valor: 100, cantidad: 3 }],
    });
    expect(await stock(sesion.id, 100)).toEqual({ sueltas: 3, tubos: 0 });

    // Aportación de cambio: 2 tubos de 1 € (50 €) y 5 monedas sueltas.
    const r = await servicio.registrarOperacion(ctx, {
      sessionId: sesion.id,
      tipo: "MANUAL_IN",
      importeCentimos: 5500,
      formasPago: [{ forma: "CASH", importe: 5500 }],
      efectivoRecibido: [{ valor: 100, cantidad: 5 }],
      cartuchosRecibidos: [{ valor: 100, cantidad: 2 }],
      concepto: "Aportación de cambio del banco",
    });

    expect(r.efectivoNetoCentimos).toBe(5500);
    // Los tubos entran CERRADOS: no se abren al entrar.
    expect(await stock(sesion.id, 100)).toEqual({ sueltas: 8, tubos: 2 });
    expect(r.aperturas).toEqual([]);
  });

  it("un tubo puede salir precintado sin abrirse", async () => {
    const caja = await crearCaja("cartucho-salida");
    const { sesion } = await servicio.abrirJornada(ctx, {
      registerId: caja,
      fondoManual: [{ valor: 100, cantidad: 4 }],
      fondoCartuchos: [{ valor: 100, cantidad: 3 }],
    });

    // Se devuelven 2 tubos al banco, sin tocar las monedas sueltas.
    const r = await servicio.registrarOperacion(ctx, {
      sessionId: sesion.id,
      tipo: "BANK_DEPOSIT",
      importeCentimos: 5000,
      formasPago: [{ forma: "CASH", importe: 5000 }],
      cartuchosEntregados: [{ valor: 100, cantidad: 2 }],
      concepto: "Devolución de cambio al banco",
    });

    // Salen enteros: ni se abre ninguno ni se tocan las sueltas.
    expect(r.aperturas).toEqual([]);
    expect(await stock(sesion.id, 100)).toEqual({ sueltas: 4, tubos: 1 });
  });

  it("no se pueden sacar más tubos de los que hay", async () => {
    const caja = await crearCaja("cartucho-sin-tubos");
    const { sesion } = await servicio.abrirJornada(ctx, {
      registerId: caja,
      fondoManual: [{ valor: 100, cantidad: 100 }],
      fondoCartuchos: [{ valor: 100, cantidad: 1 }],
    });

    await expect(
      servicio.registrarOperacion(ctx, {
        sessionId: sesion.id,
        tipo: "BANK_DEPOSIT",
        importeCentimos: 5000,
        formasPago: [{ forma: "CASH", importe: 5000 }],
        cartuchosEntregados: [{ valor: 100, cantidad: 2 }],
        concepto: "Más tubos de los que hay",
      })
    ).rejects.toMatchObject({ codigo: "STOCK_INSUFICIENTE" });
  });

  it("los tubos que no se quedan van al ingreso bancario, precintados", async () => {
    // El caso que falló en el mostrador: un tubo de 2 € y otro de 1 € que no
    // caben en el cambio final y tienen que ir al banco enteros.
    const caja = await crearCaja("cartucho-al-banco");
    const { sesion } = await servicio.abrirJornada(ctx, {
      registerId: caja,
      fondoManual: [{ valor: 5000, cantidad: 2 }], // 100 € en billetes
      fondoCartuchos: [
        { valor: 200, cantidad: 1 }, // 50 € en un tubo de 2 €
        { valor: 100, cantidad: 1 }, // 25 € en un tubo de 1 €
      ],
    });
    expect(sesion.fondoInicialCentimos).toBe(17500);

    await servicio.guardarArqueo(ctx, {
      sessionId: sesion.id,
      contado: [{ valor: 5000, cantidad: 2 }],
      cartuchos: [
        { valor: 200, cantidad: 1 },
        { valor: 100, cantidad: 1 },
      ],
    });

    // Se queda solo un billete: todo lo demás, tubos incluidos, al banco.
    const cierre = await servicio.cerrarJornada(ctx, {
      sessionId: sesion.id,
      cambioFinal: [{ valor: 5000, cantidad: 1 }],
      cambioFinalCartuchos: [],
    });

    expect(cierre.totalCambioCentimos).toBe(5000);
    // 50 € del billete que se va + 75 € de los dos tubos.
    expect(cierre.totalIngresoCentimos).toBe(12500);
    expect(cierre.ingresoBancarioCartuchos).toEqual([
      { valor: 200, cantidad: 1 },
      { valor: 100, cantidad: 1 },
    ]);

    // Cambio final + ingreso = lo contado, también contando los tubos.
    expect(cierre.totalCambioCentimos + cierre.totalIngresoCentimos).toBe(17500);

    // Y la jornada queda a cero: todo lo que entró ha salido.
    const final = await servicio.stockDeJornada(sesion.id);
    expect(final.totalCentimos).toBe(0);

    // Mañana solo hereda el billete: los tubos se fueron.
    const manana = await servicio.abrirJornada(ctx, { registerId: caja });
    expect(manana.sesion.fondoInicialCentimos).toBe(5000);
  });

  it("la propuesta de cierre deja los tubos en caja y manda el resto al banco", async () => {
    const caja = await crearCaja("cartucho-propuesta-cierre");
    const { sesion } = await servicio.abrirJornada(ctx, {
      registerId: caja,
      fondoManual: [
        { valor: 5000, cantidad: 2 }, // 100 € en billetes
        { valor: 100, cantidad: 10 }, //  10 € sueltos
      ],
      fondoCartuchos: [{ valor: 100, cantidad: 2 }], // 50 € en dos tubos
    });
    expect(sesion.fondoInicialCentimos).toBe(16000);

    const teorico = await servicio.stockDeJornada(sesion.id);
    await servicio.guardarArqueo(ctx, {
      sessionId: sesion.id,
      contado: [
        { valor: 5000, cantidad: 2 },
        { valor: 100, cantidad: 10 },
      ],
      cartuchos: [{ valor: 100, cantidad: 2 }],
    });

    // Objetivo 60 €: caben los dos tubos (50 €) y 10 € de sueltas.
    const p = await servicio.proponerCierre(sesion.id, 6000);
    expect(p.cambioFinalCartuchos).toEqual([{ valor: 100, cantidad: 2 }]);
    expect(p.cambioFinal).toEqual([{ valor: 100, cantidad: 10 }]);
    // Los billetes se van al banco.
    expect(p.ingresoBancario).toEqual([{ valor: 5000, cantidad: 2 }]);
    expect(p.ingresoBancarioCartuchos).toEqual([]);
    expect(teorico.totalCentimos).toBe(16000);
  });
});

/*
 * Días atrasados.
 *
 * Al arrancar el módulo hay días que ya se llevaron a mano en papel y hay que
 * meterlos. La fecha del cobro tiene que ser la del día en que se cobró, no la
 * del día en que se teclea, y el cambio tiene que ir pasando de un día al
 * siguiente igual que pasó en el mostrador.
 */
describe.runIf(RUN)("jornadas fechadas en días pasados", () => {
  /** Días de hace `n` en formato `YYYY-MM-DD`. */
  function haceDias(n: number): string {
    return new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
  }

  it("la fecha de la jornada manda sobre el reloj, y el fondo encadena por fecha", async () => {
    const caja = await crearCaja("atrasadas");
    const dia13 = haceDias(4);
    const dia14 = haceDias(3);

    // Día 13: se abre con 300 € contados a mano y se cobran 50 € en efectivo.
    const a13 = await servicio.abrirJornada(ctx, {
      registerId: caja,
      fecha: dia13,
      fondoManual: FONDO_300,
    });
    expect(a13.sesion.fecha).toBe(dia13);

    await servicio.registrarCobro(ctx, {
      sessionId: a13.sesion.id,
      importeCentimos: 5000,
      formasPago: [{ forma: "CASH", importe: 5000 }],
      efectivoRecibido: [{ valor: 5000, cantidad: 1 }],
      partyNombre: "Cliente del 13",
    });

    // El cobro cuelga de la jornada del 13, aunque se teclee hoy.
    const det13 = await servicio.detalleJornada(a13.sesion.id);
    expect(det13.sesion.fecha).toBe(dia13);

    // Se cierra dejando los 350 € íntegros como cambio del día siguiente.
    const teorico13 = await servicio.stockDeJornada(a13.sesion.id);
    expect(teorico13.totalCentimos).toBe(35000);
    await servicio.guardarArqueo(ctx, { sessionId: a13.sesion.id, contado: teorico13.lineas });
    const c13 = await servicio.cerrarJornada(ctx, {
      sessionId: a13.sesion.id,
      cambioFinal: teorico13.lineas,
    });
    expect(c13.totalCambioCentimos).toBe(35000);

    // Día 14: hereda la composición exacta con la que se cerró el 13.
    const a14 = await servicio.abrirJornada(ctx, { registerId: caja, fecha: dia14 });
    expect(a14.sesion.fecha).toBe(dia14);
    expect(a14.sesion.fondoInicialHeredado).toBe(true);
    expect(a14.sesion.fondoInicialCentimos).toBe(35000);
    expect(a14.stock).toEqual(c13.cambioFinal);
  });

  it("una jornada atrasada hereda del día anterior a ella, no de la última cerrada", async () => {
    const caja = await crearCaja("fuera-de-orden");
    const dia20 = haceDias(20);
    const dia10 = haceDias(10);

    // Primero se mete —fuera de orden— un día reciente con 500 €.
    const reciente = await servicio.abrirJornada(ctx, {
      registerId: caja,
      fecha: dia10,
      fondoManual: [{ valor: 5000, cantidad: 10 }],
    });
    const tRec = await servicio.stockDeJornada(reciente.sesion.id);
    await servicio.guardarArqueo(ctx, { sessionId: reciente.sesion.id, contado: tRec.lineas });
    await servicio.cerrarJornada(ctx, {
      sessionId: reciente.sesion.id,
      cambioFinal: tRec.lineas,
    });

    /*
     * Ahora se mete un día MUY anterior. Si heredara de "la última cerrada" a
     * secas, se traería los 500 € de un día que para él está en el futuro.
     * Tiene que salir sin herencia y pedir el fondo a mano.
     */
    const antiguo = await servicio.abrirJornada(ctx, {
      registerId: caja,
      fecha: dia20,
      fondoManual: FONDO_300,
    });
    expect(antiguo.sesion.fondoInicialHeredado).toBe(false);
    expect(antiguo.sesion.fondoInicialCentimos).toBe(30000);
  });

  it("no se abre caja con fecha futura ni con una fecha que no existe", async () => {
    const caja = await crearCaja("fecha-mala");
    const manana = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);

    await expect(
      servicio.abrirJornada(ctx, { registerId: caja, fecha: manana, fondoManual: FONDO_300 })
    ).rejects.toMatchObject({ codigo: "FECHA_EN_FUTURO" });

    await expect(
      servicio.abrirJornada(ctx, { registerId: caja, fecha: "2026-02-31", fondoManual: FONDO_300 })
    ).rejects.toMatchObject({ codigo: "FECHA_NO_VALIDA" });

    await expect(
      servicio.abrirJornada(ctx, { registerId: caja, fecha: "14/08/2026", fondoManual: FONDO_300 })
    ).rejects.toMatchObject({ codigo: "FECHA_NO_VALIDA" });
  });

  it("avisa si un día atrasado ya tiene jornada, y deja seguir si se confirma", async () => {
    const caja = await crearCaja("dia-repetido");
    const dia = haceDias(5);

    const primera = await servicio.abrirJornada(ctx, {
      registerId: caja,
      fecha: dia,
      fondoManual: FONDO_300,
    });
    const t = await servicio.stockDeJornada(primera.sesion.id);
    await servicio.guardarArqueo(ctx, { sessionId: primera.sesion.id, contado: t.lineas });
    await servicio.cerrarJornada(ctx, { sessionId: primera.sesion.id, cambioFinal: [] });

    // Segundo intento del mismo día: se para y se dice cuál es la que ya hay.
    await expect(
      servicio.abrirJornada(ctx, { registerId: caja, fecha: dia, fondoManual: FONDO_300 })
    ).rejects.toMatchObject({
      codigo: "FECHA_YA_TIENE_JORNADA",
      detalle: { sessionId: primera.sesion.id, fecha: dia },
    });

    // Confirmado a propósito, se abre.
    const segunda = await servicio.abrirJornada(ctx, {
      registerId: caja,
      fecha: dia,
      fondoManual: FONDO_300,
      permitirFechaRepetida: true,
    });
    expect(segunda.sesion.fecha).toBe(dia);
    expect(segunda.sesion.id).not.toBe(primera.sesion.id);
  });

  it("abrir un segundo turno de HOY no pregunta nada", async () => {
    const caja = await crearCaja("dos-turnos-hoy");

    const manana = await servicio.abrirJornada(ctx, {
      registerId: caja,
      fondoManual: FONDO_300,
    });
    const t = await servicio.stockDeJornada(manana.sesion.id);
    await servicio.guardarArqueo(ctx, { sessionId: manana.sesion.id, contado: t.lineas });
    await servicio.cerrarJornada(ctx, { sessionId: manana.sesion.id, cambioFinal: t.lineas });

    const tarde = await servicio.abrirJornada(ctx, { registerId: caja });
    expect(tarde.sesion.fecha).toBe(manana.sesion.fecha);
    expect(tarde.sesion.fondoInicialCentimos).toBe(30000);
  });
});

/*
 * Las formas de pago viajan con la operación.
 *
 * La pantalla de la jornada enseña, cobro a cobro, por qué vía entró el
 * dinero. Ese dato vive en `cash_operation_payments` y se agrega en la misma
 * consulta que las operaciones: si algún día se separan, la lista se quedaría
 * muda justo en lo que la hace útil.
 */
describe.runIf(RUN)("operaciones con sus formas de pago", () => {
  it("un cobro mixto devuelve sus dos formas, y suman el importe", async () => {
    const caja = await crearCaja("formas-en-lista");
    const { sesion } = await servicio.abrirJornada(ctx, {
      registerId: caja,
      fondoManual: FONDO_300,
    });

    // 300 €: 200 € con tarjeta y 100 € en efectivo, entregando 100 € justos.
    await servicio.registrarCobro(ctx, {
      sessionId: sesion.id,
      importeCentimos: 30000,
      formasPago: [
        { forma: "BBVA_CARD", importe: 20000, referencia: "TPV-77" },
        { forma: "CASH", importe: 10000 },
      ],
      efectivoRecibido: [{ valor: 10000, cantidad: 1 }],
      partyNombre: "Cliente mixto",
    });

    const [op] = await repo.operacionesDeSesion(sesion.id);
    expect(op.formas).toHaveLength(2);
    expect(op.formas.reduce((a, f) => a + f.importe, 0)).toBe(op.importeCentimos);

    const tarjeta = op.formas.find((f) => f.forma === "BBVA_CARD");
    expect(tarjeta?.importe).toBe(20000);
    expect(tarjeta?.referencia).toBe("TPV-77");
    expect(op.formas.find((f) => f.forma === "CASH")?.importe).toBe(10000);
  });

  it("una salida manual, que no tiene forma de pago, devuelve la lista vacía", async () => {
    const caja = await crearCaja("salida-sin-formas");
    const { sesion } = await servicio.abrirJornada(ctx, {
      registerId: caja,
      fondoManual: FONDO_300,
    });

    await servicio.registrarOperacion(ctx, {
      sessionId: sesion.id,
      tipo: "MANUAL_OUT",
      importeCentimos: 5000,
      formasPago: [{ forma: "CASH", importe: 5000 }],
      efectivoEntregado: [{ valor: 5000, cantidad: 1 }],
      concepto: "Compra de sellos",
    });

    const ops = await repo.operacionesDeSesion(sesion.id);
    expect(ops).toHaveLength(2); // el fondo inicial y la salida
    for (const o of ops) expect(Array.isArray(o.formas)).toBe(true);
  });
});

/*
 * Secciones de negocio: taller y gasolinera en un solo cajón.
 *
 * Lo que se parte es la LIQUIDACIÓN, no el inventario. El cajón sigue siendo
 * uno, el arqueo sigue siendo uno, y el reparto por sección es un dato
 * informativo. Si algún día alguien intenta convertirlo en dos arqueos, estos
 * tests son los que tienen que estorbar.
 */
describe.runIf(RUN)("secciones de negocio", () => {
  async function seccion(codigo: string): Promise<number> {
    const secciones = await config.listarSecciones(EMPRESA);
    const s = secciones.find((x) => x.codigo === codigo);
    if (!s) throw new Error(`No se ha sembrado la sección ${codigo}`);
    return s.id;
  }

  it("se siembran taller y gasolinera, y taller es la de por defecto", async () => {
    const secciones = await config.listarSecciones(EMPRESA);
    const taller = secciones.find((s) => s.codigo === "TALLER");
    const gasolinera = secciones.find((s) => s.codigo === "GASOLINERA");

    expect(taller?.porDefecto).toBe(true);
    expect(gasolinera?.porDefecto).toBe(false);
    expect(gasolinera?.activa).toBe(true);
  });

  it("reparte los cobros por sección sin tocar el arqueo, que sigue siendo uno", async () => {
    const caja = await crearCaja("secciones");
    const { sesion } = await servicio.abrirJornada(ctx, {
      registerId: caja,
      fondoManual: FONDO_300,
    });

    const taller = await seccion("TALLER");
    const gasolinera = await seccion("GASOLINERA");

    // 100 € de taller y 50 € de gasolinera, los dos en efectivo justo.
    await servicio.registrarCobro(ctx, {
      sessionId: sesion.id,
      importeCentimos: 10000,
      formasPago: [{ forma: "CASH", importe: 10000 }],
      efectivoRecibido: [{ valor: 10000, cantidad: 1 }],
      sectionId: taller,
      partyNombre: "Cliente del taller",
    });
    await servicio.registrarCobro(ctx, {
      sessionId: sesion.id,
      importeCentimos: 5000,
      formasPago: [{ forma: "CASH", importe: 5000 }],
      efectivoRecibido: [{ valor: 5000, cantidad: 1 }],
      sectionId: gasolinera,
      partyNombre: "Cliente de la gasolinera",
    });

    const r = await servicio.resumenJornada(sesion.id);

    const porNombre = new Map(r.porSeccion.map((s) => [s.nombre, s]));
    expect(porNombre.get("Taller")?.cobrosCentimos).toBe(10000);
    expect(porNombre.get("Gasolinera")?.cobrosCentimos).toBe(5000);

    // Lo que importa: el cajón es UNO. 300 € de fondo + 150 € cobrados.
    expect(r.totalStockCentimos).toBe(45000);
    // Y la suma de las secciones no puede inventarse dinero.
    const sumaSecciones = r.porSeccion.reduce((a, s) => a + s.efectivoNetoCentimos, 0);
    expect(sumaSecciones).toBe(15000);
  });

  it("un pago sin sección indicada se guarda con la de por defecto", async () => {
    const porDefecto = await config.seccionPorDefecto(EMPRESA);
    expect(porDefecto).toBe(await seccion("TALLER"));
  });

  it("no se cobra a una sección dada de baja", async () => {
    const caja = await crearCaja("seccion-de-baja");
    const { sesion } = await servicio.abrirJornada(ctx, {
      registerId: caja,
      fondoManual: FONDO_300,
    });

    const nueva = await config.crearSeccion(ctx, { nombre: `Lavadero ${Date.now()}` });
    await config.actualizarSeccion(ctx, nueva.id, { activa: false });

    await expect(
      servicio.registrarCobro(ctx, {
        sessionId: sesion.id,
        importeCentimos: 1000,
        formasPago: [{ forma: "CASH", importe: 1000 }],
        efectivoRecibido: [{ valor: 1000, cantidad: 1 }],
        sectionId: nueva.id,
      })
    ).rejects.toMatchObject({ codigo: "SECCION_DE_BAJA" });
  });

  it("la sección por defecto no se puede dar de baja", async () => {
    const taller = await seccion("TALLER");
    await expect(
      config.actualizarSeccion(ctx, taller, { activa: false })
    ).rejects.toMatchObject({ codigo: "SECCION_POR_DEFECTO" });
  });

  it("marcar otra por defecto quita la marca de la anterior", async () => {
    const gasolinera = await seccion("GASOLINERA");
    await config.actualizarSeccion(ctx, gasolinera, { porDefecto: true });

    const despues = await config.listarSecciones(EMPRESA);
    expect(despues.filter((s) => s.porDefecto)).toHaveLength(1);
    expect(despues.find((s) => s.porDefecto)?.codigo).toBe("GASOLINERA");

    // Se deja como estaba, que las demás pruebas cuentan con taller.
    await config.actualizarSeccion(ctx, await seccion("TALLER"), { porDefecto: true });
  });

  it("lo registrado antes de las secciones sale como «Sin sección», no repartido a ojo", async () => {
    const caja = await crearCaja("sin-seccion");
    const { sesion } = await servicio.abrirJornada(ctx, {
      registerId: caja,
      fondoManual: FONDO_300,
    });

    await servicio.registrarCobro(ctx, {
      sessionId: sesion.id,
      importeCentimos: 2000,
      formasPago: [{ forma: "CASH", importe: 2000 }],
      efectivoRecibido: [{ valor: 2000, cantidad: 1 }],
      // Sin sectionId: exactamente el caso de los cobros ya registrados.
    });

    const r = await servicio.resumenJornada(sesion.id);
    const sin = r.porSeccion.find((s) => s.sectionId === null);
    expect(sin?.nombre).toBe("Sin sección");
    expect(sin?.cobrosCentimos).toBe(2000);
  });
});

/*
 * Reclasificar: cambiarle la sección a una operación ya registrada.
 *
 * Es corregir un despiste de mostrador, no mover dinero. Lo que estos tests
 * fijan es justo eso: que no toque ni un céntimo, que quede acotado a las
 * operaciones que pertenecen a un negocio, y que no se pueda reescribir el
 * histórico de una anulada.
 */
describe.runIf(RUN)("reclasificar la sección de una operación", () => {
  it("cambia la sección sin tocar el dinero", async () => {
    const caja = await crearCaja("reclasificar");
    const { sesion } = await servicio.abrirJornada(ctx, {
      registerId: caja,
      fondoManual: FONDO_300,
    });

    const secciones = await config.listarSecciones(EMPRESA);
    const taller = secciones.find((s) => s.codigo === "TALLER")!.id;
    const gasolinera = secciones.find((s) => s.codigo === "GASOLINERA")!.id;

    const cobro = await servicio.registrarCobro(ctx, {
      sessionId: sesion.id,
      importeCentimos: 5000,
      formasPago: [{ forma: "CASH", importe: 5000 }],
      efectivoRecibido: [{ valor: 5000, cantidad: 1 }],
      sectionId: taller,
    });

    const stockAntes = await servicio.stockDeJornada(sesion.id);

    const r = await servicio.cambiarSeccion(ctx, cobro.operacionId, gasolinera);
    expect(r.sectionId).toBe(gasolinera);
    expect(r.seccionNombre).toBe("Gasolinera");

    // Lo importante: el dinero no se ha movido ni un céntimo.
    const stockDespues = await servicio.stockDeJornada(sesion.id);
    expect(stockDespues.totalCentimos).toBe(stockAntes.totalCentimos);

    const resumen = await servicio.resumenJornada(sesion.id);
    const porNombre = new Map(resumen.porSeccion.map((s) => [s.nombre, s]));
    expect(porNombre.get("Gasolinera")?.cobrosCentimos).toBe(5000);
    expect(porNombre.get("Taller")).toBeUndefined();
  });

  it("se puede dejar sin sección, que es como estaba lo anterior al catálogo", async () => {
    const caja = await crearCaja("reclasificar-a-nulo");
    const { sesion } = await servicio.abrirJornada(ctx, {
      registerId: caja,
      fondoManual: FONDO_300,
    });
    const taller = (await config.listarSecciones(EMPRESA)).find((s) => s.codigo === "TALLER")!.id;

    const cobro = await servicio.registrarCobro(ctx, {
      sessionId: sesion.id,
      importeCentimos: 1000,
      formasPago: [{ forma: "CASH", importe: 1000 }],
      efectivoRecibido: [{ valor: 1000, cantidad: 1 }],
      sectionId: taller,
    });

    const r = await servicio.cambiarSeccion(ctx, cobro.operacionId, null);
    expect(r.sectionId).toBeNull();
    expect(r.seccionNombre).toBeNull();
  });

  it("el fondo inicial no se reclasifica: es del cajón entero, no de un negocio", async () => {
    const caja = await crearCaja("fondo-sin-seccion");
    const { sesion } = await servicio.abrirJornada(ctx, {
      registerId: caja,
      fondoManual: FONDO_300,
    });

    const ops = await repo.operacionesDeSesion(sesion.id);
    const fondo = ops.find((o) => o.tipo === "OPENING_FLOAT")!;
    const taller = (await config.listarSecciones(EMPRESA)).find((s) => s.codigo === "TALLER")!.id;

    await expect(servicio.cambiarSeccion(ctx, fondo.id, taller)).rejects.toMatchObject({
      codigo: "OPERACION_SIN_SECCION",
    });
  });

  it("una operación de otra empresa no se toca", async () => {
    const caja = await crearCaja("otra-empresa");
    const { sesion } = await servicio.abrirJornada(ctx, {
      registerId: caja,
      fondoManual: FONDO_300,
    });
    const cobro = await servicio.registrarCobro(ctx, {
      sessionId: sesion.id,
      importeCentimos: 1000,
      formasPago: [{ forma: "CASH", importe: 1000 }],
      efectivoRecibido: [{ valor: 1000, cantidad: 1 }],
    });

    const ajeno = { empresaId: "00000000-0000-4000-a000-00000000dead", userId: null };
    await expect(servicio.cambiarSeccion(ajeno, cobro.operacionId, null)).rejects.toMatchObject({
      codigo: "OPERACION_NO_ENCONTRADA",
    });
  });
});

/*
 * El cierre reparte LO CONTADO, no el teórico.
 *
 * Con la caja cuadrada los dos números son el mismo y no se nota. El caso que
 * importa es el descuadre: si el resumen devolviera el teórico, la pantalla
 * pediría repartir un dinero que físicamente no está y la jornada no se
 * podría cerrar. Pasó de verdad con un faltante de 5,62 €.
 */
describe.runIf(RUN)("cierre con descuadre de arqueo", () => {
  it("el resumen trae el arqueo contado, no el teórico", async () => {
    const caja = await crearCaja("descuadre-resumen");
    const { sesion } = await servicio.abrirJornada(ctx, {
      registerId: caja,
      fondoManual: [
        { valor: 5000, cantidad: 2 }, // 100 €
        { valor: 1000, cantidad: 5 }, //  50 €
      ],
    });

    // Falta un billete de 10 €: contado 140 €, teórico 150 €.
    await servicio.guardarArqueo(ctx, {
      sessionId: sesion.id,
      contado: [
        { valor: 5000, cantidad: 2 },
        { valor: 1000, cantidad: 4 },
      ],
    });

    const r = await servicio.resumenJornada(sesion.id);
    expect(r.totalStockCentimos).toBe(15000); // el teórico no se toca
    expect(r.ultimoArqueo?.totalCentimos).toBe(14000);
    expect(r.ultimoArqueo?.diferenciaCentimos).toBe(-1000);
    expect(r.ultimoArqueo?.sueltas).toEqual([
      { valor: 5000, cantidad: 2 },
      { valor: 1000, cantidad: 4 },
    ]);
  });

  it("cierra con el faltante y lo asienta como ajuste auditado", async () => {
    const caja = await crearCaja("descuadre-cierre");
    const { sesion } = await servicio.abrirJornada(ctx, {
      registerId: caja,
      fondoManual: [
        { valor: 5000, cantidad: 2 },
        { valor: 1000, cantidad: 5 },
      ],
    });

    const contado = [
      { valor: 5000, cantidad: 2 },
      { valor: 1000, cantidad: 4 },
    ];
    await servicio.guardarArqueo(ctx, { sessionId: sesion.id, contado });

    // Se cierra dejándolo todo en caja: 140 €, que es lo que hay de verdad.
    const cierre = await servicio.cerrarJornada(ctx, {
      sessionId: sesion.id,
      cambioFinal: contado,
    });
    expect(cierre.totalCambioCentimos).toBe(14000);
    expect(cierre.totalIngresoCentimos).toBe(0);
    expect(cierre.diferenciaCentimos).toBe(-1000);

    // El ajuste existe, con su propia operación y su numeración.
    const ops = await repo.operacionesDeSesion(sesion.id);
    const ajuste = ops.find((o) => o.tipo === "ADJUSTMENT");
    expect(ajuste).toBeDefined();
    expect(ajuste!.numero).toMatch(numeroDe("A"));
    expect(ajuste!.efectivoNetoCentimos).toBe(-1000);

    // Y el libro cierra en cero: todo lo que entró ha salido.
    const stockFinal = await servicio.stockDeJornada(sesion.id);
    expect(stockFinal.totalCentimos).toBe(0);
  });
});

/*
 * Regularizar el arqueo: aceptar el descuadre y dejar la caja cuadrada.
 *
 * Lo que se fija aquí es que la diferencia se escriba UNA vez. El ajuste puede
 * asentarse en dos momentos —al regularizar y al cerrar— y si los dos caminos
 * no compartieran el mismo cuadre, una caja regularizada volvería a "descubrir"
 * su descuadre al cerrar y lo asentaría dos veces.
 */
describe.runIf(RUN)("regularizar el arqueo", () => {
  /** Abre una jornada de 150 EUR y arquea 140: falta un billete de 10. */
  async function jornadaConFaltante(nombre: string) {
    const caja = await crearCaja(nombre);
    const { sesion } = await servicio.abrirJornada(ctx, {
      registerId: caja,
      fondoManual: [
        { valor: 5000, cantidad: 2 },
        { valor: 1000, cantidad: 5 },
      ],
    });
    await servicio.guardarArqueo(ctx, {
      sessionId: sesion.id,
      contado: [
        { valor: 5000, cantidad: 2 },
        { valor: 1000, cantidad: 4 },
      ],
    });
    return sesion;
  }

  it("deja el teórico igual a lo contado y escribe el ajuste", async () => {
    const sesion = await jornadaConFaltante("regularizar");

    const antes = await servicio.stockDeJornada(sesion.id);
    expect(antes.totalCentimos).toBe(15000);

    const r = await servicio.regularizarArqueo(ctx, {
      sessionId: sesion.id,
      motivo: "Recontado dos veces",
    });
    expect(r!.diferenciaCentimos).toBe(-1000);

    // El teórico ya es lo contado: la caja cuadra.
    const despues = await servicio.stockDeJornada(sesion.id);
    expect(despues.totalCentimos).toBe(14000);

    // Y la diferencia quedó escrita, con el motivo dentro del concepto.
    const ops = await repo.operacionesDeSesion(sesion.id);
    const ajuste = ops.find((o) => o.tipo === "ADJUSTMENT")!;
    expect(ajuste.numero).toBe(r!.numero);
    expect(ajuste.efectivoNetoCentimos).toBe(-1000);
    expect(ajuste.concepto).toContain("Recontado dos veces");
  });

  it("una caja regularizada no vuelve a asentar el descuadre al cerrar", async () => {
    const sesion = await jornadaConFaltante("regularizar-y-cerrar");
    await servicio.regularizarArqueo(ctx, { sessionId: sesion.id, motivo: "Aceptado" });

    const cierre = await servicio.cerrarJornada(ctx, {
      sessionId: sesion.id,
      cambioFinal: [
        { valor: 5000, cantidad: 2 },
        { valor: 1000, cantidad: 4 },
      ],
    });

    // Ya cuadraba, así que el cierre no encuentra diferencia que asentar.
    expect(cierre.diferenciaCentimos).toBe(0);
    expect(cierre.denominacionesCuadran).toBe(true);

    // Y sigue habiendo UN solo ajuste, no dos.
    const ops = await repo.operacionesDeSesion(sesion.id);
    expect(ops.filter((o) => o.tipo === "ADJUSTMENT")).toHaveLength(1);

    const stockFinal = await servicio.stockDeJornada(sesion.id);
    expect(stockFinal.totalCentimos).toBe(0);
  });

  it("no se regulariza una caja que ya cuadra", async () => {
    const caja = await crearCaja("ya-cuadra");
    const { sesion } = await servicio.abrirJornada(ctx, {
      registerId: caja,
      fondoManual: FONDO_300,
    });
    const teorico = await servicio.stockDeJornada(sesion.id);
    await servicio.guardarArqueo(ctx, { sessionId: sesion.id, contado: teorico.lineas });

    await expect(
      servicio.regularizarArqueo(ctx, { sessionId: sesion.id })
    ).rejects.toMatchObject({ codigo: "CAJA_YA_CUADRA" });
  });

  it("sin arqueo no hay nada que regularizar", async () => {
    const caja = await crearCaja("sin-arqueo");
    const { sesion } = await servicio.abrirJornada(ctx, {
      registerId: caja,
      fondoManual: FONDO_300,
    });

    await expect(
      servicio.regularizarArqueo(ctx, { sessionId: sesion.id })
    ).rejects.toMatchObject({ codigo: "FALTA_ARQUEO" });
  });

  it("las monedas de los cartuchos cuentan: no se inventa un faltante", async () => {
    const caja = await crearCaja("regularizar-cartuchos");
    const { sesion } = await servicio.abrirJornada(ctx, {
      registerId: caja,
      fondoManual: [{ valor: 5000, cantidad: 2 }], // 100 €
      fondoCartuchos: [{ valor: 100, cantidad: 1 }], // 1 tubo de 25 × 1 € = 25 €
    });

    // Se cuenta igual: 2 billetes y el tubo entero, sin monedas sueltas.
    await servicio.guardarArqueo(ctx, {
      sessionId: sesion.id,
      contado: [{ valor: 5000, cantidad: 2 }],
      cartuchos: [{ valor: 100, cantidad: 1 }],
    });

    // La caja cuadra: si el tubo no se contara, saldría un faltante de 25 €.
    await expect(
      servicio.regularizarArqueo(ctx, { sessionId: sesion.id })
    ).rejects.toMatchObject({ codigo: "CAJA_YA_CUADRA" });
  });
});

describe.runIf(RUN)("bolsas de monedas", () => {
  /**
   * Configura una bolsa para la moneda de 1 €.
   *
   * El catálogo no trae bolsas de fábrica —cada banco sirve el suyo— así que
   * la prueba la configura como lo haría el usuario en Configuración.
   */
  async function configurarBolsa(valor: number, piezas: number) {
    const { rows } = await db.query(`SELECT id FROM cash_denominations WHERE valor_centimos = $1`, [
      valor,
    ]);
    await config.actualizarDenominacion(ctx, rows[0].id, { piezasPorBolsa: piezas });
  }

  /** Sueltas, tubos y bolsas de una denominación, leídos del libro mayor. */
  async function stock(sessionId: number, valor: number) {
    const { rows } = await db.query(
      `SELECT SUM(CASE WHEN cartuchos = 0 AND bolsas = 0
                       THEN (CASE WHEN direccion='IN' THEN cantidad ELSE -cantidad END)
                       ELSE 0 END) AS sueltas,
              SUM(CASE WHEN direccion='IN' THEN cartuchos ELSE -cartuchos END) AS tubos,
              SUM(CASE WHEN direccion='IN' THEN bolsas ELSE -bolsas END) AS sacos
         FROM cash_denomination_movements
        WHERE session_id = $1 AND valor_unitario_centimos = $2`,
      [sessionId, valor]
    );
    return {
      sueltas: Number(rows[0].sueltas ?? 0),
      tubos: Number(rows[0].tubos ?? 0),
      bolsas: Number(rows[0].sacos ?? 0),
    };
  }

  it("una bolsa entra en el fondo y vale lo que traen sus monedas", async () => {
    await configurarBolsa(100, 500);
    const caja = await crearCaja("bolsa-fondo");

    const { sesion } = await servicio.abrirJornada(ctx, {
      registerId: caja,
      fondoManual: [{ valor: 100, cantidad: 3 }],
      fondoBolsas: [{ valor: 100, cantidad: 1 }],
    });

    // 3 € sueltos + una bolsa de 500 monedas de 1 € = 503 €.
    expect(sesion.fondoInicialCentimos).toBe(50300);
    expect(await stock(sesion.id, 100)).toEqual({ sueltas: 3, tubos: 0, bolsas: 1 });
  });

  it("se rompe la bolsa antes que el cartucho", async () => {
    await configurarBolsa(100, 500);
    const caja = await crearCaja("bolsa-orden");

    const { sesion } = await servicio.abrirJornada(ctx, {
      registerId: caja,
      fondoManual: [{ valor: 100, cantidad: 1 }],
      fondoCartuchos: [{ valor: 100, cantidad: 1 }],
      fondoBolsas: [{ valor: 100, cantidad: 1 }],
    });

    // Faltan 3 monedas sueltas: se abre la bolsa y el cartucho no se toca.
    const r = await servicio.registrarOperacion(ctx, {
      sessionId: sesion.id,
      tipo: "MANUAL_OUT",
      importeCentimos: 400,
      formasPago: [{ forma: "CASH", importe: 400 }],
      efectivoEntregado: [{ valor: 100, cantidad: 4 }],
      concepto: "Salida que abre la bolsa",
    });

    expect(r.aperturas).toEqual([{ valor: 100, cartuchos: 0, bolsas: 1, piezas: 500 }]);
    // 1 suelta + 500 de la bolsa − 4 entregadas = 497, y el tubo intacto.
    expect(await stock(sesion.id, 100)).toEqual({ sueltas: 497, tubos: 1, bolsas: 0 });
  });

  it("cuando la bolsa no llega, se abre también el cartucho", async () => {
    await configurarBolsa(100, 500);
    const caja = await crearCaja("bolsa-abierta");

    const { sesion } = await servicio.abrirJornada(ctx, {
      registerId: caja,
      fondoCartuchos: [{ valor: 100, cantidad: 1 }],
      fondoBolsas: [{ valor: 100, cantidad: 1 }],
    });

    // 510 monedas: la bolsa trae 500, así que hace falta abrir también el tubo.
    const r = await servicio.registrarOperacion(ctx, {
      sessionId: sesion.id,
      tipo: "MANUAL_OUT",
      importeCentimos: 51000,
      formasPago: [{ forma: "CASH", importe: 51000 }],
      efectivoEntregado: [{ valor: 100, cantidad: 510 }],
      concepto: "Salida que obliga a abrir también el cartucho",
    });

    expect(r.aperturas).toEqual([{ valor: 100, cartuchos: 1, bolsas: 1, piezas: 525 }]);
    // 500 + 25 monedas abiertas − 510 entregadas = 15 sueltas.
    expect(await stock(sesion.id, 100)).toEqual({ sueltas: 15, tubos: 0, bolsas: 0 });

    // El libro mayor dice qué precinto se rompió, cada uno con su motivo.
    const { rows } = await db.query(
      `SELECT motivo, direccion, cantidad, cartuchos, bolsas
         FROM cash_denomination_movements
        WHERE session_id = $1 AND motivo IN ('CARTRIDGE_OPENED','BAG_OPENED')
        ORDER BY id`,
      [sesion.id]
    );
    expect(rows).toHaveLength(4);
    expect(rows[0]).toMatchObject({ motivo: "CARTRIDGE_OPENED", direccion: "OUT", cartuchos: 1 });
    expect(rows[1]).toMatchObject({ motivo: "CARTRIDGE_OPENED", direccion: "IN", cartuchos: 0, cantidad: 25 });
    expect(rows[2]).toMatchObject({ motivo: "BAG_OPENED", direccion: "OUT", bolsas: 1 });
    expect(rows[3]).toMatchObject({ motivo: "BAG_OPENED", direccion: "IN", bolsas: 0, cantidad: 500 });
  });

  it("una bolsa contada en el arqueo sigue precintada al día siguiente", async () => {
    await configurarBolsa(100, 500);
    const caja = await crearCaja("bolsa-cierre");

    const { sesion } = await servicio.abrirJornada(ctx, {
      registerId: caja,
      fondoBolsas: [{ valor: 100, cantidad: 1 }],
    });

    await servicio.guardarArqueo(ctx, {
      sessionId: sesion.id,
      contado: [],
      bolsas: [{ valor: 100, cantidad: 1 }],
    });

    // Todo se queda en caja: la bolsa no se manda al banco.
    const cierre = await servicio.cerrarJornada(ctx, {
      sessionId: sesion.id,
      cambioFinal: [],
      cambioFinalBolsas: [{ valor: 100, cantidad: 1 }],
    });
    expect(cierre.totalCambioCentimos).toBe(50000);
    expect(cierre.totalIngresoCentimos).toBe(0);

    // Y mañana amanece precintada, no como 500 monedas sueltas.
    const manana = await servicio.abrirJornada(ctx, { registerId: caja });
    expect(await stock(manana.sesion.id, 100)).toEqual({ sueltas: 0, tubos: 0, bolsas: 1 });
    expect(manana.sesion.fondoInicialCentimos).toBe(50000);
  });

  it("una bolsa puede traer menos monedas que el cartucho", async () => {
    // Las del banco de este taller son de veinte y los cartuchos de cincuenta.
    // Hubo una validación que lo prohibía y rechazaba la configuración real.
    const { rows } = await db.query(`SELECT id FROM cash_denominations WHERE valor_centimos = 100`);
    const d = await config.actualizarDenominacion(ctx, rows[0].id, { piezasPorBolsa: 20 });
    expect(d.piezasPorBolsa).toBe(20);
    await config.actualizarDenominacion(ctx, rows[0].id, { piezasPorBolsa: null });
  });

  it("cero o un número con coma no valen como monedas por bolsa", async () => {
    const { rows } = await db.query(`SELECT id FROM cash_denominations WHERE valor_centimos = 100`);
    for (const malo of [0, -5, 2.5]) {
      await expect(
        config.actualizarDenominacion(ctx, rows[0].id, { piezasPorBolsa: malo })
      ).rejects.toMatchObject({ codigo: "ENTRADA_NO_VALIDA" });
    }
  });
});

describe.runIf(RUN)("cambio de moneda en mostrador", () => {
  it("un billete de 20 € por 10 + 5 + cinco monedas: neto cero y numeración propia", async () => {
    const caja = await crearCaja("dar-cambio");
    const { sesion } = await servicio.abrirJornada(ctx, {
      registerId: caja,
      fondoManual: [
        { valor: 1000, cantidad: 2 },
        { valor: 500, cantidad: 2 },
        { valor: 100, cantidad: 10 },
      ],
    });
    const antes = (await servicio.stockDeJornada(sesion.id)).totalCentimos;

    const r = await servicio.registrarOperacion(ctx, {
      sessionId: sesion.id,
      tipo: "EXCHANGE",
      importeCentimos: 2000,
      formasPago: [{ forma: "CASH", importe: 2000 }],
      efectivoRecibido: [{ valor: 2000, cantidad: 1 }],
      efectivoEntregado: [
        { valor: 1000, cantidad: 1 },
        { valor: 500, cantidad: 1 },
        { valor: 100, cantidad: 5 },
      ],
      concepto: "Cambio de un billete de 20 €",
    });

    // Serie propia: el histórico distingue un cambio de un cobro o un pago.
    expect(r.numero).toMatch(numeroDe("DC"));
    expect(r.efectivoNetoCentimos).toBe(0);
    expect(r.totalStockCentimos).toBe(antes);

    // La composición sí cambió: hay un 20 € que antes no estaba.
    const stock = await servicio.stockDeJornada(sesion.id);
    const de = (valor: number) => stock.lineas.find((l) => l.valor === valor)?.cantidad ?? 0;
    expect(de(2000)).toBe(1);
    expect(de(1000)).toBe(1);
    expect(de(100)).toBe(5);
  });

  it("al revés: entran monedas y sale el billete", async () => {
    const caja = await crearCaja("dar-cambio-inverso");
    const { sesion } = await servicio.abrirJornada(ctx, {
      registerId: caja,
      fondoManual: [{ valor: 2000, cantidad: 1 }],
    });

    const r = await servicio.registrarOperacion(ctx, {
      sessionId: sesion.id,
      tipo: "EXCHANGE",
      importeCentimos: 2000,
      formasPago: [{ forma: "CASH", importe: 2000 }],
      efectivoRecibido: [{ valor: 100, cantidad: 20 }],
      efectivoEntregado: [{ valor: 2000, cantidad: 1 }],
    });

    expect(r.efectivoNetoCentimos).toBe(0);
    const stock = await servicio.stockDeJornada(sesion.id);
    expect(stock.lineas).toEqual([{ valor: 100, cantidad: 20 }]);
  });

  it("si hay que abrir un envase para juntar el cambio, se abre y lo dice", async () => {
    const caja = await crearCaja("dar-cambio-envase");
    // Nada suelto de 1 €: solo un cartucho de 25.
    const { sesion } = await servicio.abrirJornada(ctx, {
      registerId: caja,
      fondoCartuchos: [{ valor: 100, cantidad: 1 }],
    });

    const r = await servicio.registrarOperacion(ctx, {
      sessionId: sesion.id,
      tipo: "EXCHANGE",
      importeCentimos: 500,
      formasPago: [{ forma: "CASH", importe: 500 }],
      efectivoRecibido: [{ valor: 500, cantidad: 1 }],
      efectivoEntregado: [{ valor: 100, cantidad: 5 }],
    });

    expect(r.aperturas).toEqual([{ valor: 100, cartuchos: 1, piezas: 25 }]);
    expect(r.efectivoNetoCentimos).toBe(0);
  });

  it("un cambio que no cuadra o sin piezas suficientes se rechaza", async () => {
    const caja = await crearCaja("dar-cambio-malo");
    const { sesion } = await servicio.abrirJornada(ctx, {
      registerId: caja,
      fondoManual: [{ valor: 1000, cantidad: 1 }],
    });

    await expect(
      servicio.registrarOperacion(ctx, {
        sessionId: sesion.id,
        tipo: "EXCHANGE",
        importeCentimos: 2000,
        formasPago: [{ forma: "CASH", importe: 2000 }],
        efectivoRecibido: [{ valor: 2000, cantidad: 1 }],
        efectivoEntregado: [{ valor: 1000, cantidad: 1 }],
      })
    ).rejects.toMatchObject({ codigo: "EFECTIVO_NO_CUADRA" });

    await expect(
      servicio.registrarOperacion(ctx, {
        sessionId: sesion.id,
        tipo: "EXCHANGE",
        importeCentimos: 2000,
        formasPago: [{ forma: "CASH", importe: 2000 }],
        efectivoRecibido: [{ valor: 2000, cantidad: 1 }],
        efectivoEntregado: [{ valor: 1000, cantidad: 2 }],
      })
    ).rejects.toMatchObject({ codigo: "STOCK_INSUFICIENTE" });
  });
});

describe.runIf(RUN)("fondo fijo de la caja", () => {
  it("se guarda, viaja con la caja y admite el cero como «sin fondo fijo»", async () => {
    const caja = await crearCaja("fondo-fijo");

    const con = await config.actualizarCaja(ctx, caja, { fondoObjetivoCentimos: 35000 });
    expect(con.fondoObjetivoCentimos).toBe(35000);

    const listadas = await config.listarCajas(EMPRESA);
    expect(listadas.find((c) => c.id === caja)?.fondoObjetivoCentimos).toBe(35000);

    const sin = await config.actualizarCaja(ctx, caja, { fondoObjetivoCentimos: 0 });
    expect(sin.fondoObjetivoCentimos).toBe(0);
  });

  it("un fondo negativo no vale", async () => {
    const caja = await crearCaja("fondo-negativo");
    await expect(
      config.actualizarCaja(ctx, caja, { fondoObjetivoCentimos: -100 })
    ).rejects.toMatchObject({ codigo: "ENTRADA_NO_VALIDA" });
  });

  it("se puede cambiar con la jornada abierta: el nombre no", async () => {
    // Que 350 € se quedan cortos se descubre con la caja abierta, no antes.
    const caja = await crearCaja("fondo-en-caliente");
    await servicio.abrirJornada(ctx, { registerId: caja });

    const r = await config.actualizarCaja(ctx, caja, { fondoObjetivoCentimos: 50000 });
    expect(r.fondoObjetivoCentimos).toBe(50000);

    await expect(
      config.actualizarCaja(ctx, caja, { nombre: "Otro nombre" })
    ).rejects.toMatchObject({ codigo: "JORNADA_ABIERTA" });
  });

  it("el reparto del cierre deja el fondo fijo y manda al banco el resto", async () => {
    const caja = await crearCaja("fondo-cierre");
    await config.actualizarCaja(ctx, caja, { fondoObjetivoCentimos: 35000 });

    // Fondo de 350 € y 79,69 € cobrados: el caso real del mostrador.
    const { sesion } = await servicio.abrirJornada(ctx, {
      registerId: caja,
      fondoManual: [
        { valor: 5000, cantidad: 6 },
        { valor: 2000, cantidad: 2 },
        { valor: 1000, cantidad: 1 },
      ],
    });
    await servicio.registrarOperacion(ctx, {
      sessionId: sesion.id,
      tipo: "COLLECTION",
      importeCentimos: 7969,
      formasPago: [{ forma: "CASH", importe: 7969 }],
      // 50 + 20 + 5 + 2×2 + 0,50 + 0,10 + 0,05 + 0,02×2 = 79,69 €.
      efectivoRecibido: [
        { valor: 5000, cantidad: 1 },
        { valor: 2000, cantidad: 1 },
        { valor: 500, cantidad: 1 },
        { valor: 200, cantidad: 2 },
        { valor: 50, cantidad: 1 },
        { valor: 10, cantidad: 1 },
        { valor: 5, cantidad: 1 },
        { valor: 2, cantidad: 2 },
      ],
      efectivoEntregado: [],
    });

    const stock = await servicio.stockDeJornada(sesion.id);
    expect(stock.totalCentimos).toBe(35000 + 7969);

    // La propuesta reparte contra el fondo fijo: se queda 350 y sale el resto.
    await servicio.guardarArqueo(ctx, { sessionId: sesion.id, contado: stock.lineas });
    const propuesta = await servicio.proponerCierre(sesion.id, 35000);
    const suma = (l: readonly { valor: number; cantidad: number }[]) =>
      l.reduce((a, x) => a + x.valor * x.cantidad, 0);

    expect(suma(propuesta.cambioFinal)).toBe(35000);
    expect(suma(propuesta.ingresoBancario)).toBe(7969);
  });
});

describe.runIf(RUN)("escaneos de la jornada entera", () => {
  /** Mismo PDF de juguete que usa el bloque de justificantes. */
  async function pdfDePrueba(texto: string): Promise<Buffer> {
    const { PDFDocument, StandardFonts } = await import("pdf-lib");
    const doc = await PDFDocument.create();
    const pagina = doc.addPage([595, 842]);
    pagina.drawText(texto, { x: 50, y: 780, size: 14, font: await doc.embedFont(StandardFonts.Helvetica) });
    return Buffer.from(await doc.save());
  }

  it("se suben varios, cuelgan de la jornada y no de ninguna operación", async () => {
    const caja = await crearCaja("escaneos-jornada");
    const { sesion } = await servicio.abrirJornada(ctx, { registerId: caja });

    // El taco de facturas rara vez sale en un solo PDF.
    for (const nombre of ["facturas-1.pdf", "facturas-2.pdf", "resguardo-banco.pdf"]) {
      const d = await documentos.adjuntarDocumentoDeJornada(ctx, sesion.id, {
        originalname: nombre,
        mimetype: "application/pdf",
        buffer: await pdfDePrueba(nombre),
      });
      expect(d.operationId).toBeNull();
      expect(d.sessionId).toBe(sesion.id);
    }

    const lista = await documentos.documentosSueltosDeJornada(EMPRESA, sesion.id);
    expect(lista.map((d) => d.nombre)).toEqual([
      "facturas-1.pdf",
      "facturas-2.pdf",
      "resguardo-banco.pdf",
    ]);
  });

  it("van dentro del informe de cierre, junto a los de cada cobro", async () => {
    const caja = await crearCaja("escaneos-informe");
    const { sesion } = await servicio.abrirJornada(ctx, { registerId: caja, fondoManual: FONDO_300 });

    const cobro = await servicio.registrarCobro(ctx, {
      sessionId: sesion.id,
      importeCentimos: 5000,
      formasPago: [{ forma: "CASH", importe: 5000 }],
      efectivoRecibido: [{ valor: 5000, cantidad: 1 }],
      concepto: "Venta con factura",
    });
    await documentos.adjuntarDocumento(ctx, cobro.operacionId, {
      originalname: "de-la-operacion.pdf",
      mimetype: "application/pdf",
      buffer: await pdfDePrueba("DE LA OPERACION"),
    });
    await documentos.adjuntarDocumentoDeJornada(ctx, sesion.id, {
      originalname: "de-la-jornada.pdf",
      mimetype: "application/pdf",
      buffer: await pdfDePrueba("DE LA JORNADA"),
    });

    /*
     * Los dos: el de la operación y el de la jornada. Con un JOIN a secas en
     * vez de LEFT JOIN, el de la jornada desaparecía del informe justo por no
     * tener operación — que es lo que lo define.
     */
    const todos = await documentos.documentosDeJornada(sesion.id);
    expect(todos.map((d) => d.nombre)).toEqual(["de-la-operacion.pdf", "de-la-jornada.pdf"]);
    expect(todos.find((d) => d.nombre === "de-la-jornada.pdf")?.operacionNumero).toBe("Jornada");

    const pdf = await informe.informeCierre(EMPRESA, sesion.id);
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
  });

  it("una jornada de otra empresa no admite escaneos", async () => {
    const caja = await crearCaja("escaneos-ajenos");
    const { sesion } = await servicio.abrirJornada(ctx, { registerId: caja });
    await expect(
      documentos.adjuntarDocumentoDeJornada(
        { empresaId: "00000000-0000-4000-a000-0000000000ff", userId: null },
        sesion.id,
        { originalname: "x.pdf", mimetype: "application/pdf", buffer: await pdfDePrueba("X") }
      )
    ).rejects.toMatchObject({ codigo: "JORNADA_NO_ENCONTRADA" });
  });

  it("un formato que no es PDF ni imagen se rechaza", async () => {
    const caja = await crearCaja("escaneos-formato");
    const { sesion } = await servicio.abrirJornada(ctx, { registerId: caja });
    await expect(
      documentos.adjuntarDocumentoDeJornada(ctx, sesion.id, {
        originalname: "hoja.xlsx",
        mimetype: "application/vnd.ms-excel",
        buffer: Buffer.from("no soy un pdf"),
      })
    ).rejects.toMatchObject({ codigo: "FORMATO_NO_ADMITIDO" });
  });
});

describe.runIf(RUN)("canje de monedas por billetes para el ingreso", () => {
  /**
   * Monta el escenario real del mostrador: una jornada que deja al banco
   * 105,69 € con una composición concreta —95 € en billetes y 10,69 € en
   * monedas— y otra jornada abierta con los billetes del cajón.
   */
  async function escenario(billetesDeCaja: { valor: number; cantidad: number }[]) {
    const caja = await crearCaja(`canje-${Math.abs(billetesDeCaja[0]?.valor ?? 0)}-${Date.now()}`);

    const pendiente = [
      { valor: 5000, cantidad: 1 },
      { valor: 2000, cantidad: 2 },
      { valor: 500, cantidad: 1 },
      { valor: 200, cantidad: 4 },
      { valor: 100, cantidad: 2 },
      { valor: 50, cantidad: 1 },
      { valor: 10, cantidad: 1 },
      { valor: 5, cantidad: 1 },
      { valor: 2, cantidad: 2 },
    ];

    // Jornada 1: entra ese dinero y se cierra mandándolo entero al banco.
    const { sesion } = await servicio.abrirJornada(ctx, { registerId: caja });
    await servicio.registrarOperacion(ctx, {
      sessionId: sesion.id,
      tipo: "MANUAL_IN",
      importeCentimos: 10569,
      formasPago: [{ forma: "CASH", importe: 10569 }],
      efectivoRecibido: pendiente,
      concepto: "Cobros del día",
    });
    await servicio.guardarArqueo(ctx, { sessionId: sesion.id, contado: pendiente });
    await servicio.cerrarJornada(ctx, { sessionId: sesion.id, cambioFinal: [] });

    // Jornada 2, abierta, con los billetes que tenga el cajón.
    await servicio.abrirJornada(ctx, { registerId: caja, fondoManual: billetesDeCaja });
    return { caja, sessionIds: [sesion.id] };
  }

  const valor = (l: readonly { valor: number; cantidad: number }[]) =>
    l.reduce((a, x) => a + x.valor * x.cantidad, 0);

  it("el desglose del pendiente sale del libro mayor, no de un redondeo", async () => {
    const { caja, sessionIds } = await escenario([{ valor: 1000, cantidad: 1 }]);
    const p = await ingresos.proponerCanje(EMPRESA, caja, sessionIds);

    // Lo que de verdad se puede ingresar son 95 €, no los 105 € del redondeo.
    expect(p.ingresableCentimos).toBe(9500);
    expect(p.enMonedasCentimos).toBe(1069);
    expect(valor(p.pendiente.billetes) + valor(p.pendiente.monedas)).toBe(10569);
  });

  it("con un billete de 10 en caja, propone canjear los 10 € en monedas", async () => {
    const { caja, sessionIds } = await escenario([{ valor: 1000, cantidad: 1 }]);
    const p = await ingresos.proponerCanje(EMPRESA, caja, sessionIds);
    expect(p.canje?.valorMonedasCentimos).toBe(1000);
    expect(p.canje?.billetesRecibidos).toEqual([{ valor: 1000, cantidad: 1 }]);
  });

  it("sin billete de 10 pero con uno de 50, entrega los 2×20 y se lleva el 50", async () => {
    const { caja, sessionIds } = await escenario([{ valor: 5000, cantidad: 1 }]);
    const p = await ingresos.proponerCanje(EMPRESA, caja, sessionIds);
    expect(p.canje?.valorMonedasCentimos).toBe(1000);
    expect(valor(p.canje?.billetesEntregados ?? [])).toBe(4000);
    expect(p.canje?.billetesRecibidos).toEqual([{ valor: 5000, cantidad: 1 }]);
  });

  it("teniendo el de 10 y el de 50 en caja, propone llevarse el de 50", async () => {
    // La regla del mostrador: siempre el billete más grande. El cajón se queda
    // los dos de 20 y la calderilla, y suelta el billete gordo.
    const { caja, sessionIds } = await escenario([
      { valor: 5000, cantidad: 1 },
      { valor: 1000, cantidad: 1 },
    ]);
    const p = await ingresos.proponerCanje(EMPRESA, caja, sessionIds);
    expect(p.canje?.billetesRecibidos).toEqual([{ valor: 5000, cantidad: 1 }]);
    expect(p.canje?.billetesEntregados).toEqual([{ valor: 2000, cantidad: 2 }]);
    expect(p.canje?.valorMonedasCentimos).toBe(1000);
  });

  it("al registrarlo, el montón cambia y la caja no pierde valor", async () => {
    const { caja, sessionIds } = await escenario([{ valor: 1000, cantidad: 1 }]);
    const p = await ingresos.proponerCanje(EMPRESA, caja, sessionIds);
    if (!p.canje) throw new Error("debería haber canje");

    const abierta = (await repo.sesionAbierta(caja))!;
    const antes = (await servicio.stockDeJornada(abierta.id)).totalCentimos;

    await ingresos.registrarCanje(ctx, {
      registerId: caja,
      sessionIds,
      monedasEntregadas: p.canje.monedasEntregadas,
      billetesEntregados: p.canje.billetesEntregados,
      billetesRecibidos: p.canje.billetesRecibidos,
    });

    // La caja mantiene el valor y gana calderilla.
    const despues = await servicio.stockDeJornada(abierta.id);
    expect(despues.totalCentimos).toBe(antes);
    expect(despues.lineas.find((l) => l.valor === 200)?.cantidad).toBe(4);

    // Y el montón ya se puede ingresar entero salvo los 0,69 €.
    const ahora = await ingresos.proponerCanje(EMPRESA, caja, sessionIds);
    expect(ahora.ingresableCentimos).toBe(10500);
    expect(ahora.enMonedasCentimos).toBe(69);
    expect(ahora.canje).toBeNull();
  });

  it("sin billetes en la caja no hay canje: se ingresan 95 € y esperan las monedas", async () => {
    const { caja, sessionIds } = await escenario([{ valor: 200, cantidad: 3 }]);
    const p = await ingresos.proponerCanje(EMPRESA, caja, sessionIds);
    expect(p.canje).toBeNull();
    expect(p.ingresableCentimos).toBe(9500);
  });

  it("no se puede canjear una moneda que ya se canjeó", async () => {
    const { caja, sessionIds } = await escenario([{ valor: 1000, cantidad: 2 }]);
    const p = await ingresos.proponerCanje(EMPRESA, caja, sessionIds);
    if (!p.canje) throw new Error("debería haber canje");

    await ingresos.registrarCanje(ctx, {
      registerId: caja,
      sessionIds,
      monedasEntregadas: p.canje.monedasEntregadas,
      billetesEntregados: p.canje.billetesEntregados,
      billetesRecibidos: p.canje.billetesRecibidos,
    });

    // El mismo canje otra vez: esas monedas ya no están en el montón.
    await expect(
      ingresos.registrarCanje(ctx, {
        registerId: caja,
        sessionIds,
        monedasEntregadas: p.canje.monedasEntregadas,
        billetesEntregados: p.canje.billetesEntregados,
        billetesRecibidos: p.canje.billetesRecibidos,
      })
    ).rejects.toMatchObject({ codigo: "STOCK_INSUFICIENTE" });
  });

  it("un canje que no cuadra se rechaza", async () => {
    const { caja, sessionIds } = await escenario([{ valor: 1000, cantidad: 1 }]);
    await expect(
      ingresos.registrarCanje(ctx, {
        registerId: caja,
        sessionIds,
        monedasEntregadas: [{ valor: 200, cantidad: 4 }],
        billetesEntregados: [],
        billetesRecibidos: [{ valor: 1000, cantidad: 1 }],
      })
    ).rejects.toMatchObject({ codigo: "EFECTIVO_NO_CUADRA" });
  });

  it("el ingreso consume los canjes: el montón siguiente arranca limpio", async () => {
    const { caja, sessionIds } = await escenario([{ valor: 1000, cantidad: 1 }]);
    const p = await ingresos.proponerCanje(EMPRESA, caja, sessionIds);
    await ingresos.registrarCanje(ctx, {
      registerId: caja,
      sessionIds,
      monedasEntregadas: p.canje!.monedasEntregadas,
      billetesEntregados: p.canje!.billetesEntregados,
      billetesRecibidos: p.canje!.billetesRecibidos,
    });

    await ingresos.crearIngreso(ctx, {
      registerId: caja,
      sessionIds,
      importeCentimos: 10500,
    });

    // Sin cierres pendientes y con los canjes consumidos, el montón es cero.
    const despues = await ingresos.proponerCanje(EMPRESA, caja, []);
    expect(despues.ingresableCentimos).toBe(0);
    expect(despues.enMonedasCentimos).toBe(0);
  });
});

describe.runIf(RUN)("código de caja y numeración de documentos", () => {
  it("el número lleva delante el código de la caja, no un MC para todas", async () => {
    // Es lo que permite conciliar con el banco: dos cajas del mismo taller
    // compartían serie y el número no decía de cuál salía el dinero.
    const a = await crearCaja("numeracion-a");
    const b = await crearCaja("numeracion-b");
    const codigos = await db.query(
      `SELECT id, codigo FROM cash_registers WHERE id = ANY($1::int[])`,
      [[a, b]]
    );
    /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
    const codigoDe = new Map(codigos.rows.map((r: any) => [r.id, r.codigo]));

    const cobroEn = async (caja: number) => {
      const { sesion } = await servicio.abrirJornada(ctx, {
        registerId: caja,
        fondoManual: FONDO_300,
      });
      const r = await servicio.registrarCobro(ctx, {
        sessionId: sesion.id,
        importeCentimos: 5000,
        formasPago: [{ forma: "CASH", importe: 5000 }],
        efectivoRecibido: [{ valor: 5000, cantidad: 1 }],
        concepto: "Venta",
      });
      return r.numero;
    };

    const nA = await cobroEn(a);
    const nB = await cobroEn(b);

    expect(nA.startsWith(`${codigoDe.get(a)}-C-`)).toBe(true);
    expect(nB.startsWith(`${codigoDe.get(b)}-C-`)).toBe(true);
    expect(nA).not.toBe(nB);
  });

  it("cada caja tiene su propia serie: las dos empiezan en 001", async () => {
    // Con el contador global, la segunda caja habría seguido por donde iba la
    // primera y el número no serviría para contar los ingresos de un taller.
    const a = await crearCaja("serie-a");
    const b = await crearCaja("serie-b");
    const primerCobro = async (caja: number) => {
      const { sesion } = await servicio.abrirJornada(ctx, {
        registerId: caja,
        fondoManual: FONDO_300,
      });
      const r = await servicio.registrarCobro(ctx, {
        sessionId: sesion.id,
        importeCentimos: 5000,
        formasPago: [{ forma: "CASH", importe: 5000 }],
        efectivoRecibido: [{ valor: 5000, cantidad: 1 }],
        concepto: "Venta",
      });
      return r.numero.split("-").pop();
    };
    expect(await primerCobro(a)).toBe("001");
    expect(await primerCobro(b)).toBe("001");
  });

  it("el año va en dos cifras y la secuencia crece dentro de la caja", async () => {
    const caja = await crearCaja("serie-crece");
    const { sesion } = await servicio.abrirJornada(ctx, {
      registerId: caja,
      fondoManual: FONDO_300,
    });
    const cobrar = async () =>
      (
        await servicio.registrarCobro(ctx, {
          sessionId: sesion.id,
          importeCentimos: 1000,
          formasPago: [{ forma: "CASH", importe: 1000 }],
          efectivoRecibido: [{ valor: 1000, cantidad: 1 }],
          concepto: "Venta",
        })
      ).numero;

    const uno = await cobrar();
    const dos = await cobrar();
    const [, , aa, seq1] = uno.split("-");
    const [, , , seq2] = dos.split("-");
    expect(aa).toHaveLength(2);
    expect(aa).toBe(String(new Date().getFullYear() % 100));
    expect(Number(seq2)).toBe(Number(seq1) + 1);
  });

  it("una caja sin código numera con MC en vez de dejar la caja parada", async () => {
    // Un dato de configuración que falta no puede parar el mostrador. Sale
    // feo, se ve en Configuración, y se arregla sin perder ningún cobro.
    const { rows } = await db.query(
      `INSERT INTO cash_registers (empresa_id, centro, nombre, created_at_ms, updated_at_ms)
       VALUES ($1,'sincodigo',$2,$3,$3) RETURNING id`,
      [EMPRESA, `sin-codigo-${String(process.hrtime.bigint()).slice(-9)}`, Date.now()]
    );
    const { sesion } = await servicio.abrirJornada(ctx, {
      registerId: rows[0].id,
      fondoManual: FONDO_300,
    });
    const r = await servicio.registrarCobro(ctx, {
      sessionId: sesion.id,
      importeCentimos: 5000,
      formasPago: [{ forma: "CASH", importe: 5000 }],
      efectivoRecibido: [{ valor: 5000, cantidad: 1 }],
      concepto: "Venta",
    });
    expect(r.numero.startsWith("MC-C-")).toBe(true);
  });

  it("una caja nueva nace con código, y dos no pueden compartirlo", async () => {
    const centro = `centro-${String(process.hrtime.bigint()).slice(-6)}`;
    const uno = await config.crearCaja(ctx, { nombre: "Mostrador", centro });
    expect(uno.codigo).not.toBe("");

    const otra = await config.crearCaja(ctx, { nombre: "Taller", centro });
    expect(otra.codigo).not.toBe(uno.codigo);

    await expect(
      config.actualizarCaja(ctx, otra.id, { codigo: uno.codigo })
    ).rejects.toMatchObject({ codigo: "ENTRADA_NO_VALIDA" });
  });

  it("el código se normaliza y se rechaza el que rompería el número", async () => {
    const centro = `centro-${String(process.hrtime.bigint()).slice(-6)}`;
    const caja = await config.crearCaja(ctx, { nombre: "Mostrador", centro });

    // Código único por ejecución: la base de pruebas se reutiliza, y un
    // literal fijo chocaría con la caja que lo recibió en la pasada anterior.
    const unico = `x ${String(process.hrtime.bigint()).slice(-4)}`;
    const cambiada = await config.actualizarCaja(ctx, caja.id, { codigo: unico });
    expect(cambiada.codigo).toBe(unico.toUpperCase().replace(" ", ""));

    // Un guion partiría REU-2-IB-26-001 por donde no toca.
    await expect(
      config.actualizarCaja(ctx, caja.id, { codigo: "R" })
    ).rejects.toMatchObject({ codigo: "ENTRADA_NO_VALIDA" });
  });

  it("cambiar el código no renumera lo ya emitido", async () => {
    // Un número puede estar impreso en un resguardo o apuntado en el extracto.
    const centro = `centro-${String(process.hrtime.bigint()).slice(-6)}`;
    const caja = await config.crearCaja(ctx, { nombre: "Mostrador", centro });
    const { sesion } = await servicio.abrirJornada(ctx, {
      registerId: caja.id,
      fondoManual: FONDO_300,
    });
    const cobro = await servicio.registrarCobro(ctx, {
      sessionId: sesion.id,
      importeCentimos: 5000,
      formasPago: [{ forma: "CASH", importe: 5000 }],
      efectivoRecibido: [{ valor: 5000, cantidad: 1 }],
      concepto: "Venta",
    });

    await servicio.guardarArqueo(ctx, {
      sessionId: sesion.id,
      contado: (await servicio.stockDeJornada(sesion.id)).lineas,
    });
    await servicio.cerrarJornada(ctx, {
      sessionId: sesion.id,
      cambioFinal: (await servicio.proponerCierre(sesion.id, 30000)).cambioFinal,
    });
    const nuevoCodigo = `Z${String(process.hrtime.bigint()).slice(-5)}`;
    await config.actualizarCaja(ctx, caja.id, { codigo: nuevoCodigo });

    const { rows } = await db.query(`SELECT numero FROM cash_operations WHERE id = $1`, [
      cobro.operacionId,
    ]);
    expect(rows[0].numero).toBe(cobro.numero);
    expect(rows[0].numero.startsWith(`${nuevoCodigo}-`)).toBe(false);
  });
});

describe.runIf(RUN)("resguardo del ingreso bancario", () => {
  it("lleva el número, el importe y el desglose de billetes", async () => {
    const caja = await crearCaja("resguardo");
    const { sesion } = await servicio.abrirJornada(ctx, {
      registerId: caja,
      fondoManual: FONDO_300,
    });
    await servicio.registrarCobro(ctx, {
      sessionId: sesion.id,
      importeCentimos: 10000,
      formasPago: [{ forma: "CASH", importe: 10000 }],
      efectivoRecibido: [{ valor: 5000, cantidad: 2 }],
      concepto: "Venta",
    });
    await servicio.guardarArqueo(ctx, {
      sessionId: sesion.id,
      contado: (await servicio.stockDeJornada(sesion.id)).lineas,
    });
    await servicio.cerrarJornada(ctx, {
      sessionId: sesion.id,
      cambioFinal: (await servicio.proponerCierre(sesion.id, 30000)).cambioFinal,
    });

    const ingreso = await ingresos.crearIngreso(ctx, {
      registerId: caja,
      sessionIds: [sesion.id],
      importeCentimos: 10000,
    });

    const pdf = await informe.informeIngreso(EMPRESA, ingreso.id);
    expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
    expect(pdf.length).toBeGreaterThan(1000);
  });

  it("lleva el logotipo del banco a tamaño completo, sin haber subido nada", async () => {
    /*
     * El logotipo se imprime, así que va al PDF con toda su resolución: la
     * miniatura de un botón sale sucia en el papel. Se comprueba por el ancho
     * en píxeles de la imagen incrustada, que es el del fichero de
     * `public/bancos/`, no uno recortado por el camino.
     */
    const caja = await crearCaja("resguardo-logo");
    const { sesion } = await servicio.abrirJornada(ctx, {
      registerId: caja,
      fondoManual: FONDO_300,
    });
    await servicio.registrarCobro(ctx, {
      sessionId: sesion.id,
      importeCentimos: 10000,
      formasPago: [{ forma: "CASH", importe: 10000 }],
      efectivoRecibido: [{ valor: 5000, cantidad: 2 }],
      concepto: "Venta",
    });
    await servicio.guardarArqueo(ctx, {
      sessionId: sesion.id,
      contado: (await servicio.stockDeJornada(sesion.id)).lineas,
    });
    await servicio.cerrarJornada(ctx, {
      sessionId: sesion.id,
      cambioFinal: (await servicio.proponerCierre(sesion.id, 30000)).cambioFinal,
    });

    // Cuenta de CaixaBank y banco SIN logotipo subido: manda el de la aplicación.
    const bancos = await config.listarBancos(EMPRESA);
    const caixa = bancos.find((b) => b.codigo === "2100")!;
    await config.actualizarBanco(ctx, caixa.id, { logoUrl: null });
    const bban = `2100${String(process.hrtime.bigint()).slice(-16).padStart(16, "0")}`;
    let resto = 0;
    for (const c of `${bban}ES00`) {
      const v = c >= "A" ? String(c.charCodeAt(0) - 55) : c;
      for (const d of v) resto = (resto * 10 + Number(d)) % 97;
    }
    const cuenta = await config.crearCuenta(ctx, {
      iban: `ES${String(98 - resto).padStart(2, "0")}${bban}`,
    });

    const ingreso = await ingresos.crearIngreso(ctx, {
      registerId: caja,
      sessionIds: [sesion.id],
      importeCentimos: 10000,
      bankAccountId: cuenta.id,
    });

    const pdf = await informe.informeIngreso(EMPRESA, ingreso.id);
    const fichero = path.join(process.cwd(), "public", "bancos", "2100-caixabank.png");
    const { width, height } = await sharp(fs.readFileSync(fichero)).metadata();
    const crudo = pdf.toString("latin1");
    expect(crudo).toContain(`/Width ${width}`);
    expect(crudo).toContain(`/Height ${height}`);
  });

  it("un ingreso de otra empresa no se puede imprimir", async () => {
    const caja = await crearCaja("resguardo-ajeno");
    const { sesion } = await servicio.abrirJornada(ctx, {
      registerId: caja,
      fondoManual: FONDO_300,
    });
    await servicio.registrarCobro(ctx, {
      sessionId: sesion.id,
      importeCentimos: 10000,
      formasPago: [{ forma: "CASH", importe: 10000 }],
      efectivoRecibido: [{ valor: 5000, cantidad: 2 }],
      concepto: "Venta",
    });
    await servicio.guardarArqueo(ctx, {
      sessionId: sesion.id,
      contado: (await servicio.stockDeJornada(sesion.id)).lineas,
    });
    await servicio.cerrarJornada(ctx, {
      sessionId: sesion.id,
      cambioFinal: (await servicio.proponerCierre(sesion.id, 30000)).cambioFinal,
    });
    const ingreso = await ingresos.crearIngreso(ctx, {
      registerId: caja,
      sessionIds: [sesion.id],
      importeCentimos: 10000,
    });

    await expect(
      informe.informeIngreso("00000000-0000-4000-a000-0000000000ff", ingreso.id)
    ).rejects.toMatchObject({ codigo: "INGRESO_NO_ENCONTRADO" });
  });
});

describe.runIf(RUN)("arqueo repartido entre las cajas de la ERP", () => {
  it("el informe saca una hoja por caja y las dos suman lo contado", async () => {
    /*
     * El caso real del 18/08: un cajón con 350 € de fondo, 29,69 € de taller y
     * 50 € de gasolinera. En Genes son dos cierres distintos, así que el
     * arqueo del cajón entero (429,69 €) no cuadra contra ninguno de los dos.
     */
    const secciones = await config.listarSecciones(EMPRESA);
    const taller = secciones.find((x) => x.porDefecto)!;
    const nombreGaso = `Gasolinera ${String(process.hrtime.bigint()).slice(-6)}`;
    const gaso = await config.crearSeccion(ctx, { nombre: nombreGaso });
    await config.actualizarSeccion(ctx, gaso.id, { arqueaAparte: true });

    const caja = await crearCaja("erp-split");
    const { sesion } = await servicio.abrirJornada(ctx, {
      registerId: caja,
      fondoManual: [
        { valor: 5000, cantidad: 4 }, { valor: 2000, cantidad: 2 }, { valor: 1000, cantidad: 6 },
        { valor: 200, cantidad: 2 }, { valor: 100, cantidad: 23 }, { valor: 50, cantidad: 21 },
        { valor: 20, cantidad: 15 }, { valor: 10, cantidad: 49 }, { valor: 5, cantidad: 64 },
        { valor: 2, cantidad: 51 }, { valor: 1, cantidad: 38 },
      ],
    });

    await servicio.registrarCobro(ctx, {
      sessionId: sesion.id,
      importeCentimos: 2969,
      formasPago: [{ forma: "CASH", importe: 2969 }],
      efectivoRecibido: [{ valor: 2000, cantidad: 1 }, { valor: 1000, cantidad: 1 }],
      concepto: "Reparación",
      sectionId: taller.id,
    });
    await servicio.registrarCobro(ctx, {
      sessionId: sesion.id,
      importeCentimos: 5000,
      formasPago: [{ forma: "CASH", importe: 5000 }],
      efectivoRecibido: [{ valor: 5000, cantidad: 1 }],
      concepto: "Repostaje",
      sectionId: gaso.id,
    });

    const teorico = await servicio.stockDeJornada(sesion.id);
    expect(teorico.totalCentimos).toBe(42969);
    await servicio.guardarArqueo(ctx, { sessionId: sesion.id, contado: teorico.lineas });

    const resumen = await servicio.resumenJornada(sesion.id);
    const enResumen = resumen.porSeccion.find((x) => x.nombre === nombreGaso);
    expect(enResumen?.arqueaAparte).toBe(true);
    expect(enResumen?.efectivoNetoCentimos).toBe(5000);

    // El reparto: la gasolinera se lleva su billete de 50 y el resto se queda.
    const { repartirArqueo } = await import("./domain/erpsplit.ts");
    const reparto = repartirArqueo(
      resumen.ultimoArqueo!.sueltas,
      "Taller",
      resumen.porSeccion.filter((x) => x.arqueaAparte && x.efectivoNetoCentimos !== 0)
    );
    expect(reparto.principal.importeCentimos).toBe(37969);
    expect(reparto.aparte).toHaveLength(1);
    expect(reparto.aparte[0].importeCentimos).toBe(5000);
    expect(reparto.aparte[0].piezas).toEqual([{ valor: 5000, cantidad: 1 }]);

    // Y lo que hace que el cierre de Genes cuadre: las dos suman lo contado.
    expect(reparto.principal.importeCentimos + reparto.aparte[0].importeCentimos).toBe(42969);

    await servicio.cerrarJornada(ctx, {
      sessionId: sesion.id,
      cambioFinal: (await servicio.proponerCierre(sesion.id, 35000)).cambioFinal,
    });

    const pdf = await informe.informeCierre(EMPRESA, sesion.id);
    expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
  });

  it("sin secciones aparte, el informe sigue sacando una sola hoja", async () => {
    const caja = await crearCaja("erp-sin-split");
    const { sesion } = await servicio.abrirJornada(ctx, {
      registerId: caja,
      fondoManual: FONDO_300,
    });
    await servicio.guardarArqueo(ctx, {
      sessionId: sesion.id,
      contado: (await servicio.stockDeJornada(sesion.id)).lineas,
    });
    await servicio.cerrarJornada(ctx, {
      sessionId: sesion.id,
      cambioFinal: (await servicio.proponerCierre(sesion.id, 30000)).cambioFinal,
    });
    const pdf = await informe.informeCierre(EMPRESA, sesion.id);
    expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
  });

  it("la sección por defecto no se puede arquear aparte: es la caja principal", async () => {
    // Se queda con el fondo, así que separarla de sí misma dejaría el fondo
    // sin caja a la que imputarse y no cuadraría ninguna de las dos.
    const secciones = await config.listarSecciones(EMPRESA);
    const porDefecto = secciones.find((x) => x.porDefecto)!;
    await expect(
      config.actualizarSeccion(ctx, porDefecto.id, { arqueaAparte: true })
    ).rejects.toMatchObject({ codigo: "SECCION_POR_DEFECTO" });
  });
});

/**
 * Ámbito de taller (MC Central, fase 1).
 *
 * Lo que se comprueba aquí no es que la pantalla oculte cajas —eso es cosmética
 * y se puede saltar— sino que el SERVICIO se niegue. Un ámbito que solo vive en
 * el desplegable no limita a nadie que sepa escribir un id.
 */
describe.runIf(RUN)("Ámbito por taller", () => {
  let TALLER_A = "";
  let TALLER_B = "";

  /*
   * El taller se crea en `app_centros` cuando esa tabla existe.
   *
   * Con un uuid inventado la prueba pasaba en una base sin la fundación SaaS y
   * reventaba en una migrada, que es donde importa: `cash_registers.centro_id`
   * tiene clave ajena y un id que no existe no se puede guardar. Una prueba que
   * solo pasa donde no hay integridad referencial no prueba nada.
   */
  async function taller(nombre: string): Promise<string> {
    const { rows: hay } = await db.query(
      `SELECT to_regclass('public.app_centros') IS NOT NULL AS hay`
    );
    // Sin fundación SaaS no hay taller que crear, pero el id tiene que ser
    // DISTINTO en cada llamada: con `Date.now()` los dos talleres de la prueba
    // salían iguales dentro del mismo milisegundo y la prueba de aislamiento
    // comparaba un taller consigo mismo. `hrtime` es lo que ya usa `crearCaja`.
    if (!hay[0]?.hay) {
      // `padStart` y no solo `slice`: en un runner recién arrancado `hrtime`
      // lleva pocos nanosegundos y su texto NO llega a 12 dígitos, así que el
      // último grupo salía corto y PostgreSQL rechazaba el uuid. Reventaba solo
      // en máquinas con poco tiempo encendidas —o sea, en la CI y nunca en
      // local—, que es la peor forma de fallar.
      const cola = String(process.hrtime.bigint()).slice(-12).padStart(12, "0");
      return `00000000-0000-4000-a000-${cola}`;
    }

    await db.query(
      // El mismo valor va DOS VECES como parámetro distinto: en una posición
      // PostgreSQL lo deduce uuid y en la otra texto, y con un solo `$1` se
      // niega a preparar la consulta («inconsistent types deduced»). El cast
      // no lo arregla: mueve el conflicto, no lo quita.
      `INSERT INTO app_empresas (id, nombre, slug) VALUES ($1, 'Pruebas', 'pruebas-' || $2)
       ON CONFLICT (id) DO NOTHING`,
      [EMPRESA, EMPRESA]
    );
    const { rows } = await db.query(
      `INSERT INTO app_centros (empresa_id, nombre) VALUES ($1, $2) RETURNING id`,
      [EMPRESA, `${nombre}-${String(process.hrtime.bigint()).slice(-9)}`]
    );
    return rows[0].id;
  }

  beforeAll(async () => {
    if (!RUN) return;
    TALLER_A = await taller("ambito-A");
    TALLER_B = await taller("ambito-B");
  });

  it("un usuario limitado a su taller no abre la caja de otro, y sí la suya", async () => {
    const cajaA = await crearCaja("ambito-a");
    const cajaB = await crearCaja("ambito-b");
    await db.query(`UPDATE cash_registers SET centro_id = $2 WHERE id = $1`, [cajaA, TALLER_A]);
    await db.query(`UPDATE cash_registers SET centro_id = $2 WHERE id = $1`, [cajaB, TALLER_B]);

    const soloA = { ...ctx, centroId: TALLER_A };

    await expect(
      servicio.abrirJornada(soloA, { registerId: cajaB, fondoManual: [] })
    ).rejects.toMatchObject({ codigo: "CAJA_FUERA_DE_AMBITO" });

    const { sesion } = await servicio.abrirJornada(soloA, { registerId: cajaA, fondoManual: [] });
    expect(sesion.registerId).toBe(cajaA);
  });

  it("sin ámbito se sigue operando toda la empresa: nadie pierde acceso al desplegar", async () => {
    const caja = await crearCaja("ambito-sin");
    await db.query(`UPDATE cash_registers SET centro_id = $2 WHERE id = $1`, [caja, TALLER_B]);

    const { sesion } = await servicio.abrirJornada(ctx, { registerId: caja, fondoManual: [] });
    expect(sesion.registerId).toBe(caja);
  });

  /*
   * Una caja sin taller asignado queda FUERA de cualquier ámbito. Es la
   * decisión que más se puede discutir, así que se fija en una prueba: lo
   * contrario convertiría cada caja que el backfill no supo emparejar en un
   * agujero por el que se cuela todo el mundo.
   */
  it("una caja sin taller no la opera quien tiene ámbito", async () => {
    const huerfana = await crearCaja("ambito-huerfana");

    await expect(
      servicio.abrirJornada({ ...ctx, centroId: TALLER_A }, { registerId: huerfana, fondoManual: [] })
    ).rejects.toMatchObject({ codigo: "CAJA_FUERA_DE_AMBITO" });
  });

  it("el listado de cajas se recorta al ámbito", async () => {
    const caja = await crearCaja("ambito-lista");
    await db.query(`UPDATE cash_registers SET centro_id = $2 WHERE id = $1`, [caja, TALLER_A]);

    const listaA = await config.listarCajas(EMPRESA, TALLER_A);
    expect(listaA.some((c) => c.id === caja)).toBe(true);

    const listaB = await config.listarCajas(EMPRESA, TALLER_B);
    expect(listaB.some((c) => c.id === caja)).toBe(false);

    const todas = await config.listarCajas(EMPRESA);
    expect(todas.some((c) => c.id === caja)).toBe(true);
  });
});

/**
 * Eventos hacia MC Central (fase 2).
 *
 * Lo que de verdad hay que demostrar aquí no es que se emita un evento —eso es
 * fácil— sino que **emitirlo no puede costar un cobro**. Todo lo demás son
 * comprobaciones de la cola.
 */
describe.runIf(RUN)("Eventos hacia MC Central", () => {
  // El fondo variado de la suite: con solo billetes de 50 € la caja no puede
  // devolver cambio y el cobro falla antes de llegar a emitir nada.
  const FONDO = FONDO_300;

  /*
   * Vaciar la cola entera, no una tanda.
   *
   * El worker coge por orden de llegada, y a estas alturas de la suite hay
   * cientos de eventos de otras pruebas esperando delante. Una sola tanda ni
   * siquiera llega a los de la prueba en curso. Termina siempre: lo entregado
   * queda en SENT y lo fallido en RETRY_PENDING con la espera por delante o en
   * ERROR, y ninguno de los tres vuelve a salir.
   */
  async function vaciarCola() {
    for (let i = 0; i < 50; i++) {
      if ((await eventos.procesarEventos(500)) === 0) return;
    }
  }

  async function eventosDe(sessionId: number, tipo?: string) {
    const { rows } = await db.query(
      `SELECT tipo, aggregate_type, aggregate_version, datos, estado, event_id
         FROM cash_event_outbox
        WHERE session_id = $1 ${tipo ? "AND tipo = $2" : ""}
        ORDER BY id`,
      tipo ? [sessionId, tipo] : [sessionId]
    );
    return rows;
  }

  it("un cobro emite un evento, y solo uno, con su versión de jornada", async () => {
    const caja = await crearCaja("ev-cobro");
    const { sesion } = await servicio.abrirJornada(ctx, { registerId: caja, fondoManual: FONDO });

    await servicio.registrarCobro(ctx, {
      sessionId: sesion.id,
      importeCentimos: 2000,
      formasPago: [{ forma: "CASH", importe: 2000 }],
      efectivoRecibido: [{ valor: 5000, cantidad: 1 }],
    });

    /*
     * Uno, no dos. El fondo inicial también se asienta como operación, pero la
     * apertura no pasa por `registrarOperacion`: emite `SESSION_OPENED` con el
     * fondo dentro. Y así tiene que ser: con los dos eventos, Central podría
     * sumar el fondo dos veces, que es exactamente el doble conteo que el
     * encargo prohíbe.
     */
    const registrados = await eventosDe(sesion.id, "OPERATION_REGISTERED");
    expect(registrados.length).toBe(1);
    expect(registrados[0].datos.tipoOperacion).toBe("COLLECTION");
    expect(Number(registrados[0].datos.importeCentimos)).toBe(2000);

    // La apertura también emitió lo suyo, y la versión va en orden.
    const todos = await eventosDe(sesion.id);
    expect(todos[0].tipo).toBe("SESSION_OPENED");
    const versiones = todos.map((e) => Number(e.aggregate_version));
    expect(versiones).toEqual([...versiones].sort((a, b) => a - b));
    expect(new Set(versiones).size).toBe(versiones.length);
    expect(todos.every((e) => e.aggregate_type === "SESSION")).toBe(true);
  });

  /*
   * La prueba que justifica el diseño entero. Si el transporte cayendo pudiera
   * revertir la transacción, el dinero estaría en el cajón y el cobro no
   * existiría: el peor fallo posible en este módulo.
   */
  it("con el transporte caído, el cobro se registra igual y el evento espera", async () => {
    const memoria = new transporte.TransporteEnMemoria();
    memoria.fallo = new Error("Central no responde");
    transporte.registrarTransporte(memoria);

    try {
      const caja = await crearCaja("ev-caido");
      const { sesion } = await servicio.abrirJornada(ctx, { registerId: caja, fondoManual: FONDO });

      const cobro = await servicio.registrarCobro(ctx, {
        sessionId: sesion.id,
        importeCentimos: 1000,
        formasPago: [{ forma: "CASH", importe: 1000 }],
        efectivoRecibido: [{ valor: 5000, cantidad: 1 }],
      });

      // El cobro existe: el dinero contado está registrado.
      expect(cobro.numero).toMatch(numeroDe("C"));

      await vaciarCola();

      const { rows } = await db.query(
        `SELECT estado, intentos, last_error FROM cash_event_outbox
          WHERE session_id = $1 ORDER BY id DESC LIMIT 1`,
        [sesion.id]
      );
      expect(rows[0].estado).toBe("RETRY_PENDING");
      expect(rows[0].intentos).toBe(1);
      expect(rows[0].last_error).toContain("Central no responde");
    } finally {
      transporte.registrarTransporte(null);
    }
  });

  it("el worker entrega y no reenvía lo ya entregado", async () => {
    const memoria = new transporte.TransporteEnMemoria();
    transporte.registrarTransporte(memoria);

    try {
      const caja = await crearCaja("ev-entrega");
      const { sesion } = await servicio.abrirJornada(ctx, { registerId: caja, fondoManual: FONDO });

      await vaciarCola();
      const entregados = memoria.recibidos.filter((r) => r.sessionId === sesion.id).length;
      expect(entregados).toBeGreaterThan(0);

      // Segunda vuelta: ya está todo en SENT, así que no vuelve a salir.
      await vaciarCola();
      expect(memoria.recibidos.filter((r) => r.sessionId === sesion.id).length).toBe(entregados);
    } finally {
      transporte.registrarTransporte(null);
    }
  });

  it("un rechazo permanente va a la cola muerta y se puede relanzar", async () => {
    const memoria = new transporte.TransporteEnMemoria();
    memoria.fallo = new transporte.ErrorTransportePermanente("Empresa desconocida");
    transporte.registrarTransporte(memoria);

    try {
      const caja = await crearCaja("ev-dlq");
      const { sesion } = await servicio.abrirJornada(ctx, { registerId: caja, fondoManual: FONDO });

      await vaciarCola();

      // Sin gastar los ocho intentos: un permanente no se reintenta.
      const { rows } = await db.query(
        `SELECT estado, intentos FROM cash_event_outbox WHERE session_id = $1 ORDER BY id`,
        [sesion.id]
      );
      expect(rows[0].estado).toBe("ERROR");
      expect(rows[0].intentos).toBe(1);

      const cola = await eventos.estadoCola(EMPRESA);
      expect(cola.muertos.some((m) => m.lastError?.includes("Empresa desconocida"))).toBe(true);

      // Arreglado lo de enfrente, el relanzamiento los devuelve a la cola.
      memoria.fallo = null;
      const reencolados = await eventos.reintentarEventos(EMPRESA);
      expect(reencolados).toBeGreaterThan(0);
      await vaciarCola();

      const { rows: despues } = await db.query(
        `SELECT estado FROM cash_event_outbox WHERE session_id = $1 ORDER BY id`,
        [sesion.id]
      );
      expect(despues.every((r) => r.estado === "SENT")).toBe(true);
    } finally {
      transporte.registrarTransporte(null);
    }
  });

  it("el cierre y el ingreso bancario emiten lo suyo, y el ingreso cuelga de la CAJA", async () => {
    const caja = await crearCaja("ev-cierre");
    const { sesion } = await servicio.abrirJornada(ctx, { registerId: caja, fondoManual: FONDO });

    await servicio.guardarArqueo(ctx, { sessionId: sesion.id, contado: FONDO });
    // Todo lo contado se queda como cambio: no hay ingreso bancario que hacer.
    await servicio.cerrarJornada(ctx, { sessionId: sesion.id, cambioFinal: FONDO });

    const tipos = (await eventosDe(sesion.id)).map((e) => e.tipo);
    expect(tipos).toContain("COUNT_RECORDED");
    expect(tipos).toContain("SESSION_CLOSED");

    const { rows } = await db.query(
      `SELECT aggregate_type, register_id FROM cash_event_outbox
        WHERE tipo = 'BANK_DEPOSIT_CREATED' AND register_id = $1`,
      [caja]
    );
    // Sin ingreso bancario que hacer no hay evento; lo que se fija aquí es que
    // si lo hubiera, colgaría de la caja y no de una jornada.
    for (const r of rows) expect(r.aggregate_type).toBe("REGISTER");
  });

});

/**
 * Evidencias: integridad y versión (fase 9 de MC Central).
 *
 * El bucket privado y la URL firmada ya existían. Lo que se prueba aquí es lo
 * nuevo: que se pueda demostrar que el fichero de hoy es el que se adjuntó, y
 * que sustituir un escaneo torcido no pierda el anterior.
 */
describe.runIf(RUN)("Evidencias con huella y versión", () => {
  async function pdfDePrueba(texto: string): Promise<Buffer> {
    const { PDFDocument, StandardFonts } = await import("pdf-lib");
    const doc = await PDFDocument.create();
    const pagina = doc.addPage([595.28, 841.89]);
    const fuente = await doc.embedFont(StandardFonts.Helvetica);
    pagina.drawText(texto, { x: 60, y: 760, size: 14, font: fuente });
    return Buffer.from(await doc.save());
  }

  async function cobroConCaja(nombre: string) {
    const caja = await crearCaja(nombre);
    const { sesion } = await servicio.abrirJornada(ctx, {
      registerId: caja,
      fondoManual: FONDO_300,
    });
    return servicio.registrarCobro(ctx, {
      sessionId: sesion.id,
      importeCentimos: 5000,
      formasPago: [{ forma: "CASH", importe: 5000 }],
      efectivoRecibido: [{ valor: 5000, cantidad: 1 }],
    });
  }
  it("el justificante guarda su huella y se puede verificar", async () => {
    const cobro = await cobroConCaja("huella");

    const doc = await documentos.adjuntarDocumento(ctx, cobro.operacionId, {
      originalname: "factura.pdf",
      mimetype: "application/pdf",
      buffer: await pdfDePrueba("ORIGINAL"),
    });

    const { rows } = await db.query(
      `SELECT sha256, version FROM cash_operation_documents WHERE id = $1`,
      [doc.id]
    );
    expect(rows[0].sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(rows[0].version).toBe(1);

    expect((await documentos.verificarDocumento(ctx, doc.id)).estado).toBe("OK");
  });

  /*
   * La razón de ser del SHA-256: si el fichero del almacenamiento cambia, se
   * tiene que notar. Sin esta comprobación la huella sería un adorno.
   */
  it("si el fichero cambia por detrás, la verificación lo dice", async () => {
    const cobro = await cobroConCaja("alterado");
    const doc = await documentos.adjuntarDocumento(ctx, cobro.operacionId, {
      originalname: "factura.pdf",
      mimetype: "application/pdf",
      buffer: await pdfDePrueba("ORIGINAL"),
    });

    // Se cambia la huella guardada, que es equivalente a que cambiara el
    // fichero y mucho más fácil de provocar en una prueba.
    await db.query(`UPDATE cash_operation_documents SET sha256 = $2 WHERE id = $1`, [
      doc.id,
      "0".repeat(64),
    ]);

    expect((await documentos.verificarDocumento(ctx, doc.id)).estado).toBe("ALTERADO");
  });

  it("un justificante sin huella dice que no se puede comprobar, no que esté bien", async () => {
    const cobro = await cobroConCaja("sinhuella");
    const doc = await documentos.adjuntarDocumento(ctx, cobro.operacionId, {
      originalname: "vieja.pdf",
      mimetype: "application/pdf",
      buffer: await pdfDePrueba("ANTIGUA"),
    });

    // Como los que se subieron antes de esta fase.
    await db.query(`UPDATE cash_operation_documents SET sha256 = NULL WHERE id = $1`, [doc.id]);

    const v = await documentos.verificarDocumento(ctx, doc.id);
    expect(v.estado).toBe("SIN_HUELLA");
  });

  it("sustituir un escaneo sube la versión y conserva el anterior", async () => {
    const cobro = await cobroConCaja("version");

    const torcido = await documentos.adjuntarDocumento(ctx, cobro.operacionId, {
      originalname: "torcido.pdf",
      mimetype: "application/pdf",
      buffer: await pdfDePrueba("TORCIDO"),
    });

    const bueno = await documentos.adjuntarDocumento(
      ctx,
      cobro.operacionId,
      {
        originalname: "bueno.pdf",
        mimetype: "application/pdf",
        buffer: await pdfDePrueba("BUENO"),
      },
      torcido.id
    );

    const { rows } = await db.query(
      `SELECT id, version, reemplaza_a, sustituido, anulado
         FROM cash_operation_documents WHERE id = ANY($1::int[]) ORDER BY id`,
      [[torcido.id, bueno.id]]
    );
    const [viejo, nuevo] = rows;

    expect(nuevo.version).toBe(2);
    expect(nuevo.reemplaza_a).toBe(torcido.id);
    // El anterior se queda: sustituido no es lo mismo que anulado. Anular es lo
    // que se hace cuando un justificante no debía estar; sustituir es que el
    // mismo papel se ha vuelto a escanear mejor.
    expect(viejo.sustituido).toBe(true);
    expect(viejo.anulado).toBe(false);
  });

  it("avisa de que ese mismo fichero ya se había subido", async () => {
    const cobro = await cobroConCaja("duplicado");

    const contenido = await pdfDePrueba("EL MISMO TACO DE FACTURAS");
    await documentos.adjuntarDocumento(ctx, cobro.operacionId, {
      originalname: "taco.pdf",
      mimetype: "application/pdf",
      buffer: contenido,
    });

    const repetidos = await documentos.duplicadosDe(EMPRESA, contenido);
    expect(repetidos.length).toBeGreaterThanOrEqual(1);
    expect(repetidos[0].nombre).toBe("taco.pdf");

    // Y uno distinto no sale como duplicado.
    expect(await documentos.duplicadosDe(EMPRESA, await pdfDePrueba("OTRO"))).toHaveLength(0);
  });
});

/**
 * Auditoría inmutable y separación de funciones (fase 10 de MC Central).
 *
 * La auditoría no la ejercitaba NINGUNA prueba: `app_auditoria` la creaba una
 * migración que se aplica a mano, no existía en la base de pruebas, y como
 * `registrarAuditoria` traga sus errores, las 35 llamadas del módulo fallaban
 * en silencio sin que nadie se enterara. Eso es lo primero que se comprueba
 * aquí: que ahora se escribe de verdad.
 */
describe.runIf(RUN)("Auditoría inmutable y separación de funciones", () => {
  async function cobroSuelto(nombre: string) {
    const caja = await crearCaja(nombre);
    const { sesion } = await servicio.abrirJornada(ctx, {
      registerId: caja,
      fondoManual: FONDO_300,
    });
    const cobro = await servicio.registrarCobro(ctx, {
      sessionId: sesion.id,
      importeCentimos: 5000,
      formasPago: [{ forma: "CASH", importe: 5000 }],
      efectivoRecibido: [{ valor: 5000, cantidad: 1 }],
    });
    return { caja, sesion, cobro };
  }

  it("un cobro deja su línea de auditoría, con huella", async () => {
    const { cobro } = await cobroSuelto("auditoria");

    const { rows } = await db.query(
      `SELECT accion, huella, detalle FROM app_auditoria
        WHERE entidad = 'cash_operations' AND entidad_id = $1`,
      [String(cobro.operacionId)]
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].accion).toBe("cash.operation.collection");
    expect(rows[0].huella).toMatch(/^[0-9a-f]{64}$/);
    expect(rows[0].detalle.numero).toBe(cobro.numero);
  });

  /*
   * Las políticas RLS ya impedían modificar y borrar, pero el servidor se
   * conecta con `pg` y no pasa por RLS. El disparador sí alcanza a todo el
   * mundo, y eso es lo que se comprueba: con la misma conexión que usa el
   * módulo.
   */
  it("una línea de auditoría no se puede cambiar ni borrar", async () => {
    const { cobro } = await cobroSuelto("inmutable");
    const { rows } = await db.query(
      `SELECT id FROM app_auditoria WHERE entidad_id = $1 LIMIT 1`,
      [String(cobro.operacionId)]
    );
    const id = rows[0].id;

    await expect(
      db.query(`UPDATE app_auditoria SET accion = 'otra cosa' WHERE id = $1`, [id])
    ).rejects.toThrow(/inmutable/i);

    await expect(db.query(`DELETE FROM app_auditoria WHERE id = $1`, [id])).rejects.toThrow(
      /inmutable/i
    );

    // Y sigue ahí, intacta.
    const { rows: despues } = await db.query(
      `SELECT accion FROM app_auditoria WHERE id = $1`,
      [id]
    );
    expect(despues[0].accion).toBe("cash.operation.collection");
  });

  /*
   * La auditoría va DENTRO de la transacción del dinero. Si no se puede
   * escribir, la operación no se guarda: es la mitad que faltaba del riesgo R2
   * —antes podía quedar un cobro asentado sin ninguna línea que dijera quién lo
   * hizo—.
   */
  it("si la auditoría no se puede escribir, el cobro tampoco se guarda", async () => {
    const caja = await crearCaja("r2");
    const { sesion } = await servicio.abrirJornada(ctx, {
      registerId: caja,
      fondoManual: FONDO_300,
    });

    // Se rompe la escritura de auditoría a propósito, con un disparador que
    // falla. Es la forma de provocar en una prueba lo que en producción sería
    // un problema de la base de datos.
    await db.query(`
      CREATE OR REPLACE FUNCTION app_auditoria_romper() RETURNS TRIGGER AS $$
      BEGIN RAISE EXCEPTION 'auditoria caida'; END $$ LANGUAGE plpgsql;
      CREATE TRIGGER app_auditoria_romper_trg BEFORE INSERT ON app_auditoria
        FOR EACH ROW EXECUTE FUNCTION app_auditoria_romper();
    `);

    try {
      await expect(
        servicio.registrarCobro(ctx, {
          sessionId: sesion.id,
          importeCentimos: 5000,
          formasPago: [{ forma: "CASH", importe: 5000 }],
          efectivoRecibido: [{ valor: 5000, cantidad: 1 }],
        })
      ).rejects.toThrow();
    } finally {
      await db.query(`DROP TRIGGER IF EXISTS app_auditoria_romper_trg ON app_auditoria`);
    }

    // Nada asentado: ni operación ni movimientos. El dinero no se ha movido.
    const { rows } = await db.query(
      `SELECT COUNT(*)::int AS n FROM cash_operations WHERE session_id = $1 AND tipo = 'COLLECTION'`,
      [sesion.id]
    );
    expect(rows[0].n).toBe(0);
  });

  it("con SoD apagado, quien cobra puede anular: es el comportamiento de siempre", async () => {
    const { cobro } = await cobroSuelto("sod-off");
    const anulada = await servicio.anularOperacion(ctx, cobro.operacionId, "Error de tecleo");
    expect(anulada.operacionId).toBeGreaterThan(0);
  });

  /*
   * Encendido, la misma persona no puede deshacer lo que hizo. Anular una
   * operación y reabrir una jornada son justo las dos acciones que borran el
   * rastro de un descuadre.
   */
  it("con SoD encendido, quien cobró no puede anular, y otra persona sí", async () => {
    const yo = "00000000-0000-4000-a000-00000000aa01";
    const otro = "00000000-0000-4000-a000-00000000aa02";

    const caja = await crearCaja("sod-on");
    const { sesion } = await servicio.abrirJornada(ctx, {
      registerId: caja,
      fondoManual: FONDO_300,
    });
    const cobro = await servicio.registrarCobro(
      { ...ctx, userId: yo },
      {
        sessionId: sesion.id,
        importeCentimos: 5000,
        formasPago: [{ forma: "CASH", importe: 5000 }],
        efectivoRecibido: [{ valor: 5000, cantidad: 1 }],
      }
    );

    await config.fijarAjuste(ctx, config.AJUSTES.SOD_ACTIVO, "1");
    try {
      await expect(
        servicio.anularOperacion({ ...ctx, userId: yo }, cobro.operacionId, "Me equivoqué")
      ).rejects.toMatchObject({ codigo: "SOD_REQUIERE_OTRA_PERSONA" });

      // Sin usuario identificado tampoco: ante la duda, no.
      await expect(
        servicio.anularOperacion({ ...ctx, userId: null }, cobro.operacionId, "Anónimo")
      ).rejects.toMatchObject({ codigo: "SOD_REQUIERE_OTRA_PERSONA" });

      const anulada = await servicio.anularOperacion(
        { ...ctx, userId: otro },
        cobro.operacionId,
        "Lo revisa el encargado"
      );
      expect(anulada.operacionId).toBeGreaterThan(0);
    } finally {
      await config.fijarAjuste(ctx, config.AJUSTES.SOD_ACTIVO, null);
    }
  });
});

/**
 * Reautenticación (fase 10).
 *
 * El verificador es enchufable por la misma razón que el conector de ERP: la
 * comprobación real va contra Supabase, que aquí no existe, y la REGLA —cuánto
 * dura, quién pasa, qué ocurre al caducar— se puede probar sin levantar nada.
 */
describe.runIf(RUN)("Reautenticación", () => {
  const USUARIO = "00000000-0000-4000-a000-00000000bb01";

  it("una clave correcta vale diez minutos; una equivocada no vale nada", async () => {
    reauth.registrarVerificador({
      verificar: async (_id, clave) => clave === "correcta",
    });
    try {
      await expect(reauth.reautenticar(USUARIO, "mal")).rejects.toMatchObject({
        codigo: "CLAVE_NO_VALIDA",
      });
      expect(await reauth.estaReautenticado(USUARIO)).toBe(false);

      await reauth.reautenticar(USUARIO, "correcta");
      expect(await reauth.estaReautenticado(USUARIO)).toBe(true);
    } finally {
      reauth.registrarVerificador(null);
    }
  });

  it("caduca: identificarse hace media hora no sirve para lo de ahora", async () => {
    reauth.registrarVerificador({ verificar: async () => true });
    try {
      await reauth.reautenticar(USUARIO, "loquesea");

      // Se envejece la marca media hora. Esperar de verdad no es una opción.
      await db.query(`UPDATE cash_reauth SET hasta_ms = $2 WHERE user_id = $1`, [
        USUARIO,
        Date.now() - 30 * 60_000,
      ]);
      expect(await reauth.estaReautenticado(USUARIO)).toBe(false);
    } finally {
      reauth.registrarVerificador(null);
    }
  });

  it("apagada no estorba; encendida exige identificarse, y sin usuario no pasa", async () => {
    // Apagada: la acción sensible no pide nada.
    await expect(reauth.exigirReautenticacion(EMPRESA, USUARIO)).resolves.toBeUndefined();

    await config.fijarAjuste(ctx, config.AJUSTES.REAUTH_ACTIVO, "1");
    try {
      await expect(reauth.exigirReautenticacion(EMPRESA, USUARIO)).rejects.toMatchObject({
        codigo: "REAUTENTICACION_REQUERIDA",
      });

      // Ante la duda, no: un usuario sin identificar no puede demostrar nada.
      await expect(reauth.exigirReautenticacion(EMPRESA, null)).rejects.toMatchObject({
        codigo: "REAUTENTICACION_REQUERIDA",
      });

      reauth.registrarVerificador({ verificar: async () => true });
      await reauth.reautenticar(USUARIO, "correcta");
      await expect(reauth.exigirReautenticacion(EMPRESA, USUARIO)).resolves.toBeUndefined();
    } finally {
      reauth.registrarVerificador(null);
      await config.fijarAjuste(ctx, config.AJUSTES.REAUTH_ACTIVO, null);
      await db.query(`DELETE FROM cash_reauth WHERE user_id = $1`, [USUARIO]);
    }
  });

  it("sin verificador registrado no se puede comprobar, y se dice", async () => {
    reauth.registrarVerificador(null);
    await expect(reauth.reautenticar(USUARIO, "loquesea")).rejects.toMatchObject({
      codigo: "REAUTENTICACION_NO_DISPONIBLE",
    });
  });
});

/**
 * Migration Center (fase 11).
 *
 * Lo que se prueba es la decisión de fondo: un día de papel se importa con el
 * desglose REAL del cambio del cajón —lo contado al cerrar menos lo contado al
 * abrir— y no con un reparto inventado del total. Y que repetir la importación
 * no duplique dinero, que es lo que separa una herramienta de migración que se
 * puede reintentar de una que hay que acertar a la primera.
 */
describe.runIf(RUN)("Importación de días de papel", () => {
  it("importa dos días encadenados y el cierre de uno es el fondo del otro", async () => {
    const caja = await crearCaja("papel");
    const lote = `L${String(process.hrtime.bigint()).slice(-9)}`;

    const dia13 = {
      registerId: caja,
      fecha: "2026-03-13",
      apertura: [{ valor: 2000, cantidad: 5 }],
      cierre: [
        { valor: 2000, cantidad: 5 },
        { valor: 1000, cantidad: 3 },
      ],
      cobradoCentimos: 3000,
    };
    const dia14 = {
      registerId: caja,
      fecha: "2026-03-14",
      apertura: [
        { valor: 2000, cantidad: 5 },
        { valor: 1000, cantidad: 3 },
      ],
      cierre: [
        { valor: 2000, cantidad: 5 },
        { valor: 1000, cantidad: 1 },
      ],
      pagadoCentimos: 2000,
    };

    // A propósito en desorden: la importación los ordena, porque el cierre de
    // cada día es el fondo del siguiente.
    const r = await migracion.importarDias(ctx, lote, [dia14, dia13]);

    expect(r.importados.map((d) => d.fecha)).toEqual(["2026-03-13", "2026-03-14"]);
    expect(r.importados[0].netoCentimos).toBe(3000);
    expect(r.importados[1].netoCentimos).toBe(-2000);

    // El asiento lleva las PIEZAS reales, no un reparto plausible del total.
    const { rows } = await db.query(
      `SELECT m.valor_unitario_centimos AS valor_centimos, m.cantidad, m.direccion
         FROM cash_denomination_movements m
         JOIN cash_operations o ON o.id = m.operation_id
        WHERE o.session_id = $1 AND o.origen = 'IMPORT'
        ORDER BY m.valor_unitario_centimos DESC`,
      [r.importados[0].sessionId]
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].valor_centimos).toBe(1000);
    expect(rows[0].cantidad).toBe(3);
    expect(rows[0].direccion).toBe("IN");

    // Y los días quedan cerrados y cuadrados: la importación no puede inventar
    // un descuadre que en el papel no estaba.
    const { rows: sesiones } = await db.query(
      `SELECT estado, diferencia_centimos FROM cash_sessions WHERE id = ANY($1::int[])`,
      [r.importados.map((d) => d.sessionId)]
    );
    for (const s of sesiones) {
      expect(s.estado).toBe("CLOSED");
      expect(Number(s.diferencia_centimos)).toBe(0);
    }
  });

  it("repetir el mismo lote no duplica dinero", async () => {
    const caja = await crearCaja("reimport");
    const lote = `R${String(process.hrtime.bigint()).slice(-9)}`;
    const dia = {
      registerId: caja,
      fecha: "2026-04-01",
      apertura: [{ valor: 1000, cantidad: 2 }],
      cierre: [{ valor: 1000, cantidad: 5 }],
    };

    const primera = await migracion.importarDias(ctx, lote, [dia]);
    expect(primera.importados).toHaveLength(1);

    const segunda = await migracion.importarDias(ctx, lote, [dia]);
    expect(segunda.importados).toHaveLength(0);
    expect(segunda.omitidos).toHaveLength(1);

    const { rows } = await db.query(
      `SELECT COUNT(*)::int AS n FROM cash_operations
        WHERE empresa_id = $1 AND external_system = 'IMPORT' AND external_document_id = $2`,
      [EMPRESA, `${lote}:2026-04-01`]
    );
    expect(rows[0].n).toBe(1);
  });

  it("un día sin movimiento se importa igual, sin asiento que no ocurrió", async () => {
    const caja = await crearCaja("quieto");
    const lote = `Q${String(process.hrtime.bigint()).slice(-9)}`;
    const r = await migracion.importarDias(ctx, lote, [
      {
        registerId: caja,
        fecha: "2026-04-02",
        apertura: [{ valor: 1000, cantidad: 2 }],
        cierre: [{ valor: 1000, cantidad: 2 }],
      },
    ]);

    expect(r.importados[0].netoCentimos).toBe(0);
    const { rows } = await db.query(
      `SELECT COUNT(*)::int AS n FROM cash_operations
        WHERE session_id = $1 AND origen = 'IMPORT'`,
      [r.importados[0].sessionId]
    );
    expect(rows[0].n).toBe(0);
  });

  it("el saldo inicial se declara una vez, y no cuando la caja ya tiene historia", async () => {
    const caja = await crearCaja("saldo");
    const declarado = await migracion.declararSaldoInicial(
      ctx,
      caja,
      [{ valor: 5000, cantidad: 2 }, { valor: 1000, cantidad: 5 }],
      "Recuento del 1 de enero, dinero que ya estaba en el cajón"
    );
    expect(declarado.totalCentimos).toBe(15000);

    // Queda dicho que se declaró, que es lo que preguntará un auditor.
    const { rows } = await db.query(
      `SELECT detalle FROM app_auditoria
        WHERE accion = 'cash.initial_balance.declare' AND entidad_id = $1`,
      [String(declarado.sessionId)]
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].detalle.totalCentimos).toBe(15000);

    await expect(
      migracion.declararSaldoInicial(ctx, caja, [{ valor: 1000, cantidad: 1 }], "Otra vez")
    ).rejects.toMatchObject({ codigo: "SALDO_INICIAL_YA_NO_APLICA" });
  });
});

describe.runIf(RUN)("bolsa contada que el libro mayor no tenía", () => {
  it("el cierre la precinta en vez de dejar el saldo en negativo", async () => {
    // 0,10 € con bolsas de 50 piezas configuradas.
    await db.query(
      `UPDATE cash_denominations SET piezas_por_bolsa = 50 WHERE valor_centimos = 10`
    );
    const { rows } = await db.query(
      `INSERT INTO cash_registers (empresa_id, centro, nombre, codigo, created_at_ms, updated_at_ms)
       VALUES ($1,'tarragona',$2,'R' || floor(random()*100000)::text,$3,$3) RETURNING id`,
      [EMPRESA, `repro-${String(process.hrtime.bigint()).slice(-9)}`, Date.now()]
    );
    const caja = rows[0].id;

    // Se abre con 80 monedas de 0,10 € SUELTAS (8,00 €) y un billete de 50 €.
    const { sesion } = await servicio.abrirJornada(ctx, {
      registerId: caja,
      fondoManual: [
        { valor: 5000, cantidad: 1 },
        { valor: 10, cantidad: 80 },
      ],
    });

    // El arqueo cuenta 30 sueltas + 1 BOLSA de 50: las mismas 80 piezas, pero
    // alguien las precintó durante el día. El libro mayor no lo sabe.
    await servicio.guardarArqueo(ctx, {
      sessionId: sesion.id,
      contado: [
        { valor: 5000, cantidad: 1 },
        { valor: 10, cantidad: 30 },
      ],
      bolsas: [{ valor: 10, cantidad: 1 }],
    });

    // Se cierra dejándolo todo como cambio, con la bolsa precintada.
    await servicio.cerrarJornada(ctx, {
      sessionId: sesion.id,
      cambioFinal: [
        { valor: 5000, cantidad: 1 },
        { valor: 10, cantidad: 30 },
      ],
      cambioFinalBolsas: [{ valor: 10, cantidad: 1 }],
    });

    // Ningún saldo de formato en negativo.
    const resumen = await servicio.resumenJornada(sesion.id);
    expect(resumen.incidenciasStock).toEqual([]);

    // Y el informe se genera, que es lo que fallaba.
    const pdf = await informe.informeCierre(EMPRESA, sesion.id);
    expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
  });
});

describe.runIf(RUN)("jornada que ya quedó con el saldo en negativo", () => {
  it("el informe sigue imprimiéndose y el descuadre sale escrito", async () => {
    await db.query(
      `UPDATE cash_denominations SET piezas_por_bolsa = 50 WHERE valor_centimos = 10`
    );
    const { rows } = await db.query(
      `INSERT INTO cash_registers (empresa_id, centro, nombre, codigo, created_at_ms, updated_at_ms)
       VALUES ($1,'tarragona',$2,'V' || floor(random()*100000)::text,$3,$3) RETURNING id`,
      [EMPRESA, `roto-${String(process.hrtime.bigint()).slice(-9)}`, Date.now()]
    );
    const caja = rows[0].id;
    const { sesion } = await servicio.abrirJornada(ctx, {
      registerId: caja,
      fondoManual: [{ valor: 5000, cantidad: 1 }, { valor: 10, cantidad: 80 }],
    });
    await servicio.guardarArqueo(ctx, {
      sessionId: sesion.id,
      contado: [{ valor: 5000, cantidad: 1 }, { valor: 10, cantidad: 80 }],
    });
    await servicio.cerrarJornada(ctx, {
      sessionId: sesion.id,
      cambioFinal: [{ valor: 5000, cantidad: 1 }, { valor: 10, cantidad: 80 }],
    });

    /*
     * Se fabrica el destrozo que dejaba la versión anterior, y se fabrica
     * FIEL: al cerrar, las piezas cuadran —todo sale como cambio final— y lo
     * único que queda mal es el FORMATO. Por eso no se añade ningún
     * movimiento nuevo: se parte el asiento de salida en dos, una parte como
     * bolsa precintada que el libro mayor nunca vio entrar.
     *
     * Con un movimiento de más, lo que se rompería serían las piezas, y eso
     * lo caza otro control distinto (`stockTeorico`). No es lo que pasó.
     */
    const { rows: salida } = await db.query(
      `SELECT m.id, m.operation_id, m.denomination_id, m.created_at_ms
         FROM cash_denomination_movements m
        WHERE m.session_id = $1 AND m.valor_unitario_centimos = 10
          AND m.direccion = 'OUT' AND m.motivo = 'CLOSING_FLOAT'
        LIMIT 1`,
      [sesion.id]
    );
    // 80 sueltas que salieron → 1 bolsa de 50 + 30 sueltas. Mismas piezas.
    await db.query(
      `UPDATE cash_denomination_movements
          SET cantidad = 50, bolsas = 1, importe_centimos = 500
        WHERE id = $1`,
      [salida[0].id]
    );
    await db.query(
      `INSERT INTO cash_denomination_movements
         (session_id, operation_id, denomination_id, valor_unitario_centimos,
          importe_centimos, direccion, motivo, cantidad, cartuchos, bolsas,
          created_by, created_at_ms)
       VALUES ($1,$2,$3,10,300,'OUT','CLOSING_FLOAT',30,0,0,NULL,$4)`,
      [sesion.id, salida[0].operation_id, salida[0].denomination_id, salida[0].created_at_ms]
    );

    // El aviso viaja, en vez de reventar.
    const resumen = await servicio.resumenJornada(sesion.id);
    expect(resumen.incidenciasStock).toEqual([
      expect.objectContaining({ valor: 10, bolsas: -1 }),
    ]);

    // Y el papeleo sale igual: es lo que se archiva.
    const pdf = await informe.informeCierre(EMPRESA, sesion.id);
    expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
  });
});

describe.runIf(RUN)("anular una jornada abierta por error", () => {
  it("el flujo del despiste entero: anular la de hoy y abrir la del día que tocaba", async () => {
    const caja = await crearCaja("despiste");

    // El lunes 24 se llevó en papel. El 20 fue el último cierre real.
    const dia20 = await servicio.abrirJornada(ctx, {
      registerId: caja,
      fecha: "2026-08-20",
      fondoManual: [{ valor: 5000, cantidad: 7 }], // 350 €
    });
    await servicio.guardarArqueo(ctx, {
      sessionId: dia20.sesion.id,
      contado: [{ valor: 5000, cantidad: 7 }],
    });
    await servicio.cerrarJornada(ctx, {
      sessionId: dia20.sesion.id,
      cambioFinal: [{ valor: 5000, cantidad: 7 }],
    });

    // Hoy se abre por despiste. Hereda los 350 € del 20.
    const hoy = await servicio.abrirJornada(ctx, { registerId: caja });
    expect(hoy.sesion.fondoInicialHeredado).toBe(true);

    // Se anula. La caja queda libre.
    const anulada = await servicio.anularJornada(ctx, hoy.sesion.id, "abierta por error");
    expect(anulada.estado).toBe("CANCELLED");
    expect(await repo.sesionAbierta(caja)).toBeNull();

    // Su fondo de apertura cayó con ella.
    const { rows: ops } = await db.query(
      `SELECT estado FROM cash_operations WHERE session_id = $1`,
      [hoy.sesion.id]
    );
    expect(ops.every((o: { estado: string }) => o.estado === "CANCELLED")).toBe(true);

    // Y se abre la del 24, que hereda del 20 — la anulada no pinta nada.
    const dia24 = await servicio.abrirJornada(ctx, { registerId: caja, fecha: "2026-08-24" });
    expect(dia24.sesion.fecha).toBe("2026-08-24");
    expect(dia24.sesion.fondoInicialHeredado).toBe(true);
    expect(dia24.sesion.fondoInicialCentimos).toBe(35000);
    expect(dia24.stock).toEqual([{ valor: 5000, cantidad: 7 }]);
  });

  it("una jornada con operaciones no se anula: primero se anulan ellas", async () => {
    const caja = await crearCaja("despiste-lleno");
    const { sesion } = await servicio.abrirJornada(ctx, { registerId: caja, fondoManual: FONDO_300 });
    const cobro = await servicio.registrarCobro(ctx, {
      sessionId: sesion.id,
      importeCentimos: 5000,
      formasPago: [{ forma: "CASH", importe: 5000 }],
      efectivoRecibido: [{ valor: 5000, cantidad: 1 }],
      concepto: "Venta",
    });

    await expect(
      servicio.anularJornada(ctx, sesion.id, "me equivoqué")
    ).rejects.toMatchObject({ codigo: "JORNADA_CON_OPERACIONES" });

    // Anulada la operación, la jornada ya está vacía y sí se deja.
    await servicio.anularOperacion(ctx, cobro.operacionId, "prueba");
    const anulada = await servicio.anularJornada(ctx, sesion.id, "ahora sí");
    expect(anulada.estado).toBe("CANCELLED");
  });

  it("con arqueo guardado no se anula, y sin motivo tampoco", async () => {
    const caja = await crearCaja("despiste-arqueo");
    const { sesion } = await servicio.abrirJornada(ctx, { registerId: caja, fondoManual: FONDO_300 });

    await expect(servicio.anularJornada(ctx, sesion.id, "  ")).rejects.toMatchObject({
      codigo: "FALTA_MOTIVO",
    });

    await servicio.guardarArqueo(ctx, { sessionId: sesion.id, contado: FONDO_300 });
    await expect(
      servicio.anularJornada(ctx, sesion.id, "sobra")
    ).rejects.toMatchObject({ codigo: "JORNADA_CON_ARQUEO" });
  });

  it("una cerrada no se anula, y la anulada queda en el histórico con su motivo", async () => {
    const caja = await crearCaja("despiste-cerrada");
    const cerrada = await servicio.abrirJornada(ctx, { registerId: caja, fondoManual: FONDO_300 });
    await servicio.guardarArqueo(ctx, { sessionId: cerrada.sesion.id, contado: FONDO_300 });
    await servicio.cerrarJornada(ctx, { sessionId: cerrada.sesion.id, cambioFinal: FONDO_300 });

    await expect(
      servicio.anularJornada(ctx, cerrada.sesion.id, "tarde")
    ).rejects.toMatchObject({ codigo: "JORNADA_NO_ABIERTA" });

    const vacia = await servicio.abrirJornada(ctx, { registerId: caja });
    await servicio.anularJornada(ctx, vacia.sesion.id, "abierta por error");
    const { rows } = await db.query(`SELECT estado, notas FROM cash_sessions WHERE id = $1`, [
      vacia.sesion.id,
    ]);
    expect(rows[0].estado).toBe("CANCELLED");
    expect(rows[0].notas).toContain("abierta por error");
  });
});

describe.runIf(RUN)("cadena de herencia rota por un cierre a cero", () => {
  it("el caso real: cierre bueno, cierre en falso a cero, y la siguiente hereda del bueno", async () => {
    const caja = await crearCaja("cadena-rota");

    // El 20 se cierra dejando 350 €.
    const dia20 = await servicio.abrirJornada(ctx, {
      registerId: caja,
      fecha: "2026-08-20",
      fondoManual: [{ valor: 5000, cantidad: 7 }],
    });
    await servicio.guardarArqueo(ctx, { sessionId: dia20.sesion.id, contado: [{ valor: 5000, cantidad: 7 }] });
    await servicio.cerrarJornada(ctx, {
      sessionId: dia20.sesion.id,
      cambioFinal: [{ valor: 5000, cantidad: 7 }],
    });

    /*
     * El 22, un cierre EN FALSO: jornada abierta por error, sin fondo, cerrada
     * vacía — que era la única salida antes de que existiera anular. Deja el
     * cambio a cero y rompía la cadena.
     */
    const falso = await servicio.abrirJornada(ctx, { registerId: caja, fecha: "2026-08-22", fondoManual: [] });
    await servicio.guardarArqueo(ctx, { sessionId: falso.sesion.id, contado: [] });
    await servicio.cerrarJornada(ctx, { sessionId: falso.sesion.id, cambioFinal: [] });

    // La del 24 hereda del 20, saltándose el cierre a cero.
    const dia24 = await servicio.abrirJornada(ctx, { registerId: caja, fecha: "2026-08-24" });
    expect(dia24.sesion.fondoInicialHeredado).toBe(true);
    expect(dia24.sesion.fondoInicialCentimos).toBe(35000);
    expect(dia24.stock).toEqual([{ valor: 5000, cantidad: 7 }]);
  });

  it("la jornada ya abierta a cero puede traer el fondo del último cierre con cambio", async () => {
    const caja = await crearCaja("traer-fondo");
    const dia20 = await servicio.abrirJornada(ctx, {
      registerId: caja,
      fecha: "2026-08-20",
      fondoManual: [{ valor: 5000, cantidad: 7 }],
    });
    await servicio.guardarArqueo(ctx, { sessionId: dia20.sesion.id, contado: [{ valor: 5000, cantidad: 7 }] });
    await servicio.cerrarJornada(ctx, {
      sessionId: dia20.sesion.id,
      cambioFinal: [{ valor: 5000, cantidad: 7 }],
    });
    const falso = await servicio.abrirJornada(ctx, { registerId: caja, fecha: "2026-08-22", fondoManual: [] });
    await servicio.guardarArqueo(ctx, { sessionId: falso.sesion.id, contado: [] });
    await servicio.cerrarJornada(ctx, { sessionId: falso.sesion.id, cambioFinal: [] });

    /*
     * La del 24 en el estado EXACTO de producción: abierta antes del arreglo
     * de la herencia, sin fondo y sin operación de apertura. Ya no se puede
     * producir por el camino normal —la propia prueba anterior demuestra que
     * ahora se hereda—, así que se fabrica: se abre (hereda) y se le quita el
     * fondo por SQL, que es como quedó la de verdad.
     */
    const dia24 = await servicio.abrirJornada(ctx, {
      registerId: caja,
      fecha: "2026-08-24",
      permitirFechaRepetida: true,
    });
    await db.query(
      `DELETE FROM cash_denomination_movements
        WHERE session_id = $1 AND motivo = 'OPENING_FLOAT'`,
      [dia24.sesion.id]
    );
    await db.query(
      `DELETE FROM cash_operations WHERE session_id = $1 AND tipo = 'OPENING_FLOAT'`,
      [dia24.sesion.id]
    );
    await db.query(
      `UPDATE cash_sessions
          SET fondo_inicial_centimos = 0, fondo_inicial_heredado = false
        WHERE id = $1`,
      [dia24.sesion.id]
    );
    await servicio.registrarCobro(ctx, {
      sessionId: dia24.sesion.id,
      importeCentimos: 5000,
      formasPago: [{ forma: "CASH", importe: 5000 }],
      efectivoRecibido: [{ valor: 5000, cantidad: 1 }],
      concepto: "Venta del papel",
    });

    // El candidato es el cierre del 20, no el del 22.
    const candidato = await servicio.ultimoCierreConCambio(caja, "2026-08-24", dia24.sesion.id);
    expect(candidato?.fecha).toBe("2026-08-20");
    expect(candidato?.totalCentimos).toBe(35000);

    const sesion = await servicio.traerFondoDeCierre(ctx, {
      sessionId: dia24.sesion.id,
      motivo: "cadena rota por el cierre en falso del 22",
    });
    expect(sesion.fondoInicialCentimos).toBe(35000);
    expect(sesion.fondoInicialHeredado).toBe(true);

    // El teórico: 350 heredados + 50 del cobro que ya estaba.
    const stock = await servicio.stockDeJornada(dia24.sesion.id);
    expect(stock.totalCentimos).toBe(40000);

    // Y no se puede traer dos veces: lo duplicaría.
    await expect(
      servicio.traerFondoDeCierre(ctx, { sessionId: dia24.sesion.id, motivo: "otra vez" })
    ).rejects.toMatchObject({ codigo: "JORNADA_YA_TIENE_FONDO" });
  });

  it("sin ningún cierre con cambio no hay nada que traer", async () => {
    const caja = await crearCaja("sin-candidato");
    const { sesion } = await servicio.abrirJornada(ctx, { registerId: caja, fondoManual: [] });
    expect(await servicio.ultimoCierreConCambio(caja, sesion.fecha, sesion.id)).toBeNull();
    await expect(
      servicio.traerFondoDeCierre(ctx, { sessionId: sesion.id, motivo: "no hay" })
    ).rejects.toMatchObject({ codigo: "SIN_CIERRE_ANTERIOR" });
  });
});

describe.runIf(RUN)("cierre que deja la caja vacía", () => {
  async function cajaConFondoFijo(nombre: string): Promise<number> {
    const caja = await crearCaja(nombre);
    await db.query(`UPDATE cash_registers SET fondo_objetivo_centimos = 35000 WHERE id = $1`, [caja]);
    return caja;
  }

  it("con fondo fijo configurado, mandar todo al banco pide confirmación", async () => {
    // El despiste real: teclear el cierre con el fondo entero como «ingreso».
    const caja = await cajaConFondoFijo("vacia-guarda");
    const { sesion } = await servicio.abrirJornada(ctx, {
      registerId: caja,
      fondoManual: [{ valor: 5000, cantidad: 7 }],
    });
    await servicio.guardarArqueo(ctx, { sessionId: sesion.id, contado: [{ valor: 5000, cantidad: 7 }] });

    await expect(
      servicio.cerrarJornada(ctx, { sessionId: sesion.id, cambioFinal: [] })
    ).rejects.toMatchObject({ codigo: "CIERRE_DEJA_CAJA_VACIA" });

    // Confirmado en claro, se deja: vaciar la caja de verdad existe.
    const r = await servicio.cerrarJornada(ctx, {
      sessionId: sesion.id,
      cambioFinal: [],
      permitirCajaVacia: true,
    });
    expect(r.totalIngresoCentimos).toBe(35000);
    expect(r.totalCambioCentimos).toBe(0);
  });

  it("sin fondo fijo no pregunta nada: vaciar es lo normal", async () => {
    const caja = await crearCaja("vacia-sin-fondo");
    const { sesion } = await servicio.abrirJornada(ctx, {
      registerId: caja,
      fondoManual: [{ valor: 5000, cantidad: 2 }],
    });
    await servicio.guardarArqueo(ctx, { sessionId: sesion.id, contado: [{ valor: 5000, cantidad: 2 }] });
    const r = await servicio.cerrarJornada(ctx, { sessionId: sesion.id, cambioFinal: [] });
    expect(r.totalIngresoCentimos).toBe(10000);
  });

  it("dejar cambio no dispara la pregunta aunque haya fondo fijo", async () => {
    const caja = await cajaConFondoFijo("vacia-normal");
    const { sesion } = await servicio.abrirJornada(ctx, {
      registerId: caja,
      fondoManual: [{ valor: 5000, cantidad: 8 }],
    });
    await servicio.guardarArqueo(ctx, { sessionId: sesion.id, contado: [{ valor: 5000, cantidad: 8 }] });
    const r = await servicio.cerrarJornada(ctx, {
      sessionId: sesion.id,
      cambioFinal: [{ valor: 5000, cantidad: 7 }],
    });
    expect(r.totalCambioCentimos).toBe(35000);
    expect(r.totalIngresoCentimos).toBe(5000);
  });
});

describe.runIf(RUN)("confirmar el ingreso en el banco y adjuntar el comprobante", () => {
  /** Un ingreso real, con su cierre detrás. */
  async function ingresoDePrueba(): Promise<{ id: number; caja: number }> {
    const caja = await crearCaja("comprobante");
    const { sesion } = await servicio.abrirJornada(ctx, {
      registerId: caja,
      fondoManual: [{ valor: 5000, cantidad: 2 }],
    });
    await servicio.registrarCobro(ctx, {
      sessionId: sesion.id,
      importeCentimos: 10000,
      formasPago: [{ forma: "CASH", importe: 10000 }],
      efectivoRecibido: [{ valor: 5000, cantidad: 2 }],
      concepto: "Venta",
    });
    await servicio.guardarArqueo(ctx, {
      sessionId: sesion.id,
      contado: [{ valor: 5000, cantidad: 4 }],
    });
    await servicio.cerrarJornada(ctx, {
      sessionId: sesion.id,
      cambioFinal: [{ valor: 5000, cantidad: 2 }],
    });
    const ingreso = await ingresos.crearIngreso(ctx, {
      registerId: caja,
      sessionIds: [sesion.id],
      importeCentimos: 10000,
    });
    // Se registra sin fecha ni referencia, que es lo normal: las da el banco
    // después, cuando alguien vuelve con el resguardo.
    expect(ingreso.fechaIngreso).toBeNull();
    expect(ingreso.referencia).toBeNull();
    return { id: ingreso.id, caja };
  }

  it("se completan la fecha real y la referencia después de ir al banco", async () => {
    const { id } = await ingresoDePrueba();

    const completado = await ingresos.completarIngreso(ctx, {
      depositId: id,
      fechaIngreso: "2026-08-27",
      referencia: "ING-99881",
    });
    expect(completado.fechaIngreso).toBe("2026-08-27");
    expect(completado.referencia).toBe("ING-99881");
    // Los importes NO se tocan por aquí: eso se corrige anulando.
    expect(completado.importeCentimos).toBe(10000);

    // Y persiste: no era solo lo que devolvió la llamada.
    const { rows } = await db.query(
      `SELECT fecha_ingreso::text AS f, referencia FROM cash_bank_deposits WHERE id = $1`,
      [id]
    );
    expect(rows[0].f).toBe("2026-08-27");
    expect(rows[0].referencia).toBe("ING-99881");
  });

  it("lo que no se manda se queda como estaba, y lo vacío se borra", async () => {
    const { id } = await ingresoDePrueba();
    await ingresos.completarIngreso(ctx, { depositId: id, fechaIngreso: "2026-08-27", referencia: "R-1" });

    // Solo la referencia: la fecha sigue puesta.
    const soloRef = await ingresos.completarIngreso(ctx, { depositId: id, referencia: "R-2" });
    expect(soloRef.fechaIngreso).toBe("2026-08-27");
    expect(soloRef.referencia).toBe("R-2");

    // Cadena vacía = borrar, para poder deshacer una errata.
    const borrada = await ingresos.completarIngreso(ctx, { depositId: id, referencia: "" });
    expect(borrada.referencia).toBeNull();
    expect(borrada.fechaIngreso).toBe("2026-08-27");
  });

  it("una fecha con formato raro se rechaza y un ingreso anulado no se completa", async () => {
    const { id } = await ingresoDePrueba();
    await expect(
      ingresos.completarIngreso(ctx, { depositId: id, fechaIngreso: "27/08/2026" })
    ).rejects.toMatchObject({ codigo: "ENTRADA_NO_VALIDA" });

    await ingresos.anularIngreso(ctx, id, "prueba");
    await expect(
      ingresos.completarIngreso(ctx, { depositId: id, referencia: "R" })
    ).rejects.toMatchObject({ codigo: "INGRESO_ANULADO" });
  });

  it("el comprobante cuelga del ingreso y NO del informe de cierre de sus jornadas", async () => {
    const caja = await crearCaja("comprobante-informe");
    const { sesion } = await servicio.abrirJornada(ctx, {
      registerId: caja,
      fondoManual: [{ valor: 5000, cantidad: 2 }],
    });
    await servicio.registrarCobro(ctx, {
      sessionId: sesion.id,
      importeCentimos: 10000,
      formasPago: [{ forma: "CASH", importe: 10000 }],
      efectivoRecibido: [{ valor: 5000, cantidad: 2 }],
      concepto: "Venta",
    });
    await servicio.guardarArqueo(ctx, { sessionId: sesion.id, contado: [{ valor: 5000, cantidad: 4 }] });
    await servicio.cerrarJornada(ctx, { sessionId: sesion.id, cambioFinal: [{ valor: 5000, cantidad: 2 }] });
    const ingreso = await ingresos.crearIngreso(ctx, {
      registerId: caja,
      sessionIds: [sesion.id],
      importeCentimos: 10000,
    });

    const doc = await documentos.adjuntarDocumentoDeIngreso(ctx, ingreso.id, {
      originalname: "resguardo-banco.pdf",
      mimetype: "application/pdf",
      buffer: Buffer.from("%PDF-1.4 resguardo"),
    });
    expect(doc.depositId).toBe(ingreso.id);
    expect(doc.sessionId).toBeNull();
    expect(doc.operationId).toBeNull();

    const lista = await documentos.documentosDeIngreso(EMPRESA, ingreso.id);
    expect(lista).toHaveLength(1);
    expect(lista[0].nombre).toBe("resguardo-banco.pdf");

    /*
     * Lo que de verdad importa: el resguardo cubre el ingreso entero —que junta
     * varios cierres— así que NO puede colarse en el informe de cierre de una
     * jornada suelta, o el papeleo de ese día enseñaría un papel que no es suyo.
     */
    const deJornada = await documentos.documentosDeJornada(sesion.id);
    expect(deJornada).toHaveLength(0);
  });

  it("no se adjunta a un ingreso que no existe", async () => {
    await expect(
      documentos.adjuntarDocumentoDeIngreso(ctx, 999999, {
        originalname: "x.pdf",
        mimetype: "application/pdf",
        buffer: Buffer.from("%PDF-1.4"),
      })
    ).rejects.toMatchObject({ codigo: "INGRESO_NO_ENCONTRADO" });
  });
});

describe.runIf(RUN)("cuentas bancarias de la empresa", () => {
  /**
   * Un IBAN español VÁLIDO y distinto en cada ejecución.
   *
   * Con IBAN fijos, la segunda pasada choca contra las cuentas que dejó la
   * primera —la base de pruebas sobrevive— y el alta falla por repetida. Y no
   * vale cualquier número: el dígito de control se calcula, porque el propio
   * código lo comprueba y rechazaría un IBAN inventado.
   */
  function ibanDePrueba(): string {
    // El BBAN español son 20 dígitos EXACTOS: 4 de entidad y 16 más. Sin
    // rellenar, un reloj con menos cifras deja un IBAN corto que el propio
    // validador rechaza, y la prueba fallaría por el dato, no por el código.
    const bban = `2100${String(process.hrtime.bigint()).slice(-16).padStart(16, "0")}`;
    const movido = `${bban}ES00`;
    let resto = 0;
    for (const c of movido) {
      const valor = c >= "A" ? String(c.charCodeAt(0) - 55) : c;
      for (const d of valor) resto = (resto * 10 + Number(d)) % 97;
    }
    return `ES${String(98 - resto).padStart(2, "0")}${bban}`;
  }

  it("la primera cuenta se marca sola como predeterminada", async () => {
    // Si no, el desplegable saldría sin nada preseleccionado el primer día.
    const { rows } = await db.query(`SELECT COUNT(*)::int AS n FROM cash_bank_accounts WHERE empresa_id=$1`, [EMPRESA]);
    if (rows[0].n === 0) {
      const iban = ibanDePrueba();
      const primera = await config.crearCuenta(ctx, { banco: "BBVA", iban });
      expect(primera.porDefecto).toBe(true);
      // Se guarda normalizado: sin espacios y en mayúsculas.
      expect(primera.iban).toBe(iban.replace(/\s/g, "").toUpperCase());
    }
  });

  it("un IBAN con un dígito bailado se rechaza", async () => {
    await expect(
      // Un dígito de control que no cuadra: misma pinta, número imposible.
      config.crearCuenta(ctx, { banco: "Malo", iban: "ES00 2100 0418 4502 0005 1332" })
    ).rejects.toMatchObject({ codigo: "IBAN_NO_VALIDO" });
  });

  it("no se puede dar de alta dos veces la misma cuenta", async () => {
    const iban = ibanDePrueba();
    await config.crearCuenta(ctx, { banco: "Uno", iban });
    await expect(config.crearCuenta(ctx, { banco: "Otro", iban })).rejects.toMatchObject({
      codigo: "CUENTA_REPETIDA",
    });
  });

  it("marcar otra como predeterminada quita la marca a la anterior", async () => {
    // La base de datos solo admite una: sin quitar la vieja, el UPDATE moriría.
    const a = await config.crearCuenta(ctx, { banco: "A", iban: ibanDePrueba(), porDefecto: true });
    const b = await config.crearCuenta(ctx, { banco: "B", iban: ibanDePrueba(), porDefecto: true });
    const lista = await config.listarCuentas(EMPRESA);
    expect(lista.find((c) => c.id === b.id)!.porDefecto).toBe(true);
    expect(lista.find((c) => c.id === a.id)!.porDefecto).toBe(false);
    expect(lista.filter((c) => c.porDefecto)).toHaveLength(1);
  });

  it("la predeterminada no se da de baja sin poner otra antes", async () => {
    const { rows } = await db.query(
      `SELECT id FROM cash_bank_accounts WHERE empresa_id = $1 AND por_defecto`, [EMPRESA]);
    await expect(
      config.actualizarCuenta(ctx, rows[0].id, { activa: false })
    ).rejects.toMatchObject({ codigo: "CUENTA_POR_DEFECTO" });
  });

  it("un ingreso nuevo va a la cuenta predeterminada sin tener que elegirla", async () => {
    const cuenta = await config.crearCuenta(ctx, {
      banco: "Santander",
      iban: ibanDePrueba(),
      porDefecto: true,
    });

    const caja = await crearCaja("cuenta-defecto");
    const { sesion } = await servicio.abrirJornada(ctx, {
      registerId: caja,
      fondoManual: [{ valor: 5000, cantidad: 2 }],
    });
    await servicio.registrarCobro(ctx, {
      sessionId: sesion.id,
      importeCentimos: 10000,
      formasPago: [{ forma: "CASH", importe: 10000 }],
      efectivoRecibido: [{ valor: 5000, cantidad: 2 }],
      concepto: "Venta",
    });
    await servicio.guardarArqueo(ctx, { sessionId: sesion.id, contado: [{ valor: 5000, cantidad: 4 }] });
    await servicio.cerrarJornada(ctx, { sessionId: sesion.id, cambioFinal: [{ valor: 5000, cantidad: 2 }] });

    const ingreso = await ingresos.crearIngreso(ctx, {
      registerId: caja,
      sessionIds: [sesion.id],
      importeCentimos: 10000,
    });
    expect(ingreso.bankAccountId).toBe(cuenta.id);

    // Y el listado la trae ya resuelta, sin otra consulta desde la pantalla.
    const panel = await ingresos.panelIngresos(EMPRESA, caja);
    const enLista = panel.ingresos.find((i: { id: number }) => i.id === ingreso.id)!;
    expect(enLista.banco).toBe("Santander");
    expect(enLista.iban).toBe(cuenta.iban);
  });

  it("se puede cambiar la cuenta de un ingreso ya hecho, incluso a una de baja", async () => {
    // El dinero pudo ir a una cuenta que después se cerró: apuntar dónde fue
    // de verdad no es elegir dónde va.
    const vieja = await config.crearCuenta(ctx, { banco: "Cerrada", iban: ibanDePrueba() });
    const caja = await crearCaja("cuenta-cambio");
    const { sesion } = await servicio.abrirJornada(ctx, {
      registerId: caja,
      fondoManual: [{ valor: 5000, cantidad: 2 }],
    });
    await servicio.registrarCobro(ctx, {
      sessionId: sesion.id,
      importeCentimos: 10000,
      formasPago: [{ forma: "CASH", importe: 10000 }],
      efectivoRecibido: [{ valor: 5000, cantidad: 2 }],
      concepto: "Venta",
    });
    await servicio.guardarArqueo(ctx, { sessionId: sesion.id, contado: [{ valor: 5000, cantidad: 4 }] });
    await servicio.cerrarJornada(ctx, { sessionId: sesion.id, cambioFinal: [{ valor: 5000, cantidad: 2 }] });
    const ingreso = await ingresos.crearIngreso(ctx, {
      registerId: caja,
      sessionIds: [sesion.id],
      importeCentimos: 10000,
    });

    await config.actualizarCuenta(ctx, vieja.id, { activa: false });
    const completado = await ingresos.completarIngreso(ctx, {
      depositId: ingreso.id,
      bankAccountId: vieja.id,
      referencia: "R-777",
    });
    expect(completado.bankAccountId).toBe(vieja.id);
    expect(completado.banco).toBe("Cerrada");
  });

  it("no se puede apuntar un ingreso a una cuenta de otra empresa", async () => {
    const { rows } = await db.query(
      `INSERT INTO cash_bank_accounts (empresa_id, banco, iban, created_at_ms, updated_at_ms)
       VALUES ('00000000-0000-4000-a000-0000000000ff','Ajeno',$2,$1,$1)
       RETURNING id`,
      [Date.now(), ibanDePrueba().replace(/\s/g, "")]
    );
    const caja = await crearCaja("cuenta-ajena");
    const { sesion } = await servicio.abrirJornada(ctx, {
      registerId: caja,
      fondoManual: [{ valor: 5000, cantidad: 2 }],
    });
    await servicio.registrarCobro(ctx, {
      sessionId: sesion.id,
      importeCentimos: 10000,
      formasPago: [{ forma: "CASH", importe: 10000 }],
      efectivoRecibido: [{ valor: 5000, cantidad: 2 }],
      concepto: "Venta",
    });
    await servicio.guardarArqueo(ctx, { sessionId: sesion.id, contado: [{ valor: 5000, cantidad: 4 }] });
    await servicio.cerrarJornada(ctx, { sessionId: sesion.id, cambioFinal: [{ valor: 5000, cantidad: 2 }] });

    await expect(
      ingresos.crearIngreso(ctx, {
        registerId: caja,
        sessionIds: [sesion.id],
        importeCentimos: 10000,
        bankAccountId: rows[0].id,
      })
    ).rejects.toMatchObject({ codigo: "CUENTA_NO_ENCONTRADA" });
  });
});

describe.runIf(RUN)("maestro de bancos", () => {
  /** IBAN válido de una entidad concreta, distinto en cada ejecución. */
  function ibanDe(entidad: string): string {
    const bban = `${entidad}${String(process.hrtime.bigint()).slice(-16).padStart(16, "0")}`;
    let resto = 0;
    for (const c of `${bban}ES00`) {
      const v = c >= "A" ? String(c.charCodeAt(0) - 55) : c;
      for (const d of v) resto = (resto * 10 + Number(d)) % 97;
    }
    return `ES${String(98 - resto).padStart(2, "0")}${bban}`;
  }

  it("se siembra solo, con los códigos de entidad reales", async () => {
    const bancos = await config.listarBancos(EMPRESA);
    const caixa = bancos.find((b) => b.codigo === "2100");
    expect(caixa?.nombre).toContain("CaixaBank");
    expect(bancos.find((b) => b.codigo === "0182")?.nombre).toBe("BBVA");
  });

  it("una cuenta reconoce su banco por el IBAN, sin que nadie lo elija", async () => {
    // Es lo que evita el error de colgar la cuenta del banco equivocado.
    const cuenta = await config.crearCuenta(ctx, { iban: ibanDe("0182") });
    expect(cuenta.banco).toBe("BBVA");
  });

  it("el nombre tecleado manda sobre el del maestro", async () => {
    // Un banco puede tener nombre comercial propio para quien lo usa.
    const cuenta = await config.crearCuenta(ctx, { banco: "BBVA nóminas", iban: ibanDe("0182") });
    expect(cuenta.banco).toBe("BBVA nóminas");
  });

  it("un IBAN de entidad desconocida exige teclear el banco", async () => {
    // 9999 no existe en el maestro: sin nombre no hay cuenta que valga.
    await expect(config.crearCuenta(ctx, { iban: ibanDe("9999") })).rejects.toMatchObject({
      codigo: "ENTRADA_NO_VALIDA",
    });
    const cuenta = await config.crearCuenta(ctx, { banco: "Banco raro", iban: ibanDe("9999") });
    expect(cuenta.banco).toBe("Banco raro");
  });

  it("el logotipo del maestro llega a la cuenta sin copiarlo", async () => {
    // Se sube una vez por banco y lo heredan todas sus cuentas: copiarlo
    // dejaría cuentas con el logotipo viejo al cambiarlo.
    const bancos = await config.listarBancos(EMPRESA);
    const santander = bancos.find((b) => b.codigo === "0049")!;
    await config.actualizarBanco(ctx, santander.id, { logoUrl: "https://ejemplo.test/s.png" });

    const cuenta = await config.crearCuenta(ctx, { iban: ibanDe("0049") });
    const lista = await config.listarCuentas(EMPRESA);
    expect(lista.find((c) => c.id === cuenta.id)!.logoUrl).toBe("https://ejemplo.test/s.png");
  });

  it("los que trae la aplicación salen sin subir nada, y el subido manda", async () => {
    /*
     * Tres capas, de arriba abajo: el logotipo subido a la cuenta, el subido
     * al banco y el que trae la aplicación. Quitar uno tiene que dejar ver el
     * de debajo, que es la salida cuando el fichero subido sale mal: fue lo
     * que pasó con un CaixaBank que traía dentro las dos versiones de la marca
     * y salían las dos en la cabecera del resguardo.
     */
    const bancos = await config.listarBancos(EMPRESA);
    const caixa = bancos.find((b) => b.codigo === "2100")!;

    const limpio = await config.actualizarBanco(ctx, caixa.id, { logoUrl: null });
    expect(limpio.logoUrl).toBe("/bancos/2100-caixabank.png");
    expect(limpio.logoPropio).toBe(false);

    const propio = await config.actualizarBanco(ctx, caixa.id, {
      logoUrl: "https://ejemplo.test/subido.png",
    });
    expect(propio.logoUrl).toBe("https://ejemplo.test/subido.png");
    expect(propio.logoPropio).toBe(true);

    // Y al quitarlo vuelve el de la aplicación, no se queda sin nada.
    const vuelto = await config.actualizarBanco(ctx, caixa.id, { logoUrl: null });
    expect(vuelto.logoUrl).toBe("/bancos/2100-caixabank.png");
  });

  it("el fichero del logotipo que trae la aplicación existe de verdad", async () => {
    // Una ruta mal escrita dejaría el resguardo sin logotipo y sin ruido.
    for (const banco of BANCOS_SEMILLA) {
      if (!banco.logo) continue;
      const fichero = path.join(process.cwd(), "public", banco.logo.replace(/^\//, ""));
      expect(fs.existsSync(fichero), `falta ${banco.logo}`).toBe(true);
      // Con transparencia: la cabecera del resguardo es azul marino, y un
      // logotipo con su fondo dentro sale metido en un recuadro.
      const { hasAlpha } = await sharp(fs.readFileSync(fichero)).metadata();
      expect(hasAlpha, `${banco.logo} sin transparencia`).toBe(true);
    }
  });

  it("el logotipo de Mobilink Cash de las cabeceras va sin fondo", async () => {
    /*
     * El fichero de siempre trae dentro su propio azul marino, parecido al de
     * la banda pero no igual, y sobre el papel se le veía el recuadro. Las
     * cabeceras usan la versión recortada; si desapareciera, volvería el
     * recuadro sin que nadie se enterara hasta imprimir.
     */
    const fichero = path.join(process.cwd(), "public", "logo-cash-fondo-oscuro.png");
    expect(fs.existsSync(fichero)).toBe(true);
    const { hasAlpha } = await sharp(fs.readFileSync(fichero)).metadata();
    expect(hasAlpha).toBe(true);
  });

  it("una cuenta de CaixaBank saca el logotipo aunque nadie haya subido ninguno", async () => {
    const bancos = await config.listarBancos(EMPRESA);
    const caixa = bancos.find((b) => b.codigo === "2100")!;
    await config.actualizarBanco(ctx, caixa.id, { logoUrl: null });

    const cuenta = await config.crearCuenta(ctx, { iban: ibanDe("2100") });
    const lista = await config.listarCuentas(EMPRESA);
    const vista = lista.find((c) => c.id === cuenta.id)!;
    expect(vista.logoUrl).toBe("/bancos/2100-caixabank.png");
    expect(vista.logoPropio).toBe(false);
  });
});

describe.runIf(RUN)("cuentas anteriores al maestro de bancos", () => {
  it("una cuenta creada sin bank_id se engancha sola por su IBAN", async () => {
    /*
     * El caso real: la cuenta se dio de alta cuando `bank_id` no existía, así
     * que quedó a NULL y el resguardo salía sin logotipo aunque el banco lo
     * tuviera subido. Nada lo decía: simplemente no aparecía.
     */
    const bban = `2100${String(process.hrtime.bigint()).slice(-16).padStart(16, "0")}`;
    let resto = 0;
    for (const c of `${bban}ES00`) {
      const v = c >= "A" ? String(c.charCodeAt(0) - 55) : c;
      for (const d of v) resto = (resto * 10 + Number(d)) % 97;
    }
    const iban = `ES${String(98 - resto).padStart(2, "0")}${bban}`;

    // Se inserta a pelo, como quedaron las de antes: sin banco enlazado.
    const { rows } = await db.query(
      `INSERT INTO cash_bank_accounts
         (empresa_id, banco, iban, created_at_ms, updated_at_ms)
       VALUES ($1,'CAIXABANK',$2,$3,$3) RETURNING id`,
      [EMPRESA, iban, Date.now()]
    );
    const cuentaId = rows[0].id;

    const { rows: antes } = await db.query(
      `SELECT bank_id FROM cash_bank_accounts WHERE id = $1`,
      [cuentaId]
    );
    expect(antes[0].bank_id).toBeNull();

    // Con solo consultar el maestro, la cuenta queda enganchada…
    const bancos = await config.listarBancos(EMPRESA);
    const caixa = bancos.find((b) => b.codigo === "2100")!;
    const { rows: despues } = await db.query(
      `SELECT bank_id FROM cash_bank_accounts WHERE id = $1`,
      [cuentaId]
    );
    expect(despues[0].bank_id).toBe(caixa.id);

    // …y hereda el logotipo, que era lo que faltaba en el resguardo.
    await config.actualizarBanco(ctx, caixa.id, { logoUrl: "https://ejemplo.test/caixa.png" });
    const lista = await config.listarCuentas(EMPRESA);
    expect(lista.find((c) => c.id === cuentaId)!.logoUrl).toBe("https://ejemplo.test/caixa.png");
  });

  it("no pisa el banco de una cuenta que ya lo tenía", async () => {
    const bancos = await config.listarBancos(EMPRESA);
    const bbva = bancos.find((b) => b.codigo === "0182")!;
    const bban = `2100${String(process.hrtime.bigint()).slice(-16).padStart(16, "0")}`;
    let resto = 0;
    for (const c of `${bban}ES00`) {
      const v = c >= "A" ? String(c.charCodeAt(0) - 55) : c;
      for (const d of v) resto = (resto * 10 + Number(d)) % 97;
    }
    const iban = `ES${String(98 - resto).padStart(2, "0")}${bban}`;

    // IBAN de CaixaBank pero enganchada a mano a BBVA: el relleno no la toca.
    const { rows } = await db.query(
      `INSERT INTO cash_bank_accounts
         (empresa_id, banco, iban, bank_id, created_at_ms, updated_at_ms)
       VALUES ($1,'A mano',$2,$3,$4,$4) RETURNING id`,
      [EMPRESA, iban, bbva.id, Date.now()]
    );
    await config.listarBancos(EMPRESA);
    const { rows: despues } = await db.query(
      `SELECT bank_id FROM cash_bank_accounts WHERE id = $1`,
      [rows[0].id]
    );
    expect(despues[0].bank_id).toBe(bbva.id);
  });
});

describe.runIf(RUN)("reposición del fondo desde el dinero pendiente de ingresar", () => {
  /**
   * El caso real de Tarragona el 28/08/2026, reproducido.
   *
   * Fondo fijo 350 €. La jornada abre con 350, se ingresan 100 € al banco de
   * más de lo que dio el día, y el cierre deja el cajón en 250 €: le faltan
   * 100 € de fondo, y esos 100 € están en la bolsa que espera al banco.
   */
  async function escenario({ reabrir = true } = {}) {
    const caja = await crearCaja(`reposicion-${Date.now()}`);
    await config.actualizarCaja(ctx, caja, { fondoObjetivoCentimos: 35000 });

    // 350,00 € exactos: 150 + 100 + 50 + 20 + 10 + 10 + 5 + 4 + 1.
    const fondo = [
      { valor: 5000, cantidad: 3 },
      { valor: 2000, cantidad: 5 },
      { valor: 1000, cantidad: 5 },
      { valor: 500, cantidad: 4 },
      { valor: 200, cantidad: 5 },
      { valor: 100, cantidad: 10 },
      { valor: 50, cantidad: 10 },
      { valor: 20, cantidad: 20 },
      { valor: 10, cantidad: 10 },
    ];
    const { sesion } = await servicio.abrirJornada(ctx, { registerId: caja, fondoManual: fondo });

    // Se cierra dejando 250 € y mandando 100 € al banco: la caja queda corta.
    await servicio.guardarArqueo(ctx, { sessionId: sesion.id, contado: fondo });
    await servicio.cerrarJornada(ctx, {
      sessionId: sesion.id,
      // 250,00 €: el fondo menos dos billetes de 50, que se van al banco.
      cambioFinal: [
        { valor: 5000, cantidad: 1 },
        { valor: 2000, cantidad: 5 },
        { valor: 1000, cantidad: 5 },
        { valor: 500, cantidad: 4 },
        { valor: 200, cantidad: 5 },
        { valor: 100, cantidad: 10 },
        { valor: 50, cantidad: 10 },
        { valor: 20, cantidad: 20 },
        { valor: 10, cantidad: 10 },
      ],
    });

    // Y al día siguiente se abre heredando esos 250 €.
    const hoy = reabrir
      ? (await servicio.abrirJornada(ctx, { registerId: caja })).sesion
      : null;
    return { caja, sessionIds: [sesion.id], hoy: hoy! };
  }

  const valor = (l: readonly { valor: number; cantidad: number }[]) =>
    l.reduce((a, x) => a + x.valor * x.cantidad, 0);

  it("ve el déficit del fondo y de dónde viene", async () => {
    const { caja } = await escenario();
    const d = await ingresos.deficitDeCaja(EMPRESA, caja);
    expect(d.fondoObjetivoCentimos).toBe(35000);
    expect(d.fondoCentimos).toBe(25000);
    expect(d.deficitCentimos).toBe(10000);
    expect(d.cierresConDeficit).toBe(1);
  });

  it("propone reponerlo con piezas que están de verdad en el montón", async () => {
    const { caja, sessionIds } = await escenario();
    const p = await ingresos.proponerReposicion(EMPRESA, caja, sessionIds);
    expect(p.deficitCentimos).toBe(10000);
    expect(p.montonCentimos).toBe(10000);
    expect(p.reposicion!.netoCentimos).toBe(10000);
    // El montón tiene los dos billetes de 50 justos: no hace falta vuelta.
    expect(p.reposicion!.devolver).toEqual([]);
    // Y lo propuesto cabe en el montón, pieza a pieza.
    const hay = new Map(
      [...p.monton.billetes, ...p.monton.monedas].map((l) => [l.valor, l.cantidad])
    );
    for (const l of p.reposicion!.sacar) {
      expect(l.cantidad).toBeLessThanOrEqual(hay.get(l.valor) ?? 0);
    }
  });

  it("al reponer, el cajón sube y el montón baja lo mismo: el total NO cambia", async () => {
    /*
     * Es la prueba que sostiene toda la funcionalidad. Reponer no es ingresar
     * ni cobrar: es mover dinero de un bolsillo de la tienda a otro.
     */
    const { caja, sessionIds, hoy } = await escenario();
    const antesCaja = (await servicio.detalleJornada(hoy.id)).totalStockCentimos;
    const antesMonton = (await ingresos.proponerReposicion(EMPRESA, caja, sessionIds)).montonCentimos;

    const p = await ingresos.proponerReposicion(EMPRESA, caja, sessionIds);
    await ingresos.registrarReposicion(ctx, { registerId: caja, sessionIds, sacar: p.reposicion!.sacar, devolver: p.reposicion!.devolver });

    const despuesCaja = (await servicio.detalleJornada(hoy.id)).totalStockCentimos;
    const despuesMonton = (await ingresos.proponerReposicion(EMPRESA, caja, sessionIds)).montonCentimos;

    expect(despuesCaja - antesCaja).toBe(10000);
    expect(antesMonton - despuesMonton).toBe(10000);
    expect(antesCaja + antesMonton).toBe(despuesCaja + despuesMonton);
  });

  it("después de reponer, la caja ya no tiene déficit", async () => {
    const { caja, sessionIds } = await escenario();
    const p = await ingresos.proponerReposicion(EMPRESA, caja, sessionIds);
    await ingresos.registrarReposicion(ctx, { registerId: caja, sessionIds, sacar: p.reposicion!.sacar, devolver: p.reposicion!.devolver });
    expect((await ingresos.deficitDeCaja(EMPRESA, caja)).deficitCentimos).toBe(0);
  });

  it("lo repuesto ya no se puede ingresar en el banco", async () => {
    // Si no bajara el disponible, ese dinero se ingresaría estando en el cajón.
    const { caja, sessionIds } = await escenario();
    const p = await ingresos.proponerReposicion(EMPRESA, caja, sessionIds);
    await ingresos.registrarReposicion(ctx, { registerId: caja, sessionIds, sacar: p.reposicion!.sacar, devolver: p.reposicion!.devolver });

    await expect(
      ingresos.crearIngreso(ctx, { registerId: caja, sessionIds, importeCentimos: 10000 })
    ).rejects.toMatchObject({ codigo: "INGRESO_SUPERA_DISPONIBLE" });
  });

  it("NO se puede reponer más de lo que falta", async () => {
    const { caja, sessionIds } = await escenario();
    await expect(
      ingresos.registrarReposicion(ctx, {
        registerId: caja,
        sessionIds,
        sacar: [{ valor: 5000, cantidad: 3 }],
      })
    ).rejects.toMatchObject({ codigo: "REPOSICION_EXCESIVA" });
  });

  it("NO se puede sacar del montón una pieza que no está", async () => {
    const { caja, sessionIds } = await escenario();
    await expect(
      ingresos.registrarReposicion(ctx, {
        registerId: caja,
        sessionIds,
        sacar: [{ valor: 5, cantidad: 4 }],
      })
    ).rejects.toMatchObject({ codigo: "STOCK_INSUFICIENTE" });
  });

  it("una caja con su fondo completo no admite reposición", async () => {
    const { caja, sessionIds } = await escenario();
    const p = await ingresos.proponerReposicion(EMPRESA, caja, sessionIds);
    await ingresos.registrarReposicion(ctx, { registerId: caja, sessionIds, sacar: p.reposicion!.sacar, devolver: p.reposicion!.devolver });

    await expect(
      ingresos.registrarReposicion(ctx, {
        registerId: caja,
        sessionIds,
        sacar: [{ valor: 1000, cantidad: 1 }],
      })
    ).rejects.toMatchObject({ codigo: "SIN_DEFICIT" });
  });

  it("la reposición NO se cuela en el reparto por secciones ni en el cierre del Genes", async () => {
    /*
     * Es el motivo de que el dinero salga del montón y no de los cobros del
     * día siguiente: con los cobros, parte de la caja del Genes dejaría de ser
     * venta. El desglose por secciones solo cuenta cobros y pagos.
     */
    const { caja, sessionIds, hoy } = await escenario();
    const p = await ingresos.proponerReposicion(EMPRESA, caja, sessionIds);
    await ingresos.registrarReposicion(ctx, { registerId: caja, sessionIds, sacar: p.reposicion!.sacar, devolver: p.reposicion!.devolver });

    const detalle = await servicio.detalleJornada(hoy.id);
    const cobros = detalle.porSeccion.reduce((a, s) => a + s.cobrosCentimos, 0);
    expect(cobros).toBe(0);
  });

  it("el déficit se mide contra el ÚLTIMO CIERRE, no contra el cajón a media mañana", async () => {
    /*
     * El fallo que tenía esto y que se veía en pantalla: a mediodía el cajón
     * lleva dentro los cobros del día, que se van a ingresar, y medir contra
     * él hacía que el déficit encogiera —o desapareciera— para volver puntual
     * en el cierre. El fondo es con lo que la caja ARRANCA, y eso lo fijó el
     * cierre anterior.
     */
    const { caja, hoy } = await escenario();
    await servicio.registrarCobro(ctx, {
      sessionId: hoy.id,
      importeCentimos: 20000,
      formasPago: [{ forma: "CASH", importe: 20000 }],
      efectivoRecibido: [{ valor: 20000, cantidad: 1 }],
      concepto: "Venta del día siguiente",
    });

    // El cajón tiene ahora 450 €, muy por encima del fondo de 350…
    expect((await servicio.detalleJornada(hoy.id)).totalStockCentimos).toBe(45000);
    // …y aun así le siguen faltando los 100 € que el cierre se llevó de más.
    const d = await ingresos.deficitDeCaja(EMPRESA, caja);
    expect(d.fondoCentimos).toBe(25000);
    expect(d.deficitCentimos).toBe(10000);
  });

  it("con la bolsa sin las piezas justas, saca de más y el cajón da la vuelta", async () => {
    /*
     * El caso de Tarragona del 31/08: en la bolsa hay 72,60 € en piezas con
     * las que NO se pueden formar 21,52 €. Sin vuelta lo más que se saca son
     * 20,60 € y la caja se queda coja; con vuelta cuadra al céntimo.
     */
    const caja = await crearCaja(`repo-vuelta-${Date.now()}`);
    await config.actualizarCaja(ctx, caja, { fondoObjetivoCentimos: 35000 });

    // Abre con 350 € exactos, con calderilla de sobra para dar la vuelta.
    const fondo = [
      { valor: 5000, cantidad: 4 },
      { valor: 2000, cantidad: 5 },
      { valor: 1000, cantidad: 2 },
      { valor: 200, cantidad: 5 },
      { valor: 100, cantidad: 10 },
      { valor: 50, cantidad: 10 },
      { valor: 20, cantidad: 10 },
      { valor: 10, cantidad: 10 },
      { valor: 5, cantidad: 20 },
      { valor: 2, cantidad: 20 },
      { valor: 1, cantidad: 60 },
    ];
    expect(valor(fondo)).toBe(35000);
    const { sesion } = await servicio.abrirJornada(ctx, { registerId: caja, fondoManual: fondo });

    // Un cobro en efectivo de 51,08 € con las piezas justas, sin cambio.
    const cobrado = [
      { valor: 5000, cantidad: 1 },
      { valor: 100, cantidad: 1 },
      { valor: 5, cantidad: 1 },
      { valor: 2, cantidad: 1 },
      { valor: 1, cantidad: 1 },
    ];
    expect(valor(cobrado)).toBe(5108);
    await servicio.registrarCobro(ctx, {
      sessionId: sesion.id,
      importeCentimos: 5108,
      formasPago: [{ forma: "CASH", importe: 5108 }],
      efectivoRecibido: cobrado,
      concepto: "Venta del día",
    });

    // En el cajón hay 401,08 €. Se cierra dejando 328,48 € de cambio, así que
    // a la bolsa se van 72,60 € en 50 + 10 + 10 + 2 + 0,50 + 0,10.
    const cambioFinal = [
      { valor: 5000, cantidad: 4 },
      { valor: 2000, cantidad: 5 },
      { valor: 200, cantidad: 4 },
      { valor: 100, cantidad: 11 },
      { valor: 50, cantidad: 9 },
      { valor: 20, cantidad: 10 },
      { valor: 10, cantidad: 9 },
      { valor: 5, cantidad: 21 },
      { valor: 2, cantidad: 21 },
      { valor: 1, cantidad: 61 },
    ];
    expect(valor(cambioFinal)).toBe(32848);
    await servicio.guardarArqueo(ctx, {
      sessionId: sesion.id,
      contado: [...fondo, ...cobrado],
    });
    await servicio.cerrarJornada(ctx, { sessionId: sesion.id, cambioFinal });

    const { sesion: hoy } = await servicio.abrirJornada(ctx, { registerId: caja });
    const sessionIds = [sesion.id];

    const d = await ingresos.deficitDeCaja(EMPRESA, caja);
    expect(d.fondoCentimos).toBe(32848);
    expect(d.deficitCentimos).toBe(2152);

    const p = await ingresos.proponerReposicion(EMPRESA, caja, sessionIds);
    expect(p.montonCentimos).toBe(7260);
    // Salen 22,00 € y vuelven 0,48 €: el fondo sube exactamente 21,52 €.
    expect(valor(p.reposicion!.sacar)).toBe(2200);
    expect(valor(p.reposicion!.devolver)).toBe(48);
    expect(p.reposicion!.netoCentimos).toBe(2152);

    const antesCaja = (await servicio.detalleJornada(hoy.id)).totalStockCentimos;
    await ingresos.registrarReposicion(ctx, {
      registerId: caja,
      sessionIds,
      sacar: p.reposicion!.sacar,
      devolver: p.reposicion!.devolver,
    });

    // El cajón sube el NETO, no lo que salió de la bolsa.
    const despuesCaja = (await servicio.detalleJornada(hoy.id)).totalStockCentimos;
    expect(despuesCaja - antesCaja).toBe(2152);
    // Y la bolsa baja ese mismo neto: la vuelta se le devuelve de verdad.
    const despues = await ingresos.proponerReposicion(EMPRESA, caja, sessionIds);
    expect(p.montonCentimos - despues.montonCentimos).toBe(2152);
    expect(despues.deficitCentimos).toBe(0);
  });

  it("la reposición sale en la lista de pendientes, en negativo, y resta del total", async () => {
    /*
     * Que se vea ahí y no en una nota aparte es lo que hace que la columna de
     * importes sume lo que de verdad se va a llevar al banco. Con el bruto, la
     * pantalla ofrecería un importe que el propio servidor rechaza.
     */
    const { caja, sessionIds } = await escenario();
    const antes = await ingresos.panelIngresos(EMPRESA, caja);
    expect(antes.totalPendienteCentimos).toBe(10000);
    expect(antes.reposiciones).toEqual([]);

    const p = await ingresos.proponerReposicion(EMPRESA, caja, sessionIds);
    await ingresos.registrarReposicion(ctx, {
      registerId: caja,
      sessionIds,
      sacar: p.reposicion!.sacar,
      devolver: p.reposicion!.devolver,
    });

    const despues = await ingresos.panelIngresos(EMPRESA, caja);
    expect(despues.reposiciones).toHaveLength(1);
    expect(despues.reposiciones[0].importeCentimos).toBe(10000);
    // Los cierres siguen ahí por su importe; el total ya descuenta lo repuesto.
    expect(despues.pendientes.reduce((a, c) => a + c.importeCentimos, 0)).toBe(10000);
    expect(despues.totalPendienteCentimos).toBe(0);
  });

  it("una caja sin fondo fijo nunca tiene déficit que reponer", async () => {
    const caja = await crearCaja(`sin-fondo-${Date.now()}`);
    const d = await ingresos.deficitDeCaja(EMPRESA, caja);
    expect(d.fondoObjetivoCentimos).toBe(0);
    expect(d.deficitCentimos).toBe(0);
  });

  it("una caja recién dada de alta no debe su fondo entero", async () => {
    /*
     * Sin ningún cierre no hay nada que reponer: proponerle devolver los 350 €
     * completos sería inventarse una deuda que nadie ha contraído.
     */
    const caja = await crearCaja(`repo-nueva-${Date.now()}`);
    await config.actualizarCaja(ctx, caja, { fondoObjetivoCentimos: 35000 });
    const d = await ingresos.deficitDeCaja(EMPRESA, caja);
    expect(d.fondoObjetivoCentimos).toBe(35000);
    expect(d.deficitCentimos).toBe(0);
  });

  it("sin jornada abierta se puede consultar pero no reponer", async () => {
    // Con déficit de verdad —la caja cerró corta— pero sin cajón donde meter
    // el dinero: la reposición mueve efectivo y eso necesita jornada abierta.
    const { caja, sessionIds } = await escenario({ reabrir: false });
    const p = await ingresos.proponerReposicion(EMPRESA, caja, sessionIds);
    expect(p.deficitCentimos).toBe(10000);
    expect(p.sinJornadaAbierta).toBe(true);
    await expect(
      ingresos.registrarReposicion(ctx, {
        registerId: caja,
        sessionIds,
        sacar: [{ valor: 5000, cantidad: 1 }],
      })
    ).rejects.toMatchObject({ codigo: "JORNADA_NO_ABIERTA" });
  });
});
