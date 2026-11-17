import { practiceUrl, readGrammarCatalog } from './grammar-data.js';
import { createGrammarStore } from './grammar-storage.js';

const title = document.getElementById('page-title');
const intro = document.getElementById('grammar-intro');
const navigation = document.getElementById('grammar-nav');
const status = document.getElementById('grammar-status');
const grid = document.getElementById('grammar-catalog');
const startPractice = document.getElementById('catalog-practice');
const plurals = new Intl.PluralRules('ru');
const number = new Intl.NumberFormat('ru');
const countNouns = { one: 'задание', few: 'задания', many: 'заданий', other: 'задания' };

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function categoryUrl(categoryId) {
  return `grammar.html?category=${encodeURIComponent(categoryId)}`;
}

function link(href, text, lang = 'en') {
  const anchor = element('a', null, text);
  anchor.href = href;
  anchor.lang = lang;
  return anchor;
}

function categoryCard(category) {
  const card = element('article', 'grammar-card');
  const heading = element('h2');
  const href = categoryUrl(category.id);
  const categoryLink = link(href, category.title);
  categoryLink.setAttribute('aria-label', `Категория ${category.title}`);
  heading.append(categoryLink);
  const topics = element('ul', 'grammar-topic-links');
  for (const topic of category.topics) {
    const item = element('li');
    item.append(link(`${href}#${encodeURIComponent(topic.id)}`, topic.title));
    topics.append(item);
  }
  card.append(heading, element('p', 'grammar-description', category.description), topics);
  return card;
}

function topicCard(topic, latest) {
  const card = element('article', 'grammar-card');
  card.id = topic.id;
  card.tabIndex = -1;
  const heading = element('h2', null, topic.title);
  heading.lang = 'en';
  const count = `${number.format(topic.count)} ${countNouns[plurals.select(topic.count)]}`;
  card.append(heading, element('p', 'grammar-description', topic.description),
    element('p', 'grammar-count', count));
  if (latest) {
    const review = latest.review ? ` На сверку — ${latest.review}.` : '';
    card.append(element('p', 'grammar-description', `В последней попытке верно ${latest.correct} из ${latest.total}.${review}`));
  }
  if (topic.count > 0) {
    const start = link(practiceUrl({ topics: [topic.id] }), 'Начать тренировку', 'ru');
    start.className = 'button button-secondary';
    start.setAttribute('aria-label', `Начать тренировку по теме ${topic.title}`);
    card.append(start);
  }
  return card;
}

function showCategory(category, categories) {
  title.textContent = category.title;
  title.lang = 'en';
  intro.textContent = category.description;
  document.title = `${category.title} · Грамматика · Миролюбова Анастасия`;

  const links = categories.map(item => {
    const anchor = link(categoryUrl(item.id), item.title);
    if (item.id === category.id) anchor.setAttribute('aria-current', 'page');
    return anchor;
  });
  navigation.replaceChildren(link('grammar.html', 'Все категории', 'ru'), ...links);
  navigation.hidden = false;
  grid.classList.add('grammar-grid-topics');
  const lastResults = new Map();
  for (const attempt of createGrammarStore().list()) {
    if (!attempt.result) continue;
    for (const [id, result] of Object.entries(attempt.result.byTopic)) {
      if (!lastResults.has(id) && Number.isInteger(result?.total) && Number.isInteger(result.correct)) {
        lastResults.set(id, result);
      }
    }
  }
  grid.replaceChildren(...category.topics.map(topic => topicCard(topic, lastResults.get(topic.id))));

  const target = category.topics.find(topic => location.hash === `#${encodeURIComponent(topic.id)}`);
  if (target) {
    const card = document.getElementById(target.id);
    card.focus({ preventScroll: true });
    card.scrollIntoView({ block: 'nearest' });
  }
}

async function openCatalog() {
  status.hidden = false;
  try {
    const categories = await readGrammarCatalog();

    const requested = new URLSearchParams(location.search).get('category');
    const category = categories.find(item => item.id === requested);
    if (category) showCategory(category, categories);
    else grid.replaceChildren(...categories.map(categoryCard));

    const available = (category?.topics ?? categories.flatMap(item => item.topics)).some(topic => topic.count > 0);
    startPractice.hidden = !available;
    if (category) {
      startPractice.href = practiceUrl({ topics: category.topics.filter(topic => topic.count > 0).map(topic => topic.id) });
    }
    if (requested !== null && !category) {
      status.textContent = 'Категория не найдена. Выберите её из списка ниже.';
    } else if (!available) {
      status.textContent = 'Задания появятся после добавления учебных материалов.';
    } else {
      status.hidden = true;
    }
  } catch {
    status.textContent = 'Не удалось загрузить каталог. Обновите страницу, чтобы попробовать ещё раз.';
  }
}

openCatalog();
