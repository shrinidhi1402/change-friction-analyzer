import { analyzeRepository } from 'file:///C:/Users/shrin/OneDrive/Desktop/change friction analyzer/packages/analyzer/dist/src/index.js';
import path from 'path';

const absPath = path.resolve('../phase4-test-repo');
const analysisAbsPath = path.resolve('../phase4-test-repo/packages/next/src/server');

console.log('Running analysis...');
const result = analyzeRepository({ 
  repositoryPath: absPath,
  analysisPath: analysisAbsPath
});

const top10 = result.files
  .sort((a, b) => b.metrics.frictionScore - a.metrics.frictionScore)
  .slice(0, 10);

console.log('\n=======================================');
console.log('EXPLAINABILITY VALIDATION (TOP 10 FILES)');
console.log('=======================================\n');

top10.forEach((f, idx) => {
  // calculate raw coupling weight
  const fileCoChanges = result.coChanges.filter(p => p.source === f.path || p.target === f.path);
  const rawCouplingWeight = fileCoChanges.reduce((sum, p) => sum + p.count, 0);
  const rawDependencies = f.dependencyCount + f.dependentCount;
  
  // Find which normalized metric contributes the most to final score (after weighting)
  const weighted = {
    dependencyImpact: f.metrics.dependencyImpact * 0.30,
    changeFrequency: f.metrics.changeFrequency * 0.25,
    coChangeCoupling: f.metrics.coChangeCoupling * 0.20,
    contributorComplexity: f.metrics.contributorComplexity * 0.10,
    historicalRisk: f.metrics.historicalRisk * 0.15
  };
  
  let maxMetric = '';
  let maxVal = -1;
  for (const [k, v] of Object.entries(weighted)) {
    if (v > maxVal) {
      maxVal = v;
      maxMetric = k;
    }
  }

  console.log(`${idx + 1}. ${f.path}`);
  console.log(`   RAW METRICS:`);
  console.log(`     - raw dependency count: ${rawDependencies} (deps: ${f.dependencyCount}, dependents: ${f.dependentCount})`);
  console.log(`     - raw change count: ${f.changeCount}`);
  console.log(`     - raw co-change coupling weight: ${rawCouplingWeight}`);
  console.log(`     - raw contributor count: ${f.contributorCount}`);
  console.log(`     - raw historical risk signal count: ${f.historicalEvidence.length}`);
  
  console.log(`   NORMALIZED METRICS:`);
  console.log(`     - normalized dependencyImpact: ${f.metrics.dependencyImpact.toFixed(2)}`);
  console.log(`     - normalized changeFrequency: ${f.metrics.changeFrequency.toFixed(2)}`);
  console.log(`     - normalized coChangeCoupling: ${f.metrics.coChangeCoupling.toFixed(2)}`);
  console.log(`     - normalized contributorComplexity: ${f.metrics.contributorComplexity.toFixed(2)}`);
  console.log(`     - normalized historicalRisk: ${f.metrics.historicalRisk.toFixed(2)}`);
  
  console.log(`   FINAL SCORE: ${f.metrics.frictionScore}`);
  console.log(`   MOST SIGNIFICANT CONTRIBUTOR: ${maxMetric} (weighted value: ${maxVal.toFixed(2)})\n`);
});

// Manual verification of the highest scoring file
const top1 = top10[0];
const calculatedScore = (
  top1.metrics.dependencyImpact * 0.30 +
  top1.metrics.changeFrequency * 0.25 +
  top1.metrics.coChangeCoupling * 0.20 +
  top1.metrics.contributorComplexity * 0.10 +
  top1.metrics.historicalRisk * 0.15
);
const clamped = Math.min(100, Math.max(0, Number(calculatedScore.toFixed(2))));

console.log('=======================================');
console.log('MANUAL VERIFICATION OF HIGHEST SCORE');
console.log('=======================================');
console.log(`File: ${top1.path}`);
console.log(`Formula: dependencyImpact * 0.30 + changeFrequency * 0.25 + coChangeCoupling * 0.20 + contributorComplexity * 0.10 + historicalRisk * 0.15`);
console.log(`Calculation: ${top1.metrics.dependencyImpact.toFixed(2)} * 0.30 + ${top1.metrics.changeFrequency.toFixed(2)} * 0.25 + ${top1.metrics.coChangeCoupling.toFixed(2)} * 0.20 + ${top1.metrics.contributorComplexity.toFixed(2)} * 0.10 + ${top1.metrics.historicalRisk.toFixed(2)} * 0.15`);
console.log(`Calculated Result: ${clamped.toFixed(2)}`);
console.log(`Reported Final Score: ${top1.metrics.frictionScore}`);
console.log(`Match? ${clamped === top1.metrics.frictionScore ? 'YES' : 'NO'}`);
