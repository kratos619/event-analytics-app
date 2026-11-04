import Event from '../models/Event';
import RejectedRecord from '../models/RejectedRecord';
import ImportRun from '../models/ImportRun';

// how many accepted events of each type
const getByType = async (match: Record<string, unknown>) => {
    // check redis, return data from redis if exists
    // key: events:byType:dealer_id:from:to

    const rows = await Event.aggregate([
        { $match: match },
        { $group: { _id: '$event_type', count: { $sum: 1 } } },   // like: SELECT event_type, COUNT(*) ... GROUP BY event_type
        { $sort: { _id: 1 } },
    ]);

    const by_type = rows.map((r) => ({ event_type: r._id, count: r.count }));
    const total = by_type.reduce((sum, r) => sum + r.count, 0);

    // create a redis cache for this data

    return { total, by_type };
};

// how many accepted events on each UTC day
const getDaily = async (match: Record<string, unknown>) => {
    const rows = await Event.aggregate([
        { $match: match },
        { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$event_timestamp', timezone: 'UTC' } }, count: { $sum: 1 } } },
        { $sort: { _id: 1 } },
    ]);

    return { daily: rows.map((r) => ({ day: r._id, count: r.count })) };
};

// the filters a caller can ask for. Already validated, so the service only has to use them
interface EventFilters { dealer_id?: string; event_type?: string; from?: string; to?: string }

// turns the filters into a MongoDB $match
const toMatch = ({ dealer_id, event_type, from, to }: EventFilters) => {
    const match: Record<string, any> = {};
    if (dealer_id) match.dealer_id = dealer_id;
    if (event_type) match.event_type = event_type;
    if (from || to) {
        match.event_timestamp = {};
        if (from) match.event_timestamp.$gte = new Date(`${from}T00:00:00Z`);   // from: start of that day, UTC
        if (to) match.event_timestamp.$lte = new Date(`${to}T23:59:59.999Z`);   // to: end of that day, UTC
    }
    return match;
};

// events per dealer, biggest first
const getByDealer = async (filters: EventFilters) => {
    const rows = await Event.aggregate([
        { $match: toMatch(filters) },
        { $group: { _id: '$dealer_id', count: { $sum: 1 } } },
        { $sort: { count: -1, _id: 1 } },
    ]);

    return { by_dealer: rows.map((r) => ({ dealer_id: r._id, count: r.count })) };
};

const LATE_HOURS = 24;

// how many events arrived late, and the average delay between event time and received time
const getLate = async (match: Record<string, unknown>) => {
    const delay = { $subtract: ['$received_at', '$event_timestamp'] };   // milliseconds
    const [row] = await Event.aggregate([
        { $match: match },
        {
            $group: {
                _id: null, //one group for all rows, so we get one row back with the totals
                total: { $sum: 1 }, //counts every event.
                late: { $sum: { $cond: [{ $gt: [delay, LATE_HOURS * 3600 * 1000] }, 1, 0] } },//counts only the events that are late eg. delay > 24 hours
                avg_delay_ms: { $avg: delay },
            }
        },
    ]);

    return {
        total: row?.total ?? 0,
        late: row?.late ?? 0,
        late_after_hours: LATE_HOURS,
        avg_delay_minutes: row ? Math.round(row.avg_delay_ms / 60000) : 0,
    };
};

// the last import, and how many rows were rejected for each reason
const getQuality = async () => {
    const [last_import, rows] = await Promise.all([
        ImportRun.findOne().sort({ createdAt: -1 }).select('-_id -__v').lean(),
        RejectedRecord.aggregate([{ $group: { _id: '$reason', count: { $sum: 1 } } }, { $sort: { count: -1, _id: 1 } }]),
    ]);

    return { last_import, by_reason: rows.map((r) => ({ reason: r._id, count: r.count })) };
};

// the rows we did not save, with the reason and the original row. reason narrows it down
const getRejected = async (page: number, limit: number, reason?: string) => {
    const filter = reason ? { reason } : {};
    console.log({ filter })
    const [total, records] = await Promise.all([
        RejectedRecord.countDocuments(filter),
        RejectedRecord.find(filter).sort({ row_number: 1 }).skip((page - 1) * limit).limit(limit)
            .select('-_id row_number reason raw').lean(),
    ]);

    return { page, limit, total, records };
};

// accepted events, newest first
const getEvents = async (match: Record<string, unknown>, page: number, limit: number) => {
    const [total, events] = await Promise.all([
        Event.countDocuments(match),
        Event.find(match).sort({ event_timestamp: -1, event_id: 1 }).skip((page - 1) * limit).limit(limit).select('-_id -__v').lean(),
    ]);

    return { page, limit, total, events };
};

export { getByType, getDaily, getByDealer, getLate, getQuality, getRejected, getEvents };
