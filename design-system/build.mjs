// Bundle the package's source into an ESM dist entry the design-sync converter
// ingests (`--entry ./dist/index.es.js`). React is external — the converter
// supplies it via _vendor, and the shipped extension never consumes this.
import { build } from 'esbuild';
import { readFileSync, writeFileSync } from 'node:fs';

await build({
  entryPoints: ['src/index.ts'],
  outfile: 'dist/index.es.js',
  format: 'esm',
  bundle: true,
  jsx: 'automatic',
  target: ['es2020'],
  external: ['react', 'react-dom', 'react/jsx-runtime'],
  logLevel: 'info',
});

console.log('built dist/index.es.js');

// Ship one self-contained stylesheet (token canon + component styles) as the
// converter's cssEntry — the design-sync copyTokens path only fires for a
// separate tokens *package*, so tokens must travel inside the cssEntry here.
const css = [
  readFileSync('src/tokens.css', 'utf8'),
  readFileSync('src/styles.css', 'utf8'),
].join('\n');
writeFileSync('dist/bundle.css', css);
console.log('built dist/bundle.css (tokens + components)');

