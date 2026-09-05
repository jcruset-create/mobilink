/**
 * AutoScan de punta a punta, con base de datos de verdad.
 *
 * Lo que se prueba aquí no es que el código corra: es que las cuatro reglas
 * que sostienen la funcionalidad no se puedan saltar.
 *
 *   1. Un documento entra SIN jornada abierta. Son las 20:40.
 *   2. La empresa y el centro salen de la credencial, nunca de la petición.
 *   3. Duplicado e idempotencia son preguntas distintas y se responden distinto.
 *   4. Escanear no es cobrar: seleccionar no marca USADO.
 *
 * El análisis se prueba con un extractor de mentira. La IA de verdad no entra
 * en una suite: lo que hay que comprobar es el circuito, no lo que lee un
 * modelo.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";

const RUN = process.env.RUN_DB_TESTS === "1";

/*
 * Los documentos van a disco, no a Supabase. La CI define un Supabase FICTICIO
 * (`http://supabase.invalid`) para que las suites carguen; sin este
 * interruptor, cada documento que entra en la bandeja intentaría subirse a un
 * host que no existe. Misma línea y misma razón que en las otras dos suites
 * que guardan ficheros.
 */
process.env.CASH_STORAGE_LOCAL = "1";

let db: typeof import("../../db.ts").default;
let devices: typeof import("./devices.ts");
let inbox: typeof import("./inbox.ts");
let promote: typeof import("./promote.ts");

const EMPRESA = "00000000-0000-4000-a000-0000000a5c01";
const OTRA_EMPRESA = "00000000-0000-4000-a000-0000000a5c02";
const CENTRO_A = "00000000-0000-4000-a000-0000000ce001";
const CENTRO_B = "00000000-0000-4000-a000-0000000ce002";
const USUARIO = "00000000-0000-4000-a000-0000000a5c99";

/** Un PDF mínimo pero de verdad: los magic bytes tienen que cuadrar. */
const pdf = (texto: string) =>
  Buffer.concat([
    Buffer.from("%PDF-1.4\n"),
    Buffer.from(texto),
    Buffer.from("\n%%EOF\n"),
  ]);

const fichero = (nombre: string, contenido: Buffer) => ({
  originalname: nombre,
  mimetype: "application/pdf",
  buffer: contenido,
});

beforeAll(async () => {
  if (!RUN) return;
  db = (await import("../../db.ts")).default;
  await (await import("../schema.ts")).initCash();
  devices = await import("./devices.ts");
  /*
   * La licencia la contesta la prueba. El comprobador de verdad pregunta por
   * `app_licencia_activa()`, que esta base no tiene, y no hay valor por
   * defecto a propósito: un puerto sin registrar hace fallar la activación en
   * vez de dejar pasar, que es lo que se quiere si algún día alguien olvida
   * registrarlo al montar.
   */
  devices.registrarComprobadorDeLicencia(async () => true);
  inbox = await import("./inbox.ts");
  promote = await import("./promote.ts");
}, 180_000);

afterAll(async () => {
  if (!RUN) return;
  await db.query(`DELETE FROM cash_autoscan_inbox WHERE empresa_id = ANY($1::uuid[])`, [
    [EMPRESA, OTRA_EMPRESA],
  ]);
  await db.query(`DELETE FROM cash_autoscan_activation_codes WHERE empresa_id = ANY($1::uuid[])`, [
    [EMPRESA, OTRA_EMPRESA],
  ]);
  await db.query(`DELETE FROM cash_autoscan_devices WHERE empresa_id = ANY($1::uuid[])`, [
    [EMPRESA, OTRA_EMPRESA],
  ]);
});

