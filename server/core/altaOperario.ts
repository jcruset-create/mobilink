/**
 * Alta de un operario por enlace.
 *
 * El encargado crea la ficha con el nombre y el móvil, y el operario
 * rellena el resto desde su teléfono. El enlace va por SMS y no por
 * WhatsApp a propósito: escribir primero a alguien por WhatsApp exige una
 * plantilla aprobada por Meta, y el alta no puede esperar a ese trámite.
 * Cuando la plantilla esté, se cambia el canal y nada más.
 *
 * ── Dos decisiones que conviene no reabrir sin pensarlas ───────────────────
 *
 *  · **Del token solo se guarda el sha256.** El valor en claro existe una
 *    vez, dentro del SMS. Quien se lleve una copia de la base no puede
 *    abrir la ficha de nadie, que es justo lo que protege un enlace sin
 *    contraseña: el token ES la credencial.
 *  · **Lo que escribe el operario no toca el estado de la ficha.** Guarda
 *    sus datos y la deja en `recibida`; activarla es de un admin. Sin ese
 *    paso, cualquiera con el enlace podría cambiar el DNI de un empleado
 *    ya dado de alta y nadie se enteraría.
 */

import { createHash, randomBytes } from "crypto";

/** Lo que dura el enlace. Tres días cubren un fin de semana entero. */
export const CADUCIDAD_HORAS = 72;

/** Las cuatro fotos que se piden. Cualquier otra cosa se rechaza. */
export const TIPOS_DOCUMENTO = [
  "dni_anverso",
  "dni_reverso",
  "carnet_anverso",
  "carnet_reverso",
] as const;

export type TipoDocumento = (typeof TIPOS_DOCUMENTO)[number];

export const esTipoDocumento = (v: unknown): v is TipoDocumento =>
  typeof v === "string" && (TIPOS_DOCUMENTO as readonly string[]).includes(v);

/**
 * Campos de `sea_employees` que el operario puede escribir.
 *
 * Lista blanca y no lista negra: lo que no esté aquí no se guarda, aunque
 * llegue en el cuerpo de la petición. Con una lista negra, la columna que
 * se añadiera mañana —`rol`, `activo`, `codigo_operario`— quedaría abierta
 * al primero que probara a mandarla.
 */
export const CAMPOS_TEXTO = [
  "nombre",
  "apellidos",
  "dni_nie",
  "nacionalidad",
  "num_seguridad_social",
  "telefono",
  "email",
  "direccion",
  "codigo_postal",
  "poblacion",
  "provincia",
  "carnet_numero",
  "carnet_clases",
  "cap_numero",
  "emergencia_nombre",
  "emergencia_telefono",
] as const;

export const CAMPOS_FECHA = [
  "fecha_nacimiento",
  "carnet_caducidad",
  "cap_caducidad",
] as const;

/** Las tallas, que viven en `sea_employee_clothing`. */
export const CAMPOS_TALLA = [
  "calzado",
  "pantalon",
  "camisa",
  "camiseta",
  "chaqueta",
  "sudadera",
  "chaleco",
] as const;

/** Los tres consentimientos. Los dos primeros son obligatorios para enviar. */
export const CONSENTIMIENTOS = ["normativa", "whatsapp", "datos"] as const;
export type Consentimiento = (typeof CONSENTIMIENTOS)[number];

export type FichaLimpia = {
  empleado: Record<string, string | null>;
  tallas: Record<string, string | null>;
};

export type Validacion = { ficha: FichaLimpia; errores: string[] };

const MAX_TEXTO = 200;

function texto(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim().slice(0, MAX_TEXTO);
  return t === "" ? null : t;
}

/**
 * Una fecha como la escribe una persona → como la quiere Postgres.
 *
 * Se aceptan los dos órdenes porque el teclado del móvil ofrece los dos: el
 * nativo de Android manda `aaaa-mm-dd` y quien teclea a mano escribe
 * `dd/mm/aaaa`. Lo que no se acepta es media fecha: devolver algo
 * aproximado en la caducidad de un carnet sería peor que no guardar nada.
 */
