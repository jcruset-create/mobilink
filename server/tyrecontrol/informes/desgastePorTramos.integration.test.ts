/**
 * El corte por tramos y los dos informes que viven encima, contra PostgreSQL
 * de verdad: `tc_mediciones_tramo`, `tc_informes_km_por_mm` y
 * `tc_informes_desgaste`.
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
const MIGRACION = `${RAIZ}supabase/migrations/tyrecontrol_desgaste_por_tramos.sql`;
const MIGRACION_PREVISION = `${RAIZ}supabase/migrations/tyrecontrol_sustituciones_previstas.sql`;
const MIGRACION_SEGUIMIENTO = `${RAIZ}supabase/migrations/tyrecontrol_sin_seguimiento_en_informes.sql`;

/**
 * Las dos funciones de esa migración que este banco puede cargar.
 *
 * Las otras doce son informes que viven sobre tablas que aquí no existen
 * —operaciones, planes, alertas—, así que se sacan por nombre en vez de
 * cargar el fichero entero.
 */
function funcionDeLaMigracion(sql: string, nombre: string): string {
  const i = sql.indexOf(`create or replace function public.${nombre}(`);
  if (i < 0) throw new Error(`No se encuentra ${nombre}`);
  const j = sql.indexOf("$$;", i) + 3;
  return sql.slice(i, j);
}

/** Un esquema propio: así esta prueba no pisa nada de las demás. */
const ESQUEMA = "pruebas_desgaste_tramos";

