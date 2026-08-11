/**
 * Lector del informe del CheckPoint de Bridgestone.
 *
 * El CheckPoint es un arco por el que pasa el autobús y que le lee presión y
 * profundidad de todas las ruedas. Su informe semanal ("Estado general ·
 * Informe general de la flota") no tiene el formato de nuestra plantilla, así
 * que aquí se traduce: de sus filas salen filas de revisión normales, que
 * importa el mismo código de siempre.
 *
 * Tres cosas del formato que hay que saber, porque no son evidentes:
 *
 * 1. ES UNA FOTO, NO UN DIARIO. Trae la ÚLTIMA medición de cada vehículo,
 *    aunque sea de hace un año. Descargarlo cada semana reenvía casi toda la
 *    flota otra vez, así que hay que quedarse solo con lo medido después de
 *    lo que ya tenemos (`filtrarNuevas`).
 *
 * 2. LA COLUMNA "Estado" NO SIRVE DE FILTRO. Hay filas "Awaiting Measurement"
 *    que SÍ traen medición (vieja) y filas "Measured" que no traen ninguna.
 *    Se mira si hay valor, no lo que diga el estado.
 *
 * 3. EMITE SIEMPRE CUATRO HUECOS POR EJE TRASERO. Un autocar 2x4x2 sale con
 *    diez filas: las dos exteriores del tercer eje son huecos de la plantilla
 *    y no se han medido nunca. La rueda única de ese eje viene en el hueco
 *    "Interior". Contar filas para numerar las posiciones pondría esa rueda
 *    en el sitio equivocado; por eso se mapea por (eje, lado, int/ext) contra
 *    la configuración declarada en el tipo, no por orden de aparición.
 */

export const HOJA_DETALLE = "Neumáticos Detalle";

/** Una rueda medida por el arco, ya traducida a nuestros términos. */
export interface FilaCheckpoint {
  matricula: string;
  idFlota: string | null;
  tipoCheckpoint: string;
  /** Configuración de ejes deducida del tipo: "2x4x2" → [2, 4, 2]. */
  ejes: number[];
  /** Código de posición nuestro: E1_IZQ, E2_IZQ_EXT, E3_DER_INT… */
  codigoPosicion: string;
  medidoAt: Date | null;
  profundidadMm: number | null;
  presionBar: number | null;
}

/** Un vehículo del informe, con lo que el arco sabe de él. */
export interface VehiculoCheckpoint {
  matricula: string;
  idFlota: string | null;
  tipoCheckpoint: string;
  ejes: number[];
  /** Medida sacada del nombre del tipo, si lo dice: "BUS 2x4x2 295-80R22.5". */
  medida: string | null;
  medidoAt: Date | null;
  ruedasMedidas: number;
}

export interface LecturaCheckpoint {
  filas: FilaCheckpoint[];
  vehiculos: VehiculoCheckpoint[];
  /** Vehículos del informe que aún no han cruzado nunca el arco. */
  sinMedir: string[];
  avisos: string[];
}

