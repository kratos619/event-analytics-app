import { Request, Response } from 'express';
import Event,{EVENT_TYPES} from '../models/Event';
import Joi from 'joi';



// a day written like 2026-09-01 (UTC)
const day = Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).custom((v, h) => (isNaN(Date.parse(v)) ? h.error('any.invalid') : v));
const filterData = Joi.object({
    dealer_id: Joi.string(),
    event_type: Joi.string().valid(...EVENT_TYPES),
    from: day,
    to: day,
});

// turns the filters in the URL into a MongoDB $match. If a filter is wrong, error has the message
const buildMatch = (query: any) => {
    const match: any = {};
    const { error, value } = filterData.validate(query);
    if (error) return { match, error: error.message };
    if (value.from && value.to && value.from > value.to) return { match, error: '"from" must not be after "to"' };

    if (value.dealer_id) match.dealer_id = value.dealer_id;
    if (value.event_type) match.event_type = value.event_type;
    if (value.from || value.to) {
        match.event_timestamp = {};
        if (value.from) match.event_timestamp.$gte = new Date(`${value.from}T00:00:00Z`);   // from: start of that day, UTC
        if (value.to) match.event_timestamp.$lte = new Date(`${value.to}T23:59:59.999Z`);   // to: end of that day, UTC
    }
    return { match };
};

// how many accepted events of each type
const getByType = async (req: Request, res: Response) => {
    try {
        const { match, error } = buildMatch(req.query);
        if (error) return res.status(400).send({ error: 'Bad Request', message: error });

        const rows = await Event.aggregate([
            { $match: match },            
            { $group: { _id: '$event_type', count: { $sum: 1 } } },   // like: SELECT event_type, COUNT(*) ... GROUP BY event_type
            { $sort: { _id: 1 } },
        ]);
        const by_type = rows.map((r) => ({ event_type: r._id, count: r.count }));
        const total = by_type.reduce((sum, r) => sum + r.count, 0);

        return res.status(200).send({ total, by_type });
    } catch (e: any) {
        return res.status(500).send({ error: 'Query failed', message: e.message });
    }
};

const getDaily = async (req: Request, res: Response) => {
    try {
        const { match, error } = buildMatch(req.query);
        if (error) return res.status(400).send({ error: 'Bad Request', message: error });

        const rows = await Event.aggregate([
            { $match: match },
            { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$event_timestamp', timezone: 'UTC' } }, count: { $sum: 1 } } },
            { $sort: { _id: 1 } },
        ]);
        return res.status(200).send({ daily: rows.map((r) => ({ day: r._id, count: r.count })) });
    } catch (e: any) {
        return res.status(500).send({ error: 'Query failed', message: e.message });
    }
};

// events per dealer, biggest first
const getByDealer = async (req: Request, res: Response) => {
    try {
        const { match, error } = buildMatch(req.query);
        if (error) return res.status(400).send({ error: 'Bad Request', message: error });

        const rows = await Event.aggregate([
            { $match: match },
            { $group: { _id: '$dealer_id', count: { $sum: 1 } } },
            { $sort: { count: -1, _id: 1 } },
        ]);
        return res.status(200).send({ by_dealer: rows.map((r) => ({ dealer_id: r._id, count: r.count })) });
    } catch (e: any) {
        return res.status(500).send({ error: 'Query failed', message: e.message });
    }
};

const LATE_HOURS = 24;

// how many events arrived late, and the average delay between event time and received time
const getLate = async (req: Request, res: Response) => {
    try {
        const { match, error } = buildMatch(req.query);
        if (error) return res.status(400).send({ error: 'Bad Request', message: error });

        const delay = { $subtract: ['$received_at', '$event_timestamp'] };   // milliseconds
        const [row] = await Event.aggregate([
            { $match: match },
            {
                $group: {
                    _id: null,
                    total: { $sum: 1 },
                    late: { $sum: { $cond: [{ $gt: [delay, LATE_HOURS * 3600 * 1000] }, 1, 0] } },
                    avg_delay_ms: { $avg: delay },
                }
            },
        ]);
        return res.status(200).send({
            total: row?.total ?? 0,
            late: row?.late ?? 0,
            late_after_hours: LATE_HOURS,
            avg_delay_minutes: row ? Math.round(row.avg_delay_ms / 60000) : 0,
        });
    } catch (e: any) {
        return res.status(500).send({ error: 'Query failed', message: e.message });
    }
};

export { getByType, getDaily, getByDealer, getLate };
