/**
 * Conceptos de gasto y a qué se imputan, contra base de datos de verdad.
 *
 * Lo que se prueba aquí no es que se guarden dos números: es que la
 * clasificación **no se pueda ensuciar**. Una estadística de gasto solo sirve
 * si nadie ha podido meterle una fila incoherente, y esas filas no entran por
 * la pantalla —que enseña lo que toca— sino por la API.
 *
 * Las cuatro reglas:
 *
 *   1. El destino tiene que ser del TIPO que pide el concepto. «Dietas» pide
 *      persona: un centro de coste ahí sumaría en el desglose sin que se note.
 *   2. Un destino sin concepto no significa nada y no entra.
 *   3. Nada de esto es obligatorio: un pago sin clasificar se registra igual.
 *   4. Es de GASTO: un cobro no lo acepta, ni siquiera en silencio.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";

const RUN = process.env.RUN_DB_TESTS === "1" && !!process.env.DATABASE_URL;

process.env.CASH_STORAGE_LOCAL = "1";

let db: typeof import("../db.ts").default;
let servicio: typeof import("./service.ts");
let config: typeof import("./config.ts");

const EMPRESA = "00000000-0000-4000-a000-0000000000e5";
const ctx = { empresaId: EMPRESA, userId: null as string | null };

/** Único por ejecución: la base se reutiliza entre pasadas. */
const sufijo = String(process.hrtime.bigint()).slice(-9);

const FONDO = [
  { valor: 5000, cantidad: 4 },
  { valor: 2000, cantidad: 5 },
];

let caja = 0;
let sesion = 0;

beforeAll(async () => {
  if (!RUN) return;
  db = (await import("../db.ts")).default;
  await (await import("./schema.ts")).initCash();
  servicio = await import("./service.ts");
  config = await import("./config.ts");

  const { rows } = await db.query(
    `INSERT INTO cash_registers (empresa_id, centro, nombre, activa, created_at_ms, updated_at_ms)
     VALUES ($1,'Centro',$2,true,$3,$3) RETURNING id`,
    [EMPRESA, `Gastos ${sufijo}`, Date.now()]
  );
  caja = rows[0].id;
  sesion = (await servicio.abrirJornada(ctx, { registerId: caja, fondoManual: FONDO })).sesion.id;
}, 180_000);

afterAll(async () => {
  if (!RUN) return;
  await db.query(`DELETE FROM cash_expense_targets WHERE empresa_id = $1`, [EMPRESA]);
  await db.query(`DELETE FROM cash_expense_concepts WHERE empresa_id = $1`, [EMPRESA]);
});

/** Un pago pequeño, con lo que se le quiera colgar de clasificación. */
const pagar = (extra: Record<string, unknown> = {}) =>
  servicio.registrarOperacion(ctx, {
    sessionId: sesion,
    tipo: "PAYMENT",
    importeCentimos: 2000,
    formasPago: [{ forma: "CASH", importe: 2000 }],
    efectivoEntregado: [{ valor: 2000, cantidad: 1 }],
    concepto: "prueba",
    ...extra,
  });

describe.runIf(RUN)("Conceptos de gasto · catálogo", () => {
  it("el código sale del nombre y aguanta acentos", async () => {
    const c = await config.crearConcepto(ctx, {
      nombre: `Ferretería ${sufijo}`,
      tipoDestino: "CENTRO_COSTE",
    });
    expect(c.codigo).toBe(`FERRETERIA_${sufijo}`);
    expect(c.tipoDestino).toBe("CENTRO_COSTE");
    expect(c.activo).toBe(true);
  });

  it("dos conceptos con el mismo nombre no se pisan: el segundo falla", async () => {
    const nombre = `Repetido ${sufijo}`;
    await config.crearConcepto(ctx, { nombre });
    await expect(config.crearConcepto(ctx, { nombre })).rejects.toMatchObject({
      codigo: "CONCEPTO_DUPLICADO",
    });
  });

  it("renombrar NO cambia el código, que es lo que queda en el histórico", async () => {
    const c = await config.crearConcepto(ctx, { nombre: `Dietas ${sufijo}`, tipoDestino: "PERSONA" });
    const r = await config.actualizarConcepto(ctx, c.id, {
      nombre: `Dietas y desplazamientos ${sufijo}`,
    });
    expect(r.nombre).toContain("desplazamientos");
    /*
     * Si el código cambiara, las estadísticas de años anteriores dejarían de
     * cuadrar con las de este: mismo gasto, dos etiquetas.
     */
    expect(r.codigo).toBe(c.codigo);
  });
});

