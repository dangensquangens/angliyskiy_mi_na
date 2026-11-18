import { answerSlotCount, countAnswered, gradeAnswer, isAnswerComplete, summarizeAnswers } from './grammar-check.js?v=2';
import { countOptions, modeLabels, pageSize, practiceUrl, readGrammarCatalog, readGrammarTopic, selectExercises } from './grammar-data.js';
import { createGrammarStore, newAttemptId } from './grammar-storage.js';

const $ = id => document.getElementById(id);
const settings = $('trainer-settings');
const session = $('trainer-session');
const status = $('trainer-status');
const startButton = $('trainer-start');
const mode = $('trainer-mode');
const count = $('trainer-count');
const topicPicker = $('trainer-topics');
const pageNumber = $('page-number');
const questionList = $('trainer-questions');
const loadedTopics = new Map();
const topicInfo = new Map();
const store = createGrammarStore({ onUnavailable: () => { $('storage-status').hidden = false; } });
const number = new Intl.NumberFormat('ru');
const date = new Intl.DateTimeFormat('ru', { dateStyle: 'short', timeStyle: 'short' });
const modeNotes = {
  practice: 'Проверяйте ответы на каждой странице. В конце можно повторить задания, в которых ошиблись.',
  test: 'Это контрольная для самопроверки. Тренажёр покажет решения, когда вы её завершите.',
  solutions: 'Решения будут рядом с заданиями.',
};
const gradeLabels = { correct: 'Верно', incorrect: 'Ошибка', empty: 'Без ответа', review: 'Нужно сверить' };

let attempt;
let exercises = [];
let visibleRows = [];
let loading = false;
let completedAnswers = 0;
let saveTimer;

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function showStatus(message) {
  status.textContent = message;
  status.hidden = !message;
}

function selectedTopics() {
  return [...topicPicker.querySelectorAll('input:checked')].map(input => input.value);
}

function updateSettings() {
  const selected = selectedTopics();
  const topicSelection = $('topic-selection');
  topicSelection.textContent = selected.length === 1 ? topicInfo.get(selected[0]).title : `Выбрано ${selected.length}`;
  topicSelection.lang = selected.length === 1 ? 'en' : 'ru';
  const available = selected.reduce((sum, topic) => sum + topicInfo.get(topic).count, 0);
  const amount = count.value === 'all' ? available : Math.min(available, Number(count.value));
  $('mode-note').textContent = modeNotes[mode.value];
  $('selection-note').textContent = amount ? `Заданий в варианте — ${number.format(amount)}.` : 'Выберите хотя бы одно время.';
  startButton.disabled = !amount || loading;
  startButton.textContent = loading ? 'Загружаем задания…' : mode.value === 'solutions' ? 'Показать решения' : 'Начать';
}

function setSelection(topics) {
  const chosen = new Set(topics);
  for (const input of topicPicker.querySelectorAll('input')) input.checked = chosen.has(input.value);
}

function renderPicker(categories) {
  for (const category of categories) {
    const available = category.topics.filter(topic => topic.count > 0);
    if (!available.length) continue;
    const group = element('fieldset', 'trainer-topic-group');
    const legend = element('legend', null, category.title);
    legend.lang = 'en';
    group.append(legend);
    for (const topic of available) {
      topicInfo.set(topic.id, topic);
      const label = element('label');
      const input = element('input');
      input.type = 'checkbox';
      input.value = topic.id;
      const title = element('span', null, topic.title);
      title.lang = 'en';
      label.append(input, title);
      group.append(label);
    }
    topicPicker.append(group);
  }
}

function topicTitles(topics) {
  return topics.map(id => topicInfo.get(id)?.title ?? id).join(', ');
}

function renderHistory() {
  const records = store.list();
  for (const [panelId, listId, completed] of [
    ['trainer-drafts', 'draft-list', false],
    ['trainer-results', 'result-list', true],
  ]) {
    const matching = records.filter(entry => Boolean(entry.result) === completed && entry.topics.every(id => topicInfo.has(id)));
    $(panelId).hidden = !matching.length;
    $(listId).replaceChildren(...matching.map(entry => {
      const item = element('li');
      const score = entry.result ? ` · ${entry.result.correct} из ${entry.result.total}` : ` · ${entry.questions.length} заданий`;
      const link = element('a', null, `${modeLabels[entry.mode]} · ${topicTitles(entry.topics)}${score} · ${date.format(entry.result?.completedAt ?? entry.updatedAt)}`);
      link.href = practiceUrl({ attempt: entry.id });
      link.dataset.attempt = entry.id;
      item.append(link);
      return item;
    }));
  }
  $('trainer-history').hidden = $('trainer-drafts').hidden && $('trainer-results').hidden;
}

