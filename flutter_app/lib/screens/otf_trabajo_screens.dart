import 'dart:async';
import 'dart:io';

import 'package:flutter/material.dart';

import '../services/api_service.dart';
import '../services/camara.dart';
import '../theme/app_theme.dart';
import '../widgets/plate_badge.dart';

/// Por qué no se ha hecho un trabajo. Siempre va con la explicación del
/// técnico, que es obligatoria.
const motivosNoRealizado = [
  'El vehículo no está en la base',
  'Falta material',
  'El cliente no autoriza el trabajo',
  'Avería distinta a la indicada',
  'Peligroso / sin seguridad',
  'Otro',
];

/// Lo mínimo que tiene que escribir el técnico para que la oficina entienda
/// qué ha pasado.
const minExplicacionNoRealizado = 10;

List<Map<String, dynamic>> _fotos(Map<String, dynamic> t) =>
    (t['fotos'] as List<dynamic>?)?.cast<Map<String, dynamic>>() ?? [];

// ── Antes de empezar: foto de la matrícula (obligatoria) y más fotos ──
//
// Como en las asistencias, antes de tocar el vehículo: la foto con la
// matrícula —que el servidor lee y compara con la del trabajo, para no
// trabajar en el remolque equivocado— y las del estado inicial que convenga.
class OtfInicioTrabajoScreen extends StatefulWidget {
  final ApiService api;
  final Map<String, dynamic> trabajo;
  final int numero;
  final int total;
  const OtfInicioTrabajoScreen({
    super.key,
    required this.api,
    required this.trabajo,
    required this.numero,
    required this.total,
  });

  @override
  State<OtfInicioTrabajoScreen> createState() => _OtfInicioTrabajoScreenState();
}

class _OtfInicioTrabajoScreenState extends State<OtfInicioTrabajoScreen> {
  File? _matricula;
  late bool _matriculaSubida = _fotos(widget.trabajo).any((f) => f['kind'] == 'matricula');
  final List<File> _extras = [];
  bool _ocupado = false;

  int get _tid => widget.trabajo['id'] as int;

