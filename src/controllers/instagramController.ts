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
    
    if (!userId || !callbackUrl) {
      return res.status(400).json({ error: 'Missing required parameters' });
    }
    
    console.log('🚀 OAuth flow started');
    console.log('   User ID:', userId);
    console.log('   Callback URL:', callbackUrl);
    
    const payload = JSON.stringify({ userId, callbackUrl, state });
    const { state: secureState, nonce } = createSecureState(payload, state);
    
    // ✅ FIX: Rimuovi path restriction
    res.cookie('oauth_nonce', nonce, {
      httpOnly: true,
      signed: true,
      maxAge: 10 * 60 * 1000,
      sameSite: 'none', // ← Cambiato da lax
      secure: true,     // ← Obbligatorio con sameSite=none
    });
    
    console.log('🔑 Cookie settato:', nonce.substring(0, 10) + '...');
    
    const redirectUri = process.env.INSTAGRAM_REDIRECT_URI!;
    const authUrl = instagramService.getAuthorizationUrl(redirectUri, secureState);
    
    res.redirect(authUrl);
    
  } catch (error) {
    console.error('❌ Error in startAuth:', error);
    res.status(500).json({
      error: 'Failed to start OAuth flow',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
};

export const handleCallback = async (req: Request, res: Response) => {
  try {
    console.log('📥 OAuth callback received');
    console.log('   All cookies:', req.cookies);
    console.log('   Signed cookies:', req.signedCookies);
    
    const code = req.query['code'] as string;
    const receivedState = req.query['state'] as string;
    
    if (!code || !receivedState) {
      throw new Error('Code or state missing');
    }
    
    const storedNonce = req.signedCookies.oauth_nonce;
    
    console.log('🔑 Nonce from cookie:', storedNonce ? 'Found' : 'MISSING');
    
    if (!storedNonce) {
      throw new Error('Nonce missing - possible CSRF attack');
    }
    
    const verification = verifySecureState(receivedState, storedNonce);
    
    if (!verification.valid) {
      throw new Error(`CSRF verification failed: ${verification.reason}`);
    }
    
    res.clearCookie('oauth_nonce');
    
    const payload = JSON.parse(verification.data!.userId);
    const { userId, callbackUrl } = payload;
    
    const authData = await instagramService.exchangeCodeForAuth(code);
    
    const redirectUrl = new URL(callbackUrl);
    redirectUrl.searchParams.append('success', 'true');
    redirectUrl.searchParams.append('instagramUserId', authData.userId);
    redirectUrl.searchParams.append('instagramUsername', authData.username);
    redirectUrl.searchParams.append('accessToken', authData.accessToken);
    
    console.log('✅ Redirecting to:', redirectUrl.toString());
    
    res.redirect(redirectUrl.toString());
    
  } catch (error) {
    console.error('❌ Error:', error);
    res.redirect(`http://localhost:5173?error=${encodeURIComponent(error instanceof Error ? error.message : 'Unknown')}`);
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