/**
 * Acceso telefónico (fase 3), detrás de un adaptador. Sólo tipos en la fase 1.
 *
 *   rut_whitelist      — el RUT241 abre a los números de su lista (MVP). El
 *                        backend la mantiene al día y registra si lo está.
 *   backend_validated  — el dispositivo avisa de la llamada y el backend decide.
 *   twilio             — opcional; la aplicación no depende de él.
 */

export type PhoneAccessMode = "rut_whitelist" | "backend_validated" | "twilio";

/** Un número que debe estar autorizado en un dispositivo, y por qué. */
export type AuthorizedNumber = {
  phoneE164: string;
  source: "customer_phone" | "contract_member" | "temporary_access";
  sourceId: string;
  contractId: string;
};

export type WhitelistSyncResult = {
  ok: boolean;
  /** Huella (sha256) de la lista aplicada: «al día» = deseada === aplicada. */
  appliedHash: string | null;
  error?: string;
};

export interface PhoneAccessAdapter {
  readonly mode: PhoneAccessMode;
  /** Deja en el dispositivo EXACTAMENTE esta lista (altas y bajas). */
  syncWhitelist(deviceId: string, numbers: AuthorizedNumber[]): Promise<WhitelistSyncResult>;
}
