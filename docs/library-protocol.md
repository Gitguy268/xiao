# Library protocol, version 1

How the Library page talks to Xiao. The source of truth is `core/lib/library-protocol.mjs`. This page describes it. OpenFinder keeps a copy of that file in `src/fs/contract/`.

## Transport

The page calls `window.xiao.request(request)`, which returns a promise of a reply. The function exists only on `resource://xiao-library/index.html`, at the top of a normal tab. XiaoParent checks that again for every message, together with the document's principal and that the page has not navigated away (see library-architecture.md).

```ts
type LibraryRequest = { protocol: 1; requestId: string; method: string; payload: object; key?: string }
type LibraryReply<T> =
  | { requestId: string; ok: true; revision: number; data: T }
  | { requestId: string; ok: false; code: string; message: string; retryable: boolean }
```

- `requestId` and `key`: 1–64 characters, `[A-Za-z0-9_-]`.
- `key` is an idempotency key, required by every method that changes something. A change sent again with the same key returns the first reply and is not repeated. The last 500 keys are kept.
- A request over 64 KB is refused with `TOO_LARGE`.
- Payload fields not in the method's schema are dropped.

Xiao tells open Library pages that something changed by firing `xiao-library-changed` on the page's `window`, with `detail.revision`.

## Shared types

- **item**: `{ root: id, path: string[], revision?: string }`
  - `path` is plain names below the root, at most 64 of them. Each name is NFC-normalised, at most 255 UTF-8 bytes, and has no `/ \ :`, NUL, control or bidi-override characters. Device names such as `CON` are refused, as are names that are `.`, `..`, or end in a dot or a space.
- **revision**: `"<size>-<mtime>"`, as the page last saw the file.

## Methods

| Method | Payload | Changes | Needs a click | Reply |
|---|---|---|---|---|
| `capabilities` | — | | | `{ protocol, methods, views, platform, theme }`. Opening the page also catches up the notes folder and rescans folders not scanned in 10 minutes |
| `roots.list` | — | | | `[{ id, kind: folder\|file, name, place, canWrite, source, available }]` |
| `roots.choose` | — | grant | yes | The native folder picker; the new root, or `null` |
| `roots.revoke` | `root` | yes | | `true`. The index for that root is deleted; tags and collection entries stay |
| `roots.stopScan` | `root` | | | `true`. Stops that folder's scan; what it found so far stays searchable. `roots.list` reports `scanning` for each root |
| `items.list` | `root, path, cursor?, limit?` | | | `{ items: [{ name, kind, size, modified, revision }], total, next }`, 200 per page |
| `items.stat` | `item` | | | One item |
| `items.open` | `item` | | yes | Opens with the system, PDFs in Xiao's viewer. Programs, installers and folders are refused (`UNSUPPORTED`) |
| `items.reveal` | `item` | | yes | Shows it in Finder or the file manager |
| `search.query` | `q, view?, scope?, cursor?, limit?, generation?` | | | `{ items, total, next, warnings }`. `view` is one of all, downloads, files, notes, tabs, archive, collections. `scope` is a root or collection id |
| `preview.open` | `item` | | | `{ kind: image\|audio\|video, mime, bytes }`, `{ kind: text, text, truncated }` (256 KB at most) or `{ kind: none, note }`. Media at most 32 MB |
| `preview.close` | `item?` | | | (reserved) |
| `tags.set` | `item, tags` | yes | | The tags (at most 32, each at most 40 characters) |
| `collections.list` | — | | | `[{ id, name, query, size }]` |
| `collections.update` | `op: create\|rename\|delete\|add\|remove, collection?, name?, items?` | yes | | `{ id }`. Never touches files |
| `searches.save` | `name, q` | yes | | `{ id }`. A collection whose content is the query |
| `rename.preview`, `rename.apply`, `trash`, `operations.list`, `operations.undo` | see Phase 3 | yes | trash | |
| `request.cancel` | `request` | | | `true`. Stops a running read; a change that has started finishes and reports what happened |

A method in the table that this Xiao does not implement yet answers `UNSUPPORTED`. `capabilities.methods` lists the ones it does.

## Errors

`INVALID`, `UNKNOWN_METHOD`, `UNSUPPORTED`, `PERMISSION_REVOKED`, `NOT_FOUND`, `STALE_ITEM`, `CONFLICT`, `UNAVAILABLE`, `TOO_LARGE`, `CANCELLED`, `BUSY`, `IO_ERROR`.

- `retryable` is true for `UNAVAILABLE`, `BUSY` and `IO_ERROR`.
- Messages are sentences for people. An unexpected error is reported as `IO_ERROR`, "Xiao could not do that"; its details go to the browser console, never to the page.

## Versions

The page and Xiao must speak the same `protocol`. A request with another number gets `UNSUPPORTED`. `npm run packs` refuses an OpenFinder build whose `openfinder-build.json` names another protocol, or contract hashes different from Xiao's files.
