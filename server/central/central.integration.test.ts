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
let clientes: typeof import("./api/clients.ts");
let hooks: typeof import("./api/webhooks.ts");
let conciliacion: typeof import("./reconciliation/service.ts");
let observabilidad: typeof import("./health.ts");
let prediccion: typeof import("./forecast/service.ts");
let puntuacion: typeof import("./score/service.ts");
let trasladosCaja: typeof import("../cash/transfers.ts");
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
  clientes = await import("./api/clients.ts");
  hooks = await import("./api/webhooks.ts");
  conciliacion = await import("./reconciliation/service.ts");
  observabilidad = await import("./health.ts");
  prediccion = await import("./forecast/service.ts");
  puntuacion = await import("./score/service.ts");
  trasladosCaja = await import("../cash/transfers.ts");
  transporteCaja = await import("../cash/events/transport.ts");
  workerCaja = await import("../cash/events/worker.ts");
  TransporteLocal = (await import("./transport.ts")).TransporteLocal;

  /*
   * Base limpia para esta empresa: las pruebas cuentan filas.
   *
   * Lo primero, la cola de eventos de la caja. Una prueba que emite un evento y
   * termina sin vaciarla deja esa fila PENDIENTE, y en la EJECUCIÓN SIGUIENTE
   * el primer `vaciar()` la procesa: aparecen jornadas y dinero de la vuelta
   * anterior, y falla una prueba que no tiene nada que ver con la que los dejó.
   * Costó un rato entenderlo; se limpia aquí para que cada ejecución empiece de
   * cero de verdad.
   */
  await db.query(
    `DELETE FROM cash_event_outbox WHERE empresa_id = $1 AND estado IN ('PENDING','RETRY_PENDING')`,
    [EMPRESA]
  );

  // Y ahora las proyecciones.
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
  await db.query(`DELETE FROM central_webhook_deliveries WHERE empresa_id = $1`, [EMPRESA]);
  await db.query(`DELETE FROM central_webhooks WHERE empresa_id = $1`, [EMPRESA]);
  await db.query(`DELETE FROM central_api_tokens WHERE empresa_id = $1`, [EMPRESA]);
  await db.query(`DELETE FROM central_api_clients WHERE empresa_id = $1`, [EMPRESA]);
  await db.query(`DELETE FROM central_statement_lines WHERE empresa_id = $1`, [EMPRESA]);
  await db.query(`DELETE FROM central_bank_statements WHERE empresa_id = $1`, [EMPRESA]);
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
   * Regresión: una caja recién dada de alta, que todavía no ha movido un euro,
   * TIENE que verse en la red.
   *
   * Antes no se veía, y el motivo era sutil: el listado mandaba sobre
   * `central_registers`, que es una proyección de eventos y solo tiene fila
   * cuando la caja ha emitido alguno. O sea que la pantalla que existe para
   * vigilar la red escondía justo la caja del primer día, sin dar ningún error.
   */
  it("una caja sin un solo evento se ve igual en la red", async () => {
    const { rows: creada } = await db.query(
      `INSERT INTO cash_registers (empresa_id, centro, nombre, created_at_ms, updated_at_ms)
       VALUES ($1,'sin-eventos',$2,$3,$3) RETURNING id`,
      [EMPRESA, `virgen-${String(process.hrtime.bigint()).slice(-9)}`, Date.now()]
    );
    const caja = creada[0].id;

    // Nadie la ha tocado: no debe existir en la proyección.
    const { rows: proy } = await db.query(
      `SELECT 1 FROM central_registers WHERE register_id = $1`,
      [caja]
    );
    expect(proy).toHaveLength(0);

    const enRed = await queries.cajasEnRed(EMPRESA);
    const mia = enRed.find((c) => c.registerId === caja);

    expect(mia).toBeDefined();
    // Y sale diciendo la verdad: existe y no ha hecho nada todavía.
    expect(mia!.ultimaActividadMs).toBeNull();
    expect(mia!.jornadaAbiertaId).toBeNull();
    expect(mia!.ingresadoCentimos).toBe(0);
  });

  /*
   * La puerta que la fase 1 prometía y no existía: poner a mano la caja que el
   * backfill no supo emparejar.
   *
   * Se prueba también que NO se pueda tocar la caja de otra empresa. La
   * pantalla manda el id de la caja tal cual, así que sin esa comprobación
   * bastaría con cambiar un número en la petición.
   */
  it("una caja sin taller se puede asignar a mano, y solo dentro de tu empresa", async () => {
    const { rows: hayCentros } = await db.query(
      `SELECT to_regclass('public.app_centros') IS NOT NULL AS hay`
    );
    if (!hayCentros[0]?.hay) return; // sin fundación SaaS no hay taller que asignar

    await db.query(
      `INSERT INTO app_empresas (id, nombre, slug) VALUES ($1, 'Pruebas', 'pruebas-' || $2)
       ON CONFLICT (id) DO NOTHING`,
      [EMPRESA, EMPRESA]
    );
    const { rows: centro } = await db.query(
      `INSERT INTO app_centros (empresa_id, nombre) VALUES ($1, $2) RETURNING id`,
      [EMPRESA, `taller-manual-${String(process.hrtime.bigint()).slice(-9)}`]
    );
    const taller = centro[0].id;

    const { rows: creada } = await db.query(
      `INSERT INTO cash_registers (empresa_id, centro, nombre, created_at_ms, updated_at_ms)
       VALUES ($1,'huerfana',$2,$3,$3) RETURNING id`,
      [EMPRESA, `sin-taller-${String(process.hrtime.bigint()).slice(-9)}`, Date.now()]
    );
    const caja = creada[0].id;

    const jerarquia = await import("../cash/hierarchy.ts");
    // `ip` va fuera: es opcional y `null` no encaja con `string | undefined`.
    const ctx = { empresaId: EMPRESA, userId: null };

    // Antes: la red la enseña, pero sin taller.
    const antes = (await queries.cajasEnRed(EMPRESA)).find((c) => c.registerId === caja);
    expect(antes?.centroId).toBeNull();

    await jerarquia.asignarCentroACaja(ctx, caja, taller);

    const despues = (await queries.cajasEnRed(EMPRESA)).find((c) => c.registerId === caja);
    expect(despues?.centroId).toBe(taller);
    expect(despues?.centroNombre).toBeTruthy();

    // Y se puede deshacer: asignar mal y no poder corregirlo sería peor.
    await jerarquia.asignarCentroACaja(ctx, caja, null);
    const quitado = (await queries.cajasEnRed(EMPRESA)).find((c) => c.registerId === caja);
    expect(quitado?.centroId).toBeNull();

    // La caja es de esta empresa; desde otra, no existe.
    const otra = { ...ctx, empresaId: "00000000-0000-4000-a000-0000000000ff" };
    await expect(jerarquia.asignarCentroACaja(otra, caja, taller)).rejects.toMatchObject({
      codigo: "ENTRADA_NO_VALIDA",
    });

    // Y un taller de otra empresa tampoco vale como destino.
    await expect(
      jerarquia.asignarCentroACaja(ctx, caja, "00000000-0000-4000-a000-0000000000fe")
    ).rejects.toBeTruthy();

    // Un id que no es una caja se contesta con un error entendible, no con uno
    // de PostgreSQL por comparar contra NaN.
    await expect(jerarquia.asignarCentroACaja(ctx, Number("x"), taller)).rejects.toMatchObject({
      codigo: "ENTRADA_NO_VALIDA",
    });
  });

  /*
   * Corregir un cierre ya proyectado: el caso real del 21/08.
   *
   * Se tecleó el reparto al revés y el fondo salió como «ingreso bancario».
   * `scripts/cash-reclasificar-cierre.ts` lo arregla en la caja, pero si no
   * avisa a Central, Central sigue enseñando ese dinero como ido al banco —y
   * no en un sitio: el mismo campo alimenta la columna «Al banco», la posición
   * global y los «pendientes de ingresar».
   *
   * Lo que hay que demostrar no es que la consulta pinte números, sino que el
   * evento correctivo GANA al del cierre original. Central proyecta por versión
   * del agregado y descarta lo viejo como TARDIO: si la corrección no subiera
   * la versión, se tiraría en silencio y el descuadre seguiría ahí.
   */
  it("un cierre corregido pisa al original en Central, no se descarta por tardío", async () => {
    transporteCaja.registrarTransporte(new TransporteLocal());
    try {
      const { rows: creada } = await db.query(
        `INSERT INTO cash_registers (empresa_id, centro, nombre, created_at_ms, updated_at_ms)
         VALUES ($1,'reclasificar',$2,$3,$3) RETURNING id`,
        [EMPRESA, `recl-${String(process.hrtime.bigint()).slice(-9)}`, Date.now()]
      );
      const caja = creada[0].id;
      const hoy = new Date().toISOString().slice(0, 10);
      const { rows: ses } = await db.query(
        `INSERT INTO cash_sessions (empresa_id, register_id, fecha, estado,
                                    created_at_ms, updated_at_ms)
         VALUES ($1,$2,$3::date,'CLOSED',$4,$4) RETURNING id`,
        [EMPRESA, caja, hoy, Date.now()]
      );
      const sesion = ses[0].id;

      const emitir = async (cambio: number, ingreso: number) => {
        const client = await db.connect();
        try {
          await client.query("BEGIN");
          await (await import("../cash/events/emitter.ts")).emitirEvento(client, {
            empresaId: EMPRESA,
            registerId: caja,
            sessionId: sesion,
            agregado: { tipo: "SESSION", id: sesion },
            tipo: "SESSION_CLOSED",
            ocurridoEnMs: Date.now(),
            datos: {
              fecha: hoy,
              cambioFinalCentimos: cambio,
              ingresoBancarioCentimos: ingreso,
              diferenciaCentimos: 0,
            },
          });
          await client.query("COMMIT");
        } finally {
          client.release();
        }
      };

      // El cierre tal como se tecleó: los 350 € del fondo como ingreso.
      await emitir(0, 35000);
      await vaciar();

      const { rows: mal } = await db.query(
        `SELECT cambio_final_centimos, ingreso_bancario_centimos
           FROM central_sessions WHERE session_id = $1`,
        [sesion]
      );
      expect(Number(mal[0].ingreso_bancario_centimos)).toBe(35000);

      // Y la corrección: mismo dinero, otra etiqueta.
      await emitir(35000, 0);
      await vaciar();

      const { rows: bien } = await db.query(
        `SELECT cambio_final_centimos, ingreso_bancario_centimos
           FROM central_sessions WHERE session_id = $1`,
        [sesion]
      );
      expect(Number(bien[0].ingreso_bancario_centimos)).toBe(0);
      expect(Number(bien[0].cambio_final_centimos)).toBe(35000);
    } finally {
      transporteCaja.registrarTransporte(null);
    }
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
        // Con fecha DE VERDAD y no a nulo: si se deja sin poner, comprobar que
        // Central la recibe compara null con null y no prueba nada.
        fechaIngreso: "2026-08-21",
      });
      await vaciar();

      const enRed = await queries.ingresosEnRed(EMPRESA, { registerId: caja });
      const proyectado = enRed.find((i) => i.depositId === ingreso.id);
      expect(proyectado).toBeTruthy();
      expect(proyectado!.importeCentimos).toBe(4000);
      expect(proyectado!.referencia).toBe("ABONO-123");

      /*
       * La fecha y el estado también, que es lo que se mira para conciliar con
       * el extracto. Sin esto, Central enseñaba el ingreso con la fecha en
       * blanco y nadie podía casarlo con el apunte del banco.
       */
      expect(ingreso.fechaIngreso).toBe("2026-08-21");
      expect(proyectado!.fecha).toBe("2026-08-21");
      expect(proyectado!.estado).toBe("CONFIRMADO");

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
   * Poner la fecha real del banco DESPUÉS, que es como ocurre: el ingreso se
   * registra al preparar la bolsa y la fecha se sabe al volver.
   *
   * Esta prueba cubre el camino que faltaba y por el que se coló el fallo: la
   * fila YA ESTÁ en Central. Antes, el reenvío del alta chocaba con ella y el
   * `ON CONFLICT` solo tocaba el estado, así que la fecha se quedaba vieja
   * para siempre y la caja decía «Confirmado» mientras Central decía
   * «Pendiente de confirmar».
   */
  it("la fecha del banco puesta después llega a Central, con la fila ya proyectada", async () => {
    transporteCaja.registrarTransporte(new TransporteLocal());
    try {
      const { rows: creada } = await db.query(
        `INSERT INTO cash_registers (empresa_id, centro, nombre, codigo, created_at_ms, updated_at_ms)
         VALUES ($1,'completar',$2,$3,$4,$4) RETURNING id`,
        [
          EMPRESA,
          `compl-${String(process.hrtime.bigint()).slice(-9)}`,
          `CP${String(process.hrtime.bigint()).slice(-6)}`,
          Date.now(),
        ]
      );
      const caja = creada[0].id;
      const { sesion } = await servicio.abrirJornada(ctx, { registerId: caja, fondoManual: [] });
      await servicio.registrarCobro(ctx, {
        sessionId: sesion.id,
        importeCentimos: 4000,
        formasPago: [{ forma: "CASH", importe: 4000 }],
        efectivoRecibido: [{ valor: 2000, cantidad: 2 }],
      });
      await servicio.guardarArqueo(ctx, {
        sessionId: sesion.id,
        contado: [{ valor: 2000, cantidad: 2 }],
      });
      // Todo al banco: no se deja cambio.
      await servicio.cerrarJornada(ctx, { sessionId: sesion.id, cambioFinal: [] });

      // Se registra SIN fecha: la bolsa está lista, nadie ha ido al banco aún.
      const ingreso = await ingresosCaja.crearIngreso(ctx, {
        registerId: caja,
        sessionIds: [sesion.id],
        importeCentimos: 4000,
      });
      await vaciar();

      const antes = (await queries.ingresosEnRed(EMPRESA, { registerId: caja })).find(
        (i) => i.depositId === ingreso.id
      );
      expect(antes?.fecha).toBeNull(); // pendiente de confirmar, y bien dicho

      // Y ahora se vuelve del banco y se apunta la fecha de verdad.
      await ingresosCaja.completarIngreso(ctx, {
        depositId: ingreso.id,
        fechaIngreso: "2026-08-27",
        referencia: "ABONO-REAL",
      });
      await vaciar();

      const despues = (await queries.ingresosEnRed(EMPRESA, { registerId: caja })).find(
        (i) => i.depositId === ingreso.id
      );
      expect(despues?.fecha).toBe("2026-08-27");
      expect(despues?.referencia).toBe("ABONO-REAL");
      expect(despues?.estado).toBe("CONFIRMADO");
    } finally {
      transporteCaja.registrarTransporte(null);
    }
  });

  /*
   * El reenvío sobre una fila QUE YA ESTÁ en Central.
   *
   * Es el camino que usa `scripts/central-reemitir-ingresos.ts` para reparar
   * lo que Central no vio en su momento, y el que estaba roto: el `ON CONFLICT`
   * solo tocaba el estado, así que la fecha se quedaba vieja y reenviar no
   * servía de nada. Sin esta prueba, la reparación vuelve a romperse sin que
   * nadie se entere.
   */
  it("reenviar el alta actualiza la fecha de un ingreso ya proyectado", async () => {
    const { rows: creada } = await db.query(
      `INSERT INTO cash_registers (empresa_id, centro, nombre, codigo, created_at_ms, updated_at_ms)
       VALUES ($1,'reenvio',$2,$3,$4,$4) RETURNING id`,
      [
        EMPRESA,
        `reenv-${String(process.hrtime.bigint()).slice(-9)}`,
        `RE${String(process.hrtime.bigint()).slice(-6)}`,
        Date.now(),
      ]
    );
    const caja = creada[0].id;
    const dep = Number(String(process.hrtime.bigint()).slice(-8));

    const alta = (fecha: string | null) =>
      ingest.ingerirEvento(
        evento({
          tipo: "BANK_DEPOSIT_CREATED",
          aggregateType: "REGISTER",
          aggregateId: caja,
          registerId: caja,
          sessionId: null,
          datos: { depositId: dep, numero: `RV-${dep}`, importeCentimos: 81500, fecha },
        })
      );

    // Así llegó en su día: sin la fecha del banco.
    await alta(null);
    const antes = (await queries.ingresosEnRed(EMPRESA, { registerId: caja })).find(
      (i) => i.depositId === dep
    );
    expect(antes?.fecha).toBeNull();

    // Y así lo reenvía el script, con la fecha que la caja ya tiene.
    await alta("2026-08-27");
    const despues = (await queries.ingresosEnRed(EMPRESA, { registerId: caja })).find(
      (i) => i.depositId === dep
    );
    expect(despues?.fecha).toBe("2026-08-27");

    // Y un reenvío SIN fecha no borra la que ya hay: solo rellena huecos.
    await alta(null);
    const tras = (await queries.ingresosEnRed(EMPRESA, { registerId: caja })).find(
      (i) => i.depositId === dep
    );
    expect(tras?.fecha).toBe("2026-08-27");
  });

  /*
   * Los filtros de la pantalla de ingresos.
   *
   * El del rango de fechas tiene una consecuencia que conviene dejar probada:
   * un ingreso SIN fecha del banco queda fuera de cualquier rango. Es lo
   * correcto —preguntar «qué se ingresó entre estos días» no puede devolver
   * algo que no se ha ingresado ningún día—, pero si no se dice, parece que se
   * ha perdido.
   */
  it("los ingresos se filtran por caja y por rango de fechas", async () => {
    const { rows: creada } = await db.query(
      `INSERT INTO cash_registers (empresa_id, centro, nombre, codigo, created_at_ms, updated_at_ms)
       VALUES ($1,'filtros',$2,$3,$4,$4) RETURNING id`,
      [
        EMPRESA,
        `filtro-${String(process.hrtime.bigint()).slice(-9)}`,
        `FL${String(process.hrtime.bigint()).slice(-6)}`,
        Date.now(),
      ]
    );
    const caja = creada[0].id;

    const alta = async (numero: string, fecha: string | null) => {
      const { rows } = await db.query(
        `INSERT INTO cash_bank_deposits
           (empresa_id, register_id, numero, estado, fecha_ingreso, importe_centimos,
            remanente_anterior_centimos, total_cierres_centimos, remanente_nuevo_centimos,
            creado_at_ms)
         VALUES ($1,$2,$3,'CONFIRMADO',$4::date,1000,0,1000,0,$5) RETURNING id`,
        [EMPRESA, caja, numero, fecha, Date.now()]
      );
      await ingest.ingerirEvento(
        evento({
          tipo: "BANK_DEPOSIT_CREATED",
          aggregateType: "REGISTER",
          aggregateId: caja,
          registerId: caja,
          sessionId: null,
          datos: { depositId: rows[0].id, numero, importeCentimos: 1000, fecha },
        })
      );
      return rows[0].id;
    };

    await alta(`F-ENE-${caja}`, "2026-01-15");
    await alta(`F-JUN-${caja}`, "2026-06-15");
    const sinFecha = await alta(`F-SIN-${caja}`, null);

    const deLaCaja = await queries.ingresosEnRed(EMPRESA, { registerId: caja });
    expect(deLaCaja).toHaveLength(3);

    const primerSemestre = await queries.ingresosEnRed(EMPRESA, {
      registerId: caja,
      desde: "2026-01-01",
      hasta: "2026-03-31",
    });
    expect(primerSemestre.map((i) => i.numero)).toEqual([`F-ENE-${caja}`]);

    // El que no tiene fecha no está en NINGÚN rango, y eso es lo correcto.
    const todoElAno = await queries.ingresosEnRed(EMPRESA, {
      registerId: caja,
      desde: "2026-01-01",
      hasta: "2026-12-31",
    });
    expect(todoElAno.map((i) => i.depositId)).not.toContain(sinFecha);
    expect(todoElAno).toHaveLength(2);
  });

  /*
   * El resguardo del ingreso, por la API de Central.
   *
   * Existe ruta propia porque la de la caja exige `cash.view` y un supervisor
   * de red puede no tenerlo. Lo que hay que demostrar es que **la empresa sale
   * de la sesión y no de la petición**: pedir el resguardo de otra empresa
   * cambiando el número tiene que no devolver nada.
   */
  it("el resguardo se genera para tu empresa y no para la de otro", async () => {
    const { rows: creada } = await db.query(
      `INSERT INTO cash_registers (empresa_id, centro, nombre, codigo, created_at_ms, updated_at_ms)
       VALUES ($1,'resguardo',$2,$3,$4,$4) RETURNING id`,
      [
        EMPRESA,
        `resg-${String(process.hrtime.bigint()).slice(-9)}`,
        `RG${String(process.hrtime.bigint()).slice(-6)}`,
        Date.now(),
      ]
    );
    const caja = creada[0].id;
    const { rows: dep } = await db.query(
      `INSERT INTO cash_bank_deposits
         (empresa_id, register_id, numero, estado, fecha_ingreso, importe_centimos,
          remanente_anterior_centimos, total_cierres_centimos, remanente_nuevo_centimos,
          creado_at_ms)
       VALUES ($1,$2,$3,'CONFIRMADO','2026-08-21',4000,0,4000,0,$4) RETURNING id`,
      [EMPRESA, caja, `RESG-${String(process.hrtime.bigint()).slice(-6)}`, Date.now()]
    );

    const { informeIngreso } = await import("../cash/report.ts");

    const pdf = await informeIngreso(EMPRESA, dep[0].id);
    expect(pdf.length).toBeGreaterThan(1000);
    // Un PDF de verdad y no una página de error: la firma va en los 5 primeros
    // bytes y es lo único que distingue un Buffer válido de uno cualquiera.
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");

    // Desde otra empresa, ese mismo ingreso no existe.
    await expect(
      informeIngreso("00000000-0000-4000-a000-0000000000ef", dep[0].id)
    ).rejects.toMatchObject({ codigo: "INGRESO_NO_ENCONTRADO" });
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

  /*
   * Fase 12: acceso máquina-a-máquina.
   *
   * Hasta aquí un programa tenía que usar la cuenta de una persona, con todos
   * sus permisos y la garantía de dejar de funcionar el día que esa persona se
   * fuera. Era el riesgo R8.
   */
  it("un cliente cambia su secreto por un testigo, y el secreto no se guarda", async () => {
    const { clientId, clientSecret } = await clientes.crearCliente(EMPRESA, "ERP de pruebas", [
      "read:network",
    ]);

    // De él solo queda la huella: una copia de la base no da acceso a nada.
    const { rows } = await db.query(
      `SELECT secreto_huella FROM central_api_clients WHERE client_id = $1`,
      [clientId]
    );
    expect(rows[0].secreto_huella).not.toBe(clientSecret);
    expect(rows[0].secreto_huella).toMatch(/^[0-9a-f]{64}$/);

    const testigo = await clientes.emitirTestigo(clientId, clientSecret);
    expect(testigo?.token_type).toBe("Bearer");
    expect(testigo?.scope).toBe("read:network");

    const ctxApi = await clientes.resolverTestigo(testigo!.access_token);
    expect(ctxApi?.empresaId).toBe(EMPRESA);
    expect(ctxApi?.alcances).toEqual(["read:network"]);
  });

  it("un secreto equivocado no da testigo, y un cliente que no existe tampoco", async () => {
    const { clientId } = await clientes.crearCliente(EMPRESA, "Otro", []);
    expect(await clientes.emitirTestigo(clientId, "me-lo-invento")).toBeNull();
    expect(await clientes.emitirTestigo("mc_noexiste", "loquesea")).toBeNull();
  });

  /*
   * Revocar tiene que cortar YA. Si los testigos vivos siguieran valiendo hasta
   * una hora, seguirían valiendo justo en el rato en el que a alguien le urge
   * cortar el acceso.
   */
  it("revocar un cliente invalida sus testigos en el momento", async () => {
    const { clientId, clientSecret } = await clientes.crearCliente(EMPRESA, "Revocable", [
      "read:network",
    ]);
    const testigo = await clientes.emitirTestigo(clientId, clientSecret);
    expect(await clientes.resolverTestigo(testigo!.access_token)).not.toBeNull();

    await clientes.revocarCliente(EMPRESA, clientId);

    expect(await clientes.resolverTestigo(testigo!.access_token)).toBeNull();
    expect(await clientes.emitirTestigo(clientId, clientSecret)).toBeNull();
  });

  it("un testigo caducado deja de valer", async () => {
    const { clientId, clientSecret } = await clientes.crearCliente(EMPRESA, "Caduca", []);
    const testigo = await clientes.emitirTestigo(clientId, clientSecret);

    await db.query(`UPDATE central_api_tokens SET expira_ms = $1 WHERE client_id = $2`, [
      Date.now() - 1000,
      clientId,
    ]);
    expect(await clientes.resolverTestigo(testigo!.access_token)).toBeNull();

    expect(await clientes.limpiarTestigos()).toBeGreaterThanOrEqual(1);
  });

  it("una incidencia nueva encola su webhook, y repetir no lo duplica", async () => {
    const { id } = await hooks.crearWebhook(EMPRESA, "https://ejemplo.test/mobilink", []);

    await hooks.encolarEvento(EMPRESA, "incident.opened", "incident:12345", { id: "12345" });
    await hooks.encolarEvento(EMPRESA, "incident.opened", "incident:12345", { id: "12345" });

    const { rows } = await db.query(
      `SELECT COUNT(*)::int AS n FROM central_webhook_deliveries
        WHERE webhook_id = $1 AND idempotency_key = 'incident:12345'`,
      [id]
    );
    expect(rows[0].n).toBe(1);
  });

  it("un webhook solo recibe los eventos a los que se suscribió", async () => {
    const { id } = await hooks.crearWebhook(EMPRESA, "https://ejemplo.test/solo-cierres", [
      "session.closed",
    ]);
    await hooks.encolarEvento(EMPRESA, "incident.opened", "otra-cosa", {});

    const { rows } = await db.query(
      `SELECT COUNT(*)::int AS n FROM central_webhook_deliveries WHERE webhook_id = $1`,
      [id]
    );
    expect(rows[0].n).toBe(0);
  });

  it("un webhook sin https se rechaza: por ahí viajan importes", async () => {
    await expect(hooks.crearWebhook(EMPRESA, "http://ejemplo.test/inseguro", [])).rejects.toThrow(
      /https/i
    );
  });

  /*
   * Fase 14: conciliación bancaria asistida.
   *
   * El lector de Norma 43 y el casador se prueban aparte y sin base de datos.
   * Lo que se comprueba aquí es lo que ellos no pueden: que un extracto que no
   * cuadra NO se guarde, y que un ingreso ya conciliado deje de ofrecerse.
   */
  const l80 = (s: string) => s.padEnd(80, " ");

  function extractoDePrueba(importeCentimos: number, fecha = "260503"): string {
    return [
      l80("11" + "0049" + "1500" + "0123456789" + "260501" + "260531" + "2" + "0".repeat(14)),
      l80(
        "22" + "00000000" + fecha + fecha + "12   " + "2" +
          String(importeCentimos).padStart(14, "0") + "0000000000" + "INGRESO CAJA"
      ),
      l80("33" + "0049" + "1500" + "0123456789".padEnd(43, "0") + "2" +
        String(importeCentimos).padStart(14, "0")),
    ].join("\n");
  }

  it("importa un extracto y propone la pareja del ingreso", async () => {
    // Un ingreso registrado en Central, como lo dejaría un cierre.
    await db.query(
      `INSERT INTO central_bank_deposits
         (deposit_id, empresa_id, numero, fecha, importe_centimos, estado, actualizado_en_ms)
       VALUES (900001, $1, 'TAR1-IB-26-901', '2026-05-03', 150000, 'CONFIRMADO', $2)
       ON CONFLICT (deposit_id) DO NOTHING`,
      [EMPRESA, Date.now()]
    );

    const r = await conciliacion.importarExtracto(
      { empresaId: EMPRESA, userId: null },
      "mayo.q43",
      extractoDePrueba(150000)
    );
    expect(r.cuadra).toBe(true);
    expect(r.apuntes).toBe(1);

    const p = await conciliacion.propuestas(EMPRESA, r.statementId!);
    expect(p.resumen.altas).toBe(1);
    expect(p.propuestas[0].candidatos[0].depositId).toBe(900001);

    // Se confirma, y a partir de ahí el ingreso deja de ofrecerse: ofrecer uno
    // ya casado es invitar a contarlo dos veces.
    await conciliacion.conciliar(
      { empresaId: EMPRESA, userId: null },
      p.propuestas[0].apunteId,
      900001
    );

    const despues = await conciliacion.propuestas(EMPRESA, r.statementId!);
    expect(despues.apuntes).toHaveLength(0);
  });

  /*
   * Un extracto incompleto conciliado a medias da por descuadrado lo que en
   * realidad estaba bien, y deshacerlo cuesta más que volver a pedir el fichero.
   */
  it("un extracto que no cuadra consigo mismo no se guarda", async () => {
    const roto = [
      l80("11" + "0049" + "1500" + "0123456789" + "260501" + "260531" + "2" + "0".repeat(14)),
      l80("22" + "00000000" + "260503" + "260503" + "12   " + "2" + "150000".padStart(14, "0")),
      l80("33" + "0049" + "1500" + "0123456789".padEnd(43, "0") + "2" + "999999".padStart(14, "0")),
    ].join("\n");

    const r = await conciliacion.importarExtracto(
      { empresaId: EMPRESA, userId: null },
      "roto.q43",
      roto
    );
    expect(r.statementId).toBeNull();
    expect(r.errores.join(" ")).toMatch(/no cuadra/i);

    // Se cuenta ESTE fichero, no todos: otras pruebas importan los suyos.
    const { rows } = await db.query(
      `SELECT COUNT(*)::int AS n FROM central_bank_statements
        WHERE empresa_id = $1 AND nombre_fichero = 'roto.q43'`,
      [EMPRESA]
    );
    expect(rows[0].n).toBe(0);
  });

  it("un apunte ajeno a la caja se descarta y deja de estorbar", async () => {
    const r = await conciliacion.importarExtracto(
      { empresaId: EMPRESA, userId: null },
      "comisiones.q43",
      extractoDePrueba(3300)
    );
    const p = await conciliacion.propuestas(EMPRESA, r.statementId!);
    expect(p.apuntes).toHaveLength(1);

    await conciliacion.descartar(
      { empresaId: EMPRESA, userId: null },
      p.apuntes[0].id,
      "Comisión de mantenimiento"
    );

    const despues = await conciliacion.propuestas(EMPRESA, r.statementId!);
    expect(despues.apuntes).toHaveLength(0);
  });

  it("un apunte ya conciliado no se puede volver a conciliar", async () => {
    await db.query(
      `INSERT INTO central_bank_deposits
         (deposit_id, empresa_id, numero, fecha, importe_centimos, estado, actualizado_en_ms)
       VALUES (900002, $1, 'TAR1-IB-26-902', '2026-05-03', 77700, 'CONFIRMADO', $2)
       ON CONFLICT (deposit_id) DO NOTHING`,
      [EMPRESA, Date.now()]
    );

    const r = await conciliacion.importarExtracto(
      { empresaId: EMPRESA, userId: null },
      "otro.q43",
      extractoDePrueba(77700)
    );
    const p = await conciliacion.propuestas(EMPRESA, r.statementId!);
    const apunte = p.propuestas[0].apunteId;

    await conciliacion.conciliar({ empresaId: EMPRESA, userId: null }, apunte, 900002);
    await expect(
      conciliacion.conciliar({ empresaId: EMPRESA, userId: null }, apunte, 900002)
    ).rejects.toThrow(/ya está conciliado/i);
  });

  /*
   * Fase 15: observabilidad.
   *
   * Un servicio que contesta «ok» mientras tiene ocho mil eventos sin enviar
   * miente con la verdad: el proceso vive, pero el sistema no funciona. Lo que
   * se comprueba aquí es que el atasco se ve.
   */
  /*
   * Esta prueba mira la FORMA, no el veredicto: el estado global depende de lo
   * que hayan dejado las demás pruebas en las colas, y afirmar «OK» aquí sería
   * un verde que se rompe según el orden en que se ejecute todo.
   */
  it("informa de las cuatro colas y del tiempo de respuesta de la base", async () => {
    const s = await observabilidad.salud();

    expect(s.colas.map((c) => c.nombre)).toEqual(
      expect.arrayContaining([
        "Eventos hacia Central",
        "Avisos por correo",
        "Webhooks",
        "Sincronización con la ERP",
      ])
    );
    expect(s.baseDeDatosMs).toBeGreaterThanOrEqual(0);
    expect(["OK", "DEGRADADO", "ATASCADO"]).toContain(s.estado);
  });

  /*
   * El retraso se mide en TIEMPO, no en filas. Cien pendientes de hace treinta
   * segundos es una tarde normal; tres desde hace dos días es una integración
   * rota, y el número de filas solo no distingue una cosa de la otra.
   */
  it("un pendiente viejo saca el sistema de OK, aunque sea uno solo", async () => {
    const { rows } = await db.query(
      `INSERT INTO central_notifications
         (empresa_id, incident_id, destino, asunto, cuerpo, creado_en_ms)
       VALUES ($1, 999999, 'x@y.test', 'a', 'b', $2) RETURNING id`,
      [EMPRESA, Date.now() - 3 * 60 * 60_000]
    );
    try {
      const s = await observabilidad.salud();
      const correo = s.colas.find((c) => c.nombre === "Avisos por correo")!;
      // Otras pruebas dejan avisos recientes en la cola; lo que importa aquí es
      // que el retraso lo marque el MÁS VIEJO, que es de hace tres horas.
      expect(correo.pendientes).toBeGreaterThanOrEqual(1);
      expect(correo.retrasoMinutos).toBeGreaterThanOrEqual(120);
      expect(correo.estado).toBe("ATASCADA");
      expect(s.estado).toBe("ATASCADO");
    } finally {
      await db.query(`DELETE FROM central_notifications WHERE id = $1`, [rows[0].id]);
    }
  });

  /*
   * Una fila en error terminal no se resuelve sola: es atasco desde el minuto
   * uno, por muy reciente y por muy poquitas que sean.
   */
  it("una sola fila en error terminal ya es atasco, aunque sea de hace un minuto", async () => {
    const { rows } = await db.query(
      `INSERT INTO central_notifications
         (empresa_id, incident_id, destino, asunto, cuerpo, estado, creado_en_ms)
       VALUES ($1, 999998, 'x@y.test', 'a', 'b', 'ERROR', $2) RETURNING id`,
      [EMPRESA, Date.now()]
    );
    try {
      const s = await observabilidad.salud();
      const correo = s.colas.find((c) => c.nombre === "Avisos por correo")!;
      expect(correo.enError).toBe(1);
      expect(correo.estado).toBe("ATASCADA");
    } finally {
      await db.query(`DELETE FROM central_notifications WHERE id = $1`, [rows[0].id]);
    }
  });

  /*
   * Fases 17 y 18: predicción y puntuación sobre datos reales.
   *
   * Los motores se prueban aparte y sin base de datos. Lo que se comprueba aquí
   * es lo que ellos no pueden: que las señales se lean de donde deben.
   */
  it("el historial de consumo sale del libro mayor, no de los totales", async () => {
    transporteCaja.registrarTransporte(new TransporteLocal());
    try {
      const { rows: creada } = await db.query(
        `INSERT INTO cash_registers (empresa_id, centro, nombre, created_at_ms, updated_at_ms)
         VALUES ($1,'prediccion',$2,$3,$3) RETURNING id`,
        [EMPRESA, `pre-${String(process.hrtime.bigint()).slice(-9)}`, Date.now()]
      );
      const caja = creada[0].id;
      await db.query(`UPDATE cash_registers SET codigo = 'PD' || id WHERE id = $1`, [caja]);

      const { sesion } = await servicio.abrirJornada(ctx, {
        registerId: caja,
        fondoManual: [
          { valor: 5000, cantidad: 2 },
          { valor: 100, cantidad: 30 },
        ],
      });

      /*
       * Un cobro de 50 € pagado con TARJETA no gasta calderilla. Si el
       * historial saliera de los totales de la jornada, este cobro inflaría la
       * predicción justo en los días de más facturación.
       */
      await servicio.registrarOperacion(ctx, {
        sessionId: sesion.id,
        tipo: "COLLECTION",
        importeCentimos: 5000,
        formasPago: [{ forma: "BBVA_CARD", importe: 5000, referencia: "0001" }],
      });

      // Y un cobro en efectivo que sí devuelve monedas.
      await servicio.registrarCobro(ctx, {
        sessionId: sesion.id,
        importeCentimos: 300,
        formasPago: [{ forma: "CASH", importe: 300 }],
        efectivoRecibido: [{ valor: 500, cantidad: 1 }],
      });

      await servicio.guardarArqueo(ctx, {
        sessionId: sesion.id,
        contado: await stockContado(sesion.id),
      });
      await servicio.cerrarJornada(ctx, {
        sessionId: sesion.id,
        cambioFinal: await stockContado(sesion.id),
      });

      const historial = await prediccion.historialDeCaja(EMPRESA, caja);
      expect(historial).toHaveLength(1);

      /*
       * Salieron 2 € en monedas de cambio, y solo eso.
       *
       * Ni el cobro con tarjeta —que no toca el cajón— ni el CAMBIO FINAL que
       * se deja para mañana. Lo segundo lo destapó esta prueba: contando todas
       * las salidas, una caja que cierra con 300 € en monedas parecía gastar
       * 300 € al día, y la predicción mandaba al banco a por un dinero que
       * estaba en el cajón.
       */
      expect(historial[0].calderillaCentimos).toBe(200);
    } finally {
      transporteCaja.registrarTransporte(null);
    }
  });

  it("una caja sin historia no se predice: se dice que no hay datos", async () => {
    const { rows } = await db.query(
      `INSERT INTO cash_registers (empresa_id, centro, nombre, created_at_ms, updated_at_ms)
       VALUES ($1,'nueva',$2,$3,$3) RETURNING id`,
      [EMPRESA, `nue-${String(process.hrtime.bigint()).slice(-9)}`, Date.now()]
    );
    const p = await prediccion.prediccionDeCaja(EMPRESA, rows[0].id);
    expect(p.confianza).toBe("SIN_DATOS");
    expect(p.irAlBancoAntesDe).toBeNull();
  });

  it("la salud de la red puntúa y separa las cajas sin datos", async () => {
    const s = await puntuacion.saludDeLaRed(EMPRESA);
    expect(s.conDatos + s.sinDatos).toBeGreaterThan(0);
    // Cada puntuación viene con sus motivos: un número solo no dice nada.
    for (const c of s.peores) {
      expect(Array.isArray(c.motivos)).toBe(true);
      expect(c.puntos).not.toBeNull();
    }
  });

  /*
   * Fase 21: traslados entre cajas.
   *
   * Lo que hay que demostrar es lo que la fase 19 no podía garantizar sin este
   * documento: que durante el viaje **el dinero no se cuenta dos veces**.
   */
  it("el dinero sale de una caja, viaja, y no está en las dos a la vez", async () => {
    transporteCaja.registrarTransporte(new TransporteLocal());
    try {
      const marca = String(process.hrtime.bigint()).slice(-9);
      const { rows: cajas } = await db.query(
        `INSERT INTO cash_registers (empresa_id, centro, nombre, created_at_ms, updated_at_ms)
         VALUES ($1,'traslado','orig-' || $2, $3, $3), ($1,'traslado','dest-' || $2, $3, $3)
         RETURNING id`,
        [EMPRESA, marca, Date.now()]
      );
      const [origen, destino] = cajas.map((c: { id: number }) => c.id);
      await db.query(`UPDATE cash_registers SET codigo = 'TR' || id WHERE id = ANY($1::int[])`, [
        [origen, destino],
      ]);

      const jOrigen = await servicio.abrirJornada(ctx, {
        registerId: origen,
        fondoManual: [{ valor: 100, cantidad: 100 }],
      });
      const jDestino = await servicio.abrirJornada(ctx, {
        registerId: destino,
        fondoManual: [{ valor: 5000, cantidad: 1 }],
      });

      const traslado = await trasladosCaja.enviar(ctx, {
        sessionId: jOrigen.sesion.id,
        destinoRegisterId: destino,
        piezas: [{ valor: 100, cantidad: 40 }],
        portador: "Nuria",
      });
      expect(traslado.estado).toBe("EN_TRANSITO");
      expect(traslado.importeCentimos).toBe(4000);

      /*
       * Durante el viaje: el origen ya NO lo tiene y el destino TODAVÍA no. La
       * suma de los dos cajones es 60 + 50 = 110 €, no 150: los 40 € están en
       * tránsito, contados una sola vez y en un sitio.
       */
      const stockOrigen = await servicio.stockDeJornada(jOrigen.sesion.id);
      const stockDestino = await servicio.stockDeJornada(jDestino.sesion.id);
      expect(stockOrigen.totalCentimos).toBe(6000);
      expect(stockDestino.totalCentimos).toBe(5000);

      await vaciar();
      const { rows: transito } = await db.query(
        `SELECT estado, importe_centimos, responsable FROM central_transits
          WHERE documento_id = $1 AND clase = 'TRANSFER'`,
        [traslado.id]
      );
      expect(transito[0].estado).toBe("ABIERTO");
      expect(Number(transito[0].importe_centimos)).toBe(4000);
      expect(transito[0].responsable).toBe("Nuria");

      const recibido = await trasladosCaja.recibir(ctx, traslado.id, {
        sessionId: jDestino.sesion.id,
      });
      expect(recibido.estado).toBe("RECIBIDO");

      const despues = await servicio.stockDeJornada(jDestino.sesion.id);
      expect(despues.totalCentimos).toBe(9000);

      await vaciar();
      const { rows: cerrado } = await db.query(
        `SELECT estado FROM central_transits WHERE documento_id = $1 AND clase = 'TRANSFER'`,
        [traslado.id]
      );
      expect(cerrado[0].estado).toBe("LIQUIDADO");
    } finally {
      transporteCaja.registrarTransporte(null);
    }
  });

  /*
   * Si llega de menos no se bloquea: el dinero ya está donde está, y negarse a
   * registrarlo solo esconde el problema. Se exige un motivo, como ya hace el
   * módulo con el banco y con las entregas.
   */
  it("si llega menos de lo que salió, exige motivo pero no se bloquea", async () => {
    transporteCaja.registrarTransporte(new TransporteLocal());
    try {
      const marca = String(process.hrtime.bigint()).slice(-9);
      const { rows: cajas } = await db.query(
        `INSERT INTO cash_registers (empresa_id, centro, nombre, created_at_ms, updated_at_ms)
         VALUES ($1,'dif','o-' || $2, $3, $3), ($1,'dif','d-' || $2, $3, $3) RETURNING id`,
        [EMPRESA, marca, Date.now()]
      );
      const [origen, destino] = cajas.map((c: { id: number }) => c.id);
      await db.query(`UPDATE cash_registers SET codigo = 'DF' || id WHERE id = ANY($1::int[])`, [
        [origen, destino],
      ]);

      const jO = await servicio.abrirJornada(ctx, {
        registerId: origen,
        fondoManual: [{ valor: 100, cantidad: 50 }],
      });
      const jD = await servicio.abrirJornada(ctx, { registerId: destino, fondoManual: [] });

      const t = await trasladosCaja.enviar(ctx, {
        sessionId: jO.sesion.id,
        destinoRegisterId: destino,
        piezas: [{ valor: 100, cantidad: 30 }],
        portador: "Iván",
      });

      await expect(
        trasladosCaja.recibir(ctx, t.id, {
          sessionId: jD.sesion.id,
          recibido: [{ valor: 100, cantidad: 28 }],
        })
      ).rejects.toMatchObject({ codigo: "FALTA_MOTIVO" });

      const r = await trasladosCaja.recibir(ctx, t.id, {
        sessionId: jD.sesion.id,
        recibido: [{ valor: 100, cantidad: 28 }],
        diferenciaMotivo: "Faltaban dos monedas al abrir la bolsa",
      });
      expect(r.recibidoCentimos).toBe(2800);
      expect(r.importeCentimos).toBe(3000);
    } finally {
      transporteCaja.registrarTransporte(null);
    }
  });

  it("un traslado no se recibe en una caja que no es su destino", async () => {
    transporteCaja.registrarTransporte(new TransporteLocal());
    try {
      const marca = String(process.hrtime.bigint()).slice(-9);
      const { rows: cajas } = await db.query(
        `INSERT INTO cash_registers (empresa_id, centro, nombre, created_at_ms, updated_at_ms)
         VALUES ($1,'x','a-' || $2, $3, $3), ($1,'x','b-' || $2, $3, $3), ($1,'x','c-' || $2, $3, $3)
         RETURNING id`,
        [EMPRESA, marca, Date.now()]
      );
      const [a, b, c] = cajas.map((x: { id: number }) => x.id);
      await db.query(`UPDATE cash_registers SET codigo = 'XX' || id WHERE id = ANY($1::int[])`, [
        [a, b, c],
      ]);

      const jA = await servicio.abrirJornada(ctx, {
        registerId: a,
        fondoManual: [{ valor: 100, cantidad: 10 }],
      });
      const jC = await servicio.abrirJornada(ctx, { registerId: c, fondoManual: [] });

      const t = await trasladosCaja.enviar(ctx, {
        sessionId: jA.sesion.id,
        destinoRegisterId: b,
        piezas: [{ valor: 100, cantidad: 5 }],
        portador: "Quien sea",
      });

      await expect(
        trasladosCaja.recibir(ctx, t.id, { sessionId: jC.sesion.id })
      ).rejects.toMatchObject({ codigo: "TRASLADO_DE_OTRA_CAJA" });
    } finally {
      transporteCaja.registrarTransporte(null);
    }
  });

  it("una caja no se manda dinero a sí misma, ni se traslada sin portador", async () => {
    const { rows } = await db.query(
      `INSERT INTO cash_registers (empresa_id, centro, nombre, created_at_ms, updated_at_ms)
       VALUES ($1,'solo','s-' || $2, $3, $3) RETURNING id`,
      [EMPRESA, String(process.hrtime.bigint()).slice(-9), Date.now()]
    );
    const caja = rows[0].id;
    await db.query(`UPDATE cash_registers SET codigo = 'SS' || id WHERE id = $1`, [caja]);
    const j = await servicio.abrirJornada(ctx, {
      registerId: caja,
      fondoManual: [{ valor: 100, cantidad: 10 }],
    });

    await expect(
      trasladosCaja.enviar(ctx, {
        sessionId: j.sesion.id,
        destinoRegisterId: caja,
        piezas: [{ valor: 100, cantidad: 1 }],
        portador: "Alguien",
      })
    ).rejects.toMatchObject({ codigo: "TRASLADO_A_LA_MISMA_CAJA" });

    await expect(
      trasladosCaja.enviar(ctx, {
        sessionId: j.sesion.id,
        destinoRegisterId: caja + 1,
        piezas: [{ valor: 100, cantidad: 1 }],
        portador: "   ",
      })
    ).rejects.toMatchObject({ codigo: "FALTA_PORTADOR" });
  });

  /*
   * Fase 23: el camino de vuelta.
   *
   * Sin él, un traslado que no se llega a hacer deja ese dinero en tránsito
   * para siempre, engordando la posición global con algo que en realidad está
   * en el cajón.
   */
  it("un traslado cancelado devuelve el dinero a la caja de la que salió", async () => {
    transporteCaja.registrarTransporte(new TransporteLocal());
    try {
      const marca = String(process.hrtime.bigint()).slice(-9);
      const { rows: cajas } = await db.query(
        `INSERT INTO cash_registers (empresa_id, centro, nombre, created_at_ms, updated_at_ms)
         VALUES ($1,'canc','co-' || $2, $3, $3), ($1,'canc','cd-' || $2, $3, $3) RETURNING id`,
        [EMPRESA, marca, Date.now()]
      );
      const [origen, destino] = cajas.map((c: { id: number }) => c.id);
      await db.query(`UPDATE cash_registers SET codigo = 'CN' || id WHERE id = ANY($1::int[])`, [
        [origen, destino],
      ]);

      const jO = await servicio.abrirJornada(ctx, {
        registerId: origen,
        fondoManual: [{ valor: 1000, cantidad: 10 }], // 100 €
      });

      const t = await trasladosCaja.enviar(ctx, {
        sessionId: jO.sesion.id,
        destinoRegisterId: destino,
        piezas: [{ valor: 1000, cantidad: 4 }],
        portador: "Nadie al final",
      });

      // Salieron 40 €: quedan 60.
      expect((await servicio.stockDeJornada(jO.sesion.id)).totalCentimos).toBe(6000);

      // Sin motivo no se cancela: el dinero ya había salido del cajón.
      await expect(
        trasladosCaja.cancelar(ctx, t.id, jO.sesion.id, "  ")
      ).rejects.toMatchObject({ codigo: "FALTA_MOTIVO" });

      const cancelado = await trasladosCaja.cancelar(
        ctx,
        t.id,
        jO.sesion.id,
        "El viaje se suspendió"
      );
      expect(cancelado.estado).toBe("CANCELADO");

      // Y vuelve entero: 100 € otra vez, con las mismas piezas.
      expect((await servicio.stockDeJornada(jO.sesion.id)).totalCentimos).toBe(10000);

      await vaciar();
      const { rows: transito } = await db.query(
        `SELECT estado FROM central_transits WHERE documento_id = $1 AND clase = 'TRANSFER'`,
        [t.id]
      );
      expect(transito[0].estado).toBe("LIQUIDADO");
    } finally {
      transporteCaja.registrarTransporte(null);
    }
  });

  /*
   * Vuelve a la caja de ORIGEN y no a cualquiera: lo contrario dejaría un
   * cuadre que no se puede explicar mirando el libro mayor.
   */
  it("un traslado cancelado no se puede devolver a otra caja", async () => {
    transporteCaja.registrarTransporte(new TransporteLocal());
    try {
      const marca = String(process.hrtime.bigint()).slice(-9);
      const { rows: cajas } = await db.query(
        `INSERT INTO cash_registers (empresa_id, centro, nombre, created_at_ms, updated_at_ms)
         VALUES ($1,'cx','x-' || $2, $3, $3), ($1,'cx','y-' || $2, $3, $3) RETURNING id`,
        [EMPRESA, marca, Date.now()]
      );
      const [origen, otra] = cajas.map((c: { id: number }) => c.id);
      await db.query(`UPDATE cash_registers SET codigo = 'CX' || id WHERE id = ANY($1::int[])`, [
        [origen, otra],
      ]);

      const jO = await servicio.abrirJornada(ctx, {
        registerId: origen,
        fondoManual: [{ valor: 1000, cantidad: 5 }],
      });
      const jOtra = await servicio.abrirJornada(ctx, { registerId: otra, fondoManual: [] });

      const t = await trasladosCaja.enviar(ctx, {
        sessionId: jO.sesion.id,
        destinoRegisterId: otra,
        piezas: [{ valor: 1000, cantidad: 2 }],
        portador: "Alguien",
      });

      await expect(
        trasladosCaja.cancelar(ctx, t.id, jOtra.sesion.id, "Devolver aquí")
      ).rejects.toMatchObject({ codigo: "TRASLADO_DE_OTRA_CAJA" });
    } finally {
      transporteCaja.registrarTransporte(null);
    }
  });

  /*
   * Fase 24: que las señales nuevas lleguen a alguien.
   *
   * La predicción y el estado de las colas estaban en sus pantallas, esperando
   * a que alguien las mirase. Con una regla, avisan solas.
   */
  it("una cola atascada abre incidencia sin que nadie mire la pantalla", async () => {
    await reglas.guardarRegla(
      { empresaId: EMPRESA, userId: null },
      { tipo: "COLA_ATASCADA_MINUTOS", ambito: "EMPRESA", umbral: 60 }
    );

    // Un aviso pendiente de hace tres horas: la cola lleva parada ese rato.
    const { rows } = await db.query(
      `INSERT INTO central_notifications
         (empresa_id, incident_id, destino, asunto, cuerpo, creado_en_ms)
       VALUES ($1, 999777, 'x@y.test', 'a', 'b', $2) RETURNING id`,
      [EMPRESA, Date.now() - 3 * 60 * 60_000]
    );

    try {
      await reglas.evaluar(EMPRESA);
      const bandeja = await reglas.listarIncidencias(EMPRESA);
      const atasco = bandeja.find((i) => i.tipo === "COLA_ATASCADA_MINUTOS");
      expect(atasco).toBeTruthy();
      expect(atasco!.valor).toBeGreaterThanOrEqual(180);
    } finally {
      await db.query(`DELETE FROM central_notifications WHERE id = $1`, [rows[0].id]);
    }
  });

  /*
   * El cierre automático de esta incidencia NO se comprueba aquí, y conviene
   * decir por qué en vez de dejar una prueba que a veces falla.
   *
   * El retraso de la cola es de toda la instalación, no de esta empresa: lo
   * marca el evento pendiente más viejo, venga de donde venga. En una base
   * donde otras pruebas han dejado eventos sin enviar —que es lo normal— la
   * cola está atascada de verdad, así que la incidencia **debe** seguir
   * abierta y afirmar lo contrario sería un verde que depende de qué se haya
   * ejecutado antes.
   *
   * El mecanismo de cierre automático ya está probado con el tránsito, que sí
   * se controla de principio a fin («el aviso de dinero fuera se cierra solo
   * cuando el dinero vuelve»), y es el mismo código para los dos.
   */

  /*
   * Predecir cuesta —una consulta por caja sobre el libro mayor—, así que solo
   * se hace si alguien ha pedido ese aviso. Una empresa que no lo use no paga
   * por él en cada vuelta del ciclo.
   */
  it("sin regla de autonomía, evaluar no predice nada", async () => {
    const r = await reglas.evaluar(EMPRESA);
    expect(r.evaluadas).toBeGreaterThan(0);

    const conAutonomia = (await reglas.listarIncidencias(EMPRESA)).filter(
      (i) => i.tipo === "AUTONOMIA_DIAS"
    );
    expect(conAutonomia).toHaveLength(0);
  });
});

/** Lo contado en una jornada, a partir del stock teórico. */
async function stockContado(sessionId: number) {
  const { lineas } = await servicio.stockDeJornada(sessionId);
  return lineas.filter((l) => l.cantidad > 0);
}
