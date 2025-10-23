import type { Request, Response } from 'express';
import { instagramService } from '../services/instagramService.js';
import { createSecureState, verifySecureState } from '../utils/stateHelper.js';
import axios from 'axios';

// ============================================
// OAUTH CONTROLLERS
// ============================================

/**
 * GET /api/v1/instagram/auth/url
 * Inizia il flusso OAuth
 */
// microservizio/src/controllers/instagramController.ts


export const startAuth = (req: Request, res: Response) => {
  try {
    const userId = req.query['userId'] as string;
    const callbackUrl = req.query['callbackUrl'] as string;
    const state = req.query['state'] as string || 'default';

    if (!userId || !callbackUrl) {
      return res.status(400).json({ error: 'Parametri mancanti' });
    }

    console.log('🚀 OAuth flow started');
    console.log('   User ID:', userId);
    console.log('   Callback URL:', callbackUrl);

    // ✅ Crea payload JSON
    const payload = JSON.stringify({ userId, callbackUrl, state });
    
    // ✅ Genera state sicuro con firma HMAC
    const { state: secureState, nonce } = createSecureState(payload, state);

    console.log('🔑 Nonce generato:', nonce.substring(0, 10) + '...');

    // ✅ NO cookie! Solo state firmato
    const redirectUri = process.env.INSTAGRAM_REDIRECT_URI!;
    const authUrl = instagramService.getAuthorizationUrl(redirectUri, secureState);

    console.log('🔗 Redirecting to Instagram OAuth');
    res.json({ authUrl });

  } catch (error) {
    console.error('❌ Error:', error);
    res.status(500).json({ error: 'Errore generazione URL' });
  }
};

export const handleCallback = async (req: Request, res: Response) => {
  try {
    console.log('📥 OAuth callback received');

    const code = req.query['code'] as string;
    const receivedState = req.query['state'] as string;
    const error = req.query['error'] as string;

    // Gestisci errori OAuth
    if (error) {
      console.error('❌ OAuth error:', error);
      const errorUrl = new URL(process.env.IVOT_FRONTEND_URL || 'http://localhost:5173');
      errorUrl.searchParams.append('success', 'false');
      errorUrl.searchParams.append('error', error);
      return res.redirect(errorUrl.toString());
    }

    if (!code || !receivedState) {
      throw new Error('Parametri mancanti');
    }

    // ✅ Verifica state con firma HMAC (no cookie!)
    console.log('🔒 Verifying state (CSRF protection)');
    const verification = verifySecureState(receivedState);

    if (!verification.valid) {
      console.error('❌ State verification failed:', verification.reason);
      throw new Error(`CSRF verification failed: ${verification.reason}`);
    }

    console.log('✅ State verified successfully');

    const { userId, callbackUrl, state } = verification.data!;

    console.log('👤 User ID:', userId);
    console.log('🔗 Callback URL:', callbackUrl);

    // Scambia code per token
    console.log('🔄 Exchanging code for access token');
    const authData = await instagramService.exchangeCodeForAuth(code);

    console.log('✅ Instagram authentication successful');
    console.log('   Instagram User ID:', authData.userId);
    console.log(authData.username);

    // ✅ Redirect al backend IVOT con i dati
    const backendUrl = new URL(callbackUrl);
    backendUrl.searchParams.append('access_token', authData.accessToken);
    backendUrl.searchParams.append('platform_user_id', userId)
    backendUrl.searchParams.append('user_id', authData.userId);
    backendUrl.searchParams.append('username', authData.username);
    backendUrl.searchParams.append('expires_in', authData.expiresIn.toString());
    backendUrl.searchParams.append('expires_at', authData.expiresAt);

    if (authData.accountType) {
      backendUrl.searchParams.append('account_type', authData.accountType);
    }

    console.log('🎉 Redirecting to backend callback');

    console.log(backendUrl)
    res.redirect(backendUrl.toString());

  } catch (error) {
    console.error('❌ Error in handleCallback:', error);
    const errorUrl = new URL(process.env.IVOT_FRONTEND_URL || 'http://localhost:5173');
    errorUrl.searchParams.append('success', 'false');
    errorUrl.searchParams.append('error', error instanceof Error ? error.message : 'Unknown');
    res.redirect(errorUrl.toString());
  }
};

