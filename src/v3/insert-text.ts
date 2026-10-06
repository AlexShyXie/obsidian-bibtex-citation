export const getCitationInsertText = (prefixText: string, key: string): string => {
  const prefix = String(prefixText || '');
  const open = prefix.lastIndexOf('[');
  if (open > prefix.lastIndexOf(']')) {
    return `@${key}`;
  }
  return `[@${key}]`;
};
