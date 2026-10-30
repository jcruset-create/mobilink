import 'package:flutter/material.dart';
import '../models/models.dart';
import '../services/offline_store.dart';
import '../services/supabase_service.dart';
import '../theme/app_theme.dart';
import '../widgets/km_vehiculo.dart';
import 'review_screen.dart';

/// Ficha de confirmacion tras identificar el vehiculo. Un solo boton
/// de accion: no hay nada mas que decidir aqui.
class ConfirmVehicleScreen extends StatefulWidget {
  final Vehiculo vehiculo;
  const ConfirmVehicleScreen({super.key, required this.vehiculo});

  @override
  State<ConfirmVehicleScreen> createState() => _ConfirmVehicleScreenState();
}

class _ConfirmVehicleScreenState extends State<ConfirmVehicleScreen> {
  bool _cargando = false;
  RevisionVehiculo? _ultimaRevision;
  int _numNeumaticos = 0;
  bool _verificarPresiones = true;
  /// Km que teclea el técnico cuando el vehículo no los da solo. Null hasta
  /// que los informa; entonces viajan a la revisión.
  int? _kmManual;
  /*
   * La lectura del odómetro, preguntada al Hub nada más abrir.
   *
   * Antes esta pantalla decidía con `vehiculo.kmAutomaticos`, que solo mira si
   * hay un objeto de WEBFLEET enlazado. Un cliente de Movertis —632 vehículos
   * enlazados en Plana— veía siempre el botón naranja «Informar kilómetros» y
   * tecleaba un número que la revisión descartaba acto seguido, porque allí sí
   * se pregunta al Hub. Aquí se pregunta lo mismo y se enseña lo que conteste.
   *
   * La consulta no escribe nada: quien guarda los km es la revisión, con el
   * técnico delante. Y nunca lanza: si el proveedor está caído, `_lecturaKm`
   * se queda sin número y la pantalla vuelve a pedirlos a mano, como antes.
   */
  Map<String, dynamic>? _lecturaKm;
  bool _consultandoKm = true;

  @override
  void initState() {
    super.initState();
    _cargarContexto();
    _consultarKm();
  }

  /// Va aparte de `_cargarContexto` a propósito: una telemática lenta o caída
  /// no puede retrasar ni tumbar el resto de la ficha.
  Future<void> _consultarKm() async {
    final l = await TyreControlApi.kilometrajeActual(widget.vehiculo.id);
    if (!mounted) return;
    setState(() {
      _lecturaKm = l;
      _consultandoKm = false;
    });
  }

  Future<void> _cargarContexto() async {
    try {
      final ultima = await TyreControlApi.obtenerUltimaRevision(widget.vehiculo.id);
      int n = 0;
      if (widget.vehiculo.tipoVehiculoId != null) {
        final pos = await TyreControlApi.listarPosiciones(widget.vehiculo.tipoVehiculoId!);
        n = pos.length;
      }
      if (!mounted) return;
      setState(() {
        _ultimaRevision = ultima;
        _numNeumaticos = n;
      });
    } catch (_) {
      // Sin red: seguimos, la ficha basica ya la tenemos
    }
  }

  Future<void> _pedirKm() async {
    final v = await pedirKmVehiculo(context, matricula: widget.vehiculo.matricula, actual: _kmManual);
    if (v == null || !mounted) return;
    setState(() => _kmManual = v);
    // Se guardan ya en la ficha del vehículo: aunque el técnico se salga sin
    // empezar la revisión, el dato no se pierde.
    await TyreControlApi.actualizarKmVehiculo(widget.vehiculo.id, v, origen: 'manual');
  }

