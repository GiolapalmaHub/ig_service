// microservizio/src/utils/state.ts

import crypto from 'crypto';

const SECRET_KEY = process.env.STATE_SECRET_KEY;

if (!SECRET_KEY) {
  throw new Error('❌ STATE_SECRET_KEY non configurato in .env');
}

if (SECRET_KEY.length < 32) {
  throw new Error('❌ STATE_SECRET_KEY deve essere almeno 32 caratteri');
}

export interface StateData {
  userId: string;
  callbackUrl: string;
  state: string;
  nonce: string;
  timestamp: number;
  expiry: number;
}

export interface CreateStateResult {
  state: string;
  nonce: string;
}

export interface VerifyStateResult {
  valid: boolean;
  data?: StateData;
  reason?: string;
}

function signPayload(payload: string): string {
  const hmac = crypto.createHmac('sha256', SECRET_KEY!);
  hmac.update(payload);
  return hmac.digest('base64url');
}

/**
 * Crea state sicuro con firma HMAC
 * @param payload JSON string con {userId, callbackUrl, state}
 * @param userState State custom dall'applicazione
 */
export function createSecureState(
  payload: string,
  userState: string
): CreateStateResult {
  if (!payload || payload.trim() === '') {
    throw new Error('payload è richiesto');
  }

  // Genera nonce univoco per questo state (anti-replay)
  const nonce = crypto.randomBytes(16).toString('base64url');
  const timestamp = Date.now();
  const expiry = timestamp + 10 * 60 * 1000; // 10 minuti

  // Encode payload in base64 per sicurezza
  const payloadB64 = Buffer.from(payload).toString('base64url');

  // Costruisci dati da firmare: payload.state.nonce.timestamp.expiry
  const data = `${payloadB64}.${userState}.${nonce}.${timestamp}.${expiry}`;
  const signature = signPayload(data);

  // State finale: 6 parti
  const state = `${data}.${signature}`;

  return { state, nonce };
}

/**
 * Verifica state ricevuto da Instagram
 * ✅ Protezione CSRF tramite firma HMAC (no cookie!)
 */
export function verifySecureState(state: string): VerifyStateResult {
  if (!state || state.trim() === '') {
    return { valid: false, reason: 'state è richiesto' };
  }

  const parts = state.split('.');

  // Formato: payloadB64.userState.nonce.timestamp.expiry.signature (6 parti)
  if (parts.length !== 6) {
    return { valid: false, reason: 'formato dello state non valido' };
  }

  const [payloadB64, userState, nonce, timestampStr, expiryStr, signature] = parts;

  // Parse numeri
  const timestamp = Number(timestampStr);
  const expiry = Number(expiryStr);

  if (!Number.isFinite(timestamp)) {
    return { valid: false, reason: 'timestamp non valido' };
  }

  if (!Number.isFinite(expiry)) {
    return { valid: false, reason: 'expiry non valido' };
  }

  // ✅ Verifica scadenza
  if (Date.now() > expiry) {
    return { valid: false, reason: 'state scaduto' };
  }

  // ✅ Verifica firma HMAC (protezione CSRF!)
  const data = `${payloadB64}.${userState}.${nonce}.${timestamp}.${expiry}`;
  const expectedSignature = signPayload(data);

  try {
    const sigBuf = Buffer.from(signature, 'base64url');
    const expectedBuf = Buffer.from(expectedSignature, 'base64url');

    if (sigBuf.length !== expectedBuf.length) {
      return { valid: false, reason: 'firma non valida' };
    }

    if (!crypto.timingSafeEqual(sigBuf, expectedBuf)) {
      return { valid: false, reason: 'firma non valida' };
    }
  } catch (e) {
    return { valid: false, reason: 'errore verifica firma' };
  }

  // ✅ Decodifica payload
  let payloadData;
  try {
    const payloadJson = Buffer.from(payloadB64, 'base64url').toString('utf8');
    payloadData = JSON.parse(payloadJson);
  } catch (e) {
    return { valid: false, reason: 'payload non valido' };
  }

  return {
    valid: true,
    data: {
      userId: payloadData.userId,
      callbackUrl: payloadData.callbackUrl,
      state: payloadData.state || userState,
      nonce,
      timestamp,
      expiry
    }
  };
}