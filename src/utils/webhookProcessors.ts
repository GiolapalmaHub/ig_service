// ============================================
// WEBHOOK EVENT PROCESSORS
// Processa eventi da Instagram e li invia a IVOT
// ============================================

import { IvotNotifier } from "./ivotNotifier"
/**
 * Processa eventi di messaging (messaggi diretti)
 */
export async function processMessagingEvent(
  instagramAccountId: string, 
  msg: any,
  webhookTime: number
): Promise<void> {
  console.log('💬 Processing messaging event:', {
    accountId: instagramAccountId,
    sender: msg.sender?.id,
    recipient: msg.recipient?.id,
    timestamp: msg.timestamp
  });

  // ==========================================
  // 1. MESSAGE RECEIVED
  // ==========================================
  if (msg.message) {
    console.log('📨 Message event:', {
      mid: msg.message.mid,
      hasText: !!msg.message.text,
      hasAttachments: !!msg.message.attachments,
      isDeleted: msg.message.is_deleted,
      isEcho: msg.message.is_echo,
      isSelf: msg.message.is_self,
      isUnsupported: msg.message.is_unsupported
    });

    // Determina tipo messaggio
    let messageType: 'text' | 'image' | 'video' | 'audio' | 'sticker' | 'story_mention' | 'quick_reply' | 'referral' = 'text';
    
    if (msg.message.quick_reply) {
      messageType = 'quick_reply';
    } else if (msg.message.referral) {
      messageType = 'referral';
    } else if (msg.message.reply_to?.story) {
      messageType = 'story_mention';
    } else if (msg.message.attachments?.length > 0) {
      const attachmentType = msg.message.attachments[0].type;
      if (['image', 'video', 'audio'].includes(attachmentType)) {
        messageType = attachmentType;
      } else if (attachmentType === 'like_heart') {
        messageType = 'sticker';
      }
    }

    // Crea payload per IVOT
    const payload = {
      instagram_account_id: instagramAccountId,
      sender_id: msg.sender.id,
      sender_username: msg.sender.username,
      conversation_id: `${instagramAccountId}_${msg.sender.id}`, // Crea ID conversazione unico
      
      message: {
        id: msg.message.mid,
        text: msg.message.text,
        attachments: msg.message.attachments?.map((att: any) => ({
          type: att.type,
          url: att.payload?.url,
          payload: att.payload
        })),
        timestamp: msg.timestamp,
        type: messageType,
        
        // Campi speciali
        quick_reply: msg.message.quick_reply,
        referral: msg.message.referral,
        reply_to: msg.message.reply_to,
      },
      
      is_echo: msg.message.is_echo || false,
      is_deleted: msg.message.is_deleted || false,
      is_unsupported: msg.message.is_unsupported || false,
      
      webhook_event_type: 'message',
      webhook_received_at: new Date().toISOString(),
      instagram_webhook_time: webhookTime
    };

    // 🚀 Invia a IVOT
    await IvotNotifier.notifyMessage(payload);
  }

  // ==========================================
  // 2. MESSAGE REACTION
  // ==========================================
  if (msg.reaction) {
    console.log('❤️ Reaction event:', {
      messageId: msg.reaction.mid,
      action: msg.reaction.action,
      emoji: msg.reaction.emoji
    });

    const payload = {
      instagram_account_id: instagramAccountId,
      sender_id: msg.sender.id,
      conversation_id: `${instagramAccountId}_${msg.sender.id}`,
      
      message: {
        id: msg.reaction.mid,
        timestamp: msg.timestamp,
        type: 'reaction' as const,
        text: undefined,
        attachments: undefined,
      },
      
      reaction: {
        action: msg.reaction.action, // 'react' | 'unreact'
        emoji: msg.reaction.emoji,
        reaction_type: msg.reaction.reaction // 'love'
      },
      
      is_echo: false,
      is_deleted: false,
      is_unsupported: false,
      
      webhook_event_type: 'message_reaction',
      webhook_received_at: new Date().toISOString(),
      instagram_webhook_time: webhookTime
    };

    await IvotNotifier.notifyMessage(payload);
  }

  // ==========================================
  // 3. MESSAGE READ (SEEN)
  // ==========================================
  if (msg.read) {
    console.log('👁️ Message read:', {
      messageId: msg.read.mid,
      readBy: msg.sender.id
    });

    // Opzionale: puoi notificare IVOT che un messaggio è stato letto
    await IvotNotifier.notifyGenericEvent(
      'message_seen',
      instagramAccountId,
      {
        message_id: msg.read.mid,
        seen_by: msg.sender.id,
        timestamp: msg.timestamp
      }
    );
  }

  // ==========================================
  // 4. POSTBACK (Icebreaker o CTA button)
  // ==========================================
  if (msg.postback) {
    console.log('🔘 Postback event:', {
      title: msg.postback.title,
      payload: msg.postback.payload
    });

    const payload = {
      instagram_account_id: instagramAccountId,
      sender_id: msg.sender.id,
      conversation_id: `${instagramAccountId}_${msg.sender.id}`,
      
      message: {
        id: msg.postback.mid,
        timestamp: msg.timestamp,
        type: 'postback' as const,
        text: msg.postback.title,
        attachments: undefined,
      },
      
      postback: {
        title: msg.postback.title,
        payload: msg.postback.payload
      },
      
      is_echo: false,
      is_deleted: false,
      is_unsupported: false,
      
      webhook_event_type: 'postback',
      webhook_received_at: new Date().toISOString(),
      instagram_webhook_time: webhookTime
    };

    await IvotNotifier.notifyMessage(payload);
  }

  // ==========================================
  // 5. REFERRAL (ig.me link click)
  // ==========================================
  if (msg.referral && !msg.message) {
    console.log('🔗 Referral event:', {
      ref: msg.referral.ref,
      source: msg.referral.source
    });

    await IvotNotifier.notifyGenericEvent(
      'referral',
      instagramAccountId,
      {
        sender_id: msg.sender.id,
        ref: msg.referral.ref,
        source: msg.referral.source,
        type: msg.referral.type,
        timestamp: msg.timestamp
      }
    );
  }

  // ==========================================
  // 6. MESSAGE EDIT
  // ==========================================
  if (msg.message_edit) {
    console.log('✏️ Message edit:', {
      messageId: msg.message_edit.mid,
      newText: msg.message_edit.text,
      editCount: msg.message_edit.num_edit
    });

    await IvotNotifier.notifyGenericEvent(
      'message_edit',
      instagramAccountId,
      {
        message_id: msg.message_edit.mid,
        text: msg.message_edit.text,
        num_edit: msg.message_edit.num_edit,
        sender_id: msg.sender.id,
        timestamp: msg.timestamp
      }
    );
  }
}

