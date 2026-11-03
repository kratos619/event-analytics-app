import { Router } from 'express';
import { importEvents } from '../controllers/importController';
import { getByType } from '../controllers/eventsController';

const router = Router();

router.post('/import', importEvents);   // POST /api/import  -> read the file and save the events
router.get('/metrics/by-type', getByType);  // GET /api/metrics/by-type -> accepted events per event_type

export default router;
