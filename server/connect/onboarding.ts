/**
 * Puesta en marcha de una central que acaba de comprar la licencia.
 *
 * El motor sabe tarificar, pero una central nueva se encuentra la base vacía y
 * doce conceptos que no ha visto nunca —versiones, franjas, clases de día,
 * contratos—. Esto es lo que la lleva de "no hay nada" a "ya factura":
 *
 *   1. `crearCentro()`     — la central, su calendario y su primer usuario.
 *   2. `aplicarPlantilla()`— un tarifario con la estructura montada y los
 *                            importes a cero, listo para poner precios.
 *   3. `estadoPuestaEnMarcha()` — la lista de lo que todavía falta, en orden.
 *
 * El tercero es el que más importa. Configurar esto tiene ocho pasos y siete
 * de ellos no dan error si te los saltas: simplemente no se factura, y nadie
 * se entera hasta fin de mes. La lista convierte ese silencio en una pantalla.
 *
 * Nada de lo que hay aquí publica una tarifa. Publicar sigue siendo un acto
 * manual y deliberado, porque un asistente que deja tarifas facturando por
 * pulsar "siguiente" es exactamente lo que no se quiere.
 */

import db from "../db.ts";
import { cargarTarifario } from "./pricing/tarifario.ts";
import { plantilla } from "./pricing/plantillas/index.ts";

export class ErrorPuestaEnMarcha extends Error {
  constructor(readonly codigo: string, mensaje: string, readonly estado = 400) {
    super(mensaje);
  }
}

// ── Crear la central ────────────────────────────────────────────────────────

export interface NuevoCentro {
  nombre: string;
  /** Correo del primer administrador. Sin él la central no tendría quién entre. */
  emailAdmin: string;
  nombreAdmin?: string | null;
  pais?: string;
  zonaHoraria?: string;
  moneda?: string;
}

/**
 * Da de alta una central con su primer administrador.
 *
 * El usuario se crea con rol `cc_admin` y sin contraseña: entra por la sesión
 * unificada, igual que todos. Si el correo ya existe en otra central no se
 * toca —sería robarle el usuario a la otra— y se avisa.
 */
export async function crearCentro(n: NuevoCentro): Promise<{
  controlCenterId: number; adminCreado: boolean; aviso: string | null;
}> {
  const nombre = String(n.nombre ?? "").trim();
  if (!nombre) throw new ErrorPuestaEnMarcha("nombre_requerido", "La central necesita un nombre");

  const email = String(n.emailAdmin ?? "").trim().toLowerCase();
  if (!email.includes("@")) {
    throw new ErrorPuestaEnMarcha("email_requerido",
      "Hace falta el correo del primer administrador: si no, nadie podría entrar a configurarla");
  }

  const now = Date.now();
  const cc = await db.query(
    `INSERT INTO connect_control_centers (uuid, name, settings, "createdAtMs", "updatedAtMs")
     VALUES ($1,$2,$3,$4,$4) RETURNING id`,
    [`cc-${now}-${Math.floor(now % 100000)}`, nombre,
     JSON.stringify({ pais: n.pais ?? "ES", zonaHoraria: n.zonaHoraria ?? "Europe/Madrid",
                      moneda: n.moneda ?? "EUR" }), now],
  );
  const controlCenterId = Number(cc.rows[0].id);

  const existente = await db.query(
    `SELECT "controlCenterId" FROM connect_users WHERE lower(email) = $1`, [email]);
  if (existente.rows[0]) {
    return {
      controlCenterId, adminCreado: false,
      aviso: `El correo ${email} ya pertenece a otra central. La central se ha creado, ` +
             `pero hay que darle un administrador propio desde Usuarios.`,
    };
  }

  await db.query(
    `INSERT INTO connect_users ("controlCenterId", email, name, role, "createdAtMs", "updatedAtMs")
     VALUES ($1,$2,$3,'cc_admin',$4,$4)`,
    [controlCenterId, email, String(n.nombreAdmin ?? "").trim() || email, now],
  );

  return { controlCenterId, adminCreado: true, aviso: null };
}

// ── Aplicar una plantilla ───────────────────────────────────────────────────

export interface AplicarPlantilla {
  plantilla: string;
  /** Código del tarifario que se crea. */
  code: string;
  nombre: string;
  anio?: number;
  pais?: string;
  zonaHoraria?: string;
  moneda?: string;
}

/**
 * Crea un tarifario a partir de una plantilla.
 *
 * Nace como BORRADOR y con todos los importes a cero. Eso no es un descuido:
 * una plantilla con precios inventados es un número que alguien publica con
 * prisa y acaba en una factura.
 */
