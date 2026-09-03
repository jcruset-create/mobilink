/**
 * Conector de TyreControl: la tubería, no el negocio.
 *
 * Lo que hace: autenticarse como el usuario de integración, llamar a un RPC,
 * normalizar el error y decir si merece otro intento.
 *
 * Lo que NO hace, y es deliberado: decidir qué hay que mandarle a TC. Eso es
 * dominio de Assist —qué significa cerrar una asistencia, qué trabajos lleva
 * una OTF— y si se metiera aquí, el conector acabaría conociendo las reglas de
 * negocio de Assist y ya no serviría para otra cosa.
 *
 * ── El cerrojo de escritura ─────────────────────────────────────────────────
 *
 * Ninguna operación que toque datos sale de aquí mientras
 * `TYRE_CONTROL_WRITE_ENABLED` no esté puesto a `true`. Está comprobado EN EL
 * CONECTOR y no en quien llama: la protección tiene que estar en el sitio por
 * el que pasa todo, no en cada sitio que se acuerde de comprobarla.
 *
 * Y en esta fase, aunque se active, no hay ninguna operación de escritura
 * implementada: el interruptor prepara la fase siguiente, no la adelanta.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { clienteTyreControl, olvidarSesionTc } from "./sesion.ts";
import { clasificar, escribe, esSinPermiso, type OperacionTc } from "./operaciones.ts";

export type ResultadoRpc<T = unknown> =
  | { ok: true; datos: T }
  | { ok: false; codigo: string; mensaje: string; reintentable: boolean };

/** ¿Está permitido escribir en TyreControl? Por defecto, NO. */
export function escrituraHabilitada(): boolean {
  return String(process.env.TYRE_CONTROL_WRITE_ENABLED ?? "").toLowerCase() === "true";
}

function normalizar(e: any): { codigo: string; mensaje: string } {
  const mensaje = String(e?.message ?? e ?? "Error desconocido");
  if (e?.codigo) return { codigo: String(e.codigo), mensaje };
  if (esSinPermiso(mensaje)) return { codigo: "tc_permission_denied", mensaje };
  if (/medida|incompatible/i.test(mensaje)) return { codigo: "tc_incompatible_size", mensaje };
  if (/neum[aá]tico no encontrado/i.test(mensaje)) return { codigo: "tc_tyre_not_found", mensaje };
  if (/veh[ií]culo no encontrado/i.test(mensaje)) return { codigo: "tc_vehicle_not_found", mensaje };
  return { codigo: "tc_error", mensaje };
}

/**
 * Llama a un RPC de TyreControl como el usuario de integración.
 *
 * Si el token ha caducado se olvida la sesión y se reintenta UNA vez: es el
 * caso normal de un lote largo que empieza con el token a punto de vencer, y
 * resolverlo aquí evita marcar como fallida una operación que solo necesitaba
 * volver a saludar. Una vez, no en bucle: si tampoco entra a la segunda, es
 * otro problema.
 */
export async function llamarRpc<T = unknown>(
  operacion: OperacionTc,
  rpc: string,
  argumentos: Record<string, unknown> = {},
): Promise<ResultadoRpc<T>> {
  if (escribe(operacion) && !escrituraHabilitada()) {
    return {
      ok: false, codigo: "tc_write_disabled", reintentable: false,
      mensaje: "La escritura en TyreControl está desactivada (TYRE_CONTROL_WRITE_ENABLED)",
    };
  }

  const intentar = async (cliente: SupabaseClient) => cliente.rpc(rpc, argumentos);

  try {
    let r = await intentar(await clienteTyreControl());

    if (r.error && /jwt|token|not authenticated/i.test(r.error.message ?? "")) {
      olvidarSesionTc();
      r = await intentar(await clienteTyreControl());
    }

    if (r.error) {
      const { codigo, mensaje } = normalizar(r.error);
      // Al registro va el nombre del RPC y el motivo; nunca los argumentos, que
      // pueden llevar datos del cliente, ni el token.
      console.error(`[TyreControl] ${rpc} falló: ${codigo}`);
      return { ok: false, codigo, mensaje, reintentable: clasificar(codigo, mensaje) === "retryable" };
    }
    return { ok: true, datos: r.data as T };
  } catch (e: any) {
    const { codigo, mensaje } = normalizar(e);
    console.error(`[TyreControl] ${rpc} error de transporte: ${codigo}`);
    return { ok: false, codigo, mensaje, reintentable: clasificar(codigo, mensaje) === "retryable" };
  }
}

/**
 * Comprobación del canal, sin tocar ni un dato.
 *
 * Llama a las funciones de identidad de TC y a un RPC de solo lectura. No monta
 * nada, no desmonta nada, no crea intervenciones. Es lo máximo que se puede
 * afirmar sobre el canal sin escribir de verdad — y escribir de verdad no toca
 * en esta fase.
 */
