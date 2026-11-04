import { Request, Response } from 'express';
import * as importService from '../services/importService';

const FILE = process.env.EVENTS_FILE ?? 'data/events_10000.json';   // where the input file is

const importEvents = async (req: Request, res: Response) => {
    try {
        const { error, result } = await importService.importEvents(FILE);
        if (error) return res.status(400).send({ error: 'Bad Request', message: error });

        return res.status(200).send(result);
    } catch (e: any) {
        return res.status(500).send({ error: 'Import failed', message: e.message });
    }
};

export { importEvents };
