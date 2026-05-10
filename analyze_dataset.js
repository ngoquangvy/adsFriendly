const fs = require('fs');
const readline = require('readline');

async function processLineByLine() {
  const fileStream = fs.createReadStream('servermock/storage/dataset.jsonl');
  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

  const actions = {};
  const labels = {};
  const reasons = {};

  for await (const line of rl) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line);
      const decisionLayer = parsed.decision_layer || {};
      const action = decisionLayer.decision?.action || 'unknown';
      const label = decisionLayer.classification?.label_strength || 'unknown';
      const reason = decisionLayer.decision?.reason || 'unknown';

      actions[action] = (actions[action] || 0) + 1;
      labels[label] = (labels[label] || 0) + 1;
      reasons[reason] = (reasons[reason] || 0) + 1;
    } catch (e) {
      console.error("Error parsing line", e.message);
    }
  }

  console.log("--- Actions ---");
  console.log(JSON.stringify(actions, null, 2));
  console.log("--- Labels ---");
  console.log(JSON.stringify(labels, null, 2));
  console.log("--- Reasons ---");
  console.log(JSON.stringify(reasons, null, 2));
}

processLineByLine();
