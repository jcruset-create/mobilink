import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../models/models.dart';
import '../models/incidencias.dart';
import '../models/umbrales.dart';
import 'dart:async';

import '../services/pausa_controller.dart';
import '../services/probe_session.dart';
import '../services/tlgx_probe_service.dart';
import '../services/supabase_service.dart';
import '../theme/app_theme.dart';
import '../widgets/etiqueta_neumatico.dart';
import '../widgets/pausa_trabajo.dart';
import 'catalogo_screen.dart';

/// Cambio rápido de neumático (tablet, táctil).
///
/// El técnico arrastra con el dedo:
///  · la rueda montada → 🏭 Almacén (vuelve como usado) o 🗑️ Basura (descarte).
///  · una tarjeta del stock (nuevo/usado, de la medida del vehículo) → una
///    posición vacía del plano para montarla.
class CambioNeumaticoScreen extends StatefulWidget {
  final String vehiculoId;
  final String? posicionInicialId; // resaltar (viene de una incidencia)
  final List<Incidencia> incidencias; // incidencias de esta revisión (para resolver al finalizar)
  const CambioNeumaticoScreen({super.key, required this.vehiculoId, this.posicionInicialId, this.incidencias = const []});

  @override
  State<CambioNeumaticoScreen> createState() => _CambioNeumaticoScreenState();
}

class _DragMontaje {
  final MontajeActual m;
  const _DragMontaje(this.m);
}

class _DragStock {
  final StockAlmacenLinea linea;
  final String condicion; // 'nuevo' | 'usado'
  const _DragStock(this.linea, this.condicion);
}

class _CambioNeumaticoScreenState extends State<CambioNeumaticoScreen> {
  bool _loading = true;
  String? _error;
  String _matricula = '';
  String? _empresaId;
  List<PosicionVehiculo> _posiciones = [];
  Map<String, MontajeActual> _montajePorPosicion = {};
  String? _imagenChasis;
  bool _ejesSeparados = false; // usando la imagen de chasis con ejes separados (remap de tarjetas)
  List<StockAlmacenLinea> _stock = [];
  Set<String> _medidasVehiculo = {}; // medidas base admitidas por el vehículo
  Map<String, RevisionDetalleDraft> _mediciones = {}; // última medición por NEUMÁTICO
  UmbralConfig? _umbralEmpresa; // umbrales de profundidad para pintar el estado
  Map<String, UmbralConfig> _umbralPorMedida = {};
  PausaController? _pausas; // inactividad de la sesión de cambio (productividad)
  Map<int, ({num presion, num margen})> _presionesObjetivo = {}; // presión recomendada por eje
  Map<String, ({double? prof, double? pres})> _datosCat = {}; // catálogo por modelo (dibujo/presión máx)
  bool _trabajando = false;
  late final DateTime _abiertoEn = DateTime.now(); // para acotar el "deshacer" a esta sesión
  final Set<String> _posicionesMontadas = {}; // posiciones donde se montó un neumático en esta sesión
  final Set<String> _posicionesResueltas = {}; // reparaciones en sitio hechas en esta sesión
  final Set<String> _incidenciasResueltas = {}; // ids de incidencias ya resueltas (para no re-resolver al finalizar)
  String? _posSeleccionada; // posición elegida en el plano para operar desde el panel
  // Plan de trabajo: se elige la ACCIÓN en el panel lateral y se marcan las
  // ruedas afectadas. Nada toca la BD hasta pulsar "Aplicar plan".
  String? _accionActiva; // 'mover' | 'reescultura' | 'giro' | 'pinchazo' | …
  bool get _modoPermuta => _accionActiva != null;
  String? _permutaA; // primera posición elegida (origen del movimiento en curso)
  // Movimientos: posiciónDestino → montajeId que acabará ahí.
  final Map<String, String> _plan = {};
  // Resto de acciones marcadas: montajeId → tipos de acción.
  final Map<String, Set<String>> _marcas = {};
  // Milímetros tras el corte, por montaje reesculturado.
  final Map<String, double> _mmReescultura = {};

  /// Incidencias vigentes del vehículo: las que pasa quien abre la pantalla
  /// MÁS las que se cargan del servidor. Entrando desde la ficha nadie las
  /// pasaba, así que la rueda se cambiaba y la incidencia seguía abierta.
  List<Incidencia> _incidencias = [];

  // Incidencia (con problemas abiertos) por posición: para pintar el rojo y
  // ofrecer las operaciones en el panel de la rueda.
  Map<String, Incidencia> _incidenciaPorPosicion = {};

  void _indexarIncidencias(List<Incidencia> lista) {
    final porId = <String, Incidencia>{};
    for (final inc in [...widget.incidencias, ...lista]) {
      porId[inc.id] = inc; // la del servidor pisa a la recibida: es más fresca
    }
    _incidencias = porId.values.toList();
    final map = <String, Incidencia>{};
    for (final inc in _incidencias) {
      final pid = inc.posicionId;
      if (pid == null) continue;
      if (!inc.problemas.any((p) => p.abierto)) continue;
      map[pid] = inc; // si hay varias, la última gana (poco habitual)
    }
    _incidenciaPorPosicion = map;
  }

  /// Problemas abiertos (etiquetas) de una posición aún no atendida en esta sesión.
  List<String>? _problemasVigentes(String posId) {
    if (_posicionesMontadas.contains(posId) || _posicionesResueltas.contains(posId)) return null;
    final inc = _incidenciaPorPosicion[posId];
    if (inc == null) return null;
    final labels = inc.problemas.where((p) => p.abierto).map((p) => problemaLabel(p.tipo)).toList();
    return labels.isEmpty ? null : labels;
  }

  /// Tipos de problema abiertos de una posición (claves, p. ej. 'pinchazo').
  Set<String> _tiposVigentes(String posId) {
    final inc = _incidenciaPorPosicion[posId];
    if (inc == null) return {};
    return inc.problemas.where((p) => p.abierto).map((p) => p.tipo).toSet();
  }

  double? _aspect;
  ImageStream? _stream;
  ImageStreamListener? _listener;

  List<Map<String, dynamic>>? _montajeAntes; // estado del vehículo al abrir (plano "antes")

  @override
  void initState() {
    super.initState();
    // Si venimos de una incidencia, abrimos el panel de operaciones sobre ella.
    _posSeleccionada = widget.posicionInicialId;
    _cargar();
  }

  @override
  void dispose() {
    if (_stream != null && _listener != null) _stream!.removeListener(_listener!);
    super.dispose();
  }

  static String _baseMedida(String? s) {
    final t = (s ?? '').toUpperCase().replaceAll(RegExp(r'\s+'), '');
    final m = RegExp(r'(\d{2,3})(?:/(\d{2,3}))?R?(\d{1,2}(?:[.,]\d)?)').firstMatch(t);
    if (m == null) return t;
    final perfil = m.group(2);
    return '${m.group(1)}${perfil != null ? '/$perfil' : ''}R${m.group(3)!.replaceAll(',', '.')}';
  }

