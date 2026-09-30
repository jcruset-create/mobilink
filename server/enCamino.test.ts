/**
 * «En camino»: que no se llame a sí mismo y que deje su línea en el diario.
 *
 * ── Por qué se comprueba leyendo el fuente ──────────────────────────────────
 *
 * Mismo motivo que `seguridadFase0.test.ts`, y con su misma limitación: esto
 * vive en `server/index.ts`, veinte mil líneas que no se pueden montar por HTTP
 * sin arrancar el servidor entero con sus trabajos en segundo plano. Esto caza
 * que alguien VUELVA a quitar lo que se arregló; no demuestra que la salida
 * funcione de punta a punta.
 *
 * Las dos reglas de aquí son las dos averías que se vieron el 30/09 y que
 * salían del mismo handler.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const INDEX = readFileSync(new URL("./index.ts", import.meta.url).pathname, "utf8");

/** El fuente sin comentarios: una regla no puede cumplirse en su explicación. */
const CODIGO = INDEX.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");

/**
 * El cuerpo de la función, acotado por la ruta que viene justo detrás.
 *
 * Con una ventana de N caracteres el trozo se colaba en los endpoints
 * siguientes y las comprobaciones de «aquí NO aparece res.json» cazaban el
 * `res.json` de otra ruta. El final es el `app.post` que la usa.
 */
const FUNCION = (() => {
  const i = CODIGO.indexOf("async function ponerAsistenciaEnCamino");
  expect(i, "no se encuentra la función").toBeGreaterThan(0);
  const fin = CODIGO.indexOf('app.post("/api/asistencias/:id/en-camino"', i);
  expect(fin, "no se encuentra la ruta que la usa").toBeGreaterThan(i);
  return CODIGO.slice(i, fin);
})();

describe("el servidor no se llama a sí mismo por HTTP", () => {
  /*
   * La avería: la ruta del operario hacía
   *
   *   fetch(`http://localhost:${PORT}/api/asistencias/${id}/en-camino`)
   *
   * sin cabeceras. Mientras esa ruta no pidió credencial, coló. En cuanto la
   * Fase 0 de seguridad la envolvió en `exigirCredencial`, la llamada interna
   * pasó a contestar 401 y el operario veía «No autorizado» al pulsar «En
   * camino» en el móvil, con la asistencia sin salir.
   *
   * Es una avería de FORMA, no de esa ruta: cualquier otra que se llame a sí
   * misma se romperá igual el día que alguien le ponga un guarda delante. Por
   * eso la regla se escribe sobre todo el fichero.
   */
  it("ninguna ruta hace fetch a su propio puerto", () => {
    expect(CODIGO).not.toMatch(/fetch\(\s*`http:\/\/localhost:\$\{[^}]*PORT/);
  });

  it("y la ruta del operario comparte la función, no la petición", () => {
    const i = CODIGO.indexOf('"/api/roadside-operator/assistances/:id/en-camino"');
    expect(i, "no se encuentra la ruta del operario").toBeGreaterThan(0);
    const trozo = CODIGO.slice(i, i + 2000);
    expect(trozo).toContain("ponerAsistenciaEnCamino(id, req)");
    expect(trozo).not.toContain("localhost");
  });

  it("la función devuelve estado y cuerpo, para que las dos rutas contesten igual", () => {
    // Si volviera a escribir en `res`, dejaría de poder llamarse desde la ruta
    // del operario y la tentación sería rehacer el fetch interno.
    expect(FUNCION).toContain("Promise<{ status: number; body: any }>");
    expect(FUNCION).not.toContain("res.status");
    expect(FUNCION).not.toContain("res.json");
  });
});

describe("la salida queda apuntada en el diario del cliente", () => {
  /*
   * La segunda avería del mismo handler: cambiaba el estado y ponía
   * «departedAtMs», pero no insertaba nada en `roadside_assistance_events`. La
   * página de seguimiento saca de ahí sus «Últimos eventos», así que el cliente
   * veía la barra de pasos en «En camino» y la lista de eventos parada en
   * «Asignada».
   *
   * Y no era que nadie lo apuntara: la vigilancia de Webfleet, que pone en
   * camino sola al salir la furgoneta del taller, SÍ lo apuntaba. O sea que la
   * misma asistencia contaba una cosa u otra según hubiera salido sola o le
   * hubieran dado al botón.
   */
  it("se inserta el evento en_camino", () => {
    expect(FUNCION).toContain("INSERT INTO roadside_assistance_events");
    expect(FUNCION).toContain("'en_camino'");
  });

  it("solo cuando el estado cambia de verdad", () => {
    // Pulsar «En camino» dos veces son dos peticiones, y dos líneas iguales en
    // el diario del cliente no cuentan nada que no contara una.
    expect(FUNCION).toContain('row.status !== "en_camino"');
  });

  it("y apuntar no puede tumbar una salida ya guardada", () => {
    // El operario ya está en camino y el estado es lo que manda: si el apunte
    // falla, se queda en el log y la petición sigue en verde.
    const i = FUNCION.indexOf("INSERT INTO roadside_assistance_events");
    expect(FUNCION.slice(i, i + 600)).toContain("catch");
  });
});
