(() => {
  'use strict';

  const menu = document.querySelector('.site-menu-toggle');
  if (!menu) return;
  const header = menu.closest('.site-header');
  const navigation = document.getElementById(menu.getAttribute('aria-controls'));
  const learning = navigation.querySelector('.nav-learning');
  const learningToggle = learning.querySelector('summary');
  const narrow = matchMedia('(max-width: 880px)');

  function closeMenu() {
    menu.setAttribute('aria-expanded', 'false');
    learning.open = false;
  }

  menu.addEventListener('click', () => {
    const open = menu.getAttribute('aria-expanded') === 'false';
    menu.setAttribute('aria-expanded', String(open));
    learning.open = open;
  });

  header.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    if (narrow.matches && menu.getAttribute('aria-expanded') === 'true') {
      closeMenu();
      menu.focus();
      event.preventDefault();
    } else if (learning.open) {
      learning.open = false;
      learningToggle.focus();
      event.preventDefault();
    }
  });

  header.addEventListener('focusout', event => {
    if (!event.relatedTarget) return;
    if (!header.contains(event.relatedTarget)) closeMenu();
    else if (!narrow.matches && !learning.contains(event.relatedTarget)) learning.open = false;
  });

  document.addEventListener('pointerdown', event => {
    if (!header.contains(event.target)) closeMenu();
    else if (!narrow.matches && !learning.contains(event.target)) learning.open = false;
  });

  narrow.addEventListener('change', () => {
    if (narrow.matches && navigation.contains(document.activeElement)) menu.focus();
    if (!narrow.matches && document.activeElement === menu) navigation.querySelector('a').focus();
    closeMenu();
  });
  menu.hidden = false;
})();
