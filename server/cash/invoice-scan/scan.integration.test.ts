/**
 * El escaneo entero contra PostgreSQL, SIN llamar a ningún proveedor de IA.
 *
 * El extractor entra por parámetro, así que aquí se le pasa uno que devuelve
 * lo que un modelo debería sacar de la factura B0020000580. Lo que se prueba
 * es todo lo demás, que es lo que puede romperse sin que nadie se entere: las
 * reglas de la empresa, el catálogo, los duplicados, el rastro, y sobre todo
 * que escanear NO cobra.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";

const RUN = process.env.RUN_DB_TESTS === "1" && !!process.env.DATABASE_URL;

process.env.CASH_STORAGE_LOCAL = "1";

const EMPRESA = "00000000-0000-4000-a000-000000000001";
const USUARIO = "00000000-0000-4000-a000-0000000000aa";
const ctx = { empresaId: EMPRESA, userId: USUARIO, ip: "127.0.0.1" };

let db: typeof import("../../db.ts").default;
let escaneo: typeof import("./service.ts");
let config: typeof import("../config.ts");
let servicio: typeof import("../service.ts");
let esquema: typeof import("../schema.ts");
/** Un PDF de verdad, mínimo: lo que importa es que la firma sea la buena. */
const PDF = Buffer.from(
  "%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n",
  "latin1"
);

/** La extracción que un modelo debe sacar de B0020000580. */
function extraccion580(): import("./types.ts").ExtraccionCruda {
  return {
    es_factura: true,
    facturas_detectadas: 1,
    factura: { numero: "B0020000580", fecha: "27/08/2026" },
    cliente: { codigo: "2979", nombre: "CARLOS GONZALEZ CABALLERO", nif: "78048667F" },
    vehiculo: { marca: "NISSAN", modelo: "IVERA", matricula: "9655JYL" },
    concepto: "NISSAN IVERA · 9655JYL · Cambio de aceite y filtro",
    totales: {
      base_imponible: "161,24",
      iva_importe: "33,86 €",
      iva_porcentaje: "21,00%",
      total: "195,10 EUR",
      moneda: "EUR",
    },
    recibo: {
      detectado: true,
      recibos_detectados: 1,
      plantilla: "INTEGRADO_ERP",
      importe: "195,10",
      tipo_operacion: "VENTA",
      tarjeta: "************7394",
      num_operacion: "179.307",
      cod_autorizacion: "369389",
      comercio: "702",
      terminal: "1",
      red: "Servired",
      adquirente: null,
      cuenta: "BBVA",
      fecha_hora: "2026-08-27 - 11:23:21.0000000",
      texto: "Recibo Cliente de Pago por TPV ... LBL : Visa CaixaBank ... Ticket : 24.935",
    },
    confianza: { numero_factura: 0.99, cliente: 0.98, total: 0.99, concepto: 0.86, recibo: 0.97 },
  };
}

/** Sin resguardo: la factura B0020000576, que se cobró en efectivo. */
function extraccionSinRecibo(): import("./types.ts").ExtraccionCruda {
  const base = extraccion580();
  return {
    ...base,
    factura: { numero: `SIN-TPV-${String(process.hrtime.bigint()).slice(-8)}`, fecha: "26/08/2026" },
    cliente: { codigo: "CC0890255", nombre: "SALA COMAS CARLOS", nif: "39821791M" },
    recibo: {
      ...base.recibo,
      detectado: false,
      recibos_detectados: 0,
      plantilla: "DESCONOCIDA",
      importe: null,
      comercio: null,
      terminal: null,
      cuenta: null,
      texto: null,
    },
    confianza: { ...base.confianza, recibo: 0 },
  };
}

const fichero = (nombre = "factura.pdf") => ({
  originalname: nombre,
  mimetype: "application/pdf",
  buffer: PDF,
});

/** Escanea con una extracción dada, sin tocar la red. */
async function escanear(cruda: import("./types.ts").ExtraccionCruda, nombre?: string) {
  return escaneo.escanearFactura(
    { empresaId: EMPRESA, userId: USUARIO, sessionId: null, fichero: fichero(nombre) },
    async () => cruda
  );
}

beforeAll(async () => {
  if (!RUN) return;
  db = (await import("../../db.ts")).default;
  esquema = await import("../schema.ts");
  escaneo = await import("./service.ts");
  config = await import("../config.ts");
  servicio = await import("../service.ts");
  await esquema.initCash();
  // El catálogo se siembra al consultarlo, y con él la regla de CaixaBank.
  await config.listarFormasPago(EMPRESA);
  await config.listarReglasPago(EMPRESA);
});

