import 'package:flutter/material.dart';

import '../services/biometria.dart';
import '../theme.dart';

/// Candado biométrico de la sesión guardada.
///
/// Se enseña al arrancar cuando el operario ha activado Face ID / huella: la
/// sesión ya está en el llavero, y esto es la llave. Devuelve `true` si el
/// sistema da por buena la identificación y `false` si el operario prefiere
/// entrar con usuario y PIN.
///
/// La petición sale sola al abrir la pantalla —una pulsación menos— pero si
/// falla o se cancela **no se repite sola**: queda el botón. Reintentar en
/// bucle es la forma más rápida de bloquear la biometría del sistema por
/// intentos fallidos y dejar al operario fuera con una avería esperando.
class BloqueoScreen extends StatefulWidget {
  const BloqueoScreen({super.key});

  @override
  State<BloqueoScreen> createState() => _BloqueoScreenState();
}

class _BloqueoScreenState extends State<BloqueoScreen> {
  String _nombre = 'Face ID';
  bool _pidiendo = false;
  bool _fallo = false;

  @override
  void initState() {
    super.initState();
    _preparar();
  }

  Future<void> _preparar() async {
    final n = await Biometria.nombre();
    if (!mounted) return;
    setState(() => _nombre = n);
    await _pedir();
  }

  Future<void> _pedir() async {
    if (_pidiendo) return;
    setState(() { _pidiendo = true; _fallo = false; });
    final ok = await Biometria.autenticar('Entra en Mobilink Assist Lite');
    if (!mounted) return;
    if (ok) {
      Navigator.of(context).pop(true);
      return;
    }
    setState(() { _pidiendo = false; _fallo = true; });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(24),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 400),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Center(
                    child: ConstrainedBox(
                      constraints: const BoxConstraints(maxWidth: 300),
                      child: Image.asset(
                        'assets/logo_horizontal.png',
                        fit: BoxFit.contain,
                        semanticLabel: 'Mobilink Assist Lite',
                      ),
                    ),
                  ),
                  const SizedBox(height: 36),
                  FilledButton.icon(
                    onPressed: _pidiendo ? null : _pedir,
                    icon: const Icon(Icons.fingerprint),
                    label: Text('Entrar con $_nombre'),
                  ),
                  if (_fallo) ...[
                    const SizedBox(height: 12),
                    Text(
                      'No se ha podido identificar con $_nombre. Vuelve a '
                      'intentarlo o entra con tu usuario y PIN.',
                      textAlign: TextAlign.center,
                      style: const TextStyle(
                          color: AppColors.textMuted, fontSize: 13),
                    ),
                  ],
                  const SizedBox(height: 8),
                  TextButton(
                    onPressed: () => Navigator.of(context).pop(false),
                    child: const Text('Entrar con usuario y PIN'),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
