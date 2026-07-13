import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:supabase_flutter/supabase_flutter.dart' show PostgrestException;
import '../models/models.dart';
import '../models/umbrales.dart';
import '../services/offline_store.dart';
import '../services/probe_session.dart';
import '../services/supabase_service.dart';
import '../services/tlgx_probe_service.dart';
import '../theme/app_theme.dart';
import '../widgets/vehicle_schema.dart';
import '../widgets/vehicle_layout_image.dart';
import 'tire_detail_screen.dart';

/// Pantalla 4: revision. Modo asistente automatico: el tecnico no
/// decide que rueda toca ahora, simplemente avanza. Con la sonda TLGX3
/// conectada (P0), la rueda resaltada recibe la medida y la app avanza
/// sola cuando todo esta correcto (camino rapido); si hay anomalia abre
/// la ficha para confirmar/fotografiar (camino de excepcion).
class ReviewScreen extends StatefulWidget {
  final Vehiculo vehiculo;
  final RevisionVehiculo? revisionExistente;
  const ReviewScreen({super.key, required this.vehiculo, this.revisionExistente});

  @override
  State<ReviewScreen> createState() => _ReviewScreenState();
}

class _ReviewScreenState extends State<ReviewScreen> {
  bool _cargando = true;
  String? _error;

  List<PosicionVehiculo> _posiciones = [];
  final Map<String, MontajeActual> _montajePorPosicion = {};
  final Map<String, String> _posPorEpc = {}; // rfid_epc (mayúsculas) → posicionId
  Map<String, String> _fotosModelo = {}; // claveModeloCatalogo → url foto del catálogo
  String? _imagenChasis; // foto/plano del vehículo (si está configurada)
  num _kmRevision = 0; // km del vehículo para esta revisión (Webfleet si está enlazado)
  final Map<String, RevisionDetalleDraft> _detalles = {};
  RevisionVehiculo? _revision;
  int _index = 0;
  bool _finalizando = false;
  bool _ofreciendoFinal = false; // hay un diálogo de finalizar abierto
  bool _finalOfrecidoYa = false; // ya se ofreció auto-finalizar en esta tanda

  // ── Sonda / modo ruta ────────────────────────────────────────
  final ProbeSession _sonda = ProbeSession.instance;
  StreamSubscription<LecturaSonda>? _lecturaSub;
  Timer? _commitTimer;
  bool _modoRuta = true;
  double? _liveProf; // medida en curso para la rueda activa
  double? _livePres;

  @override
  void initState() {
    super.initState();
    _cargar();
    _lecturaSub = _sonda.onLectura.listen(_onLectura);
    _sonda.addListener(_onSonda);
  }

  @override
  void dispose() {
    _lecturaSub?.cancel();
    _commitTimer?.cancel();
    _sonda.removeListener(_onSonda);
    // La sesion de sonda NO se desconecta: sigue viva para el siguiente vehiculo.
    super.dispose();
  }

  void _onSonda() {
    if (mounted) setState(() {});
  }

