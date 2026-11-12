import { Router } from 'express';
import { importEvents } from '../controllers/importController';
import { getByDealer, getByType, getDaily, getEvents, getLate, getQuality, getRejected } from '../controllers/eventsController';
import { validateQuery } from '../middleware/validate';
import { uploadEventsFile } from '../middleware/upload';
import { eventFiltersSchema, eventsListSchema, rejectedListSchema } from '../validators/eventFilters';

const router = Router();

// every route that reads the URL query validates it here, so a controller never sees a bad query
router.post('/import', uploadEventsFile, importEvents);                                  // form field "file" -> saved to disk, then imported
router.get('/metrics/daily', validateQuery(eventFiltersSchema), getDaily);               // accepted events per UTC event day
router.get('/metrics/by-dealer', validateQuery(eventFiltersSchema), getByDealer);        // accepted events per dealer
router.get('/metrics/late', validateQuery(eventFiltersSchema), getLate);                 // late arrivals and average delay
router.get('/metrics/by-type', validateQuery(eventFiltersSchema), getByType);            // accepted events per event_type
router.get('/quality', getQuality);                                                      // last import + counts per reason (no query)
router.get('/quality/rejected', validateQuery(rejectedListSchema), getRejected);         // rows we did not save, paginated
router.get('/events', validateQuery(eventsListSchema), getEvents);                       // accepted events, paginated

export default router;
