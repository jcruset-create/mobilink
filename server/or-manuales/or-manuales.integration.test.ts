/**
 * El circuito de OR Manuales por HTTP y contra PostgreSQL de verdad.
 *
 * Es la mitad del módulo que no se puede probar con funciones puras: el UNIQUE
 * que impide que una OR caiga en dos blocs, el índice que no deja entregar dos
 * veces el mismo taco, el cerrojo del cierre y el archivado dentro de una
 * transacción. Nada de eso existe fuera de la base.
 *
 * El caso central es el criterio de terminación del encargo, entero:
 *
 *   crear bloc 010 (2001-2025) → entregar → devolver → subir un PDF de 20
 *   páginas → 20/25 → ver que faltan cinco → subir las cinco → 25/25 COMPLETO
 *   → abrir cada OR → cerrar el bloc → histórico y auditoría.
 *
 * Y además: rangos que se pisan, duplicados que no sobrescriben, confianza
 * baja que va a la bandeja, asignación manual, permisos y aislamiento entre
 * empresas.
 *
 * Sólo con RUN_DB_TESTS=1 y DATABASE_URL a una base DESECHABLE.
 */

import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

import express from "express";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const RUN = process.env.RUN_DB_TESTS === "1" && !!process.env.DATABASE_URL;

// Sin Supabase: los ficheros van al disco del runner.
process.env.OR_MANUALES_STORAGE_LOCAL = "1";
// Sin IA: las páginas de prueba son PDF con texto, que es el camino bueno de
// todas formas. Así la suite no depende de que haya salida a internet.
process.env.OPENAI_API_KEY = "";

vi.mock("../core/auth.ts", () => ({
  authenticate: (req: any, _res: any, next: any) => {
    req.authCtx = {
      userId: String(req.headers["x-test-user"] ?? ""),
      username: "prueba",
      nombre: String(req.headers["x-test-nombre"] ?? "Prueba"),
      empresaId: String(req.headers["x-test-empresa"] ?? ""),
      esSuperadmin: false,
    };
    next();
  },
  requireModule: () => (_req: any, _res: any, next: any) => next(),
}));

let base = "";
let servidor: Server;
let db: typeof import("../db.ts").default;

const EMPRESA_A = "00000000-0000-4000-a000-00000000dd01";
const EMPRESA_B = "00000000-0000-4000-a000-00000000dd02";
const GESTOR_A = "00000000-0000-4000-a000-000000000d01";
const OPERARIO_A = "00000000-0000-4000-a000-000000000d02";
const CONSULTA_A = "00000000-0000-4000-a000-000000000d03";
const GESTOR_B = "00000000-0000-4000-a000-000000000d04";
const ADMIN_A = "00000000-0000-4000-a000-000000000d05";

type Quien = { usuario: string; empresa: string; nombre: string };

const gestorA: Quien = { usuario: GESTOR_A, empresa: EMPRESA_A, nombre: "Marta López" };
const operarioA: Quien = { usuario: OPERARIO_A, empresa: EMPRESA_A, nombre: "Juan Pérez" };
const consultaA: Quien = { usuario: CONSULTA_A, empresa: EMPRESA_A, nombre: "Sólo Mira" };
const gestorB: Quien = { usuario: GESTOR_B, empresa: EMPRESA_B, nombre: "Otra Empresa" };
// La configuración del OCR es de administrador: un gestor no la toca, y eso lo
// comprueba una prueba de más abajo a propósito.
const adminA: Quien = { usuario: ADMIN_A, empresa: EMPRESA_A, nombre: "Admin Prueba" };

type Respuesta = { status: number; body: any; headers: Headers };

function api(
  ruta: string,
  quien: Quien,
  init?: { method?: string; body?: unknown }
): Promise<Respuesta> {
  return fetch(`${base}/api/or-manuales${ruta}`, {
    method: init?.method ?? "GET",
    headers: cabeceras(quien, { "Content-Type": "application/json" }),
    body: init?.body != null ? JSON.stringify(init.body) : undefined,
  }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => ({})), headers: r.headers }));
}

function cabeceras(quien: Quien, extra: Record<string, string> = {}): Record<string, string> {
  return {
    "x-test-user": quien.usuario,
    "x-test-empresa": quien.empresa,
    "x-test-nombre": quien.nombre,
    ...extra,
  };
}

/* ── Las hojas de prueba ─────────────────────────────────────────────────── */

/**
 * Un PDF con una página por número, con el número arriba a la derecha, que es
 * donde el taller lo lleva impreso y donde mira la zona por defecto.
 */
async function pdfDeOrs(numeros: (number | null)[]): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const fuente = await doc.embedFont(StandardFonts.Helvetica);
  for (const n of numeros) {
    const pagina = doc.addPage([595, 842]);
    // y=790 en coordenadas de PDF (desde abajo) es la franja superior.
    if (n !== null) pagina.drawText(`OR Nº ${n}`, { x: 400, y: 790, size: 16, font: fuente });
    pagina.drawText("ORDEN DE REPARACION MANUAL", { x: 60, y: 750, size: 12, font: fuente });
    pagina.drawText("Trabajos realizados: sustitucion de neumatico", { x: 60, y: 600, size: 11, font: fuente });
  }
  return Buffer.from(await doc.save());
}

async function subir(nombre: string, contenido: Buffer, quien: Quien = operarioA): Promise<Respuesta> {
  const form = new FormData();
  form.append("documentos", new Blob([new Uint8Array(contenido)], { type: "application/pdf" }), nombre);
  const r = await fetch(`${base}/api/or-manuales/documentos`, {
    method: "POST",
    headers: cabeceras(quien),
    body: form,
  });
  return { status: r.status, body: await r.json().catch(() => ({})), headers: r.headers };
}

/** Espera a que el lote termine. El procesamiento va por detrás de la respuesta. */
async function esperarProceso(procesoId: string, quien: Quien = operarioA): Promise<any> {
  for (let intento = 0; intento < 120; intento += 1) {
    const r = await api(`/procesamientos/${procesoId}`, quien);
    const p = r.body.procesamiento;
    if (p && (p.estado === "COMPLETADO" || p.estado === "ERROR")) return p;
    await new Promise((listo) => setTimeout(listo, 250));
  }
  throw new Error("El procesamiento no ha terminado a tiempo");
}

async function subirYEsperar(nombre: string, numeros: (number | null)[], quien: Quien = operarioA) {
  const r = await subir(nombre, await pdfDeOrs(numeros), quien);
  expect(r.status, JSON.stringify(r.body)).toBe(202);
  return esperarProceso(r.body.procesos[0].id, quien);
}

/* ── Datos ───────────────────────────────────────────────────────────────── */

