import { describe, expect, it } from "vitest";

import {
  colaDe,
  comoEntraria,
  enCursoDe,
  enEspera,
  estaCerrada,
  type AsistenciaEnCola,
} from "./colaEspera.ts";

/** Una asistencia con lo mínimo, para no repetir el objeto entero cada vez. */
function a(
  id: number,
  tecnico: string | null,
  status: string,
  esperaTrasId: number | null = null,
): AsistenciaEnCola {
  return { id, assignedTechName: tecnico, status, esperaTrasId };
}

describe("cuándo una asistencia deja libre al operario", () => {
  it("la que está en camino o en el sitio lo sigue ocupando", () => {
    expect(estaCerrada(a(1, "Anthoni", "asignada"))).toBe(false);
    expect(estaCerrada(a(1, "Anthoni", "en_camino"))).toBe(false);
    expect(estaCerrada(a(1, "Anthoni", "en_sitio"))).toBe(false);
  });

  it("la que llegó al taller, se canceló o se redirigió, no", () => {
    expect(estaCerrada(a(1, "Anthoni", "llegada_taller"))).toBe(true);
    expect(estaCerrada(a(1, "Anthoni", "cancelada"))).toBe(true);
    expect(estaCerrada(a(1, "Anthoni", "redirigida"))).toBe(true);
  });
});

describe("estar en espera se deduce, no se guarda", () => {
  it("espera mientras la de delante siga abierta", () => {
    const todas = [a(145, "Anthoni", "en_camino"), a(152, "Anthoni", "asignada", 145)];
    expect(enEspera(todas[1], todas)).toBe(true);
  });

  it("en cuanto la de delante se cierra, deja de esperar sola", () => {
    // Nadie ha tocado esperaTrasId: sigue apuntando a la 145. Y aun así la 152
    // ya no está en espera. Esto es lo que hace que un fallo del enganche del
    // cierre no pueda dejar a un operario sin trabajo.
    const todas = [a(145, "Anthoni", "llegada_taller", null), a(152, "Anthoni", "asignada", 145)];
    expect(enEspera(todas[1], todas)).toBe(false);
  });

  it("también se suelta si la de delante se cancela o se redirige", () => {
    for (const estado of ["cancelada", "redirigida"]) {
      const todas = [a(145, "Anthoni", estado), a(152, "Anthoni", "asignada", 145)];
      expect(enEspera(todas[1], todas)).toBe(false);
    }
  });

  it("la que no espera a nadie no está en espera", () => {
    const todas = [a(152, "Anthoni", "asignada", null)];
    expect(enEspera(todas[0], todas)).toBe(false);
  });

  it("una asistencia ya cerrada no está en espera de nada", () => {
    const todas = [a(145, "Anthoni", "en_camino"), a(152, "Anthoni", "cancelada", 145)];
    expect(enEspera(todas[1], todas)).toBe(false);
  });

  it("si la de delante no aparece, se suelta la cola", () => {
    // Preferimos soltarla a dejarla presa por una asistencia que ni se puede
    // consultar: lo peor que pasa es que el operario vea dos, y eso se ve.
    const todas = [a(152, "Anthoni", "asignada", 999)];
    expect(enEspera(todas[0], todas)).toBe(false);
  });
});

describe("qué lleva ahora cada operario", () => {
  it("la asignada, abierta y que no espera", () => {
    const todas = [a(145, "Anthoni", "en_camino"), a(152, "Anthoni", "asignada", 145)];
    expect(enCursoDe("Anthoni", todas)?.id).toBe(145);
  });

  it("nada si todas las suyas están cerradas", () => {
    const todas = [a(145, "Anthoni", "llegada_taller"), a(150, "Anthoni", "cancelada")];
    expect(enCursoDe("Anthoni", todas)).toBeNull();
  });

  it("no se le cuentan las de otro operario", () => {
    const todas = [a(145, "Marc", "en_camino"), a(152, "Anthoni", "asignada")];
    expect(enCursoDe("Anthoni", todas)?.id).toBe(152);
    expect(enCursoDe("Marc", todas)?.id).toBe(145);
  });

  it("si alguien le asignó dos a mano, la más antigua", () => {
    // El servidor nunca ha impedido asignar dos sin cola. La más antigua es la
    // que de verdad lo está ocupando.
    const todas = [a(152, "Anthoni", "asignada"), a(145, "Anthoni", "en_camino")];
    expect(enCursoDe("Anthoni", todas)?.id).toBe(145);
  });

  it("un operario sin nada asignado no lleva nada", () => {
    expect(enCursoDe("Anthoni", [a(145, "Marc", "en_camino")])).toBeNull();
    expect(enCursoDe("Anthoni", [])).toBeNull();
  });
});

describe("la cola de un operario", () => {
  it("por orden de alta: quien primero entró, primero sale", () => {
    const todas = [
      a(145, "Anthoni", "en_camino"),
      a(160, "Anthoni", "asignada", 145),
      a(152, "Anthoni", "asignada", 145),
    ];
    expect(colaDe("Anthoni", todas).map((x) => x.id)).toEqual([152, 160]);
  });

  it("la que lleva ahora no sale en su propia cola", () => {
    const todas = [a(145, "Anthoni", "en_camino"), a(152, "Anthoni", "asignada", 145)];
    expect(colaDe("Anthoni", todas).map((x) => x.id)).toEqual([152]);
  });

  it("al cerrarse la de delante, la cola se vacía y esa pasa a ser la de ahora", () => {
    const todas = [a(145, "Anthoni", "llegada_taller"), a(152, "Anthoni", "asignada", 145)];
    expect(colaDe("Anthoni", todas)).toEqual([]);
    expect(enCursoDe("Anthoni", todas)?.id).toBe(152);
  });

  it("cada operario tiene la suya", () => {
    const todas = [
      a(145, "Anthoni", "en_camino"),
      a(152, "Anthoni", "asignada", 145),
      a(146, "Marc", "en_camino"),
      a(153, "Marc", "asignada", 146),
    ];
    expect(colaDe("Anthoni", todas).map((x) => x.id)).toEqual([152]);
    expect(colaDe("Marc", todas).map((x) => x.id)).toEqual([153]);
  });
});

describe("qué avisar antes de guardar la asignación", () => {
  it("entra directa si el operario está libre", () => {
    expect(comoEntraria(152, "Anthoni", [a(145, "Anthoni", "llegada_taller")])).toEqual({
      directa: true,
    });
  });

  it("queda detrás de la que lleva ahora", () => {
    expect(comoEntraria(152, "Anthoni", [a(145, "Anthoni", "en_camino")])).toEqual({
      directa: false,
      trasId: 145,
    });
  });

  it("nunca detrás de sí misma", () => {
    // Reasignar la que ya estaba en curso al mismo operario no la pone a
    // esperarse a sí misma, que la dejaría bloqueada para siempre.
    expect(comoEntraria(145, "Anthoni", [a(145, "Anthoni", "en_camino")])).toEqual({
      directa: true,
    });
  });

  it("una asistencia que aún no existe, sobre un operario ocupado", () => {
    // Al crearla desde el panel todavía no hay id.
    expect(comoEntraria(null, "Anthoni", [a(145, "Anthoni", "en_camino")])).toEqual({
      directa: false,
      trasId: 145,
    });
  });

  it("detrás de la más antigua cuando hay varias sin cola", () => {
    const todas = [a(145, "Anthoni", "en_camino"), a(150, "Anthoni", "asignada")];
    expect(comoEntraria(152, "Anthoni", todas)).toEqual({ directa: false, trasId: 145 });
  });
});