  Future<void> _confirmar() async {
    setState(() => _cargando = true);
    try {
      await OfflineStore.agregarVehiculoReciente({
        'id': widget.vehiculo.id,
        'matricula': widget.vehiculo.matricula,
        'numero_unidad': widget.vehiculo.numeroUnidad,
        'empresa_id': widget.vehiculo.empresaId,
        'km_actual': widget.vehiculo.kmActual,
        'activo': true,
      });
      if (!mounted) return;
      Navigator.of(context).push(MaterialPageRoute(
          builder: (_) => ReviewScreen(
              vehiculo: widget.vehiculo,
              verificarPresiones: _verificarPresiones,
              kmManual: _kmManual,
              // Se le pasa la lectura para que no vuelva a gastar cupo del
              // proveedor tres segundos después. Si ha caducado, la revisión
              // pregunta igual: lo decide `lecturaSigueValiendo`.
              lecturaKm: _lecturaKm)));
    } finally {
      if (mounted) setState(() => _cargando = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final v = widget.vehiculo;
    return Scaffold(
      appBar: AppBar(title: const Text('Confirmar vehículo')),
      body: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Container(
              height: 140,
              decoration: BoxDecoration(color: AppColors.surfaceVariant, borderRadius: BorderRadius.circular(16)),
              child: const Center(child: Icon(Icons.local_shipping, size: 56, color: AppColors.textSecondary)),
            ),
            const SizedBox(height: 16),
            Text(v.matricula, style: Theme.of(context).textTheme.displayLarge, textAlign: TextAlign.center),
            if (v.numeroUnidad != null)
              Center(child: Text('Unidad ${v.numeroUnidad}', style: const TextStyle(color: AppColors.textSecondary, fontSize: 16))),
            const SizedBox(height: 20),
            Card(
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    _Fila('Cliente', v.empresa?.nombre),
                    _Fila('Marca / Modelo', [v.marca, v.modelo].where((e) => e != null && e.isNotEmpty).join(' ')),
                    _Fila('Tipo', v.tipo?.descripcion ?? v.tipo?.nombre),
                    _Fila('Configuración de ejes', v.tipo?.configuracionEjes),
                    _Fila('Nº de neumáticos', _numNeumaticos > 0 ? '$_numNeumaticos' : null),
                    _FilaKm(
                      kmManual: _kmManual,
                      kmFicha: v.kmActual > 0 ? v.kmActual : null,
                      lectura: _lecturaKm,
                      consultando: _consultandoKm,
                      onEditar: _pedirKm,
                    ),
                    _Fila('Última revisión', _ultimaRevision?.fechaRevision),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 12),
            Card(
              child: SwitchListTile(
                value: _verificarPresiones,
                onChanged: (v) => setState(() => _verificarPresiones = v),
                title: const Text('Verificar presiones', style: TextStyle(fontWeight: FontWeight.w700)),
                subtitle: const Text(
                    'Si está activo, cada rueda necesita profundidad Y presión para avanzar automáticamente a la siguiente.',
                    style: TextStyle(color: AppColors.textSecondary, fontSize: 12)),
                secondary: const Icon(Icons.speed, color: AppColors.primary),
                activeColor: AppColors.primary,
              ),
            ),
            const Spacer(),
            ElevatedButton.icon(
              onPressed: _cargando ? null : _confirmar,
              icon: const Icon(Icons.check_circle),
              label: const Text('Confirmar vehículo'),
            ),
          ],
        ),
      ),
    );
  }
}

class _Fila extends StatelessWidget {
  final String label;
  final String? value;
  const _Fila(this.label, this.value);

  @override
  Widget build(BuildContext context) {
    final v = value;
    final texto = (v == null || v.isEmpty) ? '—' : v;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 5),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(width: 150, child: Text(label, style: const TextStyle(color: AppColors.textSecondary, fontSize: 13))),
          Expanded(child: Text(texto, style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600))),
        ],
      ),
    );
  }
}

