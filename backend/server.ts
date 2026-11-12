import express from 'express';
import mongoose from 'mongoose';
import routes from './routes';
import { errorHandler } from './middleware/errorHandler';
import Event from './models/Event';
import RejectedRecord from './models/RejectedRecord';
import ImportRun from './models/ImportRun';

const app = express();
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
    .then(() => app.listen(PORT, () => console.log(`server on ${PORT}, mongo connected, indexes ready`)))
    .catch((err) => { console.error('server failed to start:', err.message); process.exit(1); });

export default app;
