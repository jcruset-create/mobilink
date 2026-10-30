import { describe, expect, it } from "vitest";
import { matriculaDeFurgoneta } from "./furgonetaDelTrabajo";

const FURGONETAS = [
  { id: 1, name: "Furgoneta 1", plate: "4329NFT" },
  { id: 2, name: "Furgo taller", plate: "" },
  { id: 3, name: "Sprinter", plate: null },
];

describe("matriculaDeFurgoneta", () => {
  it("un trabajo móvil: por id, y sale la matrícula", () => {
    expect(matriculaDeFurgoneta({ assignedVehicleId: 1 }, FURGONETAS)).toBe("4329NFT");
  });

  it("una asistencia: por nombre, y sale la matrícula", () => {
    expect(matriculaDeFurgoneta({ assignedVehicleName: "furgoneta 1" }, FURGONETAS)).toBe("4329NFT");
  });

  it("sin matrícula en la ficha, el nombre", () => {
    expect(matriculaDeFurgoneta({ assignedVehicleId: 2 }, FURGONETAS)).toBe("Furgo taller");
    expect(matriculaDeFurgoneta({ assignedVehicleName: "Sprinter" }, FURGONETAS)).toBe("Sprinter");
  });

  it("si el nombre ya es la matrícula, también la encuentra", () => {
    expect(matriculaDeFurgoneta({ assignedVehicleName: "4329nft" }, FURGONETAS)).toBe("4329NFT");
  });

  it("sin ficha, lo escrito; sin furgoneta, nada", () => {
    expect(matriculaDeFurgoneta({ assignedVehicleName: "Alquiler 7788KLM" }, FURGONETAS)).toBe("Alquiler 7788KLM");
    expect(matriculaDeFurgoneta({}, FURGONETAS)).toBeNull();
    expect(matriculaDeFurgoneta({ assignedVehicleId: 99, assignedVehicleName: " " }, FURGONETAS)).toBeNull();
  });
});
