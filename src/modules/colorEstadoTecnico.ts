/**
 * El color de la tarjeta de un técnico en la pantalla de TV.
 *
 * La pantalla se mira desde lejos: el color tiene que decir, sin leer, qué
 * está haciendo cada uno. Lo eligió el taller: VERDE es libre, ROJO es
 * trabajando (una asistencia en carretera también), subido para el
 * RESPONSABLE del trabajo y claro para el APOYO, y la BAJA es rojo fuerte
 * con la fila entera maciza, para que no se confunda con trabajar aunque sea
 * el mismo color. Amarillo son vacaciones y permiso, azul está en otro
 * taller o en un mantenimiento fuera, azul claro es formación (en un curso)
 * y gris lo que no encaja en nada de lo anterior.
 *
 * Los chips (`chipDeSituacion`) van macizos con letras blancas; solo el
 * amarillo las lleva oscuras, porque en amarillo el blanco no se lee.
 */
export type SituacionTecnico =
  | "libre"
  /** Trabajando como responsable del trabajo (o solo): rojo subido. */
  | "trabajando"
  /** Trabajando como apoyo de otro: rojo claro. */
  | "apoyo"
  | "baja"
  | "ausente"
  | "fuera"
  | "formacion"
  | "reservado"
  | "otro";

export function situacionDeTecnico(
  estadoNormalizado: string,
  extra: {
    enAsistencia?: boolean;
    mantenimientoFuera?: boolean;
    mantenimientoEnTaller?: boolean;
    reservadoParaValidar?: boolean;
    /** Tiene un trabajo activo aunque su ficha diga «disponible». */
    trabajando?: boolean;
    /** En ese trabajo va de apoyo, no de responsable. */
    apoyo?: boolean;
  } = {}
): SituacionTecnico {
  // Una asistencia en carretera es TRABAJAR, no «estar fuera»: el técnico
  // está en ello igual que el que tiene un camión en el foso. Azul queda para
  // quien está en otro taller o en un mantenimiento fuera.
  if (extra.enAsistencia || extra.mantenimientoEnTaller || extra.trabajando) {
    return extra.apoyo ? "apoyo" : "trabajando";
  }
  if (extra.mantenimientoFuera) return "fuera";
  if (extra.reservadoParaValidar) return "reservado";

  switch (estadoNormalizado) {
    case "ocupado":
    case "refuerzo":
      return "trabajando";
    case "baja":
      return "baja";
    case "vacaciones":
    case "permiso":
      return "ausente";
    case "otro_taller":
    case "en_otro_taller":
      return "fuera";
    case "formacion":
      return "formacion";
    case "disponible":
    case "supervisor":
      return "libre";
    default:
      return "otro";
  }
}

/**
 * La cara que se pone en la redonda del técnico.
 *
 * La pantalla se mira desde lejos y de reojo: una cara se lee antes que una
 * palabra, y antes que un color para quien no distingue bien el rojo del
 * verde. Las tres primeras las eligió el taller; las otras acompañan para que
 * ninguna redonda se quede a medias.
 */
export function emojiDeSituacion(s: SituacionTecnico): string {
  switch (s) {
    case "libre":
      return "😀";
    case "trabajando":
    case "apoyo":
      return "😅";
    case "baja":
      return "🥵";
    case "ausente":
      return "🌴";
    case "fuera":
      return "🚐";
    case "formacion":
      return "📚";
    case "reservado":
      return "⏳";
    default:
      return "";
  }
}

export function claseDeSituacion(s: SituacionTecnico): string {
  switch (s) {
    case "libre":
      return "border-green-300 bg-green-200 text-green-950";
    case "trabajando":
      return "border-red-500 bg-red-400 text-red-950";
    case "apoyo":
      return "border-red-300 bg-red-100 text-red-950";
    case "baja":
      return "border-red-700 bg-red-600 text-white";
    case "ausente":
      return "border-yellow-300 bg-yellow-200 text-yellow-950";
    case "fuera":
      return "border-blue-300 bg-blue-200 text-blue-950";
    case "formacion":
      return "border-sky-300 bg-sky-100 text-sky-950";
    case "reservado":
      return "border-violet-300 bg-violet-200 text-violet-950";
    default:
      return "border-slate-300 bg-slate-100 text-slate-700";
  }
}

/** El chip de estado de la tarjeta: macizo, letras blancas salvo en amarillo. */
export function chipDeSituacion(s: SituacionTecnico): string {
  switch (s) {
    case "libre":
      return "bg-green-600 text-white";
    case "trabajando":
      return "bg-red-900 text-white";
    case "apoyo":
      return "bg-red-600 text-white";
    case "baja":
      return "bg-red-950 text-white";
    case "ausente":
      return "bg-yellow-400 text-slate-900";
    case "fuera":
      return "bg-blue-600 text-white";
    case "formacion":
      return "bg-sky-500 text-white";
    case "reservado":
      return "bg-violet-600 text-white";
    default:
      return "bg-slate-600 text-white";
  }
}
