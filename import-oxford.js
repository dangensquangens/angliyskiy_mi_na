// The Oxford PDF is selected by the user and processed in the browser.
// Britfone 3.0.1, by Jose Llarena, is distributed under the MIT licence:
// https://github.com/JoseLlarena/Britfone/blob/1062be14adc96c358f2087ac5449d72130c7a6f4/LICENSE.txt
(function () {
  const pdfVersion = '5.4.624';
  const pdfBase = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfVersion}/build/`;
  const dictionaryUrl = 'https://raw.githubusercontent.com/JoseLlarena/Britfone/1062be14adc96c358f2087ac5449d72130c7a6f4/britfone.main.3.0.1.csv';
  const posStart = /\s+(?:indefinite article|definite article|modal v\.|auxiliary v\.|noun\.|adj\.|adv\.|det\.|pron\.|prep\.|conj\.|exclam\.|number\b|n\.|v\.)/i;
  // Entries missing from Britfone, checked against the British Oxford Learner's Dictionary.
  const extraPronunciations = {
    'because of': ['bɪˈkɒz əv', 'bɪˈkʌz əv'],
    'grandparent': ['ˈɡrænpeərənt'],
    'have to': ['ˈhæv tə', 'ˈhæf tə'],
    'ice cream': ['ˈaɪs kriːm', 'ˌaɪs ˈkriːm'],
    'next to': ['ˈnekst tə', 'ˈnekst tu'],
    'no one': ['ˈnəʊ wʌn'],
    'o’clock': ['əˈklɒk'],
    'ok': ['əʊˈkeɪ'],
    'sweater': ['ˈswetə', 'ˈswetə(r)'],
    'tv': ['ˌtiː ˈviː'],
    'according to': ['əˈkɔːdɪŋ tə', 'əˈkɔːdɪŋ tu'],
    'all right': ['ɔːl ˈraɪt'],
    'any more': ['ˌeni ˈmɔː', 'ˌeni ˈmɔː(r)'],
    'instead of': ['ɪnˈsted əv'],
    'per cent': ['pə ˈsent'],
    'recycle': ['ˌriːˈsaɪkl'],
    'smartphone': ['ˈsmɑːtfəʊn'],
    'used to': ['ˈjuːst tə', 'ˈjuːst tu'],
  };

  function pageLines(items, pageWidth) {
    const columns = Array.from({ length: 4 }, () => []);
    for (const item of items) {
      if (!item.str || !item.str.trim()) continue;
      const x = item.transform[4];
      const y = item.transform[5];
      const margin = pageWidth * 0.0714;
      const columnWidth = (pageWidth - 2 * margin) / 3.92;
      const column = Math.max(0, Math.min(3, Math.floor((x - margin + 0.5) / columnWidth)));
      columns[column].push({ x, y, width: item.width || 0, text: item.str });
    }

    return columns.flatMap(column => {
      column.sort((a, b) => b.y - a.y || a.x - b.x);
      const rows = [];
      for (const item of column) {
        let row = rows.find(candidate => Math.abs(candidate.y - item.y) < 2);
        if (!row) {
          row = { y: item.y, items: [] };
          rows.push(row);
        }
        row.items.push(item);
      }
      return rows.sort((a, b) => b.y - a.y).map(row => {
        row.items.sort((a, b) => a.x - b.x);
        let line = '';
        let end = -Infinity;
        for (const item of row.items) {
          const gap = item.x - end;
          if (line && gap > 1.5 && !/\s$/.test(line) && !/^\s/.test(item.text)) line += ' ';
          line += item.text;
          end = item.x + item.width;
        }
        return line.replace(/\s+/g, ' ').trim();
      });
    });
  }

  function parseOxford(lines) {
    const entries = new Map();
    let level = '';
    let sawB1 = false;
    for (const rawLine of lines) {
      const line = rawLine.replace(/©.*$/, '').trim();
      if (line === 'A1' || line === 'A2') {
        level = line;
        continue;
      }
      if (line === 'B1') {
        sawB1 = true;
        break;
      }
      if (!level || !line || /^The Oxford 3000|^\d+\s*\/\s*\d+/i.test(line)) continue;
      const pos = line.search(posStart);
      if (pos < 0) continue;
      const head = line.slice(0, pos).replace(/\([^)]*\)/g, '').trim().replace(/([a-z])\s*[¹²³123]+$/i, '$1').trim();
      const spellings = head.toLowerCase() === 'a, an' ? ['a', 'an'] : [head];
      for (const spelling of spellings) {
        const display = spelling.replace(/\s+/g, ' ').trim();
        const word = display.toLowerCase();
        if (!/^[\p{L}]+(?:[ ’'-][\p{L}]+)*$/u.test(word)) continue;
        const entry = entries.get(word);
        if (entry) {
          if (!entry.levels.includes(level)) entry.levels.push(level);
        } else {
          entries.set(word, { word, level, levels: [level], ...(display !== word ? { display } : {}) });
        }
      }
    }
    const a1 = [...entries.values()].filter(entry => entry.levels.includes('A1')).length;
    const a2 = [...entries.values()].filter(entry => entry.levels.includes('A2')).length;
    if (!sawB1 || a1 < 700 || a2 < 700 || a1 > 1100 || a2 > 1100) {
      throw new Error(`Не удалось надёжно прочитать уровни A1 и A2 в этом PDF (найдено ${a1} и ${a2}). Проверьте, что выбран официальный PDF Oxford 3000 by CEFR level.`);
    }
    return [...entries.values()];
  }

  function parseBritfone(csv) {
    const dictionary = new Map();
    for (const line of csv.split(/\r?\n/)) {
      const comma = line.indexOf(',');
      if (comma < 0) continue;
      const word = line.slice(0, comma).trim().replace(/\(\d+\)$/, '').replace(/_/g, ' ').toLowerCase();
      const phonemes = line.slice(comma + 1).trim().split(/\s+/);
      let ipa = phonemes.join('');
      if (!word || !ipa) continue;
      // Britfone explicitly uses these IPA symbols for the traditional dictionary symbols.
      ipa = ipa.replace(/ɹ/g, 'r').replace(/ɛ/g, 'e').replace(/ɐ/g, 'ʌ');
      // Britfone places stress before the vowel. In monosyllables it adds no distinction.
      if (phonemes.filter(phoneme => /[aeiouæɑɒɔʊʌɜəɪɐɛ]/.test(phoneme)).length === 1) ipa = ipa.replace(/[ˈˌ]/g, '');
      if (!dictionary.has(word)) dictionary.set(word, []);
      if (!dictionary.get(word).includes(ipa)) dictionary.get(word).push(ipa);
    }
    return dictionary;
  }

  function groupFor(word, ipa) {
    const plain = ipa.replace(/[ˈˌ]/g, '');
    if (/\s/.test(word)) return 'phrases';
    if (/th/.test(word) && /θ/.test(plain)) return 'th-voiceless';
    if (/th/.test(word) && /ð/.test(plain)) return 'th-voiced';
    if (/sh/.test(word) && /ʃ/.test(plain)) return 'sh';
    if (/ch/.test(word) && /tʃ/.test(plain)) return 'ch';
    if (/ee/.test(word) && /iː/.test(plain)) return 'ee';
    if (/oo/.test(word) && /uː/.test(plain)) return 'oo-long';
    if (/oo/.test(word) && /ʊ/.test(plain)) return 'oo-short';
    if (/oa/.test(word) && /əʊ/.test(plain)) return 'oa';
    if (/ai/.test(word) && /eɪ/.test(plain)) return 'ai';
    if (/ou/.test(word) && /aʊ/.test(plain)) return 'ou';
    if (/ea/.test(word) && /iː/.test(plain)) return 'ea-long';
    if (/ea/.test(word) && /e(?![ɪəː])/.test(plain)) return 'ea-short';
    if (/ay/.test(word) && /eɪ/.test(plain)) return 'ay';
    if (/ow/.test(word) && /əʊ/.test(plain)) return 'ow-long';
    if (/ow/.test(word) && /aʊ/.test(plain)) return 'ow-short';
    if (/igh/.test(word) && /aɪ/.test(plain)) return 'igh';
    if (/oi|oy/.test(word) && /ɔɪ/.test(plain)) return 'oi';
    if (/ar/.test(word) && /ɑː/.test(plain)) return 'ar';
    if (/or/.test(word) && /ɔː/.test(plain)) return 'or';
    if (/er|ir|ur/.test(word) && /ɜː/.test(plain)) return 'er-ir-ur';
    if (/wh/.test(word) && /w/.test(plain)) return 'wh';
    if (/^kn/.test(word) && /^n/.test(plain)) return 'kn';
    if (/^wr/.test(word) && /^r/.test(plain)) return 'wr';
    if (/ph/.test(word) && /f/.test(plain)) return 'ph';
    if (/ng/.test(word) && /ŋ/.test(plain)) return 'ng';
    if (/ck/.test(word) && /k/.test(plain)) return 'ck';
    if (/tion/.test(word) && /ʃən/.test(plain)) return 'tion';
    if (/a[^aeiou]e$/.test(word) && /eɪ/.test(plain)) return 'a-e';
    if (/i[^aeiou]e$/.test(word) && /aɪ/.test(plain)) return 'i-e';
    if (/o[^aeiou]e$/.test(word) && /əʊ/.test(plain)) return 'o-e';
    if (/u[^aeiou]e$/.test(word) && /(?:j)?uː/.test(plain)) return 'u-e';
    if (/^[^aeiou]*a[^aeiou]+$/.test(word) && /æ/.test(plain)) return 'short-a';
    if (/^[^aeiou]*e[^aeiou]+$/.test(word) && /e(?![ɪəː])/.test(plain)) return 'short-e';
    if (/^[^aeiou]*i[^aeiou]+$/.test(word) && /ɪ(?!ə)/.test(plain)) return 'short-i';
    if (/^[^aeiou]*o[^aeiou]+$/.test(word) && /ɒ/.test(plain)) return 'short-o';
    if (/^[^aeiou]*u[^aeiou]+$/.test(word) && /ʌ/.test(plain)) return 'short-u';
    const nuclei = plain.match(/aɪ|aʊ|eɪ|əʊ|ɔɪ|ɪə|eə|ʊə|[aeiouæɑɒɔʊʌɜəɪ]|[lnm]̩/gu) ?? [];
    return nuclei.length === 1 ? 'other-short' : 'other';
  }

  function soundKey(ipa) {
    return ipa.toLowerCase().replace(/\(r\)/g, '').replace(/[\s/\[\]ˌ]/g, '')
      .replace(/ɡ/g, 'g').replace(/([ˈ])([^aeiouæɑɒɔʊʌɜəɪˈ]+)(?=[aeiouæɑɒɔʊʌɜəɪ])/g, '$2$1');
  }

  globalThis.importOxford = async function (file, starterWords, reportStatus = () => {}) {
    if (!file || typeof file.arrayBuffer !== 'function') throw new Error('Выберите PDF Oxford 3000 by CEFR level.');
    reportStatus('Читаем PDF Oxford…');
    const pdfjs = await import(`${pdfBase}pdf.min.mjs`);
    pdfjs.GlobalWorkerOptions.workerSrc = `${pdfBase}pdf.worker.min.mjs`;
    const document = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
    const lines = [];
    try {
      for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
        const page = await document.getPage(pageNumber);
        const content = await page.getTextContent();
        lines.push(...pageLines(content.items, page.view[2] - page.view[0]));
      }
    } finally {
      await document.destroy();
    }
    const entries = parseOxford(lines);
    reportStatus('Загружаем британские транскрипции Britfone…');
    const response = await fetch(dictionaryUrl);
    if (!response.ok) throw new Error(`Не удалось загрузить Britfone (ошибка ${response.status}). Проверьте подключение к интернету.`);
    const dictionary = parseBritfone(await response.text());
    const starter = new Map((starterWords || []).map(entry => [entry.word.toLowerCase(), entry]));
    const words = [];
    const missing = [];
    for (const entry of entries) {
      const original = starter.get(entry.word);
      const found = dictionary.get(entry.word) || extraPronunciations[entry.word];
      if (original) {
        words.push({ ...entry, ...original, levels: entry.levels });
      } else if (found && found.length) {
        const source = dictionary.has(entry.word) ? 'Britfone' : 'Oxford';
        words.push({ ...entry, ipa: found[0], alternatives: found.slice(1), group: groupFor(entry.word, found[0]), hint: '', source });
      } else {
        missing.push({ word: entry.word, level: entry.level, levels: entry.levels });
      }
    }

    const spellingsBySound = new Map();
    for (const entry of words) {
      for (const ipa of [entry.ipa, ...(entry.alternatives || [])]) {
        const key = soundKey(ipa);
        if (!spellingsBySound.has(key)) spellingsBySound.set(key, new Set());
        spellingsBySound.get(key).add(entry.word);
      }
    }
    for (const entry of words) {
      entry.spellings = [...(spellingsBySound.get(soundKey(entry.ipa)) || [])];
    }
    const counts = {
      A1: entries.filter(entry => entry.levels.includes('A1')).length,
      A2: entries.filter(entry => entry.levels.includes('A2')).length,
      matched: words.length,
      missing: missing.length,
    };
    reportStatus(`Найдено ${counts.matched} слов с транскрипциями.`);
    return { words, missing, counts };
  };
}());
