/**
 * ¿Vale el nombre que alguien teclea para entrar en una APK?
 *
 * En la APK de Almacén se entra con «nombre de usuario» y PIN. El PIN es lo
 * que identifica la ficha; el nombre es la comprobación de que quien lo teclea
 * sabe de quién es. Hasta ahora se comparaba con el nombre que guarda el
 * propio módulo (`perfiles_usuario.nombre`).
 *
 * ## Si la ficha está enlazada con Core, se mira a Core
 *
 * Vale el nombre de Core, en cualquiera de las formas en que una persona lo
 * escribe sin pensarlo: completo («Albert Belles Bertran»), el campo nombre
 * («Albert») o la primera palabra. Así, si se corrige el nombre en Core, se
 * entra con el corregido sin tocar nada en Almacén.
 *
 * El nombre antiguo del módulo SIGUE valiendo mientras exista: quitarlo de
 * golpe dejaría fuera, un lunes por la mañana, a quien lleva años tecleando
 * un mote que no es su nombre de Core. Cuando esa columna se retire (fase
 * posterior), dejará de valer sola.
 *
 * Sin enlazar, como siempre: el nombre del módulo.
 *
 * La comparación ignora mayúsculas, tildes y espacios de más
 * (`normalizarNombre`): en un móvil nadie pone la tilde de «Ramón».
 */

import { normalizarNombre } from "./vinculoTecnicos.ts";

export type PersonaDeCore = { nombre: string | null; apellidos: string | null };

/** Las formas del nombre de Core con las que se puede entrar. */
export function nombresDeCore(core: PersonaDeCore): string[] {
  const completo = normalizarNombre([core.nombre, core.apellidos].filter(Boolean).join(" "));
  const nombre = normalizarNombre(core.nombre);
  // En Core muchas fichas llevan el nombre entero en `nombre` y los apellidos
  // vacíos: por eso la primera palabra cuenta aparte.
  const primera = nombre.split(" ")[0] ?? "";
  return [...new Set([completo, nombre, primera])].filter(Boolean);
}

export function nombreValeParaEntrar(
  tecleado: unknown,
  ficha: { nombreModulo: string | null | undefined; core?: PersonaDeCore | null }
): boolean {
  const t = normalizarNombre(tecleado);
  if (!t) return false;
  if (ficha.core && nombresDeCore(ficha.core).includes(t)) return true;
  const modulo = normalizarNombre(ficha.nombreModulo);
  return modulo !== "" && modulo === t;
}
