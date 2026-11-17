(() => {
  'use strict';

  const menu = document.querySelector('.site-menu-toggle');
  if (!menu) return;
  const header = menu.closest('.site-header');
  const navigation = document.getElementById(menu.getAttribute('aria-controls'));
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
  document.addEventListener('pointerdown', event => {
    if (!header.contains(event.target)) setOpen(false);
  });
  narrow.addEventListener('change', () => {
    if (narrow.matches && navigation.contains(document.activeElement)) menu.focus();
    if (!narrow.matches && document.activeElement === menu) navigation.querySelector('a').focus();
    setOpen(false);
  });
  menu.hidden = false;
})();
