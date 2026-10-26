# Off Script

Learn a whole play, word for word and cue by cue, on an iPhone.

Off Script is a web app you add to your Home Screen. You load your own script and it teaches you every line together with the cue before it. Between new lines it tests you on what you have already learnt, using a forgetting curve to bring each line back just before you would lose it. Walk mode reads cues aloud, so you can practise on the move with the screen locked.

## Nothing leaves your phone

* Your script is read on your phone and kept only there, in this site's storage in Safari.
* The app makes no network requests except to load its own files, and its content security policy blocks any others.
* There is no account, no server and no analytics.
* Backups are files you save yourself. They hold line ids and results, never the words.
* This repository holds no script and never will. A privacy check runs before every push.

## Use it

1. Open https://harrisonwright0996-beep.github.io/off-script/ in Safari on your iPhone.
2. Tap Share, then Add to Home Screen, and open Off Script from there.
3. Load your script: a Word file (.docx) where each speech is a paragraph that starts with the speaker's name in capitals, then a tab, then the words. Text in italics after the tab is treated as words on a screen.

## Audio for walks (optional)

On a Mac, this makes an audio pack with the Mac's own voices (it needs LAME: `brew install lame`):

```bash
npm run audio -- --script "path/to/your script.docx" --out "a folder outside this repository"
```

Then import the pack on your phone in Settings. Without a pack, Walk uses the phone's own voice with the screen on.

## Develop

* `npm test` runs the unit tests.
* `npx playwright test` runs the browser tests in WebKit and Chromium, on an invented play.
* `npm run serve` serves the app at http://localhost:4173/off-script/
* `npm run privacy` checks that no listed name, script or audio file is in the repository.
* Change `VERSION` in `sw.js` with every release, so phones pick up the update.

No build step and no runtime dependencies: plain ES modules, with fflate (MIT) vendored for zip files.
