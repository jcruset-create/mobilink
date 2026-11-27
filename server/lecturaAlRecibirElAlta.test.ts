/**
 * Dos cosas del alta que, si se rompen, nadie ve romperse:
 *
 *  · La documentación se lee sola cuando el trabajador envía el formulario,
 *    pero DESPUÉS de contestarle. Si se esperase a la IA antes de responder,
 *    el trabajador se quedaría mirando una pantalla de «enviando» medio minuto
 *    (o vería un error que no es suyo si el modelo está caído).
 *
 *  · La ficha enseña —y «Pasar a la ficha» aplica— la lectura más reciente que
 *    haya, no solo la del último envío. Si vuelve a mirar solo el último, pedir
 *    una actualización «borra» lo que ya se había leído.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const ROUTER = readFileSync(new URL("./core/altaOperarioRouter.ts", import.meta.url), "utf8");

/** El cuerpo de una ruta: desde su declaración hasta la siguiente. */
function ruta(declaracion: string): string {
  const desde = ROUTER.indexOf(declaracion);
  expect(desde).toBeGreaterThan(-1);
  const siguiente = ROUTER.slice(desde + declaracion.length).search(/\n  r\.(get|post|put|delete)\(|\n  return r;/);
  return ROUTER.slice(desde, desde + declaracion.length + siguiente);
}

describe("al enviar el formulario de alta", () => {
  const enviar = ruta('r.post("/:token/enviar"');

  it("se lee la documentación sola", () => {
    expect(enviar).toContain("leerAlRecibir(db, { employeeId: inv.employee_id, invitacionId: inv.id }");
  });

  it("después de contestar al trabajador, y sin esperarla", () => {
    const responde = enviar.lastIndexOf("res.json({ ok: true })");
    const lee = enviar.indexOf("leerAlRecibir(");
    expect(responde).toBeGreaterThan(-1);
    expect(lee).toBeGreaterThan(responde);
    expect(enviar).toContain("void leerAlRecibir(");
    expect(enviar).not.toContain("await leerAlRecibir(");
  });
});

describe("la lectura que se enseña y la que se pasa a la ficha", () => {
  it("la ficha enseña la más reciente que haya, no solo la del último envío", () => {
    const ver = ruta('r.get("/:employeeId"');
    expect(ver).toContain("lecturaVigente(db, employeeId)");
    expect(ver).not.toContain("invitacion?.lectura");
  });

  it("«Pasar a la ficha» aplica esa misma", () => {
    expect(ruta('r.post("/:employeeId/aplicar-lectura"')).toContain("lecturaVigente(db, employeeId)");
  });
});
