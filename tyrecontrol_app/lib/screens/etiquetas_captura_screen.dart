import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';

import '../services/fotos.dart';
import '../services/supabase_service.dart';

/// Fotografiar gomas nuevas, una detrás de otra.
///
/// ── Por qué hay una cola ────────────────────────────────────────────────────
///
/// Un palé son cuarenta gomas. Si después de cada foto hubiera que esperar a
/// que suba y a que la IA la lea, el operario pasaría la mitad del rato
/// mirando una ruedecita, y al final haría lo de siempre: apuntar los números
/// en un papel. Así que la foto entra en una cola, se ve al momento en la
/// lista y él sigue disparando; subir y leer va por detrás, de una en una para
/// no ahogar la conexión del patio.
///
/// Una foto NUNCA se pierde por un fallo de red: si no se puede leer, se
/// guarda igual y queda «por revisar» para que en el panel se escriba el
/// número a mano. Perder la foto sería perder el trabajo hecho.
///
/// ── Aquí NO se lee ningún número ────────────────────────────────────────────
///
/// La tablet solo hace fotos. Leer el número de serie y proponer la etiqueta
/// es cosa del panel, que analiza solo las fotos que llegan. Es lo que le
/// conviene a cada uno: el operario está de pie delante de un palé y necesita
/// disparar y pasar a la siguiente, no esperar a un modelo de visión con la
/// cobertura del patio; y la persona que revisa está sentada delante de una
/// pantalla grande, donde la foto se ve y el número se comprueba.
class EtiquetasCapturaScreen extends StatefulWidget {
  const EtiquetasCapturaScreen({super.key, required this.loteId, required this.codigo});
  final String loteId;
  final String codigo;

  @override
  State<EtiquetasCapturaScreen> createState() => _EtiquetasCapturaScreenState();
}

/// Una foto en la cola.
class _EnCola {
  _EnCola(this.file);
  final XFile file;
  String estado = 'esperando'; // esperando · subiendo · hecha · error
  String? error;
}

class _EtiquetasCapturaScreenState extends State<EtiquetasCapturaScreen> {
  final List<_EnCola> _cola = [];
  bool _trabajando = false;
  bool _cerrando = false;

  int get _hechas => _cola.where((e) => e.estado == 'hecha').length;
  int get _pendientes => _cola.where((e) => e.estado != 'hecha' && e.estado != 'error').length;
  int get _fallidas => _cola.where((e) => e.estado == 'error').length;

  Future<void> _fotografiar() async {
    final f = await elegirFoto(context);
    if (f == null) return;
    setState(() => _cola.add(_EnCola(f)));
    _bombear();
  }

  /// Procesa la cola de una en una. Se llama cada vez que entra una foto y no
  /// hace nada si ya está en marcha.
  Future<void> _bombear() async {
    if (_trabajando) return;
    _trabajando = true;
    try {
      while (true) {
        // Cada vuelta vuelve a mirar la cola: mientras se sube una foto el
        // operario está haciendo la siguiente, y la lista ha crecido.
        final esperando = _cola.where((e) => e.estado == 'esperando').toList();
        if (esperando.isEmpty) break;
        // `_procesar` siempre deja la foto en «hecha» o en «error», nunca en
        // «esperando», así que esto termina.
        await _procesar(esperando.first);
      }
    } finally {
      _trabajando = false;
    }
  }

  Future<void> _procesar(_EnCola e) async {
    void mostrar(void Function() cambio) {
      cambio();
      if (mounted) setState(() {});
    }

    try {
      mostrar(() => e.estado = 'subiendo');
      final url = await TyreControlApi.subirFotoEtiqueta(e.file, loteId: widget.loteId);

      // Queda «pendiente»: subida y sin leer. El panel la analiza al abrir el
      // lote. Si se marcara de otra forma, el panel no sabría que le falta.
      await TyreControlApi.guardarFotoEtiqueta(loteId: widget.loteId, fotoUrl: url);

      mostrar(() => e.estado = 'hecha');
    } catch (err) {
      // La foto no ha llegado a guardarse: se deja en la lista con su error y
      // un botón para reintentar. No se borra, porque la rueda ya está
      // fotografiada y volver a buscarla en el palé es peor.
      mostrar(() { e.estado = 'error'; e.error = '$err'; });
    }
  }

  void _reintentar(_EnCola e) {
    setState(() { e.estado = 'esperando'; e.error = null; });
    _bombear();
  }

