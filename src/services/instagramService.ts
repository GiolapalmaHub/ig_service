import type { Request } from 'express';
import axios from 'axios';
import type { ParamsDictionary } from 'express-serve-static-core';
import type { ParsedQs } from 'qs';

const GRAPH_API_BASE_URL = 'https://graph.facebook.com/v20.0';

class InstagramService {
  // get ig auth
  getInstagramAuthUrl(redirectUri: string, state: string): string {
    const params = new URLSearchParams({
      client_id: process.env.INSTAGRAM_APP_ID || '',
      redirect_uri: redirectUri,
      scope: 'instagram_basic,instagram_content_publish,pages_show_list',
      response_type: 'code',
      state,
    });

    return `https://www.facebook.com/v20.0/dialog/oauth?${params.toString()}`;
  }

  private async getInstagramAccountId(accessToken: string): Promise<string> {
    const response = await axios.get(`${GRAPH_API_BASE_URL}/me/accounts`, {
      params: {
        access_token: accessToken,
      },
    });

    const accounts = response.data.data;
    if (!accounts || accounts.length === 0) {
      throw new Error('Nessun account Instagram trovato per l\'utente.');
    }

    const instagramAccount = accounts.find((account: any) => account.instagram_business_account);
    if (!instagramAccount) {
      throw new Error('Nessun account Instagram Business trovato.');
    }

    return instagramAccount.instagram_business_account.id;
  }

  async handleAuthCallback(code: string, ivotUserId: string) {
    const tokenResponse = await axios.get(`${GRAPH_API_BASE_URL}/oauth/access_token`, {
      params: {
        client_id: process.env.INSTAGRAM_APP_ID,
        client_secret: process.env.INSTAGRAM_APP_SECRET,
        redirect_uri: process.env.INSTAGRAM_REDIRECT_URI,
        code,
      },
    });

    const accessToken = tokenResponse.data.access_token;
    console.log('Access Token ricevuto:', accessToken);
    if (!accessToken) {
      throw new Error('Access token non ricevuto da Instagram.');
    }

    const longLivedTokenResponse = await axios.get(`${GRAPH_API_BASE_URL}/oauth/access_token`, {
      params: {
        grant_type: 'fb_exchange_token',
        client_id: process.env.INSTAGRAM_APP_ID,
        client_secret: process.env.INSTAGRAM_APP_SECRET,
        fb_exchange_token: accessToken,
      },
    });

    const longLivedAccessToken = longLivedTokenResponse.data.access_token;
    console.log('Long-Lived Access Token ricevuto:', longLivedAccessToken);
    if (!longLivedAccessToken) {
      throw new Error('Long-lived access token non ricevuto da Instagram.');
    }

    const accountID = await this.getInstagramAccountId(longLivedAccessToken);
    console.log('Instagram Account ID:', accountID);

    return { accessToken: longLivedAccessToken, userId: accountID };
  }
  
  // Funzione per verificare il webhook di Instagram
  verifyInstagramWebhook(req: Request): string {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];


    // Example logic: return challenge if mode and token are present, otherwise return an empty string
    if (mode && token) {
        if (mode === 'subscribe' && token === process.env.VERIFY_TOKEN) {
            console.log('WEBHOOK_VERIFIED');
            return challenge as string;
        } else {
            throw new Error('Token di verifica non valido.');
        }
    }
    throw new Error('Parametri mancanti.');
  }
}

export const instagramService = new InstagramService();

