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
let tesoreria: typeof import("../cash/treasury.ts");
let ingresosCaja: typeof import("../cash/bankdeposits.ts");
let reglas: typeof import("./rules/service.ts");
let avisos: typeof import("./notifications/service.ts");
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
  tesoreria = await import("../cash/treasury.ts");
  ingresosCaja = await import("../cash/bankdeposits.ts");
  reglas = await import("./rules/service.ts");
  avisos = await import("./notifications/service.ts");
  transporteCaja = await import("../cash/events/transport.ts");
  workerCaja = await import("../cash/events/worker.ts");
  TransporteLocal = (await import("./transport.ts")).TransporteLocal;

  // Base limpia para esta empresa: las pruebas cuentan filas.
  await db.query(`DELETE FROM central_events WHERE empresa_id = $1`, [EMPRESA]);
  await db.query(`DELETE FROM central_sessions WHERE empresa_id = $1`, [EMPRESA]);
  await db.query(`DELETE FROM central_registers WHERE empresa_id = $1`, [EMPRESA]);
  await db.query(`DELETE FROM central_transits WHERE empresa_id = $1`, [EMPRESA]);
  await db.query(`DELETE FROM central_deposit_sources WHERE empresa_id = $1`, [EMPRESA]);
  await db.query(`DELETE FROM central_bank_deposits WHERE empresa_id = $1`, [EMPRESA]);
  await db.query(`DELETE FROM central_denomination_stock WHERE empresa_id = $1`, [EMPRESA]);
  await db.query(`DELETE FROM central_incidents WHERE empresa_id = $1`, [EMPRESA]);
  await db.query(`DELETE FROM central_rules WHERE empresa_id = $1`, [EMPRESA]);
  await db.query(`DELETE FROM central_notifications WHERE empresa_id = $1`, [EMPRESA]);
  await db.query(`DELETE FROM central_notification_channels WHERE empresa_id = $1`, [EMPRESA]);
});

afterAll(async () => {
  if (!RUN) return;
  await db.end().catch(() => {});
});

