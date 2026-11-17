export const countOptions = [10, 20, 50, 100, 'all'];
export const modeLabels = Object.freeze({
  practice: 'Тренировка',
  test: 'Контрольная',
  solutions: 'Просмотр решений',
});
export const pageSize = 10;

const slug = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

async function readJson(path) {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`Could not load ${path}`);
  return response.json();
}

export async function readGrammarCatalog() {
  const data = await readJson('data/grammar/catalog.json');
  if (data.version !== 1 || !Array.isArray(data.categories) || !data.categories.length) {
    throw new Error('Invalid grammar catalogue');
  }
  return data.categories;
}

function validExercise(exercise, topic) {
  return exercise && typeof exercise.id === 'string' && exercise.id && exercise.topic === topic
    && typeof exercise.prompt === 'string' && ['gaps', 'sentence'].includes(exercise.answerMode)
    && Array.isArray(exercise.answers) && exercise.answers.length > 0
    && exercise.answers.every(answer => Array.isArray(answer) && answer.length > 0
      && answer.length === exercise.answers[0].length && answer.every(value => typeof value === 'string' && value.trim()));
}

export async function readGrammarTopic(id) {
  if (!slug.test(id)) throw new Error('Invalid grammar topic');
  const file = await readJson(`data/grammar/${id}.json`);
  if (file.version !== 1 || file.topic !== id || !Array.isArray(file.exercises)
    || file.exercises.some(exercise => !validExercise(exercise, id))) throw new Error('Invalid grammar exercises');
  return file.exercises;
}

function shuffle(entries, random) {
  const result = [...entries];
  for (let position = result.length - 1; position > 0; position--) {
    const other = Math.floor(random() * (position + 1));
    [result[position], result[other]] = [result[other], result[position]];
  }
  return result;
}

export function selectExercises(groups, requestedCount, random = Math.random) {
  const ids = new Set();
  const pools = shuffle(groups, random).map(group => shuffle(group, random).filter(exercise => {
    if (ids.has(exercise.id)) return false;
    ids.add(exercise.id);
    return true;
  }));
  const count = requestedCount === 'all' ? ids.size : Math.min(Number(requestedCount), ids.size);
  const selected = [];
  for (let position = 0; selected.length < count; position++) {
    for (const pool of pools) {
      if (pool[position]) selected.push(pool[position]);
      if (selected.length === count) break;
    }
  }
  return shuffle(selected, random);
}

export function practiceUrl({ topics = [], attempt } = {}) {
  const params = new URLSearchParams();
  if (topics.length) params.set('topics', topics.join(','));
  if (attempt) params.set('attempt', attempt);
  return `grammar-practice.html${params.size ? `?${params}` : ''}`;
}
