import 'package:flutter/material.dart';
import 'package:flutter_blue_plus/flutter_blue_plus.dart';
import '../services/tlgx_probe_service.dart';
import '../theme/app_theme.dart';

/// Prueba de conexión con la sonda Transense TLGX3 por Bluetooth.
/// Lecturas en vivo de profundidad, presión y RFID.
class SondaScreen extends StatefulWidget {
  const SondaScreen({super.key});
  @override
  State<SondaScreen> createState() => _SondaScreenState();
}

class _SondaScreenState extends State<SondaScreen> {
  late final TlgxProbeService _probe;
  bool _conectada = false;
  bool _ocupado = false;
  String _error = '';

  String _modelo = '';
  String _version = '';
  String _bateria = '';
  double? _profundidad;
  double? _presion;
  String _rfid = '';
  final List<String> _log = [];

  @override
  void initState() {
    super.initState();
    _probe = TlgxProbeService(onLine: _onLine, onState: _onState);
  }

  @override
  void dispose() {
    _probe.desconectar();
    super.dispose();
  }

  void _addLog(String txt) {
    final t = TimeOfDay.now();
    setState(() {
      _log.insert(0, '${t.format(context)} · $txt');
      if (_log.length > 100) _log.removeLast();
    });
  }

  void _onLine(String line) {
    _addLog('◀ $line');
    final r = parsearLinea(line);
    setState(() {
      switch (r.tipo) {
        case LecturaTipo.profundidad: _profundidad = r.valor; break;
        case LecturaTipo.presion: _presion = r.valor; break;
        case LecturaTipo.rfid: _rfid = r.texto ?? ''; break;
        case LecturaTipo.info:
          if (r.clave == 'modelo') _modelo = r.texto ?? '';
          if (r.clave == 'version') _version = r.texto ?? '';
          if (r.clave == 'bateria') _bateria = r.texto ?? '';
          break;
        default: break;
      }
    });
  }

  void _onState(bool estado) {
    if (!mounted) return;
    setState(() => _conectada = estado);
    if (!estado) _addLog('Sonda desconectada');
  }

  Future<void> _conectar() async {
    setState(() { _error = ''; _ocupado = true; });
    try {
      if (!await _probe.pedirPermisos()) {
        throw Exception('Faltan permisos de Bluetooth o ubicación.');
      }
      final resultados = await _probe.escanear();
      if (!mounted) return;
      if (resultados.isEmpty) {
        throw Exception('No se ha encontrado ninguna sonda. Enciéndela y acércala.');
      }
      final elegido = resultados.length == 1
          ? resultados.first.device
          : await _elegirDispositivo(resultados);
      if (elegido == null) { setState(() => _ocupado = false); return; }

      await _probe.conectar(elegido);
      _addLog('Conectada: ${_probe.nombre}');
      // Configura unidades y pide info
      await _probe.enviar('UTM'); // profundidad mm
      await _probe.enviar('UPP'); // presión psi
      await _probe.enviar('MODSTR');
      await _probe.enviar('V');
      await _probe.enviar('BV');
    } catch (e) {
      setState(() => _error = e.toString().replaceFirst('Exception: ', ''));
    } finally {
      if (mounted) setState(() => _ocupado = false);
    }
  }

