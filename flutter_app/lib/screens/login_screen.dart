import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../services/api_service.dart';
import '../theme/app_theme.dart';
import 'assistances_screen.dart';

class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _nameController = TextEditingController();
  final _pinControllers = List.generate(4, (_) => TextEditingController());
  final _pinFocusNodes = List.generate(4, (_) => FocusNode());
  bool _loading = false;
  String? _error;

  String get _pin => _pinControllers.map((c) => c.text).join();

  Future<void> _login() async {
    final name = _nameController.text.trim();
    final pin = _pin;

    if (name.isEmpty || pin.length < 4) {
      setState(() => _error = 'Introduce tu nombre y PIN de 4 dígitos');
      return;
    }

    setState(() { _loading = true; _error = null; });

    try {
      await ApiService.login(name, pin);
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString('techName', name);
      await prefs.setString('code', pin);

      if (!mounted) return;
      Navigator.of(context).pushReplacement(
        MaterialPageRoute(
          builder: (_) => AssistancesScreen(api: ApiService(techName: name, code: pin)),
        ),
      );
    } catch (e) {
      setState(() => _error = e.toString().replaceFirst('Exception: ', ''));
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  void _onPinDigit(int index, String value) {
    if (value.length == 1 && index < 3) {
      _pinFocusNodes[index + 1].requestFocus();
    } else if (value.isEmpty && index > 0) {
      _pinFocusNodes[index - 1].requestFocus();
    }
    if (index == 3 && value.length == 1) _login();
  }

  @override
  void dispose() {
    _nameController.dispose();
    for (final c in _pinControllers) c.dispose();
    for (final f in _pinFocusNodes) f.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final tt = Theme.of(context).textTheme;
    return Scaffold(
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.symmetric(horizontal: 40, vertical: 32),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 480),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Image.asset('assets/logo_transparent.png', width: 280),
                  const SizedBox(height: 12),
                  Text(
                    'Acceso operarios',
                    style: tt.bodyMedium,
                  ),
                  const SizedBox(height: 48),

                  // Campo nombre
                  TextField(
                    controller: _nameController,
                    style: tt.bodyLarge,
                    textCapitalization: TextCapitalization.words,
                    decoration: const InputDecoration(
                      labelText: 'Tu nombre',
                      prefixIcon: Icon(Icons.person_outline, color: AppColors.textSecondary),
                    ),
                  ),
                  const SizedBox(height: 32),

                  // PIN label
                  Align(
                    alignment: Alignment.centerLeft,
                    child: Text('PIN de acceso', style: tt.bodyMedium),
                  ),
                  const SizedBox(height: 12),

                  // Dígitos PIN
                  Row(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: List.generate(4, (i) {
                      return Container(
                        width: 64,
                        height: 72,
                        margin: const EdgeInsets.symmetric(horizontal: 8),
                        child: TextField(
                          controller: _pinControllers[i],
                          focusNode: _pinFocusNodes[i],
                          keyboardType: TextInputType.number,
                          maxLength: 1,
                          obscureText: true,
                          textAlign: TextAlign.center,
                          style: tt.titleMedium?.copyWith(color: AppColors.primary),
                          decoration: const InputDecoration(
                            counterText: '',
                            fillColor: AppColors.surfaceVariant,
                          ),
                          onChanged: (v) => _onPinDigit(i, v),
                        ),
                      );
                    }),
                  ),

                  if (_error != null) ...[
                    const SizedBox(height: 20),
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                      decoration: BoxDecoration(
                        color: AppColors.danger.withValues(alpha: 0.15),
                        border: Border.all(color: AppColors.danger.withValues(alpha: 0.4)),
                        borderRadius: BorderRadius.circular(8),
                      ),
                      child: Row(
                        children: [
                          const Icon(Icons.error_outline, color: AppColors.danger, size: 20),
                          const SizedBox(width: 8),
                          Expanded(child: Text(_error!, style: TextStyle(color: AppColors.danger, fontSize: 14))),
                        ],
                      ),
                    ),
                  ],

                  const SizedBox(height: 36),

                  // Botón entrar
                  SizedBox(
                    width: double.infinity,
                    child: ElevatedButton.icon(
                      onPressed: _loading ? null : _login,
                      icon: _loading
                          ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2, color: AppColors.onPrimary))
                          : const Icon(Icons.login, size: 22),
                      label: Text(_loading ? 'Verificando…' : 'Entrar'),
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