  Future<void> _fotoMatricula() async {
    final x = await Camara.hacerFoto(context, maxWidth: 1920);
    if (x == null || !mounted) return;
    setState(() {
      _matricula = File(x.path);
      _ocupado = true;
    });
    try {
      final r = await widget.api.uploadOtfTrabajoFile(_tid, File(x.path), 'matricula');
      _matriculaSubida = true;
      if (r['offline'] == true && mounted) {
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
          content: Text('Sin cobertura: la foto se enviará al recuperar señal (la matrícula se comprobará entonces).'),
        ));
      }
      final m = r['matricula'];
      if (m is Map && m['coincide'] == false && mounted) {
        final esEste = await showDialog<bool>(
          context: context,
          barrierDismissible: false,
          builder: (_) => AlertDialog(
            backgroundColor: AppColors.surface,
            title: const Text('¿Es el vehículo correcto?', style: TextStyle(color: AppColors.textPrimary)),
            content: Text(
              'En la foto se lee ${m['leida']}, y el trabajo es para ${m['esperada']}.\n\n'
              'Comprueba que estás en el vehículo correcto antes de empezar.',
              style: const TextStyle(color: AppColors.textSecondary, fontSize: 16),
            ),
            actions: [
              TextButton(
                onPressed: () => Navigator.pop(context, false),
                child: const Text('Repetir foto'),
              ),
              FilledButton(
                onPressed: () => Navigator.pop(context, true),
                child: const Text('Sí, es este'),
              ),
            ],
          ),
        );
        if (esEste == false && mounted) {
          setState(() => _ocupado = false);
          await _fotoMatricula();
          return;
        }
      }
    } catch (e) {
      _matriculaSubida = false;
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(
          content: Text(e.toString().replaceFirst('Exception: ', '')),
          backgroundColor: Colors.red,
        ));
      }
    } finally {
      if (mounted) setState(() => _ocupado = false);
    }
  }

  Future<void> _masFotos({required bool galeria}) async {
    final x = await (galeria
        ? Camara.elegirDeGaleria(context, maxWidth: 1920)
        : Camara.hacerFoto(context, maxWidth: 1920));
    if (x == null || !mounted) return;
    setState(() => _ocupado = true);
    try {
      await widget.api.uploadOtfTrabajoFile(_tid, File(x.path), 'inicial');
      if (mounted) setState(() => _extras.add(File(x.path)));
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(
          content: Text(e.toString().replaceFirst('Exception: ', '')),
          backgroundColor: Colors.red,
        ));
      }
    } finally {
      if (mounted) setState(() => _ocupado = false);
    }
  }

  Future<void> _noSePuede() async {
    final hecho = await Navigator.of(context).push<bool>(MaterialPageRoute(
      builder: (_) => OtfNoRealizadoScreen(
          api: widget.api, trabajo: widget.trabajo, numero: widget.numero, total: widget.total),
    ));
    // Sin valor: la OTF recarga y no abre «en curso».
    if (hecho == true && mounted) Navigator.of(context).pop();
  }

  Future<void> _empezar() async {
    setState(() => _ocupado = true);
    try {
      await widget.api.updateOtfTrabajoStatus(_tid, 'en_proceso', otfId: widget.trabajo['otfId'] as int?);
      if (!mounted) return;
      Navigator.of(context).pop(true);
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(
          content: Text(e.toString().replaceFirst('Exception: ', '')),
          backgroundColor: Colors.red,
        ));
      }
    } finally {
      if (mounted) setState(() => _ocupado = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final t = widget.trabajo;
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
        title: Text('Trabajo ${widget.numero} de ${widget.total}'),
        backgroundColor: AppColors.surface,
        foregroundColor: AppColors.textPrimary,
      ),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            const Text('Antes de empezar',
                style: TextStyle(color: AppColors.textPrimary, fontSize: 22, fontWeight: FontWeight.w900)),
            const SizedBox(height: 12),
            _CabeceraTrabajo(trabajo: t),
            const SizedBox(height: 18),
            const Row(children: [
              Expanded(
                child: Text('1. Foto del vehículo y la matrícula',
                    style: TextStyle(color: AppColors.textPrimary, fontSize: 16, fontWeight: FontWeight.w900)),
              ),
              _Etiqueta(texto: 'OBLIGATORIA', color: AppColors.danger),
            ]),
            const SizedBox(height: 8),
            InkWell(
              onTap: _ocupado ? null : _fotoMatricula,
              borderRadius: BorderRadius.circular(16),
              child: Container(
                height: 190,
                decoration: BoxDecoration(
                  color: AppColors.surface,
                  borderRadius: BorderRadius.circular(16),
                  border: Border.all(
                    color: _matriculaSubida ? AppColors.success : const Color(0xFFFBBF24),
                    width: 3,
                  ),
                ),
                child: _matricula != null
                    ? ClipRRect(
                        borderRadius: BorderRadius.circular(13),
                        child: Image.file(_matricula!, fit: BoxFit.cover, width: double.infinity),
                      )
                    : Column(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          Icon(_matriculaSubida ? Icons.check_circle : Icons.photo_camera_outlined,
                              size: 44, color: _matriculaSubida ? AppColors.success : const Color(0xFFFDE68A)),
                          const SizedBox(height: 8),
                          Text(_matriculaSubida ? 'Ya tiene foto de la matrícula' : 'Hacer la foto',
                              style: const TextStyle(color: Color(0xFFFDE68A), fontSize: 17, fontWeight: FontWeight.w900)),
                          const Text('Que se lea la matrícula',
                              style: TextStyle(color: AppColors.textSecondary, fontSize: 13)),
                        ],
                      ),
              ),
            ),
            const SizedBox(height: 20),
            const Row(children: [
              Expanded(
                child: Text('2. Más fotos (estado inicial)',
                    style: TextStyle(color: AppColors.textPrimary, fontSize: 16, fontWeight: FontWeight.w900)),
              ),
              _Etiqueta(texto: 'OPCIONAL', color: AppColors.textHint),
            ]),
            const SizedBox(height: 8),
            _RejillaFotos(
              ficheros: _extras,
              ocupado: _ocupado,
              onCamara: () => _masFotos(galeria: false),
              onGaleria: () => _masFotos(galeria: true),
            ),
            const SizedBox(height: 6),
            const Text('Neumáticos, llanta, daños… lo que convenga que quede en el informe.',
                style: TextStyle(color: AppColors.textSecondary, fontSize: 13)),
            const SizedBox(height: 24),
            SizedBox(
              height: 64,
              child: FilledButton(
                onPressed: _matriculaSubida && !_ocupado ? _empezar : null,
                style: FilledButton.styleFrom(
                  backgroundColor: AppColors.success,
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
                ),
                child: _ocupado
                    ? const SizedBox(width: 24, height: 24, child: CircularProgressIndicator(strokeWidth: 2.5, color: Colors.white))
                    : const Text('Empezar trabajo', style: TextStyle(fontSize: 19, fontWeight: FontWeight.w900)),
              ),
            ),
            if (!_matriculaSubida)
              const Padding(
                padding: EdgeInsets.only(top: 8),
                child: Text('Se activa al hacer la foto de la matrícula',
                    textAlign: TextAlign.center, style: TextStyle(color: AppColors.textSecondary, fontSize: 13)),
              ),
            const SizedBox(height: 14),
            // Sin foto de matrícula también: si el camión no está, no hay foto.
            SizedBox(
              height: 52,
              child: OutlinedButton(
                onPressed: _ocupado ? null : _noSePuede,
                style: OutlinedButton.styleFrom(
                  foregroundColor: const Color(0xFFFFB4B0),
                  side: const BorderSide(color: AppColors.danger, width: 2),
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                ),
                child: const Text('No se puede realizar…', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w800)),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

// ── Trabajo en curso: tiempo, fotos y cierre ──
class OtfTrabajoEnCursoScreen extends StatefulWidget {
  final ApiService api;
  final Map<String, dynamic> trabajo;
  final int numero;
  final int total;
  const OtfTrabajoEnCursoScreen({
    super.key,
    required this.api,
    required this.trabajo,
    required this.numero,
    required this.total,
  });

  @override
  State<OtfTrabajoEnCursoScreen> createState() => _OtfTrabajoEnCursoScreenState();
}

class _OtfTrabajoEnCursoScreenState extends State<OtfTrabajoEnCursoScreen> {
  // Lista de comprobación de la plantilla del trabajo.
  late final List<String> _puntos =
      ((widget.trabajo['checklistPlantilla'] as List<dynamic>?) ?? []).map((e) => e.toString()).toList();
  final Set<String> _hechos = {};
  late final Map<String, TextEditingController> _valores = {for (final p in _puntos) p: TextEditingController()};
  // Material montado: lo que ya tenía y lo añadido ahora.
  late final List<Map<String, dynamic>> _material =
      ((widget.trabajo['material'] as List<dynamic>?) ?? []).map((e) => Map<String, dynamic>.from(e as Map)).toList();

  Future<void> _anadirMaterial() async {
    final m = await showModalBottomSheet<Map<String, dynamic>>(
      context: context,
      backgroundColor: AppColors.surface,
      isScrollControlled: true,
      builder: (_) => const _NuevoMaterial(),
    );
    if (m == null || !mounted) return;
    setState(() => _ocupado = true);
    try {
      final r = await widget.api.addOtfMaterial(_tid, m);
      if (mounted) setState(() => _material.add(r));
    } catch (e) {
      _error(e);
    } finally {
      if (mounted) setState(() => _ocupado = false);
    }
  }

  Future<void> _quitarMaterial(Map<String, dynamic> m) async {
    final id = m['id'];
    if (id is! int) {
      setState(() => _material.remove(m));
      return;
    }
    try {
      await widget.api.deleteOtfMaterial(id);
      if (mounted) setState(() => _material.remove(m));
    } catch (e) {
      _error(e);
    }
  }

  late final DateTime _inicio = widget.trabajo['iniciadoAtMs'] is int
      ? DateTime.fromMillisecondsSinceEpoch(widget.trabajo['iniciadoAtMs'] as int)
      : DateTime.now();
  Timer? _reloj;
  final List<File> _finales = [];
  bool _ocupado = false;

  int get _tid => widget.trabajo['id'] as int;

  @override
  void initState() {
    super.initState();
    _reloj = Timer.periodic(const Duration(seconds: 1), (_) {
      if (mounted) setState(() {});
    });
  }

  @override
  void dispose() {
    _reloj?.cancel();
    for (final c in _valores.values) {
      c.dispose();
    }
    super.dispose();
  }

  String get _tiempo {
    final d = DateTime.now().difference(_inicio);
    String dos(int n) => n.toString().padLeft(2, '0');
    return '${dos(d.inHours)}:${dos(d.inMinutes % 60)}:${dos(d.inSeconds % 60)}';
  }

  Future<void> _foto({required bool galeria}) async {
    final x = await (galeria
        ? Camara.elegirDeGaleria(context, maxWidth: 1920)
        : Camara.hacerFoto(context, maxWidth: 1920));
    if (x == null || !mounted) return;
    setState(() => _ocupado = true);
    try {
      await widget.api.uploadOtfTrabajoFile(_tid, File(x.path), 'final');
      if (mounted) setState(() => _finales.add(File(x.path)));
    } catch (e) {
      _error(e);
    } finally {
      if (mounted) setState(() => _ocupado = false);
    }
  }

  Future<void> _cerrar(String status, {String? motivo}) async {
    setState(() => _ocupado = true);
    try {
      await widget.api.updateOtfTrabajoStatus(
        _tid,
        status,
        motivo: motivo,
        otfId: widget.trabajo['otfId'] as int?,
        // Al finalizar, lo marcado de la lista de comprobación de su plantilla.
        checklist: status == 'finalizado' && _puntos.isNotEmpty
            ? [
                for (final p in _puntos)
                  {'texto': p, 'hecho': _hechos.contains(p), 'valor': _valores[p]?.text.trim()},
              ]
            : null,
      );
      if (mounted) Navigator.of(context).pop(true);
    } catch (e) {
      _error(e);
    } finally {
      if (mounted) setState(() => _ocupado = false);
    }
  }

  Future<void> _noRealizado() async {
    final hecho = await Navigator.of(context).push<bool>(MaterialPageRoute(
      builder: (_) => OtfNoRealizadoScreen(
          api: widget.api, trabajo: widget.trabajo, numero: widget.numero, total: widget.total),
    ));
    if (hecho == true && mounted) Navigator.of(context).pop(true);
  }

  void _error(Object e) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(
      content: Text(e.toString().replaceFirst('Exception: ', '')),
      backgroundColor: Colors.red,
    ));
  }

  @override
  Widget build(BuildContext context) {
    final t = widget.trabajo;
    final previas = _fotos(t);
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
        title: Text('Trabajo ${widget.numero} de ${widget.total} · en curso'),
        backgroundColor: AppColors.surface,
        foregroundColor: AppColors.textPrimary,
      ),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            Row(
              children: [
                Expanded(child: _CabeceraTrabajo(trabajo: t)),
                const SizedBox(width: 12),
                Column(
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: [
                    const Text('TIEMPO', style: TextStyle(color: AppColors.textHint, fontSize: 11, fontWeight: FontWeight.w700)),
                    Text(_tiempo,
                        style: const TextStyle(
                          color: AppColors.info,
                          fontSize: 26,
                          fontWeight: FontWeight.w900,
                          fontFeatures: [FontFeature.tabularFigures()],
                        )),
                  ],
                ),
              ],
            ),
            if (previas.isNotEmpty) ...[
              const SizedBox(height: 14),
              SizedBox(
                height: 72,
                child: ListView.separated(
                  scrollDirection: Axis.horizontal,
                  itemCount: previas.length,
                  separatorBuilder: (_, __) => const SizedBox(width: 8),
                  itemBuilder: (_, i) => ClipRRect(
                    borderRadius: BorderRadius.circular(10),
                    child: Image.network(previas[i]['url'] as String, width: 72, height: 72, fit: BoxFit.cover),
                  ),
                ),
              ),
            ],
            const SizedBox(height: 20),
            const Text('Fotos del trabajo hecho',
                style: TextStyle(color: AppColors.textPrimary, fontSize: 16, fontWeight: FontWeight.w900)),
            const SizedBox(height: 8),
            _RejillaFotos(
              ficheros: _finales,
              ocupado: _ocupado,
              onCamara: () => _foto(galeria: false),
              onGaleria: () => _foto(galeria: true),
            ),
            if (_puntos.isNotEmpty) ...[
              const SizedBox(height: 20),
              const Text('Comprobar al terminar',
                  style: TextStyle(color: AppColors.textPrimary, fontSize: 16, fontWeight: FontWeight.w900)),
              const SizedBox(height: 6),
              for (final p in _puntos)
                Row(children: [
                  Checkbox(
                    value: _hechos.contains(p),
                    onChanged: (v) => setState(() => v == true ? _hechos.add(p) : _hechos.remove(p)),
                    activeColor: AppColors.success,
                  ),
                  Expanded(child: Text(p, style: const TextStyle(color: AppColors.textPrimary, fontSize: 15))),
                  SizedBox(
                    width: 110,
                    child: TextField(
                      controller: _valores[p],
                      style: const TextStyle(color: AppColors.textPrimary, fontSize: 14),
                      decoration: const InputDecoration(hintText: 'valor', isDense: true),
                    ),
                  ),
                ]),
            ],
            const SizedBox(height: 20),
            Row(children: [
              const Expanded(
                child: Text('Material usado',
                    style: TextStyle(color: AppColors.textPrimary, fontSize: 16, fontWeight: FontWeight.w900)),
              ),
              TextButton.icon(
                onPressed: _ocupado ? null : _anadirMaterial,
                icon: const Icon(Icons.add),
                label: const Text('Añadir'),
              ),
            ]),
            if (_material.isEmpty)
              const Text('Neumáticos o piezas montadas: salen en el informe y en el presupuesto.',
                  style: TextStyle(color: AppColors.textSecondary, fontSize: 13)),
            for (final m in _material)
              ListTile(
                contentPadding: EdgeInsets.zero,
                leading: const Icon(Icons.tire_repair, color: AppColors.textSecondary),
                title: Text(
                  m['texto']?.toString() ??
                      '${m['cantidad']} × ${m['descripcion'] ?? m['medida']}${m['marca'] != null ? ' ${m['marca']}' : ''}',
                  style: const TextStyle(color: AppColors.textPrimary),
                ),
                subtitle: m['offline'] == true
                    ? const Text('Sin cobertura: se enviará al recuperar señal',
                        style: TextStyle(color: AppColors.warning, fontSize: 12))
                    : null,
                trailing: IconButton(
                  onPressed: () => _quitarMaterial(m),
                  icon: const Icon(Icons.close, color: AppColors.danger),
                  tooltip: 'Quitar',
                ),
              ),
            const SizedBox(height: 28),
            SizedBox(
              height: 64,
              child: FilledButton(
                onPressed: _ocupado ? null : () => _cerrar('finalizado'),
                style: FilledButton.styleFrom(
                  backgroundColor: AppColors.success,
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
                ),
                child: const Text('Finalizar trabajo', style: TextStyle(fontSize: 20, fontWeight: FontWeight.w900)),
              ),
            ),
            const SizedBox(height: 10),
            SizedBox(
              height: 52,
              child: OutlinedButton(
                onPressed: _ocupado ? null : _noRealizado,
                style: OutlinedButton.styleFrom(
                  foregroundColor: const Color(0xFFFDE68A),
                  side: const BorderSide(color: Color(0xFFB45309)),
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                ),
                child: const Text('No se puede realizar…', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700)),
              ),
            ),
            const SizedBox(height: 8),
            const Text('Pide el motivo, tu explicación y, si quieres, fotos: sale en el informe.',
                textAlign: TextAlign.center, style: TextStyle(color: AppColors.textSecondary, fontSize: 13)),
          ],
        ),
      ),
    );
  }
}

