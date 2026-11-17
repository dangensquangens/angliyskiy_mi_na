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
  const title = document.getElementById('sound-pair-title');
  const questions = document.getElementById('sound-pair-questions');
  const result = document.getElementById('sound-pair-result');
  let rows = [];

  contrasts.forEach(({ label }, index) => select.add(new Option(label, String(index))));
  select.add(new Option('Все пары', 'all'));

  function renderQuestion({ answer, pair }, index) {
    const row = document.createElement('fieldset');
    row.className = 'pair-question';
    const legend = document.createElement('legend');
    legend.textContent = `/${pronunciations.get(answer)}/`;
    const choices = document.createElement('div');
    choices.className = 'pair-choices';
    const inputs = shuffle([...pair]).map(word => {
      const choice = document.createElement('label');
      choice.className = 'pair-choice';
      const input = document.createElement('input');
      input.type = 'radio';
      input.name = `sound-pair-answer-${index}`;
      input.value = word;
      const text = document.createElement('span');
      text.lang = 'en';
      text.textContent = word;
      choice.append(input, text);
      choices.append(choice);
      return input;
    });
    const feedback = document.createElement('p');
    feedback.className = 'pair-feedback';
    feedback.hidden = true;
    row.append(legend, choices, feedback);
    return { row, inputs, answer, feedback };
  }

  settings.addEventListener('submit', event => {
    event.preventDefault();
    const contrast = contrasts[select.value];
    const pairs = contrast?.pairs ?? contrasts.flatMap(group => group.pairs);
    const prompts = pairs.flatMap(pair => pair.map(answer => ({ answer, pair })));
    rows = shuffle(prompts).map(renderQuestion);
    questions.replaceChildren(...rows.map(({ row }) => row));
    title.textContent = contrast?.label ?? 'Все пары';
    result.textContent = '';
    quiz.hidden = false;
    title.focus();
  });

  quiz.addEventListener('submit', event => {
    event.preventDefault();
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
    }
    const missing = unanswered ? ` Без ответа — ${unanswered}.` : '';
    result.textContent = `Верно ${correct} из ${rows.length}.${missing}`;
  });

  quiz.addEventListener('change', () => {
    if (!result.textContent) return;
    result.textContent = '';
    for (const { row, feedback } of rows) {
      delete row.dataset.result;
      feedback.hidden = true;
    }
  });
})();
