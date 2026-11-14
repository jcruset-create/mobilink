import 'dart:async';
import 'package:flutter/material.dart';
import '../services/api_service.dart';
import '../services/biometria.dart';
import '../services/preferencias.dart';
import '../theme.dart';

/// Bloqueo por inactividad para la tablet del puesto de trabajo.
///
/// La tablet se queda encendida y la comparten varios técnicos, así que dejar
/// la sesión abierta indefinidamente significa que el siguiente que pase
/// fichará trabajo a nombre del anterior. Tras unos minutos sin tocar la
/// pantalla se pide el PIN otra vez.
///
/// **No cierra la sesión ni toca la cola offline**: los cambios pendientes de
/// enviar son del dispositivo, no del técnico, y perderlos al bloquear sería
/// mucho peor que el problema que esto resuelve. Para cambiar de operario está
/// el botón de salir, que sí borra la identidad.
class BloqueoInactividad extends StatefulWidget {
  final Widget child;
  final ApiService api;
  final Duration limite;

  const BloqueoInactividad({
    super.key,
    required this.child,
    required this.api,
    this.limite = const Duration(minutes: 5),
  });

  @override
  State<BloqueoInactividad> createState() => _BloqueoInactividadState();
}

class _BloqueoInactividadState extends State<BloqueoInactividad> {
  Timer? _timer;
  bool _bloqueada = false;

  @override
  void initState() {
    super.initState();
    _rearmar();
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  void _rearmar() {
    _timer?.cancel();
    if (_bloqueada) return;
    _timer = Timer(widget.limite, () {
      if (mounted) setState(() => _bloqueada = true);
    });
  }

  void _desbloquear() {
    setState(() => _bloqueada = false);
    _rearmar();
  }

  @override
  Widget build(BuildContext context) {
    return Listener(
      behavior: HitTestBehavior.translucent,
      onPointerDown: (_) => _rearmar(),
      onPointerMove: (_) => _rearmar(),
      child: Stack(
        children: [
          widget.child,
          if (_bloqueada)
            _PantallaBloqueo(api: widget.api, onDesbloquear: _desbloquear),
        ],
      ),
    );
  }
}

class _PantallaBloqueo extends StatefulWidget {
  final ApiService api;
  final VoidCallback onDesbloquear;

  const _PantallaBloqueo({required this.api, required this.onDesbloquear});

  @override
  State<_PantallaBloqueo> createState() => _PantallaBloqueoState();
}

class _PantallaBloqueoState extends State<_PantallaBloqueo> {
  final _pinCtrl = TextEditingController();
  String? _error;
  bool _comprobando = false;

  /// Si el operario activó Face ID / huella, el candado se abre con eso y el
  /// PIN queda de salida. La petición sale sola una vez al bloquearse.
  bool _bio = false;
  String _bioNombre = 'Face ID';

  @override
  void initState() {
    super.initState();
    _prepararBiometria();
  }

  Future<void> _prepararBiometria() async {
    if (!await Preferencias.biometriaActivada()) return;
    if (!await Biometria.disponible()) return;
    final nombre = await Biometria.nombre();
    if (!mounted) return;
    setState(() {
      _bio = true;
      _bioNombre = nombre;
    });
    await _conBiometria();
  }

  Future<void> _conBiometria() async {
    if (await Biometria.autenticar('Desbloquea WorkPlanner Taller')) {
      if (mounted) widget.onDesbloquear();
    }
  }

  @override
  void dispose() {
    _pinCtrl.dispose();
    super.dispose();
  }

  Future<void> _comprobar() async {
    final pin = _pinCtrl.text.trim();
    if (pin.isEmpty) return;

    // El PIN correcto es el de la sesión abierta: no hace falta ir al servidor,
    // que además puede no estar disponible en el taller.
    if (pin == widget.api.code) {
      widget.onDesbloquear();
      return;
    }

    setState(() {
      _comprobando = true;
      _error = null;
    });

    if (!mounted) return;
    setState(() {
      _comprobando = false;
      _error = 'PIN incorrecto. Para entrar con otro operario, sal de la sesión.';
      _pinCtrl.clear();
    });
  }

  @override
  Widget build(BuildContext context) {
    return Positioned.fill(
      child: Container(
        color: AppColors.bg,
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 420),
            child: Padding(
              padding: const EdgeInsets.all(24),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  const Icon(Icons.lock_outline, size: 56, color: AppColors.primary),
                  const SizedBox(height: 16),
                  const Text(
                    'Pantalla bloqueada',
                    style: TextStyle(fontSize: 24, fontWeight: FontWeight.bold),
                  ),
                  const SizedBox(height: 6),
                  Text(
                    widget.api.techName,
                    style: const TextStyle(fontSize: 18, color: AppColors.textMuted),
                  ),
                  const SizedBox(height: 24),
                  if (_bio) ...[
                    SizedBox(
                      width: double.infinity,
                      child: FilledButton.icon(
                        onPressed: _conBiometria,
                        icon: const Icon(Icons.fingerprint),
                        label: Text('Desbloquear con $_bioNombre'),
                      ),
                    ),
                    const SizedBox(height: 16),
                  ],
                  TextField(
                    controller: _pinCtrl,
                    autofocus: !_bio,
                    keyboardType: TextInputType.number,
                    obscureText: true,
                    maxLength: 6,
                    style: const TextStyle(fontSize: 22, letterSpacing: 6),
                    textAlign: TextAlign.center,
                    decoration: const InputDecoration(
                      labelText: 'PIN',
                      counterText: '',
                    ),
                    onSubmitted: (_) => _comprobar(),
                  ),
                  if (_error != null) ...[
                    const SizedBox(height: 10),
                    Text(
                      _error!,
                      textAlign: TextAlign.center,
                      style: const TextStyle(color: AppColors.primary),
                    ),
                  ],
                  const SizedBox(height: 20),
                  SizedBox(
                    width: double.infinity,
                    child: ElevatedButton(
                      onPressed: _comprobando ? null : _comprobar,
                      child: const Text('Continuar'),
                    ),
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
