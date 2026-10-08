(() => {
  'use strict';
  const canvas = document.querySelector('#host-pixel-canvas');
  const pane = document.querySelector('#host-pixel-view');
  const buttons = [...document.querySelectorAll('button[data-planet-mode]')];
  const renderer = window.HerstoryPixelRenderer;
  let pixel = null;
  function updateVisibility() {
    pane.hidden = document.body.dataset.tab !== 'mine' || document.body.dataset.planetMode !== '2d';
  }
  function applySnapshot(snapshot) {
    window.HerstoryIdentity.assertUser(snapshot);
    if (!snapshot.pixelPlanet) return;
    const next = renderer.validateState(snapshot.pixelPlanet);
    if (next.paletteId !== snapshot.paletteId) throw Error('2D/3D palette mismatch');
    const frame = renderer.renderFrame(next, { width: 240, height: 320 });
    canvas.getContext('2d').putImageData(new ImageData(frame.rgba, frame.width, frame.height), 0, 0);
    pixel = structuredClone(next);
  }
  for (const button of buttons) button.onclick = () => {
    document.body.dataset.planetMode = button.dataset.planetMode;
    for (const candidate of buttons) candidate.setAttribute('aria-pressed', String(candidate === button));
    updateVisibility();
    if (button.dataset.planetMode === '3d') window.dispatchEvent(new Event('resize'));
  };
  window.HerstoryPixelDisplay = { applySnapshot, updateVisibility, getState: () => pixel && structuredClone(pixel) };
})();
