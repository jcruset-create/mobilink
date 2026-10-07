import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Programar el estado de un técnico es cosa de administradores.
 *
 * Decide quién puede coger trabajo y alimenta el cuadro de vacaciones, así que
 * no lo toca cualquiera. Esconder la pestaña en la agenda NO es la cerradura:
 * la cerradura está en el servidor, y este guarda comprueba las dos, porque el
 * día que alguien devuelva el endpoint a `requireSupervisorRole` la pantalla
 * seguiría escondiendo la pestaña y nadie se enteraría.
 */
const RAIZ = new URL("../", import.meta.url).pathname;
const SERVIDOR = readFileSync(`${RAIZ}server/index.ts`, "utf8");
const AGENDA = readFileSync(`${RAIZ}src/components/AgendaView.tsx`, "utf8");

describe("estado de técnico: solo administradores", () => {
  it("el servidor exige rol de administrador para escribir y para borrar", () => {
    expect(SERVIDOR).toContain('app.put("/api/scheduled-tech-statuses", requireAdminRole');
    expect(SERVIDOR).toContain('app.delete("/api/scheduled-tech-statuses/:id", requireAdminRole');
    expect(SERVIDOR).not.toContain('"/api/scheduled-tech-statuses", requireSupervisorRole');
  });

  it("la agenda esconde la pestaña y no abre la barra de un estado ajeno", () => {
    expect(AGENDA).toContain("puedeEditarEstadoTecnico");
    // El guardia del clic sobre «DAVID · BAJA», que es la otra puerta.
    const i = AGENDA.indexOf("function openEditDateReminder(");
    expect(i).toBeGreaterThan(0);
    expect(AGENDA.slice(i, i + 600)).toContain(
      'if (reminder.kind === "tech_status" && !puedeEditarEstadoTecnico) return;'
    );
  });

  it("sin pasar el permiso se queda fuera, no dentro", () => {
    // Un sitio que monte la agenda y se olvide del permiso no puede acabar
    // dando acceso: el valor por defecto es `false`.
    expect(AGENDA).toContain("puedeEditarEstadoTecnico = false,");
  });
});
