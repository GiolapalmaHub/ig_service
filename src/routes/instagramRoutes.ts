import { Router } from 'express';
import crypto from 'crypto';
import type { Request, Response } from 'express';
import { 
  startAuth, 
  handleCallback,
  publishImage, 
  publishVideo,
  publishCarousel,
  refreshToken,
  checkRateLimit
} from '../controllers/instagramController.js';
import { processMessagingEvent, processChangeEvent } from '../utils/webhookProcessors.js';

const router = Router();

// ============================================
// OAUTH ROUTES
// ============================================
router.get('/url', startAuth);
router.get('/callback', handleCallback);

// ============================================
// PUBLISHING ROUTES
// ============================================
router.post('/publish/image', publishImage);
router.post('/publish/video', publishVideo);
router.post('/publish/carousel', publishCarousel);
router.post('/refresh-token', refreshToken);
router.get('/rate-limit', checkRateLimit);

// ============================================
// DEAUTHORIZATION & DATA DELETION (GDPR)
// ============================================

/**
 * POST /api/v1/instagram/auth/deauthorize
 * Gestisce la deauthorizzazione dell'app (chiamato da Meta)
 */
router.post('/deauthorize', async (req: Request, res: Response) => {
  try {
    const { signed_request } = req.body;
    
    console.log('📤 Deauthorize request ricevuta:', {
      timestamp: new Date().toISOString(),
      signedRequest: signed_request ? 'presente' : 'mancante'
    });

    if (!signed_request) {
      return res.status(400).json({ error: 'signed_request mancante' });
    }

    // Parse signed request (formato: signature.payload)
    const [signature, payload] = signed_request.split('.');
    const data = JSON.parse(Buffer.from(payload, 'base64').toString('utf-8'));
    
    console.log('👤 Utente deauthorizzato:', {
      userId: data.user_id,
      issuedAt: new Date(data.issued_at * 1000).toISOString()
    });

    // TODO: Notificare IVOT per rimuovere token dal DB
    // await IvotNotifier.notifyGenericEvent('deauthorize', 'system', {
    //   user_id: data.user_id,
    //   issued_at: data.issued_at
    // });

    res.status(200).json({ 
      success: true,
      message: 'Deauthorizzazione processata'
    });

  } catch (error) {
    console.error('❌ Errore deauthorizzazione:', error);
    res.status(500).json({ 
      error: 'Errore processando deauthorizzazione'
    });
  }
});

/**
 * POST /api/v1/instagram/auth/data-deletion
 * Gestisce richieste cancellazione dati (GDPR compliance)
 */
router.post('/data-deletion', async (req: Request, res: Response) => {
  try {
    const { signed_request } = req.body;
    
    console.log('🗑️ Data deletion request ricevuta');

    if (!signed_request) {
      return res.status(400).json({ error: 'signed_request mancante' });
    }

    const [signature, payload] = signed_request.split('.');
    const data = JSON.parse(Buffer.from(payload, 'base64').toString('utf-8'));
    
    const confirmationCode = `IVOT_DEL_${Date.now()}_${data.user_id}`;

    console.log('👤 Richiesta cancellazione per:', data.user_id);

    // TODO: Notificare IVOT per schedulare cancellazione dati
    // await IvotNotifier.notifyGenericEvent('data_deletion_request', 'system', {
    //   user_id: data.user_id,
    //   confirmation_code: confirmationCode,
    //   issued_at: data.issued_at
    // });

    const statusUrl = `${process.env.IVOT_FRONTEND_URL}/data-deletion-status?code=${confirmationCode}`;

    res.status(200).json({ 
      url: statusUrl,
      confirmation_code: confirmationCode
    });

  } catch (error) {
    console.error('❌ Errore data deletion:', error);
    res.status(500).json({ 
      error: 'Errore processando richiesta cancellazione'
    });
  }
});

// ============================================
// WEBHOOKS
// ============================================

/**
 * GET /api/v1/instagram/auth/webhooks
 * Verifica webhook (chiamato da Meta durante setup)
 */
