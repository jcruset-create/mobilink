// Sugerencia del nombre de usuario al dar acceso a un empleado.
/** Sugerencia de login: nombre + primer apellido, sin acentos ni espacios. */
export function usuarioSugerido(nombre: string, apellidos: string | null): string {
  const limpio = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9]/g, "");
  const n = limpio(nombre.trim().split(/\s+/)[0] ?? "");
  const a = limpio((apellidos ?? "").trim().split(/\s+/)[0] ?? "");
  return (n + a).toLowerCase();
}