function save() {
  clearTimeout(saveTimer);
  saveTimer = undefined;
  attempt.updatedAt = Date.now();
  store.write(attempt);
}

function queueSave() {
  if (saveTimer === undefined) saveTimer = setTimeout(save, 200);
}

function flushPendingSave() {
  if (saveTimer !== undefined) save();
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) flushPendingSave();
});
window.addEventListener('pagehide', flushPendingSave);

async function loadTopics(topics) {
  if (!topics.length || topics.some(topic => !topicInfo.has(topic))) throw new Error('Unknown grammar topic');
  return Promise.all(topics.map(async topic => {
    if (!loadedTopics.has(topic)) loadedTopics.set(topic, await readGrammarTopic(topic));
    return loadedTopics.get(topic);
  }));
}

function showSettings({ focus = false } = {}) {
  if (attempt) {
    flushPendingSave();
    setSelection(attempt.topics);
    count.value = String(attempt.count);
    mode.value = attempt.mode;
    history.replaceState(history.state, '', practiceUrl({ topics: attempt.topics }));
  }
  session.hidden = true;
  settings.hidden = false;
  attempt = undefined;
  renderHistory();
  updateSettings();
  if (focus) $('settings-title').focus();
}

function activate(next, selected, { persist = true } = {}) {
  flushPendingSave();
  attempt = next;
  exercises = selected;
  completedAnswers = countAnswered(exercises, attempt.responses);
  if (persist) save();
  history.replaceState(history.state, '', practiceUrl({ topics: next.topics, attempt: next.id }));
  settings.hidden = true;
  $('trainer-history').hidden = true;
  session.hidden = false;
  showStatus('');
  renderPage();
  $('session-title').focus();
}

function newAttempt(config, selected, { id = newAttemptId(), startedAt = Date.now() } = {}) {
  return {
    version: 1, id, startedAt, updatedAt: startedAt,
    topics: config.topics, mode: config.mode, count: config.count,
    questions: selected.map(exercise => exercise.id), responses: {},
    page: 0, checkedPages: [], result: null,
  };
}

async function restore(id) {
  const saved = store.read(id);
  if (!saved) {
    showStatus('В этом браузере нет такой попытки.');
    return;
  }
  loading = true;
  updateSettings();
  showStatus('Открываем сохранённую попытку…');
  try {
    const byId = new Map((await loadTopics(saved.topics)).flat().map(exercise => [exercise.id, exercise]));
    const ordered = saved.questions.map(id => byId.get(id));
    if (ordered.some(exercise => !exercise)) {
      showStatus('Некоторые задания из этой попытки больше недоступны. Можно начать новую тренировку.');
      return;
    }
    activate(saved, ordered, { persist: false });
  } catch {
    showStatus('Не удалось загрузить задания. Откройте попытку ещё раз.');
  } finally {
    loading = false;
    updateSettings();
  }
}

function answerValues(values) {
  if (values.length === 1) {
    const text = element('p', 'trainer-answer-values', values[0] || '—');
    text.lang = 'en';
    return text;
  }
  const ordered = element('ol', 'trainer-answer-values');
  for (const value of values) {
    const slot = element('li', null, value || '—');
    slot.lang = 'en';
    ordered.append(slot);
  }
  return ordered;
}

function acceptedAnswers(exercise, container) {
  for (const values of exercise.answers) container.append(answerValues(values));
}