afterAll(async () => {
  if (RUN && db) await db.end();
});

describe.runIf(RUN)("escaneo de factura", () => {
  it("rellena los cuatro campos de la pantalla", async () => {
    const p = await escanear(extraccion580(), "B0020000580.pdf");
    expect(p.referencia.valor).toBe("B0020000580");
    expect(p.importeCentimos.valor).toBe(19510);
    expect(p.cliente.valor).toBe("CARLOS GONZALEZ CABALLERO");
    expect(p.concepto.valor).toContain("9655JYL");
    expect(p.importeCuadra).toBe(true);
  });

  it("NO registra ningún cobro: solo propone", async () => {
    /*
     * La prueba de la regla 3, hecha con los datos y no con la fe: se cuentan
     * las operaciones de la empresa antes y después de escanear.
     */
    const antes = await db.query(`SELECT COUNT(*)::int AS n FROM cash_operations WHERE empresa_id=$1`, [EMPRESA]);
    await escanear(extraccion580());
    const despues = await db.query(`SELECT COUNT(*)::int AS n FROM cash_operations WHERE empresa_id=$1`, [EMPRESA]);
    expect(despues.rows[0].n).toBe(antes.rows[0].n);
  });

  it("deja rastro de lo que propuso, para poder investigarlo después", async () => {
    const p = await escanear(extraccion580());
    const { rows } = await db.query(
      `SELECT * FROM cash_invoice_scans WHERE id = $1 AND empresa_id = $2`,
      [p.scanId, EMPRESA]
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].operation_id).toBe(null); // escanear no obliga a cobrar
    expect(rows[0].sha256).toHaveLength(64);
    expect(rows[0].extraccion_cruda.factura.numero).toBe("B0020000580");
    expect(rows[0].extraccion_normalizada.totales.totalCentimos).toBe(19510);
  });

  it("el número de tarjeta entero NO llega a la base de datos", async () => {
    // Del recibo solo pueden entrar los cuatro últimos, en ningún sitio más.
    const p = await escanear(extraccion580());
    const { rows } = await db.query(`SELECT * FROM cash_invoice_scans WHERE id = $1`, [p.scanId]);
    expect(rows[0].extraccion_normalizada.recibo.tarjetaUltimos4).toBe("7394");
    expect(JSON.stringify(rows[0].extraccion_normalizada)).not.toContain("************7394");
  });
});

describe.runIf(RUN)("la ausencia de TPV no es una respuesta", () => {
  it("una factura sin resguardo no se propone como efectivo", async () => {
    const p = await escanear(extraccionSinRecibo());
    expect(p.formaCobro.formaPago).toBe(null);
    expect(p.formaCobro.autoSeleccionar).toBe(false);
    expect(p.avisos.some((a) => a.codigo === "SIN_EVIDENCIA_DE_PAGO")).toBe(true);
  });

  it("y aun así rellena el resto: el trabajo se ahorra igual", async () => {
    const p = await escanear(extraccionSinRecibo());
    expect(p.cliente.valor).toBe("SALA COMAS CARLOS");
    expect(p.importeCentimos.valor).toBe(19510);
  });
});

