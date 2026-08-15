/**
 * Estado compartido de Mobilink Cash.
 *
 * Guarda lo que necesitan todas las pantallas: el catálogo de denominaciones
 * (que viene de base de datos, no de constantes repartidas por los
 * componentes), las cajas, los permisos del usuario y la jornada abierta.
 *
 * La jornada vive aquí porque casi todas las pantallas escriben en ella, y
 * después de cada operación el stock cambia: `refrescar()` es lo que hace que
 * el arqueo y el cierre no trabajen nunca con un stock viejo.
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
import type { Bootstrap, Denominacion, ResumenJornada } from "../types";

type Valor = {
  cargando: boolean;
  error: string;
  denominaciones: Denominacion[];
  cajas: Bootstrap["cajas"];
  permisos: string[];
  rol: string | null;
  erp: Bootstrap["erp"] | null;
  cambioMaximoCentimos: number;

  cajaId: number | null;
  seleccionarCaja: (id: number) => void;

  jornada: ResumenJornada | null;
  refrescar: () => Promise<void>;
  /** Existencias por valor, para limitar lo que se puede sacar. */
  disponible: Record<number, number>;
  puede: (permiso: string) => boolean;
};

const CashContext = createContext<Valor | null>(null);

const CLAVE_CAJA = "mobilink-cash:caja";

export function CashProvider({ children }: { children: ReactNode }) {
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");
  const [boot, setBoot] = useState<Bootstrap | null>(null);
  const [cajaId, setCajaId] = useState<number | null>(null);
  const [jornada, setJornada] = useState<ResumenJornada | null>(null);

  const cargarJornada = useCallback(async (id: number) => {
    try {
      const r = await api.jornadaAbierta(id);
      setJornada("sesion" in r && r.sesion === null ? null : (r as ResumenJornada));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error cargando la jornada");
      setJornada(null);
    }
  }, []);

  useEffect(() => {
    let vivo = true;
    (async () => {
      try {
        const b = await api.bootstrap();
        if (!vivo) return;
        setBoot(b);

        // Se recuerda la caja elegida: quien trabaja en el mostrador de Reus no
        // quiere elegirla otra vez cada mañana.
        const guardada = Number(localStorage.getItem(CLAVE_CAJA));
        const elegida = b.cajas.find((c) => c.id === guardada)?.id ?? b.cajas[0]?.id ?? null;
        setCajaId(elegida);
        if (elegida) await cargarJornada(elegida);
      } catch (e) {
        if (vivo) setError(e instanceof Error ? e.message : "Error cargando Mobilink Cash");
      } finally {
        if (vivo) setCargando(false);
      }
    })();
    return () => {
      vivo = false;
    };
  }, [cargarJornada]);

  const seleccionarCaja = useCallback(
    (id: number) => {
      setCajaId(id);
      localStorage.setItem(CLAVE_CAJA, String(id));
      setJornada(null);
      void cargarJornada(id);
    },
    [cargarJornada]
  );

  const refrescar = useCallback(async () => {
    if (cajaId) await cargarJornada(cajaId);
  }, [cajaId, cargarJornada]);

  const disponible = useMemo(() => {
    const m: Record<number, number> = {};
    for (const l of jornada?.stock ?? []) m[l.valor] = l.cantidad;
    return m;
  }, [jornada]);

  const permisos = boot?.permisos ?? [];
  const puede = useCallback((p: string) => permisos.includes(p), [permisos]);

  const valor: Valor = {
    cargando,
    error,
    denominaciones: boot?.denominaciones ?? [],
    cajas: boot?.cajas ?? [],
    permisos,
    rol: boot?.rol ?? null,
    erp: boot?.erp ?? null,
    cambioMaximoCentimos: boot?.cambioMaximoCentimos ?? 0,
    cajaId,
    seleccionarCaja,
    jornada,
    refrescar,
    disponible,
    puede,
  };

  return <CashContext.Provider value={valor}>{children}</CashContext.Provider>;
}

export function useCash(): Valor {
  const ctx = useContext(CashContext);
  if (!ctx) throw new Error("useCash debe usarse dentro de CashProvider");
  return ctx;
}