/// Fila de kilómetros.
///
/// Decide con la LECTURA que ha contestado el Hub, no con
/// `vehiculo.kmAutomaticos`: ese flag solo sabe de Webfleet y deja fuera a
/// todo cliente de Movertis. Tres estados, y el técnico siempre puede
/// teclear: la telemetría rellena el campo, no lo secuestra.
class _FilaKm extends StatelessWidget {
  /// Lo que ha tecleado el técnico en esta pantalla. Si hay algo, manda.
  final int? kmManual;
  /// El último km guardado en la ficha. Es el peor de los tres: puede ser de
  /// hace meses. Solo se usa si no hay nada mejor.
  final num? kmFicha;
  final Map<String, dynamic>? lectura;
  final bool consultando;
  final VoidCallback onEditar;
  const _FilaKm({
    required this.kmManual,
    required this.kmFicha,
    required this.lectura,
    required this.consultando,
    required this.onEditar,
  });

  @override
  Widget build(BuildContext context) {
    final kmLectura = lectura?['km'] as num?;
    final estado = lectura?['estado'] as String?;
    // El orden importa: lo que el técnico ha confirmado a mano no se le pisa.
    final telematica = kmManual == null && kmLectura != null;
    final valor = kmManual ?? kmLectura ?? kmFicha;

    Widget contenido;
    if (consultando && kmManual == null) {
      contenido = const Row(children: [
        SizedBox(width: 14, height: 14, child: CircularProgressIndicator(strokeWidth: 2)),
        SizedBox(width: 8),
        Text('Consultando telemetría…',
            style: TextStyle(color: AppColors.textSecondary, fontSize: 13)),
      ]);
    } else if (telematica) {
      // Con número del proveedor: se enseña con su procedencia y se deja
      // corregir. Un odómetro de hace rato sigue valiendo —lo que no se mueve
      // no suma kilómetros— pero el técnico tiene derecho a saberlo.
      final viejo = estado == 'lectura_anterior';
      contenido = Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        InkWell(
          onTap: onEditar,
          borderRadius: BorderRadius.circular(8),
          child: Padding(
            padding: const EdgeInsets.symmetric(vertical: 2),
            child: Row(children: [
              Text('${valor!.round()} km',
                  style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600)),
              const SizedBox(width: 8),
              Icon(Icons.satellite_alt, size: 14,
                  color: viejo ? AppColors.warning : AppColors.textSecondary),
              const SizedBox(width: 4),
              Text('telemática',
                  style: TextStyle(
                      color: viejo ? AppColors.warning : AppColors.textSecondary, fontSize: 12)),
              const SizedBox(width: 6),
              const Icon(Icons.edit, size: 12, color: AppColors.textSecondary),
            ]),
          ),
        ),
        if ((lectura?['texto'] as String?)?.isNotEmpty == true)
          Text(lectura!['texto'] as String,
              style: TextStyle(
                  color: viejo ? AppColors.warning : AppColors.textHint, fontSize: 11)),
      ]);
    } else {
      // Sin telemática, con el proveedor caído o con un equipo que no da
      // cuentakilómetros: como siempre, los pide el técnico.
      final tiene = (valor ?? 0) > 0;
      contenido = OutlinedButton.icon(
        onPressed: onEditar,
        icon: Icon(tiene ? Icons.edit : Icons.speed,
            size: 16, color: tiene ? AppColors.textPrimary : AppColors.warning),
        label: Text(
          tiene ? '${valor!.round()} km' : 'Informar kilómetros',
          style: TextStyle(
              fontSize: 15,
              fontWeight: FontWeight.w600,
              color: tiene ? AppColors.textPrimary : AppColors.warning),
        ),
        style: OutlinedButton.styleFrom(
          side: BorderSide(color: tiene ? AppColors.cardBorder : AppColors.warning),
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
        ),
      );
    }

    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 5),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const SizedBox(
              width: 150,
              child: Text('Km actuales',
                  style: TextStyle(color: AppColors.textSecondary, fontSize: 13))),
          Expanded(child: contenido),
        ],
      ),
    );
  }
}