export async function aplicarPlantilla(controlCenterId: number, p: AplicarPlantilla) {
  const pl = plantilla(p.plantilla);
  if (!pl) {
    throw new ErrorPuestaEnMarcha("plantilla_desconocida", `No existe la plantilla ${p.plantilla}`, 404);
  }
  const code = String(p.code ?? "").trim().toUpperCase().replace(/\s+/g, "_");
  if (!code) throw new ErrorPuestaEnMarcha("code_requerido", "El tarifario necesita un código");

  const ya = await db.query(
    `SELECT id FROM connect_tariff_plans WHERE "controlCenterId" = $1 AND code = $2`,
    [controlCenterId, code]);
  if (ya.rows[0]) {
    throw new ErrorPuestaEnMarcha("tarifario_duplicado",
      `Ya hay un tarifario con el código ${code}`, 409);
  }

  const definicion = pl.construir({
    code, nombre: String(p.nombre ?? code).trim(),
    anio: p.anio ?? new Date().getFullYear(),
    pais: p.pais, zonaHoraria: p.zonaHoraria, moneda: p.moneda,
  });

  const r = await cargarTarifario(controlCenterId, definicion);
  return {
    ...r,
    plantilla: pl.code,
    aRellenar: pl.aRellenar,
    aviso: "Los importes están a cero: hay que ponerlos antes de publicar la versión.",
  };
}

// ── Qué falta ───────────────────────────────────────────────────────────────

export interface Paso {
  clave: string;
  titulo: string;
  /** Por qué hace falta, en una línea. Sin esto la lista es una burocracia. */
  porQue: string;
  hecho: boolean;
  /** Bloquea facturar, o solo conviene. */
  imprescindible: boolean;
  detalle?: string;
  ruta?: string;
}

/**
 * Lo que le falta a una central para poder facturar, en orden.
 *
 * Cada paso dice POR QUÉ hace falta. Una lista de casillas sin el porqué se
 * rellena a ciegas, y aquí lo que se está configurando es dinero.
 */
