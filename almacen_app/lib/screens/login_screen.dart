import 'package:flutter/material.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'traspasos_screen.dart';

final _db = Supabase.instance.client;

class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _nombreCtrl = TextEditingController();
  final _pinControllers = List.generate(4, (_) => TextEditingController());
  final _pinFocusNodes = List.generate(4, (_) => FocusNode());
  bool _loading = false;
  String? _error;

  String get _pin => _pinControllers.map((c) => c.text).join();

  @override
  void dispose() {
    _nombreCtrl.dispose();
    for (final c in _pinControllers) c.dispose();
    for (final f in _pinFocusNodes) f.dispose();
    super.dispose();
  }

  void _onPinDigit(int index, String value) {
    if (value.length == 1 && index < 3) {
      _pinFocusNodes[index + 1].requestFocus();
    } else if (value.isEmpty && index > 0) {
      _pinFocusNodes[index - 1].requestFocus();
    }
    if (index == 3 && value.length == 1) _entrar();
  }

  void _limpiarPin() {
    for (final c in _pinControllers) c.clear();
    _pinFocusNodes[0].requestFocus();
  }

  Future<void> _entrar() async {
    final nombre = _nombreCtrl.text.trim();
    final pin = _pin;

    if (nombre.isEmpty || pin.length < 4) {
      setState(() => _error = 'Introduce tu nombre de usuario y contraseña.');
      return;
    }

    setState(() { _loading = true; _error = null; });

    try {
      final res = await _db
          .from('perfiles_usuario')
          .select('id, nombre, rol, ubicacion, activo, codigo_operario')
          .eq('codigo_operario', pin)
          .eq('activo', true)
          .maybeSingle();

      if (res == null) {
        setState(() => _error = 'Usuario o contraseña incorrectos.');
        _limpiarPin();
        return;
      }

      final nombreDb = (res['nombre'] as String? ?? '').toLowerCase().trim();
      if (nombreDb != nombre.toLowerCase().trim()) {
        setState(() => _error = 'Usuario o contraseña incorrectos.');
        _limpiarPin();
        return;
      }

      if (!mounted) return;
      Navigator.of(context).pushReplacement(
        MaterialPageRoute(builder: (_) => TraspasoListScreen(operario: res)),
      );
    } catch (e) {
      setState(() => _error = 'Error de conexión: $e');
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF1a1a2e),
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(32),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                const Icon(Icons.warehouse, size: 72, color: Colors.white54),
                const SizedBox(height: 16),
                const Text(
                  'Mobilink Almacén',
                  style: TextStyle(
                    color: Colors.white,
                    fontSize: 28,
                    fontWeight: FontWeight.bold,
                  ),
                ),
                const SizedBox(height: 8),
                const Text(
                  'Gestión de traspasos',
                  style: TextStyle(color: Colors.white54, fontSize: 14),
                ),
                const SizedBox(height: 40),
                TextField(
                  controller: _nombreCtrl,
                  textCapitalization: TextCapitalization.words,
                  enabled: !_loading,
                  style: const TextStyle(color: Colors.white),
                  decoration: InputDecoration(
                    labelText: 'Nombre de usuario',
                    labelStyle: const TextStyle(color: Colors.white54),
                    enabledBorder: OutlineInputBorder(
                      borderSide: const BorderSide(color: Colors.white24),
                      borderRadius: BorderRadius.circular(12),
                    ),
                    focusedBorder: OutlineInputBorder(
                      borderSide: const BorderSide(color: Colors.blue),
                      borderRadius: BorderRadius.circular(12),
                    ),
                  ),
                  onSubmitted: (_) => _pinFocusNodes[0].requestFocus(),
                ),
                const SizedBox(height: 24),
                const Text('Contraseña',
                    style: TextStyle(color: Colors.white54, fontSize: 13)),
                const SizedBox(height: 12),
                Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: List.generate(4, (i) {
                    return Container(
                      width: 56,
                      height: 64,
                      margin: const EdgeInsets.symmetric(horizontal: 8),
                      child: TextField(
                        controller: _pinControllers[i],
                        focusNode: _pinFocusNodes[i],
                        keyboardType: TextInputType.number,
                        maxLength: 1,
                        obscureText: true,
                        textAlign: TextAlign.center,
                        enabled: !_loading,
                        style: const TextStyle(
                            color: Colors.white,
                            fontSize: 24,
                            fontWeight: FontWeight.bold),
                        decoration: InputDecoration(
                          counterText: '',
                          enabledBorder: OutlineInputBorder(
                            borderSide: const BorderSide(color: Colors.white24),
                            borderRadius: BorderRadius.circular(12),
                          ),
                          focusedBorder: OutlineInputBorder(
                            borderSide: const BorderSide(color: Colors.blue),
                            borderRadius: BorderRadius.circular(12),
                          ),
                          filled: true,
                          fillColor: Colors.white10,
                        ),
                        onChanged: (v) => _onPinDigit(i, v),
                      ),
                    );
                  }),
                ),
                if (_error != null) ...[
                  const SizedBox(height: 16),
                  Text(_error!,
                      style: const TextStyle(color: Colors.redAccent),
                      textAlign: TextAlign.center),
                ],
                const SizedBox(height: 32),
                SizedBox(
                  width: double.infinity,
                  height: 52,
                  child: ElevatedButton(
                    onPressed: _loading ? null : _entrar,
                    style: ElevatedButton.styleFrom(
                      backgroundColor: Colors.blue,
                      shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(12)),
                    ),
                    child: _loading
                        ? const CircularProgressIndicator(color: Colors.white)
                        : const Text('Entrar',
                            style: TextStyle(
                                fontSize: 16, fontWeight: FontWeight.bold)),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
