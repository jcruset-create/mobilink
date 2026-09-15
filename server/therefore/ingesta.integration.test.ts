/**
 * La ingesta de correo por HTTP y contra PostgreSQL de verdad.
 *
 * Es la mitad del módulo que no se puede probar con funciones puras: la
 * idempotencia la garantiza un UNIQUE, el no-duplicar-actuaciones un índice
 * parcial, y el «dos personas deciden a la vez» un FOR UPDATE. Nada de eso
 * existe fuera de la base, así que probarlo llamando al servicio con la base
 * simulada demostraría sólo que el simulador hace lo que se le ha dicho.
 *
 * Lo que se fija aquí son los casos 1–9 y 24 del encargo:
 *
 *   1  un correo → un expediente con sus actuaciones;
 *   2  el MISMO correo dos veces → exactamente lo mismo que una;
 *   3  el segundo correo del mismo asunto → mismo expediente, dos correos;
 *   4  «urgente» sube la prioridad y deja constancia;
 *   5  GRABAR y luego MODIFICAR el mismo albarán → decisión, bloqueo, y la
 *      actuación anterior INTACTA hasta que alguien diga;
 *   6  un correo que pide tres cosas → tres actuaciones;
 *   7  una reclamación con un albarán más → se añade ése y no se repiten los otros;
 *   8  aprobación y tareas vencidas de la misma factura → un solo expediente;
 *   9  el abono negativo sobrevive el viaje entero;
 *   24 una reclamación sobre algo resuelto pregunta, y no reabre sola.
 *
 * Y dos cosas más que sólo se ven contra la base: que la normalización de
 * identificadores en SQL y en TypeScript dicen lo mismo, y que una empresa no
 * ve los correos de otra.
 *
 * Sólo con RUN_DB_TESTS=1 y DATABASE_URL a una base DESECHABLE.
 */

import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const RUN = process.env.RUN_DB_TESTS === "1" && !!process.env.DATABASE_URL;

vi.mock("../core/auth.ts", () => ({
  authenticate: (req: any, _res: any, next: any) => {
    req.authCtx = {
      userId: String(req.headers["x-test-user"] ?? ""),
      username: "prueba",
      nombre: String(req.headers["x-test-nombre"] ?? "Prueba"),
      empresaId: String(req.headers["x-test-empresa"] ?? ""),
      esSuperadmin: req.headers["x-test-superadmin"] === "1",
    };
    next();
  },
  requireModule: () => (_req: any, _res: any, next: any) => next(),
}));

let base = "";
let servidor: Server;
let db: typeof import("../db.ts").default;

const EMPRESA_A = "00000000-0000-4000-a000-00000000ca01";
const EMPRESA_B = "00000000-0000-4000-a000-00000000cb01";
const ADMIN_A = "00000000-0000-4000-a000-0000000000c1";
const GESTOR_A = "00000000-0000-4000-a000-0000000000c2";
const CONSULTA_A = "00000000-0000-4000-a000-0000000000c3";
const ADMIN_B = "00000000-0000-4000-a000-0000000000c4";

const adminA = { usuario: ADMIN_A, empresa: EMPRESA_A };
const gestorA = { usuario: GESTOR_A, empresa: EMPRESA_A };
const consultaA = { usuario: CONSULTA_A, empresa: EMPRESA_A };
const adminB = { usuario: ADMIN_B, empresa: EMPRESA_B };

type Respuesta = { status: number; body: any };

function api(
  ruta: string,
  quien: { usuario: string; empresa: string },
  init?: { method?: string; body?: unknown }
): Promise<Respuesta> {
  return fetch(`${base}/api/therefore${ruta}`, {
    method: init?.method ?? "GET",
    headers: {
      "x-test-user": quien.usuario,
      "x-test-empresa": quien.empresa,
      "Content-Type": "application/json",
    },
    body: init?.body != null ? JSON.stringify(init.body) : undefined,
  }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) }));
}

/* ── El correo del encargo ───────────────────────────────────────────────── */

let contador = 0;
function messageId(): string {
  contador += 1;
  return `<thf-${contador}-${Date.now()}@ejemplo.invalid>`;
}

/**
 * Un correo con la forma del que manda Therefore.
 *
 * Los valores son los del encargo —sociedad 007, factura 0000555111, abono de
 * −45,63 €— y están inventados en lo identificativo. Lo que importa de ellos es
 * la ESTRUCTURA: qué campos vienen y cómo se relacionan.
 */
function correo(sobre: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    messageId: messageId(),
    fecha: "2026-09-01T08:15:00.000Z",
    de: "therefore@ejemplo.invalid",
    para: "incidencias@ejemplo.invalid",
    asunto: "Incidencia en factura 0000555111",
    texto: "Por favor, graba el albarán 9011223344 de la factura 0000555111.",
    tipo: "INCIDENCIA_ALBARAN",
    empresaCodigo: "007",
    empresaNombre: "Comercial Ejemplo",
    proveedorCodigo: "8",
    proveedorNombre: "PROVEEDOR UNO, S.L.",
    cuentaContable: "4040000077",
    facturaNumero: "0000555111",
    facturaFecha: "2026-08-31",
    importeCentimos: -4563,
    acciones: [{ accion: "GRABAR", albaran: "9011223344", importeCentimos: -4563 }],
    ...sobre,
  };
}

async function importar(
  sobre: Record<string, unknown> = {},
  quien = adminA
): Promise<Respuesta> {
  return api("/correos", quien, { method: "POST", body: correo(sobre) });
}

async function ficha(id: string, quien = adminA): Promise<any> {
  const r = await api(`/expedientes/${id}`, quien);
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return r.body;
}

async function decisionesPendientes(quien = adminA): Promise<any[]> {
  const r = await api("/decisiones?estado=PENDIENTE", quien);
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return r.body.decisiones;
}

/**
 * Dos correos que dejan al sistema en la franja de la duda.
 *
 * El mismo albarán, pero en OTRA factura. Suma el albarán (45), la misma acción
 * sobre él (10), el proveedor (20), la sociedad (10) y el importe (15), y resta
 * 40 por ser facturas distintas: 60. Entre 40 y 70, así que ni fusiona ni crea:
 * pregunta. Es un caso real —el mismo albarán refacturado— no un ejemplo de
 * laboratorio.
 */
async function conDuda(): Promise<{ primero: Respuesta; segundo: Respuesta }> {
  const primero = await importar();
  const segundo = await importar({
    fecha: "2026-09-07T08:00:00.000Z",
    asunto: "Incidencia en factura 0000999777",
    facturaNumero: "0000999777",
  });
  return { primero, segundo };
}

/**
 * Vacía el histórico de estas empresas sin que nadie más lo note.
 *
 * El histórico tiene un candado que rechaza UPDATE y DELETE, así que para
 * limpiarlo hay que desactivar el disparador. El detalle que importa es que
 * las tres sentencias van en UNA transacción, y no sueltas en autocommit.
 *
 * ── Por qué ────────────────────────────────────────────────────────────────
 *
 * `ALTER TABLE ... DISABLE TRIGGER` es GLOBAL: lo ve toda la base, no sólo
 * esta conexión. Con las tres sentencias sueltas, entre la primera y la
 * tercera el histórico queda modificable PARA TODO EL MUNDO, y vitest ejecuta
 * los ficheros de prueba en paralelo contra la misma base. La prueba que
 * comprueba que el histórico es inmutable, corriendo en otro worker, hacía su
 * UPDATE justo en esa ventana, le funcionaba, y fallaba.
 *
 * No era una hipótesis: el mismo commit salió rojo en una ejecución de la CI y
 * verde en otra. Dentro de la transacción, el ALTER mantiene el lock exclusivo
 * de la tabla hasta el COMMIT, así que ninguna otra sesión llega a ver el
 * candado abierto: espera, y cuando entra ya está cerrado otra vez.
 *
 * Reactivarlo es obligatorio pase lo que pase: dejarlo desactivado haría que
 * la prueba de inmutabilidad pasara sin que nada la protegiera, que es la peor
 * clase de prueba verde.
 */
