export type FindingClassification = 'confirmed' | 'review' | 'manual' | 'blocker';
export type Severity = 'Critical' | 'Serious' | 'Moderate' | 'Minor' | 'Advisory';
export type AuditStatus = 'completed' | 'cancelled';
export type AuditProgressPhase =
  | 'preparing'
  | 'targets'
  | 'browser'
  | 'reporting'
  | 'validation'
  | 'completed'
  | 'cancelled';

export interface AuditProgressEvent {
  phase: AuditProgressPhase;
  message: string;
  current?: number;
  total?: number;
  url?: string;
  viewport?: string;
}

export interface AuditExecutionContext {
  signal?: AbortSignal;
  onProgress?: (event: AuditProgressEvent) => void | Promise<void>;
}

export interface ViewportDefinition {
  name: string;
  width: number;
  height: number;
  isMobile?: boolean;
}

export interface EvidenceItem {
  kind: 'axe' | 'dom' | 'keyboard' | 'responsive' | 'network' | 'manual';
  pageUrl: string;
  viewport?: string;
  selector?: string;
  detail: string;
  screenshot?: string;
}

export interface ElementContext {
  selector: string;
  tagName: string;
  role: string;
  accessibleName: string;
  visibleText: string;
  componentName: string;
  location: string;
  captureSelector: string;
}

export interface ConsentHandlingResult {
  found: boolean;
  dismissed: boolean;
  action: 'reject' | 'necessary' | 'accept' | 'none';
  buttonName: string;
  surfaceSelector: string;
  frameUrl: string;
  error?: string;
}

export interface Finding {
  key: string;
  ruleId: string;
  classification: FindingClassification;
  severity: Severity;
  wcag: string[];
  summary: string;
  issue: string;
  impact: string;
  testing: string;
  remediation: string;
  component: string;
  /** Human-readable rendered component name used in reports. */
  componentName?: string;
  /** Human-readable page region or section used to locate the component. */
  componentLocation?: string;
  /**
   * Stable evidence-backed identity for a reusable component implementation.
   * Findings without this value are consolidated only within the same page.
   */
  sharedComponentKey?: string;
  urls: string[];
  viewports: string[];
  selectors: string[];
  evidence: EvidenceItem[];
  assignment: 'Development' | 'Design' | 'Content' | 'QA' | 'Mixed';
  effort: 'Small' | 'Medium' | 'Large' | 'Review';
  translationRequired: 'Yes' | 'No' | 'Review';
}

export interface AxeNodeResult {
  html: string;
  target: string[];
  failureSummary?: string;
}

export interface AxeViolationResult {
  id: string;
  impact: string | null;
  tags: string[];
  description: string;
  help: string;
  helpUrl: string;
  nodes: AxeNodeResult[];
}

export interface DomCheckResult {
  h1Count: number;
  mainCount: number;
  unnamedLandmarks: Array<{ selector: string; role: string }>;
  missingAltImages: Array<{ selector: string; html: string }>;
  linkedImagesForReview: Array<{ selector: string; name: string; alt: string; href: string; reason: string }>;
  emptyLinks: Array<{ selector: string; html: string; href: string }>;
  emptyNamedControls: Array<{ selector: string; tag: string; html: string }>;
  unlabeledFields: Array<{ selector: string; html: string }>;
  duplicateIds: Array<{ id: string; count: number }>;
  smallTargets: Array<{ selector: string; name: string; width: number; height: number }>;
  tablesForReview: Array<{ selector: string; reason: string }>;
  autoplayMedia: Array<{ selector: string; tag: string }>;
}

export interface KeyboardCheckResult {
  sequence: Array<{
    index: number;
    selector: string;
    name: string;
    role: string;
    visibleIndicator: boolean;
    obscured: boolean;
  }>;
  repeatedAt?: number;
}

export interface ResponsiveCheckResult {
  horizontalOverflow: number;
  overflowElements: Array<{ selector: string; right: number; width: number }>;
  textSpacingOverflow: number;
}

export interface DisclosureCheckResult {
  selector: string;
  name: string;
  controls: string | null;
  beforeExpanded: string | null;
  afterExpanded: string | null;
  controlledVisibleAfterOpen: boolean | null;
  firstTabSelector: string | null;
  tabEnteredControlledRegion: boolean | null;
  escapeClosed: boolean;
  focusReturned: boolean;
  error?: string;
}

export interface TabCheckResult {
  selector: string;
  name: string;
  tabCount: number;
  selectedCount: number;
  tabbableCount: number;
  navigationKey: 'ArrowRight' | 'ArrowDown';
  navigationMovedToTab: boolean;
  activationWorked: boolean;
  homeMovedToFirst: boolean;
  endMovedToLast: boolean;
  structuralFailures: string[];
  structuralReviews: string[];
  error?: string;
}

export interface LinkCheckResult {
  selector: string;
  name: string;
  href: string;
  status: number | null;
  finalUrl?: string;
  classification: 'confirmed' | 'review';
  reason: string;
}

export interface ElementScreenshot {
  selector: string;
  path: string;
}

export interface ViewportAudit {
  viewport: ViewportDefinition;
  url: string;
  finalUrl: string;
  status: number | null;
  title: string;
  axe: AxeViolationResult[];
  dom: DomCheckResult;
  keyboard: KeyboardCheckResult;
  responsive: ResponsiveCheckResult;
  disclosures: DisclosureCheckResult[];
  tabs: TabCheckResult[];
  links: LinkCheckResult[];
  consent: ConsentHandlingResult;
  elementContexts: ElementContext[];
  screenshot: string;
  elementScreenshots: ElementScreenshot[];
  errors: string[];
  cancelled?: boolean;
}

export interface PageAudit {
  url: string;
  viewports: ViewportAudit[];
}

export interface ManualCheck {
  id: string;
  title: string;
  wcag: string[];
  procedure: string;
  applicableTo: string;
}

export interface AuditSummary {
  status: AuditStatus;
  cancelledAt?: string;
  generatedAt: string;
  auditor: string;
  source: string;
  landingPageUrl: string;
  requestedUrls: string[];
  auditedUrls: string[];
  skippedUrls: Array<{ url: string; reason: string }>;
  pages: PageAudit[];
  findings: Finding[];
  manualChecks: ManualCheck[];
  limitations: string[];
}

export interface AuditOptions {
  auditor: string;
  outputDir: string;
  landingPageUrl?: string;
  allowedHosts: string[];
  stagingOnly: boolean;
  headless: boolean;
  channel?: string;
  executablePath?: string;
  timeoutMs: number;
  maxTabStops: number;
  maxLinksPerPage: number;
  concurrency: number;
  captureScreenshots: boolean;
  viewports: ViewportDefinition[];
}
