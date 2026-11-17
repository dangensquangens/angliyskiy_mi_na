(() => {
  'use strict';

  function redirect() {
    const { hash, href, search } = location;
    let page;
    if (/^#v[123]\./.test(hash) || /^#(?:practice|exercise-panel|sound-pairs)$/.test(hash)) {
      page = 'phonetics.html';
    } else if (/^#(?:dictionary|dictionary-search|dictionary-level|word-groups)$/.test(hash)) {
      page = 'dictionary.html';
    }
    if (!page) return;

    const url = new URL(page, href);
    url.search = search;
    url.hash = hash;
    location.replace(url.href);
  }

  redirect();
  window.addEventListener('hashchange', redirect);
})();
