# Modulo asistencias carretera

## Objetivo

Integrar la asistencia movil dentro del programa actual de gestion de taller, sin separar datos ni duplicar operarios. El panel de oficina crea y controla asistencias; mas adelante la app de operario, WhatsApp, Google Maps, Webfleet y PDF trabajaran sobre la misma entidad.

## Base de datos inicial

### `roadside_assistances`

Tabla principal de cada asistencia.

- `id`: identificador interno.
- `workshopId`: taller SEA asociado.
- `status`: `pendiente`, `asignada`, `en_camino`, `en_punto`, `finalizada`, `llegada_taller`, `cancelada`.
- `priority`: `normal` o `urgente`.
- `customerName`, `customerPhone`: cliente y telefono WhatsApp.
- `address`, `googleMapsUrl`, `latitude`, `longitude`: ubicacion de asistencia.
- `plate`, `vehicleDescription`: vehiculo atendido.
- `webfleetVehicleId`: futuro enlace con vehiculo Webfleet.
- `assignedTechName`: operario asignado.
- `assignedVehicleName`: furgoneta o unidad movil asignada.
- `trackingToken`: token privado para pagina de seguimiento del cliente.
- `notes`: observaciones de oficina.
- `createdAtMs`, `assignedAtMs`, `departedAtMs`, `arrivedAtPointMs`, `finishedAtMs`, `arrivedAtWorkshopMs`, `cancelledAtMs`, `updatedAtMs`: tiempos clave.

### `roadside_assistance_events`

Historial de cambios de estado.

- `assistanceId`: asistencia relacionada.
- `status`: estado registrado.
- `note`: observacion opcional.
- `createdBy`: oficina, app operario, sistema, WhatsApp, etc.
- `createdAtMs`: fecha del evento.

### `roadside_assistance_files`

Evidencias futuras.

- `assistanceId`: asistencia relacionada.
- `kind`: `foto`, `firma`, `pdf`, etc.
- `url`: ruta del archivo.
- `fileName`: nombre original.
- `createdAtMs`: fecha de subida.

### `roadside_vehicles`

Catalogo de furgonetas y unidades moviles disponibles para asistencia.

- `id`: identificador interno.
- `workshopId`: taller SEA asociado.
- `name`: nombre visible en el panel.
- `plate`: matricula de la furgoneta.
- `webfleetVehicleId`: identificador futuro para enlazar con Webfleet.
- `notes`: observaciones internas.
- `active`: permite ocultarla del selector sin borrar historico.
- `createdAtMs`, `updatedAtMs`: fechas de alta y ultima modificacion.

## Modulos de desarrollo

### Fase 1 - Oficina y base operativa

- Crear asistencias desde el panel actual.
- Editar datos completos de asistencia desde oficina.
- Asignar operario y furgoneta.
- Cambiar estados principales.
- Guardar tiempos reales de salida, llegada, fin y vuelta a taller.
- Mantener filtro por taller actual.
- Copiar y abrir enlace privado de seguimiento.

Estado actual:

- Tabla `roadside_vehicles` creada.
- API de furgonetas creada:
  - `GET /api/roadside-vehicles`
  - `POST /api/roadside-vehicles`
  - `PUT /api/roadside-vehicles/:id`
  - `DELETE /api/roadside-vehicles/:id`
- El panel permite crear, editar y desactivar furgonetas.
- El formulario de asistencia usa selector de furgonetas activas.

### Fase 2 - App operario

- Login de operario.
- Listado de asistencias asignadas.
- Detalle con cliente, telefono, ubicacion y observaciones.
- Botones: navegar, llamar, en camino, llegado, finalizar.
- Subida de fotos, firma y observaciones.

Estado actual:

- Ruta web movil creada: `/operario/asistencias`.
- Login simple por operario + codigo.
- API movil creada:
  - `POST /api/roadside-operator/login`
  - `GET /api/roadside-operator/assistances`
  - `POST /api/roadside-operator/assistances/:id/status`
- Cada operario puede tener un codigo individual guardado en `techs.roadsideOperatorCode`.
- Si un operario aun no tiene codigo individual, se mantiene respaldo temporal con `ROADSIDE_OPERATOR_CODE` o `APP_PASSWORD`.
- El panel de asistencias permite generar y guardar codigos por operario.
- La vista movil permite llamar, navegar y avanzar estados:
  `en_camino`, `en_punto`, `finalizada`, `llegada_taller`.

### Fase 3 - WhatsApp

- Inicio manual con WhatsApp Business normal.
- Envio de mensajes desde backend al crear/asignar asistencia.
- Enlace privado de seguimiento.
- Migracion posterior a WhatsApp Business API o proveedor.
- Automatizacion de avisos por cambios de estado.

Estado actual:

- Endpoint creado: `POST /api/roadside-assistances/:id/send-tracking-whatsapp`.
- El panel puede enviar el enlace al crear, al asignar o manualmente.
- Se guarda `trackingWhatsappSentAtMs` y `trackingWhatsappSid`.
- Si se configura `TWILIO_ROADSIDE_CONTENT_SID`, se usa plantilla aprobada de Twilio.
- Sin plantilla especifica, se usa mensaje libre; en produccion puede requerir ventana WhatsApp abierta o plantilla aprobada.

### Fase 4 - Maps y Webfleet

- Extraer coordenadas desde enlaces de Google Maps.
- Calcular ETA y distancia.
- Consultar posicion de furgoneta Webfleet.
- Registrar salida, llegada al punto, finalizacion, llegada a taller y kilometros.
- Geozonas para confirmar eventos automaticamente.

### Fase 5 - Cliente e informes

- Pagina privada `/seguimiento/:token`.
- Estado y ETA aproximada.
- Boton llamar.
- Caducidad al finalizar.
- PDF final con datos, tiempos, kilometros, fotos, firma y observaciones.

Estado actual:

- Ruta publica creada: `/seguimiento/:token`.
- API publica creada: `/api/roadside-tracking/:token`.
- La pagina muestra estado, fases, ubicacion, operario/furgoneta y eventos.

## Relacion con el programa actual

- Operarios: se reutiliza `techs`.
- Taller actual: se reutiliza `workshopId`.
- Agenda: en una fase posterior una cita podra generar una asistencia.
- Trabajos de taller: una asistencia podra crear o enlazar un `job` cuando el vehiculo llegue al taller.
- Cobros: se podra reutilizar el modulo de pagos para senales o cobros de asistencia.
- WhatsApp agenda: se aprovecha la infraestructura Twilio ya presente.
