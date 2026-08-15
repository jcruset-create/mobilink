/**
 * Administración del catálogo de neumáticos.
 *
 * El motor ya sabía resolver el precio de un neumático (`tires.ts`) y el
 * repositorio ya sabía leer el catálogo. Lo que faltaba era poder mantenerlo:
 * dar de alta medidas, marcas, grupos de marcas, precios de tarifa y baremos
 * de fabricante sin tener que volver a cargar el tarifario entero desde un
 * fichero de datos.
 *
 * Tres criterios recorren todo el módulo:
 *
 *  1. **Se normaliza al escribir, no al leer.** La medida pasa por
 *     `medidaCanonica` y la marca por `normalizarMarca` ANTES del INSERT, y
 *     el único índice de la tabla cuelga de la forma normalizada. Así
 *     "315/80 R 22,5" y "315/80R22.5" no pueden acabar siendo dos filas: la
 *     segunda alta devuelve la primera. Normalizar solo al consultar dejaría
 *     el duplicado escrito y el catálogo sucio para siempre.
 *
 *  2. **Una versión publicada no se toca.** Es el mismo criterio que
 *     `cargarTarifario`: cambiar el precio de un neumático de una versión ya
 *     publicada cambiaría el importe de asistencias facturadas con ella. Se
 *     corrige publicando otra versión, no editando la anterior.
 *
 *  3. **Todo pasa por el centro de control.** Aquí se manejan costes de
 *     compra: un centro no puede ver ni tocar el catálogo de otro. Por eso
 *     `controlCenterId` es el primer parámetro de todas las funciones y
 *     también se comprueba al escribir sobre filas que ya existen.
 */

import db from "../../db.ts";
import { medidaCanonica } from "../../../shared/medidas.ts";
import { normalizarMarca, type ModeloPrecio, type PosicionNeumatico } from "./tires.ts";

export class ErrorCatalogo extends Error {
  constructor(readonly codigo: string, mensaje: string) {
    super(mensaje);
  }
}

const POSICIONES: PosicionNeumatico[] = ["STEER", "DRIVE", "TRAILER", "ANY"];
const MODELOS: ModeloPrecio[] = ["NET_PRICE", "DISCOUNT_FROM_LIST"];

// ── Medidas ────────────────────────────────────────────────────────────────

export interface Medida {
  id: number;
  normalizedCode: string;
  rawInput: string | null;
  active: boolean;
}

export async function listarMedidas(controlCenterId: number, busqueda?: string | null): Promise<Medida[]> {
  const q = (busqueda ?? "").trim();
  const r = await db.query(
    `SELECT id, "normalizedCode", "rawInput", active
       FROM connect_tire_sizes
      WHERE "controlCenterId" = $1
        AND ($2 = '' OR "normalizedCode" LIKE '%' || $2 || '%')
      ORDER BY "normalizedCode"
      LIMIT 500`,
    [controlCenterId, medidaCanonica(q)],
  );
  return r.rows as Medida[];
}

/**
 * Alta de medida. Idempotente por la forma normalizada: pedir dos veces
 * "315/80R22.5" escrito de dos maneras distintas devuelve la misma fila.
 */
export async function crearMedida(controlCenterId: number, entrada: string): Promise<Medida> {
  const normalizada = medidaCanonica(entrada);
  if (!normalizada) throw new ErrorCatalogo("medida_vacia", "La medida no puede estar vacía");

  const piezas = descomponer(normalizada);
  const r = await db.query(
    `INSERT INTO connect_tire_sizes
       ("controlCenterId", width, "aspectRatio", "rimDiameter", "normalizedCode", "rawInput", "createdAtMs")
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT ("controlCenterId", "normalizedCode") DO UPDATE
       SET active = true
     RETURNING id, "normalizedCode", "rawInput", active`,
    [controlCenterId, piezas.width, piezas.aspectRatio, piezas.rimDiameter,
     normalizada, String(entrada).trim(), Date.now()],
  );
  return r.rows[0] as Medida;
}

