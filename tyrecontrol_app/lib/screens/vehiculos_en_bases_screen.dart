import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../models/presencia_vista.dart';
import '../services/supabase_service.dart';
import '../theme/app_theme.dart';
import '../widgets/ficha_vehiculo_en_base.dart';
import 'confirm_vehicle_screen.dart';

/// Vehículos en bases — réplica de la pantalla del panel web, para el patio.
///
/// Contesta la pregunta del técnico que baja con la tablet: «¿a quién puedo
/// revisar ahora sin sacarlo de servicio?». Lo calcula el barrido de telemática
/// del servidor cada diez minutos —una llamada al proveedor para toda la
/// flota— y aquí solo se enseña.
///
/// ── Lo que esta pantalla NO hace, a propósito ───────────────────────────────
///
/// **No barre.** El botón «Barrer ahora» del panel es de administradores porque
/// habla con el proveedor y gasta su cuota. Desde la tablet solo se lee, y se
/// dice siempre cuándo se barrió: un estado de hace veinte minutos es útil, y
/// ese mismo estado presentado como «ahora» es engañoso.
///
/// **No es un mapa ni un seguimiento.** La posición se compara con las
/// geo-zonas de las delegaciones y lo que se guarda es «dentro de la base X» o
/// «fuera»; sirve para organizar revisiones, no para saber por dónde va un
/// conductor.
///
/// ── Los pendientes se reparten en TRES cuadros, y la suma cuadra ────────────
///
/// En base, fuera de base y de ubicación desconocida. Con solo el primero, los
/// que están en el patio parecen todo el trabajo atrasado cuando son una
/// fracción. Y sin el tercero la resta no daría, porque los de posición antigua
/// no caen en ninguno de los dos primeros y desaparecerían sin que nadie los
/// viera. La prueba que lo fija está en `test/presencia_vista_test.dart`.
class VehiculosEnBasesScreen extends StatefulWidget {
  final bool embedded;
  const VehiculosEnBasesScreen({super.key, this.embedded = false});

  @override
  State<VehiculosEnBasesScreen> createState() => _VehiculosEnBasesScreenState();
}

/// Sentinelas del filtro, para no mezclarlos con los ids de base de verdad.
const String _kTodosPendientes = '__pendientes__';
const String _kFueraDeBase = '__fuera_de_base__';
const String _kSinUbicacion = '__sin_ubicacion__';
const String _kSinPeriodicidad = '__sin_periodicidad__';

/// Dónde se recuerda la última base elegida.
///
/// Los técnicos no tienen delegación en su perfil (`tc_usuarios.delegacion_id`
/// está vacío), así que la app no puede adivinar en qué patio están. Se guarda
/// la que elijan, por cliente: el mismo técnico trabaja en varias flotas y la
/// base de una no significa nada en la otra.
String _clavePreferencia(String empresaId) => 'tc_base_elegida_$empresaId';

class _VehiculosEnBasesScreenState extends State<VehiculosEnBasesScreen> {
  bool _cargando = true;
  String? _error;
  PresenciaBases? _datos;
  Map<String, RevisionEstado> _revisiones = {};

  /// Filtro activo: un sentinela o el id de una base.
  String _filtro = _kTodosPendientes;

  /// Para que el botón de una ficha no se pueda pulsar dos veces mientras se
  /// carga el vehículo.
  String? _abriendo;

  @override
  void initState() {
    super.initState();
    _cargar();
  }

  Future<void> _cargar() async {
    setState(() {
      _cargando = true;
      _error = null;
    });
    final empresa = TyreControlApi.empresaActivaId;
    if (empresa == null) {
      setState(() {
        _cargando = false;
        // Vale también para el modo «Admin — todos los clientes», que deja
        // `empresaActivaId` a null: las bases y el barrido son de un cliente
        // concreto, así que aquí hay que elegir uno igualmente.
        _error = 'Elige primero un cliente para ver dónde están sus vehículos.';
      });
      return;
    }
    try {
      // Las dos a la vez: la presencia es una llamada al backend y el estado de
      // revisión un RPC. En serie el técnico espera el doble para nada.
      final resultados = await Future.wait([
        TyreControlApi.presenciaBases(empresa),
        TyreControlApi.revisionEstadoCompleto(),
      ]);
      final datos = resultados[0] as PresenciaBases;
      final revisiones = resultados[1] as Map<String, RevisionEstado>;
      final guardada = await _baseRecordada(empresa, datos.bases);
      if (!mounted) return;
      setState(() {
        _datos = datos;
        _revisiones = revisiones;
        if (guardada != null) _filtro = guardada;
        _cargando = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _cargando = false;
        _error = '$e'.replaceFirst('Exception: ', '');
      });
    }
  }

