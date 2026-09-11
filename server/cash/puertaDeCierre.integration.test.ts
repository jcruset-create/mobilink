/**
 * La puerta del cotejo, contra base de datos de verdad.
 *
 * Lo que decide se prueba aparte y sin base de datos, en
 * `domain/puertaDeCierre.test.ts`. Aquí se prueban las tres costuras que allí
 * no se pueden ver, y que son justo donde esto se rompería:
 *
 *   1. Que la caja que NO lo exige cierra como toda la vida. Es lo que impide
 *      que esta regla tumbe a los mostradores que no facturan por Genes.
 *   2. Que la huella que calcula la base de datos cambia con lo que tiene que
 *      cambiar: un cobro más caduca el cotejo de verdad, no en teoría.
 *   3. Que forzar deja el motivo escrito en la jornada. Un cierre forzado que
 *      no se pueda ver después no vigila nada.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";

const RUN = process.env.RUN_DB_TESTS === "1" && !!process.env.DATABASE_URL;

process.env.CASH_STORAGE_LOCAL = "1";

let db: typeof import("../db.ts").default;
let servicio: typeof import("./service.ts");
let registro: typeof import("./cotejoRegistro.ts");

const EMPRESA = "00000000-0000-4000-a000-0000000000e8";
const ctx = { empresaId: EMPRESA, userId: null as string | null };

const sufijo = String(process.hrtime.bigint()).slice(-9);

beforeAll(async () => {
  if (!RUN) return;
  db = (await import("../db.ts")).default;
  await (await import("./schema.ts")).initCash();
  servicio = await import("./service.ts");
  registro = await import("./cotejoRegistro.ts");

  await db.query(
    `INSERT INTO cash_payment_methods
       (empresa_id, codigo, nombre, afecta_efectivo, activa, orden, created_at_ms, updated_at_ms)
     VALUES ($1,'CASH','Efectivo',true,true,1,$2,$2)`,
    [EMPRESA, Date.now()]
  );
}, 180_000);

afterAll(async () => {
  if (!RUN) return;
  await db.query(`DELETE FROM cash_payment_methods WHERE empresa_id = $1`, [EMPRESA]);
});

/** Una caja con su jornada abierta y 300 € de fondo, lista para cerrar. */
async function jornadaNueva(exigeCotejo: boolean) {
  const { rows } = await db.query(
    `INSERT INTO cash_registers
       (empresa_id, centro, nombre, activa, exigir_cotejo_erp, created_at_ms, updated_at_ms)
     VALUES ($1,'Centro',$2,true,$3,$4,$4) RETURNING id`,
    [EMPRESA, `Puerta ${sufijo}-${process.hrtime.bigint()}`, exigeCotejo, Date.now()]
  );
  const caja = rows[0].id as number;
  const sesion = (
    await servicio.abrirJornada(ctx, {
      registerId: caja,
      fondoManual: [{ valor: 5000, cantidad: 6 }],
    })
  ).sesion.id;
  return { caja, sesion };
}

/** El arqueo que respalda el cierre: se cuenta exactamente lo que hay. */
async function arquear(sesion: number) {
  const teorico = await servicio.stockDeJornada(sesion);
  await servicio.guardarArqueo(ctx, { sessionId: sesion, contado: teorico.lineas });
  return teorico;
}

const cerrar = (sesion: number, teorico: { lineas: { valor: number; cantidad: number }[] }, motivo?: string) =>
  servicio.cerrarJornada(ctx, {
    sessionId: sesion,
    cambioFinal: teorico.lineas,
    motivoSinCotejo: motivo,
  });

