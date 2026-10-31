// Capture the one-use browser prompt before the app finishes loading.
window.littleInstall = { prompt: null, installed: false };
// eslint-disable-next-line functional/prefer-immutable-types -- Consume the native install event so only an explicit button click opens the browser prompt.
window.addEventListener('beforeinstallprompt', event => {
  event.preventDefault();
  window.littleInstall.prompt = event;
  window.littleInstall.installed = false;
  window.dispatchEvent(new Event('little-install-change'));
});
window.addEventListener('appinstalled', () => {
  window.littleInstall.prompt = null;
  window.littleInstall.installed = true;
  window.dispatchEvent(new Event('little-install-change'));
});