describe.runIf(RUN)("reglas de la empresa", () => {
  it("la de CaixaBank viene sembrada, porque no depende del taller", async () => {
    const reglas = await config.listarReglasPago(EMPRESA);
    const caixa = reglas.find((r) => r.patron === "Comercia Global Payments");
    expect(caixa?.formaPago).toBe("CAIXABANK_CARD");
    expect(caixa?.campo).toBe("ADQUIRENTE");
  });

  it("una regla de comercio propone la forma configurada", async () => {
    const codigo = `TPVX${String(process.hrtime.bigint()).slice(-5)}`;
    await config.crearFormaPago(ctx, { codigo, nombre: "TPV de prueba" });
    const comercio = String(process.hrtime.bigint()).slice(-6);
    const regla = await config.crearReglaPago(ctx, {
      campo: "COMERCIO",
      patron: comercio,
      formaPago: codigo,
      confianza: 0.97,
      prioridad: 5,
    });

    const cruda = extraccion580();
    cruda.recibo.comercio = comercio;
    const p = await escanear(cruda);
    expect(p.formaCobro.formaPago).toBe(codigo);
    expect(p.formaCobro.reglaId).toBe(regla.id);
    expect(p.formaCobro.autoSeleccionar).toBe(true);

    // Se deja como estaba: el catálogo y las reglas son de toda la empresa.
    await config.borrarReglaPago(ctx, regla.id);
  });

  it("una regla a una forma que no está en el catálogo se rechaza al crearla", async () => {
    await expect(
      config.crearReglaPago(ctx, {
        campo: "COMERCIO",
        patron: "999999",
        formaPago: "NO_EXISTE_ESTA",
      })
    ).rejects.toMatchObject({ codigo: "FORMA_NO_ENCONTRADA" });
  });

  it("un patrón de un solo carácter se rechaza: casaría con casi todo", async () => {
    await expect(
      config.crearReglaPago(ctx, { campo: "TEXTO", patron: "a", formaPago: "CASH" })
    ).rejects.toMatchObject({ codigo: "ENTRADA_NO_VALIDA" });
  });

  it("dos reglas iguales no pueden convivir", async () => {
    const patron = `REPE${String(process.hrtime.bigint()).slice(-6)}`;
    const r = await config.crearReglaPago(ctx, { campo: "TEXTO", patron, formaPago: "CASH" });
    await expect(
      config.crearReglaPago(ctx, { campo: "TEXTO", patron, formaPago: "CASH" })
    ).rejects.toMatchObject({ codigo: "REGLA_REPETIDA" });
    await config.borrarReglaPago(ctx, r.id);
  });
});

describe.runIf(RUN)("duplicados", () => {
  it("avisa si esa factura ya está cobrada, y deja de preseleccionar", async () => {
    const caja = await config.crearCaja(ctx, {
      nombre: `escaner-${String(process.hrtime.bigint()).slice(-6)}`,
      centro: "tarragona",
    } as never);
    const { sesion } = await servicio.abrirJornada(ctx, {
      registerId: caja.id,
      fondoManual: [{ valor: 5000, cantidad: 4, cartuchos: 0, bolsas: 0 }],
    } as never);

    const referencia = `DUP-${String(process.hrtime.bigint()).slice(-8)}`;
    await servicio.registrarCobro(ctx, {
      sessionId: sesion.id,
      importeCentimos: 19510,
      formasPago: [{ forma: "CAIXABANK_CARD", importe: 19510, referencia }],
      efectivoRecibido: [],
      partyNombre: "CARLOS GONZALEZ CABALLERO",
      concepto: "Cobro previo",
      referencia,
    } as never);

    const cruda = extraccion580();
    cruda.factura.numero = referencia;
    const p = await escanear(cruda);

    const aviso = p.avisos.find((a) => a.codigo === "POSIBLE_DUPLICADO");
    expect(aviso).toBeDefined();
    expect(aviso!.mensaje).toContain(referencia);
    // Avisa, no bloquea: la propuesta sigue ahí, pero nadie la marca sola.
    expect(p.formaCobro.autoSeleccionar).toBe(false);
  });

  it("una factura nueva no da falso positivo", async () => {
    const cruda = extraccion580();
    cruda.factura.numero = `NUEVA-${String(process.hrtime.bigint()).slice(-8)}`;
    const p = await escanear(cruda);
    expect(p.avisos.some((a) => a.codigo === "POSIBLE_DUPLICADO")).toBe(false);
  });
});

describe.runIf(RUN)("ficheros que no son lo que dicen ser", () => {
  it("un fichero que se declara PDF pero no lo es se rechaza", async () => {
    await expect(
      escaneo.escanearFactura(
        {
          empresaId: EMPRESA,
          userId: USUARIO,
          sessionId: null,
          fichero: {
            originalname: "factura.pdf",
            mimetype: "application/pdf",
            buffer: Buffer.from("esto es un ejecutable, no una factura"),
          },
        },
        async () => extraccion580()
      )
    ).rejects.toMatchObject({ codigo: "FORMATO_NO_ADMITIDO" });
  });

  it("un fichero vacío se rechaza antes de mandarlo a ningún sitio", async () => {
    await expect(
      escaneo.escanearFactura(
        {
          empresaId: EMPRESA,
          userId: USUARIO,
          sessionId: null,
          fichero: { originalname: "v.pdf", mimetype: "application/pdf", buffer: Buffer.alloc(0) },
        },
        async () => {
          throw new Error("no se debería haber llamado al extractor");
        }
      )
    ).rejects.toMatchObject({ codigo: "ENTRADA_NO_VALIDA" });
  });

  it("un JPG de verdad se acepta aunque venga mal etiquetado", async () => {
    // El mostrador escanea con lo que tiene; lo que manda es la firma.
    const jpg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 1)]);
    const p = await escaneo.escanearFactura(
      {
        empresaId: EMPRESA,
        userId: USUARIO,
        sessionId: null,
        fichero: { originalname: "foto", mimetype: "application/octet-stream", buffer: jpg },
      },
      async (doc) => {
        expect(doc.mime).toBe("image/jpeg");
        return extraccion580();
      }
    );
    expect(p.referencia.valor).toBe("B0020000580");
  });
});

