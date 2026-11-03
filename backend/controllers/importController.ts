import fs from 'fs';
import { Request, Response } from 'express';
import RejectedRecord from '../models/RejectedRecord';
import ImportRun from '../models/ImportRun';
import Event, { validateEvent } from '../models/Event';

const FILE = process.env.EVENTS_FILE ?? 'data/events_10000.json';   // where the input file is

// two events are the same if these 9 fields match (event_id is the key, received_at is ignored)
const FIELDS = ['customer_id', 'dealer_id', 'event_type', 'event_timestamp', 'lead_created_at', 'campaign_id', 'segment', 'email_provider', 'lead_status'];
const val = (v: any) => (v instanceof Date ? v.getTime() : v ?? null);    // dates are compared as numbers
const isSame = (a: any, b: any) => FIELDS.every((f) => val(a[f]) === val(b[f]));
 



const importEvents = async (req: Request, res: Response) => {
    const start = Date.now();
    try {
        
        const rows = JSON.parse(fs.readFileSync(FILE, 'utf8'));
     
        if (!Array.isArray(rows)) return res.status(400).send({ error: 'Bad Request', message: 'input file must be a JSON array' });
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
            }else{
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
        
        await Event.insertMany(goodEntries); 
        await RejectedRecord.deleteMany({});                  // rejected_records shows only the latest import
        await RejectedRecord.insertMany(rejectedEntries);     // rejectedEntries are unique, so one bulk insert

        const run = await ImportRun.create({
            status: 'completed', total_rows: rows.length, accepted: goodEntries.length,
            exact_duplicates: exact, conflicting_duplicates: conflicting, invalid, duration_ms: Date.now() - start,
        });
        return res.status(200).send({ total_rows: rows.length, accepted: goodEntries.length, exact_duplicates: exact, conflicting_duplicates: conflicting, invalid , run });

    } catch (e: any) {
        await ImportRun.create({ status: 'failed', error: e.message, duration_ms: Date.now() - start });
        console.error('import failed:', e.message);
        return res.status(500).send({ error: 'Import failed', message: e.message });
    }
};

export { importEvents };
