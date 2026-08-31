import 'dart:io';
import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import '../models/models.dart';
import '../services/supabase_service.dart';
import '../theme/app_theme.dart';

/// Corregir QUÉ neumático hay en una posición, desde la propia revisión.
///
/// La goma que el técnico tiene delante no es la que Mobilink dice. Esto NO es
/// un trabajo de taller: no se monta ni se desmonta nada, se corrige el dato
/// para que coincida con la realidad. Cero coste, cero mano de obra, y la
/// revisión sigue abierta al terminar.
///
/// Por qué la acción NO se llama "Cambiar": porque eso es una sustitución
/// física, que sí genera trabajo. Confundirlas es la manera más fácil de
/// meter en el histórico un montaje que nunca ocurrió.
///
/// Tres caminos para decir cuál es la buena, y siempre acaban igual: una
/// pantalla que enseña lo que había y lo que va a haber, y un botón. La IA
/// propone; guarda el técnico.
class NoCoincideScreen extends StatefulWidget {
  final Neumatico registrado;
  final String montajeId;
  final String empresaId;
  final String revisionId;
  final String posicionId;
  final String posicionNombre;

  const NoCoincideScreen({
    super.key,
    required this.registrado,
    required this.montajeId,
    required this.empresaId,
    required this.revisionId,
    required this.posicionId,
    required this.posicionNombre,
  });

  @override
  State<NoCoincideScreen> createState() => _NoCoincideScreenState();
}

class _NoCoincideScreenState extends State<NoCoincideScreen> {
  bool _hayIA = false;
  bool _trabajando = false;
  String? _error;

  // Camino A: una ficha que ya existe.
  final _busqueda = TextEditingController();
  List<Neumatico> _candidatos = [];

  // Camino C: lo leído del flanco, ya confirmado o corregido a mano.
  final _marca = TextEditingController();
  final _modelo = TextEditingController();
  final _medida = TextEditingController();
  final _dot = TextEditingController();
  final _carga = TextEditingController();
  final _velocidad = TextEditingController();
  List<String> _dudosos = [];
  String? _avisoIA;
  String? _fotoUrl;
  bool _leido = false;

  @override
  void initState() {
    super.initState();
    SupabaseService.flancoDisponible().then((v) {
      if (mounted) setState(() => _hayIA = v);
    });
  }

  @override
  void dispose() {
    for (final c in [_busqueda, _marca, _modelo, _medida, _dot, _carga, _velocidad]) {
      c.dispose();
    }
    super.dispose();
  }

  // ── Camino A: buscar una ficha que ya existe ───────────────────────────────
  Future<void> _buscar() async {
    setState(() { _trabajando = true; _error = null; });
    try {
      final r = await SupabaseService.buscarNeumaticosParaCorregir(widget.empresaId, _busqueda.text);
      if (mounted) setState(() => _candidatos = r);
    } catch (e) {
      if (mounted) setState(() => _error = 'No se ha podido buscar: $e');
    } finally {
      if (mounted) setState(() => _trabajando = false);
    }
  }

  // ── Camino C: la foto del flanco ───────────────────────────────────────────
  Future<void> _identificarConFoto() async {
    final foto = await ImagePicker().pickImage(source: ImageSource.camera, imageQuality: 85);
    if (foto == null) return;
    setState(() { _trabajando = true; _error = null; _avisoIA = null; });
    try {
      final url = await SupabaseService.subirFotoFlanco(
        File(foto.path), revisionId: widget.revisionId, posicionId: widget.posicionId);
      final p = await SupabaseService.leerFlanco(url);
      if (!mounted) return;
      setState(() {
        _fotoUrl = url;
        _leido = true;
        // Lo que no se ha leído con seguridad llega vacío: se deja vacío. No
        // se rellena a ojo, que es como se cuela un dato equivocado.
        _marca.text = (p['marca'] ?? '') as String? ?? '';
        _modelo.text = (p['modelo'] ?? '') as String? ?? '';
        _medida.text = (p['medida'] ?? '') as String? ?? '';
        _dot.text = (p['dot'] ?? '') as String? ?? '';
        _carga.text = (p['indice_carga_simple'] ?? '') as String? ?? '';
        _velocidad.text = (p['codigo_velocidad'] ?? '') as String? ?? '';
        _dudosos = ((p['dudosos'] as List?) ?? const []).map((e) => e.toString()).toList();
        _avisoIA = p['aviso'] as String?;
      });
    } catch (e) {
      if (mounted) setState(() => _error = 'No se ha podido subir la foto: $e');
    } finally {
      if (mounted) setState(() => _trabajando = false);
    }
  }

