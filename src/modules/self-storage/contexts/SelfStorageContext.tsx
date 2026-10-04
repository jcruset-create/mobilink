/**
 * Estado compartido del módulo: rol, permisos, centros, vocabulario y el
 * centro con el que se está trabajando. Se carga una vez al entrar; cada
 * pantalla pide sus propios datos. Misma forma que `RecepcionesContext`.
 *
 * El centro elegido se recuerda en el navegador (comodidad, no seguridad: el
 * servidor filtra siempre por la empresa de la sesión).
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import * as api from "../services/api";
import {
  ETIQUETA_ACCESS_METHOD,
  ETIQUETA_ACCESS_REASON,
  ETIQUETA_CONNECTION_TYPE,
  ETIQUETA_DOOR_TYPE,
  ETIQUETA_CALL_DIRECTION,
  ETIQUETA_CALL_HANDLER,
  ETIQUETA_CALL_STATUS,
  ETIQUETA_INCIDENT_STATUS,
  ETIQUETA_INCIDENT_TYPE,
  ETIQUETA_PRIORITY,
  type CallDirection,
  type CallHandler,
  type CallStatus,
  type IncidentStatus,
  type IncidentType,
  type Priority,
  type AccessMethod,
  type AccessReason,
  type ConnectionType,
  type DoorType,
  ETIQUETA_BLOCK_REASON,
  ETIQUETA_INVOICE_STATUS,
  ETIQUETA_ITEM_TYPE,
  ETIQUETA_PAYMENT_METHOD,
  ETIQUETA_PAYMENT_STATUS,
  type BlockReason,
  type Bootstrap,
  type ContractStatus,
  type CustomerStatus,
  type CustomerType,
  type InvoiceItemType,
  type InvoiceStatus,
  type PaymentMethod,
  type PaymentStatus,
  type UnitStatus,
} from "../types";

const CLAVE_CENTRO = "self-storage.centro";

type Estado = {
  cargando: boolean;
  error: string | null;
  rol: Bootstrap["rol"];
  permisos: string[];
  usuario: Bootstrap["usuario"] | null;
  empresa: { id: string; nombre: string } | null;
  empresas: { id: string; nombre: string }[] | null;
  /** Superadministrador: cambia de empresa y recarga todo el módulo. */
  fijarEmpresa: (id: string) => void;
  centros: Bootstrap["centros"];
  centroId: string | null;
  fijarCentro: (id: string | null) => void;
  puede: (permiso: string) => boolean;
  etqUnidad: (e: UnitStatus) => string;
  etqCliente: (e: CustomerStatus) => string;
  etqTipoCliente: (t: CustomerType) => string;
  etqContrato: (e: ContractStatus) => string;
  etqFactura: (e: InvoiceStatus) => string;
  etqConcepto: (t: InvoiceItemType) => string;
  etqMetodo: (m: PaymentMethod | null | undefined) => string;
  etqPago: (e: PaymentStatus) => string;
  etqBloqueo: (r: BlockReason) => string;
  etqMotivoAcceso: (r: AccessReason) => string;
  etqMetodoAcceso: (m: AccessMethod) => string;
  etqTipoPuerta: (t: DoorType) => string;
  etqConexion: (t: ConnectionType) => string;
  etqEstadoLlamada: (e: CallStatus) => string;
  etqAtendida: (h: CallHandler) => string;
  etqSentido: (d: CallDirection) => string;
  etqPrioridad: (p: Priority) => string;
  etqTipoIncidencia: (t: IncidentType) => string;
  etqEstadoIncidencia: (e: IncidentStatus) => string;
  refrescar: () => Promise<void>;
};

const Ctx = createContext<Estado | null>(null);

function leerCentroGuardado(): string | null {
  try {
    return localStorage.getItem(CLAVE_CENTRO);
  } catch {
    return null;
  }
}

