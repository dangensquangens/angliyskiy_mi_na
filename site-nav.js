(() => {
  'use strict';

  const menu = document.querySelector('.site-menu-toggle');
  const header = menu.closest('.site-header');
  const narrow = matchMedia('(max-width: 880px)');
  const setOpen = open => menu.setAttribute('aria-expanded', String(open));

  menu.addEventListener('click', () => setOpen(menu.getAttribute('aria-expanded') === 'false'));
  header.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || menu.getAttribute('aria-expanded') !== 'true') return;
    setOpen(false);
    menu.focus();
  });
  header.addEventListener('focusout', event => {
    if (event.relatedTarget && !header.contains(event.relatedTarget)) setOpen(false);
  });
  narrow.addEventListener('change', () => {
    if (narrow.matches && header.querySelector('.site-nav').contains(document.activeElement)) menu.focus();
    setOpen(false);
  });
  menu.hidden = false;
})();
