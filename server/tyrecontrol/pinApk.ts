/**
 * El PIN de la tablet, como contraseña de Supabase Auth.
 *
 * ── Qué pasaba ──────────────────────────────────────────────────────────────
 *
 * El PIN con el que se entra en la APK de TyreControl ES la contraseña del
 * usuario en Supabase Auth, tal cual. La pantalla de entrada de la tablet
 * tiene cuatro casillas, y Auth no deja ya guardar contraseñas de menos de
 * seis caracteres: al poner un PIN de cuatro dígitos desde Usuarios contesta
 * «Password should be at least 6 characters». Los operarios que ya tenían su
 * PIN de cuatro lo conservan —la longitud solo se mira al guardar—, pero no se
 * podía dar de alta a nadie nuevo ni cambiarle el PIN a nadie.
 *
 * ── Qué se hace ─────────────────────────────────────────────────────────────
 *
 * A un PIN corto se le añade un sufijo fijo antes de guardarlo, igual que el
 * hub hace con `#SEA` (`authClave.ts`). El de seis o más se guarda como viene.
 *
 * El sufijo NO sale del servidor: la tablet manda el PIN, el servidor lo
 * comprueba (`clavesPosibles`: primero tal cual, por los operarios de antes, y
 * luego con sufijo) y le devuelve la contraseña que ha valido para que inicie
 * su sesión. Así no hay que compilarlo dentro de la APK.
 *
 * No es un secreto ni añade seguridad: un PIN de cuatro dígitos sigue siendo
 * de cuatro dígitos, y lo que lo protege es el freno de intentos del login.
 * Solo sirve para llegar a la longitud que pide Auth. Por eso mismo NO SE
 * PUEDE CAMBIAR: cambiarlo deja sin entrar a todos los que tengan PIN corto.
 */

/** Lo que pide Supabase Auth. */
export const LONGITUD_MINIMA_AUTH = 6;

/** Lo mínimo que se acepta como PIN: las cuatro casillas de la tablet. */
export const LONGITUD_MINIMA_PIN = 4;

const SUFIJO = "#TC";

/** La contraseña que se guarda en Auth para ese PIN. */
export function claveDePin(pin: string): string {
  return pin.length >= LONGITUD_MINIMA_AUTH ? pin : `${pin}${SUFIJO}`;
}

/**
 * Las contraseñas con las que puede estar guardado ese PIN, en el orden en
 * que conviene probarlas: tal cual (los operarios dados de alta antes de que
 * Auth pidiera seis) y, si es corto, con sufijo.
 */
export function clavesPosibles(pin: string): string[] {
  const conSufijo = claveDePin(pin);
  return conSufijo === pin ? [pin] : [pin, conSufijo];
}
