(function () {
  'use strict';

  const scriptUrl = document.currentScript && document.currentScript.src;
  const assetBase = new URL('.', scriptUrl || document.baseURI);
  let libraryPromise;
  let fontPromise;

  function loadLibrary() {
    if (!libraryPromise) {
      libraryPromise = new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = new URL('jspdf.umd.min.js', assetBase).href;
        script.onload = () => {
          if (globalThis.jspdf && typeof globalThis.jspdf.jsPDF === 'function') {
            resolve(globalThis.jspdf.jsPDF);
          } else {
            reject(new Error('Не удалось загрузить инструмент для создания PDF.'));
          }
        };
        script.onerror = () => reject(new Error('Не удалось загрузить инструмент для создания PDF. Проверьте подключение и повторите попытку.'));
        document.head.appendChild(script);
      }).catch(error => {
        libraryPromise = undefined;
        throw error;
      });
    }
    return libraryPromise;
  }

  function loadFont() {
    if (!fontPromise) {
      fontPromise = fetch(new URL('WorkbookSans.ttf', assetBase))
        .then(response => {
          if (!response.ok) throw new Error('Не удалось загрузить шрифт для PDF.');
          return response.arrayBuffer();
        })
        .then(buffer => {
          const bytes = new Uint8Array(buffer);
          const chunks = [];
          for (let i = 0; i < bytes.length; i += 32768) {
            chunks.push(String.fromCharCode(...bytes.subarray(i, i + 32768)));
          }
          return btoa(chunks.join(''));
        })
        .catch(error => {
          fontPromise = undefined;
          throw error;
        });
    }
    return fontPromise;
  }

  function textValue(value) {
    return value == null ? '' : String(value).replace(/\r\n?/g, '\n');
  }

  async function downloadWorksheetResponses({ title, subtitle, filename, sections }) {
    if (!Array.isArray(sections)) throw new Error('Не удалось подготовить задания для PDF.');
    const [JsPDF, font] = await Promise.all([loadLibrary(), loadFont()]);
    const doc = new JsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true, putOnlyUsedFonts: true });
    doc.addFileToVFS('WorkbookSans.ttf', font);
    doc.addFont('WorkbookSans.ttf', 'WorkbookSans', 'normal');
    doc.setFont('WorkbookSans', 'normal');

    const left = 18;
    const right = 192;
    const bottom = 278;
    const lineHeight = 5.5;
    const promptX = 27;
    const answerX = 110;
    const promptWidth = 77;
    const answerWidth = right - answerX;
    let y = 20;

    function setText(size, color) {
      doc.setFontSize(size);
      doc.setTextColor(...color);
    }

    function lines(value, width) {
      const source = textValue(value);
      if (!source) return [];
      return source.split('\n').flatMap(part => part ? doc.splitTextToSize(part, width) : ['']);
    }

    function newPage() {
      doc.addPage();
      y = 20;
    }

    function writeWrapped(value, width, size, color, gapAfter = 0) {
      setText(size, color);
      const wrapped = lines(value, width);
      for (const line of wrapped) {
        if (y + lineHeight > bottom) newPage();
        doc.text(line, left, y);
        y += lineHeight;
      }
      y += gapAfter;
    }

    function sectionHeader(section, continued) {
      if (y + 23 > bottom) newPage();
      const heading = textValue(section.title) + (continued ? ' (продолжение)' : '');
      writeWrapped(heading, right - left, 13, [48, 50, 83], 2);
      if (!continued && section.instructions) {
        writeWrapped(section.instructions, right - left, 9, [103, 102, 116], 2);
      }
      if (y + 13 > bottom) newPage();
      setText(8, [117, 115, 130]);
      doc.text(lines('Слово или транскрипция', promptWidth), promptX, y);
      doc.text(lines('Ваш ответ', answerWidth), answerX, y);
      y += 3;
      doc.setDrawColor(222, 220, 228);
      doc.line(left, y, right, y);
      y += 6;
    }

    function writeRow(row, index, section) {
      setText(10, [42, 43, 57]);
      const promptLines = lines(row.prompt, promptWidth);
      const hintLines = lines(row.hint, promptWidth);
      const answerLines = lines(row.answer, answerWidth);
      const promptContent = promptLines.map(line => ({ line, hint: false }))
        .concat(hintLines.map(line => ({ line, hint: true })));
      const totalLines = Math.max(promptContent.length, answerLines.length, 1);
      let offset = 0;

      while (offset < totalLines) {
        if (y + lineHeight > bottom) {
          newPage();
          sectionHeader(section, true);
        }
        const fit = Math.max(1, Math.floor((bottom - y) / lineHeight));
        const end = Math.min(totalLines, offset + fit);
        if (offset === 0) {
          setText(9, [139, 136, 150]);
          doc.text(String(index + 1) + '.', left, y);
        }
        for (let lineIndex = offset; lineIndex < end; lineIndex++) {
          const baseline = y + (lineIndex - offset) * lineHeight;
          const prompt = promptContent[lineIndex];
          if (prompt) {
            setText(prompt.hint ? 8 : 10, prompt.hint ? [118, 115, 128] : [42, 43, 57]);
            doc.text(prompt.line, promptX, baseline);
          }
          if (answerLines[lineIndex] !== undefined) {
            setText(10, [42, 43, 57]);
            doc.text(answerLines[lineIndex], answerX, baseline);
          }
        }
        if (!answerLines.length && offset === 0) {
          doc.setDrawColor(191, 189, 198);
          doc.line(answerX, y + 1, right, y + 1);
        }
        y += (end - offset) * lineHeight;
        offset = end;
        if (offset < totalLines) {
          newPage();
          sectionHeader(section, true);
        }
      }
      doc.setDrawColor(235, 233, 237);
      doc.line(left, y - 3, right, y - 3);
      y += 2;
    }

    writeWrapped(title || 'Ответы к упражнениям', right - left, 18, [36, 38, 59], 2);
    if (subtitle) writeWrapped(subtitle, right - left, 9, [117, 115, 130], 4);
    else y += 4;
    for (const section of sections) {
      if (y + 27 > bottom) newPage();
      sectionHeader(section, false);
      (Array.isArray(section.rows) ? section.rows : []).forEach((row, index) => writeRow(row, index, section));
      y += 8;
    }

    const pageCount = doc.getNumberOfPages();
    for (let pageNumber = 1; pageNumber <= pageCount; pageNumber++) {
      doc.setPage(pageNumber);
      setText(8, [139, 136, 150]);
      doc.text(`${pageNumber} / ${pageCount}`, right, 288, { align: 'right' });
    }

    await doc.save(textValue(filename) || 'english-responses.pdf', { returnPromise: true });
  }

  globalThis.downloadWorksheetResponses = downloadWorksheetResponses;
})();
