import './style.css';

const root = document.querySelector('#app');
const connectionView = '@connection';
const emojiChoices = ['😀', '😂', '😊', '😍', '🥰', '😎', '🤔', '😭', '😅', '🙃', '😉', '😴', '👋', '👍', '👎', '👏', '🙏', '❤️', '💚', '🔥', '✨', '🎉', '☕', '🐱'];
const defaults = {
  host: 'irc.libera.chat', port: '6697', nick: 'HarborGuest', username: '', channels: '#libera',
  backupNicks: '', authMethod: 'none', authAccount: '', rememberAuthPassword: false,
  requireAuthentication: false, requireAuthenticationByServer: {},
  quitMessage: '{nick} has quit their Harbor client', customScripts: [], awayMessage: 'Away'
};
const stored = loadSettings();
const state = {
  connected: false, connecting: false, away: false, scriptCooldowns: new Map(), server: '', nick: stored.nick || defaults.nick,
  active: '', channels: [], users: new Map(), memberModes: new Map(), conversations: new Map(), recentTalkers: new Map(),
  settings: { ...defaults, ...stored, customScripts: normalizeCustomScripts(stored.customScripts), password: '', authPassword: '' }, settingsOpen: false, settingsTab: 'appearance',
  imageUrl: '', imageObjectUrl: ''
};
let tabCompletion;

root.innerHTML = `
  <div class="window-shell">
    <aside class="side-rail" aria-label="Primary navigation">
      <div class="brand-mark" aria-label="Harbor IRC">H</div>
      <button class="rail-button selected" aria-label="Chat" title="Chat"><span class="icon icon-chat"></span></button>
      <button class="rail-button" id="rail-settings" aria-label="Settings" title="Settings"><span class="icon icon-settings"></span></button>
      <div class="rail-spacer"></div><button class="rail-button" id="rail-connect" aria-label="Connect" title="Connect"><span class="icon icon-plug"></span></button>
    </aside>
    <aside class="channel-sidebar">
      <div class="sidebar-heading"><div><span class="eyebrow">WORKSPACE</span><h1>Harbor</h1></div></div>
      <div class="server-card"><span class="server-led" id="server-led"></span><div class="server-copy"><strong id="server-name">Not connected</strong><span id="server-detail">Choose a server to get started</span></div><button class="icon-button small" id="server-menu" title="Connection settings" aria-label="Connection settings"><span class="icon icon-sliders"></span></button></div>
      <div class="section-label"><span>SERVER</span></div><button class="channel-item connection-item" id="connection-view" type="button"><span class="channel-item-hash">↔</span><span class="channel-item-name">Connection log</span></button>
      <div class="section-label"><span>CHANNELS</span></div>
      <div class="channel-list" id="channel-list"></div>
      <div class="sidebar-footer"><span class="footer-dot"></span><span>Messages stay on your device</span></div>
    </aside>
    <main class="chat-area">
      <header class="chat-header"><div class="chat-title"><span class="channel-hash" id="channel-symbol">#</span><div><h2 id="active-title">Welcome</h2><p id="active-topic">Connect to an IRC network to begin chatting.</p></div></div><div class="header-actions"><span class="connection-pill" id="connection-pill"><i></i> Offline</span><button class="icon-button" id="leave-channel" title="Leave channel" aria-label="Leave channel"><span class="icon icon-exit"></span></button><button class="icon-button" id="open-settings" title="Settings" aria-label="Settings"><span class="icon icon-settings"></span></button></div></header>
      <div class="conversation-layout"><section class="conversation"><div class="message-list" id="message-list" aria-live="polite"><div class="welcome-state"><div class="welcome-glyph">H</div><div class="eyebrow">YOUR IRC DESKTOP</div><h3>A quieter place to chat.</h3><p>Connect to a network, join a channel, and pick up the conversation.</p><button class="primary-button" id="welcome-connect"><span class="icon icon-plug"></span> Connect to a server</button></div></div><div class="composer-wrap"><div class="emoji-picker hidden" id="emoji-picker" role="group" aria-label="Emoji picker"></div><form class="composer" id="message-form"><button type="button" class="composer-plus" id="composer-join" title="Join a channel" aria-label="Join a channel"><span class="icon icon-plus"></span></button><button type="button" class="emoji-button" id="emoji-button" title="Insert emoji" aria-label="Insert emoji">😊</button><label class="composer-input-label" for="message-input"><span class="sr-only">Message</span></label><input id="message-input" autocomplete="off" maxlength="400" placeholder="Connect to start chatting" disabled /><button class="send-button" type="submit" title="Send message" aria-label="Send message" disabled><span class="icon icon-send"></span></button></form><div class="composer-hint"><span>Enter to send</span><span>IRC commands begin with <kbd>/</kbd></span></div></div></section><aside class="member-panel"><div class="member-heading"><span>MEMBERS</span><span class="member-count" id="member-count">0</span></div><div class="member-list" id="member-list"><span class="empty-members">Join a channel to see who's here.</span></div><div class="member-footer"><span class="lock-mark"></span><span>TLS connection</span></div></aside></div>
    </main>
  </div>
  <div class="toast-stack" id="toast-stack" role="status" aria-live="polite"></div>
  <div class="modal-backdrop hidden" id="modal-backdrop"><section class="settings-modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><header class="modal-header"><div><span class="eyebrow">PREFERENCES</span><h2 id="modal-title">Settings</h2></div><button class="icon-button" id="close-settings" aria-label="Close settings" title="Close settings"><span class="icon icon-close"></span></button></header><div class="modal-body"><nav class="settings-nav" aria-label="Settings sections"><button class="settings-nav-item" data-tab="connection"><span class="icon icon-plug"></span> Connection</button><button class="settings-nav-item active" data-tab="appearance"><span class="icon icon-palette"></span> Themes &amp; Appearance</button><button class="settings-nav-item" data-tab="scripts"><span class="icon icon-settings"></span> Scripts</button></nav><div class="settings-content" id="settings-content"></div></div></section></div>
`;

const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const messageList = $('#message-list');
const imageInput = document.createElement('input');
imageInput.type = 'file';
imageInput.accept = 'image/png,image/jpeg,image/webp,image/gif';
imageInput.hidden = true;
document.body.append(imageInput);

