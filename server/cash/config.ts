/**
 * Configuración de Mobilink Cash: cajas físicas y catálogo de denominaciones.
 *
 * Va aparte del router porque tiene reglas propias, y el router no debe tener
 * ninguna. Las dos que importan son de protección, y las dos evitan dejar el
 * módulo en un estado del que no se puede salir:
 *
 *  · No se modifica ni se da de baja una caja con la jornada abierta. Quedaría
 *    dinero contado en una caja que ya no aparece, y nadie podría cerrarla.
 *  · No se desactiva una denominación que todavía tiene piezas en una caja
 *    abierta. Desaparecería de las pantallas con monedas dentro: el arqueo no
 *    podría contarla ni el cierre sacarla.
 */

import pool from "../db.ts";
import { registrarAuditoria } from "../core/auditoria.ts";
import type { Denominacion } from "./domain/denominations.ts";
import { FORMAS_PAGO_SEMILLA } from "./domain/operations.ts";
import { ErrorCaja, sesionAbierta } from "./repository.ts";

export type Contexto = { empresaId: string; userId: string | null; ip?: string };

export type CajaConfig = {
  id: number;
  centro: string;
  nombre: string;
  activa: boolean;
  jornadas: number;
  jornadaAbierta: number | null;
};

// ── Cajas ──────────────────────────────────────────────────────────────────

/** Todas las cajas de la empresa, incluidas las dadas de baja. */
export async function listarCajas(empresaId: string): Promise<CajaConfig[]> {
  const { rows } = await pool.query(
    `SELECT c.id, c.centro, c.nombre, c.activa,
            (SELECT COUNT(*) FROM cash_sessions s WHERE s.register_id = c.id) AS jornadas,
            (SELECT s.id FROM cash_sessions s
              WHERE s.register_id = c.id AND s.estado IN ('OPEN','PENDING_CLOSE','REOPENED')
              LIMIT 1) AS jornada_abierta
       FROM cash_registers c
      WHERE c.empresa_id = $1
      ORDER BY c.activa DESC, c.centro, c.nombre`,
    [empresaId]
  );
  /* eslint-disable @typescript-eslint/no-explicit-any */
  return rows.map((r: any) => ({
    id: r.id,
    centro: r.centro,
    nombre: r.nombre,
    activa: r.activa,
    jornadas: Number(r.jornadas),
    jornadaAbierta: r.jornada_abierta,
  }));
  /* eslint-enable @typescript-eslint/no-explicit-any */
}

export async function crearCaja(
  ctx: Contexto,
  datos: { nombre: string; centro?: string }
): Promise<{ id: number; centro: string; nombre: string; activa: boolean }> {
  const nombre = datos.nombre?.trim();
  if (!nombre) throw new ErrorCaja("ENTRADA_NO_VALIDA", "La caja necesita un nombre.", 400);

  const ahora = Date.now();
  // El upsert reactiva una caja que se había dado de baja con ese mismo nombre
  // en vez de fallar por la clave única: es lo que espera quien la vuelve a
  // crear sin acordarse de que ya existía.
  const { rows } = await pool.query(
    `INSERT INTO cash_registers (empresa_id, centro, nombre, created_at_ms, updated_at_ms)
     VALUES ($1,$2,$3,$4,$4)
     ON CONFLICT (empresa_id, centro, nombre) DO UPDATE SET activa = true, updated_at_ms = $4
     RETURNING id, centro, nombre, activa`,
    [ctx.empresaId, (datos.centro ?? "").trim(), nombre, ahora]
  );

  await registrarAuditoria({
    empresaId: ctx.empresaId,
    userId: ctx.userId,
    accion: "cash.register.create",
    entidad: "cash_registers",
    entidadId: String(rows[0].id),
    detalle: { nombre: rows[0].nombre, centro: rows[0].centro },
    ip: ctx.ip,
  });

  return rows[0];
}

