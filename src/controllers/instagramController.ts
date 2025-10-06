import type { Request, Response } from 'express';
import { instagramService } from '../services/instagramService.js';
import { createSecureState, verifySecureState } from '../utils/stateHelper.js';

// ============================================
// OAUTH CONTROLLERS
// ============================================

/**
 * GET /api/v1/instagram/auth/url
 * Inizia il flusso OAuth
 */
export const startAuth = (req: Request, res: Response) => {
  try {
    const userId = req.query['userId'] as string;
    const callbackUrl = req.query['callbackUrl'] as string;
    const state = (req.query['state'] as string) || 'default';
    
    // Validazione parametri
    if (!userId) {
      return res.status(400).json({ 
        error: 'Missing required parameter: userId' 
      });
    }
    
    if (!callbackUrl) {
      return res.status(400).json({ 
        error: 'Missing required parameter: callbackUrl' 
      });
    }
    
    console.log('🚀 OAuth flow started');
    console.log('   User ID:', userId);
    console.log('   Callback URL:', callbackUrl);
    console.log('   State:', state);
    
    // Crea state sicuro con CSRF protection
    const payload = JSON.stringify({ userId, callbackUrl, state });
    const { state: secureState, nonce } = createSecureState(payload, state);
    
    // Salva nonce in cookie firmato
    res.cookie('oauth_nonce', nonce, {
      httpOnly: true,
      signed: true,
      maxAge: 10 * 60 * 1000, // 10 minuti
      sameSite: 'none',
      secure: true,
    });
    
    console.log('🔑 Cookie settato:', nonce.substring(0, 10) + '...');
    
    // Genera URL autorizzazione Instagram
    const redirectUri = process.env.INSTAGRAM_REDIRECT_URI!;
    const authUrl = instagramService.getAuthorizationUrl(redirectUri, secureState);
    
    console.log('🔗 Redirecting to Instagram OAuth');
    
    res.redirect(authUrl);
    
  } catch (error) {
    console.error('❌ Error in startAuth:', error);
    res.status(500).json({
      error: 'Failed to start OAuth flow',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
};

/**
 * GET /api/v1/instagram/auth/callback
 * Callback da Instagram OAuth
 */
export const handleCallback = async (req: Request, res: Response) => {
  try {
    console.log('📥 OAuth callback received');
    console.log('   All cookies:', req.cookies);
    console.log('   Signed cookies:', req.signedCookies);
    
    const code = req.query['code'] as string;
    const receivedState = req.query['state'] as string;
    const error = req.query['error'] as string;
    const errorReason = req.query['error_reason'] as string;
    const errorDescription = req.query['error_description'] as string;
    
    // Gestisci errori OAuth
    if (error) {
      console.error('❌ OAuth error from Instagram:', {
        error,
        errorReason,
        errorDescription
      });
      
      const errorUrl = new URL(process.env.IVOT_FRONTEND_URL || 'http://localhost:5173');
      errorUrl.searchParams.append('success', 'false');
      errorUrl.searchParams.append('error', error);
      errorUrl.searchParams.append('error_reason', errorReason || '');
      errorUrl.searchParams.append('error_description', errorDescription || '');
      
      return res.redirect(errorUrl.toString());
    }
    
    // Validazione parametri
    if (!code) {
      throw new Error('Authorization code missing');
    }
    
    if (!receivedState) {
      throw new Error('State parameter missing');
    }
    
    // CSRF verification
    const storedNonce = req.signedCookies.oauth_nonce;
    
    console.log('🔑 Nonce from cookie:', storedNonce ? 'Found' : 'MISSING');
    
    if (!storedNonce) {
      throw new Error('Nonce missing - possible CSRF attack');
    }
    
    console.log('🔒 Verifying state (CSRF protection)');
    const verification = verifySecureState(receivedState, storedNonce);
    
    if (!verification.valid) {
      console.error('❌ State verification failed:', verification.reason);
      throw new Error(`CSRF verification failed: ${verification.reason}`);
    }
    
    console.log('✅ State verified successfully');
    
    // Pulisci cookie
    res.clearCookie('oauth_nonce');
    
    // Estrai payload
    const payload = JSON.parse(verification.data!.userId);
    const { userId, callbackUrl, state } = payload;
    
    console.log('👤 User ID:', userId);
    console.log('🔗 Callback URL:', callbackUrl);
    
    // Scambia code per access token
    console.log('🔄 Exchanging code for access token');
    const authData = await instagramService.exchangeCodeForAuth(code);
    
    console.log('✅ Instagram authentication successful');
    console.log('   Instagram User ID:', authData.userId);
    console.log('   Username:', authData.username);
    console.log('   Account Type:', authData.accountType);
    console.log('   Expires in:', authData.expiresIn, 'seconds');
    
    // TODO: Salvare token in database
    // await saveTokenToDatabase(userId, authData);
    
    // Costruisci URL di redirect
    let redirectUrl: URL;
    try {
      redirectUrl = new URL(callbackUrl);
    } catch {
      // Fallback se callbackUrl non valido
      redirectUrl = new URL(process.env.IVOT_FRONTEND_URL || 'http://localhost:5173');
    }
    
    // Aggiungi parametri
    redirectUrl.searchParams.append('success', 'true');
    redirectUrl.searchParams.append('userId', userId);
    redirectUrl.searchParams.append('state', state);
    redirectUrl.searchParams.append('instagramUserId', authData.userId);
    redirectUrl.searchParams.append('instagramUsername', authData.username);
    redirectUrl.searchParams.append('accessToken', authData.accessToken);
    redirectUrl.searchParams.append('expiresIn', authData.expiresIn.toString());
    redirectUrl.searchParams.append('expiresAt', authData.expiresAt);
    
    if (authData.accountType) {
      redirectUrl.searchParams.append('accountType', authData.accountType);
    }
    
    console.log('🎉 Redirecting to client callback with data');
    
    res.redirect(redirectUrl.toString());
    
  } catch (error) {
    console.error('❌ Error in handleCallback:', error);
    
    // Redirect con errore
    const defaultCallbackUrl = process.env.IVOT_FRONTEND_URL || 'http://localhost:5173';
    const errorUrl = new URL(defaultCallbackUrl);
    errorUrl.searchParams.append('success', 'false');
    errorUrl.searchParams.append('error', error instanceof Error ? error.message : 'Unknown error');
    
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
    const { 
      instagram_account_id, 
      access_token, 
      video_url, 
      caption, 
      cover_url,
      media_type,
      location_id 
    } = req.body;
    
    // Validazione
    if (!instagram_account_id || !access_token || !video_url) {
      return res.status(400).json({
        error: 'Parametri mancanti',
        required: ['instagram_account_id', 'access_token', 'video_url']
      });
    }
    
    // Validazione URL
    try {
      new URL(video_url);
      if (cover_url) new URL(cover_url);
    } catch {
      return res.status(400).json({
        error: 'URL non valido',
        message: 'video_url (e cover_url se fornito) devono essere URL completi'
      });
    }
    
    console.log('🎥 Publishing video to Instagram account:', instagram_account_id);
    console.log('   Media type:', media_type || 'VIDEO');
    
    // Verifica rate limit
    try {
      const rateLimit = await instagramService.checkPublishingLimit(
        instagram_account_id,
        access_token
      );
      
      if (rateLimit.quota_usage >= rateLimit.config.quota_total) {
        return res.status(429).json({
          error: 'Rate limit raggiunto',
          message: 'Hai raggiunto il limite di 100 post nelle ultime 24 ore'
        });
      }
    } catch (error) {
      console.warn('⚠️ Impossibile verificare rate limit');
    }
    
    // Pubblica video
    const mediaId = await instagramService.publishVideo(
      instagram_account_id,
      video_url,
      caption || '',
      access_token,
      { 
        cover_url, 
        media_type: media_type === 'REELS' ? 'REELS' : 'VIDEO',
        location_id 
      }
    );
    
    res.status(200).json({
      success: true,
      media_id: mediaId,
      message: media_type === 'REELS' ? 'Reel pubblicato con successo' : 'Video pubblicato con successo',
      instagram_url: `https://www.instagram.com/p/${mediaId}/`
    });
    
  } catch (error) {
    console.error('❌ Errore pubblicazione video:', error);
    
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