/**
 * Ancho, perfil y llanta de una medida ya normalizada.
 *
 * Se guardan sueltos para poder buscar por llanta sin parsear texto en SQL.
 * Si la medida no tiene la forma habitual se dejan nulos: es preferible a
 * inventarse un ancho que luego alguien filtre y no encuentre.
 */
function descomponer(medida: string): { width: number | null; aspectRatio: number | null; rimDiameter: number | null } {
  const m = /^(\d{2,3})\/(\d{2,3})\s*R?\s*(\d{2}(?:\.\d)?)/.exec(medida);
  if (!m) return { width: null, aspectRatio: null, rimDiameter: null };
  return { width: Number(m[1]), aspectRatio: Number(m[2]), rimDiameter: Number(m[3]) };
}

// ── Marcas ─────────────────────────────────────────────────────────────────

export interface Marca {
  id: number;
  code: string;
  name: string;
  normalizedName: string;
  active: boolean;
}

export async function listarMarcas(controlCenterId: number): Promise<Marca[]> {
  const r = await db.query(
    `SELECT id, code, name, "normalizedName", active
       FROM connect_tire_brands WHERE "controlCenterId" = $1 ORDER BY name`,
    [controlCenterId],
  );
  return r.rows as Marca[];
}

export async function crearMarca(controlCenterId: number, nombre: string, code?: string | null): Promise<Marca> {
  const limpio = String(nombre ?? "").trim();
  if (!limpio) throw new ErrorCatalogo("marca_vacia", "La marca no puede estar vacía");
  const normalizada = normalizarMarca(limpio);

  const r = await db.query(
    `INSERT INTO connect_tire_brands ("controlCenterId", code, name, "normalizedName", "createdAtMs")
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT ("controlCenterId", "normalizedName") DO UPDATE
       SET name = EXCLUDED.name, active = true
     RETURNING id, code, name, "normalizedName", active`,
    [controlCenterId, (code ?? normalizada).replace(/\s+/g, "_"), limpio, normalizada, Date.now()],
  );
  return r.rows[0] as Marca;
}

// ── Grupos de marcas ───────────────────────────────────────────────────────

export interface GrupoMarcas {
  id: number;
  code: string;
  name: string;
  marcas: string[];
}

export async function listarGrupos(controlCenterId: number, versionId: number): Promise<GrupoMarcas[]> {
  const r = await db.query(
    `SELECT g.id, g.code, g.name,
            COALESCE(array_agg(b.name ORDER BY b.name) FILTER (WHERE b.id IS NOT NULL), '{}') AS marcas
       FROM connect_tire_brand_groups g
       LEFT JOIN connect_tire_brand_group_members m ON m."groupId" = g.id
       LEFT JOIN connect_tire_brands b ON b.id = m."brandId"
      WHERE g."controlCenterId" = $1 AND g."tariffVersionId" = $2
      GROUP BY g.id
      ORDER BY g.code`,
    [controlCenterId, versionId],
  );
  return r.rows as GrupoMarcas[];
}

/**
 * Alta o actualización de un grupo con sus marcas.
 *
 * El grupo cuelga de la versión tarifaria a propósito: que Hankook sea
 * IMPORT_1 en el tarifario de un cliente no obliga a que lo sea en el de otro.
 * Las marcas que no existan se dan de alta sobre la marcha, porque escribir un
 * grupo y que falle a mitad por una marca nueva sería un mal sitio para
 * enterarse.
 */
