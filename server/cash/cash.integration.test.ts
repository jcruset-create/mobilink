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

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { esFallo } from "./domain/result.ts";

const RUN = process.env.RUN_DB_TESTS === "1" && !!process.env.DATABASE_URL;

let db: typeof import("../db.ts").default;
let servicio: typeof import("./service.ts");
let repo: typeof import("./repository.ts");
let outbox: typeof import("./erp/worker.ts");
let registry: typeof import("./erp/registry.ts");
let config: typeof import("./config.ts");
let tesoreria: typeof import("./treasury.ts");
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

/** Caja nueva por prueba: evita que una prueba dependa del estado de otra. */
async function crearCaja(nombre: string): Promise<number> {
  const ahora = Date.now();
  const { rows } = await db.query(
    `INSERT INTO cash_registers (empresa_id, centro, nombre, created_at_ms, updated_at_ms)
     VALUES ($1,'tarragona',$2,$3,$3) RETURNING id`,
    [EMPRESA, `${nombre}-${String(process.hrtime.bigint()).slice(-9)}`, ahora]
  );
  return rows[0].id;
}

beforeAll(async () => {
  if (!RUN) return;
  db = (await import("../db.ts")).default;
  servicio = await import("./service.ts");
  repo = await import("./repository.ts");
  outbox = await import("./erp/worker.ts");
  registry = await import("./erp/registry.ts");
  config = await import("./config.ts");
  tesoreria = await import("./treasury.ts");
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

    expect(cobro.numero).toMatch(/^MC-C-\d{4}-\d{6}$/);
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

    expect(pago.numero).toMatch(/^MC-P-\d{4}-\d{6}$/);
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
    expect(reversa.numero).toMatch(/^MC-C-/);

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

    expect(pedido.numero).toMatch(/^MC-CB-\d{4}-\d{6}$/);
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

    expect(entrega.numero).toMatch(/^MC-EN-\d{4}-\d{6}$/);
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
