import { defineConfig, type Plugin } from 'vite';

/**
 * Strip the strict offline CSP meta tag only during Vite dev preview so
 * @vite/client and React dev modules load cleanly in browser preview,
 * while keeping the exact offline CSP intact in production `ui/dist` builds.
 */
function devCspRelax(): Plugin {
  return {
    name: 'stillmark-dev-csp-relax',
    apply: 'serve',
    transformIndexHtml(html) {
      return html.replace(/<meta\s+http-equiv="Content-Security-Policy"[^>]*>\s*/i, '');
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [devCspRelax()],
  server: {
    host: '0.0.0.0',
    port: 3000,
    allowedHosts: true,
  },
  build: {
    assetsInlineLimit: 0,
  },
});