  Future<void> _cargar() async {
    setState(() {
      _cargando = true;
      _error = null;
    });
    try {
      final tipoId = widget.vehiculo.tipoVehiculoId;
      if (tipoId == null) {
        setState(() => _error = 'Este vehículo no tiene un tipo con posiciones configuradas.');
        return;
      }
      final posiciones = await TyreControlApi.listarPosiciones(tipoId);
      // Orden de revisión: si está configurado en el panel (orden_revision),
      // se respeta; si no, recorrido físico alrededor del vehículo → lado
      // derecho de delante hacia atrás, luego izquierdo de atrás hacia delante
      // (1 Del. der, 2 Tra. der, 3 Tra. izq, 4 Del. izq).
      final hayOrdenConfig = posiciones.any((p) => p.ordenRevision != null);
      posiciones.sort((a, b) {
        if (hayOrdenConfig) {
          final oa = a.ordenRevision ?? 100000;
          final ob = b.ordenRevision ?? 100000;
          if (oa != ob) return oa.compareTo(ob);
        }
        return _ordenRevision(a).compareTo(_ordenRevision(b));
      });
      _imagenChasis = await TyreControlApi.obtenerImagenChasis(widget.vehiculo);
      final montajes = await TyreControlApi.listarMontajesVehiculo(widget.vehiculo.id);
      _montajePorPosicion.clear();
      _posPorEpc.clear();
      for (final m in montajes) {
        _montajePorPosicion[m.posicionId] = m;
        final epc = m.neumatico?.rfidEpc;
        if (epc != null && epc.isNotEmpty) _posPorEpc[epc.toUpperCase()] = m.posicionId;
      }

      // Km automáticos de Webfleet: si el vehículo está enlazado, se leen los
      // km reales al empezar la revisión y quedan registrados en ella.
      _kmRevision = widget.vehiculo.kmActual;
      final wfId = widget.vehiculo.webfleetVehicleId;
      if (widget.revisionExistente == null && wfId != null && wfId.isNotEmpty) {
        final kmWf = await TyreControlApi.obtenerKmWebfleet(widget.vehiculo.empresaId, wfId);
        if (kmWf != null) {
          _kmRevision = kmWf;
          await TyreControlApi.actualizarKmVehiculo(widget.vehiculo.id, kmWf);
        }
      }

      _revision = widget.revisionExistente ??
          await TyreControlApi.crearRevision(
            empresaId: widget.vehiculo.empresaId,
            vehiculoId: widget.vehiculo.id,
            kmVehiculo: _kmRevision,
          );

      for (final p in posiciones) {
        _detalles[p.id] = RevisionDetalleDraft(posicionId: p.id, neumaticoId: _montajePorPosicion[p.id]?.neumaticoId);
      }

      // Fotos de modelo del catálogo, con caché para trabajar sin cobertura.
      // Si falla no bloquea la revisión: simplemente no se muestra foto.
      try {
        _fotosModelo = await TyreControlApi.fotosCatalogoPorModelo();
        await OfflineStore.cacheJson('fotos_modelo_catalogo', _fotosModelo);
      } catch (_) {
        final raw = OfflineStore.cachedJson('fotos_modelo_catalogo');
        if (raw is Map) {
          _fotosModelo = raw.map((k, v) => MapEntry(k.toString(), v.toString()));
        }
      }

      if (!mounted) return;
      setState(() => _posiciones = posiciones);
    } catch (e) {
      setState(() => _error = 'No se pudo cargar el vehículo. Comprueba la conexión e inténtalo de nuevo.');
    } finally {
      if (mounted) setState(() => _cargando = false);
    }
  }

  // ── Estado visual de cada posicion ───────────────────────────
  TireStatus _statusDe(PosicionVehiculo p) {
    if (p.id == _posiciones.elementAtOrNull(_index)?.id) return TireStatus.seleccionado;
    final d = _detalles[p.id];
    if (d == null || !d.medido) return TireStatus.pendiente;
    return Umbrales.def.evaluar(d);
  }

  bool get _todoRevisado => _posiciones.every((p) => _detalles[p.id]?.medido ?? false);

  // Orden de revisión (recorrido en circuito alrededor del vehículo):
  // lado derecho de delante hacia atrás y lado izquierdo de atrás hacia
  // delante. Exterior antes que interior en ruedas gemelas.
  double _ordenRevision(PosicionVehiculo p) {
    final eje = (p.eje ?? 0).toDouble();
    final ext = p.interiorExterior == 'int' ? 0.5 : 0.0;
    if (p.lado == 'der') return eje + ext; // 1..N: delante → atrás
    if (p.lado == 'izq') return 1000 - eje + ext; // atrás → delante
    return 500 + p.ordenVisual.toDouble(); // centro / sin lado
  }

  // ── Sonda: cada lectura va a la rueda activa ─────────────────
  void _onLectura(LecturaSonda r) {
    if (!mounted) return;

    // RFID: la sonda nos dice QUÉ rueda estamos midiendo → la seleccionamos
    // sola. Así el técnico no tiene que tocar el plano.
    if (r.tipo == LecturaTipo.rfid && r.texto != null) {
      _autoPosicionarPorRfid(r.texto!);
      return;
    }

    final activa = _posiciones.elementAtOrNull(_index);
    if (activa == null) return;

    bool nuevaProfundidad = false;
    if (r.tipo == LecturaTipo.profundidad && r.valor != null) {
      _liveProf = r.valor;
      nuevaProfundidad = true;
    } else if (r.tipo == LecturaTipo.presion && r.valor != null) {
      _livePres = r.valor; // ya en bar
    }
    setState(() {});

    // La profundidad es la accion deliberada (apoyar la sonda en la banda):
    // dispara el guardado tras un breve margen para recoger tambien la presion.
    if (_modoRuta && _sonda.conectada && nuevaProfundidad) {
      _commitTimer?.cancel();
      _commitTimer = Timer(const Duration(milliseconds: 700), () {
        if (mounted) _commitActiva(activa);
      });
    }
  }

