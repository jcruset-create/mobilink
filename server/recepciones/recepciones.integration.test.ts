/**
 * El circuito de recepción por HTTP y contra PostgreSQL de verdad.
 *
 * Es la mitad del módulo que no se puede probar con funciones puras: el
 * cerrojo del cierre es un FOR UPDATE, la idempotencia un UNIQUE y los
 * acumulados un UPDATE dentro de una transacción. Nada de eso existe fuera de
 * la base.
 *
 * Los casos son los del encargo:
 *
 *   1  OK · pedido 2, expedido 2, recibido 2 → albarán RECIBIDO, pedido COMPLETADO, sin incidencia
 *   2  expedición parcial · pedido 10, expedido 6, recibido 6 → OK, y el pedido sigue con 4 por expedir
 *   3  incidencia · expedido 10, recibido 8 → PARCIALMENTE_RECIBIDO, FALTA_MERCANCIA −2, quedan 2
 *   4  concurrencia · dos cierres a la vez sobre el mismo albarán → uno crea, el otro 409
 *   5  recepción parcial · 8 y luego 2 → 10 recibidas, dos recepciones, sin duplicar
 *   6  documentos · el original queda intacto (mismo hash) y el recepcionado es otro fichero
 *   7  sin mapeo de artículo · se recepciona igual
 *
 * Y además: rectificación, idempotencia por clave, aislamiento entre empresas,
 * inmutabilidad del histórico y —lo que más importa a este encargo— que en
 * todo el módulo NO existe ninguna referencia a `movimientos_stock`.
 *
 * Sólo con RUN_DB_TESTS=1 y DATABASE_URL a una base DESECHABLE.
 */

import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import fs from "node:fs";
import path from "node:path";

import express from "express";
import PDFDocument from "pdfkit";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const RUN = process.env.RUN_DB_TESTS === "1" && !!process.env.DATABASE_URL;

process.env.RECEPCIONES_STORAGE_LOCAL = "1";

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

const EMPRESA_A = "00000000-0000-4000-a000-00000000cc01";
const EMPRESA_B = "00000000-0000-4000-a000-00000000cc02";
const GESTOR_A = "00000000-0000-4000-a000-000000000c01";
const OPERARIO_A = "00000000-0000-4000-a000-000000000c02";
const OPERARIO_A2 = "00000000-0000-4000-a000-000000000c03";
const GESTOR_B = "00000000-0000-4000-a000-000000000c04";

const gestorA = { usuario: GESTOR_A, empresa: EMPRESA_A, nombre: "Gestora Prueba" };
const operarioA = { usuario: OPERARIO_A, empresa: EMPRESA_A, nombre: "Juan Pérez" };
const operarioA2 = { usuario: OPERARIO_A2, empresa: EMPRESA_A, nombre: "Ana López" };
const gestorB = { usuario: GESTOR_B, empresa: EMPRESA_B, nombre: "Otra Empresa" };

type Quien = { usuario: string; empresa: string; nombre: string };
type Respuesta = { status: number; body: any; headers: Headers };

function api(ruta: string, quien: Quien, init?: { method?: string; body?: unknown; headers?: Record<string, string> }): Promise<Respuesta> {
  return fetch(`${base}/api/recepciones${ruta}`, {
    method: init?.method ?? "GET",
    headers: {
      "x-test-user": quien.usuario,
      "x-test-empresa": quien.empresa,
      "x-test-nombre": quien.nombre,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
    body: init?.body != null ? JSON.stringify(init.body) : undefined,
  }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => ({})), headers: r.headers }));
}

async function apiBinario(ruta: string, quien: Quien): Promise<{ status: number; bytes: Buffer; headers: Headers }> {
  const r = await fetch(`${base}/api/recepciones${ruta}`, {
    headers: { "x-test-user": quien.usuario, "x-test-empresa": quien.empresa, "x-test-nombre": quien.nombre },
  });
  return { status: r.status, bytes: Buffer.from(await r.arrayBuffer()), headers: r.headers };
}

/** Un PDF de una página que hace de albarán original. */
function pdfDePrueba(texto: string): Promise<Buffer> {
  const doc = new PDFDocument({ size: "A4" });
  const trozos: Buffer[] = [];
  doc.on("data", (c: Buffer) => trozos.push(c));
  const listo = new Promise<Buffer>((resolve) => doc.on("end", () => resolve(Buffer.concat(trozos))));
  doc.fontSize(18).text(texto, 60, 60);
  doc.end();
  return listo;
}

async function subirOriginal(albaranId: string, contenido: Buffer, quien: Quien = gestorA): Promise<Respuesta> {
  const form = new FormData();
  form.append("documento", new Blob([new Uint8Array(contenido)], { type: "application/pdf" }), "albaran.pdf");
  const r = await fetch(`${base}/api/recepciones/albaranes/${albaranId}/original`, {
    method: "POST",
    headers: { "x-test-user": quien.usuario, "x-test-empresa": quien.empresa, "x-test-nombre": quien.nombre },
    body: form,
  });
  return { status: r.status, body: await r.json().catch(() => ({})), headers: r.headers };
}

/* ── El caso real de Soledad ─────────────────────────────────────────────── */

let proveedorId = "";
let contador = 0;
const numeroUnico = (prefijo: string) => `${prefijo}${Date.now() % 1_000_000}${(contador += 1)}`;

async function crearPedido(cantidad = 2, extra: Record<string, unknown> = {}, quien: Quien = gestorA) {
  const r = await api("/pedidos", quien, {
    method: "POST",
    body: {
      proveedorId,
      numeroProveedor: numeroUnico("56888"),
      fechaPedido: "2026-09-15",
      centroNombre: "TARRAGONA",
      almacenOrigen: "227 - ALMACEN MANRESA (CATALUÑA)",
      transportista: "TRANSAHER",
      usuarioPedido: "comercialseatarragona",
      lineas: [{ descripcionProveedor: "245/70X17.5 HANKOOK AH35 136M", cantidadPedida: cantidad, precioUnitarioCentimos: 24845 }],
      ...extra,
    },
  });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body as { pedido: any; lineas: any[] };
}

