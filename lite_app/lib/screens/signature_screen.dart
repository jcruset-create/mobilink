import 'package:flutter/material.dart';
import 'package:signature/signature.dart';
import '../services/api.dart';
import '../services/file_queue.dart';
import '../services/session.dart';
import '../services/tracker.dart';
import '../theme.dart';

const String kConsentText =
    'El firmante declara haber recibido el servicio descrito y autoriza el '
    'tratamiento de su firma con la única finalidad de acreditar la '
    'prestación, conforme a la política de privacidad de Mobilink.';

/// Recogida de la firma del cliente. La firma se envía como PNG junto al
/// nombre del firmante, su documento (si procede) y el consentimiento.
class SignatureScreen extends StatefulWidget {
  const SignatureScreen({super.key, required this.session, required this.assistanceId});
  final Session session;
  final int assistanceId;

  @override
  State<SignatureScreen> createState() => _SignatureScreenState();
}

class _SignatureScreenState extends State<SignatureScreen> {
  late final Api _api = Api(widget.session.token);
  final _controller = SignatureController(penStrokeWidth: 3, penColor: Colors.black);
  final _nombre = TextEditingController();
  final _documento = TextEditingController();
  bool _consentimiento = false;
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _controller.dispose();
    _nombre.dispose();
    _documento.dispose();
    super.dispose();
  }

  Future<void> _guardar() async {
    if (_nombre.text.trim().isEmpty) {
      setState(() => _error = 'Indica el nombre del firmante.');
      return;
    }
    if (_controller.isEmpty) {
      setState(() => _error = 'Falta la firma.');
      return;
    }
    if (!_consentimiento) {
      setState(() => _error = 'El firmante debe aceptar el consentimiento.');
      return;
    }
    setState(() { _busy = true; _error = null; });
    try {
      final png = await _controller.toPngBytes();
      if (png == null) throw Exception('No se pudo generar la firma');
      final pos = await Tracker.currentPosition();

      // La firma se guarda en el móvil antes de intentar enviarla: si no hay
      // cobertura no se puede pedir al cliente que vuelva a firmar dentro de
      // un rato, porque para entonces ya se habrá ido.
      await FileQueue.addSignature(
        assistanceId: widget.assistanceId,
        png: png,
        signerName: _nombre.text.trim(),
        signerDocument: _documento.text.trim().isEmpty ? null : _documento.text.trim(),
        consentText: kConsentText,
        lat: pos?.latitude,
        lng: pos?.longitude,
      );
      await FileQueue.flush(_api);
      if (!mounted) return;
      final pendiente = FileQueue.forAssistance(widget.assistanceId)
          .any((f) => f.kind == 'signature');
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
        content: Text(pendiente
            ? 'Firma guardada. Se enviará a la central al recuperar cobertura.'
            : 'Firma registrada.'),
        backgroundColor: pendiente ? AppColors.warn : null,
      ));
      Navigator.of(context).pop(true);
    } on ApiError catch (e) {
      setState(() => _error = e.message);
    } catch (e) {
      setState(() => _error = 'No se pudo guardar la firma: $e');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Firma del cliente')),
      body: ListView(padding: const EdgeInsets.all(16), children: [
        TextField(
          controller: _nombre,
          textCapitalization: TextCapitalization.words,
          decoration: const InputDecoration(
            labelText: 'Nombre y apellidos del firmante *',
            prefixIcon: Icon(Icons.person),
          ),
        ),
        const SizedBox(height: 12),
        TextField(
          controller: _documento,
          textCapitalization: TextCapitalization.characters,
          decoration: const InputDecoration(
            labelText: 'DNI / documento (si procede)',
            prefixIcon: Icon(Icons.badge),
          ),
        ),
        const SizedBox(height: 16),
        const Text('Firma', style: TextStyle(fontWeight: FontWeight.bold)),
        const SizedBox(height: 8),
        Container(
          decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(12),
            border: Border.all(color: AppColors.border),
          ),
          child: ClipRRect(
            borderRadius: BorderRadius.circular(12),
            child: Signature(controller: _controller, height: 220, backgroundColor: Colors.white),
          ),
        ),
        Align(
          alignment: Alignment.centerRight,
          child: TextButton.icon(
            onPressed: () => setState(_controller.clear),
            icon: const Icon(Icons.undo),
            label: const Text('Borrar y repetir'),
          ),
        ),
        CheckboxListTile(
          value: _consentimiento,
          onChanged: (v) => setState(() => _consentimiento = v ?? false),
          contentPadding: EdgeInsets.zero,
          controlAffinity: ListTileControlAffinity.leading,
          title: const Text('El cliente acepta el consentimiento',
              style: TextStyle(fontSize: 14)),
          subtitle: const Text(kConsentText,
              style: TextStyle(fontSize: 12, color: AppColors.textMuted)),
        ),
        if (_error != null) ...[
          const SizedBox(height: 8),
          Text(_error!, style: const TextStyle(color: AppColors.danger)),
        ],
        const SizedBox(height: 16),
        ElevatedButton.icon(
          onPressed: _busy ? null : _guardar,
          icon: const Icon(Icons.check),
          label: Text(_busy ? 'Guardando…' : 'Guardar firma'),
        ),
      ]),
    );
  }
}
