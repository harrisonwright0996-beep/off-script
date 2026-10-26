// An invented play for tests. No real names: every role is a job title.
// Builds a minimal .docx in memory with the same shapes as the real script:
// tab speeches, standalone labels, placards, italic directions, on screen text,
// a long speech, a scene with no spoken lines, tracked changes and a hyperlink.
import { zipSync, strToU8 } from '../../vendor/fflate.js';

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const run = (text, italic = false) =>
  `<w:r>${italic ? '<w:rPr><w:i/></w:rPr>' : ''}<w:t xml:space="preserve">${esc(text)}</w:t></w:r>`;
const tabRun = (text, italic = false) =>
  `<w:r>${italic ? '<w:rPr><w:i w:val="1"/></w:rPr>' : ''}<w:tab/><w:t xml:space="preserve">${esc(text)}</w:t></w:r>`;
const para = (...runs) => `<w:p><w:pPr><w:tabs><w:tab w:val="left" w:pos="2160"/></w:tabs></w:pPr>${runs.join('')}</w:p>`;

const speech = (role, text) => para(run(role), tabRun(text));
const screen = (role, text) => para(run(role), tabRun(text, true));
const dir = (text) => para(run(text, true));
const plain = (text) => para(run(text));
const blank = '<w:p/>';

export const LONG_SPEECH =
  'The first time I crossed, the sea was flat as glass. ' +
  'I stood at the rail and counted the gulls until I lost count. ' +
  'My mother said the ferry was older than her, and she was right. ' +
  'Halfway over, the engine stopped and nobody said a word. ' +
  'We just drifted. Then it coughed, and we went on, and I have never forgotten that silence.';

export function fixtureXml() {
  const body = [
    plain('THE NIGHT FERRY'),
    plain('An invented play for testing.'),
    blank,
    plain('PROLOGUE'),
    dir('Darkness. The sound of the sea.'),
    speech('CAST', 'We are the ones who stayed.'),
    plain('We are the ones who waited.'),
    blank,
    speech('KEEPER', 'I’ve kept this light for 254 nights.'),
    dir('A phone buzzes.'),
    speech('PILOT', '(Texting.) On my way… wait—what?'),
    speech('KEEPER', 'Then hurry.'),
    blank,
    plain('SCENE 1: THE HARBOUR'),
    dir('The harbour at night.'),
    speech('KEEPER', 'Tickets cost £35, and that’s the well-known price.'),
    speech('PILOT', 'Say “please” first.'),
    plain('KEEPER'),
    plain('Please.'),
    plain('CAST PLACARDS'),
    plain('NO RETURN TICKETS'),
    speech('CLERK', 'I’ve been to İstanbul and the café was closed.'),
    screen('PHONE', 'New message: where are you?'),
    blank,
    dir('She reads it.'),
    speech('CLERK', LONG_SPEECH),
    speech('MUM', 'Come home now.'),
    speech('PILOT’S DAD', 'She’s fine. Leave her be.'),
    plain('CLERK AS HER PARENT'),
    plain('You heard him.'),
    blank,
    plain('And I meant it.'),
    plain('STRANGER (AS HIS MUM)'),
    plain('Not again.'),
    speech('STRANGER', 'Again.'),
    blank,
    plain('SCENE 2: THE CROSSING'),
    dir('Projected text.'),
    screen('SCREEN', 'Day one'),
    screen('SCREEN', 'Day two'),
    blank,
    plain('SCENE 3: LANDFALL'),
    speech('KEEPER', 'We made it.'),
    `<w:p>${run('PILOT')}<w:r><w:tab/><w:t>We </w:t></w:r><w:del w:id="1"><w:r><w:delText>never </w:delText></w:r></w:del><w:ins w:id="2"><w:r><w:t>really </w:t></w:r></w:ins><w:hyperlink r:id="rId9"><w:r><w:t>did</w:t></w:r></w:hyperlink><w:r><w:t>.</w:t></w:r></w:p>`,
    speech('KEEPER', '(Nods.)'),
    speech('KEEPER', 'Home, then.'),
    speech('PILOT', 'Home.'),
    speech('KEEPER', 'Light the lamp.'),
    speech('PILOT', 'Home.'),
    plain('THE END'),
    plain('Thank you for reading.'),
  ].join('');
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    `<w:body>${body}<w:sectPr/></w:body></w:document>`
  );
}

export function buildFixtureDocx(xml = fixtureXml()) {
  return zipSync({
    '[Content_Types].xml': strToU8(
      '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '</Types>',
    ),
    '_rels/.rels': strToU8(
      '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
        '</Relationships>',
    ),
    'word/document.xml': strToU8(xml),
  });
}
