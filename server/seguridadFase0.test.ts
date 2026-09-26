/**
 * Guardas de la Fase 0 de seguridad.
 *
 * ── Por qué se comprueba leyendo el fuente ──────────────────────────────────
 *
 * Lo que arregla la Fase 0 vive casi todo en `server/index.ts`: veinte mil
 * líneas de endpoints que no tienen forma de probarse por HTTP sin arrancar el
 * servidor entero, con sus catorce trabajos en segundo plano y sus buzones de
 * correo. El proyecto ya tiene este patrón por el mismo motivo —ver
 * `server/citasWhatsapp/cableado.test.ts` y
 * `server/recepcionVehiculos/columnas.test.ts`— y su razonamiento vale igual
 * aquí: estas reglas no se rompen con un error de tipos, se rompen borrando una
 * línea sin saber para qué estaba.
 *
 * No es lo mismo que una prueba negativa por HTTP, y conviene no confundirlo:
 * esto detecta que alguien QUITA la protección, no demuestra que la protección
 * funcione. Las pruebas por HTTP (anónimo → 401, recurso de otra empresa → 404)
 * necesitan un arnés que monte la app sin los trabajos en segundo plano, y eso
 * va con la Fase 1, cuando el fichero se parta.
 *
 * Cada `it` dice qué agujero cierra, para que quien lo vea fallar sepa si está
 * rompiendo algo o arreglándolo.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const INDEX = readFileSync(new URL("./index.ts", import.meta.url).pathname, "utf8");

/** El fuente sin comentarios: un guarda no puede cazarse a sí mismo en la explicación. */
function sinComentarios(texto: string): string {
  return texto.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
}

const CODIGO = sinComentarios(INDEX);

/** El trozo de una ruta, desde su declaración hasta la siguiente. */
function ruta(patron: string, largo = 3000): string {
  const i = INDEX.indexOf(patron);
  expect(i, `no se encuentra la ruta ${patron}`).toBeGreaterThan(0);
  return INDEX.slice(i, i + largo);
}

