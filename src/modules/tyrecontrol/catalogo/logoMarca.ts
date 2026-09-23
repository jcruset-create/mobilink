/**
 * Emparejar la marca escrita en un vehículo con la del catálogo, para poder
 * enseñar su logo.
 *
 * El problema es que `tc_vehiculos.marca` es texto libre —lo que llegó de
 * Movertis, de un Excel o de lo que tecleó el técnico— y ahí conviven
 * "MERCEDES", "MERCEDES-BENZ" y "Mercedes Benz" para la misma marca. El
 * catálogo (`tc_cat_marcas_vehiculo`) sí tiene un nombre y un logo por marca.
 */

export interface MarcaConLogo {
  id: string;
  nombre: string;
  logo_url?: string | null;
}

/** Sin acentos, sin signos y en mayúsculas: "Mercedes-Benz" → "MERCEDESBENZ". */
export function normalizarMarca(nombre: string | null | undefined): string {
  return (nombre ?? "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

/** La primera palabra, que es la que identifica: "MERCEDES-BENZ" → "MERCEDES". */
function primeraPalabra(nombre: string | null | undefined): string {
  const partes = (nombre ?? "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .split(/[^A-Z0-9]+/)
    .filter(Boolean);
  return partes[0] ?? "";
}

/**
 * La marca del catálogo que corresponde a lo que pone el vehículo.
 *
 * Primero por id, que es lo único seguro. Si el vehículo no lo tiene —la
 * mayoría, porque el campo llegó después—, por nombre: exacto, y si no, por
 * la primera palabra, que es lo que arregla el caso real de MERCEDES contra
 * MERCEDES-BENZ.
 *
 * Por primera palabra ENTERA, no por prefijo: "MAN" no puede acabar
 * enseñando el logo de "Manitou", que es exactamente el tipo de error que
 * nadie mira dos veces porque el logo parece que confirma el dato.
 */
export function marcaDelCatalogo(
  vehiculo: { marca?: string | null; marca_id?: string | null },
  catalogo: MarcaConLogo[],
): MarcaConLogo | null {
  if (vehiculo.marca_id) {
    const porId = catalogo.find((m) => m.id === vehiculo.marca_id);
    if (porId) return porId;
  }

  const escrita = normalizarMarca(vehiculo.marca);
  if (!escrita) return null;

  const exacta = catalogo.find((m) => normalizarMarca(m.nombre) === escrita);
  if (exacta) return exacta;

  const palabra = primeraPalabra(vehiculo.marca);
  if (palabra.length < 3) return null;
  const candidatas = catalogo.filter((m) => primeraPalabra(m.nombre) === palabra);
  // Si dos marcas del catálogo empiezan igual no hay forma de decidir, y
  // elegir una a voleo sería peor que no enseñar logo.
  return candidatas.length === 1 ? candidatas[0] : null;
}
