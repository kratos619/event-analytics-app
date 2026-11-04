import { ErrorRequestHandler } from 'express';
import { STATUS_CODES } from 'http';

// an error we expect, with the HTTP status to send back. Middleware and services throw it
export class AppError extends Error {
    constructor(public statusCode: number, message: string) { super(message); }
}

// the one place where errors become responses. 4xx show their message, 5xx are logged and hidden
export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
    // err.status: errors from express.json(). A MulterError has a code: too big is 413, anything else is the client's mistake
    const status = err.statusCode ?? err.status ?? (err.code === 'LIMIT_FILE_SIZE' ? 413 : err.name === 'MulterError' ? 400 : 500);
    if (status >= 500) console.error(err);
    res.status(status).send({ error: STATUS_CODES[status], message: status >= 500 ? 'Something went wrong' : err.message });
};
