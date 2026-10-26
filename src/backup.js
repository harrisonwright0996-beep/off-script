// Progress backups: a file he keeps in Files (OneDrive, say). It holds line ids, results and
// settings, never the script's words, so it is safe to keep anywhere.
export const BACKUP_VERSION = 1;

export class BackupError extends Error {
  constructor(code) {
    super(code);
    this.code = code; // 'not-json' | 'not-backup' | 'newer'
  }
}

// Undo needs the whole earlier state, but only within a sprint; the plan and the forgetting curve
// fit need just these three fields.
const slim = (prev) => prev && { status: prev.status, stability: prev.stability, lastTime: prev.lastTime };

export function makeBackup({ model, states, events, settings, now = Date.now() }) {
  return {
    app: 'off-script',
    version: BACKUP_VERSION,
    made: now,
    scriptHash: model.hash,
    settings: { ...settings },
    states: [...states],
    events: events.map(({ key, prev, ...e }) => ({ ...e, prev: slim(prev) })),
  };
}

// Reads a backup against the script on the phone: progress is kept for every line still in it.
export function readBackup(text, model) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new BackupError('not-json');
  }
  if (!data || data.app !== 'off-script' || !Array.isArray(data.states) || !Array.isArray(data.events)) throw new BackupError('not-backup');
  if (data.version > BACKUP_VERSION) throw new BackupError('newer');
  const ids = new Set(model.items.map((it) => it.id));
  const states = data.states.filter((s) => s && ids.has(s.id));
  const events = data.events.filter((e) => e && ids.has(e.id));
  return {
    made: data.made,
    sameScript: data.scriptHash === model.hash,
    settings: data.settings || null,
    states,
    events,
    kept: states.length,
    dropped: data.states.length - states.length,
  };
}
