import { Router } from 'express';
import { importEvents } from '../controllers/importController';
import { getByDealer, getByType, getDaily, getLate } from '../controllers/eventsController';

const router = Router();

router.post('/import', importEvents);   // POST /api/import  -> read the file and save the events
router.get('/metrics/daily', getDaily);         // accepted events per UTC event day
router.get('/metrics/by-dealer', getByDealer);  // accepted events per dealer
router.get('/metrics/late', getLate);    
router.get('/metrics/by-type', getByType);      // accepted events per event_type
export default router;
