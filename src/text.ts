export function singleLineText(value: string, maxLength = Number.POSITIVE_INFINITY): string {
  const visible = Array.from(value, (character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint < 32 || (codePoint >= 127 && codePoint <= 159) ? ' ' : character;
  }).join('');
  return visible.replace(/\s+/g, ' ').trim().slice(0, maxLength);
}
