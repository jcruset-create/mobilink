/**
 * La ruta del informe mensual de flota.
 *
 * Fase 1 de la réplica del informe de Grupo Soledad: la cabecera y los
 * recuentos (`docs/PLAN_informe_mensual_plana.md`). Las rejillas por
 * posición, los quesitos y el detalle por vehículo van detrás, sobre este
 * mismo cálculo.
 *
 * ── El acceso se comprueba AQUÍ ─────────────────────────────────────────────
 *
 * El servidor habla con Supabase con `service_role`, que NO pasa por RLS. Sin
 * esta comprobación, cualquiera con sesión podría pedir el informe de otro
 * cliente tecleando su id. Es el mismo criterio que el resto de informes,
 * `empresaDelInforme`, y no una comprobación nueva inventada aquí.
 *
 * ── Y el cálculo NO está aquí ───────────────────────────────────────────────
 *
 * Está en `armar.ts`, sin tocar la base, para que se pueda probar entero. Lo
 * de este fichero es leer, llamar y contestar.
 */

import type { Express, RequestHandler } from "express";

import { empresaDelInforme } from "../informes/alcance.ts";
import {
  MesInvalido, avisosDelMes, neumaticosRevisados, periodoDeMes, recuentos, revisionCuenta,
  ruedasDelMes, type CabeceraMensual,
} from "./armar.ts";
import {
  leerCondicionDeNeumaticos, leerMediciones, leerNeumaticos, leerNombreEmpresa,
  leerOrdenDePosiciones, leerRevisiones, leerVehiculos,
} from "./datos.ts";
import {
  avisosDeCondicion, completar, condicionPorPosicion, marcaPorPosicion,
  medidaPorMarca, medidaPorMilimetro, medidaPorPosicion, profundidadPorPosicion,
  type Matriz, type RuedaCompleta,
} from "./matrices.ts";
import {
  mesesHasta, quesitoDeBandas, quesitoDeCondicion, recortar, serieMensual,
} from "./evolucion.ts";

/** El mes en curso, para cuando no se pide ninguno. */
const mesActual = (): string => new Date().toISOString().slice(0, 7);