/// Un trabajo que no se puede hacer: motivo, explicación del técnico
/// (obligatoria) y fotos que lo demuestren. Sale en el informe como
/// NO REALIZADO. También sirve para corregirlo después (viene relleno).
class OtfNoRealizadoScreen extends StatefulWidget {
  final ApiService api;
  final Map<String, dynamic> trabajo;
  final int numero;
  final int total;
  const OtfNoRealizadoScreen({
    super.key,
    required this.api,
    required this.trabajo,
    required this.numero,
    required this.total,
  });

  @override
  State<OtfNoRealizadoScreen> createState() => _OtfNoRealizadoScreenState();
}

class _OtfNoRealizadoScreenState extends State<OtfNoRealizadoScreen> {
  late String? _motivo = motivosNoRealizado.contains(widget.trabajo['motivoNoRealizado'])
      ? widget.trabajo['motivoNoRealizado'] as String
      : (widget.trabajo['motivoNoRealizado'] != null ? 'Otro' : null);
  late final _explicacion = TextEditingController(
    text: widget.trabajo['explicacionNoRealizado']?.toString() ??
        // De versiones viejas: el «Otro» escrito era el motivo.
        (widget.trabajo['motivoNoRealizado'] != null && !motivosNoRealizado.contains(widget.trabajo['motivoNoRealizado'])
            ? widget.trabajo['motivoNoRealizado'].toString()
            : ''),
  );
  final List<File> _nuevas = [];
  bool _ocupado = false;

