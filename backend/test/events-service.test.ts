// the service functions called directly (no HTTP, no import file): data is seeded straight into the test database
import { test, describe, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import RejectedRecord from '../models/RejectedRecord';
import ImportRun from '../models/ImportRun';
import * as service from '../services/eventsService';
import { seed, useTestDb } from './helpers';

useTestDb();

// a received_at that is `ms` after the event_timestamp of 2026-09-01T10:00:00Z
const receivedAfter = (ms: number) => new Date(Date.parse('2026-09-01T10:00:00Z') + ms).toISOString();

describe('getByType', () => {
    test('an empty database gives zero', async () => {
        assert.deepEqual(await service.getByType({}), { total: 0, by_type: [] });
    });

    test('counts each type, sorted by type name, with the total', async () => {
        await seed([
            { event_type: 'EMAIL_SENT' }, { event_type: 'EMAIL_SENT' }, { event_type: 'EMAIL_SENT' },
            { event_type: 'EMAIL_OPENED' }, { event_type: 'EMAIL_OPENED' }, { event_type: 'EMAIL_CLICKED' },
        ]);
        assert.deepEqual(await service.getByType({}), {
            total: 6,
            by_type: [
                { event_type: 'EMAIL_CLICKED', count: 1 },
                { event_type: 'EMAIL_OPENED', count: 2 },
                { event_type: 'EMAIL_SENT', count: 3 },
            ],
        });
    });

    test('the match narrows what is counted', async () => {
        await seed([{ dealer_id: 'd1' }, { dealer_id: 'd2', event_type: 'EMAIL_SENT' }, { dealer_id: 'd2', event_type: 'EMAIL_SENT' }]);
        assert.deepEqual(await service.getByType({ dealer_id: 'd2' }), { total: 2, by_type: [{ event_type: 'EMAIL_SENT', count: 2 }] });
        assert.deepEqual(await service.getByType({ dealer_id: 'nobody' }), { total: 0, by_type: [] });
    });
});

describe('getDaily', () => {
    test('an empty database gives an empty list', async () => {
        assert.deepEqual(await service.getDaily({}), { daily: [] });
    });

    test('groups by UTC event day and sorts by day, whatever order the events were saved in', async () => {
        await seed([
            { event_timestamp: '2026-09-02T09:00:00Z' },
            { event_timestamp: '2026-09-01T23:59:59Z' },     // last second of 09-01
            { event_timestamp: '2026-09-01T00:00:00Z' },     // first second of 09-01
            { event_timestamp: '2026-09-03T00:00:00Z' },     // first second of 09-03
        ]);
        assert.deepEqual(await service.getDaily({}), {
            daily: [{ day: '2026-09-01', count: 2 }, { day: '2026-09-02', count: 1 }, { day: '2026-09-03', count: 1 }],
        });
    });

    test('a late event counts on its event day, never on its received day', async () => {
        await seed([{ event_timestamp: '2026-09-01T23:00:00Z', received_at: '2026-09-05T01:00:00Z' }]);
        assert.deepEqual(await service.getDaily({}), { daily: [{ day: '2026-09-01', count: 1 }] });
    });

    test('the match narrows what is counted', async () => {
        await seed([{ dealer_id: 'd1' }, { dealer_id: 'd2' }, { dealer_id: 'd2', event_timestamp: '2026-09-04T10:00:00Z' }]);
        assert.deepEqual(await service.getDaily({ dealer_id: 'd2' }), {
            daily: [{ day: '2026-09-01', count: 1 }, { day: '2026-09-04', count: 1 }],
        });
    });
});

describe('getByDealer (takes plain filters, builds its own query)', () => {
    test('an empty database gives an empty list', async () => {
        assert.deepEqual(await service.getByDealer({}), { by_dealer: [] });
    });

    test('biggest first, and dealers with the same count are sorted by name', async () => {
        // 20 dealers with 1 event each, saved in reverse name order, so the sort is the only thing that can put them in order
        const tied = Array.from({ length: 20 }, (_, i) => `t${String(19 - i).padStart(2, '0')}`);
        await seed([...tied.map((dealer_id) => ({ dealer_id })), { dealer_id: 'big' }, { dealer_id: 'big' }, { dealer_id: 'big' }, { dealer_id: 'mid' }, { dealer_id: 'mid' }]);
        const expected = [{ dealer_id: 'big', count: 3 }, { dealer_id: 'mid', count: 2 }, ...[...tied].sort().map((dealer_id) => ({ dealer_id, count: 1 }))];
        assert.deepEqual((await service.getByDealer({})).by_dealer, expected);
    });

    test('filters by dealer_id and by event_type', async () => {
        await seed([
            { dealer_id: 'd1', event_type: 'EMAIL_SENT' }, { dealer_id: 'd1', event_type: 'EMAIL_OPENED' },
            { dealer_id: 'd2', event_type: 'EMAIL_SENT' },
        ]);
        assert.deepEqual((await service.getByDealer({ dealer_id: 'd1' })).by_dealer, [{ dealer_id: 'd1', count: 2 }]);
        assert.deepEqual((await service.getByDealer({ event_type: 'EMAIL_SENT' })).by_dealer, [{ dealer_id: 'd1', count: 1 }, { dealer_id: 'd2', count: 1 }]);
        assert.deepEqual((await service.getByDealer({ dealer_id: 'd1', event_type: 'EMAIL_SENT' })).by_dealer, [{ dealer_id: 'd1', count: 1 }]);
    });

    describe('date filters cover whole UTC days', () => {
        beforeEach(() => seed([
            { event_timestamp: '2026-08-31T23:59:59.999Z' },   // just before 09-01
            { event_timestamp: '2026-09-01T00:00:00.000Z' },   // first moment of 09-01
            { event_timestamp: '2026-09-02T23:59:59.999Z' },   // last moment of 09-02
            { event_timestamp: '2026-09-03T00:00:00.000Z' },   // first moment of 09-03
        ]));
        const count = async (filters: object) => (await service.getByDealer(filters)).by_dealer[0]?.count ?? 0;

        test('from and to are both inclusive', async () => assert.equal(await count({ from: '2026-09-01', to: '2026-09-02' }), 2));
        test('from alone has no upper limit', async () => assert.equal(await count({ from: '2026-09-02' }), 2));
        test('to alone has no lower limit', async () => assert.equal(await count({ to: '2026-09-01' }), 2));
        test('one single day', async () => assert.equal(await count({ from: '2026-09-03', to: '2026-09-03' }), 1));
        test('a range with no events', async () => assert.equal(await count({ from: '2027-01-01' }), 0));
    });
});

describe('getLate', () => {
    test('an empty database gives zeros', async () => {
        assert.deepEqual(await service.getLate({}), { total: 0, late: 0, late_after_hours: 24, avg_delay_minutes: 0 });
    });

    test('late means MORE than 24 hours between event and received time', async () => {
        const HOUR = 3600 * 1000;
        await seed([
            { received_at: receivedAfter(24 * HOUR - 1) },   // 1 ms short of 24h: not late
            { received_at: receivedAfter(24 * HOUR) },       // exactly 24h: not late
            { received_at: receivedAfter(24 * HOUR + 1) },   // 1 ms over: late
            { received_at: receivedAfter(72 * HOUR) },       // late
        ]);
        const result = await service.getLate({});
        assert.equal(result.total, 4);
        assert.equal(result.late, 2);
        assert.equal(result.late_after_hours, 24);
    });

    test('the average delay is in whole minutes, rounded', async () => {
        await seed([{ received_at: receivedAfter(10 * 60000) }, { received_at: receivedAfter(21 * 60000) }]);   // 10 and 21 min -> 15.5
        assert.equal((await service.getLate({})).avg_delay_minutes, 16);
    });

    test('the match narrows what is counted', async () => {
        await seed([
            { dealer_id: 'd1', received_at: receivedAfter(5 * 60000) },
            { dealer_id: 'd2', received_at: receivedAfter(48 * 3600 * 1000) },
        ]);
        assert.deepEqual(await service.getLate({ dealer_id: 'd1' }), { total: 1, late: 0, late_after_hours: 24, avg_delay_minutes: 5 });
        assert.deepEqual(await service.getLate({ dealer_id: 'd2' }), { total: 1, late: 1, late_after_hours: 24, avg_delay_minutes: 2880 });
    });
});

// two imports: A is older, B is the latest
const importRun = (file_id: string, createdAt: string, over: object = {}) =>
    ImportRun.create({ file_id, file_name: `${file_id}.json`, status: 'completed', total_rows: 10, createdAt: new Date(createdAt), ...over });
const reject = (file_id: string, reason: string, row_number: number, raw: unknown = { row: row_number }) =>
    RejectedRecord.create({ file_id, reason, row_number, raw });

describe('getQuality', () => {
    test('before any import: no last import and no reasons', async () => {
        assert.deepEqual(await service.getQuality(), { last_import: null, by_reason: [] });
    });

    test('shows the newest import and counts only ITS rejected rows', async () => {
        await importRun('B', '2026-09-02T00:00:00Z');         // created first on purpose: the date decides, not the insert order
        await importRun('A', '2026-09-01T00:00:00Z');
        await Promise.all([
            reject('A', 'MISSING_EVENT_ID', 1), reject('A', 'MISSING_EVENT_ID', 2), reject('A', 'MISSING_EVENT_ID', 3),
            reject('B', 'UNKNOWN_EVENT_TYPE', 1), reject('B', 'UNKNOWN_EVENT_TYPE', 2),
            reject('B', 'EXACT_DUPLICATE', 3), reject('B', 'EXACT_DUPLICATE', 4),
            reject('B', 'MISSING_DEALER_ID', 5),
        ]);
        const quality: any = await service.getQuality();
        assert.equal(quality.last_import.file_id, 'B');
        assert.equal(quality.last_import.file_name, 'B.json');
        assert.equal(quality.last_import.status, 'completed');
        assert.equal('_id' in quality.last_import, false);
        assert.equal('__v' in quality.last_import, false);
        // biggest first, same count -> sorted by reason; the 3 rows of import A are not counted
        assert.deepEqual(quality.by_reason, [
            { reason: 'EXACT_DUPLICATE', count: 2 }, { reason: 'UNKNOWN_EVENT_TYPE', count: 2 }, { reason: 'MISSING_DEALER_ID', count: 1 },
        ]);
    });

    test('a newer import with no rejected rows shows none, even if an older one had some', async () => {
        await importRun('A', '2026-09-01T00:00:00Z');
        await reject('A', 'MISSING_EVENT_ID', 1);
        await importRun('B', '2026-09-02T00:00:00Z', { total_rows: 1, accepted: 1 });
        assert.deepEqual((await service.getQuality()).by_reason, []);
    });

    test('a failed import is the last import too', async () => {
        await importRun('A', '2026-09-01T00:00:00Z');
        await importRun('B', '2026-09-02T00:00:00Z', { status: 'failed', error: 'boom' });
        const quality: any = await service.getQuality();
        assert.equal(quality.last_import.status, 'failed');
        assert.equal(quality.last_import.error, 'boom');
    });

    test('data saved before file_id existed (no file_id anywhere) still works', async () => {
        await ImportRun.collection.insertOne({ status: 'completed', total_rows: 2, createdAt: new Date() });
        await RejectedRecord.collection.insertMany([{ row_number: 1, reason: 'MISSING_EVENT_ID', raw: {} }, { row_number: 2, reason: 'MISSING_EVENT_ID', raw: {} }]);
        assert.deepEqual((await service.getQuality()).by_reason, [{ reason: 'MISSING_EVENT_ID', count: 2 }]);
    });
});

describe('getRejected', () => {
    // the service logs the filter it uses; keep the test output clean
    let log: ReturnType<typeof mock.method>;
    beforeEach(() => { log = mock.method(console, 'log', () => {}); });
    afterEach(() => log.mock.restore());

    test('before any import: an empty page', async () => {
        assert.deepEqual(await service.getRejected(1, 20), { page: 1, limit: 20, total: 0, records: [] });
    });

    test('only the latest import, in file order, with only row_number, reason and raw', async () => {
        await importRun('A', '2026-09-01T00:00:00Z');
        await importRun('B', '2026-09-02T00:00:00Z');
        const raw = { event_id: '', nested: { a: [1, 2] } };
        await RejectedRecord.insertMany([
            { file_id: 'B', row_number: 3, reason: 'UNKNOWN_EVENT_TYPE', raw: 'third' },
            { file_id: 'A', row_number: 1, reason: 'MISSING_EVENT_ID', raw: 'old import' },
            { file_id: 'B', row_number: 1, reason: 'MISSING_EVENT_ID', raw },
            { file_id: 'B', row_number: 2, reason: 'EXACT_DUPLICATE', raw: 'second' },
        ]);
        const result = await service.getRejected(1, 20);
        assert.equal(result.total, 3);
        assert.deepEqual(result.records, [
            { row_number: 1, reason: 'MISSING_EVENT_ID', raw },            // raw comes back untouched
            { row_number: 2, reason: 'EXACT_DUPLICATE', raw: 'second' },
            { row_number: 3, reason: 'UNKNOWN_EVENT_TYPE', raw: 'third' },
        ]);
    });

    test('pages: total stays the same, the last page may be short, a page past the end is empty', async () => {
        await importRun('B', '2026-09-02T00:00:00Z');
        await Promise.all([1, 2, 3, 4, 5].map((n) => reject('B', 'EXACT_DUPLICATE', n)));
        const rows = async (page: number, limit: number) => (await service.getRejected(page, limit)).records.map((r: any) => r.row_number);
        assert.deepEqual(await rows(1, 2), [1, 2]);
        assert.deepEqual(await rows(2, 2), [3, 4]);
        assert.deepEqual(await rows(3, 2), [5]);
        assert.deepEqual(await rows(4, 2), []);
        assert.deepEqual(await service.getRejected(2, 2).then(({ page, limit, total }) => ({ page, limit, total })), { page: 2, limit: 2, total: 5 });
    });

    test('reason narrows the list and the total, and stays inside the latest import', async () => {
        await importRun('A', '2026-09-01T00:00:00Z');
        await importRun('B', '2026-09-02T00:00:00Z');
        await Promise.all([
            reject('A', 'EXACT_DUPLICATE', 1),
            reject('B', 'EXACT_DUPLICATE', 1), reject('B', 'MISSING_EVENT_ID', 2), reject('B', 'EXACT_DUPLICATE', 3),
        ]);
        const result = await service.getRejected(1, 20, 'EXACT_DUPLICATE');
        assert.equal(result.total, 2);
        assert.deepEqual(result.records.map((r: any) => r.row_number), [1, 3]);
        assert.equal((await service.getRejected(1, 20, 'NO_SUCH_REASON')).total, 0);
    });
});

describe('getEvents', () => {
    test('an empty database gives an empty page', async () => {
        assert.deepEqual(await service.getEvents({}, 1, 20), { page: 1, limit: 20, total: 0, events: [] });
    });

    test('newest event first; the same time is sorted by event_id', async () => {
        await seed([
            { event_id: 'b', event_timestamp: '2026-09-02T10:00:00Z' },
            { event_id: 'old', event_timestamp: '2026-09-01T10:00:00Z' },
            { event_id: 'a', event_timestamp: '2026-09-02T10:00:00Z' },
            { event_id: 'new', event_timestamp: '2026-09-03T10:00:00Z' },
        ]);
        assert.deepEqual((await service.getEvents({}, 1, 20)).events.map((e: any) => e.event_id), ['new', 'a', 'b', 'old']);
    });

    test('pages of the same list', async () => {
        await seed([1, 2, 3, 4, 5].map((n) => ({ event_id: `e${n}`, event_timestamp: `2026-09-0${n}T10:00:00Z` })));   // e5 is the newest
        const ids = async (page: number, limit: number) => (await service.getEvents({}, page, limit)).events.map((e: any) => e.event_id);
        assert.deepEqual(await ids(1, 2), ['e5', 'e4']);
        assert.deepEqual(await ids(2, 2), ['e3', 'e2']);
        assert.deepEqual(await ids(3, 2), ['e1']);
        assert.deepEqual(await ids(4, 2), []);
        const { page, limit, total } = await service.getEvents({}, 2, 2);
        assert.deepEqual({ page, limit, total }, { page: 2, limit: 2, total: 5 });
    });

    test('the match narrows both the list and the total', async () => {
        await seed([{ dealer_id: 'd1' }, { dealer_id: 'd2' }, { dealer_id: 'd2' }]);
        const result = await service.getEvents({ dealer_id: 'd2' }, 1, 20);
        assert.equal(result.total, 2);
        assert.equal(result.events.length, 2);
        assert.ok(result.events.every((e: any) => e.dealer_id === 'd2'));
    });

    test('an event has all its fields, real Dates, and no _id or __v', async () => {
        await seed([{ event_id: 'x1', segment: 'Used' }]);
        const [event]: any[] = (await service.getEvents({}, 1, 20)).events;
        assert.equal(event.event_id, 'x1');
        assert.equal(event.segment, 'Used');
        assert.ok(event.event_timestamp instanceof Date);
        assert.equal('_id' in event, false);
        assert.equal('__v' in event, false);
    });
});
