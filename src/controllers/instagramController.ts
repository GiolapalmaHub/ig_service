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

export const publishImg = async (req: Request, res: Response) =>{
  try{
    const { instagram_account_id, access_token, image_url, caption } = req.body;

    if (!instagram_account_id|| !access_token || !image_url){
      return res.status(400).json({
        error: 'Parametri mancanti',
        required: ['instagram_account_id', 'access_token', 'image_url']
      }); 
    }
    console.log('publishing image to Instagram account', instagram_account_id);

    const mediaId = await instagramService.publishSingleImage(
      instagram_account_id,
      image_url, 
      caption || '',
      access_token
    );

    res.status(200).json({
      success: true,
      media_id: mediaId,
      message: 'Post pubblicato con successo su Instagram'
    });
  } catch (error) {
    console.error('Errore pubblicazione:', error);
    res.status(500).json({
      error: 'Errore durante la pubblicazione',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  };
}

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
    
    // Step 2: Aspetta che il video sia processato (può richiedere minuti)
    console.log('Video in elaborazione, attendi...');
    await new Promise(resolve => setTimeout(resolve, 5000)); // Aspetta 5 secondi
    
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
    res.status(500).json({
      error: 'Errore durante la pubblicazione video',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  };
}

