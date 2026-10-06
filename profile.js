import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('./public/assets/avatar-preview-catalog.js', import.meta.url), 'utf8');
const catalog = JSON.parse(source.slice(source.indexOf(' = ') + 3).trim().replace(/;$/, ''));

export function validFinalAvatar(avatar) {
  if (!avatar || avatar.release !== catalog.release || !avatar.selection || typeof avatar.selection !== 'object') return false;
  const layers = catalog.layers.filter(layer => layer.selectable);
  return Object.keys(avatar.selection).length === layers.length && layers.every(layer =>
    catalog.assets.some(asset => asset.layer === layer.id && asset.id === avatar.selection[layer.id]));
}