  static const _maxFotos = 6;

  int get _tid => widget.trabajo['id'] as int;
  int get _yaSubidas => _fotos(widget.trabajo).where((f) => f['kind'] == 'no_realizado').length;
  bool get _valido => _motivo != null && _explicacion.text.trim().length >= minExplicacionNoRealizado;

  @override
  void dispose() {
    _explicacion.dispose();
    super.dispose();
  }

  Future<void> _foto({required bool galeria}) async {
    if (_nuevas.length + _yaSubidas >= _maxFotos) return;
    final x = await (galeria
        ? Camara.elegirDeGaleria(context, maxWidth: 1920)
        : Camara.hacerFoto(context, maxWidth: 1920));
    if (x == null || !mounted) return;
    setState(() => _nuevas.add(File(x.path)));
  }

  Future<void> _guardar() async {
    if (!_valido) return;
    setState(() => _ocupado = true);
    try {
      // Las fotos se suben al confirmar: si se arrepiente, no quedan en el trabajo.
      // Sin cobertura se quedan en la cola y se envían al volver la señal.
      var sinCobertura = false;
      for (final f in _nuevas) {
        final r = await widget.api.uploadOtfTrabajoFile(_tid, f, 'no_realizado');
        if (r['offline'] == true) sinCobertura = true;
      }
      await widget.api.updateOtfTrabajoStatus(
        _tid,
        'no_realizado',
        motivo: _motivo,
        explicacion: _explicacion.text.trim(),
        otfId: widget.trabajo['otfId'] as int?,
      );
      if (!mounted) return;
      if (sinCobertura) {
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
          content: Text('Sin cobertura: se enviará al recuperar señal.'),
        ));
      }
      Navigator.of(context).pop(true);
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(
          content: Text(e.toString().replaceFirst('Exception: ', '')),
          backgroundColor: Colors.red,
        ));
      }
    } finally {
      if (mounted) setState(() => _ocupado = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final t = widget.trabajo;
    final caben = _nuevas.length + _yaSubidas < _maxFotos;
    final escrito = _explicacion.text.trim().length;
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
        title: Text('No se puede realizar · ${widget.numero} de ${widget.total}'),
        backgroundColor: AppColors.surface,
        foregroundColor: AppColors.textPrimary,
      ),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            _CabeceraTrabajo(trabajo: t),
            const SizedBox(height: 18),
            const Text('1 · ¿Por qué no se hace?',
                style: TextStyle(color: AppColors.textPrimary, fontSize: 16, fontWeight: FontWeight.w900)),
            const SizedBox(height: 8),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                for (final m in motivosNoRealizado)
                  ChoiceChip(
                    label: Text(m),
                    selected: _motivo == m,
                    onSelected: _ocupado ? null : (_) => setState(() => _motivo = m),
                    showCheckmark: true,
                    checkmarkColor: const Color(0xFFFFD2B0),
                    selectedColor: const Color(0xFF3A2414),
                    backgroundColor: AppColors.surface,
                    side: BorderSide(
                      color: _motivo == m ? AppColors.warning : AppColors.cardBorder,
                      width: _motivo == m ? 2 : 1,
                    ),
                    labelStyle: TextStyle(
                      color: _motivo == m ? const Color(0xFFFFD2B0) : AppColors.textPrimary,
                      fontWeight: _motivo == m ? FontWeight.w800 : FontWeight.w600,
                      fontSize: 14,
                    ),
                    padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 8),
                  ),
              ],
            ),
            const SizedBox(height: 20),
            const Row(children: [
              Expanded(
                child: Text('2 · Explica qué has visto',
                    style: TextStyle(color: AppColors.textPrimary, fontSize: 16, fontWeight: FontWeight.w900)),
              ),
              _Etiqueta(texto: 'OBLIGATORIO', color: AppColors.warning),
            ]),
            const SizedBox(height: 8),
            TextField(
              controller: _explicacion,
              enabled: !_ocupado,
              minLines: 4,
              maxLines: 8,
              maxLength: 500,
              onChanged: (_) => setState(() {}),
              textCapitalization: TextCapitalization.sentences,
              style: const TextStyle(color: AppColors.textPrimary, fontSize: 15),
              decoration: const InputDecoration(
                hintText: 'Qué pasa y qué hace falta para poder hacerlo',
                filled: true,
                helperText: 'Se puede dictar con el micrófono del teclado',
              ),
            ),
            if (escrito > 0 && escrito < minExplicacionNoRealizado)
              const Text('Un poco más de detalle, para que la oficina lo entienda.',
                  style: TextStyle(color: AppColors.warning, fontSize: 13)),
            const SizedBox(height: 16),
            const Row(children: [
              Expanded(
                child: Text('3 · Fotos que lo demuestren',
                    style: TextStyle(color: AppColors.textPrimary, fontSize: 16, fontWeight: FontWeight.w900)),
              ),
              _Etiqueta(texto: 'OPCIONAL · HASTA $_maxFotos', color: AppColors.textHint),
            ]),
            if (_yaSubidas > 0)
              Padding(
                padding: const EdgeInsets.only(top: 4),
                child: Text('Ya tiene $_yaSubidas foto(s) de antes',
                    style: const TextStyle(color: AppColors.textSecondary, fontSize: 13)),
              ),
            const SizedBox(height: 8),
            GridView.count(
              crossAxisCount: 4,
              crossAxisSpacing: 8,
              mainAxisSpacing: 8,
              shrinkWrap: true,
              physics: const NeverScrollableScrollPhysics(),
              children: [
                for (final f in _nuevas)
                  Stack(fit: StackFit.expand, children: [
                    ClipRRect(borderRadius: BorderRadius.circular(10), child: Image.file(f, fit: BoxFit.cover)),
                    Positioned(
                      top: 2,
                      right: 2,
                      child: IconButton.filled(
                        onPressed: _ocupado ? null : () => setState(() => _nuevas.remove(f)),
                        icon: const Icon(Icons.close, size: 18),
                        tooltip: 'Quitar foto',
                        style: IconButton.styleFrom(
                          backgroundColor: AppColors.background,
                          foregroundColor: AppColors.danger,
                          minimumSize: const Size(32, 32),
                        ),
                      ),
                    ),
                  ]),
                if (caben) ...[
                  _BotonFoto(icono: Icons.add_a_photo_outlined, texto: 'Cámara',
                      onTap: _ocupado ? null : () => _foto(galeria: false)),
                  _BotonFoto(icono: Icons.photo_library_outlined, texto: 'Galería',
                      onTap: _ocupado ? null : () => _foto(galeria: true)),
                ],
              ],
            ),
            const SizedBox(height: 16),
            Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(color: AppColors.secondary, borderRadius: BorderRadius.circular(12)),
              child: const Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Icon(Icons.info_outline, color: AppColors.info, size: 20),
                SizedBox(width: 10),
                Expanded(
                  child: Text(
                    'Saldrá en el informe como NO REALIZADO, con tu explicación y las fotos.',
                    style: TextStyle(color: Color(0xFFCFE0F5), fontSize: 13),
                  ),
                ),
              ]),
            ),
            const SizedBox(height: 20),
            SizedBox(
              height: 60,
              child: FilledButton(
                onPressed: _valido && !_ocupado ? _guardar : null,
                style: FilledButton.styleFrom(
                  backgroundColor: AppColors.danger,
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
                ),
                child: _ocupado
                    ? const SizedBox(width: 24, height: 24, child: CircularProgressIndicator(strokeWidth: 2.5, color: Colors.white))
                    : const Text('Marcar como no realizado', style: TextStyle(fontSize: 18, fontWeight: FontWeight.w900)),
              ),
            ),
            if (!_valido)
              const Padding(
                padding: EdgeInsets.only(top: 8),
                child: Text('Elige el motivo y escribe la explicación',
                    textAlign: TextAlign.center, style: TextStyle(color: AppColors.textSecondary, fontSize: 13)),
              ),
          ],
        ),
      ),
    );
  }
}