describe.runIf(RUN)("la clasificación no se puede ensuciar", () => {
  let dietas = 0;
  let ferreteria = 0;
  let varios = 0;
  let juan = 0;
  let unidadMovil = 0;

  beforeAll(async () => {
    dietas = (await config.crearConcepto(ctx, { nombre: `D${sufijo}`, tipoDestino: "PERSONA" })).id;
    ferreteria = (
      await config.crearConcepto(ctx, { nombre: `F${sufijo}`, tipoDestino: "CENTRO_COSTE" })
    ).id;
    varios = (await config.crearConcepto(ctx, { nombre: `V${sufijo}`, tipoDestino: "NINGUNO" })).id;
    juan = (await config.crearDestino(ctx, { nombre: `Juan ${sufijo}`, tipo: "PERSONA" })).id;
    unidadMovil = (
      await config.crearDestino(ctx, { nombre: `Unidad movil ${sufijo}`, tipo: "CENTRO_COSTE" })
    ).id;
  });

  it("la pareja correcta se guarda", async () => {
    const r = await pagar({ expenseConceptId: dietas, expenseTargetId: juan });
    const { rows } = await db.query(
      `SELECT expense_concept_id, expense_target_id FROM cash_operations WHERE id = $1`,
      [r.operacionId]
    );
    expect(rows[0].expense_concept_id).toBe(dietas);
    expect(rows[0].expense_target_id).toBe(juan);
  });

  it("un centro de coste NO vale para un concepto que pide persona", async () => {
    /*
     * Ésta es la regla que sostiene el desglose por destino. Sin ella, «gasto
     * en dietas por operario» sumaría una unidad móvil entre las personas y
     * nadie lo vería mirando el total, que seguiría cuadrando.
     */
    await expect(pagar({ expenseConceptId: dietas, expenseTargetId: unidadMovil })).rejects.toMatchObject(
      { codigo: "DESTINO_NO_VALIDO" }
    );
  });

  it("ni una persona para uno que pide centro de coste", async () => {
    await expect(pagar({ expenseConceptId: ferreteria, expenseTargetId: juan })).rejects.toMatchObject({
      codigo: "DESTINO_NO_VALIDO",
    });
  });

  it("un concepto que no se imputa a nadie rechaza el destino", async () => {
    await expect(pagar({ expenseConceptId: varios, expenseTargetId: juan })).rejects.toMatchObject({
      codigo: "ENTRADA_NO_VALIDA",
    });
  });

  it("un destino SIN concepto no entra", async () => {
    await expect(pagar({ expenseTargetId: juan })).rejects.toMatchObject({
      codigo: "ENTRADA_NO_VALIDA",
    });
  });

  it("un concepto desactivado no admite pagos nuevos", async () => {
    const c = await config.crearConcepto(ctx, { nombre: `Baja ${sufijo}` });
    await config.actualizarConcepto(ctx, c.id, { activo: false });
    await expect(pagar({ expenseConceptId: c.id })).rejects.toMatchObject({
      codigo: "CONCEPTO_INACTIVO",
    });
  });

  it("un destino desactivado tampoco", async () => {
    const d = await config.crearDestino(ctx, { nombre: `Se fue ${sufijo}`, tipo: "PERSONA" });
    await config.actualizarDestino(ctx, d.id, { activo: false });
    await expect(pagar({ expenseConceptId: dietas, expenseTargetId: d.id })).rejects.toMatchObject({
      codigo: "DESTINO_INACTIVO",
    });
  });

  it("el concepto de otra empresa no existe para ésta", async () => {
    const { rows } = await db.query(
      `INSERT INTO cash_expense_concepts
         (empresa_id, codigo, nombre, tipo_destino, activo, orden, created_at_ms, updated_at_ms)
       VALUES ('00000000-0000-4000-a000-0000000000ff',$1,'Ajeno','NINGUNO',true,0,$2,$2)
       RETURNING id`,
      [`AJENO_${sufijo}`, Date.now()]
    );
    await expect(pagar({ expenseConceptId: rows[0].id })).rejects.toMatchObject({
      codigo: "CONCEPTO_NO_ENCONTRADO",
    });
  });
});