// ============================================
// PUBLISHING CONTROLLERS
// ============================================

/**
 * POST /api/v1/instagram/auth/publish/image
 * Pubblica un'immagine su Instagram
 */
export const publishImage = async (req: Request, res: Response) => {
  try {
    const { instagram_account_id, access_token, image_url, caption, location_id, user_tags } = req.body;

    // Validazione
    if (!instagram_account_id || !access_token || !image_url) {
      return res.status(400).json({
        error: 'Parametri mancanti',
        required: ['instagram_account_id', 'access_token', 'image_url'],
        received: Object.keys(req.body)
      });
    }

    // Validazione URL
    try {
      new URL(image_url);
    } catch {
      return res.status(400).json({
        error: 'image_url non valido',
        message: 'Deve essere un URL completo (es: https://example.com/image.jpg)'
      });
    }

    console.log('📸 Publishing image to Instagram account:', instagram_account_id);

    // Verifica rate limit prima di pubblicare
    try {
      const rateLimit = await instagramService.checkPublishingLimit(
        instagram_account_id,
        access_token
      );

      if (rateLimit.quota_usage >= rateLimit.config.quota_total) {
        return res.status(429).json({
          error: 'Rate limit raggiunto',
          message: 'Hai raggiunto il limite di 100 post nelle ultime 24 ore',
          quota_usage: rateLimit.quota_usage,
          quota_total: rateLimit.config.quota_total
        });
      }

      console.log(`📊 Rate limit: ${rateLimit.quota_usage}/${rateLimit.config.quota_total}`);
    } catch (error) {
      console.warn('⚠️ Impossibile verificare rate limit, continuo comunque');
    }

    // Pubblica
    const mediaId = await instagramService.publishSingleImage(
      instagram_account_id,
      image_url,
      caption || '',
      access_token,
      { location_id, user_tags }
    );

    res.status(200).json({
      success: true,
      media_id: mediaId,
      message: 'Immagine pubblicata con successo su Instagram',
      instagram_url: `https://www.instagram.com/p/${mediaId}/`
    });

  } catch (error) {
    console.error('❌ Errore pubblicazione immagine:', error);

    res.status(500).json({
      error: 'Errore durante la pubblicazione',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
};

/**
 * POST /api/v1/instagram/auth/publish/video
 * Pubblica un video su Instagram
 */
export const publishVideo = async (req: Request, res: Response) => {
  try {
    const { instagram_account_id, access_token, video_url, caption } = req.body;
    
    if (!instagram_account_id || !access_token || !video_url) {
      return res.status(400).json({
        error: 'Parametri mancanti',
        required: ['instagram_account_id', 'access_token', 'video_url']
      });
    }
    
    // Step 1: Crea container video
    const containerId = await instagramService.createMediaContainer({
      instagram_account_id,
      video_url,
      caption: caption || '',
      media_type: 'VIDEO',
      access_token,
    });
    
    // Step 2: Aspetta che il video sia processato
    console.log('Video in elaborazione, attendi...');
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    // Step 3: Pubblica
    const result = await instagramService.publishMedia(
      instagram_account_id,
      containerId,
      access_token
    );
    
    res.status(200).json({
      success: true,
      media_id: result.id,
      message: 'Video pubblicato con successo'
    });
    
  } catch (error) {
    console.error('Errore pubblicazione video:', error);
    
    // 🔴 AGGIUNGI QUESTO CONTROLLO
    if (axios.isAxiosError(error)) {
      const fbError = error.response?.data?.error;
      
      // Token scaduto o invalidato
      if (fbError?.code === 190) {
        return res.status(401).json({
          error: 'TOKEN_EXPIRED',
          message: 'Token Instagram scaduto o invalidato. Richiede nuovo login.',
          facebook_error: fbError
        });
      }
      
      // Rate limit
      if (fbError?.code === 4 || fbError?.code === 32) {
        return res.status(429).json({
          error: 'RATE_LIMIT',
          message: 'Rate limit raggiunto. Riprova più tardi.',
          facebook_error: fbError
        });
      }
    }
    
    res.status(500).json({
      error: 'Errore durante la pubblicazione video',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
};
/**
 * POST /api/v1/instagram/auth/publish/carousel
 * Pubblica un carousel (post multipli)
 */
export const publishCarousel = async (req: Request, res: Response) => {
  try {
    const { instagram_account_id, access_token, items, caption } = req.body;

    // Validazione
    if (!instagram_account_id || !access_token || !items) {
      return res.status(400).json({
        error: 'Parametri mancanti',
        required: ['instagram_account_id', 'access_token', 'items']
      });
    }

    if (!Array.isArray(items) || items.length < 2 || items.length > 10) {
      return res.status(400).json({
        error: 'items non valido',
        message: 'items deve essere un array di 2-10 elementi'
      });
    }

    console.log('🎠 Publishing carousel to Instagram account:', instagram_account_id);
    console.log('   Items count:', items.length);

    // Pubblica carousel
    const mediaId = await instagramService.publishCarousel(
      instagram_account_id,
      items,
      caption || '',
      access_token
    );

    res.status(200).json({
      success: true,
      media_id: mediaId,
      message: 'Carousel pubblicato con successo',
      instagram_url: `https://www.instagram.com/p/${mediaId}/`
    });

  } catch (error) {
    console.error('❌ Errore pubblicazione carousel:', error);

    res.status(500).json({
      error: 'Errore durante la pubblicazione carousel',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
};

// ============================================
// UTILITY CONTROLLERS
// ============================================

/**
 * GET /api/v1/instagram/auth/health
 * Health check
 */
export const healthCheck = (req: Request, res: Response) => {
  res.status(200).json({
    status: 'healthy',
    service: 'instagram-oauth-service',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV || 'development',
    version: '1.0.0'
  });
};

/**
 * POST /api/v1/instagram/auth/refresh-token
 * Refresh access token
 */
export const refreshToken = async (req: Request, res: Response) => {
  try {
    const { access_token } = req.body;

    if (!access_token) {
      return res.status(400).json({
        error: 'access_token richiesto'
      });
    }

    console.log('🔄 Refreshing access token');

    const refreshed = await instagramService.refreshLongLivedToken(access_token);

    const expiresAt = new Date(
      Date.now() + refreshed.expires_in * 1000
    ).toISOString();

    res.status(200).json({
      success: true,
      access_token: refreshed.access_token,
      token_type: refreshed.token_type,
      expires_in: refreshed.expires_in,
      expires_at: expiresAt,
      message: 'Token refreshed successfully, valido per altri 60 giorni'
    });

  } catch (error) {
    console.error('❌ Errore refresh token:', error);

    res.status(500).json({
      error: 'Errore durante il refresh del token',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
};

/**
 * GET /api/v1/instagram/auth/rate-limit
 * Verifica rate limit pubblicazione
 */
export const checkRateLimit = async (req: Request, res: Response) => {
  try {
    const { instagram_account_id, access_token } = req.query;

    if (!instagram_account_id || !access_token) {
      return res.status(400).json({
        error: 'Parametri mancanti',
        required: ['instagram_account_id', 'access_token']
      });
    }

    const rateLimit = await instagramService.checkPublishingLimit(
      instagram_account_id as string,
      access_token as string
    );

    const remaining = rateLimit.config.quota_total - rateLimit.quota_usage;
    const percentage = (rateLimit.quota_usage / rateLimit.config.quota_total) * 100;

    res.status(200).json({
      quota_usage: rateLimit.quota_usage,
      quota_total: rateLimit.config.quota_total,
      quota_remaining: remaining,
      usage_percentage: Math.round(percentage),
      limit_reached: remaining === 0,
      warning: percentage > 80 ? 'Attenzione: stai raggiungendo il limite giornaliero' : null
    });

  } catch (error) {
    console.error('❌ Errore verifica rate limit:', error);

    res.status(500).json({
      error: 'Errore durante la verifica del rate limit',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
};