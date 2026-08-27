/**
 * Reclasifica el «ingreso bancario» de un cierre que en realidad era el CAMBIO.
 *
 * ── El caso real ──────────────────────────────────────────────────────────
 *
 * Al cerrar el 21/08 se tecleó el reparto al revés: los 350 € del fondo
 * salieron como «ingreso bancario» y el cambio quedó a cero. Consecuencias:
 *
 *  · La pantalla de Ingresos enseña 350 € «pendientes de ingresar» que no
 *    existen: ese dinero nunca salió del cajón.
 *  · El día siguiente amaneció sin fondo, porque hereda del cambio del
 *    cierre anterior, y ese cambio era cero.
 *
 * ── Qué hace ──────────────────────────────────────────────────────────────
 *
 * Convierte el ingreso de ese cierre en cambio final: mismos movimientos,
 * mismas piezas, motivo `BANK_DEPOSIT` → `CLOSING_FLOAT`; la operación pasa a
 * tipo CLOSING_FLOAT con número nuevo de la serie CI (el viejo queda escrito
 * en el concepto); y la jornada intercambia sus totales de cambio e ingreso.
 * **No toca ni una pieza ni un céntimo: cambia la etiqueta, no el dinero.**
 *
 * Por defecto NO cambia nada: enseña lo que haría.
 *
 *   npx tsx scripts/cash-reclasificar-cierre.ts --fecha 2026-08-21          # mirar
 *   npx tsx scripts/cash-reclasificar-cierre.ts --fecha 2026-08-21 --aplicar
 *   npx tsx scripts/cash-reclasificar-cierre.ts --sesion 42 --aplicar       # por id
 *
 * Se niega si el cierre ya forma parte de un ingreso bancario REGISTRADO
 * (`cash_bank_deposit_sessions` vigente): ahí el dinero sí se contó como ido
 * al banco y reclasificarlo descuadraría el ingreso. Primero se anula el
 * ingreso, luego se reclasifica.
 *
 * Reclasifica el ingreso ENTERO del cierre. Si solo una parte era cambio, no
 * sirve: ese caso se corrige reabriendo la jornada y cerrándola bien.
 *
 * ── Y avisa a MC Central ──────────────────────────────────────────────────
 *
 * Al reclasificar se emite un `SESSION_CLOSED` con los totales nuevos. Sin él,
 * la caja quedaba bien y Central se quedaba con la foto vieja: seguia
 * enseñando ese dinero como ido al banco. Y no es un sitio: el mismo campo
 * alimenta la columna «Al banco» de Jornadas, la posicion global y la lista de
 * «pendientes de ingresar», asi que un valor viejo envenena los tres.
 *
 * Central proyecta por version del agregado, y `emitirEvento` la sube, asi que
 * el evento correctivo gana al del cierre original en vez de descartarse por
 * tardio.
 *
 *   npx tsx scripts/cash-reclasificar-cierre.ts --sesion 42 --reemitir
 *
 * `--reemitir` no cambia ni un dato de la caja: vuelve a mandar a Central los
 * totales que la jornada tiene AHORA. Es la salida para las jornadas que se
 * reclasificaron antes de que este script emitiera el evento.
 */

import pool from "../server/db.ts";
import { emitirEvento } from "../server/cash/events/emitter.ts";

const APLICAR = process.argv.includes("--aplicar");
const REEMITIR = process.argv.includes("--reemitir");
const arg = (nombre: string): string | null => {
  const i = process.argv.indexOf(nombre);
  return i >= 0 ? process.argv[i + 1] : null;
};
const SESION = arg("--sesion") ? Number(arg("--sesion")) : null;
const FECHA = arg("--fecha");

const eur = (c: number) =>
  new Intl.NumberFormat("es-ES", { minimumFractionDigits: 2 }).format(c / 100);

async function main(): Promise<void> {
  if (!SESION && !FECHA) {
    console.log("Uso: --fecha AAAA-MM-DD  o  --sesion <id>   [--aplicar]");
    return;
  }

  /* eslint-disable @typescript-eslint/no-explicit-any */
  const { rows: sesiones } = await pool.query(
    `SELECT s.id, s.fecha::text AS fecha, s.estado,
            s.cambio_final_centimos, s.ingreso_bancario_centimos,
            s.diferencia_centimos, s.empresa_id, s.register_id, r.centro_id,
            r.codigo, COALESCE(r.centro || ' · ', '') || r.nombre AS caja,
            EXISTS (SELECT 1 FROM cash_bank_deposit_sessions l
                     WHERE l.session_id = s.id AND l.vigente) AS conciliado
       FROM cash_sessions s
       JOIN cash_registers r ON r.id = s.register_id
      WHERE ${SESION ? "s.id = $1" : "s.fecha = $1::date"}
      ORDER BY s.id`,
    [SESION ?? FECHA]
  );

  if (sesiones.length === 0) {
    console.log("No hay ninguna jornada con ese criterio.");
    return;
  }
  console.log(APLICAR ? "" : "── SIMULACIÓN, no se cambia nada ──");

  for (const s of sesiones as any[]) {
    const cab = `Jornada ${s.id} · ${s.fecha} · ${s.caja}`;
    const ingreso = Number(s.ingreso_bancario_centimos ?? 0);
    const cambio = Number(s.cambio_final_centimos ?? 0);

    if (s.estado !== "CLOSED") {
      console.log(`  ✗ ${cab}: no está cerrada (${s.estado}). Sin tocar.`);
      continue;
    }

    /*
     * Reemitir es otra cosa: no reclasifica nada, solo le vuelve a contar a
     * Central lo que la jornada dice AHORA. Va antes del guarda de abajo a
     * propósito, porque el caso que lo necesita es justo el de una jornada YA
     * reclasificada, que tiene el ingreso a cero.
     */
    if (REEMITIR) {
      console.log(
        `  ↻ ${cab}: reenviando a Central cambio ${eur(cambio)} €, ` +
          `ingreso ${eur(ingreso)} €.`
      );
      if (APLICAR) await avisarACentral(s, cambio, ingreso);
      continue;
    }

    if (ingreso <= 0) {
      console.log(`  ✗ ${cab}: su cierre no tiene ingreso que reclasificar. Sin tocar.`);
      continue;
    }
    if (s.conciliado) {
      console.log(
        `  ✗ ${cab}: ya forma parte de un ingreso bancario registrado. ` +
          `Anula ese ingreso primero. Sin tocar.`
      );
      continue;
    }

    console.log(
      `  ✓ ${cab}: ingreso ${eur(ingreso)} € → cambio final. ` +
        `Quedará: cambio ${eur(cambio + ingreso)} €, ingreso 0,00 €.`
    );
    if (APLICAR) await aplicar(s, s.codigo || "MC", ingreso, cambio);
  }
  /* eslint-enable @typescript-eslint/no-explicit-any */
}

