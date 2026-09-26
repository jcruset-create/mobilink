/**
 * Pruebas negativas por HTTP contra el servidor de verdad.
 *
 * ── Por qué existe este arnés ───────────────────────────────────────────────
 *
 * Las guardas de `server/seguridadFase0.test.ts` leen el fuente: detectan que
 * alguien QUITA una protección, pero no demuestran que la protección funcione.
 * Lo que de verdad hay que poder afirmar es «un anónimo recibe 401» y «el panel
 * de siempre sigue entrando», y eso solo se ve levantando el servidor.
 *
 * `server/index.ts` no se puede importar desde una prueba: al cargarlo arranca
 * catorce trabajos en segundo plano, abre buzones de correo y escucha en un
 * puerto. Así que se arranca como proceso aparte, con su base de datos de
 * pruebas, y se le habla por HTTP. Tarda, y por eso el timeout es generoso.
 *
 * Cubre las tres familias de credencial que la Fase 0 acepta —token de panel
 * clásico, cabeceras de operario y sesión unificada— porque el riesgo de
 * `exigirCredencial` no es dejar entrar a quien no debe: es dejar FUERA a un
 * cliente que hoy funciona.
 *
 * Sin `RUN_DB_TESTS=1` no hace nada.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { openSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/*
 * Detrás de su propia variable, y no solo de `RUN_DB_TESTS`, por una razón
 * medida: arrancar el servidor DENTRO de la suite completa le hace compartir la
 * base con los demás ficheros, y el `initDb` del arranque toma bloqueos sobre
 * tablas que otra prueba está usando. Medido: la suite completa pasó de 220 s a
 * varios minutos sin terminar; este fichero aislado tarda nueve segundos.
 *
 * Se ejecuta a propósito, y conviene darle una base propia:
 *
 *   RUN_DB_TESTS=1 RUN_HTTP_TESTS=1 DATABASE_URL=... npx vitest run server/seguridadHttp
 */
const CORRE =
  process.env.RUN_DB_TESTS === "1" &&
  process.env.RUN_HTTP_TESTS === "1" &&
  Boolean(process.env.DATABASE_URL);
const describeSiHayBase = CORRE ? describe : describe.skip;

const PUERTO = 4700 + Math.floor(Math.random() * 200);
const BASE = `http://127.0.0.1:${PUERTO}`;
const CLAVE_ADMIN = "clave-de-prueba-admin";
const CODIGO_OPERARIO = "9137";
const NOMBRE_OPERARIO = "OperarioDePrueba";

const RAIZ = new URL("../", import.meta.url).pathname;

