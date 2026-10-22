import { defineConfig } from 'vite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// The brand lives in one file: rename it there when the final name is chosen.
const brand = JSON.parse(readFileSync(fileURLToPath(new URL('./brand.json', import.meta.url)), 'utf8'));

export default defineConfig({
  plugins: [
    {
      name: 'brand-tokens',
      transformIndexHtml: (html) => html.replace(/\{\{(\w+)\}\}/g, (_, k) => String(brand[k] ?? '')),
    },
  ],
  define: { __BRAND__: JSON.stringify(brand) },
  build: {
    target: 'es2020',
    // Never inline assets as data: URIs; the CSP only allows files from our own origin.
    assetsInlineLimit: 0,
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        privacy: fileURLToPath(new URL('./privacy.html', import.meta.url)),
      },
    },
  },
});
