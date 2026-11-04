import fs from 'fs';
import path from 'path';
import { Request, Response } from 'express';
import * as importService from '../services/importService';

// POST /api/import   form field "file": the events file. The upload middleware has already saved it to disk as <file_id>.json
const importEvents = async (req: Request, res: Response) => {
    try {
        if (!req.file) return res.status(400).send({ error: 'Bad Request', message: 'attach a .json file in the "file" field' });

        const file_id = path.parse(req.file.filename).name;             // the stored file is named after its file_id
        // multer reads the name the browser sent (utf8) as latin1, so "más.json" would come out as "mÃ¡s.json"
        const file_name = Buffer.from(req.file.originalname, 'latin1').toString('utf8');
        const { error, result } = await importService.importEvents(req.file.path, file_name, file_id);
        if (error) {
            fs.rmSync(req.file.path, { force: true });                  // no run points to this file, so do not keep it
            return res.status(400).send({ error: 'Bad Request', message: error });
        }

        return res.status(200).send(result);
    } catch (e: any) {
        return res.status(500).send({ error: 'Import failed', message: e.message });
    }
};

export { importEvents };
