import fs from 'fs';
import StreamArray from 'stream-json/streamers/StreamArray';
import RejectedRecord from '../models/RejectedRecord';
import ImportRun from '../models/ImportRun';
import Event, { validateEvent } from '../models/Event';
import { AppError } from '../middleware/errorHandler';

const CHUNK_SIZE = 1000;   // rows that are looked up, checked and saved together

// two events are the same if these 9 fields match (event_id is the key, received_at is ignored)
const FIELDS = ['customer_id', 'dealer_id', 'event_type', 'event_timestamp', 'lead_created_at', 'campaign_id', 'segment', 'email_provider', 'lead_status'];
const val = (v: any) => (v instanceof Date ? v.getTime() : v ?? null);    // dates are compared as numbers
const isSame = (a: any, b: any) => FIELDS.every((f) => val(a[f]) === val(b[f]));

// the parser's messages, turned into a 400 the user can understand. Anything else (e.g. a missing file) stays as it is
const toBadFileError = (e: unknown) => {
    const message = e instanceof Error ? e.message : String(e);
    if (message.includes('should be an array')) return new AppError(400, 'input file must be a JSON array');
    if (message.startsWith('Parser')) return new AppError(400, `input file is not valid JSON: ${message}`);
    return e;
};

// reads the file ONE ROW AT A TIME and hands out chunks of `size` rows (a generator: the next chunk is only read when
// it is asked for). start = position of the chunk's first row in the file, so row numbers stay file-wide.
// Only one chunk is in memory, so a 1 GB file needs about the same memory as a 4 MB one
async function* readInChunks(filePath: string, size: number) {
    if (!Number.isInteger(size) || size < 1) throw new RangeError('chunk size must be a whole number of 1 or more');
    const parser = StreamArray.withParser();
    const file = fs.createReadStream(filePath);
    file.on('error', (err) => parser.destroy(err));   // pipe() does not pass read errors on, so a missing file would hang
    let rows: unknown[] = [];
    let start = 0;
    try {
        for await (const { value } of file.pipe(parser) as AsyncIterable<{ value: unknown }>) {
            rows.push(value);
            if (rows.length === size) {
                yield { start, rows };
                start += size;
                rows = [];
            }
        }
    } catch (e) {
        throw toBadFileError(e);
    }
    if (rows.length > 0) yield { start, rows };
}

type Counts = { accepted: number; exact: number; conflicting: number; invalid: number };

// looks up, checks and saves ONE chunk of rows. Events saved by earlier chunks (or earlier imports) are found by the
// lookup, so a repeat in a later chunk is still a duplicate and the first copy still wins
const processChunk = async (rows: any[], start: number, file_id: string): Promise<Counts> => {
    const goodEntries: any[] = [];
    const rejectedEntries: { row_number: number; reason: string; raw: any }[] = [];

    // events of this chunk that are already saved (one query): we treat them as "seen before"
    const ids = rows.map((r) => r?.event_id).filter((id) => typeof id === 'string');
    const saved = await Event.find({ event_id: { $in: ids } }).lean();
    const uniqueEntries = new Map<string, any>(saved.map((e) => [e.event_id, e]));   // event_id -> first copy

    for (let i = 0; i < rows.length; i++) {
        const row_number = start + i + 1;                 // position in the whole file, not in the chunk
        const result: any = validateEvent(rows[i]);       // { value } if clean, { reason } if bad
        if (result.reason) {
            rejectedEntries.push({ row_number, reason: result.reason, raw: rows[i] });
        } else {
            const { event_id, ...rest } = result.value;
            if (!uniqueEntries.has(event_id)) {
                uniqueEntries.set(event_id, rest);
                goodEntries.push(result.value);
            } else if (isSame(uniqueEntries.get(event_id), rest)) {
                rejectedEntries.push({ row_number, reason: 'EXACT_DUPLICATE', raw: rows[i] }); // same fields -> exact duplicate,
            } else {
                rejectedEntries.push({ row_number, reason: 'CONFLICTING_DUPLICATE', raw: rows[i] });   // different fields -> conflict
            }
        }
    }

    const exact = rejectedEntries.filter((r) => r.reason === 'EXACT_DUPLICATE').length;
    const conflicting = rejectedEntries.filter((r) => r.reason === 'CONFLICTING_DUPLICATE').length;
    const invalid = rejectedEntries.length - exact - conflicting;

    await Event.insertMany(goodEntries.map((e) => ({ ...e, file_id })));              // every row of this upload carries the same file_id
    await RejectedRecord.insertMany(rejectedEntries.map((r) => ({ ...r, file_id })));   // rejectedEntries are unique, so one bulk insert
    return { accepted: goodEntries.length, exact, conflicting, invalid };
};

// streams an uploaded file from disk (filePath), saves its new events chunk by chunk, keeps the rejected rows and records the run.
// file_name is the name the user gave it, file_id is the one ID of this upload (it goes on everything saved).
// Every import that starts leaves a run: completed, or failed with the error. On failure the error is thrown again:
// a bad file is an AppError(400), anything else (the database) a 500, and the errorHandler turns it into the response.
// Chunks saved before a failure stay saved (their events carry this file_id), and the failed run shows the counts so far
const importEvents = async (filePath: string, file_name: string, file_id: string, chunkSize = CHUNK_SIZE) => {
    const start = Date.now();
    const totals: Counts = { accepted: 0, exact: 0, conflicting: 0, invalid: 0 };   // grows chunk by chunk
    let total_rows = 0;
    try {
        for await (const chunk of readInChunks(filePath, chunkSize)) {
            const counts = await processChunk(chunk.rows, chunk.start, file_id);
            totals.accepted += counts.accepted;
            totals.exact += counts.exact;
            totals.conflicting += counts.conflicting;
            totals.invalid += counts.invalid;
            total_rows += chunk.rows.length;
        }

        const run = await ImportRun.create({
            file_id, file_name, status: 'completed', total_rows, accepted: totals.accepted,
            exact_duplicates: totals.exact, conflicting_duplicates: totals.conflicting, invalid: totals.invalid, duration_ms: Date.now() - start,
        });
        return { total_rows, accepted: totals.accepted, exact_duplicates: totals.exact, conflicting_duplicates: totals.conflicting, invalid: totals.invalid, run };
    } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        await ImportRun.create({
            file_id, file_name, status: 'failed', error: message, total_rows, accepted: totals.accepted,
            exact_duplicates: totals.exact, conflicting_duplicates: totals.conflicting, invalid: totals.invalid, duration_ms: Date.now() - start,
        });
        console.error('import failed:', message);
        throw e;
    }
};

export { importEvents, readInChunks };
