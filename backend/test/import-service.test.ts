// importEvents called directly with the path of a saved file (no HTTP), against the test database
import { test, describe, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import { randomUUID } from 'crypto';
import Event from '../models/Event';
import RejectedRecord from '../models/RejectedRecord';
import ImportRun from '../models/ImportRun';
import { importEvents } from '../services/importService';
import * as eventsService from '../services/eventsService';
import { base, ev, writeRows, useTestDb } from './helpers';

useTestDb();

// imports a file made of these rows, as an upload called events-test.json; the test fails if the service answers with an error
const run = async (rows: unknown, file_id = randomUUID()) => {
    const out = await importEvents(writeRows(rows), 'events-test.json', file_id);
    assert.equal(out.error, undefined);
    return out.result!;
};
const counts = (r: any) => ({ total_rows: r.total_rows, accepted: r.accepted, exact: r.exact_duplicates, conflicting: r.conflicting_duplicates, invalid: r.invalid });

describe('a clean file', () => {
    test('reads the file, saves the events and records the run', async () => {
        const result = await run([base, ev({ event_id: 'e2' })]);
        assert.deepEqual(counts(result), { total_rows: 2, accepted: 2, exact: 0, conflicting: 0, invalid: 0 });
        assert.equal(result.run.status, 'completed');
        assert.equal(result.run.file_name, 'events-test.json');
        assert.equal(typeof result.run.duration_ms, 'number');
        assert.equal(await Event.countDocuments(), 2);
        assert.equal(await RejectedRecord.countDocuments(), 0);
        assert.ok((await Event.findOne({ event_id: 'e1' }).lean())!.event_timestamp instanceof Date);   // stored as a real date
    });

    test('the run uses the file_id and the file name it is given, not the name of the file on disk', async () => {
        const id = randomUUID();
        const out = await importEvents(writeRows([base], 'stored-as-something-else.json'), 'my events (March).json', id);
        assert.equal(out.result!.run.file_id, id);
        assert.equal(out.result!.run.file_name, 'my events (March).json');
        const saved = await ImportRun.findOne().lean();
        assert.deepEqual({ file_id: saved!.file_id, file_name: saved!.file_name }, { file_id: id, file_name: 'my events (March).json' });
    });

    test('the run in the answer is the run that was saved', async () => {
        const result = await run([base, ev({ event_id: '' })]);
        const saved = await ImportRun.findOne().lean();
        assert.equal(await ImportRun.countDocuments(), 1);
        assert.equal(String(saved!._id), String(result.run._id));
        assert.deepEqual(
            { file_id: saved!.file_id, total_rows: saved!.total_rows, accepted: saved!.accepted, invalid: saved!.invalid },
            { file_id: result.run.file_id, total_rows: 2, accepted: 1, invalid: 1 },
        );
    });

    test('an empty file is a completed run with zeros', async () => {
        const result = await run([]);
        assert.deepEqual(counts(result), { total_rows: 0, accepted: 0, exact: 0, conflicting: 0, invalid: 0 });
        assert.equal(await ImportRun.countDocuments({ status: 'completed' }), 1);
    });
});

describe('rejected rows', () => {
    test('each bad row keeps its reason, its 1-based row number and its original data', async () => {
        const rows = [
            base,                                                                  // 1: fine
            ev({ event_id: 'e2', event_type: 'EMAIL_LOST' }),                      // 2
            'not an object',                                                       // 3
            ev({ event_id: 'e4', lead_created_at: '2026-10-01T00:00:00Z' }),       // 4
            null,                                                                  // 5
            ev({ event_id: 'e6', event_timestamp: '2026-02-30T10:00:00Z' }),       // 6
        ];
        const result = await run(rows);
        assert.deepEqual(counts(result), { total_rows: 6, accepted: 1, exact: 0, conflicting: 0, invalid: 5 });
        const rejected = await RejectedRecord.find().sort({ row_number: 1 }).lean();
        assert.deepEqual(rejected.map((r) => [r.row_number, r.reason]), [
            [2, 'UNKNOWN_EVENT_TYPE'], [3, 'INVALID_RECORD'], [4, 'INVALID_LEAD_CHRONOLOGY'], [5, 'INVALID_RECORD'], [6, 'INVALID_EVENT_TIMESTAMP'],
        ]);
        assert.deepEqual(rejected[0].raw, rows[1]);                                // the original row, untouched
        assert.equal(rejected[1].raw, 'not an object');
        assert.equal(await Event.countDocuments(), 1);
    });
});

describe('duplicates inside one file', () => {
    test('the same event again (only received_at differs) is an exact duplicate', async () => {
        const result = await run([base, ev({ received_at: '2026-09-01T18:00:00Z' })]);
        assert.deepEqual(counts(result), { total_rows: 2, accepted: 1, exact: 1, conflicting: 0, invalid: 0 });
        assert.equal(await Event.countDocuments(), 1);
        assert.deepEqual((await RejectedRecord.findOne().lean())!.row_number, 2);
        assert.equal((await RejectedRecord.findOne().lean())!.reason, 'EXACT_DUPLICATE');
    });

    test('a missing optional field and a null one are the same', async () => {
        const { segment, ...withoutSegment } = ev({ event_id: 'x' });
        const result = await run([ev({ event_id: 'x', segment: null }), withoutSegment]);
        assert.equal(result.exact_duplicates, 1);
        assert.equal(result.conflicting_duplicates, 0);
    });

    test('the same id with other values is a conflict: the first one stays', async () => {
        const result = await run([base, ev({ event_type: 'EMAIL_CLICKED' })]);
        assert.equal(result.conflicting_duplicates, 1);
        assert.equal((await Event.findOne({ event_id: 'e1' }).lean())!.event_type, 'EMAIL_OPENED');
        const rejected = await RejectedRecord.findOne({ reason: 'CONFLICTING_DUPLICATE' }).lean();
        assert.equal(rejected!.raw.event_type, 'EMAIL_CLICKED');
        assert.equal(rejected!.row_number, 2);
    });

    test('a copy of an INVALID row is not a duplicate of anything: both are invalid', async () => {
        const bad = ev({ event_id: 'bad', customer_id: null });
        const result = await run([bad, bad]);
        assert.equal(result.invalid, 2);
        assert.equal(result.exact_duplicates, 0);
    });
});

describe('events that are already saved', () => {
    test('a second file: same rows are exact duplicates, changed rows are conflicts, new rows are saved', async () => {
        await run([base, ev({ event_id: 'e2' })]);
        const result = await run([base, ev({ event_id: 'e2', event_type: 'EMAIL_SENT' }), ev({ event_id: 'e3' })]);
        assert.deepEqual(counts(result), { total_rows: 3, accepted: 1, exact: 1, conflicting: 1, invalid: 0 });
        assert.equal(await Event.countDocuments(), 3);
        assert.equal((await Event.findOne({ event_id: 'e2' }).lean())!.event_type, 'EMAIL_OPENED');   // not overwritten
    });

    test('importing the same file again saves nothing new', async () => {
        const rows = [base, ev({ event_id: 'e2', event_type: 'EMAIL_SENT' }), ev({ event_id: 'e3', dealer_id: 'd2' })];
        await run(rows);
        const again = await run(rows);
        assert.deepEqual(counts(again), { total_rows: 3, accepted: 0, exact: 3, conflicting: 0, invalid: 0 });
        assert.equal(await Event.countDocuments(), 3);
    });
});

describe('file_id: one per import, on the run, its events and its rejected rows', () => {
    // getRejected logs its filter; keep the test output clean
    let log: any;
    beforeEach(() => { log = mock.method(console, 'log', () => {}); });
    afterEach(() => log.mock.restore());

    test('events and rejected rows carry the file_id of their import', async () => {
        const first = (await run([base, ev({ event_id: '' })])).run;                                          // 1 saved, 1 rejected
        const second = (await run([ev({ event_id: 'e2' }), ev({ event_id: 'e3', customer_id: null })])).run;  // 1 saved, 1 rejected
        assert.notEqual(first.file_id, second.file_id);
        assert.equal((await Event.findOne({ event_id: 'e1' }).lean())!.file_id, first.file_id);
        assert.equal((await Event.findOne({ event_id: 'e2' }).lean())!.file_id, second.file_id);
        assert.equal(await RejectedRecord.countDocuments({ file_id: first.file_id }), 1);
        assert.equal(await RejectedRecord.countDocuments({ file_id: second.file_id }), 1);
    });

    test('the rejected rows of an earlier import are kept', async () => {
        await run([ev({ event_id: '' }), ev({ event_id: '' })]);
        await run([ev({ customer_id: null })]);
        assert.equal(await RejectedRecord.countDocuments(), 3);
        assert.equal(await ImportRun.countDocuments(), 2);
    });

    test('an event that was already saved keeps the file_id of the import that first saved it', async () => {
        const first = (await run([base])).run;
        await run([base, ev({ event_id: 'e2' })]);
        assert.equal((await Event.findOne({ event_id: 'e1' }).lean())!.file_id, first.file_id);
    });

    test('the quality functions see only the latest import', async () => {
        await run([ev({ event_id: '' }), ev({ event_id: '' })]);                                               // 2 rejected
        const second = (await run([ev({ customer_id: null })])).run;                                          // 1 rejected
        const quality: any = await eventsService.getQuality();
        assert.equal(quality.last_import.file_id, second.file_id);
        assert.deepEqual(quality.by_reason, [{ reason: 'MISSING_CUSTOMER_ID', count: 1 }]);
        const rejected = await eventsService.getRejected(1, 20);
        assert.equal(rejected.total, 1);
        assert.equal(rejected.records[0].reason, 'MISSING_CUSTOMER_ID');
    });
});

describe('when the import cannot finish', () => {
    let log: any;
    beforeEach(() => { log = mock.method(console, 'error', () => {}); });   // the service logs failures on purpose
    afterEach(() => log.mock.restore());

    test('a file that is not an array: { error }, nothing saved, no run recorded', async () => {
        for (const content of [{ events: [base] }, 'text', 5, null, true]) {
            const out = await importEvents(writeRows(JSON.stringify(content)), 'events-test.json', randomUUID());   // JSON text, not rows
            assert.deepEqual(out, { error: 'input file must be a JSON array' }, JSON.stringify(content));
        }
        assert.equal(await ImportRun.countDocuments(), 0);
        assert.equal(await Event.countDocuments(), 0);
    });

    test('a file that is not JSON: { error } with the parser message, no run recorded', async () => {
        const out = await importEvents(writeRows('event_id,customer_id\ne1,c1'), 'events.json', randomUUID());
        assert.match(out.error!, /^input file is not valid JSON: /);
        assert.equal(out.result, undefined);
        assert.equal(await ImportRun.countDocuments(), 0);
        assert.equal(log.mock.callCount(), 0);                                // a client mistake is not logged as a failure
    });

    test('a file that cannot be read: the error is thrown and a failed run is saved', async () => {
        const id = randomUUID();
        await assert.rejects(importEvents(path.join(path.dirname(writeRows([])), 'no-such-file.json'), 'events.json', id), /ENOENT/);
        const saved = await ImportRun.findOne().lean();
        assert.equal(saved!.status, 'failed');
        assert.equal(saved!.file_id, id);
        assert.equal(saved!.file_name, 'events.json');
        assert.ok(saved!.error);
        assert.equal(log.mock.callCount(), 1);
    });

    test('the database fails while saving: a failed run with that error and the file name, and no completed run', async () => {
        const id = randomUUID();
        const insert = mock.method(Event, 'insertMany', async () => { throw new Error('disk full'); });
        try {
            await assert.rejects(importEvents(writeRows([base, ev({ event_id: '' })]), 'events-test.json', id), /disk full/);
        } finally { insert.mock.restore(); }
        const runs = await ImportRun.find().lean();
        assert.equal(runs.length, 1);
        assert.deepEqual({ status: runs[0].status, error: runs[0].error, file_id: runs[0].file_id, file_name: runs[0].file_name },
            { status: 'failed', error: 'disk full', file_id: id, file_name: 'events-test.json' });
        assert.equal(await Event.countDocuments(), 0);
    });
});

// the sample file that ships with the project, read straight from where it is, so the numbers are the real ones
describe('the 10,000-row sample file', () => {
    const SAMPLE = path.join(__dirname, '..', 'data', 'events_10000.json');
    const importSample = () => importEvents(SAMPLE, 'events_10000.json', randomUUID());

    test('summary and reasons', async () => {
        const out = await importSample();
        assert.deepEqual(counts(out.result), { total_rows: 10000, accepted: 9000, exact: 300, conflicting: 100, invalid: 600 });
        assert.equal(await Event.countDocuments(), 9000);
        assert.equal(await RejectedRecord.countDocuments(), 1000);
        assert.deepEqual((await eventsService.getQuality()).by_reason, [
            { reason: 'EXACT_DUPLICATE', count: 300 },
            { reason: 'CONFLICTING_DUPLICATE', count: 100 }, { reason: 'INVALID_EVENT_TIMESTAMP', count: 100 },
            { reason: 'INVALID_LEAD_CHRONOLOGY', count: 100 }, { reason: 'MISSING_CUSTOMER_ID', count: 100 },
            { reason: 'MISSING_DEALER_ID', count: 100 }, { reason: 'MISSING_EVENT_ID', count: 100 }, { reason: 'UNKNOWN_EVENT_TYPE', count: 100 },
        ]);
    });

    test('importing it a second time saves nothing and every row is rejected', async () => {
        await importSample();
        const again = await importSample();
        // the 9,000 saved rows and the 300 exact repeats are now exact duplicates; conflicts and invalid rows stay what they were
        assert.deepEqual(counts(again.result), { total_rows: 10000, accepted: 0, exact: 9300, conflicting: 100, invalid: 600 });
        assert.equal(await Event.countDocuments(), 9000);
    });
});