export async function guardarGrupo(
  controlCenterId: number,
  versionId: number,
  grupo: { code: string; name: string; marcas: string[] },
): Promise<GrupoMarcas> {
  await exigirBorrador(controlCenterId, versionId);
  const code = String(grupo.code ?? "").trim().toUpperCase();
  if (!code) throw new ErrorCatalogo("grupo_sin_codigo", "El grupo necesita un código");

  const r = await db.query(
    `INSERT INTO connect_tire_brand_groups ("controlCenterId", "tariffVersionId", code, name)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT ("tariffVersionId", code) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
    [controlCenterId, versionId, code, String(grupo.name ?? code).trim()],
  );
  const groupId = Number(r.rows[0].id);

  // Se reescribe la pertenencia entera: quitar una marca de un grupo tiene
  // que poder hacerse mandando la lista sin ella.
  await db.query(`DELETE FROM connect_tire_brand_group_members WHERE "groupId" = $1`, [groupId]);
  for (const nombre of grupo.marcas ?? []) {
    const marca = await crearMarca(controlCenterId, nombre);
    await db.query(
      `INSERT INTO connect_tire_brand_group_members ("groupId", "brandId")
       VALUES ($1,$2) ON CONFLICT DO NOTHING`,
      [groupId, marca.id],
    );
  }

  const grupos = await listarGrupos(controlCenterId, versionId);
  return grupos.find((g) => g.id === groupId)!;
}

// ── Precios de tarifa ──────────────────────────────────────────────────────

export interface PrecioTarifa {
  id: number;
  tireSizeCode: string | null;
  brandName: string | null;
  brandGroupCode: string | null;
  position: PosicionNeumatico;
  priceModel: ModeloPrecio;
  netAmount: string | null;
  discountPercent: string | null;
  manufacturerPriceListId: number | null;
  priority: number;
  active: boolean;
}

export async function listarPrecios(controlCenterId: number, versionId: number): Promise<PrecioTarifa[]> {
  const r = await db.query(
    `SELECT p.id, s."normalizedCode" AS "tireSizeCode", b.name AS "brandName",
            g.code AS "brandGroupCode", p.position, p."priceModel", p."netAmount",
            p."discountPercent", p."manufacturerPriceListId", p.priority, p.active
       FROM connect_tariff_tire_prices p
       LEFT JOIN connect_tire_sizes s ON s.id = p."tireSizeId"
       LEFT JOIN connect_tire_brands b ON b.id = p."brandId"
       LEFT JOIN connect_tire_brand_groups g ON g.id = p."brandGroupId"
      WHERE p."controlCenterId" = $1 AND p."tariffVersionId" = $2
      ORDER BY p.priority DESC, p.id`,
    [controlCenterId, versionId],
  );
  return r.rows as PrecioTarifa[];
}

export interface EntradaPrecio {
  medida?: string | null;
  marca?: string | null;
  grupoMarca?: string | null;
  posicion?: string | null;
  modeloPrecio: string;
  importeNeto?: string | number | null;
  descuentoPorcentaje?: string | number | null;
  baremoId?: number | null;
  prioridad?: number | null;
  activo?: boolean | null;
}

export async function crearPrecio(
  controlCenterId: number,
  versionId: number,
  e: EntradaPrecio,
): Promise<PrecioTarifa> {
  await exigirBorrador(controlCenterId, versionId);
  validarPrecio(e);

  if (e.marca && e.grupoMarca) {
    throw new ErrorCatalogo("marca_y_grupo",
      "Un precio cuelga de una marca o de un grupo, no de las dos: si no, no se sabría cuál manda");
  }

  const medidaId = e.medida ? (await crearMedida(controlCenterId, e.medida)).id : null;
  const marcaId = e.marca ? (await crearMarca(controlCenterId, e.marca)).id : null;
  const grupoId = e.grupoMarca ? await idDeGrupo(controlCenterId, versionId, e.grupoMarca) : null;

  const r = await db.query(
    `INSERT INTO connect_tariff_tire_prices
       ("controlCenterId", "tariffVersionId", "tireSizeId", "brandId", "brandGroupId",
        position, "priceModel", "netAmount", "discountPercent", "manufacturerPriceListId",
        priority, active, "createdAtMs")
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     RETURNING id`,
    [controlCenterId, versionId, medidaId, marcaId, grupoId,
     e.posicion ?? "ANY", e.modeloPrecio,
     e.importeNeto ?? null, e.descuentoPorcentaje ?? null, e.baremoId ?? null,
     e.prioridad ?? 0, e.activo ?? true, Date.now()],
  );

  const precios = await listarPrecios(controlCenterId, versionId);
  return precios.find((p) => p.id === Number(r.rows[0].id))!;
}

export interface FilaLote extends EntradaPrecio {
  /** Fila del origen, para poder decir cuál falla. */
  fila?: number;
}

export interface ResultadoLote {
  escritas: number;
  borradas: number;
  errores: { fila: number; motivo: string }[];
}

/**
 * Carga en lote de precios de neumático, pensada para pegar una tabla entera.
 *
 * Un catálogo real son ciento y pico filas por lado. Meterlas de una en una
 * por un formulario no lo hace nadie: acabarían otra vez en un fichero de
 * código, que es de donde se quería salir.
 *
 * Dos decisiones que importan:
 *
 *  1. **Se valida TODO antes de escribir NADA.** Si la fila 90 tiene un
 *     descuento imposible, no se han escrito ya 89 filas a medias. Se devuelve
 *     la lista de fallos con su número de fila y no se toca la base.
 *
 *  2. **`reemplazar` borra lo que había en esa versión.** Es lo que se espera
 *     al pegar la tabla del proveedor: la tabla nueva ES el catálogo, no un
 *     añadido. Sin esto, volver a pegar tras corregir una errata duplicaría
 *     las ciento y pico filas y el precio saldría de una de las dos copias sin
 *     que nadie sepa cuál.
 */
export async function crearPreciosEnLote(
  controlCenterId: number,
  versionId: number,
  filas: FilaLote[],
  opciones: { reemplazar?: boolean } = {},
): Promise<ResultadoLote> {
  await exigirBorrador(controlCenterId, versionId);

  const errores: { fila: number; motivo: string }[] = [];
  filas.forEach((f, i) => {
    const n = f.fila ?? i + 1;
    try {
      validarPrecio(f);
      if (f.marca && f.grupoMarca) {
        throw new ErrorCatalogo("marca_y_grupo", "No puede colgar de una marca y de un grupo a la vez");
      }
      if (!f.medida && !f.marca && !f.grupoMarca) {
        throw new ErrorCatalogo("fila_vacia", "Sin medida, marca ni grupo esta fila valdría para todo");
      }
    } catch (e) {
      errores.push({ fila: n, motivo: e instanceof ErrorCatalogo ? e.message : String(e) });
    }
  });

  // Los grupos citados tienen que existir: se comprueba antes de borrar nada
  const grupos = new Map<string, number>();
  for (const code of new Set(filas.map((f) => f.grupoMarca).filter(Boolean) as string[])) {
    try {
      grupos.set(code, await idDeGrupo(controlCenterId, versionId, code));
    } catch {
      errores.push({ fila: 0, motivo: `El grupo ${code} no existe en esta versión` });
    }
  }

  if (errores.length > 0) return { escritas: 0, borradas: 0, errores };

  let borradas = 0;
  if (opciones.reemplazar) {
    const r = await db.query(
      `DELETE FROM connect_tariff_tire_prices WHERE "tariffVersionId" = $1 AND "controlCenterId" = $2`,
      [versionId, controlCenterId]);
    borradas = r.rowCount ?? 0;
  }

  const now = Date.now();
  let escritas = 0;
  for (const f of filas) {
    const medidaId = f.medida ? (await crearMedida(controlCenterId, f.medida)).id : null;
    const marcaId = f.marca ? (await crearMarca(controlCenterId, f.marca)).id : null;
    await db.query(
      `INSERT INTO connect_tariff_tire_prices
         ("controlCenterId", "tariffVersionId", "tireSizeId", "brandId", "brandGroupId",
          position, "priceModel", "netAmount", "discountPercent", "manufacturerPriceListId",
          priority, active, "createdAtMs")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,true,$12)`,
      [controlCenterId, versionId, medidaId, marcaId,
       f.grupoMarca ? grupos.get(f.grupoMarca) ?? null : null,
       f.posicion ?? "ANY", f.modeloPrecio, f.importeNeto ?? null,
       f.descuentoPorcentaje ?? null, f.baremoId ?? null,
       f.prioridad ?? (f.marca ? 20 : f.grupoMarca ? 10 : 5), now]);
    escritas++;
  }

  return { escritas, borradas, errores: [] };
}

/**
 * Baja de un precio. Se desactiva en lugar de borrarse: el precio puede estar
 * referenciado desde el snapshot de una asistencia, y aunque el snapshot se
 * baste solo, dejar el rastro cuesta una columna.
 */
export async function desactivarPrecio(controlCenterId: number, precioId: number): Promise<boolean> {
  const fila = await db.query(
    `SELECT "tariffVersionId" FROM connect_tariff_tire_prices WHERE id = $1 AND "controlCenterId" = $2`,
    [precioId, controlCenterId],
  );
  if (!fila.rows[0]) return false;
  await exigirBorrador(controlCenterId, Number(fila.rows[0].tariffVersionId));

  const r = await db.query(
    `UPDATE connect_tariff_tire_prices SET active = false
      WHERE id = $1 AND "controlCenterId" = $2 RETURNING id`,
    [precioId, controlCenterId],
  );
  return (r.rowCount ?? 0) > 0;
}

function validarPrecio(e: EntradaPrecio): void {
  if (!MODELOS.includes(e.modeloPrecio as ModeloPrecio)) {
    throw new ErrorCatalogo("modelo_desconocido", `Modelo de precio no reconocido: ${e.modeloPrecio}`);
  }
  if (e.posicion && !POSICIONES.includes(e.posicion as PosicionNeumatico)) {
    throw new ErrorCatalogo("posicion_desconocida", `Posición no reconocida: ${e.posicion}`);
  }
  if (e.modeloPrecio === "NET_PRICE" && e.importeNeto == null) {
    throw new ErrorCatalogo("falta_importe", "Un precio neto necesita importe");
  }
  if (e.modeloPrecio === "DISCOUNT_FROM_LIST") {
    if (e.descuentoPorcentaje == null) {
      throw new ErrorCatalogo("falta_descuento", "Un precio por baremo necesita el porcentaje de descuento");
    }
    /*
     * El porcentaje es el DESCUENTO, no el precio resultante. Un 610 metido
     * aquí en lugar de un 39 daría un precio negativo, así que se corta en el
     * alta y no en la factura.
     */
    const d = Number(e.descuentoPorcentaje);
    if (!Number.isFinite(d) || d < 0 || d > 100) {
      throw new ErrorCatalogo("descuento_invalido",
        "El descuento va de 0 a 100: es el porcentaje que se resta del baremo, no el precio final");
    }
  }
}

async function idDeGrupo(controlCenterId: number, versionId: number, code: string): Promise<number> {
  const r = await db.query(
    `SELECT id FROM connect_tire_brand_groups
      WHERE "controlCenterId" = $1 AND "tariffVersionId" = $2 AND code = $3`,
    [controlCenterId, versionId, String(code).trim().toUpperCase()],
  );
  if (!r.rows[0]) throw new ErrorCatalogo("grupo_no_encontrado", `El grupo ${code} no existe en esta versión`);
  return Number(r.rows[0].id);
}

// ── Baremos de fabricante ──────────────────────────────────────────────────

export interface Baremo {
  id: number;
  brandName: string;
  name: string;
  validFromMs: number;
  validToMs: number | null;
  sourceDocument: string | null;
  active: boolean;
  lineas: number;
}

export async function listarBaremos(controlCenterId: number): Promise<Baremo[]> {
  const r = await db.query(
    `SELECT l.id, b.name AS "brandName", l.name, l."validFromMs", l."validToMs",
            l."sourceDocument", l.active, COUNT(p.id)::int AS lineas
       FROM connect_manufacturer_price_lists l
       JOIN connect_tire_brands b ON b.id = l."brandId"
       LEFT JOIN connect_manufacturer_tire_prices p ON p."priceListId" = l.id
      WHERE l."controlCenterId" = $1
      GROUP BY l.id, b.name
      ORDER BY b.name, l."validFromMs" DESC`,
    [controlCenterId],
  );
  return r.rows.map((x: any) => ({
    ...x,
    validFromMs: Number(x.validFromMs),
    validToMs: x.validToMs == null ? null : Number(x.validToMs),
  }));
}

export async function crearBaremo(
  controlCenterId: number,
  e: { marca: string; nombre: string; vigenteDesdeMs: number; vigenteHastaMs?: number | null; fuente?: string | null },
): Promise<{ id: number }> {
  const marca = await crearMarca(controlCenterId, e.marca);
  const r = await db.query(
    `INSERT INTO connect_manufacturer_price_lists
       ("controlCenterId", "brandId", name, "validFromMs", "validToMs", "sourceDocument", "createdAtMs")
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
    [controlCenterId, marca.id, String(e.nombre ?? "").trim() || `Baremo ${marca.name}`,
     e.vigenteDesdeMs, e.vigenteHastaMs ?? null, e.fuente ?? null, Date.now()],
  );
  return { id: Number(r.rows[0].id) };
}

