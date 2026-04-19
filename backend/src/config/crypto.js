import crypto from 'node:crypto';
import { env } from './env.js';
import { logger } from './logger.js';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;

export function encrypt(text) {
  const key = Buffer.from(env.encryptionKey, 'hex');
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const tag = cipher.getAuthTag();
  return iv.toString('hex') + ':' + tag.toString('hex') + ':' + encrypted;
}

export function decrypt(data) {
  if (!data || typeof data !== 'string') {
    throw new Error('Invalid encrypted data: empty or not a string');
  }
  const parts = data.split(':');
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted data format');
  }

  const key = Buffer.from(env.encryptionKey, 'hex');
  const [ivHex, tagHex, encrypted] = parts;
  const iv = Buffer.from(ivHex, 'hex');
  const tag = Buffer.from(tagHex, 'hex');
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

// Backward-compat helper: tries to decrypt; if it fails (legacy plaintext) returns value as-is.
export function safeDecrypt(data) {
  if (!data) return data;
  try {
    return decrypt(data);
  } catch (err) {
    logger.warn('safeDecrypt failed, returning value as-is (legacy plaintext or wrong ENCRYPTION_KEY)', { error: err.message });
    return data;
  }
}