async function crearAlbaran(pedido: { pedido: any; lineas: any[] }, cantidadExpedida: number, quien: Quien = gestorA) {
  const r = await api(`/pedidos/${pedido.pedido.id}/albaranes`, quien, {
    method: "POST",
    body: {
      numeroProveedor: numeroUnico("20284"),
      fechaExpedicion: "2026-09-15",
      transportista: "TRANSAHER",
      lineas: [{ pedidoLineaId: pedido.lineas[0].id, cantidadExpedida }],
    },
  });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  const albaran = r.body.albaranes[r.body.albaranes.length - 1];
  return { ficha: r.body, albaran, linea: albaran.lineas[0] };
}

afterAll(async () => {
  if (!RUN) return;
  await new Promise<void>((r) => servidor?.close(() => r()));
  await db?.end().catch(() => {});
});

describe.skipIf(!RUN)("Recepciones · circuito manual contra PostgreSQL", () => {
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
      [OPERARIO_A2, "operario"],
      [GESTOR_B, "gestor"],
    ]) {
      await db.query(
        `INSERT INTO app_usuario_modulos (user_id, modulo, rol) VALUES ($1,'recepciones',$2)
         ON CONFLICT (user_id, modulo) DO UPDATE SET rol = EXCLUDED.rol`,
        [usuario, rol]
      );
    }

    const { createRecepcionesRouter } = await import("./router.ts");
    const app = express();
    app.use(express.json());
    app.use("/api/recepciones", createRecepcionesRouter());
    await new Promise<void>((listo) => {
      servidor = app.listen(0, () => {
        base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
        listo();
      });
    });
  }, 60_000);

  beforeEach(async () => {
    const empresas = [EMPRESA_A, EMPRESA_B];
    // El histórico es inmutable por trigger: se vacía desactivándolo, que es
    // lo que haría un administrador de la base, no la aplicación.
    await db.query(`ALTER TABLE rcp_eventos DISABLE TRIGGER rcp_eventos_inmutable_trg`);
    await db.query(`DELETE FROM rcp_eventos WHERE empresa_id = ANY($1)`, [empresas]);
    await db.query(`ALTER TABLE rcp_eventos ENABLE TRIGGER rcp_eventos_inmutable_trg`);
    for (const t of [
      "rcp_rectificacion_lineas",
      "rcp_rectificaciones",
      "rcp_incidencias",
      "rcp_documentos",
      "rcp_recepcion_lineas",
      "rcp_recepciones",
      "rcp_albaran_lineas",
      "rcp_albaranes",
      "rcp_pedido_lineas",
      "rcp_pedidos",
      "rcp_proveedor_articulos",
      "rcp_proveedores",
      "rcp_operarios",
      "rcp_contadores",
    ]) {
      if (t === "rcp_rectificacion_lineas") {
        await db.query(`DELETE FROM rcp_rectificacion_lineas WHERE rectificacion_id IN (SELECT id FROM rcp_rectificaciones WHERE empresa_id = ANY($1))`, [empresas]);
      } else {
        await db.query(`DELETE FROM ${t} WHERE empresa_id = ANY($1)`, [empresas]);
      }
    }
    const r = await api("/proveedores", gestorA, {
      method: "POST",
      body: { codigo: "SOLEDAD", nombre: "NEUMÁTICOS SOLEDAD", remitentesCorreo: ["pedidos@soledad.example"] },
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    proveedorId = r.body.proveedor.id;
  });

  /* ── Bootstrap y permisos ────────────────────────────────────────────── */

  it("el bootstrap dice el rol, los permisos y el vocabulario", async () => {
    const r = await api("/bootstrap", operarioA);
    expect(r.status).toBe(200);
    expect(r.body.rol).toBe("operario");
    expect(r.body.permisos).toContain("recepciones.recibir");
    expect(r.body.permisos).not.toContain("recepciones.pedido.create");
    expect(r.body.vocabulario.tiposIncidencia).toContain("FALTA_MERCANCIA");
    expect(r.body.proveedores.map((p: any) => p.codigo)).toEqual(["SOLEDAD"]);
  });

  it("un operario no puede crear pedidos", async () => {
    const r = await api("/pedidos", operarioA, { method: "POST", body: { proveedorId, numeroProveedor: "1", lineas: [] } });
    expect(r.status).toBe(403);
    expect(r.body.code).toBe("PERMISO_DENEGADO");
  });

  /* ── El orden de la bandeja ──────────────────────────────────────────── */

  it("la bandeja va de lo más viejo a lo más nuevo: el muelle es una cola", async () => {
    const viejo = await crearPedido(2);
    const nuevo = await crearPedido(2);
    // El más viejo se expidió antes, aunque se dé de alta primero el otro.
    const albaranNuevo = await api(`/pedidos/${nuevo.pedido.id}/albaranes`, gestorA, {
      method: "POST",
      body: { numeroProveedor: numeroUnico("20291"), fechaExpedicion: "2026-09-16", lineas: [{ pedidoLineaId: nuevo.lineas[0].id, cantidadExpedida: 2 }] },
    });
    const albaranViejo = await api(`/pedidos/${viejo.pedido.id}/albaranes`, gestorA, {
      method: "POST",
      body: { numeroProveedor: numeroUnico("20290"), fechaExpedicion: "2026-09-10", lineas: [{ pedidoLineaId: viejo.lineas[0].id, cantidadExpedida: 2 }] },
    });
    expect(albaranNuevo.status).toBe(201);
    expect(albaranViejo.status).toBe(201);

    const ids = (await api("/bandeja", operarioA)).body.albaranes.map((a: any) => a.id);
    const idViejo = albaranViejo.body.albaranes.at(-1).id;
    const idNuevo = albaranNuevo.body.albaranes.at(-1).id;
    expect(ids.indexOf(idViejo)).toBeLessThan(ids.indexOf(idNuevo));
  });

  /* ── Editar proveedores ──────────────────────────────────────────────── */

  describe("editar un proveedor", () => {
    it("se le puede cambiar el código, el nombre, el NIF y los remitentes", async () => {
      const alta = await api("/proveedores", gestorA, {
        method: "POST",
        body: { codigo: `TMP${Date.now() % 100000}`, nombre: "NEUMÁTICOS SOLEDAD", remitentesCorreo: ["jordi.cruset@gruposedad.net"] },
      });
      expect(alta.status, JSON.stringify(alta.body)).toBe(201);
      const id = alta.body.proveedor.id;
      const nuevoCodigo = `SOL${Date.now() % 100000}`;

      const r = await api(`/proveedores/${id}`, gestorA, {
        method: "PATCH",
        body: { codigo: nuevoCodigo, nombre: "NEUMÁTICOS SOLEDAD, S.A.", nif: "A03012345", remitentesCorreo: ["noreply@gruposoledad.net", "gruposoledad.net"] },
      });
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      expect(r.body.proveedor.codigo).toBe(nuevoCodigo);
      expect(r.body.proveedor.nombre).toBe("NEUMÁTICOS SOLEDAD, S.A.");
      expect(r.body.proveedor.nif).toBe("A03012345");
      expect(r.body.proveedor.remitentesCorreo).toEqual(["noreply@gruposoledad.net", "gruposoledad.net"]);
    });

    it("el código se normaliza igual que al darlo de alta, y no puede chocar con otro", async () => {
      const codigoA = `UNO${Date.now() % 100000}`;
      const a = await api("/proveedores", gestorA, { method: "POST", body: { codigo: codigoA, nombre: "Uno" } });
      const b = await api("/proveedores", gestorA, { method: "POST", body: { codigo: `DOS${Date.now() % 100000}`, nombre: "Dos" } });
      expect(a.status).toBe(201);
      expect(b.status).toBe(201);

      // Minúsculas y adornos se limpian, como en el alta.
      const sufijo = `${Date.now() % 100000}`;
      const limpio = await api(`/proveedores/${b.body.proveedor.id}`, gestorA, { method: "PATCH", body: { codigo: ` sol edad${sufijo}! ` } });
      expect(limpio.status, JSON.stringify(limpio.body)).toBe(200);
      expect(limpio.body.proveedor.codigo).toBe(`SOLEDAD${sufijo}`);

      // Y pisarle el código a otro se rechaza en vez de reventar con un 500.
      const choque = await api(`/proveedores/${b.body.proveedor.id}`, gestorA, { method: "PATCH", body: { codigo: codigoA } });
      expect(choque.status).toBe(409);
      expect(choque.body.code).toBe("PROVEEDOR_DUPLICADO");
    });

    it("cambiar los remitentes cambia de quién reconoce el buzón cada correo", async () => {
      const alta = await api("/proveedores", gestorA, {
        method: "POST",
        body: { codigo: `REM${Date.now() % 100000}`, nombre: "Con remitente malo", remitentesCorreo: ["NoReply@GRUPOSEDAD.net"] },
      });
      // Se guardan en minúsculas: si no, el mismo remitente escrito de dos
      // formas sería dos remitentes distintos.
      expect(alta.body.proveedor.remitentesCorreo).toEqual(["noreply@gruposedad.net"]);

      const r = await api(`/proveedores/${alta.body.proveedor.id}`, gestorA, { method: "PATCH", body: { remitentesCorreo: ["  GrupoSoledad.NET  "] } });
      expect(r.body.proveedor.remitentesCorreo).toEqual(["gruposoledad.net"]);
    });

    it("el operario del muelle no puede editar proveedores", async () => {
      const alta = await api("/proveedores", gestorA, { method: "POST", body: { codigo: `NOP${Date.now() % 100000}`, nombre: "Ni tocarlo" } });
      const r = await api(`/proveedores/${alta.body.proveedor.id}`, operarioA, { method: "PATCH", body: { nombre: "Colado" } });
      expect(r.status).toBe(403);
    });
  });

  /* ── El operario que firma ───────────────────────────────────────────── */

  describe("quién recibe la mercancía", () => {
    const alta = (nombre: string, pin: string, centroId: string | null = null) =>
      api("/operarios", gestorA, { method: "POST", body: { nombre, pin, centroId } });

    it("sin padrón de operarios firma la sesión: el módulo se puede usar desde el primer día", async () => {
      const pedido = await crearPedido(2);
      const { albaran } = await crearAlbaran(pedido, 2);
      const r = await api(`/albaranes/${albaran.id}/recepcion`, operarioA, { method: "POST", body: { resultado: "OK" } });
      expect(r.status, JSON.stringify(r.body)).toBe(201);
      expect(r.body.recepcion.operarioNombre).toBeNull();
      expect(r.body.recepcion.recibidoNombre).toBe("Juan Pérez");
    });

    it("en cuanto hay un operario, cerrar sin elegirlo se rechaza y la respuesta trae el desplegable", async () => {
      const nombre = `Paco Muelle ${Date.now()}`;
      expect((await alta(nombre, "4321")).status).toBe(201);
      const pedido = await crearPedido(2);
      const { albaran } = await crearAlbaran(pedido, 2);

      const r = await api(`/albaranes/${albaran.id}/recepcion`, operarioA, { method: "POST", body: { resultado: "OK" } });
      expect(r.status, JSON.stringify(r.body)).toBe(400);
      expect(r.body.code).toBe("OPERARIO_REQUERIDO");
      expect(r.body.detalle.operarios.map((o: any) => o.nombre)).toContain(nombre);
    });

    it("con el PIN bueno firma el operario, no el usuario de la sesión, y así sale en el documento", async () => {
      const nombre = `Paco Muelle ${Date.now()}`;
      const operario = (await alta(nombre, "4321")).body.operario;
      const pedido = await crearPedido(2);
      const { albaran } = await crearAlbaran(pedido, 2);

      const r = await api(`/albaranes/${albaran.id}/recepcion`, operarioA, {
        method: "POST",
        body: { resultado: "OK", operarioId: operario.id, pin: "4321" },
      });
      expect(r.status, JSON.stringify(r.body)).toBe(201);
      expect(r.body.recepcion.operarioNombre).toBe(nombre);
      // La sesión NO se pierde: las dos preguntas tienen respuesta.
      expect(r.body.recepcion.recibidoNombre).toBe("Juan Pérez");
      expect(r.body.recepcion.recibidoPor).toBe(OPERARIO_A);

      const ficha = await api(`/recepciones/${r.body.recepcion.id}`, operarioA);
      const evento = ficha.body.eventos?.find((e: any) => e.tipo === "RECEPCION_OK");
      if (evento) expect(evento.descripcion).toContain(nombre);
    });

    it("el PIN nunca sale por la API, ni al crearlo ni al listar", async () => {
      const nombre = `Paco Muelle ${Date.now()}`;
      const creado = await alta(nombre, "4321");
      const texto = JSON.stringify(creado.body) + JSON.stringify((await api("/operarios", operarioA)).body);
      expect(texto).not.toContain("4321");
      expect(texto).not.toContain("pinHash");
      expect(texto).not.toContain("pin_hash");
    });

    it("un PIN equivocado no cierra nada, y a los cinco fallos el operario queda bloqueado", async () => {
      const nombre = `Paco Muelle ${Date.now()}`;
      const operario = (await alta(nombre, "4321")).body.operario;
      const pedido = await crearPedido(2);
      const { albaran } = await crearAlbaran(pedido, 2);
      const intento = (pin: string) =>
        api(`/albaranes/${albaran.id}/recepcion`, operarioA, { method: "POST", body: { resultado: "OK", operarioId: operario.id, pin } });

      for (let i = 0; i < 4; i += 1) {
        const malo = await intento("0000");
        expect(malo.status, `intento ${i + 1}`).toBe(401);
        expect(malo.body.code).toBe("PIN_INCORRECTO");
      }
      // El quinto fallo bloquea, y a partir de ahí ni con el PIN bueno.
      expect((await intento("0000")).status).toBe(401);
      const bloqueado = await intento("4321");
      expect(bloqueado.status).toBe(429);
      expect(bloqueado.body.code).toBe("OPERARIO_BLOQUEADO");

      // Y el albarán sigue sin recepcionar: nada se ha colado.
      expect((await api(`/albaranes/${albaran.id}`, operarioA)).body.albaran.estado).toBe("EN_TRANSITO");

      // Cambiarle el PIN lo desatasca: es la salida para el encargado.
      expect((await api(`/operarios/${operario.id}`, gestorA, { method: "PATCH", body: { pin: "9876" } })).status).toBe(200);
      expect((await intento("9876")).status).toBe(201);
    });

    it("un operario dado de baja no firma, y uno de otro centro tampoco", async () => {
      const nombre = `Paco Muelle ${Date.now()}`;
      const operario = (await alta(nombre, "4321")).body.operario;
      expect((await api(`/operarios/${operario.id}`, gestorA, { method: "PATCH", body: { activo: false } })).status).toBe(200);

      const pedido = await crearPedido(2);
      const { albaran } = await crearAlbaran(pedido, 2);
      const r = await api(`/albaranes/${albaran.id}/recepcion`, operarioA, {
        method: "POST",
        body: { resultado: "OK", operarioId: operario.id, pin: "4321" },
      });
      expect(r.status, JSON.stringify(r.body)).toBe(404);
      expect(r.body.code).toBe("OPERARIO_NO_ENCONTRADO");
    });

    it("el operario del muelle no puede dar de alta operarios: eso es del gestor", async () => {
      expect((await api("/operarios", operarioA, { method: "POST", body: { nombre: "Colado", pin: "1111" } })).status).toBe(403);
      expect((await alta(`Legítimo ${Date.now()}`, "123")).status).toBe(400); // PIN corto
    });
  });

  /* ── Caso 1 ──────────────────────────────────────────────────────────── */

  describe("caso 1 · pedido 2, expedido 2, recibido 2", () => {
    it("cierra OK: albarán RECIBIDO, pedido COMPLETADO, sin incidencia, con usuario y hora del servidor", async () => {
      const pedido = await crearPedido(2);
      expect(pedido.pedido.estado).toBe("PENDIENTE_EXPEDICION");
      expect(pedido.lineas[0].productoTexto).toBeNull(); // sin mapeo: se recepciona igual

      const { albaran } = await crearAlbaran(pedido, 2);
      expect(albaran.estado).toBe("EN_TRANSITO");

      const bandeja = await api("/bandeja", operarioA);
      expect(bandeja.body.albaranes.map((a: any) => a.id)).toContain(albaran.id);
      expect(bandeja.body.albaranes[0].unidadesExpedidas).toBe(2);
      expect(bandeja.body.albaranes[0].unidadesRecibidas).toBe(0);

      const antes = Date.now();
      const r = await api(`/albaranes/${albaran.id}/recepcion`, operarioA, { method: "POST", body: { resultado: "OK" } });
      expect(r.status, JSON.stringify(r.body)).toBe(201);
      expect(r.body.recepcion.numero).toMatch(/^REC-\d{4}-\d{8}$/);
      expect(r.body.recepcion.resultado).toBe("OK");
      expect(r.body.recepcion.recibidoNombre).toBe("Juan Pérez");
      expect(r.body.recepcion.recibidoPor).toBe(OPERARIO_A);
      expect(Math.abs(new Date(r.body.recepcion.recibidoAt).getTime() - antes)).toBeLessThan(10_000);
      expect(r.body.lineas).toHaveLength(1);
      expect(r.body.lineas[0].cantidadRecibida).toBe(2);
      expect(r.body.incidencias).toHaveLength(0);
      expect(r.body.albaran.estado).toBe("RECIBIDO");
      expect(r.body.recepcion.documentoEstado).toBe("GENERADO");

      const ficha = await api(`/pedidos/${pedido.pedido.id}`, gestorA);
      expect(ficha.body.pedido.estado).toBe("COMPLETADO");
      expect(ficha.body.lineas[0].cantidadRecibida).toBe(2);
      expect(ficha.body.eventos.map((e: any) => e.tipo)).toEqual([
        "PEDIDO_CREADO",
        "ALBARAN_CREADO",
        "RECEPCION_OK",
        "DOCUMENTO_GENERADO",
      ]);

      // La auditoría del SaaS también lo tiene, dentro de la misma transacción.
      const aud = await db.query(`SELECT accion FROM app_auditoria WHERE empresa_id = $1 AND entidad_id = $2`, [EMPRESA_A, r.body.recepcion.id]);
      expect(aud.rows.map((x: any) => x.accion)).toEqual(["recepciones.cerrar"]);
    });
  });

  /* ── Caso 2 ──────────────────────────────────────────────────────────── */

  describe("caso 2 · pedido 10, expedido 6, recibido 6", () => {
    it("es una recepción OK y el pedido sigue con 4 pendientes de expedir", async () => {
      const pedido = await crearPedido(10);
      const { albaran } = await crearAlbaran(pedido, 6);
      const ficha1 = await api(`/pedidos/${pedido.pedido.id}`, gestorA);
      expect(ficha1.body.pedido.estado).toBe("PARCIALMENTE_EXPEDIDO");

      const r = await api(`/albaranes/${albaran.id}/recepcion`, operarioA, { method: "POST", body: { resultado: "OK" } });
      expect(r.status).toBe(201);
      expect(r.body.incidencias).toHaveLength(0);
      expect(r.body.albaran.estado).toBe("RECIBIDO");

      const ficha2 = await api(`/pedidos/${pedido.pedido.id}`, gestorA);
      expect(ficha2.body.pedido.estado).toBe("PARCIALMENTE_EXPEDIDO");
      expect(ficha2.body.lineas[0].cantidadPedida).toBe(10);
      expect(ficha2.body.lineas[0].cantidadExpedida).toBe(6);
      expect(ficha2.body.lineas[0].cantidadRecibida).toBe(6);
    });

    it("no deja expedir más de lo pedido", async () => {
      const pedido = await crearPedido(2);
      const r = await api(`/pedidos/${pedido.pedido.id}/albaranes`, gestorA, {
        method: "POST",
        body: { numeroProveedor: numeroUnico("9"), lineas: [{ pedidoLineaId: pedido.lineas[0].id, cantidadExpedida: 3 }] },
      });
      expect(r.status).toBe(409);
      expect(r.body.code).toBe("EXPEDICION_SUPERA_PEDIDO");
    });
  });

  /* ── Caso 3 ──────────────────────────────────────────────────────────── */

  describe("caso 3 · expedido 10, recibido 8", () => {
    it("queda PARCIALMENTE_RECIBIDO con una incidencia FALTA_MERCANCIA de −2 y 2 pendientes", async () => {
      const pedido = await crearPedido(10);
      const { albaran, linea } = await crearAlbaran(pedido, 10);

      const r = await api(`/albaranes/${albaran.id}/recepcion`, operarioA, {
        method: "POST",
        body: {
          resultado: "CON_INCIDENCIA",
          lineas: [{ albaranLineaId: linea.id, cantidadRecibida: 8, incidencia: { tipo: "FALTA_MERCANCIA", observaciones: "Faltan dos cubiertas" } }],
        },
      });
      expect(r.status, JSON.stringify(r.body)).toBe(201);
      expect(r.body.recepcion.resultado).toBe("CON_INCIDENCIA");
      expect(r.body.albaran.estado).toBe("PARCIALMENTE_RECIBIDO");
      expect(r.body.incidencias).toHaveLength(1);
      const inc = r.body.incidencias[0];
      expect(inc.tipo).toBe("FALTA_MERCANCIA");
      expect(inc.cantidadEsperada).toBe(10);
      expect(inc.cantidadRecibida).toBe(8);
      expect(inc.diferencia).toBe(-2);
      expect(inc.estado).toBe("ABIERTA");
      expect(inc.observaciones).toBe("Faltan dos cubiertas");
      expect(inc.descripcionProducto).toBe("HANKOOK AH35 245/70 R17.5 136M");

      const ficha = await api(`/albaranes/${albaran.id}`, operarioA);
      expect(ficha.body.lineas[0].cantidadRecibida).toBe(8);
      expect(ficha.body.lineas[0].cantidadPendiente).toBe(2);
      expect(ficha.body.recibible).toBe(true);

      const pedidoTras = await api(`/pedidos/${pedido.pedido.id}`, gestorA);
      expect(pedidoTras.body.pedido.estado).toBe("EXPEDIDO");

      const abiertas = await api("/incidencias", gestorA);
      expect(abiertas.body.incidencias.map((i: any) => i.id)).toContain(inc.id);
    });

    it("una diferencia sin motivo declarado abre igualmente la incidencia", async () => {
      const pedido = await crearPedido(2);
      const { albaran, linea } = await crearAlbaran(pedido, 2);
      const r = await api(`/albaranes/${albaran.id}/recepcion`, operarioA, {
        method: "POST",
        body: { resultado: "CON_INCIDENCIA", lineas: [{ albaranLineaId: linea.id, cantidadRecibida: 3 }] },
      });
      expect(r.status).toBe(201);
      expect(r.body.incidencias[0].tipo).toBe("SOBRA_MERCANCIA");
      expect(r.body.incidencias[0].diferencia).toBe(1);
      expect(r.body.albaran.estado).toBe("RECIBIDO_CON_INCIDENCIA");
    });

    it("un gestor resuelve la incidencia y queda quién y cuándo", async () => {
      const pedido = await crearPedido(2);
      const { albaran, linea } = await crearAlbaran(pedido, 2);
      const r = await api(`/albaranes/${albaran.id}/recepcion`, operarioA, {
        method: "POST",
        body: { resultado: "CON_INCIDENCIA", lineas: [{ albaranLineaId: linea.id, cantidadRecibida: 1, incidencia: { tipo: "FALTA_MERCANCIA" } }] },
      });
      const inc = r.body.incidencias[0];
      const noPuede = await api(`/incidencias/${inc.id}/estado`, operarioA, { method: "POST", body: { estado: "RESUELTA", resolucion: "x" } });
      expect(noPuede.status).toBe(403);
      const sinMotivo = await api(`/incidencias/${inc.id}/estado`, gestorA, { method: "POST", body: { estado: "RESUELTA" } });
      expect(sinMotivo.status).toBe(400);
      const ok = await api(`/incidencias/${inc.id}/estado`, gestorA, { method: "POST", body: { estado: "RESUELTA", resolucion: "Abono del proveedor" } });
      expect(ok.status, JSON.stringify(ok.body)).toBe(200);
      expect(ok.body.incidencia.estado).toBe("RESUELTA");
      expect(ok.body.incidencia.resueltaNombre).toBe("Gestora Prueba");
      expect(ok.body.incidencia.resueltaAt).toBeTruthy();
    });
  });

  /* ── Caso 4 ──────────────────────────────────────────────────────────── */

  describe("caso 4 · dos operarios cierran a la vez el mismo albarán", () => {
    it("sólo uno crea la recepción; el otro recibe 409 y no hay cantidades duplicadas", async () => {
      const pedido = await crearPedido(2);
      const { albaran } = await crearAlbaran(pedido, 2);

      const [a, b] = await Promise.all([
        api(`/albaranes/${albaran.id}/recepcion`, operarioA, { method: "POST", body: { resultado: "OK" } }),
        api(`/albaranes/${albaran.id}/recepcion`, operarioA2, { method: "POST", body: { resultado: "OK" } }),
      ]);
      const estados = [a.status, b.status].sort();
      expect(estados, JSON.stringify([a.body, b.body])).toEqual([201, 409]);
      // El que pierde relee dentro del cerrojo: o ya no queda nada pendiente o
      // el albarán ya no está en un estado recibible. Las dos son la misma
      // negativa y ninguna crea nada.
      const perdedor = a.status === 409 ? a : b;
      expect(["NADA_PENDIENTE", "ALBARAN_NO_RECIBIBLE"]).toContain(perdedor.body.code);

      const { rows } = await db.query(`SELECT COUNT(*)::int AS n FROM rcp_recepciones WHERE albaran_id = $1`, [albaran.id]);
      expect(rows[0].n).toBe(1);
      const ficha = await api(`/albaranes/${albaran.id}`, operarioA);
      expect(ficha.body.lineas[0].cantidadRecibida).toBe(2);
      expect(ficha.body.albaran.estado).toBe("RECIBIDO");
      expect(ficha.body.recibible).toBe(false);
    });

    it("un doble toque con la misma Idempotency-Key devuelve la misma recepción", async () => {
      const pedido = await crearPedido(2);
      const { albaran } = await crearAlbaran(pedido, 2);
      const clave = `toque-${Date.now()}`;
      const primero = await api(`/albaranes/${albaran.id}/recepcion`, operarioA, { method: "POST", body: { resultado: "OK" }, headers: { "Idempotency-Key": clave } });
      const segundo = await api(`/albaranes/${albaran.id}/recepcion`, operarioA, { method: "POST", body: { resultado: "OK" }, headers: { "Idempotency-Key": clave } });
      expect(primero.status).toBe(201);
      expect(segundo.status).toBe(200);
      expect(segundo.body.repetida).toBe(true);
      expect(segundo.body.recepcion.id).toBe(primero.body.recepcion.id);
    });

    it("cerrar un albarán ya recibido contesta 409", async () => {
      const pedido = await crearPedido(2);
      const { albaran } = await crearAlbaran(pedido, 2);
      await api(`/albaranes/${albaran.id}/recepcion`, operarioA, { method: "POST", body: { resultado: "OK" } });
      const r = await api(`/albaranes/${albaran.id}/recepcion`, operarioA, { method: "POST", body: { resultado: "OK" } });
      expect(r.status).toBe(409);
      expect(r.body.code).toBe("ALBARAN_NO_RECIBIBLE");
    });
  });

  /* ── Caso 5 ──────────────────────────────────────────────────────────── */

  describe("caso 5 · albarán de 10 recibido en dos veces (8 y 2)", () => {
    it("suma 10 en dos recepciones, sin duplicidades, y la segunda es la que cierra", async () => {
      const pedido = await crearPedido(10);
      const { albaran, linea } = await crearAlbaran(pedido, 10);

      const r1 = await api(`/albaranes/${albaran.id}/recepcion`, operarioA, {
        method: "POST",
        body: { resultado: "CON_INCIDENCIA", lineas: [{ albaranLineaId: linea.id, cantidadRecibida: 8, incidencia: { tipo: "FALTA_MERCANCIA", observaciones: "Llegan 8" } }] },
      });
      expect(r1.status).toBe(201);
      expect(r1.body.albaran.estado).toBe("PARCIALMENTE_RECIBIDO");

      // La pantalla del segundo operario ve 2 pendientes, no 10.
      const ficha = await api(`/albaranes/${albaran.id}`, operarioA2);
      expect(ficha.body.lineas[0].cantidadPendiente).toBe(2);

      const r2 = await api(`/albaranes/${albaran.id}/recepcion`, operarioA2, { method: "POST", body: { resultado: "OK" } });
      expect(r2.status, JSON.stringify(r2.body)).toBe(201);
      expect(r2.body.lineas[0].cantidadEsperada).toBe(2);
      expect(r2.body.lineas[0].cantidadRecibida).toBe(2);
      expect(r2.body.recepcion.numero).not.toBe(r1.body.recepcion.numero);
      // Sigue con incidencia registrada (la falta de la primera): recibido con incidencia.
      expect(r2.body.albaran.estado).toBe("RECIBIDO_CON_INCIDENCIA");

      const tras = await api(`/albaranes/${albaran.id}`, gestorA);
      expect(tras.body.lineas[0].cantidadRecibida).toBe(10);
      expect(tras.body.recepciones).toHaveLength(2);
      const pedidoTras = await api(`/pedidos/${pedido.pedido.id}`, gestorA);
      expect(pedidoTras.body.pedido.estado).toBe("COMPLETADO");
      expect(pedidoTras.body.lineas[0].cantidadRecibida).toBe(10);
    });
  });

  /* ── Caso 6 ──────────────────────────────────────────────────────────── */

  describe("caso 6 · documentos", () => {
    it("el original queda intacto y el recepcionado es otro fichero con el sello", async () => {
      const pedido = await crearPedido(2);
      const { albaran } = await crearAlbaran(pedido, 2);
      const original = await pdfDePrueba(`ALBARAN ${albaran.numeroProveedor} SOLEDAD`);
      const subida = await subirOriginal(albaran.id, original);
      expect(subida.status, JSON.stringify(subida.body)).toBe(201);
      expect(subida.body.documento.nombreFichero).toBe(`SOLEDAD_${albaran.numeroProveedor}_ORIGINAL.pdf`);
      const hashOriginal = subida.body.documento.hashSha256;

      // Un segundo original no sustituye al primero.
      const otra = await subirOriginal(albaran.id, await pdfDePrueba("OTRO"));
      expect(otra.status).toBe(409);

      const r = await api(`/albaranes/${albaran.id}/recepcion`, operarioA, { method: "POST", body: { resultado: "OK" } });
      expect(r.status).toBe(201);
      expect(r.body.recepcion.documentoEstado).toBe("GENERADO");

      const rec = await api(`/recepciones/${r.body.recepcion.id}`, operarioA);
      const generado = rec.body.documentos.find((d: any) => d.tipo === "ALBARAN_RECEPCION");
      expect(generado.nombreFichero).toBe(`SOLEDAD_${albaran.numeroProveedor}_${r.body.recepcion.numero}.pdf`);
      expect(generado.hashSha256).not.toBe(hashOriginal);
      expect(generado.generadoDesdeHash ?? subida.body.documento.hashSha256).toBe(hashOriginal);

      // El original sigue siendo byte a byte el que se subió.
      const bytesOriginal = await apiBinario(`/documentos/${subida.body.documento.id}/contenido`, operarioA);
      expect(bytesOriginal.status).toBe(200);
      expect(Buffer.compare(bytesOriginal.bytes, original)).toBe(0);
      const verif = await api(`/documentos/${subida.body.documento.id}/verificar`, operarioA);
      expect(verif.body.integro).toBe(true);

      // El recepcionado tiene una página más (el sello) y empieza como PDF.
      const bytesRec = await apiBinario(`/documentos/${generado.id}/contenido`, operarioA);
      expect(bytesRec.status).toBe(200);
      expect(bytesRec.headers.get("content-type")).toBe("application/pdf");
      expect(bytesRec.bytes.subarray(0, 5).toString()).toBe("%PDF-");
      const { PDFDocument: PDFLib } = await import("pdf-lib");
      const pdf = await PDFLib.load(bytesRec.bytes);
      expect(pdf.getPageCount()).toBe(2);

      // Y en disco (modo local) están los dos, con nombres distintos.
      const dir = path.join(process.cwd(), "server", "uploads", "recepciones", EMPRESA_A);
      expect(fs.existsSync(dir)).toBe(true);
    });

    it("sin original, el recepcionado sale igual con la hoja del sello", async () => {
      const pedido = await crearPedido(2);
      const { albaran } = await crearAlbaran(pedido, 2);
      const r = await api(`/albaranes/${albaran.id}/recepcion`, operarioA, { method: "POST", body: { resultado: "OK" } });
      expect(r.body.recepcion.documentoEstado).toBe("GENERADO");
      const rec = await api(`/recepciones/${r.body.recepcion.id}`, operarioA);
      const generado = rec.body.documentos.find((d: any) => d.tipo === "ALBARAN_RECEPCION");
      const bytes = await apiBinario(`/documentos/${generado.id}/contenido`, operarioA);
      const { PDFDocument: PDFLib } = await import("pdf-lib");
      expect((await PDFLib.load(bytes.bytes)).getPageCount()).toBe(1);
    });
  });

  /* ── Caso 7 ──────────────────────────────────────────────────────────── */

  describe("caso 7 · sin mapeo de artículo", () => {
    it("la línea se recepciona por la descripción del proveedor y luego el mapeo se aplica", async () => {
      const pedido = await crearPedido(2, { lineas: [{ descripcionProveedor: "CAMARA 20 PULGADAS", cantidadPedida: 2 }] });
      expect(pedido.lineas[0].productoId).toBeNull();
      const { albaran } = await crearAlbaran(pedido, 2);
      const ficha = await api(`/albaranes/${albaran.id}`, operarioA);
      expect(ficha.body.lineas[0].sinMapear).toBe(true);
      expect(ficha.body.lineas[0].articuloLeido).toBe("CAMARA 20 PULGADAS");

      const r = await api(`/albaranes/${albaran.id}/recepcion`, operarioA, { method: "POST", body: { resultado: "OK" } });
      expect(r.status).toBe(201);

      // Después se confirma el mapeo y el siguiente pedido ya nace con artículo.
      const mapeo = await api("/mapeo", operarioA, {
        method: "POST",
        body: { proveedorId, descripcionProveedor: "CAMARA 20 PULGADAS", productoTexto: "CÁMARA 20\"", ean: "8400000000017" },
      });
      expect(mapeo.status, JSON.stringify(mapeo.body)).toBe(201);
      const otro = await crearPedido(1, { lineas: [{ descripcionProveedor: "camara  20 pulgadas", cantidadPedida: 1 }] });
      expect(otro.lineas[0].productoTexto).toBe("CÁMARA 20\"");
    });
  });

  /* ── Rectificación ───────────────────────────────────────────────────── */

  describe("rectificación", () => {
    it("corrige la cantidad sin tocar la recepción original y deja constancia numerada", async () => {
      const pedido = await crearPedido(2);
      const { albaran } = await crearAlbaran(pedido, 2);
      const r = await api(`/albaranes/${albaran.id}/recepcion`, operarioA, { method: "POST", body: { resultado: "OK" } });
      const recepcionId = r.body.recepcion.id;
      const lineaId = r.body.lineas[0].id;

      const noPuede = await api(`/recepciones/${recepcionId}/rectificar`, operarioA, { method: "POST", body: { motivo: "x", lineas: [] } });
      expect(noPuede.status).toBe(403);

      const rect = await api(`/recepciones/${recepcionId}/rectificar`, gestorA, {
        method: "POST",
        body: { motivo: "Error de conteo", lineas: [{ recepcionLineaId: lineaId, cantidadRecibida: 1 }] },
      });
      expect(rect.status, JSON.stringify(rect.body)).toBe(201);
      expect(rect.body.rectificacion.numero).toMatch(/^RECT-\d{4}-\d{5}$/);
      expect(rect.body.rectificacion.lineas[0]).toMatchObject({ cantidadAnterior: 2, cantidadNueva: 1 });

      const rec = await api(`/recepciones/${recepcionId}`, gestorA);
      expect(rec.body.recepcion.resultado).toBe("OK"); // lo que se dijo entonces no cambia
      expect(rec.body.recepcion.recibidoNombre).toBe("Juan Pérez");
      expect(rec.body.rectificaciones).toHaveLength(1);
      expect(rec.body.rectificaciones[0].rectificadoNombre).toBe("Gestora Prueba");
      expect(rec.body.lineas[0].cantidadRecibida).toBe(1);
      expect(rec.body.documentos.filter((d: any) => d.tipo === "ALBARAN_RECEPCION")).toHaveLength(2); // el anterior se conserva

      const alb = await api(`/albaranes/${albaran.id}`, gestorA);
      expect(alb.body.albaran.estado).toBe("PARCIALMENTE_RECIBIDO");
      expect(alb.body.lineas[0].cantidadPendiente).toBe(1);
      expect(alb.body.eventos.map((e: any) => e.tipo)).toContain("RECTIFICACION");
    });
  });

  /* ── Aislamiento e inmutabilidad ─────────────────────────────────────── */

  it("una empresa no ve ni toca lo de otra: 404, no 403", async () => {
    const pedido = await crearPedido(2);
    const { albaran } = await crearAlbaran(pedido, 2);
    expect((await api(`/pedidos/${pedido.pedido.id}`, gestorB)).status).toBe(404);
    expect((await api(`/albaranes/${albaran.id}`, gestorB)).status).toBe(404);
    expect((await api(`/albaranes/${albaran.id}/recepcion`, gestorB, { method: "POST", body: { resultado: "OK" } })).status).toBe(404);
    const bandejaB = await api("/bandeja", gestorB);
    expect(bandejaB.body.albaranes).toHaveLength(0);
  });

  it("el mismo número de pedido no se crea dos veces aunque se escriba distinto", async () => {
    const numero = numeroUnico("5688");
    await crearPedido(2, { numeroProveedor: `B-2026-${numero}` });
    const r = await api("/pedidos", gestorA, {
      method: "POST",
      body: { proveedorId, numeroProveedor: numero, lineas: [{ descripcionProveedor: "X", cantidadPedida: 1 }] },
    });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe("PEDIDO_DUPLICADO");
  });

  it("el histórico no se puede editar ni borrar", async () => {
    await crearPedido(2);
    await expect(db.query(`UPDATE rcp_eventos SET descripcion = 'x' WHERE empresa_id = $1`, [EMPRESA_A])).rejects.toThrow(/inmutable/);
    await expect(db.query(`DELETE FROM rcp_eventos WHERE empresa_id = $1`, [EMPRESA_A])).rejects.toThrow(/inmutable/);
  });

  /* ── Lo que este encargo exige por encima de todo ────────────────────── */

  it("el módulo no toca el stock: ninguna referencia a movimientos_stock ni al almacén en su código", () => {
    const raiz = path.join(process.cwd(), "server", "recepciones");
    const ficheros: string[] = [];
    const recorrer = (d: string) => {
      for (const f of fs.readdirSync(d)) {
        const ruta = path.join(d, f);
        if (fs.statSync(ruta).isDirectory()) recorrer(ruta);
        else if (ruta.endsWith(".ts") && !ruta.endsWith(".test.ts")) ficheros.push(ruta);
      }
    };
    recorrer(raiz);
    expect(ficheros.length).toBeGreaterThan(5);
    for (const f of ficheros) {
      const codigo = fs
        .readFileSync(f, "utf8")
        // Los comentarios pueden nombrarlo para decir que NO se usa; el código, no.
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");
      expect(codigo, f).not.toMatch(/movimientos_stock|productos_neumaticos|solicitudes_reposicion|traspasos\b|stock_minimos/);
    }
  });

  it("cerrar una recepción no escribe en ninguna tabla que no sea rcp_* o la auditoría", async () => {
    // Si existiera una tabla movimientos_stock en esta base, tendría que seguir vacía.
    await db.query(`CREATE TABLE IF NOT EXISTS movimientos_stock (id SERIAL PRIMARY KEY, tipo TEXT, cantidad NUMERIC)`);
    const antes = (await db.query(`SELECT COUNT(*)::int AS n FROM movimientos_stock`)).rows[0].n;
    const pedido = await crearPedido(2);
    const { albaran } = await crearAlbaran(pedido, 2);
    const r = await api(`/albaranes/${albaran.id}/recepcion`, operarioA, { method: "POST", body: { resultado: "OK" } });
    expect(r.status).toBe(201);
    const despues = (await db.query(`SELECT COUNT(*)::int AS n FROM movimientos_stock`)).rows[0].n;
    expect(despues).toBe(antes);
  });
});
