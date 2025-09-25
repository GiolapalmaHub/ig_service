import type { Request, Response } from 'express';
// Assicurati che il percorso dell'import sia corretto
import { instagramService } from '../services/instagramService';

export const redirectToInstagramAuth = (req: Request, res: Response) => {
  // Determine state from query or use a default page
  const stateParam = req.query['state'] || 'dashboard';
  if (Array.isArray(stateParam)) {
    res.status(400).send('Invalid state parameter');
    return;
  }
  const state = stateParam as string;

  // Build the redirect URI that Instagram will call back to
  const host = req.get('host') || 'localhost';
  const protocol = req.protocol || 'https';
  const redirectUri = new URL('/api/instagram/callback', `${protocol}://${host}`).toString();

  const authUrl = instagramService.getInstagramAuthUrl(redirectUri, state);
  res.redirect(authUrl);
};
export const handleIntagramCallback = async (req: Request, res: Response) => {
  try {
    // Logica per gestire il callback di Instagram
    console.log('Ricevuto callback di Instagram:', req.query);
    const cose = req.query['code'];
    console.log('code:', cose);
    if (!cose) {
      throw new Error('Codice di autorizzazione mancante nel callback di Instagram.');
    }

    // pagina dell'url di redirect presi dalla query
    const redirectPage = req.query['state'] || 'dashboard';
    if (Array.isArray(redirectPage)) {
      throw new Error('Parametro di stato non valido.');
    }
    console.log('redirectPage:', redirectPage);
    
    
    // TODO: associa l'utente Instagram con il tuo sistema utilizzando il codice ricevuto
    const ivotUserId = 'id-' //! da fare

    const result =  await instagramService.handleAuthCallback(cose as string, ivotUserId);
    if (!result) {
      throw new Error('Errore durante la gestione del callback di Instagram.');
    }
    console.log('Risultato della gestione del callback di Instagram:', result);
    // Redirect to frontend; stop further processing after redirect

    const redirectURL = new URL(`/${redirectPage}`, `https://${req.get('host')}`);
    redirectURL.searchParams.append('token', result.accessToken);
    redirectURL.searchParams.append('userId', ivotUserId);
    redirectURL.searchParams.append('accountId', result.userId);
    redirectURL.searchParams.append('instagram', 'success');


    res.redirect(redirectURL.toString());
    return;
  } catch (error) {
    console.error('Errore nel callback di Instagram:', error);
    // Redirect to frontend with error; stop further processing after redirect
    const redirectURL = new URL(`/error`, `https://${req.get('host')}`);
    redirectURL.searchParams.append('instagram', 'error');
    res.redirect(redirectURL.toString());
    return;
  }
   
};

export const verifyWebhook = (req: Request, res: Response) => {
  try {
    // Ho rinominato la funzione nel service per coerenza, vedi sotto
    const challenge = instagramService.verifyInstagramWebhook(req);
    res.status(200).send(challenge);
  } catch (error) {
    console.error("Errore nella verifica del webhook:", error);
    res.status(403).send('Verifica fallita.');
  }
};