describe.runIf(RUN)("Ingesta en MC Central", () => {
  /** Entrega toda la cola de la caja: el worker va por orden de llegada. */
  async function vaciar() {
    for (let i = 0; i < 50; i++) {
      if ((await workerCaja.procesarEventos(500)) === 0) return;
    }
  }

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

  /*
   * La prueba que da sentido a la fase 4.
   *
   * El encargo prohíbe el doble conteo: un mismo efectivo no puede figurar a la
   * vez en dos posiciones agregadas. El caso que lo pone a prueba es el dinero
   * que sale del cajón y no ha vuelto — el que se lleva alguien para comprar
   * algo. Ese billete ya no está en el cajón, pero sigue siendo de la empresa.
   *
   * Lo que se comprueba: **el total de la red no cambia** al sacarlo. Cambia
   * dónde está, no cuánto hay. Si sumara, se estaría contando dos veces; si
   * restara, se estaría perdiendo, que es lo que hace que un arqueo descuadre
   * 200 € sin que nadie recuerde por qué.
   */
  it("sacar dinero del cajón mueve la posición, no la aumenta", async () => {
    transporteCaja.registrarTransporte(new TransporteLocal());
    try {
      const { rows: creada } = await db.query(
        `INSERT INTO cash_registers (empresa_id, centro, nombre, created_at_ms, updated_at_ms)
         VALUES ($1,'pos-global',$2,$3,$3) RETURNING id`,
        [EMPRESA, `pos-${String(process.hrtime.bigint()).slice(-9)}`, Date.now()]
      );
      const caja = creada[0].id;
      await db.query(`UPDATE cash_registers SET codigo = 'PG' || id WHERE id = $1`, [caja]);

      const { sesion } = await servicio.abrirJornada(ctx, {
        registerId: caja,
        fondoManual: [{ valor: 5000, cantidad: 4 }, { valor: 2000, cantidad: 5 }],
      });
      await vaciar();

      const antes = await queries.posicionGlobal(EMPRESA);

      // Salen 50 € con una persona.
      await tesoreria.entregarDinero(ctx, {
        sessionId: sesion.id,
        persona: "Ivan",
        motivo: "Compra de material",
        importeCentimos: 5000,
        entregado: [{ valor: 5000, cantidad: 1 }],
      });
      await vaciar();

      const fuera = await queries.posicionGlobal(EMPRESA);

      // El cajón tiene 50 € menos…
      expect(fuera.enCajonesCentimos).toBe(antes.enCajonesCentimos - 5000);
      // …que están en tránsito, con su nombre…
      expect(fuera.enTransitoPersonasCentimos).toBe(antes.enTransitoPersonasCentimos + 5000);
      // …y el TOTAL de la red no se ha movido ni un céntimo.
      expect(fuera.totalCentimos).toBe(antes.totalCentimos);

      const abiertos = await queries.transitosAbiertos(EMPRESA);
      const mio = abiertos.find((t) => t.responsable === "Ivan" && t.importeCentimos === 5000);
      expect(mio).toBeTruthy();
      expect(mio!.clase).toBe("ADVANCE");
    } finally {
      transporteCaja.registrarTransporte(null);
    }
  });

  it("al liquidar la entrega, el tránsito se cierra y el total sigue igual", async () => {
    transporteCaja.registrarTransporte(new TransporteLocal());
    try {
      const { rows: creada } = await db.query(
        `INSERT INTO cash_registers (empresa_id, centro, nombre, created_at_ms, updated_at_ms)
         VALUES ($1,'pos-liq',$2,$3,$3) RETURNING id`,
        [EMPRESA, `liq-${String(process.hrtime.bigint()).slice(-9)}`, Date.now()]
      );
      const caja = creada[0].id;
      await db.query(`UPDATE cash_registers SET codigo = 'PL' || id WHERE id = $1`, [caja]);

      const { sesion } = await servicio.abrirJornada(ctx, {
        registerId: caja,
        fondoManual: [{ valor: 5000, cantidad: 2 }, { valor: 1000, cantidad: 5 }],
      });
      const entrega = await tesoreria.entregarDinero(ctx, {
        sessionId: sesion.id,
        persona: "Marta",
        motivo: "Ferretería",
        importeCentimos: 5000,
        entregado: [{ valor: 5000, cantidad: 1 }],
      });
      await vaciar();
      const conElDineroFuera = await queries.posicionGlobal(EMPRESA);

      /*
       * El caso del encargo: se entregan 50 €, la factura es de 40 € y devuelve
       * un billete de 10 €. El tránsito se cierra por los 50 que salieron, no
       * por los 40 de la factura: si no, quedarían 10 € eternamente «fuera»
       * con alguien que ya devolvió el cambio.
       */
      await tesoreria.liquidarEntrega(ctx, entrega.id, {
        sessionId: sesion.id,
        gastoCentimos: 4000,
        devuelto: [{ valor: 1000, cantidad: 1 }],
      });
      await vaciar();

      const despues = await queries.posicionGlobal(EMPRESA);
      expect(despues.enTransitoPersonasCentimos).toBe(
        conElDineroFuera.enTransitoPersonasCentimos - 5000
      );
      // Se han gastado 40 € de verdad: eso sí sale de la red.
      expect(despues.totalCentimos).toBe(conElDineroFuera.totalCentimos - 4000);

      // Por documento y no por nombre: la base de pruebas sobrevive entre
      // ejecuciones y una «Marta» de la vuelta anterior haría pasar o fallar
      // esta comprobación por el motivo equivocado.
      const abiertos = await queries.transitosAbiertos(EMPRESA);
      expect(abiertos.some((t) => t.clase === "ADVANCE" && t.documentoId === entrega.id)).toBe(
        false
      );
    } finally {
      transporteCaja.registrarTransporte(null);
    }
  });

  /*
   * Fase 5: el ciclo completo de un ingreso bancario, de punta a punta.
   *
   * Lo que se demuestra es la ASIGNACIÓN DE ORIGEN: que el ingreso no llega a
   * Central como un importe suelto, sino sabiendo de qué jornadas salió y
   * cuánto puso cada una. Es lo que después permite conciliar con el extracto.
   */
  it("un ingreso llega con su origen desglosado y deja de estar pendiente", async () => {
    transporteCaja.registrarTransporte(new TransporteLocal());
    try {
      const { rows: creada } = await db.query(
        `INSERT INTO cash_registers (empresa_id, centro, nombre, created_at_ms, updated_at_ms)
         VALUES ($1,'ingresos',$2,$3,$3) RETURNING id`,
        [EMPRESA, `ing-${String(process.hrtime.bigint()).slice(-9)}`, Date.now()]
      );
      const caja = creada[0].id;
      await db.query(`UPDATE cash_registers SET codigo = 'IN' || id WHERE id = $1`, [caja]);

      // Un día que cobra 40 € y los aparta enteros para el banco.
      const { sesion } = await servicio.abrirJornada(ctx, {
        registerId: caja,
        fondoManual: [{ valor: 1000, cantidad: 2 }],
      });
      await servicio.registrarCobro(ctx, {
        sessionId: sesion.id,
        importeCentimos: 4000,
        formasPago: [{ forma: "CASH", importe: 4000 }],
        efectivoRecibido: [{ valor: 2000, cantidad: 2 }],
      });
      await servicio.guardarArqueo(ctx, {
        sessionId: sesion.id,
        contado: [{ valor: 2000, cantidad: 2 }, { valor: 1000, cantidad: 2 }],
      });
      await servicio.cerrarJornada(ctx, {
        sessionId: sesion.id,
        // El cambio se queda; los 40 € en billetes de 20 van al banco.
        cambioFinal: [{ valor: 1000, cantidad: 2 }],
      });
      await vaciar();

      // Antes de ingresar, ese dinero está pendiente y se ve.
      const pendienteAntes = await queries.pendienteDeIngresar(EMPRESA);
      const mioAntes = pendienteAntes.find((p) => p.registerId === caja);
      expect(mioAntes?.centimos).toBe(4000);
      expect(mioAntes?.jornadas).toBe(1);

      const ingreso = await ingresosCaja.crearIngreso(ctx, {
        registerId: caja,
        sessionIds: [sesion.id],
        importeCentimos: 4000,
        referencia: "ABONO-123",
      });
      await vaciar();

      const enRed = await queries.ingresosEnRed(EMPRESA, { registerId: caja });
      const proyectado = enRed.find((i) => i.depositId === ingreso.id);
      expect(proyectado).toBeTruthy();
      expect(proyectado!.importeCentimos).toBe(4000);
      expect(proyectado!.referencia).toBe("ABONO-123");

      // La asignación de origen: de qué jornada salió y cuánto puso.
      expect(proyectado!.origen).toHaveLength(1);
      expect(proyectado!.origen[0].sessionId).toBe(sesion.id);
      expect(proyectado!.origen[0].importeCentimos).toBe(4000);
      expect(proyectado!.origen[0].fecha).toBe(sesion.fecha);

      // Y deja de contarse como pendiente: ese dinero ya está en el banco.
      const pendienteDespues = await queries.pendienteDeIngresar(EMPRESA);
      expect(pendienteDespues.find((p) => p.registerId === caja)).toBeUndefined();
    } finally {
      transporteCaja.registrarTransporte(null);
    }
  });

  /*
   * Un evento de la fase 3 —cuando el alta solo llevaba la lista de ids— tiene
   * que poder ingerirse hoy. Los eventos son hechos del pasado: el formato
   * puede crecer, pero lo ya escrito en la cola no se reescribe.
   */
  it("ingiere un evento con el formato viejo, sin desglose de origen", async () => {
    const viejo = evento({
      tipo: "BANK_DEPOSIT_CREATED",
      aggregateType: "REGISTER",
      aggregateId: 900001,
      sessionId: null,
      datos: { depositId: 987654, numero: "VIEJO-1", importeCentimos: 1500, cierres: [900001] },
    });

    expect(await ingest.ingerirEvento(viejo)).toBe("APLICADO");

    const { rows } = await db.query(
      `SELECT importe_centimos FROM central_bank_deposits WHERE deposit_id = 987654`
    );
    expect(Number(rows[0].importe_centimos)).toBe(1500);

    // El origen queda con la jornada, sin importe: es lo que el evento sabía.
    const { rows: fuentes } = await db.query(
      `SELECT session_id, importe_centimos FROM central_deposit_sources WHERE deposit_id = 987654`
    );
    expect(fuentes).toHaveLength(1);
    expect(fuentes[0].session_id).toBe(900001);
  });

  /*
   * Fase 6: la vista consolidada de cambio.
   *
   * Lo que se comprueba es que Central recibe el detalle POR PIEZA del arqueo,
   * porque es lo único que permite contestar «¿qué caja se está quedando sin
   * calderilla?». Con solo los totales, esa pregunta no tiene respuesta.
   */
  it("el arqueo llega pieza a pieza y deja ver quién se queda sin calderilla", async () => {
    transporteCaja.registrarTransporte(new TransporteLocal());
    try {
      const { rows: creada } = await db.query(
        `INSERT INTO cash_registers (empresa_id, centro, nombre, created_at_ms, updated_at_ms)
         VALUES ($1,'cambio',$2,$3,$3) RETURNING id`,
        [EMPRESA, `cam-${String(process.hrtime.bigint()).slice(-9)}`, Date.now()]
      );
      const caja = creada[0].id;
      await db.query(`UPDATE cash_registers SET codigo = 'CM' || id WHERE id = $1`, [caja]);

      // Una caja con un billete de 50 € y poca cosa más: casi sin calderilla.
      const fondo = [
        { valor: 5000, cantidad: 1 },
        { valor: 100, cantidad: 3 },
        { valor: 10, cantidad: 4 },
      ];
      const { sesion } = await servicio.abrirJornada(ctx, { registerId: caja, fondoManual: fondo });
      await servicio.guardarArqueo(ctx, { sessionId: sesion.id, contado: fondo });
      await vaciar();

      const { rows: piezas } = await db.query(
        `SELECT valor_centimos, cantidad FROM central_denomination_stock
          WHERE register_id = $1 ORDER BY valor_centimos DESC`,
        [caja]
      );
      const porValor = new Map<number, number>(
        (piezas as { valor_centimos: number; cantidad: number }[]).map((p) => [
          p.valor_centimos,
          p.cantidad,
        ])
      );
      expect(porValor.get(5000)).toBe(1);
      expect(porValor.get(100)).toBe(3);
      expect(porValor.get(10)).toBe(4);

      // La calderilla son las monedas, no el billete: 3 € + 0,40 €.
      const sinCambio = await queries.cajasSinCambio(EMPRESA);
      const mia = sinCambio.find((c) => c.registerId === caja);
      expect(mia?.calderillaCentimos).toBe(340);

      // Y el consolidado cuenta las cajas que se han quedado a cero en una
      // pieza, que es el dato que un total de red no puede dar.
      const red = await queries.cambioEnRed(EMPRESA);
      expect(red.find((p) => p.valorCentimos === 5000)?.cantidad).toBeGreaterThanOrEqual(1);
    } finally {
      transporteCaja.registrarTransporte(null);
    }
  });

  it("un descuadre se puede mirar por pieza, no solo por su importe", async () => {
    transporteCaja.registrarTransporte(new TransporteLocal());
    try {
      const { rows: creada } = await db.query(
        `INSERT INTO cash_registers (empresa_id, centro, nombre, created_at_ms, updated_at_ms)
         VALUES ($1,'descuadre',$2,$3,$3) RETURNING id`,
        [EMPRESA, `des-${String(process.hrtime.bigint()).slice(-9)}`, Date.now()]
      );
      const caja = creada[0].id;
      await db.query(`UPDATE cash_registers SET codigo = 'DS' || id WHERE id = $1`, [caja]);

      const { sesion } = await servicio.abrirJornada(ctx, {
        registerId: caja,
        fondoManual: [{ valor: 2000, cantidad: 3 }],
      });
      // Se cuenta un billete de 20 € de menos.
      await servicio.guardarArqueo(ctx, {
        sessionId: sesion.id,
        contado: [{ valor: 2000, cantidad: 2 }],
      });
      await vaciar();

      const { rows } = await db.query(
        `SELECT diferencia FROM central_denomination_stock
          WHERE register_id = $1 AND valor_centimos = 2000`,
        [caja]
      );
      expect(rows[0].diferencia).toBe(-1);

      const porPieza = await queries.descuadresPorPieza(EMPRESA);
      expect(porPieza.some((p) => p.valorCentimos === 2000 && p.diferencia < 0)).toBe(true);
    } finally {
      transporteCaja.registrarTransporte(null);
    }
  });

  /*
   * Fase 7: reglas, alertas e incidencias, contra datos reales.
   *
   * El motor ya está probado aparte y sin base de datos. Lo que se comprueba
   * aquí es lo que el motor no puede: que la bandeja no se duplique al
   * reevaluar, y que lo que deja de pasar se cierre solo.
   */
  it("un descuadre abre una incidencia, y reevaluar no la duplica", async () => {
    transporteCaja.registrarTransporte(new TransporteLocal());
    try {
      const { rows: creada } = await db.query(
        `INSERT INTO cash_registers (empresa_id, centro, nombre, created_at_ms, updated_at_ms)
         VALUES ($1,'reglas',$2,$3,$3) RETURNING id`,
        [EMPRESA, `reg-${String(process.hrtime.bigint()).slice(-9)}`, Date.now()]
      );
      const caja = creada[0].id;
      await db.query(`UPDATE cash_registers SET codigo = 'RG' || id WHERE id = $1`, [caja]);

      await reglas.guardarRegla(
        { empresaId: EMPRESA, userId: null },
        { tipo: "DESCUADRE", ambito: "EMPRESA", umbral: 1000 }
      );

      const { sesion } = await servicio.abrirJornada(ctx, {
        registerId: caja,
        fondoManual: [{ valor: 2000, cantidad: 3 }],
      });
      // Falta un billete de 20 €: descuadre de 2.000 céntimos.
      await servicio.guardarArqueo(ctx, {
        sessionId: sesion.id,
        contado: [{ valor: 2000, cantidad: 2 }],
      });
      await vaciar();

      const primera = await reglas.evaluar(EMPRESA);
      expect(primera.abiertas).toBeGreaterThanOrEqual(1);

      const bandeja = await reglas.listarIncidencias(EMPRESA);
      const mia = bandeja.filter((i) => i.registerId === caja && i.tipo === "DESCUADRE");
      expect(mia).toHaveLength(1);
      expect(mia[0].valor).toBe(2000);
      expect(mia[0].umbral).toBe(1000);

      // Reevaluar no abre otra: la barrera es el índice único, no un `if`.
      await reglas.evaluar(EMPRESA);
      await reglas.evaluar(EMPRESA);
      const otraVez = await reglas.listarIncidencias(EMPRESA);
      expect(otraVez.filter((i) => i.registerId === caja && i.tipo === "DESCUADRE")).toHaveLength(1);
    } finally {
      transporteCaja.registrarTransporte(null);
    }
  });

  /*
   * Lo que deja de pasar se cierra solo. Si hubiera que cerrarlo a mano, la
   * bandeja acumularía avisos de problemas ya arreglados y en dos semanas
   * nadie la abriría.
   */
  it("el aviso de dinero fuera se cierra solo cuando el dinero vuelve", async () => {
    transporteCaja.registrarTransporte(new TransporteLocal());
    try {
      const { rows: creada } = await db.query(
        `INSERT INTO cash_registers (empresa_id, centro, nombre, created_at_ms, updated_at_ms)
         VALUES ($1,'auto',$2,$3,$3) RETURNING id`,
        [EMPRESA, `aut-${String(process.hrtime.bigint()).slice(-9)}`, Date.now()]
      );
      const caja = creada[0].id;
      await db.query(`UPDATE cash_registers SET codigo = 'AU' || id WHERE id = $1`, [caja]);

      // «Más de un día fuera». La regla se lee así de literal: con umbral 0 y
      // un tránsito de hace un minuto NO salta, y es lo correcto — ir al banco
      // y volver por la tarde es la operativa normal, no una incidencia.
      await reglas.guardarRegla(
        { empresaId: EMPRESA, userId: null },
        { tipo: "TRANSITO_DIAS", ambito: "EMPRESA", umbral: 1 }
      );

      const { sesion } = await servicio.abrirJornada(ctx, {
        registerId: caja,
        fondoManual: [{ valor: 5000, cantidad: 2 }],
      });
      const entrega = await tesoreria.entregarDinero(ctx, {
        sessionId: sesion.id,
        persona: "Nuria",
        motivo: "Recambios",
        importeCentimos: 5000,
        entregado: [{ valor: 5000, cantidad: 1 }],
      });
      await vaciar();

      // Se envejece el tránsito tres días: esperar de verdad no es una opción.
      await db.query(
        `UPDATE central_transits SET abierto_en_ms = $2
          WHERE clase = 'ADVANCE' AND documento_id = $1`,
        [entrega.id, Date.now() - 3 * 86_400_000]
      );
      await reglas.evaluar(EMPRESA);

      const abierta = (await reglas.listarIncidencias(EMPRESA)).find(
        (i) => i.registerId === caja && i.tipo === "TRANSITO_DIAS"
      );
      expect(abierta).toBeTruthy();

      // Vuelve el dinero.
      await tesoreria.liquidarEntrega(ctx, entrega.id, {
        sessionId: sesion.id,
        gastoCentimos: 5000,
      });
      await vaciar();
      const resultado = await reglas.evaluar(EMPRESA);
      expect(resultado.cerradas).toBeGreaterThanOrEqual(1);

      const viva = (await reglas.listarIncidencias(EMPRESA)).find(
        (i) => i.registerId === caja && i.tipo === "TRANSITO_DIAS"
      );
      expect(viva).toBeUndefined();
    } finally {
      transporteCaja.registrarTransporte(null);
    }
  });

  /*
   * El descuadre NO se cierra solo: es un hecho que ocurrió. El dinero faltó
   * ese día aunque hoy la caja cuadre, y cerrarlo automáticamente sería borrar
   * la única señal de que pasó.
   */
  it("el descuadre sigue abierto aunque la caja vuelva a cuadrar", async () => {
    transporteCaja.registrarTransporte(new TransporteLocal());
    try {
      const { rows: creada } = await db.query(
        `INSERT INTO cash_registers (empresa_id, centro, nombre, created_at_ms, updated_at_ms)
         VALUES ($1,'persiste',$2,$3,$3) RETURNING id`,
        [EMPRESA, `per-${String(process.hrtime.bigint()).slice(-9)}`, Date.now()]
      );
      const caja = creada[0].id;
      await db.query(`UPDATE cash_registers SET codigo = 'PR' || id WHERE id = $1`, [caja]);

      await reglas.guardarRegla(
        { empresaId: EMPRESA, userId: null },
        { tipo: "DESCUADRE", ambito: "EMPRESA", umbral: 100 }
      );

      const { sesion } = await servicio.abrirJornada(ctx, {
        registerId: caja,
        fondoManual: [{ valor: 1000, cantidad: 3 }],
      });
      await servicio.guardarArqueo(ctx, {
        sessionId: sesion.id,
        contado: [{ valor: 1000, cantidad: 2 }],
      });
      await vaciar();
      await reglas.evaluar(EMPRESA);

      // Se regulariza: a partir de aquí la caja cuadra.
      await servicio.regularizarArqueo(ctx, { sessionId: sesion.id, motivo: "Recuento erróneo" });
      await vaciar();
      await reglas.evaluar(EMPRESA);

      const sigue = (await reglas.listarIncidencias(EMPRESA)).find(
        (i) => i.registerId === caja && i.tipo === "DESCUADRE"
      );
      expect(sigue).toBeTruthy();
      expect(sigue!.estado).toBe("ABIERTA");

      // Y la cierra una persona, que es quien puede decir por qué.
      await reglas.cambiarIncidencia(
        { empresaId: EMPRESA, userId: null },
        sigue!.id,
        "RESUELTA",
        "Se recontó y apareció"
      );
      const cerrada = (await reglas.listarIncidencias(EMPRESA, false)).find(
        (i) => i.id === sigue!.id
      );
      expect(cerrada!.estado).toBe("RESUELTA");
      expect(cerrada!.cerradaMotivo).toBe("MANUAL");
    } finally {
      transporteCaja.registrarTransporte(null);
    }
  });

  /*
   * Fase 8: los avisos.
   *
   * Lo que hay que demostrar no es que se mande un correo —eso depende del SMTP
   * y aquí no hay— sino que **se encola uno y solo uno por incidencia**. Un
   * problema que dura tres días no puede mandar tres correos iguales: es la
   * diferencia entre un aviso que se lee y uno que se filtra a una carpeta.
   */
  it("una incidencia nueva encola un aviso, y reevaluar no encola más", async () => {
    transporteCaja.registrarTransporte(new TransporteLocal());
    try {
      const { rows: creada } = await db.query(
        `INSERT INTO cash_registers (empresa_id, centro, nombre, created_at_ms, updated_at_ms)
         VALUES ($1,'avisos',$2,$3,$3) RETURNING id`,
        [EMPRESA, `avi-${String(process.hrtime.bigint()).slice(-9)}`, Date.now()]
      );
      const caja = creada[0].id;
      await db.query(`UPDATE cash_registers SET codigo = 'AV' || id WHERE id = $1`, [caja]);

      await avisos.guardarCanal({ empresaId: EMPRESA }, { destino: "jefe@taller.example" });
      await reglas.guardarRegla(
        { empresaId: EMPRESA, userId: null },
        { tipo: "DESCUADRE", ambito: "EMPRESA", umbral: 500 }
      );

      const { sesion } = await servicio.abrirJornada(ctx, {
        registerId: caja,
        fondoManual: [{ valor: 2000, cantidad: 3 }],
      });
      await servicio.guardarArqueo(ctx, {
        sessionId: sesion.id,
        contado: [{ valor: 2000, cantidad: 2 }],
      });
      await vaciar();

      const primera = await reglas.evaluar(EMPRESA);
      expect(primera.avisadas).toBeGreaterThanOrEqual(1);

      const { rows: cola } = await db.query(
        `SELECT n.asunto, n.destino, n.estado
           FROM central_notifications n
           JOIN central_incidents i ON i.id = n.incident_id
          WHERE i.register_id = $1`,
        [caja]
      );
      expect(cola).toHaveLength(1);
      expect(cola[0].destino).toBe("jefe@taller.example");
      expect(cola[0].estado).toBe("PENDIENTE");
      // El asunto basta para saber si importa, sin abrir el correo.
      expect(cola[0].asunto).toContain("Descuadre");
      expect(cola[0].asunto).toContain("20,00 €");

      // Tres evaluaciones más: sigue habiendo un aviso.
      await reglas.evaluar(EMPRESA);
      await reglas.evaluar(EMPRESA);
      const { rows: otraVez } = await db.query(
        `SELECT n.id FROM central_notifications n
           JOIN central_incidents i ON i.id = n.incident_id
          WHERE i.register_id = $1`,
        [caja]
      );
      expect(otraVez).toHaveLength(1);
    } finally {
      transporteCaja.registrarTransporte(null);
    }
  });

  /*
   * Sin SMTP configurado los avisos ESPERAN, no fallan. Marcarlos como error
   * gastaría los intentos antes de que exista siquiera la posibilidad de
   * enviarlos, y el día que se configure el correo ya no saldrían.
   */
  it("sin correo configurado, los avisos esperan sin gastar intentos", async () => {
    const antes = process.env.SMTP_HOST;
    delete process.env.SMTP_HOST;
    try {
      expect(await avisos.enviarPendientes()).toBe(0);
      const { rows } = await db.query(
        `SELECT intentos, estado FROM central_notifications WHERE empresa_id = $1`,
        [EMPRESA]
      );
      for (const n of rows) {
        expect(n.intentos).toBe(0);
        expect(n.estado).toBe("PENDIENTE");
      }
    } finally {
      if (antes !== undefined) process.env.SMTP_HOST = antes;
    }
  });

  it("un canal solo recibe los tipos que pidió", async () => {
    await avisos.guardarCanal(
      { empresaId: EMPRESA },
      { destino: "solo-cambio@taller.example", tipos: ["CALDERILLA_MINIMA"] }
    );

    const { rows: antes } = await db.query(
      `SELECT COUNT(*)::int AS n FROM central_notifications
        WHERE empresa_id = $1 AND destino = 'solo-cambio@taller.example'`,
      [EMPRESA]
    );

    // Se fuerza una incidencia de descuadre nueva, de otra jornada.
    await db.query(
      `INSERT INTO central_incidents
         (empresa_id, register_id, tipo, clave, umbral, valor, abierta_en_ms, actualizada_en_ms)
       VALUES ($1, 999001, 'DESCUADRE', 'DESCUADRE:999001:1', 100, 5000, $2, $2)
       ON CONFLICT DO NOTHING`,
      [EMPRESA, Date.now()]
    );
    await reglas.evaluar(EMPRESA);

    const { rows: despues } = await db.query(
      `SELECT COUNT(*)::int AS n FROM central_notifications
        WHERE empresa_id = $1 AND destino = 'solo-cambio@taller.example'`,
      [EMPRESA]
    );
    expect(despues[0].n).toBe(antes[0].n);
  });
});
