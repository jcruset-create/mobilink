/**
 * Lectura y forma de las liquidaciones de gastos.
 *
 * Lo comparten el servicio (ciclo de vida) y las líneas (tickets). Vive aparte
 * para que ninguno de los dos tenga que importar al otro.
 */

import type { PoolClient } from "pg";
import pool from "../../db.ts";
import { ErrorCaja } from "../errors.ts";
import type { Contexto } from "../service.ts";
import type {
  EstadoAnalisis,
  EstadoLiquidacion,
  LineaParaReglas,
  SituacionLinea,
  TipoDestino,
} from "./domain.ts";

type Consultable = Pick<PoolClient, "query">;

export type Liquidacion = {
  id: number;
  numero: string;
  estado: EstadoLiquidacion;
  centroId: string | null;
  employeeId: string | null;
  expenseTargetId: number;
  empleadoNombre: string;
  solicitanteUserId: string | null;
  periodoDesde: string | null;
  periodoHasta: string | null;
  totalCentimos: number;
  notas: string | null;
  presentadaPor: string | null;
  presentadaAtMs: number | null;
  aprobadaPor: string | null;
  aprobadaAtMs: number | null;
  rechazoMotivo: string | null;
  rechazadaPor: string | null;
  rechazadaAtMs: number | null;
  operationPagoId: number | null;
  /** El número del pago en la caja, P-26-041. */
  pagoNumero: string | null;
  sessionIdPago: number | null;
  pagadaPor: string | null;
  pagadaAtMs: number | null;
  anuladaPor: string | null;
  anuladaAtMs: number | null;
  anuladaMotivo: string | null;
  version: number;
  creadoPor: string | null;
  createdAtMs: number;
  updatedAtMs: number;
};

export type EvidenciaDuplicado = {
  id: number;
  lineId: number;
  tipo: "MISMO_FICHERO" | "MISMA_CLAVE" | "MISMO_NUMERO";
  referenciaTipo: "LINEA" | "DOCUMENTO" | "OPERACION";
  referenciaId: number;
  referenciaNumero: string | null;
  detectadoEn: "SUBIDA" | "ANALISIS" | "PRESENTAR" | "PAGAR";
  detectadoAtMs: number;
  resolucion: "PENDIENTE" | "ACEPTADA" | "EXCLUIDA" | "DESCARTADA";
  resueltoPor: string | null;
  resueltoAtMs: number | null;
  motivo: string | null;
};

export type LineaLiquidacion = {
  id: number;
  claimId: number;
  orden: number;
  nombre: string;
  mime: string;
  tamanoBytes: number;
  sha256: string;
  analisis: EstadoAnalisis;
  analisisError: string | null;
  situacion: SituacionLinea;
  excluidaMotivo: string | null;
  revisada: boolean;
  revisadaPor: string | null;
  revisadaAtMs: number | null;
  fecha: string | null;
  emisorNombre: string;
  emisorNif: string | null;
  numeroDocumento: string | null;
  concepto: string;
  baseCentimos: number | null;
  ivaCentimos: number | null;
  importeCentimos: number;
  moneda: string;
  expenseConceptId: number | null;
  conceptoNombre: string | null;
  conceptoTipoDestino: TipoDestino | null;
  expenseTargetId: number | null;
  destinoNombre: string | null;
  subidoAtMs: number;
  /** Enlace temporal. Caduca: no sirve para guardarlo en ningún sitio. */
  url: string | null;
  duplicados: EvidenciaDuplicado[];
};

