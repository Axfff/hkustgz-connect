'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getState: () => ipcRenderer.invoke('get-state'),
  save: (payload) => ipcRenderer.invoke('save', payload),
  connect: () => ipcRenderer.invoke('connect'),
  disconnect: () => ipcRenderer.invoke('disconnect'),
  reconnect: () => ipcRenderer.invoke('reconnect'),
  runDiagnostics: () => ipcRenderer.invoke('run-diagnostics'),
  logout: () => ipcRenderer.invoke('logout'),
  getLogs: () => ipcRenderer.invoke('get-logs'),
  openLog: () => ipcRenderer.invoke('open-log'),
  installHpcSsh: () => ipcRenderer.invoke('install-hpc-ssh'),
  removeHpcSsh: () => ipcRenderer.invoke('remove-hpc-ssh'),
  installFallbackService: () => ipcRenderer.invoke('install-fallback-service'),
  removeFallbackService: () => ipcRenderer.invoke('remove-fallback-service'),
  sshConfig: () => ipcRenderer.invoke('ssh-config'),
  shadowrocketModule: (preset) => ipcRenderer.invoke('shadowrocket-module', preset),
  mihomoProfile: () => ipcRenderer.invoke('mihomo-profile'),
  copy: (text) => ipcRenderer.invoke('copy', text),
  openExternalCampusResource: (url) => ipcRenderer.invoke('open-external-campus-resource', url),
  openNetworkGuide: (topic) => ipcRenderer.invoke('open-network-guide', topic),
  resize: (height) => ipcRenderer.invoke('resize', height),
  onStatus: (cb) => ipcRenderer.on('status', (_e, s) => cb(s)),
  onTelemetry: (cb) => ipcRenderer.on('telemetry', (_e, t) => cb(t)),
});
