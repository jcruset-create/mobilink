/**
 * Estado compartido del módulo: rol, permisos y datos del centro.
 *
 * Se carga una vez al entrar. Los expedientes NO viven aquí: cada pantalla pide
 * los suyos, porque la lista y el detalle tienen ritmos distintos y meterlos en
 * un contexto obligaría a invalidarlo desde sitios que no deberían saber de él.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import * as api from "../services/api";
import type { Bootstrap, Centro } from "../types";

type Estado = {
  cargando: boolean;
  error: string | null;
  rol: string | null;
  permisos: string[];
  centro: Centro | null;
  autorrelleno: boolean;
  puede: (permiso: string) => boolean;
  refrescar: () => Promise<void>;
  fijarCentro: (c: Centro) => void;
};

const Ctx = createContext<Estado | null>(null);

export function TacografosProvider({ children }: { children: ReactNode }) {
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [datos, setDatos] = useState<Bootstrap | null>(null);

  /*
   * La primera sentencia es un `await`, no un `setState`: llamar a esto desde
   * un efecto no dispara un render en cascada. Por eso `cargando` no se pone a
   * true al refrescar — sólo importa en la carga inicial, que es cuando no hay
   * nada que pintar.
   */
  const refrescar = useCallback(async () => {
    try {
      const datos = await api.bootstrap();
      setDatos(datos);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se ha podido cargar el módulo");
    } finally {
      setCargando(false);
    }
  }, []);

  /*
   * La carga inicial va inline y no llamando a `refrescar`: el linter no puede
   * seguir la llamada a través del `useCallback` y la da por un `setState`
   * síncrono dentro del efecto. Es el mismo patrón que usa `CashContext`.
   */
  useEffect(() => {
    let vivo = true;
    void (async () => {
      try {
        const datos = await api.bootstrap();
        if (!vivo) return;
        setDatos(datos);
        setError(null);
      } catch (e) {
        if (!vivo) return;
        setError(e instanceof Error ? e.message : "No se ha podido cargar el módulo");
      } finally {
        if (vivo) setCargando(false);
      }
    })();
    return () => {
      vivo = false;
    };
  }, []);

  const valor = useMemo<Estado>(
    () => ({
      cargando,
      error,
      rol: datos?.rol ?? null,
      permisos: datos?.permisos ?? [],
      centro: datos?.centro ?? null,
      autorrelleno: Boolean(datos?.autorrelleno),
      puede: (p: string) => (datos?.permisos ?? []).includes(p),
      refrescar,
      fijarCentro: (c: Centro) => setDatos((d) => (d ? { ...d, centro: c } : d)),
    }),
    [cargando, error, datos, refrescar]
  );

  return <Ctx.Provider value={valor}>{children}</Ctx.Provider>;
}

export function useTacografos(): Estado {
  const v = useContext(Ctx);
  if (!v) throw new Error("useTacografos fuera de TacografosProvider");
  return v;
}
