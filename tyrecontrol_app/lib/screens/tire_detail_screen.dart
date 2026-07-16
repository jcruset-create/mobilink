import 'dart:io';
import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import '../models/models.dart';
import '../services/offline_store.dart';
import '../services/supabase_service.dart';
import '../theme/app_theme.dart';

const _estadosVisuales = <String, String>{
  'correcto': 'Correcto',
  'desgaste_irregular': 'Desgaste irregular',
  'dano_lateral': 'Daño lateral',
  'pinchazo': 'Pinchazo',
  'corte': 'Corte',
  'objeto_clavado': 'Objeto clavado',
  'reesculturado': 'Reesculturado',
  'no_accesible': 'No accesible',
  'otro': 'Otro',
};

/// Pantalla del neumatico: medicion + estado visual + foto + observaciones.
/// Un solo objetivo por pantalla; "Guardar y siguiente" es la accion
/// principal, todo lo demas queda mas pequeno.
class TireDetailScreen extends StatefulWidget {
  final PosicionVehiculo posicion;
  final Neumatico? neumatico;
  final String? fotoModeloUrl; // foto del modelo heredada del catálogo
  final RevisionDetalleDraft draft;
  final RevisionVehiculo revision;
  final Vehiculo vehiculo;
  /// Si es true, no se puede guardar sin profundidad Y presión (salvo que la
  /// rueda esté marcada como no accesible / sin neumático).
  final bool exigirPresion;

  const TireDetailScreen({
    super.key,
    required this.posicion,
    required this.neumatico,
    this.fotoModeloUrl,
    required this.draft,
    required this.revision,
    required this.vehiculo,
    this.exigirPresion = false,
  });

  @override
  State<TireDetailScreen> createState() => _TireDetailScreenState();
}

class _TireDetailScreenState extends State<TireDetailScreen> {
  late final TextEditingController _profundidad;
  late final TextEditingController _presion;
  late final TextEditingController _observaciones;
  String? _estadoVisual;
  bool _noAccesible = false;
  bool _neumaticoAusente = false;
  String? _fotoLocalPath;
  bool _guardando = false;

  @override
  void initState() {
    super.initState();
    final d = widget.draft;
    _profundidad = TextEditingController(text: d.profundidadMm?.toString() ?? '');
    _presion = TextEditingController(text: d.presionBar?.toStringAsFixed(1) ?? '');
    _observaciones = TextEditingController(text: d.observaciones ?? '');
    _estadoVisual = d.estadoVisual;
    _noAccesible = d.noAccesible;
    _neumaticoAusente = d.neumaticoAusente;
    _fotoLocalPath = d.fotoPaths.isNotEmpty ? d.fotoPaths.first : null;
  }

  @override
  void dispose() {
    _profundidad.dispose();
    _presion.dispose();
    _observaciones.dispose();
    super.dispose();
  }

  Future<void> _tomarFoto() async {
    final picker = ImagePicker();
    final foto = await picker.pickImage(source: ImageSource.camera, imageQuality: 80);
    if (foto != null) setState(() => _fotoLocalPath = foto.path);
  }

  Future<void> _elegirGaleria() async {
    final picker = ImagePicker();
    final foto = await picker.pickImage(source: ImageSource.gallery, imageQuality: 80);
    if (foto != null) setState(() => _fotoLocalPath = foto.path);
  }

