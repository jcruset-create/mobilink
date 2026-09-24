/**
 * El parte de trabajo del proveedor, traducido a lo nuestro.
 *
 * El taller manda un PDF escaneado —«El Gegant del Pneumàtic», Comercial Sea—
 * con lo que le ha hecho al vehículo: las presiones y profundidades de cada
 * rueda, cuáles ha cambiado, qué gomas ha puesto y qué ha facturado. Hoy eso
 * se teclea a mano en TyreControl, ocho filas por parte, y por eso casi nunca
 * se teclea.
 *
 * Aquí está la parte que DECIDE, sin red ni navegador: qué fila es qué rueda,
 * qué es un cambio y qué es solo una medición, qué goma se ha montado y qué
 * no cuadra. Lo que lee el papel es un modelo de IA y vive en el servidor;
 * lo que lo escribe es `tc_guardar_parte_guiado`, que ya existe. En medio,
 * esto: código puro, con pruebas, y una persona que confirma antes de guardar.
 *
 * ── La regla que manda ──────────────────────────────────────────────────────
 *
 * Ante la duda, NO se escribe. Un número mal atribuido a una rueda no da un
 * error: da un dato creíble y falso que entra en el histórico del neumático y
 * descuadra lo que ha durado. Por eso cada cosa que no encaja sale como aviso
 * —o como error, si impide seguir— y la resuelve quien confirma.
 */

import { baseMedida, medidaCanonica } from "./medidas";

// ── Lo que devuelve el lector del papel ─────────────────────────────────────

/** Una fila del cuadro «EXAMEN DEL VEHÍCULO». */
export interface FilaParteProveedor {
  /** El número de rueda del croquis del proveedor: 1, 2, 3… */
  posicion: number | null;
  presion_bar: number | null;
  /** Profundidad interior y exterior. El papel trae las dos. */
  mm_int: number | null;
  mm_ext: number | null;
  /** «NUEV», «RECAU»… o vacío si solo se midió. */
  operacion: string | null;
  montadas: string | null;
  quitadas: string | null;
}

/** Una línea de «PRODUCTOS Y SERVICIOS». */
export interface ProductoParteProveedor {
  descripcion: string;
  unidades: number | null;
  precio_unitario: number | null;
  precio_total: number | null;
}

/** El parte entero tal como lo lee el modelo. Todo puede venir a null. */
export interface LecturaParteProveedor {
  pt_numero: string | null;
  fecha: string | null;
  matricula: string | null;
  numero_unidad: string | null;
  km: number | null;
  cliente_nombre: string | null;
  cliente_cif: string | null;
  tecnico: string | null;
  filas: FilaParteProveedor[];
  productos: ProductoParteProveedor[];
  confianza: number | null;
  aviso: string | null;
}

// ── Lo que se le propone a quien confirma ───────────────────────────────────

/** Una posición del plano del vehículo, lo justo que hace falta de ella. */
export interface PosicionDelPlano {
  id: string;
  codigo_posicion: string;
  nombre?: string | null;
  eje?: number | null;
  orden_visual: number;
}

export interface MedicionPropuesta {
  /** El número que traía el papel. */
  numero: number;
  posicionId: string;
  codigo: string;
  presionBar: number | null;
  profundidadMm: number | null;
  /** Las dos lecturas, para poder mirarlas al confirmar. */
  mmInt: number | null;
  mmExt: number | null;
}

export interface CambioPropuesto {
  numero: number;
  posicionId: string;
  codigo: string;
  /** Lo que ponía en la columna OP.: «NUEV», «RECAU»… */
  operacion: string;
}

export interface NeumaticoDelParte {
  /** La línea del papel, tal cual. */
  texto: string;
  /** Medida ya en nuestra forma: "295/80R22.5". */
  medida: string;
  unidades: number;
  precioUnitario: number | null;
}

export interface ServicioPropuesto {
  /** Código de `tc_cat_servicios`. */
  codigo: string;
  cantidad: number;
  /** La línea del papel de la que sale, para poder cotejarla. */
  origen: string;
}