describe.runIf(RUN)("qué hizo la persona con lo propuesto", () => {
  it("se anota al confirmar, y sin eso no se sabría si acertó", async () => {
    const caja = await config.crearCaja(ctx, {
      nombre: `escaner-fin-${String(process.hrtime.bigint()).slice(-6)}`,
      centro: "tarragona",
    } as never);
    const { sesion } = await servicio.abrirJornada(ctx, {
      registerId: caja.id,
      fondoManual: [{ valor: 5000, cantidad: 4, cartuchos: 0, bolsas: 0 }],
    } as never);

    const cruda = extraccion580();
    cruda.factura.numero = `FIN-${String(process.hrtime.bigint()).slice(-8)}`;
    const p = await escanear(cruda);

    const cobro = await servicio.registrarCobro(ctx, {
      sessionId: sesion.id,
      importeCentimos: 19510,
      // Con tarjeta: la caja de la prueba solo tiene billetes de 50 y no
      // podría devolver los 4,90 € de cambio de un pago en efectivo.
      formasPago: [{ forma: "CAIXABANK_CARD", importe: 19510, referencia: "TPV" }],
      efectivoRecibido: [],
      partyNombre: "CARLOS GONZALEZ CABALLERO",
      concepto: "Cambio de aceite",
      referencia: cruda.factura.numero,
    } as never);

    await escaneo.anotarConfirmacion(p.scanId, EMPRESA, {
      operationId: cobro.operacionId,
      formaPagoFinal: "CAIXABANK_CARD",
      camposCorregidos: ["concepto"],
    });

    const { rows } = await db.query(`SELECT * FROM cash_invoice_scans WHERE id = $1`, [p.scanId]);
    expect(rows[0].operation_id).toBe(cobro.operacionId);
    expect(rows[0].forma_pago_final).toBe("CAIXABANK_CARD");
    expect(rows[0].campos_corregidos).toEqual(["concepto"]);
  });

  it("anotar un escaneo de otra empresa no hace nada", async () => {
    const p = await escanear(extraccion580());
    await escaneo.anotarConfirmacion(p.scanId, "00000000-0000-4000-a000-0000000000ff", {
      operationId: 1,
      formaPagoFinal: "CASH",
      camposCorregidos: [],
    });
    const { rows } = await db.query(`SELECT operation_id FROM cash_invoice_scans WHERE id = $1`, [p.scanId]);
    expect(rows[0].operation_id).toBe(null);
  });
});

