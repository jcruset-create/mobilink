import 'dart:io';
import 'dart:typed_data';
import 'package:flutter/material.dart';
import 'package:signature/signature.dart';
import 'package:path_provider/path_provider.dart';
import '../services/api_service.dart';
import '../theme/app_theme.dart';
import '../widgets/plate_badge.dart';
import '../services/camara.dart';
import '../services/mensajes_oficina.dart';
import '../services/navegar.dart';
import '../widgets/conversacion_oficina.dart';
import 'otf_trabajo_screens.dart';
import '../services/orden_trabajos.dart';

const _tipos = ['Tractora', 'Remolque', 'Camión rígido', 'Furgoneta', 'Turismo', 'Maquinaria', 'Otros'];

Color _trabajoColor(String s) {
  switch (s) {
    case 'finalizado': return AppColors.success;
    case 'en_proceso': return AppColors.info;
    case 'no_realizado': return AppColors.danger;
    default: return AppColors.textHint;
  }
}

String _trabajoLabel(String s) {
  switch (s) {
    case 'finalizado': return 'Finalizado';
    case 'en_proceso': return 'En proceso';
    case 'no_realizado': return 'No realizado';
    default: return 'Pendiente';
  }
}

String? _fechaCorta(Object? ms) {
  if (ms is! int) return null;
  final d = DateTime.fromMillisecondsSinceEpoch(ms);
  const dias = ['lun', 'mar', 'mié', 'jue', 'vie', 'sáb', 'dom'];
  return '${dias[d.weekday - 1]} ${d.day}/${d.month}';
}

String? _duracion(Map<String, dynamic> t) {
  final a = t['iniciadoAtMs'], b = t['finalizadoAtMs'];
  if (a is! int || b is! int) return null;
  final min = ((b - a) / 60000).round();
  return min < 60 ? '$min min' : '${min ~/ 60} h ${min % 60} min';
}

// ── Lista de OTF (tab) ──
class OtfListTab extends StatefulWidget {
  final ApiService api;
  const OtfListTab({super.key, required this.api});
  @override
  State<OtfListTab> createState() => _OtfListTabState();
}

class _OtfListTabState extends State<OtfListTab> {
  List<Map<String, dynamic>> _list = [];
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() { _loading = true; _error = null; });
    try {
      final l = await widget.api.getOtfList();
      if (mounted) setState(() => _list = l);
    } catch (e) {
      if (mounted) setState(() => _error = e.toString().replaceFirst('Exception: ', ''));
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final tt = Theme.of(context).textTheme;
    if (_loading) return const Center(child: CircularProgressIndicator(color: AppColors.primary));
    if (_error != null) {
      return Center(child: Column(mainAxisSize: MainAxisSize.min, children: [
        const Icon(Icons.wifi_off_outlined, color: AppColors.danger, size: 48),
        const SizedBox(height: 12),
        Text(_error!, style: tt.bodyMedium, textAlign: TextAlign.center),
        const SizedBox(height: 16),
        SizedBox(width: 200, child: ElevatedButton.icon(onPressed: _load, icon: const Icon(Icons.refresh), label: const Text('Reintentar'))),
      ]));
    }
    if (_list.isEmpty) {
      return Center(child: Text('Sin órdenes de flota asignadas', style: tt.bodyLarge?.copyWith(color: AppColors.textSecondary)));
    }
    return RefreshIndicator(
      color: AppColors.primary,
      backgroundColor: AppColors.surface,
      onRefresh: _load,
      child: ListView.builder(
        padding: const EdgeInsets.fromLTRB(16, 12, 16, 24),
        itemCount: _list.length,
        itemBuilder: (_, i) {
          final o = _list[i];
          final prog = o['progreso'] as Map<String, dynamic>? ?? {};
          return Card(
            child: InkWell(
              borderRadius: BorderRadius.circular(8),
              onTap: () async {
                await Navigator.of(context).push(MaterialPageRoute(
                  builder: (_) => OtfDetailScreen(api: widget.api, otfId: o['id'] as int),
                ));
                _load();
              },
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                  Row(children: [
                    Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      Row(children: [
                        Flexible(child: Text(o['clientName'] ?? '', style: tt.titleMedium)),
                        // Asignada y aún sin abrir en la tablet.
                        if (o['vistaAtMs'] == null) ...[
                          const SizedBox(width: 8),
                          Container(
                            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                            decoration: BoxDecoration(color: const Color(0xFFFBBF24), borderRadius: BorderRadius.circular(999)),
                            child: const Text('NUEVA', style: TextStyle(color: Color(0xFF0E1B2E), fontSize: 11, fontWeight: FontWeight.w900)),
                          ),
                        ],
                        if (o['enEspera'] == true) ...[
                          const SizedBox(width: 8),
                          Text('pendiente · tras #${o['esperaAsistenciaId']}',
                              style: const TextStyle(color: AppColors.warning, fontSize: 12, fontWeight: FontWeight.w700)),
                        ],
                      ]),
                      const SizedBox(height: 4),
                      Text(
                        '${o['baseName'] ?? o['direccion'] ?? '—'}${_fechaCorta(o['fechaProgramadaMs']) != null ? ' · ${_fechaCorta(o['fechaProgramadaMs'])}' : ''}',
                        style: tt.bodyMedium?.copyWith(color: AppColors.textHint),
                      ),
                      const SizedBox(height: 8),
                      Text('Progreso: ${prog['hechos'] ?? 0} / ${prog['total'] ?? 0}',
                          style: const TextStyle(color: AppColors.primary, fontWeight: FontWeight.w700)),
                    ])),
                    const Icon(Icons.chevron_right, color: AppColors.primary, size: 28),
                  ]),
                  // Sin haber llegado: ir directo a la base desde la lista.
                  if (o['arrivedAtBaseMs'] == null && (o['lat'] != null || o['direccion'] != null)) ...[
                    const SizedBox(height: 10),
                    SizedBox(
                      height: 48,
                      child: FilledButton.icon(
                        onPressed: () => navegarA(context, lat: o['lat'], lng: o['lng'], direccion: o['direccion'] as String?),
                        icon: const Icon(Icons.navigation),
                        label: const Text('Ir a la base', style: TextStyle(fontWeight: FontWeight.w900)),
                        style: FilledButton.styleFrom(backgroundColor: const Color(0xFF2563EB)),
                      ),
                    ),
                  ],
                ]),
              ),
            ),
          );
        },
      ),
    );
  }
}

