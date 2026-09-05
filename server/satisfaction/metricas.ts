/**
 * Las métricas de Satisfaction. Todo agregado en SQL.
 *
 * ── Separado de la bandeja a propósito ──────────────────────────────────────
 *
 * `calidad.ts` responde «qué casos tengo que mirar hoy» y devuelve filas.
 * Esto responde «cómo vamos» y devuelve números. Mezclarlos llevaría a calcular
 * medias recorriendo una lista paginada, que es exactamente el error que hace
 * que un panel funcione con cien respuestas y se caiga con cien mil.
 *
 * Aquí no se trae ni una respuesta entera: se piden AVG, COUNT y FILTER, y lo
 * que llega a Node ya son totales.
 *
 * ── Conductor y cliente NO se mezclan ───────────────────────────────────────
 *
 * Son dos poblaciones distintas que contestan formularios distintos sobre cosas
 * distintas: el conductor valora la asistencia que vivió, el cliente valora el
 * servicio que contrató. Una media conjunta no significa nada — sube o baja
 * según cuál de los dos haya contestado más ese mes.
 */

import pool from "../db.ts";

/* ── Tipos ───────────────────────────────────────────────────────────────── */

export type Filtros = {
  desdeMs: number;
  hastaMs: number;
  clienteId?: number | null;
  proveedorTallerId?: number | null;
};

/**
 * Una media con su tamaño de muestra.
 *
 * `media` es `null` cuando no hay respuestas, y eso NO es lo mismo que cero:
 * una media de cero estrellas no existe —la escala empieza en 1— así que
 * pintar «0,0 ★» donde no hay datos sería inventar un dato malísimo.
 */
export type Media = { media: number | null; respuestas: number };

export type Distribucion = { estrella: number; n: number; pct: number }[];

export type MetricasRol = {
  overall: Media;
  professional: Media | null;
  speed: Media | null;
  tracking: Media | null;
  resolucion: { si: number; parcial: number; no: number; siPct: number | null;
                parcialPct: number | null; noPct: number | null };
  negativasPct: number | null;
  conComentario: number;
  distribucion: Distribucion;
};

export type PuntoTendencia = {
  desdeMs: number;
  driver: Media;
  customer: Media;
  casos: number;
  criticos: number;
};

export type MetricasCalidad = {
  creados: number; abiertos: number; resueltos: number; cerrados: number;
  criticos: number; altos: number;
  porMotivo: { motivo: string; n: number }[];
  porResolucion: { resolution: string; n: number }[];
  porAccion: { actionTaken: string; n: number }[];
  danos: { alegados: number; confirmados: number; descartados: number; sinCerrar: number };
  tiempos: { hastaResolverMs: number | null; hastaCerrarMs: number | null;
             resueltos: number; cerrados: number };
  porCada100Respuestas: number | null;
  porCada100Asistencias: number | null;
};

export type FilaProveedor = {
  proveedorId: number | null; nombre: string | null;
  asistencias: number; respuestasDriver: number; satisfaccionDriver: number | null;
  resolucionSiPct: number | null; casos: number; criticos: number;
  casosPor100: number | null; suficiente: boolean;
};

export type FilaCliente = {
  clienteId: number | null; nombre: string | null;
  asistencias: number;
  respuestasCustomer: number; satisfaccionCustomer: number | null;
  respuestasDriver: number; satisfaccionDriver: number | null;
  casos: number; casosPor100: number | null;
};

export type Metricas = {
  periodo: { desdeMs: number; hastaMs: number; dias: number };
  resumen: {
    asistenciasFinalizadas: number;
    encuestasGeneradas: number;
    respuestas: number;
    /** `null` mientras no haya envíos reales. Ver `envio`. */
    tasaRespuestaPct: number | null;
    envio: { hayEntregas: boolean; entregadas: number; motivo: string | null };
    casosAbiertos: number;
    casosCriticos: number;
  };
  driver: MetricasRol;
  customer: MetricasRol;
  calidad: MetricasCalidad;
  motivosNegativos: { motivo: string; n: number; pctSobreRespuestas: number | null }[];
  tendencia: { granularidad: "dia" | "semana" | "mes"; puntos: PuntoTendencia[] };
  proveedores: FilaProveedor[];
  clientes: FilaCliente[];
  franjas: { franja: string; asistencias: number; driver: Media }[];
  /** Lo que NO se puede segmentar y por qué. La pantalla lo enseña. */
  limitaciones: string[];
};

/* ── Ayudas ──────────────────────────────────────────────────────────────── */

const DIA = 86_400_000;

/** Mínimo de respuestas para entrar en el ranking principal de proveedores. */
export const MINIMO_RESPUESTAS_RANKING = 5;

const num = (v: unknown): number => Number(v ?? 0);
const medioONulo = (media: unknown, n: unknown): Media => {
  const respuestas = num(n);
  return { media: respuestas > 0 && media != null ? Number(Number(media).toFixed(2)) : null, respuestas };
};
const pct = (parte: number, total: number): number | null =>
  total > 0 ? Number(((parte / total) * 100).toFixed(1)) : null;

