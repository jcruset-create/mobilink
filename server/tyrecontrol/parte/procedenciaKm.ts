/**
 * De dónde salió el kilometraje que va impreso en el parte.
 *
 * ── Por qué NO se escribe en la hoja ────────────────────────────────────────
 *
 * Porque el parte se dibuja sobre una PLANTILLA con coordenadas fijas
 * (`coordenadas.ts`): cada rótulo está donde está porque encaja con el papel
 * preimpreso que el cliente firma. Meter una línea más obligaría a recolocar
 * el resto, y un parte que no cuadra con su plantilla es un parte que no se
 * puede archivar.
 *
 * Así que el kilometraje se queda en su casilla de siempre y la procedencia va
 * a los METADATOS del PDF, que es donde se puede consultar sin tocar nada de
 * lo impreso: abrir «Propiedades del documento» en cualquier visor y leerlo.
 * Un parte de hace un año sigue abriéndose exactamente igual que antes.
 *
 * Código PURO: no consulta nada y no sabe de PDF.
 */

/** Los orígenes que entiende el panel (`ORIGEN_KM_LABELS`). */
const NOMBRES: Record<string, string> = {
  manual: "introducido a mano",
  telematica: "telemática",
  webfleet: "telemática Webfleet",
  importacion_excel: "importación de Excel",
};

/** Fecha y hora como se leen en un documento español. */
function fechaHora(d: Date): string {
  const dos = (n: number) => String(n).padStart(2, "0");
  return `${dos(d.getDate())}/${dos(d.getMonth() + 1)}/${d.getFullYear()} ` +
         `${dos(d.getHours())}:${dos(d.getMinutes())}`;
}

/**
 * La línea de trazabilidad del kilometraje, o `null` si no hay nada que decir.
 *
 * Se devuelve `null` —y no un «origen desconocido»— cuando no consta el
 * origen: un metadato que dice «no se sabe» no añade nada a un documento y
 * sí invita a pensar que el dato es dudoso cuando a lo mejor no lo es.
 */
export function procedenciaKm(params: {
  km: number | null | undefined;
  /** `tc_vehiculos.origen_km` o `revisiones_vehiculo.origen_km`. */
  origen: string | null | undefined;
  /** Cuándo lo leyó el proveedor, si vino de telemática. */
  capturadoAt?: Date | null;
}): string | null {
  const { km, origen } = params;
  if (km == null || !Number.isFinite(Number(km))) return null;
  const clave = (origen ?? "").trim().toLowerCase();
  if (!clave) return null;

  // Un origen que no esté en el catálogo se imprime tal cual en vez de
  // callarlo: es un dato real aunque el catálogo se haya quedado corto.
  const nombre = NOMBRES[clave] ?? clave;
  const cuando = params.capturadoAt ? ` — lectura del ${fechaHora(params.capturadoAt)}` : "";
  return `Kilómetros: ${Math.round(Number(km))} km. Origen: ${nombre}${cuando}.`;
}
