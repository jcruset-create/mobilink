/**
 * Leer la lista de sensores que Movertis calcula para un vehículo.
 *
 * ── Para qué ────────────────────────────────────────────────────────────────
 *
 * De Movertis no sabemos si un vehículo está en ralentí. Lo que llega del
 * histórico (`showtrips`) son posiciones y nada más: un autobús parado con el
 * motor en marcha y uno aparcado son EL MISMO DATO, la misma posición
 * repetida. Y `lastPosition` no trae contacto.
 *
 * Pero `showvehicles` acepta la bandera `sensors`, y según el propio conector
 * son unos 32 sensores por vehículo que nadie ha listado nunca. Son contadores
 * que calcula el dispositivo (del único que conocemos sabemos que es el
 * odómetro con decimales). Si entre ellos hay HORAS DE MOTOR, el ralentí sale
 * sin inventar nada:
 *
 *     ralentí del día = horas de motor − tiempo en movimiento
 *
 * y el tiempo en movimiento ya lo tenemos de las posiciones. Si solo hay
 * contacto, se puede muestrear, que es peor: aproximado y solo de hoy en
 * adelante. Y si no hay ninguno de los dos, es un no definitivo y lo que toca
 * es preguntarle al proveedor.
 *
 * Este módulo es la parte que se puede probar sola: nombrar, clasificar y
 * dictaminar. Pedirlo a la API es cosa del conector, y servirlo del router.
 *
 * ── Por qué aguanta tres formas distintas ───────────────────────────────────
 *
 * NO sabemos qué forma tiene `sensors`. El conector lo documenta como un
 * objeto y ahí se acaba lo que hay comprobado. Podría ser `{nombre: valor}`,
 * `{nombre: {value, unit}}` o una lista de `{name, value}`: las tres son
 * habituales en las API de localizadores. Un diagnóstico que solo entienda la
 * que yo haya supuesto no diagnostica nada —contestaría «ningún sensor» con la
 * respuesta buena delante—, así que entiende las tres y, si no reconoce la
 * forma, lo dice en vez de callar.
 */

/**
 * El centinela del dispositivo para «no hay lectura». Igual que en `mapeo.ts`.
 *
 * El CERO no está aquí, y la primera versión de este fichero se equivocó
 * copiándolo de `mapeo.ts` sin mirar para qué servía allí. Allí es la regla
 * del ODÓMETRO: «un cero de odómetro total no existe en una flota que rueda».
 * Para un contador acumulado es verdad; para el contacto, las revoluciones o
 * la velocidad, CERO ES UN DATO —motor parado, vehículo quieto— y tratarlo de
 * ausencia es perder justo lo que se venía a buscar. Lo decide `ceroEsNada()`.
 */
export const CENTINELA = -348201.3876;

/** Lo que haría falta para sacar el ralentí, de mejor a peor. */
export type Interes = "ralenti" | "horas_motor" | "revoluciones" | "contacto";

export interface SensorLeido {
  nombre: string;
  /** El valor tal cual vino, ya aplanado a algo que se pueda enseñar. */
  valor: string | number | boolean | null;
  /** Unidad, si el proveedor la da junto al valor. */
  unidad: string | null;
  /** `false` para los centinelas de «sin lectura» y para los vacíos. */
  conLectura: boolean;
  /** Por qué este sensor nos interesa, si nos interesa. */
  interes: Interes | null;
}

/** Sin tildes y en minúsculas, para poder buscar por nombre sin sorpresas. */
export function normalizar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

/**
 * Para qué sirve un sensor, mirando su nombre.
 *
 * El orden importa: «engine_hours» lleva dentro «engine», así que si se
 * preguntara antes por el contacto, las horas de motor se clasificarían como
 * contacto y el veredicto sería peor de lo que es.
 */
export function interesDe(nombre: string): Interes | null {
  const n = normalizar(nombre);
  if (/ralent|idle/.test(n)) return "ralenti";
  // Un contador de horas en un localizador son las horas de motor: no hay otra
  // cosa que contar en horas. La primera versión exigía que el nombre dijera
  // además «motor» o «engine», y con eso se le escapó HORASTOTALES, que es
  // exactamente lo que devuelve la cuenta real. Pedir que el proveedor nombre
  // las cosas como yo esperaba es la forma de no encontrar nunca nada.
  if (/hora|hour/.test(n) && !/horario/.test(n)) return "horas_motor";
  // «tiempo» y «time» sí necesitan compañía: solos valen para cualquier cosa.
  if (/time|tiempo/.test(n) && /motor|engine|marcha|operat|contacto|ignition/.test(n)) {
    return "horas_motor";
  }
  // Las revoluciones son mejor señal que el contacto: con la llave dada y el
  // motor parado, el contacto dice 1 y las revoluciones dicen 0. Lo que gasta
  // gasóleo es el motor girando.
  if (/\brpm\b|rpm|revolucion/.test(n)) return "revoluciones";
  if (/ignition|contacto|\bcontact|\bacc\b|engine_?(on|state|status)|motor_?(on|estado|encendid)/.test(n)) {
    return "contacto";
  }
  return null;
}

