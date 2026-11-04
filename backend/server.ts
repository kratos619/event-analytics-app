import express from 'express';
import mongoose from 'mongoose';
import routes from './routes';
import { errorHandler } from './middleware/errorHandler';

const app = express();
app.use(express.json({ limit: '50mb' }));                       // read JSON request bodies (an uploaded events file is one)
app.get('/health', (req, res) => res.json({ ok: true }));      // test route
app.use('/api', routes);                                        // all API routes live under /api
app.use(errorHandler);                                          // must come last: turns thrown errors into responses

const MONGO_URL = process.env.MONGO_URL ?? 'mongodb://localhost:27017/event_analytics';
const PORT = process.env.PORT ?? 3000;

mongoose
    .connect(MONGO_URL)
    .then(() => app.listen(PORT, () => console.log(`server on ${PORT}, mongo connected`)))
    .catch((err) => { console.error('mongo connect failed:', err.message); process.exit(1); });

export default app;
