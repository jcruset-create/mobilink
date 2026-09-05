/**
 * Casos de uso de Mobilink Cash.
 *
 * Aquí es donde se cumple la promesa del módulo: **una operación de caja y sus
 * movimientos de piezas se guardan juntos o no se guarda nada**. Todo lo que
 * mueve efectivo sigue la misma secuencia:
 *
 *     BEGIN
 *       bloquear la jornada        ← serializa esta caja
 *       leer el stock teórico      ← ya nadie lo puede cambiar
 *       validar con el motor       ← la palabra definitiva sobre disponibilidad
 *       insertar operación
 *       insertar formas de pago
 *       insertar movimientos de denominaciones
 *       insertar evento de outbox  ← misma transacción, por eso no se pierde
 *     COMMIT
 *
 * La validación del navegador es comodidad; la que cuenta es ésta, con la fila
 * bloqueada. Dos terminales que intenten gastar el último billete de 50 € no
 * pueden colarse los dos: el segundo espera al COMMIT del primero, vuelve a
 * leer el stock y falla con STOCK_INSUFICIENTE.
 *
 * El origen de la operación (MANUAL o ERP) no cambia NADA de este flujo. Es el
 * mismo motor: lo único que aporta la ERP es de dónde salen el importe y el
 * nombre del cliente, y que al final haya algo que comunicar.
 */

import type { PoolClient } from "pg";
import pool from "../db.ts";
import { registrarAuditoria, registrarAuditoriaEnTransaccion } from "../core/auditoria.ts";
import type { Centimos } from "./domain/money.ts";
import { formatearEuros } from "./domain/money.ts";
import {
  type Inventario,
  type LineaDenominacion,
  inventarioDesdeLineas,
  lineasDesdeInventario,
  totalInventario,
  totalPiezas,
} from "./domain/inventory.ts";
import {
  type FormaPago,
  type OperacionNormalizada,
  type OrigenOperacion,
  type LineaMovimiento,
  type TipoOperacion,
  CODIGOS_EFECTIVO_POR_DEFECTO,
  importeEnEfectivo,
  validarOperacion,
  type MotivoMovimiento,
} from "./domain/operations.ts";
import { calcularCambio, validarCambioManual, type ResultadoCambio } from "./domain/change.ts";
import {
  aperturasNecesarias,
  calcularCambioConCartuchos,
  type AperturaCartucho,
} from "./domain/cartridges.ts";
import type { Denominacion } from "./domain/denominations.ts";
import { esFallo } from "./domain/result.ts";
import { compararArqueo, proponerCambioFinal, repartirCierre, type ResultadoArqueo } from "./domain/arqueo.ts";
import {
  ErrorCaja,
  type Sesion,
  bloquearSesion,
  bloquearSesionOperable,
  cargarDenominaciones,
  cargarFormasPago,
  codigosEfectivoDe,
  enTransaccion,
  formasPagoDeOperacion,
  insertarFormasPago,
  piezasPorCartuchoDe,
  piezasPorBolsaDe,
  stockPorFormato,
  stockPorFormatoBruto,
  insertarMovimientos,
  insertarOperacion,
  movimientosDeOperacion,
  obtenerOperacion,
  obtenerSesion,
  operacionesDeSesion,
  sesionAbierta,
  siguienteNumero,
  stockTeorico,
  ultimaSesionCerrada,
  type IncidenciaFormato,
} from "./repository.ts";
import { conectorPara } from "./erp/registry.ts";
import { exigirAmbitoCaja, exigirJornadaPropia } from "./hierarchy.ts";
import { autorDeOperacion, exigirOtraPersona } from "./sod.ts";
import { centroDeCaja, emitirEvento } from "./events/emitter.ts";

export type Contexto = {
  empresaId: string;
  userId: string | null;
  ip?: string;
  /**
   * Taller al que está limitado el usuario. `null` o ausente = toda la empresa,
   * que es como funcionó el módulo hasta la fase 1 de MC Central.
   */
  centroId?: string | null;
};


// ── Apertura de jornada ────────────────────────────────────────────────────

export type EntradaApertura = {
  registerId: number;
  /**
   * Composición del fondo inicial cuando NO se hereda (primera jornada de la
   * caja, o corrección manual). Si se omite y hay cierre anterior, se hereda.
   */
  fondoManual?: LineaDenominacion[];
  /** Tubos precintados del fondo inicial: `cantidad` son tubos, no monedas. */
  fondoCartuchos?: LineaDenominacion[];
  /** Bolsas precintadas del fondo inicial: `cantidad` son bolsas, no monedas. */
  fondoBolsas?: LineaDenominacion[];
  motivoFondoManual?: string;
  /**
   * Fecha contable de la jornada, `YYYY-MM-DD`. Si se omite, hoy.
   *
   * Se puede fechar en un día pasado a propósito: al arrancar el módulo hay
   * que meter los días que se llevaron a mano, y la fecha del cobro tiene que
   * ser la del día en que se cobró, no la del día en que se teclea. Cuándo se
   * tecleó queda igualmente en `created_at_ms` de cada operación.
   */
  fecha?: string;
  /** Abrir una segunda jornada para una fecha que ya tiene otra. */
  permitirFechaRepetida?: boolean;
  notas?: string;
};

/**
 * Valida la fecha contable de una apertura.
 *
 * Al futuro no se abre caja: si sale una fecha de mañana es un dedo, no una
 * intención, y una jornada fechada por delante rompe la herencia del fondo
 * (`ultimaSesionCerrada` ordena por fecha) hasta que alguien la encuentre.
 */
