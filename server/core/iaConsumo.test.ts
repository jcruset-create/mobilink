/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * El contador de IA: topes, concurrencia y qué pasa cuando la base falla.
 *
 * Se prueba con un doble del pool de PostgreSQL: lo que importa aquí no es el
 * dialecto, es el COMPORTAMIENTO —qué se apunta, qué se niega y, sobre todo,
 * qué ocurre cuando el contador no puede contar—.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

interface Consulta { sql: string; args: any[] }
let consultas: Consulta[] = [];
/** Qué devuelve la base para cada consulta. Lo cambia cada prueba. */
let responder: (sql: string, args: any[]) => any[] = () => [];
let fallarConexion = false;
let fallarConsulta: string | null = null;
const liberado = vi.fn();

const ejecutar = async (sql: string, args: any[] = []) => {
  consultas.push({ sql, args });
  if (fallarConsulta && sql.includes(fallarConsulta)) throw new Error("boom");
  return { rows: responder(sql, args) };
};

vi.mock("../db.ts", () => ({
  default: {
    connect: async () => {
      if (fallarConexion) throw new Error("sin conexión");
      return { query: ejecutar, release: liberado };
    },
    query: ejecutar,
  },
}));

const { cerrar, moduloDe, registrarCache, reservar, resumenVehiculoActivo } = await import("./iaConsumo.ts");

const EMPRESA = "11111111-1111-4111-8111-111111111111";
const ctx = { empresaId: EMPRESA, operacion: "resumen.vehiculo", modeloPedido: "gpt-x" };
const sqls = () => consultas.map((c) => c.sql.replace(/\s+/g, " ").trim());
const laQue = (trozo: string) => consultas.find((c) => c.sql.includes(trozo));

beforeEach(() => {
  consultas = [];
  responder = () => [];
  fallarConexion = false;
  fallarConsulta = null;
  liberado.mockClear();
});

describe("moduloDe", () => {
  it("saca el módulo del prefijo de la operación", () => {
    expect(moduloDe("resumen.vehiculo")).toBe("resumen");
    expect(moduloDe("assist.detectPlate")).toBe("assist");
    expect(moduloDe("sinpunto")).toBe("otros");
  });
});

describe("reservar · camino normal", () => {
  it("apunta la petición como en_curso y devuelve su id", async () => {
    responder = (sql) => {
      if (sql.includes("count(*)")) return [{ peticiones: 3, tokens: 1000 }];
      if (sql.includes("returning id")) return [{ id: "uso-1" }];
      return [];
    };
    const r = await reservar(ctx);
    expect(r).toMatchObject({ permitido: true, usoId: "uso-1", peticionesHoy: 3, tokensHoy: 1000 });
    expect(sqls().some((s) => s.includes("'en_curso'"))).toBe(true);
    expect(sqls()).toContain("commit");
    expect(liberado).toHaveBeenCalled();
  });

  it("no guarda prompts, matrículas ni claves: solo empresa, módulo, operación y modelo", async () => {
    responder = (sql) => sql.includes("returning id") ? [{ id: "uso-1" }] : [{ peticiones: 0, tokens: 0 }];
    await reservar(ctx);
    const insercion = laQue("'en_curso'")!;
    expect(insercion.args).toEqual([EMPRESA, "resumen", "resumen.vehiculo", "gpt-x"]);
  });
});

describe("reservar · concurrencia", () => {
  it("toma el cerrojo por empresa ANTES de contar: veinte a la vez no pasan todas", async () => {
    responder = (sql) => sql.includes("returning id") ? [{ id: "uso-1" }] : [{ peticiones: 0, tokens: 0 }];
    await reservar(ctx);
    const orden = sqls();
    const cerrojo = orden.findIndex((s) => s.includes("pg_advisory_xact_lock"));
    const cuenta = orden.findIndex((s) => s.includes("count(*)"));
    expect(orden[0]).toBe("begin");
    expect(cerrojo).toBeGreaterThan(0);
    expect(cuenta).toBeGreaterThan(cerrojo);
    expect(laQue("pg_advisory_xact_lock")!.args).toEqual([`ia_cuota:${EMPRESA}`]);
  });
});

