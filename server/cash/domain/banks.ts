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
 * Los LOGOTIPOS no vienen puestos: son marcas registradas de cada banco y no
 * se distribuyen con la aplicación. Se suben una vez en Configuración y desde
 * ahí los reutilizan todas las cuentas de esa entidad.
 */

export type BancoSemilla = {
  /** Cuatro cifras. Clave natural: es lo que trae el IBAN. */
  codigo: string;
  nombre: string;
};

export const BANCOS_SEMILLA: BancoSemilla[] = [
  { codigo: "2100", nombre: "CaixaBank" },
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
  { codigo: "2038", nombre: "Bankia (ahora CaixaBank)" },
  { codigo: "0075", nombre: "Banco Popular (ahora Santander)" },
];
