import { Router } from 'express';
import { importEvents } from '../controllers/importController';

const router = Router();

router.post('/import', importEvents);   // POST /api/import  -> read the file and save the events

export default router;
