// validateEvent is a pure function: no database, no server
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { validateEvent, EVENT_TYPES } from '../models/Event';
import { base, ev } from './helpers';

describe('validateEvent', () => {
    test('a clean row comes back as { value } with real Dates', () => {
        const result: any = validateEvent(base);
        assert.equal(result.reason, undefined);
        assert.equal(result.value.event_id, 'e1');
        assert.ok(result.value.event_timestamp instanceof Date);
        assert.equal(result.value.event_timestamp.toISOString(), '2026-09-01T10:00:00.000Z');
        assert.equal(result.value.received_at.toISOString(), '2026-09-01T10:05:00.000Z');
        assert.equal(result.value.lead_created_at.toISOString(), '2026-08-01T10:00:00.000Z');
    });

    test('every known event type is accepted', () => {
        for (const event_type of EVENT_TYPES) assert.ok('value' in validateEvent(ev({ event_type })), event_type);
    });

    describe('ids and event type', () => {
        const cases: [string, object, string][] = [
            ['empty event_id', { event_id: '' }, 'MISSING_EVENT_ID'],
            ['blank event_id', { event_id: '   ' }, 'MISSING_EVENT_ID'],
            ['missing event_id', { event_id: undefined }, 'MISSING_EVENT_ID'],
            ['null event_id', { event_id: null }, 'MISSING_EVENT_ID'],
            ['number as event_id', { event_id: 5 }, 'MISSING_EVENT_ID'],
            ['null customer_id', { customer_id: null }, 'MISSING_CUSTOMER_ID'],
            ['blank customer_id', { customer_id: ' ' }, 'MISSING_CUSTOMER_ID'],
            ['missing customer_id', { customer_id: undefined }, 'MISSING_CUSTOMER_ID'],
            ['empty dealer_id', { dealer_id: '' }, 'MISSING_DEALER_ID'],
            ['missing dealer_id', { dealer_id: undefined }, 'MISSING_DEALER_ID'],
            ['unknown event_type', { event_type: 'EMAIL_LOST' }, 'UNKNOWN_EVENT_TYPE'],
            ['lowercase event_type', { event_type: 'email_sent' }, 'UNKNOWN_EVENT_TYPE'],
            ['missing event_type', { event_type: undefined }, 'UNKNOWN_EVENT_TYPE'],
        ];
        for (const [name, over, reason] of cases) {
            test(`${name} -> ${reason}`, () => assert.deepEqual(validateEvent(ev(over)), { reason }));
        }
    });

    describe('timestamps', () => {
        const bad = [
            'yesterday', '', '2026-09-01', '2026-09-01 10:00:00', '2026-09-01T10:00:00',   // not a UTC ISO time
            '2026-09-01T10:00:00+02:00', '2026-09-01T10:00:00.1234Z',                       // offset / too many decimals
            '2026-13-45T25:61:00Z', '2026-02-30T10:00:00Z', '2026-02-29T10:00:00Z',         // day does not exist
            12345, null, {},                                                                // not text
        ];
        const fields: [string, string][] = [
            ['event_timestamp', 'INVALID_EVENT_TIMESTAMP'],
            ['received_at', 'INVALID_RECEIVED_AT'],
            ['lead_created_at', 'INVALID_LEAD_CREATED_AT'],
        ];
        for (const [field, reason] of fields) {
            test(`a bad ${field} -> ${reason}`, () => {
                for (const value of bad) assert.deepEqual(validateEvent(ev({ [field]: value })), { reason }, JSON.stringify(value));
            });
            test(`a missing ${field} -> ${reason}`, () => assert.deepEqual(validateEvent(ev({ [field]: undefined })), { reason }));
        }

        test('milliseconds and a real leap day are fine', () => {
            const result: any = validateEvent(ev({ event_timestamp: '2028-02-29T10:00:00.123Z', received_at: '2028-02-29T10:00:01Z' }));
            assert.equal(result.value.event_timestamp.toISOString(), '2028-02-29T10:00:00.123Z');
        });
    });

    describe('lead_created_at must not be after event_timestamp', () => {
        test('after -> INVALID_LEAD_CHRONOLOGY', () => {
            assert.deepEqual(validateEvent(ev({ lead_created_at: '2026-09-01T10:00:01Z' })), { reason: 'INVALID_LEAD_CHRONOLOGY' });
        });
        test('the same moment is allowed', () => {
            assert.ok('value' in validateEvent(ev({ lead_created_at: base.event_timestamp })));
        });
    });

    describe('the four optional fields', () => {
        const fields: [string, string][] = [
            ['campaign_id', 'INVALID_CAMPAIGN_ID'], ['segment', 'INVALID_SEGMENT'],
            ['email_provider', 'INVALID_EMAIL_PROVIDER'], ['lead_status', 'INVALID_LEAD_STATUS'],
        ];
        for (const [field, reason] of fields) {
            test(`${field}: missing, empty and null are fine, a number is ${reason}`, () => {
                for (const value of [undefined, '', null, 'text']) assert.ok('value' in validateEvent(ev({ [field]: value })), String(value));
                assert.deepEqual(validateEvent(ev({ [field]: 123 })), { reason });
            });
        }
    });

    test('only the first problem is reported', () => {
        // customer_id comes before event_type in the schema
        assert.deepEqual(validateEvent(ev({ customer_id: null, event_type: 'nope' })), { reason: 'MISSING_CUSTOMER_ID' });
    });

    test('a row that is not an object -> INVALID_RECORD', () => {
        for (const row of [null, undefined, 5, 'text', true, [], [base]]) {
            assert.deepEqual(validateEvent(row), { reason: 'INVALID_RECORD' }, JSON.stringify(row));
        }
    });

    test('extra keys do not make a row invalid', () => {
        assert.ok('value' in validateEvent(ev({ something_else: 'x' })));
    });
});
