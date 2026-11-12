# Event Analytics Application

This app imports events files you pick in the browser (one or several, like the brief's `events_10000.json`),
throws out the bad rows, removes duplicates, stores what is left in MongoDB and shows it in a small React
dashboard. The point of the exercise is that the numbers on the screen are the real ones: no invalid row and
no repeated event is counted.

The backend is Node, Express and TypeScript. The frontend is React and TypeScript. Both are in this repo
(`backend/` and `frontend/`).

## What changed since the first submission

The first review pointed out three things. This is what I changed for each, and where to see it.

| Feedback | What I changed |
| --- | --- |
| Business logic sat in the controllers | Controllers only read the request, call one service and send the answer (`eventsController.ts` is a few lines per endpoint). Query validation moved into the routes (`validateQuery`), the Mongo filter is built in one place in the service (`toMatch`), and no controller has a try/catch: errors go to one `errorHandler` |
| The import button only re-read a file on the server, one file | You pick one or several `.json` files in the browser. The page uploads them one after another and shows each file's status (waiting, importing, done or failed) and its summary. A bad file fails on its own and the others still import |
| It worked for the sample, but would it hold up with more data or more users? | The file is streamed in chunks of 1,000 rows instead of read into memory (a 130 MB file: 320 MB peak instead of 583 MB just to parse it). Writes are insert-only, so two imports at the same moment both finish and each event is saved once. Every import is recorded from its start and updated after each chunk; a failed or interrupted import is rolled back, so a retry gives the file's real numbers. The server waits for its indexes at startup (without them, four 10k-row files took 8 s, 23 s, 40 s and 54 s instead of 0.8 s each) |

The test suite now has 160 tests, including two imports racing on the same event, a crash during an import,
a retry after a failure and the quality screen after a rollback.

## What the brief asks for

In short: import the file with a summary, validate every row, deduplicate by `event_id`, keep rejected
rows so someone can look at them, group by the day the event happened (not the day it arrived), make a
second import safe, expose metrics through a filtered API, show it in a dashboard, test the edge cases,
and write down the decisions.

| The brief | Where it is |
| --- | --- |
| Import with a summary | `POST /api/import` and the file picker (one or several files) with the Import button |
| Validation, rejected rows kept | `backend/models/Event.ts`, the `rejectedrecords` collection, the quality panel |
| Deduplication, exact vs conflicting | `backend/services/importService.ts` |
| Event time vs received time | daily chart (event day), "Late arrivals" card |
| Second import must not change the totals | see "Importing the same file twice" |
| At least three metrics | by type, per day, by dealer, plus late arrivals |
| Filtered API with validation | `backend/routes/index.ts` (validation), `backend/validators/eventFilters.ts`, `backend/services/eventsService.ts` |
| Dashboard | `frontend/` |
| Tests for the edge cases | `backend/test/` (`import-service.test.ts` for the import, `api.test.ts` for the endpoints) |

## Run it

You need Node 20 or newer and MongoDB running on `localhost:27017`.

```bash
# backend, http://localhost:3000
cd backend
npm install
npm run dev

# frontend, http://localhost:5173 (second terminal)
cd frontend
npm install
npm run dev

# load the data: on the page, choose backend/data/events_10000.json (or several .json files) and press Import, or
curl -F 'file=@backend/data/events_10000.json' localhost:3000/api/import

# tests (second terminal, backend folder)
npm test
```

`npm start` in `backend/` builds the TypeScript and runs the compiled server. `npm test` uses its own
database, `event_analytics_test`, and empties it before every test, so it never touches the real data.

| Variable | Default | What it does |
| --- | --- | --- |
| `MONGO_URL` | `mongodb://localhost:27017/event_analytics` | database |
| `PORT` | `3000` | backend port |
| `UPLOAD_DIR` | `uploads` (inside `backend/`) | where uploaded files are kept |

The frontend sends every `/api` call to port 3000 through the Vite dev server (`frontend/vite.config.ts`),
so the backend needs no CORS setup.

I did not commit `backend/package-lock.json`. I built and tested with Node 20.19, Express 5.3,
Mongoose 9.11, Joi 18, TypeScript 7.0, React 19.3, Vite 8 and Recharts 3.10.

## What is in the file

Before writing any code I counted what is wrong with it.

| What | Rows |
| --- | --- |
| rows in the file | 10,000 |
| valid and new, so accepted | 9,000 |
| invalid | 600 (100 each of: no `event_id`, no `customer_id`, no `dealer_id`, unknown `event_type`, impossible `event_timestamp`, `lead_created_at` after `event_timestamp`) |
| exact duplicates | 300 (same event, only `received_at` differs) |
| conflicting duplicates | 100 (same `event_id`, different `event_type`) |
| accepted events that arrived more than 24 hours late | 493 |

The file is ordered by `received_at`, not by event time, so a later row is not a later event.

## How it fits together

```text
browser  ->  Vite dev server (5173)  --/api-->  Express (3000)  ->  MongoDB
```

```text
backend/
  server.ts               express app, routes under /api; at startup: MongoDB, indexes, rolls back interrupted imports
  routes/index.ts         URL to controller
  controllers/            HTTP only: read the request, call a service, send the answer
    importController.ts   POST /api/import
    eventsController.ts   metrics, quality and the events list
  services/               the logic and the queries, no Express in here
    importService.ts      stream an uploaded file from disk, then validate, deduplicate and save it in chunks, record the run
    eventsService.ts      the queries behind the metrics, quality and events endpoints
  middleware/             upload (saves the uploaded file to disk), validate (checks the URL query),
                          errorHandler (errors become responses)
  uploads/                the uploaded files, one per import, named <file_id>.json (not in git)
  validators/             the filter rules used by the validate middleware
  models/                 Event (schema, indexes, validateEvent), RejectedRecord, ImportRun
  test/                   validation, filters, services (against a test database) and the API
  data/events_10000.json  the file from the brief, unchanged
frontend/
  src/api/client.ts       every fetch goes through here
  src/App.tsx             filters, loading, page layout
  src/components/         Filters, ImportButton, SummaryCards, DailyChart, TypeBars,
                          DealerTable, EventsTable, QualityPanel
```

### Data model

| Collection | Fields |
| --- | --- |
| `events` | `event_id` (unique), `customer_id`, `dealer_id`, `event_type`, `event_timestamp`, `received_at`, `lead_created_at` (these three are dates), `campaign_id`, `segment`, `email_provider`, `lead_status`, `file_id` (the upload that first saved it) |
| `rejectedrecords` | `file_id` (the upload it was rejected in), `row_number` (1-based position in that file), `reason`, `raw` (the original row as it came), `createdAt`, `updatedAt` |
| `importruns` | `file_id` (one per upload, copied onto its events and rejected rows), `file_name`, `status` (`running`, `completed` or `failed`), `total_rows`, `accepted`, `exact_duplicates`, `conflicting_duplicates`, `invalid` (updated after every chunk), `duration_ms`, `error`, `rolled_back`, `createdAt` |

### Indexes and what uses them

The indexes are declared next to the schemas in `models/`, and Mongoose creates them when the app starts.
The server waits for them before it takes requests (`server.ts`), so no import ever runs without the unique
index on `event_id`, and it stops with the reason if one cannot be built (for example duplicates already in the
collection). After that, MongoDB updates every index on each insert by itself; nothing in the code maintains them.
Dropping a collection drops its indexes too, so after clearing the database by hand, restart the server
(`rs` in nodemon). Without them every `event_id` lookup scans the whole collection: four 10k-row files took
8 s, 23 s, 40 s and 54 s instead of about 0.8 s each. In production I would turn `autoIndex` off and create
the indexes in a migration at deploy time. There is no TTL (auto-expiry) index: events are the canonical data
and must not expire; rejected rows could get one once the business decides how long to keep them.

- `event_id`, unique. This is what makes a second import safe, and it is the last line of defence
  against a duplicate.
- `(dealer_id, event_timestamp)`. Serves a dealer plus a date range, and a dealer on its own.
  The dealer goes first because it is an exact match and the date is a range.
- `event_timestamp`. Serves a date range for all dealers. The events list sorts by `event_timestamp` and then
  by `event_id` (so pages never repeat a row), and MongoDB sorts the matching rows in memory for that, which
  is fine at this size.
- `event_type` has no index of its own. It has six values, so it filters badly alone, and the dealer and
  date filters already narrow the rows before the type is checked.
- `rejectedrecords` has an index on `{ file_id, row_number }`: the quality screen reads the rejected rows of
  one upload, in file order. `importruns` has no extra index, it is small.

The metrics are computed by MongoDB with an aggregation (`$match`, `$group`, `$sort`), so the browser
never receives all the events.

## How I went about it

1. Read the brief and profiled the file (the table above) so I knew which cases the code has to handle.
2. Wrote the data model and the validation, then the import, then ran it on the real file.
3. Compared the numbers from the API with numbers counted straight from the JSON file with a separate script.
4. Wrote the metric endpoints, then the tests for the six cases in the brief, then the frontend.
5. Kept everything as plain as I could. Where I picked the simple option over the faster one, it is
   written down below, together with what I would change.

## Decisions and why

**Rejected rows go in their own collection.**
There are three collections: `events`, `rejectedrecords` and `importruns`. The brief says an invalid row
must never reach an aggregate. If bad rows sit in `events` with a status flag, every query has to
remember to filter them out, and one forgotten filter puts bad data in a chart. With a separate
collection the metric queries cannot see them. It also fits the data: a value like
`2026-13-45T25:61:00Z` cannot be saved in a `Date` field, but it can be saved as the raw row.

**The first valid row with an `event_id` wins.**
A later row with the same id is an exact duplicate if the nine business fields match (everything except
`event_id` and `received_at`, which only says when it arrived). If any of them differs it is a
conflicting duplicate: the first event stays and the later row is saved in `rejectedrecords` with the
reason `CONFLICTING_DUPLICATE`. An invalid row never claims an id, because validation runs first.

**Importing the same file twice.**
Events already saved are loaded first (one query per chunk of 1,000 rows, on the ids of that chunk), so
every row of a second import is compared with what is stored. Nothing new is inserted and `events` does not change. The brief asks me
to say whether repeated rows are recorded again. My choice: every import gets its own `file_id`. It writes
its own summary to `importruns`, and its rejected rows (exact duplicates included) are saved in
`rejectedrecords` with the same `file_id`. Nothing is deleted, so a second import adds another 10,000
rejected rows, because every row is either invalid or already known. The quality screen shows the latest
**completed** import only, found by its `file_id`. A failed import is rolled back (its rejected rows are gone),
so if a newer import failed, the screen shows a warning with its error and how far it got, above the numbers
of the last completed one, instead of counts whose rows no longer exist.
The unique index on `event_id` is the safety net underneath.

**Insert-only writes, so two imports at the same moment are safe.**
The lookup above is a snapshot: another import can save the same event between our lookup and our write
(a check-then-act race). So new events are written with `bulkWrite` + `updateOne({ event_id }, { $setOnInsert:
event }, { upsert: true })`: "insert it only if it is still not saved". MongoDB tells us which ones it really
inserted (`upsertedIds`). A row that was not inserted lost the race, so it is compared with the saved copy and
recorded as an exact or conflicting duplicate. Both imports finish, the first copy is never overwritten
(`$setOnInsert` only writes on insert, never `$set`), and every row is still counted once. The tests under
"two imports at the same moment" fail with `E11000 duplicate key error` on the old `insertMany` version.

**Validation with Joi, in the model file.**
The Joi schema sits under the Mongoose schema in `models/Event.ts`, and `validateEvent(row)` returns
either the clean event or one reason code. The fields are checked in the order of the brief's table and
the first failure is the reason, so a row always gets the same code. I validate the raw row before it
reaches Mongoose because Mongoose changes types quietly: a number in `event_id` would be saved as a
string, and an object in a text field made a row vanish without an error in a test with unordered inserts.
Reason codes: `MISSING_EVENT_ID`, `MISSING_CUSTOMER_ID`, `MISSING_DEALER_ID`, `UNKNOWN_EVENT_TYPE`,
`INVALID_EVENT_TIMESTAMP`, `INVALID_RECEIVED_AT`, `INVALID_LEAD_CREATED_AT`, `INVALID_CAMPAIGN_ID`,
`INVALID_SEGMENT`, `INVALID_EMAIL_PROVIDER`, `INVALID_LEAD_STATUS`, `INVALID_LEAD_CHRONOLOGY`,
`INVALID_RECORD`, and for duplicates `EXACT_DUPLICATE` and `CONFLICTING_DUPLICATE`.
`campaign_id`, `segment`, `email_provider` and `lead_status` are only stored, so they may be empty or
missing. Extra keys in a row are ignored.

**Event time and received time.**
A day always means the UTC day of `event_timestamp`. An event is late when `received_at` is more than
24 hours after `event_timestamp` (`LATE_HOURS` in `eventsService.ts`). A late event is valid and counts
on the day it happened. Test 5 sends the later event first in the file and checks that nothing lands on
the day it arrived.

**Three small metric endpoints.**
By type, per day and by dealer do almost the same thing (filter, group, count). I kept them as separate
endpoints because the brief names three metrics and each one is easy to read. The route checks the query
string (bad values are a 400 before the controller runs), and one function in the service (`toMatch`) turns
the clean filters into a Mongo `$match`. One combined endpoint is possible and is on the list below.

**Backend layout.**
Routes call controllers, controllers call services, services use the models. A route validates the query
with middleware. A controller only reads the validated input, calls one service and sends the answer; it
has no try/catch, because Express 5 hands every failed async handler to `errorHandler`, the one place that
turns errors into responses. The import lives in `importService.ts` and the read queries in
`eventsService.ts`, so both are tested without HTTP.

**Several files: one request per file, from the browser.**
The picker takes several files, and the page sends them one per request, waiting for each answer before
the next. So the backend stays a plain single-file upload, every request is short (one file, at most 50 MB),
the user sees each file's status and summary as it finishes, and the files go in the order picked, so "the
first valid row wins" follows that order. One request with all the files would only show one spinner and
then everything at once, and its time would grow with the number of files.

**Tests use Node's built-in runner.**
`node --test` through `tsx`, so there is no extra test dependency. The files run one after another
(`--test-concurrency=1`) because they share one test database, which needs a running MongoDB and a name
with `test` in it. There are five files:

- `event-validation.test.ts`: `validateEvent`, every reason code (no database).
- `filters.test.ts`: the filter rules, the validate middleware and the error handler (no database).
- `events-service.test.ts`: every function in `eventsService` called directly on events saved straight
  into the database.
- `import-service.test.ts`: `importEvents` called directly with the path of a saved file. It covers the cases from the
  brief (a valid event, a missing id or bad timestamp, an exact and a conflicting duplicate, a second
  import) plus `file_id`, failed imports and the real 10,000-row file. The file is imported in chunks of
  1,000 rows, and there are tests that the result is the same for chunk sizes from 1 to 1000, that a repeat
  in a later chunk is still a duplicate, and that row numbers stay file-wide. Also: two imports racing on
  the same event, the run's progress after every chunk, rollback after a failure, recovery after a crash,
  and a retry that gives the same numbers as a first import.
- `api.test.ts`: the endpoints over HTTP, the upload (the file is saved to disk with the content that was
  sent), the 400 on every filtered route, and the 500 paths. It uses its own upload folder (`UPLOAD_DIR`).

A filter day that does not exist (`from=2026-02-30`) is a 400 on every endpoint, instead of being read as
March 2. To check the tests themselves I broke the code on purpose in 16 different ways (late threshold, date boundary, sort tie-break, duplicate
comparison, `file_id`, deleting old rejected rows, failed-run record and others) and each one made at
least one test fail.

**Frontend.**
React with Vite. Bootstrap comes from a CDN link, so there is no CSS to maintain. Recharts is used for the
one line chart. The bars for event types are plain Bootstrap progress bars. All shared state (filters, a
refresh counter, the loaded metrics) lives in `App.tsx` and goes down as props. The filter form keeps a
draft and only sends it when you press Apply, so typing never fires a request. Every `fetch` goes through
`src/api/client.ts`. The page has loading, empty and error states, and the quality panel and the
filters stay visible when there is no data. The four metric requests run at the same time. While new
numbers load, the old ones stay on screen, dimmed, and an answer for filters that have changed since is
ignored, so one dealer's numbers never show under another dealer's name.

## Assumptions

Where the brief left something open, this is what I assumed.

- `event_id` is unique across the whole file and across dealers. The same id with a different
  `dealer_id` is a conflict, not two events.
- "The same event" means the nine fields `customer_id`, `dealer_id`, `event_type`, `event_timestamp`,
  `lead_created_at`, `campaign_id`, `segment`, `email_provider` and `lead_status`. `received_at` is ignored
  because it only says when the row arrived.
- File order decides which row is first. An invalid row never counts as the first one, so a later valid row
  with the same id is accepted.
- An id, customer or dealer made only of spaces counts as missing. Event types are case sensitive, so
  `email_sent` is unknown.
- Timestamps must be UTC ISO-8601 ending in `Z`, like `2026-09-01T10:00:00Z` (milliseconds allowed), because
  the brief says every well-formed timestamp is UTC. An offset such as `+05:30`, a date without a time and a
  time without a timezone are rejected. So is a day that does not exist, like `2026-02-30`, instead of being
  moved to 2 March.
- `lead_created_at` equal to `event_timestamp` is fine, only a later one is rejected. A `received_at` that is
  earlier than the event time is not treated as an error, because the brief does not call it one.
- `campaign_id`, `segment`, `email_provider` and `lead_status` may be empty, `null` or missing. A value that
  is not text, such as a number or an object, is rejected so it cannot be saved wrongly.
- Late means more than 24 hours after the event, strictly more.
- `from` and `to` are UTC calendar days, and both days are included (`from` starts at 00:00:00, `to` ends at
  23:59:59.999).
- A dealer is a tenant. The dealer filter is an exact match on `dealer_id` in every metric and in the events
  list, so a filtered view never contains another dealer's events.
- A missing earlier event, such as an open with no send, is not an error, and no rate is shown.

## API

| Endpoint | Returns |
| --- | --- |
| `POST /api/import` | a form with one events file in the field `file` (a `.json` file holding an array, up to 50 MB). The file is saved to `uploads/` as `<file_id>.json`, then imported from there. Returns the summary and the saved run. A bad file is a 400 with the reason (and a failed run). For several files the page sends one request per file |
| `GET /api/metrics/by-type` | accepted events per event type |
| `GET /api/metrics/daily` | accepted events per UTC event day |
| `GET /api/metrics/by-dealer` | accepted events per dealer, biggest first |
| `GET /api/metrics/late` | accepted total, late count, average delay in minutes |
| `GET /api/quality` | the latest completed import (`last_import`), the number of its rejected rows per reason, and a newer import that failed, if any (`last_failed`) |
| `GET /api/quality/rejected` | rows the latest completed import did not save, with their original data |
| `GET /api/events` | accepted events, newest first |
| `GET /health` | `{ "ok": true }` |

The four metric endpoints and `/api/events` take the same optional filters: `dealer_id`, `event_type`,
`from` and `to` (`YYYY-MM-DD`, UTC days, both included). A wrong value, an unknown parameter or a `from`
after `to` returns HTTP 400 with a message. The two list endpoints also take `page` and `limit`
(at most 100), and `/api/quality/rejected` takes `reason`.

## What the metrics mean

- **Accepted events**: valid events after deduplication, inside the chosen filters.
- **By type, by dealer, per day**: accepted events counted per type, per dealer, per UTC event day.
- **Late arrivals**: accepted events received more than 24 hours after they happened. The card shows that
  count and, as a percentage, the count divided by all accepted events in the same filters (493 of 9,000,
  5.5%).
- **Average delay**: the mean of `received_at - event_timestamp` over the accepted events (373 minutes).

The file has no `message_id`, so I do not show an open rate, click rate or delivery rate. There is no
way to match a send to its open. A missing earlier event, like an open without a send, is not an error.

## Performance

Measured on my laptop with MongoDB running locally, on the supplied file (3.9 MB, 10,000 rows).

| | Time | Backend memory |
| --- | --- | --- |
| first import, 9,000 events inserted | about 0.8 s | about 180–245 MB at the peak |
| same file again (nothing new, 10,000 rejected rows) | about 0.7 s | about the same |
| four 10k-row files picked together | about 0.7–0.95 s each | about the same |

The memory figures are the process size sampled while the import ran, so treat them as rough. The first
version took about 0.4 s: it read the whole file with `JSON.parse`, which is faster than the streaming
parser but needs the whole file in memory (see below). I chose bounded memory over that 0.4 s.

Indexes: unique on `event_id`, plus `(dealer_id, event_timestamp)` and `event_timestamp` for the filters.
For one dealer and a week, MongoDB reads about 90 documents instead of all 9,000. On this much data every
query still takes only a few milliseconds with or without the indexes, so the gain shows when the
collection grows, not now.

The import reads the file as a stream (`stream-json`), one row at a time, and an async generator
(`readInChunks` in `importService.ts`) hands out chunks of 1,000 rows. Each chunk is looked up, checked and
saved before the next one is read, so only one chunk is in memory and the file never exists in memory as a
whole. Measured on a 130 MB file (400,000 rows, the sample copied 40 times with new ids):

| | Peak backend memory |
| --- | --- |
| old way, `readFile` + `JSON.parse` only (before saving anything) | about 583 MB |
| new way, the whole streamed import (28 s) | about 320 MB |
| new way, the 10,000-row sample (0.8 s) | about 180–245 MB (varies between runs) |

Insert-only writes (`bulkWrite` with upserts, see Decisions) cost about the same as `insertMany`: 0.8 s for
the sample both ways, 28 s instead of 27 s for the 130 MB file.

The old way needed about 4.5 times the file size just to parse it, so a 1 GB file would need several GB.
The streamed import grows only a little with the file (mostly the database driver and garbage collection).

**The main bottleneck at larger scale.** The import runs at about 12,000–14,000 rows per second (400,000 rows
in 28 s), and almost all of that time is the database: per chunk one lookup, one `bulkWrite` and one insert
of rejected rows. So:

- **Writes.** A million rows is about 80 s inside one HTTP request, one file at a time. The next step would
  be to upload to object storage, answer 202 at once, and import in background workers from a queue, with
  progress read from the run (polling or server-sent events). Several workers on different files are already
  safe, because writes are insert-only on a unique `event_id`.
- **Reads.** Every dashboard request aggregates over all matching events. With millions of events that
  becomes the slow part, so I would keep pre-computed daily counts per dealer and type (updated by the
  import) and read the charts from those, with a short cache in front.
- **One database.** Past one machine, the events would be sharded, by `event_id` for the unique check or by
  `dealer_id` for the dashboard queries, which is a trade-off to decide with the access patterns.

## Reliability, logs and input handling

- **Atomic or resumable? Each file is all-or-nothing (atomic by rollback), and safe to restart.** The run is
  created first (`running`) and its counts are saved after every chunk, so the database always shows how far
  an import got. If the import fails (bad file half way, database error), everything it saved is removed by
  its `file_id` and the run is marked `failed` with `rolled_back: true` and the counts it reached. If the
  server dies during an import (Ctrl+C, crash, restart), no catch block runs; at the next start every run
  still `running` is rolled back the same way and marked `failed: interrupted`. A retry is then a clean
  import with the file's real numbers, and no half-import is left in the totals or the rejected rows.
  Tested for real: a 100,000-row upload killed after 2 s left a `running` run at 25,000 rows and 22,501
  events (one event of chunk 26 was written before the kill); the next start removed them, and the
  re-upload gave 90,000 / 3,000 / 1,000 / 6,000. Not a MongoDB transaction: that needs a replica set and a
  whole file is too big for one. Not resumable: a retry starts from row 1, which is about a second for these
  files (see "What I want to improve next" for resume).
- **Failures.** Every import that starts leaves a run in `importruns`: `completed`, or `failed` with the
  error message, and the error is printed to the console (`import failed, rolled back: ...`). A bad file
  (not JSON, not an array, cut off half way) is a 400 with the reason. Anything else (the database) is a 500
  that does not show the internal message to the client; the run keeps it. The server prints a line when it
  starts, and exits with a message if MongoDB is not reachable or an index cannot be built.
- **One error path.** Controllers have no try/catch. Expected errors are thrown as `AppError(status, message)`,
  Express 5 hands every failed async handler to `errorHandler`, and that one place picks the status, logs
  5xx errors and hides their message. Every endpoint answers errors as `{ error, message }`.
- **Validation in the routes.** Every route that reads the URL query validates it with `validateQuery`
  (Joi schemas in `validators/eventFilters.ts`), so a controller only sees clean values. The services build
  the MongoDB query from those values (`toMatch` in `eventsService.ts`, the only place that does it).
- **Untrusted input.** The file must be a JSON array, and every row is checked at runtime, because
  TypeScript types say nothing about what is in a JSON file. Query strings are validated and unknown
  parameters are rejected. There are no secrets in the code, only defaults and environment variables.

## AI development note

I used Claude Code (Claude Sonnet 5.5) as a pair programmer, in the terminal and in VS Code. For a last
review of the finished project I used Claude (Opus 5.5) in the Claude app. For the changes after the first
review I used Claude Code (Claude Opus 5.5) in VS Code.

What it did: most of the code started as suggestions from Claude in chat (the validation, the import,
the metric queries, the React components and the tests). I typed or approved every file, ran it, and
asked for changes. It also ran checks for me on scratch copies of the project.

What I checked: I ran `npm test` (all tests pass). The numbers from the API were compared with numbers counted
directly from the JSON file by a separate script (9,000, 300, 100, 600, the per-dealer and per-day counts
and the 493 late events). I opened the dashboard and used the filters and the Import button, looked at
the empty state, and saw the error state when the backend was off. The tests were also run against code
that had been broken on purpose to see them fail.

Where I stepped in:

- The first version of the import was about 80 lines with batching, `bulkWrite` and several helper
  functions. I asked for something I could read and explain, and it was rebuilt as one loop with a `Map`.
- It started with a service layer and several extra controller files. In the first submission I removed
  them to keep the code small, and the logic ended up in the controllers. The review showed that was the
  wrong call, so the service layer is back (see "What changed since the first submission").
- Its first frontend API file used generics and `Promise.all`. I asked for the plain style I use in my
  own React projects (`fetch`, check `ok`, return the JSON), and it was rewritten that way. Later I put
  `Promise.all` back in `App.tsx`, because loading the four metrics one after another was slower.
- In that last review, `Joi.date().iso()` turned out to accept `2026-02-30` (saved as 2 March) and to read
  a time without `Z` in the server's timezone. I changed the rule to accept only UTC times ending in `Z`
  that turn back into the same text.
- The same review found that pressing Apply with nothing changed left the spinner on for good, and that a
  slow answer for an old dealer filter could replace the numbers of the new one. The spinner now turns on
  only when data really loads, and an old answer is ignored.
- It added its own name as co-author on my commits, and the e-mail it set up for them was linked on
  GitHub to a different account. I removed that line and rewrote the commits with my own GitHub no-reply
  address.

After the first review, I asked for every change to be explained with an example of the old and the new
behaviour before any code was written, and I decided on each one. What I checked: all 160 tests on Node 20
and 24, the 10,000-row numbers after every change, the dashboard in the browser, and the import under
failure (a 100,000-row upload with the server killed half way, then restarted). Where I stepped in:

- It proposed answering the upload with 202, a queue, and the browser asking for the status every second.
  For files that import in under a second that is machinery without a benefit, and the brief makes live
  progress optional, so I said no. The same goes for sockets. It is written down as the next step for
  big files instead.
- It proposed sending several files in one request. I wanted the backend to stay a plain single-file
  upload, so the browser sends the files one by one and shows each file's status.
- While testing I dropped the database with the server running, and four 10k-row files took 8 s, 23 s,
  40 s and 54 s. `explain()` showed a full collection scan: the indexes had gone with the collections. Its
  first fix created the indexes before every import. I asked for the conventional place instead: the server
  creates them at startup, waits for them, and stops if one cannot be built.
- I killed the server during an import and the quality screen then showed a failed import's counts above an
  empty table: its change that rolls back failed imports had removed the rows the screen was listing. The
  screen now shows the latest completed import, with a warning about the newer failed one.

## What is not great

- **Two imports at the same moment work on one database.** Both finish and each event is saved once (see
  Decisions), but which import "wins" an event depends on which one writes first, not on upload order.
- **A rolled-back import was briefly visible.** While a file imports, its events already count on the
  dashboard; if it then fails, they disappear again. If another import ran at that same moment and saw them
  as duplicates, those rows stay recorded as duplicates of events that are now gone. A large system would
  import into a staging area first and publish when the file is complete.
- **Crash recovery assumes one server.** At startup every `running` run is treated as cut off. With several
  servers, each run would need the id of its server (or a heartbeat), so one server does not roll back
  another server's live import.
- **`rejectedrecords` grows with every import.** Each row carries the `file_id` of its upload and the
  quality screen reads only the latest one, but old rows are never cleaned up. Uploading the same file
  again adds its rows again.
- **The import runs inside the upload request.** The browser waits until the whole file is imported. The
  import itself streams, but the upload is still limited to 50 MB (the browser checks that before sending).
  For bigger files the next step is to answer 202 at once and let the browser poll the run's status.
- **Uploaded files are never deleted.** A file stays in `uploads/` exactly when a run with its `file_id`
  exists (also a failed one, so it can be looked at). There is no clean-up job, so the folder grows with
  every import, and uploading the same file twice keeps two copies.
- **Only `.json` files are accepted**, one per request (the page sends several one after another). Other
  formats such as CSV would need a parser step before the import.
- **Some browsers and tools send a file name that multer reads wrongly** (it decodes names as latin1). The
  controller converts it back to UTF-8, which is what browsers send.
- **Pagination uses `skip`**, which gets slow on very deep pages.
- **Timestamps are strict.** Only UTC times ending in `Z` are accepted, so a valid ISO time with an offset
  such as `+05:30` is rejected. The brief says every good timestamp is UTC.
- **Frontend.** No automated UI tests, I checked it by hand. Filter inputs have no labels, only a `title`.
  Most types are `any`.
- No authentication, as the brief says it is out of scope.

## What I want to improve next

I am sending this version first to stay inside the time box. I would change these next, in this order:

1. ~~Stream and batch the import~~ (done: see Performance).
2. ~~Make concurrent imports safe~~ (done: insert-only writes, see Decisions).
3. Return the dashboard metrics from one aggregation, or pre-computed daily totals if the data grows a lot.
4. Cursor pagination instead of `skip`.
5. Frontend: labels, proper types, a few UI tests.
6. Resume instead of starting again, for very big files: the run already keeps how far it got after every
   chunk, and the uploaded file stays on disk. Resume would remove only what the half-finished chunk saved
   (events would store the row they came from), then continue from the last finished chunk.


