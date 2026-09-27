/**
 * Guardas del cliente Supabase único del front web.
 *
 * ── Qué defecto vigilan ─────────────────────────────────────────────────────
 *
 * Había tres `createClient` (TyreControl, Administración, Almacén) sobre el
 * mismo proyecto y, por tanto, sobre la misma clave de almacenamiento. Tres
 * `GoTrueClient` con tres temporizadores de refresco rotando el mismo refresh
 * token producen «Invalid Refresh Token» y expulsan al usuario. El razonamiento
 * completo está en `supabaseCliente.ts`.
 *
 * Se comprueban dos cosas distintas, y conviene no confundirlas:
 *
 *   1. Guardas estáticas: leen el fuente y detectan que alguien VUELVE a añadir
 *      un `createClient` en `src/`, o `storageKey` por módulo. Eso no se rompe
 *      con un error de tipos, se rompe copiando un fichero.
 *
 *   2. Pruebas de comportamiento: montan la instancia de verdad con `fetch`
 *      interceptado y comprueban que la sesión es realmente compartida —que
 *      entrar por un módulo deja sesión en los otros dos, y salir por uno la
 *      quita en los tres—. La identidad de objetos sola no lo demostraría: dos
 *      instancias distintas sobre el mismo almacén también «parecen» compartir
 *      sesión al leerla, y aun así se pisan al refrescar.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * Todo el fuente de `src/`, que es el front web, leído en crudo.
 *
 * Se usa `import.meta.glob` en vez de `node:fs` porque este fichero vive bajo
 * `src/` y ahí el tsconfig es el del navegador: no tiene los tipos de Node.
 * Vite resuelve el glob en tiempo de transformación, así que funciona igual bajo
 * vitest.
 */
