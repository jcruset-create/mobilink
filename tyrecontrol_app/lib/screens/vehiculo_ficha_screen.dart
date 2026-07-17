import 'package:flutter/material.dart';
import '../models/models.dart';
import '../services/supabase_service.dart';
import '../theme/app_theme.dart';
import '../widgets/vehicle_layout_image.dart';
import 'cambio_neumatico_screen.dart';

/// Ficha del vehículo — réplica de solo lectura de la del panel web.
///
/// Mismas secciones: datos generales, kilometraje, plan de mantenimiento,
/// configuración de neumáticos, plano del vehículo, estructura de posiciones
/// e inspecciones. Sin acciones de edición (se hacen en el panel web).
class VehiculoFichaScreen extends StatefulWidget {
  final String vehiculoId;
  const VehiculoFichaScreen({super.key, required this.vehiculoId});

  @override
  State<VehiculoFichaScreen> createState() => _VehiculoFichaScreenState();
}

const _origenKmLabels = {
  'manual': 'Manual',
  'webfleet': 'Webfleet',
  'importacion_excel': 'Importación Excel',
};

const _estadoPlanLabels = {
  'correcta': 'Correcta',
  'proxima': 'Próxima',
  'vence_hoy': 'Vence hoy',
  'atrasada': 'Atrasada',
  'planificada': 'Planificada',
};

class _VehiculoFichaScreenState extends State<VehiculoFichaScreen> {
  bool _loading = true;
  String? _error;
  Map<String, dynamic>? _v;
  List<PosicionVehiculo> _posiciones = [];
  Map<String, MontajeActual> _montajePorPosicion = {};
  List<Map<String, dynamic>> _planes = [];
  Map<String, Map<String, dynamic>> _planEstado = {};
  List<Map<String, dynamic>> _ejes = [];
  List<Map<String, dynamic>> _revisiones = [];
  Map<String, String> _medidas = {};
  List<Map<String, dynamic>> _llantas = [];
  Map<String, RevisionDetalleDraft> _mediciones = {}; // última medición por posición
  String? _imagenChasis;

  @override
  void initState() {
    super.initState();
    _cargar();
  }

  Future<void> _cargar() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final v = await TyreControlApi.obtenerVehiculoCompleto(widget.vehiculoId);
      if (v == null) throw Exception('Vehículo no encontrado');

      final tipoId = v['tipo_vehiculo_id'] as String?;
      final results = await Future.wait([
        tipoId != null
            ? TyreControlApi.listarPosiciones(tipoId)
            : Future.value(<PosicionVehiculo>[]),
        TyreControlApi.listarMontajesVehiculo(widget.vehiculoId),
        TyreControlApi.listarPlanesMantenimiento(),
        TyreControlApi.listarPlanEstado(),
        TyreControlApi.listarEjesDeVehiculo(widget.vehiculoId),
        TyreControlApi.listarRevisionesDeVehiculo(widget.vehiculoId),
        TyreControlApi.mapaMedidas(),
        TyreControlApi.listarTiposLlantaCat(),
        TyreControlApi.ultimasMedicionesPorPosicion(widget.vehiculoId),
      ]);

      final montajes = results[1] as List<MontajeActual>;
      final planes = (results[2] as List<Map<String, dynamic>>)
          .where((p) => p['vehiculo_id'] == widget.vehiculoId)
          .toList();
      final estados = {
        for (final e in results[3] as List<Map<String, dynamic>>)
          e['plan_id'] as String: e
      };

      // Imagen del plano: la del tipo si la tiene; si no, la de la config de ejes.
      final tipo = v['tipo'];
      final cfgEjes = v['config_ejes'];
      String? img = tipo is Map ? tipo['imagen_chasis_url'] as String? : null;
      if (img == null || img.isEmpty) {
        img = cfgEjes is Map ? cfgEjes['imagen_chasis_url'] as String? : null;
      }

