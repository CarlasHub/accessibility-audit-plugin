export type FindingClassification = 'confirmed' | 'review' | 'manual' | 'blocker';
export type Severity = 'Critical' | 'Serious' | 'Moderate' | 'Minor' | 'Advisory';
export type AuditStatus = 'completed' | 'cancelled';
export type WcagConformanceLevel = 'AA' | 'AAA';
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
  /** Stable report identity shared by JSON, HTML, XLSX, and WCAG criterion links. */
  id?: string;
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
  any?: AxeCheckResult[];
  all?: AxeCheckResult[];
  none?: AxeCheckResult[];
}

export interface AxeRelatedNode {
  html: string;
  target: string[];
}

export interface AxeCheckResult {
  id: string;
  data?: unknown;
  relatedNodes?: AxeRelatedNode[];
  impact?: string | null;
  message?: string;
}

export interface AxeViolationResult {
  id: string;
  resultType?: 'violation' | 'incomplete';
  impact: string | null;
  tags: string[];
  description: string;
  help: string;
  helpUrl: string;
  nodes: AxeNodeResult[];
}

export interface AxeRunMetadata {
  completed: boolean;
  error?: string;
  violationCount: number;
  incompleteCount: number;
  passCount: number;
  passes: Array<{ id: string; tags: string[]; nodeCount: number }>;
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
  smallTargets: Array<{
    selector: string;
    name: string;
    width: number;
    height: number;
    groupSelector: string;
    inlineException: boolean;
    /** True only when the target was inside the viewport and passed elementFromPoint hit testing. */
    hitTested: boolean;
    spacingRisk: boolean;
    axeTargetSizeSignal?: boolean;
    nearbyTargets: Array<{
      selector: string;
      name: string;
      width: number;
      height: number;
      centerDistance: number;
    }>;
  }>;
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
    outsideViewport: boolean;
    componentSelector?: string;
    modalSelector?: string;
    }>;
  repeatedAt?: number;
  completedCycle: boolean;
  truncated: boolean;
  scope: 'document' | 'modal-only' | 'unknown';
  modalSelector?: string;
  journeys: KeyboardJourneyResult[];
}

export type AuditJourneyCategory = 'keyboard' | 'forms' | 'interaction' | 'dynamic-content';

export type AuditJourneyStep =
  | { action: 'focus'; selector: string }
  | { action: 'press'; key: string; selector?: string }
  | { action: 'type'; selector: string; text: string }
  | { action: 'wait'; milliseconds: number }
  | {
      action: 'assert';
      expectation:
        | 'focused'
        | 'visible'
        | 'hidden'
        | 'expanded'
        | 'collapsed'
        | 'pressed'
        | 'unpressed'
        | 'selected'
        | 'checked'
        | 'unchecked'
        | 'invalid'
        | 'valid'
        | 'url-contains'
        | 'text-contains'
        | 'value-equals'
        | 'live-region-updated';
      selector?: string;
      value?: string;
      timeoutMs?: number;
    };

/** A repeatable, site-specific keyboard task executed against matching pages and viewports. */
export interface AuditJourneyDefinition {
  id: string;
  title: string;
  categories: AuditJourneyCategory[];
  /** A case-sensitive substring of the requested URL. Omit to run on every requested page. */
  urlIncludes?: string;
  /** Viewport names on which to run the journey. Omit to run on every configured viewport. */
  viewports?: string[];
  steps: AuditJourneyStep[];
}

export interface KeyboardJourneyResult {
  id: string;
  title: string;
  status: 'passed' | 'failed' | 'not-applicable' | 'inconclusive';
  steps: string[];
  detail: string;
  source?: 'built-in' | 'configured';
  categories?: AuditJourneyCategory[];
  assertionCount?: number;
  selectors?: string[];
}

export interface ResponsiveCheckResult {
  /** True only after the default, 200% text-resize, and WCAG text-spacing phases all completed. */
  completed?: boolean;
  horizontalOverflow: number;
  overflowElements: Array<{ selector: string; right: number; width: number }>;
  textSpacingOverflow: number;
  /** Root-font 200% stress-test overflow. This is evidence, not a substitute for browser zoom review. */
  textResizeOverflow?: number;
  clippedElements: Array<{
    selector: string;
    axis: 'horizontal' | 'vertical' | 'both';
    phase: 'default' | 'text-resize-200' | 'text-spacing';
    clientWidth: number;
    clientHeight: number;
    scrollWidth: number;
    scrollHeight: number;
  }>;
  overlapPairs: Array<{
    firstSelector: string;
    secondSelector: string;
    phase: 'default' | 'text-resize-200' | 'text-spacing';
    overlapWidth: number;
    overlapHeight: number;
  }>;
  lostInteractiveElements: Array<{ selector: string; name: string }>;
  textResizeLostInteractiveElements?: Array<{ selector: string; name: string }>;
}

