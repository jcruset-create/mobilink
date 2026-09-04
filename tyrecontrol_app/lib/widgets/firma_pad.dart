import 'dart:ui' as ui;
import 'package:flutter/material.dart';
import 'package:flutter/foundation.dart';
import '../theme/app_theme.dart';

/// Un recuadro para firmar con el dedo.
///
/// Escrito a mano y no con un paquete: son ochenta líneas, y meter una
/// dependencia nueva en las siete APK para dibujar una polilínea no sale a
/// cuenta.
///
/// La firma se entrega como PNG con FONDO TRANSPARENTE, para que al estamparla
/// en el parte no tape el recuadro impreso ni el texto de debajo.
class FirmaPad extends StatefulWidget {
  final String titulo;
  /// Se llama al soltar el dedo, con el PNG. null = se ha borrado.
  final ValueChanged<Uint8List?> onFirma;
  final double alto;

  const FirmaPad({super.key, required this.titulo, required this.onFirma, this.alto = 160});

  @override
  State<FirmaPad> createState() => _FirmaPadState();
}

class _FirmaPadState extends State<FirmaPad> {
  /// Trazos: cada uno es una lista de puntos. Separarlos importa —si se
  /// guardaran todos seguidos, levantar el dedo dibujaría una raya de vuelta.
  final List<List<Offset>> _trazos = [];
  Size _tam = Size.zero;

  Future<void> _entregar() async {
    if (_trazos.isEmpty) { widget.onFirma(null); return; }
    final rec = ui.PictureRecorder();
    final canvas = Canvas(rec);
    _PintorFirma(_trazos).paint(canvas, _tam);
    final img = await rec.endRecording().toImage(_tam.width.toInt(), _tam.height.toInt());
    final bytes = await img.toByteData(format: ui.ImageByteFormat.png);
    widget.onFirma(bytes?.buffer.asUint8List());
  }

  @override
  Widget build(BuildContext context) {
    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
        Text(widget.titulo, style: const TextStyle(fontWeight: FontWeight.w700)),
        if (_trazos.isNotEmpty)
          TextButton.icon(
            onPressed: () { setState(_trazos.clear); widget.onFirma(null); },
            icon: const Icon(Icons.refresh, size: 16),
            label: const Text('Repetir'),
          ),
      ]),
      const SizedBox(height: 4),
      LayoutBuilder(builder: (_, c) {
        _tam = Size(c.maxWidth, widget.alto);
        return Container(
          height: widget.alto,
          decoration: BoxDecoration(
            color: Colors.white,
            border: Border.all(color: AppColors.cardBorder),
            borderRadius: BorderRadius.circular(10),
          ),
          child: GestureDetector(
            // opaque: sin esto, el gesto no llega donde el fondo es transparente.
            behavior: HitTestBehavior.opaque,
            onPanStart: (d) => setState(() => _trazos.add([d.localPosition])),
            onPanUpdate: (d) => setState(() {
              if (_trazos.isEmpty) _trazos.add([]);
              _trazos.last.add(d.localPosition);
            }),
            onPanEnd: (_) => _entregar(),
            child: CustomPaint(painter: _PintorFirma(_trazos), size: Size.infinite),
          ),
        );
      }),
      const SizedBox(height: 2),
      const Text('Firma aquí con el dedo', style: TextStyle(fontSize: 11, color: AppColors.textSecondary)),
    ]);
  }
}

class _PintorFirma extends CustomPainter {
  final List<List<Offset>> trazos;
  const _PintorFirma(this.trazos);

  @override
  void paint(Canvas canvas, Size size) {
    final p = Paint()
      ..color = Colors.black
      ..strokeWidth = 2.5
      ..strokeCap = StrokeCap.round
      ..strokeJoin = StrokeJoin.round
      ..style = PaintingStyle.stroke;
    for (final trazo in trazos) {
      if (trazo.length < 2) {
        // Un toque suelto también es tinta: un punto sobre una i.
        if (trazo.length == 1) canvas.drawPoints(ui.PointMode.points, trazo, p);
        continue;
      }
      final path = Path()..moveTo(trazo.first.dx, trazo.first.dy);
      for (final o in trazo.skip(1)) {
        path.lineTo(o.dx, o.dy);
      }
      canvas.drawPath(path, p);
    }
  }

  @override
  bool shouldRepaint(_PintorFirma viejo) => true;
}
