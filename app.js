(() => {
  'use strict';

  const $ = id => document.getElementById(id);
  const settings = $('settings');
  const wordCount = $('word-count');
  const levelSelect = $('level');
  const tabs = [...document.querySelectorAll('[data-mode]')];
  const list = $('answer-list');
  const checkResult = $('check-result');
  const actionStatus = $('action-status');
  const downloadResponses = $('download-responses');
  const baseLimit = Number(wordCount.max);
  const starterWords = globalThis.WORDS;
  const catalog = globalThis.OXFORD_CATALOG;
  const levels = { all: 'A1 и A2', A1: 'A1', A2: 'A2' };
  const exercises = [
    {
      title: 'Запишите транскрипцию',
      instructions: 'Прочитайте слово и запишите его британскую транскрипцию. Косые черты можно опустить.',
      placeholder: 'Транскрипция',
    },
    {
      title: 'Запишите слово',
      instructions: 'Прочитайте транскрипцию и запишите слово по-английски.',
      placeholder: 'Слово',
    },
  ];
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
  const families = {
    'short-a': 'short', 'short-e': 'short', 'short-i': 'short',
    'short-o': 'short', 'short-u': 'short', sh: 'consonants',
    ch: 'consonants', 'th-voiceless': 'consonants', 'th-voiced': 'consonants',
    wh: 'consonants', kn: 'consonants', wr: 'consonants', ph: 'consonants',
    ng: 'consonants', ck: 'consonants', tion: 'consonants', 'other-short': 'other',
    other: 'other', phrases: 'other',
  };

  let worksheet;
  let mode = 0;
  let draft;
  let activeInput;
  let renderedRows = [];
  const ipaSymbols = ['ə', 'ʊ', 'ɪ', 'æ', 'ɒ', 'ʌ', 'ɑ', 'ɔ', 'ɜ',
    'ʃ', 'ʒ', 'θ', 'ð', 'ŋ', 'ɡ', 'tʃ', 'dʒ', 'ː', 'ˈ', 'ˌ'];

  function element(tag, className, value) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (value !== undefined) node.textContent = value;
    return node;
  }

  function idFor(text) {
    let hash = 2166136261;
    for (const character of text) {
      hash = Math.imul(hash ^ character.codePointAt(0), 16777619);
    }
    return (hash >>> 0).toString(36);
  }

  const starterById = new Map(starterWords.map(word => [idFor(word.word), word]));
  const catalogById = new Map(catalog.words.map(word => [idFor(word.word), word]));

  function hasLevel(word, level) {
    return level === 'all' || (word.levels ?? [word.level]).includes(level);
  }

  function poolFor(level) {
    return catalog.words.filter(word => hasLevel(word, level));
  }

  function availableCount(level) {
    return Math.min(baseLimit, Math.floor(poolFor(level).length / 2));
  }

  function shuffle(values) {
    for (let index = values.length - 1; index > 0; index -= 1) {
      const choice = Math.floor(Math.random() * (index + 1));
      [values[index], values[choice]] = [values[choice], values[index]];
    }
    return values;
  }

  function draw(remaining, count, level) {
    const a2 = level === 'all' ? Math.floor(count * 0.3 + 0.5) : 0;
    const schedule = level === 'all'
      ? shuffle([...Array(count - a2).fill('A1'), ...Array(a2).fill('A2')])
      : Array(count).fill(level);
    const groupUses = new Map();
    const familyUses = new Map();
    const familyOf = word => families[word.group] ?? 'vowels';
    const priority = word => (groupUses.get(word.group) ?? 0) * (count + 1)
      + (familyUses.get(familyOf(word)) ?? 0);

    return schedule.map(wantedLevel => {
      const eligible = remaining.filter(word => hasLevel(word, wantedLevel));
      const candidates = eligible.length ? eligible : remaining;
      const lowest = Math.min(...candidates.map(priority));
      const word = candidates.find(candidate => priority(candidate) === lowest);
      remaining.splice(remaining.indexOf(word), 1);
      groupUses.set(word.group, (groupUses.get(word.group) ?? 0) + 1);
      const family = familyOf(word);
      familyUses.set(family, (familyUses.get(family) ?? 0) + 1);
      return word;
    });
  }

  function generate(count, level) {
    const remaining = shuffle([...poolFor(level)]);
    return { level, edition: 'catalog', items: [draw(remaining, count, level), draw(remaining, count, level)] };
  }

  function encode({ level, edition, items }) {
    if (edition === 'full') {
      const packed = items.map(rows => rows.map(({ word, ipa, alternatives, spellings, source, hint, sense, display }) =>
        [word, ipa, alternatives, spellings, source, hint, sense, display]));
      const binary = Array.from(new TextEncoder().encode(JSON.stringify([level, packed])), byte => String.fromCharCode(byte)).join('');
      return `v2.${btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}`;
    }
    const version = edition === 'starter' ? 'v1' : 'v3';
    return `${version}.${level}.${items.map(rows => rows.map(row => idFor(row.word)).join('-')).join('.')}`;
  }

  function decodeFull(token) {
    if (!/^v2\.[a-z0-9_-]+$/i.test(token) || token.length > 11000) return;
    const validText = value => typeof value === 'string' && value.length > 0 && value.length <= 120;
    const validList = value => value === null || (Array.isArray(value) && value.length <= 20 && value.every(validText));
    try {
      const binary = atob(token.slice(3).replace(/-/g, '+').replace(/_/g, '/'));
      const [level, packed] = JSON.parse(new TextDecoder().decode(Uint8Array.from(binary, char => char.charCodeAt(0))));
      if (!Object.hasOwn(levels, level) || !Array.isArray(packed) || packed.length !== 2
        || !packed.every(Array.isArray) || packed[0].length === 0 || packed[0].length > baseLimit
        || packed[0].length !== packed[1].length) return;
      const valid = packed.flat().every(row => Array.isArray(row) && row.length === 8
        && validText(row[0]) && validText(row[1]) && validList(row[2]) && validList(row[3])
        && row.slice(4).every(value => value === null || value === '' || validText(value)));
      if (!valid || new Set(packed.flat().map(row => row[0])).size !== packed[0].length * 2) return;
      const items = packed.map(rows => rows.map(([word, ipa, alternatives, spellings, source, hint, sense, display]) =>
        ({ word, ipa, alternatives, spellings, source, hint, sense, display })));
      return { level, edition: 'full', items };
    } catch { return undefined; }
  }

  function decode(token) {
    if (token.startsWith('v2.')) return decodeFull(token);
    if (!/^v[13]\.(all|A1|A2)\.[a-z0-9-]+\.[a-z0-9-]+$/.test(token) || token.length > 260) return;
    const [version, level, left, right] = token.split('.');
    const legacy = version === 'v1';
    const words = legacy ? starterById : catalogById;
    const items = [left, right].map(part => part.split('-').map(id => words.get(id)));
    const combined = items.flat();
    if (items[0].length !== items[1].length || items[0].length > availableCount(level)
      || new Set(combined).size !== combined.length
      || combined.some(word => !word || !hasLevel(word, level))) return;
    return { level, edition: legacy ? 'starter' : 'catalog', items };
  }

  function storageKey() {
    return `english-reading:${location.pathname}:${encode(worksheet)}`;
  }

  function blankDraft() {
    return { mode: 0, checked: [false, false], responses: worksheet.items.map(rows => rows.map(() => '')) };
  }

  function readDraft() {
    try {
      const record = JSON.parse(sessionStorage.getItem(storageKey()));
      if (record && [0, 1].includes(record.mode) && record.checked?.length === 2
        && record.responses?.length === 2
        && record.responses.every((row, index) => Array.isArray(row) && row.length === worksheet.items[index].length
          && row.every(answer => typeof answer === 'string' && answer.length <= 64))) return record;
    } catch { /* The current page remains usable when session storage is unavailable. */ }
    return blankDraft();
  }

  function saveDraft() {
    try { sessionStorage.setItem(storageKey(), JSON.stringify(draft)); }
    catch { /* The draft is still kept in memory. */ }
  }

  function applyWorksheet(value, historyMethod) {
    worksheet = value;
    if (historyMethod) history[historyMethod](null, '', `#${encode(worksheet)}`);
    draft = readDraft();
    levelSelect.value = worksheet.level;
    wordCount.max = availableCount(worksheet.level);
    wordCount.value = worksheet.items[0].length;
    $('worksheet-meta').textContent = `${levels[worksheet.level]} · ${worksheet.items[0].length} в каждом задании`;
    $('settings-note').textContent = '';
    actionStatus.textContent = '';
    renderHeroExample();
    renderPrint();
    setMode(draft.mode);
  }

  function renderHeroExample() {
    const pairs = [
      [['ship', 'ʃɪp'], ['sheep', 'ʃiːp']],
      [['sit', 'sɪt'], ['seat', 'siːt']],
      [['bin', 'bɪn'], ['bean', 'biːn']],
      [['bit', 'bɪt'], ['beat', 'biːt']],
    ];
    const prompts = new Set(worksheet.items.flat().map(word => word.word));
    const [short, long] = pairs.find(pair => pair.every(([word]) => !prompts.has(word))) ?? pairs[0];
    $('hero-short-word').textContent = short[0];
    $('hero-short-ipa').textContent = `/${short[1]}/`;
    $('hero-long-word').textContent = long[0];
    $('hero-long-ipa').textContent = `/${long[1]}/`;
  }

  function revealStudyTip() {
    if (reducedMotion.matches || !('IntersectionObserver' in window)) return;
    const observer = new IntersectionObserver(entries => {
      for (const { target, isIntersecting } of entries) {
        if (!isIntersecting) continue;
        target.removeAttribute('data-pending');
        observer.unobserve(target);
      }
    }, { rootMargin: '0px 0px -12% 0px' });
    let position = 0;
    for (const line of document.querySelectorAll('.tip-line')) {
      const words = line.textContent.trim().split(/\s+/);
      line.replaceChildren();
      for (const [index, word] of words.entries()) {
        if (index > 0) line.append(' ');
        const span = element('span', 'tip-word', word);
        span.dataset.pending = '';
        span.style.transitionDelay = `${position * 32}ms`;
        position += 1;
        line.append(span);
        observer.observe(span);
      }
    }
  }

  function currentPrompt(word, index) {
    return index === 0 ? (word.display ?? word.word) : `/${word.ipa}/`;
  }

  function promptHint(word, index) {
    return index === 0 ? word.sense : word.hint;
  }

  function addPrompt(node, word, index) {
    const prompt = element('span', null, currentPrompt(word, index));
    prompt.lang = 'en';
    node.append(prompt);
    const hint = promptHint(word, index);
    if (hint) node.append(element('span', 'prompt-hint', ` (${hint})`));
  }

  function displayAnswer(word, index) {
    if (index === 1) {
      const spellings = word.hint ? [word.word] : (word.spellings ?? [word.word]);
      return spellings.map(spelling => spelling === word.word ? (word.display ?? word.word) : spelling).join(' или ');
    }
    return [word.ipa, ...(word.alternatives ?? [])].map(ipa => `/${ipa}/`).join(' или ');
  }

  function ipaKey(value, source) {
    const normal = value.normalize('NFC').replace(/[\s/\[\].͜͡]/gu, '')
      .replace(/g/g, 'ɡ').replace(/:/g, 'ː').replace(/['’]/g, 'ˈ');
    if (source !== 'Britfone') return normal;
    return normal.replace(/ɹ/g, 'r').replace(/ɛ/g, 'e').replace(/ɐ/g, 'ʌ')
      .replace(/([ˈˌ])([^aeiouæɑɒɔʊʌɜəɪˈˌ]+)(?=[aeiouæɑɒɔʊʌɜəɪ])/g, '$2$1');
  }

  function isCorrect(answer, word, index) {
    if (index === 1) {
      const normalizeSpelling = spelling => spelling.trim().toLowerCase().normalize('NFC').replace(/’/g, "'").replace(/\s+/g, ' ');
      const accepted = word.hint ? [word.word] : (word.spellings ?? [word.word]);
      return accepted.some(spelling => normalizeSpelling(spelling) === normalizeSpelling(answer));
    }
    const entered = ipaKey(answer, word.source);
    return [word.ipa, ...(word.alternatives ?? [])].some(ipa => entered === ipaKey(ipa, word.source));
  }

  function renderProgress() {
    const answered = draft.responses[mode].filter(answer => answer.trim()).length;
    const progress = $('answer-progress');
    const message = `Заполнено ${answered} из ${renderedRows.length}`;
    if (progress.textContent !== message) progress.textContent = message;
  }

  function grade() {
    let correct = 0;
    let missing = 0;
    renderedRows.forEach(({ item, input, feedback, word }) => {
      const blank = !input.value.trim();
      const matched = !blank && isCorrect(input.value, word, mode);
      correct += Number(matched);
      missing += Number(blank);
      item.dataset.result = blank ? 'empty' : matched ? 'correct' : 'incorrect';
      input.setAttribute('aria-invalid', String(!blank && !matched));
      feedback.hidden = false;
      feedback.textContent = blank ? 'Без ответа' : matched ? 'Верно' : `Ответ: ${displayAnswer(word, mode)}`;
    });
    const missingText = missing ? ` Без ответа: ${missing}.` : '';
    checkResult.textContent = `Верно ${correct} из ${renderedRows.length}.${missingText}`;
    draft.checked[mode] = true;
    saveDraft();
  }

  function inputChanged(index, input) {
    draft.responses[mode][index] = input.value;
    if (draft.checked[mode]) {
      draft.checked[mode] = false;
      for (const { item, input: field, feedback } of renderedRows) {
        delete item.dataset.result;
        field.removeAttribute('aria-invalid');
        feedback.hidden = true;
      }
      checkResult.textContent = '';
    }
    saveDraft();
    renderProgress();
  }

  function renderRow(word, index) {
    const item = element('li', 'question-row');
    const number = element('span', 'question-index', String(index + 1).padStart(2, '0'));
    number.setAttribute('aria-hidden', 'true');
    const label = element('label', 'question-prompt');
    const cell = element('div', 'answer-cell');
    const input = element('input', 'answer-input');
    const feedback = element('p', 'answer-feedback');
    input.id = `answer-${index + 1}`;
    input.lang = 'en';
    input.type = 'text';
    input.maxLength = 64;
    input.spellcheck = false;
    input.autocomplete = 'off';
    input.setAttribute('autocapitalize', 'none');
    input.setAttribute('autocorrect', 'off');
    input.placeholder = exercises[mode].placeholder;
    input.value = draft.responses[mode][index];
    feedback.id = `${input.id}-feedback`;
    feedback.hidden = true;
    input.setAttribute('aria-describedby', feedback.id);
    label.htmlFor = input.id;
    addPrompt(label, word, mode);
    input.addEventListener('focus', () => {
      activeInput = input;
      $('ipa-target').textContent = `Символы вставляются в строку ${index + 1}`;
    });
    input.addEventListener('input', () => inputChanged(index, input));
    cell.append(input, feedback);
    item.append(number, label, cell);
    return { item, input, feedback, word };
  }

  function setMode(index) {
    mode = index;
    draft.mode = index;
    for (const [tabIndex, tab] of tabs.entries()) {
      tab.setAttribute('aria-selected', String(tabIndex === mode));
      tab.tabIndex = tabIndex === mode ? 0 : -1;
    }
    $('exercise-panel').setAttribute('aria-labelledby', tabs[mode].id);
    const exercise = exercises[mode];
    $('exercise-title').textContent = exercise.title;
    $('instructions').textContent = exercise.instructions;
    const chosen = new Set(worksheet.items.flat().map(word => word.word));
    const example = starterWords.find(word => !chosen.has(word.word) && word.group.startsWith('short-'));
    const exampleAnswer = mode === 0 ? example.ipa : currentPrompt(example, 0);
    const [first, second] = [currentPrompt(example, mode), exampleAnswer]
      .map(value => element('strong', null, value));
    first.lang = second.lang = 'en';
    $('exercise-example').replaceChildren('Например, ', first, ' → ', second);
    $('ipa-keyboard').hidden = mode === 1;
    $('ipa-target').textContent = 'Символы вставляются в строку 1';
    activeInput = undefined;
    checkResult.textContent = '';
    renderedRows = worksheet.items[mode].map(renderRow);
    list.replaceChildren(...renderedRows.map(row => row.item));
    if (mode === 0) addKeyboard();
    renderProgress();
    if (draft.checked[mode]) grade();
    saveDraft();
  }

  function addKeyboard() {
    const keys = $('ipa-keys');
    const symbols = new Set(ipaSymbols);
    for (const word of worksheet.items[0]) {
      for (const symbol of [word.ipa, ...(word.alternatives ?? [])].join('')) {
        if (/[^\x00-\x7F]/.test(symbol)) symbols.add(symbol);
      }
    }
    keys.replaceChildren();
    for (const symbol of symbols) {
      const button = element('button', 'ipa-key', symbol);
      button.type = 'button';
      button.setAttribute('aria-label', `Вставить ${symbol}`);
      button.addEventListener('mousedown', event => event.preventDefault());
      button.addEventListener('click', () => {
        const input = activeInput ?? renderedRows[0].input;
        const { selectionStart, selectionEnd } = input;
        if (input.value.length - (selectionEnd - selectionStart) + symbol.length > input.maxLength) return;
        input.focus({ preventScroll: true });
        input.setRangeText(symbol, selectionStart, selectionEnd, 'end');
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
      keys.append(button);
    }
  }

  function renderGroups() {
    const container = $('word-groups');
    const entries = catalog.words;
    const grouped = new Map();
    for (const entry of entries) {
      const group = Object.hasOwn(groups, entry.group) ? entry.group : 'other';
      if (!grouped.has(group)) grouped.set(group, []);
      grouped.get(group).push(entry);
    }
    $('word-groups-note').textContent = `${entries.length.toLocaleString('ru-RU')} слов и выражений Oxford 3000 уровня A1–A2. Нажмите на группу, чтобы открыть список.`;
    container.replaceChildren();
    for (const [group, title] of Object.entries(groups)) {
      if (!grouped.has(group)) continue;
      const section = element('details', 'word-group');
      const heading = element('summary', null, title);
      heading.append(element('small', null, String(grouped.get(group).length)));
      const items = element('ul', 'word-group-list');
      for (const word of grouped.get(group)) {
        const row = element('li', 'word-chip');
        const label = element('span', null, word.display ?? word.word);
        label.lang = 'en';
        row.append(label, element('small', null, (word.levels ?? [word.level]).join(' · ')));
        items.append(row);
      }
      section.append(heading, items);
      container.append(section);
    }
  }

  function variantId() {
    return idFor(encode(worksheet)).toUpperCase();
  }

  function renderPrint() {
    const sections = worksheet.items.map((wordsForExercise, index) => {
      const section = element('section', 'print-section');
      const items = element('ol');
      for (const word of wordsForExercise) {
        const item = element('li', 'print-row');
        const prompt = element('span', 'print-prompt');
        addPrompt(prompt, word, index);
        item.append(prompt, element('span', 'print-line'));
        items.append(item);
      }
      section.append(element('h2', null, `${index + 1}. ${exercises[index].title}`),
        element('p', null, exercises[index].instructions), items);
      return section;
    });
    $('print-work').replaceChildren(element('h1', null, 'Слова и звуки'),
      element('p', null, `Вариант ${variantId()} · ${levels[worksheet.level]} · Британский английский`),
      ...sections);
  }

  function responseSheet() {
    return {
      title: 'Слова и звуки',
      subtitle: `Ответы ученика · ${levels[worksheet.level]}`,
      filename: `Ответы-${variantId()}.pdf`,
      sections: worksheet.items.map((wordsForExercise, index) => ({
        title: `${index + 1}. ${exercises[index].title}`,
        instructions: exercises[index].instructions,
        rows: wordsForExercise.map((word, row) => ({
          prompt: currentPrompt(word, index),
          hint: promptHint(word, index),
          answer: draft.responses[index][row].trim(),
        })),
      })),
    };
  }

  function worksheetUrl() {
    const url = new URL(location.href);
    url.hash = encode(worksheet);
    return url.href;
  }

  async function copy(value, success, fallbackTitle) {
    try {
      await navigator.clipboard.writeText(value);
      actionStatus.textContent = success;
    } catch {
      const dialog = $('share-fallback');
      $('share-title').textContent = fallbackTitle;
      const field = $('share-value');
      field.value = value;
      dialog.showModal();
      field.focus();
      field.select();
    }
  }

  function openLocation() {
    const fragment = location.hash.slice(1);
    const fromLink = decode(fragment);
    if (fromLink) {
      applyWorksheet(fromLink);
    } else if (!worksheet || /^v[123]\./.test(fragment)) {
      applyWorksheet(generate(10, 'all'), 'replaceState');
      if (/^v[123]\./.test(fragment)) $('settings-note').textContent = 'Эта ссылка не открылась. Создан новый вариант.';
    }
  }

  settings.addEventListener('submit', event => {
    event.preventDefault();
    const level = levelSelect.value;
    const count = wordCount.valueAsNumber;
    if (!Number.isInteger(count) || count < 1 || count > availableCount(level)) return;
    applyWorksheet(generate(count, level), 'pushState');
    $('settings-note').textContent = 'Новый вариант готов.';
  });

  levelSelect.addEventListener('change', () => {
    wordCount.max = availableCount(levelSelect.value);
    if (wordCount.valueAsNumber > Number(wordCount.max)) wordCount.value = wordCount.max;
    $('settings-note').textContent = '';
  });

  for (const [index, tab] of tabs.entries()) {
    tab.addEventListener('click', () => { if (index !== mode) setMode(index); });
    tab.addEventListener('keydown', event => {
      const next = { ArrowLeft: 1 - index, ArrowRight: 1 - index, Home: 0, End: 1 }[event.key];
      if (next === undefined) return;
      event.preventDefault();
      if (next !== mode) setMode(next);
      tabs[next].focus();
    });
  }

  $('check-answers').addEventListener('click', grade);
  $('copy-link').addEventListener('click', () => copy(worksheetUrl(), 'Ссылка скопирована.', 'Ссылка на вариант'));
  downloadResponses.addEventListener('click', async () => {
    if (!draft.responses.flat().some(response => response.trim())) {
      actionStatus.textContent = 'Запишите хотя бы один ответ.';
      return;
    }
    downloadResponses.disabled = true;
    actionStatus.textContent = 'Готовим PDF…';
    try {
      await globalThis.downloadWorksheetResponses(responseSheet());
      actionStatus.textContent = 'PDF готов.';
    } catch {
      actionStatus.textContent = 'Не удалось скачать PDF. Проверьте подключение и попробуйте ещё раз.';
    } finally {
      downloadResponses.disabled = false;
    }
  });
  $('print-worksheet').addEventListener('click', () => window.print());
  $('close-share').addEventListener('click', () => $('share-fallback').close());
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  for (const link of document.querySelectorAll('[data-section]')) {
    link.addEventListener('click', event => {
      if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
      const target = $(link.hash.slice(1));
      event.preventDefault();
      if (target instanceof HTMLDetailsElement) target.open = true;
      target.focus({ preventScroll: true });
      const instant = reducedMotion.matches || link.classList.contains('skip-link');
      target.scrollIntoView({ behavior: instant ? 'auto' : 'smooth' });
    });
  }
  window.addEventListener('hashchange', openLocation);

  renderGroups();
  openLocation();
  revealStudyTip();
})();
