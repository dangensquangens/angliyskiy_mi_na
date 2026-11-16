(() => {
  const families = {
    'short-a': 'short', 'short-e': 'short', 'short-i': 'short',
    'short-o': 'short', 'short-u': 'short', sh: 'consonants',
    ch: 'consonants', 'th-voiceless': 'consonants', 'th-voiced': 'consonants',
    wh: 'consonants', kn: 'consonants', wr: 'consonants', ph: 'consonants',
    ng: 'consonants', ck: 'consonants', tion: 'consonants', 'other-short': 'other',
    other: 'other', phrases: 'other',
  };

  function hasLevel(word, level) {
    return level === 'all' || (word.levels ?? [word.level]).includes(level);
  }

  function shuffle(values) {
    for (let index = values.length - 1; index > 0; index -= 1) {
      const choice = Math.floor(Math.random() * (index + 1));
      [values[index], values[choice]] = [values[choice], values[index]];
    }
    return values;
  }

  function draw(remaining, count, level) {
    const a2 = Math.floor(count * 0.3 + 0.5);
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

  function choose(words, count, level) {
    const remaining = shuffle(words.filter(word => hasLevel(word, level)));
    return [draw(remaining, count, level), draw(remaining, count, level)];
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

  globalThis.READING_RULES = Object.freeze({ choose, hasLevel, isCorrect });
})();