class _CabeceraTrabajo extends StatelessWidget {
  const _CabeceraTrabajo({required this.trabajo});
  final Map<String, dynamic> trabajo;

  @override
  Widget build(BuildContext context) {
    final plate = (trabajo['plate']?.toString() ?? '').trim();
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(color: AppColors.surface, borderRadius: BorderRadius.circular(14)),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(children: [
            if (plate.isNotEmpty) PlateBadge(plate: plate),
            const SizedBox(width: 8),
            Flexible(
              child: Text(trabajo['tipoVehiculo']?.toString() ?? '',
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(color: AppColors.textSecondary, fontSize: 13)),
            ),
          ]),
          const SizedBox(height: 6),
          Text(trabajo['trabajo']?.toString() ?? '',
              style: const TextStyle(color: AppColors.textPrimary, fontSize: 15)),
          if ((trabajo['observaciones']?.toString() ?? '').trim().isNotEmpty)
            Padding(
              padding: const EdgeInsets.only(top: 4),
              child: Text('📌 ${trabajo['observaciones']}',
                  style: const TextStyle(color: AppColors.warning, fontSize: 13, fontWeight: FontWeight.w700)),
            ),
        ],
      ),
    );
  }
}

class _Etiqueta extends StatelessWidget {
  const _Etiqueta({required this.texto, required this.color});
  final String texto;
  final Color color;

  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
        decoration: BoxDecoration(
          color: color.withValues(alpha: 0.18),
          borderRadius: BorderRadius.circular(999),
          border: Border.all(color: color.withValues(alpha: 0.5)),
        ),
        child: Text(texto, style: TextStyle(color: color, fontSize: 11, fontWeight: FontWeight.w900)),
      );
}

