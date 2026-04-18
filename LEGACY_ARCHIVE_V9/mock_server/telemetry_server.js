const http = require('http');
const fs = require('fs');
const path = require('path');

/**
 * AdsFriendly Mock Telemetry Server
 * Logs incoming AI sensor data to raw_telemetry.json
 */
const PORT = 3000;
const DB_FILE = path.join(__dirname, 'raw_telemetry.json');

const server = http.createServer((req, res) => {
    // 1. Enable CORS for extension context
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    // Handle Preflight
    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }

    // 2. Handle Telemetry Intake
    if (req.method === 'POST' && req.url === '/telemetry') {
        let body = '';
        req.on('data', chunk => {
            body += chunk.toString();
        });

        req.on('end', () => {
            try {
                const payload = JSON.parse(body);
                
                // Debug: Check if identity exists
                if (!payload.identity) {
                    console.log('[Mock Server] ⚠️ Warning: Received payload without identity group.');
                    console.log('[Mock Server] Available keys:', Object.keys(payload).join(', '));
                }

                const domain = payload.identity ? payload.identity.site_domain : 'unknown-domain';
                const sessionId = payload.identity ? payload.identity.session_id : 'unknown-session';

                console.log(`[Mock Server] 📥 Received: ${payload.type} from ${domain}`);
                if (domain === 'unknown-domain') {
                    console.log('[Mock Server] 📄 Partial Payload Payload for debugging:', JSON.stringify(payload).substring(0, 200) + '...');
                }

                // Read (Simulate DB Query)
                let database = [];
                if (fs.existsSync(DB_FILE)) {
                    try {
                        database = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
                    } catch (e) { database = []; }
                }

                // Write to main JSON DB
                database.unshift(payload);
                if (database.length > 500) database.length = 500;
                fs.writeFileSync(DB_FILE, JSON.stringify(database, null, 2));

                // v4.6: Dedicated Human-Readable Diagnostic Log
                if (payload.type === 'DIAGNOSTIC_REDIRECT' || payload.type === 'HEARTBEAT' || payload.type === 'DEBUG_LOG') {
                    const logFile = path.join(__dirname, 'diagnostic_reports.log');
                    const logEntry = `[${new Date().toISOString()}] [${domain}] [${payload.type}]\n` +
                                     `URL: ${payload.data.url}\n` +
                                     `Details: ${JSON.stringify(payload.data.state || payload.data)}\n` +
                                     `-------------------------------------------\n`;
                    fs.appendFileSync(logFile, logEntry);
                    console.log(`[Mock Server] 📝 Diagnostic report saved to diagnostic_reports.log`);
                }

                // Response
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ 
                    success: true, 
                    recorded_at: new Date().toISOString(),
                    session_id: sessionId
                }));
            } catch (err) {
                console.error('[Mock Server] ❌ Failed to parse telemetry:', err.message);
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, error: 'Malformed JSON' }));
            }
        });
    } else {
        res.writeHead(404);
        res.end(JSON.stringify({ error: 'Endpoint not found' }));
    }
});

server.listen(PORT, () => {
    console.log('\x1b[32m%s\x1b[0m', `[AdsFriendly Mock] Telemetry Server is ACTIVE`);
    console.log(`[AdsFriendly Mock] URL: http://localhost:${PORT}/telemetry`);
    console.log(`[AdsFriendly Mock] DB: ${DB_FILE}`);
    console.log(`[AdsFriendly Mock] Press Ctrl+C to stop.\n`);
});
