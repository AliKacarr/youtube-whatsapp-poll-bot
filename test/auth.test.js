const test = require('node:test');
const assert = require('node:assert/strict');

process.env.CONFIG_KEY = 'auth-test-key';
process.env.NODE_ENV = 'test';

function loadAuth() {
  const dbPath = require.resolve('../src/db');
  const authPath = require.resolve('../src/auth');
  const users = new Map();
  const sessions = new Map();
  const collections = {
    users: {
      findOne: async filter => users.get(filter._id) || null,
      insertOne: async document => {
        if (users.has(document._id)) throw Object.assign(new Error('duplicate'), { code: 11000 });
        users.set(document._id, document);
      }
    },
    auth_sessions: {
      insertOne: async document => sessions.set(document.tokenHash, document),
      findOne: async filter => {
        const session = sessions.get(filter.tokenHash);
        return session?.configKey === filter.configKey && session.expiresAt > new Date() ? session : null;
      },
      deleteOne: async filter => sessions.delete(filter.tokenHash)
    }
  };
  require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: { db: () => ({ collection: name => collections[name] }) } };
  delete require.cache[authPath];
  return require(authPath);
}

function response() {
  const headers = {};
  return { headers, setHeader: (name, value) => { headers[name.toLowerCase()] = value; } };
}

test('ilk yönetici kurulumu CONFIG_KEY doğrulaması ve güvenli oturum çerezi gerektirir', async () => {
  const auth = loadAuth();
  const res = response();
  await assert.rejects(() => auth.setup({ body: { configKey: 'yanlis', password: 'guvenli-sifre' }, ip: '1' }, res), /CONFIG_KEY/);
  await auth.setup({ body: { configKey: 'auth-test-key', password: 'guvenli-sifre' }, ip: '2' }, res);
  assert.match(res.headers['set-cookie'], /HttpOnly/);
  assert.match(res.headers['set-cookie'], /SameSite=Strict/);
  const cookie = res.headers['set-cookie'].split(';')[0];
  assert.deepEqual(await auth.status({ headers: { cookie } }), { authenticated: true, passwordConfigured: true });
});

test('yanlış şifre reddedilir, doğru şifre yeni oturum açar', async () => {
  const auth = loadAuth();
  await auth.setup({ body: { configKey: 'auth-test-key', password: 'guvenli-sifre' }, ip: '3' }, response());
  await assert.rejects(() => auth.login({ body: { password: 'yanlis-sifre' }, ip: '4' }, response()), /Şifre yanlış/);
  const res = response();
  await auth.login({ body: { password: 'guvenli-sifre' }, ip: '4' }, res);
  assert.match(res.headers['set-cookie'], /youtube_anket_admin=/);
});
