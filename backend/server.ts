import express from 'express';
import mongoose from 'mongoose';
import routes from './routes';
import { errorHandler } from './middleware/errorHandler';
import Event from './models/Event';
import RejectedRecord from './models/RejectedRecord';
import ImportRun from './models/ImportRun';
import { recoverInterruptedImports } from './services/importService';

const app = express();

// one line per request when the answer is sent: method, URL, status and how long it took
app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => console.log(`[http] ${req.method} ${req.originalUrl} -> ${res.statusCode} in ${Date.now() - start} ms`));
    next();
});
app.use(express.json());                                        // read JSON request bodies
app.get('/health', (req, res) => res.json({ ok: true }));      // test route
app.use('/api', routes);                                        // all API routes live under /api
app.use(errorHandler);                                          // must come last: turns thrown errors into responses

const MONGO_URL = process.env.MONGO_URL ?? 'mongodb://localhost:27017/event_analytics';
const PORT = process.env.PORT ?? 3000;

// The indexes are defined in the models. Mongoose creates them at startup; we wait for that before taking requests,
// so no import runs without the unique index on event_id, and the server stops with the reason if one cannot be built.
// After that MongoDB keeps every index up to date on each write by itself. (Dropping a collection drops its indexes
// too: restart the server afterwards. In production indexes would be created by a migration at deploy time.)
mongoose
    .connect(MONGO_URL)
    .then(() => Promise.all([Event.init(), RejectedRecord.init(), ImportRun.init()]))
    .then(async () => {
        // imports a crash or restart cut off: roll back their half-saved data, mark them failed
        const interrupted = await recoverInterruptedImports();
        if (interrupted > 0) console.warn(`[startup] ${interrupted} interrupted import(s) rolled back and marked failed`);
    })
    // the database name only: the full MONGO_URL can contain a password, so it is never logged
    .then(() => app.listen(PORT, () => console.log(`[startup] server on ${PORT}, database "${mongoose.connection.name}" connected, indexes ready`)))
    .catch((err) => { console.error('[startup] server failed to start:', err.message); process.exit(1); });

// if MongoDB goes away while the server runs, say so (the driver reconnects by itself)
mongoose.connection.on('disconnected', () => console.warn('[db] MongoDB disconnected'));
mongoose.connection.on('reconnected', () => console.log('[db] MongoDB reconnected'));

export default app;