const CRUDO = import.meta.glob("/src/**/*.{ts,tsx}", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

/** El fuente sin comentarios: una guarda no puede cazarse a sí misma en su explicación. */
function sinComentarios(texto: string): string {
  return texto.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
}

const FUENTES = Object.entries(CRUDO)
  .map(([ruta, codigo]) => ({
    // "/src/modules/x/y.ts" → "modules/x/y.ts". El glob va desde la raíz del
    // proyecto, no desde este fichero, para que las claves no dependan de dónde
    // esté la prueba.
    ruta: ruta.replace(/^\/src\//, ""),
    codigo: sinComentarios(codigo),
  }))
  .sort((a, b) => a.ruta.localeCompare(b.ruta));

it("el glob encuentra el fuente: si devolviera poco, las guardas pasarían vacías", () => {
  expect(FUENTES.length).toBeGreaterThan(100);
  expect(FUENTES.map((f) => f.ruta)).toContain("services/supabaseCliente.ts");
});

describe("guardas estáticas · una sola llamada a createClient en el front web", () => {
  it("hay exactamente un fichero en src/ que llama a createClient", () => {
    const conLlamada = FUENTES.filter((f) => /\bcreateClient\s*\(/.test(f.codigo)).map((f) => f.ruta);
    expect(conLlamada).toEqual(["services/supabaseCliente.ts"]);
  });

  it("y ese fichero la llama una sola vez", () => {
    const cliente = FUENTES.find((f) => f.ruta === "services/supabaseCliente.ts")!;
    expect(cliente.codigo.match(/\bcreateClient\s*\(/g)!.length).toBe(1);
  });

  it("nadie en src/ importa createClient de supabase-js salvo ese fichero", () => {
    const importadores = FUENTES.filter(
      (f) => /import\s*\{[^}]*\bcreateClient\b[^}]*\}\s*from\s*"@supabase\/supabase-js"/.test(f.codigo),
    ).map((f) => f.ruta);
    expect(importadores).toEqual(["services/supabaseCliente.ts"]);
  });

  it("los tres módulos reexportan la instancia compartida, no crean la suya", () => {
    for (const modulo of ["tyrecontrol", "administracion", "almacen-neumaticos"]) {
      const f = FUENTES.find((x) => x.ruta === `modules/${modulo}/services/supabase.ts`);
      expect(f, `falta el reexport de ${modulo}`).toBeDefined();
      expect(f!.codigo).toContain('export { supabase } from "../../../services/supabaseCliente"');
      expect(f!.codigo).not.toMatch(/\bcreateClient\b/);
    }
  });

  it("ningún fichero que hable con supabase-js introduce su propia storageKey", () => {
    /*
     * Separar el almacenamiento quitaría el aviso de consola y la carrera de
     * tokens, pero rompería el SSO entre módulos: es la solución que se
     * descartó expresamente.
     *
     * La guarda se limita a los ficheros que importan de `@supabase/supabase-js`
     * a propósito. `storageKey` es un nombre corriente y en `src/` ya se usa
     * para cosas que no son Auth (la clave de localStorage del standby
     * automático, un campo de los formularios de OR manuales); mirar todo `src/`
     * convertiría la guarda en una prohibición de esa palabra.
     */
    const conClave = FUENTES.filter(
      (f) => /from\s*"@supabase\/supabase-js"/.test(f.codigo) && /\bstorageKey\b/.test(f.codigo),
    ).map((f) => f.ruta);
    expect(conClave).toEqual([]);
  });

  it("y el cliente compartido no pasa opciones a createClient", () => {
    // El modelo de Auth no se toca en este cambio: las tres llamadas anteriores
    // no pasaban opciones y la única tampoco, así que `persistSession`,
    // `autoRefreshToken` y la clave derivada de la URL quedan como estaban.
    const cliente = FUENTES.find((f) => f.ruta === "services/supabaseCliente.ts")!;
    expect(cliente.codigo).toMatch(/createClient\(supabaseUrl,\s*supabaseAnonKey\)/);
  });
});

/*
 * ── Comportamiento, con la instancia de verdad ───────────────────────────────
 *
 * Se intercepta `fetch`: no hay red en las pruebas y no hace falta: lo que se
 * comprueba es qué sesión ve cada módulo, no qué contesta GoTrue.
 */
const URL_PROYECTO = "https://proyectodeprueba.supabase.co";

/** base64url sin `Buffer`, que aquí no está tipado (tsconfig de navegador). */
function base64url(texto: string): string {
  return btoa(texto).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Un JWT sin firmar con la forma que auth-js espera poder decodificar. */
function jwtFalso(expiraEn: number): string {
  const cab = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const cuerpo = base64url(
    JSON.stringify({
      sub: "11111111-1111-1111-1111-111111111111",
      role: "authenticated",
      exp: Math.floor(Date.now() / 1000) + expiraEn,
    }),
  );
  return `${cab}.${cuerpo}.firmafalsa`;
}

const USUARIO = {
  id: "11111111-1111-1111-1111-111111111111",
  aud: "authenticated",
  role: "authenticated",
  email: "operario@mobilink.es",
  app_metadata: {},
  user_metadata: {},
  created_at: new Date().toISOString(),
};

function sesionFalsa() {
  return {
    access_token: jwtFalso(3600),
    token_type: "bearer",
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    refresh_token: "refresh-uno",
    user: USUARIO,
  };
}

describe("comportamiento · la sesión es una sola para los tres módulos", () => {
  let administracion: { supabase: import("@supabase/supabase-js").SupabaseClient };
  let tyrecontrol: typeof administracion;
  let almacen: typeof administracion;
  const peticiones: string[] = [];

  beforeAll(async () => {
    vi.stubEnv("VITE_SUPABASE_URL", URL_PROYECTO);
    vi.stubEnv("VITE_SUPABASE_ANON_KEY", jwtFalso(86_400));

    vi.stubGlobal("fetch", async (entrada: string | URL | Request) => {
      const url = String(typeof entrada === "object" && "url" in entrada ? entrada.url : entrada);
      peticiones.push(url);
      const cuerpo = url.includes("/token?grant_type=password")
        ? JSON.stringify(sesionFalsa())
        : url.includes("/logout")
          ? ""
          : "{}";
      return new Response(cuerpo || null, {
        status: cuerpo ? 200 : 204,
        headers: { "content-type": "application/json" },
      });
    });

    // Se importan DESPUÉS de dejar el entorno preparado: el módulo crea el
    // cliente al cargarse, y `import.meta.env` se lee en ese momento.
    administracion = await import("../modules/administracion/services/supabase");
    tyrecontrol = await import("../modules/tyrecontrol/services/supabase");
    almacen = await import("../modules/almacen-neumaticos/services/supabase");
  });

  afterAll(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("los tres módulos devuelven la MISMA instancia, no una copia equivalente", () => {
    expect(administracion.supabase).toBe(tyrecontrol.supabase);
    expect(tyrecontrol.supabase).toBe(almacen.supabase);
  });

  it("y por tanto el mismo GoTrueClient", () => {
    expect(administracion.supabase.auth).toBe(tyrecontrol.supabase.auth);
    expect(tyrecontrol.supabase.auth).toBe(almacen.supabase.auth);
  });

  it("se ha construido UN solo GoTrueClient, no tres", () => {
    /*
     * auth-js lleva un contador estático por clave de almacenamiento y es el
     * que dispara el aviso «Multiple GoTrueClient instances detected». Con las
     * tres instancias anteriores valía 3 y el cuarto módulo habría visto un
     * `instanceID` 2. Es la medida directa del defecto, no un proxy.
     */
    const auth = administracion.supabase.auth as unknown as { instanceID: number };
    const GoTrue = Object.getPrototypeOf(auth).constructor as {
      nextInstanceID: Record<string, number>;
    };
    expect(auth.instanceID).toBe(0);
    expect(Object.values(GoTrue.nextInstanceID)).toEqual([1]);
  });

  it("hay una sola clave de almacenamiento, compartida", () => {
    const clave = (administracion.supabase.auth as unknown as { storageKey: string }).storageKey;
    expect(clave).toBe("sb-proyectodeprueba-auth-token");
    for (const modulo of [tyrecontrol, almacen]) {
      expect((modulo.supabase.auth as unknown as { storageKey: string }).storageKey).toBe(clave);
    }
  });

  it("hay un solo temporizador de refresco, no uno por módulo", () => {
    // Un `autoRefreshTicker` por instancia era la causa de la rotación cruzada
    // del refresh token. Con una instancia sólo puede haber uno.
    const tickers = new Set(
      [administracion, tyrecontrol, almacen].map(
        (m) => (m.supabase.auth as unknown as { autoRefreshTicker: unknown }).autoRefreshTicker,
      ),
    );
    expect(tickers.size).toBe(1);
  });

  it("entrar por Administración deja sesión en TyreControl y en Almacén", async () => {
    const { data, error } = await administracion.supabase.auth.signInWithPassword({
      email: "operario@mobilink.es",
      password: "lo-que-sea",
    });
    expect(error).toBeNull();
    expect(data.session).not.toBeNull();

    for (const modulo of [tyrecontrol, almacen]) {
      const { data: vista } = await modulo.supabase.auth.getSession();
      expect(vista.session?.access_token).toBe(data.session!.access_token);
      expect(vista.session?.user.email).toBe("operario@mobilink.es");
    }
  });

  it("y sólo se ha pedido un token: no hay tres módulos autenticándose por separado", () => {
    const tokens = peticiones.filter((u) => u.includes("/token?grant_type=password"));
    expect(tokens.length).toBe(1);
  });

  it("salir por TyreControl deja sin sesión a Administración y a Almacén", async () => {
    const { error } = await tyrecontrol.supabase.auth.signOut();
    expect(error).toBeNull();

    for (const modulo of [administracion, almacen]) {
      const { data } = await modulo.supabase.auth.getSession();
      expect(data.session).toBeNull();
    }
  });
});
