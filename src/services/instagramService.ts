import axios from 'axios';

const INSTAGRAM_OAUTH_URL = 'https://www.instagram.com/oauth';
const INSTAGRAM_API_TOKEN_URL = 'https://api.instagram.com/oauth/access_token';
const GRAPH_INSTAGRAM_BASE_URL = 'https://graph.instagram.com';
const GRAPH_BASE = process.env.GRAPH_INSTAGRAM_BASE_URL || 'https://graph.instagram.com';
const API_VERSION = process.env.GRAPH_INSTAGRAM_VERSION || 'v23.0';

interface CreateContainerParams {
  location_id?: string;
  cover_url?: string;
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

interface ContainerStatus {
  status_code: 'EXPIRED' | 'ERROR' | 'FINISHED' | 'IN_PROGRESS' | 'PUBLISHED';
  error_message?: string;
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

  async refreshLongLivedToken(accessToken: string): Promise<LongLivedTokenResponse> {
    try {
      const response = await axios.get<LongLivedTokenResponse>(
        `${GRAPH_INSTAGRAM_BASE_URL}/refresh_access_token`,
        {
          params: {
            grant_type: 'ig_refresh_token',
            access_token: accessToken,
          },
        }
      );

      if (!response.data.access_token) {
        throw new Error('Token refresh fallito');
      }

      console.log('✅ Token refreshed, valido per altri 60 giorni');
      return response.data;
    } catch (error) {
      this.handleInstagramError(error, 'Errore refresh token');
      throw error;
    }
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
  // ==========================================
  // CONTENT PUBLISHING
  // ==========================================

  /**
   * Step 1: Crea un media container
   */
  async createMediaContainer(params: CreateContainerParams): Promise<string> {
    const { instagram_account_id, access_token, ...mediaParams } = params;
    
    const endpoint = `${GRAPH_BASE}/${API_VERSION}/${instagram_account_id}/media`;
    
    console.log('📦 Creating media container:', {
      accountId: instagram_account_id,
      mediaType: mediaParams.media_type || 'IMAGE'
    });
    
    try {
      const response = await axios.post(endpoint, null, {
        params: {
          ...mediaParams,
          access_token,
        }
      });
      
      if (!response.data.id) {
        throw new Error('Container ID non ricevuto da Instagram');
      }
      
      console.log('✅ Container creato:', response.data.id);
      return response.data.id;
    } catch (error) {
      this.handleInstagramError(error, 'Errore creazione container');
      throw error;
    }
  }

  /**
   * Step 2: Pubblica il container
   */
  async publishMedia(
    instagram_account_id: string,
    container_id: string,
    access_token: string
  ): Promise<PublishResponse> {
    const endpoint = `${GRAPH_BASE}/${API_VERSION}/${instagram_account_id}/media_publish`;
    
    console.log('📤 Publishing container:', container_id);
    
    try {
      const response = await axios.post(endpoint, null, {
        params: {
          creation_id: container_id,
          access_token,
        }
      });
      
      if (!response.data.id) {
        throw new Error('Media ID non ricevuto dopo pubblicazione');
      }
      
      console.log('✅ Media pubblicato con ID:', response.data.id);
      return response.data;
    } catch (error) {
      this.handleInstagramError(error, 'Errore pubblicazione media');
      throw error;
    }
  }

  /**
   * Verifica status del container
   */
  async checkContainerStatus(
    container_id: string,
    access_token: string
  ): Promise<ContainerStatus> {
    const endpoint = `${GRAPH_BASE}/${API_VERSION}/${container_id}`;
    
    try {
      const response = await axios.get(endpoint, {
        params: {
          fields: 'status_code',
          access_token,
        }
      });
      
      return response.data;
    } catch (error) {
      this.handleInstagramError(error, 'Errore verifica status container');
      throw error;
    }
  }

  /**
   * Helper: Aspetta che il container sia pronto
   */
  private async waitForContainerReady(
    container_id: string,
    access_token: string,
    maxAttempts: number = 10,
    delayMs: number = 2000
  ): Promise<void> {
    for (let i = 0; i < maxAttempts; i++) {
      const status = await this.checkContainerStatus(container_id, access_token);
      
      console.log(`📊 Container status: ${status.status_code} (attempt ${i + 1}/${maxAttempts})`);
      
      if (status.status_code === 'FINISHED') {
        console.log('✅ Container pronto per pubblicazione');
        return;
      }
      
      if (status.status_code === 'ERROR') {
        throw new Error(`Container error: ${status.error_message || 'Unknown error'}`);
      }
      
      if (status.status_code === 'EXPIRED') {
        throw new Error('Container scaduto (non pubblicato entro 24 ore)');
      }
      
      // Aspetta prima del prossimo tentativo
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
    
    throw new Error(`Timeout: container non pronto dopo ${maxAttempts * delayMs / 1000} secondi`);
  }

  /**
   * Helper: Pubblica una singola immagine (flow completo)
   */
  async publishSingleImage(
    instagram_account_id: string,
    image_url: string,
    caption: string,
    access_token: string,
    options?: {
      location_id?: string;
      user_tags?: Array<{ username: string; x?: number; y?: number }>;
    }
  ): Promise<string> {
    console.log('🖼️ Publishing single image');
    
    // Step 1: Crea container
    const containerId = await this.createMediaContainer({
      instagram_account_id,
      image_url,
      caption,
      access_token,
      ...options
    });
    
    // Step 2: Aspetta che sia pronto
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
   * Helper: Pubblica un video (flow completo)
   */
  async publishVideo(
    instagram_account_id: string,
    video_url: string,
    caption: string,
    access_token: string,
    options?: {
      cover_url?: string;
      media_type?: 'VIDEO' | 'REELS';
      location_id?: string;
    }
  ): Promise<string> {
    console.log('🎥 Publishing video');
    
    // Step 1: Crea container
    const containerId = await this.createMediaContainer({
      instagram_account_id,
      video_url,
      caption,
      media_type: options?.media_type || 'VIDEO',
      cover_url: options?.cover_url,
      location_id: options?.location_id,
      access_token,
    });
    
    // Step 2: Aspetta processing (video richiede più tempo)
    console.log('⏳ Video in processing, questo può richiedere alcuni minuti...');
    await this.waitForContainerReady(containerId, access_token, 30, 5000);
    
    // Step 3: Pubblica
    const result = await this.publishMedia(
      instagram_account_id,
      containerId,
      access_token
    );
    
    return result.id;
  }

  /**
   * Helper: Pubblica un carousel (post multipli)
   */
  async publishCarousel(
    instagram_account_id: string,
    items: Array<{ image_url?: string; video_url?: string }>,
    caption: string,
    access_token: string
  ): Promise<string> {
    console.log('🎠 Publishing carousel with', items.length, 'items');
    
    if (items.length < 2 || items.length > 10) {
      throw new Error('Carousel deve contenere tra 2 e 10 items');
    }
    
    // Step 1: Crea container per ogni item
    const childrenIds: string[] = [];
    
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      console.log(`📦 Creating container ${i + 1}/${items.length}`);
      
      const childId = await this.createMediaContainer({
        instagram_account_id,
        image_url: item.image_url,
        video_url: item.video_url,
        is_carousel_item: true,
        access_token,
      });
      
      childrenIds.push(childId);
    }
    
    // Step 2: Crea carousel container
    console.log('📦 Creating carousel container');
    const carouselId = await this.createMediaContainer({
      instagram_account_id,
      media_type: 'CAROUSEL',
      caption,
      children: childrenIds,
      access_token,
    });
    
    // Step 3: Aspetta che sia pronto
    await this.waitForContainerReady(carouselId, access_token);
    
    // Step 4: Pubblica
    const result = await this.publishMedia(
      instagram_account_id,
      carouselId,
      access_token
    );
    
    return result.id;
  }

  // ==========================================
  // RATE LIMITING & INSIGHTS
  // ==========================================

  /**
   * Verifica il rate limit di pubblicazione (100 post/24h)
   */
  async checkPublishingLimit(
    instagram_account_id: string,
    access_token: string
  ): Promise<{ quota_usage: number; config: { quota_total: number; quota_duration: number } }> {
    const endpoint = `${GRAPH_BASE}/${API_VERSION}/${instagram_account_id}/content_publishing_limit`;
    
    try {
      const response = await axios.get(endpoint, {
        params: {
          fields: 'quota_usage,config',
          access_token,
        }
      });
      
      console.log('📊 Publishing rate limit:', {
        used: response.data.data[0].quota_usage,
        total: response.data.data[0].config.quota_total,
        remaining: response.data.data[0].config.quota_total - response.data.data[0].quota_usage
      });
      
      return response.data.data[0];
    } catch (error) {
      this.handleInstagramError(error, 'Errore verifica rate limit');
      throw error;
    }
  }

  // ==========================================
  // ERROR HANDLING
  // ==========================================

  /**
   * Gestisce errori specifici di Instagram API
   */
  private handleInstagramError(error: any, context: string): void {
    if (axios.isAxiosError(error)) {
      const status = error.response?.status;
      const data = error.response?.data;
      
      console.error(`❌ ${context}:`, {
        status,
        error: data?.error,
        message: data?.error?.message,
        type: data?.error?.type,
        code: data?.error?.code,
        error_subcode: data?.error?.error_subcode
      });

      // Errori comuni
      if (status === 400) {
        if (data?.error?.code === 100) {
          throw new Error('Parametri richiesta non validi');
        }
        if (data?.error?.error_subcode === 2207026) {
          throw new Error('Media URL non accessibile o formato non supportato');
        }
      }
      
      if (status === 401) {
        throw new Error('Access token non valido o scaduto');
      }
      
      if (status === 403) {
        throw new Error('Permessi insufficienti per questa operazione');
      }
      
      if (status === 429) {
        throw new Error('Rate limit superato, riprova più tardi');
      }
      
      if (status === 500) {
        throw new Error('Errore interno di Instagram, riprova più tardi');
      }
    }
    
    console.error(`❌ ${context}:`, error);
  }
}

export const instagramService = new InstagramService();