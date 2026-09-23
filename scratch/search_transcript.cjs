const fs = require('fs');
const readline = require('readline');

async function search() {
  const fileStream = fs.createReadStream('C:/Users/shrin/.gemini/antigravity-ide/brain/50e5f97a-b133-4bcf-b9f1-9315406c33d8/.system_generated/logs/transcript.jsonl');
  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

  for await (const line of rl) {
    if (line.includes('27.') || line.includes('27/100') || line.includes('around 27') || line.includes('score') && (line.includes('27') || line.includes('axios') || line.includes('Axios'))) {
      const obj = JSON.parse(line);
      const str = (obj.content || '') + ' ' + JSON.stringify(obj.tool_calls || '');
      if (str.includes('27.') || str.includes('27/100') || str.includes('around 27') || /score["':\s]+27/i.test(str)) {
        console.log(`[Step ${obj.step_index}] ${str.slice(0, 350).replace(/\r?\n/g, ' ')}`);
      }
    }
  }
}
search().catch(console.error);
