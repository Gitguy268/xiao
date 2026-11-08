// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

// about:pdf-tools in each content process (core/AboutPdf.mjs registers it in
// the parent). A content process asks the module for the page's flags before
// the parent loads it; without it there, about:pdf-tools loads as about:blank.
'use strict';
(() => {
  const CONTRACT = '@mozilla.org/network/protocol/about;1?what=pdf-tools';
  const registrar = Components.manager.QueryInterface(Ci.nsIComponentRegistrar);
  if (registrar.isContractIDRegistered(CONTRACT)) return;
  const target = () => Services.io.newURI(Services.cpmm.sharedData.get('xiao:pdfTarget') || 'resource://xiao/pdf/index.html');
  const module = {
    newChannel(uri, loadInfo) {
      const channel = Services.io.newChannelFromURIWithLoadInfo(target(), loadInfo);
      channel.originalURI = uri;
      return channel;
    },
    getURIFlags() {
      return Ci.nsIAboutModule.ALLOW_SCRIPT | Ci.nsIAboutModule.URI_MUST_LOAD_IN_CHILD | Ci.nsIAboutModule.HIDE_FROM_ABOUTABOUT;
    },
    getChromeURI: target,
    QueryInterface: ChromeUtils.generateQI(['nsIAboutModule']),
  };
  registrar.registerFactory(Components.ID('{5b0b7c38-1d1e-4d0e-9c55-5f1f2b0e8a61}'), 'Xiao about:pdf-tools', CONTRACT, {
    createInstance: (iid) => module.QueryInterface(iid),
    QueryInterface: ChromeUtils.generateQI(['nsIFactory']),
  });
})();