/**
 * Los estados de encuesta que cuentan como «generada de verdad».
 *
 * `CANCELLED` queda fuera: una encuesta anulada no es una que nadie contestó,
 * es una que no debía existir, y meterla en el denominador hundiría la tasa por
 * un motivo administrativo.
 */
const GENERADAS = ["CREATED", "QUEUED", "SENT", "DELIVERED", "STARTED", "COMPLETED", "EXPIRED", "FAILED"];

/** Los estados en los que un expediente sigue vivo. */
const ABIERTOS = ["NEW", "IN_REVIEW", "PENDING_PROVIDER", "PENDING_CUSTOMER"];

/**
 * El filtro común de asistencias. Se repite en varias consultas y tiene que
 * decir siempre lo mismo, así que se construye en un sitio.
 */
function filtroAsistencia(f: Filtros, tenantId: string | null, desde = 1) {
  const cond: string[] = [`a."finishedAtMs" IS NOT NULL`,
                          `a."finishedAtMs" >= $${desde}`, `a."finishedAtMs" <= $${desde + 1}`];
  const args: unknown[] = [f.desdeMs, f.hastaMs];
  if (tenantId != null) { args.push(tenantId); cond.push(`a."tallerId"::text = $${desde + args.length - 1}`); }
  if (f.clienteId) { args.push(f.clienteId); cond.push(`a."clienteFacturacionId" = $${desde + args.length - 1}`); }
  if (f.proveedorTallerId) { args.push(f.proveedorTallerId); cond.push(`a."proveedorTallerId" = $${desde + args.length - 1}`); }
  return { sql: cond.join(" AND "), args };
}

/* ── Métricas por rol ────────────────────────────────────────────────────── */

/**
 * Todo lo de un destinatario en una sola consulta.
 *
 * Los `FILTER (WHERE …)` son lo que permite sacar media, distribución y
 * porcentajes de resolución de una pasada. Con subconsultas separadas serían
 * ocho recorridos de la misma tabla.
 *
 * La fecha que manda es `completedAtMs`: interesa cuándo contestó, no cuándo se
 * creó la encuesta. Una respuesta de hoy a una encuesta del mes pasado cuenta
 * en el mes de hoy, que es cuando se supo lo que opinaba.
 */
async function metricasDeRol(
  rol: "DRIVER" | "CUSTOMER", f: Filtros, tenantId: string | null,
): Promise<MetricasRol> {
  const cond: string[] = [`i."recipientRole" = $1`, `r."completedAtMs" >= $2`, `r."completedAtMs" <= $3`];
  const args: unknown[] = [rol, f.desdeMs, f.hastaMs];
  const mas = (sql: string, v: unknown) => { args.push(v); cond.push(sql.replace("?", `$${args.length}`)); };
  if (tenantId != null) mas(`i."tenantId" = ?`, tenantId);
  if (f.clienteId) mas(`a."clienteFacturacionId" = ?`, f.clienteId);
  if (f.proveedorTallerId) mas(`a."proveedorTallerId" = ?`, f.proveedorTallerId);

  const q = await pool.query(
    `WITH resp AS (
       SELECT r.id,
              MAX(x."scaleValue") FILTER (WHERE x."questionCode" = 'overall_rating')      AS overall,
              MAX(x."scaleValue") FILTER (WHERE x."questionCode" = 'professional_rating') AS professional,
              MAX(x."scaleValue") FILTER (WHERE x."questionCode" = 'speed_rating')        AS speed,
              MAX(x."scaleValue") FILTER (WHERE x."questionCode" = 'tracking_rating')     AS tracking,
              MAX(x.value)        FILTER (WHERE x."questionCode" = 'resolution')          AS resolution,
              BOOL_OR(x."questionCode" = 'comment' AND x.value <> '')                     AS "conComentario"
         FROM survey_responses r
         JOIN survey_instances i ON i.id = r."surveyInstanceId"
         LEFT JOIN roadside_assistances a ON a.id = i."assistanceId"::integer
         JOIN survey_answers x ON x."surveyResponseId" = r.id
        WHERE ${cond.join(" AND ")}
        GROUP BY r.id
     )
     SELECT COUNT(*)::int AS n,
            AVG(overall)      AS "avgOverall",      COUNT(overall)::int      AS "nOverall",
            AVG(professional) AS "avgProfessional", COUNT(professional)::int AS "nProfessional",
            AVG(speed)        AS "avgSpeed",        COUNT(speed)::int        AS "nSpeed",
            AVG(tracking)     AS "avgTracking",     COUNT(tracking)::int     AS "nTracking",
            COUNT(*) FILTER (WHERE resolution = 'YES')::int     AS "resSi",
            COUNT(*) FILTER (WHERE resolution = 'PARTIAL')::int AS "resParcial",
            COUNT(*) FILTER (WHERE resolution = 'NO')::int      AS "resNo",
            COUNT(*) FILTER (WHERE overall <= 2 OR resolution = 'NO')::int AS negativas,
            COUNT(*) FILTER (WHERE "conComentario")::int AS "conComentario",
            COUNT(*) FILTER (WHERE overall = 1)::int AS e1,
            COUNT(*) FILTER (WHERE overall = 2)::int AS e2,
            COUNT(*) FILTER (WHERE overall = 3)::int AS e3,
            COUNT(*) FILTER (WHERE overall = 4)::int AS e4,
            COUNT(*) FILTER (WHERE overall = 5)::int AS e5
       FROM resp`,
    args,
  );
  const r = q.rows[0];
  const total = num(r.n);
  const nOverall = num(r.nOverall);

  return {
    overall: medioONulo(r.avgOverall, r.nOverall),
    professional: rol === "DRIVER" ? medioONulo(r.avgProfessional, r.nProfessional) : null,
    speed: rol === "CUSTOMER" ? medioONulo(r.avgSpeed, r.nSpeed) : null,
    tracking: rol === "CUSTOMER" ? medioONulo(r.avgTracking, r.nTracking) : null,
    resolucion: {
      si: num(r.resSi), parcial: num(r.resParcial), no: num(r.resNo),
      siPct: pct(num(r.resSi), total),
      parcialPct: pct(num(r.resParcial), total),
      noPct: pct(num(r.resNo), total),
    },
    // «Negativa» es nota <= 2 O resolución NO. Tener comentario NO cuenta:
    // mucha gente escribe para dar las gracias.
    negativasPct: pct(num(r.negativas), total),
    conComentario: num(r.conComentario),
    distribucion: [1, 2, 3, 4, 5].map((e) => {
      const n = num(r[`e${e}`]);
      return { estrella: e, n, pct: pct(n, nOverall) ?? 0 };
    }),
  };
}

