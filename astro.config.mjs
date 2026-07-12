// @ts-check
import { defineConfig } from 'astro/config';

export default defineConfig({
  // Canonical origin — absolute URLs (e.g. RSS links) are generated from this.
  site: 'https://tanishq.sh',
  markdown: {
    shikiConfig: {
      theme: 'vitesse-light',
    },
  },
});
