interface CellLike {
  text?: unknown;
  value?: unknown;
}

function scalarText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return String(value).trim();
  if (value instanceof Date) return value.toISOString();
  if (typeof value !== 'object') return '';

  const record = value as Record<string, unknown>;
  if (typeof record.text === 'string') return record.text.trim();
  if ('result' in record) return scalarText(record.result);
  if (Array.isArray(record.richText)) {
    return record.richText
      .map((part) => scalarText(part))
      .filter(Boolean)
      .join(' ')
      .trim();
  }
  return '';
}

/** Returns useful displayed/scalar text without serialising ExcelJS value objects as "[object Object]". */
export function cellText(cell: CellLike): string {
  const valueText = scalarText(cell.value);
  if (valueText) return valueText;
  const renderedText = scalarText(cell.text);
  return renderedText === '[object Object]' ? '' : renderedText;
}