/* ── Calidad ─────────────────────────────────────────────────────────────── */

async function metricasDeCalidad(
  f: Filtros, tenantId: string | null, respuestas: number, asistencias: number,
): Promise<MetricasCalidad> {
  const cond: string[] = [`q."sourceSystem" = 'assist'`,
                          `q."createdAtMs" >= $1`, `q."createdAtMs" <= $2`];
  const args: unknown[] = [f.desdeMs, f.hastaMs];
  const mas = (sql: string, v: unknown) => { args.push(v); cond.push(sql.replace("?", `$${args.length}`)); };
  if (tenantId != null) mas(`q."tenantId" = ?`, tenantId);
  if (f.clienteId) mas(`a."clienteFacturacionId" = ?`, f.clienteId);
  if (f.proveedorTallerId) mas(`a."proveedorTallerId" = ?`, f.proveedorTallerId);

  const DE = `FROM quality_cases q
              LEFT JOIN roadside_assistances a ON a.id = q."assistanceId"::integer
              WHERE ${cond.join(" AND ")}`;

  const g = await pool.query(
    `SELECT COUNT(*)::int AS creados,
            COUNT(*) FILTER (WHERE q.status = ANY($${args.length + 1}))::int AS abiertos,
            COUNT(*) FILTER (WHERE q.status = 'RESOLVED')::int AS resueltos,
            COUNT(*) FILTER (WHERE q.status = 'CLOSED')::int   AS cerrados,
            COUNT(*) FILTER (WHERE q.priority = 'CRITICAL')::int AS criticos,
            COUNT(*) FILTER (WHERE q.priority = 'HIGH')::int     AS altos,
            /*
             * Daños ALEGADOS vs lo que se comprobó. Son tres cifras distintas y
             * confundirlas convertiría una queja en un veredicto: el motivo lo
             * pone quien responde, la confirmación la pone el supervisor al
             * cerrar el caso.
             */
            COUNT(*) FILTER (WHERE q.reason = 'VEHICLE_DAMAGE')::int AS "danosAlegados",
            COUNT(*) FILTER (WHERE q.resolution = 'DAMAGE_CONFIRMED')::int AS "danosConfirmados",
            COUNT(*) FILTER (WHERE q.resolution = 'DAMAGE_NOT_CONFIRMED')::int AS "danosDescartados",
            COUNT(*) FILTER (WHERE q.reason = 'VEHICLE_DAMAGE' AND q.resolution IS NULL)::int AS "danosSinCerrar",
            /* Solo los que YA se resolvieron: un caso abierto no dura cero. */
            AVG(q."resolvedAtMs" - q."createdAtMs") FILTER (WHERE q."resolvedAtMs" IS NOT NULL) AS "hastaResolver",
            COUNT(*) FILTER (WHERE q."resolvedAtMs" IS NOT NULL)::int AS "nResueltos",
            AVG(q."closedAtMs" - q."createdAtMs") FILTER (WHERE q."closedAtMs" IS NOT NULL) AS "hastaCerrar",
            COUNT(*) FILTER (WHERE q."closedAtMs" IS NOT NULL)::int AS "nCerrados"
     ${DE}`,
    [...args, ABIERTOS],
  );

  const porMotivo = await pool.query(
    `SELECT q.reason AS motivo, COUNT(*)::int AS n ${DE} GROUP BY q.reason ORDER BY n DESC`, args);
  const porResolucion = await pool.query(
    `SELECT q.resolution, COUNT(*)::int AS n ${DE} AND q.resolution IS NOT NULL
      GROUP BY q.resolution ORDER BY n DESC`, args);
  const porAccion = await pool.query(
    `SELECT q."actionTaken", COUNT(*)::int AS n ${DE} AND q."actionTaken" IS NOT NULL
      GROUP BY q."actionTaken" ORDER BY n DESC`, args);

  const r = g.rows[0];
  const creados = num(r.creados);

  return {
    creados, abiertos: num(r.abiertos), resueltos: num(r.resueltos), cerrados: num(r.cerrados),
    criticos: num(r.criticos), altos: num(r.altos),
    porMotivo: porMotivo.rows.map((x) => ({ motivo: String(x.motivo), n: num(x.n) })),
    porResolucion: porResolucion.rows.map((x) => ({ resolution: String(x.resolution), n: num(x.n) })),
    porAccion: porAccion.rows.map((x) => ({ actionTaken: String(x.actionTaken), n: num(x.n) })),
    danos: {
      alegados: num(r.danosAlegados), confirmados: num(r.danosConfirmados),
      descartados: num(r.danosDescartados), sinCerrar: num(r.danosSinCerrar),
    },
    tiempos: {
      hastaResolverMs: r.hastaResolver == null ? null : Math.round(Number(r.hastaResolver)),
      hastaCerrarMs: r.hastaCerrar == null ? null : Math.round(Number(r.hastaCerrar)),
      resueltos: num(r.nResueltos), cerrados: num(r.nCerrados),
    },
    /*
     * Normalizado, porque el número bruto no compara nada: un proveedor con 500
     * servicios tendrá más casos que uno con 20 aunque trabaje mejor.
     */
    porCada100Respuestas: respuestas > 0 ? Number(((creados / respuestas) * 100).toFixed(1)) : null,
    porCada100Asistencias: asistencias > 0 ? Number(((creados / asistencias) * 100).toFixed(1)) : null,
  };
}

