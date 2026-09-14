/**
 * El módulo Therefore por HTTP y contra PostgreSQL de verdad.
 *
 * Se llama al router real, no a las funciones de dentro: el aislamiento entre
 * empresas vive en las consultas y los permisos en el middleware, y probarlos
 * llamando al servicio no demostraría nada de lo que importa. Un panel se salta
 * con `curl`; estas pruebas son el `curl`.
 *
 * Lo que se fija aquí:
 *
 *   · una empresa no ve ni toca nada de otra, y recibe 404 —no 403— al
 *     intentarlo cambiando el id;
 *   · quien sólo tiene «consulta» no crea, no resuelve y no configura;
 *   · reabrir pide su propio permiso, distinto del de resolver;
 *   · el expediente se mueve solo con sus actuaciones: la primera que se
 *     inicia lo pone EN_PROCESO y la última que se resuelve, RESUELTO;
 *   · no se puede dar por resuelto un expediente con trabajo pendiente;
 *   · una reclamación que repite los mismos albaranes NO duplica actuaciones;
 *   · el importe negativo de un abono sobrevive al viaje entero;
 *   · el histórico no se puede modificar.
 *
 * Sólo con RUN_DB_TESTS=1 y DATABASE_URL a una base DESECHABLE.
 */

import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const RUN = process.env.RUN_DB_TESTS === "1" && !!process.env.DATABASE_URL;

/*
 * `authenticate` y `requireModule` se sustituyen: el primero habla con Supabase
 * Auth y el segundo mira una licencia de la fundación SaaS, y ninguna de las
 * dos cosas existe en una base desechable. Lo que este fichero prueba es lo que
 * hay DESPUÉS de esa puerta: qué ve cada empresa y qué puede hacer cada rol.
 *
 * La empresa y el usuario llegan por cabecera, que es la forma de simular dos
 * sesiones distintas contra el mismo servidor.
 */
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

const EMPRESA_A = "00000000-0000-4000-a000-00000000aa01";
const EMPRESA_B = "00000000-0000-4000-a000-00000000bb01";

const GESTOR_A = "00000000-0000-4000-a000-0000000000f1";
const CONSULTA_A = "00000000-0000-4000-a000-0000000000f2";
const ADMIN_A = "00000000-0000-4000-a000-0000000000f3";
const SIN_ROL_A = "00000000-0000-4000-a000-0000000000f4";
const GESTOR_B = "00000000-0000-4000-a000-0000000000f5";

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

const gestorA = { usuario: GESTOR_A, empresa: EMPRESA_A };
const consultaA = { usuario: CONSULTA_A, empresa: EMPRESA_A };
const adminA = { usuario: ADMIN_A, empresa: EMPRESA_A };
const sinRolA = { usuario: SIN_ROL_A, empresa: EMPRESA_A };
const gestorB = { usuario: GESTOR_B, empresa: EMPRESA_B };

/** El cuerpo mínimo de un expediente, con el caso del abono del encargo. */
function datosExpediente(sobre: Record<string, unknown> = {}) {
  return {
    tipo: "INCIDENCIA_ALBARAN",
    empresaCodigo: "007",
    empresaNombre: "Comercial Ejemplo_New",
    proveedorCodigo: "8",
    proveedorNombre: "NEUMATICOS EJEMPLO, S.L.",
    cuentaContable: "4040000077",
    facturaNumero: "0000555111",
    facturaFecha: "2026-08-31",
    importeCentimos: -4563,
    urgente: false,
    ...sobre,
  };
}

async function crearExpediente(
  quien = gestorA,
  sobre: Record<string, unknown> = {}
): Promise<any> {
  const r = await api("/expedientes", quien, { method: "POST", body: datosExpediente(sobre) });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body.expediente;
}

async function anadirActuacion(
  expedienteId: string,
  cuerpo: Record<string, unknown>,
  quien = gestorA
): Promise<Respuesta> {
  return api(`/expedientes/${expedienteId}/actuaciones`, quien, { method: "POST", body: cuerpo });
}

afterAll(async () => {
  servidor?.close();
  await db?.end().catch(() => {});
});

