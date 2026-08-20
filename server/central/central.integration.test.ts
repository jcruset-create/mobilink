/**
 * MC Central contra PostgreSQL real.
 *
 * Solo con RUN_DB_TESTS=1 y DATABASE_URL a una base DESECHABLE.
 *
 * Lo que hay que demostrar aquí no es que la pantalla enseñe números, sino las
 * dos propiedades de las que depende que esos números signifiquen algo: que un
 * evento repetido no se cuenta dos veces, y que uno que llega tarde no
 * resucita un estado viejo.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";

const RUN = process.env.RUN_DB_TESTS === "1" && !!process.env.DATABASE_URL;

let db: typeof import("../db.ts").default;
let ingest: typeof import("./ingest.ts");
let queries: typeof import("./queries.ts");
let servicio: typeof import("../cash/service.ts");
let transporteCaja: typeof import("../cash/events/transport.ts");
let workerCaja: typeof import("../cash/events/worker.ts");
let TransporteLocal: typeof import("./transport.ts").TransporteLocal;

const EMPRESA = "00000000-0000-4000-a000-0000000000cb";
const TALLER = "00000000-0000-4000-a000-00000000cc01";
const ctx = { empresaId: EMPRESA, userId: null as string | null };

let contador = 0;
/** Un evento con lo mínimo. `version` es lo que ordena. */
function evento(over: Record<string, unknown> = {}) {
  contador++;
  return {
    eventId: `00000000-0000-4000-b000-${String(contador).padStart(12, "0")}`,
    empresaId: EMPRESA,
    centroId: TALLER,
    registerId: 900001,
    sessionId: 900001,
    aggregateType: "SESSION",
    aggregateId: 900001,
    aggregateVersion: contador,
    tipo: "SESSION_OPENED",
    ocurridoEnMs: 1_700_000_000_000 + contador,
    actorUserId: null,
    datos: {} as Record<string, unknown>,
    ...over,
  };
}

beforeAll(async () => {
  if (!RUN) return;
  db = (await import("../db.ts")).default;
  await (await import("../cash/schema.ts")).initCash();
  await (await import("./schema.ts")).initCentral();
  ingest = await import("./ingest.ts");
  queries = await import("./queries.ts");
  servicio = await import("../cash/service.ts");
  transporteCaja = await import("../cash/events/transport.ts");
  workerCaja = await import("../cash/events/worker.ts");
  TransporteLocal = (await import("./transport.ts")).TransporteLocal;

  // Base limpia para esta empresa: las pruebas cuentan filas.
  await db.query(`DELETE FROM central_events WHERE empresa_id = $1`, [EMPRESA]);
  await db.query(`DELETE FROM central_sessions WHERE empresa_id = $1`, [EMPRESA]);
  await db.query(`DELETE FROM central_registers WHERE empresa_id = $1`, [EMPRESA]);
});

afterAll(async () => {
  if (!RUN) return;
  await db.end().catch(() => {});
});