describe.runIf(RUN)("cuando el escaneo no sale", () => {
  it("un fallo del proveedor deja rastro y se propaga", async () => {
    /*
     * El rastro del que falla es el que más falta hace: cuando alguien dice
     * «a mí no me lee las facturas», esto es lo que hay que poder mirar.
     */
    const antes = await db.query(
      `SELECT COUNT(*)::int AS n FROM cash_invoice_scans WHERE empresa_id=$1 AND error IS NOT NULL`,
      [EMPRESA]
    );

    await expect(
      escaneo.escanearFactura(
        { empresaId: EMPRESA, userId: USUARIO, sessionId: null, fichero: fichero("rota.pdf") },
        async () => {
          throw new Error("el proveedor ha devuelto 503");
        }
      )
    ).rejects.toThrow("503");

    const despues = await db.query(
      `SELECT error, nombre FROM cash_invoice_scans
        WHERE empresa_id=$1 AND error IS NOT NULL ORDER BY id DESC LIMIT 1`,
      [EMPRESA]
    );
    const cuenta = await db.query(
      `SELECT COUNT(*)::int AS n FROM cash_invoice_scans WHERE empresa_id=$1 AND error IS NOT NULL`,
      [EMPRESA]
    );
    expect(cuenta.rows[0].n).toBe(antes.rows[0].n + 1);
    expect(despues.rows[0].error).toContain("503");
    expect(despues.rows[0].nombre).toBe("rota.pdf");
  });

  it("un escaneo fallido tampoco registra ningún cobro", async () => {
    const antes = await db.query(`SELECT COUNT(*)::int AS n FROM cash_operations WHERE empresa_id=$1`, [EMPRESA]);
    await expect(
      escaneo.escanearFactura(
        { empresaId: EMPRESA, userId: USUARIO, sessionId: null, fichero: fichero() },
        async () => {
          throw new Error("ilegible");
        }
      )
    ).rejects.toThrow();
    const despues = await db.query(`SELECT COUNT(*)::int AS n FROM cash_operations WHERE empresa_id=$1`, [EMPRESA]);
    expect(despues.rows[0].n).toBe(antes.rows[0].n);
  });

  it("una factura de más de 15 MB se rechaza antes de mandarla a ningún sitio", async () => {
    const gorda = Buffer.concat([
      Buffer.from("%PDF-1.4\n", "latin1"),
      Buffer.alloc(16 * 1024 * 1024, 0x20),
    ]);
    await expect(
      escaneo.escanearFactura(
        {
          empresaId: EMPRESA,
          userId: USUARIO,
          sessionId: null,
          fichero: { originalname: "gorda.pdf", mimetype: "application/pdf", buffer: gorda },
        },
        async () => {
          throw new Error("no se debería haber llamado al extractor");
        }
      )
    ).rejects.toMatchObject({ codigo: "DOCUMENTO_DEMASIADO_GRANDE" });
  });

  it("una extracción a medias no revienta el normalizador", async () => {
    /*
     * El esquema estricto garantiza la forma de la respuesta HOY, pero el
     * extractor es un puerto y mañana puede haber otro detrás. Que falte medio
     * objeto tiene que dar campos vacíos, no una pantalla rota.
     */
    const aMedias = { es_factura: true } as unknown as import("./types.ts").ExtraccionCruda;
    const p = await escanear(aMedias);
    expect(p.referencia.valor).toBe(null);
    expect(p.importeCentimos.valor).toBe(null);
    expect(p.formaCobro.formaPago).toBe(null);
    expect(p.avisos.some((a) => a.codigo === "SIN_TOTAL")).toBe(true);
  });
});

describe.runIf(RUN)("cada empresa con lo suyo", () => {
  it("las reglas de otra empresa no clasifican mis cobros", async () => {
    const OTRA = "00000000-0000-4000-a000-0000000000ee";
    const comercio = String(process.hrtime.bigint()).slice(-7);

    // Una regla de OTRA empresa que casaría de sobra con esta factura.
    await db.query(
      `INSERT INTO cash_payment_rules
         (empresa_id, campo, patron, forma_pago, confianza, auto_seleccionar, prioridad,
          created_at_ms, updated_at_ms)
       VALUES ($1,'COMERCIO',$2,'CASH',1,true,1,$3,$3)`,
      [OTRA, comercio, Date.now()]
    );

    const cruda = extraccion580();
    cruda.recibo.comercio = comercio;
    const p = await escanear(cruda);

    expect(p.formaCobro.formaPago).toBe(null);
    await db.query(`DELETE FROM cash_payment_rules WHERE empresa_id = $1`, [OTRA]);
  });

  it("un duplicado de otra empresa no es mi duplicado", async () => {
    const OTRA = "00000000-0000-4000-a000-0000000000ee";
    const referencia = `AJENA-${String(process.hrtime.bigint()).slice(-8)}`;
    await db.query(
      `INSERT INTO cash_operations
         (empresa_id, session_id, numero, tipo, origen, party_nombre, concepto, referencia,
          importe_centimos, efectivo_neto_centimos, estado, created_by, created_at_ms,
          confirmed_at_ms, updated_at_ms)
       SELECT $1, s.id, $2, 'COLLECTION', 'MANUAL', 'X', 'X', $3, 100, 0, 'CONFIRMED',
              NULL, $4, $4, $4
         FROM cash_sessions s LIMIT 1`,
      [OTRA, `OTRA-${referencia}`, referencia, Date.now()]
    );

    const cruda = extraccion580();
    cruda.factura.numero = referencia;
    const p = await escanear(cruda);
    expect(p.avisos.some((a) => a.codigo === "POSIBLE_DUPLICADO")).toBe(false);

    await db.query(`DELETE FROM cash_operations WHERE empresa_id = $1`, [OTRA]);
  });
});