/**
 * Carga de líneas de un baremo. Se reescribe lo que llega y se deja el resto:
 * un baremo se completa en varias tandas (una hoja de Excel por gama) y borrar
 * lo anterior en cada carga dejaría solo la última.
 */
export async function cargarLineasBaremo(
  controlCenterId: number,
  baremoId: number,
  lineas: { medida: string; modelo?: string | null; precio: string | number }[],
): Promise<{ escritas: number }> {
  const dueño = await db.query(
    `SELECT id FROM connect_manufacturer_price_lists WHERE id = $1 AND "controlCenterId" = $2`,
    [baremoId, controlCenterId],
  );
  if (!dueño.rows[0]) throw new ErrorCatalogo("baremo_no_encontrado", "Baremo no encontrado");

  let escritas = 0;
  for (const l of lineas) {
    const medida = await crearMedida(controlCenterId, l.medida);
    await db.query(
      `INSERT INTO connect_manufacturer_tire_prices ("priceListId", "tireSizeId", model, "listPrice")
       VALUES ($1,$2,$3,$4)
       ON CONFLICT ("priceListId", "tireSizeId", COALESCE(model, ''))
       DO UPDATE SET "listPrice" = EXCLUDED."listPrice"`,
      [baremoId, medida.id, l.modelo ?? null, l.precio],
    );
    escritas++;
  }
  return { escritas };
}

// ── Versiones ──────────────────────────────────────────────────────────────

/**
 * Una versión publicada es inmutable. No es una precaución: es lo que permite
 * que la explicación de una asistencia de hace tres meses siga cuadrando con
 * la factura que se emitió entonces.
 */
async function exigirBorrador(controlCenterId: number, versionId: number): Promise<void> {
  const r = await db.query(
    `SELECT status FROM connect_tariff_versions WHERE id = $1 AND "controlCenterId" = $2`,
    [versionId, controlCenterId],
  );
  if (!r.rows[0]) throw new ErrorCatalogo("version_no_encontrada", "Versión tarifaria no encontrada");
  if (r.rows[0].status !== "draft") {
    throw new ErrorCatalogo("version_publicada",
      "Esta versión ya está publicada: para corregir un precio hay que publicar otra versión");
  }
}