const EMPRESA_A = "00000000-0000-4000-a000-00000000000a";
const EMPRESA_B = "00000000-0000-4000-a000-00000000000b";
const V1 = "00000000-0000-4000-b000-000000000001";
const V2 = "00000000-0000-4000-b000-000000000002";
const MATRICULA_1 = "1111ABC";

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

  async function altaNeumatico(
    marca: string, modelo: string,
    opciones: { empresa?: string; montadoEn?: string; codigo?: string; medida?: string } = {},
  ): Promise<string> {
    const { rows } = await db.query(
      `insert into tc_neumaticos (marca, modelo, medida, empresa_id, codigo_interno)
       values ($1,$2,$3,$4,$5) returning id`,
      [marca, modelo, opciones.medida ?? "295/80R22.5",
       opciones.empresa ?? EMPRESA_A, opciones.codigo ?? null],
    );
    const id = rows[0].id as string;
    if (opciones.montadoEn) {
      await db.query(
        `insert into tc_montajes_actuales (neumatico_id, vehiculo_id) values ($1,$2)`,
        [id, opciones.montadoEn],
      );
    }
    return id;
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
        marca text, modelo text, medida text, empresa_id uuid,
        codigo_interno text, numero_serie text);
      create table tc_vehiculos (
        id uuid primary key default gen_random_uuid(), matricula text,
        en_seguimiento boolean not null default true);
      create table tc_montajes_actuales (
        id uuid primary key default gen_random_uuid(),
        neumatico_id uuid references tc_neumaticos(id), vehiculo_id uuid,
        fecha_montaje date);
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

    await db.query(`insert into tc_vehiculos (id, matricula) values ($1,$2),($3,'2222DEF')`,
      [V1, MATRICULA_1, V2]);

    const { rows: pos } = await db.query(
      `insert into tc_posiciones_vehiculo (eje) values (1),(2) returning id, eje`,
    );
    const EJE1 = pos.find((p) => p.eje === 1).id as string;
    const EJE2 = pos.find((p) => p.eje === 2).id as string;

    // ── AH51, eje 1 · tres gomas limpias: 20.000 km y 2 mm cada una ─────────
    // Montadas, para que también las vea el informe de desgaste.
    for (let i = 0; i < 3; i++) {
      const n = await altaNeumatico("Hankook", "AH51", { montadoEn: V1, codigo: `LIMPIA-${i}` });
      await serie(n, V1, EJE1, 100000, 15, 20000, 2);
    }

    // ── AH51, eje 1 · la goma PISADA ───────────────────────────────────────
    // Empieza con 15,0 y termina con 15,0: a ojo no se ha gastado nada. Lo que
    // pasó es que a mitad la cambiaron, y el +4 mm lo delata.
    const pisado = await altaNeumatico("Hankook", "AH51", { montadoEn: V1, codigo: "PISADA" });
    await serie(pisado, V1, EJE1, 100000, 15, 20000, 2, 3, 0);          // 15,0 → 13,0
    await serie(pisado, V1, EJE1, 130000, 17, 20000, 2, 3, 120);        // 17,0 → 15,0

    // ── AH51, eje 1 · la goma JOVEN, montada ───────────────────────────────
    // Lleva 2.000 km medidos: no da para sacarle un ritmo propio sin
    // inventarlo, así que tiene que tomar prestado el de su modelo y eje.
    const joven = await altaNeumatico("Hankook", "AH51", { montadoEn: V1, codigo: "JOVEN" });
    await serie(joven, V1, EJE1, 100000, 15, 2000, 0.1);

    // ── AH31 · la que ya está por debajo del mínimo legal ──────────────────
    const gastada = await altaNeumatico("Hankook", "AH31", { montadoEn: V1, codigo: "GASTADA" });
    await serie(gastada, V1, EJE1, 100000, 3, 20000, 2);                // 3,0 → 1,0

    // ── TOPE · tres tramos normales y uno imposible ────────────────────────
    // 300.000 km con 1 mm gastado son 300.000 km/mm. Eso no es un neumático
    // que dure para siempre: son varios neumáticos seguidos a los que el corte
    // de 2 mm no pilló porque el cambio no dio ningún salto.
    for (let i = 0; i < 3; i++) {
      const n = await altaNeumatico("Tope", "IMPOSIBLE");
      await serie(n, V1, EJE1, 100000, 15, 20000, 2);
    }
    const imposible = await altaNeumatico("Tope", "IMPOSIBLE");
    await serie(imposible, V1, EJE1, 100000, 15, 300000, 1);

    // ── AH51 · montada con un ritmo propio imposible ───────────────────────
    // Tiene mediciones de sobra, pero las suyas dicen 300.000 km/mm. No se le
    // puede creer: tiene que caer al ritmo de su modelo.
    const falsa = await altaNeumatico("Hankook", "AH51", { montadoEn: V1, codigo: "IMPOSIBLE" });
    await serie(falsa, V1, EJE1, 200000, 12, 300000, 1);

    // ── AH51 · una limpia pero DESMONTADA: sale en km/mm y no en desgaste ───
    const desmontada = await altaNeumatico("Hankook", "AH51", { codigo: "DESMONTADA" });
    await serie(desmontada, V1, EJE1, 100000, 15, 20000, 2);

    // ── Medidas para la previsión de compra ────────────────────────────────
    // La misma medida escrita de dos formas: para quien compra es una sola.
    const conIndice = await altaNeumatico("Hankook", "AH51",
      { montadoEn: V1, codigo: "CON-INDICE", medida: "385/65R22.5 158L" });
    await serie(conIndice, V1, EJE1, 100000, 15, 20000, 2);
    const sinIndice = await altaNeumatico("Hankook", "AH51",
      { montadoEn: V1, codigo: "SIN-INDICE", medida: "385/65R22.5" });
    await serie(sinIndice, V1, EJE1, 100000, 15, 20000, 2);
    // Montada y JAMÁS medida: el arco no la lee. Tiene que salir igual.
    await altaNeumatico("Hankook", "AH51",
      { montadoEn: V1, codigo: "NUNCA-MEDIDA", medida: "385/55R22.5" });

    // Y una sin medida ninguna.
    const sinMedida = await altaNeumatico("Hankook", "AH51",
      { montadoEn: V1, codigo: "SIN-MEDIDA", medida: "0" });
    await serie(sinMedida, V1, EJE1, 100000, 15, 20000, 2);

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
      const n = await altaNeumatico("Otra", "EMPRESA", { empresa: EMPRESA_B });
      await serie(n, V1, EJE1, 100000, 15, 20000, 2);
    }

    const aEsquema = (sql: string) => sql
      .replace(/public\.tc_mediciones_tramo/g, `${ESQUEMA}.tc_mediciones_tramo`)
      .replace(/public\.tc_informes_km_por_mm/g, `${ESQUEMA}.tc_informes_km_por_mm`)
      .replace(/public\.tc_informes_desgaste/g, `${ESQUEMA}.tc_informes_desgaste`)
      .replace(/public\.tc_informes_sustituciones_previstas/g, `${ESQUEMA}.tc_informes_sustituciones_previstas`)
      .replace(/^grant .*$/gm, "");

    const cargado = readFileSync(MIGRACION, "utf8")
      .replace(/public\.tc_mediciones_tramo/g, `${ESQUEMA}.tc_mediciones_tramo`)
      .replace(/public\.tc_informes_km_por_mm/g, `${ESQUEMA}.tc_informes_km_por_mm`)
      .replace(/public\.tc_informes_desgaste/g, `${ESQUEMA}.tc_informes_desgaste`)
      .replace(/^grant .*$/gm, "");
    await db.query(cargado);
    await db.query(aEsquema(readFileSync(MIGRACION_PREVISION, "utf8")));

    // Y encima, las dos reescritas que exigen `en_seguimiento`. Con todos los
    // vehículos del banco en `true`, que es como nacen, NINGUNA de las pruebas
    // de arriba puede cambiar: ésa es justo la garantía que se quiere.
    const seg = readFileSync(MIGRACION_SEGUIMIENTO, "utf8");
    await db.query(aEsquema(funcionDeLaMigracion(seg, "tc_informes_desgaste")));
    await db.query(aEsquema(funcionDeLaMigracion(seg, "tc_informes_sustituciones_previstas")));

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
    // 9 tramos de 20.000 km y 2 mm: 180.000 / 18 = 10.000 km por mm.
    expect(Number(f.tramos)).toBe(9);
    expect(Number(f.km_totales)).toBe(180000);
    expect(Number(f.mm_totales)).toBe(18);
    expect(Number(f.km_por_mm)).toBe(10000);
  });

  it("la goma pisada aporta sus DOS vidas en vez de desaparecer", () => {
    // Siete gomas limpias dan 7 tramos; la pisada tiene que poner 2 más.
    const f = de("Hankook", "AH51", 1)!;
    expect(Number(f.tramos)).toBe(9);
    expect(Number(f.neumaticos)).toBe(8);
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
    // En el banco el AH51 va de 17,0 —la goma nueva que puso la sustitución—
    // a 11,0, que es la última de la de ritmo imposible.
    const f = de("Hankook", "AH51", 1)!;
    expect(Number(f.mm_nuevo)).toBeCloseTo(17, 0);
    expect(Number(f.mm_retirada)).toBeCloseTo(11, 0);
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
    // y se cae del informe. Baja de 9 tramos a 7.
    const r = await db.query<Fila>(
      `select * from ${ESQUEMA}.tc_informes_km_por_mm(null, 10000, 5.0)`,
    );
    const f = r.rows.find((x) => x.modelo === "AH51" && x.eje === 1)!;
    expect(Number(f.tramos)).toBe(7);
  });

  it("tira el tramo que implique un ritmo imposible", async () => {
    const f = de("Tope", "IMPOSIBLE", 1)!;
    expect(f).toBeDefined();
    // Los 3 normales: 60.000 km y 6 mm. Sin el tope entrarían 360.000 y 7 mm,
    // o sea 51.428 km/mm en vez de 10.000.
    expect(Number(f.tramos)).toBe(3);
    expect(Number(f.km_por_mm)).toBe(10000);
  });

  it("subiendo el tope, el tramo imposible vuelve a entrar y estropea la cifra", async () => {
    const r = await db.query<Fila>(
      `select * from ${ESQUEMA}.tc_informes_km_por_mm(null, 10000, 2.0, 1000000)`,
    );
    const f = r.rows.find((x) => x.modelo === "IMPOSIBLE" && x.eje === 1)!;
    expect(Number(f.tramos)).toBe(4);
    expect(Number(f.km_por_mm)).toBe(51429);
  });

  // ══════════════════════════════════════════════════════════════════════════
  // tc_informes_desgaste
  // ══════════════════════════════════════════════════════════════════════════

  interface FilaDesgaste {
    neumatico_id: string; codigo: string | null;
    marca: string; modelo: string; medida: string | null; matricula: string | null;
    ultima_prof: string; ultima_fecha: Date | string;
    mm_por_1000km: string | null; origen_ritmo: string | null;
    km_restantes: string | null; fecha_prevista: Date | string | null;
    n_medidas: string;
  }

  async function desgaste(): Promise<FilaDesgaste[]> {
    const r = await db.query<FilaDesgaste>(`select * from ${ESQUEMA}.tc_informes_desgaste()`);
    return r.rows;
  }

  const porCodigo = (f: FilaDesgaste[], c: string) => f.find((x) => x.codigo === c);
  const dia = (v: Date | string | null) =>
    v === null ? null : (v instanceof Date ? v : new Date(v)).toISOString().slice(0, 10);

  it("mide el ritmo de la goma sobre su vida actual y dice que es suyo", async () => {
    const f = porCodigo(await desgaste(), "LIMPIA-0")!;
    expect(f).toBeDefined();
    expect(f.origen_ritmo).toBe("neumatico");
    // 2 mm en 20.000 km = 0,1 mm cada 1.000 km.
    expect(Number(f.mm_por_1000km)).toBeCloseTo(0.1, 5);
    expect(Number(f.ultima_prof)).toBe(13);
    // De 13,0 al mínimo legal de 1,6 quedan 11,4 mm a ese ritmo.
    expect(Number(f.km_restantes)).toBe(114000);
    expect(f.fecha_prevista).not.toBeNull();
  });

  /**
   * El caso que motiva toda la reescritura.
   *
   * El historial de esta goma empieza en 15,0 mm y acaba en 15,0 mm porque a
   * mitad la sustituyeron. El informe viejo restaba la última de la primera,
   * le salía CERO y la dejaba sin predicción, en silencio. Ahora el ritmo sale
   * del último tramo, que es la goma que está puesta.
   */
  it("la goma sustituida a mitad SÍ tiene predicción, medida sobre la de ahora", async () => {
    const f = porCodigo(await desgaste(), "PISADA")!;
    expect(f).toBeDefined();
    expect(f.origen_ritmo).toBe("neumatico");
    expect(Number(f.ultima_prof)).toBe(15);           // la última del segundo tramo
    expect(Number(f.mm_por_1000km)).toBeCloseTo(0.1, 5);
    expect(Number(f.km_restantes)).toBe(134000);
    expect(Number(f.n_medidas)).toBe(3);              // las del último tramo, no las 6
  });

  it("a la goma joven le presta el ritmo de su modelo y eje, y lo dice", async () => {
    const f = porCodigo(await desgaste(), "JOVEN")!;
    expect(f).toBeDefined();
    expect(f.origen_ritmo).toBe("modelo");
    // El del AH51 en el eje 1: 12 mm en 120.000 km.
    expect(Number(f.mm_por_1000km)).toBeCloseTo(0.1, 5);
    expect(Number(f.km_restantes)).toBe(133000);
  });

  it("a la goma cuyo ritmo propio es imposible también le presta el del modelo", async () => {
    const f = porCodigo(await desgaste(), "IMPOSIBLE")!;
    expect(f).toBeDefined();
    expect(f.origen_ritmo).toBe("modelo");
    expect(Number(f.mm_por_1000km)).toBeCloseTo(0.1, 5);
  });

  it("la que ya está por debajo del mínimo no tiene kilómetros por delante", async () => {
    const f = porCodigo(await desgaste(), "GASTADA")!;
    expect(f).toBeDefined();
    expect(Number(f.ultima_prof)).toBe(1);
    expect(Number(f.km_restantes)).toBe(0);
    expect(dia(f.fecha_prevista)).toBe(dia(f.ultima_fecha));
  });

  it("no predice la sustitución de una goma que ya no está montada", async () => {
    expect(porCodigo(await desgaste(), "DESMONTADA")).toBeUndefined();
  });

  it("dice en qué vehículo está montada", async () => {
    const f = porCodigo(await desgaste(), "LIMPIA-0")!;
    expect(f.matricula).toBe(MATRICULA_1);
  });

  it("saca primero lo que antes toca sustituir", async () => {
    const f = await desgaste();
    const fechas = f.map((x) => dia(x.fecha_prevista)).filter((x): x is string => x !== null);
    expect([...fechas].sort()).toEqual(fechas);
  });

  it("el mínimo legal es un parámetro, no un número escondido", async () => {
    // A 3 mm en vez de 1,6, a LIMPIA-0 le quedan 10 mm y no 11,4.
    const r = await db.query<FilaDesgaste>(
      `select * from ${ESQUEMA}.tc_informes_desgaste(null, 3.0)`,
    );
    const f = porCodigo(r.rows, "LIMPIA-0")!;
    expect(Number(f.km_restantes)).toBe(100000);
  });

  it("no saca una fila por cada montaje: una goma, una fila", async () => {
    const f = await desgaste();
    expect(new Set(f.map((x) => x.neumatico_id)).size).toBe(f.length);
  });

  it("dos lecturas del mismo instante se promedian, y el resultado no depende del plan", async () => {
    // Dos revisiones del mismo día con el mismo odómetro midiendo la misma
    // goma: 8,0 y 6,0. Sin promediar, el `array_agg` elegía una al azar y el
    // informe dejaba de ser reproducible. Promediadas son 7,0.
    const n = await altaNeumatico("Empate", "DOBLE", { montadoEn: V1, codigo: "EMPATE" });
    const { rows: pos } = await db.query(`select id from tc_posiciones_vehiculo where eje = 1`);
    const eje1 = pos[0].id as string;
    await medir(n, V1, eje1, 100000, 15, 0);
    await medir(n, V1, eje1, 110000, 11, 30);
    await medir(n, V1, eje1, 120000, 8, 60);
    await medir(n, V1, eje1, 120000, 6, 60);     // el empate

    const r = await db.query<FilaDesgaste>(`select * from ${ESQUEMA}.tc_informes_desgaste()`);
    const f = porCodigo(r.rows, "EMPATE")!;
    expect(Number(f.ultima_prof)).toBe(7);
    expect(Number(f.n_medidas)).toBe(3);         // tres instantes, no cuatro

    // Y dos ejecuciones seguidas dicen lo mismo.
    const otra = await db.query<FilaDesgaste>(`select * from ${ESQUEMA}.tc_informes_desgaste()`);
    expect(Number(porCodigo(otra.rows, "EMPATE")!.ultima_prof)).toBe(7);
  });

  // ══════════════════════════════════════════════════════════════════════════
  // tc_informes_sustituciones_previstas
  // ══════════════════════════════════════════════════════════════════════════

  interface FilaPrevision {
    medida: string; montados: string; sin_datos: string; sin_fecha: string;
    vencidos: string; dias: number; en_el_tramo: string; acumulado: string;
  }

  /** La previsión con una fecha fija, para que no dependa del día que sea. */
  async function prevision(desde = "2026-06-01", tramos = "{30,60,90}"): Promise<FilaPrevision[]> {
    const r = await db.query<FilaPrevision>(
      `select * from ${ESQUEMA}.tc_informes_sustituciones_previstas(null, $1::int[], $2::date)`,
      [tramos, desde],
    );
    return r.rows;
  }

  const deMedida = (f: FilaPrevision[], m: string) => f.filter((x) => x.medida === m);

  it("junta la misma medida escrita de dos formas", async () => {
    const f = await prevision();
    // «385/65R22.5 158L» y «385/65R22.5» son la misma goma para quien compra.
    const m = deMedida(f, "385/65R22.5");
    expect(m.length).toBeGreaterThan(0);
    expect(Number(m[0].montados)).toBe(2);
    expect(deMedida(f, "385/65R22.5 158L")).toHaveLength(0);
  });

  it("la goma sin medida no desaparece: se agrupa aparte", async () => {
    const f = await prevision();
    const m = deMedida(f, "(sin medida)");
    expect(m.length).toBeGreaterThan(0);
    expect(Number(m[0].montados)).toBe(1);
  });

  it("saca una fila por medida y plazo, y nada más", async () => {
    const f = await prevision();
    const medidas = new Set(f.map((x) => x.medida));
    expect(f).toHaveLength(medidas.size * 3);
    expect([...new Set(f.map((x) => x.dias))].sort((a, b) => a - b)).toEqual([30, 60, 90]);
  });

  it("el acumulado no baja nunca y empieza por lo ya vencido", async () => {
    for (const m of new Set((await prevision()).map((x) => x.medida))) {
      const filas = deMedida(await prevision(), m).sort((a, b) => a.dias - b.dias);
      const acum = filas.map((x) => Number(x.acumulado));
      expect([...acum].sort((a, b) => a - b)).toEqual(acum);
      expect(acum[0]).toBeGreaterThanOrEqual(Number(filas[0].vencidos));
    }
  });

  it("los tramos suman el acumulado, quitando lo vencido", async () => {
    for (const m of new Set((await prevision()).map((x) => x.medida))) {
      const filas = deMedida(await prevision(), m).sort((a, b) => a.dias - b.dias);
      const suma = filas.reduce((a, x) => a + Number(x.en_el_tramo), 0);
      const ultimo = filas[filas.length - 1];
      expect(suma).toBe(Number(ultimo.acumulado) - Number(ultimo.vencidos));
    }
  });

  it("nunca promete más de lo que hay montado", async () => {
    for (const x of await prevision()) {
      const cubiertas = Number(x.acumulado) + Number(x.sin_fecha) + Number(x.sin_datos);
      expect(cubiertas).toBeLessThanOrEqual(Number(x.montados));
    }
  });

  /**
   * 346 gomas de 385/55R22.5 están montadas en la flota real y ninguna tiene
   * una sola medición. Si la previsión saliera solo de lo medido, no saldrían,
   * y quien hiciera el pedido entendería que esa medida no existe.
   */
  it("una medida montada y nunca medida sale igual, con ceros y su aviso", async () => {
    const f = deMedida(await prevision(), "385/55R22.5");
    expect(f.length).toBe(3);
    expect(Number(f[0].montados)).toBe(1);
    expect(Number(f[0].sin_datos)).toBe(1);
    expect(Number(f[0].sin_fecha)).toBe(0);
    expect(f.every((x) => Number(x.en_el_tramo) === 0 && Number(x.acumulado) === 0)).toBe(true);
  });

  it("respeta los plazos que se le pidan", async () => {
    const f = await prevision("2026-06-01", "{7,400}");
    expect([...new Set(f.map((x) => x.dias))].sort((a, b) => a - b)).toEqual([7, 400]);
  });

  it("mirando desde más adelante, lo que antes era futuro pasa a vencido", async () => {
    const pronto = deMedida(await prevision("2026-06-01"), "295/80R22.5")[0];
    const tarde = deMedida(await prevision("2030-01-01"), "295/80R22.5")[0];
    expect(Number(tarde.vencidos)).toBeGreaterThan(Number(pronto.vencidos));
  });

  // ══════════════════════════════════════════════════════════════════════════
  // en_seguimiento
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * El vehículo fuera del mantenimiento integral.
   *
   * Está activo y en la telemática, pero nadie le revisa las gomas. No tiene
   * que salir ni en la predicción de sustitución ni en la previsión de
   * compra, y las medidas que solo lleve él tampoco: si de una medida no
   * tenemos que cambiar nada, no hay que comprarla.
   */
  it("un vehículo sin seguimiento desaparece del desgaste y de la previsión", async () => {
    const { rows } = await db.query(
      `insert into tc_vehiculos (matricula, en_seguimiento) values ('9999ZZZ', true) returning id`,
    );
    const fuera = rows[0].id as string;
    const { rows: pos } = await db.query(`select id from tc_posiciones_vehiculo where eje = 1`);
    const eje1 = pos[0].id as string;
    const n = await altaNeumatico("Hankook", "AH51",
      { montadoEn: fuera, codigo: "FUERA", medida: "275/70R22.5" });
    await serie(n, fuera, eje1, 100000, 15, 20000, 2);

    // Con seguimiento sale, como cualquier otra.
    const conSeg = await db.query(`select * from ${ESQUEMA}.tc_informes_desgaste()`);
    expect(conSeg.rows.find((x: any) => x.codigo === "FUERA")).toBeDefined();
    const prevCon = await db.query(
      `select * from ${ESQUEMA}.tc_informes_sustituciones_previstas(null, '{30}'::int[], '2026-06-01'::date)`,
    );
    expect(prevCon.rows.find((x: any) => x.medida === "275/70R22.5")).toBeDefined();

    // Se le quita, y deja de contar en los dos.
    await db.query(`update tc_vehiculos set en_seguimiento = false where id = $1`, [fuera]);
    const sinSeg = await db.query(`select * from ${ESQUEMA}.tc_informes_desgaste()`);
    expect(sinSeg.rows.find((x: any) => x.codigo === "FUERA")).toBeUndefined();
    const prevSin = await db.query(
      `select * from ${ESQUEMA}.tc_informes_sustituciones_previstas(null, '{30}'::int[], '2026-06-01'::date)`,
    );
    expect(prevSin.rows.find((x: any) => x.medida === "275/70R22.5")).toBeUndefined();

    // Y al devolvérselo, vuelve. No se ha perdido nada por el camino.
    await db.query(`update tc_vehiculos set en_seguimiento = true where id = $1`, [fuera]);
    const vuelta = await db.query(`select * from ${ESQUEMA}.tc_informes_desgaste()`);
    expect(vuelta.rows.find((x: any) => x.codigo === "FUERA")).toBeDefined();
    await db.query(`update tc_vehiculos set en_seguimiento = false where id = $1`, [fuera]);
  });

  it("quitarle el seguimiento a uno no toca a los demás", async () => {
    // El resto del banco sigue en `true`, así que el AH51 del eje 1 tiene que
    // seguir diciendo exactamente lo mismo que antes de todo esto.
    const f = de("Hankook", "AH51", 1)!;
    expect(Number(f.tramos)).toBe(9);
    expect(Number(f.km_por_mm)).toBe(10000);
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
