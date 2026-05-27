export const isObject = (value) =>
  value && typeof value === 'object' && !Array.isArray(value);

export const mergeDeep = (...objs) => {
  const result = {};
  for (const obj of objs) {
    if (!isObject(obj)) continue;
    for (const [key, value] of Object.entries(obj)) {
      if (isObject(value) && isObject(result[key])) {
        result[key] = mergeDeep(result[key], value);
      } else {
        result[key] = value;
      }
    }
  }
  return result;
};
