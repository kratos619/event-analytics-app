import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import RejectedRecord from '../models/RejectedRecord';
import ImportRun from '../models/ImportRun';
import Event, { validateEvent } from '../models/Event';

// two events are the same if these 9 fields match (event_id is the key, received_at is ignored)
const FIELDS = ['customer_id', 'dealer_id', 'event_type', 'event_timestamp', 'lead_created_at', 'campaign_id', 'segment', 'email_provider', 'lead_status'];
const val = (v: any) => (v instanceof Date ? v.getTime() : v ?? null);    // dates are compared as numbers
const isSame = (a: any, b: any) => FIELDS.every((f) => val(a[f]) === val(b[f]));

// reads the file, saves the new events, keeps the rejected rows and records the run.
// { error } if the file is not a JSON array (the caller makes it a 400), otherwise { result }.
// If anything else goes wrong the run is saved as failed and the error is thrown
const importEvents = async (filePath: string) => {
    const start = Date.now();
    const file_id = randomUUID();            // one ID for this upload
    const file_name = path.basename(filePath);
    try {
        const rows = JSON.parse(fs.readFileSync(filePath, 'utf8'));

        if (!Array.isArray(rows)) return { error: 'input file must be a JSON array' };
        const goodEntries: any[] = [];
        const rejectedEntries: { row_number: number; reason: string; raw: any }[] = [];

        // events from this file that are already saved (one query): we treat them as "seen before"
        const ids = rows.map((r) => r?.event_id).filter((id) => typeof id === 'string');
        const saved = await Event.find({ event_id: { $in: ids } }).lean();
        const uniqueEntries = new Map<string, any>(saved.map((e) => [e.event_id, e]));   // event_id -> first copy

        for (let i = 0; i < rows.length; i++) {
            const result: any = validateEvent(rows[i]);       // { value } if clean, { reason } if bad
            if (result.reason) {
                rejectedEntries.push({ row_number: i + 1, reason: result.reason, raw: rows[i] });
            } else {
                const { event_id, ...rest } = result.value;
                if (!uniqueEntries.has(event_id)) {
                    uniqueEntries.set(event_id, rest);
                    goodEntries.push(result.value);
                } else if (isSame(uniqueEntries.get(event_id), rest)) {
                    rejectedEntries.push({ row_number: i + 1, reason: 'EXACT_DUPLICATE', raw: rows[i] }); // same fields -> exact duplicate,
                } else {
                    rejectedEntries.push({ row_number: i + 1, reason: 'CONFLICTING_DUPLICATE', raw: rows[i] });   // different fields -> conflict
                }
            }
        }

        const exact = rejectedEntries.filter((r) => r.reason === 'EXACT_DUPLICATE').length;
        const conflicting = rejectedEntries.filter((r) => r.reason === 'CONFLICTING_DUPLICATE').length;
        const invalid = rejectedEntries.length - exact - conflicting;

        await Event.insertMany(goodEntries.map((e) => ({ ...e, file_id })));              // every row of this upload carries the same file_id
        await RejectedRecord.insertMany(rejectedEntries.map((r) => ({ ...r, file_id })));   // rejectedEntries are unique, so one bulk insert

        const run = await ImportRun.create({
            file_id, file_name, status: 'completed', total_rows: rows.length, accepted: goodEntries.length,
            exact_duplicates: exact, conflicting_duplicates: conflicting, invalid, duration_ms: Date.now() - start,
        });
        return { result: { total_rows: rows.length, accepted: goodEntries.length, exact_duplicates: exact, conflicting_duplicates: conflicting, invalid, run } };
    } catch (e: any) {
        await ImportRun.create({ file_id, file_name, status: 'failed', error: e.message, duration_ms: Date.now() - start });
        console.error('import failed:', e.message);
        throw e;
    }
};

export { importEvents };
