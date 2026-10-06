// Reserve the measured space of both fixed bars, including safe areas and wrapped text.
(() => {
  const root = document.documentElement;
  const header = document.querySelector('.site-chrome');
  const footer = document.querySelector('.festival-footer');
  if (!header || !footer) return;
  const measure = () => {
    root.style.setProperty('--site-header-height', `${Math.ceil(header.getBoundingClientRect().height)}px`);
    root.style.setProperty('--site-footer-height', `${Math.ceil(footer.getBoundingClientRect().height)}px`);
  };
  measure();
  const observer = new ResizeObserver(measure);
  observer.observe(header);
  observer.observe(footer);
})();
