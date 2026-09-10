/**
 * El registro: que no filtre secretos y que no se coma el disco.
 *
 * Las dos cosas que se prueban aquí son las dos que hacen daño de verdad. Un
 * registro se manda por correo cuando algo va mal, así que un secreto dentro
 * deja de serlo en cuanto alguien pide ayuda. Y un agente lleva años arrancado
 * en una máquina donde no entra nadie: sin poda, el primer síntoma de que el
 * log ha llenado el disco sería que ScanSnap no puede escribir el PDF.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Registro, tapar } from "../src/registro.ts";

let carpeta = "";
let reg: Registro;

/** Espera a que el stream haya vaciado, que `write` es asíncrono. */
const leerHoy = async (r: Registro): Promise<string> => {
  await new Promise((listo) => setTimeout(listo, 50));
  const f = r.ficheroDe();
  return fs.existsSync(f) ? fs.readFileSync(f, "utf8") : "";
};

beforeEach(() => {
  carpeta = fs.mkdtempSync(path.join(os.tmpdir(), "autoscan-log-"));
  reg = new Registro(carpeta, false);
});

afterEach(() => {
  reg.cerrar();
  fs.rmSync(carpeta, { recursive: true, force: true });
});

describe("lo que no puede salir de la máquina", () => {
  it("una credencial hexadecimal larga se tapa", () => {
    const secreto = "a".repeat(64);
    expect(tapar(`subiendo con ${secreto}`)).not.toContain(secreto);
  });

  it("y los campos que se llaman como se llaman", () => {
    const casos = [
      '{"secret":"abcd1234efgh"}',
      "token=ZXCVBNM12345",
      "x-autoscan-key: QWERTYUIOP123",
      'codigo: "AB12CD34EF"',
      "password=SuperSecreto99",
    ];
    for (const c of casos) {
      const tapado = tapar(c);
      expect(tapado).toContain("«tapado»");
      /*
       * Queda el NOMBRE del campo, que es lo que sirve para diagnosticar
       * («falta el token»), y desaparece el valor, que es lo que no puede
       * viajar en un correo.
       */
      expect(tapado.length).toBeLessThan(c.length + 20);
    }
  });

  it("el código de activación no se cuela al registrarlo", () => {
    expect(tapar("activando con codigo=MOBIL1NK2026")).not.toContain("MOBIL1NK2026");
  });

  it("lo escrito al fichero pasa por el mismo filtro", async () => {
    /*
     * No basta con que exista `tapar()`: la regla se salta sola en cuanto
     * alguien escribe un `${JSON.stringify(...)}` de más. Por eso lo aplica
     * `escribir()` y no quien llama.
     */
    reg.escribir(`fallo al subir: {"secret":"${"f".repeat(48)}"}`);
    const texto = await leerHoy(reg);

    expect(texto).not.toContain("f".repeat(48));
    expect(texto).toContain("«tapado»");
    expect(texto).toContain("fallo al subir");
  });

  it("un mensaje normal no se toca", async () => {
    reg.escribir("encolado «factura del taller.pdf» (204800 bytes)");
    expect(await leerHoy(reg)).toContain("encolado «factura del taller.pdf» (204800 bytes)");
  });
});

describe("un fichero por día", () => {
  it("el nombre lleva la fecha, para poder pedirlo por teléfono", () => {
    const f = reg.ficheroDe(new Date("2026-09-08T10:00:00"));
    expect(path.basename(f)).toBe("agente-2026-09-08.log");
  });

  it("cada línea va con su hora", async () => {
    reg.escribir("una cosa");
    expect(await leerHoy(reg)).toMatch(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z una cosa$/m);
  });
});