export interface PropuestaParte {
  /** Las que se guardan: las de las ruedas que NO se tocaron. */
  mediciones: MedicionPropuesta[];
  /**
   * Las de las ruedas que se cambiaron, que se enseñan pero NO se guardan.
   *
   * En el parte real, las posiciones con «NUEV» traen 14,9 y 15,2 mm: son las
   * de la goma que se acaba de poner, no las de la que se ha tirado. Guardarlas
   * como medición de la posición diría que la goma retirada tenía 15 mm, que es
   * justo lo contrario de lo que pasó, y esa cifra acabaría en el informe de
   * coste por kilómetro del neumático desmontado.
   *
   * La goma nueva ya entra con la profundidad de dibujo de su referencia
   * cuando se monta, así que no se pierde nada.
   */
  medicionesDeGomaNueva: MedicionPropuesta[];
  cambios: CambioPropuesto[];
  servicios: ServicioPropuesto[];
  /** Las líneas de producto que no se han sabido casar con nuestro catálogo. */
  serviciosSinCasar: string[];
  neumatico: NeumaticoDelParte | null;
  /** Cosas que mirar, pero que no impiden guardar. */
  avisos: string[];
  /** Cosas que sí lo impiden. */
  errores: string[];
}

// ── Piezas ──────────────────────────────────────────────────────────────────

/**
 * Las ruedas del papel, numeradas como las numera el papel.
 *
 * El croquis del proveedor cuenta por ejes, de delante a atrás, y dentro de
 * cada eje de izquierda a derecha y de fuera a dentro: en un 2x4x4 son 1,2 el
 * eje directriz; 3,4,5,6 el segundo; 7,8,9,10 el tercero.
 *
 * Que es EXACTAMENTE el `orden_visual` de nuestro plano, porque sale del mismo
 * sitio: `generarPosiciones()` lo numera así. Por eso no hay aquí ninguna
 * tabla de equivalencias escrita a mano, que sería lo primero que se quedaría
 * viejo el día que aparezca un tipo nuevo.
 */
export function posicionesPorNumero(posiciones: PosicionDelPlano[]): Map<number, PosicionDelPlano> {
  const orden = [...posiciones].sort((a, b) => a.orden_visual - b.orden_visual);
  return new Map(orden.map((p, i) => [i + 1, p]));
}

/** ¿Esta fila dice que se cambió la rueda, o solo que se midió? */
export function esCambio(operacion: string | null | undefined): boolean {
  const t = (operacion ?? "").trim().toUpperCase();
  if (!t) return false;
  // «NUEV» es como lo abrevia el parte. Se admiten las formas largas y el
  // recauchutado, que también es una goma que entra.
  return /^(N|NUEV|NUEVA|NUEVAS|NUEVO|NUEVOS|RECAU|RECAUCHUTAD[AO]S?)$/.test(t);
}

/**
 * La profundidad que se guarda cuando el papel trae interior y exterior.
 *
 * La MENOR de las dos. Es la que manda para decidir si la goma está para
 * cambiar: una rueda con 14 mm por fuera y 3 por dentro está gastada, y
 * quedarse con la media —o con la de fuera— la daría por buena.
 */
export function profundidadDeFila(mmInt: number | null, mmExt: number | null): number | null {
  const v = [mmInt, mmExt].filter((x): x is number => typeof x === "number" && x > 0);
  return v.length ? Math.min(...v) : null;
}

/** La medida que se lee en una línea de producto, ya en nuestra forma. */
export function medidaDeTexto(texto: string): string | null {
  // El papel escribe "295/80X22.5"; el catálogo, "295/80R22.5".
  const t = texto.toUpperCase().replace(/(\d)\s*X\s*(\d)/g, "$1R$2");
  const m = t.match(/\d{3}\s*\/\s*\d{2}\s*R\s*\d{2}([.,]\d)?/);
  return m ? medidaCanonica(m[0]) : null;
}

/**
 * Qué goma se ha montado, de entre las líneas facturadas.
 *
 * Se busca la que TIENE medida de neumático y unidades: el papel mezcla la
 * cubierta con los montajes, los equilibrados y las contrapesas. Si hay varias
 * —un parte que cambia gomas de dos medidas—, se devuelve la de más importe y
 * se avisa, porque repartir cuál va en cada rueda no se puede adivinar.
 */
