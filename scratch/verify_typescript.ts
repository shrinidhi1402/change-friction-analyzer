import { analyzeRepository } from '../packages/analyzer/src/index.js';
import { performance } from 'node:perf_hooks';

async function main() {
  console.log('[TypeScript Run 2] Starting analysis on C:\\cfa-tmp\\cfa-3OIbZz...');
  const t0 = performance.now();
  const result = analyzeRepository({ repositoryPath: 'C:\\cfa-tmp\\cfa-3OIbZz' });
  const duration = performance.now() - t0;
  console.log(`[TypeScript Run 2] Total analyzer time: ${(duration / 1000).toFixed(2)}s`);
  console.log(`[TypeScript Run 2] Source files: ${result.files.length}`);
  console.log(`[TypeScript Run 2] Dependency edges: ${result.dependencies.reduce((sum, d) => sum + d.dependencies.length, 0)}`);
  console.log(`[TypeScript Run 2] Overall score: ${result.overallScore}`);
}

main().catch(err => {
  console.error('[TypeScript Run 2] Error:', err);
  process.exit(1);
});
