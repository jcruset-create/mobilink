/**
 * Repara las jornadas cuyo saldo de ENVASES quedó en negativo.
 *
 * ── Qué pasó ──────────────────────────────────────────────────────────────
 *
 * Hasta la v1.8.25, el arqueo contaba tres cosas —sueltas, cartuchos y
 * bolsas— pero al libro mayor solo llegaban las PIEZAS. Si durante el día
 * alguien juntaba monedas sueltas y las precintaba, el arqueo lo veía y el
 * libro mayor seguía creyéndolas sueltas. Al cerrar, el reparto se validaba
 * contra el arqueo, así que dejaba salir ese envase y el saldo del libro mayor
 * se iba a -1.
 *
 * El DINERO nunca estuvo mal: las piezas y los importes cuadran. Lo que quedó
 * mal es el reparto entre suelto y envases.
 *
 * ── Qué hace este script ──────────────────────────────────────────────────
 *
 * Escribe el asiento que el cierre debería haber escrito: salen las monedas
 * sueltas y entra el envase con esas mismas monedas dentro. **Valor neto cero
 * y piezas netas cero** — no toca ni un céntimo, solo reclasifica el formato.
 *
 * Por defecto NO cambia nada: enseña lo que haría. Para aplicarlo de verdad
 * hay que pasarle `--aplicar`.
 *
 *   npx tsx scripts/cash-reparar-formato.ts                    # solo mirar
 *   npx tsx scripts/cash-reparar-formato.ts --sesion 42        # una jornada
 *   npx tsx scripts/cash-reparar-formato.ts --aplicar          # ejecutar
 *
 * Se niega a dejar un saldo peor del que había: si las monedas sueltas
 * apuntadas no dan para formar el envase que falta, lo dice y no toca esa
 * denominación. Ese caso ya no sería un problema de formato sino de piezas, y
 * eso no se arregla a ciegas desde un script.
 */

import pool from "../server/db.ts";

const APLICAR = process.argv.includes("--aplicar");
const SESION = (() => {
  const i = process.argv.indexOf("--sesion");
  return i >= 0 ? Number(process.argv[i + 1]) : null;
})();

const eur = (c: number) =>
  new Intl.NumberFormat("es-ES", { minimumFractionDigits: 2 }).format(c / 100);

type Saldo = {
  sessionId: number;
  fecha: string;
  caja: string;
  valor: number;
  etiqueta: string;
  denominationId: number;
  sueltas: number;
  cartuchos: number;
  bolsas: number;
  piezasPorCartucho: number | null;
  piezasPorBolsa: number | null;
};

async function main(): Promise<void> {
  const { rows } = await pool.query<Saldo>(
    `SELECT m.session_id                       AS "sessionId",
            s.fecha::text                      AS fecha,
            COALESCE(r.centro || ' · ', '') || r.nombre AS caja,
            m.valor_unitario_centimos          AS valor,
            d.etiqueta,
            d.id                               AS "denominationId",
            d.piezas_por_cartucho              AS "piezasPorCartucho",
            d.piezas_por_bolsa                 AS "piezasPorBolsa",
            SUM(CASE WHEN m.cartuchos = 0 AND m.bolsas = 0
                     THEN (CASE WHEN m.direccion = 'IN' THEN m.cantidad ELSE -m.cantidad END)
                     ELSE 0 END)::int          AS sueltas,
            SUM(CASE WHEN m.direccion = 'IN' THEN m.cartuchos ELSE -m.cartuchos END)::int AS cartuchos,
            SUM(CASE WHEN m.direccion = 'IN' THEN m.bolsas ELSE -m.bolsas END)::int       AS bolsas
       FROM cash_denomination_movements m
       JOIN cash_sessions   s ON s.id = m.session_id
       JOIN cash_registers  r ON r.id = s.register_id
       JOIN cash_denominations d ON d.valor_centimos = m.valor_unitario_centimos
      ${SESION ? "WHERE m.session_id = $1" : ""}
      GROUP BY m.session_id, s.fecha, r.centro, r.nombre,
               m.valor_unitario_centimos, d.etiqueta, d.id,
               d.piezas_por_cartucho, d.piezas_por_bolsa
      HAVING SUM(CASE WHEN m.direccion = 'IN' THEN m.cartuchos ELSE -m.cartuchos END) < 0
          OR SUM(CASE WHEN m.direccion = 'IN' THEN m.bolsas    ELSE -m.bolsas    END) < 0
      ORDER BY m.session_id, m.valor_unitario_centimos DESC`,
    SESION ? [SESION] : []
  );

  if (rows.length === 0) {
    console.log("No hay ninguna jornada con el saldo de envases en negativo.");
    return;
  }

  console.log(
    `${rows.length} denominación(es) con el saldo de envases en negativo.` +
      (APLICAR ? "" : "  ── SIMULACIÓN, no se cambia nada ──")
  );

  let arregladas = 0;
  let imposibles = 0;

  for (const f of rows) {
    const cabecera = `Jornada ${f.sessionId} · ${f.fecha} · ${f.caja} · ${f.etiqueta}`;

    for (const envase of ["cartuchos", "bolsas"] as const) {
      const faltan = -f[envase];
      if (faltan <= 0) continue;

      const porEnvase =
        envase === "cartuchos" ? f.piezasPorCartucho : f.piezasPorBolsa;
      if (!porEnvase || porEnvase <= 0) {
        console.log(
          `  ✗ ${cabecera}: faltan ${faltan} ${envase} pero la denominación ya no tiene ese formato configurado. Sin tocar.`
        );
        imposibles++;
        continue;
      }

      const piezas = faltan * porEnvase;
      if (f.sueltas < piezas) {
        console.log(
          `  ✗ ${cabecera}: para formar ${faltan} ${envase} hacen falta ${piezas} monedas sueltas y solo constan ${f.sueltas}. ` +
            `Esto ya no es un descuadre de formato sino de piezas. Sin tocar.`
        );
        imposibles++;
        continue;
      }

      console.log(
        `  ✓ ${cabecera}: ${f.sueltas} sueltas y ${f[envase]} ${envase} → ` +
          `precintar ${faltan} (${piezas} monedas, ${eur(piezas * f.valor)} €) → ` +
          `quedan ${f.sueltas - piezas} sueltas y ${f[envase] + faltan} ${envase}.`
      );

      if (APLICAR) {
        await aplicar(f, envase, faltan, piezas);
      }
      arregladas++;
    }
  }

  console.log(
    `\n${arregladas} corrección(es) ${APLICAR ? "aplicadas" : "por aplicar"}` +
      (imposibles > 0 ? `, ${imposibles} sin tocar (ver arriba).` : ".")
  );
  if (!APLICAR && arregladas > 0) {
    console.log("Vuelve a lanzarlo con --aplicar para ejecutarlas.");
  }
}

