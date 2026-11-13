import { describe, it, expect } from "vitest";
import { claveDeFoto, marcasDelPlano, type RuedaDelPlano } from "./planoAlertas";

const FOTO_BUS = "https://x.supabase.co/storage/v1/object/public/tc-chasis/config-ejes/6ac2b9a4/1785514268172.png";
const FOTO_AUTOCAR = "https://x.supabase.co/storage/v1/object/public/tc-chasis/config-ejes/e9e16460/1790189505870.png";
const FOTO_FURGO = "https://x.supabase.co/storage/v1/object/public/tc-chasis/bc8a185d/1785511664708-alineada.png";

function rueda(codigo: string, eje: number, lado: string, ie: string | null = null): RuedaDelPlano {
  return { codigo_posicion: codigo, eje, lado, interior_exterior: ie };
}

/** Las seis del autobús 2x4, en el orden en que las devuelve la función. */
const BUS: RuedaDelPlano[] = [
  rueda("E1_IZQ", 1, "izq"),
  rueda("E1_DER", 1, "der"),
  rueda("E2_IZQ_EXT", 2, "izq", "ext"),
  rueda("E2_IZQ_INT", 2, "izq", "int"),
  rueda("E2_DER_INT", 2, "der", "int"),
  rueda("E2_DER_EXT", 2, "der", "ext"),
];

/** Las ocho del autocar 2x4x2. */
const AUTOCAR: RuedaDelPlano[] = [
  ...BUS,
  rueda("E3_IZQ", 3, "izq"),
  rueda("E3_DER", 3, "der"),
].map((r) => (r.eje === 3 ? r : r));

const por = (ms: ReturnType<typeof marcasDelPlano>, codigo: string) => {
  const m = ms.find((x) => x.codigo === codigo);
  if (!m) throw new Error(`falta la marca de ${codigo}`);
  return m;
};

describe("claveDeFoto", () => {
  it("se queda con el nombre del fichero", () => {
    expect(claveDeFoto(FOTO_BUS)).toBe("1785514268172.png");
    expect(claveDeFoto(FOTO_FURGO)).toBe("1785511664708-alineada.png");
  });

  it("tira los parámetros de la URL, que no identifican la imagen", () => {
    expect(claveDeFoto(`${FOTO_BUS}?width=300`)).toBe("1785514268172.png");
  });

  it("sin foto, cadena vacía y no revienta", () => {
    expect(claveDeFoto(null)).toBe("");
    expect(claveDeFoto(undefined)).toBe("");
  });
});

describe("marcasDelPlano · el autobús de dos ejes", () => {
  const marcas = marcasDelPlano(BUS, FOTO_BUS);

  it("devuelve una marca por rueda", () => {
    expect(marcas).toHaveLength(6);
    expect(new Set(marcas.map((m) => m.codigo)).size).toBe(6);
  });

  it("todas caen dentro de la imagen", () => {
    for (const m of marcas) {
      expect(m.left).toBeGreaterThan(0);
      expect(m.left).toBeLessThan(100);
      expect(m.top).toBeGreaterThan(0);
      expect(m.top).toBeLessThan(100);
    }
  });

  it("el primer eje va al lado de su rueda, cada uno a su lado", () => {
    // La rueda está en el 26,3 % y el recuadro 8,5 puntos hacia fuera.
    expect(por(marcas, "E1_IZQ").left).toBeCloseTo(17.8, 1);
    expect(por(marcas, "E1_DER").left).toBeCloseTo(82.2, 1);
    // A la altura de la rueda, no más abajo.
    expect(por(marcas, "E1_IZQ").top).toBeCloseTo(14.3, 1);
  });

  it("el eje gemelo va DETRÁS de los neumáticos", () => {
    const rueda = 60.0;
    for (const c of ["E2_IZQ_EXT", "E2_IZQ_INT", "E2_DER_INT", "E2_DER_EXT"]) {
      expect(por(marcas, c).top).toBeGreaterThan(rueda);
      expect(por(marcas, c).top).toBeCloseTo(74.5, 1);
    }
  });

  it("los cuatro del gemelo salen en su orden real: ext, int, int, ext", () => {
    const x = (c: string) => por(marcas, c).left;
    expect(x("E2_IZQ_EXT")).toBeLessThan(x("E2_IZQ_INT"));
    expect(x("E2_IZQ_INT")).toBeLessThan(x("E2_DER_INT"));
    expect(x("E2_DER_INT")).toBeLessThan(x("E2_DER_EXT"));
  });

  it("la pareja queda separada, ni pegada ni abierta", () => {
    const hueco = por(marcas, "E2_IZQ_INT").left - por(marcas, "E2_IZQ_EXT").left;
    expect(hueco).toBeGreaterThan(8);
    expect(hueco).toBeLessThan(16);
  });

  it("es simétrico: lo que se aparta a la izquierda se aparta a la derecha", () => {
    const pares: [string, string][] = [
      ["E1_IZQ", "E1_DER"],
      ["E2_IZQ_EXT", "E2_DER_EXT"],
      ["E2_IZQ_INT", "E2_DER_INT"],
    ];
    for (const [i, d] of pares) {
      expect(por(marcas, i).left + por(marcas, d).left).toBeCloseTo(100, 1);
    }
  });
});