  /// La base elegida la última vez, si todavía existe en este cliente.
  Future<String?> _baseRecordada(String empresa, List<BaseGeo> bases) async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final id = prefs.getString(_clavePreferencia(empresa));
      if (id == null) return null;
      // Una base borrada o de otro cliente dejaría la pantalla filtrada por
      // algo que no existe, y vacía sin explicar por qué.
      return bases.any((b) => b.id == id) ? id : null;
    } catch (_) {
      return null;
    }
  }

  Future<void> _elegirFiltro(String filtro) async {
    setState(() => _filtro = filtro);
    final empresa = TyreControlApi.empresaActivaId;
    if (empresa == null) return;
    try {
      final prefs = await SharedPreferences.getInstance();
      // Solo se recuerda una base de verdad: los sentinelas son vistas
      // puntuales («a ver qué anda por ahí»), no el patio de uno.
      if (filtro.startsWith('__')) {
        await prefs.remove(_clavePreferencia(empresa));
      } else {
        await prefs.setString(_clavePreferencia(empresa), filtro);
      }
    } catch (_) {/* que no se recuerde no es motivo para romper nada */}
  }

  @override
  Widget build(BuildContext context) {
    final contenido = _cargando
        ? const Center(child: CircularProgressIndicator())
        : (_error != null ? _vistaError() : _vistaPrincipal());
    if (widget.embedded) return contenido;
    return Scaffold(
      appBar: AppBar(
        title: const Text('Vehículos en bases'),
        actions: [
          IconButton(
            tooltip: 'Volver a leer',
            onPressed: _cargando ? null : _cargar,
            icon: const Icon(Icons.refresh),
          ),
        ],
      ),
      body: contenido,
    );
  }

  Widget _vistaError() => Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Icon(Icons.cloud_off, size: 48, color: AppColors.textHint),
              const SizedBox(height: 12),
              Text(
                _error ?? '',
                textAlign: TextAlign.center,
                style: const TextStyle(color: AppColors.textSecondary, fontSize: 15),
              ),
              const SizedBox(height: 16),
              FilledButton.icon(
                onPressed: _cargar,
                icon: const Icon(Icons.refresh),
                label: const Text('Reintentar'),
              ),
            ],
          ),
        ),
      );

  Widget _vistaPrincipal() {
    final datos = _datos!;
    final vehiculos = datos.vehiculos;

    final porBase = agruparPorBase(vehiculos, _revisiones);
    final dormidos = dormidosPorBase(vehiculos);
    final pendientesPorBase = revisablesPorBase(vehiculos, _revisiones);
    final enBaseAhora = revisablesEnBase(vehiculos, _revisiones);
    final fuera = revisablesFueraDeBase(vehiculos, _revisiones);
    final sinUbicacion = revisablesSinUbicacion(vehiculos, _revisiones);
    final huerfanos = sinPeriodicidadEnBase(vehiculos, _revisiones);

    final lista = switch (_filtro) {
      _kFueraDeBase => fuera,
      _kSinUbicacion => sinUbicacion,
      _kSinPeriodicidad => huerfanos,
      _kTodosPendientes => enBaseAhora,
      _ => porBase[_filtro] ?? const <VehiculoPresencia>[],
    };
    final baseReal = _filtro.startsWith('__') ? null : _filtro;

    return RefreshIndicator(
      onRefresh: _cargar,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(12, 12, 12, 24),
        children: [
          _cabecera(datos),
          const SizedBox(height: 12),
          ..._avisos(datos, vehiculos),
          if (datos.bases.isEmpty)
            _tarjetaVacia(
              'Esta empresa no tiene ninguna base con posición configurada. '
              'Ponle el centro y el radio a la delegación en Delegaciones, '
              'desde el panel, y vuelve a mirar.',
            )
          else ...[
            _contadores(datos),
            const SizedBox(height: 12),
            _filtros(
              datos: datos,
              enBase: enBaseAhora.length,
              fuera: fuera.length,
              sinUbicacion: sinUbicacion.length,
              huerfanos: huerfanos.length,
              porBase: porBase,
              dormidos: dormidos,
              pendientesPorBase: pendientesPorBase,
            ),
            const SizedBox(height: 12),
            _resumenDeLaLista(lista.length, baseReal, pendientesPorBase, datos.bases),
            const SizedBox(height: 8),
            if (lista.isEmpty)
              _tarjetaVacia(_textoListaVacia())
            else
              ...lista.map((v) => Padding(
                    padding: const EdgeInsets.only(bottom: 10),
                    child: FichaVehiculoEnBase(
                      // Con clave propia, para que al refrescar Flutter
                      // reutilice la tarjeta del mismo vehículo en vez de la
                      // que ocupaba esa posición en la lista anterior.
                      key: ValueKey(v.vehiculoId),
                      v: v,
                      rev: _revisiones[v.vehiculoId],
                      nombreDeBase: _nombreDeBase(datos.bases),
                      abriendo: _abriendo == v.vehiculoId,
                      onRevisar: () => _abrirRevision(v),
                    ),
                  )),
          ],
        ],
      ),
    );
  }

  Map<String, String> _nombreDeBase(List<BaseGeo> bases) => {
        for (final b in bases) b.id: b.nombre,
      };

  Widget _cabecera(PresenciaBases datos) {
    final hayCuentaActiva = datos.cuentas.any((c) => c.activa);
    final texto = datos.calculadoAt != null
        ? 'Último barrido hace ${desde(datos.calculadoAt)}'
        : hayCuentaActiva
            ? 'Todavía no se ha barrido ninguna vez'
            : 'Todavía no se ha barrido ninguna vez';
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text(
                'Vehículos en bases',
                style: TextStyle(fontSize: 18, fontWeight: FontWeight.w800),
              ),
              const SizedBox(height: 2),
              Text(
                '$texto · ${datos.bases.length} base(s) con geo-zona',
                style: const TextStyle(fontSize: 12, color: AppColors.textHint),
              ),
            ],
          ),
        ),
        if (widget.embedded)
          IconButton(
            tooltip: 'Volver a leer',
            onPressed: _cargando ? null : _cargar,
            icon: const Icon(Icons.refresh),
          ),
      ],
    );
  }

  /*
   * Por qué está vacío, dicho en la propia pantalla.
   *
   * Los mismos avisos que el panel. Sin ellos salen cuatro ceros y un
   * «todavía no se ha barrido» sin más, y el motivo más frecuente no se ve
   * desde aquí: la empresa no tiene ninguna cuenta de telemática dada de alta,
   * así que el barrido no tiene a quién preguntar.
   *
   * Lo que sí cambia respecto al panel: aquí no se ofrece ir a arreglarlo. Eso
   * se hace en el panel de integraciones, desde un ordenador, y no es trabajo
   * del técnico que está en el patio. Se dice qué pasa y a quién avisar.
   */
  List<Widget> _avisos(PresenciaBases datos, List<VehiculoPresencia> vehiculos) {
    final avisos = <Widget>[];
    if (datos.bases.isNotEmpty && datos.cuentas.isEmpty) {
      avisos.add(_aviso(
        'Este cliente no tiene ninguna cuenta de telemática dada de alta, así que '
        'no hay a quién preguntar dónde están sus vehículos. Se activa en el panel, '
        'en integraciones.',
      ));
    } else if (datos.cuentas.isNotEmpty && datos.cuentas.every((c) => !c.activa)) {
      final cuales = datos.cuentas.map((c) => '${c.nombre ?? c.cuenta} · ${c.proveedor}').join(', ');
      avisos.add(_aviso(
        'Las cuentas de telemática de este cliente ($cuales) están dadas de alta '
        'pero desactivadas. Hay que marcarlas como activas en el panel.',
      ));
    }
    final sinEnlace = vehiculos.where((v) => v.motivo == 'sin_enlace').length;
    if (sinEnlace > 0) {
      avisos.add(_aviso(
        '$sinEnlace vehículo(s) no están vinculados con ninguna cuenta de telemática, '
        'así que de esos no se puede saber dónde están. Se arregla en la conciliación '
        'telemática del panel.',
      ));
    }
    return [
      for (final a in avisos) Padding(padding: const EdgeInsets.only(bottom: 10), child: a),
    ];
  }

  Widget _aviso(String texto) => Container(
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: AppColors.warning.withValues(alpha: 0.08),
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: AppColors.warning.withValues(alpha: 0.35)),
        ),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Icon(Icons.warning_amber_rounded, size: 18, color: AppColors.warning),
            const SizedBox(width: 8),
            Expanded(
              child: Text(
                texto,
                style: const TextStyle(fontSize: 13, color: AppColors.warning),
              ),
            ),
          ],
        ),
      );

  Widget _tarjetaVacia(String texto) => Container(
        width: double.infinity,
        padding: const EdgeInsets.all(28),
        decoration: BoxDecoration(
          color: AppColors.surface,
          borderRadius: BorderRadius.circular(16),
          border: Border.all(color: AppColors.cardBorder),
        ),
        child: Text(
          texto,
          textAlign: TextAlign.center,
          style: const TextStyle(color: AppColors.textSecondary, fontSize: 14),
        ),
      );

  /// Los cuatro contadores de estado. Los incómodos también.
  Widget _contadores(PresenciaBases datos) {
    const estados = [enBase, posicionAntigua, fueraDeBases, sinPosicion];
    const tonos = {
      enBase: AppColors.success,
      posicionAntigua: AppColors.warning,
      fueraDeBases: AppColors.textSecondary,
      sinPosicion: AppColors.textHint,
    };
    return SizedBox(
      height: 72,
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        itemCount: estados.length,
        separatorBuilder: (_, __) => const SizedBox(width: 8),
        itemBuilder: (_, i) {
          final e = estados[i];
          return Container(
            width: 150,
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
            decoration: BoxDecoration(
              color: AppColors.surface,
              borderRadius: BorderRadius.circular(14),
              border: Border.all(color: AppColors.cardBorder),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Text(
                  etiquetaPresencia[e]!.toUpperCase(),
                  style: const TextStyle(fontSize: 10, color: AppColors.textHint),
                ),
                const SizedBox(height: 2),
                Text(
                  '${datos.porEstado[e] ?? 0}',
                  style: TextStyle(fontSize: 24, fontWeight: FontWeight.w900, color: tonos[e]),
                ),
              ],
            ),
          );
        },
      ),
    );
  }

  /*
   * Los cuadros-filtro, en una tira que se arrastra.
   *
   * En el panel se envuelven en varias filas porque hay pantalla de sobra. Aquí
   * no: con seis bases y cuatro cuadros fijos, envolver se come media tablet
   * antes de que se vea un solo vehículo, y en el móvil donde también corre
   * esta app sería la pantalla entera. Arrastrando se ven todos y la lista
   * empieza arriba.
   */
  Widget _filtros({
    required PresenciaBases datos,
    required int enBase,
    required int fuera,
    required int sinUbicacion,
    required int huerfanos,
    required Map<String, List<VehiculoPresencia>> porBase,
    required Map<String, int> dormidos,
    required Map<String, int> pendientesPorBase,
  }) {
    final cuadros = <Widget>[
      _cuadro(
        id: _kTodosPendientes,
        titulo: 'Con revisión pendiente',
        detalle: '$enBase en base ahora',
        color: AppColors.success,
      ),
      // En gris y con el icono de carretera, no en verde: no es trabajo que se
      // pueda hacer hoy, es trabajo que hay que planificar. El mismo verde que
      // los de la base invitaría a bajar al patio a buscar un autobús que está
      // en la AP-7.
      _cuadro(
        id: _kFueraDeBase,
        titulo: 'Pendientes fuera de base',
        detalle: '$fuera circulando ahora',
        color: AppColors.info,
        icono: Icons.route,
      ),
      if (sinUbicacion > 0)
        _cuadro(
          id: _kSinUbicacion,
          titulo: 'Pendientes sin ubicación',
          detalle: '$sinUbicacion sin saber dónde',
          color: AppColors.textSecondary,
          icono: Icons.help_outline,
        ),
      if (huerfanos > 0)
        _cuadro(
          id: _kSinPeriodicidad,
          titulo: 'Sin periodicidad',
          detalle: '$huerfanos en base ahora',
          color: AppColors.reesculturado,
        ),
      for (final b in datos.bases)
        _cuadro(
          id: b.id,
          titulo: b.nombre,
          detalle: '${porBase[b.id]?.length ?? 0} dentro'
              '${(dormidos[b.id] ?? 0) > 0 ? ' · ${dormidos[b.id]} con posición antigua' : ''}',
          // Los pendientes, destacados y solo cuando los hay: una base con cero
          // no necesita una línea que lo diga.
          destacado: (pendientesPorBase[b.id] ?? 0) > 0
              ? '${pendientesPorBase[b.id]} con revisión pendiente'
              : null,
          color: AppColors.success,
          icono: Icons.place_outlined,
        ),
    ];
    return SizedBox(
      height: 84,
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        itemCount: cuadros.length,
        separatorBuilder: (_, __) => const SizedBox(width: 8),
        itemBuilder: (_, i) => cuadros[i],
      ),
    );
  }

  Widget _cuadro({
    required String id,
    required String titulo,
    required String detalle,
    required Color color,
    String? destacado,
    IconData? icono,
  }) {
    final activo = _filtro == id;
    return InkWell(
      onTap: () => _elegirFiltro(id),
      borderRadius: BorderRadius.circular(14),
      child: Container(
        width: 190,
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
        decoration: BoxDecoration(
          color: activo ? color.withValues(alpha: 0.12) : AppColors.surface,
          borderRadius: BorderRadius.circular(14),
          border: Border.all(color: activo ? color : AppColors.cardBorder),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Row(
              children: [
                if (icono != null) ...[
                  Icon(icono, size: 13, color: activo ? color : AppColors.textSecondary),
                  const SizedBox(width: 4),
                ],
                Expanded(
                  child: Text(
                    titulo,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                      fontSize: 13,
                      fontWeight: FontWeight.w800,
                      color: activo ? color : AppColors.textPrimary,
                    ),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 2),
            Text(
              detalle,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(fontSize: 11, color: AppColors.textSecondary),
            ),
            if (destacado != null)
              Text(
                destacado,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(
                  fontSize: 11,
                  fontWeight: FontWeight.w800,
                  color: AppColors.success,
                ),
              ),
          ],
        ),
      ),
    );
  }

  Widget _resumenDeLaLista(
    int cuantos,
    String? baseReal,
    Map<String, int> pendientesPorBase,
    List<BaseGeo> bases,
  ) {
    final nombres = _nombreDeBase(bases);
    final texto = switch (_filtro) {
      _kSinPeriodicidad =>
        '$cuantos vehículo(s) en base revisados pero sin periodicidad definida',
      _kFueraDeBase =>
        '$cuantos vehículo(s) con revisión pendiente circulando fuera de las bases',
      _kSinUbicacion =>
        '$cuantos vehículo(s) con revisión pendiente de los que no se sabe dónde están',
      _kTodosPendientes => '$cuantos vehículo(s) en base y con revisión pendiente',
      _ => () {
          final pend = pendientesPorBase[baseReal] ?? 0;
          final nombre = nombres[baseReal] ?? 'la base';
          return '$cuantos vehículo(s) en $nombre'
              '${pend > 0 ? ' · $pend con revisión pendiente, los primeros' : ''}';
        }(),
    };
    return Row(
      children: [
        const Icon(Icons.local_shipping_outlined, size: 15, color: AppColors.textSecondary),
        const SizedBox(width: 6),
        Expanded(
          child: Text(
            texto,
            style: const TextStyle(fontSize: 13, color: AppColors.textSecondary),
          ),
        ),
      ],
    );
  }

  String _textoListaVacia() => switch (_filtro) {
        _kSinPeriodicidad => 'Ningún vehículo en base está en ese caso ahora mismo.',
        _kFueraDeBase =>
          'Ningún vehículo con revisión pendiente está circulando ahora mismo. '
              'Todo lo pendiente está en base o no emite posición.',
        _kSinUbicacion => 'De todos los vehículos con revisión pendiente se sabe dónde están.',
        _kTodosPendientes => 'Ningún vehículo en base tiene revisión pendiente ahora mismo.',
        _ => 'Ahora mismo no hay ningún vehículo con posición reciente dentro de esta base.',
      };

  /*
   * De la ficha a la revisión de siempre.
   *
   * La presencia solo trae el id y la matrícula, y `ConfirmVehicleScreen`
   * necesita el vehículo entero: es la pantalla que pide el odómetro al Hub,
   * decide si hay que verificar presiones y pregunta los km a mano cuando el
   * vehículo no los da. Nada de eso se reimplementa aquí; se busca el vehículo
   * y se entra por la puerta de siempre.
   */
  Future<void> _abrirRevision(VehiculoPresencia v) async {
    if (_abriendo != null) return;
    setState(() => _abriendo = v.vehiculoId);
    try {
      final vehiculo = await TyreControlApi.obtenerVehiculo(v.vehiculoId);
      if (!mounted) return;
      if (vehiculo == null) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('No se ha podido abrir la ficha de ${v.matricula}')),
        );
        return;
      }
      await Navigator.of(context).push(
        MaterialPageRoute(builder: (_) => ConfirmVehicleScreen(vehiculo: vehiculo)),
      );
      // Al volver puede haber una revisión recién hecha: se vuelve a leer para
      // que el que acaba de revisarse deje de salir como pendiente.
      if (mounted) await _cargar();
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('$e'.replaceFirst('Exception: ', ''))),
      );
    } finally {
      if (mounted) setState(() => _abriendo = null);
    }
  }
}
