import { Router } from 'express';
import { startAuth, handleCallback, healthCheck } from '../controllers/instagramController.js';
const router = Router();

/**
 * GET /auth/url
 * Inizia il flusso OAuth
 * 
 * Query params:
 * - userId: ID utente del sistema client
 * - callbackUrl: URL dove reindirizzare dopo OAuth
 * - state (optional): stato da preservare
 */
router.get('/url', startAuth);

/**
 * GET /auth/callback
 * Callback da Instagram OAuth
 */
router.get('/callback', handleCallback);

/**
 * GET /health
 * Health check
 */
router.get('/health', healthCheck);

export default router;