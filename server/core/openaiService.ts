import OpenAI from "openai";

/**
 * Capa ÚNICA de IA de Mobilink.
 *
 * Toda la plataforma habla con OpenAI a través de aquí: ni controladores, ni
 * workers, ni scripts crean su propio cliente ni eligen modelo. Así, cambiar
 * de modelo es tocar una variable de entorno y reiniciar — sin desplegar.
 *
 * Usa la Responses API (`/v1/responses`), que es la interfaz vigente y la que
 * admite Structured Outputs con esquema estricto.
 *
 * Verificado contra la API real (30-07-2026) con gpt-5-mini: texto, imágenes
 * por data-URI y json_schema estricto funcionan.
 */

// ── Modelos: SIEMPRE por variable de entorno ─────────────────
// Un solo sitio donde vive el nombre del modelo. gpt-5-mini es el valor por
// defecto por relación calidad/precio; el fallback solo se usa ante errores
// técnicos del proveedor, nunca por una respuesta funcionalmente mala.
export const MODELOS = {
  get porDefecto() { return process.env.OPENAI_DEFAULT_MODEL || "gpt-5-mini"; },
  get documento() { return process.env.OPENAI_DOCUMENT_MODEL || this.porDefecto; },
  get informe()   { return process.env.OPENAI_REPORT_MODEL   || this.porDefecto; },
  get asistente() { return process.env.OPENAI_ASSISTANT_MODEL || this.porDefecto; },
  get respaldo()  { return process.env.OPENAI_FALLBACK_MODEL || ""; },
};

export type Proposito = "porDefecto" | "documento" | "informe" | "asistente";

/** Una imagen para el modelo: URL pública/firmada o data-URI. */
export interface EntradaImagen { url: string; }

export interface PeticionIA {
  /** Instrucciones + contenido. Texto suelto o mensajes con imágenes. */
  prompt: string;
  imagenes?: EntradaImagen[];
  /** Para qué es: decide el modelo sin que el llamante lo escriba. */
  proposito?: Proposito;
  /** Esquema JSON estricto. Si se indica, la respuesta viene validada. */
  esquema?: { nombre: string; schema: Record<string, unknown> };
  maxTokens?: number;
  temperatura?: number;
  /** Identificador de la operación, solo para métricas y logs. */
  operacion: string;
  timeoutMs?: number;
}

export interface RespuestaIA<T = string> {
  ok: boolean;
  texto: string;
  datos?: T;
  modelo: string;
  tokensEntrada?: number;
  tokensSalida?: number;
  duracionMs: number;
  error?: string;
}

const TIMEOUT_POR_DEFECTO = 60_000;
const REINTENTOS = 2;

let cliente: OpenAI | null = null;
function getCliente(): OpenAI {
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY no configurada");
  return (cliente ??= new OpenAI({ apiKey: process.env.OPENAI_API_KEY }));
}

export function hayIA(): boolean {
  return !!process.env.OPENAI_API_KEY;
}

/** Errores del proveedor que justifican reintentar o caer al respaldo. */
function esErrorTecnico(e: any): boolean {
  const status = Number(e?.status ?? e?.response?.status ?? 0);
  return status === 429 || (status >= 500 && status < 600) ||
    e?.code === "ETIMEDOUT" || e?.name === "APIConnectionError" || e?.name === "AbortError";
}

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Llama al modelo. Nunca lanza por un fallo del proveedor: devuelve
 * `ok: false` para que quien llame decida, igual que hacía el código previo.
 */
export async function pedirIA<T = string>(req: PeticionIA): Promise<RespuestaIA<T>> {
  const inicio = Date.now();
  const modelo = MODELOS[req.proposito ?? "porDefecto"];

  if (!hayIA()) {
    return { ok: false, texto: "", modelo, duracionMs: 0, error: "OPENAI_API_KEY no configurada" };
  }

  const cuerpo: Record<string, any> = {
    model: modelo,
    max_output_tokens: req.maxTokens ?? 4000,
    input: req.imagenes?.length
      ? [{
          role: "user",
          content: [
            { type: "input_text", text: req.prompt },
            ...req.imagenes.map((i) => ({ type: "input_image", image_url: i.url })),
          ],
        }]
      : req.prompt,
  };
  if (req.temperatura != null) cuerpo.temperature = req.temperatura;
  if (req.esquema) {
    cuerpo.text = {
      format: { type: "json_schema", name: req.esquema.nombre, strict: true, schema: req.esquema.schema },
    };
  }

  const modelos = [modelo, ...(MODELOS.respaldo && MODELOS.respaldo !== modelo ? [MODELOS.respaldo] : [])];
  let ultimoError = "";

  for (const m of modelos) {
    for (let intento = 0; intento <= REINTENTOS; intento++) {
      try {
        const r: any = await getCliente().responses.create(
          { ...cuerpo, model: m } as any,
          { timeout: req.timeoutMs ?? TIMEOUT_POR_DEFECTO },
        );

        const texto = extraerTexto(r);
        const salida: RespuestaIA<T> = {
          ok: true,
          texto,
          modelo: m,
          tokensEntrada: r?.usage?.input_tokens,
          tokensSalida: r?.usage?.output_tokens,
          duracionMs: Date.now() - inicio,
        };
        if (req.esquema && texto) {
          try { salida.datos = JSON.parse(texto) as T; }
          catch { salida.ok = false; salida.error = "La respuesta no era JSON válido"; }
        }
        registrar(req.operacion, salida);
        return salida;
      } catch (e: any) {
        ultimoError = String(e?.message ?? e);
        // Solo se reintenta (y solo se cae al respaldo) ante fallos técnicos:
        // un error de esquema o de petición no mejora repitiéndolo.
        if (!esErrorTecnico(e)) break;
        if (intento < REINTENTOS) await esperar(500 * Math.pow(2, intento));
      }
    }
  }

  const fallo: RespuestaIA<T> = {
    ok: false, texto: "", modelo, duracionMs: Date.now() - inicio, error: ultimoError,
  };
  registrar(req.operacion, fallo);
  return fallo;
}

/** La Responses API devuelve el texto en output[].content[].text. */
function extraerTexto(r: any): string {
  if (typeof r?.output_text === "string" && r.output_text) return r.output_text;
  const partes: string[] = [];
  for (const o of r?.output ?? []) {
    if (o?.type !== "message") continue;
    for (const c of o?.content ?? []) if (typeof c?.text === "string") partes.push(c.text);
  }
  return partes.join("").trim();
}

/**
 * Métricas de uso. A propósito NO registra el prompt ni la respuesta: por ahí
 * pasan fichas técnicas, matrículas y datos de clientes.
 */
function registrar(operacion: string, r: RespuestaIA<any>) {
  console.log(JSON.stringify({
    service: "mobilink-ai",
    operation: operacion,
    model: r.modelo,
    status: r.ok ? "success" : "error",
    durationMs: r.duracionMs,
    inputTokens: r.tokensEntrada ?? null,
    outputTokens: r.tokensSalida ?? null,
    ...(r.error ? { error: r.error.slice(0, 200) } : {}),
  }));
}
