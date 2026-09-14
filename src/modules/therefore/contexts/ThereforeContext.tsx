/**
 * Estado compartido del módulo: rol, permisos, contadores y vocabulario.
 *
 * Se carga una vez al entrar. Los expedientes NO viven aquí: cada pantalla pide
 * los suyos, porque la bandeja y el detalle tienen ritmos distintos y meterlos
 * en un contexto obligaría a invalidarlo desde sitios que no deberían saber de
 * él. Es la misma forma que `TacografosContext`.
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
import { mismosContadores } from "../services/bandeja";
import type { Bootstrap, Contadores } from "../types";

type Estado = {
  cargando: boolean;
  error: string | null;
  rol: string | null;
  permisos: string[];
  contadores: Contadores | null;
  vocabulario: Bootstrap["vocabulario"] | null;
  erpDisponible: boolean;
  puede: (permiso: string) => boolean;
  refrescar: () => Promise<void>;
  /** La bandeja los actualiza al listar, para no pedir el bootstrap otra vez. */
  fijarContadores: (c: Contadores) => void;
};

const Ctx = createContext<Estado | null>(null);

export function ThereforeProvider({ children }: { children: ReactNode }) {
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [datos, setDatos] = useState<Bootstrap | null>(null);

  const refrescar = useCallback(async () => {
    try {
      const d = await api.bootstrap();
      setDatos(d);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se ha podido cargar el módulo");
    } finally {
      setCargando(false);
    }
  }, []);

  /*
   * Identidad ESTABLE, y no es un detalle de estilo.
   *
   * La bandeja llama a esto al terminar de listar y lo tiene en las
   * dependencias de su `cargar`. Si la función se recreara en cada render
   * —como pasa con todo lo que se define dentro del `useMemo` de abajo—, la
   * cadena sería: listar → fijar contadores → nuevo estado → nueva función →
   * nuevo `cargar` → el efecto vuelve a disparar → listar otra vez. Un bucle
   * de una petición cada 250 ms que nadie ve venir porque la pantalla se
   * pinta bien.
   *
   * Además no toca el estado si los contadores son los mismos: así una
   * recarga que no cambia nada tampoco repinta el módulo entero.
   */
  const fijarContadores = useCallback((c: Contadores) => {
    setDatos((d) => (!d || mismosContadores(d.contadores, c) ? d : { ...d, contadores: c }));
  }, []);

  /*
   * La carga inicial va en línea y no llamando a `refrescar`: el linter no
   * puede seguir la llamada a través del `useCallback` y la da por un `setState`
   * síncrono dentro del efecto. Mismo patrón que Cash y Tacógrafos.
   */
  useEffect(() => {
    let vivo = true;
    void (async () => {
      try {
        const d = await api.bootstrap();
        if (!vivo) return;
        setDatos(d);
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
      contadores: datos?.contadores ?? null,
      vocabulario: datos?.vocabulario ?? null,
      erpDisponible: Boolean(datos?.erp?.disponible),
      puede: (p: string) => (datos?.permisos ?? []).includes(p),
      refrescar,
      fijarContadores,
    }),
    [cargando, error, datos, refrescar, fijarContadores]
  );

  return <Ctx.Provider value={valor}>{children}</Ctx.Provider>;
}

export function useTherefore(): Estado {
  const v = useContext(Ctx);
  if (!v) throw new Error("useTherefore fuera de ThereforeProvider");
  return v;
}
