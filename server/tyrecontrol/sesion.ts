/**
 * Sesión de integración con TyreControl.
 *
 * ── Por qué existe ──────────────────────────────────────────────────────────
 *
 * Los RPC de TC deciden el permiso con `auth.uid()`. La clave de servicio no es
 * nadie para TC, así que para escribir hay que presentarse como un usuario de
 * verdad: el usuario de integración «Mobilink Assist», que entra igual que la
 * APK, con `signInWithPassword`.
 *
 * Escribir directamente en las tablas `tc_*` con la clave de servicio sería más
 * fácil y está descartado: los RPC son los que validan la compatibilidad de
 * medida, escriben el historial, crean la fila de `operaciones_neumaticos` y
 * mantienen los estados. Saltárselos dejaría TyreControl incoherente de una
 * forma que nadie detecta hasta mucho después.
 *
 * ── Por qué se cachea y por qué hay un solo vuelo ───────────────────────────
 *
 * Un `signInWithPassword` por operación sería una llamada de red y un hash de
 * contraseña por cada rueda. Peor: veinte operaciones saliendo a la vez del
 * worker harían veinte logins simultáneos del mismo usuario. Se guarda la
 * sesión mientras valga y, si hace falta renovarla, la primera que llega abre
 * la puerta y las demás esperan a ESA promesa. Es el patrón de un solo vuelo.
 *
 * ── Qué no sale de aquí ─────────────────────────────────────────────────────
 *
 * Ni la contraseña ni el token. No se registran, no se devuelven, no viajan en
 * el outbox ni en un mensaje de error. Lo único que se puede saber desde fuera
 * es si hay sesión y a nombre de quién.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export class ErrorSesionTc extends Error {
  constructor(public codigo: string, mensaje: string) { super(mensaje); }
}

type Sesion = {
  cliente: SupabaseClient;
  usuarioId: string;
  email: string;
  /** Cuándo deja de valer, en ms. */
  expiraEnMs: number;
};

/*
 * Margen de renovación. Se renueva un minuto ANTES de que caduque para que una
 * operación que empieza con el token a punto de expirar no se lo encuentre
 * caducado a mitad: un token que vence entre la comprobación y la llamada es
 * exactamente el fallo intermitente que luego nadie reproduce.
 */
const MARGEN_MS = 60_000;

let sesion: Sesion | null = null;
/** El vuelo en curso, si lo hay. Todo el que llegue mientras tanto espera aquí. */
let enVuelo: Promise<Sesion> | null = null;

function credenciales(): { email: string; password: string; url: string; anon: string } {
  const email = process.env.TC_SERVICE_USER_EMAIL;
  const password = process.env.TC_SERVICE_USER_PASSWORD;
  const url = process.env.SUPABASE_URL;
  const anon = process.env.VITE_SUPABASE_ANON_KEY;

  if (!email || !password) {
    throw new ErrorSesionTc(
      "tc_credentials_missing",
      "Falta el usuario de integración de TyreControl (TC_SERVICE_USER_EMAIL / TC_SERVICE_USER_PASSWORD)",
    );
  }
  if (!url || !anon) {
    throw new ErrorSesionTc("tc_config_missing", "Falta SUPABASE_URL o VITE_SUPABASE_ANON_KEY");
  }
  return { email, password, url, anon };
}

async function entrar(): Promise<Sesion> {
  const { email, password, url, anon } = credenciales();

  const cliente = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await cliente.auth.signInWithPassword({ email, password });

  if (error || !data.session) {
    /*
     * El mensaje de Supabase se conserva porque distingue «contraseña mal» de
     * «no hay red», y eso cambia qué hacer. Lo que no se registra nunca es con
     * qué se intentó entrar.
     */
    throw new ErrorSesionTc(
      "tc_login_failed",
      `El usuario de integración de TyreControl no ha podido entrar: ${error?.message ?? "sin sesión"}`,
    );
  }

  const expiraEn = data.session.expires_at
    ? data.session.expires_at * 1000
    : Date.now() + 55 * 60_000;   // Supabase da una hora; se asume conservador

  console.log(`[TyreControl] sesión de integración abierta (${email})`);
  return {
    cliente,
    usuarioId: data.user?.id ?? "",
    email,
    expiraEnMs: expiraEn,
  };
}

function sigueValiendo(s: Sesion | null): s is Sesion {
  return s != null && s.expiraEnMs - MARGEN_MS > Date.now();
}

/**
 * Cliente de Supabase autenticado como el usuario de integración de TC.
 *
 * Devuelve la sesión guardada si vale; si no, abre una y hace esperar a todo
 * el que llegue mientras tanto.
 */
export async function clienteTyreControl(): Promise<SupabaseClient> {
  return (await sesionTyreControl()).cliente;
}

export async function sesionTyreControl(): Promise<Sesion> {
  if (sigueValiendo(sesion)) return sesion;
  if (enVuelo) return enVuelo;   // otra operación ya está entrando: se espera a la suya

  enVuelo = entrar()
    .then((s) => { sesion = s; return s; })
    .catch((e) => { sesion = null; throw e; })
    .finally(() => { enVuelo = null; });

  return enVuelo;
}

/**
 * Olvida la sesión guardada.
 *
 * Se llama cuando TC contesta que el token no vale: así el siguiente intento
 * vuelve a entrar en vez de repetir el mismo token caducado indefinidamente.
 */
export function olvidarSesionTc(): void {
  sesion = null;
}

/** Estado de la sesión para diagnóstico. Sin token y sin contraseña. */
export function estadoSesionTc(): {
  hayCredenciales: boolean; activa: boolean; email: string | null; expiraEnMs: number | null;
} {
  let hayCredenciales = true;
  try { credenciales(); } catch { hayCredenciales = false; }
  return {
    hayCredenciales,
    activa: sigueValiendo(sesion),
    // El correo del usuario de integración no es un secreto y ayuda a saber
    // contra qué usuario se está trabajando. La contraseña nunca aparece.
    email: sesion?.email ?? null,
    expiraEnMs: sesion?.expiraEnMs ?? null,
  };
}

/** Solo para pruebas: deja el módulo como recién cargado. */
export function reiniciarSesionTcParaPruebas(): void {
  sesion = null;
  enVuelo = null;
}
