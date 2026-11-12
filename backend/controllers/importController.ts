import path from 'path';
import { Request, Response } from 'express';
import * as importService from '../services/importService';
import { AppError } from '../middleware/errorHandler';

// POST /api/import   form field "file": the events file. The upload middleware has already saved it to disk as <file_id>.json
// No try/catch: a failed import throws, and Express 5 hands the error to errorHandler (400 for a bad file, 500 otherwise)
const importEvents = async (req: Request, res: Response) => {
    if (!req.file) throw new AppError(400, 'attach a .json file in the "file" field');

    const file_id = path.parse(req.file.filename).name;             // the stored file is named after its file_id
    // multer reads the name the browser sent (utf8) as latin1, so "más.json" would come out as "mÃ¡s.json"
    const file_name = Buffer.from(req.file.originalname, 'latin1').toString('utf8');
    res.send(await importService.importEvents(req.file.path, file_name, file_id));
};

export { importEvents };
