import crypto from 'crypto';

const SECRET_KEY = process.env.STATE_SECRET_KEY;

console.log(process.env)

if (!SECRET_KEY) {
  throw new Error('❌ STATE_SECRET_KEY non configurato in .env');
}

if (SECRET_KEY.length <= 32) {
  throw new Error('❌ STATE_SECRET_KEY deve essere almeno 32 caratteri');
}

export interface StateData {
  userId: string;
  page: string;
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

export function createSecureState(
  userId: string,
  page: string,
  expiryMinutes: number = 10
): CreateStateResult {
  if (!userId || userId.trim() === '') {
    throw new Error('userId è richiesto');
  }
  
  if (!page || page.trim() === '') {
    throw new Error('page è richiesta');
  }

  const nonce = crypto.randomBytes(16).toString('base64url');
  const timestamp = Date.now();
  const expiry = timestamp + expiryMinutes * 60 * 1000; 
  
  // ✅ INCLUDE EXPIRY nel payload
  const payload = `${userId}.${page}.${nonce}.${timestamp}.${expiry}`;
  const signature = signPayload(payload);
  
  // 6 parti: userId.page.nonce.timestamp.expiry.signature
  const state = `${payload}.${signature}`;
  
  return { state, nonce };
}

export function verifySecureState(
  state: string,
  storedNonce: string
): VerifyStateResult {
  if (!state || state.trim() === '') {
    return { valid: false, reason: 'state è richiesto' };
  }

  const parts = state.split('.');
  
  // ✅ 6 parti attese
  if (parts.length !== 6) {
    return { valid: false, reason: 'formato dello state non valido' };
  }

  const [userId, page, nonce, timestampStr, expiryStr, signature] = parts;

  // ✅ VERIFICA NONCE (protezione CSRF!)
  if (nonce !== storedNonce) {
    return { valid: false, reason: 'nonce mismatch - possibile CSRF' };
  }

  const timestamp = Number(timestampStr);
  const expiry = Number(expiryStr);
  
  if (!Number.isFinite(timestamp) || Number.isNaN(timestamp)) {
    return { valid: false, reason: 'timestamp non valido' };
  }
  
  if (!Number.isFinite(expiry) || Number.isNaN(expiry)) {
    return { valid: false, reason: 'expiry non valido' };
  }

  // ✅ VERIFICA EXPIRY (ora è firmato)
  if (Date.now() > expiry) {
    return { valid: false, reason: 'state scaduto' };
  }

  // ✅ VERIFICA FIRMA (con expiry incluso)
  const payload = `${userId}.${page}.${nonce}.${timestamp}.${expiry}`;
  const expectedSignature = signPayload(payload);

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

  return {
    valid: true,
    data: { userId, page, nonce, timestamp, expiry }
  };
}