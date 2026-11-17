(() => {
  'use strict';

  const $ = id => document.getElementById(id);
  const settings = $('settings');
  const wordCount = $('word-count');
  const levelSelect = $('level');
  const phonemeSelect = $('phoneme');
  const allSoundGroups = $('all-sound-groups');
  const tabs = [...document.querySelectorAll('[data-mode]')];
  const list = $('answer-list');
  const checkResult = $('check-result');
  const checkAnswers = $('check-answers');
  const repeatErrors = $('repeat-errors');
  const returnFromReview = $('return-from-review');
  const mobileLayout = matchMedia('(max-width: 740px)');
  const keyboard = $('ipa-keyboard');
  const keyboardHome = $('ipa-keyboard-home');
  const actionStatus = $('action-status');
  const downloadResponses = $('download-responses');
  const sitePath = new URL('./', location.href).pathname;
  const lastVariantKey = `english-reading-last:${sitePath}`;
  const baseLimit = Number(wordCount.max);
  const starterWords = globalThis.WORDS;
  const catalog = globalThis.OXFORD_CATALOG;
  const levels = { all: 'A1 и A2', A1: 'A1', A2: 'A2' };
  const exercises = [
    {
      title: 'Запишите транскрипцию',
      instructions: 'Запишите британскую транскрипцию слова. Косые черты можно опустить.',
      placeholder: 'Транскрипция',
    },
    {
      title: 'Запишите слово',
      instructions: 'Запишите английское слово по транскрипции.',
      placeholder: 'Слово',
    },
  ];
  const { choose, hasLevel, isCorrect, ipaTokens } = globalThis.READING_RULES;
  const soundGroups = [['θ', 'ð'], ['ɪ', 'iː'], ['æ', 'e'], ['ʃ', 'tʃ'], ['ʊ', 'uː']];
  const soundGroupControls = new Map();

  let worksheet;
  let mode = 0;
  let draft;
  let reviewDrafts;
  let activeInput;
  let openIpaToggle;
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
  const soundsByWord = new Map(catalog.words.map(word => [word, new Set(ipaTokens(word.ipa))]));
  const exerciseLimit = size => Math.min(baseLimit, Math.floor(size / 2));

  function setupSoundFilters() {
    const phonemes = new Set([...soundsByWord.values()].flatMap(sounds => [...sounds]));
    for (const sound of [...phonemes].sort((a, b) => a.localeCompare(b, 'en'))) {
      const option = element('option', null, `/${sound}/`);
      option.value = sound;
      phonemeSelect.append(option);
    }
    for (const sounds of soundGroups) {
      const label = element('label');
      const input = element('input');
      input.type = 'checkbox';
      label.append(input, sounds.map(sound => `/${sound}/`).join(' и '));
      $('sound-groups').append(label);
      soundGroupControls.set(input, sounds);
    }
  }

  function clearSoundFilters() {
    phonemeSelect.value = '';
    for (const input of soundGroupControls.keys()) input.checked = false;
  }

  function eligibleWords(level) {
    const phonemes = new Set(phonemeSelect.value ? [phonemeSelect.value] : []);
    for (const [input, sounds] of soundGroupControls) {
      if (input.checked) for (const sound of sounds) phonemes.add(sound);
    }
    const selected = [...phonemes];
    return catalog.words.filter(word => hasLevel(word, level) &&
      (!selected.length || selected.some(sound => soundsByWord.get(word).has(sound))));
  }

  function updateVariantSettings() {
    const checked = [...soundGroupControls.keys()].filter(input => input.checked).length;
    allSoundGroups.checked = checked === soundGroupControls.size;
    allSoundGroups.indeterminate = checked > 0 && !allSoundGroups.checked;
    const size = eligibleWords(levelSelect.value).length;
    const limit = exerciseLimit(size);
    wordCount.max = Math.max(1, limit);
    wordCount.disabled = limit === 0;
    $('generate-worksheet').disabled = limit === 0;
    if (limit && wordCount.valueAsNumber > limit) wordCount.value = limit;
    $('available-prompts').textContent = `Слов в подборке — ${size.toLocaleString('ru-RU')}. ` + (limit
      ? `В каждом упражнении до ${limit} заданий.` : 'Нужно хотя бы два разных слова.');
  }

  function generate(count, level, pool = catalog.words) {
    return { level, edition: 'catalog', items: choose(pool, count, level) };
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
    const limit = exerciseLimit(catalog.words.filter(word => hasLevel(word, level)).length);
    if (items[0].length !== items[1].length || items[0].length > limit
      || new Set(combined).size !== combined.length
      || combined.some(word => !word || !hasLevel(word, level))) return;
    return { level, edition: legacy ? 'starter' : 'catalog', items };
  }

  function storageKey(path = location.pathname) {
    return `english-reading:${path}:${encode(worksheet)}`;
  }

  function blankDraft() {
    return { mode: 0, checked: [false, false], responses: worksheet.items.map(rows => rows.map(() => '')) };
  }

  function readDraft() {
    for (const path of [location.pathname, sitePath, `${sitePath}index.html`]) {
      try {
        const record = JSON.parse(sessionStorage.getItem(storageKey(path)));
        if (record && [0, 1].includes(record.mode) && record.checked?.length === 2
          && Array.isArray(record.responses) && record.responses.length === 2
          && record.responses.every((row, index) => Array.isArray(row) && row.length === worksheet.items[index].length
            && row.every(answer => typeof answer === 'string' && answer.length <= 64))) return record;
      } catch { /* Try the next key when a record is unreadable. */ }
    }
    return blankDraft();
  }

  function saveDraft() {
    try { sessionStorage.setItem(storageKey(), JSON.stringify(draft)); }
    catch { /* The draft is still kept in memory. */ }
  }

  const reviewFallback = new Map();
  const reviewStore = {
    read(key) {
      try {
        const saved = reviewFallback.get(key) ?? localStorage.getItem(key);
        return saved === null ? undefined : JSON.parse(saved);
      } catch { return undefined; }
    },
    write(key, review) {
      const saved = JSON.stringify(review);
      try {
        localStorage.setItem(key, saved);
        reviewFallback.delete(key);
      } catch { reviewFallback.set(key, saved); }
    },
  };

  function reviewKey(index) {
    return `english-reading-mistakes:v1:${sitePath}:${encode(worksheet)}:${index}`;
  }

  function newReview(indices) {
    return { indices, responses: indices.map(() => ''), checked: false };
  }

  function readReview(words, index) {
    const record = reviewStore.read(reviewKey(index));
    if (record === null) return null;
    if (Array.isArray(record?.indices) && record.indices.length > 0
      && new Set(record.indices).size === record.indices.length
      && record.indices.every(position => Number.isInteger(position) && position >= 0 && position < words.length)
      && Array.isArray(record.responses) && record.responses.length === record.indices.length
      && record.responses.every(answer => typeof answer === 'string' && answer.length <= 64)
      && typeof record.checked === 'boolean') return record;

    if (!draft.checked[index]) return null;
    const indices = words.flatMap((word, position) => {
      const answer = draft.responses[index][position];
      return answer.trim() && !isCorrect(answer, word, index) ? [position] : [];
    });
    const review = indices.length ? newReview(indices) : null;
    reviewStore.write(reviewKey(index), review);
    return review;
  }

  function saveReview(review) {
    reviewDrafts[mode] = review;
    reviewStore.write(reviewKey(mode), review);
  }

  function remainingMistakes() {
    const review = reviewDrafts[mode];
    if (!review) return [];
    if (!review.checked) return review.indices;
    return review.indices.filter((index, position) => {
      const answer = review.responses[position];
      return !answer.trim() || !isCorrect(answer, worksheet.items[mode][index], mode);
    });
  }

  function applyWorksheet(value, historyMethod) {
    worksheet = value;
    if (historyMethod) history[historyMethod](null, '', `#${encode(worksheet)}`);
    try { sessionStorage.setItem(lastVariantKey, encode(worksheet)); }
    catch { /* The variant stays open when storage is unavailable. */ }
    draft = readDraft();
    reviewDrafts = worksheet.items.map(readReview);
    levelSelect.value = worksheet.level;
    wordCount.value = worksheet.items[0].length;
    updateVariantSettings();
    $('worksheet-meta').textContent = `${levels[worksheet.level]} · по ${worksheet.items[0].length} в каждом упражнении`;
    $('settings-note').textContent = '';
    actionStatus.textContent = '';
    renderPrint();
    setMode(draft.mode, draft.reviewing === true);
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

  function renderProgress() {
    const answered = renderedRows.filter(({ input }) => input.value.trim()).length;
    const progress = $('answer-progress');
    const message = `Заполнено ${answered} из ${renderedRows.length}`;
    if (progress.textContent !== message) progress.textContent = message;
  }

  function renderGrade() {
    let correct = 0;
    let missing = 0;
    const incorrect = [];
    renderedRows.forEach(({ item, input, feedback, word }, index) => {
      const blank = !input.value.trim();
      const matched = !blank && isCorrect(input.value, word, mode);
      correct += Number(matched);
      missing += Number(blank);
      if (!blank && !matched) incorrect.push(index);
      item.dataset.result = blank ? 'empty' : matched ? 'correct' : 'incorrect';
      input.setAttribute('aria-invalid', String(!blank && !matched));
      feedback.hidden = false;
      feedback.textContent = blank ? 'Без ответа' : matched ? 'Верно' : `Ответ: ${displayAnswer(word, mode)}`;
    });
    const missingText = missing ? ` Без ответа — ${missing}.` : '';
    const success = correct === renderedRows.length
      ? draft.reviewing ? ' Все ошибки исправлены.' : ' Все ответы верны.' : '';
    checkResult.textContent = `Верно ${correct} из ${renderedRows.length}. Ошибок — ${incorrect.length}.${missingText}${success}`;
    return incorrect;
  }

  function updateReviewActions() {
    const reviewed = draft.reviewing && reviewDrafts[mode].checked;
    repeatErrors.hidden = (draft.reviewing && !reviewed) || remainingMistakes().length === 0;
    returnFromReview.hidden = !draft.reviewing;
    checkAnswers.hidden = reviewed;
    if (reviewed) closeInlineKeyboard();
    keyboard.hidden = mode === 1 || reviewed;
    for (const { input, ipaToggle } of renderedRows) {
      input.readOnly = reviewed;
      if (ipaToggle) ipaToggle.hidden = reviewed;
    }
  }

  function grade() {
    const incorrect = renderGrade();
    if (draft.reviewing) {
      const review = reviewDrafts[mode];
      review.checked = true;
      saveReview(review);
    } else {
      if (!draft.checked[mode]) {
        const previous = remainingMistakes();
        const wrong = new Set(incorrect);
        const unresolved = new Set(previous);
        const next = renderedRows.flatMap(({ input }, index) =>
          wrong.has(index) || (!input.value.trim() && unresolved.has(index)) ? [index] : []);
        if (next.length !== previous.length || next.some((index, position) => index !== previous[position])) {
          saveReview(next.length ? newReview(next) : null);
        }
      }
      draft.checked[mode] = true;
      saveDraft();
      if (!/^#v[123]\./.test(location.hash)) history.replaceState(history.state, '', `#${encode(worksheet)}`);
    }
    updateReviewActions();
    if (draft.reviewing) checkResult.focus({ preventScroll: true });
  }

  function inputChanged(index, input) {
    if (draft.reviewing) {
      const review = reviewDrafts[mode];
      review.responses[index] = input.value;
      saveReview(review);
      renderProgress();
      return;
    }
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

  function closeInlineKeyboard() {
    if (!openIpaToggle) return;
    openIpaToggle.setAttribute('aria-expanded', 'false');
    openIpaToggle = undefined;
    keyboardHome.append(keyboard);
  }

  function selectAnswerInput(input, index) {
    if (activeInput !== input) closeInlineKeyboard();
    activeInput = input;
    $('ipa-target').textContent = `Строка ${index + 1}`;
  }

  function renderRow(word, index, answer) {
    const item = element('li', 'question-row');
    const number = element('span', 'question-index', String(index + 1).padStart(2, '0'));
    number.setAttribute('aria-hidden', 'true');
    const label = element('label', 'question-prompt');
    const cell = element('div', 'answer-cell');
    const controls = element('div', 'answer-controls');
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
    input.value = answer;
    feedback.id = `${input.id}-feedback`;
    feedback.hidden = true;
    input.setAttribute('aria-describedby', feedback.id);
    label.htmlFor = input.id;
    addPrompt(label, word, mode);
    input.addEventListener('focus', () => selectAnswerInput(input, index));
    input.addEventListener('input', () => inputChanged(index, input));
    controls.append(input);
    let ipaToggle;
    if (mode === 0) {
      ipaToggle = element('button', 'button button-outline answer-ipa-toggle', 'IPA');
      ipaToggle.type = 'button';
      ipaToggle.setAttribute('aria-label', `Символы IPA для строки ${index + 1}`);
      ipaToggle.setAttribute('aria-controls', keyboard.id);
      ipaToggle.setAttribute('aria-expanded', 'false');
      ipaToggle.addEventListener('click', () => {
        const wasOpen = openIpaToggle === ipaToggle;
        closeInlineKeyboard();
        if (wasOpen) return;
        selectAnswerInput(input, index);
        openIpaToggle = ipaToggle;
        ipaToggle.setAttribute('aria-expanded', 'true');
        ipaToggle.focus({ preventScroll: true });
        item.append(keyboard);
        keyboard.scrollIntoView({ block: 'nearest' });
      });
      controls.append(ipaToggle);
    }
    cell.append(controls, feedback);
    item.append(number, label, cell);
    return { item, input, feedback, word, ipaToggle };
  }

  function setMode(index, reviewing = false) {
    closeInlineKeyboard();
    mode = index;
    draft.mode = index;
    const review = reviewDrafts[mode];
    draft.reviewing = reviewing && Boolean(review);
    for (const [tabIndex, tab] of tabs.entries()) {
      tab.setAttribute('aria-selected', String(tabIndex === mode));
      tab.tabIndex = tabIndex === mode ? 0 : -1;
    }
    $('exercise-panel').setAttribute('aria-labelledby', tabs[mode].id);
    const exercise = exercises[mode];
    $('exercise-title').textContent = draft.reviewing ? 'Работа над ошибками' : exercise.title;
    $('instructions').textContent = exercise.instructions;
    const chosen = new Set(worksheet.items.flat().map(word => word.word));
    const example = starterWords.find(word => !chosen.has(word.word) && word.group.startsWith('short-'));
    const exampleAnswer = mode === 0 ? example.ipa : currentPrompt(example, 0);
    const [first, second] = [currentPrompt(example, mode), exampleAnswer]
      .map(value => element('strong', null, value));
    first.lang = second.lang = 'en';
    $('exercise-example').replaceChildren('Например, ', first, ' → ', second);
    $('ipa-target').textContent = 'Строка 1';
    activeInput = undefined;
    checkResult.textContent = '';
    const words = draft.reviewing ? review.indices.map(position => worksheet.items[mode][position]) : worksheet.items[mode];
    const responses = draft.reviewing ? review.responses : draft.responses[mode];
    renderedRows = words.map((word, position) => renderRow(word, position, responses[position]));
    list.replaceChildren(...renderedRows.map(row => row.item));
    if (mode === 0) addKeyboard();
    renderProgress();
    if (draft.reviewing ? review.checked : draft.checked[mode]) renderGrade();
    updateReviewActions();
    saveDraft();
  }

  function addKeyboard() {
    const keys = $('ipa-keys');
    const symbols = new Set(ipaSymbols);
    for (const { word } of renderedRows) {
      for (const symbol of [word.ipa, ...(word.alternatives ?? [])].join('')) {
        if (/[^\x00-\x7F]/.test(symbol)) symbols.add(symbol);
      }
    }
    keys.replaceChildren();
    for (const symbol of symbols) {
      const button = element('button', 'ipa-key', symbol);
      button.type = 'button';
      button.setAttribute('aria-label', `Вставить ${symbol}`);
      button.addEventListener('mousedown', event => {
        if (!openIpaToggle) event.preventDefault();
      });
      button.addEventListener('click', () => {
        const input = activeInput ?? renderedRows[0].input;
        const { selectionStart, selectionEnd } = input;
        if (input.readOnly || input.value.length - (selectionEnd - selectionStart) + symbol.length > input.maxLength) return;
        if (!openIpaToggle) input.focus({ preventScroll: true });
        input.setRangeText(symbol, selectionStart, selectionEnd, 'end');
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
      keys.append(button);
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
      title: 'Ответы к упражнениям',
      subtitle: levels[worksheet.level],
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
    const url = new URL('phonetics.html', location.href);
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
    if (fragment === 'sound-pairs') $('sound-pairs').open = true;
    const fromLink = decode(fragment);
    if (fromLink) {
      clearSoundFilters();
      applyWorksheet(fromLink);
    } else if (!worksheet || /^v[123]\./.test(fragment)) {
      const invalidLink = /^v[123]\./.test(fragment);
      let saved;
      if (!invalidLink) {
        try { saved = decode(sessionStorage.getItem(lastVariantKey) ?? ''); }
        catch { /* Open a new variant when storage is unavailable. */ }
      }
      clearSoundFilters();
      const historyMethod = $(fragment) ? undefined : 'replaceState';
      applyWorksheet(saved ?? generate(10, 'all'), historyMethod);
      if (invalidLink) $('settings-note').textContent = 'Не удалось открыть вариант по ссылке. Показываем новый.';
    }
  }

  settings.addEventListener('submit', event => {
    event.preventDefault();
    const level = levelSelect.value;
    const count = wordCount.valueAsNumber;
    const pool = eligibleWords(level);
    if (!Number.isInteger(count) || count < 1 || count > exerciseLimit(pool.length)) return;
    applyWorksheet(generate(count, level, pool), 'pushState');
    $('settings-note').textContent = 'Новый вариант готов.';
  });

  settings.addEventListener('change', event => {
    if (event.target === wordCount) return;
    if (event.target === allSoundGroups) {
      for (const input of soundGroupControls.keys()) input.checked = allSoundGroups.checked;
    }
    updateVariantSettings();
    $('settings-note').textContent = '';
  });

  function switchExercise(index) {
    if (index === mode) return;
    setMode(index);
    if (mobileLayout.matches) tabs[index].closest('.worksheet').scrollIntoView({ block: 'start' });
  }

  const variantPanel = $('variant-settings');
  variantPanel.open = !mobileLayout.matches;
  mobileLayout.addEventListener('change', () => {
    const focused = document.activeElement;
    const keyboardFocused = keyboard.contains(focused) || focused === openIpaToggle;
    closeInlineKeyboard();
    if (keyboardFocused) {
      const row = renderedRows.find(({ input }) => input === activeInput) ?? renderedRows[0];
      const target = mobileLayout.matches ? row?.ipaToggle : row?.input;
      target?.focus({ preventScroll: true });
    }
    if (!mobileLayout.matches || !variantPanel.contains(document.activeElement)) variantPanel.open = !mobileLayout.matches;
  });

  $('answer-list').addEventListener('keydown', event => {
    if (event.key !== 'Escape' || !openIpaToggle) return;
    openIpaToggle.focus();
    closeInlineKeyboard();
  });
  for (const [index, tab] of tabs.entries()) {
    tab.addEventListener('click', () => switchExercise(index));
    tab.addEventListener('keydown', event => {
      const next = { ArrowLeft: 1 - index, ArrowRight: 1 - index, Home: 0, End: 1 }[event.key];
      if (next === undefined) return;
      event.preventDefault();
      switchExercise(next);
      tabs[next].focus({ preventScroll: mobileLayout.matches });
    });
  }

  checkAnswers.addEventListener('click', grade);
  repeatErrors.addEventListener('click', () => {
    const indices = remainingMistakes();
    if (!indices.length) return;
    if (reviewDrafts[mode].checked) saveReview(newReview(indices));
    if (!/^#v[123]\./.test(location.hash)) history.replaceState(history.state, '', `#${encode(worksheet)}`);
    setMode(mode, true);
    $('exercise-title').focus();
  });
  returnFromReview.addEventListener('click', () => {
    setMode(mode);
    $('exercise-title').focus();
  });
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
      actionStatus.textContent = 'Не удалось скачать PDF. Проверьте интернет и попробуйте ещё раз.';
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

  setupSoundFilters();
  openLocation();
})();