      if (!mounted) return;
      setState(() {
        _v = v;
        _posiciones = results[0] as List<PosicionVehiculo>;
        _montajePorPosicion = {for (final m in montajes) m.posicionId: m};
        _planes = planes;
        _planEstado = estados;
        _ejes = results[4] as List<Map<String, dynamic>>;
        _revisiones = results[5] as List<Map<String, dynamic>>;
        _medidas = results[6] as Map<String, String>;
        _llantas = results[7] as List<Map<String, dynamic>>;
        _mediciones = results[8] as Map<String, RevisionDetalleDraft>;
        _imagenChasis = (img != null && img.isNotEmpty) ? img : null;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() => _error = '$e');
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  String _medidaLabel(String? id) => id == null ? '—' : (_medidas[id] ?? '—');

  String _llantaLabel(String? id) {
    if (id == null) return '—';
    final l = _llantas.where((x) => x['id'] == id).firstOrNull;
    if (l == null) return '—';
    final material = (l['material'] as String?) ?? '';
    final partes = <String>[
      if (material.isNotEmpty)
        material[0].toUpperCase() + material.substring(1),
      if ((l['medida'] as String?)?.isNotEmpty == true) l['medida'] as String,
      if (l['agujeros'] != null) '${l['agujeros']} aguj.',
      if ((l['centrado'] as String?)?.isNotEmpty == true)
        l['centrado'] as String,
      (l['tapacubo'] as bool?) == true ? 'c/tapacubo' : 's/tapacubo',
    ];
    return partes.isEmpty ? '—' : partes.join(' · ');
  }

  @override
  Widget build(BuildContext context) {
    final v = _v;
    return Scaffold(
      appBar: AppBar(
        title: Text(v == null
            ? 'Ficha'
            : '${v['matricula']}${v['numero_unidad'] != null ? ' · Unidad ${v['numero_unidad']}' : ''}'),
        actions: [
          if (v != null)
            Padding(
              padding: const EdgeInsets.only(right: 12),
              child: Center(child: _badgeActivo((v['activo'] as bool?) ?? true)),
            ),
        ],
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _error != null
              ? Center(
                  child: Padding(
                    padding: const EdgeInsets.all(24),
                    child: Text(_error!,
                        textAlign: TextAlign.center,
                        style:
                            const TextStyle(color: AppColors.textSecondary)),
                  ),
                )
              : RefreshIndicator(
                  onRefresh: _cargar,
                  child: ListView(
                    padding: const EdgeInsets.all(12),
                    children: [
                      _datosGenerales(),
                      const SizedBox(height: 12),
                      _kilometraje(),
                      const SizedBox(height: 12),
                      _planMantenimiento(),
                      const SizedBox(height: 12),
                      _configNeumaticos(),
                      const SizedBox(height: 12),
                      _plano(),
                      const SizedBox(height: 12),
                      _estructuraPosiciones(),
                      const SizedBox(height: 12),
                      _inspecciones(),
                      const SizedBox(height: 24),
                    ],
                  ),
                ),
    );
  }

  Widget _badgeActivo(bool activo) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
        decoration: BoxDecoration(
          color: (activo ? AppColors.success : AppColors.textSecondary)
              .withValues(alpha: 0.15),
          borderRadius: BorderRadius.circular(8),
        ),
        child: Text(activo ? 'Activo' : 'Inactivo',
            style: TextStyle(
                color: activo ? AppColors.success : AppColors.textSecondary,
                fontSize: 11,
                fontWeight: FontWeight.w700)),
      );

  Widget _seccion(String titulo, Widget child) => Container(
        width: double.infinity,
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: AppColors.surface,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: AppColors.cardBorder),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(titulo.toUpperCase(),
                style: const TextStyle(
                    color: AppColors.textSecondary,
                    fontSize: 11,
                    fontWeight: FontWeight.w800,
                    letterSpacing: 0.4)),
            const SizedBox(height: 10),
            child,
          ],
        ),
      );

  Widget _dato(String label, String? valor) => Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(label,
              style:
                  const TextStyle(color: AppColors.textHint, fontSize: 10)),
          Text((valor == null || valor.isEmpty) ? '—' : valor,
              style: const TextStyle(
                  color: AppColors.textPrimary, fontSize: 13)),
        ],
      );

  static String? _nombre(dynamic rel) =>
      rel is Map ? rel['nombre'] as String? : null;

  Widget _datosGenerales() {
    final v = _v!;
    final tipo = v['tipo'];
    return _seccion(
      'Datos generales',
      Wrap(
        spacing: 24,
        runSpacing: 10,
        children: [
          _dato('Empresa', _nombre(v['empresa'])),
          _dato('Delegación', _nombre(v['delegacion'])),
          _dato('Nº de unidad', v['numero_unidad'] as String?),
          _dato('Marca', v['marca'] as String?),
          _dato('Modelo', v['modelo'] as String?),
          _dato(
              'Tipo',
              tipo is Map
                  ? ((tipo['descripcion'] as String?) ??
                      (tipo['nombre'] as String?))
                  : null),
          _dato('Bastidor', v['bastidor'] as String?),
          _dato('Fecha matriculación', v['fecha_matriculacion'] as String?),
          _dato('Webfleet ID', v['webfleet_vehicle_id'] as String?),
        ],
      ),
    );
  }

  Widget _kilometraje() {
    final v = _v!;
    final km = (v['km_actual'] as num?) ?? 0;
    final origen = (v['origen_km'] as String?) ?? 'manual';
    return _seccion(
      'Kilometraje',
      Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              Text(km.round().toString(),
                  style: const TextStyle(
                      color: AppColors.textPrimary,
                      fontSize: 30,
                      fontWeight: FontWeight.w900)),
              const SizedBox(width: 6),
              const Padding(
                padding: EdgeInsets.only(bottom: 4),
                child: Text('km',
                    style: TextStyle(
                        color: AppColors.textSecondary, fontSize: 13)),
              ),
            ],
          ),
          const SizedBox(height: 2),
          Text('Origen: ${_origenKmLabels[origen] ?? origen}',
              style:
                  const TextStyle(color: AppColors.textHint, fontSize: 12)),
        ],
      ),
    );
  }

  Widget _planMantenimiento() {
    return _seccion(
      'Plan de mantenimiento (${_planes.length})',
      _planes.isEmpty
          ? const Text('Este vehículo no tiene planes de revisión.',
              style: TextStyle(color: AppColors.textHint, fontSize: 13))
          : Column(
              children: _planes.map((p) {
                final est = _planEstado[p['id']];
                final estado = (est?['estado'] as String?) ?? 'correcta';
                final op = p['operacion'];
                final nombre = (p['nombre'] as String?)?.isNotEmpty == true
                    ? p['nombre'] as String
                    : (op is Map
                        ? (op['nombre'] as String?) ?? 'Revisión'
                        : 'Revisión');
                final dias = (est?['dias_restantes'] as num?)?.toInt();
                final color = estado == 'atrasada'
                    ? AppColors.danger
                    : estado == 'vence_hoy'
                        ? const Color(0xFFF97316)
                        : estado == 'proxima'
                            ? AppColors.warning
                            : AppColors.success;
                return Container(
                  margin: const EdgeInsets.only(bottom: 6),
                  padding: const EdgeInsets.all(10),
                  decoration: BoxDecoration(
                    color: AppColors.surfaceVariant,
                    borderRadius: BorderRadius.circular(10),
                  ),
                  child: Row(
                    children: [
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(nombre,
                                style: const TextStyle(
                                    color: AppColors.textPrimary,
                                    fontSize: 13,
                                    fontWeight: FontWeight.w700)),
                            const SizedBox(height: 2),
                            Text(
                                'Última: ${_fecha(p['ultima_fecha'] as String?)} · Próxima: ${_fecha(est?['proxima_fecha_efec'] as String?)}${dias != null ? ' · ${_diasTexto(dias)}' : ''}',
                                style: const TextStyle(
                                    color: AppColors.textSecondary,
                                    fontSize: 12)),
                          ],
                        ),
                      ),
                      Container(
                        padding: const EdgeInsets.symmetric(
                            horizontal: 8, vertical: 3),
                        decoration: BoxDecoration(
                          color: color.withValues(alpha: 0.15),
                          borderRadius: BorderRadius.circular(8),
                          border:
                              Border.all(color: color.withValues(alpha: 0.4)),
                        ),
                        child: Text(
                            (_estadoPlanLabels[estado] ?? estado).toUpperCase(),
                            style: TextStyle(
                                color: color,
                                fontSize: 10,
                                fontWeight: FontWeight.w800)),
                      ),
                    ],
                  ),
                );
              }).toList(),
            ),
    );
  }

  Widget _configNeumaticos() {
    final v = _v!;
    final cfg = v['config_ejes'];
    final cfgLabel = cfg is Map
        ? [cfg['nombre'], cfg['descripcion']]
            .whereType<String>()
            .where((s) => s.isNotEmpty)
            .join(' · ')
        : '';
    final porEje = (v['medidas_por_eje'] as bool?) == true;
    return _seccion(
      'Configuración de neumáticos',
      Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Wrap(
            spacing: 24,
            runSpacing: 10,
            children: [
              _dato('Configuración de ejes', cfgLabel.isEmpty ? '—' : cfgLabel),
              _dato('Medidas por eje',
                  porEje ? 'Sí · distintas por eje' : 'No · misma medida'),
              if (!porEje)
                _dato('Medida de neumático',
                    _medidaLabel(v['medida_id'] as String?)),
              if (!porEje)
                _dato('Tipo de llanta',
                    _llantaLabel(v['tipo_llanta_id'] as String?)),
            ],
          ),
          if (porEje && _ejes.isNotEmpty) ...[
            const SizedBox(height: 10),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: _ejes.map((e) {
                return Container(
                  padding: const EdgeInsets.symmetric(
                      horizontal: 12, vertical: 8),
                  decoration: BoxDecoration(
                    color: AppColors.surfaceVariant,
                    borderRadius: BorderRadius.circular(10),
                    border: Border.all(color: AppColors.cardBorder),
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                          'Eje ${e['eje']}${e['ruedas'] != null ? ' · ${e['ruedas']} ruedas' : ''}',
                          style: const TextStyle(
                              color: AppColors.info,
                              fontSize: 12,
                              fontWeight: FontWeight.w700)),
                      Text(_medidaLabel(e['medida_id'] as String?),
                          style: const TextStyle(
                              color: AppColors.textPrimary, fontSize: 12)),
                      Text(_llantaLabel(e['tipo_llanta_id'] as String?),
                          style: const TextStyle(
                              color: AppColors.textHint, fontSize: 10)),
                    ],
                  ),
                );
              }).toList(),
            ),
          ],
        ],
      ),
    );
  }

  Widget _plano() {
    return _seccion(
      'Plano del vehículo',
      Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      SizedBox(
        width: double.infinity,
        child: FilledButton.icon(
          onPressed: () => Navigator.of(context).push(MaterialPageRoute(
              builder: (_) => CambioNeumaticoScreen(vehiculoId: widget.vehiculoId))),
          icon: const Icon(Icons.swap_horiz),
          label: const Text('Cambiar neumáticos (arrastrar)'),
        ),
      ),
      const SizedBox(height: 10),
      _imagenChasis == null
          ? const Text('Este vehículo no tiene plano configurado.',
              style: TextStyle(color: AppColors.textHint, fontSize: 13))
          : VehicleLayoutImage(
              imagenUrl: _imagenChasis!,
              posiciones: _posiciones,
              montajePorPosicion: _montajePorPosicion,
              // Última medición por posición: el plano muestra "X mm · Y bar".
              detalles: _mediciones,
              estados: const {},
              seleccionadaId: null,
              liveProf: null,
              livePres: null,
              onTap: (p) {
                final m = _montajePorPosicion[p.id];
                final n = m?.neumatico;
                final med = _mediciones[p.id];
                final medTxt = med == null
                    ? ''
                    : ' · ${med.profundidadMm != null ? '${med.profundidadMm!.toStringAsFixed(1)} mm' : '— mm'} · ${med.presionBar != null ? '${med.presionBar!.toStringAsFixed(1)} bar' : '— bar'}';
                ScaffoldMessenger.of(context).showSnackBar(SnackBar(
                  content: Text(n == null
                      ? '${p.codigoPosicion} · sin neumático montado$medTxt'
                      : '${p.codigoPosicion} · ${[n.marca, n.modelo, n.medida].whereType<String>().join(' ')}$medTxt'),
                ));
              },
            ),
      ]),
    );
  }

  Widget _estructuraPosiciones() {
    return _seccion(
      'Estructura de posiciones (${_posiciones.length})',
      _posiciones.isEmpty
          ? const Text('Este tipo de vehículo no tiene posiciones definidas.',
              style: TextStyle(color: AppColors.textHint, fontSize: 13))
          : Wrap(
              spacing: 8,
              runSpacing: 8,
              children: _posiciones.map((p) {
                return Container(
                  padding: const EdgeInsets.symmetric(
                      horizontal: 12, vertical: 8),
                  decoration: BoxDecoration(
                    color: AppColors.surfaceVariant,
                    borderRadius: BorderRadius.circular(10),
                    border: Border.all(color: AppColors.cardBorder),
                  ),
                  child: Column(
                    children: [
                      Text(p.codigoPosicion,
                          style: const TextStyle(
                              color: AppColors.info,
                              fontSize: 13,
                              fontWeight: FontWeight.w700)),
                      Text(p.nombre ?? '—',
                          style: const TextStyle(
                              color: AppColors.textSecondary, fontSize: 10)),
                      Text(
                          'Eje ${p.eje ?? '—'}${p.lado != null ? ' · ${p.lado}' : ''}${p.interiorExterior != null ? ' · ${p.interiorExterior}' : ''}',
                          style: const TextStyle(
                              color: AppColors.textHint, fontSize: 9)),
                    ],
                  ),
                );
              }).toList(),
            ),
    );
  }

  Widget _inspecciones() {
    return _seccion(
      'Inspecciones (${_revisiones.length})',
      _revisiones.isEmpty
          ? const Text('Este vehículo aún no tiene revisiones registradas.',
              style: TextStyle(color: AppColors.textHint, fontSize: 13))
          : Column(
              children: _revisiones.map((r) {
                final fecha = (r['fecha_revision'] as String?) ?? '—';
                final km = r['km_vehiculo'];
                final estado = (r['estado_revision'] as String?) ?? '—';
                return Container(
                  margin: const EdgeInsets.only(bottom: 4),
                  padding: const EdgeInsets.symmetric(
                      horizontal: 10, vertical: 8),
                  decoration: BoxDecoration(
                    color: AppColors.surfaceVariant,
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: Row(
                    children: [
                      Expanded(
                        child: Text('$fecha · ${km ?? '—'} km',
                            style: const TextStyle(
                                color: AppColors.textPrimary, fontSize: 12)),
                      ),
                      Text(estado,
                          style: const TextStyle(
                              color: AppColors.textHint, fontSize: 11)),
                    ],
                  ),
                );
              }).toList(),
            ),
    );
  }

  static String _fecha(String? iso) {
    if (iso == null || iso.isEmpty) return '—';
    final d = DateTime.tryParse(iso);
    if (d == null) return '—';
    return '${d.day}/${d.month}/${d.year}';
  }

  static String _diasTexto(int d) {
    if (d < 0) return '${d.abs()} d retraso';
    if (d == 0) return 'hoy';
    return '$d d';
  }
}
