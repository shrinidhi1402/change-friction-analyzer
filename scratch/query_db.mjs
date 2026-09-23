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

console.log('Database URL configured:', dbUrl ? 'Yes' : 'No');
const prisma = new PrismaClient({
  datasources: {
    db: {
      url: dbUrl
    }
  }
});

async function main() {
  try {
    const repos = await prisma.repository.findMany({
      where: {
        OR: [
          { name: { contains: 'axios', mode: 'insensitive' } },
          { path: { contains: 'axios', mode: 'insensitive' } }
        ]
      },
      include: {
        analyses: {
          orderBy: { createdAt: 'asc' }
        }
      }
    });

    console.log(`Found ${repos.length} matching repositories.`);
    for (const r of repos) {
      console.log(`Repo: ${r.name} (${r.id}) - Path: ${r.path}`);
      for (const a of r.analyses) {
        console.log(`  Analysis ID: ${a.id}`);
        console.log(`    Created At: ${a.createdAt.toISOString()}`);
        console.log(`    Overall Score: ${a.overallScore}`);
        console.log(`    File Count: ${a.fileCount}`);
        console.log(`    Commit Count: ${a.commitCount}`);
        const summary = typeof a.summary === 'string' ? JSON.parse(a.summary) : a.summary;
        console.log(`    Summary Score: ${summary?.overallScore}`);
      }
    }

    // Also check all analyses in the entire database just in case repository path was different
    const allAnalyses = await prisma.analysis.findMany({
      include: { repository: true },
      orderBy: { createdAt: 'asc' }
    });
    console.log(`\nAll analyses in DB (${allAnalyses.length} total):`);
    for (const a of allAnalyses) {
      console.log(`ID: ${a.id} | Repo: ${a.repository?.name} (${a.repository?.path}) | CreatedAt: ${a.createdAt.toISOString()} | Score: ${a.overallScore} | Files: ${a.fileCount} | Commits: ${a.commitCount}`);
    }
  } catch (err) {
    console.error('Error querying database:', err);
  } finally {
    await prisma.$disconnect();
  }
}

main();
