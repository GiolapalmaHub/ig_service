// ============================================
// IVOT NOTIFIER
// Invia notifiche webhook a IVOT backend
// ============================================

import axios from 'axios';

const IVOT_BACKEND_URL = process.env.IVOT_BACKEND_WEBHOOK_URL || 'http://localhost:3000/api/webhooks/instagram';
const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY;

interface IvotMessagePayload {
  // Identificatori
  instagram_account_id: string;
  sender_id: string;
  sender_username?: string;
  conversation_id: string;
  
  // Contenuto
  message: {
    id: string;
    text?: string;
    attachments?: Array<{
      type: string;
      url?: string;
      payload?: any;
    }>;
    timestamp: number;
    type: 'text' | 'image' | 'video' | 'audio' | 'sticker' | 'reaction' | 'story_mention' | 'quick_reply' | 'referral' | 'postback';
  };
  
  // Metadata
  is_echo: boolean;
  is_deleted: boolean;
  is_unsupported: boolean;
  
  // Context
  webhook_event_type: string;
  webhook_received_at: string;
  instagram_webhook_time: number;
}

interface IvotCommentPayload {
  instagram_account_id: string;
  comment_id: string;
  media_id: string;
  from_username: string;
  from_id: string;
  text?: string;
  parent_comment_id?: string;
  webhook_event_type: 'comment' | 'live_comment';
  webhook_received_at: string;
}

export class IvotNotifier {
  /**
   * Invia notifica di messaggio a IVOT
   */
  static async notifyMessage(payload: IvotMessagePayload): Promise<void> {
    try {
      console.log('📤 Sending message to IVOT:', {
        account: payload.instagram_account_id,
        sender: payload.sender_id,
        type: payload.message.type,
        hasText: !!payload.message.text
      });

      const response = await axios.post(
        `${IVOT_BACKEND_URL}/messages`,
        payload,
        {
          headers: {
            'Content-Type': 'application/json',
            'X-Api-Key': INTERNAL_API_KEY,
          },
          timeout: 10000, // 10 secondi
        }
      );

      if (response.status === 200) {
        console.log('✅ Message delivered to IVOT');
      } else {
        console.warn('⚠️ IVOT responded with status:', response.status);
      }
    } catch (error) {
      console.error('❌ Failed to notify IVOT:', {
        error: error instanceof Error ? error.message : 'Unknown',
        account: payload.instagram_account_id,
        messageId: payload.message.id
      });
      
      // Non rilanciare - non vogliamo bloccare il webhook
      // IVOT dovrebbe avere retry logic o fallback
    }
  }

  /**
   * Invia notifica di commento a IVOT
   */
  static async notifyComment(payload: IvotCommentPayload): Promise<void> {
    try {
      console.log('📤 Sending comment to IVOT:', {
        account: payload.instagram_account_id,
        commentId: payload.comment_id,
        mediaId: payload.media_id
      });

      await axios.post(
        `${IVOT_BACKEND_URL}/comments`,
        payload,
        {
          headers: {
            'Content-Type': 'application/json',
            'X-Api-Key': INTERNAL_API_KEY,
          },
          timeout: 10000,
        }
      );

      console.log('✅ Comment delivered to IVOT');
    } catch (error) {
      console.error('❌ Failed to notify IVOT comment:', error);
    }
  }

  /**
   * Invia notifica generica a IVOT (mention, story_insight, ecc.)
   */
  static async notifyGenericEvent(
    eventType: string,
    accountId: string,
    data: any
  ): Promise<void> {
    try {
      console.log(`📤 Sending ${eventType} to IVOT`);

      await axios.post(
        `${IVOT_BACKEND_URL}/events`,
        {
          event_type: eventType,
          instagram_account_id: accountId,
          data,
          received_at: new Date().toISOString()
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'X-Api-Key': INTERNAL_API_KEY,
          },
          timeout: 10000,
        }
      );

      console.log('✅ Event delivered to IVOT');
    } catch (error) {
      console.error('❌ Failed to notify IVOT event:', error);
    }
  }
}