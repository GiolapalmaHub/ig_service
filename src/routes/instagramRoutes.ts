// File: microservizio/src/routes/instagramRoutes.ts

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
import axios from 'axios';
import { verifyInternalApiKey } from '../middleware/authMiddleware.js';

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
// SEND MESSAGE (chiamato da IVOT backend)
// ============================================

/**
 * POST /api/v1/instagram/send-message
 * Invia messaggio Instagram (chiamato da IVOT backend)
 */
router.post('/send-message', verifyInternalApiKey, async (req: Request, res: Response) => {
  try {
    const { instagram_account_id, recipient_id, message, access_token } = req.body;

    // Validazione parametri
    if (!instagram_account_id || !recipient_id || !message || !access_token) {
      return res.status(400).json({
        error: 'Parametri mancanti',
        required: ['instagram_account_id', 'recipient_id', 'message', 'access_token']
      });
    }

    console.log('[SEND_MESSAGE] Sending to Instagram:', {
      account: instagram_account_id,
      recipient: recipient_id,
      messageLength: message.length
    });

    // Invia messaggio
    const response = await axios.post(
      `https://graph.instagram.com/v23.0/${instagram_account_id}/messages`,
      {
        recipient: { id: recipient_id },
        message: { text: message }
      },
      {
        headers: {
          'Authorization': `Bearer ${access_token}`,
          'Content-Type': 'application/json'
        },
        timeout: 10000
      }
    );

    console.log('[SEND_MESSAGE] ✅ Message sent:', response.data.message_id);

    res.json({
      success: true,
      message_id: response.data.message_id
    });

  } catch (error) {
    console.error('[SEND_MESSAGE] ❌ Error:', error);
    
    if (axios.isAxiosError(error)) {
      const fbError = error.response?.data?.error;
      
      if (fbError?.code === 190) {
        return res.status(401).json({
          error: 'TOKEN_EXPIRED',
          message: 'Access token scaduto o invalidato',
          facebook_error: fbError
        });
      }
      
      if (fbError?.code === 4 || fbError?.code === 32) {
        return res.status(429).json({
          error: 'RATE_LIMIT',
          message: 'Rate limit raggiunto',
          facebook_error: fbError
        });
      }

      if (fbError?.code === 200) {
        return res.status(403).json({
          error: 'PERMISSION_DENIED',
          message: 'Permessi insufficienti',
          facebook_error: fbError
        });
      }

      return res.status(error.response?.status || 500).json({
        error: 'INSTAGRAM_API_ERROR',
        message: fbError?.message || 'Errore invio messaggio',
        facebook_error: fbError
      });
    }
    
    res.status(500).json({ 
      error: 'INTERNAL_ERROR',
      message: 'Errore interno del microservizio' 
    });
  }
});

// ============================================
// DEAUTHORIZATION & DATA DELETION
// ============================================

router.post('/deauthorize', async (req: Request, res: Response) => {
  try {
    const { signed_request } = req.body;
    
    console.log('📤 Deauthorize request:', {
      timestamp: new Date().toISOString(),
      signedRequest: signed_request ? 'presente' : 'mancante'
    });

    if (!signed_request) {
      return res.status(400).json({ error: 'signed_request mancante' });
    }

    const [signature, payload] = signed_request.split('.');
    const data = JSON.parse(Buffer.from(payload, 'base64').toString('utf-8'));
    
    console.log('👤 Utente deauthorizzato:', {
      userId: data.user_id,
      issuedAt: new Date(data.issued_at * 1000).toISOString()
    });

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
    challenge
  });

  if (mode === 'subscribe' && token === process.env.VERIFY_TOKEN) {
    console.log('✅ Webhook verified');
    res.status(200).send(challenge);
  } else {
    console.error('❌ Webhook verification failed');
    res.status(403).send('Forbidden');
  }
});

/**
 * POST /api/v1/instagram/auth/webhooks
 * Riceve notifiche webhook da Instagram
 */