/**
 * ¿Un cero en este sensor significa «no hay lectura»?
 *
 * Solo en los CONTADORES ACUMULADOS: odómetro, totales, litros consumidos.
 * Ahí un cero es imposible en un vehículo que rueda, y es la regla que ya
 * usaba `mapeo.ts` para no borrar la vida de unos neumáticos con un 0.
 *
 * En todo lo demás, el cero es la lectura: velocidad 0 es «parado», RPM 0 es
 * «motor apagado» y contacto 0 es «llave quitada». Son tres datos, no tres
 * ausencias.
 */
export function ceroEsNada(nombre: string): boolean {
  const n = normalizar(nombre);
  return /odo|kilometr|\bkm\b|total|consumid|acumulad/.test(n);
}

/** Un valor de sensor aplanado: escalar directo, o el `value` de un objeto. */
function valorYUnidad(bruto: unknown): { valor: SensorLeido["valor"]; unidad: string | null } {
  if (bruto === null || bruto === undefined) return { valor: null, unidad: null };
  if (typeof bruto === "number" || typeof bruto === "string" || typeof bruto === "boolean") {
    return { valor: bruto, unidad: null };
  }
  if (typeof bruto === "object") {
    const o = bruto as Record<string, unknown>;
    const v = o.value ?? o.valor ?? o.val ?? o.reading ?? o.lectura;
    const u = o.unit ?? o.unidad ?? o.units ?? o.magnitude;
    const anidado = valorYUnidad(v === undefined ? null : v);
    return { valor: anidado.valor, unidad: typeof u === "string" ? u : anidado.unidad };
  }
  return { valor: null, unidad: null };
}

/**
 * ¿El valor es una lectura de verdad, o uno de los «sin dato» de Movertis?
 *
 * El nombre hace falta para decidir qué significa un cero: ver `ceroEsNada()`.
 */
export function tieneLectura(valor: SensorLeido["valor"], nombre = ""): boolean {
  if (valor === null) return false;
  if (typeof valor === "boolean") return true;
  if (typeof valor === "string") return valor.trim() !== "";
  if (valor === CENTINELA) return false;
  return valor !== 0 || !ceroEsNada(nombre);
}

/** El nombre de un sensor dentro de una entrada en forma de objeto. */
function nombreDe(o: Record<string, unknown>, porDefecto: string): string {
  for (const k of ["name", "nombre", "label", "etiqueta", "key", "clave", "id", "type", "tipo"]) {
    const v = o[k];
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "number") return String(v);
  }
  return porDefecto;
}

/**
 * Los sensores de una fila de `showvehicles`, en una lista plana.
 *
 * Primero los que nos interesan y con lectura, que es lo que se va a mirar;
 * detrás el resto por nombre. Si `sensors` no viene o no se reconoce la forma,
 * la lista sale vacía y `veredicto()` lo dirá: callar aquí sería hacer pasar
 * «no sé leerlo» por «no hay».
 */
export function sensoresDe(fila: unknown): SensorLeido[] {
  const s = (fila as Record<string, unknown> | null | undefined)?.sensors;
  if (!s || typeof s !== "object") return [];

  const crudos: Array<{ nombre: string; bruto: unknown }> = Array.isArray(s)
    ? s.map((x, i) =>
        x && typeof x === "object" && !Array.isArray(x)
          ? { nombre: nombreDe(x as Record<string, unknown>, `sensor_${i + 1}`), bruto: x }
          : { nombre: `sensor_${i + 1}`, bruto: x })
    : Object.entries(s as Record<string, unknown>).map(([nombre, bruto]) => ({ nombre, bruto }));

  const lista = crudos.map(({ nombre, bruto }) => {
    const { valor, unidad } = valorYUnidad(bruto);
    return { nombre, valor, unidad, conLectura: tieneLectura(valor, nombre), interes: interesDe(nombre) };
  });

  const peso = (x: SensorLeido) => (x.interes ? (x.conLectura ? 0 : 1) : 2);
  return lista.sort((a, b) => peso(a) - peso(b) || a.nombre.localeCompare(b.nombre, "es"));
}

