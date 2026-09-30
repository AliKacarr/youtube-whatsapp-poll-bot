const $ = selector => document.querySelector(selector);
let currentSettings = null;
let eventsPage = 0;
let whatsappReady = false;

function populateHours() {
  const options = Array.from({ length: 24 }, (_, hour) => `<option value="${hour}">${String(hour).padStart(2, '0')}:00</option>`).join('');
  $('#startHour').innerHTML = options;
  $('#endHour').innerHTML = options;
}

function setLocked(cardSelector, locked, controls, message) {
  $(cardSelector).classList.toggle('is-locked', locked);
  controls.forEach(selector => {
    const element = $(selector);
    element.disabled = locked;
    element.title = locked ? message : '';
  });
}

async function api(url, options = {}) {
  const response = await fetch(url, { headers: { 'content-type': 'application/json', ...(options.headers || {}) }, ...options });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `İstek başarısız (${response.status})`);
  return body;
}

function toast(message, error = false) {
  const element = $('#toast');
  element.textContent = message;
  element.className = `show${error ? ' error' : ''}`;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { element.className = ''; }, 3800);
}

function renderStatus(data) {
  currentSettings = data.settings;
  const wa = data.whatsapp;
  const whatsappStatus = formatWhatsappStatus(wa.status);
  $('#systemBadge').textContent = wa.status === 'READY' ? '\u25cf Sistem haz\u0131r' : `\u25cf ${whatsappStatus}`;
  $('#waStatus').textContent = wa.status === 'READY' ? `${wa.userInfo?.name || 'WhatsApp'} ba\u011fl\u0131` : wa.lastError ? formatErrorMessage(wa.lastError) : whatsappStatus;
  $('#waNextStep').textContent = wa.status === 'READY'
    ? 'Bağlantı tamamlandı. Sıradaki adım: YouTube kanalını seçin.'
    : 'QR kodunu okuttuktan sonra YouTube kanalını seçebilirsiniz.';
  $('#qrWrap').classList.toggle('hidden', !wa.qrDataUrl);
  if (wa.qrDataUrl) $('#qrImage').src = wa.qrDataUrl;
  $('#connectButton').classList.toggle('hidden', wa.status === 'READY' || Boolean(wa.qrDataUrl));
  $('#logoutButton').classList.toggle('hidden', wa.status !== 'READY');
  const monitor = data.settings?.monitor;
  const schedule = { intervalMinutes: 1, startHour: monitor?.schedule?.startHour ?? 0, endHour: monitor?.schedule?.endHour ?? 23 };
  const lastChecked = monitor?.lastCheckedAt
    ? new Intl.DateTimeFormat('tr-TR', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit', hourCycle:'h23' }).format(new Date(monitor.lastCheckedAt))
    : 'henüz kontrol edilmedi';
  const hasChannel = Boolean(data.settings?.youtubeChannelId);
  const editingChannel = Boolean($('#channelEditor').dataset.editing);
  $('#selectedChannel').classList.toggle('hidden', !hasChannel);
  $('#changeChannelButton').classList.toggle('hidden', !hasChannel || editingChannel);
  if (hasChannel) {
    const thumbnail = data.settings.youtubeChannelThumbnail;
    $('#selectedChannel').innerHTML = `<span class="channel-avatar-wrap" aria-hidden="true"><span class="channel-avatar-placeholder">▶</span>${thumbnail ? `<img class="channel-avatar-image" src="${escapeHtml(thumbnail)}" alt="">` : ''}</span><div><strong>${escapeHtml(data.settings.youtubeChannelTitle || 'YouTube kanalı')}</strong><span>${escapeHtml(data.settings.youtubeChannelId)}</span></div>`;
    $('#selectedChannel .channel-avatar-image')?.addEventListener('error', event => event.currentTarget.remove());
    if (!editingChannel) $('#channelEditor').classList.add('hidden');
  } else {
    $('#channelEditor').classList.remove('hidden');
  }
  const hasGroup = Boolean(data.settings?.targetGroupId);
  $('#selectedGroup').innerHTML = hasGroup
    ? `<div><strong>${escapeHtml(data.settings.targetGroupName || 'Seçili grup')}</strong><span>${escapeHtml(data.settings.targetGroupId)}</span></div>`
    : 'Henüz grup seçilmedi.';
  $('#openGroupsButton').textContent = hasGroup ? 'Grubu değiştir' : 'Grup seç';
  $('#readyGroup').textContent = data.settings?.targetGroupName || 'Hedef grup seçilmedi';
  $('#readySchedule').textContent = `${String(schedule.startHour).padStart(2, '0')}:00–${String(schedule.endHour).padStart(2, '0')}:00 saatleri arası her dakika kontrol`;
  $('#readyLastChecked').textContent = lastChecked;
  if (!$('#channelInput').value && data.settings?.youtubeInput) $('#channelInput').value = data.settings.youtubeInput;

  $('#startHour').value = schedule.startHour;
  $('#endHour').value = schedule.endHour;
  whatsappReady = wa.status === 'READY';
  const canConfigureSchedule = whatsappReady && hasChannel;
  setLocked('#channelCard', !whatsappReady, ['#channelInput', '#changeChannelButton'], 'Önce WhatsApp bağlantısını tamamlayın.');
  $('#saveChannelButton').disabled = !whatsappReady || !$('#channelInput').value.trim();
  setLocked('#scheduleCard', !canConfigureSchedule, ['#startHour', '#endHour', '#saveScheduleButton'], !whatsappReady ? 'Önce WhatsApp bağlantısını tamamlayın.' : 'Önce YouTube kanalını kaydedin.');
  setLocked('#groupCard', !whatsappReady || !hasChannel, ['#openGroupsButton'], !whatsappReady ? 'Önce WhatsApp bağlantısını tamamlayın.' : 'Önce YouTube kanalını kaydedin.');
  const canTest = whatsappReady && hasChannel && hasGroup;
  setLocked('#testCard', !canTest, ['#testUrl', '#testPollButton'], 'Test için önceki üç adımı tamamlayın.');
  $('#readyPanel').classList.toggle('hidden', !canTest);
}

async function refreshStatus() {
  try { renderStatus(await api('/api/status')); } catch (error) { toast(error.message, true); } finally { document.body.classList.add('is-ready'); }
}

async function loadGroups() {
  const { groups } = await api('/api/groups');
  $('#groupList').innerHTML = groups.length
    ? groups.map(group => `<div class="group-row"><strong>${escapeHtml(group.name)}</strong><button data-group-id="${escapeHtml(group.id)}">Seç</button></div>`).join('')
    : '<p class="micro">Bu hesapta WhatsApp grubu bulunamadı.</p>';
  $('#groupList').querySelectorAll('[data-group-id]').forEach(button => {
    button.onclick = async () => {
      try {
        await api('/api/settings/group', { method:'PUT', body:JSON.stringify({ groupId:button.dataset.groupId }) });
        $('#groupModal').classList.add('hidden');
        toast('Hedef grup seçildi.');
        await refreshStatus();
      } catch (error) { toast(error.message, true); }
    };
  });
}

async function loadEvents() {
  try {
    const { events, total } = await api(`/api/events?page=${eventsPage}`);
    $('#eventsBody').innerHTML = events.length ? events.map(event => `<tr><td><a href="${escapeHtml(event.videoUrl)}" target="_blank" rel="noreferrer">${escapeHtml(event.title || event.videoId)}</a></td><td>${formatEventStatus(event.status)}</td><td>${event.receivedAt ? new Date(event.receivedAt).toLocaleString('tr-TR') : '—'}</td><td>${escapeHtml(formatErrorMessage(event.lastError))}</td></tr>`).join('') : '<tr><td colspan="4">Henüz olay yok.</td></tr>';
    const first = total ? eventsPage * 10 + 1 : 0;
    const last = eventsPage * 10 + events.length;
    $('#eventsPager').classList.toggle('hidden', total <= 10);
    $('#eventsPageInfo').textContent = total ? `${first}–${last} / ${total}` : '';
    $('#previousEventsButton').disabled = eventsPage === 0;
    $('#nextEventsButton').disabled = last >= total;
  } catch {}
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, char => ({ '&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;' }[char]));
}

