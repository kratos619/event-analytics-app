import assert from 'node:assert/strict';
import { before, beforeEach, after, mock } from 'node:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import mongoose from 'mongoose';
import Event from '../models/Event';
import RejectedRecord from '../models/RejectedRecord';
import ImportRun from '../models/ImportRun';

// one valid event; each test changes only the fields it cares about
export const base = {
    event_id: 'e1', customer_id: 'c1', dealer_id: 'd1', event_type: 'EMAIL_OPENED',
    event_timestamp: '2026-09-01T10:00:00Z', received_at: '2026-09-01T10:05:00Z', lead_created_at: '2026-08-01T10:00:00Z',
    campaign_id: 'p1', segment: 'NewCar', email_provider: 'provider_A', lead_status: 'ACTIVE',
};
export const ev = (over: object = {}) => ({ ...base, ...over });

// saves events straight into the database, without an import. ids are e1, e2, ... unless a row sets its own
export const seed = (rows: object[]) => Event.insertMany(rows.map((r, i) => ev({ event_id: `e${i + 1}`, ...r })));

// the import reads a file from disk, so a test writes its rows to a temp folder (removed when the tests end) and gets the path.
// Rows are saved as JSON; text is saved as it is, to make a file that is not JSON
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'event-analytics-test-'));
process.on('exit', () => fs.rmSync(dir, { recursive: true, force: true }));
export const writeRows = (rows: unknown, name = 'rows.json') => {
    const file = path.join(dir, name);
    fs.writeFileSync(file, typeof rows === 'string' ? rows : JSON.stringify(rows));
    return file;
};

// connects to the test database and empties it before every test (call once at the top of a test file)
export const useTestDb = () => {
    // the app logs every request and import; keep the test output readable (errors still print)
    before(() => { mock.method(console, 'log', () => {}); mock.method(console, 'warn', () => {}); });
    before(async () => {
        assert.match(process.env.MONGO_URL ?? '', /test/, 'the tests wipe the database, so MONGO_URL must be a test database');
        if (mongoose.connection.readyState === 0) await mongoose.connect(process.env.MONGO_URL!);
        await mongoose.connection.asPromise();
        await Event.init();                                         // wait for the unique index on event_id
    });
    beforeEach(() => Promise.all([Event.deleteMany({}), RejectedRecord.deleteMany({}), ImportRun.deleteMany({})]));
    after(() => mongoose.disconnect());
};