function makeQuestion(exercise, index) {
  const row = element('article', 'trainer-question');
  row.dataset.exercise = exercise.id;
  const prompt = element('p', 'trainer-prompt', exercise.prompt);
  prompt.id = `trainer-prompt-${index}`;
  if (!/[А-Яа-яЁё]/.test(exercise.prompt)) prompt.lang = 'en';
  const answer = element('div', 'trainer-answer');
  const feedback = element('div', 'trainer-feedback');
  feedback.id = `trainer-feedback-${index}`;
  feedback.hidden = true;
  const slots = answerSlotCount(exercise);
  const values = Array.from({ length: slots }, (_, slot) => attempt.responses[exercise.id]?.[slot] ?? '');
  const inputs = [];
  if (attempt.mode === 'solutions') {
    answer.append(element('p', 'trainer-answer-values trainer-answer-title', 'Решение'));
    acceptedAnswers(exercise, answer);
    if (exercise.answerMode === 'gaps' && exercise.sourceAnswer) {
      const sentence = element('p', 'trainer-full-sentence', exercise.sourceAnswer);
      sentence.lang = 'en';
      answer.append(sentence);
    }
  } else if (attempt.result) {
    answer.append(element('p', 'trainer-answer-values trainer-answer-title', 'Ваш ответ'), answerValues(values));
  } else {
    for (let slot = 0; slot < slots; slot++) {
      const field = element('div', 'trainer-field');
      const text = exercise.answerMode === 'sentence' ? 'Предложение целиком' : slots === 1 ? 'Пропуск' : `Пропуск ${slot + 1}`;
      const label = element('label', null, text);
      const input = element('input');
      input.id = `trainer-answer-${index}-${slot}`;
      input.type = 'text';
      input.lang = 'en';
      input.autocomplete = 'off';
      input.spellcheck = false;
      input.value = values[slot];
      input.setAttribute('aria-describedby', `${prompt.id} ${feedback.id}`);
      label.htmlFor = input.id;
      field.append(label, input);
      inputs.push(input);
      answer.append(field);
      input.addEventListener('input', () => changeAnswer(exercise, inputs));
    }
  }
  answer.append(feedback);
  row.append(prompt, answer);
  return { row, exercise, inputs, feedback };
}

function changeAnswer(exercise, inputs) {
  const values = inputs.map(input => input.value);
  const previous = attempt.responses[exercise.id];
  completedAnswers += Number(isAnswerComplete(exercise, values)) - Number(isAnswerComplete(exercise, previous));
  if (values.some(value => value.trim())) attempt.responses[exercise.id] = values;
  else delete attempt.responses[exercise.id];
  if (attempt.checkedPages.includes(attempt.page)) {
    attempt.checkedPages = attempt.checkedPages.filter(page => page !== attempt.page);
    renderFeedback();
  }
  queueSave();
  renderProgress();
}

function renderFeedback() {
  const show = Boolean(attempt.result) || (attempt.mode === 'practice' && attempt.checkedPages.includes(attempt.page));
  let correct = 0;
  let review = 0;
  for (const { exercise, inputs, feedback } of visibleRows) {
    feedback.replaceChildren();
    feedback.hidden = !show;
    if (!show) {
      for (const input of inputs) input.removeAttribute('aria-invalid');
      continue;
    }
    const grade = gradeAnswer(exercise, attempt.responses[exercise.id]);
    correct += Number(grade === 'correct');
    review += Number(grade === 'review');
    feedback.dataset.grade = grade;
    feedback.append(element('p', 'trainer-feedback-status', gradeLabels[grade]));
    if (grade !== 'correct') {
      feedback.append(element('p', null, grade === 'review' ? 'Ответ из материалов' : 'Правильный ответ'));
      acceptedAnswers(exercise, feedback);
    }
    for (const input of inputs) {
      if (grade === 'incorrect') input.setAttribute('aria-invalid', 'true');
      else input.removeAttribute('aria-invalid');
    }
  }
  $('page-feedback').textContent = show && !attempt.result
    ? `На странице верно ${correct} из ${visibleRows.length}.${review ? ` На сверку — ${review}.` : ''}` : '';
}

function renderProgress() {
  const total = exercises.length;
  const pageText = `Страница ${attempt.page + 1} из ${Math.ceil(total / pageSize)}.`;
  const answered = attempt.mode === 'solutions' ? '' : ` Заполнено ${number.format(completedAnswers)} из ${number.format(total)}.`;
  const progress = $('session-progress');
  const message = pageText + answered;
  if (progress.textContent !== message) progress.textContent = message;
}

function renderResult() {
  const result = attempt.result;
  $('session-result').hidden = !result;
  if (!result) return;
  const percent = value => Math.round(value * 100 / result.total);
  $('result-summary').textContent = `Верно ${result.correct} из ${result.total} (${percent(result.correct)}%). `
    + `Заполнено ${result.answered} из ${result.total} (${percent(result.answered)}%).`
    + (result.review ? ` На сверку — ${result.review}.` : '');
  $('repeat-mistakes').hidden = !result.mistakes.length;
}