export function fechaIso(v: unknown): string | null {
  const t = texto(v);
  if (!t) return null;

  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
  if (iso) return fechaValida(+iso[1], +iso[2], +iso[3]) ? `${iso[1]}-${iso[2]}-${iso[3]}` : null;

  const es = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(t);
  if (es) {
    const [d, m, a] = [+es[1], +es[2], +es[3]];
    if (!fechaValida(a, m, d)) return null;
    return `${a}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }
  return null;
}

function fechaValida(anio: number, mes: number, dia: number): boolean {
  if (anio < 1900 || anio > 2100 || mes < 1 || mes > 12 || dia < 1 || dia > 31) return false;
  const d = new Date(Date.UTC(anio, mes - 1, dia));
  return d.getUTCFullYear() === anio && d.getUTCMonth() === mes - 1 && d.getUTCDate() === dia;
}

const LETRAS_DNI = "TRWAGMYFPDXBNJZSQVHLCKE";

/**
 * ¿Es un DNI o un NIE con la letra que le toca?
 *
 * Se comprueba la letra y no solo el formato porque es el único campo que
 * se puede verificar sin mirar nada más, y un dígito bailado en el DNI es
 * lo que luego no cuadra con la Seguridad Social.
 */
export function dniValido(valor: string): boolean {
  const v = valor.toUpperCase().replace(/[\s-]/g, "");
  const m = /^([XYZ]?)(\d{7,8})([A-Z])$/.exec(v);
  if (!m) return false;
  const prefijo = m[1] === "" ? "" : String("XYZ".indexOf(m[1]));
  const numero = Number(prefijo + m[2]);
  if (!Number.isFinite(numero)) return false;
  return LETRAS_DNI[numero % 23] === m[3];
}

/** Un móvil español, en E.164, o `null` si no lo parece. */
export function movilValido(valor: string): string | null {
  const v = valor.replace(/[\s().-]/g, "");
  const m = /^(?:\+34|0034|34)?([67]\d{8})$/.exec(v);
  return m ? `+34${m[1]}` : null;
}

/**
 * Lo que llega del formulario → lo que se puede guardar.
 *
 * Siempre devuelve una ficha utilizable, aunque haya errores: el formulario
 * guarda borradores según se escribe, y una fecha a medias no puede tirar
 * abajo el resto de lo tecleado. `errores` solo impide ENVIAR.
 */
export function validarFicha(cuerpo: unknown, paraEnviar = false): Validacion {
  const c = (cuerpo ?? {}) as Record<string, unknown>;
  const empleado: Record<string, string | null> = {};
  const tallas: Record<string, string | null> = {};
  const errores: string[] = [];

  for (const campo of CAMPOS_TEXTO) {
    if (campo in c) empleado[campo] = texto(c[campo]);
  }
  for (const campo of CAMPOS_FECHA) {
    if (!(campo in c)) continue;
    const bruto = texto(c[campo]);
    const iso = fechaIso(c[campo]);
    if (bruto && !iso) errores.push(`La fecha de ${etiqueta(campo)} no se entiende (dd/mm/aaaa).`);
    empleado[campo] = iso;
  }
  const tallasEntrada = (c.tallas ?? {}) as Record<string, unknown>;
  for (const campo of CAMPOS_TALLA) {
    if (campo in tallasEntrada) tallas[campo] = texto(tallasEntrada[campo]);
  }

  if (empleado.dni_nie && !dniValido(empleado.dni_nie)) {
    errores.push("El DNI o NIE no es correcto: repasa el número y la letra.");
  }
  if (empleado.telefono) {
    const movil = movilValido(empleado.telefono);
    if (!movil) errores.push("El móvil tiene que ser un número español de 9 cifras.");
    else empleado.telefono = movil;
  }
  if (empleado.email && !/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(empleado.email)) {
    errores.push("El email no parece un email.");
  }
  if (empleado.codigo_postal && !/^\d{5}$/.test(empleado.codigo_postal)) {
    errores.push("El código postal son 5 cifras.");
  }

  if (paraEnviar) {
    for (const campo of ["nombre", "apellidos", "dni_nie", "telefono", "direccion", "poblacion"] as const) {
      if (!empleado[campo]) errores.push(`Falta ${etiqueta(campo)}.`);
    }
  }

  return { ficha: { empleado, tallas }, errores };
}

function etiqueta(campo: string): string {
  const e: Record<string, string> = {
    nombre: "el nombre",
    apellidos: "los apellidos",
    dni_nie: "el DNI",
    telefono: "el móvil",
    direccion: "la dirección",
    poblacion: "la población",
    fecha_nacimiento: "nacimiento",
    carnet_caducidad: "caducidad del carnet",
    cap_caducidad: "caducidad del CAP",
  };
  return e[campo] ?? campo;
}

/**
 * ¿Se puede dar por enviada la ficha?
 *
 * Las dos fotos del DNI y los dos consentimientos que no son opcionales.
 * El carnet NO se exige: hay puestos que no conducen, y bloquear el envío
 * por eso dejaría a media oficina sin poder terminar su alta.
 */
export function faltaParaEnviar(p: {
  documentos: readonly string[];
  consentimientos: Partial<Record<Consentimiento, boolean>>;
  firma: boolean;
}): string[] {
  const falta: string[] = [];
  if (!p.documentos.includes("dni_anverso")) falta.push("Falta la foto del DNI por delante.");
  if (!p.documentos.includes("dni_reverso")) falta.push("Falta la foto del DNI por detrás.");
  if (!p.consentimientos.normativa) falta.push("Tienes que aceptar la normativa interna.");
  if (!p.consentimientos.datos) falta.push("Tienes que autorizar el tratamiento de tus datos.");
  if (!p.firma) falta.push("Falta tu firma.");
  return falta;
}

// ── El enlace ──────────────────────────────────────────────────────────────

/** 32 bytes de azar. Lo que viaja en la URL. */
export const nuevoToken = (): string => randomBytes(32).toString("base64url");

/** Lo único que se guarda del token. */
export const hashToken = (token: string): string =>
  createHash("sha256").update(token).digest("hex");

export const caducidadDesde = (ahoraMs: number): Date =>
  new Date(ahoraMs + CADUCIDAD_HORAS * 3600_000);

export const urlDeAlta = (base: string, token: string): string =>
  `${base.replace(/\/+$/, "")}/alta/${token}`;

/**
 * El SMS.
 *
 * Cabe en dos segmentos GSM contando una URL normal, y empieza por el
 * nombre de la empresa porque el número del remitente no dice nada: un
 * enlace de alguien que no se identifica no lo abre nadie, y hace bien.
 */
export function textoSms(p: { empresa: string; nombre: string; url: string }): string {
  return (
    `${p.empresa}: ${p.nombre}, para terminar tu alta rellena tu ficha aqui: ${p.url} ` +
    `Tarda 5 min. Ten a mano el DNI y el carnet. El enlace es solo tuyo y caduca en ${CADUCIDAD_HORAS} h.`
  );
}

export type EstadoInvitacion = "enviado" | "abierto" | "recibida" | "anulada";

/** Por qué no se puede abrir un enlace. `null` = se puede. */
export function motivoCerrado(
  invitacion: { estado: EstadoInvitacion; caduca_at: string | Date } | null,
  ahoraMs = Date.now()
): "no_existe" | "caducada" | "anulada" | "ya_enviada" | null {
  if (!invitacion) return "no_existe";
  if (invitacion.estado === "anulada") return "anulada";
  if (invitacion.estado === "recibida") return "ya_enviada";
  if (new Date(invitacion.caduca_at).getTime() <= ahoraMs) return "caducada";
  return null;
}
