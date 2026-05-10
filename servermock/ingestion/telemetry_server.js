const http = require('http');
const fs = require('fs');
const path = require('path');
const { SchemaValidator } = require('./schema_validator.js');
const { LogRouter } = require('./log_router.js');

const PORT = 3000;
const STORAGE_PATH = path.join(__dirname, '../storage/dataset.jsonl');
const STORAGE_REJECTED_PATH = path.join(__dirname, '../storage/rejected_events.jsonl');
const BUFFER_THRESHOLD = 100;
const FLUSH_INTERVAL = 5000;

let logBuffer = [];
let rejectedBuffer = [];
let domainCount = {};
let lastLogged = {};
let lastFlush = Date.now();

const storageDir = path.dirname(STORAGE_PATH);
if (!fs.existsSync(storageDir)) {
    fs.mkdirSync(storageDir, { recursive: true });
}

function flushBuffer() {
    if (logBuffer.length > 0) {
        const dataToWrite = logBuffer.map((log) => JSON.stringify(log)).join('\n') + '\n';
        fs.appendFile(STORAGE_PATH, dataToWrite, (err) => {
            if (err) console.error('[Telemetry Server] Flush failed:', err);
            else console.log(`[Telemetry Server] Flushed ${logBuffer.length} events to disk.`);
            logBuffer = [];
        });
    }
    
    if (rejectedBuffer.length > 0) {
        const dataToWrite = rejectedBuffer.map((log) => JSON.stringify(log)).join('\n') + '\n';
        fs.appendFile(STORAGE_REJECTED_PATH, dataToWrite, (err) => {
            if (err) console.error('[Telemetry Server] Rejected Flush failed:', err);
            else console.log(`[Telemetry Server] Flushed ${rejectedBuffer.length} REJECTED events to disk.`);
            rejectedBuffer = [];
        });
    }
    
    lastFlush = Date.now();
}

setInterval(() => {
    if (Date.now() - lastFlush >= FLUSH_INTERVAL) {
        flushBuffer();
    }
}, 1000);

function parseStoredEvents(rawText) {
    return rawText
        .split('\n')
        .filter(Boolean)
        .map((line) => {
            try {
                return JSON.parse(line);
            } catch (_) {
                return null;
            }
        })
        .filter(Boolean);
}

const server = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.statusCode = 204;
        res.end();
        return;
    }

    if (req.method === 'POST' && req.url === '/telemetry') {
        let body = '';
        req.on('data', (chunk) => { body += chunk.toString(); });
        req.on('end', () => {
            try {
                const payload = JSON.parse(body);
                const normalized = SchemaValidator.normalizePayload(payload, {
                    receivedAt: Date.now(),
                    remoteAddress: req.socket?.remoteAddress || null
                });
                const routing = LogRouter.route(normalized);
                const storedEntry = {
                    ...normalized,
                    routing
                };

                const domain = storedEntry.record?.observation?.domain
                    || storedEntry.record?.identity?.page_domain
                    || storedEntry.identity?.site_domain
                    || 'unknown';

                domainCount[domain] = (domainCount[domain] || 0) + 1;
                const now = Date.now();

                if (domainCount[domain] > 200) {
                    const elapsed = now - (lastLogged[domain] || 0);
                    if (elapsed < 2000) {
                        res.statusCode = 202;
                        res.setHeader('Content-Type', 'application/json');
                        res.end(JSON.stringify({ success: true, throttled: true, domain, routing }));
                        return;
                    }
                }

                lastLogged[domain] = now;
                
                const isRejected = !routing.training_ready || !storedEntry.record?.forensic?.valid;
                if (isRejected) {
                    rejectedBuffer.push(storedEntry);
                } else {
                    logBuffer.push(storedEntry);
                }

                if (logBuffer.length >= BUFFER_THRESHOLD || rejectedBuffer.length >= BUFFER_THRESHOLD) {
                    flushBuffer();
                }

                res.statusCode = 200;
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({
                    success: true,
                    count: isRejected ? rejectedBuffer.length : logBuffer.length,
                    record_id: storedEntry.record?.identity?.event_id || null,
                    subsystem: routing.subsystem,
                    training_ready: routing.training_ready,
                    structural_valid: storedEntry.record?.forensic?.valid ?? false
                }));
            } catch (e) {
                res.statusCode = 400;
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ success: false, error: 'Invalid JSON', message: e.message }));
            }
        });
        return;
    }

    if (req.method === 'POST' && req.url === '/telemetry/rejected') {
        let body = '';
        req.on('data', (chunk) => { body += chunk.toString(); });
        req.on('end', () => {
            try {
                const payload = JSON.parse(body);
                // Wrap raw dropped event
                const droppedEntry = {
                    type: 'DROPPED_EVENT',
                    timestamp: Date.now(),
                    reason: payload.reason || 'UNKNOWN_REJECTION',
                    raw_event: payload.event || {}
                };
                
                rejectedBuffer.push(droppedEntry);
                if (rejectedBuffer.length >= BUFFER_THRESHOLD) flushBuffer();

                res.statusCode = 200;
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ success: true }));
            } catch (e) {
                res.statusCode = 400;
                res.end();
            }
        });
        return;
    }

    if (req.method === 'GET' && req.url === '/dataset') {
        if (!fs.existsSync(STORAGE_PATH)) {
            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify([]));
            return;
        }

        fs.readFile(STORAGE_PATH, 'utf-8', (err, data) => {
            if (err) {
                res.statusCode = 500;
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ success: false, error: 'Read failure' }));
                return;
            }

            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(parseStoredEvents(data)));
        });
        return;
    }

    res.statusCode = 404;
    res.end();
});

server.listen(PORT, () => {
    console.log(`[Vanguard Telemetry Server] Listening on port ${PORT}`);
    console.log(`[Storage] Writing to: ${STORAGE_PATH}`);
});