  Future<void> _cargar() async {
    setState(() { _loading = true; _error = null; });
    try {
      final v = await TyreControlApi.obtenerVehiculoCompleto(widget.vehiculoId);
      if (v == null) throw Exception('Vehículo no encontrado');
      _empresaId = v['empresa_id'] as String?;
      // Pausas de productividad: se crean al conocer la empresa (una vez).
      if (_empresaId != null) {
        _pausas ??= PausaController(
          contexto: 'operacion',
          empresaId: _empresaId!,
          vehiculoId: widget.vehiculoId,
        );
      }
      _matricula = (v['matricula'] as String?) ?? '';
      final tipoId = v['tipo_vehiculo_id'] as String?;

      final results = await Future.wait([
        tipoId != null ? TyreControlApi.listarPosiciones(tipoId) : Future.value(<PosicionVehiculo>[]),
        TyreControlApi.listarMontajesVehiculo(widget.vehiculoId),
        TyreControlApi.mapaMedidas(),
        TyreControlApi.listarEjesDeVehiculo(widget.vehiculoId),
        _empresaId != null ? TyreControlApi.stockAlmacenEmpresa(_empresaId!) : Future.value(<StockAlmacenLinea>[]),
        TyreControlApi.ultimasMedicionesPorNeumatico(widget.vehiculoId),
        TyreControlApi.datosCatalogoPorModelo(),
        TyreControlApi.marcasRecauchutadas(), // para el distintivo RECAUCH.
        TyreControlApi.incidenciasAbiertasDeVehiculo(widget.vehiculoId),
      ]);

      // Se reindexa en cada carga: tras resolver una, deja de salir en rojo.
      _indexarIncidencias(results[8] as List<Incidencia>);

      final medidas = results[2] as Map<String, String>;
      final ejes = results[3] as List<Map<String, dynamic>>;
      final porEje = (v['medidas_por_eje'] as bool?) == true;
      final set = <String>{};
      if (porEje) {
        for (final e in ejes) {
          final lbl = medidas[e['medida_id']];
          if (lbl != null) set.add(_baseMedida(lbl));
        }
      } else {
        final lbl = medidas[v['medida_id']];
        if (lbl != null) set.add(_baseMedida(lbl));
      }

      final tipo = v['tipo'];
      final cfgEjes = v['config_ejes'];
      // Imagen con los ejes separados: solo esta pantalla. Si existe, se usa y
      // se remapean las tarjetas (ver _remapCambioY); si no, imagen normal.
      final imgCambio = tipo is Map ? tipo['imagen_chasis_cambio_url'] as String? : null;
      final usarCambio = imgCambio != null && imgCambio.isNotEmpty;
      // Manda la imagen de la configuración de ejes; la del tipo es el respaldo.
      String? img = cfgEjes is Map ? cfgEjes['imagen_chasis_url'] as String? : null;
      if (img == null || img.isEmpty) img = tipo is Map ? tipo['imagen_chasis_url'] as String? : null;
      if (usarCambio) img = imgCambio;

      final posiciones = results[0] as List<PosicionVehiculo>;
      // Presión recomendada por eje (para las tarjetas).
      final ejesSet = posiciones.map((p) => p.eje).whereType<int>().toSet().toList();
      Map<int, ({num presion, num margen})> presObj = {};
      if (ejesSet.isNotEmpty) {
        presObj = await TyreControlApi.presionesObjetivoDeVehiculo(widget.vehiculoId, ejesSet);
      }
      // Umbrales de profundidad: deciden si la rueda está bien, justa o mal.
      final ({UmbralConfig? empresa, Map<String, UmbralConfig> porMedida}) umb = _empresaId != null
          ? await TyreControlApi.umbralesDeEmpresa(_empresaId!)
          : (empresa: null, porMedida: <String, UmbralConfig>{});

      if (!mounted) return;
      setState(() {
        _posiciones = posiciones;
        _montajePorPosicion = {for (final m in results[1] as List<MontajeActual>) m.posicionId: m};
        _medidasVehiculo = set;
        _stock = (results[4] as List<StockAlmacenLinea>)
            .where((l) => set.isEmpty || set.contains(_baseMedida(l.medida)))
            .toList();
        _mediciones = results[5] as Map<String, RevisionDetalleDraft>;
        _datosCat = results[6] as Map<String, ({double? prof, double? pres})>;
        _presionesObjetivo = presObj;
        _umbralEmpresa = umb.empresa;
        _umbralPorMedida = umb.porMedida;
        _imagenChasis = (img != null && img.isNotEmpty) ? img : null;
        _ejesSeparados = usarCambio;
      });
      // El plano "antes" se congela con el estado de la PRIMERA carga.
      _montajeAntes ??= _snapshotActual();
      if (_imagenChasis != null) _resolverImagen(_imagenChasis!);
    } catch (e) {
      if (!mounted) return;
      setState(() => _error = '$e');
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  /// Estado actual del vehículo (posición → neumático + avería + coordenadas)
  /// para pintar el plano "antes" sobre la imagen real del chasis.
  List<Map<String, dynamic>> _snapshotActual() {
    final out = <Map<String, dynamic>>[];
    for (int i = 0; i < _posiciones.length; i++) {
      final p = _posiciones[i];
      final co = _coords(p, i);
      final m = _montajePorPosicion[p.id];
      final n = m?.neumatico;
      final med = m != null ? _mediciones[m.neumaticoId] : null;
      final inc = _incidenciaPorPosicion[p.id];
      final tipos = inc?.problemas.where((x) => x.abierto).map((x) => problemaLabel(x.tipo)).toList();
      out.add({
        'posicion_id': p.id,
        'codigo': p.codigoPosicion,
        'eje': p.eje,
        'x': co.x, 'y': co.y, 'w': co.w, 'h': co.h,
        'marca': n?.marca,
        'modelo': n?.modelo,
        'medida': n?.medida,
        'mm': med?.profundidadMm ?? n?.profundidadActualMm?.toDouble(),
        'presion': med?.presionBar,
        // Distintivos del propio neumático, para que el "antes" de la
        // intervención los conserve aunque luego cambie la rueda.
        'reesc': n?.reesculturado == true,
        'girado': n?.giradoEnLlanta == true,
        'recau': n != null && TyreControlApi.esMarcaRecauchutada(n.marca),
        'averias': (tipos != null && tipos.isNotEmpty) ? tipos : null,
      });
    }
    return out;
  }

  /// Incidencias de origen (posición + averías) para la ficha de la intervención.
  List<Map<String, dynamic>> _incidenciasOrigen() {
    final out = <Map<String, dynamic>>[];
    for (final inc in _incidencias) {
      final tipos = inc.problemas.where((x) => x.abierto).map((x) => problemaLabel(x.tipo)).toList();
      out.add({
        'posicion_id': inc.posicionId,
        'codigo': inc.posicionNombre,
        'averias': tipos,
        'gravedad': gravedadLabel(inc.gravedad),
      });
    }
    return out;
  }

  void _resolverImagen(String url) {
    _stream?.removeListener(_listener!);
    final img = NetworkImage(url);
    _stream = img.resolve(ImageConfiguration.empty);
    _listener = ImageStreamListener((info, _) {
      final w = info.image.width.toDouble(), h = info.image.height.toDouble();
      if (h > 0 && mounted) setState(() => _aspect = w / h);
    }, onError: (_, __) { if (mounted) setState(() => _aspect = 0.62); });
    _stream!.addListener(_listener!);
  }

  // ── Acciones ──────────────────────────────────────────────────────────────
  Future<void> _desmontar(MontajeActual m, String destino) async {
    setState(() => _trabajando = true);
    try {
      await TyreControlApi.desmontarNeumatico(montajeId: m.id, destino: destino);
      HapticFeedback.mediumImpact();
      await _cargar();
      final msg = destino == 'almacen'
          ? 'Desmontado y devuelto al almacén (usado)'
          : destino == 'pendiente_reciclaje'
              ? 'Enviado a la papelera de reciclaje'
              : 'Neumático descartado';
      _aviso(msg, ok: destino != 'descartado');
    } catch (e) { _aviso('Error: $e', ok: false); }
    finally { if (mounted) setState(() => _trabajando = false); }
  }

  /// Finalizar: da por solucionadas las incidencias de las posiciones donde se
  /// ha montado un neumático (sustitución completada); el resto sigue pendiente.
  Future<void> _finalizar() async {
    // Cierra la intervención (agrupa las operaciones de la sesión + informe IA)
    // aportando el estado "antes" y las incidencias de origen para la trazabilidad.
    setState(() => _trabajando = true);
    // Cronometraje: una pausa sin reanudar se cierra al finalizar la sesión.
    await _pausas?.cerrarSiActiva();
    await TyreControlApi.cerrarIntervencion(
      widget.vehiculoId, _abiertoEn,
      montajeAntes: _montajeAntes,
      incidencias: _incidenciasOrigen(),
      imagenChasis: _imagenChasis,
      pausaSeg: _pausas?.pausaSeg,
      nPausas: _pausas?.numPausas,
    );
    if (mounted) setState(() => _trabajando = false);

    // Posiciones sustituidas (se montó una rueda) cuya incidencia sigue abierta
    // y no se resolvió ya en sitio (reparación).
    final aResolver = _incidencias
        .where((i) => i.posicionId != null && _posicionesMontadas.contains(i.posicionId)
            && !_incidenciasResueltas.contains(i.id) && i.problemas.any((p) => p.abierto))
        .toList();
    final yaResueltas = _incidenciasResueltas.length; // reparaciones en sitio

    if (aResolver.isEmpty) {
      if (yaResueltas > 0) {
        _aviso('$yaResueltas incidencia(s) solucionada(s)', ok: true);
      } else if (_incidencias.isNotEmpty) {
        _aviso('No se ha actuado sobre las posiciones con incidencia; siguen pendientes.', ok: false);
      } else {
        _aviso('Cambios guardados', ok: true);
      }
      if (mounted) Navigator.of(context).pop(true);
      return;
    }

    setState(() => _trabajando = true);
    int ok = 0;
    try {
      for (final inc in aResolver) {
        final abiertos = inc.problemas.where((p) => p.abierto).map((p) => p.id).toList();
        try {
          await TyreControlApi.resolverIncidencia(
            incidenciaId: inc.id, problemaIds: abiertos, tipoOperacion: 'sustituir_neumatico',
            observaciones: 'Resuelto desde el cambio de neumático (app).');
          ok++;
        } catch (_) {}
      }
    } finally { if (mounted) setState(() => _trabajando = false); }

    final total = ok + yaResueltas;
    final pendientes = _incidencias.where((i) => i.problemas.any((p) => p.abierto)).length - total;
    _aviso(
      total > 0
          ? '$total incidencia(s) solucionada(s)${pendientes > 0 ? ' · $pendientes sigue(n) pendiente(s)' : ''}'
          : 'No se solucionó ninguna incidencia',
      ok: total > 0,
    );
    if (mounted) Navigator.of(context).pop(true);
  }

  /// "Ya solucionado": la avería que marcaba el aviso ya no existe (la rueda
  /// se cambió en otro momento, o el dato venía de una medición vieja). Cierra
  /// la incidencia sin registrar trabajo nuevo. Pide confirmación porque toca
  /// el historial del cliente.
  Future<void> _marcarYaSolucionado(PosicionVehiculo p, Incidencia inc, List<String> labels) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        title: Text('¿Ya está solucionado? · ${p.codigoPosicion}'),
        content: Text(
            'Se dará por cerrada la avería:\n\n${labels.join('\n')}\n\n'
            'Úsalo solo si has comprobado en el vehículo que ya no existe.'),
        actions: [
          TextButton(onPressed: () => Navigator.of(c).pop(false), child: const Text('Cancelar')),
          TextButton(
            onPressed: () => Navigator.of(c).pop(true),
            child: const Text('Sí, cerrarla', style: TextStyle(color: AppColors.success)),
          ),
        ],
      ),
    );
    if (ok != true) return;

