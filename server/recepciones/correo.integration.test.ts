/**
 * Los correos de Soledad de punta a punta: `.eml` importado por la API y buzón
 * IMAP falso, contra PostgreSQL de verdad.
 *
 * Lo falso es SÓLO el transporte: los mensajes MIME se componen con nodemailer
 * y mailparser los parsea como parsearía uno real. A partir de ahí todo es el
 * camino de producción: parser, ingesta, `service.crearPedido` /
 * `crearAlbaran`, el PDF original, los eventos.
 *
 * Lo que se fija:
 *   · el correo de pedido crea el pedido con sus líneas (origen CORREO);
 *   · el correo de albarán localiza el pedido, asocia el albarán EN_TRANSITO,
 *     guarda el PDF adjunto como ORIGINAL y deja lo pendiente de expedir a 0;
 *   · el mismo correo dos veces es DUPLICADO, sin segundo pedido ni albarán;
 *   · el albarán que llega ANTES que el pedido queda en revisión y se
 *     reprocesa solo cuando llega el pedido;
 *   · un remitente desconocido se ignora; un correo que no se entiende, también;
 *   · el buzón falso: lee sin tocar ninguna bandera (es un buzón de personas),
 *     lleva el progreso por UID, no deja avanzar la marca tras un error,
 *     rehace la marca si la carpeta se renumera, y no procesa nada mientras
 *     ningún proveedor tenga remitentes;
 *   · el enlace al PDF se descarga de un servidor HTTP local y queda como
 *     ORIGINAL; si el enlace no devuelve un PDF, el albarán se crea igual y el
 *     motivo lo dice.
 *
 * Sólo con RUN_DB_TESTS=1 y DATABASE_URL a una base DESECHABLE.
 */

import type { AddressInfo } from "node:net";
import http, { type Server } from "node:http";
import express from "express";
import PDFDocument from "pdfkit";
import MailComposer from "nodemailer/lib/mail-composer/index.js";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ClienteBuzon, ConfigBuzon } from "./buzon.ts";

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

const EMPRESA = "00000000-0000-4000-a000-00000000cd01";
const GESTOR = "00000000-0000-4000-a000-000000000d01";
const gestor = { usuario: GESTOR, empresa: EMPRESA, nombre: "Gestora Prueba" };
const REMITENTE = "pedidos@soledad.example";
const CFG: ConfigBuzon = { host: "imap.ejemplo.invalid", port: 993, user: "recepciones@ejemplo.invalid", pass: "no", carpeta: "INBOX", minutos: 5, empresaId: EMPRESA };

let base = "";
let servidor: Server;
let db: typeof import("../db.ts").default;
let buzon: typeof import("./buzon.ts");
let proveedorId = "";
let contador = 0;
const unico = (p: string) => `${p}${Date.now() % 1_000_000}${(contador += 1)}`;

function api(ruta: string, init?: { method?: string; body?: unknown }) {
  return fetch(`${base}/api/recepciones${ruta}`, {
    method: init?.method ?? "GET",
    headers: { "x-test-user": gestor.usuario, "x-test-empresa": gestor.empresa, "x-test-nombre": gestor.nombre, "Content-Type": "application/json" },
    body: init?.body != null ? JSON.stringify(init.body) : undefined,
  }).then(async (r) => ({ status: r.status, body: (await r.json().catch(() => ({}))) as any }));
}

async function importarEml(source: Buffer) {
  const form = new FormData();
  form.append("archivo", new Blob([new Uint8Array(source)], { type: "message/rfc822" }), "correo.eml");
  const r = await fetch(`${base}/api/recepciones/correo/eml`, {
    method: "POST",
    headers: { "x-test-user": gestor.usuario, "x-test-empresa": gestor.empresa, "x-test-nombre": gestor.nombre },
    body: form,
  });
  return { status: r.status, body: (await r.json().catch(() => ({}))) as any };
}

function pdfDePrueba(texto: string): Promise<Buffer> {
  const doc = new PDFDocument({ size: "A4" });
  const trozos: Buffer[] = [];
  doc.on("data", (c: Buffer) => trozos.push(c));
  const listo = new Promise<Buffer>((resolve) => doc.on("end", () => resolve(Buffer.concat(trozos))));
  doc.fontSize(18).text(texto, 60, 60);
  doc.end();
  return listo;
}

