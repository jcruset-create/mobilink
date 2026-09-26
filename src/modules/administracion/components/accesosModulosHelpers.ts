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


// ── Licencia de la empresa ───────────────────────────────────────────────
//
// Lo que devuelve el RPC `app_licencias_usuario`: una fila por módulo
// licenciado de la empresa del usuario que se está editando.
export type LicenciaModulo = {
  modulo: string;
  estado: string;
  fecha_fin: string | null;
  vigente: boolean;
  max_usuarios: number | null;
  usados: number;
};

export type EstadoLicencia = {
  /** No se puede marcar: la empresa no tiene con qué. */
  bloqueado: boolean;
  /** Por qué, dicho para una persona. Null cuando no hay nada que contar. */
  motivo: string | null;
  /**
   * "aviso" para lo que pide atención -vencida, sin plazas, conservado a pesar
   * de todo-; "info" para un dato de paso, como el aforo. Si todo se pintara
   * igual de llamativo, el que importa se perdería entre los demás.
   */
  tono: "aviso" | "info";
};

function fechaCorta(iso: string | null): string {
  if (!iso) return "";
  const [a, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${a}`;
}

/**
 * Qué se puede hacer con un módulo según la licencia de la empresa.
 *
 * `yaGuardado` es la regla que evita el destrozo: un acceso que el usuario ya
 * tiene NUNCA se bloquea, aunque su licencia haya vencido. Si se bloqueara, la
 * siguiente edición de ese usuario -cambiarle el teléfono- le quitaría el
 * acceso sin que nadie lo hubiera decidido. Lo que se impide es AÑADIR sobre
 * una licencia vencida o sin plazas.
 */
export function estadoDeLicencia(
  modulo: string,
  licencias: LicenciaModulo[] | null,
  yaGuardado: boolean
): EstadoLicencia {
  // null = no se han podido leer. No es lo mismo que "no tiene ninguna": si se
  // confundieran, un fallo al consultar apagaría el editor entero y nadie
  // podría dar accesos.
  if (licencias === null) return { bloqueado: false, motivo: null, tono: "info" };

  const lic = licencias.find((l) => l.modulo === modulo);

  if (!lic) {
    return yaGuardado
      ? { bloqueado: false, motivo: "Sin licencia en la empresa; el acceso se conserva porque ya lo tenía.", tono: "aviso" }
      : { bloqueado: true, motivo: "Tu empresa no tiene contratado este módulo.", tono: "info" };
  }

  if (!lic.vigente) {
    const cuando = lic.fecha_fin ? ` el ${fechaCorta(lic.fecha_fin)}` : "";
    return yaGuardado
      ? { bloqueado: false, motivo: `Licencia vencida${cuando}; el acceso se conserva.`, tono: "aviso" }
      : { bloqueado: true, motivo: `La licencia venció${cuando}.`, tono: "aviso" };
  }

  if (lic.max_usuarios != null) {
    const quedan = lic.max_usuarios - lic.usados;
    if (!yaGuardado && quedan <= 0) {
      return {
        bloqueado: true,
        motivo: `Licencia para ${lic.max_usuarios} usuarios y ya hay ${lic.usados}. No quedan plazas.`,
        tono: "aviso",
      };
    }
    return { bloqueado: false, motivo: `${lic.usados} de ${lic.max_usuarios} usuarios.`, tono: "info" };
  }

  return { bloqueado: false, motivo: null, tono: "info" };
}

/** Módulos que el usuario YA tiene guardados (los que no se pueden perder). */
export function modulosGuardados(existentes?: AccesoModulo[]): Set<string> {
  return new Set((existentes ?? []).map((a) => a.modulo));
}