function formatEventStatus(status) {
  const labels = {
    pending: 'Gönderim bekliyor',
    sending: 'Gönderiliyor',
    sent: 'Gönderildi',
    failed: 'Gönderilemedi',
    ignored: 'Başlangıç kaydı'
  };
  return labels[status] || 'Bilinmeyen';
}

$('#connectButton').onclick = async () => { try { await api('/api/whatsapp/start', { method:'POST', body:'{}' }); toast('WhatsApp bağlantısı başlatıldı.'); await refreshStatus(); } catch (e) { toast(e.message, true); } };
$('#logoutButton').onclick = async () => { if (!confirm('WhatsApp oturumu silinsin ve yeni QR üretilsin mi?')) return; try { await api('/api/whatsapp/logout', { method:'POST', body:'{}' }); toast('Oturum sıfırlandı.'); await refreshStatus(); } catch (e) { toast(e.message, true); } };
$('#openGroupsButton').onclick = async () => { $('#groupModal').classList.remove('hidden'); $('#groupList').innerHTML = '<p class="micro">Gruplar yükleniyor…</p>'; try { await loadGroups(); } catch (e) { $('#groupList').innerHTML = `<p class="micro">${escapeHtml(e.message)}</p>`; } };
$('#closeGroupsButton').onclick = () => $('#groupModal').classList.add('hidden');
$('#groupModal').onclick = event => { if (event.target === $('#groupModal')) $('#groupModal').classList.add('hidden'); };
$('#changeChannelButton').onclick = () => { $('#channelInput').value = ''; $('#saveChannelButton').disabled = true; $('#channelEditor').dataset.editing = 'true'; $('#channelEditor').classList.remove('hidden'); $('#changeChannelButton').classList.add('hidden'); $('#channelInput').focus(); };
$('#channelInput').oninput = () => { $('#saveChannelButton').disabled = !$('#channelInput').value.trim() || !whatsappReady; };
$('#saveChannelButton').onclick = async () => { try { await api('/api/settings/channel', { method:'PUT', body:JSON.stringify({ input:$('#channelInput').value }) }); delete $('#channelEditor').dataset.editing; $('#channelEditor').classList.add('hidden'); toast('Kanal kaydedildi.'); await refreshStatus(); } catch (e) { toast(e.message, true); } };
$('#saveScheduleButton').onclick = async () => {
  try {
    await api('/api/settings/monitor', { method:'PUT', body:JSON.stringify({ startHour: $('#startHour').value, endHour: $('#endHour').value }) });
    toast('Kontrol saatleri kaydedildi.');
    await refreshStatus();
  } catch (e) { toast(e.message, true); }
};
$('#testPollButton').onclick = async () => { try { await api('/api/test-poll', { method:'POST', body:JSON.stringify({ videoUrl:$('#testUrl').value }) }); toast('Test anketi gönderildi.'); } catch (e) { toast(e.message, true); } };
$('#previousEventsButton').onclick = () => { if (eventsPage > 0) { eventsPage -= 1; loadEvents(); } };
$('#nextEventsButton').onclick = () => { eventsPage += 1; loadEvents(); };

