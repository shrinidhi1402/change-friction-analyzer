import { analyzeLocalRepository } from './runner.js';

// Simple CLI argument parsing
const args = process.argv.slice(2);
if (args.length === 0) {
  console.error('Usage: npm run local:analyze -- <github-url> [--depth <n>] [--path <output-dir>]');
  process.exit(1);
}

let repoUrl = '';
let depth = '500'; // default matches API
let analysisPath: string | undefined;

for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--depth' && i + 1 < args.length) {
    depth = args[++i];
  } else if (a === '--path' && i + 1 < args.length) {
    analysisPath = args[++i];
  } else if (!repoUrl) {
    repoUrl = a;
  } else {
    console.warn(`Unknown argument: ${a}`);
  }
}

(async () => {
  try {
    const result = await analyzeLocalRepository({ repoUrl, depth, analysisPath });
    console.log(JSON.stringify(result, null, 2));
  } catch (e) {
    console.error('[Local] Error:', e instanceof Error ? e.message : e);
    process.exit(1);
  }
})();
