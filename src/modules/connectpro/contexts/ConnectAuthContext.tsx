/**
 * Connect Pro — contexto de autenticación del backoffice.
 * Carga /api/connect/bo/me (usuario Connect + centro de control) y lo expone.
 */

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { boFetch, ApiError } from "../services/api";
import type { ConnectUser, ConnectRole } from "../types";

type MeResponse = { user: ConnectUser; controlCenter: { id: number; name: string } | null };

type Ctx = {
  user: ConnectUser | null;
  controlCenter: { id: number; name: string } | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
};

const ConnectAuthContext = createContext<Ctx>({ user: null, controlCenter: null, loading: true, error: null, reload: () => {} });

const RANK: Record<ConnectRole, number> = {
  superadmin: 100, cc_admin: 80, supervisor: 60, operator: 40, analyst: 20, provider_user: 10,
};

export function hasRole(user: ConnectUser | null, min: ConnectRole): boolean {
  if (!user) return false;
  return RANK[user.role] >= RANK[min];
}

export function ConnectAuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<Omit<Ctx, "reload">>({ user: null, controlCenter: null, loading: true, error: null });

  const load = () => {
    setState((s) => ({ ...s, loading: true }));
    boFetch<MeResponse>("/me")
      .then((r) => setState({ user: r.user, controlCenter: r.controlCenter, loading: false, error: null }))
      .catch((e: unknown) => {
        const msg = e instanceof ApiError && e.status === 403
          ? "Tu usuario no tiene acceso a Connect Pro. Pide a un administrador que te dé de alta."
          : e instanceof ApiError && e.status === 401
            ? "Necesitas iniciar sesión en el hub de Mobilink."
            : "No se pudo cargar tu sesión de Connect Pro.";
        setState({ user: null, controlCenter: null, loading: false, error: msg });
      });
  };

  useEffect(load, []);

  return (
    <ConnectAuthContext.Provider value={{ ...state, reload: load }}>
      {children}
    </ConnectAuthContext.Provider>
  );
}

export function useConnectAuth() {
  return useContext(ConnectAuthContext);
}

/** Pantalla de acceso denegado / sin sesión. */
export function ConnectAccessGate({ children }: { children: ReactNode }) {
  const { user, loading, error } = useConnectAuth();
  const navigate = useNavigate();
  if (loading) {
    return <div className="flex min-h-screen items-center justify-center bg-slate-900 text-sm text-slate-400">Cargando Connect Pro…</div>;
  }
  if (!user) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-slate-900 p-6 text-center">
        <div className="text-3xl">🔗</div>
        <h1 className="text-lg font-black text-slate-100">Connect Pro</h1>
        <p className="max-w-md text-sm text-slate-400">{error}</p>
        <button
          onClick={() => navigate("/acceso")}
          className="rounded-xl bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-500"
        >
          Ir al acceso
        </button>
      </div>
    );
  }
  return <>{children}</>;
}
