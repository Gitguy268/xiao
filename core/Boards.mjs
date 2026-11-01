// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

// Boards (Features → Boards): links, quotes and notes gathered into topics,
// kept as sticky notes named "Board <title>.md" (see board/model.mjs). The
// board page shows them as cards; "Add to Board" in the page's context menu
// adds to them. Nothing here reads a page the reader did not choose.

import { addItem, boardFile, boardTitle, isBoard, newBoard, toHtml } from './board/model.mjs';

export const BOARD_URL = 'resource://xiao/board/index.html';

export class Boards {
  constructor(xiao) {
    this.xiao = xiao;
  }

  // Newest first, as the notes are.
  async list() {
    return (await this.xiao.notes.list()).filter((n) => isBoard(n.name)).map((n) => ({ name: n.name, title: boardTitle(n.name), text: n.text }));
  }

  async create(title) {
    const name = boardFile(title);
    if (!name) throw new Error('A board needs a name.');
    if (!(await this.list()).some((b) => b.name === name)) await this.xiao.notes.save({ name, text: newBoard(boardTitle(name)) });
    return name;
  }

  async board(name) {
    const found = isBoard(name) && (await this.list()).find((b) => b.name === name);
    if (!found) throw new Error('There is no such board.');
    return found;
  }

  async add(name, topic, text) {
    const b = await this.board(name);
    await this.xiao.notes.save({ name, text: addItem(b.text, String(topic).slice(0, 80) || 'Notes', String(text).slice(0, 4000)) });
    return name;
  }

  // The page's own edits (a ticked box, an item removed) come back as the whole text.
  async save(name, text) {
    await this.board(name);
    if (typeof text !== 'string') throw new Error('not a board');
    return this.xiao.notes.save({ name, text });
  }

  async html(name) {
    const b = await this.board(name);
    return toHtml(b.text, b.title);
  }
}
