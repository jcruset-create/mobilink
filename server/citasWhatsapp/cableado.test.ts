import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Lo que `server/index.ts` tiene que seguir haciendo.
 *
 * Ese fichero no tiene pruebas unitarias —son 19.600 líneas de endpoints— y
 * las reglas que la confirmación de citas necesita viven ahí: que un «leído»
 * no confirme, que una firma inválida no toque una cita, que el hueco de 24 h
 * no lo atiendan dos sitios a la vez.
 *
 * Son reglas que no se rompen con un error de tipos: se rompen borrando una
 * línea sin saber para qué estaba. Este guarda lee el fuente y lo comprueba,
 * igual que hace `recepcionVehiculos/columnas.test.ts` con los nombres de
 * columna. No es elegante; es lo que hay hasta que eso se parta en módulos.
 */

const INDEX = readFileSync(new URL("../index.ts", import.meta.url).pathname, "utf8");

/**
 * El mismo texto sin comentarios.
 *
 * Hace falta porque el comentario que explica «aquí no se toca
 * `confirmationStatus`» contiene esas mismas palabras, y el guarda las cazaba
 * a sí mismo. Un guarda que se dispara con la explicación de por qué existe
 * es un guarda que acaba borrado.
 */
function sinComentarios(texto: string): string {
  return texto
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/[^\n]*/g, " ");
}

/** El trozo del webhook de entrada. */
function webhookEntrante(): string {
  const ini = INDEX.indexOf('"/api/whatsapp/inbound"');
  const fin = INDEX.indexOf('"/api/whatsapp/messages"', ini);
  expect(ini).toBeGreaterThan(0);
  return INDEX.slice(ini, fin > ini ? fin : ini + 40000);
}

/**
 * El trozo del callback de estados, cortado en el endpoint SIGUIENTE.
 *
 * Con un número fijo de caracteres el trozo se colaba en el endpoint de al
 * lado y el test leía código que no era el suyo. Un guarda que mira donde no
 * debe da un rojo que no significa nada, y a la tercera se borra.
 */
function callbackDeEstado(): string {
  const ini = INDEX.indexOf('"/api/whatsapp/status"');
  expect(ini).toBeGreaterThan(0);
  const fin = INDEX.indexOf("\napp.", ini);
  return INDEX.slice(ini, fin > ini ? fin : ini + 4000);
}

describe("el envío de 24 h lo atiende un solo sitio", () => {
  it("el bucle de siempre se salta el hueco de 24 h", () => {
    // Sin esta línea, el recordatorio viejo y la solicitud de confirmación
    // saldrían los dos: dos WhatsApp al mismo cliente con un minuto de
    // diferencia, uno de ellos sin botones.
    expect(INDEX).toContain(
      'if (reminder.sentField === "whatsappReminder24hSentAtMs") continue;'
    );
  });

  it("la decisión de mandar sale del módulo, no de una condición suelta", () => {
    expect(INDEX).toContain("debePedirConfirmacion(job, {");
  });

  it("solo se marca como enviada si el mensaje salió de verdad", () => {
    // `marcarConfirmacionEnviada` tiene que estar DENTRO de la rama
    // «enviado». Marcarla sin haber mandado nada la pierde para siempre:
    // `debePedirConfirmacion` ya no la volvería a coger.
    const ini = INDEX.indexOf('if (resultado.estado === "enviado")');
    const fin = INDEX.indexOf('else if (resultado.estado === "sin-plantilla")', ini);
    expect(ini).toBeGreaterThan(0);
    expect(INDEX.slice(ini, fin)).toContain("marcarConfirmacionEnviada");
  });
});

describe("leído NO es confirmado", () => {
  it("el callback de estado no escribe el estado de confirmación", () => {
    const trozo = sinComentarios(callbackDeEstado());
    expect(trozo).toContain("aplicarEstadoDeEnvio");
    // Lo que dice Twilio del MENSAJE no puede mover lo que dijo el CLIENTE.
    expect(trozo).not.toContain("confirmationStatus");
    expect(trozo).not.toContain("confirmedAtMs");
  });

  it("el estado del mensaje se traduce por el módulo, no a mano", () => {
    expect(sinComentarios(callbackDeEstado())).toContain("estadoEnvioDeTwilio");
  });
});

describe("una firma inválida no toca una cita", () => {
  it("la firma se guarda como bandera en vez de solo avisar", () => {
    const trozo = webhookEntrante();
    expect(trozo).toContain("let firmaValida = false;");
  });

  it("la respuesta solo se aplica con firma válida", () => {
    const trozo = webhookEntrante();
    const ini = trozo.indexOf("if (intencion) {");
    expect(ini).toBeGreaterThan(0);
    // El primer `if` de dentro tiene que ser el de la firma: si se aplicara
    // primero y se comprobara después, ya estaría hecho el daño.
    expect(trozo.slice(ini, ini + 200)).toContain("if (!firmaValida)");
  });

  it("los caminos que ya existían siguen sin exigir firma", () => {
    // Recobros, captura y borradores llevan años entrando así. Endurecerlos
    // de golpe es romper cosas que funcionan sin saber a quién.
    const trozo = webhookEntrante();
    expect(trozo).toContain("procesando igualmente");
  });
});

describe("varias citas candidatas no confirman ninguna", () => {
  it("la elección sale del módulo puro", () => {
    expect(webhookEntrante()).toContain("eligeCitaParaRespuesta");
  });

  it("el caso ambiguo se registra y no escribe", () => {
    const trozo = webhookEntrante();
    const ini = trozo.indexOf('eleccion.tipo === "ambigua"');
    expect(ini).toBeGreaterThan(0);
    const rama = sinComentarios(trozo.slice(ini, ini + 900));
    expect(rama).toContain("REVISIÓN MANUAL");
    expect(rama).not.toContain("cambiarCita");
  });

  it("el mensaje repetido no vuelve a escribir la hora", () => {
    expect(webhookEntrante()).toContain("respuestaYaAplicada");
  });
});
