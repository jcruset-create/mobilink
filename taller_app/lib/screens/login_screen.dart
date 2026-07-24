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
  List<String> _techs = [];
  String? _selected;
  final _codeCtrl = TextEditingController();
  bool _loading = false;
  bool _loadingTechs = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _loadTechs();
  }

  Future<void> _loadTechs() async {
    try {
      final t = await ApiService.techNames();
      if (!mounted) return;
      setState(() {
        _techs = t;
        _loadingTechs = false;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() => _loadingTechs = false);
    }
  }

  Future<void> _login() async {
    final name = _selected;
    final code = _codeCtrl.text.trim();
    if (name == null || code.isEmpty) {
      setState(() => _error = 'Elige tu nombre e introduce el PIN.');
      return;
    }
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      await ApiService.login(name, code);
      final api = ApiService(techName: name, code: code);
      final esSup = await api.esSupervisor();
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString('techName', name);
      await prefs.setString('code', code);
      if (!mounted) return;
      Navigator.of(context).pushReplacement(MaterialPageRoute(
        builder: (_) => HomeScreen(api: api, esSupervisor: esSup),
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
                const Icon(Icons.build_circle, size: 64, color: AppColors.primary),
                const SizedBox(height: 12),
                const Text(
                  'Mobilink Taller',
                  textAlign: TextAlign.center,
                  style: TextStyle(fontSize: 22, fontWeight: FontWeight.bold),
                ),
                const SizedBox(height: 32),
                if (_loadingTechs)
                  const Padding(
                    padding: EdgeInsets.all(16),
                    child: CircularProgressIndicator(color: AppColors.primary),
                  )
                else
                  DropdownButtonFormField<String>(
                    value: _selected,
                    isExpanded: true,
                    decoration: const InputDecoration(labelText: 'Operario'),
                    dropdownColor: AppColors.surface,
                    items: _techs
                        .map((t) => DropdownMenuItem(value: t, child: Text(t)))
                        .toList(),
                    onChanged: (v) => setState(() => _selected = v),
                  ),
                const SizedBox(height: 14),
                TextField(
                  controller: _codeCtrl,
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
                  Text(_error!, style: const TextStyle(color: AppColors.primary)),
                ],
                const SizedBox(height: 20),
                ElevatedButton(
                  onPressed: _loading ? null : _login,
                  child: _loading
                      ? const SizedBox(
                          height: 20,
                          width: 20,
                          child: CircularProgressIndicator(
                              strokeWidth: 2, color: Colors.white),
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