function fechaDeJornada(fecha: string | undefined, ahora: number): string {
  const hoy = new Date(ahora).toISOString().slice(0, 10);
  if (fecha === undefined) return hoy;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
    throw new ErrorCaja("FECHA_NO_VALIDA", "La fecha de la jornada tiene que ser AAAA-MM-DD.", 400);
  }
  // `2026-02-31` pasa el patrón pero no es un día: se comprueba de verdad.
  const d = new Date(`${fecha}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== fecha) {
    throw new ErrorCaja("FECHA_NO_VALIDA", `La fecha ${fecha} no existe.`, 400);
  }
  if (fecha > hoy) {
    throw new ErrorCaja(
      "FECHA_EN_FUTURO",
      `No se puede abrir una jornada con fecha ${fecha}: es posterior a hoy.`,
      400
    );
  }
  return fecha;
}

/**
 * Abre una jornada.
 *
 * Lo importante: el fondo inicial no es un importe, es una COMPOSICIÓN. Se
 * recupera la del cambio final de la última jornada cerrada, pieza a pieza.
 * Copiar solo los 300 € y no saber que eran 2 de 50 + 5 de 20 + … dejaría la
 * caja del día siguiente sin poder dar cambio y sin forma de detectarlo.
 */
/**
 * Convierte líneas de envases precintados a líneas de piezas.
 *
 * `cantidad` entra como envases y sale como monedas, con el contador del
 * envase al lado. Es la traducción que hace que el libro mayor no tenga casos
 * especiales: ahí dentro `cantidad` son SIEMPRE piezas.
 */
function aPiezas(
  lineas: readonly LineaDenominacion[],
  porEnvase: ReadonlyMap<Centimos, number>,
  campo: "cartuchos" | "bolsas"
): LineaMovimiento[] {
  return lineas.map((c) => {
    const n = porEnvase.get(c.valor) ?? 0;
    if (n <= 0) {
      throw new ErrorCaja(
        campo === "cartuchos" ? "CARTUCHO_NO_CONFIGURADO" : "BOLSA_NO_CONFIGURADA",
        `La denominación de ${c.valor} céntimos no tiene ${campo} configurados.`,
        400
      );
    }
    return { valor: c.valor, cantidad: c.cantidad * n, [campo]: c.cantidad };
  });
}

export async function abrirJornada(ctx: Contexto, e: EntradaApertura): Promise<{ sesion: Sesion; stock: LineaDenominacion[] }> {
  const resultado = await enTransaccion(async (client) => {
    const abierta = await sesionAbierta(e.registerId, client);
    if (abierta) {
      throw new ErrorCaja(
        "JORNADA_YA_ABIERTA",
        `La caja ya tiene la jornada ${abierta.id} abierta. Ciérrala antes de abrir otra.`,
        409
      );
    }

    const { rows: cajas } = await client.query(
      `SELECT id FROM cash_registers WHERE id = $1 AND empresa_id = $2 AND activa = true`,
      [e.registerId, ctx.empresaId]
    );
    if (cajas.length === 0) {
      throw new ErrorCaja("CAJA_NO_ENCONTRADA", "La caja no existe o no está activa.", 404);
    }

    // La apertura es la puerta de entrada: quien no puede abrir la caja de otro
    // taller tampoco llega a tener una jornada suya que operar después.
    await exigirAmbitoCaja(client, ctx, e.registerId);

    const ahora = Date.now();
    const fecha = fechaDeJornada(e.fecha, ahora);

    /*
     * Repetir un día ATRASADO casi siempre es un despiste de quien está
     * metiendo los días que se llevaron a mano: se teclea el 14 dos veces y
     * los cobros quedan repartidos entre dos jornadas que nadie cuadra. Se
     * avisa y se deja seguir si se confirma.
     *
     * Solo para fechas pasadas: abrir una segunda jornada HOY es normal —el
     * turno de tarde después de cerrar el de mañana— y preguntar ahí sería un
     * estorbo diario a cambio de nada.
     */
    if (!e.permitirFechaRepetida && fecha < new Date(ahora).toISOString().slice(0, 10)) {
      const { rows: mismas } = await client.query<{ id: number }>(
        `SELECT id FROM cash_sessions
          WHERE register_id = $1 AND fecha = $2 AND estado <> 'CANCELLED'
          ORDER BY id LIMIT 1`,
        [e.registerId, fecha]
      );
      if (mismas.length > 0) {
        throw new ErrorCaja(
          "FECHA_YA_TIENE_JORNADA",
          `Esta caja ya tiene la jornada ${mismas[0].id} del ${fecha}. ` +
            "Si de verdad quieres una segunda jornada ese día, confírmalo.",
          409,
          { sessionId: mismas[0].id, fecha }
        );
      }
    }

    /*
     * Acotado a la fecha: una jornada fechada atrás hereda del día anterior a
     * ella, no de la última que se cerró en el reloj.
     *
     * Y saltando los cierres que quedaron a CERO. Un cierre en falso —una
     * jornada abierta por error que alguien cerró vacía cuando anular todavía
     * no existía— cortaba la cadena, y la jornada siguiente amanecía con
     * 0,00 € aunque el dinero siguiera en el cajón. El cambio de verdad es el
     * del último cierre que dejó piezas, así que es ése el que se hereda; la
     * anterioridad la sigue mandando la fecha.
     */
    const anterior = await ultimaSesionCerrada(client, e.registerId, fecha);
    const denominaciones = await cargarDenominaciones(client);

    // Composición heredada: las piezas que el cierre anterior dejó en caja.
    let composicion: LineaDenominacion[] = [];
    let cartuchos: LineaDenominacion[] = [];
    let bolsas: LineaDenominacion[] = [];
    let heredado = false;
    let sesionHeredadaId: number | null = anterior?.id ?? null;

    if (anterior) {
      let piezas = await composicionDeCierre(client, anterior.id);
      if (
        piezas.composicion.length === 0 &&
        piezas.cartuchos.length === 0 &&
        piezas.bolsas.length === 0
      ) {
        const conCambio = await ultimoCierreConCambio(e.registerId, fecha, 0, client);
        if (conCambio) {
          piezas = conCambio;
          sesionHeredadaId = conCambio.sesionId;
        }
      }
      composicion = piezas.composicion;
      // Un tubo que quedó precintado ayer sigue precintado hoy; una bolsa, igual.
      cartuchos = piezas.cartuchos;
      bolsas = piezas.bolsas;
      heredado = composicion.length > 0 || cartuchos.length > 0 || bolsas.length > 0;
    }

    const hayFondoManual =
      (e.fondoManual && e.fondoManual.length > 0) ||
      (e.fondoCartuchos && e.fondoCartuchos.length > 0) ||
      (e.fondoBolsas && e.fondoBolsas.length > 0);

    if (!heredado || hayFondoManual) {
      // Sin cierre anterior (o con cambio final vacío) se introduce a mano; y
      // si se ha heredado PERO alguien lo corrige, es exactamente el caso que
      // el encargo pide auditar, porque cambia el punto de partida del día.
      composicion = (e.fondoManual ?? []).filter((l) => l.cantidad > 0);
      cartuchos = (e.fondoCartuchos ?? []).filter((l) => l.cantidad > 0);
      bolsas = (e.fondoBolsas ?? []).filter((l) => l.cantidad > 0);
      heredado = false;
    }

    const porCartucho = piezasPorCartuchoDe(denominaciones);
    const porBolsa = piezasPorBolsaDe(denominaciones);
    // Las líneas de envase se guardan como piezas (envases × piezas del
    // envase) con su contador: así el total de piezas no necesita casos aparte.
    const lineasCartucho = aPiezas(cartuchos, porCartucho, "cartuchos");
    const lineasBolsa = aPiezas(bolsas, porBolsa, "bolsas");

    const inventarioInicial = inventarioDesdeLineas([
      ...composicion,
      ...lineasCartucho,
      ...lineasBolsa,
    ]);
    const fondo = totalInventario(inventarioInicial);

    const { rows: creada } = await client.query(
      `INSERT INTO cash_sessions
         (empresa_id, register_id, fecha, estado, abierta_por, abierta_at_ms,
          fondo_inicial_centimos, fondo_inicial_heredado, sesion_anterior_id, notas,
          created_at_ms, updated_at_ms)
       VALUES ($1,$2,$3,'OPEN',$4,$5,$6,$7,$8,$9,$5,$5)
       RETURNING id`,
      [
        ctx.empresaId,
        e.registerId,
        fecha,
        ctx.userId,
        ahora,
        fondo,
        heredado,
        heredado ? sesionHeredadaId : (anterior?.id ?? null),
        e.notas ?? null,
      ]
    );
    const sessionId = creada[0].id as number;

    if (composicion.length > 0 || lineasCartucho.length > 0 || lineasBolsa.length > 0) {
      // El fondo inicial también es una operación con sus piezas: así el libro
      // mayor cuadra desde el primer asiento y el stock se reconstruye entero
      // sumando movimientos, sin ningún caso especial.
      const numero = await siguienteNumero(client, sessionId, "OPENING_FLOAT", Number(fecha.slice(0, 4)));
      const opId = await insertarOperacion(client, {
        empresaId: ctx.empresaId,
        sessionId,
        numero,
        tipo: "OPENING_FLOAT",
        origen: "MANUAL",
        concepto: heredado ? "Cambio heredado del cierre anterior" : "Fondo inicial introducido a mano",
        importeCentimos: fondo,
        efectivoNetoCentimos: fondo,
        erpSyncStatus: "NOT_APPLICABLE",
        userId: ctx.userId,
        ahora,
      });
      await insertarMovimientos(client, {
        sessionId,
        operationId: opId,
        movimientos: [
          {
            direccion: "IN",
            motivo: "OPENING_FLOAT",
            lineas: [...composicion, ...lineasCartucho, ...lineasBolsa],
          },
        ],
        denominaciones,
        userId: ctx.userId,
        ahora,
      });
    }

    await emitirEvento(client, {
      empresaId: ctx.empresaId,
      centroId: await centroDeCaja(client, e.registerId),
      registerId: e.registerId,
      sessionId,
      agregado: { tipo: "SESSION", id: sessionId },
      tipo: "SESSION_OPENED",
      ocurridoEnMs: ahora,
      actorUserId: ctx.userId,
      // La fecha CONTABLE, que puede no ser la de hoy: al arrancar el módulo se
      // meten días atrasados, y para Central ese cobro es del día que fue.
      datos: { fecha, fondoCentimos: fondo, heredado },
    });

    const sesion = (await obtenerSesion(sessionId, client))!;
    return { sesion, stock: lineasDesdeInventario(inventarioInicial), heredado, fondo };
  });

  await registrarAuditoria({
    empresaId: ctx.empresaId,
    userId: ctx.userId,
    accion: "cash.session.open",
    entidad: "cash_sessions",
    entidadId: String(resultado.sesion.id),
    detalle: {
      registerId: e.registerId,
      fondoCentimos: resultado.fondo,
      heredado: resultado.heredado,
      motivoFondoManual: e.motivoFondoManual ?? null,
      composicion: resultado.stock,
    },
    ip: ctx.ip,
  });

  return { sesion: resultado.sesion, stock: resultado.stock };
}

// ── Consulta de stock y propuesta de cambio ────────────────────────────────

export async function stockDeJornada(sessionId: number): Promise<{
  lineas: LineaDenominacion[];
  sueltas: LineaDenominacion[];
  cartuchos: LineaDenominacion[];
  bolsas: LineaDenominacion[];
  totalCentimos: Centimos;
  piezas: number;
}> {
  /*
   * Aquí se LEE, no se mueve dinero: un saldo de formato incoherente sale como
   * aviso y no como excepción. Antes reventaba, y con él se caía el informe de
   * cierre entero: una jornada ya cerrada se quedaba sin su papeleo por algo
   * que ya no tenía arreglo desde esa pantalla.
   */
  const [inv, porFormato] = await Promise.all([
    stockTeorico(pool, sessionId),
    stockPorFormatoBruto(pool, sessionId),
  ]);
  return {
    lineas: lineasDesdeInventario(inv),
    sueltas: lineasDesdeInventario(porFormato.sueltas),
    cartuchos: lineasDesdeInventario(porFormato.cartuchos),
    bolsas: lineasDesdeInventario(porFormato.bolsas),
    totalCentimos: totalInventario(inv),
    piezas: totalPiezas(inv),
  };
}

/**
 * Propone cómo devolver un cambio con el stock actual.
 *
 * Es una consulta, no reserva nada: entre la propuesta y la confirmación el
 * stock puede cambiar, y por eso la confirmación vuelve a validar con la
 * jornada bloqueada.
 */
export async function proponerCambio(
  sessionId: number,
  importe: Centimos,
  /**
   * Denominaciones a excluir de la propuesta: las que acaban de ENTRAR.
   *
   * Un cambio de moneda va en los dos sentidos —entra un billete y salen
   * monedas, o entran monedas y sale un billete— así que no vale un tope por
   * valor. Lo que sí vale siempre: nadie cambia una pieza para recibir de
   * vuelta esa misma pieza. Quitando del stock lo que entra, el motor —que da
   * siempre la pieza más grande— resuelve solo los dos sentidos.
   */
  excluirValores?: readonly Centimos[]
) {
  const [stock, denominaciones] = await Promise.all([
    stockPorFormato(pool, sessionId),
    cargarDenominaciones(pool),
  ]);
  const fuera = new Set(excluirValores ?? []);
  const recorte = (m: Map<Centimos, number>) =>
    fuera.size === 0 ? m : new Map([...m].filter(([valor]) => !fuera.has(valor)));
  return calcularCambioConCartuchos(
    importe,
    { sueltas: recorte(stock.sueltas), cartuchos: recorte(stock.cartuchos), bolsas: recorte(stock.bolsas) },
    piezasPorCartuchoDe(denominaciones),
    piezasPorBolsaDe(denominaciones)
  );
}

// ── Operaciones que mueven efectivo ────────────────────────────────────────

export type EntradaOperacion = {
  sessionId: number;
  tipo: TipoOperacion;
  origen?: OrigenOperacion;
  importeCentimos: Centimos;
  formasPago: { forma: FormaPago; importe: Centimos; referencia?: string | null }[];
  efectivoRecibido?: LineaDenominacion[];
  efectivoEntregado?: LineaDenominacion[];
  /**
   * Autorización para cobrar una factura que ya consta cobrada.
   *
   * Solo se mira en los cobros y solo cuando de verdad hay un cobro previo. Sin
   * ella, un duplicado se rechaza aquí dentro aunque la pantalla creyera que no
   * lo era: la comprobación de verdad es ésta, con la jornada ya bloqueada.
   */
  autorizacionDuplicado?: string | null;
  /** Tubos precintados que ENTRAN: `cantidad` son tubos, no monedas. */
  cartuchosRecibidos?: LineaDenominacion[];
  /** Tubos precintados que SALEN sin abrirse (al banco, por ejemplo). */
  cartuchosEntregados?: LineaDenominacion[];
  /** Bolsas precintadas que ENTRAN: `cantidad` son bolsas, no monedas. */
  bolsasRecibidas?: LineaDenominacion[];
  /** Bolsas precintadas que SALEN sin abrirse. */
  bolsasEntregadas?: LineaDenominacion[];
  /**
   * Liquidación de una entrega de dinero: el efectivo ya salió cuando se le dio
   * el dinero a la persona, así que esta operación no mueve piezas.
   */
  liquidaEntregaId?: number;
  partyNombre?: string;
  concepto?: string;
  referencia?: string | null;
  /** Documento de la ERP, si la operación viene de una. */
  documentoId?: number | null;
  externalSystem?: string | null;
  externalDocumentId?: string | null;
  externalDocumentReference?: string | null;
  /**
   * Sección de negocio (taller, gasolinera…). Se omite en las operaciones que
   * no son de mostrador —fondo inicial, cierre, ingreso bancario— porque son
   * del cajón entero y no de un negocio.
   */
  sectionId?: number | null;
};

export type ResultadoOperacion = {
  operacionId: number;
  numero: string;
  efectivoNetoCentimos: Centimos;
  stock: LineaDenominacion[];
  totalStockCentimos: Centimos;
  erpSyncStatus: string;
  /** Cartuchos que ha habido que abrir para poder entregar. */
  aperturas: AperturaCartucho[];
};

/**
 * Registra una operación de caja completa.
 *
 * Único punto de entrada para cobros, pagos, ingresos, salidas, entregas,
 * ingresos bancarios y ajustes. Todos comparten motor, transacción y auditoría;
 * lo que cambia entre ellos es el tipo, y el tipo lo interpreta el dominio.
 */
export async function registrarOperacion(
  ctx: Contexto,
  e: EntradaOperacion,
  /**
   * Cliente de una transacción YA abierta. Lo usan los pedidos de cambio y las
   * entregas de dinero, que tienen que asentar su operación y su documento a la
   * vez: si la operación cuajara y el documento no, saldría dinero de la caja
   * sin nada que diga quién lo tiene.
   */
  clienteExterno?: PoolClient
): Promise<ResultadoOperacion> {
  const origen = e.origen ?? "MANUAL";
  // Se rellena dentro de la transacción, con el catálogo que se haya usado para
  // validar, y se reutiliza en la auditoría de después.
  let codigosEfectivo: ReadonlySet<string> = CODIGOS_EFECTIVO_POR_DEFECTO;

  const trabajo = async (client: PoolClient) => {
    const sesion = await bloquearSesionOperable(client, e.sessionId);
    await exigirJornadaPropia(client, ctx, sesion);

    // Stock leído con la jornada ya bloqueada: es el bueno hasta el COMMIT.
    const stock = await stockTeorico(client, e.sessionId);
    const denominaciones = await cargarDenominaciones(client);

    /*
     * Los envases se convierten a líneas de asiento: `cantidad` son las monedas
     * que traen y `cartuchos`/`bolsas` cuántos envases son. Se añaden a las
     * líneas sueltas sin fusionarlas, para que el libro mayor distinga un
     * envase entero de las monedas sueltas del mismo valor.
     */
    const aLineasTubo = (tubos: readonly LineaDenominacion[] | undefined) =>
      aPiezas(
        (tubos ?? []).filter((t) => t.cantidad > 0),
        piezasPorCartuchoDe(denominaciones),
        "cartuchos"
      );
    const aLineasBolsa = (sacos: readonly LineaDenominacion[] | undefined) =>
      aPiezas(
        (sacos ?? []).filter((t) => t.cantidad > 0),
        piezasPorBolsaDe(denominaciones),
        "bolsas"
      );

    const normalizada: OperacionNormalizada = {
      tipo: e.tipo,
      origen,
      importe: e.importeCentimos,
      formasPago: e.formasPago,
      efectivoRecibido: [
        ...(e.efectivoRecibido ?? []),
        ...aLineasTubo(e.cartuchosRecibidos),
        ...aLineasBolsa(e.bolsasRecibidas),
      ],
      efectivoEntregado: [
        ...(e.efectivoEntregado ?? []),
        ...aLineasTubo(e.cartuchosEntregados),
        ...aLineasBolsa(e.bolsasEntregadas),
      ],
      liquidaEntregaId: e.liquidaEntregaId,
    };

    /*
     * El catálogo de formas de pago se comprueba aquí, con la jornada ya
     * bloqueada, y no en el router: entre que la pantalla pintó los botones y
     * llega el cobro, alguien ha podido dar de baja una forma desde
     * Configuración. Es la misma razón por la que el stock se relee dentro de
     * la transacción en vez de fiarse de lo que vio el navegador.
     */
    const catalogo = await cargarFormasPago(client, ctx.empresaId);
    const porCodigo = new Map(catalogo.map((f) => [f.codigo, f]));
    for (const linea of e.formasPago) {
      const forma = porCodigo.get(linea.forma);
      if (!forma) {
        throw new ErrorCaja(
          "FORMA_PAGO_DESCONOCIDA",
          `La forma de pago ${linea.forma} no está en el catálogo de la empresa.`,
          400
        );
      }
      if (!forma.activa) {
        throw new ErrorCaja(
          "FORMA_PAGO_INACTIVA",
          `La forma de pago "${forma.nombre}" está dada de baja y no se puede usar en operaciones nuevas.`,
          409
        );
      }
      /*
       * Dónde se puede usar. Se cobra por muchas vías y se paga casi siempre en
       * efectivo, así que el catálogo dice en qué pantalla sale cada forma. Se
       * comprueba aquí y no solo al pintar los botones, por lo de siempre: la
       * pantalla puede llevar minutos abierta.
       */
      if (e.tipo === "COLLECTION" && !forma.enCobros) {
        throw new ErrorCaja(
          "FORMA_PAGO_NO_EN_COBROS",
          `"${forma.nombre}" no está habilitada para cobros. Actívala en Configuración.`,
          409
        );
      }
      if (e.tipo === "PAYMENT" && !forma.enPagos) {
        throw new ErrorCaja(
          "FORMA_PAGO_NO_EN_PAGOS",
          `"${forma.nombre}" no está habilitada para pagos. Actívala en Configuración.`,
          409
        );
      }
      if (forma.pideReferencia && !String(linea.referencia ?? "").trim()) {
        throw new ErrorCaja(
          "REFERENCIA_REQUERIDA",
          `"${forma.nombre}" necesita referencia: es lo que luego permite cuadrar con el banco.`,
          400
        );
      }
    }

    /*
     * La sección se comprueba aquí dentro, con la jornada ya bloqueada, y no
     * en el router: una sección dada de baja entre que se pintó la pantalla y
     * se pulsó confirmar tiene que rechazarse, no colarse por ser el id de
     * algo que existía hace un minuto.
     */
    if (e.sectionId != null) {
      const { rows: secc } = await client.query<{ id: number; activa: boolean; nombre: string }>(
        `SELECT id, activa, nombre FROM cash_sections WHERE id = $1 AND empresa_id = $2`,
        [e.sectionId, ctx.empresaId]
      );
      if (secc.length === 0) {
        throw new ErrorCaja("SECCION_NO_ENCONTRADA", "La sección indicada no existe.", 404);
      }
      if (!secc[0].activa) {
        throw new ErrorCaja(
          "SECCION_DE_BAJA",
          `La sección "${secc[0].nombre}" está dada de baja y no admite operaciones nuevas.`,
          409
        );
      }
    }

    codigosEfectivo = codigosEfectivoDe(catalogo);
    const validacion = validarOperacion(normalizada, stock, codigosEfectivo);
    if (esFallo(validacion)) {
      throw new ErrorCaja(validacion.codigo, validacion.mensaje, 400);
    }

    const ahora = Date.now();
    const anio = Number(sesion.fecha.slice(0, 4));
    const numero = await siguienteNumero(client, sesion.id, e.tipo, anio);

    // ¿Hay que avisar a la ERP? Solo si la operación viene de un documento
    // externo y hay integración activa. En modo autónomo esto es NOT_APPLICABLE
    // y no se crea ningún evento: no hay nada que sincronizar.
    const { conector } = await conectorPara(ctx.empresaId);
    const sincronizable =
      Boolean(e.externalDocumentId) &&
      Boolean(conector) &&
      (e.tipo === "COLLECTION" || e.tipo === "PAYMENT");
    const erpSyncStatus = sincronizable ? "PENDING" : "NOT_APPLICABLE";

    const operacionId = await insertarOperacion(client, {
      empresaId: ctx.empresaId,
      sessionId: e.sessionId,
      numero,
      tipo: e.tipo,
      origen,
      externalSystem: e.externalSystem ?? null,
      externalDocumentId: e.externalDocumentId ?? null,
      externalDocumentReference: e.externalDocumentReference ?? null,
      documentoId: e.documentoId ?? null,
      partyNombre: e.partyNombre ?? "",
      concepto: e.concepto ?? "",
      referencia: e.referencia ?? null,
      importeCentimos: e.importeCentimos,
      efectivoNetoCentimos: validacion.efectivoNeto,
      erpSyncStatus,
      sectionId: e.sectionId ?? null,
      userId: ctx.userId,
      ahora,
    });

    /*
     * Cobrar dos veces la misma factura.
     *
     * Aquí y no en el navegador: entre que la pantalla se pintó y se pulsó el
     * botón, otra persona ha podido cobrarla. Y aquí dentro la jornada ya está
     * bloqueada, así que dos peticiones simultáneas de la misma caja se ponen
     * en fila solas y la segunda ve el cobro de la primera —que es lo que
     * convierte el doble clic en un solo cobro—.
     */
    let autorizadoPor: string | null = null;
    if (e.tipo === "COLLECTION" && e.referencia) {
      const { cobroPrevioDeFactura, consumirAutorizacion } = await import("./duplicates.ts");
      const previo = await cobroPrevioDeFactura(
        ctx.empresaId,
        e.referencia,
        client,
        operacionId
      );
      if (previo) {
        if (!e.autorizacionDuplicado) {
          throw new ErrorCaja(
            "COBRO_DUPLICADO",
            `La factura ${e.referencia.trim()} ya está cobrada en ${previo.numero}. Para cobrarla otra vez hace falta que lo autorice alguien con permiso.`,
            409
          );
        }
        autorizadoPor = String(
          await consumirAutorizacion(client, {
            empresaId: ctx.empresaId,
            token: e.autorizacionDuplicado,
            referencia: e.referencia,
            importeCentimos: e.importeCentimos,
            operacionId,
          })
        );
        await registrarAuditoriaEnTransaccion(client, {
          empresaId: ctx.empresaId,
          userId: ctx.userId,
          accion: "cash.collection.duplicate_override_used",
          entidad: "cash_operations",
          entidadId: String(operacionId),
          detalle: {
            referencia: e.referencia.trim(),
            importeCentimos: e.importeCentimos,
            cobroPrevio: previo.numero,
            operacionPreviaId: previo.operacionId,
            // Quién cobra y quién autoriza, separados a propósito.
            realizadoPor: ctx.userId,
            autorizadoPor,
          },
          ip: ctx.ip,
        });
      }
    }

    await insertarFormasPago(client, operacionId, e.formasPago, ahora);

    /*
     * Cartuchos. Si lo que sale de caja no cabe en las monedas sueltas, hay que
     * abrir tubos. Se asienta ANTES de la salida y con su propio motivo: sale
     * el tubo y entran sus monedas sueltas, valor neto cero. Así el libro mayor
     * refleja que el precinto se rompió —que es irreversible— y el operador ve
     * en el histórico por qué de pronto había 25 monedas más.
     */
    const aperturas = await abrirCartuchosSiHaceFalta(client, {
      sessionId: e.sessionId,
      operationId: operacionId,
      salidas: validacion.movimientos.filter((m) => m.direccion === "OUT"),
      denominaciones,
      userId: ctx.userId,
      ahora,
    });

    await insertarMovimientos(client, {
      sessionId: e.sessionId,
      operationId: operacionId,
      movimientos: validacion.movimientos,
      denominaciones,
      userId: ctx.userId,
      ahora,
    });

    /*
     * El evento hacia MC Central.
     *
     * Va aquí, con los movimientos ya asentados y dentro de la misma
     * transacción, y NO dentro del `if` de la ERP que viene justo debajo: ese
     * era el defecto que encontró la auditoría de la fase 0 —sin ERP
     * configurada, el módulo no contaba nada a nadie—. Un cobro es un hecho de
     * la caja tanto si hay una ERP detrás como si no.
     *
     * Éste es el único punto de emisión de TODOS los movimientos de efectivo
     * del módulo: cobros, pagos, ajustes, cambios de moneda, pedidos al banco,
     * entregas, liquidaciones y canjes de ingreso pasan por aquí.
     */
    await emitirEvento(client, {
      empresaId: ctx.empresaId,
      centroId: await centroDeCaja(client, sesion.registerId),
      registerId: sesion.registerId,
      sessionId: e.sessionId,
      agregado: { tipo: "SESSION", id: e.sessionId },
      tipo: "OPERATION_REGISTERED",
      ocurridoEnMs: ahora,
      actorUserId: ctx.userId,
      datos: {
        operacionId: operacionId,
        numero,
        tipoOperacion: e.tipo,
        origen,
        importeCentimos: e.importeCentimos,
        efectivoNetoCentimos: validacion.efectivoNeto,
        sectionId: e.sectionId ?? null,
      },
    });

    if (sincronizable) {
      await encolarEventoErp(client, {
        empresaId: ctx.empresaId,
        operationId: operacionId,
        connectorKey: conector!.info.key,
        evento: e.tipo === "COLLECTION" ? "COLLECTION_COMPLETED" : "PAYMENT_COMPLETED",
        idempotencyKey: numero,
        payload: {
          externalSystem: e.externalSystem,
          externalDocumentId: e.externalDocumentId,
          operacionNumero: numero,
          importeCentimos: e.importeCentimos,
          fechaIso: new Date(ahora).toISOString(),
          formasPago: e.formasPago.map((f) => ({
            forma: f.forma,
            importeCentimos: f.importe,
            referencia: f.referencia ?? null,
          })),
        },
        ahora,
      });
    }

    // Actualiza el pendiente del documento local. La ERP sigue siendo la fuente
    // autoritativa; esto es la copia operativa, y si luego la ERP dice otra cosa
    // se verá en el panel de integración en vez de corregirse en silencio.
    if (e.documentoId) {
      await client.query(
        `UPDATE cash_external_documents
            SET pendiente_centimos = GREATEST(0, pendiente_centimos - $2),
                estado = CASE
                  WHEN pendiente_centimos - $2 <= 0 THEN 'PAID'
                  ELSE 'PARTIALLY_PAID' END,
                updated_at_ms = $3
          WHERE id = $1`,
        [e.documentoId, e.importeCentimos, ahora]
      );
    }

    /*
     * La auditoría, DENTRO de la transacción y sin tragar el error.
     *
     * Estaba después del COMMIT y con `registrarAuditoria`, que se traga lo que
     * falle: una operación podía quedar asentada sin ninguna línea que dijera
     * quién la hizo. Era el riesgo R2 de la auditoría de la fase 0, y para el
     * dinero «se guardó pero no se sabe quién» no es un estado aceptable.
     *
     * Que esto sea seguro depende de que el INSERT no pueda fallar por los
     * datos: por eso `app_auditoria` perdió su clave ajena en esta fase.
     */
    await registrarAuditoriaEnTransaccion(client, {
      empresaId: ctx.empresaId,
      userId: ctx.userId,
      accion: `cash.operation.${e.tipo.toLowerCase()}`,
      entidad: "cash_operations",
      entidadId: String(operacionId),
      detalle: {
        numero,
        origen,
        importeCentimos: e.importeCentimos,
        efectivoCentimos: importeEnEfectivo(e.formasPago, codigosEfectivo),
        formasPago: e.formasPago,
        recibido: e.efectivoRecibido ?? [],
        entregado: e.efectivoEntregado ?? [],
        externalDocumentId: e.externalDocumentId ?? null,
      },
      ip: ctx.ip,
    });

    const stockFinal = await stockTeorico(client, e.sessionId);

    return {
      operacionId,
      numero,
      efectivoNetoCentimos: validacion.efectivoNeto,
      stock: lineasDesdeInventario(stockFinal),
      totalStockCentimos: totalInventario(stockFinal),
      erpSyncStatus,
      aperturas,
    };
  };

  const resultado = clienteExterno
    ? await trabajo(clienteExterno)
    : await enTransaccion(trabajo);

  return resultado;
}

/**
 * Cobro con cambio calculado por el sistema o indicado a mano.
 *
 * Envoltorio cómodo sobre `registrarOperacion` que resuelve el cambio con el
 * stock bloqueado, para que la interfaz no tenga que hacer dos viajes ni fiarse
 * de la propuesta que vio hace treinta segundos.
 */
export type EntradaCobro = Omit<EntradaOperacion, "tipo" | "efectivoEntregado"> & {
  /** Si se omite, el sistema calcula el cambio con el stock del momento. */
  cambioManual?: LineaDenominacion[];
};

export async function registrarCobro(ctx: Contexto, e: EntradaCobro): Promise<ResultadoOperacion> {
  // Qué parte del cobro es efectivo lo dice el catálogo, no el literal "CASH":
  // el código del efectivo es de la empresa. Esto solo calcula el cambio a
  // proponer; la validación de verdad vuelve a hacerse en la transacción.
  const codigosEfectivo = codigosEfectivoDe(await cargarFormasPago(pool, ctx.empresaId));
  const efectivo = importeEnEfectivo(e.formasPago, codigosEfectivo);
  const recibido = totalInventario(inventarioDesdeLineas(e.efectivoRecibido ?? []));
  const cambioRequerido = recibido - efectivo;

  if (efectivo > 0 && cambioRequerido < 0) {
    throw new ErrorCaja(
      "EFECTIVO_INSUFICIENTE",
      `El cliente entrega ${formatearEuros(recibido)} € y la parte en efectivo es de ${formatearEuros(efectivo)} €.`,
      400
    );
  }

  let cambio: LineaDenominacion[] = [];

  if (cambioRequerido > 0) {
    if (e.cambioManual && e.cambioManual.length > 0) {
      cambio = e.cambioManual;
    } else {
      // Se resuelve contra el stock actual MÁS lo que entrega el cliente:
      // devolver uno de los billetes que acaba de dar es perfectamente legítimo
      // y no hacerlo dejaría cambios imposibles que en la práctica sí lo son.
      const stock = await stockTeorico(pool, e.sessionId);
      const disponible = new Map(stock);
      for (const l of e.efectivoRecibido ?? []) {
        disponible.set(l.valor, (disponible.get(l.valor) ?? 0) + l.cantidad);
      }
      const propuesta = calcularCambio(cambioRequerido, disponible);
      if (esFallo(propuesta)) {
        throw new ErrorCaja(
          propuesta.motivo,
          propuesta.mensaje,
          propuesta.motivo === "NO_SOLUTION" ? 409 : 400
        );
      }
      cambio = propuesta.lineas;
    }
  }

  return registrarOperacion(ctx, { ...e, tipo: "COLLECTION", efectivoEntregado: cambio });
}

// ── Arqueo ─────────────────────────────────────────────────────────────────

export type EntradaArqueo = {
  sessionId: number;
  /** Piezas sueltas contadas por denominación. */
  contado: LineaDenominacion[];
  /** Cartuchos contados aparte; se convierten a piezas con el catálogo. */
  cartuchos?: { valor: Centimos; cantidad: number }[];
  /** Bolsas contadas aparte; se convierten a piezas con el catálogo. */
  bolsas?: { valor: Centimos; cantidad: number }[];
  tipo?: "INTERMEDIATE" | "CLOSING";
  notas?: string;
};

export type ResultadoArqueoGuardado = ResultadoArqueo & { arqueoId: number };

/**
 * Guarda un arqueo y devuelve el doble cuadre.
 *
 * No cierra la jornada: se puede arquear tantas veces como haga falta. El
 * cierre es un paso aparte y usa el último arqueo.
 */
export async function guardarArqueo(
  ctx: Contexto,
  e: EntradaArqueo
): Promise<ResultadoArqueoGuardado> {
  const resultado = await enTransaccion(async (client) => {
    const sesion = await bloquearSesion(client, e.sessionId);
    await exigirJornadaPropia(client, ctx, sesion);
    if (sesion.estado === "CLOSED" || sesion.estado === "CANCELLED") {
      throw new ErrorCaja("JORNADA_CERRADA", "La jornada ya está cerrada.", 409);
    }

    const denominaciones = await cargarDenominaciones(client);
    const porValor = new Map(denominaciones.map((d) => [d.valor, d]));

    /*
     * Los envases se cuentan aparte y se GUARDAN aparte: `cantidad_contada`
     * son monedas sueltas, `cartuchos_contados` tubos y `bolsas_contadas`
     * bolsas. La comparación con el teórico sí se hace en piezas —un envase se
     * puede abrir, así que sus monedas cuentan— pero el formato no se pierde, y
     * por eso un tubo que se cuenta cerrado al cerrar sigue cerrado mañana.
     */
    const lineas: LineaDenominacion[] = [...e.contado];
    lineas.push(...aPiezas(e.cartuchos ?? [], piezasPorCartuchoDe(denominaciones), "cartuchos"));
    lineas.push(...aPiezas(e.bolsas ?? [], piezasPorBolsaDe(denominaciones), "bolsas"));

    // Sueltas contadas, para guardarlas sin mezclar con las de los tubos.
    const sueltasContadas = new Map<Centimos, number>();
    for (const l of e.contado) {
      if (l.cantidad > 0) sueltasContadas.set(l.valor, (sueltasContadas.get(l.valor) ?? 0) + l.cantidad);
    }

    const contado = inventarioDesdeLineas(lineas);
    const teorico = await stockTeorico(client, e.sessionId);
    const comparacion = compararArqueo(teorico, contado);
    const ahora = Date.now();

    const { rows } = await client.query<{ id: number }>(
      `INSERT INTO cash_counts
         (session_id, tipo, teorico_centimos, contado_centimos, diferencia_centimos,
          denominaciones_cuadran, piezas_teoricas, piezas_contadas, notas, created_by, created_at_ms)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       RETURNING id`,
      [
        e.sessionId,
        e.tipo ?? "CLOSING",
        comparacion.totalTeorico,
        comparacion.totalContado,
        comparacion.diferencia,
        comparacion.cuadranDenominaciones,
        comparacion.piezasTeoricas,
        comparacion.piezasContadas,
        e.notas ?? null,
        ctx.userId,
        ahora,
      ]
    );
    const arqueoId = rows[0].id;

    for (const l of comparacion.lineas) {
      const d = porValor.get(l.valor);
      if (!d) continue;
      const cartuchos = (e.cartuchos ?? []).find((c) => c.valor === l.valor)?.cantidad ?? 0;
      const bolsas = (e.bolsas ?? []).find((c) => c.valor === l.valor)?.cantidad ?? 0;
      await client.query(
        `INSERT INTO cash_count_lines
           (count_id, denomination_id, valor_unitario_centimos, cantidad_teorica,
            cantidad_contada, cartuchos_contados, bolsas_contadas, diferencia)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (count_id, denomination_id) DO UPDATE
           SET cantidad_contada = EXCLUDED.cantidad_contada,
               cartuchos_contados = EXCLUDED.cartuchos_contados,
               bolsas_contadas = EXCLUDED.bolsas_contadas,
               diferencia = EXCLUDED.diferencia`,
        [
          arqueoId,
          d.id,
          l.valor,
          l.teorico,
          sueltasContadas.get(l.valor) ?? 0,
          cartuchos,
          bolsas,
          l.diferencia,
        ]
      );
    }

    await emitirEvento(client, {
      empresaId: ctx.empresaId,
      centroId: await centroDeCaja(client, sesion.registerId),
      registerId: sesion.registerId,
      sessionId: e.sessionId,
      agregado: { tipo: "SESSION", id: e.sessionId },
      tipo: "COUNT_RECORDED",
      ocurridoEnMs: Date.now(),
      actorUserId: ctx.userId,
      /*
       * Con el detalle POR PIEZA, y no solo los totales.
       *
       * Es lo que permite a MC Central contestar dos cosas que el total no
       * dice: qué caja se está quedando sin calderilla —porque el arqueo es la
       * única foto fiable de qué monedas hay en cada cajón— y si un descuadre
       * es de un billete o de veinte monedas de cinco céntimos, que no son el
       * mismo problema ni se investigan igual.
       */
      datos: {
        arqueoId,
        contadoCentimos: comparacion.totalContado,
        teoricoCentimos: comparacion.totalTeorico,
        diferenciaCentimos: comparacion.diferencia,
        denominacionesCuadran: comparacion.cuadranDenominaciones,
        lineas: comparacion.lineas.map((l) => ({
          valor: l.valor,
          teorico: l.teorico,
          contado: l.contado,
          diferencia: l.diferencia,
        })),
      },
    });

    return { ...comparacion, arqueoId };
  });

  await registrarAuditoria({
    empresaId: ctx.empresaId,
    userId: ctx.userId,
    accion: "cash.count.create",
    entidad: "cash_counts",
    entidadId: String(resultado.arqueoId),
    detalle: {
      sessionId: e.sessionId,
      teoricoCentimos: resultado.totalTeorico,
      contadoCentimos: resultado.totalContado,
      diferenciaCentimos: resultado.diferencia,
      denominacionesCuadran: resultado.cuadranDenominaciones,
      descuadres: resultado.descuadres,
    },
    ip: ctx.ip,
  });

  return resultado;
}

// ── Cierre ─────────────────────────────────────────────────────────────────

export type EntradaCierre = {
  sessionId: number;
  /** Monedas sueltas que se quedan en caja para mañana. */
  cambioFinal: LineaDenominacion[];
  /** Tubos precintados que se quedan: `cantidad` son tubos, no monedas. */
  cambioFinalCartuchos?: LineaDenominacion[];
  /** Bolsas precintadas que se quedan: `cantidad` son bolsas, no monedas. */
  cambioFinalBolsas?: LineaDenominacion[];
  /** Arqueo que respalda el cierre. Si no se pasa, se usa el último guardado. */
  arqueoId?: number;
  notas?: string;
  /**
   * Confirmación explícita para cerrar dejando la caja a CERO cuando la caja
   * tiene fondo fijo configurado. Vaciarla del todo casi nunca es lo que se
   * quiere —el despiste real fue mandar el fondo entero al «ingreso» del
   * cierre— y ese cero rompe además la herencia del día siguiente.
   */
  permitirCajaVacia?: boolean;
};

export type ResultadoCierre = {
  sesion: Sesion;
  cambioFinal: LineaDenominacion[];
  cambioFinalCartuchos: LineaDenominacion[];
  cambioFinalBolsas: LineaDenominacion[];
  ingresoBancario: LineaDenominacion[];
  ingresoBancarioCartuchos: LineaDenominacion[];
  ingresoBancarioBolsas: LineaDenominacion[];
  totalCambioCentimos: Centimos;
  totalIngresoCentimos: Centimos;
  diferenciaCentimos: Centimos;
  denominacionesCuadran: boolean;
};

/**
 * Cierra la jornada: registra el cambio que se queda, manda el resto al banco y
 * bloquea la caja.
 *
 * El reparto se valida pieza a pieza: el mismo billete no puede estar a la vez
 * en el cambio de mañana y en el ingreso bancario. Por eso el ingreso no se
 * pide, se calcula restando lo que se queda de lo que se ha contado.
 *
 * Tanto el cambio final como el ingreso salen de la caja como movimientos OUT
 * reales, así que el stock teórico de la jornada acaba en cero: todo lo que
 * entró ha salido, o al cajón de mañana o al banco. Eso es lo que hace que el
 * libro mayor cuadre solo.
 */
export async function cerrarJornada(ctx: Contexto, e: EntradaCierre): Promise<ResultadoCierre> {
  const resultado = await enTransaccion(async (client) => {
    const sesion = await bloquearSesion(client, e.sessionId);
    await exigirJornadaPropia(client, ctx, sesion);
    if (sesion.estado === "CLOSED") {
      throw new ErrorCaja("JORNADA_CERRADA", "La jornada ya está cerrada.", 409);
    }
    if (sesion.estado === "CANCELLED") {
      throw new ErrorCaja("JORNADA_ANULADA", "La jornada está anulada.", 409);
    }

    const { rows: arqueos } = await client.query(
      e.arqueoId
        ? `SELECT * FROM cash_counts WHERE id = $2 AND session_id = $1`
        : `SELECT * FROM cash_counts WHERE session_id = $1 ORDER BY id DESC LIMIT 1`,
      e.arqueoId ? [e.sessionId, e.arqueoId] : [e.sessionId]
    );
    if (arqueos.length === 0) {
      throw new ErrorCaja(
        "FALTA_ARQUEO",
        "Hay que hacer el arqueo antes de cerrar la jornada.",
        409
      );
    }
    const arqueo = arqueos[0];

    // Se reparte lo CONTADO, no lo teórico: si hay descuadre, el dinero que
    // existe de verdad es el contado, y es el que se reparte entre caja y banco.
    const { rows: lineasArqueo } = await client.query(
      `SELECT valor_unitario_centimos, cantidad_contada, cartuchos_contados, bolsas_contadas
         FROM cash_count_lines WHERE count_id = $1`,
      [arqueo.id]
    );

    const denominaciones = await cargarDenominaciones(client);
    const porCartucho = piezasPorCartuchoDe(denominaciones);
    const porBolsa = piezasPorBolsaDe(denominaciones);

    /** Una columna del arqueo, como inventario. */
    const columna = (campo: "cantidad_contada" | "cartuchos_contados" | "bolsas_contadas") =>
      inventarioDesdeLineas(
        lineasArqueo
          .map((r: Record<string, number>) => ({
            valor: r.valor_unitario_centimos,
            cantidad: Number(r[campo] ?? 0),
          }))
          .filter((l: LineaDenominacion) => l.cantidad > 0)
      );

    // Lo contado, en tres dimensiones: sueltas, tubos y bolsas.
    const contadoSueltas = columna("cantidad_contada");
    const contadoTubos = columna("cartuchos_contados");
    const contadoBolsas = columna("bolsas_contadas");

    /** Envases → piezas, para poder sumarlo todo en la misma unidad. */
    const enPiezas = (inv: Inventario, por: ReadonlyMap<Centimos, number>) =>
      lineasDesdeInventario(inv).map((l) => ({
        valor: l.valor,
        cantidad: l.cantidad * (por.get(l.valor) ?? 0),
      }));

    // Para el cuadre con el teórico se cuenta en piezas: un envase se puede
    // abrir, así que sus monedas son dinero disponible igual que las sueltas.
    const contado = inventarioDesdeLineas([
      ...lineasDesdeInventario(contadoSueltas),
      ...enPiezas(contadoTubos, porCartucho),
      ...enPiezas(contadoBolsas, porBolsa),
    ]);

    /*
     * El reparto va en las TRES dimensiones. Un envase precintado que se queda
     * en caja tiene que seguir precintado mañana: si se repartiera solo en
     * piezas, amanecería como monedas sueltas y se habría perdido el formato
     * sin que nadie tocara nada.
     */
    const cambioTubos = inventarioDesdeLineas(e.cambioFinalCartuchos ?? []);
    const cambioBolsas = inventarioDesdeLineas(e.cambioFinalBolsas ?? []);
    const repartoSueltas = repartirCierre(contadoSueltas, e.cambioFinal);
    if (esFallo(repartoSueltas)) {
      throw new ErrorCaja(repartoSueltas.codigo, repartoSueltas.mensaje, 400, repartoSueltas.detalle);
    }
    const repartoTubos = repartirCierre(contadoTubos, lineasDesdeInventario(cambioTubos));
    if (esFallo(repartoTubos)) {
      throw new ErrorCaja(
        "CAMBIO_NO_DISPONIBLE",
        "El cambio final incluye cartuchos que no se han contado en el arqueo.",
        400,
        repartoTubos.detalle
      );
    }
    const repartoBolsas = repartirCierre(contadoBolsas, lineasDesdeInventario(cambioBolsas));
    if (esFallo(repartoBolsas)) {
      throw new ErrorCaja(
        "CAMBIO_NO_DISPONIBLE",
        "El cambio final incluye bolsas que no se han contado en el arqueo.",
        400,
        repartoBolsas.detalle
      );
    }

    /** Convierte envases a líneas de asiento (piezas + contador del envase). */
    const aLineasTubo = (tubos: readonly LineaDenominacion[]) =>
      aPiezas(tubos.filter((t) => t.cantidad > 0), porCartucho, "cartuchos");
    const aLineasBolsa = (sacos: readonly LineaDenominacion[]) =>
      aPiezas(sacos.filter((t) => t.cantidad > 0), porBolsa, "bolsas");

    const valorDe = (envases: readonly LineaDenominacion[], por: ReadonlyMap<Centimos, number>) =>
      envases.reduce((a, t) => a + t.valor * t.cantidad * (por.get(t.valor) ?? 0), 0);

    const cambioFinalTubos = lineasDesdeInventario(cambioTubos);
    const cambioFinalBolsas = lineasDesdeInventario(cambioBolsas);
    const reparto = {
      ingresoBancario: repartoSueltas.ingresoBancario,
      ingresoTubos: repartoTubos.ingresoBancario,
      ingresoBolsas: repartoBolsas.ingresoBancario,
      totalCambio:
        repartoSueltas.totalCambio +
        valorDe(cambioFinalTubos, porCartucho) +
        valorDe(cambioFinalBolsas, porBolsa),
      totalIngreso:
        repartoSueltas.totalIngreso +
        valorDe(repartoTubos.ingresoBancario, porCartucho) +
        valorDe(repartoBolsas.ingresoBancario, porBolsa),
    };
    /*
     * Dejar la caja a 0,00 € teniendo fondo fijo configurado casi nunca es a
     * propósito: el caso real fue teclear el cierre mandando el fondo entero
     * al ingreso del banco, y ese cero además rompía la herencia del día
     * siguiente. Se pide confirmación explícita en vez de prohibirlo, porque
     * vaciar la caja de verdad existe (vacaciones, traslado).
     */
    if (reparto.totalCambio === 0 && reparto.totalIngreso > 0 && !e.permitirCajaVacia) {
      const { rows: cajaCierre } = await client.query<{ fondo_objetivo_centimos: string }>(
        `SELECT fondo_objetivo_centimos FROM cash_registers WHERE id = $1`,
        [sesion.registerId]
      );
      const objetivo = Number(cajaCierre[0]?.fondo_objetivo_centimos ?? 0);
      if (objetivo > 0) {
        throw new ErrorCaja(
          "CIERRE_DEJA_CAJA_VACIA",
          `Este cierre manda todo al banco y deja la caja a 0,00 €, pero la caja tiene un fondo fijo de ${formatearEuros(objetivo)} €. ¿Seguro que no era cambio? Si de verdad quieres vaciarla, confírmalo.`,
          409,
          { objetivoCentimos: objetivo }
        );
      }
    }

    const ahora = Date.now();
    const anio = Number(sesion.fecha.slice(0, 4));

    /*
     * El stock teórico y lo contado pueden no coincidir. Antes de sacar el
     * cambio final y el ingreso hay que dejar el teórico igual al contado, o la
     * validación de disponibilidad rechazaría sacar piezas que físicamente
     * están ahí (o dejaría en el libro piezas que no aparecieron).
     *
     * Ese cuadre es un ajuste, y como tal se asienta con su operación propia y
     * su auditoría: la diferencia no se disuelve, queda escrita.
     */
    /*
     * El cuadre contra el teórico se calcula aquí porque la jornada guarda su
     * resultado —contado, diferencia y si cuadran las denominaciones— aunque
     * el ajuste ya se hubiera asentado antes al regularizar. En ese caso la
     * diferencia sale cero, que es exactamente lo que hay que dejar escrito.
     */
    const comparacion = compararArqueo(await stockTeorico(client, e.sessionId), contado);

    await asentarAjusteDeArqueo(client, {
      ctx,
      sessionId: e.sessionId,
      contado,
      denominaciones,
      anio,
      ahora,
      concepto: "Ajuste por diferencia de arqueo al cerrar",
    });

    /*
     * Y ahora el FORMATO, que hasta aquí no se asentaba nunca.
     *
     * El arqueo cuenta tres cosas —sueltas, cartuchos y bolsas— pero solo las
     * piezas llegaban al libro mayor. Si alguien juntaba monedas y las
     * precintaba, el arqueo lo veía y el libro mayor no: seguía creyendo que
     * estaban sueltas. Al repartir, el cierre sacaba un envase que para el
     * libro mayor no existía y su saldo se iba a NEGATIVO. A partir de ahí esa
     * jornada ya no podía ni imprimir su informe.
     *
     * Se asienta solo en el sentido de PRECINTAR. Abrir no tiene vuelta atrás
     * y ya se hace solo cuando hacen falta piezas (`abrirCartuchosSiHaceFalta`);
     * hacerlo aquí porque un arqueo dejara los envases a cero rompería tubos de
     * verdad por un descuido al contar.
     */
    await conciliarFormato(client, {
      sessionId: e.sessionId,
      operacionesDe: { anio, ahora },
      ctx,
      denominaciones,
      contadoTubos,
      contadoBolsas,
      porCartucho,
      porBolsa,
    });

    // Cambio final: sale de la jornada de hoy y mañana entra como fondo.
    if (reparto.totalCambio > 0) {
      const numero = await siguienteNumero(client, sesion.id, "CLOSING_FLOAT", anio);
      const opId = await insertarOperacion(client, {
        empresaId: ctx.empresaId,
        sessionId: e.sessionId,
        numero,
        tipo: "CLOSING_FLOAT",
        origen: "MANUAL",
        concepto: "Cambio que queda en caja para el día siguiente",
        importeCentimos: reparto.totalCambio,
        efectivoNetoCentimos: -reparto.totalCambio,
        erpSyncStatus: "NOT_APPLICABLE",
        userId: ctx.userId,
        ahora,
      });
      await insertarMovimientos(client, {
        sessionId: e.sessionId,
        operationId: opId,
        movimientos: [
          {
            direccion: "OUT",
            motivo: "CLOSING_FLOAT",
            lineas: [
              ...e.cambioFinal,
              ...aLineasTubo(cambioFinalTubos),
              ...aLineasBolsa(cambioFinalBolsas),
            ],
          },
        ],
        denominaciones,
        userId: ctx.userId,
        ahora,
      });
    }

    // Ingreso bancario: todo lo que no se queda como cambio.
    if (reparto.totalIngreso > 0) {
      const numero = await siguienteNumero(client, sesion.id, "BANK_DEPOSIT", anio);
      const opId = await insertarOperacion(client, {
        empresaId: ctx.empresaId,
        sessionId: e.sessionId,
        numero,
        tipo: "BANK_DEPOSIT",
        origen: "MANUAL",
        concepto: "Ingreso bancario del cierre",
        importeCentimos: reparto.totalIngreso,
        efectivoNetoCentimos: -reparto.totalIngreso,
        erpSyncStatus: "NOT_APPLICABLE",
        userId: ctx.userId,
        ahora,
      });
      await insertarMovimientos(client, {
        sessionId: e.sessionId,
        operationId: opId,
        movimientos: [
          {
            direccion: "OUT",
            motivo: "BANK_DEPOSIT",
            lineas: [
              ...reparto.ingresoBancario,
              ...aLineasTubo(reparto.ingresoTubos),
              ...aLineasBolsa(reparto.ingresoBolsas),
            ],
          },
        ],
        denominaciones,
        userId: ctx.userId,
        ahora,
      });
    }

    await client.query(
      `UPDATE cash_sessions
          SET estado = 'CLOSED', cerrada_por = $2, cerrada_at_ms = $3,
              contado_centimos = $4, diferencia_centimos = $5, denominaciones_cuadran = $6,
              cambio_final_centimos = $7, ingreso_bancario_centimos = $8,
              notas = COALESCE($9, notas), updated_at_ms = $3
        WHERE id = $1`,
      [
        e.sessionId,
        ctx.userId,
        ahora,
        comparacion.totalContado,
        comparacion.diferencia,
        comparacion.cuadranDenominaciones,
        reparto.totalCambio,
        reparto.totalIngreso,
        e.notas ?? null,
      ]
    );

    await emitirEvento(client, {
      empresaId: ctx.empresaId,
      centroId: await centroDeCaja(client, sesion.registerId),
      registerId: sesion.registerId,
      sessionId: e.sessionId,
      agregado: { tipo: "SESSION", id: e.sessionId },
      tipo: "SESSION_CLOSED",
      ocurridoEnMs: Date.now(),
      actorUserId: ctx.userId,
      // El ingreso bancario apartado es lo que Central necesita para la
      // posición global: es dinero que ya no vuelve a la caja.
      datos: {
        fecha: sesion.fecha,
        cambioFinalCentimos: reparto.totalCambio,
        ingresoBancarioCentimos: reparto.totalIngreso,
        diferenciaCentimos: comparacion.diferencia,
      },
    });

    const sesionFinal = (await obtenerSesion(e.sessionId, client))!;
    return {
      sesion: sesionFinal,
      cambioFinal: [...e.cambioFinal].sort((a, b) => b.valor - a.valor),
      cambioFinalCartuchos: cambioFinalTubos,
      cambioFinalBolsas,
      ingresoBancario: reparto.ingresoBancario,
      ingresoBancarioCartuchos: reparto.ingresoTubos,
      ingresoBancarioBolsas: reparto.ingresoBolsas,
      totalCambioCentimos: reparto.totalCambio,
      totalIngresoCentimos: reparto.totalIngreso,
      diferenciaCentimos: comparacion.diferencia,
      denominacionesCuadran: comparacion.cuadranDenominaciones,
    };
  });

  await registrarAuditoria({
    empresaId: ctx.empresaId,
    userId: ctx.userId,
    accion: "cash.session.close",
    entidad: "cash_sessions",
    entidadId: String(e.sessionId),
    detalle: {
      cambioFinal: resultado.cambioFinal,
      ingresoBancario: resultado.ingresoBancario,
      totalCambioCentimos: resultado.totalCambioCentimos,
      totalIngresoCentimos: resultado.totalIngresoCentimos,
      diferenciaCentimos: resultado.diferenciaCentimos,
      denominacionesCuadran: resultado.denominacionesCuadran,
    },
    ip: ctx.ip,
  });

  return resultado;
}

/**
 * Propuesta de composición del cambio final a partir del último arqueo.
 *
 * Los tubos precintados se quedan en caja mientras quepan en el objetivo: son
 * cambio listo para mañana y abrirlos es irreversible, así que mandarlos al
 * banco sería tirar por la borda justo lo que hace falta en el mostrador. El
 * resto se completa con monedas sueltas, empezando por el menudo.
 */
export async function proponerCierre(
  sessionId: number,
  objetivoCentimos: Centimos
): Promise<{
  cambioFinal: LineaDenominacion[];
  cambioFinalCartuchos: LineaDenominacion[];
  cambioFinalBolsas: LineaDenominacion[];
  ingresoBancario: LineaDenominacion[];
  ingresoBancarioCartuchos: LineaDenominacion[];
  ingresoBancarioBolsas: LineaDenominacion[];
}> {
  // Solo el arqueo MÁS RECIENTE. Antes se sumaban las líneas de todos, así que
  // con dos arqueos en la misma jornada el contado salía duplicado.
  const { rows: ultimo } = await pool.query<{ id: number }>(
    `SELECT id FROM cash_counts WHERE session_id = $1 ORDER BY id DESC LIMIT 1`,
    [sessionId]
  );
  if (ultimo.length === 0) {
    throw new ErrorCaja("FALTA_ARQUEO", "Hay que hacer el arqueo antes de preparar el cierre.", 409);
  }

  const { rows } = await pool.query(
    `SELECT valor_unitario_centimos, cantidad_contada, cartuchos_contados, bolsas_contadas
       FROM cash_count_lines WHERE count_id = $1`,
    [ultimo[0].id]
  );

  const denominaciones = await cargarDenominaciones(pool);
  const porCartucho = piezasPorCartuchoDe(denominaciones);
  const porBolsa = piezasPorBolsaDe(denominaciones);

  const columna = (campo: "cantidad_contada" | "cartuchos_contados" | "bolsas_contadas") =>
    rows
      .map((r: Record<string, number>) => ({
        valor: r.valor_unitario_centimos,
        cantidad: Number(r[campo] ?? 0),
      }))
      .filter((l: LineaDenominacion) => l.cantidad > 0)
      .sort((a: LineaDenominacion, b: LineaDenominacion) => a.valor - b.valor);

  const sueltas = inventarioDesdeLineas(columna("cantidad_contada"));
  const tubos = columna("cartuchos_contados");
  const sacos = columna("bolsas_contadas");

  let restante = objetivoCentimos;

  /**
   * Envases que se quedan: los de menor valor primero, mientras quepan.
   *
   * Los cartuchos se reparten antes que las bolsas, al revés que al romper: lo
   * que se conserva precintado para mañana es el cartucho, que es lo que el
   * cajón necesita ordenado. Una bolsa se abre en cuanto hace falta suelto, así
   * que quedársela no aporta gran cosa.
   */
  const repartirEnvases = (envases: LineaDenominacion[], por: ReadonlyMap<Centimos, number>) => {
    const quedan: LineaDenominacion[] = [];
    for (const t of envases) {
      const valorEnvase = t.valor * (por.get(t.valor) ?? 0);
      if (valorEnvase <= 0) continue;
      const caben = Math.min(t.cantidad, Math.floor(restante / valorEnvase));
      if (caben > 0) {
        quedan.push({ valor: t.valor, cantidad: caben });
        restante -= valorEnvase * caben;
      }
    }
    return quedan;
  };

  const cambioFinalCartuchos = repartirEnvases(tubos, porCartucho);
  const cambioFinalBolsas = repartirEnvases(sacos, porBolsa);

  const cambioFinal = proponerCambioFinal(sueltas, restante);

  const repartoSueltas = repartirCierre(sueltas, cambioFinal);
  const repartoTubos = repartirCierre(inventarioDesdeLineas(tubos), cambioFinalCartuchos);
  const repartoBolsas = repartirCierre(inventarioDesdeLineas(sacos), cambioFinalBolsas);

  return {
    cambioFinal,
    cambioFinalCartuchos,
    cambioFinalBolsas,
    ingresoBancario: repartoSueltas.ok ? repartoSueltas.ingresoBancario : [],
    ingresoBancarioCartuchos: repartoTubos.ok ? repartoTubos.ingresoBancario : [],
    ingresoBancarioBolsas: repartoBolsas.ok ? repartoBolsas.ingresoBancario : [],
  };
}

// ── Reapertura y reversión ─────────────────────────────────────────────────

/**
 * Composición que dejó un cierre: las piezas de su cambio final.
 *
 * Se usa al abrir —para heredar— y al traer el fondo a una jornada que se
 * abrió sin él, así que vive en un sitio y no en dos que se van separando.
 */
async function composicionDeCierre(
  client: PoolClient | typeof pool,
  sessionId: number
): Promise<{
  composicion: LineaDenominacion[];
  cartuchos: LineaDenominacion[];
  bolsas: LineaDenominacion[];
}> {
  const { rows } = await client.query(
    `SELECT valor_unitario_centimos,
            SUM(CASE WHEN cartuchos = 0 AND bolsas = 0 THEN cantidad ELSE 0 END) AS sueltas,
            SUM(cartuchos) AS tubos,
            SUM(bolsas) AS sacos
       FROM cash_denomination_movements
      WHERE session_id = $1 AND motivo = 'CLOSING_FLOAT' AND direccion = 'OUT'
      GROUP BY valor_unitario_centimos`,
    [sessionId]
  );
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const columna = (nombre: string) =>
    (rows as any[])
      .map((r) => ({ valor: r.valor_unitario_centimos, cantidad: Number(r[nombre]) }))
      .filter((l) => l.cantidad > 0);
  /* eslint-enable @typescript-eslint/no-explicit-any */
  return {
    composicion: columna("sueltas"),
    cartuchos: columna("tubos"),
    bolsas: columna("sacos"),
  };
}

/**
 * El último cierre ANTERIOR a una fecha que de verdad dejó cambio en el cajón.
 *
 * No basta con «el último cerrado»: una jornada que se cerró a cero —una
 * apertura en falso que se cerró en vez de anularse, un día que acabó con la
 * caja vacía— corta la cadena, y la jornada siguiente amanece sin fondo aunque
 * el dinero siguiera físicamente en el cajón. Aquí se salta hacia atrás hasta
 * encontrar uno con piezas, que es lo que uno esperaría al mirar la bandeja.
 */
export async function ultimoCierreConCambio(
  registerId: number,
  hasta: string,
  excluyendo: number,
  // Dentro de una transacción se pasa su client; suelto, el pool basta.
  client: PoolClient | typeof pool = pool
): Promise<{
  sesionId: number;
  fecha: string;
  totalCentimos: Centimos;
  composicion: LineaDenominacion[];
  cartuchos: LineaDenominacion[];
  bolsas: LineaDenominacion[];
} | null> {
  // 20 cierres hacia atrás dan de sobra: más de veinte cierres seguidos en
  // falso ya no es un despiste, es otra cosa, y mejor que alguien mire.
  const { rows } = await client.query<{ id: number; fecha: string }>(
    `SELECT id, fecha::text AS fecha FROM cash_sessions
      WHERE register_id = $1 AND estado = 'CLOSED'
        AND fecha <= $2::date AND id <> $3
      ORDER BY fecha DESC, id DESC LIMIT 20`,
    [registerId, hasta, excluyendo]
  );

  const denominaciones = await cargarDenominaciones(client);
  const porCartucho = piezasPorCartuchoDe(denominaciones);
  const porBolsa = piezasPorBolsaDe(denominaciones);

  for (const s of rows) {
    const piezas = await composicionDeCierre(client, s.id);
    const total = totalInventario(
      inventarioDesdeLineas([
        ...piezas.composicion,
        ...aPiezas(piezas.cartuchos, porCartucho, "cartuchos"),
        ...aPiezas(piezas.bolsas, porBolsa, "bolsas"),
      ])
    );
    if (total > 0) {
      return { sesionId: s.id, fecha: s.fecha, totalCentimos: total, ...piezas };
    }
  }
  return null;
}

/**
 * Trae a una jornada ABIERTA el cambio que dejó un cierre anterior.
 *
 * Para la jornada que se abrió sin fondo porque la cadena de herencia estaba
 * rota: el cierre inmediatamente anterior no dejó cambio —se cerró a cero— y
 * la de hoy amaneció con 0,00 € aunque el dinero siguiera en el cajón.
 *
 * Se asienta como el fondo de apertura que tenía que haber tenido: mismo
 * motivo `OPENING_FLOAT` y misma composición, envases incluidos. No se toca
 * nada de lo ya registrado hoy, así que los cobros que ya se hubieran metido
 * siguen donde estaban y el teórico sube justo lo que entra.
 *
 * Solo sobre una jornada que NO tenga ya fondo: si lo tuviera, esto lo
 * duplicaría, y un fondo duplicado no se ve hasta que el arqueo descuadra por
 * la cifra exacta del cambio.
 */
export async function traerFondoDeCierre(
  ctx: Contexto,
  e: { sessionId: number; sesionOrigenId?: number; motivo: string }
): Promise<Sesion> {
  if (!e.motivo?.trim()) {
    throw new ErrorCaja("FALTA_MOTIVO", "Traer el fondo de un cierre exige indicar el motivo.", 400);
  }

  const sesion = await enTransaccion(async (client) => {
    const s = await bloquearSesion(client, e.sessionId);
    if (s.empresaId !== ctx.empresaId) {
      throw new ErrorCaja("JORNADA_DE_OTRA_EMPRESA", "La jornada no pertenece a tu empresa.", 403);
    }
    if (s.estado !== "OPEN" && s.estado !== "REOPENED") {
      throw new ErrorCaja("JORNADA_NO_ABIERTA", "Solo se puede hacer con la jornada abierta.", 409);
    }
    if (s.fondoInicialCentimos > 0) {
      throw new ErrorCaja(
        "JORNADA_YA_TIENE_FONDO",
        `Esta jornada ya tiene un fondo de ${formatearEuros(s.fondoInicialCentimos)} €. Traer otro lo duplicaría.`,
        409
      );
    }

    // El origen: el que se pida, o el último cierre anterior con cambio.
    let origenId = e.sesionOrigenId;
    if (!origenId) {
      const cand = await ultimoCierreConCambio(s.registerId, s.fecha, e.sessionId);
      if (!cand) {
        throw new ErrorCaja(
          "SIN_CIERRE_ANTERIOR",
          "No hay ningún cierre anterior a esta fecha que dejara cambio en el cajón.",
          409
        );
      }
      origenId = cand.sesionId;
    }

    const { rows: org } = await client.query<{ id: number; fecha: string; estado: string; register_id: number }>(
      `SELECT id, fecha::text AS fecha, estado, register_id FROM cash_sessions WHERE id = $1`,
      [origenId]
    );
    if (org.length === 0 || org[0].estado !== "CLOSED") {
      throw new ErrorCaja("JORNADA_NO_CERRADA", "El origen tiene que ser una jornada cerrada.", 409);
    }
    if (org[0].register_id !== s.registerId) {
      throw new ErrorCaja("CAJA_DISTINTA", "Ese cierre es de otra caja.", 409);
    }

    const piezas = await composicionDeCierre(client, origenId);
    const denominaciones = await cargarDenominaciones(client);
    const porCartucho = piezasPorCartuchoDe(denominaciones);
    const porBolsa = piezasPorBolsaDe(denominaciones);
    const lineasCartucho = aPiezas(piezas.cartuchos, porCartucho, "cartuchos");
    const lineasBolsa = aPiezas(piezas.bolsas, porBolsa, "bolsas");
    const lineas = [...piezas.composicion, ...lineasCartucho, ...lineasBolsa];
    if (lineas.length === 0) {
      throw new ErrorCaja(
        "CIERRE_SIN_CAMBIO",
        `El cierre del ${org[0].fecha} no dejó nada en el cajón.`,
        409
      );
    }

    const fondo = totalInventario(inventarioDesdeLineas(lineas));
    const ahora = Date.now();
    const anio = Number(s.fecha.slice(0, 4));
    const numero = await siguienteNumero(client, s.id, "OPENING_FLOAT", anio);

    const opId = await insertarOperacion(client, {
      empresaId: ctx.empresaId,
      sessionId: s.id,
      numero,
      tipo: "OPENING_FLOAT",
      origen: "MANUAL",
      concepto: `Cambio heredado del cierre del ${org[0].fecha}`,
      importeCentimos: fondo,
      efectivoNetoCentimos: fondo,
      erpSyncStatus: "NOT_APPLICABLE",
      userId: ctx.userId,
      ahora,
    });
    await insertarMovimientos(client, {
      sessionId: s.id,
      operationId: opId,
      movimientos: [{ direccion: "IN", motivo: "OPENING_FLOAT", lineas }],
      denominaciones,
      userId: ctx.userId,
      ahora,
    });

    await client.query(
      `UPDATE cash_sessions
          SET fondo_inicial_centimos = $2, fondo_inicial_heredado = true,
              sesion_anterior_id = $3,
              notas = COALESCE(NULLIF(notas, '') || ' · ', '') || $4,
              updated_at_ms = $5
        WHERE id = $1`,
      [s.id, fondo, origenId, `Fondo traído del cierre del ${org[0].fecha}: ${e.motivo.trim()}`, ahora]
    );

    return (await obtenerSesion(s.id, client))!;
  });

  await registrarAuditoria({
    empresaId: ctx.empresaId,
    userId: ctx.userId,
    accion: "cash.session.inherit_float",
    entidad: "cash_sessions",
    entidadId: String(e.sessionId),
    detalle: { motivo: e.motivo, sesionOrigenId: e.sesionOrigenId ?? null },
    ip: ctx.ip,
  });

  return sesion;
}

export async function reabrirJornada(ctx: Contexto, sessionId: number, motivo: string): Promise<Sesion> {
  if (!motivo?.trim()) {
    throw new ErrorCaja("FALTA_MOTIVO", "Reabrir una jornada exige indicar el motivo.", 400);
  }

  const sesion = await enTransaccion(async (client) => {
    const s = await bloquearSesion(client, sessionId);
    await exigirJornadaPropia(client, ctx, s);
    if (s.estado !== "CLOSED") {
      throw new ErrorCaja("JORNADA_NO_CERRADA", "Solo se puede reabrir una jornada cerrada.", 409);
    }

    // Separación de funciones: quien cerró la jornada no la reabre. Reabrir
    // permite recerrar con otras cifras, así que es la otra mitad del camino
    // que la anulación abre.
    await exigirOtraPersona(ctx.empresaId, ctx, s.cerradaPor, "reabrir esta jornada");

    const abierta = await sesionAbierta(s.registerId, client);
    if (abierta) {
      throw new ErrorCaja(
        "JORNADA_YA_ABIERTA",
        "Esa caja tiene otra jornada abierta; ciérrala antes de reabrir ésta.",
        409
      );
    }

    /*
     * Una jornada cuyo importe "para el banco" ya forma parte de un ingreso
     * bancario confirmado no se puede reabrir: al volver a cerrarla, su
     * importe cambiaría y el ingreso quedaría conciliando un número que ya no
     * existe. Primero se anula el ingreso, luego se reabre.
     */
    const { rows: conciliada } = await client.query(
      `SELECT d.numero
         FROM cash_bank_deposit_sessions l
         JOIN cash_bank_deposits d ON d.id = l.deposit_id
        WHERE l.session_id = $1 AND l.vigente`,
      [sessionId]
    );
    if (conciliada.length > 0) {
      throw new ErrorCaja(
        "JORNADA_CONCILIADA",
        `Esta jornada forma parte del ingreso bancario ${conciliada[0].numero}. Anula el ingreso antes de reabrirla.`,
        409
      );
    }

    await client.query(
      `UPDATE cash_sessions SET estado = 'REOPENED', updated_at_ms = $2 WHERE id = $1`,
      [sessionId, Date.now()]
    );

    await emitirEvento(client, {
      empresaId: ctx.empresaId,
      centroId: await centroDeCaja(client, s.registerId),
      registerId: s.registerId,
      sessionId,
      agregado: { tipo: "SESSION", id: sessionId },
      tipo: "SESSION_REOPENED",
      ocurridoEnMs: Date.now(),
      actorUserId: ctx.userId,
      // El motivo viaja: una reapertura sin explicación es exactamente lo que
      // MC Central tiene que poder mirar.
      datos: { motivo: motivo.trim() },
    });

    return (await obtenerSesion(sessionId, client))!;
  });

  await registrarAuditoria({
    empresaId: ctx.empresaId,
    userId: ctx.userId,
    accion: "cash.session.reopen",
    entidad: "cash_sessions",
    entidadId: String(sessionId),
    detalle: { motivo },
    ip: ctx.ip,
  });

  return sesion;
}

/**
 * Anula una jornada abierta por error.
 *
 * Existe para el despiste concreto de abrir la jornada de HOY cuando lo que se
 * quería era registrar un día atrasado que se llevó en papel: con la equivocada
 * abierta, la caja no deja abrir ninguna otra, y cerrarla en falso sembraría el
 * histórico con un cierre basura que además entraría en la herencia del fondo.
 *
 * Solo se anula una jornada VACÍA: sin cobros, sin pagos, sin movimientos, sin
 * arqueos y sin documentos; como mucho su fondo de apertura. Una jornada con
 * dinero movido no se esfuma: sus operaciones se anulan una a una, con su
 * reversión y su rastro, y solo entonces queda vacía.
 *
 * Anular no borra nada. La jornada pasa a CANCELLED —sigue en el histórico,
 * como «Anulada»— y su fondo de apertura a CANCELLED con ella. No hace falta
 * revertir sus movimientos: el stock se reconstruye POR JORNADA, así que los
 * asientos de una cancelada no pisan a nadie; y todo lo que decide algo mira
 * el estado (`sesionAbierta` no la ve, la herencia solo mira CLOSED, los
 * informes salen de jornadas cerradas).
 */
export async function anularJornada(
  ctx: Contexto,
  sessionId: number,
  motivo: string
): Promise<Sesion> {
  if (!motivo?.trim()) {
    throw new ErrorCaja("FALTA_MOTIVO", "Anular una jornada exige indicar el motivo.", 400);
  }

  const sesion = await enTransaccion(async (client) => {
    const s = await bloquearSesion(client, sessionId);
    if (s.empresaId !== ctx.empresaId) {
      throw new ErrorCaja("JORNADA_DE_OTRA_EMPRESA", "La jornada no pertenece a tu empresa.", 403);
    }
    /*
     * PENDING_CLOSE tampoco vale: significa que ya hay un arqueo guardado, y
     * un arqueo es trabajo hecho sobre esta jornada. Quien llegó hasta ahí no
     * está ante un despiste de apertura.
     */
    if (s.estado !== "OPEN" && s.estado !== "REOPENED") {
      throw new ErrorCaja(
        "JORNADA_NO_ABIERTA",
        "Solo se puede anular una jornada abierta. Una cerrada se reabre; una anulada ya lo está.",
        409
      );
    }

    /*
     * Cuentan como «trabajo» solo las operaciones VIVAS. Una original ya
     * REVERSED y su reversión se compensan a cero y son justo el rastro de
     * haber deshecho las cosas una a una — que es lo que se pide antes de
     * poder anular la jornada. Si bloquearan, la jornada con un cobro anulado
     * no se podría anular nunca.
     */
    const { rows: ops } = await client.query<{
      id: number;
      tipo: string;
      numero: string;
      estado: string;
      reversa_de_id: number | null;
    }>(
      `SELECT id, tipo, numero, estado, reversa_de_id FROM cash_operations
        WHERE session_id = $1 AND estado <> 'CANCELLED'`,
      [sessionId]
    );
    const ajenas = ops.filter(
      (o) => o.tipo !== "OPENING_FLOAT" && o.estado !== "REVERSED" && o.reversa_de_id == null
    );
    if (ajenas.length > 0) {
      throw new ErrorCaja(
        "JORNADA_CON_OPERACIONES",
        `La jornada tiene ${ajenas.length} ${ajenas.length === 1 ? "operación registrada" : "operaciones registradas"} (${ajenas
          .slice(0, 3)
          .map((o) => o.numero)
          .join(", ")}${ajenas.length > 3 ? "…" : ""}). Anúlalas una a una antes de anular la jornada.`,
        409
      );
    }

    const { rows: arqueos } = await client.query(
      `SELECT COUNT(*)::int AS n FROM cash_counts WHERE session_id = $1`,
      [sessionId]
    );
    if (arqueos[0].n > 0) {
      throw new ErrorCaja(
        "JORNADA_CON_ARQUEO",
        "La jornada ya tiene un arqueo guardado: no es una apertura en falso. Si aun así sobra, ciérrala y déjalo escrito en las notas.",
        409
      );
    }

    const { rows: docs } = await client.query(
      `SELECT COUNT(*)::int AS n FROM cash_operation_documents
        WHERE session_id = $1 AND NOT anulado`,
      [sessionId]
    );
    if (docs[0].n > 0) {
      throw new ErrorCaja(
        "JORNADA_CON_DOCUMENTOS",
        "La jornada tiene justificantes adjuntos. Retíralos antes de anularla.",
        409
      );
    }

    const ahora = Date.now();
    /*
     * El fondo de apertura cae con la jornada: sin esto quedaría como una
     * operación viva colgando de una jornada que ya no existe a ningún
     * efecto. Las parejas ya anuladas (REVERSED + reversión) se quedan como
     * están: son el rastro de lo que pasó, no operaciones vivas.
     */
    for (const o of ops) {
      if (o.tipo !== "OPENING_FLOAT" || o.estado === "REVERSED" || o.reversa_de_id != null) continue;
      await client.query(
        `UPDATE cash_operations SET estado = 'CANCELLED', updated_at_ms = $2 WHERE id = $1`,
        [o.id, ahora]
      );
    }

    // El motivo queda EN la jornada, no solo en la auditoría: el histórico lo
    // enseña sin tener que ir a buscar quién la anuló a otra tabla.
    await client.query(
      `UPDATE cash_sessions
          SET estado = 'CANCELLED', cerrada_por = $2, cerrada_at_ms = $3,
              notas = COALESCE(NULLIF(notas, '') || ' · ', '') || $4,
              updated_at_ms = $3
        WHERE id = $1`,
      [sessionId, ctx.userId, ahora, `Anulada: ${motivo.trim()}`]
    );
    return (await obtenerSesion(sessionId, client))!;
  });

  await registrarAuditoria({
    empresaId: ctx.empresaId,
    userId: ctx.userId,
    accion: "cash.session.cancel",
    entidad: "cash_sessions",
    entidadId: String(sessionId),
    detalle: { motivo },
    ip: ctx.ip,
  });

  return sesion;
}

/**
 * Anula una operación por reversión.
 *
 * Nunca se borra un movimiento que ya afectó al stock: se asienta la operación
 * inversa. La original se marca REVERSED y las dos quedan en el histórico
 * enlazadas, que es lo que permite explicar después qué pasó.
 */
export async function anularOperacion(
  ctx: Contexto,
  operationId: number,
  motivo: string
): Promise<{ operacionId: number; numero: string }> {
  if (!motivo?.trim()) {
    throw new ErrorCaja("FALTA_MOTIVO", "Anular una operación exige indicar el motivo.", 400);
  }

  const resultado = await enTransaccion(async (client) => {
    const original = await obtenerOperacion(client, operationId);
    if (!original) throw new ErrorCaja("OPERACION_NO_ENCONTRADA", "La operación no existe.", 404);
    if (original.estado !== "CONFIRMED") {
      throw new ErrorCaja(
        "OPERACION_NO_ANULABLE",
        `La operación está en estado ${original.estado}.`,
        409
      );
    }

    const { rows } = await client.query(`SELECT session_id FROM cash_operations WHERE id = $1`, [
      operationId,
    ]);
    const sessionId = rows[0].session_id as number;
    const sesion = await bloquearSesionOperable(client, sessionId);
    await exigirJornadaPropia(client, ctx, sesion);

    /*
     * Separación de funciones: quien registró el cobro no lo anula.
     *
     * Anular es una de las dos acciones que borran el rastro de un descuadre
     * —la otra es reabrir una jornada— y encadenarlas la misma persona sin
     * testigo es el camino clásico para cuadrar una caja de la que ha salido
     * dinero. Viene apagado; se enciende donde hay gente suficiente.
     */
    await exigirOtraPersona(
      ctx.empresaId,
      ctx,
      await autorDeOperacion(client, operationId),
      "anular esta operación"
    );

    // Los mismos movimientos del revés.
    const originales = await movimientosDeOperacion(client, operationId);
    const inversos = originales.map((m) => ({
      direccion: (m.direccion === "IN" ? "OUT" : "IN") as "IN" | "OUT",
      motivo: m.motivo,
      lineas: m.lineas,
    }));

    // Devolver lo que entró exige que siga estando: si el billete de 100 € ya se
    // ha usado para dar un cambio, la reversión no puede hacerse a ciegas.
    const stock = await stockTeorico(client, sessionId);
    for (const mov of inversos.filter((m) => m.direccion === "OUT")) {
      for (const l of mov.lineas) {
        const disponible = stock.get(l.valor) ?? 0;
        if (l.cantidad > disponible) {
          throw new ErrorCaja(
            "STOCK_INSUFICIENTE",
            `Para anular hay que devolver ${l.cantidad} piezas de ${l.valor} céntimos y en caja quedan ${disponible}.`,
            409
          );
        }
      }
    }

    const denominaciones = await cargarDenominaciones(client);
    const ahora = Date.now();
    const anio = Number(sesion.fecha.slice(0, 4));
    const numero = await siguienteNumero(client, sesion.id, original.tipo, anio);

    const nuevaId = await insertarOperacion(client, {
      empresaId: ctx.empresaId,
      sessionId,
      numero,
      tipo: original.tipo,
      origen: original.origen,
      externalSystem: original.externalSystem,
      externalDocumentId: original.externalDocumentId,
      externalDocumentReference: original.externalDocumentReference,
      partyNombre: original.partyNombre,
      concepto: `Reversión de ${original.numero}`,
      referencia: original.referencia,
      importeCentimos: original.importeCentimos,
      efectivoNetoCentimos: -original.efectivoNetoCentimos,
      erpSyncStatus: original.erpSyncStatus === "SYNCED" ? "PENDING" : "NOT_APPLICABLE",
      reversaDeId: operationId,
      motivoReversa: motivo,
      userId: ctx.userId,
      ahora,
    });

    const formas = await formasPagoDeOperacion(client, operationId);
    await insertarFormasPago(client, nuevaId, formas, ahora);

    await insertarMovimientos(client, {
      sessionId,
      operationId: nuevaId,
      movimientos: inversos,
      denominaciones,
      userId: ctx.userId,
      ahora,
    });

    await client.query(
      `UPDATE cash_operations SET estado = 'REVERSED', updated_at_ms = $2 WHERE id = $1`,
      [operationId, ahora]
    );

    /*
     * La anulación es un hecho nuevo, no la retirada del anterior. Central
     * recibe los dos —el cobro y su reverso— porque así es como está en el
     * libro mayor: aquí nada se borra, se compensa.
     */
    await emitirEvento(client, {
      empresaId: ctx.empresaId,
      centroId: await centroDeCaja(client, sesion.registerId),
      registerId: sesion.registerId,
      sessionId,
      agregado: { tipo: "SESSION", id: sessionId },
      tipo: "OPERATION_REVERSED",
      ocurridoEnMs: ahora,
      actorUserId: ctx.userId,
      datos: {
        operacionAnuladaId: operationId,
        operacionInversaId: nuevaId,
        numero,
        tipoOperacion: original.tipo,
        importeCentimos: original.importeCentimos,
        motivo: motivo?.trim() ?? null,
      },
    });

    // Si el cobro ya llegó a la ERP, hay que avisarla también de la anulación.
    if (original.erpSyncStatus === "SYNCED" && original.externalDocumentId) {
      const { conector } = await conectorPara(ctx.empresaId);
      if (conector) {
        await encolarEventoErp(client, {
          empresaId: ctx.empresaId,
          operationId: nuevaId,
          connectorKey: conector.info.key,
          evento: original.tipo === "COLLECTION" ? "COLLECTION_REVERSED" : "PAYMENT_REVERSED",
          idempotencyKey: numero,
          payload: {
            externalSystem: original.externalSystem,
            externalDocumentId: original.externalDocumentId,
            operacionNumero: original.numero,
            motivo,
          },
          ahora,
        });
      }
    }

    return { operacionId: nuevaId, numero };
  });

  await registrarAuditoria({
    empresaId: ctx.empresaId,
    userId: ctx.userId,
    accion: "cash.operation.reverse",
    entidad: "cash_operations",
    entidadId: String(operationId),
    detalle: { motivo, reversaId: resultado.operacionId, reversaNumero: resultado.numero },
    ip: ctx.ip,
  });

  return resultado;
}

// ── Outbox ─────────────────────────────────────────────────────────────────

/**
 * Encola un evento para la ERP DENTRO de la transacción de la operación.
 *
 * Éste es el detalle que evita el fallo grave: si el evento se mandara a la ERP
 * en caliente y la ERP contestara 503, o bien se pierde el aviso o bien hay que
 * deshacer un cobro cuyo dinero ya está físicamente en el cajón. Guardándolo
 * aquí, el cobro es firme y el aviso es un pendiente que el worker resolverá.
 *
 * `ON CONFLICT DO NOTHING` sobre la clave de idempotencia: reintentar la misma
 * operación no encola el evento dos veces.
 */
async function encolarEventoErp(
  client: PoolClient,
  e: {
    empresaId: string;
    operationId: number;
    connectorKey: string;
    evento: string;
    idempotencyKey: string;
    payload: unknown;
    ahora: number;
  }
): Promise<void> {
  await client.query(
    `INSERT INTO cash_erp_outbox
       (empresa_id, operation_id, connector_key, evento, idempotency_key, payload,
        estado, intentos, proximo_intento_ms, created_at_ms)
     VALUES ($1,$2,$3,$4,$5,$6,'PENDING',0,$7,$7)
     ON CONFLICT (idempotency_key) DO NOTHING`,
    [e.empresaId, e.operationId, e.connectorKey, e.evento, e.idempotencyKey, JSON.stringify(e.payload), e.ahora]
  );
}

// ── Resumen de jornada (dashboard) ─────────────────────────────────────────

export type ResumenJornada = {
  sesion: Sesion;
  /** Piezas totales por valor, tubos incluidos: es el dinero disponible. */
  stock: LineaDenominacion[];
  /** De esas piezas, cuántas están sueltas. */
  stockSueltas: LineaDenominacion[];
  /** Tubos precintados por valor de la moneda. */
  stockCartuchos: LineaDenominacion[];
  /** Bolsas precintadas por valor de la moneda. */
  stockBolsas: LineaDenominacion[];
  /**
   * Denominaciones con el saldo de formato en negativo: salió un envase que
   * nunca entró. Vacío en una jornada sana. Se informa en vez de reventar,
   * para que el papeleo de una jornada ya cerrada siga saliendo.
   */
  incidenciasStock: IncidenciaFormato[];
  totalStockCentimos: Centimos;
  piezas: number;
  porFormaPago: { forma: string; importeCentimos: Centimos }[];
  cobros: { erpCentimos: Centimos; manualCentimos: Centimos; totalCentimos: Centimos };
  pagos: { erpCentimos: Centimos; manualCentimos: Centimos; totalCentimos: Centimos };
  salidasCentimos: Centimos;
  entregasCentimos: Centimos;
  operaciones: number;
  pendientesErp: number;
  /**
   * El arqueo más reciente de la jornada, si lo hay.
   *
   * El cierre reparte **lo contado**, no el teórico, así que la pantalla
   * necesita las piezas que se contaron de verdad. Sin esto usaba el stock
   * teórico y, con un descuadre, pedía repartir un dinero que físicamente no
   * estaba: el reparto no cuadraba nunca y no se podía cerrar.
   */
  ultimoArqueo: {
    id: number;
    sueltas: LineaDenominacion[];
    cartuchos: LineaDenominacion[];
    bolsas: LineaDenominacion[];
    totalCentimos: Centimos;
    diferenciaCentimos: Centimos;
    creadoAtMs: number;
  } | null;
  /**
   * Reparto por sección de negocio. **Dato informativo, no un segundo arqueo**:
   * el cajón es uno solo y este dinero no está separado físicamente. Sirve para
   * saber cuánto ha aportado cada negocio, no para cuadrarlos por separado.
   */
  porSeccion: {
    sectionId: number | null;
    nombre: string;
    cobrosCentimos: Centimos;
    pagosCentimos: Centimos;
    /** Efectivo neto: lo que de verdad ha movido el cajón esa sección. */
    efectivoNetoCentimos: Centimos;
    /** Tiene su propia caja en la ERP y se arquea por separado. */
    arqueaAparte: boolean;
    operaciones: number;
  }[];
};

export async function resumenJornada(sessionId: number): Promise<ResumenJornada> {
  const sesion = await obtenerSesion(sessionId);
  if (!sesion) throw new ErrorCaja("JORNADA_NO_ENCONTRADA", "La jornada no existe.", 404);

  /*
   * Igual que en `stockDeJornada`: esto se lee para informar, así que una
   * incoherencia de formato viaja como aviso. Es lo que hace que el informe de
   * una jornada ya cerrada siga imprimiéndose.
   */
  const [inv, porFormato] = await Promise.all([
    stockTeorico(pool, sessionId),
    stockPorFormatoBruto(pool, sessionId),
  ]);

  // Los totales por forma de pago salen de las operaciones vivas: una anulada y
  // su reversión se compensan solas porque la reversión no se cuenta y la
  // original deja de estar CONFIRMED.
  const { rows: formas } = await pool.query(
    `SELECT p.forma_pago, SUM(p.importe_centimos) AS importe
       FROM cash_operation_payments p
       JOIN cash_operations o ON o.id = p.operation_id
      WHERE o.session_id = $1 AND o.estado = 'CONFIRMED'
        AND o.tipo IN ('COLLECTION','PAYMENT')
      GROUP BY p.forma_pago`,
    [sessionId]
  );

  const { rows: porTipo } = await pool.query(
    `SELECT tipo, origen, SUM(importe_centimos) AS importe, COUNT(*) AS n
       FROM cash_operations
      WHERE session_id = $1 AND estado = 'CONFIRMED'
      GROUP BY tipo, origen`,
    [sessionId]
  );

  const suma = (tipo: string, origen?: string): Centimos =>
    porTipo
      .filter((r: { tipo: string; origen: string }) => r.tipo === tipo && (!origen || r.origen === origen))
      .reduce((a: number, r: { importe: string }) => a + Number(r.importe), 0);

  /*
   * Reparto por sección. Las operaciones anteriores al catálogo no tienen
   * ninguna y salen agrupadas como «Sin sección» en vez de repartirse a ojo
   * entre las que hay: un número inventado es peor que un hueco declarado.
   */
  const { rows: secciones } = await pool.query(
    `SELECT o.section_id,
            COALESCE(sec.nombre, 'Sin sección') AS nombre,
            COALESCE(sec.arquea_aparte, false) AS arquea_aparte,
            SUM(CASE WHEN o.tipo = 'COLLECTION' THEN o.importe_centimos ELSE 0 END) AS cobros,
            SUM(CASE WHEN o.tipo IN ('PAYMENT','MANUAL_OUT') THEN o.importe_centimos ELSE 0 END) AS pagos,
            SUM(o.efectivo_neto_centimos) AS efectivo,
            COUNT(*) AS n
       FROM cash_operations o
       LEFT JOIN cash_sections sec ON sec.id = o.section_id
      WHERE o.session_id = $1 AND o.estado = 'CONFIRMED'
        AND o.tipo IN ('COLLECTION','PAYMENT','MANUAL_OUT')
      GROUP BY o.section_id, sec.nombre, sec.orden, sec.arquea_aparte
      ORDER BY sec.orden NULLS LAST, sec.nombre`,
    [sessionId]
  );

  /*
   * El arqueo más reciente, con sus piezas. Solo el último: con dos arqueos en
   * la misma jornada, sumar las líneas de todos duplicaría lo contado.
   */
  const { rows: arqueoCab } = await pool.query(
    `SELECT id, contado_centimos, diferencia_centimos, created_at_ms
       FROM cash_counts WHERE session_id = $1 ORDER BY id DESC LIMIT 1`,
    [sessionId]
  );
  let ultimoArqueo: ResumenJornada["ultimoArqueo"] = null;
  if (arqueoCab.length > 0) {
    const { rows: lineasArqueo } = await pool.query(
      `SELECT valor_unitario_centimos, cantidad_contada, cartuchos_contados, bolsas_contadas
         FROM cash_count_lines WHERE count_id = $1`,
      [arqueoCab[0].id]
    );
    /* eslint-disable @typescript-eslint/no-explicit-any */
    ultimoArqueo = {
      id: arqueoCab[0].id,
      sueltas: lineasArqueo
        .map((r: any) => ({ valor: r.valor_unitario_centimos, cantidad: Number(r.cantidad_contada) }))
        .filter((l: LineaDenominacion) => l.cantidad > 0),
      cartuchos: lineasArqueo
        .map((r: any) => ({ valor: r.valor_unitario_centimos, cantidad: Number(r.cartuchos_contados) }))
        .filter((l: LineaDenominacion) => l.cantidad > 0),
      bolsas: lineasArqueo
        .map((r: any) => ({ valor: r.valor_unitario_centimos, cantidad: Number(r.bolsas_contadas) }))
        .filter((l: LineaDenominacion) => l.cantidad > 0),
      totalCentimos: Number(arqueoCab[0].contado_centimos),
      diferenciaCentimos: Number(arqueoCab[0].diferencia_centimos),
      creadoAtMs: Number(arqueoCab[0].created_at_ms),
    };
    /* eslint-enable @typescript-eslint/no-explicit-any */
  }

  const { rows: pendientes } = await pool.query(
    `SELECT COUNT(*) AS n FROM cash_operations
      WHERE session_id = $1 AND erp_sync_status IN ('PENDING','ERROR','RETRY_PENDING')`,
    [sessionId]
  );

  const { rows: totalOps } = await pool.query(
    `SELECT COUNT(*) AS n FROM cash_operations WHERE session_id = $1 AND estado = 'CONFIRMED'`,
    [sessionId]
  );

  return {
    sesion,
    stock: lineasDesdeInventario(inv),
    stockSueltas: lineasDesdeInventario(porFormato.sueltas),
    stockCartuchos: lineasDesdeInventario(porFormato.cartuchos),
    stockBolsas: lineasDesdeInventario(porFormato.bolsas),
    incidenciasStock: porFormato.incidencias,
    totalStockCentimos: totalInventario(inv),
    piezas: totalPiezas(inv),
    porFormaPago: formas.map((r: { forma_pago: string; importe: string }) => ({
      forma: r.forma_pago,
      importeCentimos: Number(r.importe),
    })),
    cobros: {
      erpCentimos: suma("COLLECTION", "ERP"),
      manualCentimos: suma("COLLECTION", "MANUAL"),
      totalCentimos: suma("COLLECTION"),
    },
    pagos: {
      erpCentimos: suma("PAYMENT", "ERP"),
      manualCentimos: suma("PAYMENT", "MANUAL"),
      totalCentimos: suma("PAYMENT"),
    },
    salidasCentimos: suma("MANUAL_OUT"),
    entregasCentimos: suma("CASH_DELIVERY"),
    operaciones: Number(totalOps[0].n),
    pendientesErp: Number(pendientes[0].n),
    ultimoArqueo,
    /* eslint-disable @typescript-eslint/no-explicit-any */
    porSeccion: secciones.map((r: any) => ({
      sectionId: r.section_id ?? null,
      nombre: r.nombre,
      cobrosCentimos: Number(r.cobros),
      pagosCentimos: Number(r.pagos),
      efectivoNetoCentimos: Number(r.efectivo),
      arqueaAparte: Boolean(r.arquea_aparte),
      operaciones: Number(r.n),
    })),
    /* eslint-enable @typescript-eslint/no-explicit-any */
  };
}

/** Detalle completo de una jornada, para el histórico. */
export async function detalleJornada(sessionId: number) {
  const resumen = await resumenJornada(sessionId);
  const operaciones = await operacionesDeSesion(sessionId);

  const { rows: arqueos } = await pool.query(
    `SELECT * FROM cash_counts WHERE session_id = $1 ORDER BY id DESC`,
    [sessionId]
  );

  return { ...resumen, operaciones, arqueos };
}

export { validarCambioManual };


/**
 * Abre los envases precintados que hagan falta para poder entregar unas salidas.
 *
 * Devuelve las aperturas realizadas, para que la interfaz pueda decírselo al
 * operador: sin ese aviso, la pantalla le pide cuatro monedas de 1 € y él solo
 * ve una suelta en el cajón.
 *
 * Se rompe el envase más pequeño primero —cartucho antes que bolsa—, que es lo
 * que haría cualquiera en el mostrador. Un envase abierto no se vuelve a
 * cerrar, así que esto no tiene inversa: la anulación de la operación devuelve
 * las monedas, pero sueltas.
 */
async function abrirCartuchosSiHaceFalta(
  client: PoolClient,
  e: {
    sessionId: number;
    operationId: number;
    salidas: readonly { lineas: readonly LineaMovimiento[] }[];
    denominaciones: readonly import("./domain/denominations.ts").Denominacion[];
    userId: string | null;
    ahora: number;
  }
): Promise<AperturaCartucho[]> {
  const todas = e.salidas.flatMap((m) => m.lineas);
  if (todas.length === 0) return [];

  const porCartucho = piezasPorCartuchoDe(e.denominaciones);
  const porBolsa = piezasPorBolsaDe(e.denominaciones);
  if (porCartucho.size === 0 && porBolsa.size === 0) return [];

  const stock = await stockPorFormato(client, e.sessionId);

  /*
   * Un envase que SALE precintado no se abre: se entrega tal cual. Esas líneas
   * no entran en el cálculo de aperturas —si entraran, el sistema creería que
   * hacen falta 25 monedas sueltas y rompería un tubo para nada— pero sí hay
   * que comprobar que existen los envases que se quieren sacar.
   */
  for (const l of todas) {
    if ((l.cartuchos ?? 0) > 0) {
      const disponibles = stock.cartuchos.get(l.valor) ?? 0;
      if ((l.cartuchos ?? 0) > disponibles) {
        throw new ErrorCaja(
          "STOCK_INSUFICIENTE",
          `Se quieren sacar ${l.cartuchos} cartuchos de ${l.valor} céntimos y en caja hay ${disponibles}.`,
          400
        );
      }
    }
    if ((l.bolsas ?? 0) > 0) {
      const disponibles = stock.bolsas.get(l.valor) ?? 0;
      if ((l.bolsas ?? 0) > disponibles) {
        throw new ErrorCaja(
          "STOCK_INSUFICIENTE",
          `Se quieren sacar ${l.bolsas} bolsas de ${l.valor} céntimos y en caja hay ${disponibles}.`,
          400
        );
      }
    }
  }

  const entrega = todas.filter((l) => (l.cartuchos ?? 0) === 0 && (l.bolsas ?? 0) === 0);
  if (entrega.length === 0) return [];

  const r = aperturasNecesarias(entrega, stock, porCartucho, porBolsa);

  if (esFallo(r)) {
    throw new ErrorCaja(
      "STOCK_INSUFICIENTE",
      `No hay suficientes piezas de ${r.valor} céntimos: se necesitan ${r.pedido} y hay ${r.disponible} contando cartuchos y bolsas.`,
      400
    );
  }
  if (r.aperturas.length === 0) return [];

  /*
   * Cartuchos y bolsas se asientan por separado: la base de datos no admite una
   * línea con las dos cosas (`cash_mov_un_formato`), y el motivo distinto es lo
   * que deja al histórico decir QUÉ se rompió.
   */
  const conCartucho = r.aperturas.filter((a) => a.cartuchos > 0);
  const conBolsa = r.aperturas.filter((a) => (a.bolsas ?? 0) > 0);
  const movimientos = [];

  for (const [lote, motivo, campo] of [
    [conCartucho, "CARTRIDGE_OPENED", "cartuchos"],
    [conBolsa, "BAG_OPENED", "bolsas"],
  ] as const) {
    if (lote.length === 0) continue;
    const piezasDe = (a: AperturaCartucho) =>
      campo === "cartuchos"
        ? a.cartuchos * (porCartucho.get(a.valor) ?? 0)
        : (a.bolsas ?? 0) * (porBolsa.get(a.valor) ?? 0);
    movimientos.push(
      // Sale el envase precintado…
      {
        direccion: "OUT" as const,
        motivo,
        lineas: lote.map((a) => ({
          valor: a.valor,
          cantidad: piezasDe(a),
          [campo]: campo === "cartuchos" ? a.cartuchos : a.bolsas,
        })),
      },
      // …y entran sus monedas, ya sueltas. Valor neto cero.
      {
        direccion: "IN" as const,
        motivo,
        lineas: lote.map((a) => ({ valor: a.valor, cantidad: piezasDe(a) })),
      }
    );
  }

  await insertarMovimientos(client, {
    sessionId: e.sessionId,
    operationId: e.operationId,
    movimientos,
    denominaciones: e.denominaciones,
    userId: e.userId,
    ahora: e.ahora,
  });

  return r.aperturas;
}

/**
 * Cambia la sección de una operación ya registrada.
 *
 * Es una **reclasificación, no un movimiento de dinero**: no toca ni un
 * céntimo ni una pieza, solo a qué negocio se imputa. Por eso se permite
 * aunque la jornada esté cerrada —el error se ve al día siguiente, al mirar el
 * reparto— y por eso no hace falta bloquear la jornada: no hay nada que dos
 * peticiones simultáneas puedan descuadrar.
 *
 * Lo que sí hace es quedar auditado con el antes y el después, porque cambia
 * un número que alguien va a mirar para decidir.
 */
export async function cambiarSeccion(
  ctx: Contexto,
  operationId: number,
  sectionId: number | null
): Promise<{ operacionId: number; sectionId: number | null; seccionNombre: string | null }> {
  const { rows: previas } = await pool.query(
    `SELECT o.id, o.tipo, o.estado, o.section_id,
            (SELECT nombre FROM cash_sections s WHERE s.id = o.section_id) AS seccion_nombre
       FROM cash_operations o
      WHERE o.id = $1 AND o.empresa_id = $2`,
    [operationId, ctx.empresaId]
  );
  const antes = previas[0];
  if (!antes) {
    throw new ErrorCaja("OPERACION_NO_ENCONTRADA", "La operación no existe.", 404);
  }
  if (antes.estado === "CANCELLED" || antes.estado === "REVERSED") {
    throw new ErrorCaja(
      "OPERACION_ANULADA",
      "Una operación anulada no se reclasifica: el histórico tiene que quedar como pasó.",
      409
    );
  }

  /*
   * Solo lo que pertenece a un negocio. El fondo inicial, el cierre y el
   * ingreso bancario son del cajón entero y darles sección ensuciaría el
   * reparto con dinero que no ha generado nadie.
   */
  if (!["COLLECTION", "PAYMENT", "MANUAL_OUT", "MANUAL_IN"].includes(antes.tipo)) {
    throw new ErrorCaja(
      "OPERACION_SIN_SECCION",
      "Esa operación es del cajón entero (fondo, cierre o ingreso), no de una sección.",
      409
    );
  }

  let nombre: string | null = null;
  if (sectionId != null) {
    const { rows } = await pool.query<{ nombre: string; activa: boolean }>(
      `SELECT nombre, activa FROM cash_sections WHERE id = $1 AND empresa_id = $2`,
      [sectionId, ctx.empresaId]
    );
    if (rows.length === 0) {
      throw new ErrorCaja("SECCION_NO_ENCONTRADA", "La sección indicada no existe.", 404);
    }
    // Aquí sí se admite una sección de baja: reclasificar hacia atrás puede
    // necesitar una sección que ya no se usa para cobros nuevos.
    nombre = rows[0].nombre;
  }

  await pool.query(
    `UPDATE cash_operations SET section_id = $3, updated_at_ms = $4
      WHERE id = $1 AND empresa_id = $2`,
    [operationId, ctx.empresaId, sectionId, Date.now()]
  );

  await registrarAuditoria({
    empresaId: ctx.empresaId,
    userId: ctx.userId,
    accion: "cash.operation.section",
    entidad: "cash_operations",
    entidadId: String(operationId),
    detalle: {
      antes: { sectionId: antes.section_id ?? null, nombre: antes.seccion_nombre ?? null },
      despues: { sectionId, nombre },
    },
    ip: ctx.ip,
  });

  return { operacionId: operationId, sectionId, seccionNombre: nombre };
}

/**
 * Deja el formato del libro mayor igual que el que se ha contado.
 *
 * Precinta —nunca abre— los envases que el arqueo ha visto y el libro mayor
 * no tenía apuntados. Cada uno es un asiento de valor neto CERO: salen las
 * monedas sueltas y entra el envase con esas mismas monedas dentro.
 *
 * Si no hay sueltas suficientes para formarlo, no se fuerza: significa que el
 * recuento y el libro mayor discrepan en piezas, y de eso se encarga el ajuste
 * del arqueo, que va antes. Inventar aquí las que faltan taparía un descuadre
 * de dinero haciéndolo pasar por un cambio de formato.
 */
async function conciliarFormato(
  client: PoolClient,
  p: {
    sessionId: number;
    ctx: Contexto;
    denominaciones: Denominacion[];
    contadoTubos: Inventario;
    contadoBolsas: Inventario;
    porCartucho: ReadonlyMap<Centimos, number>;
    porBolsa: ReadonlyMap<Centimos, number>;
    operacionesDe: { anio: number; ahora: number };
  }
): Promise<void> {
  const libro = await stockPorFormatoBruto(client, p.sessionId);

  type Pendiente = { valor: Centimos; envases: number; piezas: number };
  const aPrecintar: { campo: "cartuchos" | "bolsas"; motivo: MotivoMovimiento; lineas: Pendiente[] }[] =
    [
      {
        campo: "cartuchos",
        motivo: "CARTRIDGE_FORMED",
        lineas: faltantes(p.contadoTubos, libro.cartuchos, p.porCartucho, libro.sueltas),
      },
      {
        campo: "bolsas",
        motivo: "BAG_FORMED",
        lineas: faltantes(p.contadoBolsas, libro.bolsas, p.porBolsa, libro.sueltas),
      },
    ];

  for (const lote of aPrecintar) {
    if (lote.lineas.length === 0) continue;

    const numero = await siguienteNumero(client, p.sessionId, "ADJUSTMENT", p.operacionesDe.anio);
    const total = lote.lineas.reduce((a, l) => a + l.valor * l.piezas, 0);
    const opId = await insertarOperacion(client, {
      empresaId: p.ctx.empresaId,
      sessionId: p.sessionId,
      numero,
      tipo: "ADJUSTMENT",
      origen: "MANUAL",
      concepto:
        lote.campo === "cartuchos"
          ? "Monedas precintadas en cartuchos, según el arqueo"
          : "Monedas precintadas en bolsas, según el arqueo",
      importeCentimos: total,
      // Neto cero: el dinero no se mueve, cambia de envase.
      efectivoNetoCentimos: 0,
      erpSyncStatus: "NOT_APPLICABLE",
      userId: p.ctx.userId,
      ahora: p.operacionesDe.ahora,
    });

    await insertarMovimientos(client, {
      sessionId: p.sessionId,
      operationId: opId,
      movimientos: [
        {
          direccion: "OUT",
          motivo: lote.motivo,
          lineas: lote.lineas.map((l) => ({ valor: l.valor, cantidad: l.piezas })),
        },
        {
          direccion: "IN",
          motivo: lote.motivo,
          lineas: lote.lineas.map((l) => ({
            valor: l.valor,
            cantidad: l.piezas,
            [lote.campo]: l.envases,
          })),
        },
      ],
      denominaciones: p.denominaciones,
      userId: p.ctx.userId,
      ahora: p.operacionesDe.ahora,
    });
  }
}

/**
 * Envases que hay que precintar y para los que además hay monedas sueltas.
 *
 * El tope de sueltas es lo que impide que una discrepancia de PIEZAS se cuele
 * disfrazada de cambio de formato.
 */
function faltantes(
  contado: Inventario,
  enLibro: ReadonlyMap<Centimos, number>,
  porEnvase: ReadonlyMap<Centimos, number>,
  sueltasEnLibro: ReadonlyMap<Centimos, number>
): { valor: Centimos; envases: number; piezas: number }[] {
  const salida: { valor: Centimos; envases: number; piezas: number }[] = [];
  for (const { valor, cantidad } of lineasDesdeInventario(contado)) {
    const piezasPorEnvase = porEnvase.get(valor) ?? 0;
    if (piezasPorEnvase <= 0) continue;

    const faltan = cantidad - (enLibro.get(valor) ?? 0);
    if (faltan <= 0) continue;

    const cabenConLasSueltas = Math.floor((sueltasEnLibro.get(valor) ?? 0) / piezasPorEnvase);
    const envases = Math.min(faltan, cabenConLasSueltas);
    if (envases > 0) salida.push({ valor, envases, piezas: envases * piezasPorEnvase });
  }
  return salida;
}

// ── Regularización del arqueo ──────────────────────────────────────────────

/**
 * Asienta la diferencia entre el teórico y lo contado, pieza a pieza.
 *
 * Un solo sitio para el ajuste, porque hay dos momentos en que hace falta:
 * cuando se regulariza el arqueo a propósito y cuando se cierra una jornada
 * que todavía no cuadraba. Si fueran dos bloques distintos acabarían
 * divergiendo, y el que menos se usa sería el que se quedara mal.
 *
 * No cuadra un importe: cuadra CADA denominación. Dejar el total bien pero las
 * piezas mal haría que mañana la caja no pudiera dar un cambio que el sistema
 * cree tener.
 *
 * Devuelve `null` si no había nada que ajustar.
 */
async function asentarAjusteDeArqueo(
  client: PoolClient,
  p: {
    ctx: Contexto;
    sessionId: number;
    contado: Inventario;
    denominaciones: Denominacion[];
    anio: number;
    ahora: number;
    concepto: string;
    motivo?: string;
  }
): Promise<{ operacionId: number; numero: string; diferenciaCentimos: Centimos } | null> {
  const teorico = await stockTeorico(client, p.sessionId);
  const comparacion = compararArqueo(teorico, p.contado);
  if (comparacion.descuadres.length === 0) return null;

  const entradas = comparacion.descuadres
    .filter((d) => d.diferencia > 0)
    .map((d) => ({ valor: d.valor, cantidad: d.diferencia }));
  const salidas = comparacion.descuadres
    .filter((d) => d.diferencia < 0)
    .map((d) => ({ valor: d.valor, cantidad: -d.diferencia }));

  const numero = await siguienteNumero(client, p.sessionId, "ADJUSTMENT", p.anio);
  const operacionId = await insertarOperacion(client, {
    empresaId: p.ctx.empresaId,
    sessionId: p.sessionId,
    numero,
    tipo: "ADJUSTMENT",
    origen: "MANUAL",
    concepto: p.motivo?.trim() ? `${p.concepto} — ${p.motivo.trim()}` : p.concepto,
    // El importe nunca es cero: un descuadre solo de composición —sobra un
    // billete de 10 y falta uno de 10— mueve piezas sin mover el total, y una
    // operación de 0 € desaparecería de cualquier listado por importe.
    importeCentimos: Math.abs(comparacion.diferencia) || 1,
    efectivoNetoCentimos: comparacion.diferencia,
    erpSyncStatus: "NOT_APPLICABLE",
    userId: p.ctx.userId,
    ahora: p.ahora,
  });

  const movimientos = [];
  if (entradas.length > 0)
    movimientos.push({ direccion: "IN" as const, motivo: "ADJUSTMENT" as const, lineas: entradas });
  if (salidas.length > 0)
    movimientos.push({ direccion: "OUT" as const, motivo: "ADJUSTMENT" as const, lineas: salidas });

  await insertarMovimientos(client, {
    sessionId: p.sessionId,
    operationId: operacionId,
    movimientos,
    denominaciones: p.denominaciones,
    userId: p.ctx.userId,
    ahora: p.ahora,
  });

  return { operacionId, numero, diferenciaCentimos: comparacion.diferencia };
}

/**
 * Regulariza la caja contra el último arqueo: deja el teórico igual a lo
 * contado y escribe la diferencia como ajuste.
 *
 * Es lo que se pulsa cuando el recuento está confirmado y se acepta el
 * descuadre. A partir de ahí la caja cuadra y el cierre va sobre limpio, sin
 * arrastrar una diferencia que nadie ha decidido asumir.
 *
 * Bloquea la jornada, al contrario que reclasificar una sección: esto SÍ mueve
 * el libro de piezas, y dos regularizaciones a la vez asentarían dos veces la
 * misma diferencia.
 */
export async function regularizarArqueo(
  ctx: Contexto,
  e: { sessionId: number; motivo?: string }
): Promise<{
  operacionId: number;
  numero: string;
  diferenciaCentimos: Centimos;
  arqueoId: number;
} | null> {
  return enTransaccion(async (client) => {
    const sesion = await bloquearSesion(client, e.sessionId);
    await exigirJornadaPropia(client, ctx, sesion);
    if (sesion.estado === "CLOSED" || sesion.estado === "CANCELLED") {
      throw new ErrorCaja(
        "JORNADA_CERRADA",
        "La jornada ya está cerrada: su descuadre se asentó al cerrarla.",
        409
      );
    }

    // Solo el arqueo MÁS RECIENTE: con dos en la misma jornada, el bueno es el
    // último, que es el que refleja lo que hay en el cajón ahora.
    const { rows: arqueos } = await client.query<{ id: number }>(
      `SELECT id FROM cash_counts WHERE session_id = $1 ORDER BY id DESC LIMIT 1`,
      [e.sessionId]
    );
    if (arqueos.length === 0) {
      throw new ErrorCaja(
        "FALTA_ARQUEO",
        "Hay que guardar un arqueo antes de poder regularizar la caja.",
        409
      );
    }
    const arqueoId = arqueos[0].id;

    const { rows: lineas } = await client.query(
      `SELECT valor_unitario_centimos, cantidad_contada, cartuchos_contados, bolsas_contadas
         FROM cash_count_lines WHERE count_id = $1`,
      [arqueoId]
    );

    const denominaciones = await cargarDenominaciones(client);
    const porCartucho = piezasPorCartuchoDe(denominaciones);
    const porBolsa = piezasPorBolsaDe(denominaciones);

    /* eslint-disable @typescript-eslint/no-explicit-any */
    const contado = inventarioDesdeLineas(
      lineas
        .map((r: any) => ({
          valor: r.valor_unitario_centimos,
          // Las monedas de los envases también son monedas: si no se sumaran,
          // la regularización "descubriría" un faltante que no existe.
          cantidad:
            Number(r.cantidad_contada) +
            Number(r.cartuchos_contados) * (porCartucho.get(r.valor_unitario_centimos) ?? 0) +
            Number(r.bolsas_contadas ?? 0) * (porBolsa.get(r.valor_unitario_centimos) ?? 0),
        }))
        .filter((l: LineaDenominacion) => l.cantidad > 0)
    );
    /* eslint-enable @typescript-eslint/no-explicit-any */

    const ahora = Date.now();
    const ajuste = await asentarAjusteDeArqueo(client, {
      ctx,
      sessionId: e.sessionId,
      contado,
      denominaciones,
      anio: Number(sesion.fecha.slice(0, 4)),
      ahora,
      concepto: "Regularización de arqueo",
      motivo: e.motivo,
    });

    if (!ajuste) {
      throw new ErrorCaja(
        "CAJA_YA_CUADRA",
        "La caja ya cuadra con el último arqueo: no hay nada que regularizar.",
        409
      );
    }

    await registrarAuditoria({
      empresaId: ctx.empresaId,
      userId: ctx.userId,
      accion: "cash.count.regularize",
      entidad: "cash_sessions",
      entidadId: String(e.sessionId),
      detalle: {
        arqueoId,
        numeroAjuste: ajuste.numero,
        diferenciaCentimos: ajuste.diferenciaCentimos,
        motivo: e.motivo ?? null,
      },
      ip: ctx.ip,
    });

    await emitirEvento(client, {
      empresaId: ctx.empresaId,
      centroId: await centroDeCaja(client, sesion.registerId),
      registerId: sesion.registerId,
      sessionId: e.sessionId,
      agregado: { tipo: "SESSION", id: e.sessionId },
      tipo: "COUNT_ADJUSTED",
      ocurridoEnMs: ahora,
      actorUserId: ctx.userId,
      datos: {
        arqueoId,
        numeroAjuste: ajuste.numero,
        diferenciaCentimos: ajuste.diferenciaCentimos,
        motivo: e.motivo ?? null,
      },
    });

    return { ...ajuste, arqueoId };
  });
}
