import { resolve } from 'node:path';
import { defineConfig, type PluginOption } from "vite";
import libAssetsPlugin from '@laynezh/vite-plugin-lib-assets';
import makeManifestPlugin from './utils/plugins/make-manifest-plugin';
import { watchPublicPlugin, watchRebuildPlugin } from '@extension/hmr';
import { isDev, isProduction, watchOption } from '@extension/vite-config';

const rootDir = resolve(__dirname);
const srcDir = resolve(rootDir, 'src');

const outDir = resolve(rootDir, '..', 'dist');
export default defineConfig({
  resolve: {
    alias: {
      '@root': rootDir,
      '@src': srcDir,
      '@assets': resolve(srcDir, 'assets'),
      // Add alias to handle langchain imports
      'langchain/core': resolve(rootDir, 'node_modules/@langchain/core'),
      '@langchain/core': resolve(rootDir, 'node_modules/@langchain/core'),
    },
    conditions: ['browser', 'module', 'import', 'default'],
    mainFields: ['browser', 'module', 'main']
  },
  server: {
    // Restrict CORS to only allow localhost
    cors: {
      origin: ['http://localhost:5173', 'http://localhost:3000'],
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      credentials: true
    },
    host: 'localhost',
    sourcemapIgnoreList: false,
  },
  plugins: [
    libAssetsPlugin({
      outputPath: outDir,
    }) as PluginOption,
    watchPublicPlugin(),
    makeManifestPlugin({ outDir }),
    isDev && watchRebuildPlugin({ reload: true, id: 'chrome-extension-hmr' }),
  ],
  publicDir: resolve(rootDir, 'public'),
  build: {
    lib: {
      formats: ['iife'],
      entry: resolve(__dirname, 'src/background/index.ts'),
      name: 'BackgroundScript',
      fileName: 'background',
    },
    outDir,
    emptyOutDir: false,
    sourcemap: isDev,
    minify: isProduction,
    reportCompressedSize: isProduction,
    watch: watchOption,
    rollupOptions: {
      external: [
        'chrome',
        // 'chromium-bidi/lib/cjs/bidiMapper/BidiMapper.js'
      ],
      output: {
        globals: {
          chrome: 'chrome'
        }
      }
    },
  },
  optimizeDeps: {
    include: [
      '@langchain/core',
      '@langchain/community',
      '@langchain/openai',
      '@langchain/anthropic',
      '@langchain/google-genai',
      'zod',
      'zod-to-json-schema'
    ],
    exclude: [
      'chrome'
    ],
    esbuildOptions: {
      define: {
        global: 'globalThis',
      },
    },
  },
  define: {
    'import.meta.env.DEV': isDev,
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV || 'production'),
    global: 'globalThis',
  },

  envDir: '../',
});
