# Mobilink Telematics Engine (MTE)

Motor central de telemática de la plataforma Mobilink. Recibe, decodifica,
normaliza, almacena y distribuye datos de dispositivos GPS y plataformas
telemáticas. Independiente del fabricante, modular y preparado para crecer.

```
Dispositivo GPS (FMC150 / FMC650)
        │ TCP (puerto 5027)
        ▼
Mobilink Telematics Engine (MTE)
        │ Normalización + procesamiento
        ▼
Supabase / PostgreSQL
        │ REST API / WebSocket / eventos
        ▼
Resto de módulos Mobilink (Core, Assist, Fleet, OTF, Panel TV, BI, AI...)
```

## Estado actual

| Capacidad | Estado |
|---|---|
| Servidor TCP Teltonika (múltiples conexiones, IMEI, handshake, ACK) | ✅ |
| Codec 8 y Codec 8 Extended con verificación CRC-16 | ✅ |
| Drivers FMC150 y FMC650 (CAN FMS/J1939) | ✅ |
| Normalización a modelo unificado | ✅ |
| Deduplicación (memoria + unicidad en BD) | ✅ |
| Persistencia Supabase: posición actual, histórico, eventos, viajes | ✅ |
| Geocercas y llegadas (asistencia / cliente / taller) con permanencia | ✅ |
| Viajes y kilómetros (ignición ON→OFF) | ✅ |
| Alertas básicas (ignición, movimiento, bajo voltaje) | ✅ |
| API REST + WebSocket en tiempo real | ✅ |
| Logs estructurados (pino, JSON) | ✅ |
| Otros fabricantes (Webfleet, Geotab, Queclink, Ruptela...) | 🔜 vía `receivers/future` + nuevos drivers |

## Estructura

```
src/
├── config/          Configuración por variables de entorno
├── receivers/       Servidores de entrada por protocolo (teltonika/, future/)
├── decoders/        Codec 8 / 8E, CRC16, mapeo de AVL IO IDs
├── drivers/         Conocimiento por modelo (fmc150, fmc650) → modelo unificado
├── normalizers/     Saneado de posición y eventos
├── services/        device, ingest, trip, geofence, alert, dedup
├── repositories/    Acceso a Supabase (devices, positions, events)
├── controllers/     API REST
├── routes/          Rutas Express
├── middlewares/     Autenticación por API key
├── websocket/       Difusión en tiempo real
├── events/          Bus de eventos interno
├── types/           Modelo unificado y estructuras AVL
├── utils/           Logger, geo
└── tests/           Tests + simulador de dispositivo
```

## Puesta en marcha (desarrollo)

```bash
cd mte
npm install
cp .env.example .env      # editar credenciales de Supabase
npm run dev               # arranca TCP :5027 y HTTP :8080
npm test                  # tests de decodificación y framing
npm run simulate          # simula un FMC enviando un paquete AVL
```

## Base de datos

Ejecutar `sql/001_mte_schema.sql` en el SQL Editor de Supabase. Después dar de
alta los dispositivos:

```sql
insert into mte_devices (imei, device_type, vehicle_id, authorized, label)
values ('356307042441013', 'FMC650', 'veh-001', true, 'Camión taller 1');
```

Con `DEVICE_AUTH_MODE=strict` (recomendado en producción) solo conectan IMEIs
autorizados. Con `permissive`, los IMEIs desconocidos se auto-registran como
no autorizados para poder aprobarlos desde el panel.

## API REST

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/health` | Estado del servicio (público) |
| GET | `/api/v1/positions/current?imei=` | Posición actual de la flota o de un IMEI |
| GET | `/api/v1/positions/:imei/history?from=&to=` | Histórico de posiciones |
| GET | `/api/v1/sessions` | Sesiones TCP activas |

Rutas `/api/*` protegidas con cabecera `x-api-key: <API_KEY>`.

**WebSocket**: `ws://host:8080/ws?apiKey=<API_KEY>` — mensajes
`{channel: 'telemetry' | 'event', data: ...}` en tiempo real.

## Despliegue en VPS Ubuntu (IP pública fija)

### Opción A: systemd

```bash
# 1. Node 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# 2. Usuario y código
sudo useradd -r -m -d /opt/mte mte
sudo -u mte git clone <repo> /opt/mte/src-repo
cd /opt/mte/src-repo/mte && sudo -u mte npm ci && sudo -u mte npm run build
sudo -u mte cp -r dist package.json node_modules /opt/mte/
sudo -u mte cp .env.example /opt/mte/.env   # editar credenciales

# 3. Servicio
sudo cp deploy/mte.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now mte
journalctl -u mte -f          # logs JSON estructurados

# 4. Firewall
sudo ufw allow 5027/tcp       # dispositivos GPS
sudo ufw allow 8080/tcp       # API (o solo desde IPs de Render)
```

### Opción B: Docker

```bash
cd mte
cp .env.example .env   # editar
docker compose up -d --build
```

### Configuración del dispositivo Teltonika

En el configurador (o por SMS/GPRS commands):
- **Domain**: IP pública del VPS
- **Port**: 5027
- **Protocol**: TCP
- **Data Protocol**: Codec 8 Extended (recomendado en FMC650 para CAN)

## Añadir un nuevo fabricante

1. Crear `src/receivers/<fabricante>/` con su servidor/cliente de protocolo.
2. Implementar `ProtocolDecoder` en `src/decoders/`.
3. Crear un driver que produzca `NormalizedTelemetry`.
4. Registrarlo en `src/drivers/driver.registry.ts`.

Todo lo demás (persistencia, geocercas, viajes, alertas, API, WebSocket)
funciona sin cambios porque opera sobre el modelo unificado.
