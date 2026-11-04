import { Request, Response } from 'express';
import { EVENT_TYPES } from '../models/Event';
import Joi from 'joi';
import * as eventsService from '../services/eventsService';




const pageData = Joi.object({
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(20),
});


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

        return res.status(200).send(await eventsService.getByType(match));
    } catch (e: any) {
        return res.status(500).send({ error: 'Query failed', message: e.message });
    }
};

const getDaily = async (req: Request, res: Response) => {
    try {
        const { match, error } = buildMatch(req.query);
        if (error) return res.status(400).send({ error: 'Bad Request', message: error });

        return res.status(200).send(await eventsService.getDaily(match));
    } catch (e: any) {
        return res.status(500).send({ error: 'Query failed', message: e.message });
    }
};

// events per dealer, biggest first. The route already validated the query, errors go to errorHandler
const getByDealer = async (req: Request, res: Response) => {
    res.status(200).send(await eventsService.getByDealer(res.locals.query));
};

// how many events arrived late, and the average delay between event time and received time
const getLate = async (req: Request, res: Response) => {
    try {
        const { match, error } = buildMatch(req.query);
        if (error) return res.status(400).send({ error: 'Bad Request', message: error });

        return res.status(200).send(await eventsService.getLate(match));
    } catch (e: any) {
        return res.status(500).send({ error: 'Query failed', message: e.message });
    }
};



const getQuality = async (req: Request, res: Response) => {
    try {
        return res.status(200).send(await eventsService.getQuality());
    } catch (e: any) {
        return res.status(500).send({ error: 'Query failed', message: e.message });
    }
};


// the rows we did not save, with the reason and the original row. ?reason=... narrows it down
const getRejected = async (req: Request, res: Response) => {
    try {
        const { error, value } = pageData.keys({ reason: Joi.string() }).validate(req.query);
        if (error) return res.status(400).send({ error: 'Bad Request', message: error.message });

        return res.status(200).send(await eventsService.getRejected(value.page, value.limit, value.reason));
    } catch (e: any) {
        return res.status(500).send({ error: 'Query failed', message: e.message });
    }
};


// accepted events, newest first, with the same filters as the metrics
const getEvents = async (req: Request, res: Response) => {
    try {
        const { page, limit, ...filters } = req.query;
        const paging = pageData.validate({ page, limit });
        if (paging.error) return res.status(400).send({ error: 'Bad Request', message: paging.error.message });
        const { match, error } = buildMatch(filters);
        if (error) return res.status(400).send({ error: 'Bad Request', message: error });

        return res.status(200).send(await eventsService.getEvents(match, paging.value.page, paging.value.limit));
    } catch (e: any) {
        return res.status(500).send({ error: 'Query failed', message: e.message });
    }
};




export { getByType, getDaily, getByDealer, getLate, getQuality, getRejected, getEvents };