/** Da de alta un dispositivo pasando por el código, como en la vida real. */
async function nuevoDispositivo(
  empresaId = EMPRESA,
  centroId = CENTRO_A,
  nombre = `PC-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
) {
  const { codigo } = await devices.crearCodigoActivacion({
    empresaId,
    centroId,
    nombre,
    creadoPor: USUARIO,
  });
  return { codigo, ...(await devices.activarDispositivo({ codigo })) };
}

describe.runIf(RUN)("AutoScan · activación", () => {
  it("un código válido activa el dispositivo con SU empresa y SU centro", async () => {
    const d = await nuevoDispositivo(EMPRESA, CENTRO_B, "Recepción");
    expect(d.empresaId).toBe(EMPRESA);
    expect(d.centroId).toBe(CENTRO_B);
    expect(d.secret).toBeTruthy();
  });

  it("el mismo código NO vale dos veces", async () => {
    const { codigo } = await devices.crearCodigoActivacion({
      empresaId: EMPRESA,
      centroId: CENTRO_A,
      nombre: "Doble",
      creadoPor: USUARIO,
    });
    await devices.activarDispositivo({ codigo });
    await expect(devices.activarDispositivo({ codigo })).rejects.toMatchObject({
      codigo: "CODIGO_NO_VALIDO",
    });
  });

  it("un código caducado no activa nada", async () => {
    const { codigo } = await devices.crearCodigoActivacion({
      empresaId: EMPRESA,
      centroId: CENTRO_A,
      nombre: "Viejo",
      creadoPor: USUARIO,
    });
    // Se envejece a mano: esperar una hora en una suite no es una opción.
    await db.query(
      `UPDATE cash_autoscan_activation_codes SET expira_at_ms = $1
        WHERE usado_at_ms IS NULL AND nombre = 'Viejo'`,
      [Date.now() - 1000]
    );
    await expect(devices.activarDispositivo({ codigo })).rejects.toMatchObject({
      codigo: "CODIGO_NO_VALIDO",
    });
  });

  it("un código inventado no dice si existe o no", async () => {
    await expect(
      devices.activarDispositivo({ codigo: "MC-AS-XXXX-YYYY" })
    ).rejects.toMatchObject({ codigo: "CODIGO_NO_VALIDO" });
  });

  it("varios dispositivos por centro, y revocar uno no toca a los demás", async () => {
    const a = await nuevoDispositivo(EMPRESA, CENTRO_A, "Mostrador-1");
    const b = await nuevoDispositivo(EMPRESA, CENTRO_A, "Mostrador-2");

    await devices.revocarDispositivo(EMPRESA, a.deviceId, USUARIO);

    expect(await devices.identificarDispositivo(a.secret)).toBe(null);
    expect((await devices.identificarDispositivo(b.secret))?.deviceId).toBe(b.deviceId);
  });

  it("una credencial inventada no identifica a nadie", async () => {
    expect(await devices.identificarDispositivo("no-existe")).toBe(null);
    expect(await devices.identificarDispositivo("")).toBe(null);
  });

  it("conectado se CALCULA del último latido, no se guarda", async () => {
    const d = await nuevoDispositivo(EMPRESA, CENTRO_A, "Latidos");
    const recien = (await devices.listarDispositivos(EMPRESA, CENTRO_A)).find(
      (x) => x.id === d.deviceId
    )!;
    expect(recien.conectado).toBe(true);

    // Se envejece el último visto por encima del umbral.
    await db.query(`UPDATE cash_autoscan_devices SET ultimo_visto_at_ms = $2 WHERE id = $1`, [
      d.deviceId,
      Date.now() - devices.UMBRAL_ONLINE_MS - 1000,
    ]);
    const viejo = (await devices.listarDispositivos(EMPRESA, CENTRO_A)).find(
      (x) => x.id === d.deviceId
    )!;
    expect(viejo.conectado).toBe(false);

    // Y el latido lo devuelve a la vida sin tocar ninguna columna de estado.
    await devices.latido(d.deviceId, "1.0.0");
    const vivo = (await devices.listarDispositivos(EMPRESA, CENTRO_A)).find(
      (x) => x.id === d.deviceId
    )!;
    expect(vivo.conectado).toBe(true);
    expect(vivo.version).toBe("1.0.0");
  });
});

describe.runIf(RUN)("AutoScan · recepción", () => {
  it("SIN jornada abierta el documento entra igual", async () => {
    /*
     * Es la razón de ser de la bandeja. Son las 20:40, la caja cerró a las
     * 20:00 y alguien escanea una factura. Ni se inventa una jornada ni se
     * rechaza el documento.
     */
    const d = await nuevoDispositivo();
    const r = await inbox.recibirDocumento(
      { deviceId: d.deviceId, empresaId: d.empresaId, centroId: d.centroId, nombre: d.nombre },
      { fichero: fichero("f1.pdf", pdf(`sin-jornada-${Date.now()}`)), idempotencyKey: `k-${Date.now()}` }
    );
    expect(r.documento.estado).toBe("PENDIENTE");
    expect(r.duplicado).toBe(false);
  });

  it("la empresa y el centro salen de la credencial", async () => {
    const d = await nuevoDispositivo(EMPRESA, CENTRO_B);
    const r = await inbox.recibirDocumento(
      { deviceId: d.deviceId, empresaId: d.empresaId, centroId: d.centroId, nombre: d.nombre },
      { fichero: fichero("f.pdf", pdf(`cred-${Date.now()}`)), idempotencyKey: `k2-${Date.now()}` }
    );
    expect(r.documento.empresaId).toBe(EMPRESA);
    expect(r.documento.centroId).toBe(CENTRO_B);
  });

  it("el MISMO contenido en el mismo centro es duplicado", async () => {
    const d = await nuevoDispositivo();
    const id = { deviceId: d.deviceId, empresaId: d.empresaId, centroId: d.centroId, nombre: d.nombre };
    const contenido = pdf(`dup-${Date.now()}`);

    const primero = await inbox.recibirDocumento(id, {
      fichero: fichero("factura.pdf", contenido),
      idempotencyKey: `a-${Date.now()}`,
    });
    // Otro nombre, otra clave: mismos bytes.
    const segundo = await inbox.recibirDocumento(id, {
      fichero: fichero("factura_copia.pdf", contenido),
      idempotencyKey: `b-${Date.now()}`,
    });

    expect(segundo.duplicado).toBe(true);
    expect(segundo.documento.id).toBe(primero.documento.id);
  });

  it("el mismo contenido en OTRO centro sí entra", async () => {
    // Dos talleres funcionan independientes: el mismo justificante puede
    // existir legítimamente en los dos.
    const contenido = pdf(`centros-${Date.now()}`);
    const a = await nuevoDispositivo(EMPRESA, CENTRO_A);
    const b = await nuevoDispositivo(EMPRESA, CENTRO_B);

    const ra = await inbox.recibirDocumento(
      { deviceId: a.deviceId, empresaId: a.empresaId, centroId: a.centroId, nombre: a.nombre },
      { fichero: fichero("f.pdf", contenido), idempotencyKey: `ca-${Date.now()}` }
    );
    const rb = await inbox.recibirDocumento(
      { deviceId: b.deviceId, empresaId: b.empresaId, centroId: b.centroId, nombre: b.nombre },
      { fichero: fichero("f.pdf", contenido), idempotencyKey: `cb-${Date.now()}` }
    );

    expect(rb.duplicado).toBe(false);
    expect(rb.documento.id).not.toBe(ra.documento.id);
  });

  it("idempotencia NO es deduplicación", async () => {
    /*
     * Dos preguntas distintas: «¿esta petición ya se procesó?» y «¿este
     * contenido ya está?». Un reintento del mismo envío NO es un duplicado —el
     * agente no mandó nada dos veces, se le cortó la respuesta— y por eso
     * vuelve con `duplicado: false`.
     */
    const d = await nuevoDispositivo();
    const id = { deviceId: d.deviceId, empresaId: d.empresaId, centroId: d.centroId, nombre: d.nombre };
    const clave = `idem-${Date.now()}`;
    const contenido = pdf(`idem-${Date.now()}`);

    const primero = await inbox.recibirDocumento(id, {
      fichero: fichero("f.pdf", contenido),
      idempotencyKey: clave,
    });
    const reintento = await inbox.recibirDocumento(id, {
      fichero: fichero("f.pdf", contenido),
      idempotencyKey: clave,
    });

    expect(reintento.documento.id).toBe(primero.documento.id);
    expect(reintento.duplicado).toBe(false);
  });

  it("dos agentes a la vez con el mismo PDF: UN documento", async () => {
    const contenido = pdf(`carrera-${Date.now()}`);
    const a = await nuevoDispositivo(EMPRESA, CENTRO_A);
    const b = await nuevoDispositivo(EMPRESA, CENTRO_A);
    const ida = { deviceId: a.deviceId, empresaId: a.empresaId, centroId: a.centroId, nombre: a.nombre };
    const idb = { deviceId: b.deviceId, empresaId: b.empresaId, centroId: b.centroId, nombre: b.nombre };

    const [ra, rb] = await Promise.all([
      inbox.recibirDocumento(ida, { fichero: fichero("f.pdf", contenido), idempotencyKey: `x-${Date.now()}` }),
      inbox.recibirDocumento(idb, { fichero: fichero("f.pdf", contenido), idempotencyKey: `y-${Date.now()}` }),
    ]);

    // Los dos reciben respuesta, y apuntan al mismo documento.
    expect(ra.documento.id).toBe(rb.documento.id);
    const { rows } = await db.query(
      `SELECT count(*)::int AS n FROM cash_autoscan_inbox
        WHERE empresa_id = $1 AND centro_id = $2 AND sha256 = encode(digest($3,'sha256'),'hex')
          AND estado <> 'DESCARTADO'`,
      [EMPRESA, CENTRO_A, contenido]
    ).catch(async () => {
      // Sin pgcrypto se cuenta por el id que devolvió la carrera.
      return db.query(
        `SELECT count(*)::int AS n FROM cash_autoscan_inbox WHERE id = $1`,
        [ra.documento.id]
      );
    });
    expect(rows[0].n).toBe(1);
  });

  it("un ejecutable renombrado a .pdf no entra", async () => {
    const d = await nuevoDispositivo();
    await expect(
      inbox.recibirDocumento(
        { deviceId: d.deviceId, empresaId: d.empresaId, centroId: d.centroId, nombre: d.nombre },
        {
          fichero: {
            originalname: "factura.pdf",
            mimetype: "application/pdf",
            buffer: Buffer.from("MZ\x90\x00ejecutable de Windows"),
          },
          idempotencyKey: `mz-${Date.now()}`,
        }
      )
    ).rejects.toBeTruthy();
  });

  it("un fichero demasiado grande no entra", async () => {
    const d = await nuevoDispositivo();
    await expect(
      inbox.recibirDocumento(
        { deviceId: d.deviceId, empresaId: d.empresaId, centroId: d.centroId, nombre: d.nombre },
        {
          fichero: fichero("gordo.pdf", Buffer.alloc(inbox.TAMANO_MAXIMO + 1, 0x41)),
          idempotencyKey: `big-${Date.now()}`,
        }
      )
    ).rejects.toMatchObject({ codigo: "FICHERO_DEMASIADO_GRANDE" });
  });
});

describe.runIf(RUN)("AutoScan · bandeja", () => {
  it("descartar NO borra, y deja volver a escanear el mismo PDF", async () => {
    const d = await nuevoDispositivo();
    const id = { deviceId: d.deviceId, empresaId: d.empresaId, centroId: d.centroId, nombre: d.nombre };
    const contenido = pdf(`rescan-${Date.now()}`);

    const primero = await inbox.recibirDocumento(id, {
      fichero: fichero("f.pdf", contenido),
      idempotencyKey: `r1-${Date.now()}`,
    });
    await inbox.descartar(EMPRESA, primero.documento.id, USUARIO, "No era nuestra");

    // La fila sigue ahí.
    const descartado = await inbox.documento(EMPRESA, primero.documento.id);
    expect(descartado?.estado).toBe("DESCARTADO");

    // Y el mismo contenido puede volver a entrar.
    const segundo = await inbox.recibirDocumento(id, {
      fichero: fichero("f.pdf", contenido),
      idempotencyKey: `r2-${Date.now()}`,
    });
    expect(segundo.duplicado).toBe(false);
    expect(segundo.documento.id).not.toBe(primero.documento.id);
  });

  it("un fallido vuelve a la cola sin crear otra fila", async () => {
    const d = await nuevoDispositivo();
    const r = await inbox.recibirDocumento(
      { deviceId: d.deviceId, empresaId: d.empresaId, centroId: d.centroId, nombre: d.nombre },
      { fichero: fichero("f.pdf", pdf(`retry-${Date.now()}`)), idempotencyKey: `rt-${Date.now()}` }
    );
    await db.query(`UPDATE cash_autoscan_inbox SET estado = 'FALLIDO', error = 'x' WHERE id = $1`, [
      r.documento.id,
    ]);

    const vuelto = await inbox.reintentar(EMPRESA, r.documento.id);
    expect(vuelto.id).toBe(r.documento.id);
    expect(vuelto.estado).toBe("PENDIENTE");
    expect(vuelto.error).toBe(null);
  });

  it("antiguo se CALCULA, y sigue en su estado real", async () => {
    const d = await nuevoDispositivo();
    const r = await inbox.recibirDocumento(
      { deviceId: d.deviceId, empresaId: d.empresaId, centroId: d.centroId, nombre: d.nombre },
      { fichero: fichero("f.pdf", pdf(`viejo-${Date.now()}`)), idempotencyKey: `v-${Date.now()}` }
    );
    await db.query(`UPDATE cash_autoscan_inbox SET recibido_at_ms = $2 WHERE id = $1`, [
      r.documento.id,
      Date.now() - inbox.ANTIGUO_MS - 1000,
    ]);

    const viejo = await inbox.documento(EMPRESA, r.documento.id);
    expect(viejo?.esAntiguo).toBe(true);
    // Y su estado NO ha cambiado: sigue pendiente, que es lo que de verdad es.
    expect(viejo?.estado).toBe("PENDIENTE");
  });

  it("el contador cuenta lo que espera, y solo eso", async () => {
    const centro = "00000000-0000-4000-a000-0000000ce0c0";
    const d = await nuevoDispositivo(EMPRESA, centro, `Cont-${Date.now()}`);
    const id = { deviceId: d.deviceId, empresaId: EMPRESA, centroId: centro, nombre: d.nombre };

    const estados = [
      "PENDIENTE", "PENDIENTE",
      "ANALIZANDO",
      "LISTO", "LISTO", "LISTO", "LISTO",
      "FALLIDO",
      "USADO", "USADO", "USADO",
      "DESCARTADO", "DESCARTADO",
    ];
    for (const [i, estado] of estados.entries()) {
      const r = await inbox.recibirDocumento(id, {
        fichero: fichero("f.pdf", pdf(`cont-${Date.now()}-${i}`)),
        idempotencyKey: `c-${Date.now()}-${i}`,
      });
      await db.query(`UPDATE cash_autoscan_inbox SET estado = $2 WHERE id = $1`, [
        r.documento.id,
        estado,
      ]);
    }

    const res = await inbox.resumen(EMPRESA, centro);
    // 2 + 1 + 4 + 1 = 8. Ni los 3 usados ni los 2 descartados.
    expect(res.pendientes).toBe(8);
    expect(res.listos).toBe(4);
    expect(res.fallidos).toBe(1);
    expect(res.hayDispositivos).toBe(true);
  });

  it("un centro SIN dispositivos lo dice, para que la pantalla no enseñe el bloque", async () => {
    const res = await inbox.resumen(EMPRESA, "00000000-0000-4000-a000-0000000ce0ff");
    expect(res.hayDispositivos).toBe(false);
    expect(res.pendientes).toBe(0);
  });

  it("un centro CON dispositivo y cero pendientes enseña el cero", async () => {
    const centro = "00000000-0000-4000-a000-0000000ce0c1";
    await nuevoDispositivo(EMPRESA, centro, `Cero-${Date.now()}`);
    const res = await inbox.resumen(EMPRESA, centro);
    expect(res.hayDispositivos).toBe(true);
    expect(res.pendientes).toBe(0);
  });

  it("no se ve la bandeja de otra empresa", async () => {
    const d = await nuevoDispositivo(OTRA_EMPRESA, CENTRO_A, `Ajeno-${Date.now()}`);
    const r = await inbox.recibirDocumento(
      { deviceId: d.deviceId, empresaId: OTRA_EMPRESA, centroId: CENTRO_A, nombre: d.nombre },
      { fichero: fichero("f.pdf", pdf(`ajeno-${Date.now()}`)), idempotencyKey: `aj-${Date.now()}` }
    );
    expect(await inbox.documento(EMPRESA, r.documento.id)).toBe(null);
    expect(await inbox.documento(OTRA_EMPRESA, r.documento.id)).not.toBe(null);
  });
});

describe.runIf(RUN)("AutoScan · promoción", () => {
  /** Un cobro de verdad, con su caja y su jornada. */
  async function cobroReal() {
    const servicio = await import("../service.ts");
    const config = await import("../config.ts");
    const ctx = { empresaId: EMPRESA, userId: USUARIO, ip: null } as unknown as Parameters<
      typeof servicio.registrarCobro
    >[0];

    const { rows } = await db.query(
      `INSERT INTO cash_registers (empresa_id, codigo, nombre, activa, created_at_ms, updated_at_ms)
       VALUES ($1,$2,$3,true,$4,$4) RETURNING id`,
      // Nombre único: la caja lleva UNIQUE (empresa, centro, nombre) y cada
      // prueba crea la suya.
      [
        EMPRESA,
        `A${Date.now().toString(36).slice(-4)}${Math.random().toString(36).slice(2, 4)}`,
        `AutoScan ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        Date.now(),
      ]
    );
    const registerId = rows[0].id;
    await config.formasPagoActivas(EMPRESA);

    const { sesion } = await servicio.abrirJornada(ctx, { registerId });
    const cobro = await servicio.registrarCobro(ctx, {
      sessionId: sesion.id,
      importeCentimos: 1000,
      formasPago: [{ forma: "CASH", importe: 1000 }],
      efectivoRecibido: [{ valor: 1000, cantidad: 1 }],
      concepto: "Con AutoScan",
    });
    return { ctx, operationId: cobro.operacionId };
  }

  async function docListo() {
    const d = await nuevoDispositivo();
    const r = await inbox.recibirDocumento(
      { deviceId: d.deviceId, empresaId: d.empresaId, centroId: d.centroId, nombre: d.nombre },
      { fichero: fichero("f.pdf", pdf(`prom-${Date.now()}-${Math.random()}`)), idempotencyKey: `p-${Date.now()}-${Math.random()}` }
    );
    await db.query(`UPDATE cash_autoscan_inbox SET estado = 'LISTO' WHERE id = $1`, [
      r.documento.id,
    ]);
    return r.documento.id;
  }

  it("al cobrar, el documento pasa a USADO y cuelga de la operación", async () => {
    const inboxId = await docListo();
    const { ctx, operationId } = await cobroReal();

    const p = await promote.promover(ctx, { inboxId, operationId });
    expect(p.operationId).toBe(operationId);

    const doc = await inbox.documento(EMPRESA, inboxId);
    expect(doc?.estado).toBe("USADO");
    expect(doc?.operationId).toBe(operationId);
  });

  it("el fichero NO se duplica: la misma ruta en el bucket", async () => {
    const inboxId = await docListo();
    const { ctx, operationId } = await cobroReal();
    await promote.promover(ctx, { inboxId, operationId });

    const { rows } = await db.query(
      `SELECT i.ruta AS ruta_inbox, d.ruta AS ruta_doc
         FROM cash_autoscan_inbox i
         JOIN cash_operation_documents d ON d.operation_id = i.operation_id
        WHERE i.id = $1`,
      [inboxId]
    );
    expect(rows[0].ruta_doc).toBe(rows[0].ruta_inbox);
  });

  it("un documento USADO no se puede volver a usar", async () => {
    const inboxId = await docListo();
    const primero = await cobroReal();
    await promote.promover(primero.ctx, { inboxId, operationId: primero.operationId });

    const segundo = await cobroReal();
    await expect(
      promote.promover(segundo.ctx, { inboxId, operationId: segundo.operationId })
    ).rejects.toMatchObject({ codigo: "DOCUMENTO_YA_USADO" });
  });

  it("uno que todavía no está LISTO no se promociona", async () => {
    const d = await nuevoDispositivo();
    const r = await inbox.recibirDocumento(
      { deviceId: d.deviceId, empresaId: d.empresaId, centroId: d.centroId, nombre: d.nombre },
      { fichero: fichero("f.pdf", pdf(`nolisto-${Date.now()}`)), idempotencyKey: `nl-${Date.now()}` }
    );
    const { ctx, operationId } = await cobroReal();
    await expect(
      promote.promover(ctx, { inboxId: r.documento.id, operationId })
    ).rejects.toMatchObject({ codigo: "DOCUMENTO_NO_UTILIZABLE" });
  });

  it("el de otra empresa no existe para ésta", async () => {
    const d = await nuevoDispositivo(OTRA_EMPRESA, CENTRO_A, `Prom-${Date.now()}`);
    const r = await inbox.recibirDocumento(
      { deviceId: d.deviceId, empresaId: OTRA_EMPRESA, centroId: CENTRO_A, nombre: d.nombre },
      { fichero: fichero("f.pdf", pdf(`otra-${Date.now()}`)), idempotencyKey: `oe-${Date.now()}` }
    );
    const { ctx, operationId } = await cobroReal();
    await expect(
      promote.promover(ctx, { inboxId: r.documento.id, operationId })
    ).rejects.toMatchObject({ codigo: "DOCUMENTO_NO_ENCONTRADO" });
  });
});
