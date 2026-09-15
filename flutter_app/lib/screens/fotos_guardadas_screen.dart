/// Las fotos que la tablet tiene guardadas, y el botón de volver a enviarlas.
///
/// Sin esta pantalla la copia local no sirve de nada. Una copia que solo se
/// puede recuperar conectando la tablet por USB y rebuscando carpetas no es
/// una copia de seguridad: es un fichero que nadie va a ir a buscar el día que
/// falte una foto. Lo que convierte la copia en algo útil es poder verla aquí
/// y reenviarla desde aquí, con el camión todavía delante o tres semanas
/// después.
library;

import 'dart:async';
import 'dart:io';

import 'package:flutter/material.dart';

import '../services/api_service.dart';
import '../services/copia_local.dart';
import '../services/offline_store.dart';
import '../services/retencion_copias.dart';
import '../theme/app_theme.dart';

const _etiquetas = {
  'matricula_camion': 'Matrícula',
  'matricula_remolque': 'Matrícula remolque',
  'foto_averia': 'Avería',
  'foto_extra': 'Foto extra',
  'firma': 'Firma',
  'foto_trabajo': 'Trabajo realizado',
};

String _etiqueta(String kind) => _etiquetas[kind] ?? kind;

String _tamano(int bytes) {
  if (bytes >= 1024 * 1024) return '${(bytes / (1024 * 1024)).toStringAsFixed(1)} MB';
  if (bytes >= 1024) return '${(bytes / 1024).round()} KB';
  return '$bytes B';
}

String _fecha(int ms) {
  final d = DateTime.fromMillisecondsSinceEpoch(ms);
  String dd(int n) => n.toString().padLeft(2, '0');
  return '${dd(d.day)}/${dd(d.month)}/${d.year} ${dd(d.hour)}:${dd(d.minute)}';
}

class FotosGuardadasScreen extends StatefulWidget {
  const FotosGuardadasScreen({super.key, required this.api});

  final ApiService api;

  @override
  State<FotosGuardadasScreen> createState() => _FotosGuardadasScreenState();
}

class _FotosGuardadasScreenState extends State<FotosGuardadasScreen> {
  List<CopiaGuardada> _copias = [];
  bool _cargando = true;

  @override
  void initState() {
    super.initState();
    _cargar();
  }

  Future<void> _cargar() async {
    // Antes de enseñar nada se quitan las que ya no están en disco: prometer
    // una foto que no se puede abrir ni reenviar es peor que no listarla.
    await CopiaLocal.depurarFantasmas();
    if (!mounted) return;
    setState(() {
      _copias = CopiaLocal.todas()..sort((a, b) => b.ts.compareTo(a.ts));
      _cargando = false;
    });
  }

  Future<void> _reenviar(CopiaGuardada c) async {
    final f = File(c.ruta);
    if (!await f.exists()) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
        content: Text('La foto ya no está en la tablet'),
        backgroundColor: AppColors.danger));
      await _cargar();
      return;
    }
    await OfflineStore.enqueueUpload(
      assistanceId: c.assistanceId,
      kind: c.kind,
      localPath: c.ruta,
    );
    // Se encola en vez de subir a pelo para que pase por el mismo camino que
    // todo lo demás: reintentos, idempotencia por clientActionId y orden. Si
    // no hay cobertura ahora, sale cuando la haya.
    unawaited(widget.api.flushOutbox());
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(
      content: Text('${_etiqueta(c.kind)} de la #${c.assistanceId} puesta en cola'),
      backgroundColor: AppColors.info));
  }

  @override
  Widget build(BuildContext context) {
    final ocupado = _copias.fold<int>(0, (s, c) => s + c.bytes);
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
        backgroundColor: AppColors.surface,
        title: const Text('Fotos guardadas en la tablet'),
      ),
      body: _cargando
          ? const Center(child: CircularProgressIndicator(color: AppColors.primary))
          : Column(
              children: [
                Container(
                  width: double.infinity,
                  padding: const EdgeInsets.all(12),
                  color: AppColors.surface,
                  child: Text(
                    _copias.isEmpty
                        ? 'Todavía no hay fotos guardadas.'
                        : '${_copias.length} fotos · ${_tamano(ocupado)}\n'
                            'Se guardan $kDiasRetencion días y luego se borran solas. '
                            'Las que aún no han subido no se borran nunca.',
                    style: const TextStyle(color: AppColors.textSecondary, fontSize: 13),
                  ),
                ),
                Expanded(
                  child: _copias.isEmpty
                      ? const SizedBox()
                      : RefreshIndicator(
                          onRefresh: _cargar,
                          child: ListView.separated(
                            itemCount: _copias.length,
                            separatorBuilder: (_, __) =>
                                const Divider(height: 1, color: AppColors.background),
                            itemBuilder: (_, i) {
                              final c = _copias[i];
                              return ListTile(
                                leading: SizedBox(
                                  width: 56,
                                  height: 56,
                                  child: ClipRRect(
                                    borderRadius: BorderRadius.circular(6),
                                    child: Image.file(
                                      File(c.ruta),
                                      fit: BoxFit.cover,
                                      errorBuilder: (_, __, ___) => Container(
                                        color: AppColors.background,
                                        child: const Icon(Icons.broken_image_outlined,
                                            color: AppColors.textHint),
                                      ),
                                    ),
                                  ),
                                ),
                                title: Text(
                                  'Asistencia #${c.assistanceId} · ${_etiqueta(c.kind)}',
                                  style: const TextStyle(
                                      color: AppColors.textPrimary, fontWeight: FontWeight.w700),
                                ),
                                subtitle: Text(
                                  '${_fecha(c.ts)} · ${_tamano(c.bytes)}'
                                  '${c.subida ? '' : ' · pendiente de subir'}',
                                  style: TextStyle(
                                      color: c.subida
                                          ? AppColors.textSecondary
                                          : AppColors.warning,
                                      fontSize: 12),
                                ),
                                trailing: TextButton.icon(
                                  onPressed: () => _reenviar(c),
                                  icon: const Icon(Icons.upload_outlined, size: 18),
                                  label: const Text('Reenviar'),
                                ),
                              );
                            },
                          ),
                        ),
                ),
              ],
            ),
    );
  }
}
