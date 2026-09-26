/**
 * Qué pone en la pestaña del navegador dentro de cada módulo.
 *
 * El panel es UNA sola página: `index.html` trae "Mobilink" y el favicon
 * genérico, y todos los módulos comparten esa pestaña. Aquí se dice, en un solo
 * sitio, cuál es el título y el icono de cada uno; `PestanaDelModulo` lo aplica
 * según la ruta y lo deshace al salir.
 *
 * Añadir un módulo es una línea. Los que no tienen logotipo propio en el
 * repositorio llevan solo título y se quedan con el favicon de Mobilink: es
 * mejor el genérico que uno inventado.
 */

import type { IdentidadPestana } from "./identidadPestana";
import { BASES, rutaEmpiezaPor } from "./rutasModulos";

/** Título y, si lo tiene, nombre de sus iconos en /iconos-modulos. */
type Pestana = { titulo: string; iconos?: string };

// Módulos con base propia (la de `BASES`), por clave de MODULOS_APP.
const POR_MODULO: Record<string, Pestana> = {
  administracion: { titulo: "Mobilink Administración" },
  almacen: { titulo: "Mobilink Almacén" },
  tyrecontrol: { titulo: "Mobilink TyreControl", iconos: "tyrecontrol" },
  "sea-core": { titulo: "Mobilink Core" },
  toolcontrol: { titulo: "Mobilink ToolControl", iconos: "toolcontrol" },
  safety: { titulo: "Mobilink Safety", iconos: "safety" },
  presencia: { titulo: "Mobilink Presencia", iconos: "presencia" },
  workplanner: { titulo: "Mobilink WorkPlanner", iconos: "workplanner" },
  cash: { titulo: "Mobilink Cash", iconos: "cash" },
  central: { titulo: "Mobilink Central", iconos: "central" },
  tacografos: { titulo: "Mobilink TachoCert", iconos: "tacografos" },
  therefore: { titulo: "Mobilink Therefore" },
  recepciones: { titulo: "Mobilink Recepciones" },
  "or-manuales": { titulo: "Mobilink OR Manuales" },
};

/**
 * Módulos que no tienen una base única.
 *
 * Assist es el panel original y está repartido por rutas sueltas, herencia de
 * cuando era la aplicación entera y no un módulo. Se listan una a una en vez de
 * inventarle un prefijo: renombrar esas rutas es otra faena, con sus enlaces y
 * sus APK apuntando a ellas.
 *
 * Las páginas públicas (seguimiento, informe y valoración por token, portal del
 * cliente) NO están aquí a propósito: las abre el cliente final desde un enlace,
 * no son el módulo, y se quedan con la pestaña genérica hasta que se decida qué
 * debe leer ahí quien no trabaja en el taller.
 */
const SUELTOS: { prefijos: string[]; pestana: Pestana }[] = [
  {
    prefijos: [
      "/asistencias", "/operativo2", "/flota", "/otf", "/otf-tv",
      "/panel", "/taller", "/vehiculo",
    ],
    pestana: { titulo: "Mobilink Assist", iconos: "assist" },
  },
  { prefijos: ["/connect"], pestana: { titulo: "Mobilink Connect Pro" } },
  { prefijos: ["/integraciones"], pestana: { titulo: "Mobilink Integration Hub" } },
];

function aIdentidad(p: Pestana): IdentidadPestana {
  if (!p.iconos) return { titulo: p.titulo, iconos: [] };
  const base = `/iconos-modulos/${p.iconos}`;
  return {
    titulo: p.titulo,
    iconos: [
      { rel: "icon", type: "image/png", sizes: "32x32", href: `${base}-32.png` },
      { rel: "icon", type: "image/png", sizes: "16x16", href: `${base}-16.png` },
      { rel: "apple-touch-icon", href: `${base}-180.png` },
    ],
  };
}

/**
 * Identidad que corresponde a una ruta, o null si no es de ningún módulo (el
 * hub, el login y las páginas públicas se quedan con la pestaña de siempre).
 *
 * Gana el prefijo más largo: si algún día cuelga un módulo de otro, manda el
 * de dentro y no el de fuera.
 */
export function identidadParaRuta(ruta: string): IdentidadPestana | null {
  const candidatos: { prefijo: string; pestana: Pestana }[] = [];

  for (const [modulo, pestana] of Object.entries(POR_MODULO)) {
    const base = BASES[modulo];
    if (base && rutaEmpiezaPor(ruta, base)) candidatos.push({ prefijo: base, pestana });
  }
  for (const { prefijos, pestana } of SUELTOS) {
    for (const prefijo of prefijos) {
      if (rutaEmpiezaPor(ruta, prefijo)) candidatos.push({ prefijo, pestana });
    }
  }

  candidatos.sort((a, b) => b.prefijo.length - a.prefijo.length);
  return candidatos.length ? aIdentidad(candidatos[0].pestana) : null;
}

/** Solo para la prueba: los módulos con base propia deben tener su título. */
export const MODULOS_CON_PESTANA = Object.keys(POR_MODULO);
