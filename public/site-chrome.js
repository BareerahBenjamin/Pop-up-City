// Reserve the measured space of both fixed bars, including safe areas and wrapped text.
(() => {
  const root = document.documentElement;
  const header = document.querySelector('.site-chrome');
  const footer = document.querySelector('.festival-footer');
  if (!header || !footer) return;
  const measure = () => {
    const sidebar = matchMedia('(min-width: 1050px)').matches;
    root.style.setProperty('--site-header-height', `${sidebar ? 0 : Math.ceil(header.getBoundingClientRect().height)}px`);
    root.style.setProperty('--site-footer-height', '0px');
  };
  measure();
  const observer = new ResizeObserver(measure);
  observer.observe(header);
  observer.observe(footer);
  window.addEventListener('resize', measure);
})();
