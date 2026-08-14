/**
 * Normalización de medidas de neumático.
 *
 * La implementación se movió a `shared/` porque el motor de tarifas de Central
 * Pro necesita escribir las medidas exactamente igual que TyreControl: si cada
 * módulo normalizara por su cuenta, "315/80 R 22,5" no cruzaría con
 * "315/80R22.5" y el catálogo de precios no casaría nunca con el del almacén.
 *
 * Este fichero se queda como puente para no tocar los ocho sitios que ya la
 * importaban desde aquí.
 */
export { baseMedida, medidaCanonica, mismaMedida } from "../../../../shared/medidas";
