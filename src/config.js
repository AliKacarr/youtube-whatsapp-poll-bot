function requireEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} ortam değişkeni tanımlı değil.`);
  return value;
}

function getConfigKey() {
  const key = requireEnv('CONFIG_KEY');
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(key)) {
    throw new Error('CONFIG_KEY yalnızca harf, rakam, tire ve alt çizgi içerebilir (en fazla 64 karakter).');
  }
  return key;
}

module.exports = { requireEnv, getConfigKey };
