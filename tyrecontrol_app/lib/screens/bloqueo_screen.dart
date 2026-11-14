import 'package:flutter/material.dart';

import '../services/biometria.dart';
import '../theme/app_theme.dart';
import 'login_screen.dart';

/// Candado biométrico de la sesión guardada. Es el de Mobilink Assist Lite.
///
/// Se enseña al arrancar cuando el técnico ha activado Face ID / huella en
/// este dispositivo: la sesión ya está guardada, y esto es la llave. Si el
/// sistema da por buena la identificación se entra a [destino]; si el técnico
/// prefiere su nombre y PIN, al login.
///
/// La petición sale sola al abrir la pantalla —una pulsación menos— pero si
/// falla o se cancela **no se repite sola**: queda el botón. Reintentar en
/// bucle es la forma más rápida de bloquear la biometría del sistema por
/// intentos fallidos y dejar al técnico fuera con un vehículo esperando.
class BloqueoScreen extends StatefulWidget {
  /// Adónde se entra al identificarse: la home o la elección de cliente.
  final WidgetBuilder destino;

  /// Para las pruebas: en un test no hay sensor al que preguntar.
  final Future<bool> Function(String motivo) autenticar;
  final Future<String> Function() nombre;

  const BloqueoScreen({
    super.key,
    required this.destino,
    this.autenticar = Biometria.autenticar,
    this.nombre = Biometria.nombre,
  });

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
    final n = await widget.nombre();
    if (!mounted) return;
    setState(() => _nombre = n);
    await _pedir();
  }

  Future<void> _pedir() async {
    if (_pidiendo) return;
    setState(() {
      _pidiendo = true;
      _fallo = false;
    });
    final ok = await widget.autenticar('Entra en Mobilink TyreControl');
    if (!mounted) return;
    if (ok) {
      Navigator.of(context).pushReplacement(MaterialPageRoute(builder: widget.destino));
      return;
    }
    setState(() {
      _pidiendo = false;
      _fallo = true;
    });
  }

  /// La sesión NO se borra: un login correcto la sustituye sin más, y si al
  /// final no se entra, lo que hubiera en la cola offline sigue con su token.
  void _conNombreYPin() {
    Navigator.of(context).pushReplacement(
      MaterialPageRoute(builder: (_) => const LoginScreen()),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.symmetric(horizontal: 40, vertical: 32),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 480),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  // La misma portada que el login.
                  Image.asset('assets/logo_cabecera.png',
                      width: 420,
                      fit: BoxFit.contain,
                      semanticLabel: 'Mobilink TyreControl'),
                  const SizedBox(height: 36),
                  ElevatedButton.icon(
                    key: const Key('entrar-biometria'),
                    onPressed: _pidiendo ? null : _pedir,
                    icon: Icon(_nombre == 'Face ID' || _nombre == 'reconocimiento facial'
                        ? Icons.face
                        : Icons.fingerprint),
                    label: Text('Entrar con $_nombre'),
                  ),
                  if (_fallo) ...[
                    const SizedBox(height: 12),
                    Text(
                      'No se ha podido identificar con $_nombre. Vuelve a '
                      'intentarlo o entra con tu nombre y PIN.',
                      textAlign: TextAlign.center,
                      style: const TextStyle(color: AppColors.textSecondary, fontSize: 13),
                    ),
                  ],
                  const SizedBox(height: 8),
                  TextButton(
                    key: const Key('entrar-con-pin'),
                    onPressed: _conNombreYPin,
                    child: const Text('Entrar con nombre y PIN'),
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
