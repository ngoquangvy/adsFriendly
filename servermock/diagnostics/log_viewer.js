// servermock/diagnostics/log_viewer.js
const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '../storage/dataset.jsonl');

if (!fs.existsSync(file)) {
    console.log(`[Log Viewer] ❌ File not found: ${file}`);
    console.log('Ensure you have sent some telemetry data first.');
    process.exit(1);
}

const JSONL_DATA = fs.readFileSync(file, 'utf-8');

/**
 * Unifies flat schema (Fast-path MEDIA) and nested schema (Full AI Pipeline)
 */
function normalizeLog(l) {
    const data = l.data ?? l;
    
    // --- 1. Canonical Schema Detection (v14.0 - Training Ready) ---
    if (data.schema_v === '14.0') {
        const domain = (data.domain ?? '').toLowerCase().trim();
        const label = data.label_pred ?? data.label ?? '';
        
        if (!domain || domain === 'undefined') return null;
        if (!label || label === 'undefined') return null;

        let badgeClass = label.toLowerCase();
        if (label === 'HIGH_RISK') badgeClass = 'risk';
        if (label === 'MEDIA_PASS') badgeClass = 'media';

        return {
            url: data.url ?? 'unknown',
            domain,
            label,
            label_true: data.label_true ?? 'UNKNOWN',
            badgeClass,
            score: data.score ?? 0,
            confidence: data.confidence ?? 0,
            action: data.action ?? 'ALLOW',
            features: data.features ?? {},
            context: data.context ?? {},
            flags: data.flags || [],
            raw_signal: {
                method: data.raw?.method ?? 'GET',
                type: data.raw?.type ?? 'unknown',
                isError: data.raw?.isError || false
            },
            timestamp: data.timestamp ?? Date.now(),
            raw: l
        };
    }

    // --- 2. Schema v13.8 Fallback ---
    if (data.schema_v === '13.8') {
        const domain = (data.domain ?? '').toLowerCase().trim();
        const label = data.label ?? '';
        
        if (!domain || domain === 'undefined') return null;
        if (!label || label === 'undefined') return null;

        let badgeClass = label.toLowerCase();
        if (label === 'HIGH_RISK') badgeClass = 'risk';
        if (label === 'MEDIA_PASS') badgeClass = 'media';

        return {
            url: data.url ?? 'unknown',
            domain,
            label,
            badgeClass,
            score: data.score ?? 0,
            confidence: data.confidence ?? 0,
            action: data.action ?? 'ALLOW',
            features: data.features ?? {},
            context: data.context ?? {},
            timestamp: data.timestamp ?? Date.now(),
            raw: l
        };
    }

    // --- 2. Legacy Fallback Logic ---
    const final = data.final ?? data;
    const trace = data.trace ?? {};
    const decision = final.decision ?? data.decision ?? {};
    const context = final.context ?? data.context ?? {};

    const domain = (final.domain ?? trace.event?.domain ?? data.domain ?? '').toLowerCase().trim();
    const label = final.label ?? decision.label ?? data.label ?? '';

    if (!domain || domain === 'undefined') return null;
    if (!label || label === 'undefined') return null;

    let badgeClass = label.toLowerCase();
    if (label === 'HIGH_RISK') badgeClass = 'risk';
    if (label === 'MEDIA_PASS') badgeClass = 'media';

    return {
        url: final.url ?? data.url ?? 'unknown',
        domain,
        label,
        badgeClass,
        score: final.score ?? decision.score ?? data.score ?? 0,
        confidence: final.confidence ?? decision.confidence ?? data.confidence ?? 0,
        action: final.action ?? decision.action ?? 'ALLOW',
        features: trace.features ?? final.features ?? data.features ?? {},
        context: context,
        timestamp: final.timestamp ?? data.timestamp ?? Date.now(),
        raw: l
    };
}

const normalizedLines = JSONL_DATA.split('\n')
    .filter(line => line.trim())
    .map(line => {
        try {
            const parsed = JSON.parse(line);
            return normalizeLog(parsed);
        } catch (e) { return null; }
    })
    .filter(Boolean); // This removes the objects returned as 'null' by normalizeLog

if (normalizedLines.length === 0) {
    console.log('⚠️ Warning: All telemetry lines were dropped or invalid.');
    process.exit(0);
}
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

// 🌐 Top domains with Label info
console.log('\nTop 10 Domains and their Predictions:');
const domainStats = {};
for (const l of normalizedLines) {
    domainStats[l.domain] = (domainStats[l.domain] || 0) + 1;
}

const topDomains = Object.entries(domainStats)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

const domainTable = topDomains.map(([domain, count]) => {
    const samples = normalizedLines.filter(l => l.domain === domain).slice(0, 1);
    const sample = samples[0];
    return {
        Domain: domain,
        Hits: count,
        'Pred Label': sample.label,
        'True Label': sample.label_true || 'UNKNOWN',
        'Last Action': sample.action
    };
});
console.table(domainTable);

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

// 🧪 CONFUSION MATRIX (ADS Detection Performance)
let TP = 0, FN = 0, FP = 0, TN = 0;

for (const l of normalizedLines) {
    const isAd = l.label_true === 'ADS';
    const predictedAd = l.label === 'HIGH_RISK';

    if (predictedAd && isAd) TP++;
    else if (!predictedAd && isAd) FN++;
    else if (predictedAd && !isAd) FP++;
    else if (!predictedAd && !isAd) TN++;
}

console.log('\n🎯 CONFUSION MATRIX (ADS Detection):');
console.table({
    'Actual ADS': { 'Pred HIGH_RISK (TP)': TP, 'Pred SAFE (FN)': FN },
    'Actual SAFE': { 'Pred HIGH_RISK (FP)': FP, 'Pred SAFE (TN)': TN }
});

const precision = TP / (TP + FP) || 0;
const recall = TP / (TP + FN) || 0;
const f1 = (2 * precision * recall) / (precision + recall) || 0;

console.log(`\nMetrics:`);
console.log(`- Precision: ${(precision * 100).toFixed(1)}%`);
console.log(`- Recall:    ${(recall * 100).toFixed(1)}%`);
console.log(`- F1-Score:  ${(f1 * 100).toFixed(1)}%`);

// 🚨 FALSE NEGATIVE SAMPLES (Missed ADS)
const fnSamples = normalizedLines.filter(l => l.label === 'SAFE' && l.label_true === 'ADS').slice(0, 5);
if (fnSamples.length > 0) {
    console.log('\n❌ FALSE NEGATIVES (Missed ADS):');
    fnSamples.forEach((l, i) => {
        console.log(`[${i + 1}] ${l.domain} | Flags: ${l.flags.join(', ') || 'none'}`);
    });
}

// ⚠️ FALSE POSITIVE SAMPLES (Over-blocking)
const fpSamples = normalizedLines.filter(l => l.label === 'HIGH_RISK' && l.label_true !== 'ADS').slice(0, 5);
if (fpSamples.length > 0) {
    console.log('\n⚠️ FALSE POSITIVES (Over-blocking):');
    fpSamples.forEach((l, i) => {
        console.log(`[${i + 1}] ${l.domain} | Flags: ${l.flags.join(', ') || 'none'}`);
    });
}

console.log('\n====================================');

console.log('\n====================================');
