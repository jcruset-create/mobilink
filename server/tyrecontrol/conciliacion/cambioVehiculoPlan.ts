/**
 * «El equipo está ahora en otro vehículo»: la parte pura (sin base ni red),
 * con pruebas. La que escribe está en cambioVehiculo.ts.
 */

import { MOTIVOS_DISCREPANCIA, type FilaDiscrepancia } from "../../integration-hub/domain/reconciliation.ts";

/** Un cambio de equipo pendiente: lo que la pantalla enseña y lo que se pide. */
export interface CambioPendiente {
  tcVehicleId: string;
  externalVehicleId: string;
  matriculaAntigua: string;
  matriculaNueva: string;
  nombreProveedor: string | null;
  neumaticosMontados: number;
}

/** Los avisos de «el proveedor ha cambiado la matrícula» que se pueden resolver así. */
export function cambiosPendientes(discrepancias: FilaDiscrepancia[]): CambioPendiente[] {
  const out: CambioPendiente[] = [];
  for (const d of discrepancias) {
    if (d.motivo !== MOTIVOS_DISCREPANCIA.MATRICULA_CAMBIO_PROVEEDOR) continue;
    if (!d.interno || !d.enlace || !d.externo) continue;
    const nueva = String(d.externo.plate ?? "").trim();
    if (!nueva) continue;
    out.push({
      tcVehicleId: d.enlace.mobilinkId,
      externalVehicleId: d.enlace.externalCode,
      matriculaAntigua: d.interno.matricula,
      matriculaNueva: nueva,
      nombreProveedor: d.externo.name ?? null,
      neumaticosMontados: d.interno.neumaticosMontados ?? 0,
    });
  }
  return out;
}

export type PasoAntiguo = "baja_y_desvincular" | "desvincular";
export type PasoNuevo = "reactivar_y_vincular" | "vincular" | "alta_pendiente";

/**
 * Qué se va a hacer con cada lado. `null` si el «nuevo» es el mismo vehículo
 * que ya estaba enlazado: no hay nada que cambiar (quien llama lo dice).
 */
export function planDeCambio(p: {
  darDeBajaAntiguo: boolean;
  antiguoActivo: boolean;
  objetivo: { id: string; activo: boolean } | null;
  tcVehicleId: string;
}): { antiguo: PasoAntiguo; nuevo: PasoNuevo } | null {
  if (p.objetivo && p.objetivo.id === p.tcVehicleId) return null;
  return {
    // Un antiguo que ya está de baja solo se desvincula: la baja no se repite.
    antiguo: p.darDeBajaAntiguo && p.antiguoActivo ? "baja_y_desvincular" : "desvincular",
    nuevo: !p.objetivo ? "alta_pendiente" : p.objetivo.activo ? "vincular" : "reactivar_y_vincular",
  };
}