function loadSettings() {
  try {
    const value = JSON.parse(localStorage.getItem('harbor-settings') || '{}');
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  }
  catch { return {}; }
}
function normalizeCustomScripts(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 50).filter(script => script && typeof script === 'object').map((script, index) => ({
    id: typeof script.id === 'string' && /^[\w-]{1,80}$/.test(script.id) ? script.id : `script-${index}`,
    name: String(script.name || `Script ${index + 1}`).slice(0, 60),
    enabled: Boolean(script.enabled),
    trigger: ['private-message', 'message-contains', 'channel-join'].includes(script.trigger) ? script.trigger : 'private-message',
    contains: String(script.contains || '').slice(0, 120),
    channel: String(script.channel || '').slice(0, 100),
    response: String(script.response || '').slice(0, 400),
    onlyWhileAway: Boolean(script.onlyWhileAway),
    cooldownSeconds: Math.min(86400, Math.max(30, Number(script.cooldownSeconds) || 60))
  }));
}
function saveSettings() {
  const { password: _password, authPassword: _authPassword, ...persisted } = state.settings;
  try { localStorage.setItem('harbor-settings', JSON.stringify(persisted)); }
  catch { toast('Settings could not be saved on this device.', 'error'); }
}
function configuredQuitMessage() {
  const nick = state.nick || state.settings.nick || defaults.nick;
  return (state.settings.quitMessage || defaults.quitMessage).replace(/\{nick\}/gi, nick);
}
function authenticationServerKey(host, port = state.settings.port) {
  return `${host.trim().toLowerCase()}:${String(port).trim()}`;
}
function authenticationRequiredForHost(host, port = state.settings.port) {
  const key = authenticationServerKey(host, port);
  const byServer = state.settings.requireAuthenticationByServer || {};
  if (Object.hasOwn(byServer, key)) return Boolean(byServer[key]);
  return key === authenticationServerKey(state.settings.host, state.settings.port) && Boolean(state.settings.requireAuthentication);
}
function toast(text, kind = '') {
  const item = document.createElement('div');
  item.className = `toast ${kind}`;
  item.textContent = text;
  $('#toast-stack').append(item);
  setTimeout(() => item.remove(), 4200);
}
function openSettings(tab = 'appearance') {
  state.settingsOpen = true;
  state.settingsTab = tab;
  $('#modal-backdrop').classList.remove('hidden');
  renderSettings();
}
function closeSettings() {
  state.settingsOpen = false;
  $('#modal-backdrop').classList.add('hidden');
}
function renderSettings() {
  $$('.settings-nav-item').forEach(button => button.classList.toggle('active', button.dataset.tab === state.settingsTab));
  const content = $('#settings-content');
  if (state.settingsTab === 'connection') {
    content.innerHTML = `
      <div class="settings-section"><span class="eyebrow">NETWORK</span><h3>Server connection</h3><p class="section-description">TLS is always required. Server passwords are only kept in memory for this session.</p>
      <form id="connection-form" class="settings-form">
        <label class="field-label" for="host">Server address</label><input class="text-field" id="host" name="host" maxlength="253" required placeholder="irc.libera.chat" value="${escapeAttribute(state.settings.host)}" />
        <div class="field-row"><div><label class="field-label" for="port">TLS port</label><input class="text-field" id="port" name="port" type="number" min="1" max="65535" required value="${escapeAttribute(state.settings.port)}" /></div><div><label class="field-label" for="nick">Nickname</label><input class="text-field" id="nick" name="nick" maxlength="30" required value="${escapeAttribute(state.settings.nick)}" /></div></div>
        <div class="field-row"><div><label class="field-label" for="username">Username <span class="optional">OPTIONAL</span></label><input class="text-field" id="username" name="username" maxlength="30" value="${escapeAttribute(state.settings.username)}" /></div><div><label class="field-label" for="channels">Channels <span class="optional">OPTIONAL</span></label><input class="text-field" id="channels" name="channels" maxlength="600" placeholder="#channel, #another" value="${escapeAttribute(state.settings.channels)}" /></div></div>
        <label class="field-label" for="backup-nicks">Backup nicknames <span class="optional">UP TO 4 · COMMA-SEPARATED</span></label><input class="text-field" id="backup-nicks" name="backupNicks" maxlength="128" placeholder="HarborGuest_, HarborGuest2" value="${escapeAttribute(state.settings.backupNicks)}" />
        <label class="field-label" for="password">Server password <span class="optional">NOT SAVED</span></label><input class="text-field" id="password" name="password" type="password" maxlength="400" autocomplete="off" />
        <label class="field-label" for="auth-method">Account authentication</label><select class="text-field" id="auth-method" name="authMethod"><option value="none" ${state.settings.authMethod === 'none' ? 'selected' : ''}>Disabled</option><option value="sasl" ${state.settings.authMethod === 'sasl' ? 'selected' : ''}>SASL PLAIN</option><option value="nickserv" ${state.settings.authMethod === 'nickserv' ? 'selected' : ''}>NickServ IDENTIFY</option></select>
        <label class="remember-password"><input id="require-authentication" name="requireAuthentication" type="checkbox" ${authenticationRequiredForHost(state.settings.host, state.settings.port) ? 'checked' : ''} /><span>Require SASL or NickServ for this server</span></label>
        <label class="field-label" for="auth-account">SASL account name <span class="optional">SASL ONLY</span></label><input class="text-field" id="auth-account" name="authAccount" maxlength="128" autocomplete="username" value="${escapeAttribute(state.settings.authAccount)}" />
        <label class="field-label" for="auth-password">Authentication password</label><input class="text-field" id="auth-password" name="authPassword" type="password" maxlength="400" autocomplete="new-password" />
        <label class="remember-password"><input id="remember-auth-password" name="rememberAuthPassword" type="checkbox" ${state.settings.rememberAuthPassword ? 'checked' : ''} /><span>Remember authentication password securely on this device</span></label>
        <label class="field-label" for="quit-message">Quit message <span class="optional">USE {nick} FOR YOUR NICKNAME</span></label><input class="text-field" id="quit-message" name="quitMessage" maxlength="300" value="${escapeAttribute(state.settings.quitMessage)}" />
        <p class="section-description">Authentication is optional unless required above. Backup nicknames are tried in order when the server reports that the current nickname is already in use. Saved credentials use Windows secure storage. NickServ IDENTIFY waits for confirmation before joining channels.</p>
        <div class="security-note"><span class="icon icon-lock"></span><span>Certificate verification is on. Untrusted or expired certificates are rejected.</span></div>
        <div class="form-actions"><button type="button" class="secondary-button" id="disconnect-button" ${state.connected || state.connecting ? '' : 'disabled'}>Disconnect</button><button class="primary-button" type="submit" ${state.connecting ? 'disabled' : ''}><span class="icon icon-plug"></span>${state.connected ? 'Save settings' : state.connecting ? 'Connecting…' : 'Connect securely'}</button></div>
      </form></div>`;
    $('#connection-form').addEventListener('submit', connectFromForm);
    $('#host').addEventListener('input', event => {
      $('#require-authentication').checked = authenticationRequiredForHost(event.currentTarget.value, $('#port').value);
    });
    $('#port').addEventListener('input', event => {
      $('#require-authentication').checked = authenticationRequiredForHost($('#host').value, event.currentTarget.value);
    });
    $('#disconnect-button').addEventListener('click', async () => {
      try {
        await window.harbor.quit(configuredQuitMessage());
        closeSettings();
      } catch (error) { toast(error.message || 'Could not disconnect.', 'error'); }
    });
  } else if (state.settingsTab === 'scripts') {
    const scripts = normalizeCustomScripts(state.settings.customScripts);
    state.settings.customScripts = scripts;
    content.innerHTML = `
      <div class="settings-section"><span class="eyebrow">AUTOMATION</span><h3>Custom scripts</h3>
      <p class="section-description">Create safe event rules without running arbitrary code. Reply to private messages, react to a phrase, or post when you join a channel. Replies use IRC messages and respect cooldowns; at most three rules can reply to one event.</p>
      <div class="away-control"><div><strong>${state.away ? 'You are marked away' : 'You are not marked away'}</strong><span>Only-away rules run while your IRC away status is set.</span></div><button type="button" class="secondary-button" id="toggle-away" ${state.connected ? '' : 'disabled'}>${state.away ? 'Clear away' : 'Set away'}</button></div>
      <label class="field-label" for="away-message">Away message</label><input class="text-field" id="away-message" maxlength="300" value="${escapeAttribute(state.settings.awayMessage || defaults.awayMessage)}" />
      <div class="script-list">${scripts.length ? scripts.map(renderScriptCard).join('') : '<p class="empty-scripts">No scripts yet. Add one to create an automatic reply or channel action.</p>'}</div>
      <button type="button" class="secondary-button" id="add-script">Add script</button>
      <p class="section-description script-help">Templates: <code>{nick}</code> sender, <code>{channel}</code> channel, <code>{myNick}</code> your nickname, and <code>{message}</code> triggering text. Phrase matching ignores case. Minimum cooldown is 30 seconds.</p>
      </div>`;
    $('#toggle-away').addEventListener('click', async () => {
      state.settings.awayMessage = $('#away-message').value.trim() || defaults.awayMessage;
      saveSettings();
      try {
        await window.harbor.rawCommand(state.away ? 'AWAY' : `AWAY :${state.settings.awayMessage}`);
        state.away = !state.away;
        renderSettings();
      } catch (error) { toast(error.message || 'Could not change away status.', 'error'); }
    });
    $('#away-message').addEventListener('change', event => {
      state.settings.awayMessage = event.currentTarget.value.trim().slice(0, 300) || defaults.awayMessage;
      saveSettings();
    });
    $('#add-script').addEventListener('click', () => {
      if (scripts.length >= 50) { toast('You can save up to 50 scripts.', 'error'); return; }
      scripts.push({
        id: `script-${crypto.randomUUID()}`, name: `Script ${scripts.length + 1}`, enabled: true,
        trigger: 'private-message', contains: '', channel: '', response: '', onlyWhileAway: true, cooldownSeconds: 60
      });
      state.settings.customScripts = scripts;
      saveSettings();
      renderSettings();
      content.querySelector('.script-card:last-child .script-name')?.focus();
    });
    content.querySelectorAll('.script-card').forEach(form => {
      form.querySelector('[name="trigger"]').addEventListener('change', event => {
        form.querySelector('.script-condition').classList.toggle('hidden', event.target.value !== 'message-contains');
      });
      form.addEventListener('submit', event => {
        event.preventDefault();
        const data = new FormData(form);
        const trigger = String(data.get('trigger'));
        const name = String(data.get('name') || '').trim();
        const response = String(data.get('response') || '').trim();
        const contains = String(data.get('contains') || '').trim();
        if (!name || !response || (trigger === 'message-contains' && !contains)) {
          toast('Enter a script name, a reply, and a phrase for phrase-triggered scripts.', 'error');
          return;
        }
        const index = scripts.findIndex(script => script.id === form.dataset.scriptId);
        if (index < 0) return;
        scripts[index] = {
          ...scripts[index], name: name.slice(0, 60), enabled: data.get('enabled') === 'on', trigger,
          contains: contains.slice(0, 120), channel: String(data.get('channel') || '').trim().slice(0, 100),
          response: response.slice(0, 400), onlyWhileAway: data.get('onlyWhileAway') === 'on',
          cooldownSeconds: Math.min(86400, Math.max(30, Number(data.get('cooldownSeconds')) || 60))
        };
        state.settings.customScripts = scripts;
        state.settings.awayMessage = $('#away-message').value.trim().slice(0, 300) || defaults.awayMessage;
        saveSettings();
        toast('Script saved.');
        renderSettings();
      });
      form.querySelector('.delete-script').addEventListener('click', () => {
        state.settings.customScripts = scripts.filter(script => script.id !== form.dataset.scriptId);
        saveSettings();
        renderSettings();
      });
    });
  } else {
    const colors = appearanceColors();
    content.innerHTML = `
      <div class="settings-section"><span class="eyebrow">PERSONALIZE</span><h3>Theme &amp; appearance</h3><p class="section-description">Choose a Harbor theme, then customize nickname colors and window surfaces. Preferences stay on this device.</p>
      <label class="field-label" for="color-scheme">Theme</label><select class="text-field" id="color-scheme"><option value="harbor">Harbor green</option><option value="midnight">Midnight blue</option><option value="violet">Violet dusk</option><option value="ember">Ember</option><option value="custom">Custom</option></select>
      <div class="field-row"><div><label class="field-label" for="chat-window-color">Chat window</label><div class="color-control"><input id="chat-window-color" type="color" value="${escapeAttribute(colors.chat)}" /><span>${escapeHtml(colors.chat.toUpperCase())}</span></div></div><div><label class="field-label" for="panel-window-color">Panel windows</label><div class="color-control"><input id="panel-window-color" type="color" value="${escapeAttribute(colors.panel)}" /><span>${escapeHtml(colors.panel.toUpperCase())}</span></div></div></div>
      <label class="field-label">Nickname color palette</label><div class="nick-color-controls">${colors.nicks.map((color, index) => `<label class="color-control" aria-label="Nickname color ${index + 1}"><input type="color" data-nick-color="${index}" value="${escapeAttribute(color)}" /><span>${escapeHtml(color.toUpperCase())}</span></label>`).join('')}</div>
      <div class="range-label"><label class="field-label" for="image-dim">Image dimming</label><span id="dim-value">${escapeHtml(localStorage.getItem('harbor-dim') || '42')}%</span></div><input class="range-control" id="image-dim" type="range" min="0" max="85" value="${escapeAttribute(localStorage.getItem('harbor-dim') || '42')}" />
      <div class="image-picker"><div class="image-picker-copy"><strong>Background image</strong><span>PNG, JPEG, WebP or GIF · up to 4 MB</span></div><button type="button" class="secondary-button" id="choose-image"><span class="icon icon-image"></span> Choose image</button></div>
      <button type="button" class="text-button remove-image" id="remove-image">Remove background image</button>
      <button type="button" class="text-button" id="reset-appearance">Reset color scheme and custom colors</button>
      <div class="appearance-preview" id="appearance-preview"><span>CHAT PREVIEW</span><div><b>alex</b> &nbsp;Looks good in here.</div></div>
      </div>`;
    $('#color-scheme').value = getAppearance().theme;
    $('#color-scheme').addEventListener('change', event => {
      setAppearance({ theme: event.target.value, custom: {} });
      renderSettings();
    });
    $('#chat-window-color').addEventListener('input', event => setAppearanceColor('chat', event.target.value));
    $('#panel-window-color').addEventListener('input', event => setAppearanceColor('panel', event.target.value));
    $$('[data-nick-color]').forEach(input => input.addEventListener('input', event => {
      const index = Number(event.currentTarget.dataset.nickColor);
      const nextColors = appearanceColors().nicks.slice();
      nextColors[index] = event.currentTarget.value;
      setAppearanceColor('nicks', nextColors);
    }));
    $('#reset-appearance').addEventListener('click', () => {
      setAppearance({ theme: 'harbor', custom: {} });
      renderSettings();
    });
    $('#image-dim').addEventListener('input', event => setDim(event.target.value));
    $('#choose-image').addEventListener('click', () => imageInput.click());
    $('#remove-image').addEventListener('click', clearBackgroundImage);
    updatePreview();
  }
}

