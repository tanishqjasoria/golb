// @ts-check
import { defineConfig } from 'astro/config';

export default defineConfig({
  // Update this when the real domain is connected (also used for RSS links).
  site: 'https://tanishqjasoria.com',
  markdown: {
    shikiConfig: {
      theme: 'vitesse-light',
    },
  },
});
