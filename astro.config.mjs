import { defineConfig, fontProviders } from 'astro/config';
import mdx from '@astrojs/mdx';
import lit from '@semantic-ui/astro-lit';

export default defineConfig({
  integrations: [lit(), mdx()],
  fonts: [{
    provider: fontProviders.fontsource(),
    name: 'Open Sans',
    cssVariable: '--font-open-sans',
    weights: [400, 600, 700],
    styles: ['normal'],
    subsets: ['latin'],
  }],
  site: 'https://cumulus-ui.github.io',
  build: { inlineStylesheets: 'always' },
  vite: { environments: { client: { build: { sourcemap: true } } } },
  server: { port: 4321 },
  markdown: {
    shikiConfig: {
      themes: {
        light: 'github-light',
        dark: 'github-dark',
      },
    },
  },
});