function renderScriptCard(script) {
  const containsTrigger = script.trigger === 'message-contains';
  return `<form class="script-card" data-script-id="${escapeAttribute(script.id)}">
    <div class="script-card-header"><strong>Rule</strong><button type="button" class="text-button delete-script">Delete</button></div>
    <label class="field-label">Script name</label><input class="text-field script-name" name="name" maxlength="60" required value="${escapeAttribute(script.name)}" />
    <label class="field-label">When to run</label><select class="text-field" name="trigger">
      <option value="private-message" ${script.trigger === 'private-message' ? 'selected' : ''}>When I receive a private message</option>
      <option value="message-contains" ${containsTrigger ? 'selected' : ''}>When a message contains a phrase</option>
      <option value="channel-join" ${script.trigger === 'channel-join' ? 'selected' : ''}>When I join a channel</option>
    </select>
    <div class="script-condition${containsTrigger ? '' : ' hidden'}"><label class="field-label">Phrase to match</label><input class="text-field" name="contains" maxlength="120" value="${escapeAttribute(script.contains)}" placeholder="e.g. hello there" /></div>
    <label class="field-label">Limit to channel <span class="optional">OPTIONAL · EXACT NAME</span></label><input class="text-field" name="channel" maxlength="100" value="${escapeAttribute(script.channel)}" placeholder="#channel" />
    <label class="field-label">Reply message</label><textarea class="text-field script-response" name="response" maxlength="400" required placeholder="Hi {nick}! I’m away right now.">${escapeHtml(script.response)}</textarea>
    <label class="remember-password"><input type="checkbox" name="enabled" ${script.enabled ? 'checked' : ''} /><span>Enable this rule</span></label>
    <label class="remember-password"><input type="checkbox" name="onlyWhileAway" ${script.onlyWhileAway ? 'checked' : ''} /><span>Only run while I’m marked away</span></label>
    <label class="field-label">Cooldown per sender/channel (seconds, 30–86400)</label><input class="text-field" name="cooldownSeconds" type="number" min="30" max="86400" value="${escapeAttribute(script.cooldownSeconds)}" />
    <button class="secondary-button" type="submit">Save script</button>
  </form>`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}
