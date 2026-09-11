/**
 * La tabla de equivalencias con el ERP, contra base de datos de verdad.
 *
 * Lo que se prueba no es que se guarden dos columnas: es que esta tabla **no se
 * pueda ensuciar**, porque de ella depende que un cobro por tarjeta no se
 * cuente como caja. Una equivalencia mala no revienta el cotejo: lo hace
 * mentir, y el descuadre aparece en el arqueo de la tarde sin nada que lo
 * explique.
 *
 * Las cuatro reglas:
 *
 *   1. La etiqueta se guarda NORMALIZADA, siempre igual, la escriba quien la
 *      escriba. Si no, la misma forma entra dos veces y el cotejo falla a ratos.
 *   2. Una etiqueta no puede significar dos cosas. Volver a guardarla la
 *      reapunta; no crea una segunda.
 *   3. No se puede apuntar a una forma de cobro que no existe.
 *   4. Una forma dada de baja NO borra su equivalencia, pero se marca: el
 *      cotejo tiene que poder decir por qué algo dejó de emparejar.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { cotejar, etiquetaNormalizada } from "./domain/cotejo.ts";

/**
 * El modelo, falseado.
 *
 * Lo que interesa probar del recorrido entero NO es que OpenAI sepa leer una
 * tabla —eso ni se puede fijar en una prueba, porque la respuesta cambia— sino
 * lo de alrededor: que las operaciones de la jornada salgan bien de la base,
 * que las formas mixtas se partan en líneas, y que una lectura bloqueante NO
 * llegue a cotejarse.
 *
 * Con el modelo de verdad, esta prueba dependería de la red, de una clave y de
 * que el modelo tuviera hoy el mismo día que ayer.
 */
const respuestaDelModelo = { texto: "" };
vi.mock("../core/openaiService.ts", () => ({
  pedirIA: async () => ({
    ok: respuestaDelModelo.texto !== "",
    texto: respuestaDelModelo.texto,
    modelo: "falso",
    duracionMs: 0,
    error: respuestaDelModelo.texto === "" ? "sin clave" : undefined,
  }),
  hayIA: () => true,
}));

const RUN = process.env.RUN_DB_TESTS === "1" && !!process.env.DATABASE_URL;

process.env.CASH_STORAGE_LOCAL = "1";

let db: typeof import("../db.ts").default;
let config: typeof import("./config.ts");
let servicio: typeof import("./service.ts");
let cotejoErp: typeof import("./cotejoErp.ts");
let caja = 0;
let sesion = 0;

const EMPRESA = "00000000-0000-4000-a000-0000000000e7";
const ctx = { empresaId: EMPRESA, userId: null as string | null };

/** Único por ejecución: la base se reutiliza entre pasadas. */
const sufijo = String(process.hrtime.bigint()).slice(-9);
const FORMA = `CLEARONE_${sufijo}`;

beforeAll(async () => {
  if (!RUN) return;
  db = (await import("../db.ts")).default;
  await (await import("./schema.ts")).initCash();
  config = await import("./config.ts");

  /*
   * El catálogo de esta empresa, sembrado AQUÍ y no dentro de un test.
   *
   * Lo tenía una prueba y eso ataba el orden: la de las formas mixtas fallaba
   * si se ejecutaba antes que la que creaba el efectivo. Un test que depende de
   * que otro haya pasado primero es un test que un día falla solo.
   *
   * Efectivo hay UNO, por el índice único parcial sobre `afecta_efectivo`.
   */
  await db.query(
    `INSERT INTO cash_payment_methods
       (empresa_id, codigo, nombre, afecta_efectivo, activa, orden, created_at_ms, updated_at_ms)
     VALUES ($1,$2,$3,false,true,10,$5,$5),
            ($1,'CASH','Efectivo',true,true,1,$5,$5),
            ($1,$4,'Tarjeta',false,true,20,$5,$5)`,
    [EMPRESA, FORMA, `Datáfono ${sufijo}`, `TARJETA_${sufijo}`, Date.now()]
  );

  servicio = await import("./service.ts");
  cotejoErp = await import("./cotejoErp.ts");

  const { rows } = await db.query(
    `INSERT INTO cash_registers (empresa_id, centro, nombre, activa, created_at_ms, updated_at_ms)
     VALUES ($1,'Centro',$2,true,$3,$3) RETURNING id`,
    [EMPRESA, `Cotejo ${sufijo}`, Date.now()]
  );
  caja = rows[0].id;
  sesion = (
    await servicio.abrirJornada(ctx, {
      registerId: caja,
      fondoManual: [{ valor: 5000, cantidad: 10 }],
    })
  ).sesion.id;
}, 180_000);

