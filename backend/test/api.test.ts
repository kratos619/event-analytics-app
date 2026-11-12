// the real app over HTTP: routes, controllers, validation, the error handler and the import (the file is uploaded as a form)
import { test, describe, before, beforeEach, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import http from 'http';
import app from '../server';
import Event from '../models/Event';
import RejectedRecord from '../models/RejectedRecord';
import ImportRun from '../models/ImportRun';
import { UPLOAD_DIR } from '../middleware/upload';
import { base, ev, seed, useTestDb } from './helpers';

useTestDb();

let server: http.Server;
let url = '';
before(() => {
    assert.match(UPLOAD_DIR, /test/, 'UPLOAD_DIR must be a test folder: the tests empty it');
    server = http.createServer(app).listen(0);                       // our own port for the requests
    url = `http://localhost:${(server.address() as any).port}`;
    mock.method(console, 'log', () => {});                           // getRejected logs its filter on every call
});
after(() => { server.close(); mock.restoreAll(); fs.rmSync(UPLOAD_DIR, { recursive: true, force: true }); });

// the names of the files the app keeps on disk
const stored = () => (fs.existsSync(UPLOAD_DIR) ? fs.readdirSync(UPLOAD_DIR) : []);
beforeEach(() => { for (const name of stored()) fs.rmSync(path.join(UPLOAD_DIR, name), { force: true }); });   // every test starts with no stored files

// every call gives { status, body }; body is null if the answer is not JSON
const call = async (method: string, route: string, body?: RequestInit['body']) => {
    const res = await fetch(url + route, { method, body });
    return { status: res.status, body: (await res.json().catch(() => null)) as any };
};
const get = (route: string) => call('GET', route);
// uploads a file like the browser does: a form with the file in the field "file"
const upload = (text: string, name = 'events-test.json', field = 'file') => {
    const form = new FormData();
    form.append(field, new Blob([text], { type: 'application/json' }), name);
    return call('POST', '/api/import', form);
};
const importRows = (rows: unknown, name?: string) => upload(JSON.stringify(rows), name);
const quiet = () => mock.method(console, 'error', () => {});         // the app logs failures on purpose

describe('health', () => {
    test('GET /health', async () => assert.deepEqual(await get('/health'), { status: 200, body: { ok: true } }));
    test('an unknown route is a 404', async () => assert.equal((await get('/api/nothing-here')).status, 404));
});

describe('import (POST /api/import)', () => {
    // the details of the import are tested on importEvents in import-service.test.ts; here only what the upload and the controller add
    test('a clean file: 200 with the summary and the run', async () => {
        const { status, body } = await importRows([base, ev({ event_id: 'e2' }), ev({ event_id: '' })]);
        assert.equal(status, 200);
        assert.deepEqual(
            { total_rows: body.total_rows, accepted: body.accepted, exact: body.exact_duplicates, conflicting: body.conflicting_duplicates, invalid: body.invalid },
            { total_rows: 3, accepted: 2, exact: 0, conflicting: 0, invalid: 1 },
        );
        assert.equal(body.run.status, 'completed');
        assert.equal(await Event.countDocuments(), 2);
    });

    describe('the upload is saved to disk and the import reads it from there', () => {
        test('as <file_id>.json, with exactly the content that was uploaded', async () => {
            const text = JSON.stringify([base, ev({ event_id: 'e2' })], null, 2);
            const { body } = await upload(text);
            assert.deepEqual(stored(), [`${body.run.file_id}.json`]);
            assert.equal(fs.readFileSync(path.join(UPLOAD_DIR, `${body.run.file_id}.json`), 'utf8'), text);
            assert.equal(await Event.countDocuments({ file_id: body.run.file_id }), 2);      // the same id is on the events
        });

        test('every upload is its own file, even the same file twice', async () => {
            const first = (await importRows([base])).body.run;
            const second = (await importRows([base])).body.run;
            assert.notEqual(first.file_id, second.file_id);
            assert.deepEqual(stored().sort(), [`${first.file_id}.json`, `${second.file_id}.json`].sort());
        });

        test('the run keeps the name the user gave the file, whatever characters it has', async () => {
            for (const name of ['events_10000.json', 'my events (March) & más.json', 'データ.json', 'UPPER.JSON']) {
                const { status, body } = await importRows([ev({ event_id: name })], name);
                assert.equal(status, 200, name);
                assert.equal(body.run.file_name, name);
            }
        });
    });

    describe('a request that cannot be imported is a 400, records no run and keeps no file', () => {
        const rejectedAtTheDoor = async (promise: ReturnType<typeof upload>, message: RegExp) => {
            const { status, body } = await promise;
            assert.equal(status, 400);
            assert.equal(body.error, 'Bad Request');
            assert.match(body.message, message);
            assert.equal(await ImportRun.countDocuments(), 0);
            assert.equal(await Event.countDocuments(), 0);
            assert.deepEqual(stored(), []);
        };

        test('a form with no file', () => rejectedAtTheDoor(call('POST', '/api/import', new FormData()), /attach a \.json file/));
        test('no body at all', () => rejectedAtTheDoor(call('POST', '/api/import'), /attach a \.json file/));
        test('the file is in another field than "file"', () => rejectedAtTheDoor(upload('[]', 'events.json', 'document'), /./));
        test('a file that is not .json', () => rejectedAtTheDoor(upload('event_id,customer_id\ne1,c1', 'events.csv'), /attach a \.json file/));
    });

    // the file is read as a stream, so a bad file can only be found out while importing: it gets a failed run, and the file is kept
    describe('a .json file with bad content is a 400, a failed run with the message, and the file is kept', () => {
        const badContent = async (text: string, message: RegExp) => {
            const log = quiet();
            try {
                const { status, body } = await upload(text);
                assert.equal(status, 400);
                assert.equal(body.error, 'Bad Request');
                assert.match(body.message, message);
            } finally { log.mock.restore(); }
            const run = await ImportRun.findOne().lean();
            assert.equal(run!.status, 'failed');
            assert.match(run!.error!, message);
            assert.equal(await Event.countDocuments(), 0);
            assert.deepEqual(stored(), [`${run!.file_id}.json`]);
        };

        test('text that is not JSON', () => badContent('[ not json', /not valid JSON/));
        test('a JSON object instead of an array', () => badContent('{"events": []}', /must be a JSON array/));
    });

    test('the database fails while saving: 500 without the internal message, a failed run with it, and the file is kept', async () => {
        const log = quiet();
        const insert = mock.method(Event, 'insertMany', async () => { throw new Error('disk full'); });
        try {
            assert.deepEqual(await importRows([base]), { status: 500, body: { error: 'Internal Server Error', message: 'Something went wrong' } });
        } finally { insert.mock.restore(); log.mock.restore(); }
        const run = await ImportRun.findOne().lean();
        assert.equal(run!.status, 'failed');
        assert.equal(run!.error, 'disk full');
        assert.equal(run!.file_name, 'events-test.json');
        assert.deepEqual(stored(), [`${run!.file_id}.json`]);                                 // a run points to this file, so it stays
        assert.equal((await get('/api/quality')).body.last_import.status, 'failed');
    });

    test('the quality screen shows only the latest import', async () => {
        await importRows([ev({ event_id: '' }), ev({ event_id: '' })]);                                       // 2 rejected
        const second = (await importRows([ev({ customer_id: null })])).body.run;                              // 1 rejected
        const quality = (await get('/api/quality')).body;
        assert.equal(quality.last_import.file_id, second.file_id);
        assert.deepEqual(quality.by_reason, [{ reason: 'MISSING_CUSTOMER_ID', count: 1 }]);
        const rejected = (await get('/api/quality/rejected')).body;
        assert.equal(rejected.total, 1);
        assert.equal(rejected.records[0].reason, 'MISSING_CUSTOMER_ID');
        assert.equal(await RejectedRecord.countDocuments(), 3);                                               // the first import's rows are still there
    });

    // the sample file that ships with the project (4 MB), uploaded the way the browser does it
    test('the 10,000-row sample file: every endpoint agrees', async () => {
        const text = fs.readFileSync(path.join(__dirname, '..', 'data', 'events_10000.json'), 'utf8');
        const { status, body } = await upload(text, 'events_10000.json');
        assert.equal(status, 200);
        assert.equal(body.accepted, 9000);
        assert.equal(body.run.file_name, 'events_10000.json');
        assert.equal(fs.statSync(path.join(UPLOAD_DIR, `${body.run.file_id}.json`)).size, Buffer.byteLength(text));
        const sum = (rows: { count: number }[]) => rows.reduce((s, r) => s + r.count, 0);
        assert.equal((await get('/api/metrics/by-type')).body.total, 9000);
        assert.equal(sum((await get('/api/metrics/daily')).body.daily), 9000);
        assert.equal(sum((await get('/api/metrics/by-dealer')).body.by_dealer), 9000);
        assert.equal((await get('/api/metrics/late')).body.total, 9000);
        assert.equal((await get('/api/events?limit=1')).body.total, 9000);
        assert.equal(sum((await get('/api/quality')).body.by_reason), 1000);
    });
});

describe('metrics', () => {
    // 3 events for d1 (2 sent, 1 opened), 1 for d2; the d2 one arrived 3 days late
    const seedMetrics = () => seed([
        { dealer_id: 'd1', event_type: 'EMAIL_SENT', event_timestamp: '2026-09-01T10:00:00Z', received_at: '2026-09-01T10:10:00Z' },
        { dealer_id: 'd1', event_type: 'EMAIL_SENT', event_timestamp: '2026-09-02T10:00:00Z', received_at: '2026-09-02T10:20:00Z' },
        { dealer_id: 'd1', event_type: 'EMAIL_OPENED', event_timestamp: '2026-09-02T11:00:00Z', received_at: '2026-09-02T11:30:00Z' },
        { dealer_id: 'd2', event_type: 'EMAIL_SENT', event_timestamp: '2026-09-03T10:00:00Z', received_at: '2026-09-06T10:00:00Z' },
    ]);

    test('by-type', async () => {
        await seedMetrics();
        assert.deepEqual((await get('/api/metrics/by-type')).body, { total: 4, by_type: [{ event_type: 'EMAIL_OPENED', count: 1 }, { event_type: 'EMAIL_SENT', count: 3 }] });
    });
    test('daily', async () => {
        await seedMetrics();
        assert.deepEqual((await get('/api/metrics/daily')).body.daily, [
            { day: '2026-09-01', count: 1 }, { day: '2026-09-02', count: 2 }, { day: '2026-09-03', count: 1 },
        ]);
    });
    test('by-dealer', async () => {
        await seedMetrics();
        assert.deepEqual((await get('/api/metrics/by-dealer')).body.by_dealer, [{ dealer_id: 'd1', count: 3 }, { dealer_id: 'd2', count: 1 }]);
    });
    test('late', async () => {
        await seedMetrics();
        assert.deepEqual((await get('/api/metrics/late')).body, { total: 4, late: 1, late_after_hours: 24, avg_delay_minutes: 1095 });   // (10 + 20 + 30 min + 3 days) / 4
    });

    test('every metric accepts the same filters from the URL', async () => {
        await seedMetrics();
        const q = '?dealer_id=d1&event_type=EMAIL_SENT&from=2026-09-02&to=2026-09-02';      // only the second event matches
        assert.deepEqual((await get('/api/metrics/by-type' + q)).body, { total: 1, by_type: [{ event_type: 'EMAIL_SENT', count: 1 }] });
        assert.deepEqual((await get('/api/metrics/daily' + q)).body.daily, [{ day: '2026-09-02', count: 1 }]);
        assert.deepEqual((await get('/api/metrics/by-dealer' + q)).body.by_dealer, [{ dealer_id: 'd1', count: 1 }]);
        assert.equal((await get('/api/metrics/late' + q)).body.total, 1);
        assert.equal((await get('/api/events' + q)).body.total, 1);
    });

    test('filters that match nothing give empty answers, not errors', async () => {
        await seedMetrics();
        const q = '?dealer_id=nobody';
        assert.deepEqual((await get('/api/metrics/by-type' + q)).body, { total: 0, by_type: [] });
        assert.deepEqual((await get('/api/metrics/daily' + q)).body, { daily: [] });
        assert.deepEqual((await get('/api/metrics/by-dealer' + q)).body, { by_dealer: [] });
        assert.deepEqual((await get('/api/metrics/late' + q)).body, { total: 0, late: 0, late_after_hours: 24, avg_delay_minutes: 0 });
    });

    test('a late, out-of-order event is counted on its event date, not its received date', async () => {
        const late = ev({ event_id: 'late', event_timestamp: '2026-09-01T23:00:00Z', received_at: '2026-09-03T01:00:00Z' });
        const next = ev({ event_id: 'next', event_timestamp: '2026-09-02T09:00:00Z', received_at: '2026-09-02T09:01:00Z' });
        await importRows([next, late]);                                                    // the later event comes first in the file
        assert.deepEqual((await get('/api/metrics/daily')).body.daily, [{ day: '2026-09-01', count: 1 }, { day: '2026-09-02', count: 1 }]);
        assert.equal((await get('/api/metrics/late')).body.late, 1);
    });

    describe('a bad filter is a 400 on every endpoint that takes filters', () => {
        const routes = ['/api/metrics/by-type', '/api/metrics/daily', '/api/metrics/by-dealer', '/api/metrics/late', '/api/events'];
        const badQueries: [string, string][] = [
            ['event_type=EMAIL_LOST', 'event_type'],
            ['from=yesterday', 'from'],
            ['to=2026-9-1', 'to'],
            ['from=2026-09-05&to=2026-09-01', '"from" must not be after "to"'],
            ['dealer_id=', 'dealer_id'],
            ['foo=1', '"foo" is not allowed'],
        ];
        for (const route of routes) {
            test(route, async () => {
                for (const [query, message] of badQueries) {
                    const { status, body } = await get(`${route}?${query}`);
                    assert.equal(status, 400, `${route}?${query}`);
                    assert.equal(body.error, 'Bad Request');
                    assert.ok(body.message.includes(message), `${route}?${query} -> ${body.message}`);
                }
            });
        }
    });

    test('a day that does not exist (2026-02-30) is a 400 on every endpoint that takes filters', async () => {
        for (const route of ['/api/metrics/by-type', '/api/metrics/daily', '/api/metrics/by-dealer', '/api/metrics/late', '/api/events']) {
            for (const query of ['from=2026-02-30', 'to=2026-02-30', 'from=2026-04-31&to=2026-05-01']) {
                const { status, body } = await get(`${route}?${query}`);
                assert.equal(status, 400, `${route}?${query}`);
                assert.equal(body.error, 'Bad Request');
            }
        }
    });

    test('a real leap day is accepted', async () => {
        await seed([{ event_timestamp: '2028-02-29T12:00:00Z' }]);
        assert.deepEqual((await get('/api/metrics/daily?from=2028-02-29&to=2028-02-29')).body.daily, [{ day: '2028-02-29', count: 1 }]);
    });
});

describe('events list', () => {
    test('newest first, 20 per page by default, with page and total', async () => {
        await seed(Array.from({ length: 25 }, (_, i) => ({ event_id: `n${String(i).padStart(2, '0')}`, event_timestamp: new Date(Date.UTC(2026, 8, 1, i)).toISOString() })));
        const first = (await get('/api/events')).body;
        assert.equal(first.page, 1);
        assert.equal(first.limit, 20);
        assert.equal(first.total, 25);
        assert.equal(first.events.length, 20);
        assert.equal(first.events[0].event_id, 'n24');                                     // the newest
        const second = (await get('/api/events?page=2')).body;
        assert.equal(second.events.length, 5);
        assert.equal(second.events[4].event_id, 'n00');                                    // the oldest
    });

    test('page and limit are not treated as filters, and the total follows the filters', async () => {
        await seed([{ dealer_id: 'd1' }, { dealer_id: 'd2' }, { dealer_id: 'd2' }]);
        const { status, body } = await get('/api/events?dealer_id=d2&page=2&limit=1');
        assert.equal(status, 200);
        assert.equal(body.total, 2);
        assert.equal(body.events.length, 1);
        assert.equal(body.events[0].dealer_id, 'd2');
    });

    test('an event has no _id and no __v', async () => {
        await seed([{}]);
        const [event] = (await get('/api/events')).body.events;
        assert.equal(event.event_id, 'e1');
        assert.equal('_id' in event, false);
        assert.equal('__v' in event, false);
    });

    test('bad paging is a 400', async () => {
        for (const query of ['page=0', 'page=-1', 'page=abc', 'page=1.5', 'limit=0', 'limit=101', 'limit=abc']) {
            const { status, body } = await get('/api/events?' + query);
            assert.equal(status, 400, query);
            assert.equal(body.error, 'Bad Request');
        }
        assert.equal((await get('/api/events?limit=100')).status, 200);                    // 100 is the largest allowed
    });
});

describe('quality', () => {
    test('before any import', async () => {
        assert.deepEqual((await get('/api/quality')).body, { last_import: null, by_reason: [] });
        assert.deepEqual((await get('/api/quality/rejected')).body, { page: 1, limit: 20, total: 0, records: [] });
    });

    test('rejected rows: paging and the reason filter', async () => {
        await importRows([
            ev({ event_id: '' }), ev({ event_id: 'e2', customer_id: null }), ev({ event_id: '' }),
            ev({ event_id: 'e4', customer_id: null }), ev({ event_id: '' }),
        ]);
        const all = (await get('/api/quality/rejected')).body;
        assert.deepEqual(all.records.map((r: any) => r.row_number), [1, 2, 3, 4, 5]);
        assert.deepEqual(Object.keys(all.records[0]).sort(), ['raw', 'reason', 'row_number']);

        const page = (await get('/api/quality/rejected?page=2&limit=2')).body;
        assert.deepEqual({ page: page.page, limit: page.limit, total: page.total }, { page: 2, limit: 2, total: 5 });
        assert.deepEqual(page.records.map((r: any) => r.row_number), [3, 4]);

        const byReason = (await get('/api/quality/rejected?reason=MISSING_CUSTOMER_ID')).body;
        assert.equal(byReason.total, 2);
        assert.deepEqual(byReason.records.map((r: any) => r.row_number), [2, 4]);
    });

    test('bad paging, or a key we do not know, is a 400', async () => {
        for (const query of ['page=0', 'limit=1000', 'limit=abc', 'foo=1', 'reason=']) {
            const { status, body } = await get('/api/quality/rejected?' + query);
            assert.equal(status, 400, query);
            assert.equal(body.error, 'Bad Request');
        }
    });
});

describe('when the database fails', () => {
    // no controller catches errors: every one goes to errorHandler, so every endpoint answers the same way
    test('every endpoint answers 500, logs the error and does not leak the message', async () => {
        const routes = ['/api/metrics/by-type', '/api/metrics/daily', '/api/metrics/by-dealer', '/api/metrics/late', '/api/events', '/api/quality', '/api/quality/rejected'];
        const log = quiet();
        const fail = async () => { throw new Error('boom'); };
        const mocks = [
            mock.method(Event, 'aggregate', fail), mock.method(Event, 'countDocuments', fail),
            mock.method(ImportRun, 'findOne', () => { throw new Error('boom'); }),
        ];
        try {
            for (const route of routes) {
                assert.deepEqual(await get(route), { status: 500, body: { error: 'Internal Server Error', message: 'Something went wrong' } }, route);
            }
            assert.equal(log.mock.callCount(), routes.length);
        } finally { mocks.forEach((m) => m.mock.restore()); log.mock.restore(); }
    });
});
