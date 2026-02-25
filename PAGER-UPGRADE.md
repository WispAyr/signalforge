# Pager System Upgrade — SignalForge

## Date: 2026-02-24

## What Was Built

### 1. SQLite Persistence (`packages/server/src/pager/db.ts`)
- Database at `packages/server/data/pager.db` (WAL mode)
- Tables: `messages`, `capcodes`, `hourly_stats`, `alerts`
- Auto-creates on startup
- Every decoded message written to DB with raw + cleaned content

### 2. Message Filtering & Cleaning
- Strips control characters (0x00-0x08, 0x0B, 0x0C, 0x0E-0x1F, 0x7F)
- Stores both `content_raw` and `content_clean`
- Empty messages stored with `is_empty=1` flag but not broadcast to clients

### 3. Deduplication
- 2-second window dedup on cleaned content
- `duplicate_group_id` links duplicates to first message in group
- Client shows count badge and collapse/expand for duplicate groups

### 4. Capcode Database
- Auto-learn: new capcodes added on first message
- UK ranges seeded: Test/Admin, Emergency Services, NHS/Health, Utilities/Commercial, General
- API: GET /api/pager/capcodes, PATCH /api/pager/capcodes/:capcode

### 5. Analytics & Stats
- Hourly stats tracked per frequency per protocol
- GET /api/pager/stats/db — total, by_frequency, by_capcode, by_hour, busiest_hour
- GET /api/pager/stats/hourly — last 24h histogram

### 6. Keyword Alerts
- Table seeded with: FIRE, CARDIAC, RTC, AMBULANCE, COLLAPSE, FLOOD, EXPLOSION, HAZMAT
- Messages matching keywords emit `pager_alert` over WebSocket
- API: GET/POST/DELETE /api/pager/keyword-alerts

### 7. Auto-Frequency Discovery (`packages/server/src/pager/discovery.ts`)
- Processes FFT frames from multiplexer
- EMA energy tracking per bin
- Flags bins >10dB above noise floor not covered by existing receivers
- GET /api/pager/discovered-frequencies

### 8. Client PagerView Upgrade
- Cleaned content display (no control chars)
- Duplicate grouping with count badges and collapse
- Capcode labels and category colour coding
- Keyword highlighting with red flash animation
- Stats bar with DB stats, busiest hour, top frequency
- Search/filter by capcode, frequency, keyword, time range
- Scroll position persistence

### 9. REST API (all under /api/pager/)
- GET /messages?limit=&offset=&freq=&capcode=&search=&since=
- GET /stats (in-memory) 
- GET /stats/db (SQLite aggregates)
- GET /stats/hourly
- GET /capcodes
- PATCH /capcodes/:capcode
- GET /keyword-alerts
- POST /keyword-alerts
- DELETE /keyword-alerts/:id
- GET /discovered-frequencies

### New WebSocket Message Types
- `pager_stats` — periodic stats broadcast
- `pager_alert` — keyword match alerts with priority

### Files Modified
- `packages/server/src/pager/service.ts` — complete rewrite with SQLite integration
- `packages/server/src/pager/db.ts` — NEW: SQLite database layer
- `packages/server/src/pager/discovery.ts` — NEW: frequency discovery
- `packages/server/src/index.ts` — new API routes, FFT hook, alert broadcast
- `packages/client/src/components/PagerView.tsx` — complete UI upgrade