/* ── Todo junto ──────────────────────────────────────────────────────────── */

export async function calcularMetricas(
  f: Filtros, tenantId: string | null,
): Promise<Metricas> {
  const dias = Math.max(1, Math.round((f.hastaMs - f.desdeMs) / DIA));
  const asis = filtroAsistencia(f, tenantId);

  const [asistencias, encuestas, entregas] = await Promise.all([
    pool.query(`SELECT COUNT(*)::int AS n FROM roadside_assistances a WHERE ${asis.sql}`, asis.args),
    pool.query(
      `SELECT COUNT(*)::int AS generadas,
              COUNT(*) FILTER (WHERE i.status = 'COMPLETED')::int AS respondidas
         FROM survey_instances i
         LEFT JOIN roadside_assistances a ON a.id = i."assistanceId"::integer
        WHERE i.status = ANY($1)
          AND i."createdAtMs" >= $2 AND i."createdAtMs" <= $3
          AND ($4::text IS NULL OR i."tenantId" = $4)
          AND ($5::int IS NULL OR a."clienteFacturacionId" = $5)
          AND ($6::int IS NULL OR a."proveedorTallerId" = $6)`,
      [GENERADAS, f.desdeMs, f.hastaMs, tenantId, f.clienteId ?? null, f.proveedorTallerId ?? null],
    ),
    /*
     * ── La tasa de respuesta, sobre envíos REALES (1G) ──────────────────
     *
     * El denominador NO son las encuestas generadas: son las que salieron de
     * verdad, o sea aquellas cuyo mensaje INICIAL aceptó el proveedor. Quedan
     * fuera a propósito:
     *
     *  · `SKIPPED` — no se intentó, faltaba la plantilla. Contarlas hundiría la
     *    tasa por un problema de configuración que no tiene que ver con si la
     *    gente contesta.
     *  · `FAILED` y `UNKNOWN` — nunca se supo que llegaran a mandarse.
     *  · `QUEUED` y `CANCELLED` — ni siquiera se intentaron.
     *  · Los `REMINDER` — un recordatorio no es otra encuesta. Contarlo
     *    duplicaría el denominador de quien no contestó a la primera, que es
     *    justo a quien se le manda.
     *
     * Y mientras no exista ni un envío aceptado, la tasa sale `null`: las
     * respuestas que haya vienen de abrir el enlace a mano para probar, y un
     * 100 % ahí no mide la eficacia de nada.
     */
    pool.query(
      `SELECT COUNT(DISTINCT i.id)::int AS generadas,
              COUNT(DISTINCT i.id) FILTER (WHERE i.status = 'COMPLETED')::int AS respondidas
         FROM survey_deliveries d
         JOIN survey_instances i ON i.id = d."surveyInstanceId"
         LEFT JOIN roadside_assistances a ON a.id = i."assistanceId"::integer
        WHERE d."messageType" = 'INITIAL'
          AND d.status IN ('SENT','DELIVERED','READ')
          AND i."createdAtMs" >= $1 AND i."createdAtMs" <= $2
          AND ($3::text IS NULL OR i."tenantId" = $3)
          AND ($4::int IS NULL OR a."clienteFacturacionId" = $4)
          AND ($5::int IS NULL OR a."proveedorTallerId" = $5)`,
      [f.desdeMs, f.hastaMs, tenantId, f.clienteId ?? null, f.proveedorTallerId ?? null],
    ),
  ]);

  const nAsistencias = num(asistencias.rows[0].n);
  const generadas = num(encuestas.rows[0].generadas);
  const respondidas = num(encuestas.rows[0].respondidas);
  // Lo que salió de verdad, y de eso cuántas se contestaron.
  const entregadas = num(entregas.rows[0].generadas);
  const respondidasDeEnviadas = num(entregas.rows[0].respondidas);
  const hayEntregas = entregadas > 0;

  const [driver, customer] = await Promise.all([
    metricasDeRol("DRIVER", f, tenantId),
    metricasDeRol("CUSTOMER", f, tenantId),
  ]);
  const respuestas = driver.overall.respuestas + customer.overall.respuestas;

  const [calidad, motivosNegativos, tendencia, proveedores, clientes, franjas] = await Promise.all([
    metricasDeCalidad(f, tenantId, respuestas, nAsistencias),
    agregarMotivos(f, tenantId, respuestas),
    calcularTendencia(f, tenantId, dias),
    metricasPorProveedor(f, tenantId),
    metricasPorCliente(f, tenantId),
    metricasPorFranja(f, tenantId),
  ]);

  return {
    periodo: { desdeMs: f.desdeMs, hastaMs: f.hastaMs, dias },
    resumen: {
      asistenciasFinalizadas: nAsistencias,
      encuestasGeneradas: generadas,
      respuestas: respondidas,
      // Contestadas ENTRE LAS ENVIADAS, no entre las generadas.
      tasaRespuestaPct: hayEntregas ? pct(respondidasDeEnviadas, entregadas) : null,
      envio: {
        hayEntregas, entregadas,
        motivo: hayEntregas ? null
          : "Todavía no ha salido ninguna encuesta: las respuestas que haya vienen de accesos manuales.",
      },
      casosAbiertos: calidad.abiertos,
      casosCriticos: calidad.criticos,
    },
    driver, customer, calidad, motivosNegativos, tendencia, proveedores, clientes, franjas,
    limitaciones: LIMITACIONES,
  };
}

