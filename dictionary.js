(() => {
  'use strict';

  const $ = id => document.getElementById(id);
  const catalog = globalThis.OXFORD_CATALOG;
  const { hasLevel, ipaSearchKey } = globalThis.READING_RULES;
  const groups = {
    'short-a': 'Короткая a · /æ/', 'short-e': 'Короткая e · /e/',
    'short-i': 'Короткая i · /ɪ/', 'short-o': 'Короткая o · /ɒ/',
    'short-u': 'Короткая u · /ʌ/', 'a-e': 'a + согласная + e · /eɪ/',
    'i-e': 'i + согласная + e · /aɪ/', 'o-e': 'o + согласная + e · /əʊ/',
    sh: 'sh · /ʃ/', ch: 'ch · /tʃ/', 'th-voiceless': 'Глухое th · /θ/',
    'th-voiced': 'Звонкое th · /ð/', ee: 'ee · /iː/',
    'oo-long': 'oo · /uː/', 'oo-short': 'oo · /ʊ/', oa: 'oa · /əʊ/',
    ai: 'ai · /eɪ/', ou: 'ou · /aʊ/',
    'ea-long': 'ea · /iː/', 'ea-short': 'ea · /e/', 'ay': 'ay · /eɪ/',
    'ow-long': 'ow · /əʊ/', 'ow-short': 'ow · /aʊ/', igh: 'igh · /aɪ/',
    oi: 'oi / oy · /ɔɪ/', ar: 'ar · /ɑː/', or: 'or · /ɔː/',
    'er-ir-ur': 'er / ir / ur · /ɜː/', 'u-e': 'u + согласная + e · /uː/ или /juː/',
    wh: 'wh · /w/', kn: 'kn · /n/', wr: 'wr · /r/', ph: 'ph · /f/',
    ng: 'ng · /ŋ/', ck: 'ck · /k/', tion: 'tion · /ʃən/',
    'other-short': 'Другие односложные слова', other: 'Другие многосложные слова',
    phrases: 'Словосочетания',
  };

  function element(tag, className, value) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (value !== undefined) node.textContent = value;
    return node;
  }

  function setupDictionary() {
    const container = $('word-groups');
    const grouped = new Map();
    for (const entry of catalog.words) {
      const group = Object.hasOwn(groups, entry.group) ? entry.group : 'other';
      if (!grouped.has(group)) grouped.set(group, []);
      grouped.get(group).push(entry);
    }
    const spellingKey = text => text.toLowerCase().normalize('NFC').trim().replace(/’/g, "'").replace(/\s+/g, ' ');
    const resultGroups = [];
    for (const [group, title] of Object.entries(groups)) {
      if (!grouped.has(group)) continue;
      const section = element('details', 'word-group');
      const heading = element('summary', null, title);
      const count = element('small');
      heading.append(count);
      const items = element('ul', 'word-group-list');
      const entries = grouped.get(group).map(word => {
        const variants = [word.ipa, ...(word.alternatives ?? [])];
        const display = word.display ?? word.word;
        const row = element('li', 'word-chip');
        const label = element('span', null, display);
        label.lang = 'en';
        row.append(label, element('span', 'word-chip-ipa', variants.map(ipa => `/${ipa}/`).join(' · ')),
          element('small', null, (word.levels ?? [word.level]).join(' · ')));
        items.append(row);
        return { row, word, spellings: [word.word, display].map(spellingKey), pronunciations: variants.map(ipaSearchKey) };
      });
      section.append(heading, items);
      resultGroups.push({ section, count, entries });
    }
    container.replaceChildren(...resultGroups.map(({ section }) => section));

    const search = $('dictionary-search');
    const level = $('dictionary-level');
    const total = catalog.words.length.toLocaleString('ru-RU');
    let openBeforeSearch;

    function updateResults() {
      const spelling = spellingKey(search.value);
      const ipa = ipaSearchKey(search.value);
      if (spelling && !openBeforeSearch) {
        openBeforeSearch = new Set(resultGroups.filter(group => group.section.open));
      }
      let totalMatches = 0;
      for (const group of resultGroups) {
        let matches = 0;
        for (const { word, row, spellings, pronunciations } of group.entries) {
          const visible = hasLevel(word, level.value) && (!spelling
            || spellings.some(key => key.includes(spelling))
            || (ipa && pronunciations.some(key => key.includes(ipa))));
          row.hidden = !visible;
          if (visible) matches += 1;
        }
        group.count.textContent = String(matches);
        group.section.hidden = matches === 0;
        if (spelling) group.section.open = matches > 0;
        else if (openBeforeSearch) group.section.open = openBeforeSearch.has(group);
        totalMatches += matches;
      }
      if (!spelling) openBeforeSearch = undefined;
      $('word-groups-note').textContent = totalMatches
        ? `Найдено ${totalMatches.toLocaleString('ru-RU')} из ${total}.`
        : 'Найдено 0 слов. Попробуйте изменить запрос или уровень.';
    }

    const storageKey = `english-reading-dictionary:${location.pathname}`;
    try {
      const saved = JSON.parse(sessionStorage.getItem(storageKey));
      if (typeof saved?.query === 'string') search.value = saved.query;
      if (['all', 'A1', 'A2'].includes(saved?.level)) level.value = saved.level;
    } catch { /* Search still works without storage. */ }

    function saveFilters() {
      updateResults();
      try {
        sessionStorage.setItem(storageKey, JSON.stringify({ query: search.value, level: level.value }));
      } catch { /* Keep the filters in the current page. */ }
    }

    search.addEventListener('input', saveFilters);
    level.addEventListener('change', saveFilters);
    $('dictionary-reset').addEventListener('click', () => {
      search.value = '';
      level.value = 'all';
      saveFilters();
      search.focus();
    });
    updateResults();
  }

  setupDictionary();
})();
