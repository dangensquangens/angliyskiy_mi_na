(() => {
  'use strict';

  const $ = id => document.getElementById(id);
  const adminMode = new URLSearchParams(location.search).get('admin') === '1';
  const apiBase = typeof window.HOMEWORK_API_BASE === 'string' ? window.HOMEWORK_API_BASE.replace(/\/+$/, '') : '';
  const tokenKey = 'english-homework-admin-token';
  const draftPrefix = 'english-homework-draft:';
  const symbols = ['ə', 'ʊ', 'ɪ', 'æ', 'ɒ', 'ʌ', 'ɑ', 'ɔ', 'ɜ', 'ʃ', 'ʒ', 'θ', 'ð', 'ŋ', 'ɡ', 'tʃ', 'dʒ', 'ː', 'ˈ', 'ˌ'];
  const gradeLabels = { correct: 'Верно', incorrect: 'Есть ошибка', empty: 'Нет ответа' };
  const levels = { all: 'A1 и A2', A1: 'A1', A2: 'A2' };
  const exerciseNames = ['Слово → транскрипция', 'Транскрипция → слово'];
  let token = readStorage(sessionStorage, tokenKey) || '';
  let currentAssignment = null;
  let answers = [[], []];
  let activeInput = null;
  let studentLoading = false;
  let submitting = false;
  let assignmentSnapshot = '';

  function readStorage(storage, key) {
    try { return storage.getItem(key); } catch { return null; }
  }

  function writeStorage(storage, key, value) {
    try { storage.setItem(key, value); return true; } catch { return false; }
  }

  function removeStorage(storage, key) {
    try { storage.removeItem(key); } catch { /* Storage is optional. */ }
  }

  function element(tag, className, value) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (value !== undefined) node.textContent = String(value);
    return node;
  }

  function status(id, message, kind = 'error') {
    const target = $(id);
    target.textContent = message;
    target.dataset.kind = kind;
  }

  async function request(path, { method = 'GET', body, authenticated = false } = {}) {
    if (!apiBase) throw new Error('Сервис заданий ещё не подключён. Обратитесь к преподавателю.');
    const headers = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (authenticated) headers.Authorization = `Bearer ${token}`;
    let response;
    try {
      response = await fetch(`${apiBase}${path}`, {
        method, headers, body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(20000),
      });
    } catch {
      throw new Error('Не удалось связаться с сервисом. Проверьте подключение и попробуйте ещё раз.');
    }
    let data;
    try { data = await response.json(); } catch { throw new Error('Сервис вернул непонятный ответ. Попробуйте ещё раз.'); }
    if (!response.ok) {
      const error = new Error(typeof data.error === 'string' ? data.error : 'Не удалось выполнить запрос. Попробуйте ещё раз.');
      error.status = response.status;
      throw error;
    }
    return data;
  }

  function getDraft(code, items) {
    let stored;
    try { stored = JSON.parse(readStorage(localStorage, draftPrefix + code) || 'null'); } catch { stored = null; }
    return items.map((group, mode) => group.map((_, index) =>
      Array.isArray(stored?.[mode]) && typeof stored[mode][index] === 'string' ? stored[mode][index] : ''));
  }

  function persistDraft() {
    if (!currentAssignment || currentAssignment.submittedAt) return;
    if (!writeStorage(localStorage, draftPrefix + currentAssignment.code, JSON.stringify(answers))) {
      $('submit-note').textContent = 'Автоматически сохранить черновик на этом устройстве не удалось.';
    }
  }

  function validAssignment(assignment) {
    return assignment && typeof assignment.code === 'string' && Array.isArray(assignment.items)
      && assignment.items.length === 2 && assignment.items.every(group => Array.isArray(group));
  }

  function updateStudentUrl(code) {
    const url = new URL(location.href);
    url.search = '';
    url.searchParams.set('code', code);
    history.replaceState(null, '', url);
  }

  function drawStudent(assignment) {
    if (!validAssignment(assignment)) throw new Error('Задание получено не полностью. Попробуйте открыть его ещё раз.');
    currentAssignment = assignment;
    const submitted = Boolean(assignment.submittedAt);
    answers = submitted && Array.isArray(assignment.answers)
      ? assignment.items.map((group, mode) => group.map((_, index) => String(assignment.answers?.[mode]?.[index] ?? '')))
      : getDraft(assignment.code, assignment.items);
    if (submitted) removeStorage(localStorage, draftPrefix + assignment.code);
    $('code-panel').hidden = true;
    $('student-work').hidden = false;
    $('work-code').textContent = assignment.code;
    $('work-meta').textContent = `${levels[assignment.level] || assignment.level || ''} · ${assignment.count || assignment.items[0].length} слов на упражнение`;
    $('work-state').textContent = submitted ? 'Сдано' : 'В процессе';
    $('work-state').classList.toggle('done', submitted);
    $('result-summary').hidden = !submitted;
    $('result-summary').textContent = submitted ? `Результат: ${assignment.score ?? '—'} из ${assignment.total ?? '—'}` : '';
    $('submit-work').hidden = submitted;
    $('ipa-keyboard').hidden = submitted;
    $('submit-note').textContent = submitted ? 'Ответы отправлены преподавателю.' : 'Ответы обоих упражнений отправятся одновременно.';
    activeInput = null;

    assignment.items.forEach((group, mode) => {
      const list = $(`rows-${mode}`);
      list.replaceChildren();
      group.forEach((item, index) => {
        const row = element('li', 'answer-row');
        const label = element('label', 'prompt');
        const id = `answer-${mode}-${index}`;
        label.htmlFor = id;
        const value = element('span', '', item.prompt || '');
        value.lang = 'en';
        label.append(value);
        if (item.hint) label.append(element('span', 'hint', item.hint));
        const input = element('input');
        input.id = id;
        input.type = 'text';
        input.autocomplete = 'off';
        input.spellcheck = false;
        input.placeholder = mode === 0 ? 'Транскрипция' : 'Слово';
        input.value = answers[mode][index];
        input.disabled = submitted;
        input.addEventListener('focus', () => {
          if (mode === 0) {
            activeInput = input;
            $('ipa-target').textContent = `Символы вставляются в строку ${index + 1}`;
          }
        });
        input.addEventListener('input', () => {
          answers[mode][index] = input.value;
          persistDraft();
        });
        const cell = element('div', 'answer-cell');
        cell.append(input);
        const grade = assignment.grades?.[mode]?.[index];
        if (submitted && gradeLabels[grade]) {
          row.dataset.grade = grade;
          cell.append(element('p', `grade ${grade}`, gradeLabels[grade]));
        }
        row.append(element('span', 'row-index', String(index + 1).padStart(2, '0')), label, cell);
        list.append(row);
      });
    });
  }

  async function openAssignment(code) {
    if (studentLoading) return;
    const cleaned = code.trim();
    if (!cleaned) {
      $('code-panel').hidden = false;
      $('student-work').hidden = true;
      return;
    }
    studentLoading = true;
    $('code-form').querySelector('button').disabled = true;
    status('student-status', 'Загружаем задание…', 'success');
    try {
      const data = await request(`/api/assignments/${encodeURIComponent(cleaned)}`);
      drawStudent(data.assignment);
      updateStudentUrl(data.assignment.code);
      status('student-status', '');
    } catch (error) {
      $('code-panel').hidden = false;
      $('student-work').hidden = true;
      $('code-input').value = cleaned;
      status('student-status', error.message);
    } finally {
      studentLoading = false;
      $('code-form').querySelector('button').disabled = false;
    }
  }

  async function submitWork() {
    if (!currentAssignment || currentAssignment.submittedAt || submitting) return;
    submitting = true;
    $('submit-work').disabled = true;
    status('student-status', 'Отправляем ответы…', 'success');
    const code = currentAssignment.code;
    try {
      const data = await request(`/api/assignments/${encodeURIComponent(code)}/submit`, { method: 'POST', body: { answers } });
      if (!data.assignment?.submittedAt) throw new Error('Сервис не подтвердил отправку. Попробуйте ещё раз.');
      drawStudent(data.assignment);
      status('student-status', '');
      $('result-summary').focus();
    } catch (error) {
      // A lost response can follow a successful submission. Check before allowing another attempt.
      try {
        const data = await request(`/api/assignments/${encodeURIComponent(code)}`);
        if (data.assignment?.submittedAt) {
          drawStudent(data.assignment);
          status('student-status', 'Ответы успешно отправлены.', 'success');
          return;
        }
      } catch { /* Keep the original error and the local draft. */ }
      status('student-status', error.message);
    } finally {
      submitting = false;
      $('submit-work').disabled = false;
    }
  }

  function prepareKeyboard() {
    for (const symbol of symbols) {
      const key = element('button', 'ipa-key', symbol);
      key.type = 'button';
      key.setAttribute('aria-label', `Вставить ${symbol}`);
      key.addEventListener('pointerdown', event => event.preventDefault());
      key.addEventListener('click', () => {
        const input = activeInput || $('rows-0').querySelector('input:not(:disabled)');
        if (!input || input.disabled) return;
        input.focus();
        const start = input.selectionStart ?? input.value.length;
        const end = input.selectionEnd ?? start;
        input.setRangeText(symbol, start, end, 'end');
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
      $('ipa-keys').append(key);
    }
  }

  function showAdmin(loggedIn) {
    $('login-panel').hidden = loggedIn;
    $('admin-work').hidden = !loggedIn;
  }

  function logout(message = '') {
    token = '';
    assignmentSnapshot = '';
    removeStorage(sessionStorage, tokenKey);
    $('password').value = '';
    $('assignment-list').replaceChildren();
    showAdmin(false);
    status('admin-status', message);
  }

  function adminError(error) {
    if (error.status === 401) logout('Сессия завершилась. Войдите ещё раз.');
    else status('admin-status', error.message);
  }

  function formatDate(value) {
    if (!value) return '';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('ru-RU', { dateStyle: 'medium', timeStyle: 'short' });
  }

  async function copyLink(code) {
    const url = new URL('homework.html', location.href);
    url.searchParams.set('code', code);
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(url.href);
      status('admin-status', 'Ссылка на задание скопирована.', 'success');
    } catch {
      $('copy-value').value = url.href;
      $('copy-dialog').showModal();
      $('copy-value').focus();
      $('copy-value').select();
    }
  }

  function drawReview(container, assignment) {
    container.replaceChildren();
    if (!Array.isArray(assignment.items)) {
      container.textContent = 'Не удалось загрузить задания.';
      return;
    }
    assignment.items.forEach((group, mode) => {
      if (!Array.isArray(group)) return;
      container.append(element('h3', '', exerciseNames[mode] || 'Упражнение'));
      if (assignment.submittedAt) {
        const correct = assignment.grades?.[mode]?.filter(grade => grade === 'correct').length ?? 0;
        container.append(element('p', 'muted', `Верно ${correct} из ${group.length}`));
      }
      const list = element('ol', 'review-list');
      group.forEach((item, index) => {
        const answer = assignment.answers?.[mode]?.[index];
        const grade = assignment.grades?.[mode]?.[index];
        const row = element('li');
        const prompt = `${item.prompt || ''}${item.hint ? ` (${item.hint})` : ''}`;
        row.append(element('span', '', assignment.submittedAt ? `${prompt} — ${answer || 'нет ответа'}` : prompt));
        if (gradeLabels[grade]) row.append(element('span', `review-grade ${grade}`, gradeLabels[grade]));
        list.append(row);
      });
      container.append(list);
    });
  }

  function drawAssignments(assignments) {
    const list = $('assignment-list');
    list.replaceChildren();
    if (!assignments.length) {
      list.append(element('p', 'empty', 'Заданий пока нет. Создайте первое задание выше.'));
      return;
    }
    for (const assignment of assignments) {
      const card = element('article', 'assignment');
      const top = element('div', 'assignment-top');
      const description = element('div');
      description.append(element('p', 'assignment-code', `Код ${assignment.code}`));
      const created = formatDate(assignment.createdAt);
      description.append(element('p', 'muted', `${levels[assignment.level] || assignment.level || ''} · ${assignment.count} слов на упражнение${created ? ` · ${created}` : ''}`));
      const submitted = Boolean(assignment.submittedAt);
      if (submitted) description.append(element('p', 'muted', `Сдано ${formatDate(assignment.submittedAt)}`));
      const badgeText = submitted ? `Сдано · ${assignment.score ?? '—'} из ${assignment.total ?? '—'}` : 'Ожидает ответа';
      top.append(description, element('span', `assignment-badge${submitted ? ' done' : ''}`, badgeText));
      card.append(top);
      const actions = element('div', 'assignment-actions');
      const copy = element('button', 'button secondary', 'Скопировать ссылку');
      copy.type = 'button';
      copy.addEventListener('click', () => copyLink(assignment.code));
      actions.append(copy);
      card.append(actions);
      {
        const details = element('details');
        details.append(element('summary', '', submitted ? 'Ответы ученика' : 'Посмотреть задание'));
        const content = element('div', 'assignment-details');
        details.append(content);
        details.addEventListener('toggle', async () => {
          if (!details.open || content.dataset.loaded === 'true') return;
          content.textContent = 'Загружаем ответы…';
          try {
            const complete = Array.isArray(assignment.items)
              ? assignment
              : (await request(`/api/assignments/${encodeURIComponent(assignment.code)}`)).assignment;
            drawReview(content, complete);
            content.dataset.loaded = 'true';
          } catch (error) { content.textContent = `${error.message} Закройте и откройте ответы ещё раз.`; }
        });
        card.append(details);
      }
      list.append(card);
    }
  }

  async function refreshAssignments({ quiet = false } = {}) {
    const button = $('refresh-list');
    if (quiet && button.disabled) return false;
    const currentToken = token;
    button.disabled = true;
    try {
      const data = await request('/api/admin/assignments', { authenticated: true });
      if (currentToken !== token) return false;
      if (!Array.isArray(data.assignments)) throw new Error('Не удалось получить список заданий.');
      const snapshot = JSON.stringify(data.assignments);
      if (snapshot !== assignmentSnapshot) {
        drawAssignments(data.assignments);
        assignmentSnapshot = snapshot;
      }
      if (!quiet) status('admin-status', '');
      return true;
    } catch (error) {
      if (currentToken === token && (!quiet || error.status === 401)) adminError(error);
      return false;
    }
    finally { button.disabled = false; }
  }

  $('code-form').addEventListener('submit', event => { event.preventDefault(); openAssignment($('code-input').value); });
  $('submit-work').addEventListener('click', submitWork);
  $('login-form').addEventListener('submit', async event => {
    event.preventDefault();
    const button = event.currentTarget.querySelector('button');
    button.disabled = true;
    status('admin-status', 'Выполняется вход…', 'success');
    try {
      const data = await request('/api/login', { method: 'POST', body: { password: $('password').value } });
      if (typeof data.token !== 'string' || !data.token) throw new Error('Сервис не подтвердил вход.');
      token = data.token;
      writeStorage(sessionStorage, tokenKey, token);
      $('password').value = '';
      showAdmin(true);
      await refreshAssignments();
    } catch (error) { status('admin-status', error.message); }
    finally { button.disabled = false; }
  });
  $('create-form').addEventListener('submit', async event => {
    event.preventDefault();
    const button = event.currentTarget.querySelector('button');
    button.disabled = true;
    status('admin-status', 'Создаём задание…', 'success');
    try {
      const count = Number($('count').value);
      const data = await request('/api/admin/assignments', { method: 'POST', authenticated: true, body: { count, level: $('level').value } });
      if (!data.assignment?.code) throw new Error('Сервис не подтвердил создание задания.');
      const refreshed = await refreshAssignments();
      if (refreshed) {
        status('admin-status', `Задание ${data.assignment.code} создано. Скопируйте ссылку ниже.`, 'success');
      } else if (token) {
        drawAssignments([data.assignment]);
        status('admin-status', 'Задание создано. Список целиком загрузить не удалось, но ссылку на новое задание можно скопировать ниже.');
      }
    } catch (error) { adminError(error); }
    finally { button.disabled = false; }
  });
  $('refresh-list').addEventListener('click', refreshAssignments);
  $('logout').addEventListener('click', () => {
    request('/api/admin/logout', { method: 'POST', authenticated: true }).catch(() => {});
    logout();
  });
  $('copy-close').addEventListener('click', () => $('copy-dialog').close());

  if (adminMode) {
    $('admin-view').hidden = false;
    $('admin-link').hidden = true;
    if (token) { showAdmin(true); refreshAssignments(); }
    const refreshIfVisible = () => {
      if (token && !document.hidden) refreshAssignments({ quiet: true });
    };
    setInterval(refreshIfVisible, 15000);
    document.addEventListener('visibilitychange', refreshIfVisible);
  } else {
    $('student-view').hidden = false;
    prepareKeyboard();
    openAssignment(new URLSearchParams(location.search).get('code') || '');
  }
})();
