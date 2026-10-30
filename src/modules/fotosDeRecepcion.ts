/**
 * Las fotos de una recepción de vehículo: la de la matrícula, la del
 * cuentakilómetros y las del estado del vehículo.
 *
 * La APK las manda con un `tipo` para que el panel diga cuál es cuál. Las de
 * antes de ese cambio vienen sin tipo: se tratan como «estado».
 */

export type TipoFotoRecepcion = "matricula" | "kilometros" | "estado";

export const TIPOS_FOTO_RECEPCION: TipoFotoRecepcion[] = ["matricula", "kilometros", "estado"];

export const ETIQUETA_FOTO_RECEPCION: Record<TipoFotoRecepcion, string> = {
  matricula: "Matrícula",
  kilometros: "Kilómetros",
  estado: "Estado del vehículo",
};

/** Lo que venga de fuera, a un tipo válido; sin tipo o desconocido → «estado». */
export function tipoDeFotoRecepcion(valor: unknown): TipoFotoRecepcion {
  const t = String(valor ?? "").trim().toLowerCase();
  return (TIPOS_FOTO_RECEPCION as string[]).includes(t) ? (t as TipoFotoRecepcion) : "estado";
}

export type FotoConTipo = { url: string; tipo?: string | null; nombre?: string | null; creadaAtMs?: number | null };

/** Matrícula primero, luego kilómetros, luego el resto en su orden. Sin URL, fuera. */
export function fotosOrdenadas<T extends FotoConTipo>(fotos: T[] | null | undefined): T[] {
  const orden = (f: T) => TIPOS_FOTO_RECEPCION.indexOf(tipoDeFotoRecepcion(f.tipo));
  return (fotos ?? [])
    .map((f, i) => ({ f, i }))
    .filter(({ f }) => f && String(f.url ?? "").trim())
    .sort((a, b) => orden(a.f) - orden(b.f) || a.i - b.i)
    .map(({ f }) => f);
}

export function etiquetaDeFoto(f: FotoConTipo): string {
  return ETIQUETA_FOTO_RECEPCION[tipoDeFotoRecepcion(f.tipo)];
}