export function SelfStorageProvider({ children }: { children: ReactNode }) {
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [datos, setDatos] = useState<Bootstrap | null>(null);
  const [centroId, setCentroId] = useState<string | null>(leerCentroGuardado);

  const refrescar = useCallback(async () => {
    try {
      let b: Bootstrap;
      try {
        b = await api.bootstrap();
      } catch (e) {
        // La empresa elegida ya no vale (sin licencia, suspendida…): se vuelve a la propia.
        if (!(e instanceof api.ApiError && e.status === 404 && api.empresaElegida())) throw e;
        api.fijarEmpresa(null);
        b = await api.bootstrap();
      }
      setDatos(b);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se ha podido cargar el módulo");
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    void refrescar();
  }, [refrescar]);

  const fijarCentro = useCallback((id: string | null) => {
    setCentroId(id);
    try {
      if (id) localStorage.setItem(CLAVE_CENTRO, id);
      else localStorage.removeItem(CLAVE_CENTRO);
    } catch {
      /* sin almacenamiento: se elige cada vez */
    }
  }, []);

  const fijarEmpresa = useCallback((id: string) => {
    api.fijarEmpresa(id);
    // Otra empresa: otros centros, otros clientes… se empieza de cero.
    window.location.assign("/self-storage/dashboard");
  }, []);

  const valor = useMemo<Estado>(() => {
    const centros = datos?.centros ?? [];
    // Un centro recordado que ya no existe (o de otra empresa) se ignora.
    const centroValido = centros.some((c) => c.id === centroId) ? centroId : (centros.find((c) => c.status === "active")?.id ?? null);
    const et = datos?.vocabulario.etiquetas;
    return {
      cargando,
      error,
      rol: datos?.rol ?? null,
      permisos: datos?.permisos ?? [],
      usuario: datos?.usuario ?? null,
      empresa: datos?.empresa ?? null,
      empresas: datos?.empresas ?? null,
      fijarEmpresa,
      centros,
      centroId: centroValido,
      fijarCentro,
      puede: (p: string) => (datos?.permisos ?? []).includes(p),
      etqUnidad: (e) => et?.unitStatus[e] ?? e,
      etqCliente: (e) => et?.customerStatus[e] ?? e,
      etqTipoCliente: (t) => et?.customerType[t] ?? t,
      etqContrato: (e) => et?.contractStatus[e] ?? e,
      // Si el servidor aún no manda la etiqueta (despliegue a medias), la del vocabulario compartido.
      etqFactura: (e) => et?.invoiceStatus?.[e] ?? ETIQUETA_INVOICE_STATUS[e] ?? e,
      etqConcepto: (t) => et?.itemType?.[t] ?? ETIQUETA_ITEM_TYPE[t] ?? t,
      etqMetodo: (m) => (m ? (et?.paymentMethod?.[m] ?? ETIQUETA_PAYMENT_METHOD[m] ?? m) : "—"),
      etqPago: (e) => et?.paymentStatus?.[e] ?? ETIQUETA_PAYMENT_STATUS[e] ?? e,
      etqBloqueo: (r) => et?.blockReason?.[r] ?? ETIQUETA_BLOCK_REASON[r] ?? r,
      etqMotivoAcceso: (r) => et?.accessReason?.[r] ?? ETIQUETA_ACCESS_REASON[r] ?? r,
      etqMetodoAcceso: (m) => et?.accessMethod?.[m] ?? ETIQUETA_ACCESS_METHOD[m] ?? m,
      etqTipoPuerta: (t) => et?.doorType?.[t] ?? ETIQUETA_DOOR_TYPE[t] ?? t,
      etqConexion: (t) => et?.connectionType?.[t] ?? ETIQUETA_CONNECTION_TYPE[t] ?? t,
      etqEstadoLlamada: (e) => et?.callStatus?.[e] ?? ETIQUETA_CALL_STATUS[e] ?? e,
      etqAtendida: (h) => et?.callHandler?.[h] ?? ETIQUETA_CALL_HANDLER[h] ?? h,
      etqSentido: (d) => et?.callDirection?.[d] ?? ETIQUETA_CALL_DIRECTION[d] ?? d,
      etqPrioridad: (p) => et?.priority?.[p] ?? ETIQUETA_PRIORITY[p] ?? p,
      etqTipoIncidencia: (t) => et?.incidentType?.[t] ?? ETIQUETA_INCIDENT_TYPE[t] ?? t,
      etqEstadoIncidencia: (e) => et?.incidentStatus?.[e] ?? ETIQUETA_INCIDENT_STATUS[e] ?? e,
      refrescar,
    };
  }, [cargando, error, datos, centroId, fijarCentro, fijarEmpresa, refrescar]);

  return <Ctx.Provider value={valor}>{children}</Ctx.Provider>;
}

export function useSelfStorage(): Estado {
  const v = useContext(Ctx);
  if (!v) throw new Error("useSelfStorage fuera de SelfStorageProvider");
  return v;
}
