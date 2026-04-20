
const http = require('http');

const API_HOST = 'localhost';
const API_PORT = 3000;
const API_PATH = '/telemetry';

const mockLogs = [
    {
        schema_v: "14.0",
        url: "https://googleads.g.doubleclick.net/pagead/ads?id=123",
        domain: "googleads.g.doubleclick.net",
        label_pred: "HIGH_RISK",
        label_true: "ADS", // TP
        action: "BLOCK",
        score: 0.95,
        confidence: 0.99,
        flags: ["KNOWN_AD_DOMAIN", "PATTERN_MATCH"],
        features: { network: { isAdDomain: true } },
        context: { domainClass: "ads_network" },
        raw: { method: "GET", type: "xhr", isError: false },
        timestamp: Date.now()
    },
    {
        schema_v: "14.0",
        url: "https://ads.pubmatic.com/v2/bid?id=456",
        domain: "ads.pubmatic.com",
        label_pred: "SAFE",
        label_true: "ADS", // FN (Missed Ads)
        action: "ALLOW",
        score: 0.12,
        confidence: 0.8,
        flags: ["SOFT_CONSENSUS"],
        features: { network: { isAdDomain: false } },
        context: { domainClass: "unknown" },
        raw: { method: "POST", type: "fetch", isError: false },
        timestamp: Date.now()
    },
    {
        schema_v: "14.0",
        url: "https://api.github.com/users/octocat",
        domain: "api.github.com",
        label_pred: "HIGH_RISK",
        label_true: "UNKNOWN", // FP (False Positive)
        action: "BLOCK",
        score: 0.88,
        confidence: 0.7,
        flags: ["BURST_ATTACK_DETECTED"],
        features: { network: { entropyScore: 0.8 } },
        context: { domainClass: "unknown" },
        raw: { method: "GET", type: "fetch", isError: false },
        timestamp: Date.now()
    },
    {
        schema_v: "14.0",
        url: "https://www.google.com/search?q=ai",
        domain: "www.google.com",
        label_pred: "SAFE",
        label_true: "UNKNOWN", // TN
        action: "ALLOW",
        score: 0.05,
        confidence: 0.95,
        flags: ["WHITELIST_HIT"],
        features: { network: { isAdDomain: false } },
        context: { domainClass: "search_engine" },
        raw: { method: "GET", type: "document", isError: false },
        timestamp: Date.now()
    },
    {
        schema_v: "14.0",
        url: "https://rr1---sn-q4fl6n6y.googlevideo.com/videoplayback?id=789",
        domain: "googlevideo.com",
        label_pred: "MEDIA_PASS",
        label_true: "MEDIA",
        action: "ALLOW",
        score: 0,
        confidence: 1,
        flags: ["MEDIA_HEURISTIC"],
        features: { network: { isMediaCDN: true } },
        context: { domainClass: "media_cdn" },
        raw: { method: "GET", type: "media", isError: false },
        timestamp: Date.now()
    }
];

function sendLog(log) {
    return new Promise((resolve, reject) => {
        const data = JSON.stringify(log);
        const options = {
            hostname: API_HOST,
            port: API_PORT,
            path: API_PATH,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': data.length
            }
        };

        const req = http.request(options, (res) => {
            resolve(res.statusCode);
        });

        req.on('error', (e) => reject(e));
        req.write(data);
        req.end();
    });
}

async function seed() {
    console.log("🚀 Seeding v14.0 Telemetry (Native HTTP)...");
    for (const log of mockLogs) {
        try {
            const status = await sendLog(log);
            console.log(`✅ Sent ${log.domain} -> ${status}`);
        } catch (e) {
            console.error(`❌ Failed ${log.domain}:`, e.message);
        }
    }
    console.log("🏁 Seeding complete.");
}

seed();
