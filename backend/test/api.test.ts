import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import http from 'http';
import mongoose from 'mongoose';
import app from '../server';
import Event, { validateEvent } from '../models/Event';
import RejectedRecord from '../models/RejectedRecord';
import ImportRun from '../models/ImportRun';

// one valid event; each test changes only the fields it cares about
const base = {
    event_id: 'e1', customer_id: 'c1', dealer_id: 'd1', event_type: 'EMAIL_OPENED',
    event_timestamp: '2026-09-01T10:00:00Z', received_at: '2026-09-01T10:05:00Z', lead_created_at: '2026-08-01T10:00:00Z',
    campaign_id: 'p1', segment: 'NewCar', email_provider: 'provider_A', lead_status: 'ACTIVE',
};
const ev = (over: object) => ({ ...base, ...over });

let server: http.Server;
let url = '';
before(async () => {
    assert.match(process.env.MONGO_URL ?? '', /test/, 'the tests wipe the database, so MONGO_URL must be a test database');
    server = http.createServer(app).listen(0);                       // our own port for the requests
    url = `http://localhost:${(server.address() as any).port}`;
    await mongoose.connection.asPromise();
});
beforeEach(async () => {                                            // every test starts with empty collections
    await Promise.all([Event.deleteMany({}), RejectedRecord.deleteMany({}), ImportRun.deleteMany({})]);
});
after(async () => { server.close(); await mongoose.disconnect(); });

// the import reads the file named in EVENTS_FILE, so a test writes its rows there and calls the endpoint
const importRows = async (rows: unknown[]) => {
    fs.writeFileSync(process.env.EVENTS_FILE!, JSON.stringify(rows));
    return (await fetch(`${url}/api/import`, { method: 'POST' })).json() as Promise<any>;
};
const get = async (path: string) => (await fetch(url + path)).json() as Promise<any>;

test('a valid event is accepted', async () => {
    assert.ok('value' in validateEvent(base));
    const run = await importRows([base]);
    assert.equal(run.accepted, 1);
    assert.equal(await Event.countDocuments(), 1);
});

test('a missing identifier or an invalid timestamp is rejected', async () => {
    assert.deepEqual(validateEvent(ev({ event_id: '' })), { reason: 'MISSING_EVENT_ID' });
    assert.deepEqual(validateEvent(ev({ event_timestamp: '2026-13-45T25:61:00Z' })), { reason: 'INVALID_EVENT_TIMESTAMP' });
    const run = await importRows([ev({ customer_id: null }), ev({ event_id: 'e2', event_timestamp: 'yesterday' })]);
    assert.equal(run.invalid, 2);
    assert.equal(await Event.countDocuments(), 0);
    assert.equal(await RejectedRecord.countDocuments(), 2);          // kept for inspection, with the reason
});

test('an exact duplicate is not counted twice', async () => {
    const run = await importRows([base, ev({ received_at: '2026-09-01T18:00:00Z' })]);   // only received_at differs
    assert.equal(run.accepted, 1);
    assert.equal(run.exact_duplicates, 1);
    assert.equal(await Event.countDocuments(), 1);
});

test('a conflicting duplicate does not overwrite the canonical event', async () => {
    const run = await importRows([base, ev({ event_type: 'EMAIL_CLICKED' })]);
    assert.equal(run.conflicting_duplicates, 1);
    const saved = await Event.findOne({ event_id: 'e1' }).lean();
    assert.equal(saved!.event_type, 'EMAIL_OPENED');                  // the first one wins
    assert.equal((await RejectedRecord.findOne({ reason: 'CONFLICTING_DUPLICATE' }).lean())!.raw.event_type, 'EMAIL_CLICKED');
});

test('a late, out-of-order event is counted on its event date, not its received date', async () => {
    const late = ev({ event_id: 'late', event_timestamp: '2026-09-01T23:00:00Z', received_at: '2026-09-03T01:00:00Z' });
    const next = ev({ event_id: 'next', event_timestamp: '2026-09-02T09:00:00Z', received_at: '2026-09-02T09:01:00Z' });
    await importRows([next, late]);                                   // the later event comes first in the file
    const { daily } = await get('/api/metrics/daily');
    assert.deepEqual(daily, [{ day: '2026-09-01', count: 1 }, { day: '2026-09-02', count: 1 }]);   // nothing on 09-03
    assert.equal((await get('/api/metrics/late')).late, 1);
});

test('events per dealer: biggest first, filterable, and a bad filter is a 400', async () => {
    await importRows([base, ev({ event_id: 'e2', dealer_id: 'd2' }), ev({ event_id: 'e3', dealer_id: 'd2' })]);
    assert.deepEqual((await get('/api/metrics/by-dealer')).by_dealer, [{ dealer_id: 'd2', count: 2 }, { dealer_id: 'd1', count: 1 }]);
    assert.deepEqual((await get('/api/metrics/by-dealer?dealer_id=d1')).by_dealer, [{ dealer_id: 'd1', count: 1 }]);
    const bad = await fetch(`${url}/api/metrics/by-dealer?from=2026-09-05&to=2026-09-01`);
    assert.equal(bad.status, 400);
    assert.deepEqual(await bad.json(), { error: 'Bad Request', message: '"from" must not be after "to"' });
});

test('importing the same file again does not change the totals', async () => {
    const rows = [base, ev({ event_id: 'e2', event_type: 'EMAIL_SENT' }), ev({ event_id: 'e3', dealer_id: 'd2' })];
    await importRows(rows);
    const before = await get('/api/metrics/by-type');
    const again = await importRows(rows);
    assert.equal(again.accepted, 0);
    assert.equal(again.exact_duplicates, 3);
    assert.deepEqual(await get('/api/metrics/by-type'), before);
    assert.equal(before.total, 3);
    assert.equal(await Event.countDocuments(), 3);
});
