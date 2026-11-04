import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import multer from 'multer';

export const UPLOAD_DIR = process.env.UPLOAD_DIR ?? 'uploads';   // where uploaded files are kept
export const MAX_UPLOAD_MB = 50;

// saves the uploaded file (form field "file", a .json file) to UPLOAD_DIR as <file_id>.json.
// The file name IS the file_id, so a stored file can always be matched to its run, events and rejected rows.
// Anything else (no file, other field, not .json) leaves req.file empty, or is a MulterError for the errorHandler
export const uploadEventsFile = multer({
    storage: multer.diskStorage({
        destination: (_req, _file, cb) => { fs.mkdirSync(UPLOAD_DIR, { recursive: true }); cb(null, UPLOAD_DIR); },
        filename: (_req, _file, cb) => cb(null, `${randomUUID()}.json`),
    }),
    limits: { fileSize: MAX_UPLOAD_MB * 1024 * 1024, files: 1 },
    fileFilter: (_req, file, cb) => cb(null, path.extname(file.originalname).toLowerCase() === '.json'),
}).single('file');