  /// Selecciona la posición cuyo neumático montado tiene este EPC. Si el tag
  /// no corresponde a ninguna rueda de este vehículo, avisa sin cambiar nada.
  void _autoPosicionarPorRfid(String epc) {
    final posId = _posPorEpc[epc.toUpperCase()];
    if (posId == null) {
      HapticFeedback.selectionClick();
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Tag RFID no reconocido en este vehículo'), duration: Duration(seconds: 2)),
      );
      return;
    }
    final idx = _posiciones.indexWhere((p) => p.id == posId);
    if (idx < 0 || idx == _index) return;

    // Cambiamos de rueda: descartamos cualquier medida en curso de la anterior.
    _commitTimer?.cancel();
    _liveProf = null;
    _livePres = null;
    HapticFeedback.selectionClick();
    setState(() => _index = idx);
  }

  Future<void> _commitActiva(PosicionVehiculo p) async {
    final draft = _detalles[p.id];
    if (draft == null) return;
    final prof = _liveProf;
    final pres = _livePres;
    if (prof == null && pres == null) return;

    draft
      ..profundidadMm = prof ?? draft.profundidadMm
      ..presionBar = pres ?? draft.presionBar
      ..metodoProfundidad = prof != null ? 'sonda' : draft.metodoProfundidad
      ..metodoPresion = pres != null ? 'sonda' : draft.metodoPresion;
    _liveProf = null;
    _livePres = null;

    await _guardarDraft(p, draft);
    if (!mounted) return;

    if (Umbrales.def.esAnomalia(draft)) {
      // Camino de excepcion: aviso fuerte y ficha para confirmar/fotografiar.
      HapticFeedback.heavyImpact();
      await _abrirNeumatico(p);
    } else {
      // Camino rapido: correcto, avanza solo.
      HapticFeedback.mediumImpact();
      setState(() {});
      _avanzarSiguiente();
    }
  }

  Future<void> _guardarDraft(PosicionVehiculo p, RevisionDetalleDraft draft) async {
    final payload = draft.toJson(
      revisionId: _revision!.id,
      empresaId: widget.vehiculo.empresaId,
      vehiculoId: widget.vehiculo.id,
    );
    try {
      // Online primero: si hay cobertura, se guarda directo en el servidor.
      await TyreControlApi.guardarDetalleRevision(payload);
      OfflineStore.offline.value = false;
    } on PostgrestException catch (e) {
      // El servidor respondió y rechazó el dato (no es falta de cobertura):
      // se aparta al buzón de errores para no bloquear y seguimos online.
      await OfflineStore.parkFailed({'type': 'detalle', 'payload': payload}, e.message);
    } catch (_) {
      // Sin cobertura: a la cola, se enviará solo al recuperar la conexión.
      OfflineStore.offline.value = true;
      await OfflineStore.enqueueDetalle(payload);
    }
  }

  int? _siguientePendiente() {
    for (int i = 0; i < _posiciones.length; i++) {
      if (!(_detalles[_posiciones[i].id]?.medido ?? false)) return i;
    }
    return null;
  }

  void _avanzarSiguiente() {
    final next = _siguientePendiente();
    setState(() {
      if (next != null) _index = next;
    });
    // (A) Al medir la última rueda ya no queda pendiente: ofrecemos finalizar
    // automáticamente (una sola vez por tanda, con confirmación). Si el técnico
    // sigue midiendo o queda algo pendiente, se rearma para la próxima vez.
    if (next == null && _todoRevisado) {
      if (!_finalOfrecidoYa) {
        _finalOfrecidoYa = true;
        _ofrecerFinalizar();
      }
    } else {
      _finalOfrecidoYa = false;
    }
  }

  /// (A) Diálogo automático al completar todas las ruedas.
  Future<void> _ofrecerFinalizar() async {
    if (_ofreciendoFinal || _finalizando || !mounted) return;
    _ofreciendoFinal = true;
    HapticFeedback.mediumImpact();
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Revisión completa'),
        content: const Text('Has medido todas las ruedas. ¿Finalizar la revisión?'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Seguir revisando')),
          FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Finalizar')),
        ],
      ),
    );
    _ofreciendoFinal = false;
    if (ok == true) await _finalizar();
  }

  /// (B) Finalizar manual: si quedan posiciones sin medir, avisa y pide
  /// confirmación antes de cerrar (repuesto, sin neumático, saltadas…).
  Future<void> _finalizarConAviso() async {
    final pendientes = _posiciones.where((p) => !(_detalles[p.id]?.medido ?? false)).toList();
    if (pendientes.isNotEmpty) {
      final nombres = pendientes.map((p) => p.nombre ?? p.codigoPosicion).join(', ');
      final ok = await showDialog<bool>(
        context: context,
        builder: (ctx) => AlertDialog(
          title: const Text('Quedan posiciones sin medir'),
          content: Text('Faltan ${pendientes.length} de ${_posiciones.length}: $nombres.\n\n¿Finalizar la revisión de todos modos?'),
          actions: [
            TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Seguir revisando')),
            FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Finalizar igualmente')),
          ],
        ),
      );
      if (ok != true) return;
    }
    await _finalizar();
  }

  void _saltar() {
    setState(() {
      if (_index < _posiciones.length - 1) _index++;
    });
  }

  Future<void> _abrirNeumatico(PosicionVehiculo p) async {
    final idx = _posiciones.indexOf(p);
    setState(() => _index = idx);
    final montaje = _montajePorPosicion[p.id];
    final draft = _detalles[p.id]!;
    final resultado = await Navigator.of(context).push<RevisionDetalleDraft>(
      MaterialPageRoute(
        builder: (_) => TireDetailScreen(
          posicion: p,
          neumatico: montaje?.neumatico,
          fotoModeloUrl: _fotosModelo[claveModeloCatalogo(montaje?.neumatico?.marca, montaje?.neumatico?.modelo)],
          draft: draft,
          revision: _revision!,
          vehiculo: widget.vehiculo,
        ),
      ),
    );
    if (resultado != null) {
      setState(() => _detalles[p.id] = resultado);
      _avanzarSiguiente();
    }
  }

  Future<void> _conectarSonda() async {
    await _sonda.conectar();
    if (!mounted) return;
    if (_sonda.error.isNotEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('${_sonda.error}  (puedes elegirla en Herramientas)')),
      );
    }
  }

  Future<void> _finalizar() async {
    setState(() => _finalizando = true);
    try {
      if (OfflineStore.pendingCount.value > 0) {
        // Hay detalles en cola (no había cobertura al medirlos): encolamos el
        // completar para que suba DESPUÉS de ellos e intentamos vaciar ya
        // (si hay cobertura, se sube todo ahora → online).
        await OfflineStore.enqueueCompletar(_revision!.id);
        await OfflineStore.flush();
      } else {
        // Todo guardado online: completamos directo en el servidor.
        try {
          await TyreControlApi.completarRevision(_revision!.id);
          OfflineStore.offline.value = false;
        } on PostgrestException {
          await OfflineStore.enqueueCompletar(_revision!.id);
          await OfflineStore.flush();
        } catch (_) {
          OfflineStore.offline.value = true;
          await OfflineStore.enqueueCompletar(_revision!.id);
        }
      }
      if (!mounted) return;
      final pendientesTrasSync = OfflineStore.pendingCount.value;
      final msg = pendientesTrasSync == 0
          ? 'Revisión finalizada y sincronizada'
          : 'Revisión guardada; se enviará al recuperar la conexión';
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(msg)));
      Navigator.of(context).popUntil((r) => r.isFirst);
    } finally {
      if (mounted) setState(() => _finalizando = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_cargando) {
      return const Scaffold(body: Center(child: CircularProgressIndicator()));
    }
    if (_error != null) {
      return Scaffold(
        appBar: AppBar(title: const Text('Revisión')),
        body: Center(child: Padding(padding: const EdgeInsets.all(24), child: Text(_error!, textAlign: TextAlign.center))),
      );
    }

    final estados = {for (final p in _posiciones) p.id: _statusDe(p)};
    final actual = _posiciones.isEmpty ? null : _posiciones[_index];

    return Scaffold(
      appBar: AppBar(
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(widget.vehiculo.matricula, style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w700)),
            Text('${widget.vehiculo.empresa?.nombre ?? ''} · ${_kmRevision.round()} km', style: const TextStyle(fontSize: 12, color: AppColors.textSecondary)),
          ],
        ),
      ),
      body: Column(
        children: [
          _SondaBar(
            sonda: _sonda,
            medidas: _posiciones.where((p) => _detalles[p.id]?.medido ?? false).length,
            total: _posiciones.length,
            modoRuta: _modoRuta,
            onModoRuta: (v) => setState(() => _modoRuta = v),
            onConectar: _conectarSonda,
          ),
          Expanded(
            child: _imagenChasis != null
                ? Padding(
                    padding: const EdgeInsets.all(10),
                    child: VehicleLayoutImage(
                      imagenUrl: _imagenChasis!,
                      posiciones: _posiciones,
                      montajePorPosicion: _montajePorPosicion,
                      detalles: _detalles,
                      estados: estados,
                      seleccionadaId: actual?.id,
                      liveProf: _liveProf,
                      livePres: _livePres,
                      onTap: _abrirNeumatico,
                    ),
                  )
                : SingleChildScrollView(
                    padding: const EdgeInsets.all(16),
                    child: VehicleSchema(
                      posiciones: _posiciones,
                      estados: estados,
                      seleccionadaId: actual?.id,
                      onTap: _abrirNeumatico,
                    ),
                  ),
          ),
          _PanelInferior(
            actual: actual,
            index: _index,
            total: _posiciones.length,
            sondaLista: _sonda.conectada && _modoRuta,
            liveProf: _liveProf,
            livePres: _livePres,
            pendientes: _posiciones.where((p) => !(_detalles[p.id]?.medido ?? false)).length,
            finalizando: _finalizando,
            onAnterior: _index > 0 ? () => setState(() => _index--) : null,
            onSaltar: _index < _posiciones.length - 1 ? _saltar : null,
            onRevisar: actual == null ? null : () => _abrirNeumatico(actual),
            onFinalizar: _finalizarConAviso,
          ),
        ],
      ),
    );
  }
}

