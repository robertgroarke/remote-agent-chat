'use strict';

function setBoundedMap(map, key, value, maxEntries = 64) {
  if (!(map instanceof Map)) throw new TypeError('map must be a Map');
  const limit = Math.max(1, Number(maxEntries) || 64);
  if (map.has(key)) map.delete(key);
  map.set(key, value);
  while (map.size > limit) map.delete(map.keys().next().value);
  return value;
}

module.exports = { setBoundedMap };
