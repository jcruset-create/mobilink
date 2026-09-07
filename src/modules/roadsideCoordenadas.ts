/// Coordenadas de una asistencia, listas para leer en pantalla.
///
/// Vive aparte del componente a proposito: «RoadsideAssistanceView» arrastra
/// «apiFetch» y con el la conexion de Supabase, que revienta al importarse sin
/// variables de entorno. Aqui no hay dependencias, asi que se puede probar.
///
/// Pide solo los dos campos que usa en vez del tipo entero: cualquier objeto
/// con latitud y longitud sirve, venga de donde venga.
export type ConCoordenadas = {
  latitude?: unknown;
  longitude?: unknown;
};

/// Devuelve «41.154234, 1.106790», o cadena vacia si no hay coordenadas.
///
/// Seis decimales: unos 11 cm sobre el terreno, de sobra para encontrar un
/// camion parado en un arcen, y ademas corta la cola de decimales que llega
/// del geocodificador y que solo ensucia la pantalla.
///
/// Los valores pueden llegar como numero o como cadena segun por donde entre
/// la asistencia, asi que se normalizan antes. Y se descarta lo que no sea un
/// numero finito: un «NaN, NaN» en pantalla es peor que no poner nada.
export function formatCoords(asistencia: ConCoordenadas): string {
  const { latitude, longitude } = asistencia;

  if (latitude == null || longitude == null) return "";
  if (latitude === "" || longitude === "") return "";

  const lat = Number(latitude);
  const lng = Number(longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return "";

  return `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
}
