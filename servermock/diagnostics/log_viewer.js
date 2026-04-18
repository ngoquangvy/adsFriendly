// servermock/diagnostics/log_viewer.js
const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '../storage/dataset.jsonl');

if (!fs.existsSync(file)) {
    console.log(`[Log Viewer] ❌ File not found: ${file}`);
    console.log('Ensure you have sent some telemetry data first.');
    process.exit(1);
}

const lines = fs.readFileSync(file, 'utf-8')
    .split('\n')
    .filter(Boolean)
    .map(line => {
        try {
            return JSON.parse(line);
        } catch (e) {
            return null;
        }
    })
    .filter(Boolean);

console.log('====================================');
console.log('📊 VANGUARD DATASET ANALYSIS');
console.log('====================================');
console.log('Total events collected:', lines.length);

// 🚨 Label distribution
const labelStats = {};
for (const l of lines) {
    labelStats[l.label] = (labelStats[l.label] || 0) + 1;
}
console.log('\nLabel distribution:');
console.table(labelStats);

// 🌐 Top domains
const domainStats = {};
for (const l of lines) {
    domainStats[l.domain] = (domainStats[l.domain] || 0) + 1;
}

const topDomains = Object.entries(domainStats)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

console.log('\nTop 10 Domains:');
console.table(topDomains.map(([domain, count]) => ({ domain, count })));

// 💡 High risk samples
const highRisk = lines.filter(l => l.label === 'HIGH_RISK').slice(0, 5);

if (highRisk.length > 0) {
    console.log('\n🔥 Sample HIGH_RISK detections:');
    highRisk.forEach((l, i) => {
        console.log(`\n[Sample ${i + 1}]`);
        console.log(`URL: ${l.url.substring(0, 100)}...`);
        console.log(`Score: ${l.score} | Confidence: ${l.confidence}`);
        console.log(`Reputation: ${l.reputation}`);
        console.log(`Features Sample:`, JSON.stringify(l.features).substring(0, 150) + '...');
    });
} else {
    console.log('\n✅ No HIGH_RISK events found yet.');
}

console.log('\n====================================');
