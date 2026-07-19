import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.seatarragona.almacenmobile",
  appName: "Mobilink Almacén",
  webDir: "dist",
  server: {
    androidScheme: "https",
  },
};

export default config;
