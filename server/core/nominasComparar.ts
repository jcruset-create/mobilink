/**
 * Comparar las personas de una nómina con los empleados de Core.
 *
 * Es la parte PURA del importador (`importarNominas.ts`, que es quien explica
 * el porqué de cada regla): no toca la base ni el PDF, y por eso se prueba con
 * datos escritos a mano.
 */

import { dniValido } from "./altaOperario.ts";
import { normalizarDocumento, type PersonaDeNomina } from "./nominasLeer.ts";
import { normalizarNombre } from "./vinculoTecnicos.ts";

export type EmpleadoCore = {
  id: string;
  nombre: string | null;
  apellidos: string | null;
  dni_nie: string | null;
  num_seguridad_social: string | null;
  fecha_alta: string | null;
  cargo: string | null;
  numero_trabajador: string | null;
  activo: boolean;
  company_id: string | null;
};

export type Cambio = {
  campo: "numero_trabajador" | "dni_nie" | "num_seguridad_social" | "fecha_alta" | "cargo";
  etiqueta: string;
  actual: string | null;
  nuevo: string;
};

export type FilaImportacion = {
  nif: string;
  nombre: string;
  apellidos: string;
  codigo: string;
  centro: string;
  grupo: string;
  antiguedad: string | null;
  nass: string;
  paginas: number[];
  periodos: string[];
  tipo: "nuevo" | "actualizar" | "igual" | "baja_en_core";
  /** El empleado de Core con el que casa, si casa. */
  empleadoId: string | null;
  empleadoNombre: string | null;
  /** Casó por nombre porque en Core no tenía DNI. */
  porNombre: boolean;
  cambios: Cambio[];
  avisos: string[];
};

export type Comparacion = {
  filas: FilaImportacion[];
  /** Activos en Core (de esta empresa) que no salen en el PDF. */
  noEnNomina: { id: string; nombre: string; numeroTrabajador: string | null }[];
};

const nombreDe = (e: { nombre?: string | null; apellidos?: string | null }) =>
  [e.nombre, e.apellidos].filter(Boolean).join(" ").trim();

/** Las mismas palabras en cualquier orden: «Migens Avila Lourdes» = «Lourdes Migens Avila». */
const clavePorNombre = (texto: string) => normalizarNombre(texto).split(" ").filter(Boolean).sort().join(" ");

const vacio = (v: unknown) => v === null || v === undefined || String(v).trim() === "";

/**
 * Compara las personas de la nómina con los empleados de Core. Pura: no toca
 * la base, y por eso se prueba con datos escritos a mano.
 *
 * @param conNumero  la columna `numero_trabajador` existe (si no, no se propone)
 */