type Mensaje = { uid: number; source: Buffer; seen: boolean; date: Date };
let siguienteUid = 1;

async function mensaje(sobre: { de?: string; asunto: string; texto: string; fecha?: Date; pdf?: Buffer; messageId?: string }): Promise<Mensaje> {
  const uid = siguienteUid++;
  const fecha = sobre.fecha ?? new Date();
  const composer = new MailComposer({
    from: sobre.de ?? REMITENTE,
    to: CFG.user,
    subject: sobre.asunto,
    text: sobre.texto,
    date: fecha,
    messageId: sobre.messageId ?? `<rcp-${uid}-${Date.now()}@ejemplo.invalid>`,
    attachments: sobre.pdf ? [{ filename: "albaran.pdf", content: sobre.pdf, contentType: "application/pdf" }] : [],
  });
  return { uid, source: await composer.compile().build(), seen: false, date: fecha };
}

function buzonFalso(
  mensajes: Mensaje[],
  opciones: { falloAlAbrir?: string; falloAlLeer?: number; uidValidity?: number } = {}
): ClienteBuzon & { mensajes: Mensaje[]; flagsAplicadas: string[]; busquedas: Record<string, unknown>[]; messageFlagsAdd(r: { uid: string }, f: string[]): Promise<void> } {
  return {
    mensajes,
    // Espías: el módulo NO debe escribir en el buzón de nadie.
    flagsAplicadas: [],
    busquedas: [],
    mailbox: { uidValidity: opciones.uidValidity ?? 1 },
    async connect() {
      if (opciones.falloAlAbrir) throw new Error(opciones.falloAlAbrir);
    },
    async getMailboxLock() {
      return { release() {} };
    },
    async search(q) {
      this.busquedas.push({ ...q });
      const diaDesde = q.since ? new Date(new Date(q.since).toDateString()) : null;
      // `N:*` como en IMAP: el rango, y además el último mensaje de la carpeta.
      let porUid: (m: Mensaje) => boolean = () => true;
      if (q.uid) {
        const desde = Number(String(q.uid).split(":")[0]);
        const ultimo = Math.max(0, ...mensajes.map((m) => m.uid));
        porUid = (m) => m.uid >= desde || m.uid === ultimo;
      }
      return mensajes
        .filter((m) => (q.seen === undefined || m.seen === q.seen) && (!diaDesde || m.date >= diaDesde) && porUid(m))
        .map((m) => m.uid);
    },
    async fetchOne(uid) {
      if (opciones.falloAlLeer !== undefined && String(opciones.falloAlLeer) === uid) throw new Error("se cayó la conexión");
      const m = mensajes.find((x) => String(x.uid) === uid);
      return m ? { source: m.source } : false;
    },
    async messageFlagsAdd(rango: { uid: string }, flags: string[]) {
      this.flagsAplicadas.push(`${rango.uid}:${flags.join(",")}`);
      const m = mensajes.find((x) => String(x.uid) === rango.uid);
      if (m && flags.includes("\\Seen")) m.seen = true;
    },
    async logout() {},
  };
}

/* ── Los dos correos reales ──────────────────────────────────────────────── */

const correoPedido = (numero: string, cantidad = 2) => `Pedido:
${numero}

Fecha:
15/09/2026

Cliente:
COMERCIAL SEA, S.A.

Usuario que realiza el pedido:
comercialseatarragona

Destino:
COMERCIAL SEA, S.A.
PIRIU CLAR C/COURE 27
43006 TARRAGONA

Contenido:

Cantidad:
${cantidad}

Producto:
245/70X17.5 HANKOOK AH35 136M

Precio unitario:
248,45 €

Centro logístico:
227 - ALMACEN MANRESA (CATALUÑA)

Transportista:
TRANSAHER
`;

const correoAlbaran = (pedido: string, albaran: string, enlace?: string) => `Estimado cliente,

Le informamos de que su pedido ha sido expedido.

Pedido: ${pedido}
Albarán: ${albaran}
Transportista: TRANSAHER
${enlace ? `\nPuede descargar el albarán en:\n${enlace}\n` : ""}
Un saludo.
`;

