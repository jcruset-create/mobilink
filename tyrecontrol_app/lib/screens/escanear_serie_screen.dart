import 'package:flutter/material.dart';
import 'package:mobile_scanner/mobile_scanner.dart';

import '../models/serie_qr.dart';

/// Escanear el QR de la etiqueta de un neumático.
///
/// Devuelve el número de serie leído, o null si se sale sin escanear nada.
///
/// ── Lo que NO hace ──────────────────────────────────────────────────────────
///
/// No da nada por bueno solo, y no puede: el QR de la etiqueta lleva el número
/// en crudo, así que no hay forma de distinguirlo del QR de un palé. Lo que se
/// lee vuelve a la pantalla anterior y se escribe EN EL CAMPO, a la vista, para
/// que el técnico lo compare con lo que tiene delante antes de guardar.
///
/// Lo que sí se hace aquí es descartar lo que evidentemente no es un número de
/// serie —una URL, un texto, algo demasiado corto— y decir por qué, en vez de
/// un «QR no reconocido» que no ayuda a nadie.
class EscanearSerieScreen extends StatefulWidget {
  const EscanearSerieScreen({super.key});

  @override
  State<EscanearSerieScreen> createState() => _EscanearSerieScreenState();
}

class _EscanearSerieScreenState extends State<EscanearSerieScreen> {
  final _controlador = MobileScannerController(
    // Sin duplicados: si no, el mismo QR se dispara treinta veces por segundo.
    detectionSpeed: DetectionSpeed.noDuplicates,
    formats: const [BarcodeFormat.qrCode],
  );
  bool _resuelto = false;
  String _aviso = '';

  void _alDetectar(BarcodeCapture captura) {
    if (_resuelto) return;
    for (final codigo in captura.barcodes) {
      final leido = SerieQr.leer(codigo.rawValue);
      if (leido.valida) {
        _resuelto = true;
        Navigator.of(context).pop(leido.serie);
        return;
      }
      // Se enseña el motivo y se sigue mirando: el técnico mueve la cámara y
      // vuelve a intentarlo sin tener que salir y entrar.
      if (mounted && leido.aviso != null) setState(() => _aviso = leido.aviso!);
    }
  }

  @override
  void dispose() {
    _controlador.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Escanear etiqueta'),
        actions: [
          IconButton(
            icon: const Icon(Icons.flash_on),
            tooltip: 'Linterna',
            onPressed: () => _controlador.toggleTorch(),
          ),
        ],
      ),
      body: Stack(
        children: [
          MobileScanner(
            controller: _controlador,
            onDetect: _alDetectar,
            // Si la cámara no arranca —permiso denegado, otra app usándola—,
            // se dice, en vez de dejar un rectángulo negro.
            errorBuilder: (_, error, __) => Center(
              child: Padding(
                padding: const EdgeInsets.all(24),
                child: Text(
                  'No se ha podido abrir la cámara.\n\n${error.errorDetails?.message ?? error.errorCode.name}'
                  '\n\nEscribe el número a mano.',
                  textAlign: TextAlign.center,
                ),
              ),
            ),
          ),
          Positioned(
            left: 0, right: 0, bottom: 0,
            child: Container(
              color: Colors.black.withValues(alpha: 0.65),
              padding: const EdgeInsets.fromLTRB(16, 12, 16, 24),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(
                    _aviso.isEmpty
                        ? 'Apunta al QR de la etiqueta de la goma.'
                        : _aviso,
                    textAlign: TextAlign.center,
                    style: TextStyle(
                      color: _aviso.isEmpty ? Colors.white : Colors.amber,
                      fontSize: 15,
                    ),
                  ),
                  const SizedBox(height: 4),
                  const Text(
                    'Después compruébalo con el número de la rueda: el QR lleva '
                    'solo el número y no se distingue de cualquier otro.',
                    textAlign: TextAlign.center,
                    style: TextStyle(color: Colors.white70, fontSize: 12),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// Abre el escáner y devuelve el número, o null si no se ha leído nada.
Future<String?> escanearSerie(BuildContext context) =>
    Navigator.of(context).push<String>(
      MaterialPageRoute(builder: (_) => const EscanearSerieScreen()),
    );