class _RejillaFotos extends StatelessWidget {
  const _RejillaFotos({
    required this.ficheros,
    required this.ocupado,
    required this.onCamara,
    required this.onGaleria,
  });
  final List<File> ficheros;
  final bool ocupado;
  final VoidCallback onCamara;
  final VoidCallback onGaleria;

  @override
  Widget build(BuildContext context) {
    return GridView.count(
      crossAxisCount: 4,
      crossAxisSpacing: 8,
      mainAxisSpacing: 8,
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      children: [
        for (final f in ficheros)
          ClipRRect(borderRadius: BorderRadius.circular(10), child: Image.file(f, fit: BoxFit.cover)),
        _BotonFoto(icono: Icons.add_a_photo_outlined, texto: 'Cámara', onTap: ocupado ? null : onCamara),
        _BotonFoto(icono: Icons.photo_library_outlined, texto: 'Galería', onTap: ocupado ? null : onGaleria),
      ],
    );
  }
}

class _BotonFoto extends StatelessWidget {
  const _BotonFoto({required this.icono, required this.texto, this.onTap});
  final IconData icono;
  final String texto;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) => InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(10),
        child: Container(
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(10),
            border: Border.all(color: AppColors.textHint, width: 1.5),
          ),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(icono, color: AppColors.textSecondary),
              const SizedBox(height: 4),
              Text(texto, style: const TextStyle(color: AppColors.textSecondary, fontSize: 12, fontWeight: FontWeight.w700)),
            ],
          ),
        ),
      );
}


