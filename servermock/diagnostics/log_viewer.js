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

/**
 * Unifies flat schema (Fast-path MEDIA) and nested schema (Full AI Pipeline)
 */
function normalizeLog(l) {
    return {
        url: l.url ?? l.raw?.url ?? 'unknown',
        domain: l.domain ?? l.context?.domain ?? 'unknown',
        label: l.label ?? l.decision?.label ?? 'undefined',
        score: l.score ?? l.decision?.score ?? 0,
        confidence: l.confidence ?? l.decision?.confidence ?? 0,
        reputation: l.reputation ?? l.context?.reputation ?? 0,
        features: l.features ?? {}
    };
}

const normalizedLines = lines.map(normalizeLog);

console.log('====================================');
console.log('📊 VANGUARD DATASET ANALYSIS');
console.log('====================================');
console.log('Total events collected:', normalizedLines.length);

// 🚨 Label distribution
const labelStats = {};
for (const l of normalizedLines) {
    labelStats[l.label] = (labelStats[l.label] || 0) + 1;
}
console.log('\nLabel distribution:');
console.table(labelStats);

// 🌐 Top domains
const domainStats = {};
for (const l of normalizedLines) {
    domainStats[l.domain] = (domainStats[l.domain] || 0) + 1;
}

const topDomains = Object.entries(domainStats)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

console.log('\nTop 10 Domains:');
console.table(topDomains.map(([domain, count]) => ({ domain, count })));

// 💡 High risk samples
const highRisk = normalizedLines.filter(l => l.label === 'HIGH_RISK').slice(0, 5);

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

// 🚨 False Negative Detection
const falseNegatives = normalizedLines.filter(l => {
    return l.label === 'SAFE' && l.features?.network?.isAdDomain === true;
}).slice(0, 10);

if (falseNegatives.length > 0) {
    console.log('\n❌ FALSE NEGATIVE (SAFE nhưng là Ad):');
    falseNegatives.forEach((l, i) => {
        console.log(`\n[Case ${i + 1}]`);
        console.log(`URL: ${l.url.substring(0, 100)}...`);
        console.log(`Domain: ${l.domain}`);
        console.log(`Score: ${l.score} | Confidence: ${l.confidence}`);
    });
} else {
    console.log('\n✅ No false negatives found.');
}

// 🚨 False Positive Detection
const falsePositives = normalizedLines.filter(l => {
    return l.label === 'HIGH_RISK' && l.features?.network?.isAdDomain === false;
}).slice(0, 10);

if (falsePositives.length > 0) {
    console.log('\n⚠️ FALSE POSITIVE (HIGH_RISK nhưng không phải Ad):');
    falsePositives.forEach((l, i) => {
        console.log(`\n[Case ${i + 1}]`);
        console.log(`URL: ${l.url.substring(0, 100)}...`);
        console.log(`Domain: ${l.domain}`);
    });
}

/**
 * Known "Ground Truth" for specific domains for accuracy validation
 */
function classifyTruth(l) {
    const url = l.url || '';

    if (url.includes('doubleclick.net')) return 'ADS';
    if (url.includes('/pagead/')) return 'ADS';
    if (url.includes('/api/stats')) return 'INTERNAL';
    if (url.includes('googlevideo.com')) return 'MEDIA';

    return 'UNKNOWN';
}

const mismatches = normalizedLines.filter(l => {
    const truth = classifyTruth(l);

    if (truth === 'ADS' && l.label === 'SAFE') return true;
    if (truth !== 'ADS' && l.label === 'HIGH_RISK' && truth !== 'UNKNOWN') return true;

    return false;
}).slice(0, 10);

if (mismatches.length > 0) {
    console.log('\n🔍 GROUND TRUTH MISMATCHES:');
    mismatches.forEach((l, i) => {
        const truth = classifyTruth(l);
        console.log(`\n[Mismatch ${i + 1}]`);
        console.log(`URL: ${l.url.substring(0, 100)}...`);
        console.log(`Expected: ${truth} | Got: ${l.label}`);
    });
}

console.log('\n====================================');
