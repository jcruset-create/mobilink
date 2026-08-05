import 'package:flutter/material.dart';
import '../services/probe_session.dart';
import '../services/tlgx_probe_service.dart';
import '../theme/app_theme.dart';

/// Campos de identidad de un neumático: RFID (con lectura desde la sonda) y
/// número de serie.
///
/// Se usa tanto al montar (`cambio_neumatico_screen`) como al identificar una
/// rueda que ya está puesta (`tire_detail_screen`), así que la lectura vive
/// aquí y no se repite en cada diálogo.
///
/// El botón de leer solo aparece con la sonda enganchada; si no la hay, queda
/// el número de serie a mano y se dice por qué.
class CampoIdentidad extends StatefulWidget {
  final TextEditingController rfid;
  final TextEditingController serie;
  final bool autofocus;

  const CampoIdentidad({
    super.key,
    required this.rfid,
    required this.serie,
    this.autofocus = false,
  });

  @override
  State<CampoIdentidad> createState() => _CampoIdentidadState();
}

class _CampoIdentidadState extends State<CampoIdentidad> {
  bool _leyendo = false;
  String _aviso = '';

  Future<void> _leerEtiqueta() async {
    setState(() { _leyendo = true; _aviso = ''; });
    try {
      final msg = await ProbeSession.instance.leerEpc();
      if (!mounted) return;
      setState(() {
        if (msg.hayEtiqueta && (msg.epc ?? '').isNotEmpty) {
          widget.rfid.text = msg.epc!;
          _aviso = 'Etiqueta leída';
        } else if (msg.status == RfidStatus.timeout) {
          _aviso = 'No se ha encontrado etiqueta. Acerca la sonda al flanco.';
        } else {
          _aviso = 'No se ha podido leer${msg.error != null ? ': ${msg.error}' : ''}';
        }
      });
    } catch (e) {
      if (mounted) setState(() => _aviso = 'Error al leer: $e');
    } finally {
      if (mounted) setState(() => _leyendo = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final sonda = ProbeSession.instance;
    return Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      Row(children: [
        Expanded(
          child: TextField(
            controller: widget.rfid,
            autofocus: widget.autofocus,
            decoration: const InputDecoration(labelText: 'RFID', hintText: 'o lee la etiqueta'),
          ),
        ),
        const SizedBox(width: 8),
        if (sonda.puedeLeerRfid)
          FilledButton.icon(
            onPressed: _leyendo ? null : _leerEtiqueta,
            icon: Icon(_leyendo ? Icons.bluetooth_searching : Icons.nfc, size: 18),
            label: Text(_leyendo ? 'Leyendo…' : 'Leer'),
          ),
      ]),
      const SizedBox(height: 8),
      TextField(
        controller: widget.serie,
        decoration: const InputDecoration(labelText: 'Número de serie', hintText: 'si no hay etiqueta'),
      ),
      if (!sonda.puedeLeerRfid)
        const Padding(
          padding: EdgeInsets.only(top: 6),
          child: Text('Sonda no conectada: teclea el número de serie.',
              style: TextStyle(fontSize: 11, color: AppColors.textSecondary)),
        ),
      if (_aviso.isNotEmpty)
        Padding(
          padding: const EdgeInsets.only(top: 6),
          child: Text(_aviso,
              style: TextStyle(
                  fontSize: 12,
                  color: _aviso == 'Etiqueta leída' ? AppColors.success : AppColors.warning)),
        ),
    ]);
  }
}