/**
 * Escribe el asiento, en una transacción y colgando de su propia operación de
 * ajuste para que quede rastro de quién lo tocó y por qué.
 */
async function aplicar(
  f: Saldo,
  envase: "cartuchos" | "bolsas",
  faltan: number,
  piezas: number
): Promise<void> {
  const motivo = envase === "cartuchos" ? "CARTRIDGE_FORMED" : "BAG_FORMED";
  const ahora = Date.now();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const { rows: ses } = await client.query(
      `SELECT empresa_id FROM cash_sessions WHERE id = $1`,
      [f.sessionId]
    );

    const { rows: cont } = await client.query(
      `INSERT INTO cash_document_counters (clave, last_seq)
       VALUES ($1, 1)
       ON CONFLICT (clave) DO UPDATE SET last_seq = cash_document_counters.last_seq + 1
       RETURNING last_seq`,
      [`REPARA:A:${f.fecha.slice(0, 4)}`]
    );
    const numero = `REPARA-A-${f.fecha.slice(2, 4)}-${String(cont[0].last_seq).padStart(3, "0")}`;

    const { rows: op } = await client.query(
      `INSERT INTO cash_operations
         (empresa_id, session_id, numero, tipo, origen, concepto,
          importe_centimos, efectivo_neto_centimos, estado, erp_sync_status,
          created_by, created_at_ms, updated_at_ms)
       VALUES ($1,$2,$3,'ADJUSTMENT','MANUAL',$4,$5,0,'CONFIRMED','NOT_APPLICABLE',
               NULL,$6,$6)
       RETURNING id`,
      [
        ses[0].empresa_id,
        f.sessionId,
        numero,
        `Corrección de formato: ${faltan} ${envase} de ${f.etiqueta} que el arqueo contó precintados`,
        piezas * f.valor,
        ahora,
      ]
    );
    const operationId = op[0].id;

    // Salen las monedas sueltas…
    await client.query(
      `INSERT INTO cash_denomination_movements
         (session_id, operation_id, denomination_id, valor_unitario_centimos,
          importe_centimos, direccion, motivo, cantidad, cartuchos, bolsas,
          created_by, created_at_ms)
       VALUES ($1,$2,$3,$4,$5,'OUT',$6,$7,0,0,NULL,$8)`,
      [f.sessionId, operationId, f.denominationId, f.valor, piezas * f.valor, motivo, piezas, ahora]
    );
    // …y entra el envase con esas mismas monedas dentro. Neto cero.
    await client.query(
      `INSERT INTO cash_denomination_movements
         (session_id, operation_id, denomination_id, valor_unitario_centimos,
          importe_centimos, direccion, motivo, cantidad, cartuchos, bolsas,
          created_by, created_at_ms)
       VALUES ($1,$2,$3,$4,$5,'IN',$6,$7,$8,$9,NULL,$10)`,
      [
        f.sessionId,
        operationId,
        f.denominationId,
        f.valor,
        piezas * f.valor,
        motivo,
        piezas,
        envase === "cartuchos" ? faltan : 0,
        envase === "bolsas" ? faltan : 0,
        ahora,
      ]
    );

    await client.query("COMMIT");
    console.log(`      asentado como ${numero}`);
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
