import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { AuditConfigInput } from './config.js';
import type { AuditExecutionContext, AuditProgressEvent, AuditStatus } from './types.js';
import { resolveOptions } from './config.js';
import { runAudit } from './audit/runner.js';
import { writeExcelReport } from './reporting/excel.js';
import { collectUrls } from './urls.js';
import { DEFAULT_REPORT_NAME } from './instructions.js';
import { validateExcelReport, type WorkbookValidation } from './reporting/validate.js';
import { createAuditArchive } from './reporting/archive.js';

export interface AuditRequest {
  inputs: string[];
  options?: Partial<AuditConfigInput>;
  templatePath?: string;
  reportName?: string;
  execution?: AuditExecutionContext;
}

export interface AuditRunResult {
  status: AuditStatus;
  reportPath: string;
  jsonPath: string;
  archivePath: string;
  requestedPageCount: number;
  auditedPageCount: number;
  skippedPageCount: number;
  completedPageCount: number;
  partialPageCount: number;
  notStartedPageCount: number;
  confirmedCount: number;
  blockerCount: number;
  reviewCount: number;
  manualCheckCount: number;
  imageInventoryCount: number;
  validation: WorkbookValidation;
}

function cleanReportName(value: string): string {
  const name = value.trim().replace(/[\\/:*?"<>|]/g, '-');
  return name.toLowerCase().endsWith('.xlsx') ? name : `${name}.xlsx`;
}

function outputArtifactPath(directory: string, filename: string): string {
  return resolve(directory, filename);
}

async function emitProgress(execution: AuditExecutionContext, event: AuditProgressEvent): Promise<void> {
  try {
    await execution.onProgress?.(event);
  } catch {
    // Progress display failures must not invalidate audit evidence or reporting.
  }
}

export async function executeAudit(request: AuditRequest): Promise<AuditRunResult> {
  if (!request.inputs.length) throw new Error('At least one URL or input file is required.');
  const execution = request.execution ?? {};
  const options = resolveOptions(request.options ?? {});
  await emitProgress(execution, { phase: 'preparing', message: `Preparing audit output in ${options.outputDir}.` });
  await mkdir(options.outputDir, { recursive: true });
  await emitProgress(execution, { phase: 'targets', message: 'Reading and validating the authorized page targets.' });
  const collected = await collectUrls(request.inputs, {
    allowedHosts: options.allowedHosts,
    stagingOnly: options.stagingOnly
  });
  await emitProgress(execution, {
    phase: 'targets',
    message: `Resolved ${collected.urls.length} page${collected.urls.length === 1 ? '' : 's'} for testing.`,
    current: collected.urls.length,
    total: collected.urls.length
  });
  const summary = await runAudit(collected.urls, collected.source, collected.skipped, options, execution);
  const reportName = cleanReportName(request.reportName ?? DEFAULT_REPORT_NAME);
  const reportPath = outputArtifactPath(options.outputDir, reportName);
  const jsonPath = outputArtifactPath(options.outputDir, 'audit-results.json');
  const applyLateCancellation = async (): Promise<boolean> => {
    if (!execution.signal?.aborted || summary.status === 'cancelled') return false;
    const cancelledAt = new Date().toISOString();
    summary.status = 'cancelled';
    summary.cancelledAt = cancelledAt;
    summary.limitations.push('The audit was stopped by the user. Results include only work completed before cancellation.');
    await writeFile(jsonPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
    return true;
  };
  await applyLateCancellation();
  await emitProgress(execution, {
    phase: 'reporting',
    message: `${summary.status === 'cancelled' ? 'Writing partial' : 'Writing'} Excel report to ${reportPath}.`
  });
  await writeExcelReport(summary, {
    outputPath: reportPath,
    ...(request.templatePath ? { templatePath: resolve(request.templatePath) } : {})
  });
  if (await applyLateCancellation()) {
    await writeExcelReport(summary, {
      outputPath: reportPath,
      ...(request.templatePath ? { templatePath: resolve(request.templatePath) } : {})
    });
  }
  await emitProgress(execution, { phase: 'validation', message: `Validating the generated workbook at ${reportPath}.` });
  let validation = await validateExcelReport(reportPath);
  if (await applyLateCancellation()) {
    await writeExcelReport(summary, {
      outputPath: reportPath,
      ...(request.templatePath ? { templatePath: resolve(request.templatePath) } : {})
    });
    validation = await validateExcelReport(reportPath);
  }
  if (!validation.valid) {
    throw new Error(`Generated workbook validation failed at ${reportPath}: ${validation.errors.join(' ')}`);
  }
  await emitProgress(execution, {
    phase: 'reporting',
    message: 'Packaging the workbook, JSON evidence, and linked screenshots as a portable ZIP archive.'
  });
  const archivePath = await createAuditArchive(options.outputDir, reportPath, jsonPath);
  const completedPageCount = summary.pages.filter((page) =>
    page.viewports.length === options.viewports.length &&
    page.viewports.every((viewport) => (
      !viewport.cancelled
      && !viewport.interactionBlocker
      && viewport.axeRun.completed
    ))
  ).length;
  const notStartedPageCount = Math.max(0, collected.urls.length - summary.pages.length);
  const partialPageCount = Math.max(0, collected.urls.length - completedPageCount - notStartedPageCount);
  const result: AuditRunResult = {
    status: summary.status,
    reportPath,
    jsonPath,
    archivePath,
    requestedPageCount: collected.urls.length,
    auditedPageCount: summary.auditedUrls.length,
    skippedPageCount: summary.skippedUrls.length,
    completedPageCount,
    partialPageCount,
    notStartedPageCount,
    confirmedCount: summary.findings.filter((finding) => finding.classification === 'confirmed').length,
    blockerCount: summary.findings.filter((finding) => finding.classification === 'blocker').length,
    reviewCount: summary.findings.filter((finding) => finding.classification === 'review').length,
    manualCheckCount: summary.manualChecks.length,
    imageInventoryCount: validation.imageInventoryRows,
    validation
  };
  await emitProgress(execution, {
    phase: summary.status === 'cancelled' ? 'cancelled' : 'completed',
    message: summary.status === 'cancelled'
      ? `Stopped safely. Partial Excel and JSON output is in ${options.outputDir}; the portable ZIP is ${archivePath}.`
      : `Audit completed. Excel, JSON, and linked screenshots are in ${options.outputDir}; the portable ZIP is ${archivePath}.`
  });
  return result;
}