describe.runIf(RUN)("Ingesta en MC Central", () => {
  it("proyecta la apertura y va contando las operaciones", async () => {
    expect(
      await ingest.ingerirEvento(
        evento({ tipo: "SESSION_OPENED", datos: { fecha: "2026-08-20", fondoCentimos: 30000 } })
      )
    ).toBe("APLICADO");

    await ingest.ingerirEvento(
      evento({
        tipo: "OPERATION_REGISTERED",
        datos: { tipoOperacion: "COLLECTION", importeCentimos: 2500, efectivoNetoCentimos: 2500 },
      })
    );

    const { rows } = await db.query(
      `SELECT estado, fondo_inicial_centimos, operaciones, cobros_centimos
         FROM central_sessions WHERE session_id = 900001`
    );
    expect(rows[0].estado).toBe("OPEN");
    expect(Number(rows[0].fondo_inicial_centimos)).toBe(30000);
    expect(rows[0].operaciones).toBe(1);
    expect(Number(rows[0].cobros_centimos)).toBe(2500);
  });

  /*
   * La propiedad que impide el doble conteo. No la garantiza este código: la
   * garantiza que `event_id` sea la clave primaria.
   */
  it("el mismo evento dos veces no cuenta dos veces", async () => {
    const cobro = evento({
      tipo: "OPERATION_REGISTERED",
      datos: { tipoOperacion: "COLLECTION", importeCentimos: 1000, efectivoNetoCentimos: 1000 },
    });

    expect(await ingest.ingerirEvento(cobro)).toBe("APLICADO");
    expect(await ingest.ingerirEvento(cobro)).toBe("DUPLICADO");
    expect(await ingest.ingerirEvento(cobro)).toBe("DUPLICADO");

    const { rows } = await db.query(
      `SELECT operaciones, cobros_centimos FROM central_sessions WHERE session_id = 900001`
    );
    // Dos operaciones en total: la de la prueba anterior y ésta, una sola vez.
    expect(rows[0].operaciones).toBe(2);
    expect(Number(rows[0].cobros_centimos)).toBe(3500);
  });

  /*
   * Un reintento puede entregar la apertura DESPUÉS del cierre. Sin orden, la
   * pantalla diría que sigue abierta una caja que se cerró hace horas.
   */
  it("un evento tardío no resucita un estado viejo", async () => {
    await ingest.ingerirEvento(
      evento({
        tipo: "SESSION_CLOSED",
        aggregateVersion: 500,
        datos: { fecha: "2026-08-20", ingresoBancarioCentimos: 12000, diferenciaCentimos: -250 },
      })
    );

    const tardio = await ingest.ingerirEvento(
      evento({ tipo: "SESSION_OPENED", aggregateVersion: 3, datos: { fondoCentimos: 999 } })
    );
    expect(tardio).toBe("TARDIO");

    const { rows } = await db.query(
      `SELECT estado, diferencia_centimos, fondo_inicial_centimos
         FROM central_sessions WHERE session_id = 900001`
    );
    expect(rows[0].estado).toBe("CLOSED");
    expect(Number(rows[0].diferencia_centimos)).toBe(-250);
    // Y el fondo tampoco lo ha pisado el evento viejo.
    expect(Number(rows[0].fondo_inicial_centimos)).toBe(30000);

    const { rows: marcado } = await db.query(
      `SELECT resultado FROM central_events WHERE tipo = 'SESSION_OPENED'
        AND aggregate_version = 3 AND empresa_id = $1`,
      [EMPRESA]
    );
    // Queda anotado como TARDIO: llegó y se descartó, que no es lo mismo que
    // no haber llegado.
    expect(marcado[0].resultado).toBe("TARDIO");
  });

  it("el ingreso bancario suma en la caja, y al anularlo se resta", async () => {
    const comun = { aggregateType: "REGISTER", aggregateId: 900001, sessionId: null };
    await ingest.ingerirEvento(
      evento({ ...comun, tipo: "BANK_DEPOSIT_CREATED", datos: { importeCentimos: 50000 } })
    );
    let { rows } = await db.query(
      `SELECT ingresos_bancarios, ingresado_centimos FROM central_registers WHERE register_id = 900001`
    );
    expect(rows[0].ingresos_bancarios).toBe(1);
    expect(Number(rows[0].ingresado_centimos)).toBe(50000);

    await ingest.ingerirEvento(
      evento({ ...comun, tipo: "BANK_DEPOSIT_VOIDED", datos: { importeCentimos: 50000 } })
    );
    ({ rows } = await db.query(
      `SELECT ingresos_bancarios, ingresado_centimos FROM central_registers WHERE register_id = 900001`
    ));
    expect(rows[0].ingresos_bancarios).toBe(0);
    expect(Number(rows[0].ingresado_centimos)).toBe(0);
  });

  it("el resumen de red cuenta descuadres y eventos tardíos", async () => {
    const resumen = await queries.resumenRed(EMPRESA);
    expect(resumen.cajas).toBeGreaterThanOrEqual(1);
    expect(resumen.eventosTardios).toBeGreaterThanOrEqual(1);
  });

  /*
   * De punta a punta: un cobro real en la caja tiene que acabar en la
   * proyección de Central sin que nadie copie nada a mano.
   */
  it("un cobro real recorre el camino entero: caja → cola → Central", async () => {
    transporteCaja.registrarTransporte(new TransporteLocal());
    try {
      const { rows: creada } = await db.query(
        `INSERT INTO cash_registers (empresa_id, centro, nombre, created_at_ms, updated_at_ms)
         VALUES ($1,'central-e2e',$2,$3,$3) RETURNING id`,
        [EMPRESA, `e2e-${String(process.hrtime.bigint()).slice(-9)}`, Date.now()]
      );
      const caja = creada[0].id;
      // El código sale del id y no de una constante: la base de pruebas
      // sobrevive entre ejecuciones, así que un código fijo choca con el de la
      // vuelta anterior. Es el mismo motivo por el que lo hace así la suite de
      // la caja.
      await db.query(`UPDATE cash_registers SET codigo = 'CE' || id WHERE id = $1`, [caja]);

      const { sesion } = await servicio.abrirJornada(ctx, {
        registerId: caja,
        fondoManual: [{ valor: 2000, cantidad: 5 }],
      });
      await servicio.registrarCobro(ctx, {
        sessionId: sesion.id,
        importeCentimos: 2000,
        formasPago: [{ forma: "CASH", importe: 2000 }],
        efectivoRecibido: [{ valor: 2000, cantidad: 1 }],
      });

      for (let i = 0; i < 50; i++) {
        if ((await workerCaja.procesarEventos(500)) === 0) break;
      }

      const { rows } = await db.query(
        `SELECT estado, operaciones, cobros_centimos FROM central_sessions WHERE session_id = $1`,
        [sesion.id]
      );
      expect(rows.length).toBe(1);
      expect(rows[0].estado).toBe("OPEN");
      expect(rows[0].operaciones).toBe(1);
      expect(Number(rows[0].cobros_centimos)).toBe(2000);
    } finally {
      transporteCaja.registrarTransporte(null);
    }
  });
});
