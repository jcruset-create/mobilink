import { useCallback, useEffect, useState } from "react";
import * as api from "../../services/api";
import type { EstadoAsistente } from "../../types";

/** Si el asistente está activo (interruptor global y empresa) y con qué proveedor. */
export function useEstadoAsistente() {
  const [estado, setEstado] = useState<EstadoAsistente | null>(null);
  const [error, setError] = useState<string | null>(null);
  const recargar = useCallback(() => {
    api.estadoAsistente().then(
      (e) => (setEstado(e), setError(null)),
      (e) => setError(e instanceof Error ? e.message : "Error")
    );
  }, []);
  useEffect(() => {
    recargar();
  }, [recargar]);
  return { estado, error, recargar };
}
