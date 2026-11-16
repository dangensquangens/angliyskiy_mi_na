(() => {
  'use strict';

  const $ = id => document.getElementById(id);
  const adminMode = new URLSearchParams(location.search).get('admin') === '1';
  const apiBase = typeof window.HOMEWORK_API_BASE === 'string' ? window.HOMEWORK_API_BASE.replace(/\/+$/, '') : '';
  const functionRouting = apiBase.startsWith('https://functions.yandexcloud.net/');
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
  let adminAssignments = [];
  let latestRefresh = 0;
  let assignmentToDelete = '';
  let previewDraft = null;
  let studentToken = readStorage(sessionStorage, 'student-token') || '';
  let draftTimer, draftPromise = Promise.resolve(), draftDirty = false, draftBlocked = false;

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

  async function request(path, { method = 'GET', body, authenticated = false, student = false } = {}) {
    if (!apiBase) throw new Error('Сервис заданий ещё не подключён. Обратитесь к преподавателю.');
    const headers = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (authenticated) {
      if (functionRouting) headers['X-Homework-Session'] = token;
      else headers.Authorization = `Bearer ${token}`;
    }
    if (student) {
      if (functionRouting) headers['X-Homework-Session'] = studentToken;
      else headers.Authorization = `Bearer ${studentToken}`;
    }
    const url = functionRouting ? `${apiBase}?route=${encodeURIComponent(path)}` : `${apiBase}${path}`;
    let response;
    try {
      response = await fetch(url, {
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
    if (currentAssignment.id) {
      draftDirty = true;
      clearTimeout(draftTimer);
      draftTimer = setTimeout(() => saveStudentDraft().catch(() => {}), 700);
      return;
    }
    if (!writeStorage(localStorage, draftPrefix + currentAssignment.code, JSON.stringify(answers))) {
      $('submit-note').textContent = 'Автоматически сохранить черновик на этом устройстве не удалось.';
    }
  }

  function validAssignment(assignment) {
    return assignment && typeof assignment.code === 'string' && Array.isArray(assignment.items)
      && assignment.items.length === 2 && assignment.items.every(group => Array.isArray(group));
  }

  function formatCounts(assignment) {
    let counts = assignment.counts;
    if (!Array.isArray(counts) && Array.isArray(assignment.items)) {
      counts = assignment.items.map(group => Array.isArray(group) ? group.length : 0);
    }
    if (!Array.isArray(counts) && Number.isInteger(assignment.count)) counts = [assignment.count, assignment.count];
    if (!Array.isArray(counts) || counts.length !== 2) return '';
    return `Упражнение 1 — ${counts[0]}, упражнение 2 — ${counts[1]}`;
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
    answers = (submitted || assignment.id) && Array.isArray(assignment.answers)
      ? assignment.items.map((group, mode) => group.map((_, index) => String(assignment.answers?.[mode]?.[index] ?? '')))
      : assignment.id ? assignment.items.map(group => group.map(() => '')) : getDraft(assignment.code, assignment.items);
    if (submitted && !assignment.id) removeStorage(localStorage, draftPrefix + assignment.code);
    $('code-panel').hidden = true;
    $('student-work').hidden = false;
    $('work-code').textContent = assignment.code;
    $('work-meta').textContent = `${levels[assignment.level] || assignment.level || ''} · ${formatCounts(assignment)}`;
    $('work-state').textContent = assignment.id ? stateLabel(assignment) : submitted ? 'Сдано' : 'В процессе';
    $('work-state').classList.toggle('done', submitted);
    $('result-summary').hidden = !submitted;
    $('result-summary').textContent = submitted ? `Результат: ${assignment.score ?? '—'} из ${assignment.total ?? '—'}` : '';
    $('submit-work').hidden = submitted;
    $('ipa-keyboard').hidden = submitted;
    $('submit-note').textContent = submitted ? 'Ответы отправлены преподавателю.' : 'Все ответы отправятся одновременно.';
    activeInput = null;

    assignment.items.forEach((group, mode) => {
      $(`exercise-${mode}`).hidden = group.length === 0;
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
      if (currentAssignment.id) {
        $('student-back').disabled = true;
        clearTimeout(draftTimer);
        await saveStudentDraft();
        const data = await request(`/api/student/assignments/${encodeURIComponent(currentAssignment.id)}/submit`, { method: 'POST', student: true, body: { answers, revision: currentAssignment.revision, attempt: currentAssignment.attempt } });
        drawStudent(data.assignment);
        status('student-status', 'Ответы отправлены.', 'success');
        return;
      }
      const data = await request(`/api/assignments/${encodeURIComponent(code)}/submit`, { method: 'POST', body: { answers } });
      if (!data.assignment?.submittedAt) throw new Error('Сервис не подтвердил отправку. Попробуйте ещё раз.');
      drawStudent(data.assignment);
      status('student-status', '');
      $('result-summary').focus();
    } catch (error) {
      // A lost response can follow a successful submission. Check before allowing another attempt.
      try {
        const data = currentAssignment.id
          ? await request(`/api/student/assignments/${encodeURIComponent(currentAssignment.id)}`, { student: true })
          : await request(`/api/assignments/${encodeURIComponent(code)}`);
        if (data.assignment?.submittedAt && data.assignment.attempt === currentAssignment.attempt) {
          drawStudent(data.assignment);
          status('student-status', 'Ответы успешно отправлены.', 'success');
          return;
        }
      } catch { /* Keep the original error and the local draft. */ }
      status('student-status', error.message);
    } finally {
      submitting = false;
      $('submit-work').disabled = false;
      $('student-back').disabled = false;
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

  function prepareAdminTabs() {
    const tabs = [...$('admin-work').querySelectorAll('[role="tab"]')];
    function selectTab(selected) {
      for (const tab of tabs) {
        const active = tab === selected;
        tab.setAttribute('aria-selected', String(active));
        tab.tabIndex = active ? 0 : -1;
        $(tab.getAttribute('aria-controls')).hidden = !active;
      }
    }

    for (const [index, tab] of tabs.entries()) {
      tab.addEventListener('click', () => selectTab(tab));
      tab.addEventListener('keydown', event => {
        let nextIndex;
        switch (event.key) {
          case 'ArrowRight': nextIndex = (index + 1) % tabs.length; break;
          case 'ArrowLeft': nextIndex = (index - 1 + tabs.length) % tabs.length; break;
          case 'Home': nextIndex = 0; break;
          case 'End': nextIndex = tabs.length - 1; break;
          default: return;
        }
        event.preventDefault();
        selectTab(tabs[nextIndex]);
        tabs[nextIndex].focus();
      });
    }
  }

  function logout(message = '') {
    token = '';
    adminAssignments = [];
    $('delete-dialog').close();
    clearPreview();
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
      if (!Array.isArray(group) || group.length === 0) return;
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
    adminAssignments = assignments;
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
      const countText = formatCounts(assignment);
      description.append(element('p', 'muted', `${levels[assignment.level] || assignment.level || ''}${countText ? ` · ${countText}` : ''}${created ? ` · ${created}` : ''}`));
      const submitted = Boolean(assignment.submittedAt);
      if (submitted) description.append(element('p', 'muted', `Сдано ${formatDate(assignment.submittedAt)}`));
      const badgeText = assignment.private ? 'Сохранено' : submitted ? `Сдано · ${assignment.score ?? '—'} из ${assignment.total ?? '—'}` : 'Ожидает ответа';
      top.append(description, element('span', `assignment-badge${submitted ? ' done' : ''}`, badgeText));
      card.append(top);
      const actions = element('div', 'assignment-actions');
      const copy = element('button', 'button secondary', 'Скопировать ссылку');
      copy.type = 'button';
      copy.addEventListener('click', () => copyLink(assignment.code));
      const remove = element('button', 'button delete', 'Удалить');
      remove.type = 'button';
      remove.setAttribute('aria-label', `Удалить задание ${assignment.code}`);
      remove.addEventListener('click', () => {
        assignmentToDelete = assignment.code;
        $('delete-warning').textContent = assignment.private
          ? `Вариант ${assignment.code} больше нельзя будет назначить. Уже выданные работы останутся у учеников.`
          : `Работа по коду ${assignment.code} и её ответы будут удалены. Ссылка перестанет работать.`;
        status('delete-status', '');
        $('delete-dialog').showModal();
      });
      if (!assignment.private) actions.append(copy);
      actions.append(remove);
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
              : (await (assignment.private
                ? request('/api/admin/assignments', { method: 'POST', authenticated: true, body: { action: 'view', code: assignment.code } })
                : request(`/api/assignments/${encodeURIComponent(assignment.code)}`))).assignment;
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
    const refresh = ++latestRefresh;
    const currentToken = token;
    button.disabled = true;
    try {
      const data = await request('/api/admin/assignments', { authenticated: true });
      if (currentToken !== token || refresh !== latestRefresh) return false;
      if (!Array.isArray(data.assignments)) throw new Error('Не удалось получить список заданий.');
      if (JSON.stringify(data.assignments) !== JSON.stringify(adminAssignments)) drawAssignments(data.assignments);
      if (!quiet) status('admin-status', '');
      return true;
    } catch (error) {
      if (currentToken === token && refresh === latestRefresh && (!quiet || error.status === 401)) adminError(error);
      return false;
    }
    finally { if (refresh === latestRefresh) button.disabled = false; }
  }

  async function confirmDeletion(event) {
    event.preventDefault();
    const dialog = $('delete-dialog');
    const confirm = $('delete-confirm');
    const cancel = $('delete-cancel');
    if (!dialog.open || confirm.disabled || !token) return;
    const currentToken = token;
    const code = assignmentToDelete;
    confirm.disabled = cancel.disabled = true;
    status('delete-status', 'Удаляем задание…', 'success');
    try {
      const data = await request('/api/admin/assignments', {
        method: 'POST', authenticated: true, body: { action: 'delete', code },
      });
      if (currentToken !== token) return;
      if (data.deleted !== true || data.code !== code) throw new Error('Сервис не подтвердил удаление. Попробуйте ещё раз.');
      latestRefresh++;
      dialog.close();
      drawAssignments(adminAssignments.filter(assignment => assignment.code !== code));
      await refreshProfiles();
      $('refresh-list').disabled = false;
      $('refresh-list').focus();
      status('admin-status', `Задание ${code} удалено.`, 'success');
    } catch (error) {
      if (currentToken !== token) return;
      if (error.status === 401) adminError(error);
      else status('delete-status', error.message);
    } finally {
      confirm.disabled = cancel.disabled = false;
    }
  }

  function clearPreview() {
    previewDraft = null;
    $('assignment-preview').hidden = true;
    $('preview-choices').replaceChildren();
    $('preview-groups').replaceChildren();
    status('preview-status', '');
  }

  function renderPreview(settings, preview) {
    const byId = new Map(preview.choices.map(choice => [choice.id, choice]));
    const choices = [...preview.choices].sort((left, right) => left.display.localeCompare(right.display, 'en'));
    const byName = new Map(choices.map(choice => [choice.display.toLowerCase(), choice]));
    const findChoice = input => byName.get(input.value.trim().toLowerCase());
    $('preview-choices').replaceChildren(...choices.map(choice => {
      const option = element('option');
      option.value = choice.display;
      return option;
    }));
    const groups = $('preview-groups');
    const inputs = preview.selections.map((selection, mode) => {
      if (selection.length === 0) return [];
      const group = element('section');
      const list = element('ol', 'preview-words');
      group.append(element('h3', '', exerciseNames[mode]), list);
      groups.append(group);
      return selection.map((id, index) => {
        const choice = byId.get(id);
        const row = element('li');
        const fields = element('div', 'preview-word');
        const input = element('input');
        input.type = 'text';
        input.lang = 'en';
        input.value = choice.display;
        input.autocomplete = 'off';
        input.spellcheck = false;
        input.setAttribute('list', 'preview-choices');
        input.setAttribute('aria-label', `Упражнение ${mode + 1}, слово ${index + 1}`);
        const ipa = element('span', 'preview-ipa', `/${choice.ipa}/`);
        input.addEventListener('input', () => {
          const replacement = findChoice(input);
          ipa.textContent = replacement ? `/${replacement.ipa}/` : '';
          input.removeAttribute('aria-invalid');
          status('preview-status', '');
        });
        fields.append(input, ipa);
        row.append(fields);
        list.append(row);
        return input;
      });
    });
    previewDraft = { settings, revision: preview.revision, inputs, findChoice };
    $('assignment-preview').hidden = false;
    $('preview-title').focus();
  }

  function collectSelections(draft) {
    const seen = new Set();
    return draft.inputs.map(group => group.map(input => {
      const choice = draft.findChoice(input);
      const error = !choice ? 'Выберите слово из словаря.' :
        seen.has(choice.id) ? `Слово ${choice.display} уже есть в задании.` : '';
      if (error) {
        input.setAttribute('aria-invalid', 'true');
        input.focus();
        throw new Error(error);
      }
      input.removeAttribute('aria-invalid');
      seen.add(choice.id);
      return choice.id;
    }));
  }

  async function saveStudentDraft() {
    draftPromise = draftPromise.then(async () => {
      if (draftBlocked) throw new Error('Черновик изменён на другом устройстве. Вернитесь к списку и откройте задание снова.');
      while (draftDirty) {
        draftDirty = false;
        const snapshot = answers.map(group => [...group]);
        try {
          const data = await request(`/api/student/assignments/${encodeURIComponent(currentAssignment.id)}/draft`, { method: 'POST', student: true, body: { answers: snapshot, revision: currentAssignment.revision, attempt: currentAssignment.attempt } });
          currentAssignment.revision = data.assignment.revision;
          $('work-state').textContent = stateLabel(data.assignment);
          status('student-status', 'Черновик сохранён.', 'success');
        } catch (error) {
          draftDirty = true;
          if (error.status === 409) draftBlocked = true;
          status('student-status', draftBlocked ? 'Черновик изменён на другом устройстве. Вернитесь к списку и откройте задание снова.' : `Черновик не сохранён. ${error.message}`);
          throw error;
        }
      }
    });
    const pending = draftPromise;
    draftPromise = pending.catch(() => {});
    return pending;
  }

  const stateLabel = assignment => ({ assigned: 'Назначено', in_progress: 'В работе', submitted: 'Сдано' }[assignment.status] || 'Назначено');

  async function showStudentDashboard() {
    const data = await request('/api/student/assignments', { student: true });
    $('student-name').textContent = data.student.name;
    $('student-login-panel').hidden = true;
    $('code-panel').hidden = true;
    $('student-dashboard').hidden = false;
    $('student-work').hidden = true;
    $('student-back').hidden = true;
    $('student-list').replaceChildren();
    for (const assignment of data.assignments) {
      const item = element('div', 'assignment');
      item.append(element('p', '', `${assignment.code} · ${stateLabel(assignment)}${assignment.status === 'submitted' ? ` · ${assignment.score} из ${assignment.total}` : ''}`));
      const button = element('button', 'button secondary', 'Открыть');
      button.type = 'button';
      button.addEventListener('click', async () => {
        button.disabled = true;
        try {
          const result = await request(`/api/student/assignments/${encodeURIComponent(assignment.id)}`, { student: true });
          draftDirty = false; draftBlocked = false;
          $('student-dashboard').hidden = true;
          $('student-back').hidden = false;
          drawStudent(result.assignment);
          status('student-status', '');
        } catch (error) { status('student-status', error.message); }
        finally { button.disabled = false; }
      });
      item.append(button); $('student-list').append(item);
    }
    if (!data.assignments.length) $('student-list').append(element('p', 'muted', 'Пока нет назначенных заданий.'));
  }

  async function refreshProfiles() {
    if (!token) return;
    try {
      const [profiles, assigned] = await Promise.all([request('/api/admin/students', { authenticated: true }), request('/api/admin/student-assignments', { authenticated: true })]);
      $('admin-students').replaceChildren(...profiles.students.map(student => element('p', '', `${student.name} · ${student.login}`)));
      const fieldset = $('assign-students');
      const checked = new Set([...fieldset.querySelectorAll('input:checked')].map(input => input.value));
      const activeCode = $('assign-code').value;
      fieldset.replaceChildren(element('legend', '', 'Ученики'));
      for (const student of profiles.students) {
        const label = element('label');
        const box = element('input'); box.type = 'checkbox'; box.value = student.id; box.checked = checked.has(student.id);
        label.append(box, document.createTextNode(` ${student.name} `)); fieldset.append(label);
      }
      $('assign-code').replaceChildren(...adminAssignments.map(assignment => {
        const option = element('option', '', `${assignment.code} · ${formatCounts(assignment)}`); option.value = assignment.code; return option;
      }));
      if (adminAssignments.some(assignment => assignment.code === activeCode)) $('assign-code').value = activeCode;
      updateImportOption();
      $('assigned-list').replaceChildren();
      if (!assigned.assignments.length) $('assigned-list').append(element('p', 'muted', 'Пока нет назначенных заданий.'));
      for (const assignment of assigned.assignments) {
        const item = element('div', 'assignment');
        item.append(element('p', '', `${assignment.studentName} · ${assignment.code} · ${stateLabel(assignment)}${assignment.status === 'submitted' ? ` · ${assignment.score} из ${assignment.total}` : ''}`));
        if (assignment.status === 'submitted') {
          const details = element('details');
          const content = element('div', 'assignment-details');
          details.append(element('summary', '', 'Ответы ученика'), content);
          details.addEventListener('toggle', async () => {
            if (!details.open || content.dataset.loaded) return;
            try {
              const result = await request(`/api/admin/student-assignments/${encodeURIComponent(assignment.id)}`, { authenticated: true });
              drawReview(content, result.assignment);
              content.dataset.loaded = 'true';
            } catch (error) { content.textContent = error.message; }
          });
          item.append(details);
          const button = element('button', 'button secondary', 'Разрешить повторную попытку'); button.type = 'button';
          button.addEventListener('click', async () => { try { button.disabled = true; await request(`/api/admin/student-assignments/${encodeURIComponent(assignment.id)}/retry`, { method: 'POST', authenticated: true }); await refreshProfiles(); } catch (error) { status('admin-status', error.message); button.disabled = false; } });
          item.append(button);
        }
        $('assigned-list').append(item);
      }
    } catch (error) { status('admin-status', error.message); }
  }

  function updateImportOption() {
    const selected = adminAssignments.find(assignment => assignment.code === $('assign-code').value);
    const available = Boolean(selected?.submittedAt && !selected.private);
    $('import-result-option').hidden = !available;
    if (!available) $('import-result').checked = false;
    $('assign-form').querySelector('button').textContent = available && $('import-result').checked
      ? 'Перенести результат' : 'Назначить';
  }

  $('student-login').addEventListener('submit', async event => {
    event.preventDefault();
    try { const data = await request('/api/student/login', { method: 'POST', body: { login: $('student-login-name').value, password: $('student-password').value } }); studentToken = data.token; writeStorage(sessionStorage, 'student-token', studentToken); $('student-password').value = ''; await showStudentDashboard(); status('student-status', ''); } catch (error) { status('student-status', error.message); }
  });
  $('student-logout').addEventListener('click', async () => {
    await request('/api/student/logout', { method: 'POST', student: true }).catch(() => {});
    studentToken = '';
    removeStorage(sessionStorage, 'student-token');
    $('student-dashboard').hidden = true;
    $('student-login-panel').hidden = false;
    $('code-panel').hidden = false;
  });
  $('student-back').addEventListener('click', async event => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      clearTimeout(draftTimer);
      if (!draftBlocked) await saveStudentDraft();
      await showStudentDashboard();
      currentAssignment = null;
      status('student-status', '');
    } catch (error) { status('student-status', error.message); }
    finally { button.disabled = false; }
  });
  $('student-create').addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector('button');
    button.disabled = true;
    try {
      await request('/api/admin/students', {
        method: 'POST', authenticated: true,
        body: { name: $('new-name').value, login: $('new-login').value, password: $('new-password').value },
      });
      form.reset();
      await refreshProfiles();
      status('admin-status', 'Профиль создан.', 'success');
    } catch (error) { status('admin-status', error.message); }
    finally { button.disabled = false; }
  });
  $('assign-code').addEventListener('change', () => {
    $('import-result').checked = false;
    updateImportOption();
  });
  $('import-result').addEventListener('change', updateImportOption);
  $('assign-form').addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector('button');
    const studentIds = [...$('assign-students').querySelectorAll('input:checked')].map(input => input.value);
    const importResult = $('import-result').checked;
    if (studentIds.length === 0 || (importResult && studentIds.length !== 1)) {
      status('admin-status', importResult ? 'Для переноса результата выберите одного ученика.' : 'Выберите ученика.');
      return;
    }
    button.disabled = true;
    try {
      await request('/api/admin/student-assignments', {
        method: 'POST', authenticated: true, body: { code: $('assign-code').value, studentIds, importResult },
      });
      $('assign-students').querySelectorAll('input:checked').forEach(input => { input.checked = false; });
      $('import-result').checked = false;
      await refreshProfiles();
      status('admin-status', importResult ? 'Результат перенесён в профиль ученика.' : 'Задание назначено.', 'success');
    } catch (error) { status('admin-status', error.message); }
    finally { button.disabled = false; }
  });
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
      await refreshProfiles();
    } catch (error) { status('admin-status', error.message); }
    finally { button.disabled = false; }
  });
  $('create-form').addEventListener('submit', async event => {
    event.preventDefault();
    const controls = [$('count-0'), $('count-1'), $('level')];
    const button = event.currentTarget.querySelector('button');
    if (button.disabled || !token) return;
    const currentToken = token;
    const counts = controls.slice(0, 2).map(input => input.valueAsNumber);
    const settings = { counts, level: $('level').value };
    if (!counts.every(value => Number.isSafeInteger(value) && value >= 0) || counts.every(value => value === 0)) {
      status('admin-status', 'Укажите целое неотрицательное число для каждого упражнения. Хотя бы в одном упражнении должно быть слово.');
      return;
    }
    clearPreview();
    button.disabled = true;
    controls.forEach(control => { control.disabled = true; });
    status('admin-status', 'Подбираем слова…', 'success');
    try {
      const data = await request('/api/admin/assignments', {
        method: 'POST', authenticated: true, body: { action: 'preview', settings },
      });
      if (currentToken !== token) return;
      if (!data.preview) throw new Error('Не удалось получить список слов. Попробуйте ещё раз.');
      renderPreview(settings, data.preview);
      status('admin-status', '');
    } catch (error) { if (currentToken === token) adminError(error); }
    finally {
      button.disabled = false;
      controls.forEach(control => { control.disabled = false; });
    }
  });
  $('create-form').addEventListener('input', () => {
    if (!previewDraft) return;
    clearPreview();
    status('admin-status', 'Параметры изменились. Нажмите «Подобрать слова», чтобы обновить список.');
  });
  $('publish-assignment').addEventListener('click', async event => {
    const button = event.currentTarget;
    const draft = previewDraft;
    if (!draft || button.disabled || !token) return;
    let selections;
    try { selections = collectSelections(draft); }
    catch (error) { status('preview-status', error.message); return; }

    const currentToken = token;
    const controls = [...$('create-form').elements, ...draft.inputs.flat(), button];
    controls.forEach(control => { control.disabled = true; });
    status('preview-status', 'Создаём задание…', 'success');
    try {
      const data = await request('/api/admin/assignments', {
        method: 'POST', authenticated: true,
        body: { action: 'create-preview', private: true, settings: draft.settings, revision: draft.revision, selections },
      });
      if (currentToken !== token) return;
      if (!data.assignment?.code) throw new Error('Сервис не подтвердил создание задания.');
      clearPreview();
      const refreshed = await refreshAssignments();
      await refreshProfiles();
      if (currentToken !== token) return;
      if (refreshed) {
        status('admin-status', `Задание ${data.assignment.code} сохранено. Его можно назначить ученикам.`, 'success');
      } else if (token) {
        if (!adminAssignments.some(assignment => assignment.code === data.assignment.code)) {
          drawAssignments([data.assignment, ...adminAssignments]);
        }
        status('admin-status', 'Задание сохранено. Обновите список перед назначением.', 'success');
      }
    } catch (error) {
      if (currentToken !== token) return;
      if (error.status === 401) adminError(error);
      else status('preview-status', error.message);
    } finally {
      controls.forEach(control => { control.disabled = false; });
    }
  });
  $('refresh-list').addEventListener('click', async () => {
    if (await refreshAssignments()) await refreshProfiles();
  });
  $('logout').addEventListener('click', () => {
    request('/api/admin/logout', { method: 'POST', authenticated: true }).catch(() => {});
    logout();
  });
  $('copy-close').addEventListener('click', () => $('copy-dialog').close());
  $('delete-form').addEventListener('submit', confirmDeletion);
  $('delete-cancel').addEventListener('click', () => $('delete-dialog').close());
  $('delete-dialog').addEventListener('cancel', event => {
    if ($('delete-confirm').disabled) event.preventDefault();
  });

  if (adminMode) {
    $('admin-view').hidden = false;
    $('admin-link').hidden = true;
    prepareAdminTabs();
    if (token) { showAdmin(true); refreshAssignments().then(refreshProfiles); }
    const refreshIfVisible = () => {
      if (token && !document.hidden) refreshAssignments({ quiet: true });
    };
    setInterval(refreshIfVisible, 15000);
    document.addEventListener('visibilitychange', refreshIfVisible);
  } else {
    $('student-view').hidden = false;
    prepareKeyboard();
    openAssignment(new URLSearchParams(location.search).get('code') || '');
    if (studentToken && !new URLSearchParams(location.search).get('code')) {
      showStudentDashboard().catch(error => {
        if (error.status === 401) {
          studentToken = '';
          removeStorage(sessionStorage, 'student-token');
        }
        status('student-status', error.message);
      });
    }
  }
})();