describe.runIf(RUN)("la puerta del cotejo al cerrar", () => {
  it("la caja que NO lo exige cierra como siempre", async () => {
    /*
     * LA PRUEBA QUE PROTEGE A TODO EL MUNDO. Hay mostradores que no facturan
     * contra Genes; si esta regla se aplicara a todos, se quedarían sin poder
     * cerrar por algo que no les toca. Apagado es el valor por defecto y tiene
     * que seguir comportándose como antes de existir esto.
     */
    const { sesion } = await jornadaNueva(false);
    const teorico = await arquear(sesion);

    const cierre = await cerrar(sesion, teorico);
    expect(cierre.sesion.estado).toBe("CLOSED");
    expect(cierre.cierreForzado).toBe(false);
  });

  it("la que sí lo exige no cierra sin haber cotejado", async () => {
    const { sesion } = await jornadaNueva(true);
    const teorico = await arquear(sesion);

    await expect(cerrar(sesion, teorico)).rejects.toMatchObject({ codigo: "FALTA_COTEJO" });
  });

  it("con el cotejo en verde y al día, cierra sin forzar nada", async () => {
    const { sesion } = await jornadaNueva(true);
    const teorico = await arquear(sesion);
    await registro.registrarCotejo(EMPRESA, sesion, null, informeQueCuadra());

    const cierre = await cerrar(sesion, teorico);
    expect(cierre.sesion.estado).toBe("CLOSED");
    expect(cierre.cierreForzado).toBe(false);
  });

  it("un cobro después del cotejo lo caduca, y la huella lo nota", async () => {
    /*
     * La costura de verdad: que la huella la calcula una consulta, y que esa
     * consulta se mueve cuando se mueve la jornada. En el dominio esto se
     * prueba con dos cadenas; aquí, metiendo un cobro.
     */
    const { sesion } = await jornadaNueva(true);
    await registro.registrarCotejo(EMPRESA, sesion, null, informeQueCuadra());
    expect((await registro.estadoDelCotejo(EMPRESA, sesion)).caducado).toBe(false);

    await servicio.registrarCobro(ctx, {
      sessionId: sesion,
      importeCentimos: 5000,
      formasPago: [{ forma: "CASH", importe: 5000 }],
      efectivoRecibido: [{ valor: 5000, cantidad: 1 }],
      concepto: "Un cobro de después",
      partyNombre: "Cliente",
    });

    expect((await registro.estadoDelCotejo(EMPRESA, sesion)).caducado).toBe(true);

    const teorico = await arquear(sesion);
    await expect(cerrar(sesion, teorico)).rejects.toMatchObject({ codigo: "COTEJO_CADUCADO" });
  });

  it("forzar deja el motivo escrito en la jornada", async () => {
    /*
     * Un cierre forzado que no se pueda ver después no vigila nada: la nota
     * sale en el histórico, al lado de las cifras, que es donde alguien se
     * pregunta por qué esta jornada no cuadra.
     */
    const { sesion } = await jornadaNueva(true);
    const teorico = await arquear(sesion);

    const cierre = await cerrar(sesion, teorico, "El lector de capturas no responde");
    expect(cierre.sesion.estado).toBe("CLOSED");
    expect(cierre.cierreForzado).toBe(true);

    const { rows } = await db.query(`SELECT notas FROM cash_sessions WHERE id = $1`, [sesion]);
    expect(rows[0].notas).toContain("Cerrada sin el OK del cotejo");
    expect(rows[0].notas).toContain("El lector de capturas no responde");
  });

  it("un motivo en blanco no abre la puerta", async () => {
    const { sesion } = await jornadaNueva(true);
    const teorico = await arquear(sesion);

    await expect(cerrar(sesion, teorico, "   ")).rejects.toMatchObject({
      codigo: "FALTA_COTEJO",
    });
  });

  it("una lectura bloqueante se apunta, pero NO vale como cotejo", async () => {
    /*
     * Pegar una captura que no se ha podido leer no es haber cotejado. Queda
     * apuntado —sirve para entender un cierre forzado— pero la puerta sigue
     * cerrada.
     */
    const { sesion } = await jornadaNueva(true);
    await registro.registrarCotejo(EMPRESA, sesion, null, null);

    const estado = await registro.estadoDelCotejo(EMPRESA, sesion);
    expect(estado.falta).toBe(false);
    expect(estado.cuadra).toBe(false);

    const teorico = await arquear(sesion);
    await expect(cerrar(sesion, teorico)).rejects.toMatchObject({ codigo: "COTEJO_NO_CUADRA" });
  });
});

/** Un informe que cuadra, con lo mínimo que `registrarCotejo` mira. */
function informeQueCuadra() {
  return {
    emparejadas: [],
    soloEnErp: [],
    soloEnMobilink: [],
    ambiguas: [],
    discrepanciasDeForma: [],
    formasSinEquivalencia: [],
    formasAmbiguas: [],
    formasPorRecorte: [],
    totales: {
      erpCobros: 0,
      erpPagos: 0,
      mobilinkCobros: 0,
      mobilinkPagos: 0,
      diferenciaCobros: 0,
      diferenciaPagos: 0,
    },
    cuadra: true,
  };
}