// ── Detalle de OTF ──
class OtfDetailScreen extends StatefulWidget {
  final ApiService api;
  final int otfId;
  const OtfDetailScreen({super.key, required this.api, required this.otfId});
  @override
  State<OtfDetailScreen> createState() => _OtfDetailScreenState();
}

class _OtfDetailScreenState extends State<OtfDetailScreen> {
  Map<String, dynamic>? _otf;
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _load();
    // Abrirla es haberla visto: deja de avisarse como nueva.
    MensajesOficina.instancia.otfVista(widget.otfId);
  }

  Future<void> _load() async {
    setState(() => _loading = true);
    try {
      final o = await widget.api.getOtf(widget.otfId);
      if (mounted) setState(() => _otf = o);
    } catch (_) {
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _setStatus(Map<String, dynamic> t, String status) async {
    final tid = t['id'] as int;
    try {
      // La foto de la matrícula es obligatoria para el informe: si el trabajo
      // aún no la tiene (los planificados desde oficina no la traen), se abre
      // la cámara antes de empezar o finalizar.
      if (status == 'en_proceso' || status == 'finalizado') {
        final fotos = (t['fotos'] as List<dynamic>?)?.cast<Map<String, dynamic>>() ?? [];
        final tieneMatricula = fotos.any((f) => f['kind'] == 'matricula');
        if (!tieneMatricula) {
          if (mounted) {
            ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
              content: Text('Haz una foto de la matrícula del vehículo'),
              duration: Duration(seconds: 2)));
          }
          final x = await Camara.hacerFoto(context, maxWidth: 1920);
          if (x == null) {
            if (mounted) {
              ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
                content: Text('La foto de la matrícula es obligatoria para el informe'),
                backgroundColor: Colors.red));
            }
            return;
          }
          await widget.api.uploadOtfTrabajoFile(tid, File(x.path), 'matricula');
        }
      }
      await widget.api.updateOtfTrabajoStatus(tid, status, otfId: widget.otfId);
      _load();
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(
          content: Text(e.toString().replaceFirst('Exception: ', '')), backgroundColor: Colors.red));
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final o = _otf;
    // En el orden de recorrer la base: a medias, pendientes por plaza, hechos.
    final trabajos = ordenarTrabajosEnBase(
        (o?['trabajos'] as List<dynamic>?)?.cast<Map<String, dynamic>>() ?? []);
    final prog = o?['progreso'] as Map<String, dynamic>? ?? {};
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
        title: Text(o?['clientName'] ?? 'OTF'),
        backgroundColor: AppColors.surface,
        foregroundColor: AppColors.textPrimary,
      ),
      floatingActionButton: o == null ? null : FloatingActionButton.extended(
        backgroundColor: AppColors.primary,
        foregroundColor: AppColors.onPrimary,
        icon: const Icon(Icons.add),
        label: const Text('Añadir trabajo'),
        onPressed: () async {
          final added = await Navigator.of(context).push<bool>(MaterialPageRoute(
            builder: (_) => OtfAddTrabajoScreen(api: widget.api, otfId: widget.otfId),
          ));
          if (added == true) _load();
        },
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator(color: AppColors.primary))
          : o == null
              ? const Center(child: Text('No se pudo cargar', style: TextStyle(color: AppColors.textSecondary)))
              : ListView(
                  padding: const EdgeInsets.all(16),
                  children: [
                    Container(
                      padding: const EdgeInsets.all(16),
                      decoration: BoxDecoration(color: AppColors.surface, borderRadius: BorderRadius.circular(12)),
                      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                        Text(o['baseName'] ?? o['direccion'] ?? '—',
                            style: const TextStyle(color: AppColors.textPrimary, fontSize: 17, fontWeight: FontWeight.w800)),
                        if (o['baseName'] != null && o['direccion'] != null)
                          Text(o['direccion'], style: const TextStyle(color: AppColors.textSecondary)),
                        if (_fechaCorta(o['fechaProgramadaMs']) != null)
                          Text('Programada: ${_fechaCorta(o['fechaProgramadaMs'])}',
                              style: const TextStyle(color: AppColors.textSecondary)),
                        const SizedBox(height: 8),
                        Text('Progreso: ${prog['hechos'] ?? 0} / ${prog['total'] ?? 0}',
                            style: const TextStyle(color: AppColors.primary, fontSize: 18, fontWeight: FontWeight.w800)),
                        if (o['arrivedAtBaseMs'] != null)
                          const Padding(padding: EdgeInsets.only(top: 6), child: Text(
                            '✓ Llegada a base registrada',
                            style: TextStyle(color: AppColors.success, fontSize: 13, fontWeight: FontWeight.w700))),
                        if (o['arrivedAtBaseMs'] == null && o['status'] != 'finalizada') ...[
                          const SizedBox(height: 12),
                          SizedBox(
                            width: double.infinity,
                            height: 60,
                            child: FilledButton.icon(
                              onPressed: () => navegarA(context, lat: o['lat'], lng: o['lng'], direccion: o['direccion'] as String?),
                              icon: const Icon(Icons.navigation),
                              label: const Text('Navegar a la base', style: TextStyle(fontSize: 18, fontWeight: FontWeight.w900)),
                              style: FilledButton.styleFrom(
                                backgroundColor: const Color(0xFF2563EB),
                                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                              ),
                            ),
                          ),
                          const SizedBox(height: 10),
                          Container(
                            padding: const EdgeInsets.all(12),
                            decoration: BoxDecoration(
                              color: AppColors.success.withValues(alpha: 0.12),
                              borderRadius: BorderRadius.circular(12),
                              border: Border.all(color: AppColors.success.withValues(alpha: 0.5)),
                            ),
                            child: const Text(
                              'Llegada automática: al estar a menos de 300 m de la base se marca sola.',
                              style: TextStyle(color: AppColors.success, fontSize: 14, fontWeight: FontWeight.w600),
                            ),
                          ),
                          if (o['status'] == 'planificada') ...[
                            const SizedBox(height: 10),
                            SizedBox(width: double.infinity, child: OutlinedButton.icon(
                              onPressed: _checkin,
                              icon: const Icon(Icons.location_on),
                              label: const Text('He llegado a la base'),
                              style: OutlinedButton.styleFrom(
                                foregroundColor: AppColors.success,
                                side: const BorderSide(color: AppColors.success),
                                padding: const EdgeInsets.symmetric(vertical: 14),
                              ),
                            )),
                          ],
                        ],
                        if ((o['notas'] ?? '').toString().trim().isNotEmpty) ...[
                          const SizedBox(height: 12),
                          Text('Notas de la oficina: ${o['notas']}',
                              style: const TextStyle(color: AppColors.textSecondary, fontSize: 14)),
                        ],
                      ]),
                    ),
                    const SizedBox(height: 16),
                    ...trabajos.asMap().entries.map((e) => _trabajoCard(e.value, e.key + 1, trabajos.length)),
                    const SizedBox(height: 16),
                    if (o['status'] != 'finalizada' && o['status'] != 'cancelada') ...[
                      ConversacionOficina(api: widget.api, otfId: widget.otfId),
                      const SizedBox(height: 16),
                    ],
                    if (o['status'] != 'finalizada')
                      SizedBox(width: double.infinity, child: ElevatedButton.icon(
                        onPressed: _finalizarVisita,
                        icon: const Icon(Icons.draw),
                        label: const Text('Finalizar visita (firma)'),
                        style: ElevatedButton.styleFrom(
                          backgroundColor: AppColors.success, foregroundColor: Colors.white,
                          padding: const EdgeInsets.symmetric(vertical: 16),
                        ),
                      )),
                    if (o['status'] == 'finalizada')
                      Container(
                        width: double.infinity,
                        padding: const EdgeInsets.all(14),
                        decoration: BoxDecoration(color: AppColors.success.withValues(alpha: 0.15), borderRadius: BorderRadius.circular(12)),
                        child: Text('✓ Visita finalizada${o['firmanteNombre'] != null ? ' · Firmó: ${o['firmanteNombre']}' : ''}',
                            style: const TextStyle(color: AppColors.success, fontWeight: FontWeight.w700), textAlign: TextAlign.center),
                      ),
                    const SizedBox(height: 80),
                  ],
                ),
    );
  }

  Future<void> _checkin() async {
    try {
      await widget.api.checkinOtf(widget.otfId);
      _load();
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(
          content: Text(e.toString().replaceFirst('Exception: ', '')), backgroundColor: Colors.red));
      }
    }
  }

  Future<void> _finalizarVisita() async {
    final ok = await Navigator.of(context).push<bool>(MaterialPageRoute(
      builder: (_) => OtfFirmaScreen(api: widget.api, otfId: widget.otfId),
    ));
    if (ok == true) _load();
  }

  Future<void> _abrirTrabajo(Map<String, dynamic> t, int numero, int total, {required bool enCurso}) async {
    final api = widget.api;
    var cambio = await Navigator.of(context).push<bool>(MaterialPageRoute(
      builder: (_) => enCurso
          ? OtfTrabajoEnCursoScreen(api: api, trabajo: t, numero: numero, total: total)
          : OtfInicioTrabajoScreen(api: api, trabajo: t, numero: numero, total: total),
    ));
    // Recién empezado: directo a «en curso», con el tiempo ya corriendo.
    if (cambio == true && !enCurso) {
      final otf = await api.getOtf(widget.otfId);
      final actualizado = ((otf['trabajos'] as List<dynamic>?) ?? [])
          .cast<Map<String, dynamic>>()
          .firstWhere((x) => x['id'] == t['id'], orElse: () => t);
      if (!mounted) return;
      if (mounted) setState(() => _otf = otf);
      cambio = await Navigator.of(context).push<bool>(MaterialPageRoute(
        builder: (_) => OtfTrabajoEnCursoScreen(api: api, trabajo: actualizado, numero: numero, total: total),
      ));
    }
    _load();
  }

  Widget _trabajoCard(Map<String, dynamic> t, int numero, int total) {
    final status = t['status'] as String? ?? 'pendiente';
    final color = _trabajoColor(status);
    final fotos = (t['fotos'] as List<dynamic>?)?.cast<Map<String, dynamic>>() ?? [];
    final esCampo = t['origen'] == 'tecnico_campo';
    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: color.withValues(alpha: 0.4)),
      ),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        // La matrícula manda: si viene informada, en grande y arriba del todo.
        // En su propia línea para no comerse el estado del trabajo.
        if ((t['plate']?.toString() ?? '').trim().isNotEmpty) ...[
          Align(
            alignment: Alignment.centerLeft,
            child: PlateBadge(plate: t['plate'].toString()),
          ),
          const SizedBox(height: 6),
        ],
        Row(children: [
          Text(t['tipoVehiculo'] ?? '', style: const TextStyle(color: AppColors.textSecondary, fontSize: 12)),
          const Spacer(),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
            decoration: BoxDecoration(color: color.withValues(alpha: 0.18), borderRadius: BorderRadius.circular(12)),
            child: Text(_trabajoLabel(status), style: TextStyle(color: color, fontSize: 11, fontWeight: FontWeight.w700)),
          ),
        ]),
        if (esCampo)
          Padding(padding: const EdgeInsets.only(top: 4), child: Text(
            '➕ Añadido en campo${t['creadoPorTecnico'] != null ? ' · ${t['creadoPorTecnico']}' : ''}',
            style: const TextStyle(color: AppColors.warning, fontSize: 11, fontWeight: FontWeight.w700))),
        const SizedBox(height: 4),
        Text(t['trabajo'] ?? '', style: const TextStyle(color: AppColors.textPrimary, fontSize: 14)),
        if (fotos.isNotEmpty) Padding(
          padding: const EdgeInsets.only(top: 8),
          child: SizedBox(height: 56, child: ListView.separated(
            scrollDirection: Axis.horizontal,
            itemCount: fotos.length,
            separatorBuilder: (_, __) => const SizedBox(width: 6),
            itemBuilder: (_, i) => ClipRRect(
              borderRadius: BorderRadius.circular(6),
              child: Image.network(fotos[i]['url'] as String, width: 56, height: 56, fit: BoxFit.cover),
            ),
          )),
        ),
        if (_duracion(t) != null)
          Padding(padding: const EdgeInsets.only(top: 6), child: Text('⏱ ${_duracion(t)}',
              style: const TextStyle(color: AppColors.textSecondary, fontSize: 13))),
        if (t['motivoNoRealizado'] != null)
          Padding(padding: const EdgeInsets.only(top: 4), child: Text('No realizado: ${t['motivoNoRealizado']}',
              style: const TextStyle(color: AppColors.danger, fontSize: 13, fontWeight: FontWeight.w700))),
        const SizedBox(height: 10),
        // Pendiente → pantalla previa con las fotos; en curso → tiempo y cierre.
        if (status == 'pendiente')
          SizedBox(width: double.infinity, height: 50, child: FilledButton.icon(
            onPressed: () => _abrirTrabajo(t, numero, total, enCurso: false),
            icon: const Icon(Icons.play_arrow),
            label: const Text('Empezar', style: TextStyle(fontWeight: FontWeight.w900, fontSize: 16)),
            style: FilledButton.styleFrom(backgroundColor: AppColors.info),
          ))
        else if (status == 'en_proceso')
          SizedBox(width: double.infinity, height: 50, child: FilledButton.icon(
            onPressed: () => _abrirTrabajo(t, numero, total, enCurso: true),
            icon: const Icon(Icons.timer_outlined),
            label: const Text('Continuar: finalizar o no realizado', style: TextStyle(fontWeight: FontWeight.w900)),
            style: FilledButton.styleFrom(backgroundColor: AppColors.success),
          ))
        else
          Align(
            alignment: Alignment.centerRight,
            child: TextButton(
              onPressed: () => _setStatus(t, 'pendiente'),
              child: const Text('Reabrir', style: TextStyle(color: AppColors.textHint)),
            ),
          ),
      ]),
    );
  }


}