function escapeAttribute(value) { return escapeHtml(value); }
const colorSchemes = {
  harbor: { canvas: '#151a18', panel: '#1d2421', raised: '#242c28', line: '#303a34', mint: '#a9d4b9', lime: '#d4e5a4', chat: '#141918', nicks: ['#8dd7b5', '#71b8df', '#e7bd70', '#d898cf'] },
  midnight: { canvas: '#111722', panel: '#192231', raised: '#222f41', line: '#34445a', mint: '#8ec5ff', lime: '#a8d8ff', chat: '#111925', nicks: ['#78c8f0', '#a6a2ff', '#77d6ba', '#f1bd76'] },
  violet: { canvas: '#191522', panel: '#241d30', raised: '#30263e', line: '#463753', mint: '#d0a8f0', lime: '#e2c1fa', chat: '#181320', nicks: ['#d4a1f5', '#83c6ee', '#e8a0b9', '#b7d78a'] },
  ember: { canvas: '#1c1715', panel: '#29201c', raised: '#382a23', line: '#4b3930', mint: '#edb58b', lime: '#f0d08e', chat: '#191412', nicks: ['#f0a26e', '#e8cf78', '#e8899a', '#91c7a4'] }
};
function getAppearance() {
  try {
    const saved = JSON.parse(localStorage.getItem('harbor-appearance') || '{}');
    return {
      theme: Object.hasOwn(colorSchemes, saved.theme) || saved.theme === 'custom' ? saved.theme : 'harbor',
      custom: saved.custom && typeof saved.custom === 'object' ? saved.custom : {}
    };
  } catch {
    return { theme: 'harbor', custom: {} };
  }
}
function appearanceColors() {
  const appearance = getAppearance();
  const base = colorSchemes[appearance.theme] || colorSchemes.harbor;
  const custom = appearance.custom;
  return {
    ...base,
    chat: /^#[0-9a-f]{6}$/i.test(custom.chat || '') ? custom.chat : base.chat,
    panel: /^#[0-9a-f]{6}$/i.test(custom.panel || '') ? custom.panel : base.panel,
    nicks: base.nicks.map((color, index) => /^#[0-9a-f]{6}$/i.test(custom.nicks?.[index] || '') ? custom.nicks[index] : color)
  };
}
function setAppearance(appearance) {
  localStorage.setItem('harbor-appearance', JSON.stringify(appearance));
  applyBackground();
  updatePreview();
  renderMessages();
  renderMembers();
}
function setAppearanceColor(key, value) {
  if (key !== 'nicks' && !/^#[0-9a-f]{6}$/i.test(value)) return;
  const appearance = getAppearance();
  appearance.theme = 'custom';
  appearance.custom[key] = value;
  setAppearance(appearance);
  if (key === 'chat' || key === 'panel') {
    const control = $(`#${key}-window-color`);
    control.nextElementSibling.textContent = value.toUpperCase();
  } else {
    $$('[data-nick-color]').forEach(input => {
      input.nextElementSibling.textContent = input.value.toUpperCase();
    });
  }
}
function nicknameColor(nick) {
  const palette = appearanceColors().nicks;
  let hash = 0;
  for (const character of nick.toLowerCase()) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return palette[hash % palette.length];
}
function applyBackground() {
  const colors = appearanceColors();
  const savedDim = Number(localStorage.getItem('harbor-dim') || 42);
  const dim = Number.isFinite(savedDim) ? Math.max(0, Math.min(85, savedDim)) : 42;
  for (const [property, value] of [
    ['--canvas', colors.canvas], ['--panel', colors.panel], ['--panel-raised', colors.raised],
    ['--line', colors.line], ['--mint', colors.mint], ['--lime', colors.lime],
    ['--chat-background', colors.chat], ['--panel-window', colors.panel]
  ]) document.documentElement.style.setProperty(property, value);
  colors.nicks.forEach((color, index) => document.documentElement.style.setProperty(`--nick-${index + 1}`, color));
  document.documentElement.style.setProperty('--image-dim', `${dim}%`);
  document.documentElement.style.setProperty('--background-image', state.imageUrl ? `url("${state.imageUrl}")` : 'none');
}
function setBackgroundColor(color) {
  setAppearanceColor('chat', color);
}
function setDim(value) {
  const dim = Math.max(0, Math.min(85, Number(value) || 0));
  localStorage.setItem('harbor-dim', String(dim));
  $('#dim-value').textContent = `${dim}%`;
  applyBackground();
  updatePreview();
}
function updatePreview() {
  const preview = $('#appearance-preview');
  if (!preview) return;
  const colors = appearanceColors();
  preview.style.backgroundColor = colors.chat;
  preview.style.color = colors.nicks[0];
  const nick = preview.querySelector('b');
  if (nick) nick.style.color = nicknameColor(nick.textContent);
}

function openImageDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('harbor-local-assets', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('backgrounds');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
async function saveImage(blob) {
  const db = await openImageDatabase();
  await new Promise((resolve, reject) => {
    const transaction = db.transaction('backgrounds', 'readwrite');
    transaction.objectStore('backgrounds').put(blob, 'active');
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
  });
  db.close();
  await loadImage();
}
async function loadImage() {
  try {
    const db = await openImageDatabase();
    const blob = await new Promise((resolve, reject) => {
      const request = db.transaction('backgrounds').objectStore('backgrounds').get('active');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    db.close();
    if (blob) {
      state.imageUrl = URL.createObjectURL(blob);
      state.imageObjectUrl = state.imageUrl;
      applyBackground();
    }
  } catch { toast('The saved background image could not be loaded.', 'error'); }
}
async function clearBackgroundImage() {
  const db = await openImageDatabase();
  await new Promise((resolve, reject) => {
    const transaction = db.transaction('backgrounds', 'readwrite');
    transaction.objectStore('backgrounds').delete('active');
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
  });
  db.close();
  if (state.imageObjectUrl) URL.revokeObjectURL(state.imageObjectUrl);
  state.imageUrl = '';
  state.imageObjectUrl = '';
  applyBackground();
  updatePreview();
}
imageInput.addEventListener('change', async () => {
  const file = imageInput.files?.[0];
  imageInput.value = '';
  if (!file) return;
  if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type) || file.size > 4 * 1024 * 1024) {
    toast('Choose a PNG, JPEG, WebP or GIF image under 4 MB.', 'error');
    return;
  }
  if (!state.active) {
    toast('Join a channel with /join #channel before sending a message.');
    input.value = text;
    return;
  }
  try {
    const bitmap = await createImageBitmap(file);
    const safeDimensions = bitmap.width <= 6000 && bitmap.height <= 6000;
    bitmap.close();
    if (!safeDimensions) throw new Error('Image dimensions are too large. Choose an image under 6000 × 6000 pixels.');
    await saveImage(file);
    updatePreview();
    toast('Background image saved on this device.');
  } catch (error) { toast(error.message || 'The image could not be opened.', 'error'); }
});

function addConversation(target, { timestamp = new Date(), nick = '', text, kind = 'message', action = false, self = false, numeric = '', actorNicks = [] } = {}) {
  if ((!target && kind !== 'system') || typeof text !== 'string') return;
  if (!state.conversations.has(target)) state.conversations.set(target, []);
  const messages = state.conversations.get(target);
  messages.push({ timestamp, nick, text, kind, action, self, numeric, actorNicks });
  if (messages.length > 600) messages.splice(0, messages.length - 600);
  if (state.active === target) renderMessages();
}
function noteRecentTalker(target, nick) {
  if (!target || !nick || nick.toLowerCase() === state.nick.toLowerCase()) return;
  const recent = state.recentTalkers.get(target) || [];
  state.recentTalkers.set(target, [nick, ...recent.filter(name => name.toLowerCase() !== nick.toLowerCase())].slice(0, 100));
}
function completeNickname(input) {
  const cursor = input.selectionStart ?? input.value.length;
  const value = input.value;
  let start;
  let prefix;
  let candidates;

  if (tabCompletion && value === tabCompletion.lastValue && cursor === tabCompletion.lastCursor) {
    start = tabCompletion.start;
    candidates = tabCompletion.candidates;
    tabCompletion.index = (tabCompletion.index + 1) % candidates.length;
  } else {
    const beforeCursor = value.slice(0, cursor);
    const token = beforeCursor.match(/(?:^|[\s,:])([^\s,:]+)$/);
    if (!token || !/^[A-Za-z\[\]\\`_^{|}][A-Za-z0-9\-\[\]\\`_^{|}]*$/.test(token[1])) return;
    prefix = token[1].toLowerCase();
    start = cursor - token[1].length;
    const ordered = [
      ...(state.recentTalkers.get(state.active) || []),
      ...(state.users.get(state.active) || []),
      ...((state.conversations.get(state.active) || []).slice().reverse().map(message => message.nick))
    ];
    const seen = new Set();
    candidates = ordered.filter(name => {
      const key = name.toLowerCase();
      if (key === state.nick.toLowerCase() || seen.has(key) || !key.startsWith(prefix)) return false;
      seen.add(key);
      return true;
    });
    if (!candidates.length) return;
    tabCompletion = { start, candidates, index: 0 };
  }

  const nick = candidates[tabCompletion.index];
  const suffix = value.slice(cursor);
  const insertion = `${nick}${start === 0 && !suffix ? ': ' : ' '}`;
  input.setRangeText(insertion, start, cursor, 'end');
  tabCompletion.lastValue = input.value;
  tabCompletion.lastCursor = input.selectionStart;
}
function renderMessages() {
  messageList.replaceChildren();
  const messages = state.conversations.get(state.active) || [];
  if (!state.active && !state.connected && !messages.length) {
    messageList.innerHTML = '<div class="welcome-state"><div class="welcome-glyph">H</div><div class="eyebrow">YOUR IRC DESKTOP</div><h3>A quieter place to chat.</h3><p>Connect to a network, join a channel, and pick up the conversation.</p><button class="primary-button" id="welcome-connect"><span class="icon icon-plug"></span> Connect to a server</button></div>';
    $('#welcome-connect').addEventListener('click', () => openSettings('connection'));
    return;
  }
  if (!messages.length) {
    const empty = document.createElement('div');
    empty.className = 'channel-empty';
    empty.textContent = state.active === connectionView
      ? 'Connection activity, server replies, and CTCP requests will appear here.'
      : state.connected && !state.active
      ? `Connected to ${state.server} as ${state.nick}. Join a channel with /join #channel to start chatting.`
      : state.connected ? 'You’re connected. Say hello.' : 'Connect to an IRC network to start chatting.';
    messageList.append(empty);
    return;
  }
  for (const message of messages) {
    const row = document.createElement('article');
    row.className = `message-row ${message.kind}${message.self ? ' self' : ''}`;
    const time = document.createElement('time');
    time.textContent = message.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    row.append(time);
    if (message.kind === 'message' || message.kind === 'notice') {
      const body = document.createElement('div');
      body.className = 'message-body';
      const authorWrap = document.createElement('span');
      authorWrap.className = 'message-author-wrap';
      const author = document.createElement('button');
      author.type = 'button';
      author.className = 'message-author';
      author.setAttribute('aria-haspopup', 'menu');
      author.setAttribute('aria-expanded', 'false');
      author.textContent = message.action ? `* ${message.nick}` : message.nick;
      author.style.color = nicknameColor(message.nick);
      const menu = createUserActionMenu(message.nick);
      author.addEventListener('click', () => toggleUserActionMenu(author, menu));
      authorWrap.append(author, menu);
      const text = document.createElement('span');
      text.className = 'message-text';
      appendSafeText(text, message.text);
      body.append(authorWrap, text);
      row.append(body);
    } else {
      const text = document.createElement('span');
      text.className = 'system-text';
      if (message.numeric && message.actorNicks?.length) {
        const nick = message.actorNicks[0];
        const start = message.text.indexOf(nick);
        if (start >= 0) {
          text.append(document.createTextNode(message.text.slice(0, start)), createNickActionButton(nick));
          appendWhoisText(text, message.text.slice(start + nick.length));
        } else appendWhoisText(text, message.text);
      } else if (message.numeric) appendWhoisText(text, message.text);
      else appendSystemText(text, message);
      row.append(text);
    }
    messageList.append(row);
  }
  messageList.scrollTop = messageList.scrollHeight;
}
function createNickActionButton(nick) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'system-nick';
  button.setAttribute('aria-haspopup', 'dialog');
  button.setAttribute('aria-expanded', 'false');
  button.textContent = nick;
  button.style.color = nicknameColor(nick);
  const menu = createUserActionMenu(nick);
  button.addEventListener('click', () => toggleUserActionMenu(button, menu));
  return button;
}
function appendSystemText(container, message) {
  const nicknames = (message.actorNicks || []).filter(Boolean);
  let cursor = 0;
  for (const nick of nicknames) {
    const start = message.text.indexOf(nick, cursor);
    if (start < 0) continue;
    container.append(document.createTextNode(message.text.slice(cursor, start)), createNickActionButton(nick));
    cursor = start + nick.length;
  }
  container.append(document.createTextNode(message.text.slice(cursor)));
}
function createUserActionMenu(nick) {
  const backdrop = document.createElement('div');
  backdrop.className = 'user-action-backdrop hidden';
  backdrop.addEventListener('click', event => {
    if (event.target === backdrop) closeUserActionMenus(true);
  });
  backdrop.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      closeUserActionMenus(true);
      return;
    }
    if (event.key === 'Tab') {
      const buttons = [...backdrop.querySelectorAll('button')];
      const first = buttons[0];
      const last = buttons[buttons.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  });

  const menu = document.createElement('section');
  menu.className = 'user-action-menu';
  menu.setAttribute('role', 'dialog');
  menu.setAttribute('aria-modal', 'true');
  menu.setAttribute('aria-label', `Actions for ${nick}`);

  const heading = document.createElement('h2');
  heading.className = 'user-action-heading';
  heading.textContent = `Actions for ${nick}`;
  menu.append(heading);

  for (const [action, label] of [
    ['message', 'Send message'], ['whois', 'WHOIS'], ['ctcp-ping', 'CTCP PING'],
    ['ctcp-version', 'CTCP VERSION'], ['notice', 'Send notice']
  ]) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.addEventListener('click', () => runMemberAction(action, nick));
    menu.append(button);
  }
  backdrop.append(menu);
  return backdrop;
}
function closeUserActionMenus(restoreFocus = false) {
  const backdrops = [...document.querySelectorAll('.user-action-backdrop')];
  const trigger = backdrops[0]?.trigger;
  backdrops.forEach(backdrop => {
    backdrop.classList.add('hidden');
    backdrop.remove();
  });
  document.querySelectorAll('[aria-expanded="true"]').forEach(item => item.setAttribute('aria-expanded', 'false'));
  if (restoreFocus && trigger?.isConnected) trigger.focus();
}
function toggleUserActionMenu(trigger, menu) {
  const open = menu.classList.contains('hidden');
  closeUserActionMenus();
  if (open) {
    menu.trigger = trigger;
    document.body.append(menu);
    menu.classList.remove('hidden');
    menu.querySelector('button').focus();
  }
  trigger.setAttribute('aria-expanded', String(open));
}
function appendSafeText(container, text) {
  text = text.replace(/\x03(?:\d{1,2}(?:,\d{1,2})?)?|\x04(?:[0-9a-f]{6}(?:,[0-9a-f]{6})?)?|[\x02\x0f\x11\x16\x1d\x1e\x1f]/gi, '');
  const linkPattern = /https?:\/\/[^\s<>]+/gi;
  let cursor = 0;
  for (const match of text.matchAll(linkPattern)) {
    const start = match.index;
    const urlText = match[0].replace(/[.,!?;:)\]]+$/, '');
    if (!urlText) continue;
    container.append(document.createTextNode(text.slice(cursor, start)));
    const link = document.createElement('button');
    link.className = 'message-link';
    link.type = 'button';
    link.textContent = urlText;
    link.addEventListener('click', () => window.harbor.openExternal(urlText).catch(error => toast(error.message, 'error')));
    container.append(link, document.createTextNode(match[0].slice(urlText.length)));
    cursor = start + match[0].length;
  }
  container.append(document.createTextNode(text.slice(cursor)));
}
function appendWhoisText(container, text) {
  const addressPattern = /(?<![\w.])(?:\[[\da-f:.]+(?:%[a-z\d_.-]+)?\]|[\da-f:.]+(?:%[a-z\d_.-]+)?)(?![\w.])/gi;
  let cursor = 0;
  for (const match of text.matchAll(addressPattern)) {
    const token = match[0];
    const bracketed = token.startsWith('[') && token.endsWith(']');
    const address = bracketed ? token.slice(1, -1) : token;
    let formatted;
    const octets = address.split('.');
    if (octets.length === 4 && octets.every(part => /^\d{1,3}$/.test(part) && Number(part) <= 255)) {
      formatted = octets.map(Number).join('.');
    } else {
      const zoneIndex = address.indexOf('%');
      const baseAddress = zoneIndex < 0 ? address : address.slice(0, zoneIndex);
      try {
        const normalized = new URL(`http://[${baseAddress}]/`).hostname;
        if (normalized.startsWith('[') && normalized.endsWith(']')) {
          formatted = `${normalized.slice(1, -1)}${zoneIndex < 0 ? '' : address.slice(zoneIndex)}`;
        }
      } catch {}
    }
    if (!formatted) continue;
    const start = match.index;
    container.append(document.createTextNode(text.slice(cursor, start)));
    const addressElement = document.createElement('bdi');
    addressElement.className = 'whois-ip';
    addressElement.dir = 'ltr';
    addressElement.textContent = formatted.includes(':') ? `[${formatted}]` : formatted;
    addressElement.title = formatted.includes(':') ? 'IPv6 address' : 'IPv4 address';
    container.append(addressElement);
    cursor = start + token.length;
  }
  container.append(document.createTextNode(text.slice(cursor)));
}
function selectConversation(target) {
  state.active = target;
  $('#active-title').textContent = target === connectionView ? 'Connection' : target || (state.connected ? state.server : 'Welcome');
  $('#channel-symbol').textContent = target === connectionView ? '↔' : target.startsWith('#') ? '#' : target ? '@' : '';
  $('#active-topic').textContent = target === connectionView
    ? `Server replies and CTCP activity${state.server ? ` · ${state.server}` : ''}`
    : target ? (state.connected ? `Conversation on ${state.server}` : 'Not connected')
      : state.connected ? `Connected securely as ${state.nick}. Join a channel to start chatting.` : 'Connect to an IRC network to begin chatting.';
  $('#message-input').placeholder = target === connectionView
    ? 'Connection log · use /join #channel to join'
    : target ? `Message ${target}` : state.connected ? '/join #channel to start chatting' : 'Connect to start chatting';
  renderChannels();
  renderMessages();
  renderMembers();
}
function renderChannels() {
  const list = $('#channel-list');
  list.replaceChildren();
  for (const channel of state.channels) {
    const button = document.createElement('button');
    button.className = `channel-item${channel === state.active ? ' active' : ''}`;
    button.type = 'button';
    button.innerHTML = '<span class="channel-item-hash">#</span><span class="channel-item-name"></span><span class="channel-unread"></span>';
    button.querySelector('.channel-item-name').textContent = channel.replace(/^[#&+!]/, '');
    button.addEventListener('click', () => selectConversation(channel));
    list.append(button);
  }
  if (!state.channels.length) {
    const empty = document.createElement('div');
    empty.className = 'sidebar-empty';
    empty.textContent = state.connected ? 'No channels joined yet.' : 'Your channels will appear here.';
    list.append(empty);
  }
  $('#connection-view').classList.toggle('active', state.active === connectionView);
}
function renderMembers() {
  const names = state.users.get(state.active) || [];
  const modes = state.memberModes.get(state.active) || new Map();
  $('#member-count').textContent = String(names.length);
  const list = $('#member-list');
  list.replaceChildren();
  if (!names.length) {
    const empty = document.createElement('span');
    empty.className = 'empty-members';
    empty.textContent = state.active === connectionView
      ? 'Server and CTCP activity is shown in the connection log.'
      : 'Join a channel to see who’s here.';
    list.append(empty);
    return;
  }
  const standardGroupOrder = [
    ['q', 'Owners (+q)'], ['a', 'Admins (+a)'], ['o', 'Operators (+o)'],
    ['h', 'Half-operators (+h)'], ['v', 'Voiced (+v)']
  ];
  const groups = new Map([...standardGroupOrder, ['', 'Members']].map(([mode, label]) => [mode, { label, members: [] }]));
  for (const name of names) {
    const memberModeSet = modes.get(name.toLowerCase()) || new Set();
    const groupMode = standardGroupOrder.find(([mode]) => memberModeSet.has(mode))?.[0] ||
      [...memberModeSet].sort((a, b) => modeRank(a) - modeRank(b))[0] || '';
    if (groupMode && !groups.has(groupMode)) groups.set(groupMode, { label: `Other status (+${groupMode})`, members: [] });
    groups.get(groupMode).members.push({ name, modes: memberModeSet });
  }
  const orderedGroups = [
    ...standardGroupOrder.map(([mode]) => [mode, groups.get(mode)]),
    ...[...groups].filter(([mode]) => mode && !standardGroupOrder.some(([standard]) => standard === mode))
      .sort(([a], [b]) => modeRank(a) - modeRank(b)),
    ['', groups.get('')]
  ];
  for (const [, { label, members }] of orderedGroups) {
    if (!members.length) continue;
    const heading = document.createElement('div');
    heading.className = 'member-group-heading';
    heading.textContent = `${label} · ${members.length}`;
    list.append(heading);
    for (const { name, modes: memberModeSet } of members.sort((a, b) => a.name.localeCompare(b.name))) {
      const entry = document.createElement('div');
      entry.className = 'member-entry';
      const row = document.createElement('button');
      row.className = 'member-item';
      row.type = 'button';
      row.setAttribute('aria-haspopup', 'menu');
      row.setAttribute('aria-expanded', 'false');
      const avatar = document.createElement('span');
      avatar.className = 'member-avatar';
      avatar.textContent = name.slice(0, 1).toUpperCase();
      avatar.style.backgroundColor = nicknameColor(name);
      avatar.style.color = appearanceColors().canvas;
      const labelElement = document.createElement('span');
      labelElement.className = 'member-nick';
      labelElement.textContent = name;
      labelElement.style.color = nicknameColor(name);
      row.append(avatar, labelElement);
      for (const memberMode of [...memberModeSet].sort((a, b) => modeRank(a) - modeRank(b))) {
        const badge = document.createElement('span');
        badge.className = 'member-mode-badge';
        badge.textContent = `+${memberMode}`;
        badge.title = modeDescription(memberMode);
        row.append(badge);
      }
      const menu = createUserActionMenu(name);
      row.addEventListener('click', () => toggleUserActionMenu(row, menu));
      entry.append(row, menu);
      list.append(entry);
    }
  }
}
function modeRank(mode) {
  return ({ q: 0, a: 1, o: 2, h: 3, v: 4 })[mode] ?? 5;
}
function modeDescription(mode) {
  return ({ q: 'Owner', a: 'Administrator', o: 'Operator', h: 'Half-operator', v: 'Voiced' })[mode] || `Mode +${mode}`;
}
function memberModeMap(channel) {
  if (!state.memberModes.has(channel)) state.memberModes.set(channel, new Map());
  return state.memberModes.get(channel);
}
async function runMemberAction(action, nick) {
  closeUserActionMenus();
  try {
    if (action === 'message') {
      if (!state.channels.includes(nick)) state.channels.push(nick);
      if (!state.users.has(nick)) state.users.set(nick, []);
      selectConversation(nick);
      $('#message-input').focus();
    } else if (action === 'whois') {
      selectConversation(connectionView);
      addConversation(connectionView, { kind: 'system', text: `WHOIS requested for ${nick}.` });
      await window.harbor.rawCommand(`WHOIS ${nick}`);
    } else if (action === 'ctcp-ping' || action === 'ctcp-version') {
      selectConversation(connectionView);
      await window.harbor.ctcp(nick, action === 'ctcp-ping' ? 'PING' : 'VERSION');
    } else if (action === 'notice') {
      const text = prompt(`Notice to ${nick}:`);
      if (text) await window.harbor.notice(nick, text);
    }
  } catch (error) {
    toast(error.message || 'Could not run that user command.', 'error');
    addConversation(connectionView, { kind: 'system', text: `Command failed for ${nick}: ${error.message || 'Unknown error.'}` });
  }
}
function setConnectionStatus(status, detail = '') {
  state.connected = status === 'connected';
  state.connecting = status === 'connecting';
  $('#connection-pill').className = `connection-pill ${status}`;
  $('#connection-pill').innerHTML = `<i></i>${status === 'connected' ? 'Connected' : status === 'connecting' ? 'Connecting' : 'Offline'}`;
  $('#server-led').className = `server-led ${status}`;
  $('#server-name').textContent = state.connected ? state.server : state.connecting ? 'Connecting…' : 'Not connected';
  $('#server-detail').textContent = state.connected ? `TLS · ${state.nick}` : detail || (state.connecting ? 'Establishing secure connection' : 'Choose a server to get started');
  $('#active-title').textContent = state.active === connectionView ? 'Connection' : state.active || (state.connected ? state.server : 'Welcome');
  $('#active-topic').textContent = state.active === connectionView
    ? `Server replies and CTCP activity${state.server ? ` · ${state.server}` : ''}`
    : state.active
    ? (state.connected ? `Conversation on ${state.server}` : 'Not connected')
    : state.connected ? `Connected securely as ${state.nick}. Join a channel to start chatting.` : 'Connect to an IRC network to begin chatting.';
  $('#message-input').disabled = !state.connected;
  $('#message-input').placeholder = state.connected
    ? (state.active === connectionView ? 'Connection log · use /join #channel to join' : state.active ? `Message ${state.active}` : '/join #channel to start chatting')
    : 'Connect to start chatting';
  $('#message-form button[type="submit"]').disabled = !state.connected;
  $('#emoji-button').disabled = !state.connected;
  $('#leave-channel').disabled = !state.connected || !state.active || !state.active.startsWith('#');
  if (state.settingsOpen && state.settingsTab === 'connection') renderSettings();
  renderChannels();
  renderMessages();
}
async function connectFromForm(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const channels = String(form.get('channels') || '').split(',').map(value => value.trim()).filter(Boolean);
  state.settings = {
    host: String(form.get('host') || '').trim(), port: String(form.get('port') || '').trim(),
    nick: String(form.get('nick') || '').trim(), username: String(form.get('username') || '').trim(),
    channels: channels.join(', '),
    backupNicks: String(form.get('backupNicks') || '').split(',').map(value => value.trim()).filter(Boolean).join(', '),
    authMethod: String(form.get('authMethod') || 'none'),
    authAccount: String(form.get('authAccount') || '').trim(),
    rememberAuthPassword: form.get('rememberAuthPassword') === 'on',
    requireAuthentication: form.get('requireAuthentication') === 'on',
    requireAuthenticationByServer: state.settings.requireAuthenticationByServer || {},
    quitMessage: String(form.get('quitMessage') || '').trim() || defaults.quitMessage
  };
  const requiredByServer = { ...(state.settings.requireAuthenticationByServer || {}) };
  requiredByServer[authenticationServerKey(state.settings.host, state.settings.port)] = state.settings.requireAuthentication;
  state.settings.requireAuthenticationByServer = requiredByServer;
  state.server = state.settings.host;
  saveSettings();
  if (state.connected) {
    try {
      await window.harbor.rememberAuthPassword({
        remember: state.settings.rememberAuthPassword,
        password: String(form.get('authPassword') || ''),
        host: state.settings.host,
        authMethod: state.settings.authMethod,
        authAccount: state.settings.authAccount,
        nick: state.settings.nick
      });
      toast('Settings saved. Disconnect to apply server changes.');
      closeSettings();
    } catch (error) {
      toast(error.message || 'Could not update saved password.', 'error');
    }
    return;
  }
  setConnectionStatus('connecting');
  try {
    const authPassword = String(form.get('authPassword') || '');
    if (state.settings.authMethod !== 'none') {
      await window.harbor.rememberAuthPassword({
        remember: state.settings.rememberAuthPassword,
        password: authPassword,
        host: state.settings.host,
        authMethod: state.settings.authMethod,
        authAccount: state.settings.authAccount,
        nick: state.settings.nick
      });
      if (state.settings.rememberAuthPassword) {
        toast(authPassword
          ? 'Authentication password saved securely on this device.'
          : 'Saved authentication password verified for this connection.');
      }
    }
    const request = window.harbor.connect({
      ...state.settings, channels,
      backupNicks: state.settings.backupNicks.split(',').map(value => value.trim()).filter(Boolean),
      password: String(form.get('password') || ''),
      authPassword,
      rememberAuthPassword: state.settings.rememberAuthPassword
    });
    await request;
    $('#password').value = '';
    $('#auth-password').value = '';
  } catch (error) {
    setConnectionStatus('offline', 'Connection failed');
    toast(error.message || 'Could not connect.', 'error');
  }
}
async function joinChannel(channel) {
  const value = channel.trim();
  if (!value) return;
  try { await window.harbor.join(value); }
  catch (error) { toast(error.message, 'error'); }
}
function promptJoin() {
  if (!state.connected) { openSettings('connection'); return; }
  const channel = prompt('Channel name, such as #help:');
  if (channel) joinChannel(channel);
}
async function submitMessage(event) {
  event.preventDefault();
  const input = $('#message-input');
  const text = input.value.trim();
  if (!text || !state.connected) return;
  input.value = '';
  if (text.startsWith('/')) {
    const [command, ...args] = text.slice(1).split(' ');
    const rest = args.join(' ').trim();
    try {
      if (command.toLowerCase() === 'join') await joinChannel(args[0] || '');
      else if (command.toLowerCase() === 'part') {
        const channel = args[0] || (state.active === connectionView ? '' : state.active);
        if (!channel) throw new Error('Usage: /part #channel [reason]');
        await window.harbor.part(channel, args.slice(args[0] ? 1 : 0).join(' '));
      }
      else if (command.toLowerCase() === 'nick') await window.harbor.changeNick(args[0] || '');
      else if (command.toLowerCase() === 'away') {
        const reason = rest.slice(0, 300);
        await window.harbor.rawCommand(reason ? `AWAY :${reason}` : 'AWAY');
        state.away = Boolean(reason);
        if (state.settingsOpen && state.settingsTab === 'scripts') renderSettings();
      }
      else if (['quit', 'disconnect'].includes(command.toLowerCase())) await window.harbor.quit(rest || configuredQuitMessage());
      else if (command.toLowerCase() === 'me') {
        if (!state.active || state.active === connectionView) throw new Error('Join a channel or open a conversation before sending an action.');
        await window.harbor.message(state.active, rest, true);
      }
      else if (command.toLowerCase() === 'notice') {
        const target = args[0];
        const body = args.slice(1).join(' ');
        if (!target || !body) throw new Error('Usage: /notice nickname message');
        await window.harbor.notice(target, body);
      }
      else if (command.toLowerCase() === 'msg') {
        const target = args[0];
        const body = args.slice(1).join(' ');
        if (!target || !body) throw new Error('Usage: /msg nickname message');
        await window.harbor.message(target, body, false);
        if (!state.channels.includes(target)) state.channels.push(target);
        selectConversation(target);
      } else if (command.toLowerCase() === 'clear') {
        if (!state.active) throw new Error('Select a conversation before clearing it.');
        state.conversations.set(state.active, []);
        renderMessages();
      } else if (command.toLowerCase() === 'help') {
        addConversation(state.active, { kind: 'system', text: 'Commands: /join #channel · /part [#channel] · /nick name · /away [message] · /me action · /msg nick message · /notice nick message · /quit [reason] · /disconnect [reason] · /clear. Join a channel before sending a regular message.' });
      } else await window.harbor.rawCommand(`${command} ${rest}`.trim());
    } catch (error) { toast(error.message || 'Command failed.', 'error'); }
    return;
  }
  if (!state.active || state.active === connectionView) {
    toast('Choose a channel or private conversation before sending a message.');
    input.value = text;
    return;
  }
  try { await window.harbor.message(state.active, text, false); }
  catch (error) { toast(error.message || 'Message could not be sent.', 'error'); input.value = text; }
}

async function runCustomScripts(triggerEvent) {
  if (!state.connected || !triggerEvent.nick) return;
  const scripts = normalizeCustomScripts(state.settings.customScripts);
  const now = Date.now();
  for (const key of state.scriptCooldowns.keys()) {
    if (now - state.scriptCooldowns.get(key) > 86400000) state.scriptCooldowns.delete(key);
  }
  let attemptedReplies = 0;
  for (const script of scripts) {
    if (attemptedReplies >= 3) break;
    if (!script.enabled || (script.onlyWhileAway && !state.away)) continue;
    if (script.channel && script.channel.toLowerCase() !== String(triggerEvent.channel || '').toLowerCase()) continue;
    if (script.trigger === 'private-message' && !(triggerEvent.type === 'message' && triggerEvent.private)) continue;
    if (script.trigger === 'message-contains') {
      if (!script.contains || triggerEvent.type !== 'message' || triggerEvent.action ||
        !triggerEvent.text.toLowerCase().includes(script.contains.toLowerCase())) continue;
    }
    if (script.trigger === 'channel-join' &&
      (triggerEvent.type !== 'channel-join' || triggerEvent.nick.toLowerCase() !== state.nick.toLowerCase())) continue;

    const target = triggerEvent.type === 'channel-join'
      ? triggerEvent.channel
      : triggerEvent.private ? triggerEvent.nick : triggerEvent.target;
    if (!target) continue;
    const cooldownKey = `${script.id}:${triggerEvent.type === 'channel-join' ? target.toLowerCase() : `${triggerEvent.private ? 'private' : target.toLowerCase()}:${triggerEvent.nick.toLowerCase()}`}`;
    const previous = state.scriptCooldowns.get(cooldownKey) || 0;
    if (now - previous < script.cooldownSeconds * 1000) continue;
    const response = script.response
      .replace(/\{nick\}/gi, triggerEvent.nick)
      .replace(/\{channel\}/gi, triggerEvent.channel || '')
      .replace(/\{myNick\}/gi, state.nick)
      .replace(/\{message\}/gi, triggerEvent.text || '')
      .trim()
      .slice(0, 400);
    if (!response) continue;

    state.scriptCooldowns.set(cooldownKey, now);
    attemptedReplies++;
    try {
      await window.harbor.message(target, response, false);
    } catch (error) {
      if (state.scriptCooldowns.get(cooldownKey) === now) state.scriptCooldowns.delete(cooldownKey);
      toast(`Script “${script.name}” could not send its reply: ${error.message || 'message failed'}`, 'error');
    }
  }
}

window.harbor.onEvent(event => {
  if (!event || typeof event.type !== 'string') return;
  if (event.type === 'connecting') {
    state.away = false;
    setConnectionStatus('connecting');
    addConversation(connectionView, { kind: 'system', text: `Connecting securely to ${event.server} as ${event.nick}…`, actorNicks: [event.nick] });
  }
  else if (event.type === 'connected') {
    state.away = false;
    state.server = event.server;
    state.nick = event.nick;
    setConnectionStatus('connected');
    addConversation(connectionView, { kind: 'system', text: `Connected securely to ${event.server} as ${event.nick}.`, actorNicks: [event.nick] });
    if (!state.active) selectConversation(connectionView);
    closeSettings();
  } else if (event.type === 'disconnected') {
    state.away = false;
    setConnectionStatus('offline', event.reason || 'Disconnected');
    addConversation(connectionView, { kind: 'system', text: event.reason || 'Disconnected.' });
  } else if (event.type === 'error') {
    const message = event.message || 'Connection error.';
    toast(message, 'error');
    addConversation(connectionView, { kind: 'system', text: `Connection error: ${message}` });
  }
  else if (event.type === 'message') {
    const target = event.private ? event.nick : event.target;
    if (!target) return;
    if (!event.self) {
      void runCustomScripts({
        type: 'message', nick: event.nick || '', target,
        channel: event.private ? '' : event.target,
        private: Boolean(event.private), text: String(event.text || ''), action: Boolean(event.action),
        self: Boolean(event.self)
      });
    }
    if (!event.private) noteRecentTalker(target, event.nick);
    if (!state.channels.includes(target)) { state.channels.push(target); state.users.set(target, []); renderChannels(); }
    addConversation(target, { nick: event.nick || 'server', text: event.text, action: event.action, self: event.self });
    if (event.self && state.active !== target) selectConversation(target);
  } else if (event.type === 'notice' || event.type === 'server') {
    const whoisReply = event.type === 'server' && ['301', '311', '312', '313', '317', '318', '319', '330', '338', '340', '378', '379', '671'].includes(event.numeric);
    const whoisNick = whoisReply
      ? event.text.match(/^[A-Za-z\[\]\\`_^{|}][A-Za-z0-9\-\[\]\\`_^{|}]*/)?.[0]
      : '';
    addConversation(connectionView, {
      kind: whoisReply ? 'whois' : 'system',
      numeric: event.numeric || '',
      text: event.nick ? `Notice from ${event.nick}: ${event.text}` : event.text,
      actorNicks: event.nick
        ? [event.nick]
        : whoisNick ? [whoisNick] : []
    });
  } else if (event.type === 'ctcp') {
    const direction = event.direction === 'sent' ? 'Sent CTCP' : event.direction === 'response' ? 'CTCP response from' : 'CTCP request from';
    const payload = event.payload ? ` · ${event.payload}` : '';
    addConversation(connectionView, {
      kind: 'system',
      text: event.direction === 'sent'
        ? `${direction} ${event.command} to ${event.target}${payload}.`
        : `${direction} ${event.nick}: ${event.command}${payload}.`,
      actorNicks: [event.nick]
    });
  } else if (event.type === 'names') {
    const names = state.users.get(event.channel) || [];
    const modes = memberModeMap(event.channel);
    for (const member of event.names) {
      const nick = typeof member === 'string' ? member : member.nick;
      if (!nick) continue;
      if (typeof member === 'string') {
        if (!modes.has(nick.toLowerCase())) modes.set(nick.toLowerCase(), new Set());
      } else {
        modes.set(nick.toLowerCase(), new Set(member.modes || []));
      }
      if (!names.some(name => name.toLowerCase() === nick.toLowerCase())) names.push(nick);
    }
    state.users.set(event.channel, names);
    if (state.active === event.channel) renderMembers();
  } else if (event.type === 'memberModes') {
    const modes = memberModeMap(event.channel);
    for (const change of event.changes || []) {
      const key = change.nick.toLowerCase();
      if (!modes.has(key)) modes.set(key, new Set());
      if (change.adding) modes.get(key).add(change.mode);
      else modes.get(key).delete(change.mode);
    }
    if (state.active === event.channel) renderMembers();
  } else if (event.type === 'namesEnd') {
    if (state.active === event.channel) renderMembers();
  } else if (event.type === 'topic') {
    if (state.active === event.channel) $('#active-topic').textContent = event.topic || 'No topic set';
  } else if (event.type === 'join') {
    if (event.nick.toLowerCase() === state.nick.toLowerCase()) {
      if (!state.channels.includes(event.channel)) state.channels.push(event.channel);
      selectConversation(event.channel);
      addConversation(event.channel, { kind: 'system', text: `${event.nick} joined ${event.channel}.`, actorNicks: [event.nick] });
      void runCustomScripts({ type: 'channel-join', nick: event.nick, channel: event.channel });
    } else {
      const names = state.users.get(event.channel) || [];
      if (!names.some(name => name.toLowerCase() === event.nick.toLowerCase())) names.push(event.nick);
      state.users.set(event.channel, names);
      memberModeMap(event.channel).set(event.nick.toLowerCase(), new Set());
      addConversation(event.channel, { kind: 'system', text: `${event.nick} joined.`, actorNicks: [event.nick] });
      if (state.active === event.channel) renderMembers();
    }
  } else if (event.type === 'part') {
    const names = state.users.get(event.channel) || [];
    state.users.set(event.channel, names.filter(name => name.toLowerCase() !== event.nick.toLowerCase()));
    memberModeMap(event.channel).delete(event.nick.toLowerCase());
    addConversation(event.channel, { kind: 'system', text: `${event.nick} left${event.reason ? `: ${event.reason}` : '.'}`, actorNicks: [event.nick] });
    if (event.nick.toLowerCase() === state.nick.toLowerCase()) {
      state.channels = state.channels.filter(channel => channel !== event.channel);
      state.users.delete(event.channel);
      state.memberModes.delete(event.channel);
      if (state.active === event.channel) selectConversation(state.channels[0] || '');
    } else if (state.active === event.channel) renderMembers();
    renderChannels();
  } else if (event.type === 'nick') {
    state.users.forEach((names, channel) => {
      state.users.set(channel, names.map(name => name.toLowerCase() === event.oldNick.toLowerCase() ? event.nick : name));
      const modes = memberModeMap(channel);
      const previousModes = modes.get(event.oldNick.toLowerCase());
      if (previousModes) {
        modes.delete(event.oldNick.toLowerCase());
        modes.set(event.nick.toLowerCase(), previousModes);
      }
    });
    if (event.oldNick.toLowerCase() === state.nick.toLowerCase()) { state.nick = event.nick; setConnectionStatus('connected'); }
    addConversation(state.active, { kind: 'system', text: `${event.oldNick} is now known as ${event.nick}.`, actorNicks: [event.oldNick, event.nick] });
    renderMembers();
  } else if (event.type === 'quit') {
    state.users.forEach((names, channel) => {
      state.users.set(channel, names.filter(name => name.toLowerCase() !== event.nick.toLowerCase()));
      memberModeMap(channel).delete(event.nick.toLowerCase());
      addConversation(channel, { kind: 'system', text: `${event.nick} quit${event.reason ? `: ${event.reason}` : '.'}`, actorNicks: [event.nick] });
    });
    renderMembers();
  }
});

window.harbor.connectionState().then(connection => {
  if (connection.status === 'offline') return;
  state.server = connection.server;
  state.nick = connection.nick;
  setConnectionStatus(connection.status);
  if (connection.status === 'connected') {
    if (!state.active) selectConversation(connectionView);
    addConversation(connectionView, {
      kind: 'system',
      text: `Restored connection to ${connection.server} as ${connection.nick}.`,
      actorNicks: [connection.nick]
    });
  }
}).catch(error => {
  toast(error.message || 'Could not restore connection status.', 'error');
});

$('#rail-settings').addEventListener('click', () => openSettings('appearance'));
$('#rail-connect').addEventListener('click', () => openSettings('connection'));
$('#open-settings').addEventListener('click', () => openSettings('appearance'));
$('#server-menu').addEventListener('click', () => openSettings('connection'));
$('#connection-view').addEventListener('click', () => selectConversation(connectionView));
$('#close-settings').addEventListener('click', closeSettings);
$('#modal-backdrop').addEventListener('click', event => { if (event.target === $('#modal-backdrop')) closeSettings(); });
$('#modal-backdrop').addEventListener('keydown', event => { if (event.key === 'Escape') closeSettings(); });
$$('.settings-nav-item').forEach(button => button.addEventListener('click', () => { state.settingsTab = button.dataset.tab; renderSettings(); }));
$('#composer-join').addEventListener('click', promptJoin);
$('#message-form').addEventListener('submit', submitMessage);
const emojiPicker = $('#emoji-picker');
for (const emoji of emojiChoices) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'emoji-choice';
  button.textContent = emoji;
  button.setAttribute('aria-label', `Insert ${emoji}`);
  button.addEventListener('click', () => {
    const input = $('#message-input');
    const start = input.selectionStart ?? input.value.length;
    const end = input.selectionEnd ?? input.value.length;
    input.setRangeText(emoji, start, end, 'end');
    input.focus();
    emojiPicker.classList.add('hidden');
  });
  emojiPicker.append(button);
}
$('#emoji-button').addEventListener('click', () => emojiPicker.classList.toggle('hidden'));
document.addEventListener('click', event => {
  if (!event.target.closest('#emoji-button, #emoji-picker')) emojiPicker.classList.add('hidden');
});
$('#leave-channel').addEventListener('click', async () => {
  try { await window.harbor.part(state.active); }
  catch (error) { toast(error.message, 'error'); }
});
$('#message-input').addEventListener('keydown', event => {
  if (event.key === 'ArrowUp') event.preventDefault();
  if (event.key === 'Tab') {
    event.preventDefault();
    if (state.connected && state.active !== connectionView) completeNickname(event.currentTarget);
  } else if (event.key !== 'Shift') {
    tabCompletion = undefined;
  }
});
$('#message-input').addEventListener('input', () => { tabCompletion = undefined; });

applyBackground();
renderChannels();
selectConversation('');
loadImage();