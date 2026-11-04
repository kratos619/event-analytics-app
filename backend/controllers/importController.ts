import { Request, Response } from 'express';
import * as importService from '../services/importService';

// POST /api/import?file_name=events.json   body: the events file itself (a JSON array)
const importEvents = async (req: Request, res: Response) => {
    try {
        const name = req.query.file_name;
        const file_name = typeof name === 'string' && name ? name.slice(0, 255) : 'unknown';   // only used to label the run

        const { error, result } = await importService.importEvents(req.body, file_name);
        if (error) return res.status(400).send({ error: 'Bad Request', message: error });

        return res.status(200).send(result);
    } catch (e: any) {
        return res.status(500).send({ error: 'Import failed', message: e.message });
    }
};

export { importEvents };
