// First visit in Safari: install to the Home Screen first, because the installed app keeps its
// own storage (anything imported in Safari would stay in Safari).
import { h, screen, button } from './dom.js';

const BROWSER_FLAG = 'off-script-in-browser';

export function isStandalone() {
  return navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;
}

function isIPhone() {
  return /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function inBrowserChosen() {
  try {
    return localStorage.getItem(BROWSER_FLAG) === '1';
  } catch {
    return false;
  }
}

export function needsInstall() {
  return isIPhone() && !isStandalone() && !inBrowserChosen();
}

export function showInstall(ctx) {
  const carryOn = () => {
    try {
      localStorage.setItem(BROWSER_FLAG, '1');
    } catch {
      // private browsing: carry on anyway
    }
    ctx.go(ctx.model ? 'today' : 'setup');
  };
  ctx.root.append(
    screen({
      title: 'Install Off Script',
      body: [
        h('p', { class: 'lead' }, 'Put Off Script on your Home Screen first. The installed app keeps its own storage, so your script and progress live there and work offline.'),
        h(
          'ol',
          { class: 'steps' },
          h('li', {}, 'Tap the Share button at the bottom of Safari (the square with an arrow).'),
          h('li', {}, 'Choose Add to Home Screen, then Add.'),
          h('li', {}, 'Open Off Script from your Home Screen and import the script there.'),
        ),
      ],
      footer: [button('Continue in Safari for now', carryOn, { class: 'btn link' })],
    }),
  );
}
