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
  List<Map<String, dynamic>> _employees = [];
  String? _selectedId;
  final _pinCtrl = TextEditingController();
  bool _loading = false;
  bool _loadingEmployees = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _loadEmployees();
  }

  Future<void> _loadEmployees() async {
    try {
      final e = await ApiService.employees();
      if (!mounted) return;
      setState(() {
        _employees = e;
        _loadingEmployees = false;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() => _loadingEmployees = false);
    }
  }

  String _fullName(Map<String, dynamic> e) {
    final nombre = (e['nombre'] ?? '').toString();
    final apellidos = (e['apellidos'] ?? '').toString();
    return apellidos.isEmpty ? nombre : '$nombre $apellidos';
  }

  Future<void> _login() async {
    final id = _selectedId;
    final pin = _pinCtrl.text.trim();
    if (id == null || pin.isEmpty) {
      setState(() => _error = 'Elige tu nombre e introduce el PIN.');
      return;
    }
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      await ApiService.login(id, pin);
      final emp = _employees.firstWhere((e) => e['id'] == id);
      final name = _fullName(emp);
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString('employeeId', id);
      await prefs.setString('pin', pin);
      await prefs.setString('employeeName', name);
      if (!mounted) return;
      Navigator.of(context).pushReplacement(MaterialPageRoute(
        builder: (_) => HomeScreen(
          api: ApiService(employeeId: id, pin: pin, employeeName: name),
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
                const Icon(Icons.health_and_safety,
                    size: 64, color: AppColors.primary),
                const SizedBox(height: 12),
                const Text(
                  'Mobilink Safety',
                  textAlign: TextAlign.center,
                  style: TextStyle(fontSize: 22, fontWeight: FontWeight.bold),
                ),
                const SizedBox(height: 4),
                const Text(
                  'EPIs, documentos y formación',
                  textAlign: TextAlign.center,
                  style: TextStyle(fontSize: 13, color: AppColors.textMuted),
                ),
                const SizedBox(height: 32),
                if (_loadingEmployees)
                  const Padding(
                    padding: EdgeInsets.all(16),
                    child:
                        CircularProgressIndicator(color: AppColors.primary),
                  )
                else
                  DropdownButtonFormField<String>(
                    value: _selectedId,
                    isExpanded: true,
                    decoration: const InputDecoration(labelText: 'Empleado'),
                    dropdownColor: AppColors.surface,
                    items: _employees
                        .map((e) => DropdownMenuItem(
                              value: e['id'] as String,
                              child: Text(_fullName(e)),
                            ))
                        .toList(),
                    onChanged: (v) => setState(() => _selectedId = v),
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
                  ),
                ),
                if (_error != null) ...[
                  const SizedBox(height: 8),
                  Text(_error!,
                      style: const TextStyle(color: AppColors.danger)),
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
