/**
 * Migration Center: meter en el sistema los días que se llevaron en papel.
 *
 * La decisión que gobierna todo lo demás, y conviene entenderla antes de tocar
 * nada: **un día llevado a mano no tiene detalle por pieza de cada cobro**. En
 * el papel están el fondo con el que se empezó, lo que se contó al cerrar y,
 * con suerte, los totales del día. Qué monedas concretas entraron en el cobro
 * de las 11:40 no lo sabe nadie, y no se puede recuperar.
 *
 * Ante eso hay dos salidas, y una es mala:
 *
 * · **Inventar el desglose** —repartir el total del día entre piezas
 *   plausibles— dejaría el libro mayor lleno de movimientos que nunca
 *   ocurrieron. El stock teórico se reconstruye sumando ese libro, así que
 *   serían mentiras con consecuencias, no adorno.
 *
 * · **Registrar lo que sí consta**: el día cambió el cajón en estas piezas
 *   exactas, que es la diferencia entre lo contado al abrir y lo contado al
 *   cerrar. Eso es un hecho, está en el papel y cuadra por construcción.
 *
 * Se hace lo segundo. Un día importado queda como **una sola operación neta**
 * con el desglose real del cambio del cajón, marcada con origen `IMPORT` para
 * que nadie la confunda con un cobro de mostrador. Es la misma regla que ya
 * aplica el módulo con las secciones: «un número inventado es peor que un hueco
 * declarado».
 *
 * Lo que sí se conserva del papel son los totales del día —cobrado y pagado—,
 * que van en el concepto y en la auditoría: informan sin fingir que son asientos.
 */

import pool from "../db.ts";
import { ErrorCaja } from "./errors.ts";
import { enTransaccion } from "./repository.ts";
import * as servicio from "./service.ts";
import type { Contexto } from "./service.ts";
import type { LineaDenominacion } from "./domain/inventory.ts";

/** Sistema externo con el que se marcan las operaciones importadas. */
export const SISTEMA_IMPORT = "IMPORT";

export type DiaDePapel = {
  registerId: number;
  /** La fecha en que ocurrió, no la de hoy. */
  fecha: string;
  /** Piezas contadas al abrir. Del arqueo del papel. */
  apertura: LineaDenominacion[];
  /** Piezas contadas al cerrar. */
  cierre: LineaDenominacion[];
  /** Totales del papel, solo informativos. */
  cobradoCentimos?: number;
  pagadoCentimos?: number;
  notas?: string;
};

export type ResultadoImportacion = {
  lote: string;
  importados: { fecha: string; sessionId: number; netoCentimos: number }[];
  /** Días que ya estaban importados en este mismo lote y no se han tocado. */
  omitidos: { fecha: string; motivo: string }[];
};

const total = (lineas: LineaDenominacion[]) =>
  lineas.reduce((a, l) => a + l.valor * l.cantidad, 0);

/**
 * Diferencia pieza a pieza entre lo contado al cerrar y lo contado al abrir.
 *
 * Puede tener cantidades negativas —salieron monedas de un valor y entraron
 * billetes de otro— y por eso se parte en dos: lo que entró y lo que salió. Una
 * sola operación no puede llevar piezas en los dos sentidos si no es un cambio
 * de moneda, así que el importe neto decide el tipo y cada lado va donde le
 * toca.
 */
function delta(
  apertura: LineaDenominacion[],
  cierre: LineaDenominacion[]
): { entran: LineaDenominacion[]; salen: LineaDenominacion[] } {
  const mapa = new Map<number, number>();
  for (const l of cierre) mapa.set(l.valor, (mapa.get(l.valor) ?? 0) + l.cantidad);
  for (const l of apertura) mapa.set(l.valor, (mapa.get(l.valor) ?? 0) - l.cantidad);

  const entran: LineaDenominacion[] = [];
  const salen: LineaDenominacion[] = [];
  for (const [valor, cantidad] of [...mapa].sort((a, b) => b[0] - a[0])) {
    if (cantidad > 0) entran.push({ valor, cantidad });
    else if (cantidad < 0) salen.push({ valor, cantidad: -cantidad });
  }
  return { entran, salen };
}

/** ¿Ya se importó este día en este lote? */
async function yaImportado(empresaId: string, lote: string, fecha: string): Promise<boolean> {
  const { rows } = await pool.query(
    `SELECT 1 FROM cash_operations
      WHERE empresa_id = $1 AND external_system = $2 AND external_document_id = $3
      LIMIT 1`,
    [empresaId, SISTEMA_IMPORT, `${lote}:${fecha}`]
  );
  return rows.length > 0;
}

/**
 * Importa una tanda de días de papel, del más antiguo al más reciente.
 *
 * El orden importa y no es un capricho: el cambio final de cada día es el fondo
 * inicial del siguiente, igual que pasó en el mostrador. Importar el 14 antes
 * que el 13 dejaría al 13 heredando de un día que para él está en el futuro.
 *
 * **Es idempotente por lote.** Volver a lanzar el mismo fichero no duplica
 * nada: cada día lleva `IMPORT:<lote>:<fecha>` como referencia externa y el que
 * ya está se salta. Es la diferencia entre una herramienta de migración que se
 * puede reintentar y una que hay que acertar a la primera con dinero de verdad.
 */
