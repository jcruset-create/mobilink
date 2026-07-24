# Mobilink Safety (APK técnicos)

App Flutter para técnicos del módulo Safety Manager: consultar sus EPIs
entregados, solicitar EPIs, firmar lecturas obligatorias de documentos y ver
sus formaciones (con caducidades) y próximas reuniones de seguridad.

## Auth

Reutiliza la autenticación de la APK de presencia: selector de empleado
(`sea_employees` activos) + PIN, validado con el RPC `pres_login`. Cada
petición lleva las cabeceras `x-presencia-employee` + `x-presencia-pin`.
Endpoints del backend: `/api/safety-operator/*` (en `server/index.ts`).

## Generar la plataforma Android (una sola vez)

El repo solo versiona `lib/` + `pubspec.yaml`. Antes de compilar:

```bash
cd safety_app
flutter create . --org com.seatarragona --project-name safety_app --platforms android
flutter pub get
```

No necesita permisos extra en el AndroidManifest (solo INTERNET, que ya viene).

## Compilar

```bash
flutter build apk --release
```

Copiar al Escritorio como `mobilink-safety-<versión>.apk` (la versión sale de
`pubspec.yaml`, p. ej. `mobilink-safety-0.1.0.apk`). Verificar con `aapt` que
la versión embebida es la esperada antes de copiar.
