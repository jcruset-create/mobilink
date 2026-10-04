/**
 * Proveedor de IA SIMULADO: determinista, sin red y sin coste. Sirve para la
 * consola de prueba sin clave, para las pruebas automáticas y como ejemplo de
 * que el asistente no depende de ningún proveedor real.
 *
 * Decide con reglas sencillas sobre el último mensaje (palabras clave en
 * castellano y catalán) y responde SÓLO con lo que le devuelven las
 * herramientas de Mobilink: nunca inventa un precio, una disponibilidad ni un
 * horario. Lo que no sabe, lo escala.
 */

import type { AIProvider, DecisionIA, MensajeIA, PeticionDecision, RespuestaDecision } from "./types.ts";

const CATALAN = /\b(què|vull|voldria|hi ha|trasters?|quant|puc|sóc|estic|bon dia|gràcies|adeu|on sou|parlar|algú|també|aquí|com)\b/i;

export function detectarIdioma(texto: string, previo: string): string {
  if (CATALAN.test(texto)) return "ca";
  if (/[ñ¿¡]|\b(quiero|cuánto|hay|puedo|dónde|gracias|hola|trastero)\b/i.test(texto)) return "es";
  return previo || "es";
}

const T = {
  es: {
    noSe: "No tengo esa información confirmada. Te paso con una persona del equipo para que te ayude.",
    adios: "Gracias por llamar. ¡Hasta pronto!",
    bloqueada: "Esa gestión no se puede hacer por teléfono con el asistente. Te paso con una persona del equipo.",
    incidencia: "He registrado la incidencia con prioridad urgente. Una persona del equipo se pondrá en contacto contigo lo antes posible.",
    visita: "He anotado tu solicitud de visita. El equipo te confirmará la disponibilidad; no queda reservada hasta que te la confirmen.",
    disponibleWeb: "El precio, la disponibilidad definitiva y la contratación están en la web.",
    hay: "Ahora mismo el sistema muestra disponibilidad para:",
    noHay: "Ahora mismo el sistema no muestra disponibilidad para ningún tipo de trastero.",
    centro: "Estamos en",
    error: "Ha habido un problema consultando el sistema. Te paso con una persona del equipo.",
  },
  ca: {
    noSe: "No tinc aquesta informació confirmada. Et passo amb una persona de l'equip perquè t'ajudi.",
    adios: "Gràcies per trucar. Fins aviat!",
    bloqueada: "Aquesta gestió no es pot fer per telèfon amb l'assistent. Et passo amb una persona de l'equip.",
    incidencia: "He registrat la incidència amb prioritat urgent. Una persona de l'equip es posarà en contacte amb tu tan aviat com sigui possible.",
    visita: "He anotat la teva sol·licitud de visita. L'equip et confirmarà la disponibilitat; no queda reservada fins que te la confirmin.",
    disponibleWeb: "El preu, la disponibilitat definitiva i la contractació són a la web.",
    hay: "Ara mateix el sistema mostra disponibilitat per a:",
    noHay: "Ara mateix el sistema no mostra disponibilitat per a cap tipus de traster.",
    centro: "Som a",
    error: "Hi ha hagut un problema consultant el sistema. Et passo amb una persona de l'equip.",
  },
} as const;

const d = (x: Partial<DecisionIA> & Pick<DecisionIA, "accion" | "idioma">): DecisionIA => ({
  respuesta: "",
  herramienta: "",
  parametros_json: "{}",
  motivo_escalado: "",
  resumen: "",
  ...x,
});

function ultimoIdioma(mensajes: MensajeIA[]): string {
  let idioma = "";
  for (const m of mensajes) if (m.rol === "user") idioma = detectarIdioma(m.texto, idioma);
  return idioma || "es";
}

