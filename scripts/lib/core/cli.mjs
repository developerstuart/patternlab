export const getArgValue = (argv, name) => {
  const index = argv.indexOf(name);
  if (index < 0) return null;
  return argv[index + 1] ?? null;
};

export const hasArg = (argv, name) => argv.includes(name);