/* eslint-disable @typescript-eslint/no-explicit-any */
const num = (v: any): number | null => (v == null ? null : Number(v));
/** DATE llega como Date o como texto según el driver; aquí siempre YYYY-MM-DD. */
const fechaIso = (v: any): string | null => {
  if (v == null) return null;
  if (v instanceof Date) {
    const y = v.getFullYear();
    const m = String(v.getMonth() + 1).padStart(2, "0");
    const d = String(v.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  return String(v).slice(0, 10);
};

export function aLiquidacion(r: any): Liquidacion {
  return {
    id: r.id,
    numero: r.numero,
    estado: r.estado,
    centroId: r.centro_id ?? null,
    employeeId: r.employee_id ?? null,
    expenseTargetId: r.expense_target_id,
    empleadoNombre: r.empleado_nombre,
    solicitanteUserId: r.solicitante_user_id ?? null,
    periodoDesde: fechaIso(r.periodo_desde),
    periodoHasta: fechaIso(r.periodo_hasta),
    totalCentimos: Number(r.total_centimos),
    notas: r.notas ?? null,
    presentadaPor: r.presentada_por ?? null,
    presentadaAtMs: num(r.presentada_at_ms),
    aprobadaPor: r.aprobada_por ?? null,
    aprobadaAtMs: num(r.aprobada_at_ms),
    rechazoMotivo: r.rechazo_motivo ?? null,
    rechazadaPor: r.rechazada_por ?? null,
    rechazadaAtMs: num(r.rechazada_at_ms),
    operationPagoId: r.operation_pago_id ?? null,
    pagoNumero: r.pago_numero ?? null,
    sessionIdPago: r.session_id_pago ?? null,
    pagadaPor: r.pagada_por ?? null,
    pagadaAtMs: num(r.pagada_at_ms),
    anuladaPor: r.anulada_por ?? null,
    anuladaAtMs: num(r.anulada_at_ms),
    anuladaMotivo: r.anulada_motivo ?? null,
    version: Number(r.version),
    creadoPor: r.creado_por ?? null,
    createdAtMs: Number(r.created_at_ms),
    updatedAtMs: Number(r.updated_at_ms),
  };
}

export function aEvidencia(r: any): EvidenciaDuplicado {
  return {
    id: r.id,
    lineId: r.line_id,
    tipo: r.tipo,
    referenciaTipo: r.referencia_tipo,
    referenciaId: r.referencia_id,
    referenciaNumero: r.referencia_numero ?? null,
    detectadoEn: r.detectado_en,
    detectadoAtMs: Number(r.detectado_at_ms),
    resolucion: r.resolucion,
    resueltoPor: r.resuelto_por ?? null,
    resueltoAtMs: num(r.resuelto_at_ms),
    motivo: r.motivo ?? null,
  };
}

function aLinea(r: any, duplicados: EvidenciaDuplicado[], url: string | null): LineaLiquidacion {
  return {
    id: r.id,
    claimId: r.claim_id,
    orden: r.orden,
    nombre: r.nombre,
    mime: r.mime,
    tamanoBytes: Number(r.tamano_bytes),
    sha256: r.sha256,
    analisis: r.analisis,
    analisisError: r.analisis_error ?? null,
    situacion: r.situacion,
    excluidaMotivo: r.excluida_motivo ?? null,
    revisada: r.revisada,
    revisadaPor: r.revisada_por ?? null,
    revisadaAtMs: num(r.revisada_at_ms),
    fecha: fechaIso(r.fecha),
    emisorNombre: r.emisor_nombre ?? "",
    emisorNif: r.emisor_nif ?? null,
    numeroDocumento: r.numero_documento ?? null,
    concepto: r.concepto ?? "",
    baseCentimos: num(r.base_centimos),
    ivaCentimos: num(r.iva_centimos),
    importeCentimos: Number(r.importe_centimos),
    moneda: r.moneda,
    expenseConceptId: r.expense_concept_id ?? null,
    conceptoNombre: r.concepto_nombre ?? null,
    conceptoTipoDestino: r.concepto_tipo_destino ?? null,
    expenseTargetId: r.expense_target_id ?? null,
    destinoNombre: r.destino_nombre ?? null,
    subidoAtMs: Number(r.subido_at_ms),
    url,
    duplicados,
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

const SELECT_LIQUIDACION = `
  SELECT c.*, o.numero AS pago_numero
    FROM cash_expense_claims c
    LEFT JOIN cash_operations o ON o.id = c.operation_pago_id`;

/**
 * Una liquidación de la empresa, comprobando el ámbito de taller.
 *
 * El ámbito se comprueba aquí y no en cada función: todas pasan por aquí, y
 * olvidarlo en una es justo el agujero que no se ve. Una liquidación creada
 * sin ámbito la ve todo el mundo, igual que una caja sin taller.
 */
export async function cargarLiquidacion(
  c: Consultable,
  ctx: Contexto,
  id: number,
  bloquear = false
): Promise<Liquidacion> {
  /*
   * `FOR UPDATE OF c`: bloquea la liquidación y no la operación del pago, que
   * es de la caja y no hay por qué retenerla.
   */
  const { rows } = await c.query(
    `${SELECT_LIQUIDACION} WHERE c.id = $1 AND c.empresa_id = $2 ${bloquear ? "FOR UPDATE OF c" : ""}`,
    [id, ctx.empresaId]
  );
  if (rows.length === 0) {
    throw new ErrorCaja("LIQUIDACION_NO_ENCONTRADA", "La liquidación no existe.", 404);
  }
  const l = aLiquidacion(rows[0]);
  if (ctx.centroId && l.centroId && l.centroId !== ctx.centroId) {
    throw new ErrorCaja(
      "LIQUIDACION_DE_OTRO_CENTRO",
      "Esta liquidación es de otro taller.",
      403
    );
  }
  return l;
}

export async function listarLiquidaciones(
  ctx: Contexto,
  f: {
    estado?: string | null;
    expenseTargetId?: number | null;
    employeeId?: string | null;
    desde?: string | null;
    hasta?: string | null;
  }
): Promise<(Liquidacion & { lineas: number })[]> {
  const { rows } = await pool.query(
    `SELECT c.*, o.numero AS pago_numero,
            (SELECT COUNT(*) FROM cash_expense_claim_lines l
              WHERE l.claim_id = c.id AND l.situacion = 'INCLUIDA')::int AS lineas
       FROM cash_expense_claims c
       LEFT JOIN cash_operations o ON o.id = c.operation_pago_id
      WHERE c.empresa_id = $1
        AND ($2::uuid IS NULL OR c.centro_id IS NULL OR c.centro_id = $2::uuid)
        AND ($3::text IS NULL OR c.estado = $3::text)
        AND ($4::int IS NULL OR c.expense_target_id = $4::int)
        AND ($5::uuid IS NULL OR c.employee_id = $5::uuid)
        AND ($6::bigint IS NULL OR c.created_at_ms >= $6::bigint)
        AND ($7::bigint IS NULL OR c.created_at_ms < $7::bigint)
      ORDER BY c.updated_at_ms DESC, c.id DESC
      LIMIT 300`,
    [
      ctx.empresaId,
      ctx.centroId ?? null,
      f.estado ?? null,
      f.expenseTargetId ?? null,
      f.employeeId ?? null,
      f.desde ? Date.parse(`${f.desde}T00:00:00Z`) : null,
      f.hasta ? Date.parse(`${f.hasta}T00:00:00Z`) + 86_400_000 : null,
    ]
  );
  /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
  return rows.map((r: any) => ({ ...aLiquidacion(r), lineas: Number(r.lineas) }));
}

/** Las líneas con su concepto, su destino y sus coincidencias de duplicado. */
export async function lineasDe(
  c: Consultable,
  claimId: number,
  firmar?: (ruta: string) => Promise<string | null>
): Promise<LineaLiquidacion[]> {
  const { rows } = await c.query(
    `SELECT l.*, k.nombre AS concepto_nombre, k.tipo_destino AS concepto_tipo_destino,
            d.nombre AS destino_nombre
       FROM cash_expense_claim_lines l
       LEFT JOIN cash_expense_concepts k ON k.id = l.expense_concept_id
       LEFT JOIN cash_expense_targets d ON d.id = l.expense_target_id
      WHERE l.claim_id = $1
      ORDER BY l.orden, l.id`,
    [claimId]
  );
  const ids = rows.map((r: { id: number }) => r.id);
  const { rows: evidencias } = ids.length
    ? await c.query(
        `SELECT * FROM cash_expense_claim_duplicates WHERE line_id = ANY($1::int[]) ORDER BY id`,
        [ids]
      )
    : { rows: [] };
  const porLinea = new Map<number, EvidenciaDuplicado[]>();
  for (const e of evidencias.map(aEvidencia)) {
    porLinea.set(e.lineId, [...(porLinea.get(e.lineId) ?? []), e]);
  }
  return Promise.all(
    /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
    rows.map(async (r: any) => aLinea(r, porLinea.get(r.id) ?? [], firmar ? await firmar(r.ruta) : null))
  );
}

/** Lo que el dominio necesita de cada línea. */
export function paraReglas(l: LineaLiquidacion): LineaParaReglas {
  return {
    id: l.id,
    situacion: l.situacion,
    fecha: l.fecha,
    importeCentimos: l.importeCentimos,
    conceptoId: l.expenseConceptId,
    conceptoNombre: l.conceptoNombre,
    moneda: l.moneda,
    revisada: l.revisada,
  };
}

/** Líneas con alguna coincidencia todavía sin decidir. */
export function conDuplicadoPendiente(lineas: readonly LineaLiquidacion[]): Set<number> {
  return new Set(
    lineas.filter((l) => l.duplicados.some((d) => d.resolucion === "PENDIENTE")).map((l) => l.id)
  );
}
