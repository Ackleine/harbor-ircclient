const { app, BrowserWindow, ipcMain, net: electronNet, protocol, safeStorage, shell } = require('electron');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const tls = require('node:tls');
const net = require('node:net');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }
]);

let mainWindow;
let client;

function authPasswordFile(options) {
  const identity = options.authMethod === 'sasl' ? options.authAccount : options.nick;
  const key = `${options.host.toLowerCase()}\0${options.authMethod}\0${identity.toLowerCase()}`;
  const filename = crypto.createHash('sha256').update(key).digest('hex');
  return path.join(app.getPath('userData'), `auth-password-${filename}.bin`);
}

function readSavedAuthPassword(options) {
  const file = authPasswordFile(options);
  if (!fs.existsSync(file)) return '';
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('Windows secure storage is unavailable. Enter the password for this connection without saving it.');
  }
  return safeStorage.decryptString(fs.readFileSync(file));
}

function saveAuthPassword(options, password) {
  const file = authPasswordFile(options);
  if (!password) {
    if (fs.existsSync(file)) fs.unlinkSync(file);
    return;
  }
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('Windows secure storage is unavailable. The password was not saved.');
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporaryFile = `${file}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  try {
    fs.writeFileSync(temporaryFile, safeStorage.encryptString(password), { flag: 'wx' });
    fs.renameSync(temporaryFile, file);
    if (readSavedAuthPassword(options) !== password) {
      throw new Error('The saved authentication password could not be verified.');
    }
  } catch (error) {
    if (fs.existsSync(temporaryFile)) fs.unlinkSync(temporaryFile);
    throw error;
  }
}

function emit(type, data = {}) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('irc:event', { type, ...data });
}

function validText(value, label, maxLength = 300) {
  if (typeof value !== 'string' || !value.trim() || value.length > maxLength || /[\r\n\0]/.test(value)) {
    throw new Error(`Invalid ${label}.`);
  }
  return value.trim();
}

function validSecret(value, label, maxLength = 400) {
  if (typeof value !== 'string' || !value.trim() || value.length > maxLength || /[\r\n\0]/.test(value)) {
    throw new Error(`Invalid ${label}.`);
  }
  return value;
}

function formatSystemInfo() {
  const cpus = os.cpus();
  if (!cpus.length || !cpus[0].model) throw new Error('System CPU information is unavailable.');
  const totalMemory = os.totalmem();
  const freeMemory = os.freemem();
  const uptime = Math.floor(os.uptime());
  const days = Math.floor(uptime / 86400);
  const hours = Math.floor((uptime % 86400) / 3600);
  const minutes = Math.floor((uptime % 3600) / 60);
  const gibibytes = bytes => `${(bytes / 1024 ** 3).toFixed(1)} GiB`;
  const uptimeText = days
    ? `${days}d ${hours}h ${minutes}m`
    : hours ? `${hours}h ${minutes}m` : `${minutes}m`;

  return `SysInfo: OS: ${os.type()} ${os.release()} (${os.arch()}), CPU: ${cpus[0].model} (${cpus.length} cores), Memory: ${gibibytes(totalMemory - freeMemory)} / ${gibibytes(totalMemory)}, Uptime: ${uptimeText}`;
}

async function uploadImgurImage(options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) throw new Error('Invalid photo upload.');
  const clientId = validText(options.clientId, 'Imgur Client-ID', 80);
  if (!/^[a-f\d]{15}$/i.test(clientId)) throw new Error('Enter a valid 15-character Imgur Client-ID.');
  const mimeType = options.mimeType;
  const extensions = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };
  if (typeof mimeType !== 'string' || !Object.hasOwn(extensions, mimeType)) {
    throw new Error('Choose a PNG, JPEG, WebP or GIF image.');
  }
  const image = options.image;
  if (typeof image !== 'string' || image.length > Math.ceil(10 * 1024 * 1024 / 3) * 4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(image)) {
    throw new Error('The selected photo is invalid or exceeds the 10 MB upload limit.');
  }
  const imageBuffer = Buffer.from(image, 'base64');
  if (!imageBuffer.length || imageBuffer.length > 10 * 1024 * 1024 || imageBuffer.toString('base64') !== image) {
    throw new Error('The selected photo is invalid or exceeds the 10 MB upload limit.');
  }
  const form = new FormData();
  form.append('image', new Blob([imageBuffer], { type: mimeType }), `photo.${extensions[mimeType]}`);
  const response = await electronNet.fetch('https://api.imgur.com/3/image', {
    method: 'POST',
    headers: { Authorization: `Client-ID ${clientId}` },
    body: form,
    redirect: 'error',
    signal: AbortSignal.timeout(30000)
  });
  const result = await response.json();
  if (!response.ok || result.success !== true) {
    const message = typeof result.data?.error === 'string' ? result.data.error : `Imgur upload failed (HTTP ${response.status}).`;
    throw new Error(message);
  }
  let link;
  try { link = new URL(result.data.link); }
  catch { throw new Error('Imgur returned an invalid photo link.'); }
  if (link.protocol !== 'https:' || !/(^|\.)imgur\.com$/i.test(link.hostname) || link.username || link.password) {
    throw new Error('Imgur returned an invalid photo link.');
  }
  return link.href;
}

function validChannel(value) {
  const channel = validText(value, 'channel', 200);
  if (!/^[#&+!][^\s,\x07]{1,199}$/.test(channel)) throw new Error('Enter a valid IRC channel name.');
  return channel;
}

function disconnect(reason = 'Disconnected') {
  const current = client;
  client = undefined;
  if (current) {
    current.authPassword = '';
    if (current.registrationTimer) clearTimeout(current.registrationTimer);
    if (current.capNegotiationTimer) clearTimeout(current.capNegotiationTimer);
    if (current.nickServTimer) clearTimeout(current.nickServTimer);
    current.intentional = true;
    if (current.registered && current.socket.writable) current.socket.end('QUIT :Leaving Harbor IRC\r\n');
    else current.socket.destroy();
  }
  emit('disconnected', { reason });
}

function quit(reason = 'Leaving Harbor IRC') {
  if (!client || !client.registered) return disconnect();
  const safeReason = validText(reason || 'Leaving Harbor IRC', 'quit reason', 300);
  const current = client;
  client = undefined;
  current.authPassword = '';
  if (current.registrationTimer) clearTimeout(current.registrationTimer);
  if (current.capNegotiationTimer) clearTimeout(current.capNegotiationTimer);
  if (current.nickServTimer) clearTimeout(current.nickServTimer);
  current.intentional = true;
  current.socket.end(`QUIT :${safeReason}\r\n`);
  emit('disconnected', { reason: 'Disconnected' });
}

function writeLine(line) {
  if (!client || !client.socket || !client.socket.writable) throw new Error('Connect to a server first.');
  if (/[\r\n\0]/.test(line) || Buffer.byteLength(line, 'utf8') > 510) throw new Error('IRC message is too long or contains invalid characters.');
  client.socket.write(`${line}\r\n`);
}

function sendRaw(line) {
  if (!client || !client.registered) throw new Error('Connect to a server first.');
  writeLine(line);
}

function failAuthentication(reason) {
  if (!client) return;
  client.authPassword = '';
  emit('error', { message: reason });
  disconnect(reason);
}

function completeRegistration() {
  if (!client || !client.welcomeReceived || !client.capNegotiationComplete || client.registered) return;
  const current = client;
  if (client.authMethod === 'sasl' && !client.saslAuthenticated) return;
  if (client.authMethod === 'nickserv' && !client.nickServSent) {
    writeLine(`PRIVMSG NickServ :IDENTIFY ${client.authPassword}`);
    client.nickServSent = true;
    client.nickServTimer = setTimeout(() => {
      if (client === current && !current.nickServAuthenticated) {
        failAuthentication('NickServ did not confirm identification. Check that the nickname is registered and the password is correct.');
      }
    }, 10000);
    client.nickServTimer.unref?.();
    return;
  }
  if (client.authMethod === 'nickserv' && !client.nickServAuthenticated) return;
  client.registered = true;
  if (client.registrationTimer) clearTimeout(client.registrationTimer);
  if (client.nickServTimer) clearTimeout(client.nickServTimer);
  emit('connected', { nick: client.welcomeNick || client.nick, server: client.host });
  for (const channel of client.channels) sendRaw(`JOIN ${channel}`);
}

function tryNextNick() {
  if (!client || client.registered) return false;
  const nextNick = client.backupNicks.shift();
  if (!nextNick) return false;
  client.nick = nextNick;
  writeLine(`NICK ${nextNick}`);
  emit('server', { text: `Nickname is in use; trying backup nickname ${nextNick}.` });
  return true;
}

function finishCapNegotiation() {
  if (!client || client.capNegotiationComplete) return;
  const current = client;
  current.capNegotiationComplete = true;
  if (current.capNegotiationTimer) clearTimeout(current.capNegotiationTimer);
  writeLine('CAP END');
  completeRegistration();
}

function parseModeChanges(modeString, args, prefixModes) {
  let adding = true;
  let argIndex = 0;
  const changes = [];
  const argumentModes = new Set(['b', 'e', 'I', 'k']);
  for (const mode of modeString) {
    if (mode === '+') { adding = true; continue; }
    if (mode === '-') { adding = false; continue; }
    const takesArgument = prefixModes.some(([, prefixMode]) => prefixMode === mode) ||
      argumentModes.has(mode) || (mode === 'l' && adding);
    if (takesArgument && args[argIndex] !== undefined) {
      const argument = args[argIndex++];
      if (prefixModes.some(([, prefixMode]) => prefixMode === mode)) {
        changes.push({ nick: argument, mode, adding });
      }
    }
  }
  return changes;
}

function parseLine(line) {
  let rest = line;
  let prefix = '';
  if (rest.startsWith('@')) {
    const tagsEnd = rest.indexOf(' ');
    if (tagsEnd < 0) return null;
    rest = rest.slice(tagsEnd + 1);
  }
  if (rest.startsWith(':')) {
    const split = rest.indexOf(' ');
    if (split < 0) return null;
    prefix = rest.slice(1, split);
    rest = rest.slice(split + 1);
  }
  const trailingAt = rest.indexOf(' :');
  const head = trailingAt < 0 ? rest : rest.slice(0, trailingAt);
  const params = head.split(' ').filter(Boolean);
  const trailing = trailingAt < 0 ? [] : [rest.slice(trailingAt + 2)];
  const command = params.shift();
  return command ? { prefix, command: command.toUpperCase(), params: [...params, ...trailing] } : null;
}

function handleLine(rawLine) {
  const message = parseLine(rawLine);
  if (!message || !client) return;
  const { prefix, command, params } = message;
  const nick = prefix.split('!')[0] || '';
  const text = params.at(-1) || '';

  if (command === 'PING') {
    writeLine(`PONG :${params.at(-1) || ''}`);
  } else if (command === 'CAP' && params[1] === 'LS') {
    if (client.capNegotiationComplete) return;
    for (const capability of (params.at(-1) || '').split(/\s+/).filter(Boolean)) {
      client.capabilities.add(capability.toLowerCase());
    }
    if (params[2] !== '*') {
      if (client.capNegotiationTimer) clearTimeout(client.capNegotiationTimer);
      if (client.authMethod === 'sasl') {
        const saslCapability = [...client.capabilities].find(capability => capability.startsWith('sasl'));
        const mechanisms = saslCapability?.includes('=') ? saslCapability.split('=', 2)[1].split(',') : [];
        if (!saslCapability || (mechanisms.length && !mechanisms.includes('plain'))) {
          failAuthentication('This server does not offer SASL PLAIN authentication.');
          return;
        }
        client.saslCapPending = true;
        writeLine('CAP REQ :sasl');
      } else {
        finishCapNegotiation();
      }
    }
  } else if (command === 'CAP' && params[1] === 'ACK' && params.at(-1)?.split(/\s+/).some(capability => capability.toLowerCase() === 'sasl')) {
    if (client.authMethod !== 'sasl' || !client.saslCapPending) return;
    client.saslCapPending = false;
    client.saslAuthStarted = true;
    writeLine('AUTHENTICATE PLAIN');
  } else if (command === 'CAP' && params[1] === 'NAK' && client.authMethod === 'sasl' && client.saslCapPending && params.at(-1)?.split(/\s+/).some(capability => capability.toLowerCase() === 'sasl')) {
    failAuthentication('The server rejected SASL PLAIN authentication.');
  } else if (command === 'AUTHENTICATE' && client.authMethod === 'sasl' && params[0] === '+') {
    if (!client.saslAuthStarted || client.saslPayloadSent) return;
    const payload = Buffer.from(`\0${client.authAccount}\0${client.authPassword}`, 'utf8').toString('base64');
    for (let offset = 0; offset < payload.length; offset += 400) {
      writeLine(`AUTHENTICATE ${payload.slice(offset, offset + 400)}`);
    }
    if (payload.length % 400 === 0) writeLine('AUTHENTICATE +');
    client.authPassword = '';
    client.saslPayloadSent = true;
  } else if (command === '903' && client.authMethod === 'sasl') {
    if (!client.saslAuthStarted) return;
    client.saslAuthenticated = true;
    client.authPassword = '';
    finishCapNegotiation();
    completeRegistration();
  } else if (/^90[4-7]$/.test(command) && client.authMethod === 'sasl') {
    failAuthentication('SASL PLAIN authentication failed. Check your account name and password.');
  } else if (command === '001') {
    client.welcomeReceived = true;
    client.welcomeNick = params[0] || client.nick;
    completeRegistration();
  } else if (command === '433') {
    if (!tryNextNick()) {
      failAuthentication('The server rejected the nickname and no available backup nickname remains.');
    }
  } else if (client.authMethod === 'nickserv' && client.nickServSent && !client.nickServAuthenticated &&
    (command === 'NOTICE' || command === 'PRIVMSG') && nick.toLowerCase() === 'nickserv') {
    if (/\bnot\s+(?:identified|logged in|recognized|authenticated)\b/i.test(text) ||
      /\b(?:invalid|incorrect|wrong)\s+password\b|\bpassword\s+(?:is\s+)?(?:invalid|incorrect|wrong)\b|\bnot registered\b|\bno such (?:nick|nickname)\b/i.test(text)) {
      client.authPassword = '';
      if (client.nickServTimer) clearTimeout(client.nickServTimer);
      failAuthentication(`NickServ identification failed: ${text}`);
    } else if (/\b(?:identified|logged in|recognized|authenticated)\b/i.test(text)) {
      client.nickServAuthenticated = true;
      client.authPassword = '';
      if (client.nickServTimer) clearTimeout(client.nickServTimer);
      completeRegistration();
    } else {
      emit('notice', { nick, text });
    }
  } else if (command === '005') {
    for (const token of params.slice(1)) {
      const prefix = token.match(/^PREFIX=\(([^)]+)\)(.+)$/);
      if (prefix && prefix[1].length === prefix[2].length) {
        client.prefixModes = [...prefix[2]].map((symbol, index) => [symbol, prefix[1][index]]);
      }
    }
  } else if (command === '353' && params.length >= 4) {
    const channel = params[2];
    const names = params[3].split(' ').filter(Boolean).map(value => {
      let name = value;
      const modes = [];
      while (name && client.prefixModes.some(([symbol]) => symbol === name[0])) {
        const [symbol, mode] = client.prefixModes.find(([prefix]) => prefix === name[0]);
        modes.push(mode);
        name = name.slice(symbol.length);
      }
      return { nick: name, modes };
    });
    emit('names', { channel, names });
  } else if (command === 'MODE' && params.length >= 2 && /^[#&+!]/.test(params[0])) {
    emit('memberModes', {
      channel: params[0],
      changes: parseModeChanges(params[1], params.slice(2), client.prefixModes)
    });
  } else if (command === '366' && params[1]) {
    emit('namesEnd', { channel: params[1] });
  } else if (command === '332' && params.length >= 3) {
    emit('topic', { channel: params[1], topic: params.slice(2).join(' ') });
  } else if (command === 'JOIN' && params[0]) {
    const channel = params[0];
    emit('join', { channel, nick });
    if (nick.toLowerCase() === client.nick.toLowerCase()) {
      client.channels.add(channel);
      sendRaw(`NAMES ${channel}`);
    }
  } else if (command === 'PART' && params[0]) {
    emit('part', { channel: params[0], nick, reason: params[1] || '' });
    if (nick.toLowerCase() === client.nick.toLowerCase()) client.channels.delete(params[0]);
  } else if (command === 'QUIT') {
    emit('quit', { nick, reason: params[0] || '' });
  } else if (command === 'NICK' && params[0]) {
    const oldNick = nick;
    if (oldNick.toLowerCase() === client.nick.toLowerCase()) client.nick = params[0];
    emit('nick', { oldNick, nick: params[0] });
  } else if (command === 'PRIVMSG' && params.length >= 2) {
    const text = params.slice(1).join(' ');
    const ctcp = text.match(/^\u0001([A-Z]+)(?: ([^\u0001]*))?\u0001$/i);
    if (ctcp && ctcp[1].toUpperCase() !== 'ACTION') {
      const ctcpCommand = ctcp[1].toUpperCase();
      const payload = ctcp[2] || '';
      emit('ctcp', { nick, command: ctcpCommand, payload, direction: 'received' });
      if (ctcpCommand === 'PING') {
        writeLine(`NOTICE ${nick} :\u0001PING${ctcp[2] === undefined ? '' : ` ${payload}`}\u0001`);
      } else if (ctcpCommand === 'VERSION') {
        writeLine(`NOTICE ${nick} :\u0001VERSION Harbor IRC - the best client out there\u0001`);
      }
      return;
    }
    const action = text.startsWith('\u0001ACTION ') && text.endsWith('\u0001');
    emit('message', {
      target: params[0], nick, text: action ? text.slice(8, -1) : text,
      action, private: params[0].toLowerCase() === client.nick.toLowerCase()
    });
  } else if (command === 'NOTICE' && params.length >= 2) {
    const noticeText = params.slice(1).join(' ');
    const ctcpReply = noticeText.match(/^\u0001([A-Z]+)(?: ([^\u0001]*))?\u0001$/i);
    if (ctcpReply) {
      emit('ctcp', {
        nick, command: ctcpReply[1].toUpperCase(), payload: ctcpReply[2] || '', direction: 'response'
      });
    } else {
      emit('notice', {
        nick, text: noticeText,
        private: params[0].toLowerCase() === client.nick.toLowerCase()
      });
    }
  } else if (command === 'TOPIC' && params.length >= 2) {
    emit('topic', { channel: params[0], topic: params.slice(1).join(' ') });
  } else if (/^\d{3}$/.test(command)) {
    emit('server', { numeric: command, text: params.slice(1).join(' ') || params.join(' ') });
  }
}

function connect(options) {
  if (client) throw new Error('Disconnect before connecting to another server.');
  const host = validText(options?.host, 'server address', 253);
  const isIpv4Text = /^(?:\d{1,3}\.){3}\d{1,3}$/.test(host);
  const isDnsName = /^(?=.{1,253}$)([a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)*[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/.test(host);
  if ((isIpv4Text && net.isIP(host) !== 4) || (!isIpv4Text && !isDnsName)) {
    throw new Error('Enter a valid DNS hostname or IPv4 address.');
  }
  const port = Number(options.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Enter a valid port number.');
  const nick = validText(options.nick, 'nickname', 30);
  if (!/^[A-Za-z\[\]\\`_^{|}][A-Za-z0-9\-\[\]\\`_^{|}]*$/.test(nick)) throw new Error('Nickname contains unsupported characters.');
  const backupNicks = Array.isArray(options.backupNicks) ? options.backupNicks.map(value => validText(value, 'backup nickname', 30)) : [];
  if (backupNicks.length > 4) throw new Error('Enter no more than four backup nicknames.');
  const seenNicks = new Set([nick.toLowerCase()]);
  for (const backupNick of backupNicks) {
    if (!/^[A-Za-z\[\]\\`_^{|}][A-Za-z0-9\-\[\]\\`_^{|}]*$/.test(backupNick)) throw new Error('A backup nickname contains unsupported characters.');
    if (seenNicks.has(backupNick.toLowerCase())) throw new Error('Backup nicknames must be unique and different from the primary nickname.');
    seenNicks.add(backupNick.toLowerCase());
  }
  const username = validText(options.username || nick, 'username', 30).replace(/[^A-Za-z0-9._-]/g, '_');
  const channels = Array.isArray(options.channels) ? options.channels.slice(0, 20).map(validChannel) : [];
  let password = options.password ? validText(options.password, 'server password', 400) : '';
  const authMethod = options.authMethod || 'none';
  if (!['none', 'sasl', 'nickserv'].includes(authMethod)) throw new Error('Choose a supported authentication method.');
  if (options.requireAuthentication && authMethod === 'none') {
    throw new Error('This server requires authentication. Choose SASL PLAIN or NickServ IDENTIFY to connect.');
  }
  const authAccount = options.authAccount ? validText(options.authAccount, 'authentication account', 128) : '';
  if (/\s/.test(authAccount)) throw new Error('Authentication account names cannot contain spaces.');
  let authPassword = '';
  if (authMethod !== 'none') {
    if (options.rememberAuthPassword) {
      authPassword = options.authPassword
        ? validSecret(options.authPassword, 'authentication password')
        : readSavedAuthPassword({ host, authMethod, authAccount, nick });
      if (!authPassword) throw new Error('Enter an authentication password before saving it.');
    } else {
      authPassword = validSecret(options.authPassword, 'authentication password');
    }
  }
  if (authMethod === 'sasl' && !authAccount) throw new Error('Enter your SASL account name.');
  if (authMethod === 'nickserv') {
    if (Buffer.byteLength(`PRIVMSG NickServ :IDENTIFY ${authPassword}`, 'utf8') > 510) {
      throw new Error('The NickServ password is too long for an IRC message.');
    }
  }
  const authIdentity = { host, authMethod, authAccount, nick };
  if (options.rememberAuthPassword && authMethod !== 'none') saveAuthPassword(authIdentity, authPassword);
  else if (authMethod !== 'none') saveAuthPassword(authIdentity, '');

  emit('connecting', { server: host, nick });
  const state = {
    host, nick, backupNicks, channels: new Set(channels), registered: false, intentional: false, buffer: '',
    authMethod, authAccount, authPassword, capabilities: new Set(), welcomeReceived: false,
    prefixModes: [['~', 'q'], ['&', 'a'], ['@', 'o'], ['%', 'h'], ['+', 'v']],
    capNegotiationComplete: false,
    saslCapPending: false, saslAuthStarted: false, saslPayloadSent: false,
    saslAuthenticated: false, nickServSent: false, nickServAuthenticated: false
  };
  const socket = tls.connect({
    host, port, ...(net.isIP(host) ? {} : { servername: host }),
    rejectUnauthorized: true, minVersion: 'TLSv1.2'
  });
  state.socket = socket;
  client = state;
  socket.setEncoding('utf8');
  socket.on('secureConnect', () => {
    if (client !== state) return;
    state.registrationTimer = setTimeout(() => {
      if (client === state && !state.registered) {
        failAuthentication(state.authMethod === 'sasl'
          ? 'Timed out waiting for IRC registration or SASL authentication. Check the server, account name, and credentials.'
          : 'Timed out waiting for IRC registration. Check the server address, port, and connection settings.');
      }
    }, 30000);
    state.registrationTimer.unref?.();
    state.capNegotiationTimer = setTimeout(() => {
      if (client !== state || state.capNegotiationComplete) return;
      if (state.authMethod === 'sasl') {
        failAuthentication('Timed out waiting for the server to negotiate IRC capabilities for SASL.');
        return;
      }
      emit('server', { text: 'The server did not answer capability negotiation; continuing without optional capabilities.' });
      finishCapNegotiation();
    }, 5000);
    state.capNegotiationTimer.unref?.();
    if (password) writeLine(`PASS ${password}`);
    password = '';
    writeLine('CAP LS 302');
    writeLine(`NICK ${nick}`);
    writeLine(`USER ${username} 0 * :Harbor IRC user`);
  });
  socket.on('data', chunk => {
    if (client !== state) return;
    state.buffer += chunk;
    if (state.buffer.length > 8192 && !state.buffer.includes('\n')) {
      disconnect('Server sent an oversized IRC line.');
      return;
    }
    let newline;
    while ((newline = state.buffer.indexOf('\n')) !== -1) {
      const line = state.buffer.slice(0, newline).replace(/\r$/, '');
      state.buffer = state.buffer.slice(newline + 1);
      if (Buffer.byteLength(line, 'utf8') > 510) {
        disconnect('Server sent an oversized IRC line.');
        return;
      }
      try { handleLine(line); } catch (error) { emit('error', { message: error.message }); }
    }
  });
  socket.on('error', error => {
    if (client !== state) return;
    state.authPassword = '';
    if (state.registrationTimer) clearTimeout(state.registrationTimer);
    if (state.capNegotiationTimer) clearTimeout(state.capNegotiationTimer);
    if (state.nickServTimer) clearTimeout(state.nickServTimer);
    client = undefined;
    emit('error', { message: error.code === 'CERT_HAS_EXPIRED' || error.code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE'
      ? 'The server TLS certificate could not be verified. Connection refused.'
      : `Connection failed: ${error.message}` });
    emit('disconnected', { reason: 'Connection failed' });
  });
  socket.on('close', () => {
    if (client !== state) return;
    state.authPassword = '';
    if (state.registrationTimer) clearTimeout(state.registrationTimer);
    if (state.capNegotiationTimer) clearTimeout(state.capNegotiationTimer);
    if (state.nickServTimer) clearTimeout(state.nickServTimer);
    client = undefined;
    emit('disconnected', { reason: state.intentional ? 'Disconnected' : 'Server connection closed' });
  });
}

function makeWindow() {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 780,
    minHeight: 560,
    backgroundColor: '#141918',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: false
    }
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const allowed = app.isPackaged ? url.startsWith('app://harbor/') : url.startsWith('http://127.0.0.1:5173/');
    if (!allowed) event.preventDefault();
  });
  if (app.isPackaged) mainWindow.loadURL('app://harbor/index.html');
  else mainWindow.loadURL('http://127.0.0.1:5173');
  mainWindow.on('closed', () => { mainWindow = undefined; });
}

ipcMain.handle('irc:connect', (_event, options) => connect(options));
ipcMain.handle('app:sysinfo', () => formatSystemInfo());
ipcMain.handle('app:uploadImage', (_event, options) => uploadImgurImage(options));
ipcMain.handle('irc:connectionState', () => {
  if (!client) return { status: 'offline' };
  return {
    status: client.registered ? 'connected' : 'connecting',
    server: client.host,
    nick: client.welcomeNick || client.nick
  };
});
ipcMain.handle('irc:rememberAuthPassword', (_event, options = {}) => {
  const authIdentity = {
    host: validText(options.host, 'server address', 253),
    authMethod: options.authMethod,
    authAccount: options.authAccount ? validText(options.authAccount, 'authentication account', 128) : '',
    nick: validText(options.nick, 'nickname', 30)
  };
  if (authIdentity.authMethod === 'none' && !options.remember) return;
  if (!['sasl', 'nickserv'].includes(authIdentity.authMethod)) {
    throw new Error('Choose SASL PLAIN or NickServ IDENTIFY to save an authentication password.');
  }
  if (!options.remember) {
    saveAuthPassword(authIdentity, '');
    return;
  }
  if (options.password) {
    saveAuthPassword(authIdentity, validSecret(options.password, 'authentication password'));
    return;
  }
  if (!readSavedAuthPassword(authIdentity)) throw new Error('Enter an authentication password before saving it.');
});
ipcMain.handle('irc:disconnect', () => disconnect());
ipcMain.handle('irc:quit', (_event, reason) => quit(reason || 'Leaving Harbor IRC'));
ipcMain.handle('irc:join', (_event, channel) => sendRaw(`JOIN ${validChannel(channel)}`));
ipcMain.handle('irc:part', (_event, channel, reason = '') => {
  const safeChannel = validChannel(channel);
  const safeReason = reason ? validText(reason, 'part reason', 300) : '';
  sendRaw(`PART ${safeChannel}${safeReason ? ` :${safeReason}` : ''}`);
});
ipcMain.handle('irc:nick', (_event, nick) => {
  const safeNick = validText(nick, 'nickname', 30);
  if (!/^[A-Za-z\[\]\\`_^{|}][A-Za-z0-9\-\[\]\\`_^{|}]*$/.test(safeNick)) throw new Error('Nickname contains unsupported characters.');
  sendRaw(`NICK ${safeNick}`);
});
ipcMain.handle('irc:message', (_event, target, text, action = false) => {
  const safeTarget = validText(target, 'message target', 200);
  if (!/^[#&+!A-Za-z0-9_\-\[\]\\`^{|}]+$/.test(safeTarget)) throw new Error('Invalid message target.');
  const safeText = validText(text, 'message', 400);
  sendRaw(`PRIVMSG ${safeTarget} :${action ? `\u0001ACTION ${safeText}\u0001` : safeText}`);
  emit('message', { target: safeTarget, nick: client.nick, text: safeText, action, private: !/^[#&+!]/.test(safeTarget), self: true });
});
ipcMain.handle('irc:notice', (_event, target, text) => {
  const safeTarget = validText(target, 'message target', 200);
  if (!/^[#&+!A-Za-z0-9_\-\[\]\\`^{|}]+$/.test(safeTarget)) throw new Error('Invalid message target.');
  sendRaw(`NOTICE ${safeTarget} :${validText(text, 'notice', 400)}`);
});
ipcMain.handle('irc:ctcp', (_event, target, command) => {
  const safeTarget = validText(target, 'CTCP target', 200);
  if (!/^[#&+!A-Za-z0-9_\-\[\]\\`^{|}]+$/.test(safeTarget)) throw new Error('Invalid CTCP target.');
  const safeCommand = String(command).toUpperCase();
  if (!['PING', 'VERSION'].includes(safeCommand)) throw new Error('That CTCP command is not supported.');
  const payload = safeCommand === 'PING' ? ` ${Date.now()}` : '';
  sendRaw(`PRIVMSG ${safeTarget} :\u0001${safeCommand}${payload}\u0001`);
  emit('ctcp', { nick: client.nick, target: safeTarget, command: safeCommand, payload: payload.trim(), direction: 'sent' });
});
ipcMain.handle('irc:raw', (_event, command) => {
  const safeCommand = validText(command, 'IRC command', 400);
  const [verb] = safeCommand.split(/\s+/);
  const allowed = new Set(['WHOIS', 'WHO', 'LIST', 'TOPIC', 'INVITE', 'KICK', 'MODE', 'AWAY']);
  if (!allowed.has(verb.toUpperCase())) throw new Error('That IRC command is not supported here.');
  sendRaw(safeCommand);
});
ipcMain.handle('app:openExternal', async (_event, value) => {
  let url;
  try { url = new URL(value); } catch { throw new Error('Invalid link.'); }
  if (!['https:', 'http:'].includes(url.protocol)) throw new Error('Only web links can be opened.');
  await shell.openExternal(url.href);
});

app.whenReady().then(() => {
  if (app.isPackaged) {
    protocol.handle('app', request => {
      const url = new URL(request.url);
      const distDirectory = path.resolve(__dirname, 'dist');
      const filePath = path.resolve(distDirectory, decodeURIComponent(url.pathname.slice(1)));
      if (url.hostname !== 'harbor' || filePath === distDirectory || !filePath.startsWith(`${distDirectory}${path.sep}`)) {
        return new Response('Not found', { status: 404 });
      }
      return electronNet.fetch(pathToFileURL(filePath).href);
    });
  }
  makeWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) makeWindow(); });
});
app.on('before-quit', () => { if (client) disconnect('Application closed'); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });