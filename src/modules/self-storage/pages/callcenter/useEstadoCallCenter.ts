import { useCallback, useEffect, useState } from "react";
import * as api from "../../services/api";
import type { EstadoCallCenter } from "../../types";

/** Si el Call Center está activo (interruptor global y empresa) y los enlaces de la empresa. */
export function useEstadoCallCenter() {
  const [estado, setEstado] = useState<EstadoCallCenter | null>(null);
  const [error, setError] = useState<string | null>(null);
  const recargar = useCallback(() => {
    api.estadoCallCenter().then(
      (e) => (setEstado(e), setError(null)),
      (e) => setError(e instanceof Error ? e.message : "Error")
    );
  }, []);
  useEffect(() => {
    recargar();
  }, [recargar]);
  return { estado, error, recargar };
}