router.post('/webhooks', async (req: Request, res: Response) => {
  console.log('\n');
  console.log('═══════════════════════════════════════════════════════');
  console.log('[WEBHOOK] 📥 NEW REQUEST RECEIVED');
  console.log('[WEBHOOK] Timestamp:', new Date().toISOString());
  console.log('[WEBHOOK] Method:', req.method);
  console.log('[WEBHOOK] URL:', req.url);
  console.log('[WEBHOOK] Headers:', JSON.stringify({
    'x-hub-signature-256': req.headers['x-hub-signature-256'],
    'content-type': req.headers['content-type'],
    'user-agent': req.headers['user-agent']
  }, null, 2));
  console.log('[WEBHOOK] Body:', JSON.stringify(req.body, null, 2));
  console.log('═══════════════════════════════════════════════════════');
  
  // ✅ STEP 1: Rispondi SUBITO (timeout 20 secondi)
  res.sendStatus(200);

  try {
    // ✅ STEP 2: Verifica signature
    console.log('[WEBHOOK] 🔒 Verifying signature...');
    
    if (!verifyWebhookSignature(req)) {
      console.error('[WEBHOOK] ❌ SIGNATURE VERIFICATION FAILED');
      console.error('[WEBHOOK] ⚠️ Skipping webhook processing for security');
      return;
    }
    
    console.log('[WEBHOOK] ✅ Signature verified successfully');

    // ✅ STEP 3: Processa eventi
    const { object, entry } = req.body;

    console.log('[WEBHOOK] 📦 Processing webhook:', {
      object,
      entriesCount: entry?.length || 0
    });

    if (!entry || entry.length === 0) {
      console.warn('[WEBHOOK] ⚠️ Webhook senza entry - ignorato');
      return;
    }

    // Process each entry
    for (const item of entry) {
      console.log('[WEBHOOK] ➡️ Processing entry:', JSON.stringify(item, null, 2));
      const itemId = item.id;
      const webhookTime = item.time;

      console.log(`[WEBHOOK] 📱 Processing entry for account: ${itemId}`);

      // ✅ Processa eventi change (include messaggi, commenti, mentions)
      if (item.changes && Array.isArray(item.changes)) {
        console.log(`[WEBHOOK] 🔄 Found ${item.changes.length} change event(s)`);
        
        for (const change of item.changes) {
          await processChangeEvent(change, webhookTime);
        }
      }

      // ✅ Processa messaggi diretti (formato alternativo - raramente usato)
      if (item.messaging && Array.isArray(item.messaging)) {
        console.log(`[WEBHOOK] 💬 Found ${item.messaging.length} direct messaging event(s)`);
        
        for (const msg of item.messaging) {
          console.log('[WEBHOOK] 📨 Processing direct message:', {
            sender: msg.sender?.id,
            recipient: msg.recipient?.id,
            hasMessage: !!msg.message,
            hasReaction: !!msg.reaction
          });
          
          await processMessagingEvent(itemId, msg, webhookTime);
        }
      }
    }

    console.log('[WEBHOOK] ✅ Webhook processing completed');
    console.log('═══════════════════════════════════════════════════════\n');

  } catch (error) {
    console.error('[WEBHOOK] ❌ Webhook processing error:', {
      error: error instanceof Error ? error.message : 'Unknown',
      stack: error instanceof Error ? error.stack : undefined
    });
  }
});

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Verifica la firma HMAC SHA256 dei webhook
 */
function verifyWebhookSignature(req: Request): boolean {
  const signature = req.headers['x-hub-signature-256'] as string;
  
  if (!signature) {
    console.warn('[WEBHOOK:VERIFY] ⚠️ Nessuna signature presente');
    return false;
  }

  try {
    // Usa raw body salvato nel middleware
    const rawBody = (req as any).rawBody;
    
    if (!rawBody) {
      console.error('[WEBHOOK:VERIFY] ❌ Raw body non disponibile');
      return false;
    }

    console.log('[WEBHOOK:VERIFY] 🔍 Verifying signature');
    console.log('[WEBHOOK:VERIFY]    Raw body length:', rawBody.length);
    console.log('[WEBHOOK:VERIFY]    Received signature:', signature);
    console.log('[WEBHOOK:VERIFY]    App secret length:', process.env.INSTAGRAM_APP_SECRET?.length);

    // Calcola firma attesa
    const expectedSignature = 'sha256=' + 
      crypto.createHmac('sha256', process.env.INSTAGRAM_APP_SECRET!)
            .update(rawBody)
            .digest('hex');

    console.log('[WEBHOOK:VERIFY]    Expected signature:', expectedSignature);

    // Confronto sicuro
    const isValid = crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expectedSignature)
    );

    if (isValid) {
      console.log('[WEBHOOK:VERIFY] ✅ Signature VALID');
    } else {
      console.error('[WEBHOOK:VERIFY] ❌ Signature INVALID');
    }

    return isValid;

  } catch (error) {
    console.error('[WEBHOOK:VERIFY] ❌ Error verifying signature:', error);
    return false;
  }
}

export default router;