/**
 * El aviso a Central: un `SESSION_CLOSED` con los totales que manda la caja.
 *
 * Se le pasa el cliente cuando forma parte de una reclasificación, para que el
 * evento entre en la MISMA transacción que el cambio de datos: es el patrón de
 * outbox transaccional que usa el resto del módulo, y lo que impide que la
 * caja quede reclasificada y el aviso se pierda por el camino.
 */
/* eslint-disable-next-line @typescript-eslint/no-explicit-any */
async function avisarACentral(s: any, cambio: number, ingreso: number, cliente?: any): Promise<void> {
  const propio = !cliente;
  const client = cliente ?? (await pool.connect());
  try {
    if (propio) await client.query("BEGIN");
    await emitirEvento(client, {
      empresaId: s.empresa_id,
      centroId: s.centro_id ?? null,
      registerId: Number(s.register_id),
      sessionId: Number(s.id),
      agregado: { tipo: "SESSION", id: Number(s.id) },
      tipo: "SESSION_CLOSED",
      ocurridoEnMs: Date.now(),
      actorUserId: null,
      datos: {
        fecha: s.fecha,
        cambioFinalCentimos: cambio,
        ingresoBancarioCentimos: ingreso,
        diferenciaCentimos: Number(s.diferencia_centimos ?? 0),
      },
    });
    if (propio) {
      await client.query("COMMIT");
      console.log("      Central avisada.");
    }
  } catch (e) {
    if (propio) await client.query("ROLLBACK");
    throw e;
  } finally {
    if (propio) client.release();
  }
}

/* eslint-disable-next-line @typescript-eslint/no-explicit-any */
async function aplicar(s: any, codigo: string, ingreso: number, cambio: number): Promise<void> {
  const sessionId = Number(s.id);
  const fecha = s.fecha as string;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const ahora = Date.now();

    // La operación del ingreso del cierre. Puede no existir si el cierre es
    // antiguo; los movimientos mandan igual.
    /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
    const { rows: ops } = await client.query<any>(
      `SELECT id, numero FROM cash_operations
        WHERE session_id = $1 AND tipo = 'BANK_DEPOSIT' AND estado = 'CONFIRMED'`,
      [sessionId]
    );

    for (const op of ops) {
      // Número nuevo de la serie del cambio final; el viejo queda escrito.
      const { rows: cont } = await client.query(
        `INSERT INTO cash_document_counters (clave, last_seq)
         VALUES ($1, 1)
         ON CONFLICT (clave) DO UPDATE SET last_seq = cash_document_counters.last_seq + 1
         RETURNING last_seq`,
        [`${codigo}:CI:${fecha.slice(0, 4)}`]
      );
      const numero = `${codigo}-CI-${fecha.slice(2, 4)}-${String(cont[0].last_seq).padStart(3, "0")}`;
      await client.query(
        `UPDATE cash_operations
            SET tipo = 'CLOSING_FLOAT', numero = $2,
                concepto = 'Cambio que queda en caja (reclasificado: se tecleó como ingreso bancario, era ' || numero || ')',
                updated_at_ms = $3
          WHERE id = $1`,
        [op.id, numero, ahora]
      );
      console.log(`      operación ${op.numero} → ${numero}`);
    }

    const { rowCount } = await client.query(
      `UPDATE cash_denomination_movements
          SET motivo = 'CLOSING_FLOAT'
        WHERE session_id = $1 AND motivo = 'BANK_DEPOSIT'`,
      [sessionId]
    );

    await client.query(
      `UPDATE cash_sessions
          SET cambio_final_centimos = $2, ingreso_bancario_centimos = 0,
              notas = COALESCE(NULLIF(notas, '') || ' · ', '') ||
                      'Reclasificado: el ingreso de ' || $3 || ' € del cierre era el cambio',
              updated_at_ms = $4
        WHERE id = $1`,
      [sessionId, cambio + ingreso, eur(ingreso), ahora]
    );

    /*
     * El aviso a Central va DENTRO de esta transacción, no después: si el
     * proceso se cae entre el UPDATE y el evento, la caja quedaría
     * reclasificada y Central enseñando el dinero como ido al banco, que es
     * exactamente el descuadre que este script viene a quitar.
     *
     * Los totales que se mandan son los de después: el ingreso pasa a cero y
     * el cambio se queda con todo.
     */
    await avisarACentral(s, cambio + ingreso, 0, client);

    await client.query("COMMIT");
    console.log(`      ${rowCount} movimiento(s) reclasificados. Central avisada.`);
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

main()
  .then(() => pool.end())
  .catch(async (e) => {
    console.error(e);
    await pool.end();
    process.exit(1);
  });
