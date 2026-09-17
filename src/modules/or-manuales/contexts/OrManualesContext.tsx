/**
 * Estado compartido del módulo: rol, permisos, indicadores, configuración y
 * vocabulario. Se carga una vez al entrar.
 *
 * Los blocs y los documentos NO viven aquí: cada pantalla pide los suyos, como
 * en Recepciones y Therefore. Lo que sí vive aquí son los INDICADORES, porque
 * los enseña el menú lateral en forma de contador y tienen que refrescarse
 * desde cualquier pantalla que cambie algo.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import * as api from "../services/api";
import type { Bootstrap, Configuracion, Indicadores, Vocabulario } from "../types";

type Estado = {
  cargando: boolean;
  error: string | null;
  rol: string | null;
  permisos: string[];
  usuario: Bootstrap["usuario"] | null;
  indicadores: Indicadores | null;
  config: Configuracion | null;
  vocabulario: Vocabulario | null;
  puede: (permiso: string) => boolean;
  etiquetaEstadoBloc: (e: string) => string;
  etiquetaEstadoOr: (e: string) => string;
  etiquetaEstadoDocumento: (e: string) => string;
  etiquetaMetodo: (m: string | null) => string;
  refrescar: () => Promise<void>;
  refrescarIndicadores: () => Promise<void>;
  fijarConfig: (c: Configuracion) => void;
};

const Ctx = createContext<Estado | null>(null);

export function OrManualesProvider({ children }: { children: ReactNode }) {
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [datos, setDatos] = useState<Bootstrap | null>(null);

  const cargar = useCallback(async () => {
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

  /**
   * Sólo los números. Se llama después de cada acción que cambia algo, y no
   * recarga el bootstrap entero: los permisos y el vocabulario no cambian
   * porque alguien archive una hoja.
   */
  const refrescarIndicadores = useCallback(async () => {
    try {
      const { indicadores } = await api.indicadores();
      setDatos((d) => (d ? { ...d, indicadores } : d));
    } catch {
      // Que no se pueda refrescar un contador no es motivo para molestar a nadie.
    }
  }, []);

  const fijarConfig = useCallback((config: Configuracion) => {
    setDatos((d) => (d ? { ...d, config } : d));
  }, []);

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

  const valor = useMemo<Estado>(() => {
    const et = datos?.vocabulario?.etiquetas;
    return {
      cargando,
      error,
      rol: datos?.rol ?? null,
      permisos: datos?.permisos ?? [],
      usuario: datos?.usuario ?? null,
      indicadores: datos?.indicadores ?? null,
      config: datos?.config ?? null,
      vocabulario: datos?.vocabulario ?? null,
      puede: (p: string) => (datos?.permisos ?? []).includes(p),
      etiquetaEstadoBloc: (e: string) => et?.estadoBloc[e] ?? e,
      etiquetaEstadoOr: (e: string) => et?.estadoOr[e] ?? e,
      etiquetaEstadoDocumento: (e: string) => et?.estadoDocumento[e] ?? e,
      etiquetaMetodo: (m: string | null) => (m ? (et?.metodoDeteccion[m] ?? m) : "—"),
      refrescar: cargar,
      refrescarIndicadores,
      fijarConfig,
    };
  }, [cargando, error, datos, cargar, refrescarIndicadores, fijarConfig]);

  return <Ctx.Provider value={valor}>{children}</Ctx.Provider>;
}

export function useOrManuales(): Estado {
  const v = useContext(Ctx);
  if (!v) throw new Error("useOrManuales fuera de OrManualesProvider");
  return v;
}