// ── Barra de estado de la sonda ────────────────────────────────
class _SondaBar extends StatelessWidget {
  final ProbeSession sonda;
  final int medidas;
  final int total;
  final bool modoRuta;
  final ValueChanged<bool> onModoRuta;
  final VoidCallback onConectar;

  const _SondaBar({
    required this.sonda,
    required this.medidas,
    required this.total,
    required this.modoRuta,
    required this.onModoRuta,
    required this.onConectar,
  });

  @override
  Widget build(BuildContext context) {
    final conectada = sonda.conectada;
    final texto = conectada
        ? 'Sonda ${sonda.nombre}${sonda.bateria != null ? ' · ${sonda.bateria}V' : ''}'
        : (sonda.conectando ? 'Conectando sonda…' : 'Sonda sin conectar');

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
      decoration: const BoxDecoration(
        color: AppColors.surface,
        border: Border(bottom: BorderSide(color: AppColors.cardBorder)),
      ),
      child: Row(
        children: [
          Icon(
            conectada ? Icons.bluetooth_connected : Icons.bluetooth_disabled,
            size: 20,
            color: conectada ? AppColors.success : AppColors.textSecondary,
          ),
          const SizedBox(width: 8),
          Expanded(child: Text(texto, style: const TextStyle(fontSize: 13, color: AppColors.textSecondary), overflow: TextOverflow.ellipsis)),
          Text('$medidas/$total', style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w700, color: AppColors.textPrimary)),
          const SizedBox(width: 8),
          if (conectada)
            Row(
              children: [
                const Text('Ruta', style: TextStyle(fontSize: 12, color: AppColors.textSecondary)),
                Switch(value: modoRuta, onChanged: onModoRuta),
              ],
            )
          else
            TextButton(
              onPressed: sonda.conectando ? null : onConectar,
              child: const Text('Conectar'),
            ),
        ],
      ),
    );
  }
}