/**
 * Lo que este panel NO puede segmentar, dicho en la propia respuesta.
 *
 * Se devuelve desde el servidor y no se escribe en la pantalla porque el motivo
 * es del modelo de datos: el día que existan los campos, desaparecen de aquí y
 * la pantalla deja de avisar sola.
 */
const LIMITACIONES = [
  "No hay segmentación por tipo de asistencia: la avería se guarda como texto libre " +
  "(«descripcionAveria») y no existe ninguna categoría normalizada que agrupar.",
  "No hay segmentación geográfica: la dirección también es texto libre y no hay " +
  "provincia ni zona operativa. Deducirla de las coordenadas daría datos que parecen " +
  "fiables sin serlo.",
];

/* ── Motivos negativos ───────────────────────────────────────────────────── */

/**
 * Cuenta cada motivo por separado.
 *
 * Es selección múltiple, así que **la suma de porcentajes puede pasar del
 * 100 %**: quien marca «tardaron» y «trato» cuenta en los dos. El porcentaje es
 * sobre respuestas, no sobre motivos marcados, que es lo que se quiere saber
 * —«en cuántas valoraciones aparece esto»—.
 */
async function agregarMotivos(
  f: Filtros, tenantId: string | null, respuestas: number,
): Promise<{ motivo: string; n: number; pctSobreRespuestas: number | null }[]> {
  const q = await pool.query(
    `SELECT m.motivo, COUNT(*)::int AS n
       FROM survey_responses r
       JOIN survey_instances i ON i.id = r."surveyInstanceId"
       LEFT JOIN roadside_assistances a ON a.id = i."assistanceId"::integer
       JOIN survey_answers x ON x."surveyResponseId" = r.id AND x."questionCode" = 'negative_reasons'
       CROSS JOIN LATERAL jsonb_array_elements_text(x.value::jsonb) AS m(motivo)
      WHERE r."completedAtMs" >= $1 AND r."completedAtMs" <= $2
        AND ($3::text IS NULL OR i."tenantId" = $3)
        AND ($4::int IS NULL OR a."clienteFacturacionId" = $4)
        AND ($5::int IS NULL OR a."proveedorTallerId" = $5)
      GROUP BY m.motivo ORDER BY n DESC`,
    [f.desdeMs, f.hastaMs, tenantId, f.clienteId ?? null, f.proveedorTallerId ?? null],
  );
  return q.rows.map((r) => ({
    motivo: String(r.motivo), n: num(r.n), pctSobreRespuestas: pct(num(r.n), respuestas),
  }));
}

/* ── Tendencia ───────────────────────────────────────────────────────────── */

