import { Router } from 'express';
import { startAuth, handleCallback, publishImg, publishVideo} from '../controllers/instagramController.js';
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


// for challenging:
// Aggiungi questo
router.get('/webhooks', (req, res) => {
  const challenge = req.query['hub.challenge'];
  const token = req.query['hub.verify_token'];
  
  if (token === process.env.VERIFY_TOKEN) {
    res.status(200).send(challenge);
  } else {
    res.status(403).send('Token non valido');
  }
});

router.post('/publish/image', publishImg);
router.post('/publish/video', publishVideo);


export default router;