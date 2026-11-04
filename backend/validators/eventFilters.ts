import Joi from 'joi';
import { EVENT_TYPES } from '../models/Event';

// a day written like 2026-09-01 (UTC). It must exist: 2026-02-30 would come back as 2026-03-02, so it is rejected
const day = Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).custom((v, h) => {
    const date = new Date(`${v}T00:00:00Z`);
    return !isNaN(date.getTime()) && date.toISOString().slice(0, 10) === v ? v : h.error('any.invalid');
});

// the filters the metrics endpoints accept in the URL
export const eventFiltersSchema = Joi.object({
    dealer_id: Joi.string(),
    event_type: Joi.string().valid(...EVENT_TYPES),
    from: day,
    to: day,
}).custom((v, h) => (v.from && v.to && v.from > v.to ? h.message({ custom: '"from" must not be after "to"' }) : v));