populateHours();
refreshStatus();
loadEvents();
setInterval(refreshStatus, 3000);
setInterval(loadEvents, 15000);

function formatWhatsappStatus(status) {
  const labels = {
    DISCONNECTED: 'Ba\u011flant\u0131 kesildi',
    INITIALIZING: 'Ba\u011flant\u0131 haz\u0131rlan\u0131yor',
    WAITING_FOR_QR: 'QR kodu bekleniyor',
    READY: 'Ba\u011fl\u0131',
    LOGGED_OUT: 'Oturum kapat\u0131ld\u0131',
    ERROR: 'Ba\u011flant\u0131 hatas\u0131'
  };
  return labels[status] || 'Durum bilinmiyor';
}
function formatErrorMessage(message) {
  if (!message) return '\u2014';
  const translations = [
    [/Connection Closed/gi, 'Ba\u011flant\u0131 kapat\u0131ld\u0131'],
    [/Connection Failure/gi, 'Ba\u011flant\u0131 ba\u015far\u0131s\u0131z oldu'],
    [/Connection Lost/gi, 'Ba\u011flant\u0131 kaybedildi'],
    [/Connection Replaced/gi, 'Ba\u011flant\u0131 ba\u015fka bir oturum taraf\u0131ndan de\u011fi\u015ftirildi'],
    [/Timed Out/gi, 'Zaman a\u015f\u0131m\u0131na u\u011frad\u0131'],
    [/Logged Out/gi, 'Oturum kapat\u0131ld\u0131'],
    [/Bad MAC/gi, 'Oturum do\u011frulama hatas\u0131'],
    [/YouTube uploads request failed/gi, 'YouTube video listesi al\u0131namad\u0131'],
    [/Invalid YouTube channel ID/gi, 'Ge\u00e7ersiz YouTube kanal kimli\u011fi']
  ];
  return translations.reduce((text, [pattern, replacement]) => text.replace(pattern, replacement), String(message));
}
