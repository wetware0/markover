import { defineConfig } from 'vite';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  esbuild: {
    jsx: 'automatic',
  },
  server: {
    watch: {
      // Don't hot-reload when markdown files are saved — user documents
      // saved anywhere in the project directory were triggering page reloads
      // and wiping editor state.
      ignored: ['**/*.md', '**/*.markdown', '**/*.txt'],
    },
  },
});
