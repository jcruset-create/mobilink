import 'dart:io';

import 'package:flutter/material.dart';
import '../services/api.dart';
import '../services/camara.dart';
import '../services/file_queue.dart';
import '../services/requisitos.dart';
import '../services/tracker.dart';
import '../theme.dart';

/// Evidencias obligatorias al llegar al punto: matrícula y avería.
///
/// Calcada en estructura de Mobilink Assist Pro
/// (`flutter_app/lib/screens/arrival_photos_screen.dart`): huecos obligatorios
/// arriba, extras opcionales debajo, miniatura en cuanto se hace la foto y el
/// botón de continuar apagado hasta que estén las dos. Se traen también sus
/// dos calidades de compresión: la matrícula se guarda más grande (hay que
/// poder leerla) y el resto más ligero, que se sube con mala cobertura.
///
/// Diferencias con Pro, y son a propósito:
///
/// * **Sin OCR de matrícula.** En Pro la foto del camión se sube en directo
///   porque su backend la lee y puede preguntar al operario. La API de Lite no
///   tiene esa ruta, así que aquí no se inventa: la foto es evidencia, no un
///   formulario.
/// * **Sin remolque.** Lite atiende turismos y furgonetas de talleres
///   colaboradores; el hueco de matrícula de remolque no aplica.
/// * **Todo por la cola.** En Pro la foto de matrícula se sube síncrona. Aquí
///   las dos van a `FileQueue`, que es lo que permite llegar a un punto sin
///   cobertura, hacer las fotos y seguir trabajando.
class ArrivalPhotosScreen extends StatefulWidget {
  const ArrivalPhotosScreen({
    super.key,
    required this.api,
    required this.assistanceId,
    this.onDone,
  });

  final Api api;
  final int assistanceId;

  /// Qué hacer cuando las evidencias están: normalmente pasar a "Trabajando".
  final Future<void> Function()? onDone;

  @override
  State<ArrivalPhotosScreen> createState() => _ArrivalPhotosScreenState();
}

class _ArrivalPhotosScreenState extends State<ArrivalPhotosScreen> {
  File? _matricula;
  File? _averia;
  final List<File> _extras = [];

  /// Categorías que ya constan hechas de antes (el operario entró, hizo una
  /// foto y salió): no se le pide dos veces lo mismo.
  Set<String> _yaHechas = {};

  bool _cargando = true;
  bool _subiendo = false;
  String? _paso;

  @override
  void initState() {
    super.initState();
    _mirarLoQueYaHay();
  }

  Future<void> _mirarLoQueYaHay() async {
    final e = await Evidencias.cargar(widget.api, widget.assistanceId);
    if (!mounted) return;
    setState(() {
      _yaHechas = e.categorias;
      _cargando = false;
    });
  }

  bool get _tieneMatricula =>
      _matricula != null || _yaHechas.contains(Requisitos.catMatricula);
  bool get _tieneAveria =>
      _averia != null || _yaHechas.contains(Requisitos.catAveria);
  bool get _puedeContinuar => _tieneMatricula && _tieneAveria;

  Future<void> _hacer(void Function(File) guardar, {bool matricula = false}) async {
    final archivo = await Camara.fotoParaEvidencia(context, alta: matricula);
    if (archivo == null || !mounted) return;
    setState(() => guardar(archivo));
  }

  Future<void> _continuar() async {
    setState(() {
      _subiendo = true;
      _paso = 'Guardando las fotografías…';
    });
    try {
      final pos = await Tracker.currentPosition();
      Future<void> encolar(File f, String categoria) => FileQueue.addPhoto(
            assistanceId: widget.assistanceId,
            file: f,
            category: categoria,
            lat: pos?.latitude,
            lng: pos?.longitude,
          );

      // Primero se guardan las tres en el móvil y después se intenta subir:
      // si no hay cobertura, la evidencia ya está a salvo y sale sola luego.
      if (_matricula != null) await encolar(_matricula!, Requisitos.catMatricula);
      if (_averia != null) await encolar(_averia!, Requisitos.catAveria);
      for (final f in _extras) {
        await encolar(f, 'other');
      }

      if (mounted) setState(() => _paso = 'Enviando a la central…');
      try {
        await FileQueue.flush(widget.api);
      } catch (_) {/* queda en cola: se enviará al recuperar cobertura */}

      if (widget.onDone != null) {
        if (mounted) setState(() => _paso = 'Actualizando el estado…');
        await widget.onDone!();
      }
      if (!mounted) return;
      final pendientes = FileQueue.forAssistance(widget.assistanceId).length;
      if (pendientes > 0) {
        _aviso('Guardado. $pendientes evidencia(s) se enviarán al recuperar '
            'cobertura.');
      }
      Navigator.of(context).pop(true);
    } catch (e) {
      if (!mounted) return;
      _aviso('No se ha podido continuar: $e', error: true);
    } finally {
      if (mounted) setState(() => _subiendo = false);
    }
  }

