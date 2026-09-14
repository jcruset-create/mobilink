// Lógica pura del editor de accesos por módulo (estado inicial y conversión
// al formato del RPC). Separada del componente para poder probarla: la
// configuración de pruebas no monta plugins de React a propósito.
import { MODULOS_APP, type ModuloApp } from "../config/modulosApp";
import type { AccesoModulo } from "../services/data";

export type AccesoEdit = {
  activo: boolean;
  rol: string;
  marcadas: Record<string, boolean>; // pantalla → marcada
  empresa_id: string;
};

export function inicializarAccesos(m: ModuloApp, existente?: AccesoModulo): AccesoEdit {
  const marcadas: Record<string, boolean> = {};
  for (const p of m.pantallas) {
    marcadas[p.key] = existente?.pantallas ? existente.pantallas.includes(p.key) : true;
  }
  return {
    activo: Boolean(existente),
    rol: existente?.rol ?? m.roles[0].value,
    marcadas,
    empresa_id: existente?.empresa_id ?? "",
  };
}

/** Estado inicial del editor a partir de los accesos ya guardados (si los hay). */
export function estadoInicialAccesos(existentes?: AccesoModulo[]): Record<string, AccesoEdit> {
  const init: Record<string, AccesoEdit> = {};
  for (const m of MODULOS_APP) {
    init[m.key] = inicializarAccesos(m, existentes?.find((a) => a.modulo === m.key));
  }
  return init;
}

/** Estado del editor → lo que espera el RPC app_guardar_usuario. */
export function accesosAPayload(accesos: Record<string, AccesoEdit>): AccesoModulo[] {
  const payload: AccesoModulo[] = [];
  for (const m of MODULOS_APP) {
    const a = accesos[m.key];
    if (!a?.activo) continue;
    const marcadas = m.pantallas.filter((p) => a.marcadas[p.key]).map((p) => p.key);
    payload.push({
      modulo: m.key,
      rol: a.rol,
      // todas marcadas = null, que en la base significa "todas las del rol":
      // así añadir una pantalla nueva al módulo no deja fuera a quien ya tenía
      // acceso completo.
      pantallas: marcadas.length === m.pantallas.length ? null : marcadas,
      empresa_id: m.conEmpresa && a.rol === "cliente" && a.empresa_id ? a.empresa_id : null,
    });
  }
  return payload;
}

