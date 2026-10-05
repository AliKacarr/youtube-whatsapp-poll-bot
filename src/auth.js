const crypto = require('crypto');
const { promisify } = require('util');
const { db } = require('./db');
const { getConfigKey } = require('./config');

const scrypt = promisify(crypto.scrypt);
const COOKIE_NAME = 'youtube_anket_admin';
const SESSION_MS = 30 * 24 * 60 * 60 * 1000;
const attempts = new Map();

function cookieValue(req, name) {
  const cookies = String(req.headers.cookie || '').split(';');
  for (const cookie of cookies) {
    const [key, ...parts] = cookie.trim().split('=');
    if (key === name) return decodeURIComponent(parts.join('='));
  }
  return null;
}

function tokenHash(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function sessionCookie(token, maxAge = SESSION_MS, useSecure = false) {
  const secure = useSecure ? '; Secure' : '';
  return `${COOKIE_NAME}=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${Math.floor(maxAge / 1000)}${secure}`;
}

function validatePassword(password) {
  const value = String(password || '');
  if (value.length < 6) throw new Error('Şifre en az 6 karakter olmalıdır.');
  if (value.length > 200) throw new Error('Şifre en fazla 200 karakter olabilir.');
  return value;
}

async function passwordDigest(password, salt) {
  return (await scrypt(password, salt, 64)).toString('hex');
}

function rateKey(req) {
  return `${getConfigKey()}:${req.ip || req.socket?.remoteAddress || 'unknown'}`;
}

function checkRateLimit(req) {
  const key = rateKey(req);
  const now = Date.now();
  const recent = (attempts.get(key) || []).filter(time => now - time < 15 * 60 * 1000);
  attempts.set(key, recent);
  if (recent.length >= 5) throw new Error('Çok fazla başarısız giriş denemesi. 15 dakika sonra tekrar deneyin.');
}

function recordFailure(req) {
  const key = rateKey(req);
  attempts.set(key, [...(attempts.get(key) || []), Date.now()]);
}

function clearFailures(req) {
  attempts.delete(rateKey(req));
}

async function createSession(req, res) {
  const token = crypto.randomBytes(32).toString('base64url');
  await db().collection('auth_sessions').insertOne({
    tokenHash: tokenHash(token),
    configKey: getConfigKey(),
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + SESSION_MS)
  });
  res.setHeader('Set-Cookie', sessionCookie(token, SESSION_MS, Boolean(req.secure)));
}

async function sessionFor(req) {
  const token = cookieValue(req, COOKIE_NAME);
  if (!token) return null;
  return db().collection('auth_sessions').findOne({ tokenHash: tokenHash(token), configKey: getConfigKey(), expiresAt: { $gt: new Date() } });
}

async function status(req) {
  const [user, session] = await Promise.all([
    db().collection('users').findOne({ _id: getConfigKey() }, { projection: { _id: 1 } }),
    sessionFor(req)
  ]);
  return { authenticated: Boolean(session), passwordConfigured: Boolean(user) };
}

async function setup(req, res) {
  checkRateLimit(req);
  const suppliedKey = Buffer.from(String(req.body.configKey || ''));
  const expectedKey = Buffer.from(getConfigKey());
  if (suppliedKey.length !== expectedKey.length || !crypto.timingSafeEqual(suppliedKey, expectedKey)) {
    recordFailure(req);
    throw new Error('CONFIG_KEY bilgisi yanlış.');
  }
  const password = validatePassword(req.body.password);
  const salt = crypto.randomBytes(16).toString('hex');
  const passwordHash = await passwordDigest(password, salt);
  try {
    await db().collection('users').insertOne({ _id: getConfigKey(), salt, passwordHash, createdAt: new Date(), updatedAt: new Date() });
  } catch (error) {
    if (error?.code === 11000) throw new Error('Bu kurulum için şifre zaten oluşturulmuş. Giriş yapın.');
    throw error;
  }
  clearFailures(req);
  await createSession(req, res);
}

async function login(req, res) {
  checkRateLimit(req);
  const password = String(req.body.password || '');
  const user = await db().collection('users').findOne({ _id: getConfigKey() });
  if (!user) throw new Error('Önce bu kurulum için bir yönetici şifresi oluşturun.');
  const actual = Buffer.from(await passwordDigest(password, user.salt), 'hex');
  const expected = Buffer.from(user.passwordHash, 'hex');
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) {
    recordFailure(req);
    throw new Error('Şifre yanlış.');
  }
  clearFailures(req);
  await createSession(req, res);
}

async function logout(req, res) {
  const token = cookieValue(req, COOKIE_NAME);
  if (token) await db().collection('auth_sessions').deleteOne({ tokenHash: tokenHash(token), configKey: getConfigKey() });
  res.setHeader('Set-Cookie', sessionCookie('', 0, Boolean(req.secure)));
}

async function requireAdmin(req, res, next) {
  try {
    if (!(await sessionFor(req))) return res.status(401).json({ ok: false, error: 'Düzenleme yapmak için yönetici girişi gereklidir.' });
    next();
  } catch (error) { next(error); }
}

module.exports = { status, setup, login, logout, requireAdmin };