// ── Panel inferior: guia de la posicion activa + acciones ──────
class _PanelInferior extends StatelessWidget {
  final PosicionVehiculo? actual;
  final int index;
  final int total;
  final bool sondaLista;
  final double? liveProf;
  final double? livePres;
  final int pendientes;
  final bool finalizando;
  final VoidCallback? onAnterior;
  final VoidCallback? onSaltar;
  final VoidCallback? onRevisar;
  final VoidCallback onFinalizar;

  const _PanelInferior({
    required this.actual,
    required this.index,
    required this.total,
    required this.sondaLista,
    required this.liveProf,
    required this.livePres,
    required this.pendientes,
    required this.finalizando,
    required this.onAnterior,
    required this.onSaltar,
    required this.onRevisar,
    required this.onFinalizar,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: const BoxDecoration(border: Border(top: BorderSide(color: AppColors.cardBorder))),
      child: Column(
        children: [
          if (actual != null)
            Text('${actual!.nombre ?? actual!.codigoPosicion} (${index + 1} de $total)',
                style: const TextStyle(color: AppColors.textSecondary, fontSize: 13)),
          if (sondaLista) ...[
            const SizedBox(height: 8),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
              decoration: BoxDecoration(
                color: AppColors.surfaceVariant,
                borderRadius: BorderRadius.circular(12),
                border: Border.all(color: AppColors.cardBorder),
              ),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.spaceEvenly,
                children: [
                  _LiveValor(icon: Icons.straighten, label: 'Profundidad', valor: liveProf != null ? '${liveProf!.toStringAsFixed(1)} mm' : '— mm'),
                  _LiveValor(icon: Icons.speed, label: 'Presión', valor: livePres != null ? '${livePres!.toStringAsFixed(1)} bar' : '— bar'),
                ],
              ),
            ),
            const SizedBox(height: 6),
            const Text('Apoya la sonda: si la rueda lleva RFID, se selecciona sola.', style: TextStyle(color: AppColors.textHint, fontSize: 12)),
          ],
          const SizedBox(height: 10),
          Row(
            children: [
              Expanded(
                child: OutlinedButton.icon(
                  onPressed: onAnterior,
                  icon: const Icon(Icons.arrow_back),
                  label: const Text('Anterior'),
                ),
              ),
              const SizedBox(width: 8),
              if (onSaltar != null) ...[
                Expanded(
                  child: OutlinedButton.icon(
                    onPressed: onSaltar,
                    icon: const Icon(Icons.skip_next),
                    label: const Text('Saltar'),
                  ),
                ),
                const SizedBox(width: 8),
              ],
              Expanded(
                child: ElevatedButton.icon(
                  onPressed: onRevisar,
                  icon: const Icon(Icons.build_circle_outlined),
                  label: const Text('Revisar'),
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),
          if (pendientes > 0)
            Padding(
              padding: const EdgeInsets.only(bottom: 6),
              child: Text(
                'Quedan $pendientes ${pendientes == 1 ? 'posición' : 'posiciones'} sin medir',
                style: const TextStyle(color: AppColors.warning, fontSize: 12, fontWeight: FontWeight.w600),
                textAlign: TextAlign.center,
              ),
            ),
          SizedBox(
            width: double.infinity,
            child: ElevatedButton.icon(
              onPressed: finalizando ? null : onFinalizar,
              style: ElevatedButton.styleFrom(
                backgroundColor: pendientes == 0 ? AppColors.success : AppColors.surfaceVariant,
                foregroundColor: pendientes == 0 ? Colors.white : AppColors.textPrimary,
              ),
              icon: finalizando
                  ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                  : const Icon(Icons.check_circle),
              label: const Text('Finalizar revisión'),
            ),
          ),
        ],
      ),
    );
  }
}

class _LiveValor extends StatelessWidget {
  final IconData icon;
  final String label;
  final String valor;
  const _LiveValor({required this.icon, required this.label, required this.valor});

  @override
  Widget build(BuildContext context) {
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        Row(
          children: [
            Icon(icon, size: 14, color: AppColors.textSecondary),
            const SizedBox(width: 4),
            Text(label, style: const TextStyle(color: AppColors.textSecondary, fontSize: 11)),
          ],
        ),
        const SizedBox(height: 2),
        Text(valor, style: const TextStyle(color: AppColors.textPrimary, fontSize: 20, fontWeight: FontWeight.bold)),
      ],
    );
  }
}