  Future<RevisionDetalleDraft> _construirYGuardar() async {
    final draft = widget.draft
      ..profundidadMm = _noAccesible || _neumaticoAusente ? null : double.tryParse(_profundidad.text.replaceAll(',', '.'))
      ..presionBar = _noAccesible || _neumaticoAusente ? null : double.tryParse(_presion.text.replaceAll(',', '.'))
      ..estadoVisual = _estadoVisual
      ..observaciones = _observaciones.text.trim().isEmpty ? null : _observaciones.text.trim()
      ..noAccesible = _noAccesible
      ..neumaticoAusente = _neumaticoAusente
      ..fotoPaths = _fotoLocalPath != null ? [_fotoLocalPath!] : [];

    final payload = draft.toJson(revisionId: widget.revision.id, empresaId: widget.vehiculo.empresaId, vehiculoId: widget.vehiculo.id);

    try {
      await TyreControlApi.guardarDetalleRevision(payload);
      OfflineStore.offline.value = false;
    } catch (_) {
      OfflineStore.offline.value = true;
      await OfflineStore.enqueueDetalle(payload);
    }

    if (_fotoLocalPath != null) {
      try {
        final url = await TyreControlApi.subirFotoRevision(File(_fotoLocalPath!), revisionId: widget.revision.id, posicionId: widget.posicion.id);
        await TyreControlApi.guardarDetalleRevision({
          'revision_id': widget.revision.id,
          'posicion_id': widget.posicion.id,
          'empresa_id': widget.vehiculo.empresaId,
          'vehiculo_id': widget.vehiculo.id,
          'foto_url': url,
        });
      } catch (_) {
        await OfflineStore.enqueueFoto(
          _fotoLocalPath!,
          revisionId: widget.revision.id,
          posicionId: widget.posicion.id,
          empresaId: widget.vehiculo.empresaId,
          vehiculoId: widget.vehiculo.id,
        );
      }
    }

    return draft;
  }