export async function estadoPuestaEnMarcha(controlCenterId: number): Promise<{
  listo: boolean; pasos: Paso[]; pendientes: number;
}> {
  const [tarifas, contratos, clientes, empresas, talleres, usuarios, asistencias] = await Promise.all([
    db.query(
      `SELECT COUNT(*)::int AS planes,
              COUNT(*) FILTER (WHERE v.status = 'published')::int AS publicadas,
              COUNT(*) FILTER (WHERE v.status = 'draft')::int AS borradores,
              COUNT(*) FILTER (WHERE v.status = 'draft' AND EXISTS (
                SELECT 1 FROM connect_tariff_rules r
                 WHERE r."tariffVersionId" = v.id AND r.active AND r.amount > 0))::int AS "conImportes"
         FROM connect_tariff_versions v WHERE v."controlCenterId" = $1`, [controlCenterId]),
    db.query(
      `SELECT COUNT(*) FILTER (WHERE role = 'sale' AND status = 'active')::int AS venta,
              COUNT(*) FILTER (WHERE role = 'purchase' AND status = 'active')::int AS compra
         FROM connect_contracts WHERE "controlCenterId" = $1`, [controlCenterId]),
    db.query(`SELECT COUNT(*)::int AS n FROM connect_clients WHERE "controlCenterId" = $1`, [controlCenterId]),
    db.query(
      `SELECT COUNT(DISTINCT pc.id)::int AS n
         FROM connect_provider_companies pc
         JOIN connect_workshops w ON w."providerCompanyId" = pc.id
         JOIN connect_provider_authorizations a ON a."providerCompanyId" = pc.id
        WHERE a."controlCenterId" = $1`, [controlCenterId]).catch(() => ({ rows: [{ n: 0 }] })),
    db.query(
      `SELECT COUNT(*)::int AS n FROM connect_workshops w
         JOIN connect_provider_authorizations a ON a."providerCompanyId" = w."providerCompanyId"
        WHERE a."controlCenterId" = $1`, [controlCenterId]).catch(() => ({ rows: [{ n: 0 }] })),
    db.query(
      `SELECT COUNT(*)::int AS n, COUNT(*) FILTER (WHERE role = 'cc_admin')::int AS admins
         FROM connect_users WHERE "controlCenterId" = $1 AND active`, [controlCenterId]),
    db.query(`SELECT COUNT(*)::int AS n FROM connect_assistances WHERE "controlCenterId" = $1`, [controlCenterId]),
  ]);

  const t = tarifas.rows[0];
  const c = contratos.rows[0];

  const pasos: Paso[] = [
    {
      clave: "usuarios",
      titulo: "Un administrador de la central",
      porQue: "Sin él nadie puede configurar ni publicar nada.",
      hecho: usuarios.rows[0].admins > 0,
      imprescindible: true,
      detalle: `${usuarios.rows[0].n} usuario(s), ${usuarios.rows[0].admins} administrador(es)`,
      ruta: "/connect/usuarios",
    },
    {
      clave: "tarifario",
      titulo: "Un tarifario",
      porQue: "Es donde viven los precios. Se puede empezar por una plantilla.",
      hecho: t.planes > 0,
      imprescindible: true,
      detalle: `${t.planes} versión(es): ${t.publicadas} publicada(s), ${t.borradores} borrador(es)`,
      ruta: "/connect/tarifas",
    },
    {
      clave: "importes",
      titulo: "Los importes puestos",
      porQue: "Las plantillas nacen a cero a propósito: un precio inventado acabaría en una factura.",
      hecho: t.publicadas > 0 || t.conImportes > 0,
      imprescindible: true,
      detalle: t.publicadas > 0
        ? "Hay una versión publicada"
        : t.conImportes > 0 ? "Hay un borrador con importes" : "Todos los importes están a cero",
      ruta: "/connect/tarifas",
    },
    {
      clave: "publicar",
      titulo: "La tarifa publicada",
      porQue: "Un borrador no factura. Publicar es un acto deliberado y no se hace solo.",
      hecho: t.publicadas > 0,
      imprescindible: true,
      detalle: `${t.publicadas} versión(es) publicada(s)`,
      ruta: "/connect/tarifas",
    },
    {
      clave: "clientes",
      titulo: "Los clientes a los que se factura",
      porQue: "El contrato de venta cuelga de un cliente.",
      hecho: clientes.rows[0].n > 0,
      imprescindible: true,
      detalle: `${clientes.rows[0].n} cliente(s)`,
      ruta: "/connect/clientes",
    },
    {
      clave: "red",
      titulo: "La red de talleres",
      porQue: "Son quienes prestan el servicio y a quienes se les compra.",
      hecho: talleres.rows[0].n > 0,
      imprescindible: true,
      detalle: `${empresas.rows[0].n} empresa(s), ${talleres.rows[0].n} taller(es)`,
      ruta: "/connect/empresas",
    },
    {
      clave: "contrato_venta",
      titulo: "Un contrato de venta por cliente",
      porQue: "Es lo que conecta a un cliente con su tarifario. Sin él el motor no sabe qué cobrarle.",
      hecho: c.venta > 0,
      imprescindible: true,
      detalle: `${c.venta} contrato(s) de venta activo(s)`,
      ruta: "/connect/tarifas",
    },
    {
      clave: "contrato_compra",
      titulo: "Un contrato de compra por empresa proveedora",
      porQue: "Sin él sale el precio de venta pero no el coste, y el margen queda indeterminado.",
      hecho: c.compra > 0,
      imprescindible: false,
      detalle: `${c.compra} contrato(s) de compra activo(s)`,
      ruta: "/connect/tarifas",
    },
    {
      clave: "prueba",
      titulo: "Una asistencia de prueba tarificada",
      porQue: "Es la única forma de comprobar que la configuración da el precio que se espera.",
      hecho: asistencias.rows[0].n > 0,
      imprescindible: false,
      detalle: `${asistencias.rows[0].n} asistencia(s)`,
      ruta: "/connect/nueva",
    },
  ];

  const pendientes = pasos.filter((p) => !p.hecho).length;
  return {
    listo: pasos.filter((p) => p.imprescindible).every((p) => p.hecho),
    pasos, pendientes,
  };
}

// ── Contratos ───────────────────────────────────────────────────────────────

/**
 * Los contratos son el eslabón que más se olvida: se configura el tarifario,
 * se publica, y no pasa nada porque nadie ha dicho qué cliente usa cuál.
 */
export async function listarContratos(controlCenterId: number) {
  const r = await db.query(
    `SELECT ct.id, ct.role, ct.name, ct.status, ct."validFromMs", ct."validToMs", ct.priority,
            ct."clientId", cl.name AS "clientName",
            ct."providerCompanyId", pc.name AS "providerName",
            ct."workshopId", w.name AS "workshopName",
            ct."tariffPlanId", tp.name AS "tariffPlanName",
            (SELECT COUNT(*)::int FROM connect_tariff_versions v
              WHERE v."tariffPlanId" = tp.id AND v.status = 'published') AS "versionesPublicadas"
       FROM connect_contracts ct
       LEFT JOIN connect_clients cl ON cl.id = ct."clientId"
       LEFT JOIN connect_provider_companies pc ON pc.id = ct."providerCompanyId"
       LEFT JOIN connect_workshops w ON w.id = ct."workshopId"
       JOIN connect_tariff_plans tp ON tp.id = ct."tariffPlanId"
      WHERE ct."controlCenterId" = $1
      ORDER BY ct.role, COALESCE(cl.name, pc.name)`,
    [controlCenterId],
  );
  return r.rows.map((x: any) => ({
    ...x,
    validFromMs: Number(x.validFromMs),
    validToMs: x.validToMs == null ? null : Number(x.validToMs),
  }));
}