  Future<void> _cerrarLote() async {
    if (_pendientes > 0) {
      final seguir = await showDialog<bool>(
        context: context,
        builder: (ctx) => AlertDialog(
          title: const Text('Quedan fotos subiendo'),
          content: Text('Hay $_pendientes ${_pendientes == 1 ? 'foto' : 'fotos'} sin '
              'terminar de subir. Espera a que acaben para no perderlas.'),
          actions: [
            TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Esperar')),
          ],
        ),
      );
      if (seguir != true) return;
    }
    setState(() => _cerrando = true);
    try {
      await TyreControlApi.cerrarLoteEtiquetas(widget.loteId);
      if (mounted) Navigator.of(context).pop();
    } catch (e) {
      if (mounted) {
        setState(() => _cerrando = false);
        ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(content: Text('No se ha podido cerrar el lote: $e')));
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text(widget.codigo),
        actions: [
          TextButton(
            onPressed: _cerrando ? null : _cerrarLote,
            child: Text(_cerrando ? 'Cerrando…' : 'Cerrar lote'),
          ),
        ],
      ),
      body: SafeArea(
        child: Column(
          children: [
            // El recuento, arriba y grande: es lo que el operario mira para
            // saber si le falta alguna rueda del palé.
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 12, 16, 4),
              child: Row(
                children: [
                  Text('$_hechas ${_hechas == 1 ? 'goma' : 'gomas'}',
                      style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w800)),
                  const SizedBox(width: 12),
                  if (_pendientes > 0)
                    Text('· $_pendientes subiendo',
                        style: const TextStyle(fontSize: 15, color: Colors.black54)),
                  if (_fallidas > 0)
                    Text('  · $_fallidas con error',
                        style: const TextStyle(fontSize: 15, color: Colors.redAccent)),
                ],
              ),
            ),
            const Padding(
              padding: EdgeInsets.fromLTRB(16, 0, 16, 8),
              child: Text(
                'Los números se leen y se imprimen desde el panel. '
                'Esto no da de alta los neumáticos.',
                style: TextStyle(fontSize: 13, color: Colors.black54),
              ),
            ),
            Expanded(
              child: _cola.isEmpty
                  ? const Center(
                      child: Padding(
                        padding: EdgeInsets.all(32),
                        child: Text(
                          'Fotografía el flanco de la primera goma.\n\n'
                          'Que el número de serie salga entero y enfocado; '
                          'del resto del flanco no hace falta nada.',
                          textAlign: TextAlign.center,
                        ),
                      ),
                    )
                  : ListView.separated(
                      padding: const EdgeInsets.fromLTRB(12, 0, 12, 12),
                      // Del revés: la última foto arriba, que es la que se
                      // acaba de hacer y la que se quiere comprobar.
                      itemCount: _cola.length,
                      separatorBuilder: (_, __) => const Divider(height: 1),
                      itemBuilder: (_, i) {
                        final e = _cola[_cola.length - 1 - i];
                        return _FilaFoto(
                          numero: _cola.length - i,
                          item: e,
                          onReintentar: () => _reintentar(e),
                        );
                      },
                    ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 4, 16, 16),
              child: SizedBox(
                height: 64,
                child: FilledButton.icon(
                  onPressed: _fotografiar,
                  icon: const Icon(Icons.photo_camera_outlined, size: 28),
                  label: const Text('Fotografiar goma', style: TextStyle(fontSize: 19)),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _FilaFoto extends StatelessWidget {
  const _FilaFoto({required this.numero, required this.item, required this.onReintentar});
  final int numero;
  final _EnCola item;
  final VoidCallback onReintentar;

  @override
  Widget build(BuildContext context) {
    late final Widget icono;
    String texto;
    Color? color;

    switch (item.estado) {
      case 'esperando':
      case 'subiendo':
        icono = const SizedBox(
            width: 22, height: 22, child: CircularProgressIndicator(strokeWidth: 2.5));
        texto = 'Subiendo la foto…';
        break;
      case 'error':
        icono = const Icon(Icons.error_outline, color: Colors.redAccent);
        texto = item.error ?? 'No se ha podido guardar';
        color = Colors.redAccent;
        break;
      default:
        icono = const Icon(Icons.check_circle_outline, color: Colors.green);
        texto = 'Foto guardada';
    }

    return ListTile(
      dense: true,
      leading: SizedBox(width: 26, child: Center(child: icono)),
      title: Text('$numero. $texto',
          style: TextStyle(color: color, fontWeight: FontWeight.w600)),
      trailing: item.estado == 'error'
          ? TextButton(onPressed: onReintentar, child: const Text('Reintentar'))
          : null,
    );
  }
}