export interface DisclosureCheckResult {
  selector: string;
  name: string;
  controls: string | null;
  initialExpanded?: string | null;
  baselinePrepared?: boolean;
  activationTargetVerified?: boolean;
  enterTargetVerified?: boolean;
  enterTestCompleted?: boolean;
  enterSettled?: boolean;
  enterSettleMs?: number;
  beforeExpanded: string | null;
  afterExpanded: string | null;
  controlledVisibleBefore: boolean | null;
  controlledVisibleAfterOpen: boolean | null;
  spaceAfterExpanded?: string | null;
  controlledVisibleAfterSpace?: boolean | null;
  spaceTestCompleted?: boolean;
  spaceTargetVerified?: boolean;
  spaceSettled?: boolean;
  spaceSettleMs?: number;
  initialState?: DisclosureStateSnapshot;
  beforeState?: DisclosureStateSnapshot;
  afterEnterState?: DisclosureStateSnapshot;
  afterSpaceState?: DisclosureStateSnapshot;
  firstTabSelector: string | null;
  tabEnteredControlledRegion: boolean | null;
  restorationError?: string;
  error?: string;
}

export interface DisclosureStateSnapshot {
  selector: string;
  name: string;
  tagName: string;
  role: string;
  expanded: string | null;
  controls: string | null;
  controlMatchCount: number;
  controlledMatchCount: number;
  controlledVisible: boolean | null;
  controlledExposed: boolean | null;
  rendered: boolean;
  topmost: boolean;
  focused: boolean;
  runningAnimations: number;
}

export interface InteractionBlocker {
  selector: string;
  role: string;
  name: string;
  reason: string;
}

export type CoverageStatus =
  | 'confirmed-passed'
  | 'confirmed-failed'
  | 'tested-inconclusive'
  | 'manual-review-required'
  | 'not-tested'
  | 'not-applicable';

export type CoverageArea =
  | 'viewport-render'
  | 'keyboard-only'
  | 'focus-order-and-visibility'
  | 'names-roles-states-relationships'
  | 'structure-headings-landmarks'
  | 'navigation-and-bypass'
  | 'links-and-buttons'
  | 'images-and-alternatives'
  | 'forms-errors-and-validation'
  | 'interactive-components'
  | 'dynamic-content-and-status'
  | 'zoom-text-spacing-and-responsive'
  | 'contrast-and-non-colour-cues'
  | 'motion-autoplay-and-controls'
  | 'language-and-language-changes'
  | 'page-title'
  | 'broken-or-misleading-links'
  | 'automated-axe'
  | 'manual-assessment';

export interface CoverageAssessment {
  area: CoverageArea;
  status: CoverageStatus;
  detail: string;
}

export interface PageCoverage {
  url: string;
  viewports: Array<{
    viewport: string;
    assessments: CoverageAssessment[];
  }>;
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

export interface LinkCheckMetadata {
  completed: boolean;
  candidateCount: number;
  checkedCount: number;
  truncated: boolean;
  scope: 'desktop-same-origin' | 'not-applicable' | 'blocked';
  error?: string;
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
  axeRun: AxeRunMetadata;
  dom: DomCheckResult;
  keyboard: KeyboardCheckResult;
  responsive: ResponsiveCheckResult;
  disclosures: DisclosureCheckResult[];
  tabs: TabCheckResult[];
  links: LinkCheckResult[];
  linkRun: LinkCheckMetadata;
  consent: ConsentHandlingResult;
  interactionBlocker: InteractionBlocker | null;
  elementContexts: ElementContext[];
  screenshot: string;
  elementScreenshots: ElementScreenshot[];
  errors: string[];
  cancelled?: boolean;
  partial?: boolean;
}

export interface PageAudit {
  url: string;
  viewports: ViewportAudit[];
  partial?: boolean;
}

export interface ManualCheck {
  id: string;
  classification: 'manual';
  title: string;
  wcag: string[];
  procedure: string;
  applicableTo: string;
  expectedEvidence?: string;
}

export type WcagCriterionStatus = 'passed' | 'failed' | 'manual-review-required' | 'not-applicable' | 'inconclusive';

export interface WcagCriterionAssessment {
  criterion: string;
  level: 'A' | 'AA' | 'AAA';
  title: string;
  understandingUrl: string;
  scope: 'standard' | 'advisory';
  status: WcagCriterionStatus;
  findingIds: string[];
  automatedEvidence: string[];
  detail: string;
}

export interface AuditSummary {
  status: AuditStatus;
  cancelledAt?: string;
  generatedAt: string;
  auditor: string;
  source: string;
  wcagLevel: WcagConformanceLevel;
  conformanceTarget?: 'AA';
  aaaAdvisory?: boolean;
  humanAssessmentRequired?: boolean;
  conformanceDecision?: 'not-determined';
  landingPageUrl: string;
  requestedUrls: string[];
  auditedUrls: string[];
  skippedUrls: Array<{ url: string; reason: string }>;
  pages: PageAudit[];
  coverage: PageCoverage[];
  criteria?: WcagCriterionAssessment[];
  findings: Finding[];
  manualChecks: ManualCheck[];
  limitations: string[];
}

export interface AuditOptions {
  auditor: string;
  wcagLevel: WcagConformanceLevel;
  aaaAdvisory?: boolean;
  outputDir: string;
  landingPageUrl?: string;
  allowedHosts: string[];
  stagingOnly: boolean;
  headless: boolean;
  autoInstallBrowser: boolean;
  channel?: string;
  executablePath?: string;
  timeoutMs: number;
  maxTabStops: number;
  maxLinksPerPage: number;
  concurrency: number;
  captureScreenshots: boolean;
  viewports: ViewportDefinition[];
  journeys: AuditJourneyDefinition[];
}
