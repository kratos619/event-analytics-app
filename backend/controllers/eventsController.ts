import { Request, Response } from 'express';
import * as eventsService from '../services/eventsService';

// HTTP only: read the validated query, call one service, send the answer.
// The route already validated the query (validateQuery puts the clean values in res.locals.query).
// No try/catch: Express 5 hands a failed promise to errorHandler, which logs it and answers 500
const getByType = async (_req: Request, res: Response) => { res.send(await eventsService.getByType(res.locals.query)); };
const getDaily = async (_req: Request, res: Response) => { res.send(await eventsService.getDaily(res.locals.query)); };
const getByDealer = async (_req: Request, res: Response) => { res.send(await eventsService.getByDealer(res.locals.query)); };
const getLate = async (_req: Request, res: Response) => { res.send(await eventsService.getLate(res.locals.query)); };
const getQuality = async (_req: Request, res: Response) => { res.send(await eventsService.getQuality()); };

// the rows the last import did not save. ?reason=... narrows it down
const getRejected = async (_req: Request, res: Response) => {
    const { page, limit, reason } = res.locals.query;
    res.send(await eventsService.getRejected(page, limit, reason));
};

// accepted events, newest first, with the same filters as the metrics
const getEvents = async (_req: Request, res: Response) => {
    const { page, limit, ...filters } = res.locals.query;
    res.send(await eventsService.getEvents(filters, page, limit));
};

export { getByType, getDaily, getByDealer, getLate, getQuality, getRejected, getEvents };