  Future<BluetoothDevice?> _elegirDispositivo(List<ScanResult> resultados) {
    return showModalBottomSheet<BluetoothDevice>(
      context: context,
      backgroundColor: AppColors.surface,
      builder: (ctx) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Padding(
              padding: EdgeInsets.all(16),
              child: Text('Elige la sonda', style: TextStyle(color: AppColors.textPrimary, fontSize: 17, fontWeight: FontWeight.w600)),
            ),
            ...resultados.map((r) => ListTile(
                  leading: const Icon(Icons.bluetooth, color: AppColors.primary),
                  title: Text(r.device.platformName, style: const TextStyle(color: AppColors.textPrimary)),
                  subtitle: Text('${r.device.remoteId.str}  ·  ${r.rssi} dBm', style: const TextStyle(color: AppColors.textSecondary)),
                  onTap: () => Navigator.pop(ctx, r.device),
                )),
          ],
        ),
      ),
    );
  }

  Future<void> _enviar(String cmd) async {
    try {
      await _probe.enviar(cmd);
      _addLog('▶ $cmd');
    } catch (e) {
      setState(() => _error = e.toString().replaceFirst('Exception: ', ''));
    }
  }

  Future<void> _desconectar() async {
    await _probe.desconectar();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Sonda TLGX')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          if (_error.isNotEmpty)
            Container(
              margin: const EdgeInsets.only(bottom: 12),
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: AppColors.danger.withValues(alpha: 0.12),
                borderRadius: BorderRadius.circular(12),
                border: Border.all(color: AppColors.danger.withValues(alpha: 0.4)),
              ),
              child: Text(_error, style: const TextStyle(color: AppColors.danger)),
            ),

          if (_conectada)
            Padding(
              padding: const EdgeInsets.only(bottom: 12),
              child: Wrap(spacing: 12, runSpacing: 4, children: [
                _chip('● ${_probe.nombre}', AppColors.success),
                if (_modelo.isNotEmpty) _info('Modelo', _modelo),
                if (_version.isNotEmpty) _info('FW', _version),
                if (_bateria.isNotEmpty) _info('Batería', '$_bateria V'),
              ]),
            ),

          // Lecturas
          Row(children: [
            Expanded(child: _lecturaCard('Profundidad', _profundidad != null ? '${_profundidad!.toStringAsFixed(2)} mm' : '—', AppColors.info, Icons.straighten, () => _enviar('T'))),
            const SizedBox(width: 8),
            Expanded(child: _lecturaCard('Presión', _presion != null ? '${_presion!.toStringAsFixed(2)} psi' : '—', AppColors.success, Icons.speed, () => _enviar('P'))),
          ]),
          const SizedBox(height: 8),
          _lecturaCard('RFID (EPC)', _rfid.isEmpty ? '—' : _rfid, const Color(0xFFA78BFA), Icons.nfc, () => _enviar('GR'), mono: true),

          const SizedBox(height: 16),
          if (_conectada)
            OutlinedButton.icon(onPressed: _desconectar, icon: const Icon(Icons.bluetooth_disabled), label: const Text('Desconectar'))
          else
            ElevatedButton.icon(
              onPressed: _ocupado ? null : _conectar,
              icon: const Icon(Icons.bluetooth_searching),
              label: Text(_ocupado ? 'Buscando…' : 'Conectar sonda'),
            ),

          const SizedBox(height: 8),
          const Text(
            'Apoya la sonda en el neumático: la profundidad y la presión se envían solas al detectar la medida. También puedes forzarlas con los botones.',
            style: TextStyle(color: AppColors.textSecondary, fontSize: 13),
          ),

          const SizedBox(height: 16),
          // Consola
          Container(
            decoration: BoxDecoration(
              color: AppColors.surfaceVariant,
              borderRadius: BorderRadius.circular(12),
              border: Border.all(color: AppColors.cardBorder),
            ),
            child: Column(children: [
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                child: Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
                  const Text('Consola', style: TextStyle(color: AppColors.textSecondary, fontSize: 12, fontWeight: FontWeight.w600)),
                  GestureDetector(onTap: () => setState(_log.clear), child: const Text('limpiar', style: TextStyle(color: AppColors.textHint, fontSize: 12))),
                ]),
              ),
              const Divider(height: 1, color: AppColors.cardBorder),
              ConstrainedBox(
                constraints: const BoxConstraints(maxHeight: 240),
                child: _log.isEmpty
                    ? const Padding(padding: EdgeInsets.all(12), child: Text('Sin actividad.', style: TextStyle(color: AppColors.textHint, fontSize: 12)))
                    : ListView(
                        padding: const EdgeInsets.all(8),
                        children: _log.map((l) => Text(l, style: const TextStyle(color: AppColors.textSecondary, fontSize: 12, fontFamily: 'monospace'))).toList(),
                      ),
              ),
            ]),
          ),
        ],
      ),
    );
  }

  Widget _chip(String txt, Color color) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
        decoration: BoxDecoration(color: color.withValues(alpha: 0.15), borderRadius: BorderRadius.circular(99)),
        child: Text(txt, style: TextStyle(color: color, fontSize: 12, fontWeight: FontWeight.w700)),
      );

  Widget _info(String k, String v) => Text.rich(TextSpan(children: [
        TextSpan(text: '$k: ', style: const TextStyle(color: AppColors.textSecondary, fontSize: 12)),
        TextSpan(text: v, style: const TextStyle(color: AppColors.textPrimary, fontSize: 12, fontWeight: FontWeight.w600)),
      ]));

  Widget _lecturaCard(String titulo, String valor, Color color, IconData icon, VoidCallback onMedir, {bool mono = false}) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppColors.cardBorder),
      ),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [Icon(icon, size: 16, color: AppColors.textSecondary), const SizedBox(width: 6), Text(titulo, style: const TextStyle(color: AppColors.textSecondary, fontSize: 11, fontWeight: FontWeight.w700))]),
        const SizedBox(height: 6),
        Text(valor, style: TextStyle(color: color, fontSize: mono ? 15 : 26, fontWeight: FontWeight.bold, fontFamily: mono ? 'monospace' : null)),
        const SizedBox(height: 4),
        GestureDetector(
          onTap: _conectada ? onMedir : null,
          child: Text(mono ? 'leer tag' : 'medir ahora', style: TextStyle(color: _conectada ? AppColors.primary : AppColors.textHint, fontSize: 12)),
        ),
      ]),
    );
  }
}
