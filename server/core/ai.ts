/**
 * Extracción de datos estructurados con IA (texto + imágenes), compartida por
 * Mobilink Assist y Central Pro.
 *
 * Un único sitio donde vive el modelo, el saneado de la respuesta y el manejo
 * de errores: los llamantes solo aportan el prompt de sistema y el material.
 */

import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export type AiContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string; detail: "auto" } };

export function hasAi(): boolean {
  return !!process.env.OPENAI_API_KEY;
}

/**
 * Pide al modelo un JSON con los campos indicados en `system`.
 * Devuelve `{}` si no hay clave, si el modelo falla o si no responde JSON:
 * la extracción por IA nunca debe tumbar la operación que la usa.
 */
export async function extractJson(opts: {
  system: string;
  text?: string;
  /** URLs http(s) o data: URLs de imágenes a analizar. */
  images?: string[];
  maxTokens?: number;
  model?: string;
}): Promise<Record<string, any>> {
  if (!hasAi()) return {};
  const images = (opts.images ?? []).filter((u) => typeof u === "string" && u.length > 0);
  const text = (opts.text ?? "").trim();
  if (!text && images.length === 0) return {};

  const userContent: AiContentPart[] = [
    { type: "text", text: text || "(sin texto: analiza las imágenes)" },
    ...images.map((url) => ({ type: "image_url" as const, image_url: { url, detail: "auto" as const } })),
  ];

  try {
    const response = await openai.chat.completions.create({
      model: opts.model ?? "gpt-4o",
      messages: [
        { role: "system", content: opts.system },
        { role: "user", content: userContent as any },
      ],
      temperature: 0.1,
      max_tokens: opts.maxTokens ?? 800,
    });
    const raw = response.choices[0]?.message?.content ?? "{}";
    const cleaned = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    const parsed = JSON.parse(cleaned);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (err: any) {
    console.error("[IA] extractJson:", err?.message);
    return {};
  }
}

/**
 * Bloque de instrucciones común: qué mirar en una imagen de una incidencia.
 *
 * Estaba implícito y por eso una foto con los datos del conductor se
 * archivaba sin leerse. Ahora se dice de forma explícita: hay que transcribir
 * TODO el texto legible, no solo matrículas y coordenadas.
 */
export const AI_IMAGE_RULES = `LECTURA DE IMÁGENES (obligatorio):
- Transcribe y aprovecha TODO el texto legible de cada imagen, venga de donde venga: fotos de documentos, DNI, permisos de circulación, albaranes, tarjetas de visita, hojas de ruta, pantallazos de WhatsApp, notas escritas a mano, rótulos de empresa o placas del vehículo.
- Datos de personas: nombre y apellidos del conductor, teléfonos, correo, empresa a la que pertenece, número de empleado.
- Datos del vehículo: matrículas, marca, modelo, bastidor/VIN, kilómetros, medida de neumático.
- Datos administrativos: nº de expediente, nº de póliza o seguro, nº de albarán o pedido, compañía o aseguradora.
- Ubicación: direcciones, calles, municipios, puntos kilométricos y coordenadas (decimales o DMS; convierte DMS a decimal: grados + minutos/60 + segundos/3600, N/E positivo, S/O negativo).
- Un teléfono escrito en una foto vale igual que uno escrito en un mensaje: extráelo.
- No inventes: si un dato no se lee con seguridad, déjalo a null y baja la confianza.

MATRÍCULAS (España):
- Matrícula BLANCA = camión o vehículo tractor.
- Matrícula ROJA = REMOLQUE, con formato R + 4 dígitos + 3 letras (p. ej. R0000BBB). Nunca la pongas como matrícula del vehículo.`;

/**
 * Prompt del back office de asistencia (contactos, empresas, operativa,
 * vehículo y facturación). Lo comparten el back office de Mobilink Assist y
 * el de Assist Central Pro: los dos rellenan los mismos campos, así que la
 * extracción tiene que entender exactamente lo mismo.
 */
export const AI_BACKOFFICE_PROMPT = `Eres un asistente de back office de asistencia en carretera. A partir del texto y las imágenes (capturas de WhatsApp, tarjetas, hojas de datos) extrae los datos para dar de alta una asistencia. NO inventes: si un dato no aparece, omítelo (no lo incluyas en el JSON). Normaliza teléfonos españoles (9 dígitos) y matrículas españolas sin espacios.

${AI_IMAGE_RULES}

Devuelve SOLO un objeto JSON con las claves que conozcas, de este conjunto exacto:
- Contactos: solicitanteNombre, solicitanteTelefono, solicitanteWhatsapp, solicitanteEmail, conductorNombre, conductorTelefono, responsableNombre, responsableTelefono, responsableCargo, autorizadorNombre, autorizadorTelefono, autorizadorCargo
- Empresas: empresaSolicitanteNombre, empresaSolicitanteTelefono, empresaSolicitanteEmail, empresaServicioNombre, empresaServicioCif, empresaServicioTelefono, empresaFacturacionNombre, empresaFacturacionCif, empresaFacturacionEmail, expedienteExterno, referenciaCliente, referenciaAutorizacion
- Operativa: tiposAsistencia (array de: Neumáticos, Mecánica, Batería, Arranque, Combustible, Apertura vehículo, Remolcado, Accidente, Rescate, Otros), tipoVehiculo (Turismo, Furgoneta, Camión rígido, Tractora, Remolque, Semirremolque, Autobús, Motocicleta, Maquinaria, Vehículo agrícola), estadoVehiculo (Puede circular, No puede circular, Bloqueado, Accidentado, Volcado), ubicacionIncidencia (Autopista, Autovía, Carretera nacional, Ciudad, Polígono, Taller, Parking, Puerto, Centro logístico)
- Vehículo: plate (matrícula del vehículo/camión), plateRemolque (matrícula roja del remolque: R+4 dígitos+3 letras), marca, modelo, color, vin, kilometraje (número), medidaNeumatico, ejeAfectado (Dirección, Tracción, Remolque), posicionRueda (Interior, Exterior), vehiculoCargado (true/false), mercancia, adr (true/false)
- Averia: descripcionAveria (texto libre de la avería o trabajos)
- Facturación: importeAcordado (número), observacionesFacturacion
Usa exactamente esas claves. tiposAsistencia siempre como array. Sin texto fuera del JSON.`;