  // ── El final común: confirmar ──────────────────────────────────────────────
  Future<bool> _confirmar(String queVaAHaber) async {
    return await showDialog<bool>(
          context: context,
          builder: (_) => AlertDialog(
            backgroundColor: AppColors.surface,
            title: const Text('Corregir neumático registrado'),
            content: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text('Posición: ${widget.posicionNombre}',
                  style: const TextStyle(color: AppColors.textSecondary, fontSize: 13)),
              const SizedBox(height: 10),
              const Text('Actualmente registrado', style: TextStyle(fontSize: 11, color: AppColors.textSecondary)),
              Text(_describe(widget.registrado), style: const TextStyle(fontWeight: FontWeight.w600)),
              const SizedBox(height: 8),
              const Text('Realmente instalado', style: TextStyle(fontSize: 11, color: AppColors.textSecondary)),
              Text(queVaAHaber, style: const TextStyle(fontWeight: FontWeight.w600, color: AppColors.success)),
              const SizedBox(height: 12),
              const Text(
                'Esta acción corregirá el neumático asociado a esta posición. '
                'No se registrará ningún trabajo de montaje o desmontaje y no generará coste.',
                style: TextStyle(fontSize: 12, color: AppColors.textSecondary)),
            ]),
            actions: [
              TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Cancelar')),
              FilledButton(onPressed: () => Navigator.pop(context, true), child: const Text('Confirmar corrección')),
            ],
          ),
        ) ??
        false;
  }

  String _describe(Neumatico n) {
    final id = n.numeroInterno ?? n.codigoInterno ?? n.numeroSerie ?? '—';
    final mm = '${n.marca ?? ''} ${n.modelo ?? ''}'.trim();
    return [id, if (mm.isNotEmpty) mm, n.medidaCompleta].where((s) => s.trim().isNotEmpty).join(' · ');
  }

  Future<void> _corregirCon(Neumatico elegido) async {
    if (!await _confirmar(_describe(elegido))) return;
    await _guardar(() => SupabaseService.corregirMontado(
          montajeId: widget.montajeId,
          neumaticoCorrectoId: elegido.id,
          revisionId: widget.revisionId,
          metodo: 'busqueda',
          observaciones: 'No coincide con el registrado',
        ));
  }

  Future<void> _corregirConFichaNueva() async {
    final marca = _marca.text.trim();
    final medida = _medida.text.trim();
    if (marca.isEmpty || medida.isEmpty) {
      setState(() => _error = 'Hacen falta al menos la marca y la medida');
      return;
    }
    final txt = [marca, _modelo.text.trim(), medida].where((s) => s.isNotEmpty).join(' ');
    if (!await _confirmar('$txt (ficha nueva)')) return;
    await _guardar(() async {
      // Si trae carga, se deja además la referencia en el catálogo para que un
      // administrador la valide. Que falle esto no puede impedir la
      // corrección: el dato del vehículo importa más que el del catálogo.
      if (_carga.text.trim().isNotEmpty && _modelo.text.trim().isNotEmpty) {
        try {
          await SupabaseService.crearReferenciaProvisional(
            empresaId: widget.empresaId, marca: marca, modelo: _modelo.text.trim(),
            medida: medida, cargaSimple: _carga.text.trim(), velocidad: _velocidad.text.trim());
        } catch (_) {/* el catálogo se completa luego; la corrección no espera */}
      }
      await SupabaseService.corregirMontadoNuevaFicha(
        montajeId: widget.montajeId, marca: marca, modelo: _modelo.text.trim(),
        medida: medida, dot: _dot.text.trim(), revisionId: widget.revisionId,
        metodo: _fotoUrl != null ? 'foto_ia' : 'manual', fotoUrl: _fotoUrl,
        observaciones: 'No coincide con el registrado');
    });
  }

  Future<void> _guardar(Future<void> Function() accion) async {
    setState(() { _trabajando = true; _error = null; });
    try {
      await accion();
      if (mounted) Navigator.of(context).pop(true);
    } catch (e) {
      final t = e.toString();
      if (mounted) {
        setState(() => _error = t.contains('Sin permiso')
            ? 'No tienes permiso para corregir en esta empresa'
            : 'No se ha podido corregir: $t');
      }
    } finally {
      if (mounted) setState(() => _trabajando = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('No coincide')),
      body: AbsorbPointer(
        absorbing: _trabajando,
        child: ListView(padding: const EdgeInsets.all(16), children: [
          Card(
            child: Padding(
              padding: const EdgeInsets.all(14),
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text('Posición ${widget.posicionNombre}',
                    style: const TextStyle(color: AppColors.textSecondary, fontSize: 12)),
                const SizedBox(height: 6),
                const Text('Neumático registrado', style: TextStyle(fontSize: 11, color: AppColors.textSecondary)),
                Text(_describe(widget.registrado), style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 15)),
                if (widget.registrado.dot != null)
                  Text('DOT ${widget.registrado.dot}',
                      style: const TextStyle(color: AppColors.textSecondary, fontSize: 12)),
                const SizedBox(height: 10),
                const Text('El neumático registrado no coincide con el que está instalado físicamente.',
                    style: TextStyle(color: AppColors.warning, fontSize: 13)),
              ]),
            ),
          ),
          if (_error != null)
            Padding(padding: const EdgeInsets.only(top: 10),
              child: Text(_error!, style: const TextStyle(color: AppColors.danger))),
          if (_trabajando) const Padding(padding: EdgeInsets.all(16), child: LinearProgressIndicator()),

          const SizedBox(height: 16),
          const Text('¿Cuál está puesto de verdad?', style: TextStyle(fontWeight: FontWeight.w700)),
          const SizedBox(height: 8),

          // Camino A
          TextField(
            controller: _busqueda,
            decoration: InputDecoration(
              labelText: 'Buscar por nº, serie, RFID o DOT',
              suffixIcon: IconButton(icon: const Icon(Icons.search), onPressed: _buscar),
            ),
            onSubmitted: (_) => _buscar(),
          ),
          for (final n in _candidatos)
            ListTile(
              dense: true,
              leading: const Icon(Icons.trip_origin, color: AppColors.textSecondary),
              title: Text(_describe(n)),
              subtitle: Text('Ahora: ${n.estado}',
                  style: const TextStyle(fontSize: 11, color: AppColors.textSecondary)),
              trailing: const Icon(Icons.chevron_right),
              onTap: () => _corregirCon(n),
            ),

          const SizedBox(height: 20),
          if (_hayIA)
            OutlinedButton.icon(
              onPressed: _identificarConFoto,
              icon: const Icon(Icons.photo_camera_outlined),
              label: const Text('Identificar con foto'),
            )
          else
            const Text(
              'La identificación por foto no está disponible ahora mismo. '
              'Puedes buscarlo o escribirlo a mano.',
              style: TextStyle(fontSize: 12, color: AppColors.textSecondary)),

          if (_avisoIA != null)
            Padding(padding: const EdgeInsets.only(top: 8),
              child: Text(_avisoIA!, style: const TextStyle(color: AppColors.warning, fontSize: 12))),

          if (_leido || _candidatos.isEmpty) ...[
            const SizedBox(height: 16),
            const Text('O escríbelo', style: TextStyle(fontWeight: FontWeight.w700)),
            if (_dudosos.isNotEmpty)
              Padding(padding: const EdgeInsets.only(top: 4),
                child: Text('Sin leer con seguridad: ${_dudosos.join(', ')}. Complétalo tú.',
                    style: const TextStyle(color: AppColors.warning, fontSize: 12))),
            const SizedBox(height: 8),
            TextField(controller: _marca, decoration: const InputDecoration(labelText: 'Marca *')),
            TextField(controller: _modelo, decoration: const InputDecoration(labelText: 'Modelo')),
            TextField(controller: _medida, decoration: const InputDecoration(labelText: 'Medida *')),
            Row(children: [
              Expanded(child: TextField(controller: _carga, decoration: const InputDecoration(labelText: 'Índice de carga'))),
              const SizedBox(width: 10),
              Expanded(child: TextField(controller: _velocidad, decoration: const InputDecoration(labelText: 'Velocidad'))),
            ]),
            TextField(controller: _dot, decoration: const InputDecoration(labelText: 'DOT')),
            const SizedBox(height: 14),
            FilledButton(onPressed: _corregirConFichaNueva, child: const Text('Corregir con estos datos')),
            const SizedBox(height: 6),
            const Text(
              'Si el modelo no está en el catálogo se dará de alta como provisional, '
              'para que un administrador lo revise.',
              style: TextStyle(fontSize: 11, color: AppColors.textSecondary)),
          ],
          const SizedBox(height: 24),
        ]),
      ),
    );
  }
}
