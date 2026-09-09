import { describe, expect, it } from 'vitest';
import { cleanReportName } from '../src/service.js';

describe('report filenames', () => {
  it('falls back to the public default when sanitizing removes the supplied name', () => {
    expect(cleanReportName(' ... ')).toBe('Accessibility_Audit_Report.xlsx');
  });

  it('removes path separators and control characters while retaining the workbook extension', () => {
    expect(cleanReportName('../team\u0000/report:final.XLSX')).toBe('team--report-final.XLSX');
  });
});
