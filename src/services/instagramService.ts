import axios from 'axios';

const INSTAGRAM_OAUTH_URL = 'https://www.instagram.com/oauth';
const INSTAGRAM_API_TOKEN_URL = 'https://api.instagram.com/oauth/access_token';
const GRAPH_INSTAGRAM_BASE_URL = 'https://graph.instagram.com';

interface TokenResponse {
  access_token: string;
  user_id: number;
  permissions?: string;
}

interface LongLivedTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

interface UserInfo {
  user_id: string;
  username: string;
  account_type?: string;
  media_count?: number;
}

export interface InstagramAuthData {
  accessToken: string;
  userId: string;
  username: string;
  accountType?: string;
  expiresIn: number;
  expiresAt: string;
}

class InstagramService {
  /**
   * Genera URL di autorizzazione Instagram
   */
  getAuthorizationUrl(redirectUri: string, state: string): string {
    const params = new URLSearchParams({
      client_id: process.env.INSTAGRAM_APP_ID || '',
      redirect_uri: redirectUri,
      scope: [
        'instagram_business_basic',
        'instagram_business_content_publish',
        'instagram_business_manage_comments',
        'instagram_business_manage_messages'
      ].join(','),
      response_type: 'code',
      state,
    });

    return `${INSTAGRAM_OAUTH_URL}/authorize?${params.toString()}`;
  }

  /**
   * Scambia authorization code per access token e ottiene info utente
   */
  async exchangeCodeForAuth(code: string): Promise<InstagramAuthData> {
    console.log('🔄 Scambio authorization code per access token');
    
    // Step 1: Ottieni short-lived token
    const shortLivedToken = await this.exchangeCodeForToken(code);
    console.log('✅ Short-lived token ottenuto');
    
    // Step 2: Scambia per long-lived token (60 giorni)
    const longLivedToken = await this.exchangeForLongLivedToken(
      shortLivedToken.access_token
    );
    console.log('✅ Long-lived token ottenuto (valido 60 giorni)');
    
    // Step 3: Ottieni informazioni utente
    const userInfo = await this.getUserInfo(longLivedToken.access_token);
    console.log('✅ Informazioni utente ottenute');
    
    // Calcola data di scadenza
    const expiresAt = new Date(
      Date.now() + longLivedToken.expires_in * 1000
    ).toISOString();
    
    return {
      accessToken: longLivedToken.access_token,
      userId: userInfo.user_id,
      username: userInfo.username,
      accountType: userInfo.account_type,
      expiresIn: longLivedToken.expires_in,
      expiresAt,
    };
  }

  /**
   * Scambia code per short-lived token
   */
  private async exchangeCodeForToken(code: string): Promise<TokenResponse> {
    const formData = new URLSearchParams({
      client_id: process.env.INSTAGRAM_APP_ID!,
      client_secret: process.env.INSTAGRAM_APP_SECRET!,
      grant_type: 'authorization_code',
      redirect_uri: process.env.INSTAGRAM_REDIRECT_URI!,
      code,
    });

    const response = await axios.post<TokenResponse>(
      INSTAGRAM_API_TOKEN_URL,
      formData.toString(),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      }
    );

    if (!response.data.access_token || !response.data.user_id) {
      throw new Error('Access token o user_id non ricevuto');
    }

    return response.data;
  }

  /**
   * Scambia short-lived per long-lived token
   */
  private async exchangeForLongLivedToken(
    shortLivedToken: string
  ): Promise<LongLivedTokenResponse> {
    const response = await axios.get<LongLivedTokenResponse>(
      `${GRAPH_INSTAGRAM_BASE_URL}/access_token`,
      {
        params: {
          grant_type: 'ig_exchange_token',
          client_secret: process.env.INSTAGRAM_APP_SECRET,
          access_token: shortLivedToken,
        },
      }
    );

    if (!response.data.access_token) {
      throw new Error('Long-lived access token non ricevuto');
    }

    return response.data;
  }

  /**
   * Ottieni informazioni utente Instagram
   */
  private async getUserInfo(accessToken: string): Promise<UserInfo> {
    const response = await axios.get(`${GRAPH_INSTAGRAM_BASE_URL}/me`, {
      params: {
        fields: 'user_id,username,account_type,media_count',
        access_token: accessToken,
      },
    });

    return response.data;
  }
}

export const instagramService = new InstagramService();