    setState(() => _trabajando = true);
    try {
      final abiertos = inc.problemas.where((x) => x.abierto).map((x) => x.id).toList();
      await TyreControlApi.resolverIncidencia(
        incidenciaId: inc.id, problemaIds: abiertos, tipoOperacion: 'actualizar_neumatico',
        resultado: 'reparado',
        observaciones: 'Ya solucionado: comprobado en el vehículo (app · cambio de neumático).');
      _posicionesResueltas.add(p.id);
      _incidenciasResueltas.add(inc.id);
      HapticFeedback.mediumImpact();
      if (mounted) setState(() => _posSeleccionada = null);
      await _cargar();
      _aviso('Avería cerrada en ${p.codigoPosicion}', ok: true);
    } catch (e) { _aviso('Error: $e', ok: false); }
    finally { if (mounted) setState(() => _trabajando = false); }
  }

  /// Reparación en sitio (el neumático se queda): registra la operación y da la
  /// incidencia por resuelta. p. ej. "Reparar pinchazo", "Corregir presión".
  Future<void> _repararEnSitio(PosicionVehiculo p, Incidencia inc, String opKey, String label) async {
    setState(() => _trabajando = true);
    try {
      final abiertos = inc.problemas.where((x) => x.abierto).map((x) => x.id).toList();
      await TyreControlApi.resolverIncidencia(
        incidenciaId: inc.id, problemaIds: abiertos, tipoOperacion: opKey,
        resultado: 'reparado', observaciones: '$label (app · cambio de neumático).');
      _posicionesResueltas.add(p.id);
      _incidenciasResueltas.add(inc.id);
      HapticFeedback.mediumImpact();
      if (mounted) setState(() => _posSeleccionada = null);
      await _cargar();
      _aviso('$label registrada', ok: true);
    } catch (e) { _aviso('Error: $e', ok: false); }
    finally { if (mounted) setState(() => _trabajando = false); }
  }

  /// Avería irreparable: el neumático montado va directo a la papelera de
  /// reciclaje y la posición queda libre para montar una nueva/usada.
  Future<void> _marcarIrreparable(PosicionVehiculo p, MontajeActual m) async {
    setState(() => _trabajando = true);
    try {
      await TyreControlApi.desmontarNeumatico(montajeId: m.id, destino: 'pendiente_reciclaje');
      HapticFeedback.mediumImpact();
      await _cargar();
      _aviso('Neumático a la papelera de reciclaje. Monta ahora la rueda de sustitución.', ok: true);
    } catch (e) { _aviso('Error: $e', ok: false); }
    finally { if (mounted) setState(() => _trabajando = false); }
  }

  Future<void> _deshacer() async {
    setState(() => _trabajando = true);
    try {
      final res = await TyreControlApi.deshacerUltimaOperacion(widget.vehiculoId, _abiertoEn);
      HapticFeedback.mediumImpact();
      await _cargar();
      _aviso(res, ok: res != 'Nada que deshacer');
    } catch (e) { _aviso('Error al deshacer: $e', ok: false); }
    finally { if (mounted) setState(() => _trabajando = false); }
  }

  Future<void> _soltarStockEnPosicion(_DragStock d, PosicionVehiculo p) async {
    double? profUsado;
    if (d.condicion == 'usado') {
      profUsado = await _pedirProfundidad();
      if (profUsado == null) return; // canceló
    }
    setState(() => _trabajando = true);
    try {
      await TyreControlApi.montarDesdeAlmacen(
        vehiculoId: widget.vehiculoId, posicionId: p.id, productoAlmacenId: d.linea.productoId,
        condicion: d.condicion, profundidadUsado: profUsado,
      );
      _posicionesMontadas.add(p.id);
      HapticFeedback.mediumImpact();
      await _cargar();
      _aviso('Montado ${d.linea.marca} ${d.linea.medida} (${d.condicion}) en ${p.codigoPosicion}', ok: true);
    } catch (e) { _aviso('Error al montar: $e', ok: false); }
    finally { if (mounted) setState(() => _trabajando = false); }
  }

  Future<double?> _pedirProfundidad() async {
    final ctrl = TextEditingController();
    return showDialog<double>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Profundidad restante'),
        content: TextField(
          controller: ctrl, autofocus: true,
          keyboardType: const TextInputType.numberWithOptions(decimal: true),
          decoration: const InputDecoration(suffixText: 'mm', hintText: 'p. ej. 8.5'),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Cancelar')),
          TextButton(onPressed: () => Navigator.pop(ctx, 0.0), child: const Text('Sin medir')),
          FilledButton(onPressed: () => Navigator.pop(ctx, double.tryParse(ctrl.text.replaceAll(',', '.')) ?? 0.0), child: const Text('Montar')),
        ],
      ),
    );
  }

  void _aviso(String txt, {required bool ok, bool conDeshacer = false}) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(
      content: Text(txt),
      backgroundColor: ok ? AppColors.success : AppColors.danger,
      // Tras un movimiento se ofrece deshacer ahí mismo: es donde el técnico
      // mira cuando se da cuenta de que se ha equivocado.
      duration: Duration(seconds: conDeshacer ? 8 : 3),
      action: conDeshacer
          ? SnackBarAction(label: 'DESHACER', textColor: Colors.white, onPressed: _deshacer)
          : null,
    ));
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text(_matricula.isEmpty ? 'Cambiar neumáticos' : 'Cambiar · $_matricula'),
        actions: [
          if (_pausas != null) BotonPausa(controller: _pausas!),
          IconButton(
            tooltip: 'Catálogo de neumáticos',
            icon: const Icon(Icons.menu_book_outlined, color: Colors.white),
            onPressed: () => Navigator.of(context).push(
              MaterialPageRoute(builder: (_) => CatalogoScreen(medidasBase: _medidasVehiculo)),
            ),
          ),
          TextButton.icon(
            onPressed: _trabajando ? null : _deshacer,
            icon: const Icon(Icons.undo, color: Colors.white),
            label: const Text('Deshacer', style: TextStyle(color: Colors.white)),
          ),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 8),
            child: FilledButton.icon(
              style: FilledButton.styleFrom(backgroundColor: AppColors.success, foregroundColor: Colors.white),
              onPressed: _trabajando ? null : _finalizar,
              icon: const Icon(Icons.check_circle),
              label: const Text('Finalizar'),
            ),
          ),
        ],
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _error != null
              ? Center(child: Padding(padding: const EdgeInsets.all(24), child: Text(_error!, textAlign: TextAlign.center)))
              : _conPausa(Stack(children: [
                  // Sin panel lateral: el vehículo manda y ocupa el centro. El
                  // stock pasa arriba en una franja y las operaciones, abajo.
                  Column(children: [
                    if (_modoPermuta) _bandaPermuta(),
                    _franjaStock(),
                    Expanded(child: _zonaPlano()),
                    if (_posSel != null) _panelOperaciones(_posSel!),
                    _barraPlanTrabajo(),
                    _barraInferior(),
                  ]),
                  if (_trabajando)
                    const Positioned.fill(child: ColoredBox(color: Color(0x66000000), child: Center(child: CircularProgressIndicator()))),
                ])),
    );
  }

  /// Panel del plan de permutación: guía paso a paso, lista de movimientos
  /// apuntados (con X para quitarlos) y los botones de vaciar/aplicar.
  Widget _bandaPermuta() {
    final movs = _movimientosPlan;
    final paso1 = _permutaA == null;
    return Container(
      width: double.infinity,
      color: AppColors.info.withValues(alpha: 0.18),
      padding: const EdgeInsets.fromLTRB(14, 8, 14, 8),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [
          const Icon(Icons.swap_horiz, color: AppColors.info),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              _accionActiva != 'mover'
                  ? '${_kAcciones[_accionActiva]?.label.toUpperCase() ?? 'PLAN'} · Toca las ruedas afectadas. Nada se guarda hasta aplicar.'
                  : (paso1
                      ? 'PERMUTAR / MOVER · Toca la rueda que quieres mover.'
                      : 'PERMUTAR / MOVER · Ahora toca el sitio de destino. (Vuelve a tocar la marcada para soltarla.)'),
              style: const TextStyle(color: AppColors.info, fontWeight: FontWeight.w700, fontSize: 13),
            ),
          ),
          TextButton(
            onPressed: () => setState(() { _accionActiva = null; _permutaA = null; }),
            child: const Text('Salir'),
          ),
        ]),
        if (movs.isNotEmpty || _marcas.isNotEmpty) ...[
          const SizedBox(height: 6),
          Wrap(spacing: 6, runSpacing: 6, children: [
            // Chips de las acciones marcadas (una por rueda y tipo).
            for (final e in _marcas.entries)
              for (final tipo in e.value)
                Container(
                  padding: const EdgeInsets.only(left: 10, right: 2, top: 2, bottom: 2),
                  decoration: BoxDecoration(
                    color: AppColors.surface,
                    borderRadius: BorderRadius.circular(20),
                    border: Border.all(color: AppColors.info.withValues(alpha: 0.6)),
                  ),
                  child: Row(mainAxisSize: MainAxisSize.min, children: [
                    Icon(_kAcciones[tipo]?.icono ?? Icons.build, size: 14, color: AppColors.info),
                    const SizedBox(width: 5),
                    Text('${_codigo(_posDe(e.key))} · ${_kAcciones[tipo]?.label ?? tipo}',
                        style: const TextStyle(color: AppColors.textPrimary, fontSize: 12, fontWeight: FontWeight.w700)),
                    IconButton(
                      icon: const Icon(Icons.close, size: 16, color: AppColors.textSecondary),
                      visualDensity: VisualDensity.compact,
                      constraints: const BoxConstraints(minWidth: 30, minHeight: 30),
                      tooltip: 'Quitar del plan',
                      onPressed: () => setState(() {
                        _marcas[e.key]?.remove(tipo);
                        if (tipo == 'reescultura') _mmReescultura.remove(e.key);
                        if (_marcas[e.key]?.isEmpty ?? false) _marcas.remove(e.key);
                      }),
                    ),
                  ]),
                ),
            for (final mv in movs)
              Container(
                padding: const EdgeInsets.only(left: 10, right: 2, top: 2, bottom: 2),
                decoration: BoxDecoration(
                  color: AppColors.surface,
                  borderRadius: BorderRadius.circular(20),
                  border: Border.all(color: AppColors.info.withValues(alpha: 0.6)),
                ),
                child: Row(mainAxisSize: MainAxisSize.min, children: [
                  Text('${_codigo(mv.origenId)} → ${_codigo(mv.destinoId)}',
                      style: const TextStyle(color: AppColors.textPrimary, fontSize: 12, fontWeight: FontWeight.w700)),
                  IconButton(
                    icon: const Icon(Icons.close, size: 16, color: AppColors.textSecondary),
                    visualDensity: VisualDensity.compact,
                    constraints: const BoxConstraints(minWidth: 30, minHeight: 30),
                    tooltip: 'Quitar del plan',
                    onPressed: () => setState(() => _plan.remove(mv.destinoId)),
                  ),
                ]),
              ),
            TextButton.icon(
              onPressed: () => setState(() {
                _plan.clear(); _marcas.clear(); _mmReescultura.clear(); _permutaA = null;
              }),
              icon: const Icon(Icons.delete_outline, size: 18),
              label: const Text('Vaciar plan'),
            ),
            FilledButton.icon(
              style: FilledButton.styleFrom(backgroundColor: AppColors.success, foregroundColor: Colors.white),
              onPressed: _trabajando ? null : _aplicarPlan,
              icon: const Icon(Icons.check_circle),
              label: Text('Aplicar plan (${movs.length + _totalMarcas})'),
            ),
          ]),
        ],
      ]),
    );
  }

  /// Overlay de "Trabajo en pausa" sobre el contenido cuando toca.
  Widget _conPausa(Widget child) =>
      _pausas == null ? child : PausaOverlay(controller: _pausas!, child: child);

  // ── Plano ─────────────────────────────────────────────────────────────────
  // Las zonas de destino (almacén / papelera) ya no cuelgan de aquí: viven en
  // la barra inferior, junto al resto de operaciones.
  Widget _zonaPlano() {
    return _imagenChasis == null || _aspect == null
        ? Center(child: _imagenChasis == null
            ? const Text('Este vehículo no tiene plano configurado.', style: TextStyle(color: AppColors.textHint))
            : const CircularProgressIndicator())
        : Padding(padding: const EdgeInsets.all(8), child: _plano());
  }

  Widget _zonaDestino({required IconData icono, required String label, required Color color, required void Function(MontajeActual) onAccept}) {
    return DragTarget<_DragMontaje>(
      onWillAcceptWithDetails: (_) => true,
      onAcceptWithDetails: (d) => onAccept(d.data.m),
      builder: (ctx, cand, rej) {
        final activo = cand.isNotEmpty;
        return Container(
          height: 72,
          decoration: BoxDecoration(
            color: color.withValues(alpha: activo ? 0.28 : 0.10),
            borderRadius: BorderRadius.circular(14),
            border: Border.all(color: color.withValues(alpha: activo ? 1 : 0.5), width: activo ? 3 : 1.5),
          ),
          child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
            Icon(icono, color: color, size: 28),
            const SizedBox(height: 2),
            Text(label, style: TextStyle(color: color, fontSize: 12, fontWeight: FontWeight.w700)),
          ]),
        );
      },
    );
  }

  Widget _plano() {
    return LayoutBuilder(builder: (ctx, c) {
      final w = c.maxWidth;
      final h = (c.maxHeight.isFinite && c.maxHeight > 0)
          ? c.maxHeight
          : w / _aspect!;
      // Rectángulo (ox,oy,iw,ih) donde se dibuja la imagen dentro del área w×h.
      // SIEMPRE se respeta el aspecto real de la foto (contain), con o sin
      // ejes separados: el camión no se deforma ni en horizontal ni en
      // vertical, y las ruedas no salen ovaladas ("de bici").
      // El hueco que sobra a los lados no se desperdicia: es justo donde las
      // tarjetas de posición se abren (ver el factor `k` en _tarjetaPosicion).
      final a = _aspect!; // ancho / alto de la imagen
      double ox = 0, oy = 0, iw = w, ih = h;
      if (w / h >= a) {
        ih = h; iw = h * a; ox = (w - iw) / 2; oy = 0;
      } else {
        iw = w; ih = w / a; ox = 0; oy = (h - ih) / 2;
      }
      // Factor de apertura de las tarjetas. Al respetar el aspecto sobra hueco
      // a los lados; la CAPA DE TARJETAS se escala en horizontal respecto al
      // centro del plano para ocuparlo. Como todas se escalan igual y desde el
      // mismo centro, se separan del chasis y ENTRE SÍ: dos tarjetas que no se
      // pisaban (los gemelos de un eje) siguen sin pisarse. Con un tope de
      // anchura para que no salgan desproporcionadas cuando sobra muchísimo.
      final areaW = 2 * ox + iw;
      double anchoMaxPct = 0;
      for (int i = 0; i < _posiciones.length; i++) {
        final c2 = _coords(_posiciones[i], i);
        if (c2.w > anchoMaxPct) anchoMaxPct = c2.w;
      }
      final natMax = anchoMaxPct / 100 * iw; // la tarjeta más ancha, sin abrir
      double k = iw > 0 ? areaW / iw : 1.0;
      if (natMax > 0 && natMax * k > _kAnchoMaxTarjeta) k = _kAnchoMaxTarjeta / natMax;
      if (k < 1) k = 1;
      return SizedBox(
        width: w, height: h,
        child: Stack(children: [
          Positioned(
            left: ox, top: oy, width: iw, height: ih,
            child: ClipRRect(
              borderRadius: BorderRadius.circular(14),
              child: Image.network(_imagenChasis!, width: iw, height: ih, fit: BoxFit.fill,
                  errorBuilder: (_, __, ___) => Container(color: AppColors.surface)),
            ),
          ),
          for (int i = 0; i < _posiciones.length; i++)
            _tarjetaPosicion(_posiciones[i], i, ox, oy, iw, ih, k),
        ]),
      );
    });
  }

  ({double x, double y, double w, double h}) _coords(PosicionVehiculo p, int i) {
    double x, y, w, h;
    if (p.posX != null && p.posY != null && p.posW != null && p.posH != null) {
      x = p.posX!; y = p.posY!; w = p.posW!; h = p.posH!;
    } else {
      final col = i % 2, row = i ~/ 2;
      x = col == 0 ? 6.0 : 78.0; y = 8.0 + row * 18.0; w = 16.0; h = 13.0;
    }
    if (_ejesSeparados) y = _remapCambioY(y);
    return (x: x, y: y, w: w, h: h);
  }

  // Remap vertical de las tarjetas para la imagen con los ejes separados. Debe
  // coincidir con la edición de la foto: sobre la imagen 2x2x2 original (alto
  // 1024 px) se estiran ×1.8 los DOS tramos ENTRE ejes; el frente, las bandas
  // de ruedas y el faldón se dejan igual. Si esa imagen se regenera con otro
  // factor/bandas, actualizar estas constantes para que las tarjetas cuadren.
  /// Tope de anchura de una tarjeta de posición al abrirse hacia los lados.
  /// Por encima de esto no se gana legibilidad y se despegan de su rueda.
  static const double _kAnchoMaxTarjeta = 210;

  static const List<List<double>> _kCambioSegs = [
    [0.0, 168.0, 1.0], [168.0, 272.0, 1.0], [272.0, 420.0, 1.8],
    [420.0, 516.0, 1.0], [516.0, 668.0, 1.8], [668.0, 772.0, 1.0], [772.0, 1024.0, 1.0],
  ];
  double _remapCambioY(double yPct) {
    const origH = 1024.0;
    final y = (yPct / 100.0 * origH).clamp(0.0, origH);
    double newH = 0;
    for (final s in _kCambioSegs) {
      newH += (s[1] - s[0]) * s[2];
    }
    double cum = 0;
    for (final s in _kCambioSegs) {
      if (y <= s[1]) return (cum + (y - s[0]) * s[2]) / newH * 100.0;
      cum += (s[1] - s[0]) * s[2];
    }
    return cum / newH * 100.0;
  }

  void _toggleSeleccion(String posId) {
    if (_modoPermuta) {
      _tocarEnPermuta(posId);
      return;
    }
    setState(() => _posSeleccionada = _posSeleccionada == posId ? null : posId);
  }

  /// Montaje por id, para resolver el plan (que trabaja con montajeId).
  Map<String, MontajeActual> get _montajePorId =>
      {for (final m in _montajePorPosicion.values) m.id: m};

  /// Qué rueda acabará en esta posición según el plan: lo planificado, o la
  /// que hay ahora salvo que el plan la lleve a otro sitio (entonces, vacía).
  String? _ocupantePrevisto(String posId) {
    if (_plan.containsKey(posId)) return _plan[posId];
    final m = _montajePorPosicion[posId];
    if (m == null) return null;
    if (_plan.containsValue(m.id)) return null; // se marcha a otra posición
    return m.id;
  }

  /// Modo plan. Con "mover" se tocan origen y destino; con el resto de
  /// acciones, cada toque marca o desmarca la rueda.
  void _tocarEnPermuta(String posId) {
    if (_accionActiva != 'mover') {
      _marcarAccion(posId, _accionActiva!);
      return;
    }
    if (_permutaA == null) {
      if (_ocupantePrevisto(posId) == null) {
        _aviso('Empieza por una rueda: toca la que quieras mover.', ok: false);
        return;
      }
      setState(() => _permutaA = posId);
      return;
    }
    final aId = _permutaA!;
    if (aId == posId) {
      setState(() => _permutaA = null); // deseleccionar
      return;
    }
    final ocupA = _ocupantePrevisto(aId);
    final ocupB = _ocupantePrevisto(posId);
    if (ocupA == null) {
      setState(() => _permutaA = null);
      return;
    }
    setState(() {
      _plan[posId] = ocupA;
      // Si el destino tenía rueda, se va al origen (permuta). Si estaba vacío,
      // el origen queda libre: basta con que no haya nada apuntado para él.
      if (ocupB != null) {
        _plan[aId] = ocupB;
      } else {
        _plan.remove(aId);
      }
      _permutaA = null;
    });
  }

  /// Marca o desmarca una rueda con la acción activa (un toque marca, otro
  /// desmarca). Se avisa si la acción no aplica a ese neumático.
  void _marcarAccion(String posId, String tipo) {
    final m = _montajePorPosicion[posId];
    if (m == null) {
      _aviso('Esa posición no tiene neumático.', ok: false);
      return;
    }
    final yaMarcada = _marcas[m.id]?.contains(tipo) ?? false;
    if (!yaMarcada) {
      if (tipo == 'giro' && _esDireccional(m.neumatico)) {
        _aviso('Dibujo direccional: no se puede girar sobre la llanta.', ok: false);
        return;
      }
      // Tras reesculturar suelen quedar 8 mm: se propone y el técnico lo
      // acepta, lo corrige a mano o lo lee con la sonda.
      if (tipo == 'reescultura') _mmReescultura[m.id] = _kMmReesculturaDefecto;
    } else if (tipo == 'reescultura') {
      _mmReescultura.remove(m.id);
    }
    setState(() {
      final set = _marcas.putIfAbsent(m.id, () => <String>{});
      yaMarcada ? set.remove(tipo) : set.add(tipo);
      if (set.isEmpty) _marcas.remove(m.id);
    });
  }

  bool _esDireccional(Neumatico? n) {
    final txt = (n?.modelo ?? '').toUpperCase();
    return txt.contains('DIREC') || txt.endsWith(' D') || txt.contains(' DH');
  }

  /// Profundidad que queda habitualmente tras el corte. Es solo la propuesta.
  static const double _kMmReesculturaDefecto = 8.0;

  static const Map<String, ({String label, IconData icono})> _kAcciones = {
    'mover': (label: 'Permutar / mover', icono: Icons.swap_horiz),
    'reescultura': (label: 'Reesculturar', icono: Icons.content_cut),
    'giro': (label: 'Girar sobre llanta', icono: Icons.rotate_left),
    'pinchazo': (label: 'Reparar pinchazo', icono: Icons.tire_repair),
    'valvula': (label: 'Cambiar válvula', icono: Icons.air),
    'equilibrado': (label: 'Equilibrar', icono: Icons.balance),
  };

  /// Movimientos del plan ya resueltos: de qué posición sale cada rueda y a
  /// cuál va (se omiten las que acaban donde estaban).
  List<({String montajeId, String origenId, String destinoId})> get _movimientosPlan {
    final out = <({String montajeId, String origenId, String destinoId})>[];
    _plan.forEach((destinoId, montajeId) {
      final m = _montajePorId[montajeId];
      if (m == null || m.posicionId == destinoId) return;
      out.add((montajeId: montajeId, origenId: m.posicionId, destinoId: destinoId));
    });
    return out;
  }

  String _codigo(String posId) {
    final p = _posiciones.where((e) => e.id == posId);
    return p.isEmpty ? '—' : p.first.codigoPosicion;
  }

  /// Posición donde está hoy un montaje (para describirlo en el resumen).
  String _posDe(String montajeId) {
    for (final e in _montajePorPosicion.entries) {
      if (e.value.id == montajeId) return e.key;
    }
    return '';
  }

  Future<void> _aplicarPlan() async {
    final movs = _movimientosPlan;
    if (movs.isEmpty && _marcas.isEmpty) {
      _aviso('El plan está vacío: marca algo primero.', ok: false);
      return;
    }
    // Avisos agrupados (no bloquean): medidas distintas y cruces de lado.
    final avisos = <String>{};
    for (final mv in movs) {
      for (final a in _avisosPermuta(mv.origenId, mv.destinoId)) {
        avisos.add(a);
      }
    }
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: AppColors.surface,
        title: Text('Aplicar plan (${movs.length + _totalMarcas} acción(es))'),
        content: SingleChildScrollView(
          child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
            for (final mv in movs)
              Padding(
                padding: const EdgeInsets.only(bottom: 4),
                child: Text('${_desc(mv.origenId)}  →  ${_codigo(mv.destinoId)}',
                    style: const TextStyle(color: AppColors.textPrimary, fontSize: 13)),
              ),
            // Resumen por tipo de acción: "Reesculturar: E2_IZQ, E2_DER".
            for (final tipo in _kAcciones.keys.where((t) => t != 'mover'))
              if (_marcas.values.any((s) => s.contains(tipo)))
                Padding(
                  padding: const EdgeInsets.only(top: 6),
                  child: Text(
                    '${_kAcciones[tipo]!.label}: '
                    '${_marcas.entries.where((e) => e.value.contains(tipo)).map((e) => _codigo(_posDe(e.key))).join(', ')}',
                    style: const TextStyle(color: AppColors.textPrimary, fontSize: 13, fontWeight: FontWeight.w700),
                  ),
                ),
            if (_mmReescultura.isNotEmpty) ...[
              const SizedBox(height: 8),
              const Text('Profundidad que queda tras el corte (mm)',
                  style: TextStyle(color: AppColors.textSecondary, fontSize: 11, fontWeight: FontWeight.w800)),
              for (final e in _mmReescultura.entries)
                _CampoReescultura(
                  codigo: _codigo(_posDe(e.key)),
                  valorInicial: e.value,
                  onCambio: (v) => _mmReescultura[e.key] = v,
                ),
            ],
            for (final a in avisos)
              Padding(
                padding: const EdgeInsets.only(top: 10),
                child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  const Icon(Icons.warning_amber_rounded, size: 18, color: AppColors.warning),
                  const SizedBox(width: 6),
                  Expanded(child: Text(a, style: const TextStyle(color: AppColors.warning, fontSize: 13))),
                ]),
              ),
          ]),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.of(ctx).pop(false), child: const Text('Cancelar')),
          FilledButton(onPressed: () => Navigator.of(ctx).pop(true), child: const Text('Aplicar')),
        ],
      ),
    );
    if (ok != true || !mounted) return;

    setState(() => _trabajando = true);
    try {
      final acciones = <Map<String, dynamic>>[
        for (final e in _plan.entries) {'tipo': 'mover', 'montaje': e.value, 'posicion': e.key},
        for (final e in _marcas.entries)
          for (final tipo in e.value)
            {'tipo': tipo, 'montaje': e.key, if (tipo == 'reescultura') 'valor': _mmReescultura[e.key]},
      ];
      await TyreControlApi.aplicarPlanTrabajo(vehiculoId: widget.vehiculoId, acciones: acciones);
      _posicionesMontadas.addAll(_plan.keys);
      HapticFeedback.mediumImpact();
      await _cargar();
      if (!mounted) return;
      final n = movs.length + _totalMarcas;
      setState(() {
        _plan.clear(); _marcas.clear(); _mmReescultura.clear();
        _permutaA = null; _accionActiva = null;
      });
      _aviso('Plan aplicado: $n acción(es).', ok: true, conDeshacer: true);
    } catch (e) {
      _aviso('No se pudo aplicar el plan: $e', ok: false);
    } finally {
      if (mounted) setState(() => _trabajando = false);
    }
  }

  int get _totalMarcas => _marcas.values.fold(0, (a, s) => a + s.length);

  /// Atajo por arrastre: soltar una rueda montada sobre otra posición del
  /// plano. Pasa por el mismo diálogo de confirmación que el modo permuta.
  void _soltarMontajeEnPosicion(MontajeActual m, PosicionVehiculo destino) {
    final origenId = m.posicionId;
    if (origenId == destino.id) return;
    _confirmarPermuta(origenId, destino.id);
  }

  String _desc(String posId) {
    final p = _posiciones.firstWhere((e) => e.id == posId);
    final m = _montajePorPosicion[posId];
    final n = m?.neumatico;
    if (n == null) return '${p.nombre ?? p.codigoPosicion} · vacía';
    final med = _mediciones[m!.neumaticoId];
    final prof = med?.profundidadMm ?? n.profundidadActualMm?.toDouble();
    final marca = [n.marca, n.modelo].whereType<String>().join(' ');
    return '${p.nombre ?? p.codigoPosicion} · $marca${prof != null ? ' · ${prof.toStringAsFixed(1)} mm' : ''}';
  }

  /// Avisos que NO bloquean: medidas distintas o cruce de lado. El técnico
  /// decide, pero se le enseña antes de tocar nada.
  List<String> _avisosPermuta(String aId, String bId) {
    final avisos = <String>[];
    final na = _montajePorPosicion[aId]?.neumatico;
    final nb = _montajePorPosicion[bId]?.neumatico;
    if (na != null && nb != null && na.medida != null && nb.medida != null && na.medida != nb.medida) {
      avisos.add('Las medidas son distintas: ${na.medida} y ${nb.medida}.');
    }
    final pa = _posiciones.firstWhere((e) => e.id == aId);
    final pb = _posiciones.firstWhere((e) => e.id == bId);
    final ladoA = pa.codigoPosicion.toUpperCase();
    final ladoB = pb.codigoPosicion.toUpperCase();
    bool izq(String c) => c.contains('IZQ');
    bool der(String c) => c.contains('DER');
    if ((izq(ladoA) && der(ladoB)) || (der(ladoA) && izq(ladoB))) {
      avisos.add('Cambian de lado: si el dibujo es direccional, girarían al revés.');
    }
    return avisos;
  }

  Future<void> _confirmarPermuta(String aId, String bId) async {
    final mA = _montajePorPosicion[aId];
    if (mA == null) {
      setState(() => _permutaA = null);
      return;
    }
    final mB = _montajePorPosicion[bId];
    final esMover = mB == null; // destino vacío → mover, no permutar
    final avisos = esMover ? const <String>[] : _avisosPermuta(aId, bId);

    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: AppColors.surface,
        title: Text(esMover ? 'Mover a posición vacía' : 'Permutar neumáticos'),
        content: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(_desc(aId), style: const TextStyle(color: AppColors.textPrimary, fontWeight: FontWeight.w700)),
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 6),
            child: Row(children: [
              Icon(esMover ? Icons.arrow_downward : Icons.swap_vert, color: AppColors.info),
              const SizedBox(width: 8),
              Text(esMover ? 'se mueve a' : 'se intercambia con',
                  style: const TextStyle(color: AppColors.textSecondary)),
            ]),
          ),
          Text(_desc(bId), style: const TextStyle(color: AppColors.textPrimary, fontWeight: FontWeight.w700)),
          for (final a in avisos)
            Padding(
              padding: const EdgeInsets.only(top: 10),
              child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                const Icon(Icons.warning_amber_rounded, size: 18, color: AppColors.warning),
                const SizedBox(width: 6),
                Expanded(child: Text(a, style: const TextStyle(color: AppColors.warning, fontSize: 13))),
              ]),
            ),
        ]),
        actions: [
          TextButton(onPressed: () => Navigator.of(ctx).pop(false), child: const Text('Cancelar')),
          FilledButton(onPressed: () => Navigator.of(ctx).pop(true), child: const Text('Confirmar')),
        ],
      ),
    );
    if (ok != true || !mounted) {
      setState(() => _permutaA = null);
      return;
    }

    setState(() => _trabajando = true);
    try {
      if (esMover) {
        await TyreControlApi.cambiarPosicion(montajeId: mA.id, posicionDestinoId: bId);
      } else {
        await TyreControlApi.intercambiarPosiciones(montajeAId: mA.id, montajeBId: mB.id);
      }
      _posicionesMontadas.addAll([aId, bId]);
      HapticFeedback.mediumImpact();
      await _cargar();
      if (!mounted) return;
      setState(() { _permutaA = null; _posSeleccionada = null; });
      _aviso(esMover ? 'Movido correctamente.' : 'Permutadas correctamente.', ok: true, conDeshacer: true);
    } catch (e) {
      if (mounted) setState(() => _permutaA = null);
      _aviso('No se pudo completar: $e', ok: false);
    } finally {
      if (mounted) setState(() => _trabajando = false);
    }
  }

  Widget _tarjetaPosicion(PosicionVehiculo p, int i, double ox, double oy, double iw, double ih, double k) {
    final co = _coords(p, i);
    // `k` viene calculado en _plano(): es lo que se abren las tarjetas hacia
    // los lados para aprovechar el hueco que deja la foto proporcionada.
    final areaW = 2 * ox + iw;
    final cardW = co.w / 100 * iw * k;
    // En modo plan el plano enseña CÓMO VA A QUEDAR: cada posición pinta la
    // rueda que acabará ahí, con una etiqueta de dónde viene.
    final mReal = _montajePorPosicion[p.id];
    String? vieneDe;
    MontajeActual? mPrev = mReal;
    if (_modoPermuta) {
      final ocupId = _ocupantePrevisto(p.id);
      mPrev = ocupId == null ? null : _montajePorId[ocupId];
      if (mPrev != null && mPrev.posicionId != p.id) vieneDe = _codigo(mPrev.posicionId);
    }
    final m = mPrev;
    final resaltar = p.id == widget.posicionInicialId;
    final problemas = _problemasVigentes(p.id);
    final esA = _modoPermuta && _permutaA == p.id;
    final sel = _posSeleccionada == p.id || esA;
    final anilloSel = sel
        ? BoxDecoration(
            borderRadius: BorderRadius.circular(13),
            border: Border.all(color: AppColors.info, width: esA ? 3 : 2),
          )
        : null;
    // Anclada por el CENTRO y separada del eje del camión por el mismo factor
    // `k`, para que la tarjeta se abra hacia fuera sin despegarse de su rueda.
    final centroPlano = ox + iw / 2;
    final centroX = ox + (co.x + co.w / 2) / 100 * iw;
    final centroAbierto = centroPlano + (centroX - centroPlano) * k;
    final topeIzq = areaW - cardW;
    return Positioned(
      left: (centroAbierto - cardW / 2).clamp(0.0, topeIzq < 0 ? 0.0 : topeIzq),
      top: (oy + co.y / 100 * ih).clamp(0.0, oy + ih - 44),
      width: cardW,
      child: Column(mainAxisSize: MainAxisSize.min, children: [
        Container(
          decoration: anilloSel,
          padding: sel ? const EdgeInsets.all(2) : EdgeInsets.zero,
          // Además del stock, las posiciones aceptan otra RUEDA MONTADA: es el
          // atajo de permuta (soltar rueda sobre rueda = intercambiar; sobre
          // hueco vacío = mover).
          child: m != null
              ? DragTarget<_DragMontaje>(
                  onWillAcceptWithDetails: (d) => !_modoPermuta && d.data.m.id != m.id,
                  onAcceptWithDetails: (d) => _soltarMontajeEnPosicion(d.data.m, p),
                  builder: (ctx, cand, rej) => Draggable<_DragMontaje>(
                    // Con un plan abierto no se arrastra: el arrastre guarda al
                    // momento y se mezclaría con lo que hay apuntado sin aplicar.
                    maxSimultaneousDrags: _modoPermuta ? 0 : 1,
                    data: _DragMontaje(m),
                    feedback: _cardMontado(p, m, cardW, arrastrando: true),
                    childWhenDragging: Opacity(opacity: 0.3, child: _cardMontado(p, m, cardW)),
                    child: GestureDetector(
                      onTap: () => _toggleSeleccion(p.id),
                      child: _cardMontado(p, m, cardW,
                          resaltar: resaltar || cand.isNotEmpty, conIncidencia: problemas != null),
                    ),
                  ),
                )
              : DragTarget<Object>(
                  onWillAcceptWithDetails: (d) =>
                      !_modoPermuta && (d.data is _DragStock || d.data is _DragMontaje),
                  onAcceptWithDetails: (d) {
                    final data = d.data;
                    if (data is _DragStock) {
                      _soltarStockEnPosicion(data, p);
                    } else if (data is _DragMontaje) {
                      _soltarMontajeEnPosicion(data.m, p);
                    }
                  },
                  builder: (ctx, cand, rej) => GestureDetector(
                    onTap: () => _toggleSeleccion(p.id),
                    child: _cardVacia(p, cardW, activo: cand.isNotEmpty, resaltar: problemas != null),
                  ),
                ),
        ),
        if (vieneDe != null)
          Container(
            margin: const EdgeInsets.only(top: 3),
            padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
            decoration: BoxDecoration(
              color: AppColors.info.withValues(alpha: 0.22),
              borderRadius: BorderRadius.circular(8),
              border: Border.all(color: AppColors.info),
            ),
            child: Text('viene de $vieneDe',
                style: const TextStyle(color: AppColors.info, fontSize: 9.5, fontWeight: FontWeight.w800)),
          ),
        if (problemas != null) _bannerIncidencia(problemas),
      ]),
    );
  }

  // Etiqueta roja con los problemas abiertos de la posición (p. ej. "Pinchazo").
  Widget _bannerIncidencia(List<String> labels) {
    return Container(
      margin: const EdgeInsets.only(top: 3),
      padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 3),
      decoration: BoxDecoration(
        color: AppColors.danger.withValues(alpha: 0.20),
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: AppColors.danger.withValues(alpha: 0.85)),
      ),
      child: Row(mainAxisSize: MainAxisSize.min, mainAxisAlignment: MainAxisAlignment.center, children: [
        const Icon(Icons.warning_amber_rounded, size: 12, color: AppColors.danger),
        const SizedBox(width: 3),
        Flexible(
          child: Text(labels.join(' · '),
              style: const TextStyle(color: AppColors.danger, fontSize: 9.5, fontWeight: FontWeight.w800, height: 1.1),
              maxLines: 3, textAlign: TextAlign.center),
        ),
      ]),
    );
  }

  /// Umbral efectivo: override por medida del neumático → empresa → app.
  Umbrales _umbralDe(PosicionVehiculo p) {
    final medida = _montajePorPosicion[p.id]?.neumatico?.medida;
    UmbralConfig? c;
    if (medida != null) {
      c = _umbralPorMedida[medida.toUpperCase().replaceAll(RegExp(r'\s+'), '')];
    }
    c ??= _umbralEmpresa;
    if (c == null) return Umbrales.def;
    return Umbrales(profCriticaMm: c.minimaMm, profAvisoMm: c.avisoMm);
  }

  Widget _cardMontado(PosicionVehiculo p, MontajeActual m, double cardW, {bool resaltar = false, bool arrastrando = false, bool conIncidencia = false}) {
    final n = m.neumatico;
    // Medición del PROPIO neumático (no de la posición): un nuevo no hereda mm del anterior.
    final med = _mediciones[m.neumaticoId];
    final obj = p.eje != null ? _presionesObjetivo[p.eje] : null;
    final cat = n != null ? _datosCat[TyreControlApi.claveCatalogo(n.marca, n.modelo, n.medida)] : null;
    // Profundidad: revisión → profundidad actual (dibujo/usado) → dibujo del catálogo.
    final prof = med?.profundidadMm ?? n?.profundidadActualMm?.toDouble() ?? cat?.prof;
    // Presión: revisión → presión recomendada del eje → presión máx. del catálogo.
    final pres = med?.presionBar ?? obj?.presion.toDouble() ?? cat?.pres;
    final profTxt = prof != null ? '${prof.toStringAsFixed(1)} mm' : '— mm';
    final presTxt = pres != null ? '${pres.toStringAsFixed(1)} bar' : '— bar';
    final esNuevoReciente = med == null && (n?.origen == 'almacen_generico' || n?.origen == 'catalogo_sin_stock');
    // Estado de la rueda: nuevo (verde brillante) > incidencia abierta (rojo) >
    // diagnóstico por umbral (verde claro / naranja / rojo). Sin datos, gris.
    final TireStatus estado = esNuevoReciente
        ? TireStatus.nuevo
        : (conIncidencia
            ? TireStatus.grave
            : (med == null && prof == null
                ? TireStatus.pendiente
                : _umbralDe(p).evaluar(
                    med ?? RevisionDetalleDraft(posicionId: p.id, profundidadMm: prof),
                    presionObjetivo: obj?.presion,
                    margenPresion: obj?.margen)));
    // El recuadro se pinta ENTERO del color del estado: es lo que se lee de un
    // vistazo con guantes y reflejos. Arrastrando manda el azul de "en
    // movimiento" y se deja sin pintar para no confundir.
    // El relleno lo manda la BANDA DE PROFUNDIDAD del informe de flota: el
    // técnico ve el mismo color que verá el cliente en su informe. Sin
    // profundidad conocida se cae al color del estado (gris de pendiente…).
    final banda = prof != null ? bandaProfundidad(prof) : null;
    final fill = arrastrando ? null : (banda?.fondo ?? tireStatusFill(estado));
    // El marco sigue marcando el contexto de la operación (arrastre, rueda
    // resaltada por incidencia). Y, como el relleno ya no dice si la rueda
    // está mal, el marco pasa a decirlo: una avería con 15 mm saldría verde
    // oscuro y sin esto no se distinguiría de una rueda sana.
    final alerta = estado == TireStatus.grave || estado == TireStatus.advertencia;
    final borde = arrastrando
        ? AppColors.info
        : (resaltar
            ? AppColors.warning
            : (alerta
                ? tireStatusColor(estado)
                : (fill != null ? Color.alphaBlend(Colors.black.withValues(alpha: 0.30), fill) : tireStatusColor(estado))));
    final cTexto = fill != null ? (banda?.tinta ?? tireStatusOnFill(estado)) : AppColors.textPrimary;
    final cSuave = fill != null ? cTexto.withValues(alpha: 0.72) : AppColors.textSecondary;
    final cAcento = fill != null ? cTexto : borde;
    final card = Container(
      width: cardW,
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 5),
      decoration: BoxDecoration(
        color: fill ?? AppColors.surface.withValues(alpha: 0.94),
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: borde, width: (resaltar || conIncidencia) ? 3 : 2),
      ),
      child: Column(mainAxisSize: MainAxisSize.min, children: [
        Text(p.codigoPosicion, style: TextStyle(fontSize: 9, fontWeight: FontWeight.w700, color: cAcento), maxLines: 1, overflow: TextOverflow.ellipsis),
        Text(n?.marca ?? '—', style: TextStyle(fontSize: 11, fontWeight: FontWeight.w700, color: cTexto), maxLines: 1, overflow: TextOverflow.ellipsis),
        Text(n?.medida ?? '', style: TextStyle(fontSize: 9, color: cSuave), maxLines: 1, overflow: TextOverflow.ellipsis),
        if (n != null &&
            (esNuevoReciente ||
                TyreControlApi.esMarcaRecauchutada(n.marca) ||
                n.reesculturado ||
                n.giradoEnLlanta))
          Wrap(alignment: WrapAlignment.center, spacing: 3, children: [
            // "Nuevo" ya no se ve por el color (ahora manda la profundidad),
            // así que se dice con todas las letras.
            if (esNuevoReciente) EtiquetaNeu(txt: 'NEW', color: cTexto, fondo: AppColors.tireNuevo),
            if (TyreControlApi.esMarcaRecauchutada(n.marca)) EtiquetaNeu(txt: 'RECAUCH.', color: cTexto),
            if (n.reesculturado) EtiquetaNeu(txt: 'REESC.', color: cTexto, fondo: AppColors.reesculturado),
            if (n.giradoEnLlanta) EtiquetaNeu(txt: 'GIRADO', color: cTexto),
          ]),
        Text('$profTxt · $presTxt', style: TextStyle(fontSize: 10, fontWeight: FontWeight.w700, color: cAcento), maxLines: 1, overflow: TextOverflow.ellipsis),
      ]),
    );
    return arrastrando ? Material(color: Colors.transparent, child: card) : card;
  }

  Widget _cardVacia(PosicionVehiculo p, double cardW, {bool activo = false, bool resaltar = false}) {
    final color = activo ? AppColors.info : (resaltar ? AppColors.danger : AppColors.cardBorder);
    return Container(
      width: cardW,
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 8),
      decoration: BoxDecoration(
        color: activo ? AppColors.info.withValues(alpha: 0.2) : AppColors.surface.withValues(alpha: 0.55),
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: color, width: (activo || resaltar) ? 3 : 1.5, style: BorderStyle.solid),
      ),
      child: Column(mainAxisSize: MainAxisSize.min, children: [
        Text(p.codigoPosicion, style: const TextStyle(fontSize: 9, fontWeight: FontWeight.w700, color: AppColors.textSecondary), maxLines: 1, overflow: TextOverflow.ellipsis),
        const SizedBox(height: 2),
        Icon(Icons.add_circle_outline, size: 16, color: activo ? AppColors.info : AppColors.textHint),
        Text(activo ? 'Soltar aquí' : 'Libre', style: TextStyle(fontSize: 9, color: activo ? AppColors.info : AppColors.textHint)),
      ]),
    );
  }

  PosicionVehiculo? get _posSel {
    final id = _posSeleccionada;
    if (id == null) return null;
    for (final p in _posiciones) {
      if (p.id == id) return p;
    }
    return null;
  }

  // Reparaciones "en sitio" sugeridas según los tipos de avería (el neumático
  // se queda montado). Excluye sustituciones (esas se hacen desmontando+montando).
  List<({String key, String label, IconData icon})> _accionesEnSitio(Set<String> tipos) {
    const enSitu = {
      'corregir_presion', 'reparar_pinchazo', 'cambiar_valvula', 'equilibrar',
      'solicitar_alineacion', 'reapretar', 'actualizar_neumatico',
    };
    final out = <({String key, String label, IconData icon})>[];
    for (final k in operacionesSugeridas(tipos)) {
      if (!enSitu.contains(k)) continue;
      final o = operacionPorKey(k);
      out.add((key: k, label: o.label, icon: o.icon));
    }
    return out;
  }

  /// Posición vacía seleccionada: con ella, tocar una tarjeta de stock monta
  /// directamente (sin arrastrar). Lo consultan la franja y la barra inferior.
  PosicionVehiculo? get _montarEn {
    final p = _posSel;
    return (p != null && !_montajePorPosicion.containsKey(p.id)) ? p : null;
  }

  // ── Franja superior: stock del cliente ────────────────────────────────────
  // Mismo contenido que tenía el panel lateral (título, medida, aviso y las
  // tarjetas arrastrables), pero en horizontal y a todo el ancho.
  Widget _franjaStock() {
    final medidaTxt = _medidasVehiculo.isEmpty ? 'todas' : _medidasVehiculo.join(' · ');
    final nuevos = _stock.where((l) => l.nuevo > 0).toList();
    final usados = _stock.where((l) => l.usado > 0).toList();
    final montarEn = _montarEn;
    return Container(
      width: double.infinity,
      decoration: const BoxDecoration(
        color: AppColors.surface,
        border: Border(bottom: BorderSide(color: AppColors.cardBorder)),
      ),
      padding: const EdgeInsets.fromLTRB(12, 8, 12, 8),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [
          const Text('STOCK DEL CLIENTE', style: TextStyle(color: AppColors.textSecondary, fontSize: 11, fontWeight: FontWeight.w800, letterSpacing: 0.4)),
          const SizedBox(width: 10),
          Text('Medida: $medidaTxt', style: const TextStyle(color: AppColors.textHint, fontSize: 11)),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              montarEn != null
                  ? 'Toca una rueda para montarla en ${montarEn.codigoPosicion}.'
                  : 'Arrastra una tarjeta a una posición libre.',
              textAlign: TextAlign.right,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(color: montarEn != null ? AppColors.info : AppColors.textHint, fontSize: 11, fontWeight: montarEn != null ? FontWeight.w700 : FontWeight.w400),
            ),
          ),
        ]),
        const SizedBox(height: 6),
        (nuevos.isEmpty && usados.isEmpty)
            ? const Padding(
                padding: EdgeInsets.symmetric(vertical: 6),
                child: Text('Sin stock de esta medida en el almacén del cliente.',
                    style: TextStyle(color: AppColors.textHint, fontSize: 13)),
              )
            : SizedBox(
                height: 58,
                child: ListView(scrollDirection: Axis.horizontal, children: [
                  if (nuevos.isNotEmpty) _grupoStock('Nuevos', nuevos, 'nuevo', AppColors.success, montarEn),
                  if (usados.isNotEmpty) _grupoStock('Usados', usados, 'usado', AppColors.warning, montarEn),
                ]),
              ),
      ]),
    );
  }

  // ── Barra de plan de trabajo (debajo del vehículo) ────────────────────────
  // Los mismos botones de siempre y en el mismo orden; solo cambian de sitio y
  // se reparten en filas según el ancho que haya.
  Widget _barraPlanTrabajo() {
    return Container(
      width: double.infinity,
      decoration: const BoxDecoration(
        border: Border(top: BorderSide(color: AppColors.cardBorder)),
      ),
      padding: const EdgeInsets.fromLTRB(12, 8, 12, 8),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        const Text('PLAN DE TRABAJO',
            style: TextStyle(color: AppColors.textSecondary, fontSize: 11, fontWeight: FontWeight.w800, letterSpacing: 0.4)),
        const SizedBox(height: 6),
        LayoutBuilder(builder: (ctx, c) {
          const sep = 8.0;
          final total = _kAcciones.length;
          // Tantos botones por fila como quepan sin bajar de ~190 px de ancho.
          int porFila = ((c.maxWidth + sep) / (190 + sep)).floor();
          if (porFila < 2) porFila = 2;
          if (porFila > total) porFila = total;
          final ancho = (c.maxWidth - sep * (porFila - 1)) / porFila;
          return Wrap(
            spacing: sep,
            runSpacing: sep,
            children: [
              for (final e in _kAcciones.entries)
                SizedBox(width: ancho, child: _btnAccion(e.key, e.value.label, e.value.icono)),
            ],
          );
        }),
      ]),
    );
  }

  // ── Barra inferior: destinos del desmontaje + montaje sin stock ───────────
  Widget _barraInferior() {
    final montarEn = _montarEn;
    final almacen = _zonaDestino(icono: Icons.warehouse, label: 'Almacén (usado)', color: AppColors.info,
        onAccept: (m) => _desmontar(m, 'almacen'));
    final papelera = _zonaDestino(icono: Icons.recycling, label: 'Papelera (reciclaje)', color: AppColors.danger,
        onAccept: (m) => _desmontar(m, 'pendiente_reciclaje'));
    // Montaje SIN control de stock: el botón usado ya decide el comportamiento
    // (no hay checkboxes ni preguntas de inventario).
    final nuevo = _btnSinStock('Montar neumático NUEVO', AppColors.success, montarEn, 'nuevo');
    final usado = _btnSinStock('Montar neumático USADO', AppColors.warning, montarEn, 'usado');
    const rotulo = Text('SIN CONTROL DE STOCK',
        style: TextStyle(color: AppColors.textSecondary, fontSize: 11, fontWeight: FontWeight.w800, letterSpacing: 0.4));
    return Padding(
      padding: const EdgeInsets.fromLTRB(12, 0, 12, 10),
      child: LayoutBuilder(builder: (ctx, c) {
        // Con sitio de sobra, los cuatro en una fila; si no, dos y dos.
        if (c.maxWidth >= 900) {
          return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            const Row(children: [Spacer(flex: 2), Expanded(flex: 2, child: rotulo)]),
            const SizedBox(height: 4),
            Row(children: [
              Expanded(child: almacen),
              const SizedBox(width: 8),
              Expanded(child: papelera),
              const SizedBox(width: 8),
              Expanded(child: SizedBox(height: 72, child: nuevo)),
              const SizedBox(width: 8),
              Expanded(child: SizedBox(height: 72, child: usado)),
            ]),
          ]);
        }
        return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(children: [
            Expanded(child: almacen),
            const SizedBox(width: 8),
            Expanded(child: papelera),
          ]),
          const SizedBox(height: 8),
          rotulo,
          const SizedBox(height: 4),
          Row(children: [
            Expanded(child: nuevo),
            const SizedBox(width: 8),
            Expanded(child: usado),
          ]),
        ]);
      }),
    );
  }

  /// Botón de acción del plan: al pulsarlo queda activo y las ruedas que se
  /// toquen a continuación se marcan con esa acción.
  Widget _btnAccion(String tipo, String label, IconData icono) {
    final activo = _accionActiva == tipo;
    final n = tipo == 'mover'
        ? _movimientosPlan.length
        : _marcas.values.where((s) => s.contains(tipo)).length;
    return OutlinedButton.icon(
      onPressed: _trabajando
          ? null
          : () => setState(() {
                _accionActiva = activo ? null : tipo;
                _permutaA = null;
                if (_accionActiva != null) _posSeleccionada = null;
              }),
      icon: Icon(icono, color: activo ? Colors.white : AppColors.info),
      label: Text('$label${n > 0 ? '  ($n)' : ''}',
          style: TextStyle(
              color: activo ? Colors.white : AppColors.info, fontWeight: FontWeight.w700)),
      style: OutlinedButton.styleFrom(
        // Mismo tamaño que los botones de montaje: se pulsan con guantes.
        minimumSize: const Size.fromHeight(50),
        alignment: Alignment.centerLeft,
        backgroundColor: activo ? AppColors.info : null,
        side: BorderSide(color: AppColors.info.withValues(alpha: activo ? 1 : 0.55)),
      ),
    );
  }

  Widget _btnSinStock(String label, Color color, PosicionVehiculo? montarEn, String condicion) {
    return OutlinedButton.icon(
      onPressed: _trabajando ? null : () => _montarSinStock(condicion, montarEn),
      icon: Icon(Icons.add_circle_outline, color: color),
      label: Text(label, style: TextStyle(color: color, fontWeight: FontWeight.w700)),
      style: OutlinedButton.styleFrom(
        minimumSize: const Size.fromHeight(50),
        side: BorderSide(color: color.withValues(alpha: montarEn != null ? 0.9 : 0.4)),
        alignment: Alignment.centerLeft,
      ),
    );
  }

  /// Flujo sin stock: posición vacía seleccionada → catálogo (medida ya
  /// filtrada) → elegir → montar. El botón pulsado decide nuevo/usado y que
  /// NO se toca el inventario; solo el usado pide las profundidades reales.
  Future<void> _montarSinStock(String condicion, PosicionVehiculo? p) async {
    if (p == null) {
      _aviso('Toca primero una posición VACÍA en el plano y vuelve a pulsar el botón.', ok: false);
      return;
    }
    final ref = await Navigator.of(context).push<Map<String, dynamic>>(MaterialPageRoute(
      builder: (_) => CatalogoScreen(
        medidasBase: _medidasVehiculo,
        seleccion: true,
        subtitulo: 'Montar ${condicion.toUpperCase()} en ${p.codigoPosicion}',
      ),
    ));
    if (ref == null || !mounted) return; // canceló
    final refId = ref['id'] as String?;
    if (refId == null) {
      _aviso('Esta referencia del catálogo no se puede montar (sin id).', ok: false);
      return;
    }
    double? profUsado;
    if (condicion == 'usado') {
      profUsado = await _pedirProfundidad();
      if (profUsado == null) return; // canceló
    }
    setState(() => _trabajando = true);
    try {
      await TyreControlApi.montarDesdeCatalogo(
        vehiculoId: widget.vehiculoId,
        posicionId: p.id,
        referenciaId: refId,
        condicion: condicion,
        profundidadUsado: profUsado,
      );
      _posicionesMontadas.add(p.id);
      HapticFeedback.mediumImpact();
      await _cargar();
      if (mounted) setState(() => _posSeleccionada = null);
      _aviso('Montado ${ref['marca']} ${ref['modelo'] ?? ''} (${condicion == 'nuevo' ? 'nuevo' : 'usado'}, sin stock) en ${p.codigoPosicion}', ok: true);
    } catch (e) {
      final txt = '$e'.contains('MEDIDA_INCOMPATIBLE')
          ? 'Medida no homologada para este vehículo.'
          : 'Error al montar: $e';
      _aviso(txt, ok: false);
    } finally {
      if (mounted) setState(() => _trabajando = false);
    }
  }

  // Bloque de operaciones para la posición seleccionada, según su avería.
  Widget _panelOperaciones(PosicionVehiculo p) {
    final inc = _incidenciaPorPosicion[p.id];
    final m = _montajePorPosicion[p.id];
    final atendida = _posicionesMontadas.contains(p.id) || _posicionesResueltas.contains(p.id);
    final tipos = atendida ? <String>{} : _tiposVigentes(p.id);
    final labels = atendida ? <String>[] : (_problemasVigentes(p.id) ?? const []);
    final acciones = _accionesEnSitio(tipos);
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.fromLTRB(12, 12, 12, 12),
      decoration: BoxDecoration(
        color: AppColors.surfaceVariant,
        border: Border(bottom: BorderSide(color: AppColors.danger.withValues(alpha: labels.isNotEmpty ? 0.6 : 0.0))),
      ),
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Row(children: [
          Expanded(
            child: Text('OPERACIÓN · ${p.codigoPosicion}',
                style: const TextStyle(color: AppColors.textSecondary, fontSize: 11, fontWeight: FontWeight.w800, letterSpacing: 0.4)),
          ),
          GestureDetector(
            onTap: () => setState(() => _posSeleccionada = null),
            child: const Icon(Icons.close, size: 18, color: AppColors.textHint),
          ),
        ]),
        if (labels.isNotEmpty) ...[
          const SizedBox(height: 4),
          Text('Avería: ${labels.join(' · ')}',
              style: const TextStyle(color: AppColors.danger, fontSize: 12, fontWeight: FontWeight.w800)),
          const SizedBox(height: 6),
          // Escape para cuando la avería ya no existe: la rueda se cambió en
          // otro momento, o el aviso venía de una medición vieja. Sin esto la
          // incidencia se queda abierta para siempre.
          SizedBox(
            width: 320,
            child: _btnOp(Icons.task_alt, 'Ya solucionado', AppColors.success,
                onTap: inc == null ? null : () => _marcarYaSolucionado(p, inc, labels)),
          ),
        ],
        const SizedBox(height: 8),
        if (m != null) ...[
          // Ahora esta banda va a todo el ancho, bajo el vehículo: los botones
          // se reparten en horizontal en vez de apilarse.
          Wrap(spacing: 8, children: [
            // Reparaciones en sitio sugeridas (el neumático se queda).
            for (final a in acciones)
              SizedBox(
                width: 280,
                child: _btnOp(a.icon, a.label, AppColors.success,
                    onTap: inc == null ? null : () => _repararEnSitio(p, inc, a.key, a.label)),
              ),
            // Avería irreparable → a la papelera de reciclaje.
            SizedBox(
              width: 280,
              child: _btnOp(Icons.recycling, 'Avería irreparable · a papelera', AppColors.danger,
                  onTap: () => _marcarIrreparable(p, m)),
            ),
            // Desmontar reutilizable → almacén como usado.
            SizedBox(
              width: 280,
              child: _btnOp(Icons.warehouse, 'Desmontar · al almacén (usado)', AppColors.info,
                  onTap: () => _desmontar(m, 'almacen')),
            ),
          ]),
          const Text('Para sustituir, desmonta y luego monta la rueda nueva o usada del stock.',
              style: TextStyle(color: AppColors.textHint, fontSize: 10.5)),
        ] else ...[
          Container(
            padding: const EdgeInsets.all(10),
            decoration: BoxDecoration(color: AppColors.info.withValues(alpha: 0.12), borderRadius: BorderRadius.circular(10)),
            child: const Row(children: [
              Icon(Icons.south, size: 16, color: AppColors.info),
              SizedBox(width: 6),
              Expanded(child: Text('Posición libre: toca una rueda del stock para montar la sustitución.',
                  style: TextStyle(color: AppColors.info, fontSize: 11, fontWeight: FontWeight.w700))),
            ]),
          ),
        ],
      ]),
    );
  }

  Widget _btnOp(IconData icon, String label, Color color, {VoidCallback? onTap}) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Material(
        color: color.withValues(alpha: onTap == null ? 0.06 : 0.16),
        borderRadius: BorderRadius.circular(10),
        child: InkWell(
          borderRadius: BorderRadius.circular(10),
          onTap: _trabajando ? null : onTap,
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 11),
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(10),
              border: Border.all(color: color.withValues(alpha: onTap == null ? 0.3 : 0.8)),
            ),
            child: Row(children: [
              Icon(icon, size: 18, color: color),
              const SizedBox(width: 8),
              Expanded(child: Text(label, style: TextStyle(color: color, fontSize: 12.5, fontWeight: FontWeight.w700))),
            ]),
          ),
        ),
      ),
    );
  }

  Future<void> _montarDesdeStockTap(StockAlmacenLinea l, String condicion, PosicionVehiculo p) async {
    await _soltarStockEnPosicion(_DragStock(l, condicion), p);
    if (mounted) setState(() => _posSeleccionada = null);
  }

  /// Grupo de tarjetas de stock. Va en la franja superior, así que se dispone
  /// en HORIZONTAL; el arrastre y el toque para montar no cambian.
  Widget _grupoStock(String titulo, List<StockAlmacenLinea> lineas, String condicion, Color color, PosicionVehiculo? montarEn) {
    return Row(crossAxisAlignment: CrossAxisAlignment.center, children: [
      Padding(padding: const EdgeInsets.symmetric(horizontal: 8),
        child: Text(titulo.toUpperCase(), style: TextStyle(color: color, fontSize: 11, fontWeight: FontWeight.w800))),
      ...lineas.map((l) {
        final cant = condicion == 'nuevo' ? l.nuevo : l.usado;
        final card = Draggable<_DragStock>(
          data: _DragStock(l, condicion),
          feedback: _cardStock(l, condicion, color, cant, arrastrando: true),
          childWhenDragging: Opacity(opacity: 0.4, child: _cardStock(l, condicion, color, cant)),
          child: _cardStock(l, condicion, color, cant, montable: montarEn != null),
        );
        return Padding(
          padding: const EdgeInsets.only(right: 8),
          // Con una posición vacía seleccionada, un toque monta directamente.
          child: montarEn != null
              ? GestureDetector(onTap: _trabajando ? null : () => _montarDesdeStockTap(l, condicion, montarEn), child: card)
              : card,
        );
      }),
    ]);
  }

  Widget _cardStock(StockAlmacenLinea l, String condicion, Color color, int cant, {bool arrastrando = false, bool montable = false}) {
    final card = Container(
      width: 240,
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
        color: AppColors.surfaceVariant,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: color.withValues(alpha: montable ? 0.9 : 0.5), width: montable ? 1.5 : 1),
      ),
      child: Row(children: [
        Icon(montable ? Icons.touch_app : Icons.drag_indicator, size: 18, color: montable ? color : AppColors.textHint),
        const SizedBox(width: 4),
        Expanded(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text('${l.marca} ${l.modelo ?? ''}'.trim(), style: const TextStyle(color: AppColors.textPrimary, fontSize: 13, fontWeight: FontWeight.w700), maxLines: 1, overflow: TextOverflow.ellipsis),
            Text(l.medida, style: const TextStyle(color: AppColors.textSecondary, fontSize: 11), maxLines: 1, overflow: TextOverflow.ellipsis),
          ]),
        ),
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
          decoration: BoxDecoration(color: color.withValues(alpha: 0.18), borderRadius: BorderRadius.circular(8)),
          child: Text('$cant', style: TextStyle(color: color, fontWeight: FontWeight.w800, fontSize: 14)),
        ),
      ]),
    );
    return arrastrando ? Material(color: Colors.transparent, child: card) : card;
  }
}

