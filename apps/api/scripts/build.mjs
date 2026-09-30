// Bündelt die API inkl. Workspace-Pakete (@parking/*) in dist/.
// npm-Abhängigkeiten bleiben extern und werden zur Laufzeit aus node_modules geladen.
import { build } from 'esbuild';

await build({
  entryPoints: ['src/server.ts', 'src/db/migrate.ts', 'src/db/seed.ts'],
  outdir: 'dist',
  outbase: 'src',
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  sourcemap: true,
  plugins: [
    {
      name: 'externalize-npm',
      setup(b) {
        b.onResolve({ filter: /^[^./]/ }, (args) =>
          args.path.startsWith('@parking/') ? undefined : { path: args.path, external: true },
        );
      },
    },
  ],
});
console.log('✔ API gebaut: dist/');
