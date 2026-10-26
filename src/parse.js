// Turns paragraphs from docx.js into scenes of speeches, stage directions and on screen text.
// A port of the tested Python reader (build_S11_packs.py, "read the play"), except that the
// cast list is inferred from the script itself, so no names live in this code.

const LABEL = /^[A-Z][A-Z' ()]+$/;
const GENERIC_ROLES = [
  /^CAST$/,
  /^MUM$/,
  /^.+'S (MUM|DAD|PARENT)$/,
  /^.+ AS (HER|HIS) PARENT$/,
  /^.+ \(AS (HER|HIS) (MUM|DAD|PARENT)\)$/,
];

export function normQuotes(s) {
  return s.replace(/[’‘]/g, "'");
}

export function displayTitle(s) {
  return s
    .toLowerCase()
    .split(' ')
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ');
}

function isItalicParagraph(p) {
  const runs = p.runs.filter((r) => r.text.trim());
  return runs.length > 0 && runs.every((r) => r.italic);
}

// Is all the text after the first tab italic? Same result as the Python rule on the real script,
// and also right when Word puts the tab and the words in one run.
function isScreenSpeech(p) {
  const body = [];
  let seenTab = false;
  for (const r of p.runs) {
    if (seenTab) {
      if (r.text.trim()) body.push(r);
    } else if (r.text.includes('\t')) {
      seenTab = true;
      if (r.text.slice(r.text.indexOf('\t') + 1).trim()) body.push(r);
    }
  }
  return body.length > 0 && body.every((r) => r.italic);
}

export function parseScript(paragraphs) {
  const tabRoles = new Set();
  for (const p of paragraphs) {
    const t = p.text.trimEnd();
    const i = t.indexOf('\t');
    if (i > 0) tabRoles.add(normQuotes(t.slice(0, i)).toUpperCase().trim());
  }
  const isRole = (s) => {
    const r = normQuotes(s).toUpperCase().trim();
    return tabRoles.has(r) || GENERIC_ROLES.some((re) => re.test(r));
  };

  const scenes = [];
  let scene = null;
  let cur = null; // the open speech
  let lastRole = null;
  let pending = null; // a label on its own line

  for (const p of paragraphs) {
    const t = p.text.trimEnd();
    const s = t.trim();
    if (!s) {
      cur = null;
      continue;
    }
    if (s === 'PROLOGUE' || /^SCENE \d+:/.test(s)) {
      const isPrologue = s === 'PROLOGUE';
      const colon = s.indexOf(':');
      scene = {
        name: isPrologue ? 'Prologue' : displayTitle(s.slice(0, colon)),
        title: isPrologue ? '' : displayTitle(s.slice(colon + 1).trim()),
        events: [],
      };
      scenes.push(scene);
      cur = null;
      lastRole = null;
      pending = null;
      continue;
    }
    if (s === 'THE END') {
      scene = null; // anything after the end is not part of the play
      continue;
    }
    if (!scene) continue;
    const ev = scene.events;

    if (t.includes('\t')) {
      const i = t.indexOf('\t');
      const role = t.slice(0, i).trim();
      cur = { t: 'speech', role, lines: [t.slice(i + 1).trim()], screen: isScreenSpeech(p) };
      ev.push(cur);
      lastRole = role;
      pending = null;
      continue;
    }
    const italic = isItalicParagraph(p);
    if (LABEL.test(s) && !italic && s.length < 40 && (s.endsWith('PLACARDS') || isRole(s))) {
      pending = s;
      cur = null;
      continue;
    }
    if (pending !== null) {
      if (pending.endsWith('PLACARDS')) {
        ev.push({ t: 'placard', text: s }); // held, never spoken
        pending = null;
        continue;
      }
      cur = { t: 'speech', role: pending, lines: [s], screen: italic };
      ev.push(cur);
      lastRole = pending;
      pending = null;
      continue;
    }
    if (italic) {
      if (cur && cur.screen) cur.lines.push(s);
      else {
        ev.push({ t: 'dir', text: s });
        cur = null;
      }
      continue;
    }
    if (cur) cur.lines.push(s);
    else {
      cur = { t: 'speech', role: lastRole, lines: [s], screen: false };
      ev.push(cur);
    }
  }
  return { scenes };
}

export function summarise(parsed) {
  let speeches = 0;
  let words = 0;
  let screen = 0;
  let directions = 0;
  const speakers = new Set();
  for (const sc of parsed.scenes) {
    for (const e of sc.events) {
      if (e.t === 'dir') directions++;
      if (e.t !== 'speech') continue;
      if (e.screen) {
        screen++;
        continue;
      }
      speeches++;
      speakers.add(e.role);
      words += countWords(e.lines.join(' '));
    }
  }
  return { scenes: parsed.scenes.length, speeches, words, screen, directions, speakers: speakers.size };
}

// Same counting rule as the size check run on 26 October (letters, digits, £ and apostrophes).
export function countWords(s) {
  return (s.match(/[A-Za-z0-9£'’]+/g) || []).length;
}
