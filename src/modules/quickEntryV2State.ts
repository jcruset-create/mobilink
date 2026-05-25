export type QuickDraftState = {
  templateKey: string;
  linkedTemplateKey: string;
  plate: string;
  urgent: boolean;
  customerName: string;
  customerPhone: string;
  includedTaskIds: string[];

  /**
   * V2:
   * Cantidad para trabajos por unidades.
   * Se guarda como string porque viene de un input.
   */
  quantity: string;
};

export const INITIAL_QUICK_DRAFT: QuickDraftState = {
  templateKey: "",
  linkedTemplateKey: "",
  plate: "",
  urgent: false,
  customerName: "",
  customerPhone: "",
  includedTaskIds: [],
  quantity: "1",
};

export function normalizeQuickEntryQuantity(value: unknown): number {
  const numberValue = Number(value);

  if (!Number.isFinite(numberValue) || numberValue <= 0) {
    return 1;
  }

  return Math.round(numberValue * 100) / 100;
}

export function resetQuickDraftAfterCreate(
  previous: QuickDraftState
): QuickDraftState {
  return {
    ...previous,
    linkedTemplateKey: "",
    plate: "",
    customerName: "",
    customerPhone: "",
    urgent: false,
    includedTaskIds: [],
    quantity: "1",
  };
}