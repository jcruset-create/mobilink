import { useCallback, useEffect, useRef, useState } from "react";

import { API_BASE } from "./workshopApi";
import { getAdminHeaders } from "./adminHeaders";
import type { RecepcionVehiculo } from "./recepcionVehiculo";

/**
 * Vehículos recibidos en el patio y todavía sin validar.
 *
 * Cada pantalla que los enseña lo pide por su cuenta en vez de recibirlos por
 * props. Es a propósito: la alternativa era atravesar `SeaTarragonaV1` —ocho
 * mil líneas y cincuenta props ya— para llegar a la agenda, y el dato es una
 * lista corta que se consulta cada minuto.
 */
export function useRecepcionesPendientes(workshopId?: string | null) {
  const [recepciones, setRecepciones] = useState<RecepcionVehiculo[]>([]);
  // Se guarda en una ref para que el intervalo no se rearme en cada render.
  const ultimoOk = useRef<RecepcionVehiculo[]>([]);

  const recargar = useCallback(async () => {
    try {
      const url = new URL(`${API_BASE}/api/recepcion-vehiculos`, window.location.origin);
      url.searchParams.set("estado", "pendiente");
      if (workshopId) url.searchParams.set("workshopId", workshopId);

      const res = await fetch(url.toString(), { headers: getAdminHeaders() });
      if (!res.ok) return; // se conserva lo último bueno, ver abajo
      const datos = await res.json();
      if (!Array.isArray(datos)) return;
      ultimoOk.current = datos;
      setRecepciones(datos);
    } catch {
      /*
       * Un fallo NO vacía la lista. Esta pantalla está colgada en la pared del
       * taller y se recarga sola cada minuto: parpadear a cero porque una
       * consulta ha ido mal haría creer que no hay nada pendiente, que es
       * justo lo contrario de para lo que sirve.
       */
    }
  }, [workshopId]);

  useEffect(() => {
    void recargar();
    const t = window.setInterval(() => void recargar(), 60_000);
    return () => window.clearInterval(t);
  }, [recargar]);

  return { recepciones, recargar };
}
