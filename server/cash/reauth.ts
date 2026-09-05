/**
 * Reautenticación para las acciones sensibles.
 *
 * Una sesión abierta en el mostrador es una sesión abierta para cualquiera que
 * pase por delante. Contra eso no sirve el permiso —el permiso lo tiene el
 * usuario, y el usuario dejó la pantalla puesta—: hace falta que quien está
 * ahora mismo delante vuelva a demostrar quién es.
 *
 * Dos decisiones que definen esto:
 *
 * · **La marca vive en la base de datos, no en memoria.** En Render hay varias
 *   instancias y la siguiente petición puede caer en otra; con un mapa en
 *   memoria, reautenticarse valdría o no según a quién le tocara responder, que
 *   es la peor clase de fallo: intermitente y sin explicación.
 *
 * · **El verificador es enchufable**, igual que el conector de ERP. La
 *   comprobación real va contra Supabase, que no existe en las pruebas; con la
 *   interfaz de por medio, la regla —cuánto dura, qué acciones la piden, qué
 *   pasa si caduca— se prueba sin levantar nada.
 *
 * Viene apagado, como la separación de funciones: encenderlo en un taller de
 * dos personas solo añade fricción a quien ya es el único que puede hacerlo.
 */

import pool from "../db.ts";
import { ErrorCaja } from "./errors.ts";

/** Cuánto vale una reautenticación. Diez minutos: lo que dura una gestión. */
export const VALIDEZ_MS = 10 * 60_000;

export interface VerificadorDeClave {
  /** ¿Es ésta la clave de este usuario? */
  verificar(userId: string, clave: string): Promise<boolean>;
  /**
   * ¿De quién son este usuario y esta clave? Devuelve su id, o `null`.
   *
   * Hace falta cuando quien se identifica NO es quien tiene la sesión abierta
   * —un encargado que viene a autorizar una excepción del cajero—, porque
   * entonces no hay un `userId` de partida: precisamente lo que se quiere
   * averiguar es quién ha escrito la clave.
   *
   * Es opcional para no romper a quien ya tenga un verificador registrado con
   * solo `verificar`; quien no la implemente, simplemente no puede autorizar
   * en nombre de otro.
   */
  identificar?(usuario: string, clave: string): Promise<string | null>;
}

let verificador: VerificadorDeClave | null = null;

export function registrarVerificador(v: VerificadorDeClave | null): void {
  verificador = v;
}

/**
 * Verificador real: la clave se comprueba contra Supabase Auth.
 *
 * Se carga de forma perezosa porque `server/supabase.ts` revienta al importarse
 * si faltan sus variables de entorno, y un módulo que solo quiera comprobar la
 * regla no tiene por qué arrastrar eso.
 */
export function verificadorSupabase(): VerificadorDeClave {
  return {
    async verificar(userId, clave) {
      // El cliente anónimo, no el de servicio: comprobar una clave es iniciar
      // sesión en nombre del usuario, y el de servicio no la pide.
      const { supabaseAnonAuth } = await import("../supabase.ts");
      const { rows } = await pool.query(`SELECT email FROM app_usuarios WHERE id = $1`, [userId]);
      const email = rows[0]?.email;
      if (!email) return false;

      const { data, error } = await supabaseAnonAuth.auth.signInWithPassword({
        email,
        password: clave,
      });
      // Se comprueba que el usuario que ha validado es el mismo, no solo que
      // la pareja correo/clave exista: si no, valdría la clave de otro.
      return !error && data.user?.id === userId;
    },

    async identificar(usuario, clave) {
      const { supabaseAnonAuth } = await import("../supabase.ts");
      /*
       * Se admite el correo o el nombre de usuario, porque en el mostrador
       * nadie se sabe el correo del encargado de memoria. La búsqueda es
       * insensible a mayúsculas y solo mira usuarios ACTIVOS: uno dado de baja
       * no autoriza nada aunque su clave siga siendo válida en Supabase.
       */
      const { rows } = await pool.query(
        `SELECT id, email FROM app_usuarios
          WHERE activo AND (lower(email) = lower($1) OR lower(username) = lower($1))
          LIMIT 1`,
        [usuario.trim()]
      );
      const encontrado = rows[0];
      if (!encontrado?.email) return null;

      const { data, error } = await supabaseAnonAuth.auth.signInWithPassword({
        email: encontrado.email,
        password: clave,
      });
      if (error || data.user?.id !== encontrado.id) return null;
      return encontrado.id as string;
    },
  };
}

/**
 * Quién es quien acaba de escribir usuario y clave.
 *
 * No deja marca de reautenticación: identificarse para autorizar lo de OTRO no
 * es identificarse para seguir uno mismo. Si dejara marca, el encargado que
 * autoriza un cobro quedaría reautenticado en una pantalla que no es suya.
 */
export async function identificarA(usuario: string, clave: string): Promise<string | null> {
  const v = verificador;
  if (!v?.identificar) {
    throw new ErrorCaja(
      "REAUTENTICACION_NO_DISPONIBLE",
      "No se puede comprobar la clave en este servidor.",
      503
    );
  }
  return v.identificar(usuario, clave);
}

/** Deja constancia de que este usuario acaba de identificarse. */
export async function reautenticar(userId: string, clave: string): Promise<void> {
  const v = verificador;
  if (!v) {
    throw new ErrorCaja(
      "REAUTENTICACION_NO_DISPONIBLE",
      "No se puede comprobar la clave en este servidor.",
      503
    );
  }

  if (!(await v.verificar(userId, clave))) {
    // Sin decir si el fallo es del usuario o de la clave, que es lo de siempre.
    throw new ErrorCaja("CLAVE_NO_VALIDA", "La clave no es correcta.", 401);
  }

  const hasta = Date.now() + VALIDEZ_MS;
  await pool.query(
    `INSERT INTO cash_reauth (user_id, hasta_ms) VALUES ($1,$2)
     ON CONFLICT (user_id) DO UPDATE SET hasta_ms = EXCLUDED.hasta_ms`,
    [userId, hasta]
  );
}

/** ¿Se ha identificado hace poco? */
export async function estaReautenticado(userId: string): Promise<boolean> {
  const { rows } = await pool.query(`SELECT hasta_ms FROM cash_reauth WHERE user_id = $1`, [
    userId,
  ]);
  return Number(rows[0]?.hasta_ms ?? 0) > Date.now();
}

export const AJUSTE_REAUTH = "reauth_activo";

async function reauthActiva(empresaId: string): Promise<boolean> {
  const { rows } = await pool.query<{ valor: string | null }>(
    `SELECT valor FROM cash_settings WHERE empresa_id = $1 AND clave = $2`,
    [empresaId, AJUSTE_REAUTH]
  );
  return rows[0]?.valor === "1";
}

/**
 * Exige identificarse de nuevo para una acción sensible.
 *
 * Como en la separación de funciones, un usuario sin identificar no pasa: no se
 * puede comprobar que sea quien dice, y ante la duda la respuesta es que no.
 */
export async function exigirReautenticacion(
  empresaId: string,
  userId: string | null
): Promise<void> {
  if (!(await reauthActiva(empresaId))) return;

  if (!userId || !(await estaReautenticado(userId))) {
    throw new ErrorCaja(
      "REAUTENTICACION_REQUERIDA",
      "Vuelve a introducir tu clave para confirmar esta acción.",
      401
    );
  }
}
