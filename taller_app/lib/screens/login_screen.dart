import 'package:flutter/material.dart';
import '../services/api_service.dart';
import '../services/biometria.dart';
import '../services/preferencias.dart';
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
        if (t.isEmpty) {
          _error = 'No hay ningún operario dado de alta con PIN de taller. '
              'Pídelo en oficina.';
        }
      });
    } catch (e) {
      if (!mounted) return;
      // Sin esto, un fallo al cargar la lista dejaba el desplegable vacío sin
      // explicar nada: parecía que la app no dejaba elegir operario.
      setState(() {
        _loadingTechs = false;
        _error = 'No se ha podido cargar la lista de operarios. '
            'Comprueba la conexión y vuelve a intentarlo.';
      });
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
      await Preferencias.guardarSesion(name, code);
      if (!mounted) return;
      await _ofrecerBiometria();
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

  /// Tras el primer login con éxito en un móvil con Face ID / huella se
  /// ofrece activarlo, una sola vez. Si dice que no, se activa cuando quiera
  /// desde el botón de la huella de la cabecera. Igual que en Assist lite.
  Future<void> _ofrecerBiometria() async {
    if (await Preferencias.biometriaActivada()) return;
    if (await Preferencias.biometriaOfrecida()) return;
    if (!await Biometria.disponible()) return;
    await Preferencias.marcarBiometriaOfrecida();
    final nombre = await Biometria.nombre();
    if (!mounted) return;
    final activar = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        icon: const Icon(Icons.fingerprint, color: AppColors.primary),
        title: Text('¿Entrar con $nombre?'),
        content: Text('La próxima vez que abras la app entrarás con $nombre, '
            'sin elegir el nombre ni escribir el PIN.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Ahora no')),
          FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Activar')),
        ],
      ),
    );
    if (activar != true) return;
    // Se comprueba en el momento: activar algo que luego no funciona deja al
    // operario en el candado sin poder pasar.
    if (await Biometria.autenticar('Activa el acceso con $nombre')) {
      await Preferencias.activarBiometria(true);
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
                // El logotipo sustituye al icono y al rótulo que había: el
                // dibujo ya lleva el nombre dentro, así que repetirlo debajo
                // sería decir dos veces lo mismo.
                //
                // Se limita el ancho en vez de estirarlo a la columna: en una
                // tablet en horizontal ocuparía media pantalla.
                Center(
                  child: ConstrainedBox(
                    constraints: const BoxConstraints(maxWidth: 320),
                    child: Image.asset(
                      'assets/logo-workplanner.png',
                      fit: BoxFit.contain,
                      // Si el asset faltara, la pantalla de entrada se queda
                      // en rojo y no se puede ni escribir el PIN. Mejor el
                      // rótulo de siempre que una app que no deja entrar.
                      errorBuilder: (_, __, ___) => const Text(
                        'WorkPlanner Taller',
                        textAlign: TextAlign.center,
                        style: TextStyle(fontSize: 22, fontWeight: FontWeight.bold),
                      ),
                    ),
                  ),
                ),
                const SizedBox(height: 28),
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