function renderPage() {
  const start = attempt.page * pageSize;
  const pages = Math.ceil(exercises.length / pageSize);
  visibleRows = exercises.slice(start, start + pageSize).map((exercise, index) => makeQuestion(exercise, start + index));
  questionList.replaceChildren(...visibleRows.map(entry => entry.row));
  $('session-title').textContent = modeLabels[attempt.mode];
  $('session-topics').textContent = topicTitles(attempt.topics);
  $('session-mode-note').hidden = attempt.mode !== 'test' || Boolean(attempt.result);
  $('session-mode-note').textContent = modeNotes.test;
  $('check-page').hidden = attempt.mode !== 'practice' || Boolean(attempt.result);
  $('finish-session').hidden = attempt.mode === 'solutions' || Boolean(attempt.result);
  $('finish-session').textContent = attempt.mode === 'test' ? 'Завершить контрольную' : 'Завершить тренировку';
  $('trainer-pagination').hidden = pages <= 1;
  $('previous-page').disabled = attempt.page === 0;
  $('next-page').disabled = attempt.page + 1 === pages;
  pageNumber.max = pages;
  pageNumber.value = attempt.page + 1;
  $('page-total').textContent = `из ${pages}`;
  renderFeedback();
  renderProgress();
  renderResult();
}

function movePage(page) {
  if (page < 0 || page >= Math.ceil(exercises.length / pageSize) || page === attempt.page) return;
  attempt.page = page;
  save();
  renderPage();
  $('session-title').focus();
}

$('trainer-form').addEventListener('change', updateSettings);
$('trainer-form').addEventListener('submit', async event => {
  event.preventDefault();
  const topics = selectedTopics();
  if (!topics.length || loading) return;
  const requested = count.value === 'all' ? 'all' : Number(count.value);
  const config = { topics, mode: mode.value, count: requested };
  if (!countOptions.includes(requested) || !Object.hasOwn(modeLabels, config.mode)) return;
  loading = true;
  updateSettings();
  showStatus('');
  try {
    const groups = await loadTopics(topics);
    const selected = selectExercises(groups, requested);
    if (!selected.length) throw new Error('No exercises');
    activate(newAttempt(config, selected), selected);
  } catch {
    showStatus('Не удалось открыть задания. Попробуйте ещё раз.');
    status.focus();
  } finally {
    loading = false;
    updateSettings();
  }
});

$('trainer-history').addEventListener('click', event => {
  const link = event.target.closest('a[data-attempt]');
  if (!link || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  if (!loading) restore(link.dataset.attempt);
});
$('trainer-settings-button').addEventListener('click', () => showSettings({ focus: true }));
$('check-page').addEventListener('click', () => {
  if (!attempt.checkedPages.includes(attempt.page)) attempt.checkedPages.push(attempt.page);
  save();
  renderFeedback();
});
$('finish-session').addEventListener('click', () => {
  attempt.result = { ...summarizeAnswers(exercises, attempt.responses), completedAt: Date.now() };
  attempt.page = 0;
  save();
  renderPage();
  $('result-title').focus();
});
$('repeat-mistakes').addEventListener('click', () => {
  const mistakes = new Set(attempt.result.mistakes);
  const selected = selectExercises([exercises.filter(exercise => mistakes.has(exercise.id))], 'all');
  const topics = [...new Set(selected.map(exercise => exercise.topic))];
  activate(newAttempt({ topics, mode: 'practice', count: 'all' }, selected), selected);
});
$('restart-session').addEventListener('click', () => {
  const identity = attempt.result ? undefined : { id: attempt.id, startedAt: attempt.startedAt };
  activate(newAttempt(attempt, exercises, identity), exercises);
});
$('previous-page').addEventListener('click', () => movePage(attempt.page - 1));
$('next-page').addEventListener('click', () => movePage(attempt.page + 1));
$('page-form').addEventListener('submit', event => {
  event.preventDefault();
  if (Number.isInteger(pageNumber.valueAsNumber)) movePage(pageNumber.valueAsNumber - 1);
});

async function initialize() {
  showStatus('Загружаем список времён…');
  try {
    renderPicker(await readGrammarCatalog());
    $('trainer-topic-details').open = matchMedia('(min-width: 621px)').matches;
    const params = new URLSearchParams(location.search);
    const requested = (params.get('topics') ?? '').split(',').filter(topic => topicInfo.has(topic));
    setSelection(requested.length ? requested : [...topicInfo.keys()].slice(0, 1));
    showSettings();
    showStatus('');
    if (params.has('attempt')) await restore(params.get('attempt'));
  } catch {
    showStatus('Не удалось загрузить список времён. Обновите страницу.');
  }
}

initialize();
