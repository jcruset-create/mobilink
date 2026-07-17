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
  bool _trabajando = false;
  late final DateTime _abiertoEn = DateTime.now(); // para acotar el "deshacer" a esta sesión
  final Set<String> _posicionesMontadas = {}; // posiciones donde se montó un neumático en esta sesión

  double? _aspect;
  ImageStream? _stream;
  ImageStreamListener? _listener;

  @override
  void initState() {
    super.initState();
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
        _presionesObjetivo = presObj;
        _imagenChasis = (img != null && img.isNotEmpty) ? img : null;
      });
      if (_imagenChasis != null) _resolverImagen(_imagenChasis!);
    } catch (e) {
      if (!mounted) return;
      setState(() => _error = '$e');
    } finally {
      if (mounted) setState(() => _loading = false);
    }
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
    final aResolver = widget.incidencias
        .where((i) => i.posicionId != null && _posicionesMontadas.contains(i.posicionId) && i.problemas.any((p) => p.abierto))
        .toList();

    if (widget.incidencias.isEmpty || aResolver.isEmpty) {
      if (widget.incidencias.isNotEmpty && aResolver.isEmpty) {
        _aviso('No se ha montado nada en las posiciones con incidencia; siguen pendientes.', ok: false);
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

    final pendientes = widget.incidencias.where((i) => i.problemas.any((p) => p.abierto)).length - ok;
    _aviso(
      ok > 0
          ? '$ok incidencia(s) solucionada(s)${pendientes > 0 ? ' · $pendientes sigue(n) pendiente(s)' : ''}'
          : 'No se solucionó ninguna incidencia',
      ok: ok > 0,
    );
    if (mounted) Navigator.of(context).pop(true);
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
      double w = c.maxWidth, h = w / _aspect!;
      if (c.maxHeight.isFinite && h > c.maxHeight) { h = c.maxHeight; w = h * _aspect!; }
      return Center(
        child: SizedBox(
          width: w, height: h,
          child: Stack(children: [
            ClipRRect(
              borderRadius: BorderRadius.circular(14),
              child: Image.network(_imagenChasis!, width: w, height: h, fit: BoxFit.fill,
                  errorBuilder: (_, __, ___) => Container(color: AppColors.surface)),
            ),
            for (int i = 0; i < _posiciones.length; i++) _tarjetaPosicion(_posiciones[i], i, w, h),
          ]),
        ),
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

  Widget _tarjetaPosicion(PosicionVehiculo p, int i, double w, double h) {
    final co = _coords(p, i);
    final cardW = (co.w / 100 * w).clamp(96.0, 200.0);
    final m = _montajePorPosicion[p.id];
    final resaltar = p.id == widget.posicionInicialId;
    return Positioned(
      left: (co.x / 100 * w).clamp(0.0, w - cardW),
      top: (co.y / 100 * h).clamp(0.0, h - 44),
      width: cardW,
      child: m != null
          ? Draggable<_DragMontaje>(
              data: _DragMontaje(m),
              feedback: _cardMontado(p, m, cardW, arrastrando: true),
              childWhenDragging: Opacity(opacity: 0.3, child: _cardMontado(p, m, cardW)),
              child: _cardMontado(p, m, cardW, resaltar: resaltar),
            )
          : DragTarget<_DragStock>(
              onWillAcceptWithDetails: (_) => true,
              onAcceptWithDetails: (d) => _soltarStockEnPosicion(d.data, p),
              builder: (ctx, cand, rej) => _cardVacia(p, cardW, activo: cand.isNotEmpty),
            ),
    );
  }

  // Verde oscuro para neumáticos NUEVOS recién montados (sin revisión aún).
  static const _verdeNuevo = Color(0xFF166534);

  Widget _cardMontado(PosicionVehiculo p, MontajeActual m, double cardW, {bool resaltar = false, bool arrastrando = false}) {
    final n = m.neumatico;
    // Medición del PROPIO neumático (no de la posición): un nuevo no hereda mm del anterior.
    final med = _mediciones[m.neumaticoId];
    final obj = p.eje != null ? _presionesObjetivo[p.eje] : null;
    // Profundidad: revisión del neumático → profundidad actual (dibujo/usado).
    final prof = med?.profundidadMm ?? n?.profundidadActualMm?.toDouble();
    // Presión: revisión del neumático → presión recomendada del eje.
    final pres = med?.presionBar ?? obj?.presion.toDouble();
    final profTxt = prof != null ? '${prof.toStringAsFixed(1)} mm' : '— mm';
    final presTxt = pres != null ? '${pres.toStringAsFixed(1)} bar' : '— bar';
    final esNuevoReciente = med == null && (n?.origen == 'almacen_generico' || n?.origen == 'catalogo_sin_stock');
    final borde = resaltar
        ? AppColors.warning
        : (arrastrando ? AppColors.info : (esNuevoReciente ? _verdeNuevo : AppColors.success));
    final card = Container(
      width: cardW,
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 5),
      decoration: BoxDecoration(
        color: AppColors.surface.withValues(alpha: 0.94),
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: borde, width: resaltar ? 3 : 2),
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

  Widget _cardVacia(PosicionVehiculo p, double cardW, {bool activo = false}) {
    return Container(
      width: cardW,
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 8),
      decoration: BoxDecoration(
        color: activo ? AppColors.info.withValues(alpha: 0.2) : AppColors.surface.withValues(alpha: 0.55),
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: activo ? AppColors.info : AppColors.cardBorder, width: activo ? 3 : 1.5, style: BorderStyle.solid),
      ),
      child: Column(mainAxisSize: MainAxisSize.min, children: [
        Text(p.codigoPosicion, style: const TextStyle(fontSize: 9, fontWeight: FontWeight.w700, color: AppColors.textSecondary), maxLines: 1, overflow: TextOverflow.ellipsis),
        const SizedBox(height: 2),
        Icon(Icons.add_circle_outline, size: 16, color: activo ? AppColors.info : AppColors.textHint),
        Text(activo ? 'Soltar aquí' : 'Libre', style: TextStyle(fontSize: 9, color: activo ? AppColors.info : AppColors.textHint)),
      ]),
    );
  }

  // ── Panel de stock (draggable) ────────────────────────────────────────────
  Widget _panelStock() {
    final medidaTxt = _medidasVehiculo.isEmpty ? 'todas' : _medidasVehiculo.join(' · ');
    final nuevos = _stock.where((l) => l.nuevo > 0).toList();
    final usados = _stock.where((l) => l.usado > 0).toList();
    return Container(
      width: 270,
      decoration: const BoxDecoration(
        color: AppColors.surface,
        border: Border(left: BorderSide(color: AppColors.cardBorder)),
      ),
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(12, 12, 12, 4),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            const Text('STOCK DEL CLIENTE', style: TextStyle(color: AppColors.textSecondary, fontSize: 11, fontWeight: FontWeight.w800, letterSpacing: 0.4)),
            Text('Medida: $medidaTxt', style: const TextStyle(color: AppColors.textHint, fontSize: 11)),
            const Text('Arrastra una tarjeta a una posición libre.', style: TextStyle(color: AppColors.textHint, fontSize: 11)),
          ]),
        ),
        Expanded(
          child: (nuevos.isEmpty && usados.isEmpty)
              ? const Center(child: Padding(padding: EdgeInsets.all(16), child: Text('Sin stock de esta medida en el almacén del cliente.', textAlign: TextAlign.center, style: TextStyle(color: AppColors.textHint, fontSize: 13))))
              : ListView(padding: const EdgeInsets.fromLTRB(10, 4, 10, 16), children: [
                  if (nuevos.isNotEmpty) _grupoStock('Nuevos', nuevos, 'nuevo', AppColors.success),
                  if (usados.isNotEmpty) _grupoStock('Usados', usados, 'usado', AppColors.warning),
                ]),
        ),
      ]),
    );
  }

  Widget _grupoStock(String titulo, List<StockAlmacenLinea> lineas, String condicion, Color color) {
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      Padding(padding: const EdgeInsets.symmetric(vertical: 6),
        child: Text(titulo.toUpperCase(), style: TextStyle(color: color, fontSize: 11, fontWeight: FontWeight.w800))),
      ...lineas.map((l) {
        final cant = condicion == 'nuevo' ? l.nuevo : l.usado;
        return Padding(
          padding: const EdgeInsets.only(bottom: 8),
          child: Draggable<_DragStock>(
            data: _DragStock(l, condicion),
            feedback: _cardStock(l, condicion, color, cant, arrastrando: true),
            childWhenDragging: Opacity(opacity: 0.4, child: _cardStock(l, condicion, color, cant)),
            child: _cardStock(l, condicion, color, cant),
          ),
        );
      }),
    ]);
  }

  Widget _cardStock(StockAlmacenLinea l, String condicion, Color color, int cant, {bool arrastrando = false}) {
    final card = Container(
      width: 240,
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
        color: AppColors.surfaceVariant,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: color.withValues(alpha: 0.5)),
      ),
      child: Row(children: [
        Icon(Icons.drag_indicator, size: 18, color: AppColors.textHint),
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
