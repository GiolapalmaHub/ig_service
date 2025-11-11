import axios from 'axios';

const IVOT_BACKEND_URL = process.env.IVOT_FRONTEND_URL
const INTERNAL_API_KEY = process.env.ENCRYPTION_KEY;

/**
 * Processa eventi di messaging (Direct Messages)
 */
export async function processMessagingEvent(
  instagramAccountId: string,
  msg: any,
  webhookTime: number
): Promise<void> {
  console.log('[PROCESSOR:MSG] 💬 Processing messaging event');
  console.log('[PROCESSOR:MSG]    Account ID:', instagramAccountId);
  console.log('[PROCESSOR:MSG]    Sender:', msg.sender?.id);
  console.log('[PROCESSOR:MSG]    Recipient:', msg.recipient?.id);
  console.log('[PROCESSOR:MSG]    Timestamp:', msg.timestamp);

  // Message received
  if (msg.message) {
    console.log('[PROCESSOR:MSG] 📨 Message received:', {
      mid: msg.message.mid,
      text: msg.message.text,
      isDeleted: msg.message.is_deleted,
      isEcho: msg.message.is_echo,
      isSelf: msg.message.is_self
    });

    // ✅ Invia al backend IVOT
    try {
      console.log('[PROCESSOR:MSG] 📤 Forwarding to IVOT backend...');
      
      const payload = {
        instagram_account_id: instagramAccountId,
        sender_id: msg.sender.id,
        sender_username: msg.sender.username,
        message: {
          id: msg.message.mid,
          text: msg.message.text,
          timestamp: msg.timestamp
        },
        is_echo: msg.message.is_echo || msg.message.is_self || false
      };

      console.log('[PROCESSOR:MSG]    Payload:', JSON.stringify(payload, null, 2));

      const response = await axios.post(
        `${process.env.IVOT_FRONTEND_URL}/api/webhooks/instagram/messages`,
        payload,
        {
          headers: {
            'X-Api-Key': INTERNAL_API_KEY,
            'Content-Type': 'application/json'
          },
          timeout: 5000
        }
      );

      console.log('[PROCESSOR:MSG] ✅ Forwarded to IVOT backend:', response.status);

    } catch (error) {
      console.error('[PROCESSOR:MSG] ❌ Error forwarding to IVOT:', error);
      
      if (axios.isAxiosError(error)) {
        console.error('[PROCESSOR:MSG]    Status:', error.response?.status);
        console.error('[PROCESSOR:MSG]    Data:', error.response?.data);
      }
    }
  }

  // Reaction
  if (msg.reaction) {
    console.log('[PROCESSOR:MSG] ❤️ Reaction:', {
      messageId: msg.reaction.mid,
      action: msg.reaction.action,
      emoji: msg.reaction.emoji
    });
    
    // TODO: Invia reaction a IVOT
  }

  // Message read
  if (msg.read) {
    console.log('[PROCESSOR:MSG] 👁️ Message read:', msg.read.mid);
    
    // TODO: Invia read status a IVOT
  }

  // Postback (icebreaker, CTA button)
  if (msg.postback) {
    console.log('[PROCESSOR:MSG] 🔘 Postback:', {
      title: msg.postback.title,
      payload: msg.postback.payload
    });
    
    // TODO: Invia postback a IVOT
  }
}

/**
 * Processa eventi di change (commenti, mentions, ecc.)
 */
export async function processChangeEvent(
  instagramAccountId: string,
  change: any,
  webhookTime: number
): Promise<void> {
  console.log('[PROCESSOR:CHANGE] 🔄 Processing change event');
  console.log('[PROCESSOR:CHANGE]    Account ID:', instagramAccountId);
  console.log('[PROCESSOR:CHANGE]    Field:', change.field);

  const { field, value } = change;

  // ✅ SPECIAL CASE: Test di Meta invia "messages" come change event
  if (field === 'messages' && value?.message) {
    console.log('[PROCESSOR:CHANGE] 📨 Detected test message in change event, forwarding...');
    
    // Reindirizza a processMessagingEvent
    await processMessagingEvent(
      instagramAccountId,
      {
        sender: value.sender,
        recipient: value.recipient,
        timestamp: value.timestamp,
        message: value.message
      },
      webhookTime
    );
    return;
  }

  switch (field) {
    case 'comments':
    case 'live_comments':
      console.log('[PROCESSOR:CHANGE] 💬 Comment:', {
        commentId: value.id,
        from: value.from?.username,
        text: value.text,
        mediaId: value.media?.id
      });

      // TODO: Invia a IVOT
      await notifyIvotEvent('comment', instagramAccountId, {
        field,
        value,
        webhook_time: webhookTime
      });
      break;

    case 'mentions':
      console.log('[PROCESSOR:CHANGE] 📢 Mention:', {
        mediaId: value.media_id,
        commentId: value.comment_id
      });

      // TODO: Invia a IVOT
      await notifyIvotEvent('mention', instagramAccountId, {
        field,
        value,
        webhook_time: webhookTime
      });
      break;

    case 'story_insights':
      console.log('[PROCESSOR:CHANGE] 📊 Story insights:', value);
      
      // TODO: Invia a IVOT
      await notifyIvotEvent('story_insights', instagramAccountId, {
        field,
        value,
        webhook_time: webhookTime
      });
      break;

    default:
      console.log('[PROCESSOR:CHANGE] ❓ Unknown field:', field);
      
      // Invia come evento generico
      await notifyIvotEvent(`unknown_${field}`, instagramAccountId, {
        field,
        value,
        webhook_time: webhookTime
      });
  }
}

/**
 * Notifica IVOT di un evento generico
 */
async function notifyIvotEvent(
  eventType: string,
  instagramAccountId: string,
  data: any
): Promise<void> {
  try {
    console.log('[PROCESSOR] 📤 Sending', eventType, 'to IVOT');

    await axios.post(
      `${IVOT_BACKEND_URL}/api/webhooks/instagram/events`,
      {
        event_type: eventType,
        instagram_account_id: instagramAccountId,
        data,
        received_at: new Date().toISOString()
      },
      {
        headers: {
          'X-Api-Key': INTERNAL_API_KEY,
          'Content-Type': 'application/json'
        },
        timeout: 10000
      }
    );

    console.log('[PROCESSOR] ✅', eventType, 'sent to IVOT');

  } catch (error) {
    console.error('[PROCESSOR] ❌ Failed to notify IVOT', eventType, ':', error);
    
    if (axios.isAxiosError(error)) {
      console.error('[PROCESSOR]    Status:', error.response?.status);
      console.error('[PROCESSOR]    Data:', error.response?.data);
    }
  }
}