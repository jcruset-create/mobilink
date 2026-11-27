/**
 * El centro de descargas construye el enlace de la APK de Taller con la
 * versión del pubspec de main (`urlReleaseApk` en server/index.ts). Si la CI
 * publica una versión y no la guarda en main, el enlace lleva a un 404.
 *
 * Pasó el 27/11/2026: la CI publicó 1.0.6+295 y main se quedó en 1.0.5+295,
 * porque el paso que guarda la versión comparaba solo el número de build.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const WORKFLOW = readFileSync(new URL("../.github/workflows/build-taller-apk.yml", import.meta.url), "utf8");
const guardar = WORKFLOW.slice(WORKFLOW.indexOf("- name: Guardar la versión nueva en el repositorio"));

describe("la CI de Taller guarda en main la versión que publica", () => {
  it("con el mismo build y otro nombre, guarda", () => {
    expect(guardar).toContain('if [ "$EN_PUNTA" = "$NOMBRE+$BUILD" ]; then');
  });

  it("solo se salta si la punta lleva un build MÁS NUEVO, no igual", () => {
    expect(guardar).toContain('if [ "${BUILD_PUNTA:-0}" -gt "$BUILD" ]');
    expect(guardar).not.toContain('if [ "${BUILD_PUNTA:-0}" -ge "$BUILD" ]');
  });
});
