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
