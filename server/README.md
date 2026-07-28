# AdsFriendly Telemetry Server

Small local server for collecting AdsFriendly training samples and diagnostic events.

## Run Locally

```powershell
cd server
npm start
```

Open:

```text
http://127.0.0.1:3000
```

## Run With Docker

```powershell
cd server
docker compose up --build
```

## API

### Health

```text
GET /health
```

### Ingest Events

```text
POST /api/ingest
Content-Type: application/json
```

Accepts a single event, `{ "events": [...] }`, or an array.

Minimal event:

```json
{
  "schema_version": "dataset.v1",
  "unit": "video_instance",
  "label": "unknown",
  "label_source": "heuristic_weak",
  "site": {
    "hostname": "example.com",
    "url": "https://example.com/watch"
  },
  "context": {
    "duration": 30,
    "src_host": "cdn.example.com"
  },
  "evidence": {
    "manifest_markers": ["cue-out"]
  },
  "action": "allow"
}
```

### Read Events

```text
GET /api/events?limit=500
GET /api/stats
GET /api/export.jsonl
GET /api/rejected
```

### Review Weak Labels

```text
GET /api/review?limit=100
POST /api/review
GET /api/reviews?limit=250
```

`POST /api/review` appends a strong `manual_review` feedback event instead of
mutating the original weak sample.

## Storage

Events are appended to `storage/dataset.jsonl`. Invalid payloads are appended to `storage/rejected.jsonl`.
Manual review events are also appended to `storage/reviews.jsonl`.