export function decidirSimulado(mensajes: MensajeIA[]): DecisionIA {
  const idioma = ultimoIdioma(mensajes);
  const t = idioma === "ca" ? T.ca : T.es;
  const ultimo = mensajes[mensajes.length - 1];
  const usuario = [...mensajes].reverse().find((m) => m.rol === "user")?.texto ?? "";
  const resumen = `Consulta: ${usuario.slice(0, 160)}`;

  if (ultimo?.rol === "tool") {
    // Resultado de una herramienta tal como lo devuelve el motor (forma libre por herramienta).
    type Res = { items?: { answer?: unknown }[]; types?: { name: string; available: boolean }[]; web?: string; address?: string; city?: string; links?: { web?: string } };
    let r: { herramienta?: string; estado?: string; resultado?: Res; error?: string } = {};
    try {
      r = JSON.parse(ultimo.texto);
    } catch {
      /* resultado ilegible: se escala */
    }
    if (r.estado === "blocked") return d({ accion: "escalar", idioma, respuesta: t.bloqueada, motivo_escalado: `Acción no autorizada: ${r.herramienta}`, resumen });
    if (r.estado !== "success") return d({ accion: "escalar", idioma, respuesta: t.error, motivo_escalado: `Fallo de herramienta: ${r.herramienta}`, resumen });
    switch (r.herramienta) {
      case "obtener_base_conocimiento": {
        const item = r.resultado?.items?.[0];
        if (!item) return d({ accion: "escalar", idioma, respuesta: t.noSe, motivo_escalado: "Consulta fuera de la base de conocimiento", resumen });
        return d({ accion: "responder", idioma, respuesta: String(item.answer), resumen });
      }
      case "consultar_disponibilidad": {
        const tipos = (r.resultado?.types ?? []) as { name: string; available: boolean }[];
        const con = tipos.filter((x) => x.available).map((x) => x.name);
        return d({ accion: "responder", idioma, respuesta: `${con.length ? `${t.hay} ${con.join(", ")}.` : t.noHay} ${t.disponibleWeb}${r.resultado?.web ? ` ${r.resultado.web}` : ""}`, resumen });
      }
      case "consultar_centro":
        return d({ accion: "responder", idioma, respuesta: `${t.centro} ${[r.resultado?.address, r.resultado?.city].filter(Boolean).join(", ")}.${r.resultado?.links?.web ? ` ${r.resultado.links.web}` : ""}`, resumen });
      case "crear_incidencia":
        return d({ accion: "responder", idioma, respuesta: t.incidencia, resumen });
      case "solicitar_visita":
        return d({ accion: "responder", idioma, respuesta: t.visita, resumen });
      default:
        return d({ accion: "responder", idioma, respuesta: t.noSe, resumen });
    }
  }

  const txt = usuario.toLowerCase();
  const herramienta = (nombre: string, parametros: Record<string, unknown> = {}) =>
    d({ accion: "herramienta", idioma, herramienta: nombre, parametros_json: JSON.stringify(parametros), resumen });

  if (/(hablar con (una persona|alguien|un humano)|persona real|operador|parlar amb (una persona|algú))/.test(txt)) {
    return d({ accion: "escalar", idioma, respuesta: t.noSe, motivo_escalado: "Quien llama pide hablar con una persona", resumen });
  }
  if (/(cancela|cancel·la|dar(me)? de baja|donar de baixa|devoluci|retorn)/.test(txt)) return herramienta("cancelar_contrato", {});
  if (/(no puedo (entrar|acceder|abrir)|no puc (entrar|accedir|obrir)|no abre|no obre)/.test(txt)) {
    return herramienta("crear_incidencia", { tipo: "no_access", titulo: idioma === "ca" ? "No pot accedir" : "No puede acceder", descripcion: usuario.slice(0, 500) });
  }
  if (/(visita guiada|visita guiad|visita amb guia)/.test(txt)) return herramienta("solicitar_visita", { tipo: "guiada", notas: usuario.slice(0, 300) });
  if (/(disponib|hay trasteros|hi ha trasters|queda(n)? (algún|alguno|libre)|lliure)/.test(txt)) return herramienta("consultar_disponibilidad", {});
  if (/(dónde est|direcci|on (sou|esteu)|adreça|ubicaci)/.test(txt)) return herramienta("consultar_centro", {});
  if (/^(gracias|adiós|adios|gràcies|adeu)\b/.test(txt.trim())) return d({ accion: "finalizar", idioma, respuesta: t.adios, resumen });
  return herramienta("obtener_base_conocimiento", { consulta: usuario.slice(0, 300) });
}

export class MockAIProvider implements AIProvider {
  readonly nombre = "mock";
  disponible(): boolean {
    return true;
  }
  modelo(): string {
    return "simulado";
  }
  async decidir(p: PeticionDecision): Promise<RespuestaDecision> {
    const inicio = Date.now();
    return { ok: true, decision: decidirSimulado(p.mensajes), modelo: "simulado", tokensEntrada: 0, tokensSalida: 0, duracionMs: Date.now() - inicio };
  }
}
