import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../models/models.dart';
import '../models/incidencias.dart';
import '../services/supabase_service.dart';
import '../theme/app_theme.dart';

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
  List<StockAlmacenLinea> _stock = [];
  Set<String> _medidasVehiculo = {}; // medidas base admitidas por el vehículo
  Map<String, RevisionDetalleDraft> _mediciones = {}; // última medición por NEUMÁTICO
  Map<int, ({num presion, num margen})> _presionesObjetivo = {}; // presión recomendada por eje
  Map<String, ({double? prof, double? pres})> _datosCat = {}; // catálogo por modelo (dibujo/presión máx)
  bool _trabajando = false;
  late final DateTime _abiertoEn = DateTime.now(); // para acotar el "deshacer" a esta sesión
  final Set<String> _posicionesMontadas = {}; // posiciones donde se montó un neumático en esta sesión
  final Set<String> _posicionesResueltas = {}; // reparaciones en sitio hechas en esta sesión
  final Set<String> _incidenciasResueltas = {}; // ids de incidencias ya resueltas (para no re-resolver al finalizar)
  String? _posSeleccionada; // posición elegida en el plano para operar desde el panel

  // Incidencia (con problemas abiertos) por posición: para pintar el rojo y
  // ofrecer las operaciones en el panel lateral.
  late final Map<String, Incidencia> _incidenciaPorPosicion = () {
    final map = <String, Incidencia>{};
    for (final inc in widget.incidencias) {
      final pid = inc.posicionId;
      if (pid == null) continue;
      if (!inc.problemas.any((p) => p.abierto)) continue;
      map[pid] = inc; // si hay varias, la última gana (poco habitual)
    }
    return map;
  }();

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
      ]);

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
      String? img = tipo is Map ? tipo['imagen_chasis_url'] as String? : null;
      if (img == null || img.isEmpty) img = cfgEjes is Map ? cfgEjes['imagen_chasis_url'] as String? : null;

      final posiciones = results[0] as List<PosicionVehiculo>;
      // Presión recomendada por eje (para las tarjetas).
      final ejesSet = posiciones.map((p) => p.eje).whereType<int>().toSet().toList();
      Map<int, ({num presion, num margen})> presObj = {};
      if (ejesSet.isNotEmpty) {
        presObj = await TyreControlApi.presionesObjetivoDeVehiculo(widget.vehiculoId, ejesSet);
      }

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
        _imagenChasis = (img != null && img.isNotEmpty) ? img : null;
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
        'averias': (tipos != null && tipos.isNotEmpty) ? tipos : null,
      });
    }
    return out;
  }

  /// Incidencias de origen (posición + averías) para la ficha de la intervención.
  List<Map<String, dynamic>> _incidenciasOrigen() {
    final out = <Map<String, dynamic>>[];
    for (final inc in widget.incidencias) {
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
    await TyreControlApi.cerrarIntervencion(
      widget.vehiculoId, _abiertoEn,
      montajeAntes: _montajeAntes,
      incidencias: _incidenciasOrigen(),
      imagenChasis: _imagenChasis,
    );
    if (mounted) setState(() => _trabajando = false);

    // Posiciones sustituidas (se montó una rueda) cuya incidencia sigue abierta
    // y no se resolvió ya en sitio (reparación).
    final aResolver = widget.incidencias
        .where((i) => i.posicionId != null && _posicionesMontadas.contains(i.posicionId)
            && !_incidenciasResueltas.contains(i.id) && i.problemas.any((p) => p.abierto))
        .toList();
    final yaResueltas = _incidenciasResueltas.length; // reparaciones en sitio

    if (aResolver.isEmpty) {
      if (yaResueltas > 0) {
        _aviso('$yaResueltas incidencia(s) solucionada(s)', ok: true);
      } else if (widget.incidencias.isNotEmpty) {
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
    final pendientes = widget.incidencias.where((i) => i.problemas.any((p) => p.abierto)).length - total;
    _aviso(
      total > 0
          ? '$total incidencia(s) solucionada(s)${pendientes > 0 ? ' · $pendientes sigue(n) pendiente(s)' : ''}'
          : 'No se solucionó ninguna incidencia',
      ok: total > 0,
    );
    if (mounted) Navigator.of(context).pop(true);
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

  void _aviso(String txt, {required bool ok}) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(
      content: Text(txt), backgroundColor: ok ? AppColors.success : AppColors.danger, duration: const Duration(seconds: 3),
    ));
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text(_matricula.isEmpty ? 'Cambiar neumáticos' : 'Cambiar · $_matricula'),
        actions: [
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
              : Stack(children: [
                  Row(children: [
                    Expanded(child: _zonaPlano()),
                    _panelStock(),
                  ]),
                  if (_trabajando)
                    const Positioned.fill(child: ColoredBox(color: Color(0x66000000), child: Center(child: CircularProgressIndicator()))),
                ]),
    );
  }

  // ── Plano + zonas de destino ──────────────────────────────────────────────
  Widget _zonaPlano() {
    return Column(children: [
      Expanded(
        child: _imagenChasis == null || _aspect == null
            ? Center(child: _imagenChasis == null
                ? const Text('Este vehículo no tiene plano configurado.', style: TextStyle(color: AppColors.textHint))
                : const CircularProgressIndicator())
            : Padding(padding: const EdgeInsets.all(8), child: _plano()),
      ),
      Padding(
        padding: const EdgeInsets.fromLTRB(8, 0, 8, 8),
        child: Row(children: [
          Expanded(child: _zonaDestino(icono: Icons.warehouse, label: 'Almacén (usado)', color: AppColors.info,
              onAccept: (m) => _desmontar(m, 'almacen'))),
          const SizedBox(width: 8),
          Expanded(child: _zonaDestino(icono: Icons.recycling, label: 'Papelera (reciclaje)', color: AppColors.danger,
              onAccept: (m) => _desmontar(m, 'pendiente_reciclaje'))),
        ]),
      ),
    ]);
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
      // Rellenamos toda el área disponible (la imagen se estira) para que los
      // ejes queden bien separados y las etiquetas/incidencias se lean. En una
      // tablet vertical sobra altura, así que priorizamos ocupar el alto.
      final w = c.maxWidth;
      final h = (c.maxHeight.isFinite && c.maxHeight > 0)
          ? c.maxHeight
          : w / _aspect!;
      return SizedBox(
        width: w, height: h,
        child: Stack(children: [
          ClipRRect(
            borderRadius: BorderRadius.circular(14),
            child: Image.network(_imagenChasis!, width: w, height: h, fit: BoxFit.fill,
                errorBuilder: (_, __, ___) => Container(color: AppColors.surface)),
          ),
          for (int i = 0; i < _posiciones.length; i++) _tarjetaPosicion(_posiciones[i], i, w, h),
        ]),
      );
    });
  }

  ({double x, double y, double w, double h}) _coords(PosicionVehiculo p, int i) {
    if (p.posX != null && p.posY != null && p.posW != null && p.posH != null) {
      return (x: p.posX!, y: p.posY!, w: p.posW!, h: p.posH!);
    }
    final col = i % 2, row = i ~/ 2;
    return (x: col == 0 ? 6.0 : 78.0, y: 8.0 + row * 18.0, w: 16.0, h: 13.0);
  }

  void _toggleSeleccion(String posId) {
    setState(() => _posSeleccionada = _posSeleccionada == posId ? null : posId);
  }

  Widget _tarjetaPosicion(PosicionVehiculo p, int i, double w, double h) {
    final co = _coords(p, i);
    final cardW = (co.w / 100 * w).clamp(96.0, 200.0);
    final m = _montajePorPosicion[p.id];
    final resaltar = p.id == widget.posicionInicialId;
    final problemas = _problemasVigentes(p.id);
    final sel = _posSeleccionada == p.id;
    final anilloSel = sel
        ? BoxDecoration(
            borderRadius: BorderRadius.circular(13),
            border: Border.all(color: AppColors.info, width: 2),
          )
        : null;
    return Positioned(
      left: (co.x / 100 * w).clamp(0.0, w - cardW),
      top: (co.y / 100 * h).clamp(0.0, h - 44),
      width: cardW,
      child: Column(mainAxisSize: MainAxisSize.min, children: [
        Container(
          decoration: anilloSel,
          padding: sel ? const EdgeInsets.all(2) : EdgeInsets.zero,
          child: m != null
              ? Draggable<_DragMontaje>(
                  data: _DragMontaje(m),
                  feedback: _cardMontado(p, m, cardW, arrastrando: true),
                  childWhenDragging: Opacity(opacity: 0.3, child: _cardMontado(p, m, cardW)),
                  child: GestureDetector(
                    onTap: () => _toggleSeleccion(p.id),
                    child: _cardMontado(p, m, cardW, resaltar: resaltar, conIncidencia: problemas != null),
                  ),
                )
              : DragTarget<_DragStock>(
                  onWillAcceptWithDetails: (_) => true,
                  onAcceptWithDetails: (d) => _soltarStockEnPosicion(d.data, p),
                  builder: (ctx, cand, rej) => GestureDetector(
                    onTap: () => _toggleSeleccion(p.id),
                    child: _cardVacia(p, cardW, activo: cand.isNotEmpty, resaltar: problemas != null),
                  ),
                ),
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

  // Verde oscuro para neumáticos NUEVOS recién montados (sin revisión aún).
  static const _verdeNuevo = Color(0xFF166534);

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
    // Prioridad de color de borde: arrastrando > nuevo reciente (verde oscuro) >
    // incidencia abierta (rojo) > resaltado por incidencia (ámbar) > normal (verde).
    final borde = arrastrando
        ? AppColors.info
        : (esNuevoReciente
            ? _verdeNuevo
            : (conIncidencia ? AppColors.danger : (resaltar ? AppColors.warning : AppColors.success)));
    final card = Container(
      width: cardW,
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 5),
      decoration: BoxDecoration(
        color: AppColors.surface.withValues(alpha: 0.94),
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: borde, width: (resaltar || conIncidencia) ? 3 : 2),
      ),
      child: Column(mainAxisSize: MainAxisSize.min, children: [
        Text(p.codigoPosicion, style: TextStyle(fontSize: 9, fontWeight: FontWeight.w700, color: borde), maxLines: 1, overflow: TextOverflow.ellipsis),
        Text(n?.marca ?? '—', style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w700, color: AppColors.textPrimary), maxLines: 1, overflow: TextOverflow.ellipsis),
        Text(n?.medida ?? '', style: const TextStyle(fontSize: 9, color: AppColors.textSecondary), maxLines: 1, overflow: TextOverflow.ellipsis),
        Text('$profTxt · $presTxt', style: TextStyle(fontSize: 10, fontWeight: FontWeight.w600, color: borde), maxLines: 1, overflow: TextOverflow.ellipsis),
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

  // ── Panel lateral: operaciones + stock ────────────────────────────────────
  Widget _panelStock() {
    final medidaTxt = _medidasVehiculo.isEmpty ? 'todas' : _medidasVehiculo.join(' · ');
    final nuevos = _stock.where((l) => l.nuevo > 0).toList();
    final usados = _stock.where((l) => l.usado > 0).toList();
    final p = _posSel;
    final montarEn = (p != null && !_montajePorPosicion.containsKey(p.id)) ? p : null; // posición vacía seleccionada
    return Container(
      width: 280,
      decoration: const BoxDecoration(
        color: AppColors.surface,
        border: Border(left: BorderSide(color: AppColors.cardBorder)),
      ),
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        if (p != null) _panelOperaciones(p),
        Padding(
          padding: const EdgeInsets.fromLTRB(12, 12, 12, 4),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            const Text('STOCK DEL CLIENTE', style: TextStyle(color: AppColors.textSecondary, fontSize: 11, fontWeight: FontWeight.w800, letterSpacing: 0.4)),
            Text('Medida: $medidaTxt', style: const TextStyle(color: AppColors.textHint, fontSize: 11)),
            Text(
              montarEn != null
                  ? 'Toca una rueda para montarla en ${montarEn.codigoPosicion}.'
                  : 'Arrastra una tarjeta a una posición libre.',
              style: TextStyle(color: montarEn != null ? AppColors.info : AppColors.textHint, fontSize: 11, fontWeight: montarEn != null ? FontWeight.w700 : FontWeight.w400),
            ),
          ]),
        ),
        Expanded(
          child: (nuevos.isEmpty && usados.isEmpty)
              ? const Center(child: Padding(padding: EdgeInsets.all(16), child: Text('Sin stock de esta medida en el almacén del cliente.', textAlign: TextAlign.center, style: TextStyle(color: AppColors.textHint, fontSize: 13))))
              : ListView(padding: const EdgeInsets.fromLTRB(10, 4, 10, 16), children: [
                  if (nuevos.isNotEmpty) _grupoStock('Nuevos', nuevos, 'nuevo', AppColors.success, montarEn),
                  if (usados.isNotEmpty) _grupoStock('Usados', usados, 'usado', AppColors.warning, montarEn),
                ]),
        ),
      ]),
    );
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
        ],
        const SizedBox(height: 8),
        if (m != null) ...[
          // Reparaciones en sitio sugeridas (el neumático se queda).
          for (final a in acciones)
            _btnOp(a.icon, a.label, AppColors.success,
                onTap: inc == null ? null : () => _repararEnSitio(p, inc, a.key, a.label)),
          // Avería irreparable → a la papelera de reciclaje.
          _btnOp(Icons.recycling, 'Avería irreparable · a papelera', AppColors.danger,
              onTap: () => _marcarIrreparable(p, m)),
          // Desmontar reutilizable → almacén como usado.
          _btnOp(Icons.warehouse, 'Desmontar · al almacén (usado)', AppColors.info,
              onTap: () => _desmontar(m, 'almacen')),
          const SizedBox(height: 4),
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

  Widget _grupoStock(String titulo, List<StockAlmacenLinea> lineas, String condicion, Color color, PosicionVehiculo? montarEn) {
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      Padding(padding: const EdgeInsets.symmetric(vertical: 6),
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
          padding: const EdgeInsets.only(bottom: 8),
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
