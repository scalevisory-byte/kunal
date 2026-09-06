import { useEffect, useState } from 'react';

const isStandalone = () =>
  window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true;

const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent);

/**
 * Chrome and friends hand us an install prompt we can fire on demand. iOS never
 * does, so there it is a short instruction instead of a button that lies.
 */
export function useInstall() {
  const [prompt, setPrompt] = useState(null);
  const [installed, setInstalled] = useState(isStandalone);

  useEffect(() => {
    const onPrompt = (event) => {
      event.preventDefault();
      setPrompt(event);
    };
    const onInstalled = () => {
      setInstalled(true);
      setPrompt(null);
    };
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  return {
    installed,
    canPrompt: Boolean(prompt),
    iosHint: !installed && isIos(),
    install: async () => {
      if (!prompt) return;
      prompt.prompt();
      await prompt.userChoice;
      setPrompt(null);
    },
  };
}
