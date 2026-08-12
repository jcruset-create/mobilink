import 'dart:io';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import '../services/offline_store.dart';
import '../theme.dart';

/// Lienzo de firma del cliente.
///
/// Se dibuja a mano en vez de traer un paquete: son cuarenta líneas, y en una
/// app que ya se instala a mano en tablets prefiero no añadir una dependencia
/// más que mantener y auditar.
///
/// El resultado se guarda como PNG en el directorio temporal y se sube por la
/// misma vía que las fotos, con `tipo=firma`, de modo que hereda la cola
/// offline y la idempotencia sin código nuevo.
class FirmaCliente extends StatefulWidget {
  const FirmaCliente({super.key});

  /// Abre el lienzo a pantalla completa y devuelve la ruta del PNG, o null si
  /// se cancela o no se ha dibujado nada.
  static Future<String?> pedir(BuildContext context) {
    return Navigator.of(context).push<String>(
      MaterialPageRoute(builder: (_) => const FirmaCliente(), fullscreenDialog: true),
    );
  }

  @override
  State<FirmaCliente> createState() => _FirmaClienteState();
}

class _FirmaClienteState extends State<FirmaCliente> {
  /// Trazos: cada uno es una lista de puntos seguidos. Se guardan por separado
  /// para no unir con una raya el final de un trazo y el principio del
  /// siguiente cuando se levanta el dedo.
  final List<List<Offset>> _trazos = [];
  final GlobalKey _lienzo = GlobalKey();
  bool _guardando = false;

  bool get _vacia => _trazos.every((t) => t.length < 2);

  Future<void> _guardar() async {
    if (_vacia || _guardando) return;
    setState(() => _guardando = true);

    try {
      final caja = _lienzo.currentContext!.findRenderObject() as RenderBox;
      final tamano = caja.size;

      final recorder = ui.PictureRecorder();
      final canvas = Canvas(recorder);

      // Fondo blanco: la firma se mira en el panel y en informes, donde el
      // fondo oscuro de la app no pinta nada.
      canvas.drawRect(
        Rect.fromLTWH(0, 0, tamano.width, tamano.height),
        Paint()..color = Colors.white,
      );
      _PintorFirma(_trazos, Colors.black).paint(canvas, tamano);

      final imagen = await recorder
          .endRecording()
          .toImage(tamano.width.round(), tamano.height.round());
      final datos = await imagen.toByteData(format: ui.ImageByteFormat.png);
      if (datos == null) throw Exception('No se ha podido generar la firma');

      final fichero = File(
        '${Directory.systemTemp.path}/${OfflineStore.nuevaClave('firma')}.png',
      );
      await fichero.writeAsBytes(datos.buffer.asUint8List(), flush: true);

      if (!mounted) return;
      Navigator.of(context).pop(fichero.path);
    } catch (e) {
      if (!mounted) return;
      setState(() => _guardando = false);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(e.toString().replaceFirst('Exception: ', ''))),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Firma del cliente'),
        actions: [
          TextButton(
            onPressed: _trazos.isEmpty ? null : () => setState(_trazos.clear),
            child: const Text('Borrar', style: TextStyle(fontSize: 16)),
          ),
        ],
      ),
      body: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          children: [
            const Text(
              'Firme dentro del recuadro',
              style: TextStyle(color: AppColors.textMuted, fontSize: 16),
            ),
            const SizedBox(height: 12),
            Expanded(
              child: Container(
                key: _lienzo,
                decoration: BoxDecoration(
                  color: Colors.white,
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(color: AppColors.border),
                ),
                child: GestureDetector(
                  onPanStart: (d) => setState(() => _trazos.add([d.localPosition])),
                  onPanUpdate: (d) => setState(() {
                    if (_trazos.isEmpty) _trazos.add([]);
                    _trazos.last.add(d.localPosition);
                  }),
                  child: CustomPaint(
                    painter: _PintorFirma(_trazos, Colors.black),
                    size: Size.infinite,
                  ),
                ),
              ),
            ),
            const SizedBox(height: 16),
            Row(
              children: [
                Expanded(
                  child: OutlinedButton(
                    onPressed: () => Navigator.of(context).pop(),
                    style: OutlinedButton.styleFrom(
                      minimumSize: const Size(0, 56),
                      foregroundColor: AppColors.textMuted,
                    ),
                    child: const Text('Cancelar', style: TextStyle(fontSize: 17)),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  flex: 2,
                  child: ElevatedButton(
                    onPressed: _vacia || _guardando ? null : _guardar,
                    child: Text(_guardando ? 'Guardando…' : 'Guardar firma'),
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class _PintorFirma extends CustomPainter {
  final List<List<Offset>> trazos;
  final Color color;

  _PintorFirma(this.trazos, this.color);

  @override
  void paint(Canvas canvas, Size size) {
    final lapiz = Paint()
      ..color = color
      ..strokeWidth = 3
      ..strokeCap = StrokeCap.round
      ..strokeJoin = StrokeJoin.round
      ..style = PaintingStyle.stroke;

    for (final trazo in trazos) {
      if (trazo.length < 2) continue;
      final camino = Path()..moveTo(trazo.first.dx, trazo.first.dy);
      for (final punto in trazo.skip(1)) {
        camino.lineTo(punto.dx, punto.dy);
      }
      canvas.drawPath(camino, lapiz);
    }
  }

  @override
  bool shouldRepaint(covariant _PintorFirma anterior) => true;
}