describe("reservar · topes", () => {
  it("con la IA desactivada no se llama al proveedor", async () => {
    responder = (sql) => {
      if (sql.includes("ia_limites")) return [{ ia_activa: false }];
      if (sql.includes("count(*)")) return [{ peticiones: 0, tokens: 0 }];
      return [];
    };
    const r = await reservar(ctx);
    expect(r).toMatchObject({ permitido: false, motivo: "ia_desactivada", usoId: null });
  });

  it("llegado el tope de peticiones, se niega", async () => {
    responder = (sql) => {
      if (sql.includes("ia_limites")) return [{ ia_activa: true, max_peticiones_dia: 10 }];
      if (sql.includes("count(*)")) return [{ peticiones: 10, tokens: 5 }];
      return [];
    };
    const r = await reservar(ctx);
    expect(r).toMatchObject({ permitido: false, motivo: "tope_peticiones", peticionesHoy: 10 });
  });

  it("llegado el tope de tokens, también", async () => {
    responder = (sql) => {
      if (sql.includes("ia_limites")) return [{ ia_activa: true, max_tokens_dia: 1000 }];
      if (sql.includes("count(*)")) return [{ peticiones: 1, tokens: 1200 }];
      return [];
    };
    const r = await reservar(ctx);
    expect(r).toMatchObject({ permitido: false, motivo: "tope_tokens", tokensHoy: 1200 });
  });

  it("un rechazo deja su propia fila: si no, nadie ve que una empresa choca cada día", async () => {
    responder = (sql) => {
      if (sql.includes("ia_limites")) return [{ ia_activa: true, max_peticiones_dia: 1 }];
      if (sql.includes("count(*)")) return [{ peticiones: 5, tokens: 0 }];
      return [];
    };
    await reservar(ctx);
    const fila = consultas.find((c) => c.sql.includes("insert into ia_uso") && c.sql.includes("'cuota'"))!;
    expect(fila.args).toContain("tope_peticiones");
    expect(sqls()).toContain("commit");
  });

  it("la cuenta del día ignora la caché y los propios rechazos", async () => {
    responder = (sql) => sql.includes("returning id") ? [{ id: "x" }] : [{ peticiones: 0, tokens: 0 }];
    await reservar(ctx);
    const cuenta = laQue("count(*)")!.sql;
    expect(cuenta).toContain("origen = 'proveedor'");
    expect(cuenta).toContain("resultado not in ('cuota', 'sin_clave')");
    expect(cuenta).toContain("date_trunc('day', now())");
  });

  it("sin empresa no hay tope por cliente, pero la petición se apunta", async () => {
    responder = (sql) => sql.includes("returning id") ? [{ id: "uso-2" }] : [{ peticiones: 0, tokens: 0 }];
    const r = await reservar({ operacion: "assist.detectPlate", modeloPedido: "gpt-x" });
    expect(r.permitido).toBe(true);
    expect(sqls().some((s) => s.includes("ia_limites"))).toBe(false);
    expect(laQue("'en_curso'")!.args[0]).toBeNull();
  });
});

describe("reservar · si el contador no puede contar", () => {
  it("sin conexión deja pasar: un fallo del contador no apaga los lectores", async () => {
    fallarConexion = true;
    expect(await reservar(ctx)).toEqual({ permitido: true, usoId: null, contador: "caido" });
  });

  it("si revienta a mitad, hace rollback y deja pasar igual", async () => {
    fallarConsulta = "count(*)";
    const r = await reservar(ctx);
    // Deja pasar, pero DICE que no ha contado: quien quiera fallar cerrado
    // (el resumen de vehículo) mira este campo.
    expect(r).toEqual({ permitido: true, usoId: null, contador: "caido" });
    expect(sqls()).toContain("rollback");
    expect(liberado).toHaveBeenCalled();
  });

  it("sin id de uso, cerrar no hace nada y no revienta", async () => {
    await expect(cerrar(null, { resultado: "ok", duracionMs: 10 })).resolves.toBeUndefined();
    expect(consultas).toHaveLength(0);
  });
});

describe("cerrar", () => {
  it("guarda el resultado, los intentos y el modelo que contestó de verdad", async () => {
    await cerrar("uso-1", {
      resultado: "ok", modeloServido: "gpt-respaldo", usoRespaldo: true, intentos: 3,
      tokensEntrada: 100, tokensSalida: 50, duracionMs: 1234.7, peticionId: "resp_abc",
    });
    const u = laQue("update ia_uso")!;
    expect(u.args.slice(0, 8)).toEqual(["uso-1", "ok", "gpt-respaldo", true, 3, 100, 50, 1235]);
  });

  it("del error guarda un código corto, nunca el cuerpo del proveedor", async () => {
    await cerrar("uso-1", { resultado: "error", duracionMs: 1, errorCodigo: "x".repeat(500) });
    const u = laQue("update ia_uso")!;
    expect((u.args[8] as string).length).toBe(80);
  });

  it("si la base falla al cerrar, no lanza: la respuesta ya se dio", async () => {
    fallarConsulta = "update ia_uso";
    await expect(cerrar("uso-1", { resultado: "ok", duracionMs: 1 })).resolves.toBeUndefined();
  });
});

describe("registrarCache", () => {
  it("apunta la respuesta de caché como tal, con cero intentos", async () => {
    await registrarCache(ctx, 12);
    const i = laQue("'cache'")!;
    expect(i.sql).toContain("'cache'");
    expect(i.sql).toContain("0, 'ok'");
    expect(i.args).toEqual([EMPRESA, "resumen", "resumen.vehiculo", "gpt-x", 12]);
  });

  it("si no se puede apuntar, no rompe la respuesta", async () => {
    fallarConsulta = "insert into ia_uso";
    await expect(registrarCache(ctx, 1)).resolves.toBeUndefined();
  });
});

describe("registrarSinClave", () => {
  it("apunta la petición que no salió, sin consumir cuota", async () => {
    const { registrarSinClave } = await import("./iaConsumo.ts");
    await registrarSinClave(ctx);
    const i = laQue("'sin_clave'")!;
    expect(i.sql).toContain("0, 'sin_clave'");
    expect(i.args).toEqual([EMPRESA, "resumen", "resumen.vehiculo", "gpt-x"]);
  });
});

describe("resumenVehiculoActivo", () => {
  it("solo está activo si la empresa lo tiene encendido", async () => {
    responder = () => [{ resumen_vehiculo_activo: true }];
    expect(await resumenVehiculoActivo(EMPRESA)).toBe(true);
    responder = () => [{ resumen_vehiculo_activo: false }];
    expect(await resumenVehiculoActivo(EMPRESA)).toBe(false);
    responder = () => [];
    expect(await resumenVehiculoActivo(EMPRESA)).toBe(false);
  });

  it("si la base falla, falla CERRADO: una funcionalidad nueva no se enciende sola", async () => {
    fallarConsulta = "resumen_vehiculo_activo";
    expect(await resumenVehiculoActivo(EMPRESA)).toBe(false);
  });
});
