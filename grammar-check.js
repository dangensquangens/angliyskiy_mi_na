const contractions = new Map([
  ["don't", 'do not'], ["doesn't", 'does not'], ["didn't", 'did not'],
  ["isn't", 'is not'], ["aren't", 'are not'], ["wasn't", 'was not'], ["weren't", 'were not'],
  ["hasn't", 'has not'], ["haven't", 'have not'], ["hadn't", 'had not'], ["won't", 'will not'],
]);

function normalize(value) {
  return value.normalize('NFC').trim().toLowerCase().replace(/[‘’]/g, "'").replace(/\s+/gu, ' ');
}

export function answerSlotCount(exercise) {
  return exercise.answers[0].length;
}

export function gradeAnswer(exercise, values = []) {
  const provided = Array.from({ length: answerSlotCount(exercise) }, (_, index) => normalize(values[index] ?? ''));
  if (provided.every(value => !value)) return 'empty';
  if (provided.some(value => !value)) return 'incorrect';

  // Expand only the listed negative auxiliaries, within each answer slot.
  // This preserves word order and never adds new combinations of slots.
  const expand = value => value.replace(/\b[a-z]+n't\b/g, word => contractions.get(word) ?? word);
  const correct = exercise.answers.some(answer => answer.every((expected, index) => {
    const authored = normalize(expected);
    return authored === provided[index] || expand(authored) === expand(provided[index]);
  }));
  if (correct) return 'correct';
  return exercise.review ? 'review' : 'incorrect';
}

export function isAnswerComplete(exercise, values) {
  return values?.length === answerSlotCount(exercise) && values.every(value => value.trim());
}

export function countAnswered(exercises, responses) {
  return exercises.filter(exercise => isAnswerComplete(exercise, responses[exercise.id])).length;
}

export function summarizeAnswers(exercises, responses) {
  const byTopic = Object.create(null);
  const mistakes = [];
  let correct = 0;
  let review = 0;
  for (const exercise of exercises) {
    const topic = byTopic[exercise.topic] ??= { total: 0, correct: 0, review: 0 };
    topic.total++;
    const grade = gradeAnswer(exercise, responses[exercise.id]);
    if (grade === 'correct') {
      correct++;
      topic.correct++;
    } else if (grade === 'review') {
      review++;
      topic.review++;
    } else {
      mistakes.push(exercise.id);
    }
  }
  return { total: exercises.length, correct, review, answered: countAnswered(exercises, responses), byTopic, mistakes };
}
