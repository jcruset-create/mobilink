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
  bool _errorEmployees = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _loadEmployees();
  }

  Future<void> _loadEmployees() async {
    setState(() {
      _loadingEmployees = true;
      _errorEmployees = false;
    });
    try {
      final e = await ApiService.employees();
      if (!mounted) return;
      setState(() {
        _employees = e;
        _loadingEmployees = false;
        _errorEmployees = e.isEmpty;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _loadingEmployees = false;
        _errorEmployees = true;
      });
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
      setState(() =>
          _error = 'Elige tu nombre en la lista e introduce el PIN.');
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
                    child: Column(
                      children: [
                        CircularProgressIndicator(color: AppColors.primary),
                        SizedBox(height: 10),
                        Text('Cargando empleados...',
                            textAlign: TextAlign.center,
                            style: TextStyle(
                                fontSize: 12, color: AppColors.textMuted)),
                      ],
                    ),
                  )
                else if (_errorEmployees)
                  Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      const Text(
                        'No se pudo cargar la lista de empleados.\n'
                        'Comprueba la conexión e inténtalo de nuevo.',
                        textAlign: TextAlign.center,
                        style: TextStyle(
                            fontSize: 13, color: AppColors.textMuted),
                      ),
                      const SizedBox(height: 10),
                      OutlinedButton.icon(
                        style: OutlinedButton.styleFrom(
                          foregroundColor: Colors.white,
                          side: const BorderSide(color: AppColors.border),
                        ),
                        onPressed: _loadEmployees,
                        icon: const Icon(Icons.refresh),
                        label: const Text('Reintentar'),
                      ),
                    ],
                  )
                else
                  Autocomplete<Map<String, dynamic>>(
                    displayStringForOption: _fullName,
                    optionsBuilder: (value) {
                      final q = value.text.trim().toLowerCase();
                      if (q.isEmpty) return _employees;
                      return _employees.where(
                          (e) => _fullName(e).toLowerCase().contains(q));
                    },
                    onSelected: (e) =>
                        setState(() => _selectedId = e['id'] as String),
                    optionsViewBuilder: (context, onSelected, options) {
                      return Align(
                        alignment: Alignment.topLeft,
                        child: Material(
                          color: AppColors.surface,
                          borderRadius: BorderRadius.circular(10),
                          elevation: 6,
                          child: ConstrainedBox(
                            constraints: const BoxConstraints(
                                maxHeight: 260, maxWidth: 340),
                            child: ListView.builder(
                              padding: EdgeInsets.zero,
                              shrinkWrap: true,
                              itemCount: options.length,
                              itemBuilder: (context, i) {
                                final e = options.elementAt(i);
                                return ListTile(
                                  dense: true,
                                  title: Text(_fullName(e),
                                      style: const TextStyle(
                                          color: Colors.white)),
                                  onTap: () => onSelected(e),
                                );
                              },
                            ),
                          ),
                        ),
                      );
                    },
                    fieldViewBuilder:
                        (context, controller, focusNode, onSubmit) {
                      return TextField(
                        controller: controller,
                        focusNode: focusNode,
                        decoration: InputDecoration(
                          labelText: 'Empleado',
                          hintText: 'Escribe tu nombre...',
                          suffixIcon: const Icon(Icons.arrow_drop_down,
                              color: AppColors.textMuted),
                        ),
                        onChanged: (_) {
                          // Si edita el texto, invalidar la selección previa
                          if (_selectedId != null) {
                            setState(() => _selectedId = null);
                          }
                        },
                      );
                    },
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