export async function actualizarCaja(
  ctx: Contexto,
  id: number,
  cambios: { nombre?: string; centro?: string; activa?: boolean }
): Promise<{ id: number; centro: string; nombre: string; activa: boolean }> {
  const { rows: actual } = await pool.query(
    `SELECT * FROM cash_registers WHERE id = $1 AND empresa_id = $2`,
    [id, ctx.empresaId]
  );
  if (actual.length === 0) throw new ErrorCaja("CAJA_NO_ENCONTRADA", "La caja no existe.", 404);

  const tocaIdentidad =
    cambios.activa === false || cambios.nombre !== undefined || cambios.centro !== undefined;

  if (tocaIdentidad && (await sesionAbierta(id))) {
    throw new ErrorCaja(
      "JORNADA_ABIERTA",
      "Esta caja tiene una jornada abierta. Ciérrala antes de modificarla o darla de baja.",
      409
    );
  }

  const nombre = cambios.nombre?.trim() || actual[0].nombre;
  const centro = cambios.centro === undefined ? actual[0].centro : cambios.centro.trim();
  const activa = cambios.activa === undefined ? actual[0].activa : cambios.activa;

  const { rows } = await pool.query(
    `UPDATE cash_registers
        SET nombre = $2, centro = $3, activa = $4, updated_at_ms = $5
      WHERE id = $1
      RETURNING id, centro, nombre, activa`,
    [id, nombre, centro, activa, Date.now()]
  );

  await registrarAuditoria({
    empresaId: ctx.empresaId,
    userId: ctx.userId,
    accion: "cash.register.update",
    entidad: "cash_registers",
    entidadId: String(id),
    detalle: {
      antes: { nombre: actual[0].nombre, centro: actual[0].centro, activa: actual[0].activa },
      despues: { nombre, centro, activa },
    },
    ip: ctx.ip,
  });

  return rows[0];
}

// ── Denominaciones ─────────────────────────────────────────────────────────

/**
 * Cambia el catálogo.
 *
 * El VALOR no se toca nunca, y por eso no es ni un parámetro: es la clave
 * natural de todo el módulo y lo que da sentido a los movimientos ya asentados.
 * Cambiar que "esta fila vale 20 €" reescribiría el pasado.
 */
export async function actualizarDenominacion(
  ctx: Contexto,
  id: number,
  cambios: { activa?: boolean; piezasPorCartucho?: number | null }
): Promise<Denominacion> {
  const { rows: actual } = await pool.query(`SELECT * FROM cash_denominations WHERE id = $1`, [id]);
  if (actual.length === 0) {
    throw new ErrorCaja("DENOMINACION_NO_ENCONTRADA", "La denominación no existe.", 404);
  }

  const activa = cambios.activa === undefined ? actual[0].activa : cambios.activa;
  const piezasPorCartucho =
    cambios.piezasPorCartucho === undefined ? actual[0].piezas_por_cartucho : cambios.piezasPorCartucho;

  if (piezasPorCartucho !== null && (!Number.isSafeInteger(piezasPorCartucho) || piezasPorCartucho <= 0)) {
    throw new ErrorCaja(
      "ENTRADA_NO_VALIDA",
      "Las piezas por cartucho tienen que ser un número entero mayor que cero, o vacío.",
      400
    );
  }

  if (!activa && actual[0].activa && (await tienePiezasEnCajaAbierta(id))) {
    throw new ErrorCaja(
      "DENOMINACION_EN_USO",
      "Esa denominación todavía tiene piezas en una caja abierta. Sácalas o cierra la jornada antes de desactivarla.",
      409
    );
  }

  const { rows } = await pool.query(
    `UPDATE cash_denominations
        SET activa = $2, piezas_por_cartucho = $3, updated_at_ms = $4
      WHERE id = $1
      RETURNING id, valor_centimos, tipo, etiqueta, piezas_por_cartucho, activa, orden`,
    [id, activa, piezasPorCartucho, Date.now()]
  );

  await registrarAuditoria({
    empresaId: ctx.empresaId,
    userId: ctx.userId,
    accion: "cash.denomination.update",
    entidad: "cash_denominations",
    entidadId: String(id),
    detalle: {
      valorCentimos: actual[0].valor_centimos,
      antes: { activa: actual[0].activa, piezasPorCartucho: actual[0].piezas_por_cartucho },
      despues: { activa, piezasPorCartucho },
    },
    ip: ctx.ip,
  });

  const d = rows[0];
  return {
    id: d.id,
    valor: d.valor_centimos,
    tipo: d.tipo,
    etiqueta: d.etiqueta,
    piezasPorCartucho: d.piezas_por_cartucho,
    activa: d.activa,
    orden: d.orden,
  };
}