/**
 * La evolución, con el grano que corresponda al periodo.
 *
 * Día hasta 45 días, semana hasta 400, mes por encima. Sin esto, un año pedido
 * por día son 365 puntos que no caben en una gráfica y que nadie puede leer.
 * El agrupado va en SQL: traer las respuestas para agruparlas en Node sería
 * justo lo que este módulo evita.
 */
async function calcularTendencia(
  f: Filtros, tenantId: string | null, dias: number,
): Promise<{ granularidad: "dia" | "semana" | "mes"; puntos: PuntoTendencia[] }> {
  const granularidad: "dia" | "semana" | "mes" = dias <= 45 ? "dia" : dias <= 400 ? "semana" : "mes";
  const trunc = granularidad === "dia" ? "day" : granularidad === "semana" ? "week" : "month";

  const bucket = (col: string) =>
    `(EXTRACT(EPOCH FROM date_trunc('${trunc}', to_timestamp(${col} / 1000.0))) * 1000)::bigint`;

  const encuestas = await pool.query(
    `SELECT ${bucket('r."completedAtMs"')} AS b,
            AVG(x."scaleValue") FILTER (WHERE i."recipientRole" = 'DRIVER')   AS "avgDriver",
            COUNT(*)            FILTER (WHERE i."recipientRole" = 'DRIVER')::int   AS "nDriver",
            AVG(x."scaleValue") FILTER (WHERE i."recipientRole" = 'CUSTOMER') AS "avgCustomer",
            COUNT(*)            FILTER (WHERE i."recipientRole" = 'CUSTOMER')::int AS "nCustomer"
       FROM survey_responses r
       JOIN survey_instances i ON i.id = r."surveyInstanceId"
       JOIN survey_answers x ON x."surveyResponseId" = r.id AND x."questionCode" = 'overall_rating'
      WHERE r."completedAtMs" >= $1 AND r."completedAtMs" <= $2
        AND ($3::text IS NULL OR i."tenantId" = $3)
      GROUP BY b ORDER BY b`,
    [f.desdeMs, f.hastaMs, tenantId],
  );

  const casos = await pool.query(
    `SELECT ${bucket('q."createdAtMs"')} AS b,
            COUNT(*)::int AS n,
            COUNT(*) FILTER (WHERE q.priority = 'CRITICAL')::int AS criticos
       FROM quality_cases q
      WHERE q."sourceSystem" = 'assist'
        AND q."createdAtMs" >= $1 AND q."createdAtMs" <= $2
        AND ($3::text IS NULL OR q."tenantId" = $3)
      GROUP BY b ORDER BY b`,
    [f.desdeMs, f.hastaMs, tenantId],
  );

  const porCubo = new Map<number, PuntoTendencia>();
  const tomar = (b: number) => {
    if (!porCubo.has(b)) {
      porCubo.set(b, {
        desdeMs: b, driver: { media: null, respuestas: 0 },
        customer: { media: null, respuestas: 0 }, casos: 0, criticos: 0,
      });
    }
    return porCubo.get(b)!;
  };

  for (const r of encuestas.rows) {
    const p = tomar(Number(r.b));
    p.driver = medioONulo(r.avgDriver, r.nDriver);
    p.customer = medioONulo(r.avgCustomer, r.nCustomer);
  }
  for (const r of casos.rows) {
    const p = tomar(Number(r.b));
    p.casos = num(r.n);
    p.criticos = num(r.criticos);
  }

  return {
    granularidad,
    puntos: [...porCubo.values()].sort((a, b) => a.desdeMs - b.desdeMs),
  };
}

/* ── Proveedores ─────────────────────────────────────────────────────────── */

/**
 * Un proveedor por fila, con TODO en una consulta.
 *
 * ── Lo que no se le atribuye ────────────────────────────────────────────────
 *
 * Solo la satisfacción del CONDUCTOR. El cliente valora el servicio de Mobilink
 * —la gestión, la información, la rapidez con la que se le atendió— y buena
 * parte de eso no depende del taller que fue. Colgarle al proveedor una mala
 * nota del cliente sería medirle por algo que no hizo.
 *
 * ── Y el volumen va siempre al lado ─────────────────────────────────────────
 *
 * Un 4,9 con siete respuestas no es mejor que un 4,4 con doscientas. Se marca
 * `suficiente` a partir de cinco respuestas para que la pantalla pueda separar
 * el ranking de lo que aún no tiene muestra, en vez de ordenar por una media
 * que se mueve con un solo voto.
 */
