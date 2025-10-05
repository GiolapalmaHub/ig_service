// src/controllers/instagramController.ts
import type { Request, Response } from 'express';
import { instagramService } from '../services/instagramService';
import { createSecureState, verifySecureState } from '../utils/stateHelper';

export const redirectToInstagramAuth = (req: Request, res: Response) => {
  try {
    const rawUserId = req.query['userId'];
    const rawPage = req.query['state'];

    if (!rawUserId || Array.isArray(rawUserId) || typeof rawUserId !== 'string') {
      return res.status(400).json({ error: 'userId richiesto' });
    }

    const userId = rawUserId;

    let page: string;
    if (rawPage === undefined) {
      page = 'dashboard';
    } else if (Array.isArray(rawPage) || typeof rawPage !== 'string') {
      return res.status(400).json({ error: 'state parameter invalido' });
    } else {
      page = rawPage;
    }

    // Crea state con expiry di 10 minuti (default)
    const { state, nonce } = createSecureState(userId, page);
    
    // Salva nonce in cookie sicuro
    res.cookie('oauth_nonce', nonce, {
      httpOnly: true,
      signed: true,
      maxAge: 10 * 60 * 1000, // 10 minuti
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/api/v1/instagram',
    });
    
    const host = req.get('host');
    const protocol = req.protocol;
    const redirectUri = `${protocol}://${host}/api/v1/instagram/auth/callback`;
    const authUrl = instagramService.getInstagramAuthUrl(redirectUri, state);
    
    console.log('🚀 OAuth avviato - User:', userId);
    res.redirect(authUrl);
    
  } catch (error) {
    console.error('❌ Errore OAuth start:', error);
    res.status(500).json({
      error: 'Errore avvio OAuth',
      message: error instanceof Error ? error.message : 'Unknown',
    });
  }
};

export const handleIntagramCallback = async (req: Request, res: Response) => {
  try {
    const code = req.query['code'];
    const receivedState = req.query['state'];
    const error = req.query['error'];
    
    // Utente ha negato l'autorizzazione
    if (error) {
      throw new Error(`OAuth error: ${error}`);
    }
    
    if (!code || Array.isArray(code) || typeof code !== 'string') {
      throw new Error('Authorization code mancante');
    }
    
    if (!receivedState || Array.isArray(receivedState) || typeof receivedState !== 'string') {
      throw new Error('State parameter mancante');
    }
    
    // Recupera nonce dal cookie
    const storedNonce = req.signedCookies.oauth_nonce;
    if (!storedNonce || typeof storedNonce !== 'string') {
      throw new Error('Nonce mancante - possibile CSRF');
    }
    
    // Verifica state con nonce
    const verification = verifySecureState(receivedState, storedNonce);
    
    if (!verification.valid) {
      console.error('❌ State invalido:', verification.reason);
      throw new Error(`Verifica fallita: ${verification.reason}`);
    }
    
    console.log('✅ State verificato - User:', verification.data!.userId);
    
    // Rimuovi nonce (one-time use)
    res.clearCookie('oauth_nonce', {
      path: '/api/v1/instagram',
    });
    
    // Scambia code per token
    const result = await instagramService.handleAuthCallback(
      code,
      verification.data!.userId
    );
    
    // Redirect a IVOT con successo
    const ivotUrl = process.env.IVOT_FRONTEND_URL || 'https://ivot.com';
    const redirectURL = new URL(`/${verification.data!.page}`, ivotUrl);
    redirectURL.searchParams.append('instagram', 'success');
    redirectURL.searchParams.append('accountId', result.userId);
    
    console.log('🎉 OAuth completato - IG Account:', result.userId);
    res.redirect(redirectURL.toString());
    
  } catch (error) {
    console.error('❌ Errore callback:', error);
    
    const ivotUrl = process.env.IVOT_FRONTEND_URL || 'https://ivot.com';
    const errorURL = new URL('/dashboard', ivotUrl);
    errorURL.searchParams.append('instagram', 'error');
    errorURL.searchParams.append(
      'message',
      error instanceof Error ? error.message : 'Errore sconosciuto'
    );
    
    res.redirect(errorURL.toString());
  }
};

export const verifyWebhook = (req: Request, res: Response) => {
  try {
    const challenge = instagramService.verifyInstagramWebhook(req);
    res.status(200).send(challenge);
  } catch (error) {
    console.error('Errore verifica webhook:', error);
    res.status(403).send('Verifica fallita');
  }
};