const num = (v: any): number | null => {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const s = String(v ?? "").trim().replace(",", ".");
  if (!s || s.toUpperCase() === "N/A") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

/** "BUS 2x4x2 295-80R22.5" → [2, 4, 2]. Vacío si el nombre no lo dice. */
export function ejesDeTipo(tipo: string): number[] {
  const m = String(tipo ?? "").match(/\b([24])(?:\s*x\s*([24]))+\b/i);
  if (!m) return [];
  const partes = m[0].split(/x/i).map((p) => Number(p.trim()));
  return partes.every((n) => n === 2 || n === 4) ? partes : [];
}

/** "BUS 2x4x2 295-80R22.5" → "295/80R22.5". Null si no trae medida completa. */
export function medidaDeTipo(tipo: string): string | null {
  // El arco escribe la medida con guion: 295-80R22.5.
  const m = String(tipo ?? "").match(/(\d{3})\s*-\s*(\d{2})\s*R\s*(\d{2}(?:[.,]\d)?)/i);
  if (!m) return null;
  return `${m[1]}/${m[2]}R${m[3].replace(",", ".")}`;
}

/**
 * De (eje, "Exterior izquierda") al código de posición nuestro.
 *
 * `ruedasDelEje` sale de la configuración declarada, no de cuántas filas
 * mandó el arco: para un eje de rueda simple el arco manda cuatro huecos y
 * solo el "Interior" lleva la rueda de verdad.
 *
 * Devuelve null cuando la fila es uno de esos huecos.
 */
export function codigoPosicion(eje: number, posicion: string, ruedasDelEje: number): string | null {
  const p = String(posicion ?? "").trim().toLowerCase();
  const lado = p.includes("izquierda") ? "IZQ" : p.includes("derecha") ? "DER" : null;
  if (!lado || !eje) return null;
  const interior = p.includes("interior");

  if (ruedasDelEje === 4) return `E${eje}_${lado}_${interior ? "INT" : "EXT"}`;
  // Eje de rueda simple. El arco lo llama "Exterior" cuando solo manda dos
  // filas (el eje delantero) e "Interior" cuando manda cuatro y dos sobran.
  return `E${eje}_${lado}`;
}

/**
 * Traduce la hoja "Neumáticos Detalle" del informe.
 *
 * `filas` es lo que devuelve sheet_to_json con las cabeceras de la fila 2 del
 * fichero (la 1 es el título con la fecha del informe).
 */
export function leerCheckpoint(filas: any[]): LecturaCheckpoint {
  const avisos = new Set<string>();
  const out: FilaCheckpoint[] = [];
  const porVehiculo = new Map<string, VehiculoCheckpoint>();
  // Cuántas filas manda el arco por eje y vehículo: distingue el eje simple
  // de dos filas del eje que manda cuatro huecos.
  const filasPorEje = new Map<string, number>();

  for (const r of filas) {
    const mat = String(r["Matrícula"] ?? "").trim().toUpperCase();
    const eje = Number(r["Eje"]);
    if (!mat || !eje) continue;
    const k = `${mat}|${eje}`;
    filasPorEje.set(k, (filasPorEje.get(k) ?? 0) + 1);
  }

  for (const r of filas) {
    const matricula = String(r["Matrícula"] ?? "").trim().toUpperCase();
    if (!matricula) continue;
    const tipoCheckpoint = String(r["Tipo de vehículo"] ?? "").trim();
    const ejes = ejesDeTipo(tipoCheckpoint);
    const eje = Number(r["Eje"]);
    const medidoAt = fechaHora(r["Fecha de la última medición"], r["Hora de la última medición"]);
    const profundidadMm = num(r["Profundidad de la banda de rodadura medida [mm]"]);
    const presionBar = num(r["Presión medida [bar]"]);

    let v = porVehiculo.get(matricula);
    if (!v) {
      v = {
        matricula,
        idFlota: txt(r["ID de flota"]),
        tipoCheckpoint,
        ejes,
        medida: medidaDeTipo(tipoCheckpoint),
        medidoAt,
        ruedasMedidas: 0,
      };
      porVehiculo.set(matricula, v);
    }

    // Sin medición no hay nada que importar: el hueco de la plantilla y la
    // rueda que el arco no pudo leer se ven igual desde aquí.
    if (profundidadMm == null && presionBar == null) continue;

    if (!ejes.length) {
      avisos.add(`${matricula}: no entiendo la configuración de ejes de "${tipoCheckpoint}", se salta`);
      continue;
    }
    // Si el arco manda solo dos filas para el eje, es simple aunque el tipo
    // diga otra cosa. Manda lo que se midió.
    const declaradas = ejes[eje - 1];
    const mandadas = filasPorEje.get(`${matricula}|${eje}`) ?? 0;
    const ruedasDelEje = mandadas === 2 ? 2 : declaradas;
    if (!ruedasDelEje) {
      avisos.add(`${matricula}: mide el eje ${eje} pero su tipo "${tipoCheckpoint}" no lo tiene, se salta`);
      continue;
    }

    const cod = codigoPosicion(eje, String(r["Posición de la rueda"] ?? ""), ruedasDelEje);
    if (!cod) {
      avisos.add(`${matricula}: no sé dónde va "${r["Posición de la rueda"]}" del eje ${eje}, se salta`);
      continue;
    }

    // Un eje declarado simple que trae medición en el hueco exterior Y en el
    // interior mandaría las dos a la misma posición. Pasa si el tipo está mal
    // puesto en el CheckPoint; se avisa en vez de pisar el dato.
    if (out.some((x) => x.matricula === matricula && x.codigoPosicion === cod)) {
      avisos.add(`${matricula}: dos mediciones para ${cod}, se queda la primera (¿tipo mal puesto en el CheckPoint?)`);
      continue;
    }

    out.push({ matricula, idFlota: v.idFlota, tipoCheckpoint, ejes, codigoPosicion: cod, medidoAt, profundidadMm, presionBar });
    v.ruedasMedidas++;
  }

  const vehiculos = [...porVehiculo.values()];
  return {
    filas: out,
    vehiculos,
    sinMedir: vehiculos.filter((v) => v.ruedasMedidas === 0).map((v) => v.matricula).sort(),
    avisos: [...avisos],
  };
}

const txt = (v: any): string | null => {
  const s = String(v ?? "").trim();
  return !s || s.toUpperCase() === "N/A" ? null : s;
};

/** Junta "2026-08-05" y "13:14:52" en un momento. Null si falta la fecha. */
export function fechaHora(fecha: any, hora: any): Date | null {
  const d = fecha instanceof Date ? new Date(fecha.getTime()) : null;
  if (!d || isNaN(d.getTime())) return null;
  const h = String(hora ?? "").trim();
  const m = h.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (m) d.setHours(Number(m[1]), Number(m[2]), Number(m[3] ?? 0), 0);
  else d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * Se queda con lo medido DESPUÉS de lo que ya tenemos de cada vehículo.
 *
 * Es lo que convierte una foto en un diario. `ultimaPorMatricula` es el
 * medido_at más reciente que hay guardado; un vehículo que no aparezca en el
 * mapa nunca se ha medido y entra entero.
 */
export function filtrarNuevas(
  filas: FilaCheckpoint[],
  ultimaPorMatricula: Map<string, Date | null>,
): { nuevas: FilaCheckpoint[]; yaEstaban: string[] } {
  const yaEstaban = new Set<string>();
  const nuevas = filas.filter((f) => {
    if (!f.medidoAt) return false;
    const ultima = ultimaPorMatricula.get(f.matricula);
    if (ultima && f.medidoAt.getTime() <= ultima.getTime()) {
      yaEstaban.add(f.matricula);
      return false;
    }
    return true;
  });
  return { nuevas, yaEstaban: [...yaEstaban].sort() };
}