router.get('/webhooks', (req: Request, res: Response) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  console.log('🔍 Webhook verification request:', {
    mode,
    token: token ? 'presente' : 'mancante',
    challenge: challenge ? 'presente' : 'mancante'
  });

  if (mode === 'subscribe' && token === process.env.VERIFY_TOKEN) {
    console.log('✅ Webhook verified successfully');
    res.status(200).send(challenge);
  } else {
    console.error('❌ Webhook verification failed:', {
      expectedToken: process.env.VERIFY_TOKEN ? 'configured' : 'MISSING',
      receivedToken: token,
      mode
    });
    res.status(403).send('Forbidden');
  }
});

/**
 * POST /api/v1/instagram/auth/webhooks
 * Riceve notifiche webhook da Instagram
 */
router.post('/webhooks', async (req: Request, res: Response) => {
  // ✅ STEP 1: Rispondi SUBITO a Instagram (timeout 20 secondi)
  res.sendStatus(200);

  try {
    // ✅ STEP 2: Verifica firma HMAC per sicurezza
    const signature = req.headers['x-hub-signature-256'] as string;
    
    if (!verifyWebhookSignature(req.body, signature)) {
      console.error('❌ Invalid webhook signature - possibile attacco!');
      return;
    }

    console.log('📬 Webhook received & verified:', {
      timestamp: new Date().toISOString(),
      object: req.body.object,
      entries: req.body.entry?.length || 0
    });

    // ✅ STEP 3: Processa eventi in background (non bloccare risposta)
    const { object, entry } = req.body;

    if (!entry || entry.length === 0) {
      console.warn('⚠️ Webhook senza entry - ignorato');
      return;
    }

    // Process each entry
    for (const item of entry) {
      const instagramAccountId = item.id;
      const webhookTime = item.time;

      console.log(`📱 Processing entry for account: ${instagramAccountId}`);

      // ✅ Processa messaggi diretti
      if (item.messaging && Array.isArray(item.messaging)) {
        console.log(`   💬 Processing ${item.messaging.length} messaging event(s)`);
        for (const msg of item.messaging) {
          await processMessagingEvent(instagramAccountId, msg, webhookTime);
        }
      }

      // ✅ Processa commenti/mentions
      if (item.changes && Array.isArray(item.changes)) {
        console.log(`   🔄 Processing ${item.changes.length} change event(s)`);
        for (const change of item.changes) {
          await processChangeEvent(instagramAccountId, change, webhookTime);
        }
      }
    }

    console.log('✅ Webhook processing completed');

  } catch (error) {
    console.error('❌ Webhook processing error:', {
      error: error instanceof Error ? error.message : 'Unknown',
      stack: error instanceof Error ? error.stack : undefined
    });
    // Non rilanciare l'errore - abbiamo già risposto 200 a Instagram
  }
});

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Verifica la firma HMAC SHA256 dei webhook
 */
function verifyWebhookSignature(body: any, signature: string | undefined): boolean {
  if (!signature) {
    console.warn('⚠️ Nessuna signature presente nell\'header X-Hub-Signature-256');
    return false;
  }

  if (!process.env.INSTAGRAM_APP_SECRET) {
    console.error('❌ INSTAGRAM_APP_SECRET non configurato!');
    return false;
  }

  try {
    const payload = JSON.stringify(body);
    const expectedSignature = 'sha256=' + 
      crypto.createHmac('sha256', process.env.INSTAGRAM_APP_SECRET)
            .update(payload)
            .digest('hex');

    // Usa timing-safe comparison per prevenire timing attacks
    const isValid = crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expectedSignature)
    );

    if (!isValid) {
      console.error('❌ Signature mismatch:', {
        received: signature.substring(0, 20) + '...',
        expected: expectedSignature.substring(0, 20) + '...'
      });
    }

    return isValid;
  } catch (error) {
    console.error('❌ Errore verifica signature:', error);
    return false;
  }
}

export default router;