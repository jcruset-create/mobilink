/**
 * Connect Pro — suscripción SSE al backoffice (/bo/events).
 * EventSource no admite cabeceras: el token de sesión viaja en la query.
 * Reconexión con token fresco ante error; devuelve función de limpieza.
 */

import { useEffect, useRef } from "react";
import { supabase } from "../../administracion/services/supabase";

const API_BASE = import.meta.env.PROD ? "" : "http://localhost:4000";

export type ConnectPush =
  | { kind: "status"; assistanceId: number; status: string }
  | { kind: "alert"; alertId: number; type: string; severity: string; title: string };

export function useConnectEvents(onPush: (push: ConnectPush) => void): void {
  const handler = useRef(onPush);
  handler.current = onPush;

  useEffect(() => {
    let es: EventSource | null = null;
    let closed = false;
    let retry: ReturnType<typeof setTimeout> | null = null;

    const connect = async () => {
      if (closed) return;
      try {
        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token;
        if (!token) { retry = setTimeout(connect, 15000); return; }
        es = new EventSource(`${API_BASE}/api/connect/bo/events?access_token=${encodeURIComponent(token)}`);
        es.addEventListener("push", (e) => {
          try { handler.current(JSON.parse((e as MessageEvent).data)); } catch { /* payload inválido */ }
        });
        es.onerror = () => {
          es?.close();
          es = null;
          if (!closed) retry = setTimeout(connect, 5000);
        };
      } catch {
        retry = setTimeout(connect, 15000);
      }
    };

    connect();
    return () => {
      closed = true;
      if (retry) clearTimeout(retry);
      es?.close();
    };
  }, []);
}
