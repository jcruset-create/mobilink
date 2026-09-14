import { describe, expect, it } from "vitest";
import {
  anonimizarMessageId,
  bastidorFalso,
  detectar,
  informacionAdicional,
  loQueQueda,
  matriculaFalsa,
  nifFalso,
  proponerSustitutos,
  sustituir,
} from "./anonimizar.ts";

/*
 * El texto de ejemplo NO usa datos reales: es el patrón del encargo con
 * valores inventados. Lo que se prueba es la mecánica, no un caso concreto.
 */
const CUERPO = [
  "Incidencia en factura recibida.",
  "Empresa 007 Comercial Ejemplo_New",
  "",
  "Información Adicional:",
  "",
  "Buenas por favor grabar el siguiente albarán",
  "",
  "Grabar",
  "0806295 272.83e T2",
  "",
  "Código Proveedor: 8",
  "Razón Social: PROVEEDOR EJEMPLO, S.L.",
  "Cuenta Contable: 4040000001",
  "Número Factura: 0000123514",
  "Importe: -45,63",
  "Matrícula: 6352GVV",
  "Bastidor: VF30E9HZHAS115406",
  "Contacto: daniel.gomez@proveedor-ejemplo.es  Tel. 977123456",
].join("\n");

describe("lo que NO se toca", () => {
  /*
   * La prueba que importa: si el anonimizador altera un número que participa
   * en la lógica, el lote deja de servir para validar el parser.
   */
  it("números de albarán, factura, importes y cuenta salen intactos", () => {
    const hallazgos = detectar(CUERPO);
    const anonimo = sustituir(CUERPO, proponerSustitutos(hallazgos));

    for (const intacto of ["0806295", "272.83", "T2", "0000123514", "4040000001", "-45,63", "8"]) {
      expect(anonimo, `se ha perdido ${intacto}`).toContain(intacto);
    }
  });

  it("la estructura del correo se conserva línea a línea", () => {
    const anonimo = sustituir(CUERPO, proponerSustitutos(detectar(CUERPO)));
    expect(anonimo.split("\n")).toHaveLength(CUERPO.split("\n").length);
    expect(anonimo).toContain("Información Adicional:");
    expect(anonimo).toContain("Grabar");
  });
});

describe("lo que sí se sustituye", () => {
  it("encuentra correo, teléfono, NIF, matrícula y bastidor", () => {
    const tipos = detectar(CUERPO).map((h) => h.tipo);
    expect(tipos).toContain("email");
    expect(tipos).toContain("matricula");
    expect(tipos).toContain("bastidor");
    expect(tipos).toContain("telefono");
  });

  it("la matrícula desaparece pero sigue habiendo una matrícula", () => {
    const anonimo = sustituir(CUERPO, proponerSustitutos(detectar(CUERPO)));
    expect(anonimo).not.toContain("6352GVV");
    // El parser tiene que seguir teniendo delante algo con forma de matrícula:
    // sustituirla por «[MATRÍCULA]» haría que el lote no probara el reconocedor.
    expect(anonimo).toMatch(/Matrícula: \d{4}[BCDFGHJKLMNPRSTVWXYZ]{3}/);
  });

  it("el bastidor también conserva la forma", () => {
    const anonimo = sustituir(CUERPO, proponerSustitutos(detectar(CUERPO)));
    expect(anonimo).not.toContain("VF30E9HZHAS115406");
    expect(anonimo).toMatch(/Bastidor: [A-HJ-NPR-Z0-9]{17}/);
  });
});

describe("estabilidad", () => {
  /*
   * Si el sustituto fuese aleatorio, el mismo proveedor saldría con dos
   * nombres en dos casos y el lote no podría probar la deduplicación, que es
   * justo lo que tiene que cruzar correo, factura y adjunto.
   */
  it("el mismo valor da siempre el mismo sustituto", () => {
    expect(matriculaFalsa("6352GVV")).toBe(matriculaFalsa("6352GVV"));
    expect(bastidorFalso("VF30E9HZHAS115406")).toBe(bastidorFalso("VF30E9HZHAS115406"));
  });

  it("valores distintos dan sustitutos distintos", () => {
    expect(matriculaFalsa("6352GVV")).not.toBe(matriculaFalsa("6352GVW"));
  });

  /* Un NIF con letra inválida enseñaría al parser a aceptar basura. */
  it("el NIF falso lleva la letra de control correcta", () => {
    const nif = nifFalso("12345678Z");
    const numero = Number(nif.slice(0, 8));
    expect(nif[8]).toBe("TRWAGMYFPDXBNJZSQVHLCKE"[numero % 23]);
  });

  /*
   * Un CIF tiene que salir como CIF. Si un CIF de proveedor se convirtiera en
   * un NIF de persona, el lote dejaría de tener la forma que el parser
   * encuentra en la realidad.
   */
  it("un CIF sale como CIF y un NIF como NIF", () => {
    expect(nifFalso("B12345674")).toMatch(/^[A-Z]\d{7}[0-9A-J]$/);
    expect(nifFalso("12345678Z")).toMatch(/^\d{8}[A-Z]$/);
  });

  it("el control del CIF también es correcto", () => {
    const cif = nifFalso("B12345674");
    const digitos = cif.slice(1, 8);
    let suma = 0;
    for (let i = 0; i < 7; i++) {
      const d = Number(digitos[i]);
      if (i % 2 === 0) {
        const doble = d * 2;
        suma += Math.floor(doble / 10) + (doble % 10);
      } else {
        suma += d;
      }
    }
    const control = (10 - (suma % 10)) % 10;
    const esperado = "PQRSNW".includes(cif[0]) ? "JABCDEFGHI"[control] : String(control);
    expect(cif[8]).toBe(esperado);
  });
});