const asuntoPedido = (numero: string) => `Aviso de nuevo Pedido número ${numero}`;
const asuntoAlbaran = (albaran: string) => `Emisión de Albarán ${albaran}`;

/* Un servidor HTTP local que hace de portal del proveedor. */
let portal: http.Server;
let portalBase = "";
let pdfDelPortal: Buffer;

afterAll(async () => {
  if (!RUN) return;
  await new Promise<void>((r) => servidor?.close(() => r()));
  await new Promise<void>((r) => portal?.close(() => r()));
  await db?.end().catch(() => {});
});

describe.skipIf(!RUN)("Recepciones · correos de Soledad contra PostgreSQL", () => {
  beforeAll(async () => {
    db = (await import("../db.ts")).default;
    buzon = await import("./buzon.ts");
    await db.query(`
      CREATE TABLE IF NOT EXISTS app_usuario_modulos (
        user_id UUID NOT NULL, modulo TEXT NOT NULL, rol TEXT NOT NULL, pantallas TEXT[],
        empresa_id UUID, centro_id UUID, UNIQUE (user_id, modulo)
      )`);
    await db.query(`INSERT INTO app_usuario_modulos (user_id, modulo, rol) VALUES ($1,'recepciones','gestor') ON CONFLICT (user_id, modulo) DO UPDATE SET rol = 'gestor'`, [GESTOR]);

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

    pdfDelPortal = await pdfDePrueba("ALBARAN DEL PORTAL");
    portal = http.createServer((req, res) => {
      if (req.url?.endsWith(".pdf")) {
        res.writeHead(200, { "Content-Type": "application/pdf" });
        res.end(pdfDelPortal);
      } else {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end("<html><body>Inicie sesión</body></html>");
      }
    });
    await new Promise<void>((listo) => {
      portal.listen(0, "127.0.0.1", () => {
        portalBase = `http://127.0.0.1:${(portal.address() as AddressInfo).port}`;
        listo();
      });
    });
  }, 60_000);

  beforeEach(async () => {
    const e = [EMPRESA];
    await db.query(`ALTER TABLE rcp_eventos DISABLE TRIGGER rcp_eventos_inmutable_trg`);
    await db.query(`DELETE FROM rcp_eventos WHERE empresa_id = ANY($1)`, [e]);
    await db.query(`ALTER TABLE rcp_eventos ENABLE TRIGGER rcp_eventos_inmutable_trg`);
    for (const t of ["rcp_correos", "rcp_buzon_pasadas", "rcp_config", "rcp_incidencias", "rcp_documentos", "rcp_recepcion_lineas", "rcp_recepciones", "rcp_albaran_lineas", "rcp_albaranes", "rcp_pedido_lineas", "rcp_pedidos", "rcp_proveedor_articulos", "rcp_proveedores", "rcp_contadores"]) {
      await db.query(`DELETE FROM ${t} WHERE empresa_id = ANY($1)`, [e]);
    }
    const r = await api("/proveedores", { method: "POST", body: { codigo: "SOLEDAD", nombre: "NEUMÁTICOS SOLEDAD", remitentesCorreo: [REMITENTE] } });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    proveedorId = r.body.proveedor.id;
  });

  it("el correo de pedido crea el pedido con sus líneas, y el de albarán lo asocia EN_TRANSITO con su PDF", async () => {
    const numero = unico("5688");
    const m1 = await mensaje({ asunto: asuntoPedido(`B-2026-${numero}`), texto: correoPedido(`B-2026-${numero}`) });
    const r1 = await importarEml(m1.source);
    expect(r1.status, JSON.stringify(r1.body)).toBe(200);
    expect(r1.body.resultado).toBe("procesado");
    expect(r1.body.tipo).toBe("PEDIDO");
    expect(r1.body.pedidoNumero).toBe(`B-2026-${numero}`);

    const pedidos = await api(`/pedidos?q=${numero}`);
    expect(pedidos.body.pedidos).toHaveLength(1);
    const pedidoId = pedidos.body.pedidos[0].id;
    const ficha = await api(`/pedidos/${pedidoId}`);
    expect(ficha.body.pedido.origen).toBe("CORREO");
    expect(ficha.body.pedido.centroNombre).toBe("TARRAGONA");
    expect(ficha.body.pedido.destinoTexto).toContain("PIRIU CLAR");
    expect(ficha.body.pedido.transportista).toBe("TRANSAHER");
    expect(ficha.body.pedido.almacenOrigen).toBe("227 - ALMACEN MANRESA (CATALUÑA)");
    expect(ficha.body.pedido.usuarioPedido).toBe("comercialseatarragona");
    expect(ficha.body.pedido.estado).toBe("PENDIENTE_EXPEDICION");
    expect(ficha.body.lineas).toHaveLength(1);
    expect(ficha.body.lineas[0]).toMatchObject({ descripcionProveedor: "245/70X17.5 HANKOOK AH35 136M", cantidadPedida: 2, precioUnitarioCentimos: 24845 });
    expect(ficha.body.pedido.creadoNombre).toBe("Correo del proveedor");

    // El albarán, con el PDF adjunto y el número de pedido sin prefijo.
    const albaranN = unico("2028");
    const pdf = await pdfDePrueba(`ALBARAN ${albaranN}`);
    const m2 = await mensaje({ asunto: asuntoAlbaran(albaranN), texto: correoAlbaran(numero, albaranN), pdf });
    const r2 = await importarEml(m2.source);
    expect(r2.status, JSON.stringify(r2.body)).toBe(200);
    expect(r2.body.resultado).toBe("procesado");
    expect(r2.body.tipo).toBe("ALBARAN");
    expect(r2.body.albaranNumero).toBe(albaranN);

    const ficha2 = await api(`/pedidos/${pedidoId}`);
    expect(ficha2.body.pedido.estado).toBe("EXPEDIDO");
    expect(ficha2.body.albaranes).toHaveLength(1);
    const alb = ficha2.body.albaranes[0];
    expect(alb.estado).toBe("EN_TRANSITO");
    expect(alb.origen).toBe("CORREO");
    expect(alb.lineas[0].cantidadExpedida).toBe(2);
    expect(alb.documentos.some((d: any) => d.tipo === "ALBARAN_ORIGINAL" && d.origen === "CORREO")).toBe(true);
    expect(ficha2.body.lineas[0].cantidadExpedida).toBe(2);

    // Aparece en la bandeja, listo para recepcionar.
    const bandeja = await api("/bandeja");
    expect(bandeja.body.albaranes.map((a: any) => a.id)).toContain(alb.id);
    expect(ficha2.body.eventos.map((e: any) => e.tipo)).toEqual(["PEDIDO_CREADO", "ALBARAN_CREADO", "ORIGINAL_ADJUNTADO"]);
  });

  it("el mismo correo dos veces es DUPLICADO: un solo pedido, un solo albarán", async () => {
    const numero = unico("5689");
    const m1 = await mensaje({ asunto: asuntoPedido(numero), texto: correoPedido(numero) });
    expect((await importarEml(m1.source)).body.resultado).toBe("procesado");
    const otraVez = await importarEml(m1.source);
    expect(otraVez.body.resultado).toBe("duplicado");
    // Y el mismo pedido con OTRO message-id también es duplicado, enlazado al que ya existe.
    const m1b = await mensaje({ asunto: asuntoPedido(`B-2026-${numero}`), texto: correoPedido(`B-2026-${numero}`) });
    const r1b = await importarEml(m1b.source);
    expect(r1b.body.resultado).toBe("duplicado");
    expect(r1b.body.pedidoNumero).toBe(numero);

    const albaranN = unico("2029");
    const m2 = await mensaje({ asunto: asuntoAlbaran(albaranN), texto: correoAlbaran(numero, albaranN) });
    expect((await importarEml(m2.source)).body.resultado).toBe("procesado");
    expect((await importarEml(m2.source)).body.resultado).toBe("duplicado");
    const m2b = await mensaje({ asunto: asuntoAlbaran(albaranN), texto: correoAlbaran(numero, albaranN) });
    expect((await importarEml(m2b.source)).body.resultado).toBe("duplicado");

    const pedidos = await api(`/pedidos?q=${numero}`);
    expect(pedidos.body.pedidos).toHaveLength(1);
    const ficha = await api(`/pedidos/${pedidos.body.pedidos[0].id}`);
    expect(ficha.body.albaranes).toHaveLength(1);
    const correos = await api("/correo");
    expect(correos.body.correos.filter((c: any) => c.resultado === "DUPLICADO")).toHaveLength(2);
  });

  it("el albarán que llega antes que el pedido espera en revisión y se reprocesa solo cuando llega el pedido", async () => {
    const numero = unico("5690");
    const albaranN = unico("2030");
    const m2 = await mensaje({ asunto: asuntoAlbaran(albaranN), texto: correoAlbaran(numero, albaranN) });
    const r2 = await importarEml(m2.source);
    expect(r2.body.resultado).toBe("revision");
    expect(r2.body.error).toMatch(/no existe todavía/);
    const boot = await api("/bootstrap");
    expect(boot.body.contadores.correosEnRevision).toBe(1);

    const m1 = await mensaje({ asunto: asuntoPedido(numero), texto: correoPedido(numero) });
    expect((await importarEml(m1.source)).body.resultado).toBe("procesado");

    const correos = await api("/correo");
    const delAlbaran = correos.body.correos.find((c: any) => c.tipo === "ALBARAN");
    expect(delAlbaran.resultado).toBe("PROCESADO");
    expect(delAlbaran.albaranNumero).toBe(albaranN);
    const pedidos = await api(`/pedidos?q=${numero}`);
    const ficha = await api(`/pedidos/${pedidos.body.pedidos[0].id}`);
    expect(ficha.body.albaranes).toHaveLength(1);
    expect(ficha.body.albaranes[0].estado).toBe("EN_TRANSITO");
    expect((await api("/bootstrap")).body.contadores.correosEnRevision).toBe(0);
  });

  it("un remitente desconocido se ignora y un correo que no se entiende también; reprocesar no cambia nada", async () => {
    const m = await mensaje({ de: "spam@otro.example", asunto: asuntoPedido("1"), texto: correoPedido("1") });
    const r = await importarEml(m.source);
    expect(r.body.resultado).toBe("ignorado");
    expect(r.body.error).toMatch(/no es de ningún proveedor/);

    const m2 = await mensaje({ asunto: "Hola", texto: "¿Qué tal todo?" });
    expect((await importarEml(m2.source)).body.resultado).toBe("ignorado");

    const correos = await api("/correo");
    expect(correos.body.correos).toHaveLength(2);
    const re = await api(`/correo/${correos.body.correos[0].id}/reprocesar`, { method: "POST" });
    expect(re.status).toBe(200);
    expect(["IGNORADO", "DUPLICADO"]).toContain(re.body.resultado);
    expect((await api("/pedidos")).body.pedidos).toHaveLength(0);
  });

  it("un pedido sin líneas legibles queda en revisión, no se crea a medias", async () => {
    const m = await mensaje({ asunto: asuntoPedido("777"), texto: "Pedido: 777\nFecha: 15/09/2026\nTransportista: TRANSAHER" });
    const r = await importarEml(m.source);
    expect(r.body.resultado).toBe("revision");
    expect((await api("/pedidos")).body.pedidos).toHaveLength(0);
  });

  it("el enlace del correo se descarga como ORIGINAL; si no devuelve un PDF, el albarán se crea igual y lo dice", async () => {
    const numero = unico("5691");
    const m1 = await mensaje({ asunto: asuntoPedido(numero), texto: correoPedido(numero) });
    expect((await importarEml(m1.source)).body.resultado).toBe("procesado");

    const albaranN = unico("2031");
    const m2 = await mensaje({ asunto: asuntoAlbaran(albaranN), texto: correoAlbaran(numero, albaranN, `${portalBase}/albaranes/${albaranN}.pdf`) });
    const r2 = await importarEml(m2.source);
    expect(r2.body.resultado).toBe("procesado");
    expect(r2.body.error).toBeUndefined();
    const pedidos = await api(`/pedidos?q=${numero}`);
    const ficha = await api(`/pedidos/${pedidos.body.pedidos[0].id}`);
    const original = ficha.body.albaranes[0].documentos.find((d: any) => d.tipo === "ALBARAN_ORIGINAL");
    expect(original.origen).toBe("DESCARGA_PROVEEDOR");
    const { hashDeFichero } = await import("./storage.ts");
    expect(original.hashSha256).toBe(hashDeFichero(pdfDelPortal));

    // Segundo albarán del mismo pedido no cabe (ya está todo expedido)…
    const numero2 = unico("5692");
    expect((await importarEml((await mensaje({ asunto: asuntoPedido(numero2), texto: correoPedido(numero2) })).source)).body.resultado).toBe("procesado");
    const albaranN2 = unico("2032");
    const m3 = await mensaje({ asunto: asuntoAlbaran(albaranN2), texto: correoAlbaran(numero2, albaranN2, `${portalBase}/login`) });
    const r3 = await importarEml(m3.source);
    expect(r3.body.resultado).toBe("procesado");
    expect(r3.body.error).toMatch(/No se ha podido descargar/);
    const p2 = await api(`/pedidos?q=${numero2}`);
    const f2 = await api(`/pedidos/${p2.body.pedidos[0].id}`);
    const alb = f2.body.albaranes[0];
    expect(alb.documentos).toHaveLength(0);
    // …y se puede reintentar desde la ficha con otro enlace.
    const reintento = await api(`/albaranes/${alb.id}/original/descargar`, { method: "POST", body: { enlace: `${portalBase}/albaranes/x.pdf` } });
    expect(reintento.status, JSON.stringify(reintento.body)).toBe(201);
    expect(reintento.body.documento.tipo).toBe("ALBARAN_ORIGINAL");
  });

  it("el correo de albarán que detalla cantidad expedida menor deja el pedido parcialmente expedido", async () => {
    const numero = unico("5693");
    expect((await importarEml((await mensaje({ asunto: asuntoPedido(numero), texto: correoPedido(numero, 10) })).source)).body.resultado).toBe("procesado");
    const albaranN = unico("2033");
    const m = await mensaje({ asunto: asuntoAlbaran(albaranN), texto: `Pedido: ${numero}\nAlbarán: ${albaranN}\nCantidad expedida: 6\nTransportista: TRANSAHER` });
    expect((await importarEml(m.source)).body.resultado).toBe("procesado");
    const p = await api(`/pedidos?q=${numero}`);
    const f = await api(`/pedidos/${p.body.pedidos[0].id}`);
    expect(f.body.pedido.estado).toBe("PARCIALMENTE_EXPEDIDO");
    expect(f.body.albaranes[0].lineas[0].cantidadExpedida).toBe(6);
    expect(f.body.lineas[0].cantidadExpedida).toBe(6);
  });

  describe("el buzón IMAP (falso)", () => {
    it("procesa lo nuevo SIN tocar ninguna bandera del buzón y lleva el progreso por UID", async () => {
      const numero = unico("5694");
      const albaranN = unico("2034");
      const mensajes = [
        await mensaje({ asunto: asuntoPedido(numero), texto: correoPedido(numero) }),
        await mensaje({ asunto: asuntoAlbaran(albaranN), texto: correoAlbaran(numero, albaranN), pdf: await pdfDePrueba("X") }),
        await mensaje({ de: "companera@comercialsea.com", asunto: "Reunión del viernes", texto: "¿Nos vemos a las 9?" }),
        await mensaje({ asunto: asuntoPedido("viejo"), texto: correoPedido("viejo"), fecha: new Date(Date.now() - 3 * 24 * 3600 * 1000) }),
      ];
      const cliente = buzonFalso(mensajes);
      const r = (await buzon.revisarBuzon({ cliente, config: CFG, origen: "manual" })) as any;
      // El viejo queda fuera por el suelo de la activación.
      expect(r.procesados).toBe(2);
      expect(r.ignorados).toBe(1);
      expect(r.errores).toBe(0);

      // Lo que más importa en un buzón de personas: no se ha tocado nada.
      expect(cliente.flagsAplicadas).toEqual([]);
      expect(mensajes.every((m) => m.seen === false)).toBe(true);
      // Y el correo de la compañera no se guarda: ni su texto ni su asunto en rcp_correos.
      const correos = await api("/correo");
      expect(correos.body.correos.some((c: any) => c.asunto === "Reunión del viernes")).toBe(false);

      const pedidos = await api(`/pedidos?q=${numero}`);
      const ficha = await api(`/pedidos/${pedidos.body.pedidos[0].id}`);
      expect(ficha.body.albaranes[0].estado).toBe("EN_TRANSITO");

      // Segunda pasada: nada nuevo que mirar, y la búsqueda ya arranca del UID siguiente.
      const cliente2 = buzonFalso(mensajes);
      const r2 = (await buzon.revisarBuzon({ cliente: cliente2, config: CFG, origen: "manual" })) as any;
      expect(r2.correos).toBe(0);
      expect(String(cliente2.busquedas[0].uid ?? "")).toMatch(/^\d+:\*$/);

      // Un correo nuevo sí entra.
      mensajes.push(await mensaje({ asunto: asuntoPedido(unico("5695")), texto: correoPedido(unico("5695")) }));
      const r3 = (await buzon.revisarBuzon({ cliente: buzonFalso(mensajes), config: CFG })) as any;
      expect(r3.correos).toBe(1);
      expect(r3.procesados).toBe(1);
    });

    it("el correo que falla no deja avanzar la marca y se reintenta en la pasada siguiente", async () => {
      const numero = unico("5696");
      const mensajes = [
        await mensaje({ asunto: asuntoPedido(numero), texto: correoPedido(numero) }),
        await mensaje({ asunto: asuntoPedido(unico("5697")), texto: correoPedido(unico("5697")) }),
      ];
      const r = (await buzon.revisarBuzon({ cliente: buzonFalso(mensajes, { falloAlLeer: mensajes[0].uid }), config: CFG })) as any;
      expect(r.errores).toBe(1);
      expect(r.procesados).toBe(1);

      // La marca se quedó antes del que falló: la siguiente pasada trae los dos.
      const cliente2 = buzonFalso(mensajes);
      const r2 = (await buzon.revisarBuzon({ cliente: cliente2, config: CFG })) as any;
      expect(r2.correos).toBe(2);
      expect(r2.procesados).toBe(2); // el que falló, ahora sí; el otro, duplicado
      const pedidos = await api(`/pedidos?q=${numero}`);
      expect(pedidos.body.pedidos).toHaveLength(1);
    });

    it("si la carpeta se renumera (UIDVALIDITY distinto) se vuelve a mirar desde la activación, sin duplicar", async () => {
      const numero = unico("5698");
      const mensajes = [await mensaje({ asunto: asuntoPedido(numero), texto: correoPedido(numero) })];
      expect(((await buzon.revisarBuzon({ cliente: buzonFalso(mensajes, { uidValidity: 7 }), config: CFG })) as any).procesados).toBe(1);

      const cliente = buzonFalso(mensajes, { uidValidity: 99 });
      const r = (await buzon.revisarBuzon({ cliente, config: CFG })) as any;
      expect(cliente.busquedas[0].uid).toBeUndefined(); // sin rango: se mira todo lo posterior a la activación
      expect(r.correos).toBe(1);
      expect(r.procesados).toBe(1); // se relee, pero es duplicado
      const pedidos = await api(`/pedidos?q=${numero}`);
      expect(pedidos.body.pedidos).toHaveLength(1);
    });

    it("sin remitentes en ningún proveedor, el buzón no procesa nada y lo dice", async () => {
      const proveedores = await api("/proveedores");
      await api(`/proveedores/${proveedores.body.proveedores[0].id}`, { method: "PATCH", body: { remitentesCorreo: [] } });
      const mensajes = [await mensaje({ asunto: asuntoPedido(unico("5699")), texto: correoPedido(unico("5699")) })];
      const cliente = buzonFalso(mensajes);
      const r = await buzon.revisarBuzon({ cliente, config: CFG });
      expect("error" in r).toBe(true);
      expect((r as { error: string }).error).toMatch(/remitentes/i);
      expect((await api("/pedidos")).body.pedidos).toHaveLength(0);
      expect(cliente.busquedas).toEqual([]);
      const estado = await api("/correo/buzon");
      expect(estado.body.pasadas[0].error).toMatch(/remitentes/i);
    });

    it("un buzón que no abre deja una pasada con su error", async () => {
      const r = await buzon.revisarBuzon({ cliente: buzonFalso([], { falloAlAbrir: "LOGIN failed" }), config: CFG });
      expect(r).toEqual({ error: "LOGIN failed" });
      const estado = await api("/correo/buzon");
      expect(estado.body.pasadas[0].error).toBe("LOGIN failed");
    });
  });
});
