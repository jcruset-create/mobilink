import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.seatarragona.tecnicosmobile",
  appName: "SEA Técnicos",
  webDir: "dist-tecnicos",
  android: {
    path: "android-tecnicos",
  },
  server: {
    androidScheme: "https",
  },
};

export default config;
