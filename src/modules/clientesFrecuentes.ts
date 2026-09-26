/// El autocompletado de clientes en el alta de asistencia.
///
/// Vive aparte del componente por lo mismo que los otros `roadside*` y
/// `clientes*`: «RoadsideAssistanceView» arrastra «apiFetch» y con el la
/// conexion de Supabase, que revienta al importarse sin variables de entorno.
/// Aqui no hay dependencias, asi que se puede probar.
///
/// ── El problema que resuelve ─────────────────────────────────────────────
///
/// «Empresa que solicita» era texto libre, asi que la misma empresa acababa
/// escrita de cinco maneras y no era la misma empresa para nadie: ni para el
/// ERP, ni para un listado por cliente, ni para saber a quien se le factura.

export type ContactoCliente = {
  id: number;
  name: string;
  surname?: string | null;
  phone?: string | null;
  mobile?: string | null;
  isPrimary?: boolean;
};

export type ClienteFrecuente = {
  id: number;
  name: string;
  taxId?: string | null;
  city?: string | null;
  contactPhone?: string | null;
  /// Cuantas asistencias ha pedido. Es lo que ordena la lista.
  veces?: number;
  /// Su codigo en el ERP, si esta enlazado.
  erpCode?: string | null;
  contactos?: ContactoCliente[];
};

/// A partir de cuantas letras se busca.
///
/// Tres. Con una o dos, cualquier maestro de clientes devuelve medio listado y
/// la lista deja de ayudar: se tarda mas en leerla que en escribir el nombre.
export const kMinimoParaBuscar = 3;

export function tocaBuscar(texto: string): boolean {
  return normalizar(texto).length >= kMinimoParaBuscar;
}

/// Quita acentos, espacios y signos para comparar nombres de empresa.
///
/// «Encatrans», «ENCATRANS S.L.» y «encatrans sl» son la misma empresa para
/// cualquiera que mire, y tienen que serlo tambien para decidir si hace falta
/// ofrecer un alta.
export function normalizar(v: unknown): string {
  // Mismo criterio que `roadsideFiltro.normalizar`, y a proposito: dos formas
  // distintas de decidir si dos nombres son el mismo acaban discrepando, y el
  // dia que discrepan nadie sabe cual manda. La coma se anade aqui porque en
  // razones sociales aparece —«Encatrans, S.L.»— y en matriculas no.
  return String(v ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[\s.,\-_/]/g, "");
}

/**
 * El contacto que se propone al elegir un cliente.
 *
 * El marcado como principal; si no hay ninguno, el primero de la lista. No se
 * devuelve «ninguno» cuando hay contactos: dejar los campos vacios teniendo el
 * dato obliga a abrir la ficha para copiarlo, que es justo lo que se venia a
 * ahorrar.
 */
export function contactoPropuesto(
  contactos?: ContactoCliente[] | null,
): ContactoCliente | null {
  const lista = Array.isArray(contactos) ? contactos.filter((c) => c && c.name) : [];
  if (lista.length === 0) return null;
  return lista.find((c) => c.isPrimary === true) ?? lista[0];
}

/// El telefono de un contacto: el movil antes que el fijo.
///
/// A quien pide una asistencia se le llama al movil; el fijo de centralita a
/// las tres de la madrugada no lo coge nadie.
export function telefonoDe(c?: ContactoCliente | null): string {
  if (!c) return "";
  return String(c.mobile || c.phone || "").trim();
}

/// El nombre completo del contacto, para pintarlo en un campo.
export function nombreDe(c?: ContactoCliente | null): string {
  if (!c) return "";
  return [c.name, c.surname].filter(Boolean).join(" ").trim();
}

/// La linea de debajo del nombre en la lista: lo que distingue dos parecidos.
///
/// «Encatrans» y «Encatrans Logistica» no se pueden elegir a ciegas, asi que
/// van el CIF, la poblacion y a quien se llama.
export function detalleDe(c: ClienteFrecuente): string {
  const contacto = contactoPropuesto(c.contactos);
  return [
    c.taxId,
    c.city,
    nombreDe(contacto) || null,
    telefonoDe(contacto) || c.contactPhone || null,
  ]
    .filter(Boolean)
    .join(" · ");
}

/**
 * Si hay que ofrecer «darlo de alta».
 *
 * Solo cuando lo escrito no coincide EXACTAMENTE con ninguno de los que ya
 * salen. Ofrecer el alta de «Encatrans» teniendo «Encatrans» en la lista
 * invita a crear el duplicado que esto viene a evitar.
 *
 * La comparacion es la normalizada: «ENCATRANS S.L.» no puede pasar por nuevo
 * teniendo «Encatrans» dado de alta.
 */
export function ofrecerAlta(texto: string, resultados: ClienteFrecuente[]): boolean {
  const t = normalizar(texto);
  if (t.length < kMinimoParaBuscar) return false;
  return !resultados.some((c) => normalizar(c.name) === t);
}
