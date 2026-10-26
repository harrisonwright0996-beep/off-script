// Reads a Word .docx file into paragraphs of runs ({ text, italic }).
// Pure: works in Safari and in Node tests. Never sends anything anywhere.
import { unzipSync, strFromU8 } from '../vendor/fflate.js';

export class DocxError extends Error {
  constructor(code) {
    super(code);
    this.code = code; // 'not-zip' | 'bad-zip' | 'no-document'
  }
}

export function readDocxParagraphs(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (u8.length < 4 || u8[0] !== 0x50 || u8[1] !== 0x4b) throw new DocxError('not-zip');
  let files;
  try {
    files = unzipSync(u8, { filter: (f) => f.name === 'word/document.xml' });
  } catch {
    throw new DocxError('bad-zip');
  }
  const xml = files['word/document.xml'];
  if (!xml) throw new DocxError('no-document');
  return paragraphsFromXml(strFromU8(xml));
}

const ENTITY = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
export function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-z]+);/g, (m, e) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return String.fromCodePoint(code);
    }
    return ENTITY[e] ?? m;
  });
}

function attr(attrs, name) {
  const m = attrs.match(new RegExp(`${name}="([^"]*)"`));
  return m ? m[1] : null;
}

// A small tag tokenizer for WordprocessingML. Handles the cases Word produces:
// runs inside hyperlinks and insertions are kept, deletions are dropped,
// run level tabs become "\t", tab stop definitions are ignored, line breaks become "\n".
export function paragraphsFromXml(xml) {
  const paragraphs = [];
  const re = /<(\/?)([A-Za-z][\w.]*:[\w.]+|[A-Za-z][\w.]*)([^>]*?)(\/?)>|([^<]+)/g;
  let para = null;
  let run = null;
  let inRunProps = false;
  let inText = false;
  let delDepth = 0;
  let m;
  const endRun = () => {
    if (para && run && run.text && delDepth === 0) para.runs.push(run);
    run = null;
    inRunProps = false;
  };
  while ((m = re.exec(xml))) {
    const [, close, name, attrs, selfClose, text] = m;
    if (text !== undefined) {
      if (inText && run && delDepth === 0) run.text += decodeEntities(text);
      continue;
    }
    if (name === 'w:p') {
      if (close) {
        if (para) paragraphs.push(finish(para));
        para = null;
      } else if (selfClose) {
        paragraphs.push(finish({ runs: [] }));
      } else {
        para = { runs: [] };
      }
      continue;
    }
    if (name === 'w:del') {
      if (!selfClose) delDepth += close ? -1 : 1;
      continue;
    }
    if (name === 'w:r') {
      if (close) endRun();
      else if (!selfClose) run = { text: '', italic: false };
      continue;
    }
    if (!run) continue; // everything below only matters inside a run
    if (name === 'w:rPr') {
      if (!selfClose) inRunProps = !close;
      continue;
    }
    if (inRunProps) {
      if (name === 'w:i' && !close) {
        const v = attr(attrs, 'w:val');
        run.italic = v === null || !['0', 'false', 'off'].includes(v);
      }
      continue;
    }
    if (name === 'w:t') {
      if (selfClose) continue;
      inText = !close;
      continue;
    }
    if (close) continue;
    if (name === 'w:tab' || name === 'w:ptab') run.text += '\t';
    else if (name === 'w:br' || name === 'w:cr') {
      const type = attr(attrs, 'w:type');
      if (type !== 'page' && type !== 'column') run.text += '\n';
    } else if (name === 'w:noBreakHyphen') run.text += '-';
  }
  return paragraphs;
}

function finish(para) {
  return { runs: para.runs, text: para.runs.map((r) => r.text).join('') };
}
