'use strict';

const TRAY_SIZE = Object.freeze({
  darwin: 18,
  win32: 20,
  linux: 22,
});

function loadTrayImage(nativeImage, iconPath, platform) {
  const source = nativeImage.createFromPath(iconPath);
  if (source.isEmpty()) return source;
  const size = TRAY_SIZE[platform] || TRAY_SIZE.linux;
  const resizeOptions = platform === 'darwin'
    ? { height: size, quality: 'best' }
    : { width: size, height: size, quality: 'best' };
  const image = source.resize(resizeOptions);
  if (platform === 'darwin') image.setTemplateImage(true);
  return image;
}

module.exports = { loadTrayImage, TRAY_SIZE };
