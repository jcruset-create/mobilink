/**
 * Lo que ha calculado el motor, listo para la pantalla.
 *
 * Está aparte de la ruta porque la conversión tiene más criterio del que
 * parece y se puede probar sin base de datos:
 *
 *  - Las columnas NUMERIC llegan del driver como TEXTO. Que cada pantalla que
 *    quiera pintar un importe se acuerde de eso es la forma segura de que
 *    alguna se olvide y llame a `.toFixed` sobre un string.
 *  - Las columnas JSONB llegan parseadas o sin parsear según por dónde entren.
 *  - Un importe nulo se queda NULO. Convertirlo a cero aquí sería deshacer el
 *    criterio del motor entero: un cero se factura, un nulo se mira.
 */

export interface EtapaApi {
  stage: string;
  status: string;
  currency: string;
  saleTotal: string | null;
  purchaseTotal: string | null;
  grossMargin: string | null;
  grossMarginPct: string | null;
  computedAtMs: number | null;
  tariff: string | null;
  version: string | null;
  rule: string | null;
  context: Record<string, unknown> | null;
  warnings: unknown[];
  lines: Record<string, unknown>[];
}

/** Importe a texto con dos decimales, o null si no se sabe. */
function dos(v: unknown): string | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n.toFixed(2) : null;
}

function objeto(v: unknown): Record<string, any> {
  if (v == null) return {};
  if (typeof v !== "string") return (v as Record<string, any>) ?? {};
  try { return JSON.parse(v) ?? {}; } catch { return {}; }
}

function lista(v: unknown): any[] {
  if (Array.isArray(v)) return v;
  if (typeof v !== "string") return [];
  try {
    const p = JSON.parse(v);
    return Array.isArray(p) ? p : [];
  } catch { return []; }
}

export function etapaParaApi(fila: Record<string, any>): EtapaApi {
  const s = objeto(fila.snapshot);
  return {
    stage: fila.stage,
    status: fila.status,
    currency: fila.currency ?? "EUR",
    saleTotal: dos(fila.saleTotal),
    purchaseTotal: dos(fila.purchaseTotal),
    grossMargin: dos(fila.grossMargin),
    grossMarginPct: dos(fila.grossMarginPct),
    computedAtMs: fila.computedAtMs == null ? null : Number(fila.computedAtMs),
    tariff: s.venta?.tariffPlanName ?? s.compra?.tariffPlanName ?? null,
    version: s.venta?.version ?? s.compra?.version ?? null,
    rule: s.venta?.reglaNombre ?? s.compra?.reglaNombre ?? null,
    context: s.contexto ?? null,
    warnings: lista(fila.warnings),
    lines: lista(fila.lines).map((l: any) => ({
      lineNumber: l.lineNumber,
      kind: l.kind,
      description: l.description,
      quantity: l.quantity == null ? null : Number(l.quantity),
      unit: l.unit ?? null,
      saleUnitPrice: dos(l.saleUnitPrice),
      saleTotal: dos(l.saleTotal),
      purchaseUnitPrice: dos(l.purchaseUnitPrice),
      purchaseTotal: dos(l.purchaseTotal),
    })),
  };
}
