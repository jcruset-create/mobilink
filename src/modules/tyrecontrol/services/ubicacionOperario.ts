/**
 * Dónde está la tablet de un operario, dicho en la lista de usuarios.
 *
 * ── Por qué no vale `haceCuanto` de la propia pantalla ──────────────────────
 *
 * Porque aquella cuenta en días —«hoy», «ayer», «hace 3 días»— y para el
 * último acceso está bien. Aquí «hoy» no dice nada: entre una posición de hace
 * tres minutos y una de esta mañana hay toda la diferencia, y es justo la que
 * se mira. Esta cuenta en minutos hasta la hora, en horas hasta el día.
 *
 * ── Lo que esta pantalla NO es ──────────────────────────────────────────────
 *
 * No es un rastro. El servidor guarda solo la ÚLTIMA posición de cada
 * operario, la borra al cerrar sesión y deja de enseñarla a las 24 h. Aquí se
 * enseña eso y nada más: dónde está ahora, no por dónde ha ido.
 */

/** Más vieja que esto, la posición ya no dice dónde está nadie. */
export const MAX_EDAD_MS = 24 * 60 * 60_000;

export interface PosicionOperario {
  usuario_id: string;
  lat: number;
  lng: number;
  precision_m?: number | null;
  velocidad_kmh?: number | null;
  visto_at: string;
}

/**
 * ¿Es una coordenada de verdad?
 *
 * Mismo criterio que `presenciaVista.coordenadaValida` y que el servidor: el
 * (0, 0) se descarta porque es lo que devuelve un GPS sin fijar, y llevaría al
 * operario al golfo de Guinea con toda la seguridad del mundo.
 */
export function coordenadaValida(lat: unknown, lng: unknown): boolean {
  const la = Number(lat);
  const lo = Number(lng);
  if (!Number.isFinite(la) || !Number.isFinite(lo)) return false;
  if (Math.abs(la) > 90 || Math.abs(lo) > 180) return false;
  return !(la === 0 && lo === 0);
}

/** Cuánto hace que se la vio. `frio` = ya no dice dónde está ahora. */
export function vistaHace(
  iso: string | null | undefined,
  ahora = Date.now(),
): { txt: string; frio: boolean } {
  if (!iso) return { txt: "—", frio: true };
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return { txt: "—", frio: true };

  const ms = ahora - t;
  // Del futuro: la tablet tiene la hora mal. No se inventa un «hace -3 min».
  if (ms < -5 * 60_000) return { txt: "—", frio: true };
  if (ms > MAX_EDAD_MS) return { txt: "hace más de un día", frio: true };

  const min = Math.max(0, Math.floor(ms / 60_000));
  if (min < 1) return { txt: "ahora mismo", frio: false };
  if (min < 60) return { txt: `hace ${min} min`, frio: min > 15 };
  const h = Math.floor(min / 60);
  // A partir de un cuarto de hora se enfría: el operario puede haberse movido
  // sin que la tablet lo haya contado todavía, y decirlo en gris evita que
  // alguien salga a buscarle a un sitio donde ya no está.
  return { txt: h === 1 ? "hace 1 h" : `hace ${h} h`, frio: true };
}

/**
 * El enlace al mapa.
 *
 * Mismo formato que `presenciaVista.enlaceDeMapa`, que es el que ya usa la
 * ficha del vehículo: un solo tipo de enlace en todo el producto.
 */
export function enlaceDeMapa(lat: number, lng: number): string {
  return `https://www.google.com/maps?q=${lat.toFixed(6)},${lng.toFixed(6)}`;
}

/** Las posiciones, indexadas por usuario y con la basura ya fuera. */
export function indexarPosiciones(
  filas: Array<Partial<PosicionOperario>> | null | undefined,
): Map<string, PosicionOperario> {
  const m = new Map<string, PosicionOperario>();
  for (const f of filas ?? []) {
    const id = f?.usuario_id;
    if (!id || !coordenadaValida(f?.lat, f?.lng) || !f?.visto_at) continue;
    m.set(String(id), {
      usuario_id: String(id),
      lat: Number(f.lat),
      lng: Number(f.lng),
      precision_m: f.precision_m == null ? null : Number(f.precision_m),
      velocidad_kmh: f.velocidad_kmh == null ? null : Number(f.velocidad_kmh),
      visto_at: String(f.visto_at),
    });
  }
  return m;
}

/** El texto del `title`: la precisión y la hora exacta, para quien la quiera. */
export function detalleDePosicion(p: PosicionOperario): string {
  const partes = [`Vista el ${new Date(p.visto_at).toLocaleString("es-ES")}`];
  if (p.precision_m != null && Number.isFinite(p.precision_m)) {
    partes.push(`precisión ±${Math.round(p.precision_m)} m`);
  }
  return `${partes.join(" · ")}. Abre Google Maps.`;
}