async function esperaPuerto(intentos = 120): Promise<boolean> {
  for (let i = 0; i < intentos; i++) {
    try {
      const r = await fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(1500) });
      if (r.status > 0) return true;
    } catch {
      /* todavía no escucha */
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

describeSiHayBase("Fase 0 por HTTP, contra el servidor real", () => {
  let servidor: ChildProcess | null = null;
  let arrancado = false;
  const RUTA_LOG = join(tmpdir(), `mobilink-servidor-pruebas-${PUERTO}.log`);

  beforeAll(async () => {
    // La salida va a un fichero, no a /dev/null: si el servidor no arranca, sin
    // esto la prueba solo puede decir «no ha arrancado» y no por qué.
    const log = openSync(RUTA_LOG, "w");
    servidor = spawn("npx", ["tsx", "server/index.ts"], {
      cwd: RAIZ,
      env: {
        ...process.env,
        PORT: String(PUERTO),
        NODE_ENV: "development",
        ADMIN_PASSWORD: CLAVE_ADMIN,
        // Claves ficticias: el servidor exige que existan al arrancar.
        SUPABASE_URL: process.env.SUPABASE_URL || "https://ejemplo.supabase.co",
        SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY || "clave",
        VITE_SUPABASE_ANON_KEY: process.env.VITE_SUPABASE_ANON_KEY || "anon",
        STRIPE_SECRET_KEY: "sk_test_ficticia",
        OPENAI_API_KEY: "ficticia",
      },
      stdio: ["ignore", log, log],
    });
    arrancado = await esperaPuerto();
    if (!arrancado) {
      console.error(`El servidor de pruebas no arrancó. Su salida está en ${RUTA_LOG}`);
    }

    if (arrancado) {
      // Un operario con código, para poder probar la familia «cabeceras de
      // operario» de verdad y no solo su ausencia.
      const { default: db } = await import("./db.ts");
      await db.query(
        `INSERT INTO techs (name, status, "roadsideOperatorCode")
         VALUES ($1, 'disponible', $2)
         ON CONFLICT (name) DO UPDATE SET "roadsideOperatorCode" = EXCLUDED."roadsideOperatorCode"`,
        [NOMBRE_OPERARIO, CODIGO_OPERARIO]
      ).catch(async () => {
        // Sin restricción única en `name`: se inserta a pelo.
        await db
          .query(
            `INSERT INTO techs (name, status, "roadsideOperatorCode") VALUES ($1,'disponible',$2)`,
            [NOMBRE_OPERARIO, CODIGO_OPERARIO]
          )
          .catch(() => {});
      });
    }
  }, 180_000);

  afterAll(() => {
    servidor?.kill("SIGKILL");
  });

  function exigeArranque() {
    if (!arrancado) throw new Error("El servidor de pruebas no ha arrancado");
  }

  const cabecerasAdmin = { "x-admin-token": CLAVE_ADMIN };
  const cabecerasOperario = {
    "x-roadside-operator-name": NOMBRE_OPERARIO,
    "x-roadside-operator-code": CODIGO_OPERARIO,
  };

  describe("SEC-001 · sin credencial no se entra", () => {
    const rutas = [
      "/api/jobs",
      "/api/techs",
      "/api/roadside-assistances?includeClosed=true",
      "/api/roadside-assistances/1",
      "/api/roadside-vehicles",
      "/api/logs",
      "/api/roadside-assistances/mi-contexto",
    ];

    for (const ruta of rutas) {
      it(`GET ${ruta} → 401`, async () => {
        exigeArranque();
        const r = await fetch(`${BASE}${ruta}`);
        // Antes de la Fase 0 esto devolvía 200 con los datos dentro: nombres,
        // teléfonos, matrículas y ubicaciones de los clientes.
        expect(r.status).toBe(401);
      });
    }

    it("y tampoco con un token que no vale", async () => {
      exigeArranque();
      const r = await fetch(`${BASE}/api/jobs`, { headers: { "x-admin-token": "me-lo-invento" } });
      expect(r.status).toBe(401);
    });

    it("ni con un Bearer que no es una sesión", async () => {
      exigeArranque();
      const r = await fetch(`${BASE}/api/jobs`, { headers: { Authorization: "Bearer no-es-un-jwt" } });
      expect(r.status).toBe(401);
    });
  });

  describe("y las tres familias de credencial siguen entrando", () => {
    it("token de panel clásico (el panel web de hoy)", async () => {
      exigeArranque();
      const r = await fetch(`${BASE}/api/jobs`, { headers: cabecerasAdmin });
      expect(r.status).toBe(200);
    });

    it("cabeceras de operario (las APKs de hoy)", async () => {
      exigeArranque();
      const r = await fetch(`${BASE}/api/roadside-assistances`, { headers: cabecerasOperario });
      // Lo que importa es que NO sea 401: el guard reconoce al operario.
      expect(r.status).not.toBe(401);
    });

    it("y un operario con el código equivocado no entra", async () => {
      exigeArranque();
      const r = await fetch(`${BASE}/api/roadside-assistances`, {
        headers: { ...cabecerasOperario, "x-roadside-operator-code": "0000" },
      });
      expect(r.status).toBe(401);
    });
  });

  describe("una ruta multipart de las APKs sigue autenticando", () => {
    it("scan-plate sin credencial → 401", async () => {
      exigeArranque();
      const cuerpo = new FormData();
      cuerpo.append("file", new Blob([new Uint8Array([0xff, 0xd8, 0xff])], { type: "image/jpeg" }), "m.jpg");
      const r = await fetch(`${BASE}/api/roadside-operator/scan-plate`, { method: "POST", body: cuerpo });
      expect(r.status).toBe(401);
    });

    it("scan-plate con las cabeceras de operario NO se queda en 401", async () => {
      exigeArranque();
      // Es la prueba de que la Fase 0 no rompe las subidas de las APKs, que es
      // la razón de no haber puesto `AUTH_MODE=strict`: los multipart mandan
      // solo estas cabeceras, nunca el Bearer.
      const cuerpo = new FormData();
      cuerpo.append("file", new Blob([new Uint8Array([0xff, 0xd8, 0xff])], { type: "image/jpeg" }), "m.jpg");
      const r = await fetch(`${BASE}/api/roadside-operator/scan-plate`, {
        method: "POST",
        headers: cabecerasOperario,
        body: cuerpo,
      });
      expect(r.status).not.toBe(401);
    });
  });

  describe("SEC-012 · los endpoints que respondían a cualquiera", () => {
    it("POST analizar-impagado sin sesión → 401", async () => {
      exigeArranque();
      const r = await fetch(`${BASE}/api/administracion/analizar-impagado`, { method: "POST" });
      expect(r.status).toBe(401);
    });

    it("POST leer-albaran-pdf sin sesión → 401", async () => {
      exigeArranque();
      const r = await fetch(`${BASE}/api/almacen/leer-albaran-pdf`, { method: "POST" });
      expect(r.status).toBe(401);
    });

    it("DELETE del historial de mantenimiento sin credencial → 401", async () => {
      exigeArranque();
      const r = await fetch(`${BASE}/api/assigned-maintenance-tasks/old-interrupted`, { method: "DELETE" });
      expect(r.status).toBe(401);
    });
  });

  describe("SEC-007 · el webhook de WhatsApp sin firma", () => {
    it("se rechaza con 403 y no procesa nada", async () => {
      exigeArranque();
      const cuerpo = new URLSearchParams({
        MessageSid: "SM-de-prueba",
        From: "whatsapp:+34600000000",
        NumMedia: "1",
        // La URL que se llevaba las credenciales de Twilio.
        MediaUrl0: "https://atacante.example/x",
      });
      const r = await fetch(`${BASE}/api/whatsapp/inbound`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: cuerpo,
      });
      expect(r.status).toBe(403);
    });
  });

  describe("SEC-015 · el freno de intentos", () => {
    it("al undécimo fallo del mismo operario contesta 429", async () => {
      exigeArranque();
      const codigos: number[] = [];
      for (let i = 0; i < 12; i++) {
        const r = await fetch(`${BASE}/api/workshop-operator/login`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: "FrenoPrueba", pin: "0000" }),
        });
        codigos.push(r.status);
      }
      expect(codigos.slice(0, 10).every((c) => c === 401)).toBe(true);
      expect(codigos.at(-1)).toBe(429);
    }, 60_000);

    it("y otra identidad desde la misma IP no se queda bloqueada", async () => {
      exigeArranque();
      const r = await fetch(`${BASE}/api/workshop-operator/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "OtroDistinto", pin: "0000" }),
      });
      // Si esto diera 429, el freno estaría echando fuera a gente legítima.
      expect(r.status).toBe(401);
    });
  });

  describe("SEC-025 · el reinicio total", () => {
    it("ya no acepta la contraseña que estaba en el código", async () => {
      exigeArranque();
      const r = await fetch(`${BASE}/api/reset`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...cabecerasAdmin },
        body: JSON.stringify({ password: "sea123" }),
      });
      expect([410, 503]).toContain(r.status);
    });
  });

  describe("SEC-019 · licencias", () => {
    it("el token de panel clásico ya no vale para administrarlas", async () => {
      exigeArranque();
      const r = await fetch(`${BASE}/api/licenses`, { headers: cabecerasAdmin });
      expect(r.status).toBe(403);
    });
  });

  describe("SEC-006 · ninguna respuesta lleva secretos", () => {
    it("login-sso sin sesión no devuelve nada aprovechable", async () => {
      exigeArranque();
      const r = await fetch(`${BASE}/api/login-sso`, { method: "POST" });
      const texto = await r.text();
      expect(r.status).toBe(401);
      expect(texto).not.toContain(CLAVE_ADMIN);
    });

    it("ninguna de las respuestas anteriores contiene la contraseña de admin", async () => {
      exigeArranque();
      // Barrido: si alguna ruta devolviera la contraseña compartida —como hacía
      // login-sso—, saldría aquí.
      for (const ruta of ["/api/panel/session", "/api/jobs", "/api/techs"]) {
        const r = await fetch(`${BASE}${ruta}`, { headers: cabecerasAdmin });
        const texto = await r.text();
        expect(texto, ruta).not.toContain(CLAVE_ADMIN);
      }
    });
  });
});
