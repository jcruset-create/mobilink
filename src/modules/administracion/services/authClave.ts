// Login unificado por USUARIO + contraseña sobre Supabase Auth.
//
// Supabase exige contraseñas de mínimo 6 caracteres, pero el taller usa
// PINs cortos (ej. "1234"). Solución: a TODA contraseña tecleada se le
// añade SIEMPRE el mismo sufijo interno antes de enviarla a Supabase.
// Este mismo helper se usa en el login, en el alta y en el restablecimiento,
// así que el usuario solo conoce su PIN corto.
export function claveInterna(clave: string): string {
  return clave + "#SEA";
}

// Email sintético interno que usa Supabase Auth para los usuarios nuevos
// (el usuario nunca lo ve; el login es por nombre de usuario).
// Debe coincidir con emailSintetico() del servidor (server/index.ts).
export function emailSintetico(username: string): string {
  return `${username.trim().toLowerCase().replace(/[^a-z0-9._-]/g, "")}@usuarios.sea`;
}
