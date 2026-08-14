import { describe, it, expect } from "vitest";
import { clasesDeDia, describirDia, type DiaCalendario } from "./calendar.ts";

const navidad: DiaCalendario = {
  date: "2026-12-25", scope: "special", dayClass: "christmas",
  name: "Navidad", yearly: true,
};
const navidadNacional: DiaCalendario = {
  date: "2026-12-25", scope: "national", dayClass: "holiday",
  name: "Natividad del Señor", yearly: true,
};
const anoNuevo: DiaCalendario = {
  date: "2026-01-01", scope: "special", dayClass: "new_year",
  name: "Año Nuevo", yearly: true,
};
const fiestaLocalPolinya: DiaCalendario = {
  date: "2026-08-11", scope: "local", municipality: "Polinyà",
  dayClass: "holiday", name: "Festa Major",
};
const diadaCatalunya: DiaCalendario = {
  date: "2026-09-11", scope: "regional", regionCode: "CT",
  dayClass: "holiday", name: "Diada", yearly: true,
};

const calendario = [navidad, navidadNacional, anoNuevo, fiestaLocalPolinya, diadaCatalunya];

describe("clases de día", () => {
  it("un martes cualquiera es laborable", () => {
    const r = clasesDeDia("2026-08-18", calendario);
    expect(r.clases).toEqual(["workday"]);
    expect(describirDia(r)).toBe("Laborable");
  });

  it("Navidad es a la vez Navidad y festivo nacional, en ese orden", () => {
    // Lo que permite que la regla de Navidad gane a la de festivo por
    // configuración, sin un `if` en el código.
    const r = clasesDeDia("2026-12-25", calendario);
    expect(r.clases[0]).toBe("christmas");
    expect(r.clases).toContain("holiday_national");
    expect(r.clases).toContain("holiday");
    expect(describirDia(r)).toBe("Navidad (día especial)");
  });

  it("los festivos que se repiten valen en cualquier año", () => {
    const r = clasesDeDia("2031-12-25", calendario);
    expect(r.clases).toContain("christmas");
  });

  it("Año Nuevo tiene su propia clase", () => {
    expect(clasesDeDia("2026-01-01", calendario).clases).toContain("new_year");
  });

  it("un festivo local solo aplica en su municipio", () => {
    const enPolinya = clasesDeDia("2026-08-11", calendario, { municipality: "Polinyà" });
    expect(enPolinya.clases).toContain("holiday_local");
    expect(describirDia(enPolinya)).toBe("Festa Major (festivo local)");

    const enVigo = clasesDeDia("2026-08-11", calendario, { municipality: "Vigo" });
    expect(enVigo.clases).toEqual(["workday"]);
  });

  it("el nombre del municipio se compara sin distinguir mayúsculas ni espacios", () => {
    const r = clasesDeDia("2026-08-11", calendario, { municipality: "  polinyà " });
    expect(r.clases).toContain("holiday_local");
  });

  it("si no se sabe dónde es el servicio, el festivo local no se aplica y se avisa", () => {
    // Aplicarlo por si acaso encarecería servicios que no corresponde; no
    // aplicarlo en silencio escondería que falta un dato.
    const r = clasesDeDia("2026-08-11", calendario, {});
    expect(r.clases).toEqual(["workday"]);
    expect(r.avisos).toContain("HOLIDAY_SCOPE_UNKNOWN");
  });

  it("un festivo autonómico aplica en su comunidad y no en otra", () => {
    expect(clasesDeDia("2026-09-11", calendario, { regionCode: "CT" }).clases)
      .toContain("holiday_regional");
    expect(clasesDeDia("2026-09-11", calendario, { regionCode: "GA" }).clases)
      .toEqual(["workday"]);
  });

  it("el sábado y el domingo se clasifican aunque no haya calendario", () => {
    expect(clasesDeDia("2026-08-15", []).clases).toContain("saturday");
    expect(clasesDeDia("2026-08-16", []).clases).toContain("sunday");
  });

  it("un festivo en sábado es festivo y sábado a la vez", () => {
    // 2026-08-15 es sábado y Asunción
    const asuncion: DiaCalendario = {
      date: "2026-08-15", scope: "national", dayClass: "holiday", name: "Asunción",
    };
    const r = clasesDeDia("2026-08-15", [asuncion]);
    expect(r.clases).toContain("holiday");
    expect(r.clases).toContain("saturday");
    // El festivo va primero: es lo más específico
    expect(r.clases.indexOf("holiday")).toBeLessThan(r.clases.indexOf("saturday"));
  });

  it("lo más específico manda en el orden: local por encima de nacional", () => {
    const nacional: DiaCalendario = {
      date: "2026-05-01", scope: "national", dayClass: "holiday", name: "Trabajo",
    };
    const local: DiaCalendario = {
      date: "2026-05-01", scope: "local", municipality: "Reus",
      dayClass: "holiday", name: "Fiesta local",
    };
    const r = clasesDeDia("2026-05-01", [nacional, local], { municipality: "Reus" });
    expect(r.clases[0]).toBe("holiday_local");
    expect(r.festivos[0].scope).toBe("local");
  });

  it("un día desactivado del calendario no cuenta", () => {
    const r = clasesDeDia("2026-12-25", [{ ...navidad, active: false }]);
    expect(r.clases).not.toContain("christmas");
  });
});
