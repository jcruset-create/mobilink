/**
 * Posición global: todo el efectivo que hay ahora mismo, pieza a pieza.
 *
 * Dos sitios, y cada euro en uno solo:
 *
 * · **En la caja.** Con la jornada abierta, su efectivo teórico (tubos y bolsas
 *   precintadas incluidos, contados por piezas). Con la caja cerrada, el
 *   cambio que dejó el último cierre, que es lo que hay en el cajón hasta que
 *   se abra otra vez.
 * · **Pendiente de ingresar.** La bolsa de Ingresos bancarios: los cierres sin
 *   ingresar, más lo que quedó del último ingreso, menos lo devuelto al cajón
 *   reponiendo el fondo (eso ya está dentro de la caja).
 *
 * El importe pendiente sale de la cuenta (el mismo número que Ingresos
 * bancarios), y las piezas de la bolsa. Cuando no coinciden se dice, con las
 * piezas que faltan, igual que en la bolsa: no se esconde el descuadre.
 *
 * Lo que está fuera de la tienda —el cambio pedido al banco, el dinero que
 * lleva una persona— no entra: aquí se cuenta lo que se puede tocar.
 */

import pool from "../db.ts";
import type { Centimos } from "./domain/money.ts";
import { type LineaDenominacion, lineasDesdeInventario } from "./domain/inventory.ts";
import { sesionAbierta, stockTeorico } from "./repository.ts";
import {
  cierresPendientes,
  composicionPendiente,
  remanenteConPiezas,
  reposicionesPendientes,
} from "./bankdeposits.ts";

export type PosicionCaja = {
  registerId: number;
  nombre: string;
  centro: string | null;
  centroId: string | null;
  /** De dónde sale lo de la caja. */
  estado: "ABIERTA" | "CERRADA" | "SIN_JORNADAS";
  /** Fecha de la jornada abierta, o del último cierre. */
  fecha: string | null;
  caja: LineaDenominacion[];
  cajaCentimos: Centimos;
  /** Piezas de la bolsa pendiente de ingresar. */
  pendiente: LineaDenominacion[];
  /** Lo pendiente según la cuenta: cierres + remanente − repuesto. */
  pendienteCentimos: Centimos;
  cierresCentimos: Centimos;
  numCierres: number;
  remanenteCentimos: Centimos;
  repuestoCentimos: Centimos;
  /** Lo que quedó del último ingreso sin piezas conocidas. Dentro del pendiente. */
  sinDesgloseCentimos: Centimos;
  /** Piezas que se sacaron de la bolsa y que según los cierres no estaban. */
  faltan: LineaDenominacion[];
};

const fechaIso = (v: unknown): string | null =>
  v == null ? null : v instanceof Date ? v.toISOString().slice(0, 10) : String(v);

const valor = (l: readonly LineaDenominacion[]) => l.reduce((a, x) => a + x.valor * x.cantidad, 0);

/** Lo que hay en el cajón: la jornada abierta, o el cambio del último cierre. */
async function enCaja(
  registerId: number
): Promise<{ estado: PosicionCaja["estado"]; fecha: string | null; lineas: LineaDenominacion[] }> {
  const abierta = await sesionAbierta(registerId);
  if (abierta) {
    const inv = await stockTeorico(pool, abierta.id);
    return {
      estado: "ABIERTA",
      fecha: abierta.fecha,
      lineas: lineasDesdeInventario(inv).filter((l) => l.cantidad > 0),
    };
  }

  const { rows: ultimos } = await pool.query(
    `SELECT id, fecha FROM cash_sessions
      WHERE register_id = $1 AND estado = 'CLOSED'
      ORDER BY fecha DESC, id DESC LIMIT 1`,
    [registerId]
  );
  if (ultimos.length === 0) return { estado: "SIN_JORNADAS", fecha: null, lineas: [] };

  // El neto: un cambio final deshecho al reabrir entra por IN y tiene que restar.
  const { rows } = await pool.query(
    `SELECT valor_unitario_centimos AS valor,
            SUM(CASE WHEN direccion = 'OUT' THEN cantidad ELSE -cantidad END)::int AS n
       FROM cash_denomination_movements
      WHERE session_id = $1 AND motivo = 'CLOSING_FLOAT'
      GROUP BY valor_unitario_centimos`,
    [ultimos[0].id]
  );
  return {
    estado: "CERRADA",
    fecha: fechaIso(ultimos[0].fecha),
    lineas: rows
      .map((r: { valor: string; n: number }) => ({ valor: Number(r.valor), cantidad: Number(r.n) }))
      .filter((l) => l.cantidad > 0)
      .sort((a, b) => b.valor - a.valor),
  };
}