export function mountInformeMensual(app: Express, ...guards: RequestHandler[]): void {
  app.get("/api/tyrecontrol/informes/mensual", ...guards, async (req, res) => {
    try {
      const alcance = await empresaDelInforme(req, req.query.empresa);
      if (!alcance.empresa) return res.status(alcance.estado!).json({ error: alcance.error });
      const empresa = alcance.empresa;

      let periodo;
      try {
        periodo = periodoDeMes(String(req.query.mes ?? mesActual()));
      } catch (e) {
        if (e instanceof MesInvalido) return res.status(400).json({ error: e.message });
        throw e;
      }
      const incluirBaja = req.query.incluirBaja === "1";

      const [vehiculos, revisiones, posiciones, empresaNombre] = await Promise.all([
        leerVehiculos(empresa),
        leerRevisiones(empresa, periodo.desde, periodo.hasta),
        leerOrdenDePosiciones(),
        leerNombreEmpresa(empresa),
      ]);

      const cuentas = recuentos(vehiculos, revisiones, periodo, incluirBaja);

      // Las mediciones solo de las revisiones que cuentan: pedir las de los
      // borradores sería traerse filas para tirarlas después.
      const idsQueCuentan = revisiones.filter((r) => revisionCuenta(r.estado)).map((r) => r.id);
      const mediciones = await leerMediciones(empresa, idsQueCuentan, posiciones.orden);

      // La misma flota que los recuentos, o el total de neumáticos no cuadra
      // con la flota y nadie sabría por qué.
      const contados = new Set(
        vehiculos.filter((v) => incluirBaja || v.activo).map((v) => v.id),
      );
      // Una rueda, una vez: el arco de CheckPoint mide cada pasada, y contar
      // mediciones daría un número once veces mayor que el del informe.
      const ruedas = ruedasDelMes(revisiones, mediciones, periodo, contados);
      const neumaticos = neumaticosRevisados(ruedas);

      /*
       * Las rejillas necesitan saber qué goma llevaba cada rueda: marca,
       * modelo, medida y si estaba reesculturada o recauchutada. Las dos
       * lecturas van por id y no enteras: de 6.541 neumáticos de Plana, en un
       * mes se miden unos 2.100.
       */
      const idsNeumatico = ruedas.ruedas
        .map((r) => r.neumaticoId).filter((x): x is string => !!x);
      const [neumaticosRef, condiciones] = await Promise.all([
        leerNeumaticos(empresa, idsNeumatico),
        leerCondicionDeNeumaticos(empresa, idsNeumatico),
      ]);
      const completas = completar(ruedas.ruedas, neumaticosRef, condiciones);
      const pos = neumaticos.posiciones;

      const rejillas: Record<string, Matriz> = {
        marcaPorPosicion: marcaPorPosicion(completas, pos),
        medidaPorPosicion: medidaPorPosicion(completas, pos),
        condicionPorPosicion: condicionPorPosicion(completas, pos),
        profundidadPorPosicion: profundidadPorPosicion(completas, pos),
        medidaPorMilimetro: medidaPorMilimetro(completas),
        medidaPorMarca: medidaPorMarca(completas),
      };

      const cabecera: CabeceraMensual = {
        empresa,
        empresaNombre,
        periodo,
        recuentos: cuentas,
        neumaticos,
        avisos: [
          ...avisosDelMes(vehiculos, neumaticos, posiciones.repetidas, incluirBaja),
          ...avisosDeCondicion(completas),
        ],
      };
      res.json({ ok: true, ...cabecera, rejillas });
    } catch (e: any) {
      console.error("[informe-mensual] error:", e?.message ?? e);
      res.status(500).json({ error: e?.message || "No se ha podido generar el informe mensual" });
    }
  });

  /**
   * La evolución de los últimos meses, y los quesitos del último.
   *
   * Va en su propia ruta y no dentro del informe porque cuesta lo que cuesta:
   * son doce meses de mediciones, y meterlo en la misma petición que la
   * cabecera haría esperar por las gráficas a quien solo quiere los
   * recuentos. La pantalla pide las dos cosas a la vez; el servidor las sirve
   * por separado.
   *
   * Cada mes se deduplica POR SEPARADO, y eso es lo que obliga a leer mes a
   * mes: una rueda medida en octubre y en noviembre son dos ruedas de la
   * serie, una de cada mes. Deduplicando el año entero de una vez quedaría
   * una sola y los meses anteriores se vaciarían.
   */
  app.get("/api/tyrecontrol/informes/mensual/evolucion", ...guards, async (req, res) => {
    try {
      const alcance = await empresaDelInforme(req, req.query.empresa);
      if (!alcance.empresa) return res.status(alcance.estado!).json({ error: alcance.error });
      const empresa = alcance.empresa;

      let periodos;
      try {
        const n = Math.min(24, Math.max(1, Number(req.query.meses ?? 12) || 12));
        periodos = mesesHasta(String(req.query.mes ?? mesActual()), n);
      } catch (e) {
        if (e instanceof MesInvalido) return res.status(400).json({ error: e.message });
        throw e;
      }
      const incluirBaja = req.query.incluirBaja === "1";

      const [vehiculos, posiciones] = await Promise.all([
        leerVehiculos(empresa), leerOrdenDePosiciones(),
      ]);
      const contados = new Set(
        vehiculos.filter((v) => incluirBaja || v.activo).map((v) => v.id),
      );

      const ruedasPorMes = new Map<string, RuedaCompleta[]>();
      const idsNeumatico = new Set<string>();
      const porMesSinCompletar = new Map<string, ReturnType<typeof ruedasDelMes>>();

      for (const p of periodos) {
        const revisiones = await leerRevisiones(empresa, p.desde, p.hasta);
        const ids = revisiones.filter((r) => revisionCuenta(r.estado)).map((r) => r.id);
        if (ids.length === 0) { porMesSinCompletar.set(p.mes, { ruedas: [], sinPosicion: 0 }); continue; }
        const mediciones = await leerMediciones(empresa, ids, posiciones.orden);
        const r = ruedasDelMes(revisiones, mediciones, p, contados);
        porMesSinCompletar.set(p.mes, r);
        for (const rueda of r.ruedas) if (rueda.neumaticoId) idsNeumatico.add(rueda.neumaticoId);
      }

      // Los neumáticos, UNA vez para toda la serie: los mismos aparecen mes
      // tras mes, y pedirlos doce veces sería doce veces el mismo viaje.
      const todos = [...idsNeumatico];
      const [neumaticosRef, condiciones] = await Promise.all([
        leerNeumaticos(empresa, todos),
        leerCondicionDeNeumaticos(empresa, todos),
      ]);
      for (const [m, r] of porMesSinCompletar) {
        ruedasPorMes.set(m, completar(r.ruedas, neumaticosRef, condiciones));
      }

      const evolucion = recortar(serieMensual(periodos, ruedasPorMes));
      const ultimo = evolucion.meses.at(-1) ?? null;

      res.json({
        ok: true,
        empresa,
        mesesPedidos: periodos.length,
        ...evolucion,
        quesitos: ultimo
          ? { bandas: quesitoDeBandas(ultimo), condicion: quesitoDeCondicion(ultimo) }
          : null,
      });
    } catch (e: any) {
      console.error("[informe-mensual-evolucion] error:", e?.message ?? e);
      res.status(500).json({ error: e?.message || "No se ha podido calcular la evolución" });
    }
  });
}
