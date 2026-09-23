const fs = require('fs');
const readline = require('readline');

async function searchFirstAxios() {
  const fileStream = fs.createReadStream('C:/Users/shrin/.gemini/antigravity-ide/brain/50e5f97a-b133-4bcf-b9f1-9315406c33d8/.system_generated/logs/transcript.jsonl');
  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

  let count = 0;
  for await (const line of rl) {
    if (line.toLowerCase().includes('axios')) {
      const obj = JSON.parse(line);
      console.log(`[Step ${obj.step_index}] (${obj.type}) ${(obj.content || '').slice(0, 200).replace(/\r?\n/g, ' ')}`);
      count++;
      if (count > 25) break;
    }
  }
}
searchFirstAxios().catch(console.error);
