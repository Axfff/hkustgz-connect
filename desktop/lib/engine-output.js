'use strict';

function classifyEngineOutput(text, socksPort) {
  if (/gateway authentication failed|login failed|invalid username/i.test(text)) {
    return '登录失败：账号或密码错误，已停止自动重试';
  }
  if (/not implemented auth|authentication method is unsupported/i.test(text)) {
    return '网关鉴权方式不受支持（可能已改为 SSO/MFA）';
  }
  if (/cannot bind the SOCKS5 listener|address already in use|bind:/i.test(text)) {
    return `端口 ${socksPort} 被占用，请在控制塔更换端口`;
  }
  return null;
}

function engineLifecycleSignal(text) {
  const value = String(text || '');
  const readyAt = value.lastIndexOf('SOCKS5 server listening');
  const recoveryMarkers = [
    'VPN data plane disconnected; reconnecting',
    'tunnel keepalive failed 2 consecutive times; reconnecting',
  ];
  const recoveringAt = Math.max(...recoveryMarkers.map((marker) => value.lastIndexOf(marker)));
  if (readyAt < 0 && recoveringAt < 0) return null;
  return recoveringAt > readyAt ? 'recovering' : 'ready';
}

module.exports = { classifyEngineOutput, engineLifecycleSignal };
