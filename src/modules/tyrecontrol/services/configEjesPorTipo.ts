/**
 * Tipos de vehículo cuya configuración de ejes es SIEMPRE la misma.
 *
 * Lo dijo Jordi: «si es un autocar 2x4x2, configuración de ejes siempre es un
 * bus 2x4x2». Elegir el tipo ya la deja puesta y no se puede cambiar; así no
 * vuelve a salir un autocar con la de un camión o sin configuración.
 *
 * Clave: `tc_tipos_vehiculo.nombre`. Valor: `tc_config_ejes.nombre`.
 */
const CONFIG_FIJA: Record<string, string> = {
  autocar: "2x4x2 Bus",
};

/** El nombre de la configuración que manda para ese tipo, o null si es libre. */
export function configFijaDeTipo(nombreTipo: string | null | undefined): string | null {
  return CONFIG_FIJA[(nombreTipo ?? "").trim().toLowerCase()] ?? null;
}

/** El id de esa configuración entre las cargadas, o null si no aplica o no está. */
export function idConfigFija(
  nombreTipo: string | null | undefined,
  configs: { id: string; nombre: string }[],
): string | null {
  const nombre = configFijaDeTipo(nombreTipo);
  if (!nombre) return null;
  return configs.find((c) => c.nombre.trim().toLowerCase() === nombre.toLowerCase())?.id ?? null;
}
