import type { ConfigContext, ExpoConfig } from "expo/config";

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: "Minimal Expo x UploadThing",
  slug: "minimal-expo",
  version: "1.0.0",
  orientation: "portrait",
  icon: "./assets/icon.png",
  scheme: "myapp",
  userInterfaceStyle: "dark",
  splash: {
    backgroundColor: "#ffffff",
  },
  assetBundlePatterns: ["**/*"],
  ios: {
    bundleIdentifier: "your.bundle.identifier",
    supportsTablet: true,
  },
  android: {
    adaptiveIcon: {
      foregroundImage: "./assets/icon.png",
      backgroundColor: "#ffffff",
    },
  },
  web: {
    bundler: "metro",
    output: "server",
  },
  plugins: ["expo-router"],
  experiments: {
    typedRoutes: true,
  },
  // extra: {
  //   eas: {
  //     projectId: "",
  //   },
  // },
});