let siguienteOr = 0;

/** Un rango sin estrenar para cada prueba: no se pisan entre sí. */
function rangoLibre(): number {
  siguienteOr += 100;
  return siguienteOr;
}

async function crearBloc(orInicial: number, quien: Quien = gestorA, extra: Record<string, unknown> = {}) {
  const r = await api("/blocs", quien, {
    method: "POST",
    body: { numeroBloc: `B${orInicial}`, orInicial, ...extra },
  });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body;
}

afterAll(async () => {
  if (!RUN) return;
  await new Promise<void>((r) => servidor?.close(() => r()));
  await db?.end().catch(() => {});
});

describe.skipIf(!RUN)("OR Manuales · el ciclo del papel contra PostgreSQL", () => {
  beforeAll(async () => {
    db = (await import("../db.ts")).default;

    // Los accesos por módulo, como en producción (la migración SaaS se aplica
    // a mano; en la base desechable se crea aquí lo mínimo).
    await db.query(`
      CREATE TABLE IF NOT EXISTS app_usuario_modulos (
        user_id UUID NOT NULL, modulo TEXT NOT NULL, rol TEXT NOT NULL, pantallas TEXT[],
        empresa_id UUID, centro_id UUID, UNIQUE (user_id, modulo)
      )`);
    for (const [usuario, rol] of [
      [GESTOR_A, "gestor"],
      [OPERARIO_A, "operario"],
      [CONSULTA_A, "consulta"],
      [GESTOR_B, "gestor"],
      [ADMIN_A, "admin"],
    ]) {
      await db.query(
        `INSERT INTO app_usuario_modulos (user_id, modulo, rol) VALUES ($1,'or-manuales',$2)
         ON CONFLICT (user_id, modulo) DO UPDATE SET rol = EXCLUDED.rol`,
        [usuario, rol]
      );
    }

    const { createOrManualesRouter } = await import("./router.ts");
    const app = express();
    app.use(express.json());
    app.use("/api/or-manuales", createOrManualesRouter());
    await new Promise<void>((listo) => {
      servidor = app.listen(0, () => {
        base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
        listo();
      });
    });
  }, 60_000);

  beforeEach(async () => {
    for (const empresa of [EMPRESA_A, EMPRESA_B]) {
      // El histórico es inmutable por trigger: se vacía desactivándolo, que es
      // lo que haría un administrador de la base, no la aplicación.
      await db.query(`ALTER TABLE orm_eventos DISABLE TRIGGER orm_eventos_inmutable_trg`);
      await db.query(`DELETE FROM orm_eventos WHERE empresa_id = $1`, [empresa]);
      await db.query(`ALTER TABLE orm_eventos ENABLE TRIGGER orm_eventos_inmutable_trg`);
      await db.query(`DELETE FROM orm_documentos WHERE empresa_id = $1`, [empresa]);
      await db.query(`DELETE FROM orm_avisos WHERE empresa_id = $1`, [empresa]);
      await db.query(`DELETE FROM orm_entregas WHERE empresa_id = $1`, [empresa]);
      await db.query(`DELETE FROM orm_or WHERE empresa_id = $1`, [empresa]);
      await db.query(`DELETE FROM orm_blocs WHERE empresa_id = $1`, [empresa]);
      await db.query(`DELETE FROM orm_procesamientos WHERE empresa_id = $1`, [empresa]);
      await db.query(`DELETE FROM orm_config WHERE empresa_id = $1`, [empresa]);
    }
    // Un tramo de numeración distinto por prueba: el UNIQUE de numero_or es
    // por empresa, así que reutilizar números arrastraría estado.
    siguienteOr = 100000 + (Date.now() % 500000);
  });

  /* ══ El criterio de terminación del encargo, entero ═══════════════════════ */

  it(
    "crear → entregar → devolver → 20 páginas → faltan 5 → subirlas → 25/25 → cerrar",
    async () => {
      const inicio = rangoLibre();

      // 1-3 · Crear el bloc: se generan sus 25 OR solas.
      const creado = await crearBloc(inicio);
      const blocId = creado.bloc.id;
      expect(creado.bloc.orFinal).toBe(inicio + 24);
      expect(creado.bloc.cantidadOr).toBe(25);
      expect(creado.ors).toHaveLength(25);
      expect(creado.ors.every((o: any) => o.estado === "PENDIENTE")).toBe(true);

      // 4-5 · Entregarlo con su fecha.
      const entregado = await api(`/blocs/${blocId}/entregar`, gestorA, {
        method: "POST",
        body: { responsableNombre: "Juan Pérez", fechaEntrega: "2026-09-01", observaciones: "Se lo lleva a ruta" },
      });
      expect(entregado.status).toBe(200);
      expect(entregado.body.bloc.estado).toBe("ENTREGADO");
      expect(entregado.body.bloc.responsableNombre).toBe("Juan Pérez");

      // 6 · Devolverlo. Sin nada escaneado: queda pendiente de escaneo.
      const devuelto = await api(`/blocs/${blocId}/devolver`, gestorA, {
        method: "POST",
        body: { fechaDevolucion: "2026-09-10" },
      });
      expect(devuelto.status).toBe(200);
      expect(devuelto.body.bloc.estado).toBe("PENDIENTE_ESCANEO");

      // 7-10 · Un PDF con 20 de las 25 hojas.
      const veinte = Array.from({ length: 20 }, (_, i) => inicio + i);
      const proceso = await subirYEsperar("escaneo-20.pdf", veinte);
      expect(proceso.estado).toBe("COMPLETADO");
      expect(proceso.paginas).toBe(20);
      expect(proceso.documentosCorrectos).toBe(20);
      expect(proceso.noIdentificados).toBe(0);
      expect(proceso.errores).toBe(0);

      // 11-12 · 20 de 25, y se sabe exactamente cuáles faltan.
      const aMedias = await api(`/blocs/${blocId}`, gestorA);
      expect(aMedias.body.progreso.archivadas).toBe(20);
      expect(aMedias.body.progreso.pendientes).toBe(5);
      expect(aMedias.body.progreso.faltan).toEqual([20, 21, 22, 23, 24].map((i) => inicio + i));
      expect(aMedias.body.bloc.estado).toBe("INCOMPLETO");

      // Y hay un aviso abierto que lo dice, sin que nadie lo haya pedido.
      const avisos = await api("/avisos", gestorA);
      expect(avisos.body.avisos).toHaveLength(1);
      expect(avisos.body.avisos[0].tipo).toBe("BLOC_INCOMPLETO");
      expect(avisos.body.avisos[0].mensaje).toContain(String(inicio + 20));

      // 13-14 · Las cinco que faltaban.
      const cinco = Array.from({ length: 5 }, (_, i) => inicio + 20 + i);
      const proceso2 = await subirYEsperar("escaneo-5.pdf", cinco);
      expect(proceso2.documentosCorrectos).toBe(5);

      // 15 · 25/25 y COMPLETO.
      const completo = await api(`/blocs/${blocId}`, gestorA);
      expect(completo.body.progreso.archivadas).toBe(25);
      expect(completo.body.progreso.pendientes).toBe(0);
      expect(completo.body.progreso.porcentaje).toBe(100);
      expect(completo.body.bloc.estado).toBe("COMPLETO");

      // El aviso se cierra solo: ya no falta nada.
      expect((await api("/avisos", gestorA)).body.avisos).toHaveLength(0);

      // 16 · Cada número se puede abrir y enseña su documento.
      const unaOr = completo.body.ors.find((o: any) => o.numeroOr === inicio + 7);
      expect(unaOr.estado).toBe("ESCANEADA");
      expect(unaOr.documentoPrincipalId).toBeTruthy();

      const contenido = await fetch(`${base}/api/or-manuales/documentos/${unaOr.documentoPrincipalId}/contenido`, {
        headers: cabeceras(gestorA),
      });
      expect(contenido.status).toBe(200);
      expect(contenido.headers.get("content-type")).toBe("application/pdf");
      expect(contenido.headers.get("content-disposition")).toContain(`OR_${inicio + 7}.pdf`);
      const bytes = Buffer.from(await contenido.arrayBuffer());
      expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");

      // Y lo guardado sigue siendo lo que se archivó.
      const verificado = await api(`/documentos/${unaOr.documentoPrincipalId}/verificar`, gestorA);
      expect(verificado.body.integro).toBe(true);

      // 17 · Se puede cerrar.
      const cerrado = await api(`/blocs/${blocId}/cerrar`, gestorA, { method: "POST", body: {} });
      expect(cerrado.status, JSON.stringify(cerrado.body)).toBe(200);
      expect(cerrado.body.bloc.estado).toBe("CERRADO");
      expect(cerrado.body.bloc.closedAt).toBeTruthy();

      // 18 · Todo en el histórico, en orden inverso.
      const acciones = cerrado.body.eventos.map((e: any) => e.accion);
      expect(acciones).toContain("BLOC_CREADO");
      expect(acciones).toContain("BLOC_ENTREGADO");
      expect(acciones).toContain("BLOC_DEVUELTO");
      expect(acciones).toContain("OR_ARCHIVADA");
      expect(acciones).toContain("BLOC_CERRADO");

      // Y en la auditoría de toda la aplicación.
      const { rows } = await db.query(
        `SELECT accion FROM app_auditoria WHERE empresa_id = $1 AND entidad_id = $2 ORDER BY id`,
        [EMPRESA_A, blocId]
      );
      expect(rows.map((r) => r.accion)).toEqual([
        "or_manuales.bloc.crear",
        "or_manuales.bloc.entregar",
        "or_manuales.bloc.devolver",
        "or_manuales.bloc.cerrar",
      ]);
    },
    180_000
  );

  /* ══ El bloc ══════════════════════════════════════════════════════════════ */

  describe("Crear blocs", () => {
    it("calcula la OR final sola: inicial + 25 OR", async () => {
      const inicio = rangoLibre();
      const r = await crearBloc(inicio);
      expect(r.bloc.orInicial).toBe(inicio);
      expect(r.bloc.orFinal).toBe(inicio + 24);
    });

    it("no deja crear un rango que se pisa con otro, y dice con cuál", async () => {
      const inicio = rangoLibre();
      await crearBloc(inicio);
      const choque = await api("/blocs", gestorA, {
        method: "POST",
        body: { numeroBloc: `X${inicio}`, orInicial: inicio + 10 },
      });
      expect(choque.status).toBe(409);
      expect(choque.body.code).toBe("RANGO_OCUPADO");
      expect(choque.body.error).toContain(`B${inicio}`);
    });

    it("tampoco dos blocs con el mismo número", async () => {
      const inicio = rangoLibre();
      await crearBloc(inicio);
      const r = await api("/blocs", gestorA, {
        method: "POST",
        body: { numeroBloc: `B${inicio}`, orInicial: inicio + 1000 },
      });
      expect(r.status).toBe(409);
      expect(r.body.code).toBe("BLOC_DUPLICADO");
    });

    it("propone el número y la OR siguientes", async () => {
      const inicio = rangoLibre();
      await api("/blocs", gestorA, { method: "POST", body: { numeroBloc: "007", orInicial: inicio } });
      const r = await api("/blocs/propuesta", gestorA);
      expect(r.body.propuesta.numeroBloc).toBe("008");
      expect(r.body.propuesta.orInicial).toBe(inicio + 25);
      expect(r.body.propuesta.orFinal).toBe(inicio + 49);
    });
  });

  describe("Custodia", () => {
    it("no se entrega dos veces sin devolverlo antes", async () => {
      const bloc = await crearBloc(rangoLibre());
      await api(`/blocs/${bloc.bloc.id}/entregar`, gestorA, { method: "POST", body: { responsableNombre: "Ana" } });
      const otra = await api(`/blocs/${bloc.bloc.id}/entregar`, gestorA, {
        method: "POST",
        body: { responsableNombre: "Luis" },
      });
      expect(otra.status).toBe(409);
      expect(otra.body.code).toBe("BLOC_YA_ENTREGADO");
      expect(otra.body.error).toContain("Ana");
    });

    it("no se devuelve un bloc que nadie tiene", async () => {
      const bloc = await crearBloc(rangoLibre());
      const r = await api(`/blocs/${bloc.bloc.id}/devolver`, gestorA, { method: "POST", body: {} });
      expect(r.status).toBe(409);
      expect(r.body.code).toBe("SIN_ENTREGA_ABIERTA");
    });

    it("guarda el histórico de salidas y vueltas, no sólo la última", async () => {
      const bloc = await crearBloc(rangoLibre());
      const id = bloc.bloc.id;
      await api(`/blocs/${id}/entregar`, gestorA, { method: "POST", body: { responsableNombre: "Ana", fechaEntrega: "2026-09-01" } });
      await api(`/blocs/${id}/devolver`, gestorA, { method: "POST", body: { fechaDevolucion: "2026-09-05" } });
      await api(`/blocs/${id}/entregar`, gestorA, { method: "POST", body: { responsableNombre: "Luis", fechaEntrega: "2026-09-06" } });

      const ficha = await api(`/blocs/${id}`, gestorA);
      expect(ficha.body.entregas).toHaveLength(2);
      expect(ficha.body.entregas.map((e: any) => e.responsableNombre)).toEqual(["Luis", "Ana"]);
      expect(ficha.body.bloc.responsableNombre).toBe("Luis");
    });

    it("no se devuelve antes de haberse entregado", async () => {
      const bloc = await crearBloc(rangoLibre());
      await api(`/blocs/${bloc.bloc.id}/entregar`, gestorA, {
        method: "POST",
        body: { responsableNombre: "Ana", fechaEntrega: "2026-09-10" },
      });
      const r = await api(`/blocs/${bloc.bloc.id}/devolver`, gestorA, {
        method: "POST",
        body: { fechaDevolucion: "2026-09-01" },
      });
      expect(r.status).toBe(400);
      expect(r.body.code).toBe("FECHA_INVALIDA");
    });
  });

  describe("Borrar y renumerar", () => {
    it("borra un bloc vacío y deja libre su número", async () => {
      const inicio = rangoLibre();
      const bloc = await crearBloc(inicio);

      const r = await api(`/blocs/${bloc.bloc.id}`, gestorA, { method: "DELETE", body: {} });
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      expect(r.body.numeroBloc).toBe(`B${inicio}`);
      expect(r.body.documentosRetirados).toBe(0);

      // Ya no existe, ni él ni sus OR.
      expect((await api(`/blocs/${bloc.bloc.id}`, gestorA)).status).toBe(404);
      const { rows } = await db.query(`SELECT COUNT(*)::int AS n FROM orm_or WHERE bloc_id = $1`, [bloc.bloc.id]);
      expect(rows[0].n).toBe(0);

      // Y el número se puede volver a usar.
      const otro = await api("/blocs", gestorA, { method: "POST", body: { numeroBloc: `B${inicio}`, orInicial: inicio } });
      expect(otro.status, JSON.stringify(otro.body)).toBe(201);
    });

    it("un bloc con hojas dentro no se borra sin confirmarlo", async () => {
      const inicio = rangoLibre();
      const bloc = await crearBloc(inicio);
      await subirYEsperar("una.pdf", [inicio]);

      const sinConfirmar = await api(`/blocs/${bloc.bloc.id}`, gestorA, { method: "DELETE", body: {} });
      expect(sinConfirmar.status).toBe(409);
      expect(sinConfirmar.body.code).toBe("BLOC_CON_DOCUMENTOS");
      expect(sinConfirmar.body.detalle.archivadas).toBe(1);

      // Sigue ahí: un 409 no se lleva nada por delante.
      expect((await api(`/blocs/${bloc.bloc.id}`, gestorA)).status).toBe(200);

      const confirmado = await api(`/blocs/${bloc.bloc.id}`, gestorA, { method: "DELETE", body: { confirmar: true, motivo: "alta de prueba" } });
      expect(confirmado.status, JSON.stringify(confirmado.body)).toBe(200);
      expect(confirmado.body.documentosRetirados).toBe(1);

      // La hoja se retira, pero su fila y su fichero siguen existiendo.
      const { rows } = await db.query(
        `SELECT estado_procesamiento, storage_key FROM orm_documentos WHERE empresa_id = $1 AND bloc_id IS NULL AND nombre_archivo = $2`,
        [EMPRESA_A, `OR_${inicio}.pdf`]
      );
      expect(rows[0]?.estado_procesamiento).toBe("ELIMINADO");
      expect(rows[0]?.storage_key).toBeTruthy();
      // Y no reaparece en la bandeja de pendientes como trabajo por hacer.
      expect((await api("/documentos/pendientes", gestorA)).body.documentos).toHaveLength(0);
    });

    it("el histórico sobrevive al bloc borrado", async () => {
      const inicio = rangoLibre();
      const bloc = await crearBloc(inicio);
      await api(`/blocs/${bloc.bloc.id}`, gestorA, { method: "DELETE", body: { motivo: "taco de prueba" } });

      const { rows } = await db.query(
        `SELECT accion, detalle FROM orm_eventos WHERE bloc_id = $1 ORDER BY id`,
        [bloc.bloc.id]
      );
      const acciones = rows.map((r) => r.accion);
      expect(acciones).toContain("BLOC_CREADO");
      expect(acciones).toContain("BLOC_BORRADO");
      const borrado = rows.find((r) => r.accion === "BLOC_BORRADO");
      expect(borrado.detalle.numeroBloc).toBe(`B${inicio}`);
      expect(borrado.detalle.motivo).toBe("taco de prueba");
    });

    it("un bloc cerrado no se borra ni confirmándolo", async () => {
      const inicio = rangoLibre();
      const bloc = await crearBloc(inicio, gestorA, { cantidadOr: 1 });
      await subirYEsperar("una.pdf", [inicio]);
      expect((await api(`/blocs/${bloc.bloc.id}/cerrar`, gestorA, { method: "POST", body: {} })).status).toBe(200);

      const r = await api(`/blocs/${bloc.bloc.id}`, gestorA, { method: "DELETE", body: { confirmar: true } });
      expect(r.status).toBe(409);
      expect(r.body.code).toBe("BLOC_CERRADO");
      expect((await api(`/blocs/${bloc.bloc.id}`, gestorA)).status).toBe(200);
    });

    it("renumerar un bloc no toca su rango de OR", async () => {
      const inicio = rangoLibre();
      const bloc = await crearBloc(inicio);

      const r = await api(`/blocs/${bloc.bloc.id}`, gestorA, { method: "PATCH", body: { numeroBloc: "001" } });
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      expect(r.body.bloc.numeroBloc).toBe("001");
      expect(r.body.bloc.orInicial).toBe(inicio);
      expect(r.body.bloc.orFinal).toBe(inicio + 24);
      expect(r.body.ors).toHaveLength(25);
    });

    it("no se renumera pisando el número de otro bloc", async () => {
      const uno = await crearBloc(rangoLibre());
      const dos = await crearBloc(rangoLibre());
      const r = await api(`/blocs/${dos.bloc.id}`, gestorA, { method: "PATCH", body: { numeroBloc: uno.bloc.numeroBloc } });
      expect(r.status).toBe(409);
      expect(r.body.code).toBe("BLOC_DUPLICADO");
    });

    it("el número no se deja en blanco", async () => {
      const bloc = await crearBloc(rangoLibre());
      const r = await api(`/blocs/${bloc.bloc.id}`, gestorA, { method: "PATCH", body: { numeroBloc: "  " } });
      expect(r.status).toBe(400);
      expect(r.body.code).toBe("NUMERO_BLOC_VACIO");
    });

    it("quien sólo escanea no borra blocs", async () => {
      const bloc = await crearBloc(rangoLibre());
      const r = await api(`/blocs/${bloc.bloc.id}`, operarioA, { method: "DELETE", body: { confirmar: true } });
      expect(r.status).toBe(403);
      expect(r.body.permiso).toBe("or-manuales.bloc.eliminar");
    });

    it("el bloc de otra empresa no se puede borrar", async () => {
      const bloc = await crearBloc(rangoLibre(), gestorA);
      const r = await api(`/blocs/${bloc.bloc.id}`, gestorB, { method: "DELETE", body: { confirmar: true } });
      expect(r.status).toBe(404);
      expect((await api(`/blocs/${bloc.bloc.id}`, gestorA)).status).toBe(200);
    });
  });

  describe("Cerrar", () => {
    it("no se cierra un bloc al que le faltan hojas, y se dice cuáles", async () => {
      const inicio = rangoLibre();
      const bloc = await crearBloc(inicio);
      await subirYEsperar("dos.pdf", [inicio, inicio + 1]);

      const r = await api(`/blocs/${bloc.bloc.id}/cerrar`, gestorA, { method: "POST", body: {} });
      expect(r.status).toBe(409);
      expect(r.body.code).toBe("BLOC_INCOMPLETO");
      expect(r.body.detalle.faltan).toHaveLength(23);
    });

    it("un bloc cerrado no admite más documentos", async () => {
      const inicio = rangoLibre();
      const bloc = await crearBloc(inicio, gestorA, { cantidadOr: 1 });
      await subirYEsperar("una.pdf", [inicio]);
      const cerrado = await api(`/blocs/${bloc.bloc.id}/cerrar`, gestorA, { method: "POST", body: {} });
      expect(cerrado.status, JSON.stringify(cerrado.body)).toBe(200);

      // La misma hoja otra vez: se reconoce por su hash y no toca el bloc.
      // Una hoja DISTINTA de esa OR sí intenta archivarse, y se rechaza.
      const proceso = await subirYEsperar("otra-vez.pdf", [inicio, null]);
      expect(proceso.estado).not.toBe("EN_CURSO");
      const ficha = await api(`/blocs/${bloc.bloc.id}`, gestorA);
      expect(ficha.body.bloc.estado).toBe("CERRADO");
    });
  });

  /* ══ El escaneo ═══════════════════════════════════════════════════════════ */

  describe("Procesar escaneos", () => {
    it("una página es una OR: un PDF de 25 páginas deja 25 documentos", async () => {
      const inicio = rangoLibre();
      await crearBloc(inicio);
      const numeros = Array.from({ length: 25 }, (_, i) => inicio + i);
      const proceso = await subirYEsperar("bloc-entero.pdf", numeros);

      expect(proceso.paginas).toBe(25);
      expect(proceso.documentosDetectados).toBe(25);
      expect(proceso.documentosCorrectos).toBe(25);

      const { rows } = await db.query(
        `SELECT COUNT(*)::int AS n FROM orm_documentos WHERE empresa_id = $1 AND estado_procesamiento = 'ARCHIVADO'`,
        [EMPRESA_A]
      );
      expect(rows[0].n).toBe(25);
    });

    it("cada documento se renombra con su OR y conserva el nombre original", async () => {
      const inicio = rangoLibre();
      const bloc = await crearBloc(inicio);
      await subirYEsperar("escan0001.pdf", [inicio]);

      const ficha = await api(`/blocs/${bloc.bloc.id}`, gestorA);
      const or = ficha.body.ors.find((o: any) => o.numeroOr === inicio);
      const doc = await api(`/documentos/${or.documentoPrincipalId}`, gestorA);
      expect(doc.body.documento.nombreArchivo).toBe(`OR_${inicio}.pdf`);
      expect(doc.body.documento.nombreOriginal).toBe("escan0001.pdf");
      expect(doc.body.documento.paginaOrigen).toBe(1);
      expect(doc.body.documento.ocrMetodo).toBe("TEXTO_ZONA");
      expect(doc.body.documento.ocrConfianza).toBeGreaterThanOrEqual(90);
    });

    it("una hoja sin número identificable va a la bandeja, no a una OR cualquiera", async () => {
      const inicio = rangoLibre();
      await crearBloc(inicio);
      const proceso = await subirYEsperar("sin-numero.pdf", [null]);

      expect(proceso.noIdentificados).toBe(1);
      expect(proceso.documentosCorrectos).toBe(0);

      const pendientes = await api("/documentos/pendientes", gestorA);
      expect(pendientes.body.documentos).toHaveLength(1);
      expect(pendientes.body.documentos[0].estadoProcesamiento).toBe("NO_IDENTIFICADO");
      expect(pendientes.body.documentos[0].orId).toBeNull();
    });

    it("una OR que no pertenece a ningún bloc tampoco se archiva", async () => {
      const inicio = rangoLibre();
      await crearBloc(inicio);
      // Un número muy lejos del rango dado de alta.
      const proceso = await subirYEsperar("ajena.pdf", [inicio + 9000]);
      expect(proceso.noIdentificados).toBe(1);

      const pendientes = await api("/documentos/pendientes", gestorA);
      expect(pendientes.body.documentos[0].estadoProcesamiento).toBe("NO_IDENTIFICADO");
    });

    it("una página mala no impide procesar las demás del lote", async () => {
      const inicio = rangoLibre();
      await crearBloc(inicio);
      const proceso = await subirYEsperar("mezcla.pdf", [inicio, null, inicio + 1, inicio + 9000, inicio + 2]);

      expect(proceso.paginas).toBe(5);
      expect(proceso.documentosCorrectos).toBe(3);
      expect(proceso.noIdentificados).toBe(2);
      expect(proceso.estado).toBe("COMPLETADO");
    });

    /*
     * El caso real del mostrador: se vacía el escáner con lo que hay encima de
     * la mesa, sin separar por blocs ni ponerlo en orden. El archivado va por
     * PÁGINA —cada hoja busca su bloc por su número—, así que el lote no tiene
     * por qué ser de un solo bloc. Esto lo deja escrito.
     */
    it("un solo escaneo con hojas de tres blocs las reparte por su bloc", async () => {
      const a = rangoLibre();
      const b = rangoLibre();
      const c = rangoLibre();
      const blocA = await crearBloc(a);
      const blocB = await crearBloc(b);
      const blocC = await crearBloc(c);

      // Mezcladas y desordenadas, como salen del escáner.
      const proceso = await subirYEsperar("cajon-de-sastre.pdf", [b + 3, a, c + 10, a + 1, b, c]);

      expect(proceso.paginas).toBe(6);
      expect(proceso.documentosCorrectos).toBe(6);
      expect(proceso.noIdentificados).toBe(0);
      expect(proceso.duplicados).toBe(0);

      const archivadasDe = async (bloc: any, numeros: number[]) => {
        const ficha = await api(`/blocs/${bloc.bloc.id}`, gestorA);
        expect(ficha.body.progreso.archivadas, `bloc ${ficha.body.bloc.numeroBloc}`).toBe(numeros.length);
        const escaneadas = ficha.body.ors.filter((o: any) => o.estado === "ESCANEADA").map((o: any) => o.numeroOr);
        expect(escaneadas.sort((x: number, y: number) => x - y)).toEqual([...numeros].sort((x, y) => x - y));
        return ficha.body;
      };

      await archivadasDe(blocA, [a, a + 1]);
      await archivadasDe(blocB, [b, b + 3]);
      await archivadasDe(blocC, [c, c + 10]);

      // Cada bloc lleva su propia cuenta y su propio aviso: no hay uno del lote.
      const avisos = await api("/avisos", gestorA);
      expect(avisos.body.avisos).toHaveLength(3);
      expect(avisos.body.avisos.every((v: any) => v.tipo === "BLOC_INCOMPLETO")).toBe(true);

      // Y ningún documento acabó colgando de un bloc que no era el suyo.
      const { rows } = await db.query(
        `SELECT b.numero_bloc, o.numero_or
           FROM orm_documentos d
           JOIN orm_or o ON o.id = d.or_id
           JOIN orm_blocs b ON b.id = d.bloc_id
          WHERE d.empresa_id = $1 AND d.estado_procesamiento = 'ARCHIVADO'`,
        [EMPRESA_A]
      );
      for (const fila of rows) {
        const suyo = [blocA, blocB, blocC].find((x) => x.bloc.numeroBloc === fila.numero_bloc);
        expect(fila.numero_or, `la OR ${fila.numero_or} está en el bloc ${fila.numero_bloc}`).toBeGreaterThanOrEqual(
          suyo.bloc.orInicial
        );
        expect(fila.numero_or).toBeLessThanOrEqual(suyo.bloc.orFinal);
      }
    });

    it("en un lote mezclado, la hoja de un bloc CERRADO no se cuela y el resto entra igual", async () => {
      const cerrado = rangoLibre();
      const abierto = rangoLibre();

      // Un bloc de una sola OR, escaneado y cerrado.
      const blocCerrado = await crearBloc(cerrado, gestorA, { cantidadOr: 1 });
      await subirYEsperar("la-suya.pdf", [cerrado]);
      expect((await api(`/blocs/${blocCerrado.bloc.id}/cerrar`, gestorA, { method: "POST", body: {} })).status).toBe(200);

      const blocAbierto = await crearBloc(abierto);

      // El lote trae otra hoja de ese mismo número, una que no es de nadie y dos buenas.
      const proceso = await subirYEsperar("mezcla.pdf", [cerrado, abierto, abierto + 9000, abierto + 1]);

      expect(proceso.documentosCorrectos).toBe(2);
      expect(proceso.noIdentificados).toBe(2);

      // El bloc cerrado se queda como estaba.
      const ficha = await api(`/blocs/${blocCerrado.bloc.id}`, gestorA);
      expect(ficha.body.bloc.estado).toBe("CERRADO");
      expect(ficha.body.progreso.archivadas).toBe(1);

      // Y el abierto se lleva sus dos hojas.
      expect((await api(`/blocs/${blocAbierto.bloc.id}`, gestorA)).body.progreso.archivadas).toBe(2);

      // La del cerrado queda en la bandeja CON su número leído, para que una
      // persona decida: no se archiva a la fuerza ni se pierde.
      const pendientes = await api("/documentos/pendientes", gestorA);
      expect(pendientes.body.documentos.some((d: any) => d.ocrNumeroDetectado === cerrado)).toBe(true);
    });

    it("subir dos veces el mismo escaneo no duplica nada", async () => {
      const inicio = rangoLibre();
      const bloc = await crearBloc(inicio);
      const pdf = await pdfDeOrs([inicio, inicio + 1]);

      const p1 = await subir("lote.pdf", pdf);
      await esperarProceso(p1.body.procesos[0].id);
      const p2 = await subir("lote.pdf", pdf);
      const repetido = await esperarProceso(p2.body.procesos[0].id);

      expect(repetido.duplicados).toBe(2);
      const ficha = await api(`/blocs/${bloc.bloc.id}`, gestorA);
      expect(ficha.body.progreso.archivadas).toBe(2);
    });

    it("rechaza lo que no es un PDF ni una imagen", async () => {
      const form = new FormData();
      form.append("documentos", new Blob([new Uint8Array(Buffer.from("no soy un pdf"))], { type: "application/pdf" }), "falso.pdf");
      const r = await fetch(`${base}/api/or-manuales/documentos`, {
        method: "POST",
        headers: cabeceras(operarioA),
        body: form,
      });
      expect(r.status).toBe(415);
      const body = await r.json();
      expect(body.code).toBe("FICHERO_NO_ADMITIDO");
    });
  });

  describe("Duplicados y correcciones", () => {
    it("un segundo documento para la misma OR NO sobrescribe al primero", async () => {
      const inicio = rangoLibre();
      const bloc = await crearBloc(inicio);
      await subirYEsperar("primera.pdf", [inicio]);

      const ficha1 = await api(`/blocs/${bloc.bloc.id}`, gestorA);
      const original = ficha1.body.ors.find((o: any) => o.numeroOr === inicio).documentoPrincipalId;

      // Otra hoja de la misma OR: distinto contenido, mismo número.
      const otra = await PDFDocument.create();
      const fuente = await otra.embedFont(StandardFonts.Helvetica);
      const p = otra.addPage([595, 842]);
      p.drawText(`OR Nº ${inicio}`, { x: 400, y: 790, size: 16, font: fuente });
      p.drawText("SEGUNDA COPIA DISTINTA", { x: 60, y: 500, size: 14, font: fuente });
      const r = await subir("segunda.pdf", Buffer.from(await otra.save()));
      await esperarProceso(r.body.procesos[0].id);

      const ficha2 = await api(`/blocs/${bloc.bloc.id}`, gestorA);
      const or = ficha2.body.ors.find((o: any) => o.numeroOr === inicio);
      // El principal sigue siendo el primero.
      expect(or.documentoPrincipalId).toBe(original);
      expect(or.estado).toBe("DUPLICADA");

      const pendientes = await api("/documentos/pendientes", gestorA);
      expect(pendientes.body.documentos.some((d: any) => d.estadoProcesamiento === "DUPLICADO")).toBe(true);
    });

    it("sustituir deja el anterior en el histórico, no lo borra", async () => {
      const inicio = rangoLibre();
      const bloc = await crearBloc(inicio);
      await subirYEsperar("primera.pdf", [inicio]);
      const ficha1 = await api(`/blocs/${bloc.bloc.id}`, gestorA);
      const original = ficha1.body.ors.find((o: any) => o.numeroOr === inicio).documentoPrincipalId;

      const otra = await PDFDocument.create();
      const fuente = await otra.embedFont(StandardFonts.Helvetica);
      const p = otra.addPage([595, 842]);
      p.drawText(`OR Nº ${inicio}`, { x: 400, y: 790, size: 16, font: fuente });
      p.drawText("VERSION BUENA", { x: 60, y: 500, size: 14, font: fuente });
      const r = await subir("buena.pdf", Buffer.from(await otra.save()));
      await esperarProceso(r.body.procesos[0].id);

      const duplicado = (await api("/documentos/pendientes", gestorA)).body.documentos.find(
        (d: any) => d.estadoProcesamiento === "DUPLICADO"
      );
      const sustituido = await api(`/documentos/${duplicado.id}/sustituir`, gestorA, { method: "POST", body: {} });
      expect(sustituido.status, JSON.stringify(sustituido.body)).toBe(200);

      const ficha2 = await api(`/blocs/${bloc.bloc.id}`, gestorA);
      const or = ficha2.body.ors.find((o: any) => o.numeroOr === inicio);
      expect(or.documentoPrincipalId).toBe(duplicado.id);
      expect(or.estado).toBe("ESCANEADA");

      // El de antes sigue existiendo y se puede abrir.
      const viejo = await api(`/documentos/${original}`, gestorA);
      expect(viejo.body.documento.estadoProcesamiento).toBe("SUSTITUIDO");
    });

    it("la asignación manual archiva un documento que no se supo identificar", async () => {
      const inicio = rangoLibre();
      const bloc = await crearBloc(inicio);
      await subirYEsperar("sin-numero.pdf", [null]);

      const pendiente = (await api("/documentos/pendientes", gestorA)).body.documentos[0];
      const r = await api(`/documentos/${pendiente.id}/asignar`, gestorA, {
        method: "POST",
        body: { numeroOr: inicio + 3 },
      });
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      expect(r.body.estado).toBe("ARCHIVADO");

      const ficha = await api(`/blocs/${bloc.bloc.id}`, gestorA);
      const or = ficha.body.ors.find((o: any) => o.numeroOr === inicio + 3);
      expect(or.estado).toBe("ESCANEADA");
      expect(or.documentoPrincipalId).toBe(pendiente.id);

      const eventos = ficha.body.eventos.map((e: any) => e.accion);
      expect(eventos).toContain("ASIGNACION_MANUAL");
    });

    it("no se asigna a una OR que no existe", async () => {
      const inicio = rangoLibre();
      await crearBloc(inicio);
      await subirYEsperar("sin-numero.pdf", [null]);
      const pendiente = (await api("/documentos/pendientes", gestorA)).body.documentos[0];

      const r = await api(`/documentos/${pendiente.id}/asignar`, gestorA, {
        method: "POST",
        body: { numeroOr: inicio + 9999 },
      });
      expect(r.status).toBe(404);
      expect(r.body.code).toBe("OR_INEXISTENTE");
    });

    it("reprocesar recoge la hoja que llegó antes que su bloc", async () => {
      const inicio = rangoLibre();
      // Se escanea ANTES de dar de alta el bloc: no hay dónde archivarla.
      await subirYEsperar("adelantada.pdf", [inicio + 5]);
      const pendiente = (await api("/documentos/pendientes", gestorA)).body.documentos[0];
      expect(pendiente.estadoProcesamiento).toBe("NO_IDENTIFICADO");

      const bloc = await crearBloc(inicio);
      const r = await api(`/documentos/${pendiente.id}/reprocesar`, gestorA, { method: "POST", body: {} });
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      expect(r.body.documento.estadoProcesamiento).toBe("ARCHIVADO");

      const ficha = await api(`/blocs/${bloc.bloc.id}`, gestorA);
      expect(ficha.body.progreso.archivadas).toBe(1);
    });

    it("eliminar un documento devuelve su OR a pendiente y deja rastro", async () => {
      const inicio = rangoLibre();
      const bloc = await crearBloc(inicio);
      await subirYEsperar("una.pdf", [inicio]);
      const ficha1 = await api(`/blocs/${bloc.bloc.id}`, gestorA);
      const docId = ficha1.body.ors.find((o: any) => o.numeroOr === inicio).documentoPrincipalId;

      const r = await api(`/documentos/${docId}`, gestorA, { method: "DELETE", body: { motivo: "escaneo torcido" } });
      expect(r.status).toBe(200);

      const ficha2 = await api(`/blocs/${bloc.bloc.id}`, gestorA);
      const or = ficha2.body.ors.find((o: any) => o.numeroOr === inicio);
      expect(or.estado).toBe("PENDIENTE");
      expect(or.documentoPrincipalId).toBeNull();
      expect(ficha2.body.eventos.map((e: any) => e.accion)).toContain("DOCUMENTO_ELIMINADO");
    });
  });

  /* ══ Confianza y configuración ════════════════════════════════════════════ */

  describe("La confianza y sus umbrales", () => {
    it("con el umbral automático al máximo, lo mismo pasa a revisión", async () => {
      const inicio = rangoLibre();
      const bloc = await crearBloc(inicio);

      // 101 es inalcanzable: nada se archiva solo y todo cae en la banda de revisión.
      const config = await api("/config", adminA, { method: "PUT", body: { umbralAutomatico: 100, umbralRevision: 50 } });
      expect(config.status, JSON.stringify(config.body)).toBe(200);

      // Sin rótulo, la hoja no llega a 100.
      const doc = await PDFDocument.create();
      const fuente = await doc.embedFont(StandardFonts.Helvetica);
      const p = doc.addPage([595, 842]);
      p.drawText(String(inicio), { x: 430, y: 790, size: 16, font: fuente });
      const r = await subir("sin-rotulo.pdf", Buffer.from(await doc.save()));
      const proceso = await esperarProceso(r.body.procesos[0].id);

      expect(proceso.documentosRevision).toBe(1);
      expect(proceso.documentosCorrectos).toBe(0);

      const ficha = await api(`/blocs/${bloc.bloc.id}`, gestorA);
      const or = ficha.body.ors.find((o: any) => o.numeroOr === inicio);
      expect(or.estado).toBe("REVISAR");
      // Cuenta como archivada —el papel está— pero el bloc pide que se mire.
      expect(ficha.body.progreso.enRevision).toBe(1);
    });

    it("confirmar una revisión la deja archivada", async () => {
      const inicio = rangoLibre();
      const bloc = await crearBloc(inicio, gestorA, { cantidadOr: 1 });
      await api("/config", adminA, { method: "PUT", body: { umbralAutomatico: 100, umbralRevision: 50 } });

      const doc = await PDFDocument.create();
      const fuente = await doc.embedFont(StandardFonts.Helvetica);
      doc.addPage([595, 842]).drawText(String(inicio), { x: 430, y: 790, size: 16, font: fuente });
      const r = await subir("sin-rotulo.pdf", Buffer.from(await doc.save()));
      await esperarProceso(r.body.procesos[0].id);

      const enRevision = (await api("/documentos/pendientes", gestorA)).body.documentos[0];
      const confirmado = await api(`/documentos/${enRevision.id}/confirmar`, gestorA, { method: "POST", body: {} });
      expect(confirmado.status, JSON.stringify(confirmado.body)).toBe(200);

      const ficha = await api(`/blocs/${bloc.bloc.id}`, gestorA);
      expect(ficha.body.bloc.estado).toBe("COMPLETO");
      expect(ficha.body.progreso.enRevision).toBe(0);
    });

    it("la zona de OCR se guarda y se valida", async () => {
      const ok = await api("/config", adminA, {
        method: "PUT",
        body: { zona: { x: 0, y: 0.7, ancho: 0.5, alto: 0.3 } },
      });
      expect(ok.status).toBe(200);
      expect(ok.body.config.zona).toEqual({ x: 0, y: 0.7, ancho: 0.5, alto: 0.3 });

      const mal = await api("/config", adminA, {
        method: "PUT",
        body: { zona: { x: 0.8, y: 0, ancho: 0.5, alto: 0.2 } },
      });
      expect(mal.status).toBe(400);
      expect(mal.body.code).toBe("ZONA_INVALIDA");
    });
  });

  /* ══ Búsqueda ═════════════════════════════════════════════════════════════ */

  describe("Buscar", () => {
    it("escribir el número de una OR lleva a su bloc y a su documento", async () => {
      const inicio = rangoLibre();
      await crearBloc(inicio);
      await subirYEsperar("una.pdf", [inicio + 4]);

      const r = await api(`/buscar?q=${inicio + 4}`, consultaA);
      expect(r.body.or.numeroOr).toBe(inicio + 4);
      expect(r.body.or.estado).toBe("ESCANEADA");
      expect(r.body.bloc.numeroBloc).toBe(`B${inicio}`);
      expect(r.body.documento.nombreArchivo).toBe(`OR_${inicio + 4}.pdf`);
    });

    it("el listado también encuentra el bloc por un número de su rango", async () => {
      const inicio = rangoLibre();
      await crearBloc(inicio);
      const r = await api(`/blocs?q=${inicio + 12}`, gestorA);
      expect(r.body.blocs).toHaveLength(1);
      expect(r.body.blocs[0].numeroBloc).toBe(`B${inicio}`);
    });
  });

  /* ══ Permisos y aislamiento ═══════════════════════════════════════════════ */

  describe("Permisos", () => {
    it("quien sólo consulta no crea blocs", async () => {
      const r = await api("/blocs", consultaA, { method: "POST", body: { orInicial: rangoLibre() } });
      expect(r.status).toBe(403);
      expect(r.body.code).toBe("PERMISO_DENEGADO");
    });

    it("el operario escanea pero no cierra blocs", async () => {
      const bloc = await crearBloc(rangoLibre());
      const r = await api(`/blocs/${bloc.bloc.id}/cerrar`, operarioA, { method: "POST", body: {} });
      expect(r.status).toBe(403);
      expect(r.body.permiso).toBe("or-manuales.bloc.cerrar");
    });

    it("sin acceso al módulo no se ve nada", async () => {
      const sinRol: Quien = { usuario: "00000000-0000-4000-a000-0000000000ff", empresa: EMPRESA_A, nombre: "Nadie" };
      const r = await api("/bootstrap", sinRol);
      expect(r.status).toBe(403);
    });

    it("sólo un admin toca la configuración", async () => {
      const r = await api("/config", gestorA, { method: "PUT", body: { umbralRevision: 60 } });
      // El gestor no tiene `config.manage`.
      expect(r.status).toBe(403);
    });
  });

  describe("Aislamiento entre empresas", () => {
    it("el bloc de una empresa no existe para la otra", async () => {
      const bloc = await crearBloc(rangoLibre());
      const r = await api(`/blocs/${bloc.bloc.id}`, gestorB);
      // 404 y no 403: «no existe» y «no es tuyo» contestan igual.
      expect(r.status).toBe(404);
    });

    it("dos empresas pueden usar el mismo número de OR sin pisarse", async () => {
      const inicio = rangoLibre();
      await crearBloc(inicio, gestorA);
      const r = await api("/blocs", gestorB, { method: "POST", body: { numeroBloc: `B${inicio}`, orInicial: inicio } });
      expect(r.status, JSON.stringify(r.body)).toBe(201);
    });

    it("ni los documentos ni los indicadores se cruzan", async () => {
      const inicio = rangoLibre();
      await crearBloc(inicio, gestorA);
      await subirYEsperar("una.pdf", [inicio], operarioA);

      const indicadoresB = await api("/indicadores", gestorB);
      expect(indicadoresB.body.indicadores.blocsPendientes).toBe(0);
      expect((await api("/documentos/pendientes", gestorB)).body.documentos).toHaveLength(0);
    });
  });

  /* ══ El histórico no se toca ══════════════════════════════════════════════ */

  it("el histórico del módulo es inmutable", async () => {
    const bloc = await crearBloc(rangoLibre());
    await expect(
      db.query(`UPDATE orm_eventos SET accion = 'MENTIRA' WHERE bloc_id = $1`, [bloc.bloc.id])
    ).rejects.toThrow(/inmutable/i);
    await expect(db.query(`DELETE FROM orm_eventos WHERE bloc_id = $1`, [bloc.bloc.id])).rejects.toThrow(/inmutable/i);
  });

  it("los indicadores del panel salen de la base, no de contadores guardados", async () => {
    const inicio = rangoLibre();
    const bloc = await crearBloc(inicio);
    await api(`/blocs/${bloc.bloc.id}/entregar`, gestorA, { method: "POST", body: { responsableNombre: "Ana" } });
    await crearBloc(rangoLibre());

    const r = await api("/bootstrap", gestorA);
    expect(r.body.indicadores.blocsEntregados).toBe(1);
    expect(r.body.indicadores.blocsPendientes).toBe(1);
    expect(r.body.indicadores.orPendientes).toBe(50);
    expect(r.body.permisos).toContain("or-manuales.bloc.cerrar");
    expect(r.body.vocabulario.etiquetas.estadoBloc.CERRADO).toBe("Cerrado");
  });
});
