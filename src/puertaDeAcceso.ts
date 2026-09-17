/**
 * A qué puerta se manda a quien llega sin sesión.
 *
 * Había una sola, y era la del almacén de neumáticos: el guard compartido
 * mandaba SIEMPRE a `/almacen-neumaticos/login`, viniera uno de donde viniera.
 * Y ese login no devuelve al sitio de origen —entra y te deja en el almacén—
 * así que quien intentaba abrir una pantalla de otro módulo acababa en un sitio
 * que no había pedido, sin manera de volver más que a mano.
 *
 * El propio `App.tsx` dice cuál era la intención: «la puerta de entrada es el
 * hub, quien no tenga sesión acaba en /acceso desde ahí». Esto la cumple.
 *
 * Se queda como función aparte, y no como un `?:` dentro del guard, para poder
 * probarla: en este proyecto no hay pruebas de componentes de React —lo dice
 * `vitest.config.ts`— así que una decisión metida en el JSX es una decisión sin
 * prueba.
 */
export function puertaDeAcceso(pathname: string): string {
  /*
   * El almacén conserva la suya. No es una excepción caprichosa: tiene su
   * propio login y sus propios usuarios desde antes de la sesión unificada, y
   * mandar a su gente al hub sería romperles la entrada para arreglar la de
   * los demás.
   */
  return pathname.startsWith("/almacen-neumaticos") ? "/almacen-neumaticos/login" : "/acceso";
}
