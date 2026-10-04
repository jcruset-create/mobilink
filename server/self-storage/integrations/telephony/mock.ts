import type { LlamadaEntrante, OrdenTelefonia, TelephonyProvider } from "./types.ts";

/**
 * Telefonía simulada. Firma: cabecera `x-mock-signature` igual a
 * SELF_STORAGE_TELEPHONY_MOCK_SECRET (sin secreto configurado, nada es válido).
 */
export class MockTelephonyProvider implements TelephonyProvider {
  readonly nombre = "mock";
  verificarFirma(cabeceras: Record<string, string | undefined>): boolean {
    const secreto = process.env.SELF_STORAGE_TELEPHONY_MOCK_SECRET;
    return Boolean(secreto) && cabeceras["x-mock-signature"] === secreto;
  }
  parsearEntrante(cuerpo: Record<string, unknown>): LlamadaEntrante | null {
    const id = typeof cuerpo.callId === "string" ? cuerpo.callId : null;
    const to = typeof cuerpo.to === "string" ? cuerpo.to : null;
    if (!id || !to) return null;
    return { externalCallId: id, from: typeof cuerpo.from === "string" ? cuerpo.from : null, to, direction: cuerpo.direction === "outgoing" ? "outgoing" : "incoming" };
  }
  responder(ordenes: OrdenTelefonia[]) {
    return { contentType: "application/json", cuerpo: JSON.stringify({ ordenes }) };
  }
}
