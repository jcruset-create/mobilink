/**
 * Maestro de bancos: la semilla con la que se crea el catálogo por empresa.
 *
 * El código de entidad son las cuatro primeras cifras del BBAN de un IBAN
 * español y es lo que permite reconocer el banco al teclear la cuenta, sin que
 * nadie tenga que elegirlo de una lista ni pueda equivocarse al hacerlo.
 *
 * La lista es un PUNTO DE PARTIDA, no un dogma: se edita en Configuración, se
 * añaden los que falten y se cambian los nombres. Por eso la semilla solo
 * rellena lo que no existe y nunca pisa lo que haya tocado el usuario.
 *
 * Los LOGOTIPOS que la aplicación trae hechos viven en `public/bancos/`, en
 * versión para fondo oscuro —la cabecera del resguardo es azul marino— y con
 * transparencia, para que no salga el recuadro blanco de la imagen. Se usan
 * solo para identificar al banco al que fue el dinero.
 *
 * No están todos: el que falte se sube en Configuración y desde ahí lo
 * reutilizan todas las cuentas de esa entidad. Un logotipo subido MANDA sobre
 * el de la semilla, y al quitarlo vuelve a salir el de la semilla, así que
 * nada se pierde por probar.
 */

export type BancoSemilla = {
  /** Cuatro cifras. Clave natural: es lo que trae el IBAN. */
  codigo: string;
  nombre: string;
  /** Logotipo que trae la aplicación, servido desde `public/`. */
  logo?: string;
};

/** El logotipo de CaixaBank cubre también los IBAN que quedan de Bankia. */
const CAIXABANK = "/bancos/2100-caixabank.png";

export const BANCOS_SEMILLA: BancoSemilla[] = [
  { codigo: "2100", nombre: "CaixaBank", logo: CAIXABANK },
  { codigo: "0049", nombre: "Banco Santander" },
  { codigo: "0182", nombre: "BBVA" },
  { codigo: "0081", nombre: "Banco Sabadell" },
  { codigo: "0128", nombre: "Bankinter" },
  { codigo: "2080", nombre: "Abanca" },
  { codigo: "2085", nombre: "Ibercaja" },
  { codigo: "2095", nombre: "Kutxabank" },
  { codigo: "2103", nombre: "Unicaja Banco" },
  { codigo: "3058", nombre: "Cajamar" },
  { codigo: "1465", nombre: "ING" },
  { codigo: "0073", nombre: "Openbank" },
  { codigo: "0061", nombre: "Banca March" },
  { codigo: "1491", nombre: "Triodos Bank" },
  { codigo: "0186", nombre: "Banco Mediolanum" },
  { codigo: "3159", nombre: "Caja de Ingenieros" },
  { codigo: "0234", nombre: "Banco Caminos" },
  { codigo: "0198", nombre: "Banco Cooperativo Español" },
  { codigo: "0238", nombre: "Banco Pastor" },
  /*
   * Absorbidos, pero sus IBAN siguen circulando: una cuenta abierta en su día
   * conserva el código de entidad antiguo, así que sin ellos el reconocimiento
   * fallaría justo en las cuentas más viejas.
   */
  { codigo: "2038", nombre: "Bankia (ahora CaixaBank)", logo: CAIXABANK },
  { codigo: "0075", nombre: "Banco Popular (ahora Santander)" },
];

/** Índice por código, para resolver el logotipo sin recorrer la lista. */
const POR_CODIGO = new Map(BANCOS_SEMILLA.map((b) => [b.codigo, b]));

/**
 * El logotipo que trae la aplicación para esa entidad, si lo trae.
 *
 * Se resuelve al LEER, no se guarda en la base de datos: así el día que se
 * cambie o se añada uno lo tienen todas las empresas sin migrar nada, y quitar
 * un logotipo subido a mano hace que vuelva a salir este en lugar de dejar el
 * resguardo sin nada.
 */
export function logoDeSemilla(codigo: string | null | undefined): string | null {
  if (!codigo) return null;
  return POR_CODIGO.get(codigo)?.logo ?? null;
}
