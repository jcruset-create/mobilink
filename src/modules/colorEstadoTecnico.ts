/**
 * El color de la tarjeta de un técnico en la pantalla de TV.
 *
 * La pantalla se mira desde lejos: el color tiene que decir, sin leer, si
 * alguien puede coger trabajo. Por eso el libre es GRIS, no verde —verde
 * parecía «todo bien» y en realidad es «no está haciendo nada»— y el que
 * trabaja es verde. Rojo es baja, naranja vacaciones o permiso, azul está en
 * otro taller o en un mantenimiento fuera; una asistencia en carretera es
 * trabajar, y va en verde.
 */
export type SituacionTecnico =
  | "libre"
  | "trabajando"
  | "baja"
  | "ausente"
  | "fuera"
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
  } = {}
): SituacionTecnico {
  // Una asistencia en carretera es TRABAJAR, no «estar fuera»: el técnico
  // está en ello igual que el que tiene un camión en el foso. Azul queda para
  // quien está en otro taller o en un mantenimiento fuera.
  if (extra.enAsistencia || extra.mantenimientoEnTaller || extra.trabajando) return "trabajando";
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
    case "disponible":
    case "supervisor":
      return "libre";
    default:
      return "otro";
  }
}

export function claseDeSituacion(s: SituacionTecnico): string {
  switch (s) {
    case "libre":
      return "border-slate-300 bg-slate-200 text-slate-800";
    case "trabajando":
      return "border-green-300 bg-green-200 text-green-950";
    case "baja":
      return "border-red-300 bg-red-200 text-red-950";
    case "ausente":
      return "border-orange-300 bg-orange-200 text-orange-950";
    case "fuera":
      return "border-blue-300 bg-blue-200 text-blue-950";
    case "reservado":
      return "border-violet-300 bg-violet-200 text-violet-950";
    default:
      return "border-slate-300 bg-slate-100 text-slate-700";
  }
}
