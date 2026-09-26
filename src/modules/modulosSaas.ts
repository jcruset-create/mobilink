/**
 * Los módulos que admiten `app_licencias` y `app_usuario_modulos`.
 *
 * Es la ÚNICA lista. Antes había tres y ya habían divergido: el CHECK de la
 * base conocía dieciséis, el panel de licencias ofrecía doce —así que no se
 * podía licenciar Central, Therefore, Recepciones ni OR Manuales— y el
 * catálogo de accesos quince. Cada sitio se enteraba de los módulos nuevos por
 * su cuenta, y el que se olvidaba fallaba en silencio.
 *
 * **Al crear un módulo del SaaS, se añade aquí y en ningún otro sitio.**
 *
 * Ojo con `server/central/schema.ts`: interpola esta lista para reconstruir el
 * CHECK en cada arranque. Un módulo que falte aquí hace que el `ADD CONSTRAINT`
 * falle en cuanto exista su primera licencia, y el `DROP` anterior ya ha
 * pasado: base sin restricción y un error en el log del despliegue.
 */
export const MODULOS_SAAS = [
  "assist",
  "administracion",
  "tyrecontrol",
  "almacen",
  "sea-core",
  "toolcontrol",
  "safety",
  "presencia",
  "taller",
  "workplanner",
  "cash",
  "central",
  "tacografos",
  "therefore",
  "recepciones",
  "or-manuales",
] as const;

export type ModuloSaas = (typeof MODULOS_SAAS)[number];

/**
 * Cómo se llama cada módulo para una persona.
 *
 * Los nombres son los del catálogo de accesos (`MODULOS_APP`); una prueba
 * comprueba que no se separen. `taller` no está en ese catálogo -es la app del
 * taller, no una pantalla del panel- pero sí se licencia, así que vive aquí.
 */
export const NOMBRE_MODULO: Record<ModuloSaas, string> = {
  assist: "Mobilink Assist",
  administracion: "Administración",
  tyrecontrol: "TyreControl",
  almacen: "Almacén neumáticos",
  "sea-core": "Mobilink Core (RRHH)",
  toolcontrol: "ToolControl",
  safety: "Safety Manager",
  presencia: "Presencia",
  taller: "Panel de taller",
  workplanner: "Mobilink WorkPlanner",
  cash: "Mobilink Cash",
  central: "MC Central",
  tacografos: "Mobilink TachoCert",
  therefore: "Therefore",
  recepciones: "Recepciones",
  "or-manuales": "OR Manuales",
};

/** Nombre del módulo, o su clave si es uno que aún no conocemos. */
export function nombreModulo(clave: string): string {
  return NOMBRE_MODULO[clave as ModuloSaas] ?? clave;
}