/**
 * Processa eventi di change (comments, mentions, ecc.)
 */
export async function processChangeEvent(
  instagramAccountId: string, 
  change: any,
  webhookTime: number
): Promise<void> {
  console.log('🔄 Processing change event:', {
    accountId: instagramAccountId,
    field: change.field
  });

  const { field, value } = change;

  switch (field) {
    // ==========================================
    // COMMENTS & LIVE COMMENTS
    // ==========================================
    case 'comments':
    case 'live_comments':
      console.log(`💬 ${field === 'live_comments' ? 'Live ' : ''}Comment:`, {
        commentId: value.id || value.comment_id,
        from: value.from?.username,
        text: value.text,
        mediaId: value.media?.id
      });

      await IvotNotifier.notifyComment({
        instagram_account_id: instagramAccountId,
        comment_id: value.id || value.comment_id,
        media_id: value.media?.id || value.media_id,
        from_username: value.from?.username,
        from_id: value.from?.id,
        text: value.text,
        parent_comment_id: value.parent_id,
        webhook_event_type: field === 'live_comments' ? 'live_comment' : 'comment',
        webhook_received_at: new Date().toISOString()
      });
      break;

    // ==========================================
    // MENTIONS
    // ==========================================
    case 'mentions':
      console.log('📢 Mention:', {
        mediaId: value.media_id,
        commentId: value.comment_id
      });

      await IvotNotifier.notifyGenericEvent(
        'mention',
        instagramAccountId,
        {
          media_id: value.media_id,
          comment_id: value.comment_id,
          webhook_time: webhookTime
        }
      );
      break;

    // ==========================================
    // STORY INSIGHTS
    // ==========================================
    case 'story_insights':
      console.log('📊 Story insights:', value);

      await IvotNotifier.notifyGenericEvent(
        'story_insights',
        instagramAccountId,
        {
          ...value,
          webhook_time: webhookTime
        }
      );
      break;

    // ==========================================
    // UNKNOWN FIELD
    // ==========================================
    default:
      console.log('❓ Unknown webhook field:', field);
      
      // Invia comunque a IVOT per logging
      await IvotNotifier.notifyGenericEvent(
        `unknown_${field}`,
        instagramAccountId,
        {
          field,
          value,
          webhook_time: webhookTime
        }
      );
  }
}