describe.runIf(RUN)("clasificar no es obligatorio", () => {
  it("un pago sin concepto se registra igual", async () => {
    /*
     * Es la decisión de producto y conviene que esté probada: obligar a
     * clasificar pararía el mostrador el día que falte una entrada del
     * catálogo, y lo que se rellenaría entonces sería lo primero que hubiera a
     * mano.
     */
    const r = await pagar();
    const { rows } = await db.query(
      `SELECT expense_concept_id FROM cash_operations WHERE id = $1`,
      [r.operacionId]
    );
    expect(rows[0].expense_concept_id).toBeNull();
  });

  it("un concepto sin destino también, aunque el concepto pida uno", async () => {
    const dietas = await config.crearConcepto(ctx, {
      nombre: `SinDestino ${sufijo}`,
      tipoDestino: "PERSONA",
    });
    const r = await pagar({ expenseConceptId: dietas.id });
    const { rows } = await db.query(
      `SELECT expense_concept_id, expense_target_id FROM cash_operations WHERE id = $1`,
      [r.operacionId]
    );
    expect(rows[0].expense_concept_id).toBe(dietas.id);
    expect(rows[0].expense_target_id).toBeNull();
  });
});

describe.runIf(RUN)("es un catálogo de GASTO", () => {
  it("un cobro no admite concepto, y lo dice en vez de ignorarlo", async () => {
    const c = await config.crearConcepto(ctx, { nombre: `Cobro ${sufijo}` });
    /*
     * Aceptarlo y no guardarlo daría una pantalla que parece clasificar y unas
     * estadísticas que no lo ven — el peor de los dos mundos.
     */
    await expect(
      servicio.registrarOperacion(ctx, {
        sessionId: sesion,
        tipo: "COLLECTION",
        importeCentimos: 1000,
        formasPago: [{ forma: "CASH", importe: 1000 }],
        efectivoRecibido: [{ valor: 1000, cantidad: 1 }],
        expenseConceptId: c.id,
      })
    ).rejects.toMatchObject({ codigo: "ENTRADA_NO_VALIDA" });
  });
});

describe.runIf(RUN)("lo ya usado no se reinterpreta", () => {
  it("no se puede cambiar a qué se imputa un concepto que ya tiene pagos", async () => {
    const c = await config.crearConcepto(ctx, { nombre: `Usado ${sufijo}`, tipoDestino: "PERSONA" });
    await pagar({ expenseConceptId: c.id });

    /*
     * Cambiarlo dejaría los pagos anteriores colgando de un operario desde un
     * concepto que ya no admite operarios: el total seguiría cuadrando y el
     * desglose mezclaría personas con centros de coste.
     */
    await expect(
      config.actualizarConcepto(ctx, c.id, { tipoDestino: "CENTRO_COSTE" })
    ).rejects.toMatchObject({ codigo: "CONCEPTO_EN_USO" });

    // Renombrarlo y desactivarlo sí se puede: eso no reinterpreta nada.
    const r = await config.actualizarConcepto(ctx, c.id, { nombre: `Usado bis ${sufijo}`, activo: false });
    expect(r.activo).toBe(false);
  });
});