  void _aviso(String texto, {bool error = false}) {
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(
      content: Text(texto),
      backgroundColor: error ? AppColors.danger : AppColors.warn,
      duration: Duration(seconds: error ? 6 : 4),
    ));
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Fotos al llegar')),
      body: _subiendo
          ? Center(
              child: Column(mainAxisSize: MainAxisSize.min, children: [
                const CircularProgressIndicator(),
                const SizedBox(height: 16),
                Text(_paso ?? '', style: const TextStyle(color: AppColors.textMuted)),
              ]),
            )
          : ListView(padding: const EdgeInsets.all(16), children: [
              const Text(
                'Antes de empezar a trabajar hacen falta dos fotografías. '
                'Sin ellas la central no puede justificar el servicio.',
                style: TextStyle(color: AppColors.textMuted),
              ),
              const SizedBox(height: 16),
              _Hueco(
                titulo: Requisitos.etiquetas[Requisitos.catMatricula]!,
                ayuda: 'Que se lea la matrícula entera.',
                archivo: _matricula,
                yaHecha: _yaHechas.contains(Requisitos.catMatricula),
                cargando: _cargando,
                onHacer: () => _hacer((f) => _matricula = f, matricula: true),
              ),
              _Hueco(
                titulo: Requisitos.etiquetas[Requisitos.catAveria]!,
                ayuda: 'El daño o el motivo de la asistencia.',
                archivo: _averia,
                yaHecha: _yaHechas.contains(Requisitos.catAveria),
                cargando: _cargando,
                onHacer: () => _hacer((f) => _averia = f),
              ),
              const Divider(height: 32),
              Row(children: [
                const Expanded(
                  child: Text('Fotos adicionales (opcionales)',
                      style: TextStyle(fontWeight: FontWeight.bold)),
                ),
                TextButton.icon(
                  onPressed: () => _hacer((f) => _extras.add(f)),
                  icon: const Icon(Icons.add_a_photo, size: 18),
                  label: const Text('Añadir'),
                ),
              ]),
              if (_extras.isNotEmpty)
                SizedBox(
                  height: 88,
                  child: ListView.separated(
                    scrollDirection: Axis.horizontal,
                    itemCount: _extras.length,
                    separatorBuilder: (_, __) => const SizedBox(width: 8),
                    itemBuilder: (_, i) => ClipRRect(
                      borderRadius: BorderRadius.circular(8),
                      child: Image.file(_extras[i], width: 88, height: 88, fit: BoxFit.cover),
                    ),
                  ),
                ),
              const SizedBox(height: 24),
              FilledButton.icon(
                onPressed: _puedeContinuar ? _continuar : null,
                icon: const Icon(Icons.play_arrow),
                label: const Text('Guardar y empezar el trabajo'),
              ),
              if (!_puedeContinuar && !_cargando)
                const Padding(
                  padding: EdgeInsets.only(top: 10),
                  child: Text(
                    'Falta alguna de las dos fotografías obligatorias.',
                    textAlign: TextAlign.center,
                    style: TextStyle(color: AppColors.warn, fontSize: 13),
                  ),
                ),
            ]),
    );
  }
}

/// Un hueco obligatorio: estado a la vista, miniatura y repetir.
class _Hueco extends StatelessWidget {
  const _Hueco({
    required this.titulo,
    required this.ayuda,
    required this.archivo,
    required this.yaHecha,
    required this.cargando,
    required this.onHacer,
  });

  final String titulo;
  final String ayuda;
  final File? archivo;
  final bool yaHecha;
  final bool cargando;
  final VoidCallback onHacer;

  @override
  Widget build(BuildContext context) {
    final hecha = archivo != null || yaHecha;
    return Card(
      color: AppColors.surfaceDeep,
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Row(children: [
          if (archivo != null)
            ClipRRect(
              borderRadius: BorderRadius.circular(8),
              child: Image.file(archivo!, width: 64, height: 64, fit: BoxFit.cover),
            )
          else
            Icon(
              cargando
                  ? Icons.hourglass_empty
                  : hecha
                      ? Icons.check_circle
                      : Icons.warning_amber,
              size: 40,
              color: cargando
                  ? AppColors.textMuted
                  : hecha
                      ? AppColors.ok
                      : AppColors.warn,
            ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(titulo, style: const TextStyle(fontWeight: FontWeight.bold)),
              const SizedBox(height: 2),
              Text(
                yaHecha && archivo == null ? 'Ya registrada en este servicio' : ayuda,
                style: const TextStyle(color: AppColors.textMuted, fontSize: 12),
              ),
            ]),
          ),
          TextButton(
            onPressed: onHacer,
            child: Text(hecha ? 'Repetir' : 'Hacer'),
          ),
        ]),
      ),
    );
  }
}
