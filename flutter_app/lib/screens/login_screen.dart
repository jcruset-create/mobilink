import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../services/api_service.dart';
import '../services/biometria.dart';
import '../services/sesion_segura.dart';
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

  /// ¿Se puede ofrecer el acceso biométrico? Hacen falta las tres cosas: que
  /// el operario lo tenga activado, que el aparato pueda hacerlo AHORA y que
  /// haya una credencial guardada que desbloquear.
  bool _biometriaOfrecible = false;
  bool _esFaceId = false;

  String get _pin => _pinControllers.map((c) => c.text).join();

  @override
  void initState() {
    super.initState();
    _prepararBiometria();
  }

  Future<void> _prepararBiometria() async {
    if (!await SesionSegura.biometriaActivada()) return;
    if (await SesionSegura.leer() == null) return;
    if (!await Biometria.disponible()) {
      // El interruptor apunta a algo que ya no existe: se apaga aquí también,
      // no sólo en el arranque, porque a esta pantalla se llega por más sitios.
      await SesionSegura.desactivarBiometria();
      return;
    }
    final face = await Biometria.esFaceId();
    if (!mounted) return;
    setState(() {
      _biometriaOfrecible = true;
      _esFaceId = face;
    });
  }

  String get _nombreBiometria => _esFaceId ? 'Face ID' : 'huella';

  Future<void> _login() async {
    final name = _nameController.text.trim();
    final pin = _pin;

    if (name.isEmpty || pin.length < 4) {
      setState(() => _error = 'Introduce tu nombre y PIN de 4 dígitos');
      return;
    }

    setState(() { _loading = true; _error = null; });

    try {
      final data = await ApiService.login(name, pin);
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString('techName', name);
      // El PIN va al Llavero/Keystore, NO a prefs: ahí estaba en texto plano.
      await SesionSegura.guardar(name, pin);

      // Multi-taller: guardar empresa y taller del operario (si los trae).
      final empresa = data['empresa'];
      final taller = data['taller'];
      await prefs.setString(
        'empresaNombre',
        (empresa is Map ? empresa['nombre'] as String? : null) ?? '',
      );
      await prefs.setString(
        'tallerNombre',
        (taller is Map ? taller['nombre'] as String? : null) ?? '',
      );
      await prefs.setInt(
        'tallerId',
        (taller is Map ? (taller['id'] as num?)?.toInt() : null) ?? 0,
      );

      if (!mounted) return;
      // Se ofrece DESPUÉS de un login correcto, nunca antes: activar el acceso
      // rápido a una sesión que no se ha probado que exista no tiene sentido.
      await _ofrecerActivarBiometria();

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

  /// Propone activar el acceso biométrico tras un login correcto.
  ///
  /// No insiste: si el operario dice que no, no se le vuelve a preguntar en
  /// este login. Puede activarlo cuando quiera desde el botón de la barra
  /// superior de la pantalla de asistencias.
  Future<void> _ofrecerActivarBiometria() async {
    if (await SesionSegura.biometriaActivada()) return;
    if (!await Biometria.disponible()) return;
    final face = await Biometria.esFaceId();
    final nombre = face ? 'Face ID' : 'la huella';
    if (!mounted) return;

    final quiere = await showDialog<bool>(
      context: context,
      builder: (_) => AlertDialog(
        backgroundColor: AppColors.surface,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
        title: Text(
          face ? 'Usar Face ID' : 'Usar la huella',
          style: const TextStyle(color: AppColors.textPrimary),
        ),
        content: Text(
          'La próxima vez podrás entrar con $nombre en lugar de escribir tu '
          'PIN. Podrás desactivarlo cuando quieras.',
          style: const TextStyle(color: AppColors.textSecondary),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('Ahora no', style: TextStyle(color: AppColors.textSecondary)),
          ),
          TextButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('Activar', style: TextStyle(color: AppColors.primary)),
          ),
        ],
      ),
    );
    if (quiere != true) return;

    // Se pide la biometría YA, antes de dar nada por activado: así el operario
    // comprueba en el momento que funciona, en vez de descubrir en el próximo
    // arranque que su cara no estaba enrolada.
    final r = await Biometria.autenticar(
      face
          ? 'Confirma tu cara para activar el acceso con Face ID'
          : 'Confirma tu huella para activar el acceso rápido',
    );
    if (r == ResultadoBiometria.ok) {
      await SesionSegura.activarBiometria();
      return;
    }
    if (!mounted) return;
    if (r == ResultadoBiometria.cancelado) return; // cancelar no es un error
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(
      content: Text(
        r == ResultadoBiometria.noDisponible
            ? 'No se ha podido activar: revisa la biometría en los ajustes del teléfono.'
            : 'No se ha podido activar el acceso biométrico.',
      ),
      backgroundColor: AppColors.info,
    ));
  }

  /// Entrar con la cara/huella: desbloquea la credencial guardada y con ella
  /// hace un login normal contra el servidor.
  Future<void> _entrarConBiometria() async {
    setState(() { _loading = true; _error = null; });
    try {
      final r = await Biometria.autenticar(
        'Accede a Mobilink Assist con tu $_nombreBiometria',
      );
      if (r == ResultadoBiometria.cancelado) return;

      if (r == ResultadoBiometria.noDisponible) {
        await SesionSegura.desactivarBiometria();
        if (!mounted) return;
        setState(() {
          _biometriaOfrecible = false;
          _error = 'La biometría ya no está disponible en este teléfono. '
              'Entra con tu nombre y PIN.';
        });
        return;
      }
      if (r != ResultadoBiometria.ok) {
        setState(() => _error = 'No se ha reconocido tu $_nombreBiometria. '
            'Vuelve a intentarlo o entra con tu PIN.');
        return;
      }

      final cred = await SesionSegura.leer();
      if (cred == null) {
        // La credencial se ha ido por debajo (sesión cerrada en otro sitio).
        await SesionSegura.desactivarBiometria();
        if (!mounted) return;
        setState(() {
          _biometriaOfrecible = false;
          _error = 'Tu sesión ya no está guardada. Entra con tu nombre y PIN.';
        });
        return;
      }

      // La biometría abre la caja; quien decide si la credencial vale sigue
      // siendo el backend.
      await ApiService.login(cred.techName, cred.code);
      if (!mounted) return;
      Navigator.of(context).pushReplacement(
        MaterialPageRoute(
          builder: (_) => AssistancesScreen(
            api: ApiService(techName: cred.techName, code: cred.code),
          ),
        ),
      );
    } catch (e) {
      if (mounted) {
        setState(() => _error = e.toString().replaceFirst('Exception: ', ''));
      }
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
                  // scaleDown: en vertical el ancho útil puede ser menor de 360.
                  FittedBox(
                    fit: BoxFit.scaleDown,
                    child: Image.asset('assets/logo_horizontal2.png', width: 360),
                  ),
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

                  // Dígitos PIN (scaleDown: 4 casillas de 64 no caben en el
                  // ancho útil de una pantalla estrecha en vertical)
                  FittedBox(
                    fit: BoxFit.scaleDown,
                    child: Row(
                    mainAxisSize: MainAxisSize.min,
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

                  // ── Acceso biométrico ──────────────────────────────
                  //
                  // Debajo del botón de siempre y con menos peso visual, no
                  // encima: el nombre y el PIN tienen que seguir siendo el
                  // camino evidente para quien no lo tenga activado o para
                  // quien la cara le falle en mitad de una guardia.
                  if (_biometriaOfrecible) ...[
                    const SizedBox(height: 20),
                    SizedBox(
                      width: double.infinity,
                      child: OutlinedButton.icon(
                        onPressed: _loading ? null : _entrarConBiometria,
                        icon: Icon(
                          _esFaceId ? Icons.face_retouching_natural : Icons.fingerprint,
                          size: 24,
                          color: AppColors.primary,
                        ),
                        label: Text(
                          _esFaceId ? 'Entrar con Face ID' : 'Entrar con huella',
                          style: const TextStyle(color: AppColors.primary),
                        ),
                        style: OutlinedButton.styleFrom(
                          padding: const EdgeInsets.symmetric(vertical: 14),
                          side: const BorderSide(color: AppColors.primary),
                          shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(8),
                          ),
                        ),
                      ),
                    ),
                  ],
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