describe("SEC-001 · ninguna ruta se queda sin credencial", () => {
  it("protectWhenStrict ya no se usa: no dependía de nada y no protegía nada", () => {
    // `AUTH_MODE` no está definido en ningún sitio, así que la función era un
    // `next()` pelado y cincuenta rutas contestaban a cualquiera.
    expect(CODIGO).not.toContain("protectWhenStrict(");
  });

  it("y se ha sustituido por un guard que exige credencial", () => {
    expect(CODIGO).toContain("exigirCredencial(");
    expect(CODIGO.match(/exigirCredencial\(/g)!.length).toBeGreaterThan(40);
  });

  it("sin credencial válida se contesta 401, no se sigue adelante", () => {
    const i = CODIGO.indexOf("async function familiaCredencial");
    const fin = CODIGO.indexOf("function normalizeRoadsideOperatorCodeRow");
    const trozo = CODIGO.slice(i, fin);
    expect(trozo).toContain('familia === "ninguna"');
    expect(trozo).toContain("status(401)");
  });

  it("acepta las tres familias que los clientes usan hoy", () => {
    // Si se quitara cualquiera de las tres, se rompería un cliente en producción:
    // el panel clásico, las APKs de operario o el hub.
    const i = CODIGO.indexOf("async function familiaCredencial");
    const trozo = CODIGO.slice(i, i + 2500);
    expect(trozo).toContain("resolveAuthContext");
    expect(trozo).toContain("getTallerOperatorFromRequest");
    expect(trozo).toContain("verificarPinPresencia");
    expect(trozo).toContain("getRoleFromRequestAsync");
  });
});

describe("SEC-012 · los endpoints que respondían a cualquiera", () => {
  const casos: Array<[string, string]> = [
    ['"/api/administracion/analizar-impagado"', "authenticate"],
    ['"/api/administracion/analizar-cliente"', "authenticate"],
    ['"/api/almacen/leer-albaran-pdf"', "authenticate"],
    ['"/api/almacen/leer-entrada-pdf"', "authenticate"],
    ['"/api/assigned-maintenance-tasks/old-interrupted"', "requireSupervisorRole"],
  ];

  for (const [patron, guard] of casos) {
    it(`${patron} exige ${guard}`, () => {
      // Sin guard, cualquiera desde internet gastaba nuestro presupuesto de
      // OpenAI (los cuatro primeros) o borraba historial (el último).
      expect(sinComentarios(ruta(patron, 400))).toContain(guard);
    });
  }

  it("mi-contexto rechaza a quien no trae credencial", () => {
    // Antes devolvía la lista completa de talleres a cualquiera.
    expect(ruta('"/api/roadside-assistances/mi-contexto"', 200)).toContain("requirePanelRole");
  });
});

describe("SEC-007 · el webhook de WhatsApp", () => {
  it("rechaza la firma inválida en vez de procesar igualmente", () => {
    const trozo = sinComentarios(ruta('"/api/whatsapp/inbound"', 4000));
    expect(trozo).toContain("if (!firmaValida)");
    expect(trozo).toContain("status(403)");
  });

  it("no queda ningún fetch con las credenciales de Twilio hacia una URL de fuera", () => {
    // La cabecera Basic con SID:AUTH_TOKEN se construía tres veces, cada una
    // hacia la URL que trajera el mensaje. Ahora hay un solo sitio y pasa por
    // la lista blanca de hosts.
    expect(CODIGO.match(/"Basic " \+/g) ?? []).toHaveLength(1);
    expect(CODIGO).toContain("async function descargarMedioTwilio");
    const i = CODIGO.indexOf("async function descargarMedioTwilio");
    expect(CODIGO.slice(i, i + 600)).toContain("HOSTS_TWILIO");
  });
});

describe("SEC-005 · reset de contraseña acotado", () => {
  it("existe la comprobación de empresa y de superadmin", () => {
    expect(CODIGO).toContain("async function puedeGestionarUsuario");
    const i = CODIGO.indexOf("async function puedeGestionarUsuario");
    const cuerpo = CODIGO.slice(i, i + 1200);
    expect(cuerpo).toContain("es_superadmin");
    expect(cuerpo).toContain("admin.empresaId");
  });

  it("el reset del panel de administración la usa", () => {
    expect(sinComentarios(ruta('"/api/administracion/usuarios/reset-password"', 1600))).toContain(
      "puedeGestionarUsuario"
    );
  });

  it("el de TyreControl comprueba empresa y superadmin de plataforma", () => {
    const trozo = sinComentarios(ruta('"/api/tyrecontrol/usuarios/:id/password"', 4000));
    expect(trozo).toContain("perfil.es_superadmin");
    expect(trozo).toContain("empresa_id");
    // La cuenta puede ser superadministradora de la plataforma sin serlo en
    // TyreControl: hay que mirar también la tabla maestra.
    expect(trozo).toContain("app_usuarios");
  });
});

describe("SEC-019 · licencias solo para superadministrador", () => {
  it("el guard exige esSuperadmin y no acepta el token clásico", () => {
    const i = CODIGO.indexOf("const requireLicensesAdmin");
    const cuerpo = CODIGO.slice(i, i + 900);
    expect(cuerpo).toContain("esSuperadmin");
    // El respaldo por contraseña compartida ya no está.
    expect(cuerpo).not.toContain("getRoleFromRequestAsync");
  });
});

describe("SEC-025 y SEC-018 · secretos fuera del código, de la URL y de los logs", () => {
  it("la contraseña de reinicio ya no está escrita en el código", () => {
    // Sobre el fuente SIN comentarios: el comentario que explica por qué se
    // quitó la nombra, y un guarda que se dispara con su propia explicación
    // acaba borrado.
    expect(CODIGO).not.toContain("sea123");
  });

  it("el reinicio total no funciona en producción", () => {
    const trozo = sinComentarios(ruta('"/api/reset"', 1800));
    expect(trozo).toContain('process.env.NODE_ENV === "production"');
    expect(trozo).toContain("status(410)");
  });

  it("el logger escribe la ruta y no la URL con su cadena de consulta", () => {
    expect(CODIGO).toContain("[REQ] ${req.method} ${req.path}");
    expect(CODIGO).not.toContain("[REQ] ${req.method} ${req.url}");
  });

  it("la copia de seguridad no se lleva credenciales", () => {
    expect(CODIGO).toContain("COLUMNAS_QUE_NO_SE_COPIAN");
    const i = CODIGO.indexOf("COLUMNAS_QUE_NO_SE_COPIAN = new Set");
    const lista = CODIGO.slice(i, i + 400);
    for (const columna of ["roadsideOperatorCode", "workshopPin", "workshopPinHash"]) {
      expect(lista, columna).toContain(columna);
    }
    expect(CODIGO).toContain("sinColumnasSecretas(result.rows)");
  });

  it("las credenciales se comparan en tiempo constante", () => {
    // `===` corta en el primer carácter distinto y el tiempo filtra el prefijo.
    expect(CODIGO).not.toContain("token === process.env.ADMIN_PASSWORD");
    expect(CODIGO).not.toContain("token === process.env.SUPERVISOR_PASSWORD");
    expect(CODIGO).not.toContain("code !== expectedCode");
    expect(CODIGO).toContain("safeEquals(");
  });
});

describe("SEC-006 · ninguna respuesta de la API devuelve una contraseña", () => {
  it("login-sso no devuelve adminToken", () => {
    const trozo = sinComentarios(ruta('"/api/login-sso"', 3500));
    expect(trozo).not.toContain("adminToken");
  });

  it("y no devuelve ni la contraseña del usuario ni la del entorno", () => {
    const trozo = sinComentarios(ruta('"/api/login-sso"', 3500));
    expect(trozo).not.toContain("panelUser.password");
    expect(trozo).not.toContain("process.env.ADMIN_PASSWORD");
  });
});

describe("SEC-015 · los logins tienen freno", () => {
  const logins = [
    '"/api/login"',
    '"/api/almacen/login-operario"',
    '"/api/taller-operator/login"',
    '"/api/workshop-operator/login"',
    '"/api/roadside-operator/login"',
    '"/api/presencia-operator/login"',
    '"/api/tyrecontrol/login-operario"',
  ];

  for (const patron of logins) {
    it(`${patron} pasa por el freno de intentos`, () => {
      const trozo = sinComentarios(ruta(patron, 2200));
      // Con PINs de cuatro dígitos y las listas de nombres abiertas, sin esto
      // son diez mil intentos por persona.
      expect(trozo).toMatch(/frenoLogin\(|comprobarIntento\(/);
    });
  }

  it("el login de TyreControl comprueba el PIN antes de dar el email", () => {
    const trozo = sinComentarios(ruta('"/api/tyrecontrol/login-operario"', 4000));
    const iComprobacion = trozo.indexOf("signInWithPassword");
    const iRespuesta = trozo.indexOf("res.json({ ok: true, email");
    expect(iComprobacion).toBeGreaterThan(0);
    expect(iRespuesta).toBeGreaterThan(0);
    // Si el email saliera antes de comprobar el PIN, esto seguiría siendo un
    // enumerador de usuarios con premio.
    expect(iComprobacion).toBeLessThan(iRespuesta);
  });
});

describe("SEC-005 · el borrado de la cuenta de Auth se autoriza con lo apuntado", () => {
  it("eliminar-auth exige un apunte de baja de tu empresa", () => {
    const trozo = sinComentarios(ruta('"/api/administracion/usuarios/eliminar-auth"', 4000));
    // La empresa ya no se puede leer de la ficha: para cuando llega aquí, la
    // ficha se ha borrado. Se comprueba contra lo que apuntó el disparador.
    expect(trozo).toContain("app_bajas_auth");
    expect(trozo).toContain("admin.empresaId");
  });

  it("y si la tabla no existe todavía, solo entra un superadministrador", () => {
    const trozo = sinComentarios(ruta('"/api/administracion/usuarios/eliminar-auth"', 4000));
    expect(trozo).toContain("tieneTabla");
    expect(trozo).toContain("admin.esSuperadmin");
  });

  it("el apunte se consume: una baja autoriza un borrado, no varios", () => {
    const trozo = sinComentarios(ruta('"/api/administracion/usuarios/eliminar-auth"', 4500));
    expect(trozo).toContain("DELETE FROM app_bajas_auth");
  });
});

describe("SEC-021 · no se sale a internet con una URL de fuera sin lista blanca", () => {
  it("files-from-url pasa por fetchSeguro", () => {
    const trozo = sinComentarios(ruta('"/api/roadside-assistances/:id/files-from-url"', 2600));
    expect(trozo).toContain("fetchSeguro");
    expect(trozo).not.toContain("await fetch(mediaUrl)");
  });

  it("y el tipo de archivo no puede salirse de su carpeta", () => {
    const trozo = sinComentarios(ruta('"/api/roadside-assistances/:id/files-from-url"', 2600));
    expect(trozo).toContain("a-z0-9_-");
  });
});
