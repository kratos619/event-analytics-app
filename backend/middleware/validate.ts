import { RequestHandler } from 'express';
import { ObjectSchema } from 'joi';
import { AppError } from './errorHandler';

// checks the URL query against a Joi schema. Bad -> 400. Good -> the clean values are in res.locals.query
export const validateQuery = (schema: ObjectSchema): RequestHandler => (req, res, next) => {
    const { error, value } = schema.validate(req.query);
    if (error) return next(new AppError(400, error.message));
    res.locals.query = value;
    next();
};
