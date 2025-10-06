import type { Request, Response } from 'express';
import { instagramService } from '../services/instagramService.js';
import { createSecureState, verifySecureState } from '../utils/stateHelper.js';

/**
 * GET /auth/url
 * 
 * Query params:
 * - userId: ID dell'utente nel sistema client
 * - callbackUrl: URL dove reindirizzare con i risultati
 * - state (optional): stato da preservare (es. 'dashboard', 'settings')
 */
export const startAuth = (req: Request, res: Response) => {
  try {
    const userId = req.query['userId'] as string;
    const callbackUrl = req.query['callbackUrl'] as string;
    const state = (req.query['state'] as string) || 'default';
    
    // Validazione
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
    
    // Crea state sicuro con userId, callbackUrl e state
    const payload = JSON.stringify({ userId, callbackUrl, state });
    const { state: secureState, nonce } = createSecureState(payload, state);
    
    // Salva nonce in cookie
    res.cookie('oauth_nonce', nonce, {
      httpOnly: true,
      signed: true,
      maxAge: 10 * 60 * 1000, // 10 minuti
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/auth',
    });
    
    // Costruisci redirect URI (del microservizio)
    const host = req.get('host');
    const protocol = req.protocol;
    const redirectUri = `${protocol}://${host}/auth/callback`;
    
    // Genera URL di autorizzazione Instagram
    const authUrl = instagramService.getAuthorizationUrl(redirectUri, secureState);
    
    console.log('🔗 Redirecting to Instagram OAuth');
    
    // Redirect a Instagram
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
 * GET /auth/callback
 * 
 * Riceve il callback da Instagram con code e state
 */
export const handleCallback = async (req: Request, res: Response) => {
  try {
    console.log('📥 OAuth callback received');
    
    const code = req.query['code'] as string;
    const receivedState = req.query['state'] as string;
    const error = req.query['error'] as string;
    const errorDescription = req.query['error_description'] as string;
    
    // Gestione errori OAuth
    if (error) {
      console.error('❌ OAuth error:', error, errorDescription);
      
      // Estrai callbackUrl dallo state (se possibile)
      let callbackUrl = process.env.DEFAULT_CALLBACK_URL || '/';
      
      try {
        const storedNonce = req.signedCookies.oauth_nonce;
        if (storedNonce && receivedState) {
          const verification = verifySecureState(receivedState, storedNonce);
          if (verification.valid && verification.data) {
            const payload = JSON.parse(verification.data.userId);
            callbackUrl = payload.callbackUrl;
          }
        }
      } catch (e) {
        // Ignora errori nella decodifica
      }
      
      const errorUrl = new URL(callbackUrl);
      errorUrl.searchParams.append('error', error);
      errorUrl.searchParams.append('error_description', errorDescription || 'OAuth error');
      
      return res.redirect(errorUrl.toString());
    }
    
    // Validazione
    if (!code) {
      throw new Error('Authorization code missing');
    }
    
    if (!receivedState) {
      throw new Error('State parameter missing');
    }
    
    // Recupera nonce
    const storedNonce = req.signedCookies.oauth_nonce;
    if (!storedNonce) {
      throw new Error('Nonce missing - possible CSRF attack');
    }
    
    // Verifica state (CSRF protection)
    console.log('🔒 Verifying state (CSRF protection)');
    const verification = verifySecureState(receivedState, storedNonce);
    
    if (!verification.valid) {
      console.error('❌ State verification failed:', verification.reason);
      throw new Error(`CSRF verification failed: ${verification.reason}`);
    }
    
    console.log('✅ State verified successfully');
    
    // Rimuovi nonce (one-time use)
    res.clearCookie('oauth_nonce', { path: '/auth' });
    
    // Decodifica payload dallo state
    const payload = JSON.parse(verification.data!.userId);
    const { userId, callbackUrl, state } = payload;
    
    console.log('👤 User ID:', userId);
    console.log('🔗 Callback URL:', callbackUrl);
    
    // Scambia code per token e ottieni dati
    console.log('🔄 Exchanging code for access token');
    const authData = await instagramService.exchangeCodeForAuth(code);
    
    console.log('✅ Instagram authentication successful');
    console.log('   Instagram User ID:', authData.userId);
    console.log('   Username:', authData.username);
    
    // Costruisci URL di callback con tutti i dati
    const redirectUrl = new URL(callbackUrl);
    redirectUrl.searchParams.append('success', 'true');
    redirectUrl.searchParams.append('userId', userId);
    redirectUrl.searchParams.append('state', state);
    
    // Aggiungi dati Instagram come parametri
    redirectUrl.searchParams.append('instagramUserId', authData.userId);
    redirectUrl.searchParams.append('instagramUsername', authData.username);
    redirectUrl.searchParams.append('accessToken', authData.accessToken);
    redirectUrl.searchParams.append('expiresIn', authData.expiresIn.toString());
    redirectUrl.searchParams.append('expiresAt', authData.expiresAt);
    
    if (authData.accountType) {
      redirectUrl.searchParams.append('accountType', authData.accountType);
    }
    
    console.log('🎉 Redirecting to client callback with data');
    
    // Redirect al client con tutti i dati
    res.redirect(redirectUrl.toString());
    
  } catch (error) {
    console.error('❌ Error in handleCallback:', error);
    
    // Redirect al client con errore
    const defaultCallbackUrl = process.env.DEFAULT_CALLBACK_URL || '/';
    const errorUrl = new URL(defaultCallbackUrl);
    errorUrl.searchParams.append('success', 'false');
    errorUrl.searchParams.append('error', error instanceof Error ? error.message : 'Unknown error');
    
    res.redirect(errorUrl.toString());
  }
};

/**
 * GET /health
 * Health check endpoint
 */
export const healthCheck = (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    service: 'instagram-oauth-microservice',
    timestamp: new Date().toISOString(),
  });
};