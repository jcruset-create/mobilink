/**
 * Las rutas de la APK tienen que registrarse ANTES que el router del panel.
 *
 * ── Por qué existe esta prueba ──────────────────────────────────────────────
 *
 * El asistente, el flanco y el parte cuelgan de /api/tyrecontrol, la misma
 * raíz que el router del back-office. Ese router hace `router.use(guarda)` con
 * el guarda del panel, que responde 401 "No autorizado" a quien no traiga el
 * token de administrador. Express prueba los middlewares en el orden en que se
 * registran, así que con el `app.use("/api/tyrecontrol", …)` por delante, ese
 * 401 se come TODAS las rutas de la APK aunque cada una tenga su propio guarda.
 *
 * No es hipotético: el técnico terminaba el parte en la tablet, pulsaba
 * "Ver el PDF" y le salía "Exception: No autorizado", con el parte ya guardado.
 * El fallo no se ve leyendo ninguno de los dos ficheros por separado — solo
 * mirando en qué orden se montan— y se rompe otra vez con solo mover una línea.
 *
 * ── Qué comprueba y qué NO ──────────────────────────────────────────────────
 *
 * Se lee el código fuente y se comparan posiciones. No levanta el servidor:
 * index.ts necesita base de datos y un montón de variables de entorno, y
 * arrancarlo aquí costaría más de lo que aporta. Lo que sí garantiza es la
 * única condición que hacía falta y que nadie estaba vigilando: el orden.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const fuente = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "index.ts"),
  "utf8",
);

/**
 * Solo CÓDIGO: se buscan las llamadas al principio de línea. Los comentarios
 * de index.ts citan estas mismas líneas para explicar por qué van donde van,
 * y buscarlas en bruto encontraría antes la explicación que la instrucción.
 */
const enCodigo = (patron: RegExp): number => {
  const m = fuente.match(patron);
  return m?.index ?? -1;
};

/** Dónde se monta el router del panel, que atrapa todo /api/tyrecontrol. */
const routerPanel = enCodigo(/^app\.use\("\/api\/tyrecontrol"/m);

describe("orden de las rutas de /api/tyrecontrol", () => {
  it("el router del panel se monta una sola vez", () => {
    const veces = fuente.match(/^app\.use\("\/api\/tyrecontrol"/gm)?.length ?? 0;
    expect(veces).toBe(1);
  });

  for (const mount of ["mountAsistente", "mountFlanco", "mountParte"]) {
    it(`${mount} va antes del router del panel, o sus rutas dan 401`, () => {
      const donde = enCodigo(new RegExp(`^${mount}\\(app,`, "m"));
      expect(donde, `no se encuentra la llamada a ${mount}(app, …)`).toBeGreaterThan(-1);
      expect(routerPanel).toBeGreaterThan(-1);
      expect(donde).toBeLessThan(routerPanel);
    });
  }

  it("cada una sigue llevando su propio guarda: adelantarlas no las abre", () => {
    for (const mount of ["mountAsistente", "mountFlanco", "mountParte"]) {
      const linea = fuente
        .slice(enCodigo(new RegExp(`^${mount}\\(app,`, "m")))
        .split(";")[0];
      expect(linea).toContain("authenticate");
      expect(linea).toContain('requireModule("tyrecontrol")');
    }
  });
});
