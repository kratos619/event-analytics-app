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

// saves the new events of a chunk, insert-only: "insert e1 only if e1 is not saved yet".
// If another import saved e1 a moment ago, MongoDB leaves that copy alone ($setOnInsert never overwrites) instead
// of failing with a duplicate key error. Returns the positions of the events that were really inserted
const saveNewEvents = async (events: any[], file_id: string) => {
    if (events.length === 0) return new Set<number>();
    const result = await Event.bulkWrite(events.map((event) => ({
        updateOne: {
            filter: { event_id: event.event_id },
            update: { $setOnInsert: { ...event, file_id } },
            upsert: true,
        },
    })));
    // upsertedIds = { position: id } for every insert, e.g. { 0: ..., 2: ... }
    return new Set(Object.keys(result.upsertedIds).map(Number));
};

// looks up, checks and saves ONE chunk of rows. Events saved by earlier chunks (or earlier imports) are found by the
// lookup, so a repeat in a later chunk is still a duplicate and the first copy still wins
const processChunk = async (rows: any[], start: number, file_id: string): Promise<Counts> => {
    const goodEntries: { row_number: number; raw: any; event: any }[] = [];
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
                goodEntries.push({ row_number, raw: rows[i], event: result.value });
            } else if (isSame(uniqueEntries.get(event_id), rest)) {
                rejectedEntries.push({ row_number, reason: 'EXACT_DUPLICATE', raw: rows[i] }); // same fields -> exact duplicate,
            } else {
                rejectedEntries.push({ row_number, reason: 'CONFLICTING_DUPLICATE', raw: rows[i] });   // different fields -> conflict
            }
        }
    }

    const inserted = await saveNewEvents(goodEntries.map((g) => g.event), file_id);

    // Our lookup above is a snapshot. If another import saved the same event between our lookup and our write,
    // that event was not inserted: it lost the race, so it is a duplicate of the saved copy. Compare with that copy.
    const lost = goodEntries.filter((_, i) => !inserted.has(i));
    if (lost.length > 0) {
        const stored = await Event.find({ event_id: { $in: lost.map((g) => g.event.event_id) } }).lean();
        const storedById = new Map(stored.map((e) => [e.event_id, e]));
        for (const g of lost) {
            const reason = isSame(storedById.get(g.event.event_id), g.event) ? 'EXACT_DUPLICATE' : 'CONFLICTING_DUPLICATE';
            rejectedEntries.push({ row_number: g.row_number, reason, raw: g.raw });
        }
        console.warn(`[import] file_id=${file_id}: ${lost.length} event(s) were saved by another import at the same moment, recorded as duplicates`);
    }

    // counted after the write, because a row that lost the race became a duplicate
    const exact = rejectedEntries.filter((r) => r.reason === 'EXACT_DUPLICATE').length;
    const conflicting = rejectedEntries.filter((r) => r.reason === 'CONFLICTING_DUPLICATE').length;
    const invalid = rejectedEntries.length - exact - conflicting;

    await RejectedRecord.insertMany(rejectedEntries.map((r) => ({ ...r, file_id })));   // every row of this upload carries the same file_id
    return { accepted: inserted.size, exact, conflicting, invalid };
};

// removes everything one import saved. Every event it inserted and every rejected row carries its file_id
// (an event that was already saved keeps the file_id of the import that first saved it, so it is not touched).
// ponytail: events have no index on file_id, so this scans the collection; fine because rollbacks are rare
const rollBack = async (file_id: string) => {
    const [events, rejected] = await Promise.all([
        Event.deleteMany({ file_id }),
        RejectedRecord.deleteMany({ file_id }),
    ]);
    console.warn(`[import] rolled back file_id=${file_id}: removed ${events.deletedCount} events and ${rejected.deletedCount} rejected rows`);
};

// streams an uploaded file from disk (filePath), saves its new events chunk by chunk, keeps the rejected rows and records the run.
// file_name is the name the user gave it, file_id is the one ID of this upload (it goes on everything saved).
// The run is created first ("running") and its counts are saved after every chunk, so the database always shows how far
// an import got. Each file is all-or-nothing: if it fails, what it saved is rolled back and the run is marked failed.
// The error is then thrown again: a bad file is an AppError(400), anything else a 500 (the errorHandler answers)
const importEvents = async (filePath: string, file_name: string, file_id: string, chunkSize = CHUNK_SIZE) => {
    const start = Date.now();
    const totals: Counts = { accepted: 0, exact: 0, conflicting: 0, invalid: 0 };   // grows chunk by chunk
    let total_rows = 0;
    // the counts so far, in the shape the run stores them
    const counts = () => ({
        total_rows, accepted: totals.accepted, exact_duplicates: totals.exact,
        conflicting_duplicates: totals.conflicting, invalid: totals.invalid,
    });

    // the run exists from the start, so even a crash half way leaves a trace (see recoverInterruptedImports)
    await ImportRun.create({ file_id, file_name, status: 'running' });
    console.log(`[import] started ${file_name} (file_id=${file_id})`);
    try {
        for await (const chunk of readInChunks(filePath, chunkSize)) {
            const chunkCounts = await processChunk(chunk.rows, chunk.start, file_id);
            totals.accepted += chunkCounts.accepted;
            totals.exact += chunkCounts.exact;
            totals.conflicting += chunkCounts.conflicting;
            totals.invalid += chunkCounts.invalid;
            total_rows += chunk.rows.length;
            await ImportRun.updateOne({ file_id }, { $set: counts() });   // progress after every chunk
        }

        const run = await ImportRun.findOneAndUpdate(
            { file_id },
            { $set: { ...counts(), status: 'completed', duration_ms: Date.now() - start } },
            { returnDocument: 'after' },   // answer with the run as it is now
        );
        console.log(`[import] done ${file_name}: ${total_rows} rows -> ${totals.accepted} accepted, ${totals.exact} exact duplicates, `
            + `${totals.conflicting} conflicting, ${totals.invalid} invalid, in ${Date.now() - start} ms`);
        return { ...counts(), run: run! };
    } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        // a bad file is the client's mistake (warning); anything else, like the database, is ours (error)
        const report = e instanceof AppError ? console.warn : console.error;
        report(`[import] failed ${file_name} (file_id=${file_id}) after ${total_rows} rows: ${message}`);
        await rollBack(file_id);
        await ImportRun.updateOne({ file_id }, {
            $set: { ...counts(), status: 'failed', error: message, rolled_back: true, duration_ms: Date.now() - start },
        });
        throw e;
    }
};

// A run still "running" when the server starts was cut off by a crash or a restart: no catch block ran for it.
// Roll back what it saved and mark it failed, keeping its counts so far. Called once at startup (server.ts).
// ponytail: assumes one server. With several, this would also cut another server's live import (needs a server id or heartbeat)
const recoverInterruptedImports = async () => {
    const runs = await ImportRun.find({ status: 'running' }).lean();
    for (const run of runs) {
        console.warn(`[startup] import of ${run.file_name} (file_id=${run.file_id}) was cut off after ${run.total_rows} rows, rolling it back`);
        if (run.file_id) await rollBack(run.file_id);
        await ImportRun.updateOne({ _id: run._id }, {
            $set: { status: 'failed', error: 'interrupted: the server stopped during this import', rolled_back: true },
        });
    }
    return runs.length;
};

export { importEvents, readInChunks, recoverInterruptedImports };