// ── Añadir trabajo en campo (fotos obligatorias) ──
class OtfAddTrabajoScreen extends StatefulWidget {
  final ApiService api;
  final int otfId;
  const OtfAddTrabajoScreen({super.key, required this.api, required this.otfId});
  @override
  State<OtfAddTrabajoScreen> createState() => _OtfAddTrabajoScreenState();
}

class _OtfAddTrabajoScreenState extends State<OtfAddTrabajoScreen> {
  final _plate = TextEditingController();
  final _trabajo = TextEditingController();
  final _motivo = TextEditingController();
  String _tipo = 'Tractora';
  File? _fotoMatricula;
  File? _fotoAveria;
  bool _saving = false;

  // Identifica este alta en el servidor. Se genera una vez por formulario, NO
  // por intento: así, si se reintenta tras un fallo de red, el servidor
  // reconoce el alta y devuelve el trabajo que ya creó en vez de crear otro.
  late final String _accionId =
      '${DateTime.now().millisecondsSinceEpoch}-otf${widget.otfId}-campo';

  // Lo ya conseguido en intentos anteriores. En campo la cobertura se cae a
  // media subida: sin esto, el técnico veía el error rojo, volvía a darle a
  // guardar y creaba un trabajo duplicado por cada reintento.
  int? _trabajoId;
  bool _matriculaSubida = false;
  bool _averiaSubida = false;