afterAll(async () => {
  if (!RUN) return;
  await db.query(`DELETE FROM cash_erp_payment_map WHERE empresa_id = $1`, [EMPRESA]);
  await db.query(`DELETE FROM cash_payment_methods WHERE empresa_id = $1`, [EMPRESA]);
});

const CAPTURA = "data:image/png;base64,iVBORw0KGgo=";

describe.runIf(RUN)("Equivalencias con el ERP", () => {
  it("la etiqueta se guarda normalizada, la escriba quien la escriba", async () => {
    const e = await config.guardarEquivalenciaErp(ctx, {
      etiquetaErp: "  datáfono   clearone ta...  ",
      formaPago: FORMA,
    });
    expect(e.etiquetaErp).toBe("DATÁFONO CLEARONE TA...");
    expect(e.formaPago).toBe(FORMA);
    expect(e.formaVigente).toBe(true);
  });

  it("volver a guardarla la REAPUNTA, no crea una segunda", async () => {
    /*
     * Es lo que se espera al corregir un mapeo desde la pantalla. Sin el
     * upsert habría que borrar y crear para cambiar una letra, y mientras
     * tanto el cotejo se quedaría sin esa equivalencia.
     */
    await config.guardarEquivalenciaErp(ctx, { etiquetaErp: "CONTADO", formaPago: FORMA });
    await config.guardarEquivalenciaErp(ctx, { etiquetaErp: "contado", formaPago: "CASH" });

    const todas = await config.listarEquivalenciasErp(EMPRESA);
    const contado = todas.filter((e) => e.etiquetaErp === "CONTADO");
    expect(contado).toHaveLength(1);
    expect(contado[0]!.formaPago).toBe("CASH");
  });

  it("no se puede apuntar a una forma de cobro que no existe", async () => {
    /*
     * No hay clave ajena —el catálogo es editable y no debe tumbar
     * equivalencias— así que la comprobación se hace aquí. Sin ella se
     * guardaría una equivalencia que no empareja nunca y no dice por qué.
     */
    await expect(
      config.guardarEquivalenciaErp(ctx, { etiquetaErp: "TPV LO QUE SEA", formaPago: "NO_EXISTE" })
    ).rejects.toMatchObject({ codigo: "FORMA_NO_ENCONTRADA" });

    const todas = await config.listarEquivalenciasErp(EMPRESA);
    expect(todas.some((e) => e.etiquetaErp === "TPV LO QUE SEA")).toBe(false);
  });

  it("una etiqueta vacía no entra", async () => {
    await expect(
      config.guardarEquivalenciaErp(ctx, { etiquetaErp: "   ", formaPago: FORMA })
    ).rejects.toMatchObject({ codigo: "ENTRADA_NO_VALIDA" });
  });

  it("si la forma se da de baja, la equivalencia SIGUE pero sale marcada", async () => {
    /*
     * Esconderla sería lo cómodo y lo peor: el cotejo dejaría de emparejar esas
     * líneas y en Configuración no habría ni rastro de por qué.
     */
    const baja = `BAJA_${sufijo}`;
    await db.query(
      `INSERT INTO cash_payment_methods
         (empresa_id, codigo, nombre, afecta_efectivo, activa, orden, created_at_ms, updated_at_ms)
       VALUES ($1,$2,'Una que se dará de baja',false,true,30,$3,$3)`,
      [EMPRESA, baja, Date.now()]
    );
    await config.guardarEquivalenciaErp(ctx, { etiquetaErp: "TPV VIEJO", formaPago: baja });

    await db.query(
      `UPDATE cash_payment_methods SET activa = false WHERE empresa_id = $1 AND codigo = $2`,
      [EMPRESA, baja]
    );

    const e = (await config.listarEquivalenciasErp(EMPRESA)).find(
      (x) => x.etiquetaErp === "TPV VIEJO"
    );
    expect(e).toBeDefined();
    expect(e!.formaVigente).toBe(false);
    expect(e!.formaNombre).toBe("Una que se dará de baja");
  });

  it("si la forma se BORRA del catálogo, la equivalencia tampoco desaparece", async () => {
    /*
     * Esto y lo de arriba no son el mismo caso, y confundirlos me costó una
     * prueba que no valía.
     *
     * Dar de BAJA deja la fila en `cash_payment_methods`, así que un JOIN
     * normal la encuentra igual y la equivalencia sale de todas formas.
     * BORRARLA la quita, y ahí es donde el LEFT JOIN es lo único que impide
     * que la equivalencia se esfume de la pantalla — dejando un cotejo que no
     * empareja esas líneas y una Configuración sin rastro de por qué.
     */
    const fantasma = `FANTASMA_${sufijo}`;
    await db.query(
      `INSERT INTO cash_payment_methods
         (empresa_id, codigo, nombre, afecta_efectivo, activa, orden, created_at_ms, updated_at_ms)
       VALUES ($1,$2,'La que se borrará',false,true,40,$3,$3)`,
      [EMPRESA, fantasma, Date.now()]
    );
    await config.guardarEquivalenciaErp(ctx, { etiquetaErp: "TPV BORRADO", formaPago: fantasma });

    await db.query(`DELETE FROM cash_payment_methods WHERE empresa_id = $1 AND codigo = $2`, [
      EMPRESA,
      fantasma,
    ]);

    const e = (await config.listarEquivalenciasErp(EMPRESA)).find(
      (x) => x.etiquetaErp === "TPV BORRADO"
    );
    expect(e, "la equivalencia tiene que seguir saliendo").toBeDefined();
    expect(e!.formaNombre).toBeNull();
    expect(e!.formaVigente).toBe(false);
    /* Y sigue apuntando al código, para que se pueda ver a qué apuntaba. */
    expect(e!.formaPago).toBe(fantasma);
  });

  it("se puede borrar, y solo de la propia empresa", async () => {
    const e = await config.guardarEquivalenciaErp(ctx, {
      etiquetaErp: "PARA BORRAR",
      formaPago: FORMA,
    });
    await expect(
      config.borrarEquivalenciaErp({ empresaId: "00000000-0000-4000-a000-00000000ffff", userId: null }, e.id)
    ).rejects.toMatchObject({ codigo: "NO_ENCONTRADA" });

    await config.borrarEquivalenciaErp(ctx, e.id);
    const todas = await config.listarEquivalenciasErp(EMPRESA);
    expect(todas.some((x) => x.id === e.id)).toBe(false);
  });

  it("el mapa que sale de la base LO ENTIENDE el cotejo", async () => {
    /*
     * La comprobación que ata las dos mitades, y la que de verdad importa.
     *
     * El servicio normaliza al guardar y `cotejar` normaliza al buscar, cada
     * uno en su fichero. Nada obliga a que lo hagan igual — salvo que las dos
     * llamen a `etiquetaNormalizada`, que es justo lo que se comprueba aquí
     * con datos que han pasado por la base de datos de verdad.
     */
    await config.guardarEquivalenciaErp(ctx, {
      etiquetaErp: "  TPV   Caixa  ",
      formaPago: FORMA,
    });
    const mapa = await config.mapaEquivalenciasErp(EMPRESA);

    const informe = cotejar(
      /* Tal cual la leería el modelo de la captura: con otras mayúsculas. */
      [{ formaErp: "tpv caixa", importeCentimos: 5000, tipo: "COBRO" }],
      [{ id: 1, numero: "A", formaCodigo: FORMA, importeCentimos: 5000, tipo: "COBRO" }],
      mapa
    );
    expect(informe.emparejadas).toHaveLength(1);
    expect(informe.formasSinEquivalencia).toEqual([]);
  });

  it("cada empresa ve solo las suyas", async () => {
    const otra = "00000000-0000-4000-a000-0000000000e8";
    await db.query(
      `INSERT INTO cash_erp_payment_map
         (empresa_id, etiqueta_erp, forma_pago, created_at_ms, updated_at_ms)
       VALUES ($1,'DE OTRA EMPRESA','X',$2,$2)`,
      [otra, Date.now()]
    );
    const mias = await config.listarEquivalenciasErp(EMPRESA);
    expect(mias.some((e) => e.etiquetaErp === "DE OTRA EMPRESA")).toBe(false);
    await db.query(`DELETE FROM cash_erp_payment_map WHERE empresa_id = $1`, [otra]);
  });
});