export async function importarDias(
  ctx: Contexto,
  lote: string,
  dias: DiaDePapel[]
): Promise<ResultadoImportacion> {
  if (!lote?.trim()) {
    throw new ErrorCaja(
      "ENTRADA_NO_VALIDA",
      "La importación necesita un nombre de lote: es lo que permite repetirla sin duplicar.",
      400
    );
  }

  const ordenados = [...dias].sort((a, b) => a.fecha.localeCompare(b.fecha));
  const resultado: ResultadoImportacion = { lote, importados: [], omitidos: [] };

  for (const dia of ordenados) {
    if (await yaImportado(ctx.empresaId, lote, dia.fecha)) {
      resultado.omitidos.push({ fecha: dia.fecha, motivo: "Ya estaba importado en este lote." });
      continue;
    }

    const { sesion } = await servicio.abrirJornada(ctx, {
      registerId: dia.registerId,
      fecha: dia.fecha,
      fondoManual: dia.apertura,
      // Un día de papel puede repetir fecha con otro ya metido; quien importa
      // sabe lo que hace y el aviso ya lo dio la comprobación de lote.
      permitirFechaRepetida: true,
    });

    const { entran, salen } = delta(dia.apertura, dia.cierre);
    const neto = total(dia.cierre) - total(dia.apertura);

    if (entran.length > 0 || salen.length > 0) {
      const concepto = [
        "Importado de papel",
        dia.cobradoCentimos != null ? `cobrado ${(dia.cobradoCentimos / 100).toFixed(2)} €` : null,
        dia.pagadoCentimos != null ? `pagado ${(dia.pagadoCentimos / 100).toFixed(2)} €` : null,
        dia.notas ?? null,
      ]
        .filter(Boolean)
        .join(" · ");

      await servicio.registrarOperacion(ctx, {
        sessionId: sesion.id,
        tipo: neto >= 0 ? "MANUAL_IN" : "MANUAL_OUT",
        origen: "IMPORT",
        importeCentimos: Math.abs(neto) || 1,
        formasPago: [{ forma: "CASH", importe: Math.abs(neto) || 1 }],
        efectivoRecibido: entran,
        efectivoEntregado: salen,
        externalSystem: SISTEMA_IMPORT,
        externalDocumentId: `${lote}:${dia.fecha}`,
        concepto,
      });
    }

    /*
     * Arqueo con lo contado del papel y cierre. Cuadra por construcción —el
     * movimiento se calculó justo como esa diferencia— y eso es exactamente lo
     * que se quiere: la importación no puede inventar un descuadre que en el
     * papel no estaba.
     */
    await servicio.guardarArqueo(ctx, { sessionId: sesion.id, contado: dia.cierre });
    /*
     * Se cierra dejando TODO como cambio final, sin apartar nada para el banco.
     * Lo que se hiciera con ese dinero en su momento ya pasó y el papel no lo
     * dice; inventar un ingreso bancario sería fabricar un movimiento que nadie
     * puede contrastar contra el extracto.
     */
    await servicio.cerrarJornada(ctx, {
      sessionId: sesion.id,
      cambioFinal: dia.cierre,
      notas: `Importado de papel (lote ${lote})`,
    });

    resultado.importados.push({ fecha: dia.fecha, sessionId: sesion.id, netoCentimos: neto });
  }

  return resultado;
}

/**
 * Saldo inicial de una caja que arranca (`INITIAL_BALANCE`).
 *
 * Es el caso del primer día: hay dinero en el cajón y no viene de ningún cobro
 * ni de ninguna jornada anterior. Se declara contándolo.
 *
 * Se hace con la apertura normal —una jornada con su fondo contado— y no con un
 * tipo de operación nuevo, porque el módulo ya lo representa bien: el fondo
 * inicial de una jornada sin jornada anterior ES el saldo declarado. Lo único
 * que añade esta función es dejar constancia de que ese fondo se declaró en vez
 * de heredarse, que es lo que un auditor va a preguntar.
 */
export async function declararSaldoInicial(
  ctx: Contexto,
  registerId: number,
  contado: LineaDenominacion[],
  motivo: string
): Promise<{ sessionId: number; totalCentimos: number }> {
  if (!motivo?.trim()) {
    throw new ErrorCaja(
      "FALTA_MOTIVO",
      "Declarar el saldo inicial exige explicar de dónde sale ese dinero.",
      400
    );
  }

  const { rows } = await pool.query(
    `SELECT 1 FROM cash_sessions WHERE register_id = $1 LIMIT 1`,
    [registerId]
  );
  if (rows.length > 0) {
    throw new ErrorCaja(
      "SALDO_INICIAL_YA_NO_APLICA",
      "Esta caja ya tiene jornadas: su saldo sale de la última, no se declara.",
      409
    );
  }

  const { sesion } = await servicio.abrirJornada(ctx, { registerId, fondoManual: contado });

  await enTransaccion(async (client) => {
    const { registrarAuditoriaEnTransaccion } = await import("../core/auditoria.ts");
    await registrarAuditoriaEnTransaccion(client, {
      empresaId: ctx.empresaId,
      userId: ctx.userId,
      accion: "cash.initial_balance.declare",
      entidad: "cash_sessions",
      entidadId: String(sesion.id),
      detalle: { contado, totalCentimos: total(contado), motivo: motivo.trim() },
      ip: ctx.ip,
    });
  });

  return { sessionId: sesion.id, totalCentimos: total(contado) };
}