  bool get _canSave =>
      _plate.text.trim().isNotEmpty &&
      _trabajo.text.trim().isNotEmpty &&
      _motivo.text.trim().isNotEmpty &&
      _fotoMatricula != null &&
      _fotoAveria != null;

  @override
  void dispose() {
    _plate.dispose(); _trabajo.dispose(); _motivo.dispose();
    super.dispose();
  }

  Future<void> _pick(void Function(File) set) async {
    final x = await Camara.hacerFoto(context, maxWidth: 1920);
    if (x == null) return;
    setState(() => set(File(x.path)));
  }

  Future<void> _save() async {
    setState(() => _saving = true);
    try {
      _trabajoId ??= (await widget.api.addOtfFieldTrabajo(
        widget.otfId,
        plate: _plate.text.trim().toUpperCase(),
        tipoVehiculo: _tipo,
        detalleManual: _trabajo.text.trim(),
        motivoAltaCampo: _motivo.text.trim(),
        status: 'en_proceso',
        actionId: _accionId,
      ))['id'] as int;
      final tid = _trabajoId!;
      if (!_matriculaSubida) {
        await widget.api.uploadOtfTrabajoFile(tid, _fotoMatricula!, 'matricula',
            actionId: '$_accionId-matricula');
        _matriculaSubida = true;
      }
      if (!_averiaSubida) {
        await widget.api.uploadOtfTrabajoFile(tid, _fotoAveria!, 'averia',
            actionId: '$_accionId-averia');
        _averiaSubida = true;
      }
      if (!mounted) return;
      Navigator.of(context).pop(true);
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
        content: Text(e.toString().replaceFirst('Exception: ', '')), backgroundColor: Colors.red));
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
        title: const Text('Nuevo trabajo en campo'),
        backgroundColor: AppColors.surface, foregroundColor: AppColors.textPrimary,
      ),
      body: _saving
          ? const Center(child: CircularProgressIndicator(color: AppColors.primary))
          : SingleChildScrollView(
              padding: const EdgeInsets.all(16),
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                _label('Matrícula *'),
                _input(_plate, 'Matrícula', upper: true),
                const SizedBox(height: 14),
                _label('Tipo de vehículo *'),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 12),
                  decoration: BoxDecoration(color: AppColors.surfaceVariant, borderRadius: BorderRadius.circular(8)),
                  child: DropdownButton<String>(
                    value: _tipo, isExpanded: true, underline: const SizedBox(),
                    dropdownColor: AppColors.surface,
                    style: const TextStyle(color: AppColors.textPrimary),
                    items: _tipos.map((v) => DropdownMenuItem(value: v, child: Text(v))).toList(),
                    onChanged: (v) => setState(() => _tipo = v ?? 'Tractora'),
                  ),
                ),
                const SizedBox(height: 14),
                _label('Trabajo a realizar *'),
                _input(_trabajo, 'Ej: Reparar pinchazo rueda derecha'),
                const SizedBox(height: 14),
                _label('Motivo de alta en campo *'),
                _input(_motivo, 'Ej: Vehículo no incluido inicialmente'),
                const SizedBox(height: 18),
                _label('Fotos obligatorias *'),
                const SizedBox(height: 8),
                Row(children: [
                  Expanded(child: _photoBox('Matrícula', _fotoMatricula, () => _pick((f) => _fotoMatricula = f))),
                  const SizedBox(width: 12),
                  Expanded(child: _photoBox('Avería', _fotoAveria, () => _pick((f) => _fotoAveria = f))),
                ]),
                const SizedBox(height: 24),
                SizedBox(width: double.infinity, child: ElevatedButton.icon(
                  onPressed: _canSave ? _save : null,
                  icon: const Icon(Icons.check),
                  label: const Text('Guardar y empezar'),
                  style: ElevatedButton.styleFrom(
                    backgroundColor: _canSave ? AppColors.primary : AppColors.disabledBtn,
                    foregroundColor: _canSave ? AppColors.onPrimary : AppColors.textDisabled,
                    padding: const EdgeInsets.symmetric(vertical: 16),
                  ),
                )),
              ]),
            ),
    );
  }

  Widget _label(String t) => Text(t, style: const TextStyle(color: AppColors.textSecondary, fontSize: 12, fontWeight: FontWeight.w700));

  Widget _input(TextEditingController c, String hint, {bool upper = false}) => TextField(
        controller: c,
        textCapitalization: upper ? TextCapitalization.characters : TextCapitalization.sentences,
        style: const TextStyle(color: AppColors.textPrimary),
        onChanged: (_) => setState(() {}),
        decoration: InputDecoration(
          hintText: hint, hintStyle: const TextStyle(color: AppColors.textHint),
          filled: true, fillColor: AppColors.surfaceVariant,
          border: OutlineInputBorder(borderRadius: BorderRadius.circular(8), borderSide: BorderSide.none),
        ),
      );

  Widget _photoBox(String label, File? file, VoidCallback onTap) => GestureDetector(
        onTap: onTap,
        child: Container(
          height: 120,
          decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(12),
            border: Border.all(color: file != null ? Colors.green : Colors.black26, width: 1.5),
          ),
          child: file != null
              ? ClipRRect(borderRadius: BorderRadius.circular(11), child: Image.file(file, fit: BoxFit.cover, width: double.infinity))
              : Column(mainAxisAlignment: MainAxisAlignment.center, children: [
                  const Icon(Icons.add_a_photo_outlined, color: Colors.black45, size: 30),
                  const SizedBox(height: 6),
                  Text(label, style: const TextStyle(color: Colors.black54, fontSize: 12, fontWeight: FontWeight.w600)),
                ]),
        ),
      );
}

