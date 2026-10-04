/**
 * Piezas comunes del Asistente IA: aviso de estado (global / empresa /
 * proveedor) y chips de sesión y de riesgo.
 */

import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import type { EstadoAsistente, RiesgoHerramienta, SesionIA } from "../../types";
import { Aviso, Cargando, Pill } from "../../components/ui";
import { useSelfStorage } from "../../contexts/SelfStorageContext";
import { useEstadoAsistente } from "./useEstadoAsistente";

/**
 * Con el interruptor global apagado no se enseña nada. Sin activar en la
 * empresa se puede preparar (conocimiento, herramientas…) con un aviso; si
 * `exigeActivo`, la pantalla no se muestra.
 */
export function ConEstadoAsistente({ exigeActivo = false, children }: { exigeActivo?: boolean; children: (e: EstadoAsistente) => ReactNode }) {
  const { puede } = useSelfStorage();
  const { estado, error } = useEstadoAsistente();
  if (error) return <Aviso tono="mal">{error}</Aviso>;
  if (!estado) return <Cargando />;
  if (!estado.global) return <Aviso tono="aviso">El Asistente IA está desactivado en este servidor (SELF_STORAGE_AI_ASSISTANT_ENABLED). El Call Center sigue funcionando sin él.</Aviso>;
  const avisoEmpresa = !estado.empresa && (
    <Aviso tono="info">
      El Asistente IA no está activado para esta empresa: puedes prepararlo (conocimiento, herramientas, proveedores) pero no conversar.{" "}
      {puede("ss.settings.manage") && (
        <Link className="underline" to="/self-storage/asistente/configuracion">
          Activarlo
        </Link>
      )}
    </Aviso>
  );
  if (exigeActivo && !estado.empresa) return <>{avisoEmpresa}</>;
  return (
    <div className="space-y-3">
      {avisoEmpresa}
      {estado.empresa && !estado.providerAvailable && (
        <Aviso tono="aviso">
          El proveedor «{estado.provider}» no está disponible (¿falta su clave en el servidor?).{" "}
          {estado.fallbackProvider ? `Se usará el de respaldo («${estado.fallbackProvider}»).` : "Sin respaldo configurado, no se pueden abrir sesiones."}
        </Aviso>
      )}
      {children(estado)}
    </div>
  );
}

const COLOR_SESION: Record<SesionIA["status"], [string, string]> = {
  active: ["En curso", "bg-sky-500/20 text-sky-300"],
  finished: ["Terminada", "bg-emerald-500/20 text-emerald-300"],
  escalated: ["Escalada a persona", "bg-amber-500/20 text-amber-300"],
  error: ["Error", "bg-rose-500/20 text-rose-300"],
};
export function ChipSesion({ estado }: { estado: SesionIA["status"] }) {
  return <Pill className={COLOR_SESION[estado][1]}>{COLOR_SESION[estado][0]}</Pill>;
}

const COLOR_RIESGO: Record<RiesgoHerramienta | "UNKNOWN", string> = {
  READ_ONLY: "bg-emerald-500/20 text-emerald-300",
  WRITE_SAFE: "bg-amber-500/20 text-amber-300",
  SENSITIVE: "bg-rose-600 text-white",
  UNKNOWN: "bg-slate-600/40 text-slate-300",
};
const NOMBRE_RIESGO: Record<RiesgoHerramienta | "UNKNOWN", string> = { READ_ONLY: "Lectura", WRITE_SAFE: "Escritura segura", SENSITIVE: "Sensible", UNKNOWN: "Desconocida" };
export function ChipRiesgo({ r }: { r: RiesgoHerramienta | "UNKNOWN" }) {
  return <Pill className={COLOR_RIESGO[r]}>{NOMBRE_RIESGO[r]}</Pill>;
}

export function ChipResultado({ o }: { o: "success" | "error" | "blocked" }) {
  const c = { success: ["Bien", "bg-emerald-500/20 text-emerald-300"], error: ["Error", "bg-rose-500/20 text-rose-300"], blocked: ["Bloqueada", "bg-slate-600/60 text-slate-200"] }[o];
  return <Pill className={c[1]}>{c[0]}</Pill>;
}
