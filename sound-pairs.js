(() => {
  'use strict';

  const contrasts = [
    { label: '/ɪ/ и /iː/', pairs: [['ship', 'sheep'], ['sit', 'seat']] },
    { label: '/æ/ и /e/', pairs: [['bad', 'bed'], ['man', 'men']] },
    { label: '/θ/ и /s/', pairs: [['think', 'sink'], ['thick', 'sick']] },
    { label: '/ʃ/ и /tʃ/', pairs: [['ship', 'chip'], ['wash', 'watch']] },
    { label: '/ʊ/ и /uː/', pairs: [['full', 'fool'], ['pull', 'pool']] },
  ];
  const pronunciations = new Map(globalThis.OXFORD_CATALOG.words.map(({ word, ipa }) => [word, ipa]));
  // British transcriptions for words outside Oxford 3000 A1–A2.
  pronunciations.set('men', 'men'); // https://www.oxfordlearnersdictionaries.com/definition/english/men
  pronunciations.set('sink', 'sɪŋk'); // https://dictionary.cambridge.org/pronunciation/english/sink
  pronunciations.set('fool', 'fuːl'); // https://dictionary.cambridge.org/pronunciation/english/fool
  const { shuffle } = globalThis.READING_RULES;

  const select = document.getElementById('sound-pair-contrast');
  const settings = document.getElementById('sound-pair-settings');
  const quiz = document.getElementById('sound-pair-quiz');
  const panel = document.getElementById('sound-pairs');
  const title = document.getElementById('sound-pair-title');
  const questions = document.getElementById('sound-pair-questions');
  const result = document.getElementById('sound-pair-result');
  const storageKey = `english-reading-pairs:${location.pathname}`;
  let activeContrast;
  let rows = [];

  contrasts.forEach(({ label }, index) => select.add(new Option(label, String(index))));
  select.add(new Option('Все пары', 'all'));

  function promptsFor(contrast) {
    const pairs = contrasts[contrast]?.pairs ?? contrasts.flatMap(group => group.pairs);
    return pairs.flatMap(pair => pair.map(answer => ({ answer, pair })));
  }

  function renderQuestion(id, { answer, pair }, index, saved) {
    const row = document.createElement('fieldset');
    row.className = 'pair-question';
    const legend = document.createElement('legend');
    legend.textContent = `/${pronunciations.get(answer)}/`;
    const choices = document.createElement('div');
    choices.className = 'pair-choices';
    const options = saved ? [...pair] : shuffle([...pair]);
    if (saved?.reversed) options.reverse();
    const inputs = options.map(word => {
      const choice = document.createElement('label');
      choice.className = 'pair-choice';
      const input = document.createElement('input');
      input.type = 'radio';
      input.name = `sound-pair-answer-${index}`;
      input.value = word;
      input.checked = saved?.response === word;
      const text = document.createElement('span');
      text.lang = 'en';
      text.textContent = word;
      choice.append(input, text);
      choices.append(choice);
      return input;
    });
    const feedback = document.createElement('p');
    feedback.className = 'pair-feedback';
    feedback.id = `sound-pair-feedback-${index}`;
    feedback.hidden = true;
    row.append(legend, choices, feedback);
    return { id, row, inputs, answer, feedback, reversed: options[0] !== pair[0] };
  }

  function showQuiz(contrast, prompts, order, savedRows = []) {
    activeContrast = contrast;
    rows = order.map((id, index) => renderQuestion(id, prompts[id], index, savedRows[index]));
    questions.replaceChildren(...rows.map(({ row }) => row));
    title.textContent = contrasts[contrast]?.label ?? 'Все пары';
    result.textContent = '';
    quiz.hidden = false;
  }

  function save() {
    const attempt = rows.length ? {
      contrast: activeContrast,
      checked: Boolean(result.textContent),
      rows: rows.map(({ id, inputs, reversed }) => ({
        id, reversed, response: inputs.find(input => input.checked)?.value,
      })),
    } : null;
    try {
      sessionStorage.setItem(storageKey, JSON.stringify({ selection: select.value, open: panel.open, attempt }));
    } catch { /* The quiz still works without storage. */ }
  }

  function validContrast(value) {
    return [...select.options].some(option => option.value === value);
  }

  function restore() {
    let saved;
    try { saved = JSON.parse(sessionStorage.getItem(storageKey)); }
    catch { return; }
    if (validContrast(saved?.selection)) select.value = saved.selection;
    if (saved?.open === true) panel.open = true;

    const attempt = saved?.attempt;
    if (!validContrast(attempt?.contrast) || !Array.isArray(attempt.rows)) return;
    const prompts = promptsFor(attempt.contrast);
    if (attempt.rows.length !== prompts.length || !attempt.rows.every(entry =>
      entry && Number.isInteger(entry.id) && entry.id >= 0 && entry.id < prompts.length)) return;
    const order = attempt.rows.map(entry => entry.id);
    if (new Set(order).size !== prompts.length) return;
    showQuiz(attempt.contrast, prompts, order, attempt.rows);
    if (attempt.checked === true) grade();
  }

  settings.addEventListener('submit', event => {
    event.preventDefault();
    const prompts = promptsFor(select.value);
    showQuiz(select.value, prompts, shuffle(prompts.map((_, id) => id)));
    title.focus();
    save();
  });

  function grade() {
    let correct = 0;
    let unanswered = 0;
    for (const { row, inputs, answer, feedback } of rows) {
      const selected = inputs.find(input => input.checked);
      const matched = selected?.value === answer;
      correct += Number(matched);
      unanswered += Number(!selected);
      row.dataset.result = !selected ? 'empty' : matched ? 'correct' : 'incorrect';
      if (!selected || matched) {
        feedback.textContent = selected ? 'Верно' : 'Без ответа';
      } else {
        const word = document.createElement('strong');
        word.lang = 'en';
        word.textContent = answer;
        feedback.replaceChildren('Правильный ответ — ', word);
      }
      feedback.hidden = false;
      row.setAttribute('aria-describedby', feedback.id);
    }
    const missing = unanswered ? ` Без ответа — ${unanswered}.` : '';
    result.textContent = `Верно ${correct} из ${rows.length}.${missing}`;
  }

  quiz.addEventListener('submit', event => {
    event.preventDefault();
    grade();
    save();
  });

  quiz.addEventListener('change', () => {
    if (result.textContent) {
      result.textContent = '';
      for (const { row, feedback } of rows) {
        delete row.dataset.result;
        feedback.hidden = true;
        row.removeAttribute('aria-describedby');
      }
    }
    save();
  });
  restore();
  panel.addEventListener('toggle', save);
  select.addEventListener('change', save);
})();
