import fs from 'fs';
import { PrismaClient } from '@prisma/client';

const envContent = fs.readFileSync('.env', 'utf-8');
let dbUrl = '';
for (const line of envContent.split(/\r?\n/)) {
  const match = line.match(/^DATABASE_URL=(.*)$/);
  if (match) {
    dbUrl = match[1].trim();
    process.env.DATABASE_URL = dbUrl;
  }
}

const prisma = new PrismaClient({
  datasources: { db: { url: dbUrl } }
});

async function main() {
  const analyses = await prisma.analysis.findMany({
    where: {
      repository: { path: { contains: 'axios' } }
    },
    orderBy: { createdAt: 'asc' }
  });

  for (const a of analyses) {
    console.log(`=== Analysis ID: ${a.id} ===`);
    console.log('CreatedAt:', a.createdAt.toISOString());
    console.log('OverallScore:', a.overallScore);
    console.log('FileCount:', a.fileCount);
    console.log('CommitCount:', a.commitCount);
    console.log('Summary distribution:', a.summary?.distribution);
    console.log('Summary topHighFrictionModules:', a.summary?.topHighFrictionModules);
  }
}

main().finally(() => prisma.$disconnect());
