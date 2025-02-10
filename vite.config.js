import { defineConfig } from "vite";

export default defineConfig(({ command, mode }) => {
  return {
    base: "/Ray-Marching-Babylon.js/",
    resolve: {
      alias: {
        babylonjs:
          mode === "development" ? "babylonjs/babylon.max" : "babylonjs",
      },
    },
  };
});
