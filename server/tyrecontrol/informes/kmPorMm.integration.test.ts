/**
 * La RPC `tc_informes_km_por_mm` contra PostgreSQL de verdad.
 *
 * ── Por qué esto no se puede probar leyendo el SQL ──────────────────────────
 *
 * Porque lo que hace esta función NO es agregar: es decidir dónde termina la
 * vida de una goma y empieza la de otra. Toda la cuenta depende de ese corte,
 * y el corte son tres `lag()` sobre una ventana. Un `partition by` de más o un
 * `rows unbounded preceding` de menos no da error: da un número plausible y
 * equivocado, que es la peor clase de fallo para un informe que se va a usar
 * para decidir qué neumáticos se compran.
 *
 * Así que se monta un esquema mínimo, se carga la función REAL del repositorio
 * sin tocarle una coma, y se le dan series construidas a mano donde la
 * respuesta correcta se sabe de antemano.
 *
 * El caso que da sentido a todo esto es `pisado`: un neumático cuyo historial
 * empieza y termina con 15,0 mm porque en medio lo sustituyeron. Sin el corte
 * su desgaste es CERO y desaparece del informe; con el corte aporta sus dos
 * vidas.
 *
 * Sin `RUN_DB_TESTS=1` no hace nada, igual que el resto de las de integración.
 */

import { readFileSync } from "node:fs";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const CORRE = process.env.RUN_DB_TESTS === "1" && Boolean(process.env.DATABASE_URL);
const describeSiHayBase = CORRE ? describe : describe.skip;

const RAIZ = new URL("../../../", import.meta.url).pathname;
const MIGRACION = `${RAIZ}supabase/migrations/tyrecontrol_informes_km_por_mm.sql`;

/** Un esquema propio: así esta prueba no pisa nada de las demás. */
const ESQUEMA = "pruebas_km_por_mm";

const EMPRESA_A = "00000000-0000-4000-a000-00000000000a";
const EMPRESA_B = "00000000-0000-4000-a000-00000000000b";
const V1 = "00000000-0000-4000-b000-000000000001";
const V2 = "00000000-0000-4000-b000-000000000002";

interface Fila {
  marca: string; modelo: string; eje: number | null;
  tramos: string; neumaticos: string;
  km_totales: string; mm_totales: string; km_por_mm: string;
  p25: string; mediana: string; p75: string;
  mm_nuevo: string | null; mm_retirada: string | null;
  neumaticos_modelo: string;
}