describe("marcasDelPlano · el autocar de tres ejes", () => {
  const marcas = marcasDelPlano(AUTOCAR, FOTO_AUTOCAR);

  it("pinta las ocho", () => {
    expect(marcas).toHaveLength(8);
  });

  it("el tercer eje va al lado, no encima, y más despegado que el primero", () => {
    const primero = 50 - por(marcas, "E1_IZQ").left;
    const tercero = 50 - por(marcas, "E3_IZQ").left;
    expect(tercero).toBeGreaterThan(primero);
    expect(por(marcas, "E3_IZQ").top).toBeCloseTo(74.5, 1);
  });

  it("cada eje a su altura, de delante atrás", () => {
    expect(por(marcas, "E1_IZQ").top).toBeLessThan(por(marcas, "E2_IZQ_EXT").top);
    expect(por(marcas, "E2_IZQ_EXT").top).toBeLessThan(por(marcas, "E3_IZQ").top);
  });

  it("los del gemelo no se montan sobre los del tercer eje", () => {
    expect(por(marcas, "E3_IZQ").top - por(marcas, "E2_IZQ_EXT").top).toBeGreaterThan(8);
  });
});

describe("marcasDelPlano · la furgoneta, que es otra foto", () => {
  const FURGO: RuedaDelPlano[] = [
    rueda("E1_IZQ", 1, "izq"), rueda("E1_DER", 1, "der"),
    rueda("E2_IZQ", 2, "izq"), rueda("E2_DER", 2, "der"),
  ];
  const marcas = marcasDelPlano(FURGO, FOTO_FURGO);

  it("usa SU medida y no la del autobús", () => {
    // En la foto de la furgoneta el eje trasero está en el 77 % del alto; en la
    // del autobús, en el 60. Si se dedujera del número de ejes saldría mal.
    expect(por(marcas, "E2_IZQ").top).toBeCloseTo(77, 1);
    expect(por(marcas, "E1_IZQ").top).toBeCloseTo(19, 1);
  });

  it("las ruedas están más al centro, y los recuadros con ellas", () => {
    expect(por(marcas, "E1_IZQ").left).toBeCloseTo(25.5, 1);
    expect(por(marcas, "E1_DER").left).toBeCloseTo(74.5, 1);
  });

  it("su eje trasero se pega a la goma como el delantero, no como un tercer eje", () => {
    // La separación grande es para el tercer eje de un autocar, donde la foto
    // lleva motor y escape. Aquí dejaría el recuadro flotando en el negro.
    expect(por(marcas, "E2_IZQ").left).toBeCloseTo(25.5, 1);
    expect(por(marcas, "E2_DER").left).toBeCloseTo(74.5, 1);
  });
});

describe("marcasDelPlano · cuando la foto no está medida", () => {
  it("una foto nueva cae a la regla de reserva, no a las medidas de otra", () => {
    const nueva = marcasDelPlano(BUS, "https://x/tc-chasis/config-ejes/zzz/9999999999999.png");
    const medida = marcasDelPlano(BUS, FOTO_BUS);
    expect(nueva).toHaveLength(6);
    // Mismo reparto por lados y ejes, otra altura: el ajuste fino se pierde
    // pero nada queda fuera de la imagen ni cambia de lado.
    expect(por(nueva, "E2_IZQ_EXT").left).toBeLessThan(por(nueva, "E2_DER_EXT").left);
    expect(por(nueva, "E1_IZQ").top).not.toBeCloseTo(por(medida, "E1_IZQ").top, 1);
    for (const m of nueva) {
      expect(m.left).toBeGreaterThan(0);
      expect(m.top).toBeLessThan(100);
    }
  });

  it("sin foto ninguna, también coloca: el plano se pinta igual sin imagen", () => {
    const marcas = marcasDelPlano(BUS, null);
    expect(marcas).toHaveLength(6);
    expect(por(marcas, "E2_IZQ_EXT").top).toBeGreaterThan(por(marcas, "E1_IZQ").top);
  });

  it("un vehículo de cuatro ejes reparte los cuatro sin salirse", () => {
    const cuatro: RuedaDelPlano[] = [1, 2, 3, 4].flatMap((e) => [
      rueda(`E${e}_IZQ`, e, "izq"), rueda(`E${e}_DER`, e, "der"),
    ]);
    const marcas = marcasDelPlano(cuatro, null);
    expect(marcas).toHaveLength(8);
    const alturas = [1, 2, 3, 4].map((e) => por(marcas, `E${e}_IZQ`).top);
    expect(alturas).toEqual([...alturas].sort((a, b) => a - b));
    expect(Math.max(...alturas)).toBeLessThan(100);
  });
});

describe("marcasDelPlano · lo que no se pinta", () => {
  it("una rueda sin eje no tiene sitio: no se inventa", () => {
    const marcas = marcasDelPlano(
      [rueda("E1_IZQ", 1, "izq"), { codigo_posicion: "SUELTA", eje: null, lado: "izq", interior_exterior: null }],
      FOTO_BUS,
    );
    expect(marcas.map((m) => m.codigo)).toEqual(["E1_IZQ"]);
  });

  it("sin ruedas, sin marcas", () => {
    expect(marcasDelPlano([], FOTO_BUS)).toEqual([]);
  });

  it("si el vehículo tiene más ejes que la foto medida, sobra sin romperse", () => {
    // La foto del autobús solo tiene dos ejes medidos: el tercero no se pinta
    // antes que pintarlo en un sitio inventado.
    const marcas = marcasDelPlano(AUTOCAR, FOTO_BUS);
    expect(marcas.map((m) => m.codigo)).not.toContain("E3_IZQ");
    expect(marcas).toHaveLength(6);
  });

  it("una rueda gemela en un eje que la foto da por sencillo cae al centro del eje", () => {
    const raro: RuedaDelPlano[] = [
      rueda("E1_IZQ_EXT", 1, "izq", "ext"),
      rueda("E1_IZQ_INT", 1, "izq", "int"),
    ];
    const marcas = marcasDelPlano(raro, FOTO_FURGO);
    expect(marcas).toHaveLength(2);
    for (const m of marcas) expect(m.left).toBeGreaterThan(0);
  });
});
