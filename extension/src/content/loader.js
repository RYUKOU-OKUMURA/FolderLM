// Content script loader to enable module imports without bundling.
(() => {
  const url = chrome?.runtime?.getURL('src/content/index.js');
  if (!url) {
    console.error('[FolderLM] chrome.runtime.getURL unavailable; cannot load module.');
    return;
  }

  import(url).catch((error) => {
    console.error('[FolderLM] Failed to load content module', error);
  });
})();
