import { Router } from 'express';
import { importEvents } from '../controllers/importController';
import { getByDealer, getByType, getDaily, getEvents, getLate, getQuality, getRejected } from '../controllers/eventsController';
import { validateQuery } from '../middleware/validate';
import { uploadEventsFile } from '../middleware/upload';
import { eventFiltersSchema } from '../validators/eventFilters';

const router = Router();

router.post('/import', uploadEventsFile, importEvents);   // POST /api/import (form field "file") -> save the file to disk, then import it
router.get('/metrics/daily', getDaily);         // accepted events per UTC event day
router.get('/metrics/by-dealer', validateQuery(eventFiltersSchema), getByDealer);  // accepted events per dealer
router.get('/metrics/late', getLate);    
router.get('/metrics/by-type', getByType); 
router.get('/quality', getQuality);              // last import + counts per reason
router.get('/quality/rejected', getRejected);    // rows we did not save, paginated
router.get('/events', getEvents);                // accepted events, paginated
// accepted events per event_type
export default router;
