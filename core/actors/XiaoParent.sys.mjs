// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

// The parent-process half of the Xiao actor: answers XiaoChild in each frame.
import { Xiao } from 'resource://xiao/XiaoCore.sys.mjs';

export class XiaoParent extends JSWindowActorParent {
  async receiveMessage({ name, data }) {
    if (name === 'cosmetics') {
      await Xiao.ready;
      return Xiao.blocker.cosmetics(data, this.browsingContext.top.currentURI?.spec ?? '');
    }
    if (name === 'base') {
      await Xiao.ready;
      return Xiao.blocker.engine ? Xiao.blocker.baseSheet() : '';
    }
    // The start page's calls: only from Xiao's own start page, loaded at the top of a tab.
    // documentURI comes from this process, not from the page.
    if (name === 'page') {
      const uri = this.manager.documentURI?.spec ?? '';
      if (!uri.startsWith(Xiao.START_URL) || this.browsingContext.parent) throw new Error('not the start page');
      return Xiao.page(data.call, data.arg, this.browsingContext);
    }
    return undefined;
  }
}
