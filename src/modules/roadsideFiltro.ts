/// Buscar dentro del listado de asistencias: por matrícula, por cliente y por
/// fecha, cada cosa en su campo.
///
/// Con 85 asistencias en «En taller ✓» —y creciendo cada día— encontrar una
/// concreta era ir bajando con la rueda del ratón. Los cuadros de arriba
/// filtran por estado, que es la pregunta de la operativa del día, pero no la
/// de «¿qué le hicimos al 3719LKK la semana pasada?».
export type Filtrable = {
  plate?: string | null;
  plateRemolque?: string | null;
  customerName?: string | null;
  createdAtMs?: number | null;
};

export type Criterios = {
  /// Matrícula, del camión o del remolque.
  ///
  /// Va aparte del cliente para poder acotar: «todas las de Truck Service de
  /// la semana pasada» es una pregunta, y «la 3719LKK» es otra. Con un solo
  /// campo no se podían combinar.
  matricula?: string;
  /// Nombre del cliente.
  cliente?: string;
  /// «AAAA-MM-DD», tal cual lo dan los <input type="date">.
  desde?: string;
  hasta?: string;
};

/// Deja el texto comparable: sin acentos, en mayúsculas y sin los separadores
/// que la gente mete en las matrículas.
///
/// Lo de los separadores no es un capricho: la misma matrícula se escribe
/// «3719LKK», «3719 LKK» y «3719-LKK» según quién la teclee, y sin esto la
/// búsqueda falla justo cuando el operario la copia del albarán.
export function normalizar(valor: string): string {
  return valor
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[\s.\-_/]/g, "");
}

/// Principio del día indicado, en hora local. `null` si la fecha no vale.
export function inicioDelDia(fecha: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(fecha.trim());
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 0, 0, 0, 0);
  return Number.isNaN(d.getTime()) ? null : d.getTime();
}

/// Final del día indicado, en hora local.
///
/// El «hasta» es INCLUSIVE. Si se comparara contra el inicio del día, una
/// asistencia de esa misma tarde se quedaría fuera de su propio filtro: se
/// busca «del 1 al 5», la del día 5 no sale, y nadie entiende por qué.
export function finDelDia(fecha: string): number | null {
  const inicio = inicioDelDia(fecha);
  if (inicio == null) return null;
  return inicio + 24 * 60 * 60 * 1000 - 1;
}

export function coincide(item: Filtrable, criterios: Criterios): boolean {
  // Los criterios se suman: rellenar dos es acotar, no ampliar. Quien escribe
  // matrícula Y cliente quiere las que cumplen las dos cosas.
  const matricula = (criterios.matricula ?? "").trim();
  if (matricula) {
    const aguja = normalizar(matricula);
    // El remolque cuenta como matrícula: en una asistencia al remolque puede
    // ser la única que hay, y es la que el cliente da por teléfono.
    const matriculas = [item.plate, item.plateRemolque]
      .filter(Boolean)
      .map((v) => normalizar(String(v)));
    if (!matriculas.some((v) => v.includes(aguja))) return false;
  }

  const cliente = (criterios.cliente ?? "").trim();
  if (cliente) {
    const aguja = normalizar(cliente);
    if (!normalizar(String(item.customerName ?? "")).includes(aguja)) return false;
  }

  const creada = item.createdAtMs;

  if (criterios.desde) {
    const desde = inicioDelDia(criterios.desde);
    // Una fecha a medio escribir —«2026-0»— no puede esconder el listado
    // entero mientras se teclea, así que hasta que es válida no filtra.
    if (desde != null) {
      if (creada == null || creada < desde) return false;
    }
  }

  if (criterios.hasta) {
    const hasta = finDelDia(criterios.hasta);
    if (hasta != null) {
      if (creada == null || creada > hasta) return false;
    }
  }

  return true;
}

export function filtrar<T extends Filtrable>(lista: T[], criterios: Criterios): T[] {
  if (!hayCriterios(criterios)) return lista;
  return lista.filter((item) => coincide(item, criterios));
}

/// ¿Hay algo que filtrar? Sirve para no recorrer la lista y para saber si
/// enseñar el aviso de «estás viendo un subconjunto».
export function hayCriterios(criterios: Criterios): boolean {
  return Boolean(
    (criterios.matricula ?? "").trim() ||
      (criterios.cliente ?? "").trim() ||
      (criterios.desde ?? "").trim() ||
      (criterios.hasta ?? "").trim()
  );
}
