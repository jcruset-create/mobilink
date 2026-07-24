import 'package:flutter/material.dart';
import 'package:mobile_scanner/mobile_scanner.dart';
import '../theme.dart';

class ScanResult {
  final String id;
  final bool isMachine;
  const ScanResult(this.id, {this.isMachine = false});
}

/// Escanea un QR de herramienta o máquina. Acepta:
/// - un UUID crudo (se asume herramienta)
/// - la URL del panel web: .../qr/herramienta/<uuid> o .../qr/maquina/<uuid>
class ScanScreen extends StatefulWidget {
  const ScanScreen({super.key});

  @override
  State<ScanScreen> createState() => _ScanScreenState();
}

class _ScanScreenState extends State<ScanScreen> {
  final _controller = MobileScannerController(
    detectionSpeed: DetectionSpeed.noDuplicates,
  );
  bool _handled = false;

  static final _uuidRe = RegExp(
      r'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$');
  static final _urlRe = RegExp(
      r'/qr/(herramienta|maquina)/([0-9a-fA-F-]{36})');

  ScanResult? _parse(String raw) {
    final value = raw.trim();
    final urlMatch = _urlRe.firstMatch(value);
    if (urlMatch != null) {
      return ScanResult(urlMatch.group(2)!.toLowerCase(),
          isMachine: urlMatch.group(1) == 'maquina');
    }
    if (_uuidRe.hasMatch(value)) {
      return ScanResult(value.toLowerCase());
    }
    return null;
  }

  void _onDetect(BarcodeCapture capture) {
    if (_handled) return;
    for (final barcode in capture.barcodes) {
      final raw = barcode.rawValue;
      if (raw == null) continue;
      final result = _parse(raw);
      if (result != null) {
        _handled = true;
        Navigator.of(context).pop(result);
        return;
      }
    }
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text('QR no reconocido')),
    );
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Escanear QR'),
        actions: [
          IconButton(
            icon: const Icon(Icons.flash_on),
            tooltip: 'Linterna',
            onPressed: () => _controller.toggleTorch(),
          ),
        ],
      ),
      body: Stack(
        children: [
          MobileScanner(controller: _controller, onDetect: _onDetect),
          Center(
            child: Container(
              width: 250,
              height: 250,
              decoration: BoxDecoration(
                border: Border.all(color: AppColors.primary, width: 3),
                borderRadius: BorderRadius.circular(16),
              ),
            ),
          ),
          const Positioned(
            bottom: 40,
            left: 0,
            right: 0,
            child: Text(
              'Apunta al QR de la herramienta o máquina',
              textAlign: TextAlign.center,
              style: TextStyle(color: Colors.white, fontSize: 16),
            ),
          ),
        ],
      ),
    );
  }
}