export type Nivel =
  | "ralenti_directo" | "horas_motor" | "revoluciones" | "solo_contacto" | "nada" | "sin_sensores";

export interface Veredicto {
  nivel: Nivel;
  /** Una frase para la pantalla, sin tecnicismos. */
  texto: string;
  /** Los sensores en los que se apoya el veredicto. */
  apoyo: string[];
}

/**
 * Qué se puede hacer con lo que ha contestado el dispositivo.
 *
 * Solo cuentan los sensores CON LECTURA. Uno que existe y siempre viene vacío
 * no sirve para calcular nada, y prometerlo sería la forma de montar la
 * pantalla encima de una columna de nulos.
 */
export function veredicto(sensores: SensorLeido[]): Veredicto {
  if (!sensores.length) {
    return {
      nivel: "sin_sensores",
      texto: "Movertis no ha devuelto sensores para este vehículo, o vienen en una forma que este diagnóstico no reconoce. Está abajo la respuesta en crudo para mirarla a mano.",
      apoyo: [],
    };
  }
  const utiles = sensores.filter((s) => s.interes && s.conLectura);
  const nombres = (i: Interes) => utiles.filter((s) => s.interes === i).map((s) => s.nombre);

  if (nombres("ralenti").length) {
    return {
      nivel: "ralenti_directo",
      texto: "El dispositivo ya cuenta el ralentí él mismo. Se puede leer tal cual, sin calcular nada.",
      apoyo: nombres("ralenti"),
    };
  }
  if (nombres("horas_motor").length) {
    return {
      nivel: "horas_motor",
      texto: "Hay horas de motor. El ralentí sale restándole el tiempo en movimiento, que ya tenemos de las posiciones. Ojo: el contador es de AHORA, no un histórico, así que hay que ir guardando una lectura al día —como ya se hace con el odómetro— y el ralentí empieza a contar desde que se monte, no del mes pasado.",
      apoyo: [...nombres("horas_motor"), ...nombres("revoluciones")],
    };
  }
  if (nombres("revoluciones").length) {
    return {
      nivel: "revoluciones",
      texto: "Hay revoluciones del motor, que dicen si está girando mejor que el contacto (con la llave dada y el motor parado, el contacto miente). No hay contador de horas, así que hay que mirarlo cada pocos minutos: sale aproximado y de hoy en adelante.",
      apoyo: nombres("revoluciones"),
    };
  }
  if (nombres("contacto").length) {
    return {
      nivel: "solo_contacto",
      texto: "Hay contacto, pero no un contador de horas ni revoluciones. Solo se puede ir mirando cada pocos minutos: sale aproximado, solo de hoy en adelante, y cuenta como ralentí la llave dada con el motor parado.",
      apoyo: nombres("contacto"),
    };
  }
  const prometidos = sensores.filter((s) => s.interes && !s.conLectura).map((s) => s.nombre);
  return {
    nivel: "nada",
    texto: prometidos.length
      ? `Los sensores que servirían existen (${prometidos.join(", ")}) pero vienen sin lectura en este vehículo. Conviene probar con otro antes de darlo por perdido.`
      : "Ninguno de los sensores sirve para saber si el motor está en marcha. Con esto, de Movertis no se puede sacar el ralentí: hay que preguntárselo al proveedor.",
    apoyo: prometidos,
  };
}

/**
 * El texto para pegarle al proveedor, con la petición exacta y lo que contestó.
 *
 * Es lo mismo que hace «Copiar para Movertis» en la prueba de kilómetros: si
 * hay que escribirles, que sea con los datos delante y no de memoria.
 */
export function textoParaMovertis(d: {
  matricula: string | null;
  unidad: string;
  peticion: unknown;
  sensores: SensorLeido[];
  veredicto: Veredicto;
  crudo: string;
}): string {
  return [
    `Sensores de ${d.matricula ?? "vehículo"} (unidad ${d.unidad}) — POST /vehicle/showvehicles`,
    `petición: ${JSON.stringify(d.peticion)}`,
    "",
    `sensores devueltos: ${d.sensores.length}`,
    ...d.sensores.map((s) =>
      `· ${s.nombre} = ${s.valor ?? "null"}${s.unidad ? ` ${s.unidad}` : ""}` +
      `${s.conLectura ? "" : "  (sin lectura)"}${s.interes ? `  [${s.interes}]` : ""}`),
    "",
    `Conclusión: ${d.veredicto.texto}`,
    "",
    "Respuesta en crudo:",
    d.crudo,
  ].join("\n");
}
