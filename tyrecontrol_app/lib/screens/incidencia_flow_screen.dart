import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter_image_compress/flutter_image_compress.dart';
import 'package:image_picker/image_picker.dart';
import 'package:path_provider/path_provider.dart';
import 'package:supabase_flutter/supabase_flutter.dart' show PostgrestException;
import '../models/incidencias.dart';
import '../models/models.dart';
import '../services/offline_store.dart';
import '../services/supabase_service.dart';
import '../theme/app_theme.dart';
import '../widgets/vehicle_layout_image.dart';
import '../widgets/vehicle_schema.dart';
import 'resolver_incidencias_screen.dart';

/// Flujo "⚠ Revisión con incidencia" (Fase 1).
/// El técnico marca posición → problemas → gravedad, y decide dejarlas
/// pendientes (o "solucionar ahora", que llega en Fase 2). Devuelve
/// 'pendiente' si se registraron incidencias, o null si cancela.
class IncidenciaFlowScreen extends StatefulWidget {
  final Vehiculo vehiculo;
  final String revisionId;
  final List<PosicionVehiculo> posiciones;
  final Map<String, MontajeActual> montajePorPosicion;
  final Map<String, RevisionDetalleDraft> detalles;
  final String? imagenChasis;

  const IncidenciaFlowScreen({
    super.key,
    required this.vehiculo,
    required this.revisionId,
    required this.posiciones,
    required this.montajePorPosicion,
    required this.detalles,
    required this.imagenChasis,
  });

  @override
  State<IncidenciaFlowScreen> createState() => _IncidenciaFlowScreenState();
}

class _Draft {
  Set<String> tipos;
  Gravedad gravedad;
  bool gravedadManual; // el técnico la tocó → no recalcular
  _Draft(this.tipos, this.gravedad, {this.gravedadManual = false});
}

class _IncidenciaFlowScreenState extends State<IncidenciaFlowScreen> {
  final Map<String, _Draft> _drafts = {}; // posicionId → draft
  bool _guardando = false;

  PosicionVehiculo? _posById(String id) =>
      widget.posiciones.where((p) => p.id == id).firstOrNull;

  String _posNombre(String id) {
    final p = _posById(id);
    return p?.nombre ?? p?.codigoPosicion ?? '—';
  }

  Map<String, TireStatus> get _estados {
    final m = <String, TireStatus>{};
    for (final p in widget.posiciones) {
      if (_drafts.containsKey(p.id)) {
        m[p.id] = switch (_drafts[p.id]!.gravedad) {
          Gravedad.critica => TireStatus.grave,
          Gravedad.importante => TireStatus.advertencia,
          Gravedad.leve => TireStatus.advertencia,
        };
      } else {
        m[p.id] = TireStatus.pendiente;
      }
    }
    return m;
  }

  Future<void> _editarPosicion(PosicionVehiculo p) async {
    final prof = widget.detalles[p.id]?.profundidadMm;
    final existente = _drafts[p.id];
    final res = await showModalBottomSheet<_Draft>(
      context: context,
      isScrollControlled: true,
      backgroundColor: AppColors.surface,
      shape: const RoundedRectangleBorder(
          borderRadius: BorderRadius.vertical(top: Radius.circular(16))),
      builder: (_) => _ProblemasSheet(
        posNombre: p.nombre ?? p.codigoPosicion,
        profundidadMm: prof,
        inicial: existente,
      ),
    );
    if (res == null) return;
    setState(() {
      if (res.tipos.isEmpty) {
        _drafts.remove(p.id);
      } else {
        _drafts[p.id] = res;
      }
    });
  }

