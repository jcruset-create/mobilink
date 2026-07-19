/**
 * Rules Engine (§2.5).
 *
 * Aplica reglas de negocio configurables sobre el contexto de una operación de
 * automatización. Las reglas devuelven "decisiones" (banderas) que el orquestador
 * respeta: p. ej. exigir validación humana en frenos, aprobación de gerente si el
 * presupuesto supera un umbral, o no consultar proveedores si hay stock local.
 *
 * Las reglas son datos, no código incrustado: aquí van las por defecto, pero el
 * evaluador acepta una lista de reglas (que en el futuro puede venir de la BD por tenant).
 */

/** Contexto que se evalúa. Campos opcionales según la fase del flujo. */
export interface RuleContext {
  tenantId: string;
  /** Categoría/área de la intervención, p. ej. "Frenos", "Motor". */
  category?: string;
  /** Segmento del cliente, p. ej. "Premium". */
  customerTier?: string;
  /** Stock local disponible de la pieza (si se conoce). */
  localStock?: number;
  /** Importe del presupuesto una vez calculado (para reglas de aprobación). */
  quoteAmount?: number;
}

/** Decisiones resultantes de evaluar las reglas. */
export interface RuleDecision {
  requiresHumanValidation: boolean;
  requiresManagerApproval: boolean;
  preferOem: boolean;
  skipSuppliers: boolean;
  /** Motivos legibles (para el audit log y el panel). */
  reasons: string[];
}

export interface Rule {
  code: string;
  description: string;
  /** Aplica la regla mutando la decisión; añade un motivo si dispara. */
  apply(ctx: RuleContext, decision: RuleDecision): void;
}

/** Umbral por defecto para aprobación de gerente (configurable por env). */
export function managerApprovalThreshold(): number {
  const v = Number(process.env.IH_MANAGER_APPROVAL_THRESHOLD);
  return Number.isFinite(v) && v > 0 ? v : 2000;
}

/** Conjunto de reglas por defecto (los ejemplos del §2.5). */
export const DEFAULT_RULES: Rule[] = [
  {
    code: "BRAKES_HUMAN_VALIDATION",
    description: "Si la reparación afecta a frenos, requerir validación humana",
    apply(ctx, d) {
      if (ctx.category && /fren/i.test(ctx.category)) {
        d.requiresHumanValidation = true;
        d.reasons.push("Intervención en frenos: requiere validación humana");
      }
    },
  },
  {
    code: "QUOTE_MANAGER_APPROVAL",
    description: "Si el presupuesto supera el umbral, requerir aprobación de gerente",
    apply(ctx, d) {
      const threshold = managerApprovalThreshold();
      if (ctx.quoteAmount != null && ctx.quoteAmount > threshold) {
        d.requiresManagerApproval = true;
        d.reasons.push(`Presupuesto ${ctx.quoteAmount} € > ${threshold} €: requiere aprobación de gerente`);
      }
    },
  },
  {
    code: "LOCAL_STOCK_SKIP_SUPPLIERS",
    description: "Si hay stock local, no consultar proveedores",
    apply(ctx, d) {
      if (ctx.localStock != null && ctx.localStock > 0) {
        d.skipSuppliers = true;
        d.reasons.push(`Stock local disponible (${ctx.localStock}): no se consultan proveedores`);
      }
    },
  },
  {
    code: "PREMIUM_PREFER_OEM",
    description: "Si el cliente es Premium, priorizar recambio OEM",
    apply(ctx, d) {
      if (ctx.customerTier && /premium/i.test(ctx.customerTier)) {
        d.preferOem = true;
        d.reasons.push("Cliente Premium: priorizar recambio OEM");
      }
    },
  },
];

/** Evalúa las reglas sobre el contexto y devuelve la decisión combinada. */
export function evaluateRules(ctx: RuleContext, rules: Rule[] = DEFAULT_RULES): RuleDecision {
  const decision: RuleDecision = {
    requiresHumanValidation: false,
    requiresManagerApproval: false,
    preferOem: false,
    skipSuppliers: false,
    reasons: [],
  };
  for (const rule of rules) rule.apply(ctx, decision);
  return decision;
}
