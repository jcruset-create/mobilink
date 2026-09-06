import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../config.dart';
import '../services/api.dart';
import '../services/session.dart';
import '../services/tracker.dart';
import '../theme.dart';
import 'inbox_screen.dart';

/// Acceso del operario: código de taller (lo facilita la central), su usuario
/// y su PIN. El token se guarda en el dispositivo; el PIN nunca.
class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _workshop = TextEditingController();
  final _user = TextEditingController();
  final _pin = TextEditingController();
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _workshop.dispose();
    _user.dispose();
    _pin.dispose();
    super.dispose();
  }

  Future<void> _entrar() async {
    if (_workshop.text.trim().isEmpty || _user.text.trim().isEmpty || _pin.text.isEmpty) {
      setState(() => _error = 'Rellena taller, usuario y PIN.');
      return;
    }
    setState(() { _busy = true; _error = null; });
    try {
      final gps = await Tracker.ensurePermission();
      final session = await Api.login(
        workshopCode: _workshop.text.trim(),
        username: _user.text.trim(),
        pin: _pin.text,
        device: {
          'deviceId': await Session.deviceId(),
          'platform': Platform.operatingSystem,
          'osVersion': Platform.operatingSystemVersion,
          'appVersion': kAppVersion,
          'gpsPermission': gps,
        },
      );
      await session.save();
      if (!mounted) return;
      Navigator.of(context).pushReplacement(
        MaterialPageRoute(builder: (_) => InboxScreen(session: session)),
      );
    } on ApiError catch (e) {
      setState(() => _error = e.message);
    } on OfflineError {
      setState(() => _error = 'Sin conexión. El primer acceso necesita internet.');
    } catch (e) {
      setState(() => _error = 'No se pudo iniciar sesión: $e');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(24),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 460),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  // El logotipo ya dice el nombre de la app, así que debajo
                  // solo queda para quién es: repetir "Mobilink Assist Lite"
                  // en texto sería decirlo dos veces.
                  Center(
                    child: ConstrainedBox(
                      constraints: const BoxConstraints(maxWidth: 360),
                      child: Image.asset(
                        'assets/logo_horizontal.png',
                        fit: BoxFit.contain,
                        semanticLabel: 'Mobilink Assist Lite',
                      ),
                    ),
                  ),
                  const SizedBox(height: 16),
                  const Text('Acceso para talleres colaboradores',
                      textAlign: TextAlign.center,
                      style: TextStyle(color: AppColors.textMuted)),
                  const SizedBox(height: 28),
                  TextField(
                    controller: _workshop,
                    textCapitalization: TextCapitalization.characters,
                    decoration: const InputDecoration(
                      labelText: 'Código de taller',
                      hintText: 'Te lo facilita la central',
                      prefixIcon: Icon(Icons.store),
                    ),
                  ),
                  const SizedBox(height: 12),
                  TextField(
                    controller: _user,
                    decoration: const InputDecoration(
                      labelText: 'Usuario',
                      prefixIcon: Icon(Icons.person),
                    ),
                  ),
                  const SizedBox(height: 12),
                  TextField(
                    controller: _pin,
                    obscureText: true,
                    keyboardType: TextInputType.number,
                    inputFormatters: [FilteringTextInputFormatter.digitsOnly],
                    maxLength: 8,
                    onSubmitted: (_) => _entrar(),
                    decoration: const InputDecoration(
                      labelText: 'PIN',
                      prefixIcon: Icon(Icons.lock),
                      counterText: '',
                    ),
                  ),
                  if (_error != null) ...[
                    const SizedBox(height: 12),
                    Container(
                      padding: const EdgeInsets.all(12),
                      decoration: BoxDecoration(
                        color: AppColors.danger.withValues(alpha: 0.12),
                        border: Border.all(color: AppColors.danger),
                        borderRadius: BorderRadius.circular(10),
                      ),
                      child: Row(children: [
                        const Icon(Icons.error_outline, color: AppColors.danger),
                        const SizedBox(width: 8),
                        Expanded(child: Text(_error!)),
                      ]),
                    ),
                  ],
                  const SizedBox(height: 20),
                  ElevatedButton(
                    onPressed: _busy ? null : _entrar,
                    child: _busy
                        ? const SizedBox(
                            height: 22, width: 22,
                            child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                        : const Text('Entrar'),
                  ),
                  const SizedBox(height: 16),
                  const Text(
                    '¿Has olvidado el PIN? Pide a la central o al responsable '
                    'del taller que te lo restablezca.',
                    textAlign: TextAlign.center,
                    style: TextStyle(color: AppColors.textMuted, fontSize: 12),
                  ),
                  const SizedBox(height: 8),
                  const Text('Versión $kAppVersion',
                      textAlign: TextAlign.center,
                      style: TextStyle(color: AppColors.textMuted, fontSize: 11)),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