/** ¿Queda alguna pieza de esta denominación en una jornada todavía abierta? */
export async function tienePiezasEnCajaAbierta(denominationId: number): Promise<boolean> {
  const { rows } = await pool.query(
    `SELECT 1
       FROM cash_denomination_movements m
       JOIN cash_sessions s ON s.id = m.session_id
      WHERE m.denomination_id = $1
        AND s.estado IN ('OPEN','PENDING_CLOSE','REOPENED')
      GROUP BY m.denomination_id
     HAVING SUM(CASE WHEN m.direccion = 'IN' THEN m.cantidad ELSE -m.cantidad END) <> 0
      LIMIT 1`,
    [denominationId]
  );
  return rows.length > 0;
}

// ── Formas de pago ─────────────────────────────────────────────────────────

export type FormaPagoConfig = {
  id: number;
  codigo: string;
  nombre: string;
  imagenUrl: string | null;
  afectaEfectivo: boolean;
  pideReferencia: boolean;
  activa: boolean;
  /** Sale como botón al cobrar. */
  enCobros: boolean;
  /** Sale como botón al pagar. */
  enPagos: boolean;
  orden: number;
  /** Cobros y pagos ya registrados con esta forma. Solo informativo. */
  usos: number;
};

/* eslint-disable @typescript-eslint/no-explicit-any */
function aFormaPago(r: any): FormaPagoConfig {
  return {
    id: r.id,
    codigo: r.codigo,
    nombre: r.nombre,
    imagenUrl: r.imagen_url,
    afectaEfectivo: r.afecta_efectivo,
    pideReferencia: r.pide_referencia,
    activa: r.activa,
    enCobros: r.en_cobros,
    enPagos: r.en_pagos,
    orden: r.orden,
    usos: Number(r.usos ?? 0),
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/**
 * Siembra el catálogo de la empresa la primera vez que se le pregunta.
 *
 * No se puede sembrar al arrancar como las denominaciones porque las formas de
 * pago son por empresa y al arrancar no sabemos cuáles hay. `ON CONFLICT DO
 * NOTHING` para que dos peticiones a la vez no se pisen, y solo se siembra si
 * la empresa no tiene NINGUNA forma: si alguien las borró todas a propósito,
 * volver a meterlas sería deshacer su decisión.
 */
export async function asegurarFormasPago(empresaId: string): Promise<void> {
  const { rows } = await pool.query(
    `SELECT 1 FROM cash_payment_methods WHERE empresa_id = $1 LIMIT 1`,
    [empresaId]
  );
  if (rows.length > 0) return;

  const ahora = Date.now();
  for (const f of FORMAS_PAGO_SEMILLA) {
    await pool.query(
      `INSERT INTO cash_payment_methods
         (empresa_id, codigo, nombre, afecta_efectivo, pide_referencia, activa,
          en_cobros, en_pagos, orden, created_at_ms, updated_at_ms)
       VALUES ($1,$2,$3,$4,$5,true,$6,$7,$8,$9,$9)
       ON CONFLICT (empresa_id, codigo) DO NOTHING`,
      [
        empresaId,
        f.codigo,
        f.nombre,
        f.afectaEfectivo,
        f.pideReferencia,
        f.enCobros,
        f.enPagos,
        f.orden,
        ahora,
      ]
    );
  }
}

/** Catálogo completo de la empresa, incluidas las formas dadas de baja. */
export async function listarFormasPago(empresaId: string): Promise<FormaPagoConfig[]> {
  await asegurarFormasPago(empresaId);
  const { rows } = await pool.query(
    `SELECT m.*,
            (SELECT COUNT(*) FROM cash_operation_payments p
              JOIN cash_operations o ON o.id = p.operation_id
             WHERE p.forma_pago = m.codigo AND o.empresa_id = m.empresa_id) AS usos
       FROM cash_payment_methods m
      WHERE m.empresa_id = $1
      ORDER BY m.activa DESC, m.orden, m.nombre`,
    [empresaId]
  );
  return rows.map(aFormaPago);
}

/** Solo las que deben salir como botón en cobros y pagos. */
export async function formasPagoActivas(empresaId: string): Promise<FormaPagoConfig[]> {
  return (await listarFormasPago(empresaId)).filter((f) => f.activa);
}

function normalizarCodigo(codigo: string): string {
  return codigo
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9_]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
}

export async function crearFormaPago(
  ctx: Contexto,
  datos: {
    nombre: string;
    codigo?: string;
    pideReferencia?: boolean;
    enCobros?: boolean;
    enPagos?: boolean;
    orden?: number;
  }
): Promise<FormaPagoConfig> {
  const nombre = String(datos.nombre ?? "").trim();
  if (!nombre) {
    throw new ErrorCaja("ENTRADA_NO_VALIDA", "La forma de pago necesita un nombre.", 400);
  }

  const codigo = normalizarCodigo(datos.codigo?.trim() || nombre);
  if (!codigo) {
    throw new ErrorCaja(
      "ENTRADA_NO_VALIDA",
      "Del nombre no sale ningún código válido. Indícalo a mano con letras y números.",
      400
    );
  }

  await asegurarFormasPago(ctx.empresaId);

  const { rows: choque } = await pool.query(
    `SELECT id, activa FROM cash_payment_methods WHERE empresa_id = $1 AND codigo = $2`,
    [ctx.empresaId, codigo]
  );
  if (choque.length > 0) {
    throw new ErrorCaja(
      "FORMA_PAGO_DUPLICADA",
      choque[0].activa
        ? `Ya existe una forma de pago con el código ${codigo}.`
        : `Ya existe una forma de pago con el código ${codigo}, dada de baja. Vuelve a activarla en vez de crear otra.`,
      409
    );
  }

  // El efectivo no se crea: es el que ya viene sembrado. Dos formas que muevan
  // piezas harían ambiguo el desglose por denominación de cada operación.
  const ahora = Date.now();
  const { rows } = await pool.query(
    `INSERT INTO cash_payment_methods
       (empresa_id, codigo, nombre, afecta_efectivo, pide_referencia, activa,
        en_cobros, en_pagos, orden, created_at_ms, updated_at_ms)
     VALUES ($1,$2,$3,false,$4,true,$5,$6,$7,$8,$8)
     RETURNING *`,
    [
      ctx.empresaId,
      codigo,
      nombre,
      datos.pideReferencia ?? true,
      datos.enCobros ?? true,
      // Una forma nueva se estrena en cobros: a un proveedor se le paga del
      // cajón, y si alguna vez hace falta se activa desde aquí mismo.
      datos.enPagos ?? false,
      datos.orden ?? 100,
      ahora,
    ]
  );

  await registrarAuditoria({
    empresaId: ctx.empresaId,
    userId: ctx.userId,
    accion: "cash.payment_method.create",
    entidad: "cash_payment_methods",
    entidadId: String(rows[0].id),
    detalle: { codigo, nombre },
    ip: ctx.ip,
  });

  return aFormaPago(rows[0]);
}

/**
 * Cambia una forma de pago.
 *
 * El CÓDIGO no se toca nunca, igual que el valor de una denominación: es lo que
 * llevan escrito los cobros ya registrados. Renombrar la etiqueta sí, y eso
 * arrastra al histórico a propósito —"TPV BBVA" pasa a llamarse como se llame
 * el banco mañana— pero el código sigue apuntando a lo mismo.
 */
export async function actualizarFormaPago(
  ctx: Contexto,
  id: number,
  cambios: {
    nombre?: string;
    activa?: boolean;
    pideReferencia?: boolean;
    enCobros?: boolean;
    enPagos?: boolean;
    orden?: number;
    imagenUrl?: string | null;
  }
): Promise<FormaPagoConfig> {
  const { rows: actual } = await pool.query(
    `SELECT * FROM cash_payment_methods WHERE id = $1 AND empresa_id = $2`,
    [id, ctx.empresaId]
  );
  if (actual.length === 0) {
    throw new ErrorCaja("FORMA_PAGO_NO_ENCONTRADA", "La forma de pago no existe.", 404);
  }
  const antes = actual[0];

  const nombre = cambios.nombre === undefined ? antes.nombre : String(cambios.nombre).trim();
  if (!nombre) {
    throw new ErrorCaja("ENTRADA_NO_VALIDA", "La forma de pago necesita un nombre.", 400);
  }
  const activa = cambios.activa === undefined ? antes.activa : cambios.activa;
  const pideReferencia =
    cambios.pideReferencia === undefined ? antes.pide_referencia : cambios.pideReferencia;
  const orden = cambios.orden === undefined ? antes.orden : cambios.orden;
  const enCobros = cambios.enCobros === undefined ? antes.en_cobros : cambios.enCobros;
  const enPagos = cambios.enPagos === undefined ? antes.en_pagos : cambios.enPagos;
  const imagenUrl = cambios.imagenUrl === undefined ? antes.imagen_url : cambios.imagenUrl;

  // El efectivo no se da de baja. Todo el módulo existe para contar piezas: sin
  // efectivo no quedaría ni arqueo, ni cambio, ni cierre que hacer.
  if (!activa && antes.afecta_efectivo) {
    throw new ErrorCaja(
      "FORMA_PAGO_PROTEGIDA",
      "El efectivo no se puede dar de baja: es la única forma que mueve el cajón, y sin ella no hay arqueo ni cierre.",
      409
    );
  }

  // Y tampoco se puede quitar de una de las dos pantallas: sin efectivo no se
  // podría cobrar ni pagar del cajón, que es de lo que va el módulo.
  if (antes.afecta_efectivo && (!enCobros || !enPagos)) {
    throw new ErrorCaja(
      "FORMA_PAGO_PROTEGIDA",
      "El efectivo tiene que estar disponible en cobros y en pagos.",
      409
    );
  }

  if (!activa && antes.activa) {
    const { rows: quedan } = await pool.query(
      `SELECT COUNT(*) AS n FROM cash_payment_methods
        WHERE empresa_id = $1 AND activa AND id <> $2`,
      [ctx.empresaId, id]
    );
    if (Number(quedan[0].n) === 0) {
      throw new ErrorCaja(
        "FORMA_PAGO_PROTEGIDA",
        "Es la última forma de pago activa. Con el catálogo vacío no se podría cobrar nada.",
        409
      );
    }
  }

  const { rows } = await pool.query(
    `UPDATE cash_payment_methods
        SET nombre = $3, activa = $4, pide_referencia = $5, orden = $6, imagen_url = $7,
            en_cobros = $8, en_pagos = $9, updated_at_ms = $10
      WHERE id = $1 AND empresa_id = $2
      RETURNING *`,
    [
      id,
      ctx.empresaId,
      nombre,
      activa,
      pideReferencia,
      orden,
      imagenUrl,
      enCobros,
      enPagos,
      Date.now(),
    ]
  );

  await registrarAuditoria({
    empresaId: ctx.empresaId,
    userId: ctx.userId,
    accion: "cash.payment_method.update",
    entidad: "cash_payment_methods",
    entidadId: String(id),
    detalle: {
      codigo: antes.codigo,
      antes: {
        nombre: antes.nombre,
        activa: antes.activa,
        pideReferencia: antes.pide_referencia,
        enCobros: antes.en_cobros,
        enPagos: antes.en_pagos,
        orden: antes.orden,
        imagenUrl: antes.imagen_url,
      },
      despues: { nombre, activa, pideReferencia, enCobros, enPagos, orden, imagenUrl },
    },
    ip: ctx.ip,
  });

  return aFormaPago(rows[0]);
}

// ── Ajustes sueltos del módulo ─────────────────────────────────────────────

/**
 * Claves admitidas en `cash_settings`.
 *
 * Lista blanca a propósito: la clave llega del cliente y sin acotarla la tabla
 * acabaría siendo un cajón donde cualquiera guarda cualquier cosa.
 */
export const AJUSTES = {
  /** Imagen del botón «Mixto» de cobros. */
  MIXTO_IMAGEN: "mixto_imagen_url",
} as const;

export type ClaveAjuste = (typeof AJUSTES)[keyof typeof AJUSTES];

const CLAVES_VALIDAS: string[] = Object.values(AJUSTES);

export type Ajustes = { mixtoImagenUrl: string | null };

/** Todos los ajustes de la empresa, ya con la forma que espera el frontend. */
export async function ajustes(empresaId: string): Promise<Ajustes> {
  const { rows } = await pool.query<{ clave: string; valor: string | null }>(
    `SELECT clave, valor FROM cash_settings WHERE empresa_id = $1`,
    [empresaId]
  );
  const mapa = new Map(rows.map((r) => [r.clave, r.valor]));
  return { mixtoImagenUrl: mapa.get(AJUSTES.MIXTO_IMAGEN) ?? null };
}

/** Fija un ajuste. `null` lo borra. */
export async function fijarAjuste(
  ctx: Contexto,
  clave: ClaveAjuste,
  valor: string | null
): Promise<Ajustes> {
  if (!CLAVES_VALIDAS.includes(clave)) {
    throw new ErrorCaja("AJUSTE_DESCONOCIDO", `El ajuste «${clave}» no existe.`, 400);
  }

  if (valor === null) {
    await pool.query(`DELETE FROM cash_settings WHERE empresa_id = $1 AND clave = $2`, [
      ctx.empresaId,
      clave,
    ]);
  } else {
    await pool.query(
      `INSERT INTO cash_settings (empresa_id, clave, valor, updated_at_ms)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (empresa_id, clave) DO UPDATE
         SET valor = EXCLUDED.valor, updated_at_ms = EXCLUDED.updated_at_ms`,
      [ctx.empresaId, clave, valor, Date.now()]
    );
  }

  await registrarAuditoria({
    empresaId: ctx.empresaId,
    userId: ctx.userId,
    accion: "cash.setting.update",
    entidad: "cash_settings",
    entidadId: clave,
    detalle: { clave, valor },
    ip: ctx.ip,
  });

  return ajustes(ctx.empresaId);
}

// ── Secciones de negocio ───────────────────────────────────────────────────

/**
 * Semilla de secciones.
 *
 * Taller y gasolinera porque es lo que hay hoy, y taller por defecto porque es
 * el negocio principal y el que se lleva los pagos. No es una lista cerrada:
 * el catálogo es de la empresa y se puede añadir una tercera —tienda, lavadero—
 * sin tocar código.
 */
const SECCIONES_SEMILLA = [
  { codigo: "TALLER", nombre: "Taller", porDefecto: true, orden: 1 },
  { codigo: "GASOLINERA", nombre: "Gasolinera", porDefecto: false, orden: 2 },
];

export type SeccionConfig = {
  id: number;
  codigo: string;
  nombre: string;
  activa: boolean;
  porDefecto: boolean;
  orden: number;
  /** Cuántas operaciones la usan. Una sección con usos no se borra. */
  usos: number;
};

/* eslint-disable @typescript-eslint/no-explicit-any */
function aSeccion(r: any): SeccionConfig {
  return {
    id: r.id,
    codigo: r.codigo,
    nombre: r.nombre,
    activa: r.activa,
    porDefecto: r.por_defecto,
    orden: r.orden,
    usos: Number(r.usos ?? 0),
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/** Siembra las secciones la primera vez que se consultan. */
async function asegurarSecciones(empresaId: string): Promise<void> {
  const ahora = Date.now();
  for (const s of SECCIONES_SEMILLA) {
    await pool.query(
      `INSERT INTO cash_sections
         (empresa_id, codigo, nombre, activa, por_defecto, orden, created_at_ms, updated_at_ms)
       VALUES ($1,$2,$3,true,$4,$5,$6,$6)
       ON CONFLICT (empresa_id, codigo) DO NOTHING`,
      [empresaId, s.codigo, s.nombre, s.porDefecto, s.orden, ahora]
    );
  }
}

/** Catálogo completo, incluidas las secciones dadas de baja. */
export async function listarSecciones(empresaId: string): Promise<SeccionConfig[]> {
  await asegurarSecciones(empresaId);
  const { rows } = await pool.query(
    `SELECT s.*, (SELECT COUNT(*) FROM cash_operations o WHERE o.section_id = s.id) AS usos
       FROM cash_sections s
      WHERE s.empresa_id = $1
      ORDER BY s.activa DESC, s.orden, s.nombre`,
    [empresaId]
  );
  return rows.map(aSeccion);
}

export async function crearSeccion(
  ctx: Contexto,
  datos: { nombre: string; codigo?: string; orden?: number }
): Promise<SeccionConfig> {
  const nombre = datos.nombre?.trim();
  if (!nombre) throw new ErrorCaja("ENTRADA_NO_VALIDA", "La sección necesita un nombre.", 400);

  // El código se deriva del nombre y no cambia nunca: es lo que queda escrito
  // en las operaciones, igual que en las formas de cobro.
  const codigo =
    datos.codigo?.trim().toUpperCase() ||
    nombre
      .toUpperCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^A-Z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 30);
  if (!codigo) throw new ErrorCaja("ENTRADA_NO_VALIDA", "El nombre no da un código válido.", 400);

  const ahora = Date.now();
  const { rows } = await pool.query(
    `INSERT INTO cash_sections
       (empresa_id, codigo, nombre, activa, por_defecto, orden, created_at_ms, updated_at_ms)
     VALUES ($1,$2,$3,true,false,$4,$5,$5)
     ON CONFLICT (empresa_id, codigo) DO NOTHING
     RETURNING *`,
    [ctx.empresaId, codigo, nombre, datos.orden ?? 99, ahora]
  );
  if (rows.length === 0) {
    throw new ErrorCaja("SECCION_DUPLICADA", `Ya existe una sección con el código ${codigo}.`, 409);
  }

  await registrarAuditoria({
    empresaId: ctx.empresaId,
    userId: ctx.userId,
    accion: "cash.section.create",
    entidad: "cash_sections",
    entidadId: String(rows[0].id),
    detalle: { codigo, nombre },
    ip: ctx.ip,
  });

  return aSeccion(rows[0]);
}

export async function actualizarSeccion(
  ctx: Contexto,
  id: number,
  datos: { nombre?: string; activa?: boolean; porDefecto?: boolean; orden?: number }
): Promise<SeccionConfig> {
  const { rows: previas } = await pool.query(
    `SELECT * FROM cash_sections WHERE id = $1 AND empresa_id = $2`,
    [id, ctx.empresaId]
  );
  const antes = previas[0];
  if (!antes) throw new ErrorCaja("SECCION_NO_ENCONTRADA", "La sección no existe.", 404);

  const activa = datos.activa ?? antes.activa;
  const porDefecto = datos.porDefecto ?? antes.por_defecto;

  /*
   * La sección por defecto no se puede dar de baja: es la que rellena los
   * pagos y la que se propone al cobrar. Sin ella, un pago no sabría a qué
   * negocio imputarse.
   */
  if (!activa && porDefecto) {
    throw new ErrorCaja(
      "SECCION_POR_DEFECTO",
      "La sección por defecto no se puede dar de baja. Marca antes otra como predeterminada.",
      409
    );
  }

  // Marcar una quita la marca de la anterior; si no, el índice único parcial
  // rechazaría el UPDATE y el usuario vería un error de base de datos.
  if (porDefecto && !antes.por_defecto) {
    await pool.query(
      `UPDATE cash_sections SET por_defecto = false, updated_at_ms = $2
        WHERE empresa_id = $1 AND por_defecto`,
      [ctx.empresaId, Date.now()]
    );
  }

  const { rows } = await pool.query(
    `UPDATE cash_sections
        SET nombre = $3, activa = $4, por_defecto = $5, orden = $6, updated_at_ms = $7
      WHERE id = $1 AND empresa_id = $2
      RETURNING *`,
    [
      id,
      ctx.empresaId,
      datos.nombre?.trim() || antes.nombre,
      activa,
      porDefecto,
      datos.orden ?? antes.orden,
      Date.now(),
    ]
  );

  await registrarAuditoria({
    empresaId: ctx.empresaId,
    userId: ctx.userId,
    accion: "cash.section.update",
    entidad: "cash_sections",
    entidadId: String(id),
    detalle: {
      codigo: antes.codigo,
      antes: { nombre: antes.nombre, activa: antes.activa, porDefecto: antes.por_defecto, orden: antes.orden },
      despues: { nombre: rows[0].nombre, activa, porDefecto, orden: rows[0].orden },
    },
    ip: ctx.ip,
  });

  return aSeccion(rows[0]);
}

/** La sección por defecto de la empresa, o `null` si no hay ninguna activa. */
export async function seccionPorDefecto(empresaId: string): Promise<number | null> {
  await asegurarSecciones(empresaId);
  const { rows } = await pool.query<{ id: number }>(
    `SELECT id FROM cash_sections WHERE empresa_id = $1 AND por_defecto AND activa LIMIT 1`,
    [empresaId]
  );
  return rows[0]?.id ?? null;
}
