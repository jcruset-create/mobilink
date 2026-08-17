/**
 * Constantes que inyecta Vite en tiempo de compilación (`define` en
 * `vite.config.ts`).
 *
 * `__APP_VERSION__` es la versión del `package.json`, la misma que se sube en
 * cada entrega. Se pinta en la cabecera de Mobilink Cash para poder distinguir
 * un fallo real de una caché vieja sin tener que abrir el bundle.
 *
 * Ojo: no es lo mismo que `APP_VERSION` de `src/version.ts`, que es el número
 * del panel Sea Tarragona y sigue su propia numeración.
 */
declare const __APP_VERSION__: string;