describe("sustitución literal", () => {
  /*
   * De la clave más larga a la más corta. Con la corta primero, «PROVEEDOR
   * EJEMPLO» se comería el principio de «PROVEEDOR EJEMPLO, S.L.» y quedaría
   * un nombre mezclado, mitad falso mitad real.
   */
  it("la clave más larga gana", () => {
    const r = sustituir("PROVEEDOR EJEMPLO, S.L. factura a PROVEEDOR EJEMPLO", {
      "PROVEEDOR EJEMPLO": "UNO",
      "PROVEEDOR EJEMPLO, S.L.": "UNO, S.L.",
    });
    expect(r).toBe("UNO, S.L. factura a UNO");
  });

  it("no distingue mayúsculas: el mismo nombre viene escrito de dos formas", () => {
    const r = sustituir("PROVEEDOR EJEMPLO y Proveedor Ejemplo", {
      "proveedor ejemplo": "UNO",
    });
    expect(r).toBe("UNO y UNO");
  });
});

describe("la red de seguridad", () => {
  it("avisa de lo que se ha quedado sin anonimizar", () => {
    // Se sustituye sólo el correo; la matrícula y el bastidor siguen ahí.
    const mapa = { "daniel.gomez@proveedor-ejemplo.es": "persona1@example.invalid" };
    const quedan = loQueQueda(sustituir(CUERPO, mapa), mapa).map((h) => h.tipo);
    expect(quedan).toContain("matricula");
    expect(quedan).toContain("bastidor");
  });

  it("con el mapa completo no queda nada", () => {
    const mapa = proponerSustitutos(detectar(CUERPO));
    expect(loQueQueda(sustituir(CUERPO, mapa), mapa)).toEqual([]);
  });

  /* Un NIF falso sigue pareciendo un NIF, y debe: no es un hallazgo. */
  it("lo que ha introducido el propio mapa no cuenta como hallazgo", () => {
    const mapa = { "6352GVV": matriculaFalsa("6352GVV") };
    const texto = sustituir("Matrícula: 6352GVV", mapa);
    expect(loQueQueda(texto, mapa)).toEqual([]);
  });
});

describe("el bloque de Información Adicional", () => {
  /*
   * Es la mitad del correo que escribe una PERSONA. La otra mitad la rellena
   * Therefore siempre igual, y no es «información adicional» de nadie.
   */
  it("se queda con lo que escribió la persona y corta en la plantilla", () => {
    const bloque = informacionAdicional(CUERPO);
    expect(bloque).toContain("Buenas por favor grabar el siguiente albarán");
    expect(bloque).toContain("Grabar");
    expect(bloque).toContain("0806295 272.83e T2");
    // Y NO se lleva por delante los campos de plantilla.
    expect(bloque).not.toContain("Código Proveedor");
    expect(bloque).not.toContain("Razón Social");
    expect(bloque).not.toContain("Cuenta Contable");
  });

  it("no incluye la propia etiqueta de apertura", () => {
    expect(informacionAdicional(CUERPO)).not.toMatch(/Información Adicional/i);
  });

  it("sin la etiqueta devuelve el cuerpo entero en vez de nada", () => {
    const suelto = "Grabar\n0806295";
    expect(informacionAdicional(suelto)).toBe(suelto);
  });

  it("un correo con bloque libre pero sin plantilla se devuelve entero", () => {
    const texto = "Información Adicional:\n\nGrabar\n123456\n789012";
    expect(informacionAdicional(texto)).toBe("Grabar\n123456\n789012");
  });
});

describe("el Message-ID", () => {
  /*
   * El dominio dice de quién es el buzón; la parte local es lo que hace único
   * el mensaje, y sin ella no se puede probar que procesarlo dos veces no cree
   * dos notificaciones.
   */
  it("pierde el dominio y conserva la parte local", () => {
    expect(anonimizarMessageId("<inc-0806295@therefore.empresa-real.es>")).toBe(
      "<inc-0806295@example.invalid>"
    );
  });

  it("dos mensajes distintos siguen teniendo identificadores distintos", () => {
    const a = anonimizarMessageId("<uno@empresa-real.es>");
    const b = anonimizarMessageId("<dos@empresa-real.es>");
    expect(a).not.toBe(b);
  });

  it("sin Message-ID no inventa uno", () => {
    expect(anonimizarMessageId(null)).toBe("");
    expect(anonimizarMessageId(undefined)).toBe("");
  });
});