export function compararConCore(
  personas: PersonaDeNomina[],
  empleados: EmpleadoCore[],
  companyId: string,
  conNumero = true
): Comparacion {
  const porNif = new Map<string, EmpleadoCore>();
  const sinDni = new Map<string, EmpleadoCore[]>();
  for (const e of empleados) {
    const nif = normalizarDocumento(e.dni_nie);
    if (nif) {
      // Si hubiera dos con el mismo DNI, manda el que está activo.
      const ya = porNif.get(nif);
      if (!ya || (!ya.activo && e.activo)) porNif.set(nif, e);
    } else {
      const clave = clavePorNombre(nombreDe(e));
      if (clave) sinDni.set(clave, [...(sinDni.get(clave) ?? []), e]);
    }
  }

  const casados = new Set<string>();
  const filas: FilaImportacion[] = personas.map((p) => {
    const avisos: string[] = [];
    if (!dniValido(p.nif)) avisos.push("El NIF de la nómina no pasa la comprobación de la letra: revísalo.");
    if (p.paginas.length > 1) {
      avisos.push(`Tiene ${p.paginas.length} nóminas en este PDF (${p.periodos.join(" · ")}): puede ser una baja a mitad de mes.`);
    }

    let empleado = porNif.get(p.nif) ?? null;
    let porNombre = false;
    if (!empleado) {
      const candidatos = sinDni.get(clavePorNombre(`${p.nombre} ${p.apellidos}`)) ?? [];
      // Solo si es inequívoco: dos personas con el mismo nombre y sin DNI no
      // se pueden distinguir, y entonces es mejor no casar a ninguna.
      if (candidatos.length === 1) {
        empleado = candidatos[0];
        porNombre = true;
        avisos.push("En Core no tenía DNI: se ha reconocido por el nombre. Compruébalo antes de actualizar.");
      } else if (candidatos.length > 1) {
        avisos.push("Hay varios empleados en Core con ese nombre y sin DNI: ponles el DNI a mano y vuelve a importar.");
      }
    }

    const base = {
      nif: p.nif,
      nombre: p.nombre,
      apellidos: p.apellidos,
      codigo: p.codigo,
      centro: p.centroNombre,
      grupo: p.grupo,
      antiguedad: p.antiguedad,
      nass: p.nass,
      paginas: p.paginas,
      periodos: p.periodos,
      porNombre,
      avisos,
    };

    if (!empleado) {
      return { ...base, tipo: "nuevo", empleadoId: null, empleadoNombre: null, cambios: [] };
    }
    casados.add(empleado.id);

    const cambios: Cambio[] = [];
    if (conNumero && p.codigo && (empleado.numero_trabajador ?? "") !== p.codigo) {
      if (empleado.company_id) {
        cambios.push({ campo: "numero_trabajador", etiqueta: "Nº de trabajador", actual: empleado.numero_trabajador, nuevo: p.codigo });
      } else {
        avisos.push("No tiene empresa en Core: no se le puede poner el número de trabajador hasta que la tenga.");
      }
    }
    // Lo que falta en Core se rellena; lo que ya está puesto no se pisa.
    if (vacio(empleado.dni_nie)) cambios.push({ campo: "dni_nie", etiqueta: "DNI / NIE", actual: null, nuevo: p.nif });
    if (vacio(empleado.num_seguridad_social) && p.nass) {
      cambios.push({ campo: "num_seguridad_social", etiqueta: "Nº Seguridad Social", actual: null, nuevo: p.nass });
    }
    if (vacio(empleado.fecha_alta) && p.antiguedad) {
      cambios.push({ campo: "fecha_alta", etiqueta: "Fecha de alta", actual: null, nuevo: p.antiguedad });
    }
    if (vacio(empleado.cargo) && p.grupo) cambios.push({ campo: "cargo", etiqueta: "Cargo", actual: null, nuevo: p.grupo });

    const comun = { ...base, empleadoId: empleado.id, empleadoNombre: nombreDe(empleado), cambios };
    if (!empleado.activo) {
      avisos.push("En Core está de baja. Si ha vuelto, dale de alta en su ficha; aquí no se crea otro.");
      return { ...comun, tipo: "baja_en_core" };
    }
    return { ...comun, tipo: cambios.length ? "actualizar" : "igual" };
  });

  const noEnNomina = empleados
    .filter((e) => e.activo && e.company_id === companyId && !casados.has(e.id))
    .map((e) => ({ id: e.id, nombre: nombreDe(e), numeroTrabajador: e.numero_trabajador }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));

  return { filas, noEnNomina };
}

export type Empresa = { id: string; nombre: string };

/** La empresa del PDF en Core: por CIF y, si no, por nombre. */
export function elegirEmpresa(
  empresas: (Empresa & { cif: string | null })[],
  delPdf: { cif: string; nombre: string }
): Empresa | null {
  const cif = normalizarDocumento(delPdf.cif);
  const porCif = cif ? empresas.filter((e) => normalizarDocumento(e.cif) === cif) : [];
  if (porCif.length === 1) return { id: porCif[0].id, nombre: porCif[0].nombre };
  // «COMERCIAL SEA, SA» y «COMERCIAL SEA S.A.» son la misma.
  const clave = (t: string) => normalizarNombre(t).replace(/ /g, "");
  const porNombre = empresas.filter((e) => clave(e.nombre) === clave(delPdf.nombre));
  return porNombre.length === 1 ? { id: porNombre[0].id, nombre: porNombre[0].nombre } : null;
}
