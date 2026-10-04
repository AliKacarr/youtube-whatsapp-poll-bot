const test = require('node:test');
const assert = require('node:assert/strict');
const { formatVideoMessage } = require('../src/whatsapp');

test('video mesajı başlık ve alt satırda bağlantı biçiminde hazırlanır', () => {
  assert.equal(
    formatVideoMessage({ title: 'Hayat Değiştiren İnce Düşünce', videoUrl: 'https://youtube.com/shorts/IhQuNsLao-k?si=X2_nX9uPd7gQiU7k' }),
    'Hayat Değiştiren İnce Düşünce\nhttps://youtube.com/shorts/IhQuNsLao-k?si=X2_nX9uPd7gQiU7k'
  );
});

test('video mesajında başlık ve bağlantı zorunludur', () => {
  assert.throws(() => formatVideoMessage({ title: '', videoUrl: 'https://youtube.com/test' }), /başlığı/);
  assert.throws(() => formatVideoMessage({ title: 'Başlık', videoUrl: '' }), /bağlantısı/);
});
