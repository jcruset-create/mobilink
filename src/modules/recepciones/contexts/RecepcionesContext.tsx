/**
 * Estado compartido del módulo: rol, permisos, centro, proveedores, centros,
 * contadores y vocabulario. Se carga una vez al entrar. Los pedidos y
 * albaranes NO viven aquí: cada pantalla pide los suyos. Misma forma que
 * `ThereforeContext` y `CashContext`.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import * as api from "../services/api";
import type { Bootstrap, Contadores } from "../types";

type Estado = {
  cargando: boolean;
  error: string | null;
  rol: string | null;
  permisos: string[];
  centroId: string | null;
  usuario: Bootstrap["usuario"] | null;
  proveedores: Bootstrap["proveedores"];
  centros: Bootstrap["centros"];
  contadores: Contadores | null;
  vocabulario: Bootstrap["vocabulario"] | null;
  puede: (permiso: string) => boolean;
  etiquetaEstadoPedido: (e: string) => string;
  etiquetaEstadoAlbaran: (e: string) => string;
  etiquetaTipoIncidencia: (t: string) => string;
  refrescar: () => Promise<void>;
  fijarContadores: (c: Contadores) => void;
};

const Ctx = createContext<Estado | null>(null);

const mismos = (a: Contadores | null | undefined, b: Contadores) =>
  !!a && a.pendientes === b.pendientes && a.recibidos === b.recibidos && a.incidenciasAbiertas === b.incidenciasAbiertas && a.pedidosPendientes === b.pedidosPendientes;

export function RecepcionesProvider({ children }: { children: ReactNode }) {
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

  const fijarContadores = useCallback((c: Contadores) => {
    setDatos((d) => (!d || mismos(d.contadores, c) ? d : { ...d, contadores: c }));
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
      centroId: datos?.centroId ?? null,
      usuario: datos?.usuario ?? null,
      proveedores: datos?.proveedores ?? [],
      centros: datos?.centros ?? [],
      contadores: datos?.contadores ?? null,
      vocabulario: datos?.vocabulario ?? null,
      puede: (p: string) => (datos?.permisos ?? []).includes(p),
      etiquetaEstadoPedido: (e: string) => et?.estadoPedido[e] ?? e,
      etiquetaEstadoAlbaran: (e: string) => et?.estadoAlbaran[e] ?? e,
      etiquetaTipoIncidencia: (t: string) => et?.tipoIncidencia[t] ?? t,
      refrescar,
      fijarContadores,
    };
  }, [cargando, error, datos, refrescar, fijarContadores]);

  return <Ctx.Provider value={valor}>{children}</Ctx.Provider>;
}

export function useRecepciones(): Estado {
  const v = useContext(Ctx);
  if (!v) throw new Error("useRecepciones fuera de RecepcionesProvider");
  return v;
}
