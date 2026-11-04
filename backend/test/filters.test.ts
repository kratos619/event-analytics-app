// the filter rules, the validation middleware and the error handler: no database, no server
import { test, describe, mock } from 'node:test';
import assert from 'node:assert/strict';
import { eventFiltersSchema } from '../validators/eventFilters';
import { validateQuery } from '../middleware/validate';
import { AppError, errorHandler } from '../middleware/errorHandler';

describe('eventFiltersSchema', () => {
    const check = (query: object) => eventFiltersSchema.validate(query);

    test('no filters is fine', () => assert.equal(check({}).error, undefined));

    test('every filter together is fine, and the values come back unchanged', () => {
        const query = { dealer_id: 'd1', event_type: 'EMAIL_SENT', from: '2026-09-01', to: '2026-09-30' };
        const { error, value } = check(query);
        assert.equal(error, undefined);
        assert.deepEqual(value, query);
    });

    test('from and to may be the same day', () => assert.equal(check({ from: '2026-09-01', to: '2026-09-01' }).error, undefined));
    test('only from, or only to, is fine', () => {
        assert.equal(check({ from: '2026-09-01' }).error, undefined);
        assert.equal(check({ to: '2026-09-01' }).error, undefined);
    });

    test('an unknown event_type is rejected', () => assert.match(check({ event_type: 'EMAIL_LOST' }).error!.message, /event_type/));
    test('an empty dealer_id is rejected', () => assert.match(check({ dealer_id: '' }).error!.message, /dealer_id/));

    test('a day that is not written YYYY-MM-DD is rejected', () => {
        for (const day of ['2026-9-1', '09/01/2026', '20260901', '2026-09-01T10:00:00Z', 'tomorrow', '']) {
            assert.ok(check({ from: day }).error, `from=${day}`);
            assert.ok(check({ to: day }).error, `to=${day}`);
        }
    });

    test('from after to is rejected with a clear message', () => {
        assert.equal(check({ from: '2026-09-05', to: '2026-09-01' }).error!.message, '"from" must not be after "to"');
    });

    test('a key we do not know is rejected', () => assert.equal(check({ foo: '1' }).error!.message, '"foo" is not allowed'));

    test('a day that does not exist is rejected, not moved to another date', () => {
        // 2026-02-30 would be read as March 2
        for (const day of ['2026-02-30', '2026-02-29', '2026-04-31', '2026-06-31', '2026-13-01', '2026-00-10', '2026-01-00', '2026-01-32']) {
            assert.ok(check({ from: day }).error, `from=${day}`);
            assert.ok(check({ to: day }).error, `to=${day}`);
        }
    });

    test('the first and last day of a month, and a real leap day, are fine', () => {
        for (const day of ['2026-01-01', '2026-01-31', '2026-02-28', '2028-02-29', '2026-04-30', '2026-12-31']) {
            assert.equal(check({ from: day, to: day }).error, undefined, day);
        }
    });
});

describe('validateQuery middleware', () => {
    const run = (query: object) => {
        const res: any = { locals: {} };
        const calls: unknown[][] = [];
        validateQuery(eventFiltersSchema)({ query } as any, res, (...args: unknown[]) => { calls.push(args); });
        return { res, calls };
    };

    test('a good query: next() with no error, clean values in res.locals.query', () => {
        const { res, calls } = run({ dealer_id: 'd1' });
        assert.deepEqual(calls, [[]]);
        assert.deepEqual(res.locals.query, { dealer_id: 'd1' });
    });

    test('a bad query: next(AppError 400) with the message, res.locals untouched', () => {
        const { res, calls } = run({ from: '2026-09-05', to: '2026-09-01' });
        assert.equal(calls.length, 1);
        const err = calls[0][0] as AppError;
        assert.ok(err instanceof AppError);
        assert.equal(err.statusCode, 400);
        assert.equal(err.message, '"from" must not be after "to"');
        assert.equal(res.locals.query, undefined);
    });
});

describe('errorHandler', () => {
    const send = (err: unknown) => {
        const out: { status?: number; body?: any } = {};
        const res: any = { status(code: number) { out.status = code; return this; }, send(body: unknown) { out.body = body; return this; } };
        errorHandler(err, {} as any, res, () => {});
        return out;
    };

    test('an AppError keeps its status and message', () => {
        assert.deepEqual(send(new AppError(400, 'bad filter')), { status: 400, body: { error: 'Bad Request', message: 'bad filter' } });
        assert.deepEqual(send(new AppError(404, 'no such import')), { status: 404, body: { error: 'Not Found', message: 'no such import' } });
    });

    test('an unexpected error is a 500, logged, and its message is not sent to the client', () => {
        const log = mock.method(console, 'error', () => {});
        try {
            const out = send(new Error('connection string mongodb://secret'));
            assert.deepEqual(out, { status: 500, body: { error: 'Internal Server Error', message: 'Something went wrong' } });
            assert.equal(log.mock.callCount(), 1);
        } finally { log.mock.restore(); }
    });

    test('a 5xx AppError is hidden too', () => {
        const log = mock.method(console, 'error', () => {});
        try {
            assert.deepEqual(send(new AppError(503, 'db is down')).body, { error: 'Service Unavailable', message: 'Something went wrong' });
        } finally { log.mock.restore(); }
    });

    test('an error from express.json() (it has .status) keeps its 400 and message', () => {
        const out = send(Object.assign(new Error('Unexpected token } in JSON'), { status: 400 }));
        assert.deepEqual(out, { status: 400, body: { error: 'Bad Request', message: 'Unexpected token } in JSON' } });
    });
});
