import Event from '../models/Event';

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

export { getByType };
