import { countOptions, modeLabels, pageSize } from './grammar-data.js';

const idFormat = /^[a-f0-9]{32}$/;

export function newAttemptId() {
  return Array.from(crypto.getRandomValues(new Uint32Array(4)), value => value.toString(16).padStart(8, '0')).join('');
}

function isSummary(result, size) {
  return result === null || Boolean(result && result.total === size
    && Number.isFinite(result.completedAt)
    && ['correct', 'review', 'answered'].every(key => Number.isInteger(result[key]) && result[key] >= 0 && result[key] <= size)
    && result.byTopic && typeof result.byTopic === 'object' && Array.isArray(result.mistakes)
    && result.mistakes.every(id => typeof id === 'string'));
}

function validAttempt(saved, id) {
  return saved && saved.version === 1 && saved.id === id && Object.hasOwn(modeLabels, saved.mode)
    && Number.isFinite(saved.updatedAt) && Number.isFinite(saved.startedAt)
    && countOptions.includes(saved.count)
    && Array.isArray(saved.topics) && saved.topics.length > 0 && saved.topics.every(topic => typeof topic === 'string')
    && Array.isArray(saved.questions) && saved.questions.length > 0 && saved.questions.every(question => typeof question === 'string')
    && new Set(saved.questions).size === saved.questions.length
    && Number.isInteger(saved.page) && saved.page >= 0 && saved.page < Math.ceil(saved.questions.length / pageSize)
    && saved.responses && typeof saved.responses === 'object' && !Array.isArray(saved.responses)
    && Object.values(saved.responses).every(values => Array.isArray(values) && values.every(value => typeof value === 'string'))
    && Array.isArray(saved.checkedPages) && saved.checkedPages.every(page => Number.isInteger(page) && page >= 0)
    && isSummary(saved.result, saved.questions.length);
}

export function createGrammarStore({
  sitePath = new URL('.', location.href).pathname,
  storage = () => localStorage,
  onUnavailable = () => {},
} = {}) {
  const prefix = `english-grammar:v1:${sitePath}:attempt:`;
  const fallback = new Map();

  function read(id) {
    if (!idFormat.test(id)) return null;
    let serialized = fallback.get(id);
    try {
      if (serialized === undefined) serialized = storage().getItem(prefix + id);
    } catch {
      onUnavailable();
      return null;
    }
    if (!serialized) return null;
    try {
      const record = JSON.parse(serialized);
      return validAttempt(record, id) ? record : null;
    } catch {
      return null;
    }
  }

  function write(attempt) {
    const json = JSON.stringify(attempt);
    try {
      storage().setItem(prefix + attempt.id, json);
      fallback.delete(attempt.id);
    } catch {
      fallback.set(attempt.id, json);
      onUnavailable();
    }
  }

  function list() {
    const keys = new Set(fallback.keys());
    try {
      const client = storage();
      for (let index = 0; index < client.length; index++) {
        const key = client.key(index);
        if (key?.startsWith(prefix)) keys.add(key.slice(prefix.length));
      }
    } catch {
      onUnavailable();
    }
    return [...keys].map(read).filter(Boolean).sort((left, right) =>
      (right.result?.completedAt ?? right.updatedAt) - (left.result?.completedAt ?? left.updatedAt));
  }

  return { read, write, list };
}