// ── Firma única de la visita ──
class OtfFirmaScreen extends StatefulWidget {
  final ApiService api;
  final int otfId;
  const OtfFirmaScreen({super.key, required this.api, required this.otfId});
  @override
  State<OtfFirmaScreen> createState() => _OtfFirmaScreenState();
}

class _OtfFirmaScreenState extends State<OtfFirmaScreen> {
  final _sig = SignatureController(penStrokeWidth: 3, penColor: Colors.black, exportBackgroundColor: Colors.white);
  final _nombre = TextEditingController();
  final _dni = TextEditingController();
  bool _saving = false;
  Map<String, dynamic>? _otf;
  // Si la OTF tiene correo para el informe, se envía al cerrar (se puede quitar).
  bool _enviarInforme = true;

  @override
  void initState() {
    super.initState();
    widget.api.getOtf(widget.otfId).then((o) {
      if (mounted) setState(() => _otf = o);
    }).catchError((_) {});
  }

  /// Sin nadie de la base para firmar: se cierra igual y queda dicho en el
  /// informe.
  Future<void> _sinResponsable() async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (_) => AlertDialog(
        backgroundColor: AppColors.surface,
        title: const Text('¿Cerrar sin firma?', style: TextStyle(color: AppColors.textPrimary)),
        content: const Text(
          'En el informe constará que no había ningún responsable en la base para firmar.',
          style: TextStyle(color: AppColors.textSecondary, fontSize: 16),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Volver')),
          FilledButton(onPressed: () => Navigator.pop(context, true), child: const Text('Cerrar sin firma')),
        ],
      ),
    );
    if (ok != true) return;
    setState(() => _saving = true);
    try {
      await widget.api.finalizarOtf(widget.otfId, null, null, null,
          sinResponsable: true, enviarInforme: _hayCorreo && _enviarInforme);
      if (!mounted) return;
      Navigator.of(context).pop(true);
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
        content: Text(e.toString().replaceFirst('Exception: ', '')), backgroundColor: Colors.red));
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  bool get _hayCorreo => (_otf?['emailInforme'] ?? '').toString().trim().isNotEmpty;

  Widget _resumen() {
    final o = _otf;
    if (o == null) return const SizedBox.shrink();
    final trabajos = (o['trabajos'] as List<dynamic>?)?.cast<Map<String, dynamic>>() ?? [];
    final llegada = o['arrivedAtBaseMs'];
    return Container(
      margin: const EdgeInsets.only(bottom: 14),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(color: AppColors.surface, borderRadius: BorderRadius.circular(12)),
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        const Text('RESUMEN', style: TextStyle(color: AppColors.textHint, fontSize: 12, fontWeight: FontWeight.w700)),
        const SizedBox(height: 8),
        for (final t in trabajos)
          Padding(
            padding: const EdgeInsets.only(bottom: 6),
            child: Row(children: [
              Expanded(child: Text('${t['plate'] ?? '—'} · ${t['trabajo'] ?? ''}',
                  maxLines: 1, overflow: TextOverflow.ellipsis,
                  style: const TextStyle(color: AppColors.textPrimary, fontSize: 14))),
              const SizedBox(width: 8),
              Text(
                t['status'] == 'finalizado'
                    ? 'Hecho${_duracion(t) != null ? ' · ${_duracion(t)}' : ''}'
                    : t['status'] == 'no_realizado'
                        ? 'No realizado'
                        : 'Sin hacer',
                style: TextStyle(
                  color: t['status'] == 'finalizado' ? AppColors.success : AppColors.warning,
                  fontWeight: FontWeight.w800,
                ),
              ),
            ]),
          ),
        if (llegada is int)
          Text('En la base desde las ${_hora(llegada)} (${_desde(llegada)})',
              style: const TextStyle(color: AppColors.textSecondary, fontSize: 13)),
      ]),
    );
  }

  String _hora(int ms) {
    final d = DateTime.fromMillisecondsSinceEpoch(ms);
    return '${d.hour.toString().padLeft(2, '0')}:${d.minute.toString().padLeft(2, '0')}';
  }

  String _desde(int ms) {
    final min = DateTime.now().difference(DateTime.fromMillisecondsSinceEpoch(ms)).inMinutes;
    return min < 60 ? '$min min' : '${min ~/ 60} h ${min % 60} min';
  }

  @override
  void dispose() {
    _sig.dispose(); _nombre.dispose(); _dni.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    if (_sig.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Falta la firma'), backgroundColor: Colors.red));
      return;
    }
    setState(() => _saving = true);
    try {
      final Uint8List? bytes = await _sig.toPngBytes(height: 200, width: 600);
      if (bytes == null) throw Exception('No se pudo exportar la firma');
      final tmp = await getTemporaryDirectory();
      final f = File('${tmp.path}/otf_firma_${DateTime.now().millisecondsSinceEpoch}.png');
      await f.writeAsBytes(bytes);
      await widget.api.finalizarOtf(widget.otfId, f,
          _nombre.text.trim().isEmpty ? null : _nombre.text.trim(),
          _dni.text.trim().isEmpty ? null : _dni.text.trim(),
          enviarInforme: _hayCorreo && _enviarInforme);
      if (!mounted) return;
      Navigator.of(context).pop(true);
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
        content: Text(e.toString().replaceFirst('Exception: ', '')), backgroundColor: Colors.red));
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(title: const Text('Firma de la visita'), backgroundColor: AppColors.surface, foregroundColor: AppColors.textPrimary),
      body: _saving
          ? const Center(child: CircularProgressIndicator(color: AppColors.primary))
          : SingleChildScrollView(
              padding: const EdgeInsets.all(16),
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                _resumen(),
                const Text('Firma única del responsable de la base (valida todos los trabajos de la visita).',
                    style: TextStyle(color: AppColors.textSecondary)),
                const SizedBox(height: 14),
                TextField(controller: _nombre, style: const TextStyle(color: Colors.black87),
                    decoration: const InputDecoration(labelText: 'Nombre (opcional)', filled: true, fillColor: Colors.white)),
                const SizedBox(height: 10),
                TextField(controller: _dni, style: const TextStyle(color: Colors.black87),
                    decoration: const InputDecoration(labelText: 'DNI (opcional)', filled: true, fillColor: Colors.white)),
                const SizedBox(height: 14),
                const Text('Firma *', style: TextStyle(color: AppColors.textSecondary, fontSize: 12, fontWeight: FontWeight.w700)),
                const SizedBox(height: 6),
                Container(
                  decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(12), border: Border.all(color: Colors.black26)),
                  child: ClipRRect(borderRadius: BorderRadius.circular(11),
                      child: Signature(controller: _sig, height: 260, backgroundColor: Colors.white)),
                ),
                Align(alignment: Alignment.centerRight, child: TextButton.icon(
                  onPressed: () => setState(() => _sig.clear()),
                  icon: const Icon(Icons.refresh, size: 16, color: AppColors.textHint),
                  label: const Text('Borrar', style: TextStyle(color: AppColors.textHint)),
                )),
                if (_hayCorreo)
                  CheckboxListTile(
                    value: _enviarInforme,
                    onChanged: (v) => setState(() => _enviarInforme = v ?? false),
                    title: Text('Enviar el informe por correo a ${_otf!['emailInforme']}',
                        style: const TextStyle(color: AppColors.textPrimary, fontSize: 15)),
                    controlAffinity: ListTileControlAffinity.leading,
                    contentPadding: EdgeInsets.zero,
                    activeColor: AppColors.primary,
                  ),
                const SizedBox(height: 8),
                SizedBox(width: double.infinity, child: ElevatedButton.icon(
                  onPressed: _save, icon: const Icon(Icons.check),
                  label: const Text('Finalizar visita'),
                  style: ElevatedButton.styleFrom(backgroundColor: AppColors.success, foregroundColor: Colors.white, padding: const EdgeInsets.symmetric(vertical: 16)),
                )),
                const SizedBox(height: 12),
                SizedBox(width: double.infinity, child: OutlinedButton.icon(
                  onPressed: _sinResponsable,
                  icon: const Icon(Icons.person_off_outlined),
                  label: const Text('Sin responsable en la base'),
                  style: OutlinedButton.styleFrom(
                    foregroundColor: AppColors.warning,
                    side: const BorderSide(color: AppColors.warning),
                    padding: const EdgeInsets.symmetric(vertical: 14),
                  ),
                )),
              ]),
            ),
    );
  }
}
