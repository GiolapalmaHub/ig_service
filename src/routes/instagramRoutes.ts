import { Router } from 'express';
import { verifyWebhook, handleIntagramCallback,redirectToInstagramAuth } from '../controllers/instagramController.js';
import { verifyInternalApiKey } from '../middleware/authMiddleware.js';

const router = Router();

// router.get('/auth/callback', handleInstagramCallback);
// router.post('/publish', verifyInternalApiKey, publishMedia);

// Endpoint per la verifica del webhook di Instagram
router.get('/webhooks', verifyWebhook);

// for callback by meta
router.get('/auth/callback', handleIntagramCallback);

// for getting the url to redirect the user to instagram auth
router.get('/auth/url', redirectToInstagramAuth)


export default router;
