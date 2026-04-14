import { fileURLToPath, URL } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vite";
import { analyzer } from "vite-bundle-analyzer";
import { lazyImport, VxeResolver } from "vite-plugin-lazy-import";
import vueDevTools from "vite-plugin-vue-devtools";

// https://vite.dev/config/
export default defineConfig({
  build: {
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            {
              name: "vxe",
              test: /node_modules[\\/]vxe/,
              priority: 1,
            },
            {
              name: "vxe-table",
              test: /node_modules[\\/]vxe-table/,
              priority: 2,
            },
            {
              name: "vue",
              test: /node_modules[\\/]@vue/,
              priority: 3,
            },
          ],
        },
      },
    },
  },
  legacy: {
    // Needed for vxe
    // Issue related, though of another package:
    //     https://github.com/x-extends/vxe-ui-plugins/issues/10
    inconsistentCjsInterop: true,
  },
  plugins: [
    analyzer({ enabled: false }),
    lazyImport({
      resolvers: [
        VxeResolver({
          libraryName: "vxe-pc-ui",
        }),
        VxeResolver({
          libraryName: "vxe-table",
        }),
      ],
    }),
    tailwindcss(),
    vue(),
    vueDevTools(),
  ],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