  Future<void> _guardar({required bool volver}) async {
    // Con "verificar presiones" activo, una rueda accesible necesita ambas
    // medidas antes de guardar y avanzar.
    if (widget.exigirPresion && !_noAccesible && !_neumaticoAusente) {
      final prof = double.tryParse(_profundidad.text.replaceAll(',', '.'));
      final pres = double.tryParse(_presion.text.replaceAll(',', '.'));
      if (prof == null || pres == null) {
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
          content: Text('Introduce profundidad Y presión (o marca la rueda como no accesible).'),
        ));
        return;
      }
    }
    setState(() => _guardando = true);
    try {
      final draft = await _construirYGuardar();
      if (!mounted) return;
      Navigator.of(context).pop(draft);
    } finally {
      if (mounted) setState(() => _guardando = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final p = widget.posicion;
    final n = widget.neumatico;
    final deshabilitado = _noAccesible || _neumaticoAusente;

    return Scaffold(
      appBar: AppBar(title: Text(p.nombre ?? p.codigoPosicion)),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            if (n == null)
              const Card(
                child: Padding(padding: EdgeInsets.all(16), child: Text('Sin neumático montado en esta posición.', style: TextStyle(color: AppColors.textSecondary))),
              )
            else
              Card(
                child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: Row(
                    children: [
                      Container(
                        width: 64,
                        height: 64,
                        clipBehavior: Clip.antiAlias,
                        decoration: BoxDecoration(color: AppColors.surfaceVariant, borderRadius: BorderRadius.circular(10)),
                        child: widget.fotoModeloUrl != null
                            ? Image.network(
                                widget.fotoModeloUrl!,
                                fit: BoxFit.cover,
                                errorBuilder: (_, __, ___) => const Icon(Icons.trip_origin, color: AppColors.textSecondary),
                              )
                            : const Icon(Icons.trip_origin, color: AppColors.textSecondary),
                      ),
                      const SizedBox(width: 14),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(n.numeroInterno ?? n.codigoInterno ?? '—', style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 16)),
                            Text('${n.marca ?? ''} ${n.modelo ?? ''}'.trim(), style: const TextStyle(color: AppColors.textSecondary)),
                            Text(n.medidaCompleta, style: const TextStyle(color: AppColors.textSecondary, fontSize: 13)),
                            if (n.dot != null) Text('DOT ${n.dot}', style: const TextStyle(color: AppColors.textSecondary, fontSize: 12)),
                          ],
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            const SizedBox(height: 16),

            Row(
              children: [
                Expanded(
                  child: CheckboxListTile(
                    value: _noAccesible,
                    onChanged: (v) => setState(() => _noAccesible = v ?? false),
                    title: const Text('No accesible', style: TextStyle(fontSize: 14)),
                    controlAffinity: ListTileControlAffinity.leading,
                    contentPadding: EdgeInsets.zero,
                  ),
                ),
                Expanded(
                  child: CheckboxListTile(
                    value: _neumaticoAusente,
                    onChanged: (v) => setState(() => _neumaticoAusente = v ?? false),
                    title: const Text('Ausente', style: TextStyle(fontSize: 14)),
                    controlAffinity: ListTileControlAffinity.leading,
                    contentPadding: EdgeInsets.zero,
                  ),
                ),
              ],
            ),

            if (!deshabilitado) ...[
              const SizedBox(height: 8),
              Text('Medición', style: Theme.of(context).textTheme.titleMedium),
              const SizedBox(height: 8),
              Row(
                children: [
                  Expanded(
                    child: TextField(
                      controller: _profundidad,
                      keyboardType: const TextInputType.numberWithOptions(decimal: true),
                      style: Theme.of(context).textTheme.displayLarge?.copyWith(fontSize: 28),
                      decoration: const InputDecoration(labelText: 'Profundidad (mm)'),
                    ),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: TextField(
                      controller: _presion,
                      keyboardType: const TextInputType.numberWithOptions(decimal: true),
                      style: Theme.of(context).textTheme.displayLarge?.copyWith(fontSize: 28),
                      decoration: const InputDecoration(labelText: 'Presión (bar)'),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 6),
              const Text(
                'Lectura manual. La conexión con herramienta Bluetooth (medidor, manómetro) llegará en una próxima versión.',
                style: TextStyle(color: AppColors.textSecondary, fontSize: 12),
              ),
              const SizedBox(height: 20),

              Text('Estado visual', style: Theme.of(context).textTheme.titleMedium),
              const SizedBox(height: 8),
              Wrap(
                spacing: 8,
                runSpacing: 8,
                children: _estadosVisuales.entries.map((e) {
                  final selected = _estadoVisual == e.key;
                  return ChoiceChip(
                    label: Text(e.value),
                    selected: selected,
                    onSelected: (_) => setState(() => _estadoVisual = e.key),
                    selectedColor: AppColors.primary.withValues(alpha: 0.25),
                    labelStyle: TextStyle(color: selected ? AppColors.primary : AppColors.textPrimary, fontWeight: selected ? FontWeight.w700 : FontWeight.w400),
                    side: BorderSide(color: selected ? AppColors.primary : AppColors.cardBorder),
                    backgroundColor: AppColors.surfaceVariant,
                  );
                }).toList(),
              ),
              const SizedBox(height: 20),

              Text('Fotografía', style: Theme.of(context).textTheme.titleMedium),
              const SizedBox(height: 8),
              if (_fotoLocalPath != null)
                ClipRRect(
                  borderRadius: BorderRadius.circular(12),
                  child: Stack(
                    children: [
                      Image.file(File(_fotoLocalPath!), height: 160, width: double.infinity, fit: BoxFit.cover),
                      Positioned(
                        top: 6,
                        right: 6,
                        child: IconButton(
                          onPressed: () => setState(() => _fotoLocalPath = null),
                          icon: const Icon(Icons.close, color: Colors.white),
                          style: IconButton.styleFrom(backgroundColor: Colors.black54),
                        ),
                      ),
                    ],
                  ),
                )
              else
                Row(
                  children: [
                    Expanded(child: OutlinedButton.icon(onPressed: _tomarFoto, icon: const Icon(Icons.camera_alt_outlined), label: const Text('Cámara'))),
                    const SizedBox(width: 10),
                    Expanded(child: OutlinedButton.icon(onPressed: _elegirGaleria, icon: const Icon(Icons.photo_library_outlined), label: const Text('Galería'))),
                  ],
                ),
              const SizedBox(height: 20),

              Text('Observaciones', style: Theme.of(context).textTheme.titleMedium),
              const SizedBox(height: 8),
              TextField(
                controller: _observaciones,
                maxLines: 3,
                decoration: const InputDecoration(hintText: 'Anotaciones adicionales…'),
              ),
            ],

            const SizedBox(height: 24),
            ElevatedButton.icon(
              onPressed: _guardando ? null : () => _guardar(volver: false),
              icon: _guardando
                  ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2, color: AppColors.onPrimary))
                  : const Icon(Icons.arrow_forward),
              label: const Text('Guardar y siguiente'),
            ),
            const SizedBox(height: 8),
            OutlinedButton(
              onPressed: _guardando ? null : () => Navigator.of(context).pop(),
              child: const Text('Volver sin guardar'),
            ),
          ],
        ),
      ),
    );
  }
}