async function metricasPorProveedor(f: Filtros, tenantId: string | null): Promise<FilaProveedor[]> {
  const q = await pool.query(
    `WITH asis AS (
       SELECT a.id, a."proveedorTallerId"
         FROM roadside_assistances a
        WHERE a."finishedAtMs" IS NOT NULL
          AND a."finishedAtMs" >= $1 AND a."finishedAtMs" <= $2
          AND ($3::text IS NULL OR a."tallerId"::text = $3)
          AND ($4::int IS NULL OR a."clienteFacturacionId" = $4)
     ),
     respuestas AS (
       SELECT s.id AS asistencia,
              x."scaleValue" AS overall,
              (SELECT y.value FROM survey_answers y
                WHERE y."surveyResponseId" = r.id AND y."questionCode" = 'resolution') AS resolution
         FROM asis s
         JOIN survey_instances i ON i."assistanceId" = s.id::text AND i."recipientRole" = 'DRIVER'
         JOIN survey_responses r ON r."surveyInstanceId" = i.id
         JOIN survey_answers x ON x."surveyResponseId" = r.id AND x."questionCode" = 'overall_rating'
     ),
     casos AS (
       SELECT s.id AS asistencia, q.priority
         FROM asis s JOIN quality_cases q ON q."assistanceId" = s.id::text
     ),
     /*
      * Se agrega POR ASISTENCIA antes de juntar las dos ramas.
      *
      * Sin esto, una asistencia con una respuesta y dos expedientes saldría con
      * la respuesta contada dos veces —el producto cartesiano de los dos LEFT
      * JOIN— y la media del proveedor quedaría ponderada por el número de
      * quejas. Se suman valores y se cuentan aparte para que la media final
      * siga siendo por respuesta y no una media de medias.
      */
     resp_por_asis AS (
       SELECT asistencia, SUM(overall)::numeric AS suma, COUNT(overall)::int AS n,
              COUNT(*) FILTER (WHERE resolution = 'YES')::int AS "resSi",
              COUNT(resolution)::int AS "resTotal"
         FROM respuestas GROUP BY asistencia
     ),
     casos_por_asis AS (
       SELECT asistencia, COUNT(*)::int AS n,
              COUNT(*) FILTER (WHERE priority = 'CRITICAL')::int AS criticos
         FROM casos GROUP BY asistencia
     )
     SELECT s."proveedorTallerId" AS "proveedorId", w.name AS nombre,
            COUNT(DISTINCT s.id)::int AS asistencias,
            COALESCE(SUM(rp.n), 0)::int AS "respuestasDriver",
            CASE WHEN COALESCE(SUM(rp.n), 0) > 0
                 THEN SUM(rp.suma) / SUM(rp.n) END AS "satisfaccionDriver",
            COALESCE(SUM(rp."resSi"), 0)::int AS "resSi",
            COALESCE(SUM(rp."resTotal"), 0)::int AS "resTotal",
            COALESCE(SUM(c.n), 0)::int AS casos,
            COALESCE(SUM(c.criticos), 0)::int AS criticos
       FROM asis s
       LEFT JOIN connect_workshops w ON w.id = s."proveedorTallerId"
       LEFT JOIN resp_por_asis rp ON rp.asistencia = s.id
       LEFT JOIN casos_por_asis c ON c.asistencia = s.id
      GROUP BY s."proveedorTallerId", w.name
      ORDER BY asistencias DESC`,
    [f.desdeMs, f.hastaMs, tenantId, f.clienteId ?? null],
  );

  return q.rows.map((r) => {
    const asistencias = num(r.asistencias);
    const respuestasDriver = num(r.respuestasDriver);
    const casos = num(r.casos);
    return {
      proveedorId: r.proveedorId == null ? null : Number(r.proveedorId),
      nombre: r.nombre ?? null,
      asistencias, respuestasDriver,
      // Sin respuestas es «sin datos», nunca cero: un proveedor sin encuestas
      // contestadas no es un proveedor con nota cero.
      satisfaccionDriver: medioONulo(r.satisfaccionDriver, r.respuestasDriver).media,
      resolucionSiPct: pct(num(r.resSi), num(r.resTotal)),
      casos, criticos: num(r.criticos),
      casosPor100: asistencias > 0 ? Number(((casos / asistencias) * 100).toFixed(1)) : null,
      suficiente: respuestasDriver >= MINIMO_RESPUESTAS_RANKING,
    };
  });
}

/* ── Clientes ────────────────────────────────────────────────────────────── */