export function neumaticoDelParte(productos: ProductoParteProveedor[]): {
  neumatico: NeumaticoDelParte | null; avisos: string[];
} {
  const avisos: string[] = [];
  const candidatos = productos
    .map((p) => ({ p, medida: medidaDeTexto(p.descripcion ?? "") }))
    .filter((c) => c.medida && (c.p.unidades ?? 0) > 0 && (c.p.precio_total ?? 0) > 0);

  if (candidatos.length === 0) return { neumatico: null, avisos };

  candidatos.sort((a, b) => (b.p.precio_total ?? 0) - (a.p.precio_total ?? 0));
  if (candidatos.length > 1) {
    avisos.push(
      `El parte factura ${candidatos.length} medidas distintas de neumático. Se propone ` +
      `«${candidatos[0].p.descripcion}»; comprueba qué goma va en cada rueda.`);
  }
  const g = candidatos[0];
  return {
    neumatico: {
      texto: g.p.descripcion,
      medida: g.medida as string,
      unidades: g.p.unidades as number,
      precioUnitario: g.p.precio_unitario ?? null,
    },
    avisos,
  };
}

/**
 * El servicio de nuestro catálogo que corresponde a una línea del proveedor.
 *
 * Por palabras y en un solo sitio, porque cada taller la escribe a su manera:
 * «MONTAJE FIJACIÓN(QUIT.PONER)CM» y «QUITAR Y PONER RUEDAS» son lo mismo.
 * Lo que no se reconoce devuelve null y lo coloca una persona: inventar un
 * código de servicio es facturar algo que no se hizo.
 */