describe.runIf(RUN)("Therefore por HTTP contra PostgreSQL", () => {
  beforeAll(async () => {
    db = (await import("../db.ts")).default;

    /*
     * `app_usuario_modulos` es de la fundación SaaS, que la base desechable de
     * las pruebas no tiene. Se crea aquí con lo justo que lee `permissions.ts`:
     * sin ella, todo contestaría 500 y no se estarían probando los permisos,
     * que es la mitad de lo que hay que probar.
     */
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
    await db.query(`DELETE FROM app_usuario_modulos WHERE modulo = 'therefore'`);
    for (const [usuario, rol] of [
      [GESTOR_A, "gestor"],
      [CONSULTA_A, "consulta"],
      [ADMIN_A, "admin"],
      [GESTOR_B, "gestor"],
    ] as const) {
      await db.query(
        `INSERT INTO app_usuario_modulos (user_id, modulo, rol) VALUES ($1,'therefore',$2)
         ON CONFLICT (user_id, modulo) DO UPDATE SET rol = EXCLUDED.rol`,
        [usuario, rol]
      );
    }

    const { createThereforeRouter } = await import("./router.ts");
    const app = express();
    // Como en `server/index.ts`, que monta el parser para toda la aplicación
    // antes que ningún router. El del módulo no lo pone por eso mismo.
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

    /*
     * El histórico no se puede borrar: para eso está su candado, y que esta
     * limpieza tenga que desactivarlo a propósito es la primera prueba de que
     * funciona. Se vuelve a activar en el `finally` pase lo que pase, porque
     * dejarlo desactivado haría pasar la prueba de inmutabilidad sin que nada
     * la protegiera, que es la peor clase de prueba verde.
     */
    await db.query(`ALTER TABLE thf_eventos DISABLE TRIGGER thf_eventos_inmutable_trg`);
    try {
      await db.query(`DELETE FROM thf_eventos WHERE empresa_id = ANY($1)`, [empresas]);
    } finally {
      await db.query(`ALTER TABLE thf_eventos ENABLE TRIGGER thf_eventos_inmutable_trg`);
    }

    await db.query(`DELETE FROM thf_actuaciones WHERE empresa_id = ANY($1)`, [empresas]);
    await db.query(`DELETE FROM thf_expedientes WHERE empresa_id = ANY($1)`, [empresas]);
    await db.query(`DELETE FROM thf_contadores WHERE empresa_id = ANY($1)`, [empresas]);
    await db.query(`DELETE FROM thf_config WHERE empresa_id = ANY($1)`, [empresas]);
  });

  /* ── Aislamiento ───────────────────────────────────────────────────────── */

  describe("una empresa no ve nada de otra", () => {
    it("el expediente de A no existe para B", async () => {
      const e = await crearExpediente(gestorA);

      const visto = await api(`/expedientes/${e.id}`, gestorB);
      // 404 y no 403: «no existe» y «no es tuyo» contestan igual, o quien va
      // probando identificadores averigua cuáles existen.
      expect(visto.status).toBe(404);
    });

    it("B no lo encuentra en su bandeja ni en sus contadores", async () => {
      await crearExpediente(gestorA);

      const lista = await api("/expedientes", gestorB);
      expect(lista.status).toBe(200);
      expect(lista.body.total).toBe(0);
      expect(lista.body.contadores.todos).toBe(0);

      const deA = await api("/expedientes", gestorA);
      expect(deA.body.total).toBe(1);
    });

    it("B no puede editarlo, ni moverlo, ni colgarle actuaciones", async () => {
      const e = await crearExpediente(gestorA);

      const editado = await api(`/expedientes/${e.id}`, gestorB, {
        method: "PATCH",
        body: { observaciones: "mío" },
      });
      expect(editado.status).toBe(404);

      const movido = await api(`/expedientes/${e.id}/estado`, gestorB, {
        method: "POST",
        body: { estado: "CERRADO" },
      });
      expect(movido.status).toBe(404);

      const colgada = await anadirActuacion(e.id, { tipoAccion: "GRABAR", albaranSolicitado: "1" }, gestorB);
      expect(colgada.status).toBe(404);

      // Y nada de eso ha tocado el expediente de A.
      const original = await api(`/expedientes/${e.id}`, gestorA);
      expect(original.body.expediente.estado).toBe("NUEVO");
      expect(original.body.expediente.observaciones).toBe("");
      expect(original.body.actuaciones).toHaveLength(0);
    });

    it("B no puede mover una actuación de A", async () => {
      const e = await crearExpediente(gestorA);
      const a = await anadirActuacion(e.id, { tipoAccion: "GRABAR", albaranSolicitado: "0501234" });

      const movida = await api(`/actuaciones/${a.body.actuacion.id}/resolver`, gestorB, {
        method: "POST",
      });
      expect(movida.status).toBe(404);
    });

    it("cada empresa lleva su propia numeración", async () => {
      const a1 = await crearExpediente(gestorA);
      const b1 = await crearExpediente(gestorB);
      const a2 = await crearExpediente(gestorA);

      expect(a1.numero).toBe("INC-000001");
      expect(b1.numero).toBe("INC-000001");
      expect(a2.numero).toBe("INC-000002");
    });
  });

  /* ── Permisos ──────────────────────────────────────────────────────────── */

  describe("permisos", () => {
    it("sin rol en el módulo no se ve nada", async () => {
      const r = await api("/expedientes", sinRolA);
      expect(r.status).toBe(403);
      expect(r.body.code).toBe("PERMISO_DENEGADO");
    });

    it("«consulta» mira pero no crea", async () => {
      expect((await api("/expedientes", consultaA)).status).toBe(200);

      const creado = await api("/expedientes", consultaA, {
        method: "POST",
        body: datosExpediente(),
      });
      expect(creado.status).toBe(403);
    });

    it("«consulta» no resuelve actuaciones", async () => {
      const e = await crearExpediente(gestorA);
      const a = await anadirActuacion(e.id, { tipoAccion: "GRABAR", albaranSolicitado: "0501234" });

      const r = await api(`/actuaciones/${a.body.actuacion.id}/resolver`, consultaA, {
        method: "POST",
      });
      expect(r.status).toBe(403);
    });

    it("«gestor» no toca la configuración; «admin» sí", async () => {
      expect((await api("/config", gestorA)).status).toBe(403);

      const cfg = await api("/config", adminA);
      expect(cfg.status).toBe(200);
      expect(cfg.body.pesos.reclamaciones).toBe(10);
    });

    it("reabrir pide su propio permiso, distinto del de resolver", async () => {
      const e = await crearExpediente(gestorA);
      await api(`/expedientes/${e.id}/estado`, gestorA, {
        method: "POST",
        body: { estado: "RESUELTO" },
      });

      /*
       * «consulta» no tiene ni el de reabrir ni el de gestionar, así que el 403
       * llega igual; lo que se comprueba es que el permiso que se pide es el de
       * reabrir y no el de resolver, porque son decisiones distintas.
       */
      const r = await api(`/expedientes/${e.id}/estado`, consultaA, {
        method: "POST",
        body: { estado: "PENDIENTE", motivo: "vuelve a reclamarlo" },
      });
      expect(r.status).toBe(403);
      expect(r.body.permiso).toBe("therefore.expediente.reopen");
    });

    it("la configuración guardada se lee de vuelta y cambia el cálculo", async () => {
      const guardado = await api("/config", adminA, {
        method: "PUT",
        body: { pesos: { urgente: 90 } },
      });
      expect(guardado.status).toBe(200);
      expect(guardado.body.pesos.urgente).toBe(90);
      // Lo que no se manda se queda como estaba.
      expect(guardado.body.pesos.reclamaciones).toBe(10);

      const e = await crearExpediente(gestorA, { urgente: true });
      expect(e.prioridadScore).toBe(90);
      expect(e.prioridad).toBe("CRITICA");
    });
  });

  /* ── Expedientes y actuaciones ─────────────────────────────────────────── */

  describe("el expediente y sus actuaciones", () => {
    it("nace NUEVO, numerado y con su evento en el histórico", async () => {
      const e = await crearExpediente(gestorA);

      expect(e.estado).toBe("NUEVO");
      expect(e.numero).toBe("INC-000001");
      expect(e.numeroNotificaciones).toBe(0);

      const ficha = await api(`/expedientes/${e.id}`, gestorA);
      expect(ficha.body.eventos).toHaveLength(1);
      expect(ficha.body.eventos[0].tipo).toBe("EXPEDIENTE_CREADO");
      expect(ficha.body.eventos[0].actorTipo).toBe("usuario");
      expect(ficha.body.eventos[0].usuarioId).toBe(GESTOR_A);
    });

    /* El abono del encargo: -45,63 €. Un signo perdido es un asiento del revés. */
    it("el importe negativo de un abono sobrevive al viaje entero", async () => {
      const e = await crearExpediente(gestorA);
      expect(e.importeCentimos).toBe(-4563);

      const ficha = await api(`/expedientes/${e.id}`, gestorA);
      expect(ficha.body.expediente.importeCentimos).toBe(-4563);

      const lista = await api("/expedientes", gestorA);
      expect(lista.body.expedientes[0].importeCentimos).toBe(-4563);
    });

    it("la fecha de factura no se mueve un día por la zona horaria", async () => {
      const e = await crearExpediente(gestorA);
      expect(e.facturaFecha).toBe("2026-08-31");
    });

    it("un importe en euros con decimales se rechaza en vez de guardarse mal", async () => {
      const r = await api("/expedientes", gestorA, {
        method: "POST",
        body: datosExpediente({ importeCentimos: -45.63 }),
      });
      expect(r.status).toBe(400);
      expect(r.body.code).toBe("IMPORTE_INVALIDO");
    });

    it("un expediente puede tener varias actuaciones con acciones distintas", async () => {
      const e = await crearExpediente(gestorA);
      await anadirActuacion(e.id, { tipoAccion: "GRABAR", albaranSolicitado: "802316", importeCentimos: 1787 });
      await anadirActuacion(e.id, { tipoAccion: "GRABAR", albaranSolicitado: "803008", importeCentimos: 814 });
      await anadirActuacion(e.id, { tipoAccion: "MODIFICAR", albaranSolicitado: "0804210", importeCentimos: 13708 });

      const ficha = await api(`/expedientes/${e.id}`, gestorA);
      expect(ficha.body.actuaciones).toHaveLength(3);
      expect(ficha.body.actuaciones.map((a: any) => a.tipoAccion)).toEqual([
        "GRABAR",
        "GRABAR",
        "MODIFICAR",
      ]);
    });

    it("guarda el indicador que no sabe interpretar en vez de tirarlo", async () => {
      const e = await crearExpediente(gestorA);
      const a = await anadirActuacion(e.id, {
        tipoAccion: "GRABAR",
        albaranSolicitado: "0501234",
        importeCentimos: 19995,
        indicadorAdicional: "T2",
      });
      expect(a.body.actuacion.indicadorAdicional).toBe("T2");
      expect(a.body.actuacion.albaranSolicitado).toBe("0501234");
      // Y lo normaliza para poder cruzarlo con el PDF, sin perder el original.
      expect(a.body.actuacion.albaranNormalizado).toBe("501234");
    });

    /*
     * El caso de la reclamación: Therefore repite los albaranes de siempre y
     * añade uno nuevo. Sólo tiene que aparecer el nuevo.
     */
    it("repetir los mismos albaranes no duplica actuaciones", async () => {
      const e = await crearExpediente(gestorA);
      await anadirActuacion(e.id, { tipoAccion: "GRABAR", albaranSolicitado: "123456" });
      await anadirActuacion(e.id, { tipoAccion: "GRABAR", albaranSolicitado: "456789" });

      const repetida = await anadirActuacion(e.id, { tipoAccion: "GRABAR", albaranSolicitado: "123456" });
      expect(repetida.status).toBe(200);
      expect(repetida.body.nueva).toBe(false);

      // Escrito con ceros a la izquierda es el mismo albarán.
      const conCeros = await anadirActuacion(e.id, { tipoAccion: "GRABAR", albaranSolicitado: "0123456" });
      expect(conCeros.body.nueva).toBe(false);

      const nueva = await anadirActuacion(e.id, { tipoAccion: "GRABAR", albaranSolicitado: "789012" });
      expect(nueva.status).toBe(201);
      expect(nueva.body.nueva).toBe(true);

      const ficha = await api(`/expedientes/${e.id}`, gestorA);
      expect(ficha.body.actuaciones).toHaveLength(3);
    });

    it("el mismo albarán con otra acción sí es otra actuación", async () => {
      const e = await crearExpediente(gestorA);
      await anadirActuacion(e.id, { tipoAccion: "GRABAR", albaranSolicitado: "0501234" });
      const otra = await anadirActuacion(e.id, { tipoAccion: "MODIFICAR", albaranSolicitado: "0501234" });

      expect(otra.status).toBe(201);
      expect(otra.body.nueva).toBe(true);
    });

    it("una acción que no existe se rechaza", async () => {
      const e = await crearExpediente(gestorA);
      const r = await anadirActuacion(e.id, { tipoAccion: "BORRAR", albaranSolicitado: "1" });
      expect(r.status).toBe(400);
      expect(r.body.code).toBe("ACCION_INVALIDA");
    });
  });

  /* ── El expediente se mueve con sus actuaciones ────────────────────────── */

  describe("el expediente sigue a sus actuaciones", () => {
    it("empezar la primera lo pone EN_PROCESO", async () => {
      const e = await crearExpediente(gestorA);
      const a = await anadirActuacion(e.id, { tipoAccion: "GRABAR", albaranSolicitado: "0501234" });

      const r = await api(`/actuaciones/${a.body.actuacion.id}/iniciar`, gestorA, { method: "POST" });
      expect(r.status).toBe(200);
      expect(r.body.expediente.estado).toBe("EN_PROCESO");
      expect(r.body.expediente.fechaInicioGestion).not.toBeNull();
    });

    it("resolver la última obligatoria lo pone RESUELTO", async () => {
      const e = await crearExpediente(gestorA);
      const a1 = await anadirActuacion(e.id, { tipoAccion: "GRABAR", albaranSolicitado: "802316" });
      const a2 = await anadirActuacion(e.id, { tipoAccion: "GRABAR", albaranSolicitado: "803008" });

      const primera = await api(`/actuaciones/${a1.body.actuacion.id}/resolver`, gestorA, {
        method: "POST",
        body: { resultado: "grabado", erpReferencia: "ALB-1" },
      });
      expect(primera.body.expediente.estado).not.toBe("RESUELTO");

      const segunda = await api(`/actuaciones/${a2.body.actuacion.id}/resolver`, gestorA, {
        method: "POST",
      });
      expect(segunda.body.expediente.estado).toBe("RESUELTO");
      expect(segunda.body.expediente.fechaResolucion).not.toBeNull();
      expect(segunda.body.expediente.resueltoPorUsuarioId).toBe(GESTOR_A);

      const tipos = segunda.body.eventos.map((ev: any) => ev.tipo);
      expect(tipos).toContain("ACTUACION_RESUELTA");
      expect(tipos).toContain("EXPEDIENTE_RESUELTO");
    });

    it("reabrir una actuación devuelve el expediente a la cola", async () => {
      const e = await crearExpediente(gestorA);
      const a = await anadirActuacion(e.id, { tipoAccion: "GRABAR", albaranSolicitado: "0501234" });
      const resuelto = await api(`/actuaciones/${a.body.actuacion.id}/resolver`, gestorA, {
        method: "POST",
      });
      expect(resuelto.body.expediente.estado).toBe("RESUELTO");

      const reabierta = await api(`/actuaciones/${a.body.actuacion.id}/reabrir`, gestorA, {
        method: "POST",
      });
      expect(reabierta.body.expediente.estado).toBe("PENDIENTE");
      expect(reabierta.body.expediente.fechaResolucion).toBeNull();
    });

    it("una actuación descartada no cuenta como trabajo pendiente", async () => {
      const e = await crearExpediente(gestorA);
      const a1 = await anadirActuacion(e.id, { tipoAccion: "GRABAR", albaranSolicitado: "802316" });
      const a2 = await anadirActuacion(e.id, { tipoAccion: "GRABAR", albaranSolicitado: "803008" });

      await api(`/actuaciones/${a1.body.actuacion.id}/resolver`, gestorA, { method: "POST" });
      const descartada = await api(`/actuaciones/${a2.body.actuacion.id}/descartar`, gestorA, {
        method: "POST",
        body: { motivo: "el albarán ya estaba grabado" },
      });
      expect(descartada.body.expediente.estado).toBe("RESUELTO");
    });

    it("descartar y bloquear exigen decir por qué", async () => {
      const e = await crearExpediente(gestorA);
      const a = await anadirActuacion(e.id, { tipoAccion: "GRABAR", albaranSolicitado: "0501234" });

      const sinMotivo = await api(`/actuaciones/${a.body.actuacion.id}/descartar`, gestorA, {
        method: "POST",
      });
      expect(sinMotivo.status).toBe(400);
      expect(sinMotivo.body.code).toBe("MOTIVO_REQUERIDO");

      const bloqueo = await api(`/actuaciones/${a.body.actuacion.id}/bloquear`, gestorA, {
        method: "POST",
      });
      expect(bloqueo.status).toBe(400);
    });

    it("descartar la única actuación deja el expediente resuelto", async () => {
      const e = await crearExpediente(gestorA);
      const a = await anadirActuacion(e.id, { tipoAccion: "GRABAR", albaranSolicitado: "0501234" });

      const r = await api(`/actuaciones/${a.body.actuacion.id}/descartar`, gestorA, {
        method: "POST",
        body: { motivo: "el albarán ya estaba grabado" },
      });
      // No queda nada por hacer, así que no tiene por qué seguir en la bandeja.
      expect(r.body.expediente.estado).toBe("RESUELTO");
    });

    it("una actuación descartada no vuelve, pero lo mismo se puede volver a pedir", async () => {
      const e = await crearExpediente(gestorA);
      const a = await anadirActuacion(e.id, { tipoAccion: "GRABAR", albaranSolicitado: "0501234" });
      // Una segunda actuación mantiene el expediente abierto: lo que se prueba
      // aquí es el índice único, no el cierre automático.
      await anadirActuacion(e.id, { tipoAccion: "GRABAR", albaranSolicitado: "802316" });

      await api(`/actuaciones/${a.body.actuacion.id}/descartar`, gestorA, {
        method: "POST",
        body: { motivo: "instrucción cambiada" },
      });

      const revivir = await api(`/actuaciones/${a.body.actuacion.id}/reabrir`, gestorA, {
        method: "POST",
      });
      expect(revivir.status).toBe(409);
      expect(revivir.body.code).toBe("TRANSICION_INVALIDA");

      /*
       * El índice único deja fuera las descartadas, así que el mismo albarán
       * con la misma acción se puede volver a pedir. Es lo que hace falta
       * cuando un cambio de instrucción se revierte: no se resucita la vieja,
       * se pide otra vez y quedan las dos en el histórico.
       */
      const denuevo = await anadirActuacion(e.id, { tipoAccion: "GRABAR", albaranSolicitado: "0501234" });
      expect(denuevo.status).toBe(201);
      expect(denuevo.body.nueva).toBe(true);
    });
  });

  /* ── Estados del expediente ────────────────────────────────────────────── */

  describe("estados del expediente", () => {
    it("no se da por resuelto con trabajo obligatorio pendiente", async () => {
      const e = await crearExpediente(gestorA);
      await anadirActuacion(e.id, { tipoAccion: "GRABAR", albaranSolicitado: "802316" });
      await anadirActuacion(e.id, { tipoAccion: "GRABAR", albaranSolicitado: "803008" });

      const r = await api(`/expedientes/${e.id}/estado`, gestorA, {
        method: "POST",
        body: { estado: "RESUELTO" },
      });
      expect(r.status).toBe(409);
      expect(r.body.code).toBe("ACTUACIONES_PENDIENTES");
      expect(r.body.detalle.pendientes).toHaveLength(2);
    });

    it("uno sin actuaciones sí se resuelve a mano", async () => {
      const e = await crearExpediente(gestorA, { tipo: "OTRO" });
      const r = await api(`/expedientes/${e.id}/estado`, gestorA, {
        method: "POST",
        body: { estado: "RESUELTO", motivo: "no procede" },
      });
      expect(r.status).toBe(200);
      expect(r.body.expediente.estado).toBe("RESUELTO");
      expect(r.body.expediente.numero).toBe("EXP-000001");
    });

    it("bloquear exige motivo", async () => {
      const e = await crearExpediente(gestorA);
      const sin = await api(`/expedientes/${e.id}/estado`, gestorA, {
        method: "POST",
        body: { estado: "BLOQUEADO" },
      });
      expect(sin.status).toBe(400);

      const con = await api(`/expedientes/${e.id}/estado`, gestorA, {
        method: "POST",
        body: { estado: "BLOQUEADO", motivo: "esperando respuesta del proveedor" },
      });
      expect(con.status).toBe(200);
      expect(con.body.expediente.estado).toBe("BLOQUEADO");
      expect(con.body.expediente.observaciones).toContain("proveedor");
    });

    /*
     * El motivo se añade a las observaciones; NO las sustituye. Borrar lo que
     * alguien apuntó sobre el expediente justo al bloquearlo es perder la nota
     * en el momento en que más falta hace.
     */
    it("el motivo no se lleva por delante lo que ya había anotado", async () => {
      const e = await crearExpediente(gestorA);
      await api(`/expedientes/${e.id}`, gestorA, {
        method: "PATCH",
        body: { observaciones: "hablar con Daniel, ext. 214" },
      });

      const r = await api(`/expedientes/${e.id}/estado`, gestorA, {
        method: "POST",
        body: { estado: "BLOQUEADO", motivo: "esperando respuesta del proveedor" },
      });
      expect(r.body.expediente.observaciones).toContain("ext. 214");
      expect(r.body.expediente.observaciones).toContain("proveedor");
    });

    it("una transición que no existe se rechaza", async () => {
      const e = await crearExpediente(gestorA, { tipo: "OTRO" });
      await api(`/expedientes/${e.id}/estado`, gestorA, {
        method: "POST",
        body: { estado: "RESUELTO", motivo: "listo" },
      });
      await api(`/expedientes/${e.id}/estado`, gestorA, {
        method: "POST",
        body: { estado: "CERRADO" },
      });

      const r = await api(`/expedientes/${e.id}/estado`, gestorA, {
        method: "POST",
        body: { estado: "RESUELTO" },
      });
      expect(r.status).toBe(409);
      expect(r.body.code).toBe("TRANSICION_INVALIDA");
    });

    it("reabrir exige motivo y borra las marcas de resolución", async () => {
      const e = await crearExpediente(gestorA, { tipo: "OTRO" });
      await api(`/expedientes/${e.id}/estado`, gestorA, {
        method: "POST",
        body: { estado: "RESUELTO", motivo: "listo" },
      });

      const sinMotivo = await api(`/expedientes/${e.id}/estado`, gestorA, {
        method: "POST",
        body: { estado: "PENDIENTE" },
      });
      expect(sinMotivo.status).toBe(400);

      const reabierto = await api(`/expedientes/${e.id}/estado`, gestorA, {
        method: "POST",
        body: { estado: "PENDIENTE", motivo: "han vuelto a reclamarlo" },
      });
      expect(reabierto.status).toBe(200);
      expect(reabierto.body.expediente.estado).toBe("PENDIENTE");
      expect(reabierto.body.expediente.fechaResolucion).toBeNull();
      expect(reabierto.body.expediente.resueltoPorUsuarioId).toBeNull();
      expect(reabierto.body.eventos.map((ev: any) => ev.tipo)).toContain("EXPEDIENTE_REABIERTO");
    });

    it("a un expediente terminado no se le cuelga trabajo sin reabrirlo", async () => {
      const e = await crearExpediente(gestorA, { tipo: "OTRO" });
      await api(`/expedientes/${e.id}/estado`, gestorA, {
        method: "POST",
        body: { estado: "RESUELTO", motivo: "listo" },
      });

      const r = await anadirActuacion(e.id, { tipoAccion: "GRABAR", albaranSolicitado: "0501234" });
      expect(r.status).toBe(409);
      expect(r.body.code).toBe("EXPEDIENTE_TERMINADO");
    });
  });

  /* ── Prioridad, asignación y bandeja ───────────────────────────────────── */

  describe("prioridad y bandeja", () => {
    it("lo urgente nace con más prioridad que lo normal", async () => {
      const normal = await crearExpediente(gestorA);
      const urgente = await crearExpediente(gestorA, { urgente: true });

      expect(normal.prioridadScore).toBe(0);
      expect(urgente.prioridadScore).toBe(25);
      expect(urgente.prioridad).toBe("NORMAL");

      // Y sale primero en la bandeja.
      const lista = await api("/expedientes", gestorA);
      expect(lista.body.expedientes[0].id).toBe(urgente.id);
    });

    it("la prioridad manual gana y queda anotada", async () => {
      const e = await crearExpediente(gestorA);
      const r = await api(`/expedientes/${e.id}`, gestorA, {
        method: "PATCH",
        body: { prioridadManual: "CRITICA" },
      });

      expect(r.status).toBe(200);
      expect(r.body.expediente.prioridad).toBe("CRITICA");
      expect(r.body.expediente.prioridadManual).toBe("CRITICA");
      // El score sigue siendo el que es: se enseñan los dos.
      expect(r.body.expediente.prioridadScore).toBe(0);
      expect(r.body.eventos.map((ev: any) => ev.tipo)).toContain("PRIORIDAD_MODIFICADA");

      // Quitarla devuelve el expediente a lo que le toca por sus hechos.
      const quitada = await api(`/expedientes/${e.id}`, gestorA, {
        method: "PATCH",
        body: { prioridadManual: "" },
      });
      expect(quitada.body.expediente.prioridadManual).toBeNull();
      expect(quitada.body.expediente.prioridad).toBe("BAJA");
    });

    it("una prioridad inventada se rechaza", async () => {
      const e = await crearExpediente(gestorA);
      const r = await api(`/expedientes/${e.id}`, gestorA, {
        method: "PATCH",
        body: { prioridadManual: "MUY_URGENTE" },
      });
      expect(r.status).toBe(400);
      expect(r.body.code).toBe("PRIORIDAD_INVALIDA");
    });

    it("asignar deja constancia de quién y cuándo", async () => {
      const e = await crearExpediente(gestorA);
      const r = await api(`/expedientes/${e.id}`, gestorA, {
        method: "PATCH",
        body: { asignadoUsuarioId: GESTOR_A },
      });
      expect(r.body.expediente.asignadoUsuarioId).toBe(GESTOR_A);
      expect(r.body.eventos.map((ev: any) => ev.tipo)).toContain("USUARIO_ASIGNADO");
    });

    it("las pestañas son filtros, no estados", async () => {
      const urgente = await crearExpediente(gestorA, { urgente: true });
      await crearExpediente(gestorA);

      const contadores = (await api("/expedientes", gestorA)).body.contadores;
      expect(contadores.pendientes).toBe(2);
      expect(contadores.urgentes).toBe(1);
      expect(contadores.reclamados).toBe(0);

      const soloUrgentes = await api("/expedientes?pestana=urgentes", gestorA);
      expect(soloUrgentes.body.total).toBe(1);
      expect(soloUrgentes.body.expedientes[0].id).toBe(urgente.id);
    });

    it("se busca por albarán, por factura y por proveedor", async () => {
      const e = await crearExpediente(gestorA);
      await anadirActuacion(e.id, { tipoAccion: "GRABAR", albaranSolicitado: "9011223344" });
      await crearExpediente(gestorA, { facturaNumero: "0000999999", proveedorNombre: "OTRO S.L." });

      expect((await api("/expedientes?texto=9011223344", gestorA)).body.total).toBe(1);
      expect((await api("/expedientes?texto=0000555111", gestorA)).body.total).toBe(1);
      expect((await api("/expedientes?texto=EJEMPLO", gestorA)).body.total).toBe(1);
      expect((await api("/expedientes?texto=nada-de-esto", gestorA)).body.total).toBe(0);
    });

    it("la bandeja trae las actuaciones y los días abiertos de cada fila", async () => {
      const e = await crearExpediente(gestorA);
      await anadirActuacion(e.id, { tipoAccion: "GRABAR", albaranSolicitado: "0501234" });

      const lista = await api("/expedientes", gestorA);
      const fila = lista.body.expedientes[0];
      expect(fila.actuaciones).toHaveLength(1);
      expect(fila.actuaciones[0].albaranSolicitado).toBe("0501234");
      expect(fila.diasAbierto).toBe(0);
    });
  });

  /* ── Histórico ─────────────────────────────────────────────────────────── */

  describe("el histórico", () => {
    it("no se puede modificar ni borrar", async () => {
      const e = await crearExpediente(gestorA);

      await expect(
        db.query(`UPDATE thf_eventos SET descripcion = 'otra cosa' WHERE expediente_id = $1`, [e.id])
      ).rejects.toThrow(/inmutable/);

      await expect(
        db.query(`DELETE FROM thf_eventos WHERE expediente_id = $1`, [e.id])
      ).rejects.toThrow(/inmutable/);
    });

    it("cada fila lleva su huella, que se calcula en la base", async () => {
      const e = await crearExpediente(gestorA);
      const { rows } = await db.query(`SELECT huella FROM thf_eventos WHERE expediente_id = $1`, [
        e.id,
      ]);
      expect(rows[0].huella).toMatch(/^[0-9a-f]{64}$/);
    });

    it("guarda el antes y el después de lo que cambia", async () => {
      const e = await crearExpediente(gestorA, { tipo: "OTRO" });
      await api(`/expedientes/${e.id}/estado`, gestorA, {
        method: "POST",
        body: { estado: "RESUELTO", motivo: "listo" },
      });

      const ficha = await api(`/expedientes/${e.id}`, gestorA);
      const resuelto = ficha.body.eventos.find((ev: any) => ev.tipo === "EXPEDIENTE_RESUELTO");
      expect(resuelto.datosAnteriores.estado).toBe("NUEVO");
      expect(resuelto.datosNuevos.estado).toBe("RESUELTO");
      expect(resuelto.datosNuevos.motivo).toBe("listo");
      expect(resuelto.descripcion).toContain("listo");
    });
  });
});
