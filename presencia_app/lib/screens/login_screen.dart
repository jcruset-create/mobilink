import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../services/api_service.dart';
import '../theme.dart';
import 'home_screen.dart';

class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  List<Employee> _empleados = [];
  Employee? _selected;
  final _pinCtrl = TextEditingController();
  bool _loading = false;
  bool _loadingEmpleados = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _loadEmpleados();
  }

  Future<void> _loadEmpleados() async {
    try {
      final e = await ApiService.employees();
      if (!mounted) return;
      setState(() {
        _empleados = e;
        _loadingEmpleados = false;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() => _loadingEmpleados = false);
    }
  }

  Future<void> _login() async {
    final emp = _selected;
    final pin = _pinCtrl.text.trim();
    if (emp == null || pin.length < 4) {
      setState(() => _error = 'Elige tu nombre e introduce tu PIN (4 dígitos).');
      return;
    }
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final logged = await ApiService.login(emp.id, pin);
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString('employeeId', emp.id);
      await prefs.setString('pin', pin);
      await prefs.setString('nombre', logged.nombreCompleto);
      if (!mounted) return;
      Navigator.of(context).pushReplacement(MaterialPageRoute(
        builder: (_) => HomeScreen(
          api: ApiService(employeeId: emp.id, pin: pin),
          nombre: logged.nombreCompleto,
        ),
      ));
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _error = e.toString().replaceFirst('Exception: ', '');
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(24),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                const Icon(Icons.badge, size: 64, color: AppColors.primary),
                const SizedBox(height: 12),
                const Text(
                  'Mobilink Presencia',
                  textAlign: TextAlign.center,
                  style: TextStyle(fontSize: 22, fontWeight: FontWeight.bold),
                ),
                const SizedBox(height: 4),
                const Text(
                  'Control de presencia en tiempo real',
                  textAlign: TextAlign.center,
                  style: TextStyle(fontSize: 13, color: AppColors.textMuted),
                ),
                const SizedBox(height: 32),
                if (_loadingEmpleados)
                  const Padding(
                    padding: EdgeInsets.all(16),
                    child: CircularProgressIndicator(color: AppColors.primary),
                  )
                else
                  DropdownButtonFormField<Employee>(
                    value: _selected,
                    isExpanded: true,
                    decoration: const InputDecoration(labelText: 'Empleado'),
                    dropdownColor: AppColors.surface,
                    items: _empleados
                        .map((e) => DropdownMenuItem(
                            value: e, child: Text(e.nombreCompleto)))
                        .toList(),
                    onChanged: (v) => setState(() => _selected = v),
                  ),
                const SizedBox(height: 14),
                TextField(
                  controller: _pinCtrl,
                  keyboardType: TextInputType.number,
                  obscureText: true,
                  maxLength: 6,
                  decoration: const InputDecoration(
                    labelText: 'PIN',
                    counterText: '',
                    helperText:
                        'Si es tu primera vez, el PIN que pongas quedará registrado.',
                  ),
                ),
                if (_error != null) ...[
                  const SizedBox(height: 8),
                  Text(_error!, style: const TextStyle(color: AppColors.red)),
                ],
                const SizedBox(height: 20),
                ElevatedButton(
                  onPressed: _loading ? null : _login,
                  child: _loading
                      ? const SizedBox(
                          height: 20,
                          width: 20,
                          child: CircularProgressIndicator(
                              strokeWidth: 2, color: AppColors.onPrimary),
                        )
                      : const Text('Entrar'),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