export type InformeCanal = {
  ok: boolean;
  identidad: { authUid: string | null; esSuperadmin: boolean | null; esAdmin: boolean | null; empresaId: string | null };
  /** La ficha del usuario en `tc_usuarios`, para poder comprobar los permisos. */
  usuarioTc: { nombre: string | null; rol: string | null; esSuperadmin: boolean; accesoApk: boolean } | null;
  empresas: { id: string; nombre: string }[];
  lecturaOk: boolean;
  escrituraHabilitada: boolean;
  /**
   * Permisos DE MÁS.
   *
   * Un usuario de integración con rol de administrador funcionaría igual de
   * bien, y ése es el problema: nadie lo notaría hasta que un fallo tocara algo
   * que no debía. Se dice aquí para que se corrija antes de la prueba real, no
   * después.
   */
  avisos: string[];
  mensaje: string;
};

export async function probarCanal(): Promise<InformeCanal> {
  const vacio = { authUid: null, esSuperadmin: null, esAdmin: null, empresaId: null };
  try {
    const cliente = await clienteTyreControl();
    const { data: sesion } = await cliente.auth.getUser();
    const uid = sesion?.user?.id ?? null;

    const [sup, adm, emp, lectura] = await Promise.all([
      cliente.rpc("tc_is_superadmin"),
      cliente.rpc("tc_is_admin"),
      cliente.rpc("tc_auth_empresa_id"),
      cliente.rpc("tc_revision_estado"),
    ]);

    /*
     * Las empresas que el usuario de integración tiene asignadas. Se leen con
     * SU sesión, no con la clave de servicio: así lo que se ve es exactamente
     * lo que verá al operar, que es lo que se quiere comprobar.
     */
    const { data: asignadas } = await cliente
      .from("tc_operador_empresas").select("empresa_id, tc_empresas(nombre)");

    const identidad = {
      authUid: uid,
      esSuperadmin: sup.error ? null : sup.data === true,
      esAdmin: adm.error ? null : adm.data === true,
      empresaId: emp.error ? null : (emp.data == null ? null : String(emp.data)),
    };
    const empresas = (asignadas ?? []).map((a: any) => ({
      id: String(a.empresa_id),
      nombre: String(a.tc_empresas?.nombre ?? ""),
    }));

    /*
     * La ficha se lee con la sesión del propio usuario: si no puede verse a sí
     * mismo, tampoco está bien dado de alta.
     */
    const { data: ficha } = await cliente
      .from("tc_usuarios").select("nombre, rol, es_superadmin, acceso_apk")
      .eq("id", uid).maybeSingle();

    const usuarioTc = ficha ? {
      nombre: ficha.nombre ?? null,
      rol: ficha.rol ?? null,
      esSuperadmin: ficha.es_superadmin === true,
      accesoApk: ficha.acceso_apk === true,
    } : null;

    const avisos: string[] = [];
    if (!usuarioTc) {
      avisos.push("El usuario entra en Supabase pero NO tiene ficha en tc_usuarios: TyreControl no lo reconoce.");
    } else {
      if (usuarioTc.esSuperadmin) {
        avisos.push("Es superadministrador de TyreControl: son muchos más permisos de los que necesita.");
      }
      if (usuarioTc.rol === "administrador") {
        avisos.push("Tiene rol de administrador: bastaría con «operador» y las empresas asignadas.");
      }
      if (usuarioTc.accesoApk) {
        avisos.push("Tiene acceso a la APK: un usuario de integración no es un técnico.");
      }
      if (empresas.length === 0 && identidad.empresaId == null) {
        avisos.push("No tiene ninguna empresa asignada en tc_operador_empresas.");
      }
    }

    const reconocido = identidad.authUid != null && usuarioTc != null
      && (identidad.esSuperadmin === true || identidad.esAdmin === true
          || identidad.empresaId != null || empresas.length > 0);

    return {
      ok: reconocido, identidad, usuarioTc, empresas, avisos,
      lecturaOk: !lectura.error,
      escrituraHabilitada: escrituraHabilitada(),
      mensaje: !reconocido
        ? "TyreControl no reconoce al usuario de integración."
        : avisos.length > 0
          ? `Reconocido con acceso a ${empresas.length} empresa(s), pero con ${avisos.length} aviso(s) de permisos.`
          : `Reconocido con los permisos justos y acceso a ${empresas.length} empresa(s).`,
    };
  } catch (e: any) {
    const { codigo, mensaje } = normalizar(e);
    return {
      ok: false, identidad: vacio, usuarioTc: null, empresas: [], avisos: [], lecturaOk: false,
      escrituraHabilitada: escrituraHabilitada(),
      mensaje: `${codigo}: ${mensaje}`,
    };
  }
}
