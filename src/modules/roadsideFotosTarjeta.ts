/// La tira de fotos que se enseña en la tarjeta de una asistencia activa.
///
/// Vive aparte del componente por lo mismo que `roadsideCoordenadas` y
/// `roadsideFechaHora`: «RoadsideAssistanceView» arrastra «apiFetch» y con el
/// la conexion de Supabase, que revienta al importarse sin variables de
/// entorno. Aqui no hay dependencias, asi que se puede probar.

/// Una foto, tal y como la manda el listado.
export type FotoTarjeta = {
  id: number;
  url: string;
  kind: string;
};

/// Cuantas miniaturas caben antes de que la tira se coma el ancho.
///
/// Cuatro. La tarjeta se mira sobre todo desde el movil, y a partir de la
/// quinta las miniaturas empiezan a competir con los botones de accion, que
/// son lo que la gente viene a pulsar.
export const kMiniaturasEnTarjeta = 4;

export type TiraDeFotos = {
  /// Las que se pintan.
  miniaturas: FotoTarjeta[];
  /// Cuantas quedan fuera, para el «+N». Cero si no queda ninguna.
  resto: number;
};

/**
 * Reparte las fotos entre las que se ven y las que se resumen en un «+N».
 *
 * `total` viene del servidor y NO es `fotos.length`: el listado manda solo las
 * primeras para no arrastrar cien URLs por asistencia. Por eso el «+N» se
 * calcula contra el total y no contra lo recibido — si se calculara contra lo
 * recibido, una asistencia con veinte fotos diria «+1» y estaria mintiendo.
 *
 * Defensivo con el total porque viene de fuera: si llega corto, ausente o
 * absurdo, se usa el numero de fotos que de verdad hay en la mano. Mas vale
 * quedarse corto en el «+N» que prometer fotos que no existen.
 */
export function tiraDeFotos(
  fotos: FotoTarjeta[] | null | undefined,
  total?: number | null,
): TiraDeFotos {
  const lista = Array.isArray(fotos) ? fotos.filter((f) => f && f.url) : [];
  if (lista.length === 0) return { miniaturas: [], resto: 0 };

  const miniaturas = lista.slice(0, kMiniaturasEnTarjeta);

  const declarado = Number(total);
  const cuantas =
    Number.isFinite(declarado) && declarado > lista.length
      ? Math.floor(declarado)
      : lista.length;

  return { miniaturas, resto: Math.max(0, cuantas - miniaturas.length) };
}

/// Como se llama cada tipo de foto debajo de la miniatura.
const NOMBRES: Record<string, string> = {
  matricula_camion: "Matrícula",
  matricula_remolque: "Matrícula remolque",
  averia: "Avería",
  foto_averia: "Avería",
  trabajo_realizado: "Trabajo",
  foto_reparacion: "Reparación",
  foto_or: "OR",
  foto_extra: "Extra",
  foto: "Foto",
};

/// El nombre del tipo, o el propio tipo si no se conoce.
///
/// Devolver el `kind` en crudo es feo, pero es lo que permite reconocer una
/// foto de un tipo nuevo en vez de esconderla detras de un «Foto» generico.
export function nombreDeFoto(kind?: string | null): string {
  const k = String(kind ?? "").trim();
  if (!k) return "Foto";
  return NOMBRES[k] ?? k;
}