/// Añadir un neumático o material montado.
class _NuevoMaterial extends StatefulWidget {
  const _NuevoMaterial();
  @override
  State<_NuevoMaterial> createState() => _NuevoMaterialState();
}

class _NuevoMaterialState extends State<_NuevoMaterial> {
  bool _neumatico = true;
  bool _usado = false;
  int _cantidad = 1;
  final _descripcion = TextEditingController();
  final _marca = TextEditingController();

  @override
  void dispose() {
    _descripcion.dispose();
    _marca.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final valido = _descripcion.text.trim().isNotEmpty;
    return Padding(
      padding: EdgeInsets.fromLTRB(16, 16, 16, 16 + MediaQuery.of(context).viewInsets.bottom),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const Text('Material usado',
              style: TextStyle(color: AppColors.textPrimary, fontSize: 20, fontWeight: FontWeight.w900)),
          const SizedBox(height: 12),
          SegmentedButton<bool>(
            segments: const [
              ButtonSegment(value: true, label: Text('Neumático')),
              ButtonSegment(value: false, label: Text('Otro material')),
            ],
            selected: {_neumatico},
            onSelectionChanged: (v) => setState(() => _neumatico = v.first),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _descripcion,
            autofocus: true,
            textCapitalization: TextCapitalization.characters,
            onChanged: (_) => setState(() {}),
            style: const TextStyle(color: AppColors.textPrimary),
            decoration: InputDecoration(
              labelText: _neumatico ? 'Medida' : 'Qué material',
              hintText: _neumatico ? '385/65R22.5' : 'Válvula, tuerca…',
              filled: true,
            ),
          ),
          const SizedBox(height: 10),
          TextField(
            controller: _marca,
            style: const TextStyle(color: AppColors.textPrimary),
            decoration: const InputDecoration(labelText: 'Marca (opcional)', filled: true),
          ),
          const SizedBox(height: 12),
          Row(children: [
            if (_neumatico)
              Expanded(
                child: SegmentedButton<bool>(
                  segments: const [
                    ButtonSegment(value: false, label: Text('Nuevo')),
                    ButtonSegment(value: true, label: Text('Usado')),
                  ],
                  selected: {_usado},
                  onSelectionChanged: (v) => setState(() => _usado = v.first),
                ),
              )
            else
              const Spacer(),
            const SizedBox(width: 12),
            IconButton(
              onPressed: _cantidad > 1 ? () => setState(() => _cantidad--) : null,
              icon: const Icon(Icons.remove_circle_outline, color: AppColors.textSecondary),
              tooltip: 'Menos',
            ),
            Text('$_cantidad', style: const TextStyle(color: AppColors.textPrimary, fontSize: 20, fontWeight: FontWeight.w900)),
            IconButton(
              onPressed: _cantidad < 50 ? () => setState(() => _cantidad++) : null,
              icon: const Icon(Icons.add_circle_outline, color: AppColors.textSecondary),
              tooltip: 'Más',
            ),
          ]),
          const SizedBox(height: 14),
          SizedBox(
            height: 52,
            child: FilledButton(
              onPressed: !valido
                  ? null
                  : () => Navigator.pop(context, {
                        'tipo': _neumatico ? 'neumatico' : 'otro',
                        'descripcion': _descripcion.text.trim(),
                        if (_marca.text.trim().isNotEmpty) 'marca': _marca.text.trim(),
                        if (_neumatico) 'estado': _usado ? 'usado' : 'nuevo',
                        'cantidad': _cantidad,
                      }),
              child: const Text('Añadir', style: TextStyle(fontWeight: FontWeight.w900)),
            ),
          ),
        ],
      ),
    );
  }
}
