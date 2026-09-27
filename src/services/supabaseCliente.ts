/**
 * El ÚNICO cliente Supabase del front web.
 *
 * ── Por qué existe este fichero ─────────────────────────────────────────────
 *
 * Hasta ahora había tres `createClient` distintos, uno por módulo:
 *
 *   src/modules/tyrecontrol/services/supabase.ts
 *   src/modules/administracion/services/supabase.ts
 *   src/modules/almacen-neumaticos/services/supabase.ts
 *
 * Los tres apuntaban al mismo proyecto y, por tanto, a la MISMA clave de
 * almacenamiento (`sb-<ref>-auth-token`, derivada de la URL). Eso deja tres
 * `GoTrueClient` vivos sobre el mismo almacén, cada uno con su propio
 * temporizador de refresco. El refresh token de Supabase ROTA: quien lo usa lo
 * invalida y recibe uno nuevo. Con tres temporizadores:
 *
 *   A refresca  → el token que A tenía queda invalidado
 *   B despierta → intenta refrescar con el token viejo que aún tiene en memoria
 *   B recibe    → «Invalid Refresh Token»
 *   B borra la sesión → el usuario se queda fuera, en los tres módulos
 *
 * Es el defecto que se observó en consola en producción antes de la Fase B.
 *
 * ── Por qué NO se arregla con `storageKey` distintos ────────────────────────
 *
 * Darle a cada módulo su propia clave quitaría el aviso de consola y la carrera
 * de tokens, pero rompería el SSO: son módulos de la misma aplicación y el
 * usuario entra una vez. Con claves separadas, entrar en Administración no
 * dejaría sesión en TyreControl. La solución correcta es la contraria: una sola
 * instancia compartida.
 *
 * ── Qué NO cambia aquí ──────────────────────────────────────────────────────
 *
 * No se pasan opciones a `createClient`. Las tres llamadas anteriores tampoco
 * las pasaban, así que el comportamiento de Auth (`persistSession`,
 * `autoRefreshToken`, `storageKey` derivada de la URL, `flowType`) queda
 * exactamente como estaba. El modelo de Auth se revisa más adelante; este
 * cambio sólo colapsa tres instancias en una.
 */
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl) throw new Error("Falta VITE_SUPABASE_URL");
if (!supabaseAnonKey) throw new Error("Falta VITE_SUPABASE_ANON_KEY");

/**
 * La instancia compartida. Ningún otro sitio del front web debe llamar a
 * `createClient`: hay una guarda estática que lo comprueba en
 * `src/services/supabaseCliente.test.ts`.
 */
export const supabase = createClient(supabaseUrl, supabaseAnonKey);