describeSiHayBase("tc_informes_km_por_mm", () => {
  let db: Client;
  let filas: Fila[] = [];

  /** Una medición: revisión del vehículo + detalle del neumático. */
  async function medir(
    neumatico: string, vehiculo: string, posicion: string | null,
    km: number, mm: number, dia: number,
    extra: { anulada?: boolean; ausente?: boolean; inaccesible?: boolean } = {},
  ) {
    const { rows } = await db.query(
      `insert into revisiones_vehiculo (vehiculo_id, fecha_revision, km_vehiculo, estado_revision)
       values ($1, date '2026-01-01' + $2::int, $3, $4) returning id`,
      [vehiculo, dia, km, extra.anulada ? "anulada" : "cerrada"],
    );
    await db.query(
      `insert into revisiones_neumaticos_detalle
         (revision_id, neumatico_id, posicion_id, profundidad_mm, neumatico_ausente, no_accesible)
       values ($1, $2, $3, $4, $5, $6)`,
      [rows[0].id, neumatico, posicion, mm, extra.ausente ?? false, extra.inaccesible ?? false],
    );
  }

  async function altaNeumatico(marca: string, modelo: string, empresa = EMPRESA_A): Promise<string> {
    const { rows } = await db.query(
      `insert into tc_neumaticos (marca, modelo, empresa_id) values ($1,$2,$3) returning id`,
      [marca, modelo, empresa],
    );
    return rows[0].id as string;
  }

  /** Serie recta: `puntos` mediciones repartiendo `km` y `mm` de desgaste. */
  async function serie(
    neumatico: string, vehiculo: string, posicion: string | null,
    kmInicial: number, mmInicial: number, km: number, mm: number, puntos = 3, dia0 = 0,
  ) {
    for (let i = 0; i < puntos; i++) {
      const t = i / (puntos - 1);
      await medir(neumatico, vehiculo, posicion,
        kmInicial + Math.round(km * t), Number((mmInicial - mm * t).toFixed(2)), dia0 + i * 30);
    }
  }

  beforeAll(async () => {
    db = new Client({ connectionString: process.env.DATABASE_URL });
    await db.connect();
    await db.query(`drop schema if exists ${ESQUEMA} cascade`);
    await db.query(`create schema ${ESQUEMA}`);
    await db.query(`set search_path = ${ESQUEMA}, public`);

    await db.query(`
      create table tc_neumaticos (
        id uuid primary key default gen_random_uuid(),
        marca text, modelo text, empresa_id uuid);
      create table tc_posiciones_vehiculo (
        id uuid primary key default gen_random_uuid(), eje int);
      create table revisiones_vehiculo (
        id uuid primary key default gen_random_uuid(),
        vehiculo_id uuid, fecha_revision date, km_vehiculo numeric, estado_revision text);
      create table revisiones_neumaticos_detalle (
        id uuid primary key default gen_random_uuid(),
        revision_id uuid references revisiones_vehiculo(id),
        neumatico_id uuid references tc_neumaticos(id),
        posicion_id uuid references tc_posiciones_vehiculo(id),
        profundidad_mm numeric, neumatico_ausente boolean, no_accesible boolean);
    `);

    const { rows: pos } = await db.query(
      `insert into tc_posiciones_vehiculo (eje) values (1),(2) returning id, eje`,
    );
    const EJE1 = pos.find((p) => p.eje === 1).id as string;
    const EJE2 = pos.find((p) => p.eje === 2).id as string;

    // ── AH51, eje 1 · tres gomas limpias: 20.000 km y 2 mm cada una ─────────
    for (let i = 0; i < 3; i++) {
      const n = await altaNeumatico("Hankook", "AH51");
      await serie(n, V1, EJE1, 100000, 15, 20000, 2);
    }

    // ── AH51, eje 1 · la goma PISADA ───────────────────────────────────────
    // Empieza con 15,0 y termina con 15,0: a ojo no se ha gastado nada. Lo que
    // pasó es que a mitad la cambiaron, y el +4 mm lo delata.
    const pisado = await altaNeumatico("Hankook", "AH51");
    await serie(pisado, V1, EJE1, 100000, 15, 20000, 2, 3, 0);          // 15,0 → 13,0
    await serie(pisado, V1, EJE1, 130000, 17, 20000, 2, 3, 120);        // 17,0 → 15,0

    // ── X-TEST, eje 2 · la goma que CAMBIA DE VEHÍCULO ──────────────────────
    // El segundo vehículo tiene el odómetro 400.000 km más arriba. Sin cortar,
    // el tramo mediría 420.000 km y el modelo saldría eterno.
    for (let i = 0; i < 3; i++) {
      const n = await altaNeumatico("Michelin", "X-TEST");
      await serie(n, V1, EJE2, 100000, 15, 20000, 2, 3, 0);
      await serie(n, V2, EJE2, 500000, 13, 20000, 2, 3, 120);
    }

    // ── Los que NO deben salir ──────────────────────────────────────────────
    for (let i = 0; i < 3; i++) {                       // tramos cortos
      const n = await altaNeumatico("Barato", "CORTO");
      await serie(n, V1, EJE1, 100000, 15, 5000, 2);
    }
    for (let i = 0; i < 3; i++) {                       // solo dos mediciones
      const n = await altaNeumatico("Dos", "MEDIDAS");
      await serie(n, V1, EJE1, 100000, 15, 40000, 3, 2);
    }
    for (let i = 0; i < 3; i++) {                       // 0,2 mm: por debajo del suelo
      const n = await altaNeumatico("Ruido", "MINIMO");
      await serie(n, V1, EJE1, 100000, 15, 20000, 0.2);
    }
    for (let i = 0; i < 3; i++) {                       // de otra empresa
      const n = await altaNeumatico("Otra", "EMPRESA", EMPRESA_B);
      await serie(n, V1, EJE1, 100000, 15, 20000, 2);
    }

    const cargado = readFileSync(MIGRACION, "utf8")
      .replace(/public\.tc_informes_km_por_mm/g, `${ESQUEMA}.tc_informes_km_por_mm`)
      .replace(/^grant .*$/gm, "");
    await db.query(cargado);

    const r = await db.query<Fila>(`select * from ${ESQUEMA}.tc_informes_km_por_mm(null)`);
    filas = r.rows;
  }, 60_000);

  afterAll(async () => {
    if (db) {
      await db.query(`drop schema if exists ${ESQUEMA} cascade`);
      await db.end();
    }
  });

  const de = (marca: string, modelo: string, eje: number | null) =>
    filas.find((f) => f.marca === marca && f.modelo === modelo && f.eje === eje);

  it("mide el AH51 del eje 1 sumando kilómetros y milímetros", () => {
    const f = de("Hankook", "AH51", 1)!;
    expect(f).toBeDefined();
    // 5 tramos de 20.000 km y 2 mm: 100.000 / 10 = 10.000 km por mm.
    expect(Number(f.tramos)).toBe(5);
    expect(Number(f.km_totales)).toBe(100000);
    expect(Number(f.mm_totales)).toBe(10);
    expect(Number(f.km_por_mm)).toBe(10000);
  });

  it("la goma pisada aporta sus DOS vidas en vez de desaparecer", () => {
    // Tres gomas limpias dan 3 tramos; la pisada tiene que poner 2 más.
    const f = de("Hankook", "AH51", 1)!;
    expect(Number(f.tramos)).toBe(5);
    expect(Number(f.neumaticos)).toBe(4);
  });

  it("corta cuando la goma cambia de vehículo, y no mide el salto de odómetro", () => {
    const f = de("Michelin", "X-TEST", 2)!;
    // 6 tramos de 20.000 km. Sin cortar serían 3 de 420.000.
    expect(Number(f.tramos)).toBe(6);
    expect(Number(f.km_totales)).toBe(120000);
    expect(Number(f.km_por_mm)).toBe(10000);
  });

  it("no cuenta dos veces las gomas que han rodado en dos sitios", () => {
    const f = de("Michelin", "X-TEST", 2)!;
    expect(Number(f.neumaticos_modelo)).toBe(3);
  });

  it("deja fuera los tramos cortos, los de dos mediciones y los que no llegan al suelo", () => {
    expect(filas.find((f) => f.modelo === "CORTO")).toBeUndefined();
    expect(filas.find((f) => f.modelo === "MEDIDAS")).toBeUndefined();
    expect(filas.find((f) => f.modelo === "MINIMO")).toBeUndefined();
  });

  it("aproxima con qué dibujo entra y con cuál se retira", async () => {
    const f = de("Hankook", "AH51", 1)!;
    expect(Number(f.mm_nuevo)).toBeCloseTo(17, 0);
    expect(Number(f.mm_retirada)).toBeCloseTo(13, 0);
  });

  it("da los cuartiles del ritmo entre tramos", () => {
    const f = de("Hankook", "AH51", 1)!;
    expect(Number(f.mediana)).toBe(10000);
    expect(Number(f.p25)).toBe(10000);
  });

  it("p_empresa acota a una empresa", async () => {
    const soloA = await db.query<Fila>(`select * from ${ESQUEMA}.tc_informes_km_por_mm($1)`, [EMPRESA_A]);
    expect(soloA.rows.find((f) => f.modelo === "EMPRESA")).toBeUndefined();
    expect(soloA.rows.find((f) => f.modelo === "AH51")).toBeDefined();

    const soloB = await db.query<Fila>(`select * from ${ESQUEMA}.tc_informes_km_por_mm($1)`, [EMPRESA_B]);
    expect(soloB.rows.map((f) => f.modelo)).toEqual(["EMPRESA"]);
  });

  it("p_salto más alto deja de cortar la goma pisada, y entonces el tramo se pierde", async () => {
    // Con un salto de 5 mm, el +4 de la sustitución ya no corta: la serie
    // entera es un solo tramo que empieza y acaba en 15,0 mm, desgaste cero,
    // y se cae del informe. Baja de 5 tramos a 3.
    const r = await db.query<Fila>(
      `select * from ${ESQUEMA}.tc_informes_km_por_mm(null, 10000, 5.0)`,
    );
    const f = r.rows.find((x) => x.modelo === "AH51" && x.eje === 1)!;
    expect(Number(f.tramos)).toBe(3);
  });

  it("no mira las revisiones anuladas ni los neumáticos ausentes o inaccesibles", async () => {
    const n = await altaNeumatico("Caso", "BORDE");
    const { rows: pos } = await db.query(`select id from tc_posiciones_vehiculo where eje = 1`);
    const eje1 = pos[0].id as string;
    await medir(n, V1, eje1, 100000, 15, 0, { anulada: true });
    await medir(n, V1, eje1, 110000, 14, 30, { ausente: true });
    await medir(n, V1, eje1, 120000, 13, 60, { inaccesible: true });
    const r = await db.query<Fila>(`select * from ${ESQUEMA}.tc_informes_km_por_mm(null)`);
    expect(r.rows.find((f) => f.modelo === "BORDE")).toBeUndefined();
  });
});
