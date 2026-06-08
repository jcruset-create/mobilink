# App movil almacen

La app Android/iOS usa Capacitor y empaqueta el modulo web mobile de almacen.

- Entrada nativa: `/almacen-neumaticos/mobile`.
- App id: `com.seatarragona.almacenmobile`.
- Nombre: `SEA Almacen Mobile`.
- Build web para app: `npm run build:mobile`.

## Probar en navegador

```bash
npm run dev
```

Abrir:

```text
http://localhost:5174/almacen-neumaticos/mobile
```

## Android

```bash
npm run mobile:sync
npm run mobile:android
```

Hace falta Android Studio instalado. Si Capacitor no lo detecta:

```powershell
$env:CAPACITOR_ANDROID_STUDIO_PATH="C:\Program Files\Android\Android Studio\bin\studio64.exe"
npx cap open android
```

## iOS

```bash
npm run mobile:sync
npm run mobile:ios
```

iOS necesita macOS con Xcode. En Windows se puede mantener el codigo, pero la compilacion y subida a App Store Connect se hacen desde Mac.

## Publicar cambios en la app

Cada vez que cambie el modulo mobile:

```bash
npm run mobile:sync
```

Despues recompilar desde Android Studio o Xcode.
