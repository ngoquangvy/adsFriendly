// servermock/ingestion/telemetry_server.js
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 3000;
const STORAGE_PATH = path.join(__dirname, '../storage/dataset.jsonl');
const BUFFER_THRESHOLD = 100; // Flush after 100 events
const FLUSH_INTERVAL = 5000;   // Flush after 5 seconds

let logBuffer = [];
let lastFlush = Date.now();

// Ensure storage directory exists
const storageDir = path.dirname(STORAGE_PATH);
if (!fs.existsSync(storageDir)) {
    fs.mkdirSync(storageDir, { recursive: true });
}

function flushBuffer() {
    if (logBuffer.length === 0) return;

    const dataToWrite = logBuffer.map(log => JSON.stringify(log)).join('\n') + '\n';

    fs.appendFile(STORAGE_PATH, dataToWrite, (err) => {
        if (err) {
            console.error('[Telemetry Server] ❌ Flush failed:', err);
        } else {
            console.log(`[Telemetry Server] 💾 Flushed ${logBuffer.length} events to disk.`);
            logBuffer = [];
            lastFlush = Date.now();
        }
    });
}

// Automatic flush every interval
setInterval(() => {
    if (Date.now() - lastFlush >= FLUSH_INTERVAL) {
        flushBuffer();
    }
}, 1000);

const server = http.createServer((req, res) => {
    // 1. CORS Headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.statusCode = 204;
        res.end();
        return;
    }

    if (req.method === 'POST' && req.url === '/telemetry') {
        let body = '';
        req.on('data', chunk => { body += chunk.toString(); });
        req.on('end', () => {
            try {
                const payload = JSON.parse(body);

                // Extract clean data (Step 4 standard)
                if (payload.type === 'DECISION_LOG' && payload.data) {
                    logBuffer.push(payload.data);

                    // Buffer high-water mark check
                    if (logBuffer.length >= BUFFER_THRESHOLD) {
                        flushBuffer();
                    }
                }

                res.statusCode = 200;
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ success: true, count: logBuffer.length }));
            } catch (e) {
                res.statusCode = 400;
                res.end(JSON.stringify({ error: 'Invalid JSON' }));
            }
        });
    } else {
        res.statusCode = 404;
        res.end();
    }
});

server.listen(PORT, () => {
    console.log(`[Vanguard Telemetry Server] 📡 Listening on port ${PORT}`);
    console.log(`[Storage] 📂 Writing to: ${STORAGE_PATH}`);
});