export function servicioDeProducto(descripcion: string): string | null {
  const t = (descripcion ?? "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase();

  if (/EQUILIBRA/.test(t)) return "equilibrado";
  if (/QUIT.*PONER|PONER.*QUIT|FIJACION/.test(t)) return "quitar_poner_rueda";
  if (/MONTAJE|MONTA\b|DESMONTA/.test(t)) return "desmontar_montar_cubierta";
  if (/PINCHAZO|REPARACION DE PINCHAZO/.test(t)) return "pinchazo";
  if (/ALINEA|DIRECCION/.test(t)) return /COMPLEJ/.test(t) ? "alineacion_compleja" : "alineacion_standard";
  if (/VALVULA/.test(t)) return "valvulas";
  if (/ALARGADERA/.test(t)) return "alargaderas";
  return null;
}

// ── El traductor ────────────────────────────────────────────────────────────

export interface ContextoParte {
  /** El plano del tipo del vehículo. */
  posiciones: PosicionDelPlano[];
  /** Los kilómetros que ya tenemos, para contrastar los del papel. */
  kmActual?: number | null;
  /** Medida que lleva el vehículo según su ficha, si la tiene. */
  medidaVehiculo?: string | null;
}

/**
 * Traduce el parte leído a lo que se va a guardar, o dice por qué no se puede.
 */
export function interpretarParte(
  lectura: LecturaParteProveedor,
  ctx: ContextoParte,
): PropuestaParte {
  const avisos: string[] = [];
  const errores: string[] = [];

  const porNumero = posicionesPorNumero(ctx.posiciones);
  if (porNumero.size === 0) {
    errores.push("Este vehículo no tiene plano de ruedas: sin él no se sabe a qué rueda va cada fila.");
  }

  const filas = (lectura.filas ?? []).filter((f) => {
    if (f.posicion == null) return false;
    // Una fila vacía del cuadro no es una medición: el papel trae 23 huecos.
    return f.presion_bar != null || f.mm_int != null || f.mm_ext != null || !!f.operacion;
  });

  const mediciones: MedicionPropuesta[] = [];
  const medicionesDeGomaNueva: MedicionPropuesta[] = [];
  const cambios: CambioPropuesto[] = [];
  const fuera: number[] = [];
  const repetidas: number[] = [];
  const vistas = new Set<number>();

  for (const f of filas) {
    const n = f.posicion as number;
    const pos = porNumero.get(n);
    if (!pos) { fuera.push(n); continue; }
    if (vistas.has(n)) { repetidas.push(n); continue; }
    vistas.add(n);

    const profundidad = profundidadDeFila(f.mm_int, f.mm_ext);
    const cambiada = esCambio(f.operacion);
    if (f.presion_bar != null || profundidad != null) {
      const m: MedicionPropuesta = {
        numero: n, posicionId: pos.id, codigo: pos.codigo_posicion,
        presionBar: f.presion_bar, profundidadMm: profundidad,
        mmInt: f.mm_int, mmExt: f.mm_ext,
      };
      // Ver el comentario de `medicionesDeGomaNueva`: la medida de una
      // posición que se acaba de cambiar es de la rueda nueva.
      (cambiada ? medicionesDeGomaNueva : mediciones).push(m);
    }
    if (cambiada) {
      cambios.push({ numero: n, posicionId: pos.id, codigo: pos.codigo_posicion,
                     operacion: (f.operacion ?? "").trim() });
    }
  }

  // El croquis no encaja con el plano. No se reparte «lo que quepa»: una
  // medición en la rueda equivocada es peor que ninguna medición.
  if (fuera.length) {
    errores.push(
      `El parte trae ${fuera.length > 1 ? "las ruedas" : "la rueda"} ${fuera.join(", ")} y este ` +
      `vehículo solo tiene ${porNumero.size} posiciones. O el tipo del vehículo está mal puesto, ` +
      `o este parte no es suyo.`);
  }
  if (repetidas.length) {
    avisos.push(`La rueda ${repetidas.join(", ")} sale más de una vez; se ha tomado la primera.`);
  }

  const { neumatico, avisos: avisosGoma } = neumaticoDelParte(lectura.productos ?? []);
  avisos.push(...avisosGoma);

  if (cambios.length > 0 && !neumatico) {
    avisos.push(
      `El parte cambia ${cambios.length} rueda(s) pero no factura ninguna cubierta: ` +
      `elige a mano qué se ha montado.`);
  }
  if (neumatico && cambios.length > 0 && neumatico.unidades !== cambios.length) {
    avisos.push(
      `Se facturan ${neumatico.unidades} cubiertas y el croquis marca ${cambios.length} ruedas ` +
      `cambiadas. Comprueba cuál de los dos manda.`);
  }
  if (neumatico && ctx.medidaVehiculo &&
      baseMedida(neumatico.medida) !== baseMedida(ctx.medidaVehiculo)) {
    avisos.push(
      `La cubierta facturada (${neumatico.medida}) no es la medida que tiene el vehículo ` +
      `(${ctx.medidaVehiculo}).`);
  }

  // Los kilómetros del papel, contra los que ya teníamos. No se bloquea: un
  // cuentakilómetros cambiado existe, y un parte de hace un mes también.
  if (lectura.km != null && ctx.kmActual != null && ctx.kmActual > 0) {
    if (lectura.km < ctx.kmActual) {
      avisos.push(
        `Los kilómetros del parte (${lectura.km.toLocaleString("es-ES")}) son menores que los ` +
        `que tenemos (${ctx.kmActual.toLocaleString("es-ES")}).`);
    }
  }
  if (lectura.km == null) {
    avisos.push("El parte no trae kilómetros, o no se han podido leer.");
  }
  if (!lectura.pt_numero) {
    errores.push("No se ha leído el número de PT, y es lo que evita que el mismo parte entre dos veces.");
  }
  if (!lectura.matricula) {
    errores.push("No se ha leído la matrícula.");
  }

  // Servicios: se agrupan por código, porque dos líneas del papel pueden caer
  // en el mismo servicio nuestro y en el parte son una cantidad, no dos filas.
  const porCodigo = new Map<string, ServicioPropuesto>();
  const sinCasar: string[] = [];
  for (const p of lectura.productos ?? []) {
    if (medidaDeTexto(p.descripcion ?? "")) continue; // la cubierta no es un servicio
    const codigo = servicioDeProducto(p.descripcion ?? "");
    const cantidad = p.unidades ?? 0;
    if (!codigo) { if ((p.descripcion ?? "").trim()) sinCasar.push(p.descripcion); continue; }
    if (cantidad <= 0) continue;
    const ya = porCodigo.get(codigo);
    if (ya) { ya.cantidad += cantidad; ya.origen += ` · ${p.descripcion}`; }
    else porCodigo.set(codigo, { codigo, cantidad, origen: p.descripcion });
  }

  return {
    mediciones, medicionesDeGomaNueva, cambios, servicios: [...porCodigo.values()],
    serviciosSinCasar: sinCasar, neumatico, avisos, errores,
  };
}

/**
 * El estado con el que se queda la goma que se quita.
 *
 * `tc_montar_desde_catalogo` escribe `p_destino_retirado` TAL CUAL en
 * `tc_neumaticos.estado`, así que no admite el código del catálogo de destinos
 * («carcasa», «reclamacion»): admite un estado. La traducción es la misma que
 * hace `tc_guardar_parte_guiado` cuando la tablet manda un destino, y se
 * escribe aquí una vez para no tener dos criterios distintos de a dónde va una
 * goma según por qué pantalla haya entrado.
 */
export function estadoDeDestino(estadoResultante: string | null | undefined): string {
  const e = (estadoResultante ?? "almacen").trim().toLowerCase();
  if (["almacen", "stock_usado", "stock_nuevo", "stock_recauchutado"].includes(e)) return "almacen";
  if (["descartado", "vendido"].includes(e)) return "descartado";
  // Recauchutado, cuarentena, reparación… no mueven stock y se afinan después.
  return "reparacion";
}

// ── La clave del parte ──────────────────────────────────────────────────────
//
// `tc_guardar_parte_guiado` no duplica nada si se le manda la misma clave, y
// esa es la única defensa contra el error más probable de todos: reimportar el
// mismo PDF dos veces y montar seis gomas donde se montaron tres.
//
// Por eso la clave NO es aleatoria: sale del proveedor y del número de PT, que
// es lo que identifica al papel. El mismo papel da la misma clave en cualquier
// ordenador y dentro de un año.
//
// Es un UUID v5 de manual (RFC 4122): SHA-1 del espacio de nombres más el
// texto. El SHA-1 va aquí escrito porque el navegador solo lo ofrece con una
// API asíncrona y esto tiene que poder llamarse en medio de un render y
// probarse sin montar nada.

function sha1(bytes: number[]): number[] {
  const ml = bytes.length * 8;
  const datos = [...bytes, 0x80];
  while (datos.length % 64 !== 56) datos.push(0);
  for (let i = 7; i >= 0; i--) datos.push((ml / 2 ** (i * 8)) & 0xff);

  let [h0, h1, h2, h3, h4] = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476, 0xc3d2e1f0];
  const rot = (n: number, s: number) => ((n << s) | (n >>> (32 - s))) >>> 0;

  for (let i = 0; i < datos.length; i += 64) {
    const w = new Array<number>(80);
    for (let j = 0; j < 16; j++) {
      w[j] = ((datos[i + j * 4] << 24) | (datos[i + j * 4 + 1] << 16) |
              (datos[i + j * 4 + 2] << 8) | datos[i + j * 4 + 3]) >>> 0;
    }
    for (let j = 16; j < 80; j++) w[j] = rot(w[j - 3] ^ w[j - 8] ^ w[j - 14] ^ w[j - 16], 1);

    let [a, b, c, d, e] = [h0, h1, h2, h3, h4];
    for (let j = 0; j < 80; j++) {
      const [f, k] =
        j < 20 ? [(b & c) | (~b & d), 0x5a827999] :
        j < 40 ? [b ^ c ^ d, 0x6ed9eba1] :
        j < 60 ? [(b & c) | (b & d) | (c & d), 0x8f1bbcdc] :
                 [b ^ c ^ d, 0xca62c1d6];
      const t = (rot(a, 5) + (f >>> 0) + e + k + w[j]) >>> 0;
      e = d; d = c; c = rot(b, 30); b = a; a = t;
    }
    h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0; h4 = (h4 + e) >>> 0;
  }
  const salida: number[] = [];
  for (const h of [h0, h1, h2, h3, h4]) {
    salida.push((h >>> 24) & 0xff, (h >>> 16) & 0xff, (h >>> 8) & 0xff, h & 0xff);
  }
  return salida;
}

/** Espacio de nombres propio, fijo para siempre: cambiarlo duplicaría partes. */
const ESPACIO_PARTES = [
  0x6e, 0x1a, 0x4b, 0x1d, 0x9c, 0x53, 0x4f, 0x2a,
  0x8b, 0x77, 0x0d, 0x3e, 0x51, 0xa4, 0xc6, 0x92,
];

/**
 * La clave del parte: la misma para el mismo papel, siempre.
 *
 * `proveedor` es un código corto y estable («comercial_sea»), no el nombre
 * comercial: dos proveedores pueden numerar sus partes igual, y el nombre se
 * escribe hoy de una manera y mañana de otra.
 */
export function claveDeParte(proveedor: string, ptNumero: string): string {
  const texto = `${proveedor.trim().toLowerCase()}|${ptNumero.trim().toUpperCase()}`;
  const bytes = [...ESPACIO_PARTES, ...Array.from(new TextEncoder().encode(texto))];
  const h = sha1(bytes);
  h[6] = (h[6] & 0x0f) | 0x50; // versión 5
  h[8] = (h[8] & 0x3f) | 0x80; // variante RFC 4122
  const hex = h.slice(0, 16).map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