async function metricasPorCliente(f: Filtros, tenantId: string | null): Promise<FilaCliente[]> {
  const q = await pool.query(
    `WITH asis AS (
       SELECT a.id, a."clienteFacturacionId"
         FROM roadside_assistances a
        WHERE a."finishedAtMs" IS NOT NULL
          AND a."finishedAtMs" >= $1 AND a."finishedAtMs" <= $2
          AND ($3::text IS NULL OR a."tallerId"::text = $3)
          AND ($4::int IS NULL OR a."proveedorTallerId" = $4)
     ),
     notas AS (
       SELECT s.id AS asistencia, i."recipientRole" AS rol, x."scaleValue" AS overall
         FROM asis s
         JOIN survey_instances i ON i."assistanceId" = s.id::text
         JOIN survey_responses r ON r."surveyInstanceId" = i.id
         JOIN survey_answers x ON x."surveyResponseId" = r.id AND x."questionCode" = 'overall_rating'
     ),
     casos AS (
       SELECT s.id AS asistencia FROM asis s JOIN quality_cases q ON q."assistanceId" = s.id::text
     ),
     /* Igual que en proveedores: una fila por asistencia antes de juntar. */
     notas_por_asis AS (
       SELECT asistencia,
              SUM(overall) FILTER (WHERE rol = 'CUSTOMER')::numeric AS "sumaCustomer",
              COUNT(*)     FILTER (WHERE rol = 'CUSTOMER')::int     AS "nCustomer",
              SUM(overall) FILTER (WHERE rol = 'DRIVER')::numeric   AS "sumaDriver",
              COUNT(*)     FILTER (WHERE rol = 'DRIVER')::int       AS "nDriver"
         FROM notas GROUP BY asistencia
     ),
     casos_por_asis AS (
       SELECT asistencia, COUNT(*)::int AS n FROM casos GROUP BY asistencia
     )
     SELECT s."clienteFacturacionId" AS "clienteId", c.name AS nombre,
            COUNT(DISTINCT s.id)::int AS asistencias,
            COALESCE(SUM(n."nCustomer"), 0)::int AS "nCustomer",
            CASE WHEN COALESCE(SUM(n."nCustomer"), 0) > 0
                 THEN SUM(n."sumaCustomer") / SUM(n."nCustomer") END AS "avgCustomer",
            COALESCE(SUM(n."nDriver"), 0)::int AS "nDriver",
            CASE WHEN COALESCE(SUM(n."nDriver"), 0) > 0
                 THEN SUM(n."sumaDriver") / SUM(n."nDriver") END AS "avgDriver",
            COALESCE(SUM(k.n), 0)::int AS casos
       FROM asis s
       LEFT JOIN connect_clients c ON c.id = s."clienteFacturacionId"
       LEFT JOIN notas_por_asis n ON n.asistencia = s.id
       LEFT JOIN casos_por_asis k ON k.asistencia = s.id
      GROUP BY s."clienteFacturacionId", c.name
      ORDER BY asistencias DESC`,
    [f.desdeMs, f.hastaMs, tenantId, f.proveedorTallerId ?? null],
  );

  return q.rows.map((r) => {
    const asistencias = num(r.asistencias);
    const casos = num(r.casos);
    return {
      clienteId: r.clienteId == null ? null : Number(r.clienteId),
      nombre: r.nombre ?? null,
      asistencias,
      respuestasCustomer: num(r.nCustomer),
      satisfaccionCustomer: medioONulo(r.avgCustomer, r.nCustomer).media,
      respuestasDriver: num(r.nDriver),
      satisfaccionDriver: medioONulo(r.avgDriver, r.nDriver).media,
      casos,
      casosPor100: asistencias > 0 ? Number(((casos / asistencias) * 100).toFixed(1)) : null,
    };
  });
}

/* ── Franja horaria ──────────────────────────────────────────────────────── */

/**
 * Por franja de la solicitud. Segmentación, no explicación.
 *
 * Que la nota baje de madrugada puede ser el turno, el tipo de avería o que a
 * las cuatro de la mañana todo se lleva peor. Esto solo separa; interpretarlo
 * es de quien lo mira.
 */
async function metricasPorFranja(
  f: Filtros, tenantId: string | null,
): Promise<{ franja: string; asistencias: number; driver: Media }[]> {
  const q = await pool.query(
    `WITH asis AS (
       SELECT a.id,
              CASE
                WHEN EXTRACT(HOUR FROM to_timestamp(a."createdAtMs" / 1000.0)) < 6  THEN '00-06'
                WHEN EXTRACT(HOUR FROM to_timestamp(a."createdAtMs" / 1000.0)) < 12 THEN '06-12'
                WHEN EXTRACT(HOUR FROM to_timestamp(a."createdAtMs" / 1000.0)) < 18 THEN '12-18'
                ELSE '18-24'
              END AS franja
         FROM roadside_assistances a
        WHERE a."finishedAtMs" IS NOT NULL
          AND a."finishedAtMs" >= $1 AND a."finishedAtMs" <= $2
          AND ($3::text IS NULL OR a."tallerId"::text = $3)
          AND ($4::int IS NULL OR a."clienteFacturacionId" = $4)
          AND ($5::int IS NULL OR a."proveedorTallerId" = $5)
     )
     SELECT s.franja, COUNT(DISTINCT s.id)::int AS asistencias,
            AVG(x."scaleValue") AS media, COUNT(x."scaleValue")::int AS n
       FROM asis s
       LEFT JOIN survey_instances i
              ON i."assistanceId" = s.id::text AND i."recipientRole" = 'DRIVER'
       LEFT JOIN survey_responses r ON r."surveyInstanceId" = i.id
       LEFT JOIN survey_answers x
              ON x."surveyResponseId" = r.id AND x."questionCode" = 'overall_rating'
      GROUP BY s.franja ORDER BY s.franja`,
    [f.desdeMs, f.hastaMs, tenantId, f.clienteId ?? null, f.proveedorTallerId ?? null],
  );
  return q.rows.map((r) => ({
    franja: String(r.franja), asistencias: num(r.asistencias),
    driver: medioONulo(r.media, r.n),
  }));
}