describe.runIf(RUN)("El recorrido entero: captura → lectura → cotejo", () => {
  /**
   * Un cobro en la jornada, con las formas que se le pasen.
   *
   * La parte en efectivo lleva su detalle de piezas, que el dominio exige: el
   * libro mayor apunta monedas, no importes. Se usan billetes de 5 € y por eso
   * los importes de estas pruebas son múltiplos de 500.
   */
  const cobrar = (formas: { forma: string; importe: number }[], referencia?: string) => {
    const efectivo = formas.filter((f) => f.forma === "CASH").reduce((a, f) => a + f.importe, 0);
    return servicio.registrarOperacion(ctx, {
      sessionId: sesion,
      tipo: "COLLECTION",
      importeCentimos: formas.reduce((a, f) => a + f.importe, 0),
      formasPago: formas.map((f) => ({ forma: f.forma, importe: f.importe })),
      ...(efectivo > 0 ? { efectivoRecibido: [{ valor: 500, cantidad: efectivo / 500 }] } : {}),
      concepto: referencia ?? "prueba",
      referencia,
    });
  };

  const capturaCon = (lineas: unknown[], totalCobros: string) =>
    JSON.stringify({ lineas, totalCobros, totalPagos: "0" });

  it("una lectura BLOQUEANTE no llega a cotejarse", async () => {
    /*
     * La regla que evita el peor caso. Con una lectura que ya se sabe mala, el
     * cotejo diría «falta este cobro» por una línea que el modelo no supo leer,
     * y alguien acabaría metiéndola dos veces.
     */
    respuestaDelModelo.texto = capturaCon(
      [{ forma: "CONTADO", importe: "10,00", tipo: "COBRO" }],
      "99,00" // el total impreso NO cuadra con la línea
    );
    const r = await cotejoErp.cotejarCapturaErp(EMPRESA, { sessionId: sesion, imagen: CAPTURA });
    expect(r.lectura.bloqueante).toBe(true);
    expect(r.informe).toBeNull();
  });

  it("una captura sin total SÍ se coteja, con su aviso", async () => {
    respuestaDelModelo.texto = JSON.stringify({
      lineas: [{ forma: "NO CONFIGURADA", importe: "10,00", tipo: "COBRO" }],
      totalCobros: null,
      totalPagos: null,
    });
    const r = await cotejoErp.cotejarCapturaErp(EMPRESA, { sessionId: sesion, imagen: CAPTURA });
    expect(r.lectura.bloqueante).toBe(false);
    expect(r.informe).not.toBeNull();
    expect(r.lectura.avisos.length).toBeGreaterThan(0);
  });

  it("una operación con formas MIXTAS sale como varias líneas", async () => {
    /*
     * El ERP las apunta por separado —en la captura del 10/09, RAMON BERENGUER
     * tiene un CONTADO y un TPV CAIXA—, así que juntarlas daría un importe que
     * no existe en ninguno de los dos sitios.
     */
    const op = await cobrar(
      [
        { forma: "CASH", importe: 3000 },
        { forma: FORMA, importe: 2000 },
      ],
      `MIX-${sufijo}`
    );
    expect(op).toBeTruthy();

    const lineas = await cotejoErp.operacionesDeJornada(EMPRESA, sesion);
    const suyas = lineas.filter((l) => l.referencia === `MIX-${sufijo}`);
    expect(suyas).toHaveLength(2);
    expect(suyas.map((l) => l.importeCentimos).sort()).toEqual([2000, 3000]);
  });

  it("cotejo completo: lo que cuadra, lo que falta y lo que sobra", async () => {
    await config.guardarEquivalenciaErp(ctx, { etiquetaErp: "CONTADO", formaPago: "CASH" });

    await cobrar([{ forma: "CASH", importe: 1500 }], `CUADRA-${sufijo}`);
    await cobrar([{ forma: "CASH", importe: 1000 }], `SOBRA-${sufijo}`);

    respuestaDelModelo.texto = capturaCon(
      [
        { forma: "CONTADO", importe: "15,00", tipo: "COBRO", referencia: `CUADRA-${sufijo}` },
        { forma: "CONTADO", importe: "77,00", tipo: "COBRO", referencia: `FALTA-${sufijo}` },
      ],
      "92,00"
    );

    const r = await cotejoErp.cotejarCapturaErp(EMPRESA, { sessionId: sesion, imagen: CAPTURA });
    expect(r.lectura.bloqueante).toBe(false);
    const inf = r.informe!;

    expect(inf.emparejadas.some((e) => e.erp.referencia === `CUADRA-${sufijo}`)).toBe(true);
    expect(inf.soloEnErp.some((l) => l.referencia === `FALTA-${sufijo}`)).toBe(true);
    expect(inf.soloEnMobilink.some((l) => l.referencia === `SOBRA-${sufijo}`)).toBe(true);
    expect(inf.cuadra).toBe(false);
  });

  it("una captura que no es una imagen se rechaza antes de llamar al modelo", async () => {
    respuestaDelModelo.texto = capturaCon([], "0");
    await expect(
      cotejoErp.cotejarCapturaErp(EMPRESA, { sessionId: sesion, imagen: "no soy una imagen" })
    ).rejects.toMatchObject({ codigo: "IMAGEN_NO_VALIDA" });
  });

  it("si el servicio de lectura no responde, lo dice por su nombre", async () => {
    /* Y no como un problema de la captura: si no, quien lo lea se pondrá a
       recortar la imagen otra vez para nada. */
    respuestaDelModelo.texto = "";
    await expect(
      cotejoErp.cotejarCapturaErp(EMPRESA, { sessionId: sesion, imagen: CAPTURA })
    ).rejects.toMatchObject({ codigo: "IA_NO_DISPONIBLE" });
  });
});

describe("la normalización de la etiqueta", () => {
  it("colapsa espacios y sube a mayúsculas", () => {
    expect(etiquetaNormalizada("  datáfono   clearone  ")).toBe("DATÁFONO CLEARONE");
  });

  it("conserva los puntos suspensivos con los que el ERP corta la etiqueta", () => {
    /* Forman parte de lo que se ve en pantalla, que es lo que el usuario copia. */
    expect(etiquetaNormalizada("Datáfono Clearone ta...")).toBe("DATÁFONO CLEARONE TA...");
  });
});
