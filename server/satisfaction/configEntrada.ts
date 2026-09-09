/**
 * Qué se acepta cuando alguien cambia la configuración de Satisfaction.
 *
 * En su propio fichero, sin tocar la base: así se puede probar sin levantar
 * PostgreSQL, que es lo que hace falta para una función que solo mira lo que
 * llega y decide si vale.
 */

import type { ConfigSatisfaction } from "./config.ts";

/**
 * Valida y limpia lo que llega para la configuración.
 *
 * Solo reglas de negocio. Ni credenciales de Twilio ni Content SID: eso vive en
 * variables de entorno y no se toca desde una pantalla, porque quien administra
 * el taller no tiene por qué poder cambiar con qué cuenta se manda un WhatsApp.
 */
export function leerConfig(cuerpo: unknown): {
  cambios: Partial<ConfigSatisfaction>; errores: string[];
} {
  const b = (cuerpo ?? {}) as Record<string, unknown>;
  const cambios: Partial<ConfigSatisfaction> = {};
  const errores: string[] = [];

  const bool = (clave: keyof ConfigSatisfaction) => {
    if (!(clave in b)) return;
    const v = b[clave];
    if (typeof v !== "boolean") errores.push(`«${clave}» tiene que ser true o false`);
    else (cambios as Record<string, unknown>)[clave] = v;
  };
  const numero = (clave: keyof ConfigSatisfaction, min: number, max: number) => {
    if (!(clave in b)) return;
    const n = Number(b[clave]);
    if (!Number.isFinite(n) || n < min || n > max) {
      errores.push(`«${clave}» tiene que estar entre ${min} y ${max}`);
    } else (cambios as Record<string, unknown>)[clave] = n;
  };

  bool("activo"); bool("conductor"); bool("cliente"); bool("recordatorio");
  // Los topes son de sentido común, no de capricho: una caducidad de dos meses
  // o un retraso de una semana no son configuraciones, son errores de tecleo.
  numero("caducidadHoras", 1, 24 * 60);
  numero("retrasoMinutos", 0, 60 * 24 * 3);
  numero("recordatorioHoras", 1, 24 * 14);
  return { cambios, errores };
}