export async function posicionDeCaja(
  empresaId: string,
  caja: { id: number; nombre: string; centro: string | null; centroId: string | null }
): Promise<PosicionCaja> {
  const [cajon, cierres, reposiciones, remanente] = await Promise.all([
    enCaja(caja.id),
    cierresPendientes(empresaId, caja.id),
    reposicionesPendientes(empresaId, caja.id),
    remanenteConPiezas(pool, caja.id),
  ]);
  const bolsa = await composicionPendiente(
    empresaId,
    caja.id,
    cierres.map((c) => c.sessionId)
  );

  const cierresCentimos = cierres.reduce((a, c) => a + c.importeCentimos, 0);
  const repuestoCentimos = reposiciones.reduce((a, r) => a + r.importeCentimos, 0);
  const pendiente = [...bolsa.billetes, ...bolsa.monedas].sort((a, b) => b.valor - a.valor);

  return {
    registerId: caja.id,
    nombre: caja.nombre,
    centro: caja.centro,
    centroId: caja.centroId,
    estado: cajon.estado,
    fecha: cajon.fecha,
    caja: cajon.lineas,
    cajaCentimos: valor(cajon.lineas),
    pendiente,
    pendienteCentimos: remanente.centimos + cierresCentimos - repuestoCentimos,
    cierresCentimos,
    numCierres: cierres.length,
    remanenteCentimos: remanente.centimos,
    repuestoCentimos,
    sinDesgloseCentimos: bolsa.sinDesgloseCentimos,
    faltan: bolsa.faltan,
  };
}

/** Todas las cajas activas que puede ver el usuario: su taller, o toda la empresa. */
export async function posicionGlobal(
  empresaId: string,
  centroId: string | null
): Promise<{ cajas: PosicionCaja[]; actualizadoMs: number }> {
  const { rows } = await pool.query(
    `SELECT id, nombre, centro, centro_id AS "centroId"
       FROM cash_registers
      WHERE empresa_id = $1 AND activa = true
        AND ($2::uuid IS NULL OR centro_id = $2)
      ORDER BY centro, nombre`,
    [empresaId, centroId]
  );
  const cajas = await Promise.all(
    rows.map((c: { id: number; nombre: string; centro: string | null; centroId: string | null }) =>
      posicionDeCaja(empresaId, c)
    )
  );
  return { cajas, actualizadoMs: Date.now() };
}

/** Varias cajas sumadas en una sola posición: la vista «todas las cajas». */
export function agregarPosicion(cajas: readonly PosicionCaja[]) {
  const sumarLineas = (f: (c: PosicionCaja) => readonly LineaDenominacion[]) => {
    const m = new Map<Centimos, number>();
    for (const c of cajas) for (const l of f(c)) m.set(l.valor, (m.get(l.valor) ?? 0) + l.cantidad);
    return m;
  };
  const suma = (f: (c: PosicionCaja) => number) => cajas.reduce((a, c) => a + f(c), 0);
  return {
    caja: sumarLineas((c) => c.caja),
    pendiente: sumarLineas((c) => c.pendiente),
    faltan: sumarLineas((c) => c.faltan),
    cajaCentimos: suma((c) => c.cajaCentimos),
    pendienteCentimos: suma((c) => c.pendienteCentimos),
    cierresCentimos: suma((c) => c.cierresCentimos),
    numCierres: suma((c) => c.numCierres),
    remanenteCentimos: suma((c) => c.remanenteCentimos),
    repuestoCentimos: suma((c) => c.repuestoCentimos),
    sinDesgloseCentimos: suma((c) => c.sinDesgloseCentimos),
    piezasPendienteCentimos: suma((c) => valor(c.pendiente)),
  };
}
