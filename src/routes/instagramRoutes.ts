import { Router } from 'express';
import crypto from 'crypto';
import type { Request, Response } from 'express';
import { 
  startAuth, 
  handleCallback} from '../controllers/instagramController.js';
import { 
  publishImage, 
  publishVideo ,
  publishCarousel,
  refreshToken,
  checkRateLimit
} from '../controllers/instagramController.js';

const router = Router();

router.get('/url', startAuth);
router.get('/callback', handleCallback);
router.post('/publish/carousel', publishCarousel);
router.post('/refresh-token', refreshToken);
router.get('/rate-limit', checkRateLimit);


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

    // TODO: Implementare logica per rimuovere token dal DB
    // Esempio con Supabase:
    // await supabase
    //   .from('instagram_accounts')
    //   .update({ access_token: null, is_active: false })
    //   .eq('instagram_user_id', data.user_id);

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

    // TODO: Implementare logica cancellazione dati
    // 1. Salvare richiesta in DB
    // 2. Schedulare cancellazione (max 90 giorni)
    // 3. Eliminare tutti i dati utente

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
  // Rispondi immediatamente (Instagram ha timeout 20 secondi)
  res.sendStatus(200);

  try {
    // Verifica signature per sicurezza
    const signature = req.headers['x-hub-signature-256'] as string;
    
    if (!verifyWebhookSignature(req.body, signature)) {
      console.error('❌ Invalid webhook signature');
      return;
    }

    console.log('📬 Webhook received:', {
      timestamp: new Date().toISOString(),
      object: req.body.object,
      entries: req.body.entry?.length || 0
    });

    // Log payload completo per debug
    console.log('Payload:', JSON.stringify(req.body, null, 2));

    // Processa eventi
    const { object, entry } = req.body;

    if (!entry || entry.length === 0) {
      console.warn('⚠️ Webhook senza entry');
      return;
    }

    for (const item of entry) {
      const accountId = item.id;
      const time = item.time;

      // Processa messaggi
      if (item.messaging) {
        for (const msg of item.messaging) {
          await processMessagingEvent(accountId, msg);
        }
      }

      // Processa commenti
      if (item.changes) {
        for (const change of item.changes) {
          await processChangeEvent(accountId, change);
        }
      }
    }

  } catch (error) {
    console.error('❌ Webhook processing error:', error);
  }
});

// ============================================
// PUBLISHING
// ============================================
/**
 * POST /api/v1/instagram/auth/publish/image
 * Pubblica un'immagine su Instagram
 * 
 * Body:
 * {
 *   "instagram_account_id": "17841476841102986",
 *   "access_token": "IGAAOwrd...",
 *   "image_url": "https://example.com/image.jpg",
 *   "caption": "Il mio post!"
 * }
 */
router.post('/publish/image', publishImage);

/**
 * POST /api/v1/instagram/auth/publish/video
 * Pubblica un video su Instagram
 */
router.post('/publish/video', publishVideo);

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Verifica la firma HMAC SHA256 dei webhook
 */
function verifyWebhookSignature(body: any, signature: string | undefined): boolean {
  if (!signature) {
    console.warn('⚠️ Nessuna signature presente');
    return false;
  }

  try {
    const payload = JSON.stringify(body);
    const expectedSignature = 'sha256=' + 
      crypto.createHmac('sha256', process.env.INSTAGRAM_APP_SECRET!)
            .update(payload)
            .digest('hex');

    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expectedSignature)
    );
  } catch (error) {
    console.error('❌ Errore verifica signature:', error);
    return false;
  }
}


/**
 * Processa eventi di messaging
 */
async function processMessagingEvent(accountId: string, msg: any): Promise<void> {
  console.log('💬 Messaging event:', {
    accountId,
    sender: msg.sender?.id,
    recipient: msg.recipient?.id,
    timestamp: msg.timestamp
  });

  // Message received
  if (msg.message) {
    console.log('📨 Message:', {
      mid: msg.message.mid,
      text: msg.message.text,
      isDeleted: msg.message.is_deleted,
      isEcho: msg.message.is_echo
    });

    // TODO: Implementare logica per gestire messaggi
    // - Salvare in DB
    // - Rispondere automaticamente
    // - Notificare frontend
  }

  // Reaction
  if (msg.reaction) {
    console.log('❤️ Reaction:', {
      messageId: msg.reaction.mid,
      action: msg.reaction.action,
      emoji: msg.reaction.emoji
    });
  }

  // Message read
  if (msg.read) {
    console.log('👁️ Message read:', msg.read.mid);
  }

  // Postback (icebreaker, CTA button)
  if (msg.postback) {
    console.log('🔘 Postback:', {
      title: msg.postback.title,
      payload: msg.postback.payload
    });
  }
}

/**
 * Processa eventi di change (comments, mentions, etc.)
 */
async function processChangeEvent(accountId: string, change: any): Promise<void> {
  console.log('🔄 Change event:', {
    accountId,
    field: change.field
  });

  const { field, value } = change;

  switch (field) {
    case 'comments':
    case 'live_comments':
      console.log('💬 Comment:', {
        commentId: value.id,
        from: value.from?.username,
        text: value.text,
        mediaId: value.media?.id
      });

      // TODO: Implementare gestione commenti
      // - Salvare in DB
      // - Moderazione automatica
      // - Rispondere
      break;

    case 'mentions':
      console.log('📢 Mention:', {
        mediaId: value.media_id,
        commentId: value.comment_id
      });

      // TODO: Implementare gestione mentions
      break;

    case 'story_insights':
      console.log('📊 Story insights:', value);
      // TODO: Salvare metriche
      break;

    default:
      console.log('❓ Unknown field:', field);
  }
}

export default router;