/// Campo de profundidad tras el reesculturado. Sale con el valor propuesto
/// (8 mm), que se acepta tal cual, se corrige a mano o se lee con la sonda.
class _CampoReescultura extends StatefulWidget {
  final String codigo;
  final double valorInicial;
  final void Function(double) onCambio;
  const _CampoReescultura({required this.codigo, required this.valorInicial, required this.onCambio});

  @override
  State<_CampoReescultura> createState() => _CampoReesculturaState();
}

class _CampoReesculturaState extends State<_CampoReescultura> {
  late final TextEditingController _c =
      TextEditingController(text: widget.valorInicial.toStringAsFixed(1));
  StreamSubscription<LecturaSonda>? _sub;
  bool _esperando = false;

  @override
  void dispose() {
    _sub?.cancel();
    _c.dispose();
    super.dispose();
  }

  void _leerConSonda() {
    if (_esperando) {
      _sub?.cancel();
      setState(() => _esperando = false);
      return;
    }
    setState(() => _esperando = true);
    _sub = ProbeSession.instance.onLectura.listen((l) {
      if (l.tipo != LecturaTipo.profundidad || l.valor == null) return;
      _c.text = l.valor!.toStringAsFixed(1);
      widget.onCambio(l.valor!);
      _sub?.cancel();
      if (mounted) setState(() => _esperando = false);
    });
  }

  @override
  Widget build(BuildContext context) {
    final conectada = ProbeSession.instance.conectada;
    return Padding(
      padding: const EdgeInsets.only(top: 6),
      child: Row(children: [
        SizedBox(
          width: 92,
          child: Text(widget.codigo,
              style: const TextStyle(color: AppColors.textPrimary, fontSize: 13)),
        ),
        SizedBox(
          width: 96,
          child: TextField(
            controller: _c,
            keyboardType: const TextInputType.numberWithOptions(decimal: true),
            decoration: const InputDecoration(isDense: true, suffixText: 'mm'),
            onChanged: (v) {
              final d = double.tryParse(v.replaceAll(',', '.'));
              if (d != null) widget.onCambio(d);
            },
          ),
        ),
        if (conectada)
          TextButton.icon(
            onPressed: _leerConSonda,
            icon: Icon(_esperando ? Icons.bluetooth_searching : Icons.bluetooth,
                size: 18, color: _esperando ? AppColors.warning : AppColors.info),
            label: Text(_esperando ? 'Mide…' : 'Sonda',
                style: TextStyle(color: _esperando ? AppColors.warning : AppColors.info, fontSize: 12)),
          ),
      ]),
    );
  }
}
