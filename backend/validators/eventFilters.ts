import Joi from 'joi';
import { EVENT_TYPES } from '../models/Event';

// a day written like 2026-09-01 (UTC)
const day = Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).custom((v, h) => (isNaN(Date.parse(v)) ? h.error('any.invalid') : v));

// the filters the metrics endpoints accept in the URL
export const eventFiltersSchema = Joi.object({
    dealer_id: Joi.string(),
    event_type: Joi.string().valid(...EVENT_TYPES),
    from: day,
    to: day,
}).custom((v, h) => (v.from && v.to && v.from > v.to ? h.message({ custom: '"from" must not be after "to"' }) : v));
