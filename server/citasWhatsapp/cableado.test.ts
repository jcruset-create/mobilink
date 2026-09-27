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
    expect(INDEX).toContain("planDeConfirmacion(job, {");
  });

  it("el intento se reserva ANTES de llamar a Twilio", () => {
    // Si se contara después, un envío que sale y no se llega a guardar
    // dejaría la cita como si nunca se hubiera intentado: se mandaría otra
    // vez, y otra, sin final.
    const i = INDEX.indexOf("await reservarIntento(");
    const j = INDEX.indexOf("await enviarConfirmacion(");
    expect(i).toBeGreaterThan(0);
    expect(i).toBeLessThan(j);
  });

  it("el horario de silencio se mide en la zona de la agenda", () => {
    // Render corre en UTC. Sin pasar la zona, el módulo usaría su valor por
    // defecto y acertaría por casualidad; el día que alguien cambie
    // AGENDA_TIME_ZONE, los WhatsApp saldrían de noche sin que nada avise.
    const i = INDEX.indexOf("planDeConfirmacion(job, {");
    expect(i).toBeGreaterThan(0);
    expect(sinComentarios(INDEX.slice(i, i + 600))).toContain("zona: AGENDA_TIME_ZONE");
  });

  it("una cita a menos de dos horas se marca como no solicitada", () => {
    expect(INDEX).toContain("marcarNoSolicitada(job.id)");
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

describe("una firma inválida no entra", () => {
  /*
   * Estas tres reglas cambiaron al cerrar el webhook.
   *
   * Antes decían que la firma se guardaba como bandera y que los caminos
   * antiguos —recobros, captura, borradores— seguían procesándose sin firma,
   * «para no romper cosas que funcionan sin saber a quién». Esa decisión se
   * revisó al ver qué había al final de uno de esos caminos: el `fetch` de
   * `MediaUrl0` que añadía las credenciales de Twilio en la cabecera. Procesar
   * sin firma no era solo aceptar un mensaje falso; era regalar el AUTH_TOKEN
   * de la cuenta a quien pusiera su propio dominio en el cuerpo. Con ese token
   * se firman webhooks válidos, citas incluidas, así que la protección de las
   * citas tampoco se sostenía.
   *
   * Ahora la regla es: sin firma válida no se procesa NADA.
   */
  it("una firma ausente o inválida se rechaza con 403 antes de procesar", () => {
    const trozo = sinComentarios(webhookEntrante());
    expect(trozo).toContain("if (!firmaValida)");
    expect(trozo).toContain('res.status(403)');
    // Y el rechazo va ANTES de guardar el mensaje: si no, un anónimo seguiría
    // escribiendo filas en whatsapp_messages.
    const iRechazo = trozo.indexOf("if (!firmaValida)");
    const iGuardar = trozo.indexOf("INSERT INTO whatsapp_messages");
    expect(iRechazo).toBeGreaterThan(0);
    expect(iGuardar).toBeGreaterThan(0);
    expect(iRechazo).toBeLessThan(iGuardar);
  });

  it("ya no queda ningún camino que procese sin firma", () => {
    expect(sinComentarios(webhookEntrante())).not.toContain("procesando igualmente");
  });

  it("la respuesta a una cita sigue teniendo su propia comprobación", () => {
    // Inalcanzable desde el 403, y se deja como segunda barrera: confirmar una
    // cita es lo único de este webhook que el cliente ve como un compromiso.
    const trozo = webhookEntrante();
    const ini = trozo.indexOf("if (intencion) {");
    expect(ini).toBeGreaterThan(0);
    expect(trozo.slice(ini, ini + 200)).toContain("if (!firmaValida)");
  });

  it("los medios de WhatsApp solo se descargan de Twilio", () => {
    // Es lo que impide entregar el AUTH_TOKEN a un host ajeno. El nombre de la
    // variable sí aparece —hay que leerla para validar la firma—; lo que no
    // puede volver a aparecer aquí es la CABECERA construida con ella, que es
    // lo que viajaba a la URL que eligiera quien mandaba el mensaje.
    const trozo = webhookEntrante();
    expect(trozo).toContain("descargarMedioTwilio");
    expect(trozo).not.toContain('"Basic "');
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
