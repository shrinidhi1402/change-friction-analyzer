import fs from 'fs';
import { PrismaClient } from '@prisma/client';

const envContent = fs.readFileSync('.env', 'utf-8');
let dbUrl = '';
for (const line of envContent.split(/\r?\n/)) {
  const match = line.match(/^DATABASE_URL=(.*)$/);
  if (match) dbUrl = match[1].trim();
}

const prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } });

async function compare() {
  const a1 = await prisma.analysis.findUnique({
    where: { id: 'cmucq610s0002rgk62ul86g8q' },
    include: { fileMetrics: { include: { file: true } } }
  });
  const a2 = await prisma.analysis.findUnique({
    where: { id: 'cmucqcypx0002qx79s30ru33d' },
    include: { fileMetrics: { include: { file: true } } }
  });

  console.log('Analysis 1 (23.77):', {
    id: a1.id,
    overallScore: a1.overallScore,
    fileCount: a1.fileCount,
    commitCount: a1.commitCount,
    metricCount: a1.fileMetrics.length
  });

  console.log('Analysis 2 (23.97):', {
    id: a2.id,
    overallScore: a2.overallScore,
    fileCount: a2.fileCount,
    commitCount: a2.commitCount,
    metricCount: a2.fileMetrics.length
  });

  // Compare top 5 files
  const top1 = [...a1.fileMetrics].sort((x, y) => y.frictionScore - x.frictionScore).slice(0, 5);
  const top2 = [...a2.fileMetrics].sort((x, y) => y.frictionScore - x.frictionScore).slice(0, 5);

  console.log('\nTop 5 in Analysis 1 (23.77):');
  for (const m of top1) {
    console.log(`  ${m.file.path}: score=${m.frictionScore}, depImpact=${m.dependencyImpact}, chgFreq=${m.changeFrequency}, coChange=${m.coChangeCoupling}, contrib=${m.contributorComplexity}, histRisk=${m.historicalRisk}, chgCount=${m.changeCount}`);
  }

  console.log('\nTop 5 in Analysis 2 (23.97):');
  for (const m of top2) {
    console.log(`  ${m.file.path}: score=${m.frictionScore}, depImpact=${m.dependencyImpact}, chgFreq=${m.changeFrequency}, coChange=${m.coChangeCoupling}, contrib=${m.contributorComplexity}, histRisk=${m.historicalRisk}, chgCount=${m.changeCount}`);
  }

  // Average file score difference
  let totalDiff = 0;
  const m2Map = new Map(a2.fileMetrics.map(m => [m.file.path, m]));
  let filesDiff = 0;
  for (const m1 of a1.fileMetrics) {
    const m2 = m2Map.get(m1.file.path);
    if (m2) {
      const diff = m2.frictionScore - m1.frictionScore;
      if (Math.abs(diff) > 0.001) filesDiff++;
      totalDiff += diff;
    }
  }
  console.log(`\nFiles with score difference: ${filesDiff} / ${a1.fileMetrics.length}`);
  console.log(`Average score delta across files: ${(totalDiff / a1.fileMetrics.length).toFixed(4)}`);
}

compare().finally(() => prisma.$disconnect());