describe("los viejos se van solos", () => {
  const crearLog = (fecha: string) =>
    fs.writeFileSync(path.join(carpeta, `agente-${fecha}.log`), "x");

  it("se borra lo de hace más de un mes y se queda lo reciente", () => {
    crearLog("2026-06-01"); // muy viejo
    crearLog("2026-07-15"); // viejo
    crearLog("2026-09-01"); // de hace una semana
    crearLog("2026-09-08"); // hoy

    const borrados = reg.podar(new Date("2026-09-08T10:00:00Z"));

    expect(borrados).toBe(2);
    const quedan = fs.readdirSync(carpeta).sort();
    expect(quedan).toEqual(["agente-2026-09-01.log", "agente-2026-09-08.log"]);
  });

  it("NO toca nada que no sea un registro suyo", () => {
    crearLog("2020-01-01");
    fs.writeFileSync(path.join(carpeta, "volcado-del-tecnico.txt"), "importante");
    fs.writeFileSync(path.join(carpeta, "captura.png"), "importante");
    fs.writeFileSync(path.join(carpeta, "agente.log"), "importante");

    reg.podar(new Date("2026-09-08T10:00:00Z"));

    /*
     * En esa carpeta alguien deja cosas. Un `readdir` que borra todo lo viejo
     * es una línea a la que se le acaba escapando algo que importaba.
     */
    const quedan = fs.readdirSync(carpeta).sort();
    expect(quedan).toEqual(["agente.log", "captura.png", "volcado-del-tecnico.txt"]);
  });

  it("el que cae justo en el límite se guarda, y no depende de la hora", () => {
    /*
     * El día 31 exacto. El límite cae a las 10:00 de ese día, así que
     * interpretar la fecha del fichero a MEDIANOCHE lo pone antes del corte y
     * lo borra, mientras que a mediodía lo deja dentro.
     *
     * Mediodía es lo correcto porque la pregunta es «¿de qué DÍA es este
     * registro?», no «¿a qué hora se escribió?». Con medianoche, que un log se
     * conserve o no dependería de a qué hora arranca el agente — se borraría
     * ejecutando la poda a las 11:00 y se guardaría ejecutándola a las 09:00,
     * el mismo día y con los mismos ficheros.
     */
    crearLog("2026-08-08"); // exactamente 31 días antes
    reg.podar(new Date("2026-09-08T10:00:00Z"), 31);
    expect(fs.existsSync(path.join(carpeta, "agente-2026-08-08.log"))).toBe(true);
  });

  it("la poda da lo mismo a las 9 que a las 11 del mismo día", () => {
    crearLog("2026-08-08");
    crearLog("2026-08-07");

    reg.podar(new Date("2026-09-08T09:00:00Z"), 31);
    const trasLasNueve = fs.readdirSync(carpeta).sort();
    reg.podar(new Date("2026-09-08T11:00:00Z"), 31);

    /* Nada cambia por correr la poda dos horas más tarde. */
    expect(fs.readdirSync(carpeta).sort()).toEqual(trasLasNueve);
    expect(trasLasNueve).toEqual(["agente-2026-08-08.log"]);
  });

  it("una carpeta que no existe no revienta la poda", () => {
    const otro = new Registro(path.join(carpeta, "no-existe"), false);
    expect(() => otro.podar()).not.toThrow();
  });
});

describe("registrar nunca tumba el agente", () => {
  it("si no se puede escribir, se sigue", () => {
    /* Un fichero donde debería estar la carpeta: mkdir falla. */
    const ruta = path.join(carpeta, "estorbo");
    fs.writeFileSync(ruta, "no soy una carpeta");
    const otro = new Registro(ruta, false);

    /*
     * Quedarse sin subir facturas porque no se pudo escribir en el log sería
     * cambiar un problema pequeño por el único que importa.
     */
    expect(() => otro.escribir("algo")).not.toThrow();
  });

  it("si la carpeta desaparece con el agente en marcha, no se cae", async () => {
    /*
     * Este es el caso que destapó un fallo de verdad. `createWriteStream` abre
     * el fichero de forma ASÍNCRONA, así que el `try/catch` de `escribir()` ya
     * ha terminado cuando llega el fallo. Un `error` sin oyente en un stream es
     * una excepción no capturada, y en Node eso mata el proceso: el agente
     * dejaría de subir facturas porque alguien renombró una carpeta.
     *
     * Sin el `on("error")` del stream, vitest cuenta aquí un «unhandled error»
     * y la ejecución sale en rojo.
     */
    const propia = fs.mkdtempSync(path.join(os.tmpdir(), "autoscan-log-fuera-"));
    const otro = new Registro(propia, false);
    otro.escribir("antes de que desaparezca");

    fs.rmSync(propia, { recursive: true, force: true });
    expect(() => otro.escribir("y ahora ya no está")).not.toThrow();

    // Se le da tiempo al fallo asíncrono a llegar y a ser atendido.
    await new Promise((listo) => setTimeout(listo, 80));
    otro.cerrar();
  });

  it("y cuando la carpeta vuelve, el registro vuelve solo", async () => {
    const propia = fs.mkdtempSync(path.join(os.tmpdir(), "autoscan-log-vuelve-"));
    const otro = new Registro(propia, false);
    otro.escribir("primera");
    fs.rmSync(propia, { recursive: true, force: true });
    otro.escribir("con la carpeta fuera");
    await new Promise((listo) => setTimeout(listo, 80));

    /*
     * El oyente suelta el flujo roto, así que el siguiente `escribir()` vuelve
     * a abrirlo. Sin eso, el agente se quedaría sin registro para siempre
     * aunque el problema se hubiera arreglado.
     */
    otro.escribir("la carpeta ha vuelto");
    await new Promise((listo) => setTimeout(listo, 80));

    expect(fs.existsSync(otro.ficheroDe())).toBe(true);
    expect(fs.readFileSync(otro.ficheroDe(), "utf8")).toContain("la carpeta ha vuelto");
    otro.cerrar();
    fs.rmSync(propia, { recursive: true, force: true });
  });

  it("cerrar dos veces tampoco", () => {
    reg.escribir("algo");
    reg.cerrar();
    expect(() => reg.cerrar()).not.toThrow();
  });
});
