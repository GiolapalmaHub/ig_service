import axios from 'axios';

const INSTAGRAM_OAUTH_URL = 'https://www.instagram.com/oauth';
const INSTAGRAM_API_TOKEN_URL = 'https://api.instagram.com/oauth/access_token';
const GRAPH_INSTAGRAM_BASE_URL = 'https://graph.instagram.com';
const GRAPH_BASE = process.env.GRAPH_INSTAGRAM_BASE_URL || 'https://graph.instagram.com';
const API_VERSION = process.env.GRAPH_INSTAGRAM_VERSION || 'v23.0';

interface CreateContainerParams {
  image_url?: string;
  video_url?: string;
  caption?: string;
  media_type?: 'IMAGE' | 'VIDEO' | 'REELS' | 'CAROUSEL';
  is_carousel_item?: boolean;
  children?: string[]; // Per carousel
  access_token: string;
  instagram_account_id: string;
}

interface PublishResponse {
  id: string; // Instagram Media ID del post pubblicato
}



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

    /**
   * Step 1: Crea un media container
   */
  async createMediaContainer(params: CreateContainerParams): Promise<string> {
    const { instagram_account_id, access_token, ...mediaParams } = params;
    
    const endpoint = `${GRAPH_BASE}/${API_VERSION}/${instagram_account_id}/media`;
    
    console.log('Creating media container for account:', instagram_account_id);
    
    const response = await axios.post(endpoint, null, {
      params: {
        ...mediaParams,
        access_token,
      }
    });
    
    if (!response.data.id) {
      throw new Error('Container ID non ricevuto da Instagram');
    }
    
    console.log('Container creato:', response.data.id);
    return response.data.id; // Container ID
  }

  async publishMedia(
    instagram_account_id: string,
    container_id: string,
    access_token: string
  ): Promise<PublishResponse> {
    const endpoint = `${GRAPH_BASE}/${API_VERSION}/${instagram_account_id}/media_publish`;
    
    console.log('Publishing container:', container_id);
    
    const response = await axios.post(endpoint, null, {
      params: {
        creation_id: container_id,
        access_token,
      }
    });
    
    if (!response.data.id) {
      throw new Error('Media ID non ricevuto dopo pubblicazione');
    }
    
    console.log('Media pubblicato con ID:', response.data.id);
    return response.data;
  }
  /**
   * Verifica status del container prima di pubblicare
   */
  async checkContainerStatus(
    container_id: string,
    access_token: string
  ): Promise<string> {
    const endpoint = `${GRAPH_BASE}/${API_VERSION}/${container_id}`;
    
    const response = await axios.get(endpoint, {
      params: {
        fields: 'status_code',
        access_token,
      }
    });
    
    return response.data.status_code; // FINISHED, IN_PROGRESS, ERROR, EXPIRED
  }
  
  /**
   * Helper: Pubblica una singola immagine (completo)
   */
  async publishSingleImage(
    instagram_account_id: string,
    image_url: string,
    caption: string,
    access_token: string
  ): Promise<string> {
    // Step 1: Crea container
    const containerId = await this.createMediaContainer({
      instagram_account_id,
      image_url,
      caption,
      access_token,
    });
    
    // Step 2: Aspetta che sia pronto (opzionale ma consigliato)
    await this.waitForContainerReady(containerId, access_token);
    
    // Step 3: Pubblica
    const result = await this.publishMedia(
      instagram_account_id,
      containerId,
      access_token
    );
    
    return result.id;
  }
  
  /**
   * Helper: Aspetta che il container sia pronto
   */
  private async waitForContainerReady(
    container_id: string,
    access_token: string,
    maxAttempts: number = 10
  ): Promise<void> {
    for (let i = 0; i < maxAttempts; i++) {
      const status = await this.checkContainerStatus(container_id, access_token);
      
      if (status === 'FINISHED') {
        console.log('Container pronto per pubblicazione');
        return;
      }
      
      if (status === 'ERROR' || status === 'EXPIRED') {
        throw new Error(`Container in stato ${status}`);
      }
      
      console.log(`Container status: ${status}, attendo...`);
      await new Promise(resolve => setTimeout(resolve, 2000)); // Aspetta 2 secondi
    }
    
    throw new Error('Timeout: container non pronto dopo 20 secondi');
  }

}

export const instagramService = new InstagramService();