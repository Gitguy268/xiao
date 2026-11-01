// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

// The rename journal's rules, kept pure so every case is tested in node.
//
// A rename is written down before the disk is touched ("prepared"), again
// once the file has moved ("applied"), and once the Library's records follow
// ("committed"). A database and a file system cannot change together, so
// after a crash Xiao looks at what is actually on the disk and decides from
// that, never by repeating a move blindly:
//
//   what the disk shows                         → what Xiao does
//   the file is still at its old name           → the rename never happened: "failed"
//   the file is at its new name, and it is ours → finish the records: "committed"
//   anything else (both, neither, another file) → leave both alone: "review"
//
// "Ours" means same size and modification time as when it was written down.

export const OPEN = ['prepared', 'applied', 'undoing'];

export const identityOf = (stat) => (stat ? { size: stat.size ?? null, modified: Math.round(stat.lastModified ?? 0) } : null);
export const sameFile = (a, b) => !!a && !!b && a.size === b.size && a.modified === b.modified;

// op: { state, identity }, before/after: identity of what is at the old and
// new path now (null when nothing is there). Returns the state to record.
export function recover(op, before, after) {
  const undoing = op.state === 'undoing';
  const [from, to] = undoing ? [after, before] : [before, after];
  if (sameFile(to, op.identity) && !from) return undoing ? 'undone' : 'committed';
  if (sameFile(from, op.identity) && !to) return undoing ? 'committed' : 'failed';
  return 'review';
}

// Whether a committed rename can be undone now, and if not, why not.
export function canUndo(op, before, after) {
  if (op.state !== 'committed') return op.state === 'undone' ? 'This was already undone.' : 'Only finished renames can be undone.';
  if (!after) return 'The file is no longer where the Library put it.';
  if (!sameFile(after, op.identity)) return 'The file has changed since it was renamed, so undo would not put back the same file.';
  if (before) return 'Something else now has the old name; undo would replace it.';
  return null;
}
