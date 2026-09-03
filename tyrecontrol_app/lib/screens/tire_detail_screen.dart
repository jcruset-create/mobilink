import 'dart:io';
import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import '../models/models.dart';
import '../services/offline_store.dart';
import '../services/supabase_service.dart';
import '../theme/app_theme.dart';
import '../widgets/campo_identidad.dart';
import 'no_coincide_screen.dart';

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
  // Identidad recién puesta desde esta pantalla. El modelo que llega por
  // widget.neumatico es inmutable, así que se guarda aparte para poder
  // refrescar la tarjeta sin recargar toda la revisión.
  String? _rfidPuesto;
  String? _seriePuesta;
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

  /// Los dos accesos de la tarjeta —identificar y "no coincide"— comparten
  /// molde: recuadro, alto de dedo y letra legible. Antes eran dos enlaces de
  /// 12 px sin borde y no se veían: en un taller, con guantes y la tablet
  /// sucia, un enlace fino no es un botón.
  Widget _botonTarjeta({
    required IconData icono,
    required String texto,
    required Color color,
    required VoidCallback? onTap,
  }) {
    return Padding(
      padding: const EdgeInsets.only(top: 8),
      child: SizedBox(
        width: double.infinity,
        child: OutlinedButton.icon(
          onPressed: onTap,
          icon: Icon(icono, size: 20, color: color),
          label: Text(texto,
              style: TextStyle(color: color, fontSize: 15, fontWeight: FontWeight.w700)),
          style: OutlinedButton.styleFrom(
            minimumSize: const Size.fromHeight(46),
            padding: const EdgeInsets.symmetric(horizontal: 12),
            alignment: Alignment.centerLeft,
            side: BorderSide(color: color, width: 1.5),
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
          ),
        ),
      ),
    );
  }

  /// "No coincide": la goma que hay puesta no es esta. Deliberadamente NO se
  /// llama "Cambiar", que es una sustitución física y sí genera trabajo:
  /// confundirlas es la forma más fácil de meter en el histórico un montaje
  /// que nunca ocurrió.
  Widget _lineaNoCoincide(Neumatico n) {
    return _botonTarjeta(
      icono: Icons.report_problem_outlined,
      texto: 'No coincide',
      color: AppColors.warning,
      onTap: _guardando ? null : () => _noCoincide(n),
    );
  }

  /// Abre la corrección. El id del montaje no viaja en esta pantalla, así que
  /// se busca aquí: es una consulta y evita cambiar el constructor, que
  /// obligaría a tocar la pantalla de revisión entera.
  ///
  /// Necesita red a propósito. La corrección cambia qué goma hay en una
  /// posición, y encolarla sin saber si otra corrección tocó la misma mientras
  /// tanto es peor que pedir cobertura para un caso que es raro.
  Future<void> _noCoincide(Neumatico n) async {
    setState(() => _guardando = true);
    try {
      final montajes = await TyreControlApi.listarMontajesVehiculo(widget.vehiculo.id);
      final m = montajes.where((x) => x.posicionId == widget.posicion.id).firstOrNull;
      if (!mounted) return;
      if (m == null) {
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
          content: Text('No se encuentra el montaje de esta posición')));
        return;
      }
      final ok = await Navigator.of(context).push<bool>(MaterialPageRoute(
        builder: (_) => NoCoincideScreen(
          registrado: n,
          montajeId: m.id,
          empresaId: widget.vehiculo.empresaId,
          revisionId: widget.revision.id,
          posicionId: widget.posicion.id,
          posicionNombre: widget.posicion.nombre ?? widget.posicion.codigoPosicion,
        ),
      ));
      if (!mounted) return;
      if (ok == true) {
        // La revisión NO se cierra ni se pierde lo tecleado: se vuelve a esta
        // misma rueda para seguir con la profundidad y la presión.
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
          content: Text('Corregido. Sin trabajo ni coste. Sigue con la medición.')));
        setState(() {});
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(
          content: Text('Hace falta conexión para corregir: $e')));
      }
    } finally {
      if (mounted) setState(() => _guardando = false);
    }
  }

  /// Identidad de la goma: la que trae o la que se acaba de poner. Si no
  /// lleva ninguna, el enlace para ponérsela.
  Widget _lineaIdentidad(Neumatico n) {
    final rfid = _rfidPuesto ?? n.rfidEpc;
    final serie = _seriePuesta ?? n.numeroSerie;
    final tiene = (rfid ?? '').isNotEmpty || (serie ?? '').isNotEmpty;
    if (tiene) {
      final txt = (rfid ?? '').isNotEmpty ? 'RFID $rfid' : 'Nº $serie';
      return Padding(
        padding: const EdgeInsets.only(top: 2),
        child: Row(children: [
          const Icon(Icons.verified_outlined, size: 13, color: AppColors.success),
          const SizedBox(width: 4),
          Flexible(child: Text(txt,
              style: const TextStyle(color: AppColors.success, fontSize: 12),
              maxLines: 1, overflow: TextOverflow.ellipsis)),
        ]),
      );
    }
    return _botonTarjeta(
      icono: Icons.nfc,
      texto: 'Identificar este neumático',
      color: AppColors.info,
      onTap: _identificar,
    );
  }

  /// Pone identidad al neumático sin desmontarlo. Es lo que permite que un
  /// cliente que pasa a modo identificado no tenga que esperar años a que
  /// caiga cada goma para tenerla registrada.
  Future<void> _identificar() async {
    final n = widget.neumatico;
    if (n == null) return;
    final rfid = TextEditingController();
    final serie = TextEditingController();

    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Identificar este neumático'),
        content: SizedBox(
          width: 360,
          child: Column(mainAxisSize: MainAxisSize.min, children: [
            Text('${n.numeroInterno ?? ''} · ${n.medidaCompleta}',
                style: const TextStyle(color: AppColors.textSecondary, fontSize: 12)),
            const SizedBox(height: 12),
            CampoIdentidad(rfid: rfid, serie: serie, autofocus: true),
          ]),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancelar')),
          FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Guardar')),
        ],
      ),
    );
    if (ok != true || !mounted) return;

    final r = rfid.text.trim();
    final s = serie.text.trim();
    if (r.isEmpty && s.isEmpty) {
      _avisar('Hace falta un RFID o un número de serie.', ok: false);
      return;
    }
    try {
      await TyreControlApi.identificarNeumatico(
        neumaticoId: n.id, rfidEpc: r, numeroSerie: s,
        observaciones: 'Identificada en la revisión de ${widget.vehiculo.matricula}',
      );
      if (!mounted) return;
      setState(() { _rfidPuesto = r; _seriePuesta = s; });
      _avisar('Rueda identificada', ok: true);
    } catch (e) {
      final t = '$e';
      final txt = t.contains('IDENTIDAD_DUPLICADA')
          ? 'Esa identidad ya es de otra goma. Comprueba la etiqueta.'
          : t.contains('IDENTIDAD_YA_TIENE')
              ? 'Este neumático ya tenía identidad y no se pisa. Avisa a oficina si ha cambiado.'
              : 'No se ha podido identificar: $t';
      _avisar(txt, ok: false);
    }
  }

  void _avisar(String txt, {required bool ok}) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(
      content: Text(txt),
      backgroundColor: ok ? AppColors.success : AppColors.danger,
    ));
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
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      Row(
                        children: [
                          Container(
                            width: 64,
                            height: 64,
                            clipBehavior: Clip.antiAlias,
                            decoration: BoxDecoration(
                              color: AppColors.surfaceVariant,
                              borderRadius: BorderRadius.circular(10),
                            ),
                            child: widget.fotoModeloUrl != null
                                ? Image.network(
                                    widget.fotoModeloUrl!,
                                    fit: BoxFit.cover,
                                    errorBuilder: (_, __, ___) =>
                                        const Icon(Icons.trip_origin, color: AppColors.textSecondary),
                                  )
                                : const Icon(Icons.trip_origin, color: AppColors.textSecondary),
                          ),
                          const SizedBox(width: 14),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(n.numeroInterno ?? n.codigoInterno ?? '—',
                                    style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 16)),
                                Text('${n.marca ?? ''} ${n.modelo ?? ''}'.trim(),
                                    style: const TextStyle(color: AppColors.textSecondary)),
                                Text(n.medidaCompleta,
                                    style: const TextStyle(color: AppColors.textSecondary, fontSize: 13)),
                                if (n.dot != null)
                                  Text('DOT ${n.dot}',
                                      style: const TextStyle(color: AppColors.textSecondary, fontSize: 12)),
                              ],
                            ),
                          ),
                        ],
                      ),
                      // Los dos botones van DEBAJO y a lo ancho de la tarjeta, no
                      // al lado de la foto: ahí les quedaban dos tercios del ancho
                      // y el texto se partía.
                      _lineaIdentidad(n),
                      _lineaNoCoincide(n),
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
