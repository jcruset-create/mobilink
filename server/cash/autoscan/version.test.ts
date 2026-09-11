import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { descargaAceptable } from "../../../autoscan_agent/src/version.ts";
import { agentePublicado, urlDelAgente, versionPublicada } from "./version.ts";

const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

describe("qué agente hay publicado", () => {
  it("lee la versión del package.json del agente", () => {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(RAIZ, "autoscan_agent", "package.json"), "utf8")
    ) as { version: string };
    expect(versionPublicada()).toBe(pkg.version);
  });

  it("construye la URL con el patrón que publica la CI", () => {
    expect(urlDelAgente("1.2.3")).toBe(
      "https://github.com/jcruset-create/mobilink/releases/download/autoscan-v1.2.3/mobilink-autoscan-1.2.3.zip"
    );
  });

  it("la URL que damos es una que el agente acepta descargar", () => {
    /*
     * Las dos mitades viven en ficheros distintos —el servidor construye, el
     * agente valida— y nada obliga a que coincidan. Si alguien cambiara aquí el
     * anfitrión, o pasara a servir el paquete desde el propio Mobilink, los
     * agentes rechazarían la descarga en silencio y nadie se actualizaría: el
     * aviso saldría en la bandeja y el botón no haría nada.
     *
     * Por eso la comprobación cruzada, que es la que ata las dos mitades.
     */
    const publicado = agentePublicado();
    expect(publicado).not.toBeNull();
    expect(descargaAceptable(publicado!.url)).toBe(true);
  });

  it("una versión con caracteres raros no se cuela en la URL sin codificar", () => {
    /* Defensa de cinturón: la versión sale de un fichero del repositorio, pero
       construir URL pegando texto es justo como se hacen los agujeros. */
    expect(urlDelAgente("1.0.0+7")).toContain("%2B7");
    expect(urlDelAgente("../../otra")).not.toContain("../");
  });
});