  Future<void> _continuar() async {
    if (_drafts.isEmpty) return;
    final accion = await showDialog<String>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: AppColors.surface,
        title: const Text('¿Quieres solucionar las incidencias ahora?'),
        content: Text(
            '${_drafts.length} ${_drafts.length == 1 ? 'incidencia' : 'incidencias'} en este vehículo.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, 'ahora'), child: const Text('Solucionar ahora')),
          FilledButton(onPressed: () => Navigator.pop(ctx, 'pendiente'), child: const Text('Dejar pendiente')),
        ],
      ),
    );
    if (!mounted || accion == null) return;
    if (accion == 'ahora') {
      await _solucionarAhora();
    } else {
      await _dejarPendiente();
    }
  }

  /// Crea las incidencias de los drafts. [form] null → estado 'detectada'
  /// (para resolver en caliente); si viene → estado según el motivo.
  /// Si no hay cobertura, las encola (solo en el modo "dejar pendiente";
  /// "solucionar ahora" necesita el id al momento y es una acción online).
  /// Devuelve true si TODAS se crearon online, false si algo quedó en cola.
  Future<bool> _crearIncidencias({_PendienteForm? form}) async {
    final permitirCola = form != null; // "dejar pendiente" tolera offline
    String? fotoUrl;
    final localFoto = form?.foto?.path;
    if (form?.foto != null) {
      try {
        fotoUrl = await TyreControlApi.subirFotoIncidencia(form!.foto!);
      } catch (_) {
        fotoUrl = null; // sin red: se subirá al sincronizar
      }
    }
    final estado = form == null ? 'detectada' : _estadoDesdeMotivo(form.motivo);
    var todoOnline = true;
    for (final entry in _drafts.entries) {
      final posId = entry.key;
      final d = entry.value;
      final det = widget.detalles[posId];
      final payload = <String, dynamic>{
        'empresaId': widget.vehiculo.empresaId,
        'vehiculoId': widget.vehiculo.id,
        'posicionId': posId,
        'neumaticoId': widget.montajePorPosicion[posId]?.neumaticoId ?? det?.neumaticoId,
        'revisionId': widget.revisionId,
        'tipos': d.tipos.toList(),
        'gravedad': gravedadKey(d.gravedad),
        'gravedadAuto': gravedadKey(gravedadAuto(tipos: d.tipos, profundidadMm: det?.profundidadMm)),
        'estado': estado,
        'motivoPendiente': form?.motivo,
        'motivoObservacion': form?.observacion,
        'accionRecomendada': form?.accion,
        'fechaRecomendada': form?.fecha,
        'autorizaPersona': form?.autoriza,
        'medicionInicial': det == null
            ? null
            : {'profundidad_mm': det.profundidadMm, 'presion_bar': det.presionBar, 'estado_visual': det.estadoVisual},
        'fotoUrl': fotoUrl,
      };
      try {
        await TyreControlApi.crearIncidenciaDesdeMapa(payload);
      } on PostgrestException {
        rethrow; // rechazo real del servidor → mostrar al técnico
      } catch (_) {
        if (!permitirCola) rethrow;
        await OfflineStore.enqueueIncidencia(payload, localFotoPath: fotoUrl == null ? localFoto : null);
        OfflineStore.offline.value = true;
        todoOnline = false;
      }
    }
    return todoOnline;
  }

  /// "Dejar pendiente": crea las incidencias con motivo y cierra la revisión
  /// como pendiente.
  Future<void> _dejarPendiente() async {
    final form = await Navigator.of(context).push<_PendienteForm>(
      MaterialPageRoute(
        builder: (_) => _PendienteFormScreen(
          numIncidencias: _drafts.length,
          // La foto es siempre opcional (decisión del usuario, 2026-07-16).
          requiereFoto: false,
        ),
      ),
    );
    if (!mounted || form == null) return;

    setState(() => _guardando = true);
    try {
      final online = await _crearIncidencias(form: form);
      await TyreControlApi.contarIncidenciasPendientes();
      if (!mounted) return;
      if (!online) {
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
            content: Text('Sin cobertura: se guardó y se enviará al recuperar la conexión.')));
      }
      Navigator.of(context).pop('completada_incidencia_pendiente');
    } catch (e) {
      if (!mounted) return;
      setState(() => _guardando = false);
      _errorGuardar(e);
    }
  }

  /// "Solucionar ahora": crea las incidencias como detectadas, abre la
  /// resolución al momento y cierra la revisión según lo que quede pendiente.
  Future<void> _solucionarAhora() async {
    setState(() => _guardando = true);
    try {
      await _crearIncidencias();
      final incidencias = await TyreControlApi.listarIncidenciasDeRevision(widget.revisionId);
      if (!mounted) return;
      setState(() => _guardando = false);
      await Navigator.of(context).push<bool>(
        MaterialPageRoute(
          builder: (_) => ResolverIncidenciasScreen(
            matricula: widget.vehiculo.matricula,
            fechaRevision: '',
            incidencias: incidencias,
          ),
        ),
      );
      // Recalcular qué queda pendiente tras resolver.
      final tras = await TyreControlApi.listarIncidenciasDeRevision(widget.revisionId);
      final quedanAbiertas = tras.any((i) =>
          !['solucionada', 'cancelada', 'no_procede'].contains(i.estado));
      await TyreControlApi.contarIncidenciasPendientes();
      if (!mounted) return;
      Navigator.of(context).pop(
          quedanAbiertas ? 'completada_incidencia_pendiente' : 'completada_con_incidencias');
    } catch (e) {
      if (!mounted) return;
      setState(() => _guardando = false);
      _errorGuardar(e);
    }
  }

  void _errorGuardar(Object e) {
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(
      content: Text('No se pudo guardar: ${e.toString().replaceFirst('Exception: ', '')}'),
      backgroundColor: AppColors.danger,
    ));
  }

  String _estadoDesdeMotivo(String motivo) => switch (motivo) {
        'falta_autorizacion' => 'pendiente_autorizacion',
        'falta_material' => 'pendiente_material',
        'falta_neumatico' => 'pendiente_material',
        'pendiente_unidad_movil' => 'pendiente_vehiculo',
        'vehiculo_debe_salir' => 'pendiente_vehiculo',
        _ => 'detectada',
      };

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Revisión con incidencia'),
      ),
      body: Column(
        children: [
          Container(
            width: double.infinity,
            color: AppColors.warning.withValues(alpha: 0.12),
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
            child: const Text(
              'Toca la posición afectada y marca las incidencias.',
              style: TextStyle(color: AppColors.warning, fontWeight: FontWeight.w600),
            ),
          ),
          Expanded(
            child: widget.imagenChasis != null
                ? Padding(
                    padding: const EdgeInsets.all(10),
                    child: VehicleLayoutImage(
                      imagenUrl: widget.imagenChasis!,
                      posiciones: widget.posiciones,
                      montajePorPosicion: widget.montajePorPosicion,
                      detalles: widget.detalles,
                      estados: _estados,
                      seleccionadaId: null,
                      liveProf: null,
                      livePres: null,
                      onTap: _editarPosicion,
                    ),
                  )
                : SingleChildScrollView(
                    padding: const EdgeInsets.all(16),
                    child: VehicleSchema(
                      posiciones: widget.posiciones,
                      estados: _estados,
                      seleccionadaId: null,
                      onTap: _editarPosicion,
                    ),
                  ),
          ),
          if (_drafts.isNotEmpty)
            Container(
              constraints: const BoxConstraints(maxHeight: 160),
              width: double.infinity,
              color: AppColors.surface,
              child: ListView(
                shrinkWrap: true,
                padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                children: _drafts.entries.map((e) {
                  final d = e.value;
                  return ListTile(
                    dense: true,
                    onTap: () {
                      final p = _posById(e.key);
                      if (p != null) _editarPosicion(p);
                    },
                    leading: Icon(Icons.circle, size: 12, color: gravedadColor(d.gravedad)),
                    title: Text(_posNombre(e.key),
                        style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w700)),
                    subtitle: Text(
                      '${gravedadLabel(d.gravedad)} · ${d.tipos.map(problemaLabel).join(', ')}',
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(fontSize: 12),
                    ),
                    trailing: IconButton(
                      icon: const Icon(Icons.delete_outline, size: 20),
                      onPressed: () => setState(() => _drafts.remove(e.key)),
                    ),
                  );
                }).toList(),
              ),
            ),
          SafeArea(
            top: false,
            child: Padding(
              padding: const EdgeInsets.all(12),
              child: SizedBox(
                width: double.infinity,
                child: FilledButton.icon(
                  onPressed: (_drafts.isEmpty || _guardando) ? null : _continuar,
                  icon: _guardando
                      ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                      : const Icon(Icons.arrow_forward),
                  label: Text(_drafts.isEmpty
                      ? 'Marca al menos una posición'
                      : 'Continuar (${_drafts.length})'),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

// ── Hoja de selección de problemas + gravedad ────────────────
class _ProblemasSheet extends StatefulWidget {
  final String posNombre;
  final double? profundidadMm;
  final _Draft? inicial;
  const _ProblemasSheet({required this.posNombre, this.profundidadMm, this.inicial});

  @override
  State<_ProblemasSheet> createState() => _ProblemasSheetState();
}

class _ProblemasSheetState extends State<_ProblemasSheet> {
  late Set<String> _tipos;
  late Gravedad _gravedad;
  late bool _gravedadManual;

  @override
  void initState() {
    super.initState();
    _tipos = {...?widget.inicial?.tipos};
    _gravedadManual = widget.inicial?.gravedadManual ?? false;
    _gravedad = widget.inicial?.gravedad ?? _auto();
  }

  Gravedad _auto() => gravedadAuto(tipos: _tipos, profundidadMm: widget.profundidadMm);

  void _toggle(String key) {
    setState(() {
      _tipos.contains(key) ? _tipos.remove(key) : _tipos.add(key);
      if (!_gravedadManual) _gravedad = _auto();
    });
  }

  @override
  Widget build(BuildContext context) {
    return DraggableScrollableSheet(
      expand: false,
      initialChildSize: 0.8,
      maxChildSize: 0.95,
      builder: (_, scroll) => Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 14, 16, 6),
            child: Row(
              children: [
                Expanded(
                  child: Text(widget.posNombre,
                      style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w800)),
                ),
                if (widget.profundidadMm != null)
                  Text('${widget.profundidadMm!.toStringAsFixed(1)} mm',
                      style: const TextStyle(color: AppColors.textSecondary)),
              ],
            ),
          ),
          Expanded(
            child: SingleChildScrollView(
              controller: scroll,
              padding: const EdgeInsets.symmetric(horizontal: 12),
              child: Wrap(
                spacing: 8,
                runSpacing: 8,
                children: kProblemasTipos.map((p) {
                  final sel = _tipos.contains(p.key);
                  return FilterChip(
                    label: Text(p.label),
                    avatar: Icon(p.icon, size: 16, color: sel ? AppColors.onPrimary : AppColors.textSecondary),
                    selected: sel,
                    onSelected: (_) => _toggle(p.key),
                    showCheckmark: false,
                    selectedColor: AppColors.primary,
                    backgroundColor: AppColors.surfaceVariant,
                    labelStyle: TextStyle(
                        color: sel ? AppColors.onPrimary : AppColors.textPrimary,
                        fontSize: 13, fontWeight: FontWeight.w600),
                    side: const BorderSide(color: AppColors.cardBorder),
                  );
                }).toList(),
              ),
            ),
          ),
          // Gravedad propuesta (editable)
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 8, 16, 4),
            child: Row(
              children: [
                const Text('Gravedad', style: TextStyle(color: AppColors.textSecondary)),
                const SizedBox(width: 12),
                ...Gravedad.values.map((g) {
                  final sel = _gravedad == g;
                  return Padding(
                    padding: const EdgeInsets.only(right: 6),
                    child: ChoiceChip(
                      label: Text(gravedadLabel(g)),
                      selected: sel,
                      showCheckmark: false,
                      onSelected: (_) => setState(() { _gravedad = g; _gravedadManual = true; }),
                      selectedColor: gravedadColor(g),
                      backgroundColor: AppColors.surfaceVariant,
                      labelStyle: TextStyle(
                          color: sel ? Colors.white : AppColors.textPrimary,
                          fontSize: 12, fontWeight: FontWeight.w700),
                      side: BorderSide(color: gravedadColor(g).withValues(alpha: 0.5)),
                    ),
                  );
                }),
              ],
            ),
          ),
          SafeArea(
            top: false,
            child: Padding(
              padding: const EdgeInsets.all(12),
              child: Row(
                children: [
                  Expanded(
                    child: OutlinedButton(
                      onPressed: () => Navigator.pop(context, _Draft({}, _gravedad)),
                      child: const Text('Quitar'),
                    ),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    flex: 2,
                    child: FilledButton(
                      onPressed: _tipos.isEmpty
                          ? null
                          : () => Navigator.pop(context, _Draft(_tipos, _gravedad, gravedadManual: _gravedadManual)),
                      child: Text(_tipos.isEmpty ? 'Selecciona una incidencia' : 'Guardar (${_tipos.length})'),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

// ── Formulario "dejar pendiente" ─────────────────────────────
class _PendienteForm {
  final String motivo;
  final String? observacion;
  final String? accion;
  final String? fecha; // yyyy-MM-dd
  final String? autoriza;
  final File? foto;
  _PendienteForm({required this.motivo, this.observacion, this.accion, this.fecha, this.autoriza, this.foto});
}

class _PendienteFormScreen extends StatefulWidget {
  final int numIncidencias;
  final bool requiereFoto;
  const _PendienteFormScreen({required this.numIncidencias, required this.requiereFoto});

  @override
  State<_PendienteFormScreen> createState() => _PendienteFormScreenState();
}

class _PendienteFormScreenState extends State<_PendienteFormScreen> {
  final _picker = ImagePicker();
  String? _motivo;
  final _obs = TextEditingController();
  final _accion = TextEditingController();
  final _autoriza = TextEditingController();
  DateTime? _fecha;
  File? _foto;

  bool get _valido =>
      _motivo != null && (!widget.requiereFoto || _foto != null);

  @override
  void dispose() {
    _obs.dispose();
    _accion.dispose();
    _autoriza.dispose();
    super.dispose();
  }

  Future<void> _pickFoto() async {
    final x = await _picker.pickImage(source: ImageSource.camera, maxWidth: 1600);
    if (x == null) return;
    final tmp = await getTemporaryDirectory();
    final out = '${tmp.path}/inc_${DateTime.now().millisecondsSinceEpoch}.jpg';
    final r = await FlutterImageCompress.compressAndGetFile(x.path, out,
        quality: 70, minWidth: 1600, minHeight: 900, keepExif: false);
    setState(() => _foto = r == null ? File(x.path) : File(r.path));
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Dejar pendiente')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Text('${widget.numIncidencias} ${widget.numIncidencias == 1 ? 'incidencia' : 'incidencias'} quedarán pendientes.',
              style: const TextStyle(color: AppColors.textSecondary)),
          const SizedBox(height: 16),
          const Text('Motivo *', style: TextStyle(color: AppColors.textSecondary, fontWeight: FontWeight.w600)),
          const SizedBox(height: 8),
          Wrap(
            spacing: 8, runSpacing: 8,
            children: kMotivosPendiente.map((m) {
              final sel = _motivo == m.key;
              return ChoiceChip(
                label: Text(m.value),
                selected: sel,
                showCheckmark: false,
                onSelected: (_) => setState(() => _motivo = m.key),
                selectedColor: AppColors.primary,
                backgroundColor: AppColors.surfaceVariant,
                labelStyle: TextStyle(
                    color: sel ? AppColors.onPrimary : AppColors.textPrimary,
                    fontSize: 13, fontWeight: FontWeight.w600),
                side: const BorderSide(color: AppColors.cardBorder),
              );
            }).toList(),
          ),
          const SizedBox(height: 16),
          Text(widget.requiereFoto ? 'Foto *' : 'Foto (opcional)',
              style: const TextStyle(color: AppColors.textSecondary, fontWeight: FontWeight.w600)),
          const SizedBox(height: 8),
          GestureDetector(
            onTap: _pickFoto,
            child: Container(
              height: 150,
              decoration: BoxDecoration(
                color: AppColors.surfaceVariant,
                borderRadius: BorderRadius.circular(12),
                border: Border.all(color: _foto != null ? AppColors.success : AppColors.cardBorder),
              ),
              child: _foto != null
                  ? ClipRRect(borderRadius: BorderRadius.circular(11), child: Image.file(_foto!, fit: BoxFit.cover, width: double.infinity))
                  : const Column(mainAxisAlignment: MainAxisAlignment.center, children: [
                      Icon(Icons.add_a_photo_outlined, color: AppColors.textSecondary, size: 36),
                      SizedBox(height: 8),
                      Text('Toca para fotografiar', style: TextStyle(color: AppColors.textSecondary)),
                    ]),
            ),
          ),
          const SizedBox(height: 16),
          TextField(
            controller: _accion,
            decoration: const InputDecoration(labelText: 'Acción recomendada'),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _obs,
            maxLines: 3,
            decoration: const InputDecoration(labelText: 'Observación'),
          ),
          const SizedBox(height: 12),
          Row(
            children: [
              Expanded(
                child: OutlinedButton.icon(
                  onPressed: () async {
                    final d = await showDatePicker(
                      context: context,
                      initialDate: DateTime.now().add(const Duration(days: 7)),
                      firstDate: DateTime.now(),
                      lastDate: DateTime.now().add(const Duration(days: 365)),
                    );
                    if (d != null) setState(() => _fecha = d);
                  },
                  icon: const Icon(Icons.event),
                  label: Text(_fecha == null
                      ? 'Fecha recomendada'
                      : '${_fecha!.day}/${_fecha!.month}/${_fecha!.year}'),
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _autoriza,
            decoration: const InputDecoration(labelText: 'Persona que autoriza (si aplica)'),
          ),
          const SizedBox(height: 20),
          FilledButton.icon(
            onPressed: _valido
                ? () => Navigator.pop(
                      context,
                      _PendienteForm(
                        motivo: _motivo!,
                        observacion: _obs.text.trim().isEmpty ? null : _obs.text.trim(),
                        accion: _accion.text.trim().isEmpty ? null : _accion.text.trim(),
                        fecha: _fecha == null
                            ? null
                            : '${_fecha!.year}-${_fecha!.month.toString().padLeft(2, '0')}-${_fecha!.day.toString().padLeft(2, '0')}',
                        autoriza: _autoriza.text.trim().isEmpty ? null : _autoriza.text.trim(),
                        foto: _foto,
                      ),
                    )
                : null,
            icon: const Icon(Icons.save),
            label: Text(widget.requiereFoto && _foto == null
                ? 'Falta la foto obligatoria'
                : _motivo == null
                    ? 'Selecciona un motivo'
                    : 'Guardar incidencias pendientes'),
          ),
        ],
      ),
    );
  }
}
