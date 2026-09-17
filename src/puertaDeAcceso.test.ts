import { describe, expect, it } from "vitest";
import { puertaDeAcceso } from "./puertaDeAcceso.ts";

describe("a qué login se manda a quien no tiene sesión", () => {
  it("el almacén conserva el suyo", () => {
    expect(puertaDeAcceso("/almacen-neumaticos")).toBe("/almacen-neumaticos/login");
    expect(puertaDeAcceso("/almacen-neumaticos/entradas")).toBe("/almacen-neumaticos/login");
  });

  it("todo lo demás va al acceso del hub", () => {
    /*
     * EL FALLO QUE ESTO ARREGLA. Antes iban también al login del almacén, y ese
     * login no devuelve al sitio de origen: entra y te deja en el almacén. Uno
     * abría Cobros sin sesión y acababa en el inventario de neumáticos sin
     * haber pedido ir allí ni tener forma de volver más que a mano.
     */
    expect(puertaDeAcceso("/cobros")).toBe("/acceso");
    expect(puertaDeAcceso("/cash/jornada")).toBe("/acceso");
    expect(puertaDeAcceso("/toolcontrol/incidencias")).toBe("/acceso");
  });

  it("una ruta que solo EMPIEZA parecido no cuenta como del almacén", () => {
    /*
     * `startsWith` a secas es la clase de comprobación que un día se traga algo
     * que no debía. Queda fijado qué pasa con los vecinos de nombre.
     */
    expect(puertaDeAcceso("/almacen")).toBe("/acceso");
    expect(puertaDeAcceso("/almacen-usados")).toBe("/acceso");
  });
});