export async function guardarContrato(controlCenterId: number, c: Record<string, any>) {
  const role = c.role === "purchase" ? "purchase" : "sale";
  const clientId = role === "sale" ? Number(c.clientId) || null : null;
  const providerCompanyId = role === "purchase" ? Number(c.providerCompanyId) || null : null;

  if (role === "sale" && clientId == null) {
    throw new ErrorPuestaEnMarcha("cliente_requerido",
      "Un contrato de venta necesita el cliente al que se le factura");
  }
  if (role === "purchase" && providerCompanyId == null) {
    throw new ErrorPuestaEnMarcha("proveedor_requerido",
      "Un contrato de compra necesita la empresa proveedora que factura a la central");
  }
  const tariffPlanId = Number(c.tariffPlanId);
  if (!tariffPlanId) throw new ErrorPuestaEnMarcha("tarifario_requerido", "Hay que elegir el tarifario");

  const propio = await db.query(
    `SELECT id FROM connect_tariff_plans WHERE id = $1 AND "controlCenterId" = $2`,
    [tariffPlanId, controlCenterId]);
  if (!propio.rows[0]) {
    throw new ErrorPuestaEnMarcha("tarifario_no_encontrado", "Ese tarifario no es de tu centro", 404);
  }

  // La restricción de la base lo rechazaría igual, pero con un error de
  // PostgreSQL en lugar de algo que se pueda leer en pantalla.
  const desde = Number(c.validFromMs) || Date.now();
  const hasta = c.validToMs ? Number(c.validToMs) : null;
  if (hasta != null && hasta <= desde) {
    throw new ErrorPuestaEnMarcha("vigencia_invalida",
      "La fecha de fin del contrato tiene que ser posterior a la de inicio");
  }

  const now = Date.now();
  if (c.id) {
    const r = await db.query(
      `UPDATE connect_contracts
          SET name = $1, "tariffPlanId" = $2, status = $3, "validFromMs" = $4, "validToMs" = $5,
              priority = $6, "workshopId" = $7, "updatedAtMs" = $8
        WHERE id = $9 AND "controlCenterId" = $10 RETURNING id`,
      [String(c.name ?? "").trim() || "Contrato", tariffPlanId, c.status ?? "draft",
       Number(c.validFromMs) || now, c.validToMs ? Number(c.validToMs) : null,
       Number(c.priority ?? 0), Number(c.workshopId) || null, now, Number(c.id), controlCenterId],
    );
    if (!r.rows[0]) throw new ErrorPuestaEnMarcha("contrato_no_encontrado", "Contrato no encontrado", 404);
    return { id: Number(r.rows[0].id) };
  }

  const r = await db.query(
    `INSERT INTO connect_contracts
       ("controlCenterId", role, "clientId", "providerCompanyId", "workshopId", "tariffPlanId",
        name, status, "validFromMs", "validToMs", priority, "createdAtMs", "updatedAtMs")
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$12) RETURNING id`,
    [controlCenterId, role, clientId, providerCompanyId, Number(c.workshopId) || null,
     tariffPlanId, String(c.name ?? "").trim() || "Contrato", c.status ?? "draft",
     Number(c.validFromMs) || now, c.validToMs ? Number(c.validToMs) : null,
     Number(c.priority ?? 0), now],
  );
  return { id: Number(r.rows[0].id) };
}

export async function borrarContrato(controlCenterId: number, contratoId: number): Promise<boolean> {
  /*
   * Se termina en lugar de borrarse: un contrato borrado dejaría sin explicar
   * las asistencias que se tarificaron con él.
   *
   * El GREATEST no es adorno. La fecha de fin tiene que ser POSTERIOR a la de
   * inicio —hay una restricción que lo exige— y un contrato dado de alta y
   * terminado en el mismo milisegundo las tendría iguales. Pasa al probar y
   * pasaría el día que alguien cree un contrato y lo anule al momento por
   * haberse equivocado de cliente.
   */
  const r = await db.query(
    `UPDATE connect_contracts
        SET status = 'ended',
            "validToMs" = COALESCE("validToMs", GREATEST($1, "validFromMs" + 1)),
            "updatedAtMs" = $1
      WHERE id = $2 AND "controlCenterId" = $3 RETURNING id`,
    [Date.now(), contratoId, controlCenterId],
  );
  return (r.rowCount ?? 0) > 0;
}