async function limpiarHistorico(empresas: readonly string[]): Promise<void> {
  const cliente = await db.connect();
  try {
    await cliente.query("BEGIN");
    await cliente.query(`ALTER TABLE thf_eventos DISABLE TRIGGER thf_eventos_inmutable_trg`);
    await cliente.query(`DELETE FROM thf_eventos WHERE empresa_id = ANY($1)`, [empresas]);
    await cliente.query(`ALTER TABLE thf_eventos ENABLE TRIGGER thf_eventos_inmutable_trg`);
    await cliente.query("COMMIT");
  } catch (e) {
    await cliente.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    cliente.release();
  }
}

afterAll(async () => {
  servidor?.close();
  await db?.end().catch(() => {});
});

describe.runIf(RUN)("La ingesta de correo de Therefore", () => {
  beforeAll(async () => {
    db = (await import("../db.ts")).default;

    await db.query(`
      CREATE TABLE IF NOT EXISTS app_usuario_modulos (
        user_id UUID NOT NULL,
        modulo TEXT NOT NULL,
        rol TEXT,
        pantallas TEXT[],
        centro_id UUID,
        PRIMARY KEY (user_id, modulo)
      );
    `);
    for (const [usuario, rol] of [
      [ADMIN_A, "admin"],
      [GESTOR_A, "gestor"],
      [CONSULTA_A, "consulta"],
      [ADMIN_B, "admin"],
    ] as const) {
      await db.query(
        `INSERT INTO app_usuario_modulos (user_id, modulo, rol) VALUES ($1,'therefore',$2)
         ON CONFLICT (user_id, modulo) DO UPDATE SET rol = EXCLUDED.rol`,
        [usuario, rol]
      );
    }

    const { createThereforeRouter } = await import("./router.ts");
    const app = express();
    app.use(express.json());
    app.use("/api/therefore", createThereforeRouter());
    await new Promise<void>((listo) => {
      servidor = app.listen(0, () => {
        base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
        listo();
      });
    });
  }, 60_000);

  beforeEach(async () => {
    const empresas = [EMPRESA_A, EMPRESA_B];

    await limpiarHistorico(empresas);

    /*
     * El orden NO es libre. `thf_notificaciones.expediente_id` es ON DELETE SET
     * NULL, así que borrar primero los expedientes dejaría los correos huérfanos
     * en la tabla y la prueba siguiente los encontraría como candidatos.
     */
    await db.query(`DELETE FROM thf_decisiones WHERE empresa_id = ANY($1)`, [empresas]);
    await db.query(`DELETE FROM thf_adjuntos WHERE empresa_id = ANY($1)`, [empresas]);
    await db.query(`DELETE FROM thf_notificaciones WHERE empresa_id = ANY($1)`, [empresas]);
    await db.query(`DELETE FROM thf_actuaciones WHERE empresa_id = ANY($1)`, [empresas]);
    await db.query(`DELETE FROM thf_expedientes WHERE empresa_id = ANY($1)`, [empresas]);
    await db.query(`DELETE FROM thf_contadores WHERE empresa_id = ANY($1)`, [empresas]);
    await db.query(`DELETE FROM thf_config WHERE empresa_id = ANY($1)`, [empresas]);
  });

  /* ── Caso 1 ──────────────────────────────────────────────────────────────── */

  describe("caso 1 · un correo se convierte en un expediente", () => {
    it("crea el expediente con su actuación, su correo y su histórico", async () => {
      const r = await importar();
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      expect(r.body.resultado).toBe("CREADO");
      expect(r.body.actuacionesCreadas).toBe(1);
      expect(r.body.tipoNotificacion).toBe("SOLICITUD");

      const f = await ficha(r.body.expedienteId);
      expect(f.expediente.numero).toMatch(/^INC-\d{6}$/);
      expect(f.expediente.facturaNumero).toBe("0000555111");
      expect(f.expediente.numeroNotificaciones).toBe(1);
      expect(f.actuaciones).toHaveLength(1);
      expect(f.actuaciones[0].tipoAccion).toBe("GRABAR");
      // El número se guarda TAL Y COMO lo escribió el correo, y el núcleo al
      // lado: si sólo se guardara el núcleo, en pantalla saldría 9011223344
      // convertido en otra cosa y nadie reconocería su albarán.
      expect(f.actuaciones[0].albaranSolicitado).toBe("9011223344");
      expect(f.actuaciones[0].albaranNormalizado).toBe("9011223344");

      const tipos = f.eventos.map((e: any) => e.tipo);
      expect(tipos).toContain("EXPEDIENTE_CREADO");
      expect(tipos).toContain("ACTUACION_ANADIDA");
    });

    it("el correo queda enlazado, entero y sin editar", async () => {
      const r = await importar();
      const n = await api(`/expedientes/${r.body.expedienteId}/notificaciones`, adminA);
      expect(n.status).toBe(200);
      expect(n.body.notificaciones).toHaveLength(1);
      expect(n.body.notificaciones[0].textoOriginal).toContain("graba el albarán 9011223344");
      expect(n.body.notificaciones[0].estadoProceso).toBe("PROCESADA");
    });

    /*
     * La antigüedad se cuenta desde que Therefore lo pidió, no desde que se
     * creó la fila. Importar el histórico de un buzón con esto al revés dejaría
     * cien expedientes de hace meses nacidos hoy, todos con prioridad mínima.
     */
    it("la antigüedad cuenta desde la fecha del correo", async () => {
      const r = await importar({ fecha: "2026-06-01T09:00:00.000Z" });
      const f = await ficha(r.body.expedienteId);
      expect(f.expediente.fechaPrimeraNotificacion.slice(0, 10)).toBe("2026-06-01");
    });
  });

  /* ── Caso 2 ──────────────────────────────────────────────────────────────── */

  describe("caso 2 · el mismo correo dos veces", () => {
    it("no duplica nada y dice dónde fue a parar la primera vez", async () => {
      const cuerpo = correo();
      const primera = await api("/correos", adminA, { method: "POST", body: cuerpo });
      const segunda = await api("/correos", adminA, { method: "POST", body: cuerpo });

      expect(primera.body.duplicado).toBe(false);
      expect(segunda.status).toBe(200);
      expect(segunda.body.duplicado).toBe(true);
      expect(segunda.body.expedienteId).toBe(primera.body.expedienteId);
      expect(segunda.body.actuacionesCreadas).toBe(0);

      const f = await ficha(primera.body.expedienteId);
      expect(f.actuaciones).toHaveLength(1);
      expect(f.expediente.numeroNotificaciones).toBe(1);

      const { rows } = await db.query(
        `SELECT COUNT(*)::int AS n FROM thf_notificaciones WHERE empresa_id = $1`,
        [EMPRESA_A]
      );
      expect(rows[0].n).toBe(1);
    });

    /*
     * Lo que de verdad protege el UNIQUE: dos pasadas del buzón solapándose.
     * Una comprobación previa de «¿ya existe?» las dejaría pasar a las dos.
     */
    it("ni aunque las dos pasadas lleguen a la vez", async () => {
      const cuerpo = correo();
      const [a, b] = await Promise.all([
        api("/correos", adminA, { method: "POST", body: cuerpo }),
        api("/correos", adminA, { method: "POST", body: cuerpo }),
      ]);

      expect([a.status, b.status]).toEqual([200, 200]);
      expect([a.body.duplicado, b.body.duplicado].filter(Boolean)).toHaveLength(1);

      const { rows } = await db.query(
        `SELECT COUNT(*)::int AS n FROM thf_expedientes WHERE empresa_id = $1`,
        [EMPRESA_A]
      );
      expect(rows[0].n).toBe(1);
    });
  });

  /* ── Caso 3 ──────────────────────────────────────────────────────────────── */

  describe("caso 3 · el segundo correo del mismo asunto", () => {
    it("cae en el mismo expediente y cuenta como recordatorio", async () => {
      const primero = await importar();
      const segundo = await importar({
        asunto: "RE: Incidencia en factura 0000555111",
        texto: "Seguimos sin ver grabado el albarán 9011223344.",
        fecha: "2026-09-04T08:00:00.000Z",
      });

      expect(segundo.body.resultado).toBe("FUSIONADO");
      expect(segundo.body.expedienteId).toBe(primero.body.expedienteId);
      expect(segundo.body.tipoNotificacion).toBe("RECORDATORIO");
      // La reclamación repite el albarán de siempre: no crea actuación.
      expect(segundo.body.actuacionesCreadas).toBe(0);

      const f = await ficha(primero.body.expedienteId);
      expect(f.actuaciones).toHaveLength(1);
      expect(f.expediente.numeroNotificaciones).toBe(2);
      expect(f.expediente.numeroReclamaciones).toBe(0);
    });

    /*
     * Dos correos del mismo expediente a la vez: lo que pasa cuando el buzón
     * trae una tanda. Los contadores se leen y se escriben, así que sin el
     * FOR UPDATE de la fila los dos leerían el mismo valor y el segundo
     * pisaría al primero: un correo recibido que no cuenta.
     */
    it("dos correos simultáneos del mismo asunto cuentan los dos", async () => {
      const primero = await importar();
      const [a, b] = await Promise.all([
        importar({ fecha: "2026-09-04T08:00:00.000Z" }),
        importar({ fecha: "2026-09-04T08:01:00.000Z" }),
      ]);
      expect(a.body.expedienteId).toBe(primero.body.expedienteId);
      expect(b.body.expedienteId).toBe(primero.body.expedienteId);

      const f = await ficha(primero.body.expedienteId);
      expect(f.expediente.numeroNotificaciones).toBe(3);
    });

    /*
     * Pedir tres veces lo mismo ES reclamar, lo diga el texto o no. Si
     * dependiera de la palabra, un proveedor educado que insiste cinco veces
     * sin quejarse nunca subiría en la cola.
     */
    it("a partir del tercero cuenta como reclamación y sube la prioridad", async () => {
      const primero = await importar();
      await importar({ fecha: "2026-09-04T08:00:00.000Z" });
      const tercero = await importar({ fecha: "2026-09-08T08:00:00.000Z" });

      expect(tercero.body.tipoNotificacion).toBe("RECLAMACION");

      const f = await ficha(primero.body.expedienteId);
      expect(f.expediente.numeroNotificaciones).toBe(3);
      expect(f.expediente.numeroReclamaciones).toBe(1);
      expect(f.eventos.map((e: any) => e.tipo)).toContain("RECLAMACION_RECIBIDA");
    });
  });

  /* ── Caso 4 ──────────────────────────────────────────────────────────────── */

  describe("caso 4 · urgente", () => {
    it("marca el expediente, sube el score y lo deja en el histórico", async () => {
      const normal = await importar();
      const fNormal = await ficha(normal.body.expedienteId);

      const urgente = await importar({
        messageId: messageId(),
        facturaNumero: "0000999888",
        urgente: true,
        acciones: [{ accion: "GRABAR", albaran: "777111" }],
      });
      const fUrgente = await ficha(urgente.body.expedienteId);

      expect(fUrgente.expediente.urgente).toBe(true);
      expect(fUrgente.expediente.prioridadScore).toBeGreaterThan(
        fNormal.expediente.prioridadScore
      );
      expect(fUrgente.eventos.map((e: any) => e.tipo)).toContain("PRIORIDAD_MODIFICADA");
    });

    /*
     * Las banderas sólo suben. Un recordatorio que no repite la palabra
     * «urgente» no desactiva una urgencia ya reconocida: nadie ha dicho que
     * haya dejado de correr prisa.
     */
    it("un correo posterior sin la palabra no le quita la urgencia", async () => {
      const primero = await importar({ urgente: true });
      await importar({ fecha: "2026-09-05T08:00:00.000Z", urgente: false });
      const f = await ficha(primero.body.expedienteId);
      expect(f.expediente.urgente).toBe(true);
    });
  });

  /* ── Caso 5 ──────────────────────────────────────────────────────────────── */

  describe("caso 5 · cambio de instrucción", () => {
    async function conCambio() {
      const primero = await importar();
      const segundo = await importar({
        fecha: "2026-09-05T08:00:00.000Z",
        texto: "Corrección: el albarán 9011223344 hay que MODIFICARLO, no grabarlo.",
        acciones: [{ accion: "MODIFICAR", albaran: "9011223344" }],
      });
      return { primero, segundo };
    }

    it("no toca la actuación anterior, bloquea el expediente y pregunta", async () => {
      const { primero, segundo } = await conCambio();

      expect(segundo.body.resultado).toBe("FUSIONADO");
      expect(segundo.body.expedienteId).toBe(primero.body.expedienteId);
      expect(segundo.body.tipoNotificacion).toBe("CAMBIO_INSTRUCCION");
      expect(segundo.body.actuacionesCreadas).toBe(0);

      const f = await ficha(primero.body.expedienteId);
      expect(f.expediente.estado).toBe("BLOQUEADO");
      expect(f.actuaciones).toHaveLength(1);
      // Intacta: puede que alguien la tenga a medias, y cambiarla por su cuenta
      // sería decidir por esa persona.
      expect(f.actuaciones[0].tipoAccion).toBe("GRABAR");
      expect(f.actuaciones[0].estado).toBe("PENDIENTE");

      const pendientes = await decisionesPendientes();
      expect(pendientes).toHaveLength(1);
      expect(pendientes[0].tipo).toBe("CAMBIO_INSTRUCCION");
      expect(pendientes[0].detalle).toMatchObject({
        albaran: "9011223344",
        accionAnterior: "GRABAR",
        accionNueva: "MODIFICAR",
      });
    });

    it("aceptar descarta la anterior, crea la nueva y desbloquea", async () => {
      const { primero } = await conCambio();
      const [decision] = await decisionesPendientes();

      const r = await api(`/decisiones/${decision.id}`, gestorA, {
        method: "POST",
        body: { decision: "ACEPTAR" },
      });
      expect(r.status, JSON.stringify(r.body)).toBe(200);

      const f = await ficha(primero.body.expedienteId);
      expect(f.expediente.estado).toBe("PENDIENTE");
      expect(f.actuaciones).toHaveLength(2);
      const porAccion = Object.fromEntries(
        f.actuaciones.map((a: any) => [a.tipoAccion, a.estado])
      );
      expect(porAccion).toEqual({ GRABAR: "DESCARTADA", MODIFICAR: "PENDIENTE" });
      expect(await decisionesPendientes()).toHaveLength(0);
    });

    it("mantener deja todo como estaba y también desbloquea", async () => {
      const { primero } = await conCambio();
      const [decision] = await decisionesPendientes();

      await api(`/decisiones/${decision.id}`, gestorA, {
        method: "POST",
        body: { decision: "MANTENER", motivo: "Ya está grabado así." },
      });

      const f = await ficha(primero.body.expedienteId);
      expect(f.expediente.estado).toBe("PENDIENTE");
      expect(f.actuaciones).toHaveLength(1);
      expect(f.actuaciones[0].tipoAccion).toBe("GRABAR");
      expect(f.actuaciones[0].estado).toBe("PENDIENTE");
    });

    it("bloquear exige decir a qué se espera, y deja el expediente bloqueado", async () => {
      const { primero } = await conCambio();
      const [decision] = await decisionesPendientes();

      const sinMotivo = await api(`/decisiones/${decision.id}`, gestorA, {
        method: "POST",
        body: { decision: "BLOQUEAR" },
      });
      expect(sinMotivo.status).toBe(400);

      const conMotivo = await api(`/decisiones/${decision.id}`, gestorA, {
        method: "POST",
        body: { decision: "BLOQUEAR", motivo: "Pendiente de hablar con el proveedor." },
      });
      expect(conMotivo.status).toBe(200);

      const f = await ficha(primero.body.expedienteId);
      expect(f.expediente.estado).toBe("BLOQUEADO");
    });

    it("una decisión ya tomada no se vuelve a tomar", async () => {
      await conCambio();
      const [decision] = await decisionesPendientes();
      await api(`/decisiones/${decision.id}`, gestorA, {
        method: "POST",
        body: { decision: "MANTENER" },
      });
      const otra = await api(`/decisiones/${decision.id}`, gestorA, {
        method: "POST",
        body: { decision: "ACEPTAR" },
      });
      expect(otra.status).toBe(409);
    });
  });

  /* ── Casos 6 y 7 ─────────────────────────────────────────────────────────── */

  describe("casos 6 y 7 · varios albaranes", () => {
    const tres = [
      { accion: "GRABAR", albaran: "9011223344" },
      { accion: "MODIFICAR", albaran: "2028359554" },
      { accion: "ANULAR", albaran: "2028359555" },
    ];

    it("caso 6 · un correo que pide tres cosas crea tres actuaciones", async () => {
      const r = await importar({ acciones: tres });
      expect(r.body.actuacionesCreadas).toBe(3);

      const f = await ficha(r.body.expedienteId);
      expect(f.actuaciones.map((a: any) => a.tipoAccion).sort()).toEqual([
        "ANULAR",
        "GRABAR",
        "MODIFICAR",
      ]);
    });

    it("caso 7 · la reclamación con un albarán más añade ése y no repite los otros", async () => {
      const primero = await importar({ acciones: tres });
      const segundo = await importar({
        fecha: "2026-09-06T08:00:00.000Z",
        acciones: [...tres, { accion: "GRABAR", albaran: "999" }],
      });

      expect(segundo.body.expedienteId).toBe(primero.body.expedienteId);
      expect(segundo.body.actuacionesCreadas).toBe(1);

      const f = await ficha(primero.body.expedienteId);
      expect(f.actuaciones).toHaveLength(4);
      expect(f.actuaciones.filter((a: any) => a.albaranNormalizado === "999")).toHaveLength(1);
    });

    /*
     * `0501234` y `501234` son el mismo albarán —el cero a la izquierda no
     * cambia nada— y el índice único tiene que verlo así. Si no, la misma
     * reclamación escrita de dos maneras duplicaría el trabajo.
     */
    it("el mismo albarán con ceros a la izquierda no crea otra actuación", async () => {
      const primero = await importar({ acciones: [{ accion: "GRABAR", albaran: "0501234" }] });
      const segundo = await importar({
        fecha: "2026-09-06T08:00:00.000Z",
        acciones: [{ accion: "GRABAR", albaran: "501234" }],
      });

      expect(segundo.body.expedienteId).toBe(primero.body.expedienteId);
      expect(segundo.body.actuacionesCreadas).toBe(0);
      expect((await ficha(primero.body.expedienteId)).actuaciones).toHaveLength(1);
    });

    it("pero 0501234 y 0501235 son albaranes distintos", async () => {
      const primero = await importar({ acciones: [{ accion: "GRABAR", albaran: "0501234" }] });
      const segundo = await importar({
        fecha: "2026-09-06T08:00:00.000Z",
        acciones: [{ accion: "GRABAR", albaran: "0501235" }],
      });

      expect(segundo.body.expedienteId).toBe(primero.body.expedienteId);
      expect(segundo.body.actuacionesCreadas).toBe(1);
      expect((await ficha(primero.body.expedienteId)).actuaciones).toHaveLength(2);
    });
  });

  /* ── Caso 8 ──────────────────────────────────────────────────────────────── */

  describe("caso 8 · aprobación de factura y sus tareas vencidas", () => {
    it("las cuatro son un solo expediente con cuatro correos", async () => {
      const aprobacion = await importar({
        tipo: "APROBACION_FACTURA",
        asunto: "Aprobación de factura 0000555111",
        acciones: [{ accion: "APROBAR", albaran: null }],
      });
      expect(aprobacion.body.tipoNotificacion).toBe("APROBACION");

      for (let i = 1; i <= 3; i++) {
        const vencida = await importar({
          tipo: "APROBACION_FACTURA",
          asunto: `Tarea vencida (${i}) factura 0000555111`,
          fecha: `2026-09-0${i + 1}T08:00:00.000Z`,
          tareaVencida: true,
          importeCentimos: null,
          acciones: [],
        });
        expect(vencida.body.resultado).toBe("FUSIONADO");
        expect(vencida.body.expedienteId).toBe(aprobacion.body.expedienteId);
        expect(vencida.body.tipoNotificacion).toBe("TAREA_VENCIDA");
      }

      const f = await ficha(aprobacion.body.expedienteId);
      expect(f.expediente.tipo).toBe("APROBACION_FACTURA");
      expect(f.expediente.numero).toMatch(/^APR-/);
      expect(f.expediente.numeroNotificaciones).toBe(4);
      expect(f.expediente.numeroReclamaciones).toBe(3);
      expect(f.expediente.tareaVencida).toBe(true);
      expect(f.actuaciones).toHaveLength(1);

      const { rows } = await db.query(
        `SELECT COUNT(*)::int AS n FROM thf_expedientes WHERE empresa_id = $1`,
        [EMPRESA_A]
      );
      expect(rows[0].n).toBe(1);
    });

    /*
     * Y lo contrario: una incidencia de albarán de la misma factura NO se mete
     * en la aprobación sin preguntar.
     *
     * Comparten factura, proveedor, sociedad e importe —95 puntos— y el castigo
     * por tipo incompatible les quita 40: quedan 55, en la franja de la duda.
     * Que no sea una fusión automática es justo lo que hace el castigo; que
     * tampoco sea un expediente nuevo en silencio es correcto, porque la
     * coincidencia es demasiado buena para ignorarla. Se pregunta.
     */
    it("una incidencia de albarán de la misma factura no se fusiona en la aprobación", async () => {
      const aprobacion = await importar({
        tipo: "APROBACION_FACTURA",
        acciones: [{ accion: "APROBAR", albaran: null }],
      });
      const incidencia = await importar({
        fecha: "2026-09-03T08:00:00.000Z",
        acciones: [{ accion: "GRABAR", albaran: "9011223344" }],
      });
      expect(incidencia.body.resultado).toBe("PENDIENTE_DECISION");
      expect(incidencia.body.expedienteId).toBeNull();

      const [decision] = await decisionesPendientes();
      expect(decision.tipo).toBe("POSIBLE_DUPLICADO");
      expect(decision.candidatos[0].id).toBe(aprobacion.body.expedienteId);
      // Y el motivo por el que dudó queda escrito, con el castigo incluido.
      const claves = decision.candidatos[0].motivos.map((m: any) => m.clave);
      expect(claves).toContain("misma_factura");
      expect(claves).toContain("tipo_incompatible");
    });
  });

  /* ── Caso 9 ──────────────────────────────────────────────────────────────── */

  it("caso 9 · el abono viaja negativo de punta a punta", async () => {
    const r = await importar({
      acciones: [{ accion: "GRABAR", albaran: "9011223344", importeCentimos: -4563 }],
    });
    const f = await ficha(r.body.expedienteId);
    expect(f.expediente.importeCentimos).toBe(-4563);
    expect(f.actuaciones[0].importeCentimos).toBe(-4563);

    // Y en la base, no sólo en lo que devuelve la API.
    const { rows } = await db.query(
      `SELECT importe_centimos FROM thf_expedientes WHERE id = $1`,
      [r.body.expedienteId]
    );
    expect(Number(rows[0].importe_centimos)).toBe(-4563);
  });

  it("un importe que no viene en céntimos enteros se rechaza", async () => {
    const r = await api("/correos", adminA, {
      method: "POST",
      body: correo({ importeCentimos: -45.63 }),
    });
    expect(r.status).toBe(400);
    expect(r.body.code).toBe("IMPORTE_INVALIDO");
  });

  /* ── Caso 24 ─────────────────────────────────────────────────────────────── */

  describe("caso 24 · reclamación sobre un expediente resuelto", () => {
    async function conExpedienteResuelto() {
      const primero = await importar();
      const f = await ficha(primero.body.expedienteId);

      // Se resuelve la actuación, y el expediente se resuelve solo con ella.
      const mover = await api(`/actuaciones/${f.actuaciones[0].id}/resolver`, gestorA, {
        method: "POST",
        body: { resultado: "Grabado." },
      });
      expect(mover.status, JSON.stringify(mover.body)).toBe(200);
      expect((await ficha(primero.body.expedienteId)).expediente.estado).toBe("RESUELTO");

      const reclamacion = await importar({
        fecha: "2026-09-10T08:00:00.000Z",
        texto: "Seguimos sin ver grabado el albarán 9011223344.",
        reclamacion: true,
      });
      return { expedienteId: primero.body.expedienteId, reclamacion };
    }

    it("no reabre sola: deja la decisión y el expediente como estaba", async () => {
      const { expedienteId, reclamacion } = await conExpedienteResuelto();

      expect(reclamacion.body.resultado).toBe("PENDIENTE_DECISION");
      expect(reclamacion.body.expedienteId).toBeNull();

      const f = await ficha(expedienteId);
      expect(f.expediente.estado).toBe("RESUELTO");

      const [decision] = await decisionesPendientes();
      expect(decision.tipo).toBe("RECLAMACION_SOBRE_RESUELTO");
      expect(decision.expedienteId).toBe(expedienteId);
      // La puntuación se guarda tal y como se calculó: es la razón por la que
      // se preguntó, y los pesos pueden cambiar mañana.
      expect(decision.candidatos[0].motivos.length).toBeGreaterThan(0);
    });

    it("reabrir lo devuelve a PENDIENTE y enlaza el correo", async () => {
      const { expedienteId } = await conExpedienteResuelto();
      const [decision] = await decisionesPendientes();

      const r = await api(`/decisiones/${decision.id}`, gestorA, {
        method: "POST",
        body: { decision: "REABRIR", motivo: "El proveedor dice que sigue sin verlo." },
      });
      expect(r.status, JSON.stringify(r.body)).toBe(200);

      const f = await ficha(expedienteId);
      expect(f.expediente.estado).toBe("PENDIENTE");
      expect(f.expediente.numeroNotificaciones).toBe(2);
      expect(f.expediente.numeroReclamaciones).toBe(1);
      expect(f.eventos.map((e: any) => e.tipo)).toContain("EXPEDIENTE_REABIERTO");
    });

    /*
     * Confirmar que está resuelto no significa que el correo no haya llegado:
     * llegó, cuenta como reclamación y sube el contador. Dejarlo fuera haría
     * que un expediente reclamado tres veces pareciera tranquilo.
     */
    it("confirmar resuelto no reabre, pero cuenta la reclamación", async () => {
      const { expedienteId } = await conExpedienteResuelto();
      const [decision] = await decisionesPendientes();

      await api(`/decisiones/${decision.id}`, gestorA, {
        method: "POST",
        body: { decision: "CONFIRMAR_RESUELTO", motivo: "Ya está grabado." },
      });

      const f = await ficha(expedienteId);
      expect(f.expediente.estado).toBe("RESUELTO");
      expect(f.expediente.numeroReclamaciones).toBe(1);
    });

    it("crear relacionado abre otro expediente y lo cruza con el viejo", async () => {
      const { expedienteId } = await conExpedienteResuelto();
      const [decision] = await decisionesPendientes();

      const r = await api(`/decisiones/${decision.id}`, gestorA, {
        method: "POST",
        body: { decision: "CREAR_RELACIONADO" },
      });
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      expect(r.body.expedienteId).not.toBe(expedienteId);

      const viejo = await ficha(expedienteId);
      const nuevo = await ficha(r.body.expedienteId);
      // El cruce va en los dos: desde el viejo se ve el rebrote y desde el
      // nuevo, de dónde viene. Sólo en uno sería medio rastro.
      expect(viejo.eventos.map((e: any) => e.tipo)).toContain("EXPEDIENTE_RELACIONADO");
      expect(nuevo.eventos.map((e: any) => e.tipo)).toContain("EXPEDIENTE_RELACIONADO");
    });
  });

  /* ── Posible duplicado ───────────────────────────────────────────────────── */

  describe("la franja de la duda", () => {
    it("el correo se queda esperando, sin expediente", async () => {
      const { primero, segundo } = await conDuda();
      expect(primero.body.resultado).toBe("CREADO");
      expect(segundo.body.resultado).toBe("PENDIENTE_DECISION");
      expect(segundo.body.expedienteId).toBeNull();

      const [decision] = await decisionesPendientes();
      expect(decision.tipo).toBe("POSIBLE_DUPLICADO");
      expect(decision.candidatos.map((c: any) => c.id)).toContain(primero.body.expedienteId);
    });

    it("fusionar lo mete donde diga la persona", async () => {
      const { primero } = await conDuda();
      const [decision] = await decisionesPendientes();

      const r = await api(`/decisiones/${decision.id}`, gestorA, {
        method: "POST",
        body: { decision: "FUSIONAR", expedienteId: primero.body.expedienteId },
      });
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      expect(r.body.expedienteId).toBe(primero.body.expedienteId);

      const f = await ficha(primero.body.expedienteId);
      expect(f.expediente.numeroNotificaciones).toBe(2);
    });

    it("crear nuevo abre el segundo expediente", async () => {
      const { primero } = await conDuda();
      const [decision] = await decisionesPendientes();

      const r = await api(`/decisiones/${decision.id}`, gestorA, {
        method: "POST",
        body: { decision: "CREAR_NUEVO" },
      });
      expect(r.status).toBe(200);
      expect(r.body.expedienteId).not.toBe(primero.body.expedienteId);

      const { rows } = await db.query(
        `SELECT COUNT(*)::int AS n FROM thf_expedientes WHERE empresa_id = $1`,
        [EMPRESA_A]
      );
      expect(rows[0].n).toBe(2);
    });

    /*
     * Sólo se admite uno de los candidatos que se le enseñaron a la persona.
     * Admitir cualquier expediente convertiría la pantalla de revisión en un
     * «mueve esto donde quieras» sin rastro de por qué.
     */
    it("no se puede fusionar en un expediente que no era candidato", async () => {
      await conDuda();
      const ajeno = await importar({
        facturaNumero: "0000777666",
        proveedorCodigo: "99",
        proveedorNombre: "OTRO PROVEEDOR, S.L.",
        importeCentimos: 12345,
        acciones: [{ accion: "GRABAR", albaran: "555444" }],
      });
      const [decision] = await decisionesPendientes();

      const r = await api(`/decisiones/${decision.id}`, gestorA, {
        method: "POST",
        body: { decision: "FUSIONAR", expedienteId: ajeno.body.expedienteId },
      });
      expect(r.status).toBe(400);
      expect(r.body.code).toBe("EXPEDIENTE_NO_CANDIDATO");
    });

    it("una respuesta que no es de ese tipo de decisión se rechaza", async () => {
      await conDuda();
      const [decision] = await decisionesPendientes();
      const r = await api(`/decisiones/${decision.id}`, gestorA, {
        method: "POST",
        body: { decision: "REABRIR" },
      });
      expect(r.status).toBe(400);
      expect(r.body.code).toBe("DECISION_NO_VALIDA");
    });
  });

  /* ── Lo que no se sabe interpretar ───────────────────────────────────────── */

  describe("lo que el correo no deja claro", () => {
    /*
     * Un número citado sin decir qué hacer con él NO se convierte en actuación.
     * Un albarán grabado con la acción equivocada cuesta más de arreglar que
     * uno que se quedó esperando a que alguien mirase el correo.
     */
    it("un albarán ambiguo no se convierte en actuación: se pregunta", async () => {
      const r = await importar({
        albaranesAmbiguos: ["2028359999"],
      });
      const f = await ficha(r.body.expedienteId);
      expect(f.actuaciones).toHaveLength(1);
      expect(f.expediente.requiereRevision).toBe(true);

      const pendientes = await decisionesPendientes();
      expect(pendientes.map((d: any) => d.tipo)).toContain("REQUIERE_REVISION");
      expect(pendientes[0].detalle.albaranesAmbiguos).toEqual(["2028359999"]);
    });

    it("una acción leída con poca confianza también pide revisión", async () => {
      const r = await importar({
        acciones: [{ accion: "GRABAR", albaran: "9011223344", confianza: 0.4 }],
      });
      const f = await ficha(r.body.expedienteId);
      expect(f.expediente.requiereRevision).toBe(true);
      expect(f.actuaciones[0].confianza).toBeCloseTo(0.4, 2);
    });

    it("al marcarla revisada, el expediente deja de pedir revisión", async () => {
      const r = await importar({ albaranesAmbiguos: ["2028359999"] });
      const [decision] = await decisionesPendientes();

      await api(`/decisiones/${decision.id}`, gestorA, {
        method: "POST",
        body: { decision: "REVISADO" },
      });

      const f = await ficha(r.body.expedienteId);
      expect(f.expediente.requiereRevision).toBe(false);
    });

    /*
     * «T2» pegado al albarán no se traduce. Inventarle un significado es peor
     * que no tenerlo, porque nadie revisa lo que parece entendido.
     */
    it("el indicador que no se sabe qué es se guarda tal cual", async () => {
      const r = await importar({
        acciones: [{ accion: "GRABAR", albaran: "9011223344", indicador: "T2" }],
      });
      const f = await ficha(r.body.expedienteId);
      expect(f.actuaciones[0].indicadorAdicional).toBe("T2");
    });
  });

  /* ── Adjuntos ────────────────────────────────────────────────────────────── */

  describe("adjuntos", () => {
    it("se registran, se cuelgan del expediente y no se duplican", async () => {
      const adjunto = { nombre: "factura.pdf", mimeType: "application/pdf", hash: "abc123" };
      const r = await importar({ adjuntos: [adjunto, adjunto] });

      const n = await api(`/expedientes/${r.body.expedienteId}/notificaciones`, adminA);
      expect(n.body.adjuntos).toHaveLength(1);
      expect(n.body.adjuntos[0].tipoDocumento).toBe("PDF_FACTURA");
      expect(n.body.adjuntos[0].expedienteId).toBe(r.body.expedienteId);
    });

    it("un adjunto sin hash se rechaza", async () => {
      const r = await api("/correos", adminA, {
        method: "POST",
        body: correo({ adjuntos: [{ nombre: "factura.pdf" }] }),
      });
      expect(r.status).toBe(400);
      expect(r.body.code).toBe("HASH_REQUERIDO");
    });

    /*
     * El mismo PDF en dos correos es una señal de que hablan de lo mismo, y
     * aquí es la ÚNICA que hay: sin factura, sin proveedor, sin albaranes y sin
     * hilo. Que llegue hasta la puntuación no se puede comprobar mirando la
     * decisión —con los pesos de casa son 10 puntos y no llega a nada—, así que
     * se sube ese peso: si el adjunto no sirviera para encontrar el candidato,
     * subirlo no cambiaría nada y esta prueba seguiría en rojo.
     */
    it("el mismo documento en dos correos basta para encontrar el expediente", async () => {
      await api("/config", adminA, {
        method: "PUT",
        body: { dedupe: { pesos: { mismoDocumento: 80 } } },
      });

      const adjunto = { nombre: "factura.pdf", mimeType: "application/pdf", hash: "compartido" };
      const soloElPdf = {
        facturaNumero: null,
        proveedorCodigo: null,
        proveedorNombre: null,
        empresaCodigo: null,
        importeCentimos: null,
        acciones: [],
        adjuntos: [adjunto],
      };
      const primero = await importar(soloElPdf);
      const segundo = await importar({ ...soloElPdf, fecha: "2026-09-07T08:00:00.000Z" });

      expect(segundo.body.resultado).toBe("FUSIONADO");
      expect(segundo.body.expedienteId).toBe(primero.body.expedienteId);
    });
  });

  /* ── El hilo del correo ──────────────────────────────────────────────────── */

  it("una respuesta en el mismo hilo suma, pero sola no fusiona", async () => {
    const primero = await importar({
      gmailThreadId: "hilo-1",
      facturaNumero: null,
      proveedorCodigo: null,
      proveedorNombre: null,
      empresaCodigo: null,
      importeCentimos: null,
      acciones: [],
    });
    const segundo = await importar({
      gmailThreadId: "hilo-1",
      fecha: "2026-09-07T08:00:00.000Z",
      facturaNumero: null,
      proveedorCodigo: null,
      proveedorNombre: null,
      empresaCodigo: null,
      importeCentimos: null,
      acciones: [],
    });

    // 30 puntos: por debajo del umbral de revisión, que es 40. Un hilo
    // reutilizado para otra cosa no arrastra el correo a un expediente ajeno.
    expect(segundo.body.resultado).toBe("CREADO");
    expect(segundo.body.expedienteId).not.toBe(primero.body.expedienteId);
  });

  /* ── La normalización, escrita dos veces ─────────────────────────────────── */

  /*
   * `thf_normalizar_id` (SQL) y `normalizarIdentificador` (TypeScript) tienen
   * que decir lo mismo: la consulta de candidatos usa la primera y la
   * puntuación, la segunda. Si divergieran, un expediente entraría como
   * candidato y luego no puntuaría, o al revés, y no habría forma de verlo.
   */
  it("la normalización de SQL y la de TypeScript coinciden", async () => {
    const { normalizarIdentificador } = await import("./domain/dedupe.ts");
    const valores = [
      "0000555111",
      "555111",
      "FA-2026/001",
      "  ent-770199-0501234  ",
      "000",
      "",
      "---",
      "A0001",
    ];
    const { rows } = await db.query<{ v: string; n: string | null }>(
      `SELECT v, thf_normalizar_id(v) AS n FROM unnest($1::text[]) AS v`,
      [valores]
    );
    for (const fila of rows) {
      expect(fila.n, `difieren para «${fila.v}»`).toBe(normalizarIdentificador(fila.v));
    }
  });

  /* ── Aislamiento y permisos ──────────────────────────────────────────────── */

  describe("aislamiento y permisos", () => {
    it("el mismo Message-ID en dos empresas son dos correos distintos", async () => {
      const cuerpo = correo();
      const enA = await api("/correos", adminA, { method: "POST", body: cuerpo });
      const enB = await api("/correos", adminB, { method: "POST", body: cuerpo });

      expect(enA.body.duplicado).toBe(false);
      // El UNIQUE es (empresa_id, message_id): dos instalaciones que reciben el
      // mismo aviso no se pisan.
      expect(enB.body.duplicado).toBe(false);
      expect(enB.body.expedienteId).not.toBe(enA.body.expedienteId);
    });

    it("B no ve las decisiones de A", async () => {
      await conDuda();
      expect((await decisionesPendientes(adminA)).length).toBeGreaterThan(0);
      expect(await decisionesPendientes(adminB)).toEqual([]);
    });

    it("B no puede resolver una decisión de A: 404, no 403", async () => {
      await conDuda();
      const [decision] = await decisionesPendientes(adminA);

      const r = await api(`/decisiones/${decision.id}`, adminB, {
        method: "POST",
        body: { decision: "CREAR_NUEVO" },
      });
      expect(r.status).toBe(404);
    });

    it("quien sólo consulta no importa correos ni resuelve decisiones", async () => {
      const importado = await api("/correos", consultaA, { method: "POST", body: correo() });
      expect(importado.status).toBe(403);

      await conDuda();
      const [decision] = await decisionesPendientes();

      const resuelta = await api(`/decisiones/${decision.id}`, consultaA, {
        method: "POST",
        body: { decision: "CREAR_NUEVO" },
      });
      expect(resuelta.status).toBe(403);
    });

    /*
     * Importar es la boca de entrada del módulo: quien pueda llamarla puede
     * crear expedientes con los datos que quiera, sin el correo que los
     * respalde. Por eso no es un permiso del día a día.
     */
    it("un gestor tampoco importa correos, pero sí resuelve decisiones", async () => {
      const importado = await api("/correos", gestorA, { method: "POST", body: correo() });
      expect(importado.status).toBe(403);

      await conDuda();
      const [decision] = await decisionesPendientes();
      const resuelta = await api(`/decisiones/${decision.id}`, gestorA, {
        method: "POST",
        body: { decision: "CREAR_NUEVO" },
      });
      expect(resuelta.status).toBe(200);
    });
  });

  /* ── Lo que el correo tiene que traer ────────────────────────────────────── */

  describe("lo que no se admite", () => {
    it("sin Message-ID no se procesa: sin él no hay idempotencia", async () => {
      const r = await api("/correos", adminA, {
        method: "POST",
        body: correo({ messageId: "" }),
      });
      expect(r.status).toBe(400);
      expect(r.body.code).toBe("MESSAGE_ID_REQUERIDO");
    });

    it("sin cuerpo tampoco: es la única prueba de qué se pidió", async () => {
      const r = await api("/correos", adminA, { method: "POST", body: correo({ texto: "" }) });
      expect(r.status).toBe(400);
      expect(r.body.code).toBe("TEXTO_REQUERIDO");
    });

    it("una fecha que no es una fecha se rechaza", async () => {
      const r = await api("/correos", adminA, { method: "POST", body: correo({ fecha: "ayer" }) });
      expect(r.status).toBe(400);
      expect(r.body.code).toBe("FECHA_INVALIDA");
    });

    it("una acción que no existe se rechaza", async () => {
      const r = await api("/correos", adminA, {
        method: "POST",
        body: correo({ acciones: [{ accion: "INVENTAR", albaran: "1" }] }),
      });
      expect(r.status).toBe(400);
      expect(r.body.code).toBe("ACCION_INVALIDA");
    });
  });

  /* ── El correo tal cual, con el parser por medio ─────────────────────────── */

  describe("un correo entero, sin campos ya masticados", () => {
    /*
     * Aquí entra el correo como llega —asunto y cuerpo— y el parser hace el
     * resto. Los valores son inventados; lo que se conserva del correo real es
     * la FORMA: dónde va cada campo, con qué puntuación y cómo se pega un
     * importe a un albarán.
     */
    const EMPRESA_ERP = "031 Comercial Ejemplo_New";
    const ASUNTO_INC = `Incidencia en factura recibida. Empresa ${EMPRESA_ERP}`;
    const ASUNTO_APR = "Aprobación de Factura recibida. 031-Comercial Ejemplo_New";
    const ASUNTO_TV = `Tarea vencida. ${ASUNTO_APR}`;
    const PIE = "Este es un mensaje enviado automáticamente.\n\nUn saludo.\n";

    function cuerpoIncidencia(bloqueLibre: string, sobre: Record<string, string> = {}) {
      const c = {
        proveedor: "77",
        razon: "NEUMATICOS EJEMPLO, S.L.",
        cuenta: "4040000077",
        factura: "0000555111",
        fecha: "31/08/2026",
        importe: "1.234,56",
        ...sobre,
      };
      return (
        `Por favor procese la incidencia de la factura recibida. Empresa ${EMPRESA_ERP}:\n\n` +
        `Información Adicional:\n${bloqueLibre}\n` +
        `Código Proveedor: ${c.proveedor}.\nRazón Social: ${c.razon}.\n` +
        `Cuenta Contable: ${c.cuenta}.\nNúmero Factura: ${c.factura}.\n` +
        `Fecha Factura:${c.fecha}.\nImporte: ${c.importe}.\n\n` + PIE
      );
    }

    function cuerpoAprobacion(factura: string, instancia: string, vencida: boolean) {
      return (
        "Por favor apruebe la factura recibida:\n\n" +
        "Código Proveedor: 100999.\nRazón Social: SERVICIOS EJEMPLO, S.L.U..\n" +
        `Cuenta Contable: 4100000999.\nNúmero Factura: ${factura}.\n` +
        "Fecha Factura:01/08/2026.\nImporte: 321,45.\n\n" +
        "Haga clic en el siguiente enlace para acceder al documento y procesarlo:\n" +
        `https://therefore.ejemplo.invalid/TWA/tdwv/#/workflows/instance/${instancia}/1\n` +
        (vencida ? "\nHan pasado 7 días desde que recibio la primera notificación.\n" : "") +
        "\nUn saludo.\n"
      );
    }

    const enviar = (asunto: string, cuerpo: string, fecha: string, quien = adminA) =>
      api("/correos/texto", quien, {
        method: "POST",
        body: { messageId: messageId(), asunto, texto: cuerpo, fecha },
      });

    it("una incidencia con dos instrucciones se convierte en cuatro actuaciones", async () => {
      const r = await enviar(
        ASUNTO_INC,
        cuerpoIncidencia(
          "04/09/2026 Persona A\n\nBuenas,\nNecesitamos que gestionéis los siguientes albaranes:\n" +
            "Gracias\nGRABAR\n9011223344\n\nMODIFICAR FECHA\n9011229901\n9011229902\n9011229903\n"
        ),
        "2026-09-04T08:00:00.000Z"
      );
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      expect(r.body.actuacionesCreadas).toBe(4);

      const f = await ficha(r.body.expedienteId);
      const porAccion = f.actuaciones.map((a: any) => [a.tipoAccion, a.accionTexto, a.albaranSolicitado]);
      expect(porAccion).toEqual([
        ["GRABAR", null, "9011223344"],
        ["MODIFICAR", "MODIFICAR FECHA", "9011229901"],
        ["MODIFICAR", "MODIFICAR FECHA", "9011229902"],
        ["MODIFICAR", "MODIFICAR FECHA", "9011229903"],
      ]);
    });

    it("el importe del albarán, su indicador y su observación llegan enteros", async () => {
      const r = await enviar(
        ASUNTO_INC,
        cuerpoIncidencia("Grabar\n0501234 199.95e T2\n9011229999 2020.50€ FALTAN PIEZAS SON 3\n"),
        "2026-09-02T08:00:00.000Z"
      );
      const f = await ficha(r.body.expedienteId);
      expect(f.actuaciones[0]).toMatchObject({
        albaranSolicitado: "0501234",
        importeCentimos: 19995,
        indicadorAdicional: "T2",
      });
      expect(f.actuaciones[1]).toMatchObject({
        importeCentimos: 202050,
        observaciones: "FALTAN PIEZAS SON 3",
      });
      // Y el total de la factura, que es OTRA cifra, no se ha pisado.
      expect(f.expediente.importeCentimos).toBe(123456);
    });

    /*
     * El caso 10 del encargo: se pide grabar y no se escribe el número. No se
     * inventa: la actuación queda incompleta y el expediente pide revisión.
     */
    it("pedir grabar sin decir qué deja el expediente pidiendo revisión", async () => {
      const r = await enviar(
        ASUNTO_INC,
        cuerpoIncidencia("Por favor, necesitamos que grabéis los siguientes albaranes.\nGracias de antemano.\n"),
        "2026-08-25T08:00:00.000Z"
      );
      const f = await ficha(r.body.expedienteId);
      expect(f.actuaciones).toHaveLength(1);
      expect(f.actuaciones[0].albaranSolicitado).toBeNull();
      expect(f.expediente.requiereRevision).toBe(true);
      expect((await decisionesPendientes()).map((d: any) => d.tipo)).toContain("REQUIERE_REVISION");
    });

    it("un número citado sin acción no se convierte en actuación", async () => {
      const r = await enviar(
        ASUNTO_INC,
        cuerpoIncidencia("9011220000\nGrabar\n9011223344\n"),
        "2026-09-02T09:00:00.000Z"
      );
      const f = await ficha(r.body.expedienteId);
      expect(f.actuaciones.map((a: any) => a.albaranSolicitado)).toEqual(["9011223344"]);
      expect(f.expediente.requiereRevision).toBe(true);
    });

    /*
     * El caso que el encargo pide explícitamente: una aprobación y sus cuatro
     * tareas vencidas son UN expediente con cinco correos, no cinco
     * expedientes. Lo que las une es la terna sociedad + proveedor + factura.
     */
    it("una aprobación y sus cuatro tareas vencidas son un solo expediente", async () => {
      const original = await enviar(
        ASUNTO_APR,
        cuerpoAprobacion("0000007777", "9998887", false),
        "2026-08-25T07:00:00.000Z"
      );
      expect(original.body.resultado).toBe("CREADO");
      expect(original.body.tipoNotificacion).toBe("APROBACION");

      for (const dia of ["11", "12", "13", "14"]) {
        const v = await enviar(
          ASUNTO_TV,
          cuerpoAprobacion("0000007777", "9998887", true),
          `2026-09-${dia}T07:00:00.000Z`
        );
        expect(v.status, JSON.stringify(v.body)).toBe(200);
        expect(v.body.resultado).toBe("FUSIONADO");
        expect(v.body.expedienteId).toBe(original.body.expedienteId);
        expect(v.body.tipoNotificacion).toBe("TAREA_VENCIDA");
      }

      const f = await ficha(original.body.expedienteId);
      expect(f.expediente.tipo).toBe("APROBACION_FACTURA");
      expect(f.expediente.numeroNotificaciones).toBe(5);
      expect(f.expediente.numeroReclamaciones).toBe(4);
      expect(f.expediente.tareaVencida).toBe(true);
      expect(f.expediente.casoReferencia).toBe("9998887");

      /*
       * Y UNA sola actuación. Las tareas vencidas no piden nada nuevo: es el
       * mismo trabajo, que sigue sin hacerse. Una por recordatorio dejaría el
       * expediente con cinco «aprobar» idénticos.
       */
      expect(f.actuaciones).toHaveLength(1);
      expect(f.actuaciones[0].tipoAccion).toBe("APROBAR");

      const { rows } = await db.query(
        `SELECT COUNT(*)::int AS n FROM thf_expedientes WHERE empresa_id = $1`,
        [EMPRESA_A]
      );
      expect(rows[0].n).toBe(1);
    });

    it("una tarea vencida de OTRA factura no cae en ese expediente", async () => {
      const uno = await enviar(
        ASUNTO_APR,
        cuerpoAprobacion("0000007777", "9998887", false),
        "2026-08-25T07:00:00.000Z"
      );
      const otra = await enviar(
        ASUNTO_TV,
        cuerpoAprobacion("0000009999", "7776665", true),
        "2026-09-14T07:00:00.000Z"
      );
      expect(otra.body.resultado).toBe("CREADO");
      expect(otra.body.expedienteId).not.toBe(uno.body.expedienteId);
    });

    it("el texto original se guarda entero y sin tocar", async () => {
      const bloqueLibre = "PTE. AVERIGUAR JUSTIFICANTE MERCANCIA\n\n20/07/2026 Persona B\nGrabar\n9011223344\n";
      const cuerpo = cuerpoIncidencia(bloqueLibre);
      const r = await enviar(ASUNTO_INC, cuerpo, "2026-07-20T08:00:00.000Z");

      const n = await api(`/expedientes/${r.body.expedienteId}/notificaciones`, adminA);
      expect(n.body.notificaciones[0].textoOriginal).toBe(cuerpo);
      // Y lo que el parser entendió queda al lado, con sus avisos.
      expect(r.body.parseado.informacionAdicional).toContain("PTE. AVERIGUAR JUSTIFICANTE MERCANCIA");
    });

    it("el mismo correo por texto dos veces sigue sin duplicar nada", async () => {
      const id = messageId();
      const cuerpo = cuerpoIncidencia("Grabar\n9011223344\n");
      const enviarDosVeces = () =>
        api("/correos/texto", adminA, {
          method: "POST",
          body: { messageId: id, asunto: ASUNTO_INC, texto: cuerpo, fecha: "2026-09-02T08:00:00.000Z" },
        });

      const primera = await enviarDosVeces();
      const segunda = await enviarDosVeces();
      expect(primera.body.duplicado).toBe(false);
      expect(segunda.body.duplicado).toBe(true);
      expect((await ficha(primera.body.expedienteId)).actuaciones).toHaveLength(1);
    });

    it("un correo sin cuerpo se rechaza antes de tocar nada", async () => {
      const r = await api("/correos/texto", adminA, {
        method: "POST",
        body: { messageId: messageId(), asunto: ASUNTO_INC, texto: "", fecha: "2026-09-02T08:00:00.000Z" },
      });
      expect(r.status).toBe(400);
      expect(r.body.code).toBe("TEXTO_REQUERIDO");
    });
  });

  /* ── Los pesos se pueden cambiar ─────────────────────────────────────────── */

  it("bajar el umbral de fusión cambia la decisión sin tocar el código", async () => {
    const sinFactura = { facturaNumero: null, acciones: [] };
    const primero = await importar(sinFactura);

    // Con los umbrales de casa, 45 puntos caen en la franja de la duda.
    const conDuda = await importar({ ...sinFactura, fecha: "2026-09-07T08:00:00.000Z" });
    expect(conDuda.body.resultado).toBe("PENDIENTE_DECISION");

    const guardado = await api("/config", adminA, {
      method: "PUT",
      body: { dedupe: { umbrales: { fusionar: 40 } } },
    });
    expect(guardado.status, JSON.stringify(guardado.body)).toBe(200);
    expect(guardado.body.dedupe.umbrales.fusionar).toBe(40);

    const ahoraFusiona = await importar({ ...sinFactura, fecha: "2026-09-08T08:00:00.000Z" });
    expect(ahoraFusiona.body.resultado).toBe("FUSIONADO");
    expect(ahoraFusiona.body.expedienteId).toBe(primero.body.expedienteId);
  });

  it("un peso negativo se guarda con su signo", async () => {
    const r = await api("/config", adminA, {
      method: "PUT",
      body: { dedupe: { pesos: { tipoIncompatible: -60 } } },
    });
    expect(r.status).toBe(200);
    // Con el lector de los pesos de prioridad, que rechaza negativos, esto se
    // habría guardado en silencio como el valor por defecto.
    expect(r.body.dedupe.pesos.tipoIncompatible).toBe(-60);
  });
});
