import type {
  AuditSummary,
  Finding,
  ManualCheck,
  PageAudit,
  WcagCriterionAssessment
} from '../types.js';
import { findingId } from '../reporting/finding-id.js';

interface CriterionDefinition {
  criterion: string;
  level: 'A' | 'AA' | 'AAA';
  title: string;
  slug: string;
}

const definitions: CriterionDefinition[] = [
  ['1.1.1', 'A', 'Non-text Content', 'non-text-content'],
  ['1.2.1', 'A', 'Audio-only and Video-only (Prerecorded)', 'audio-only-and-video-only-prerecorded'],
  ['1.2.2', 'A', 'Captions (Prerecorded)', 'captions-prerecorded'],
  ['1.2.3', 'A', 'Audio Description or Media Alternative (Prerecorded)', 'audio-description-or-media-alternative-prerecorded'],
  ['1.2.4', 'AA', 'Captions (Live)', 'captions-live'],
  ['1.2.5', 'AA', 'Audio Description (Prerecorded)', 'audio-description-prerecorded'],
  ['1.2.6', 'AAA', 'Sign Language (Prerecorded)', 'sign-language-prerecorded'],
  ['1.2.7', 'AAA', 'Extended Audio Description (Prerecorded)', 'extended-audio-description-prerecorded'],
  ['1.2.8', 'AAA', 'Media Alternative (Prerecorded)', 'media-alternative-prerecorded'],
  ['1.2.9', 'AAA', 'Audio-only (Live)', 'audio-only-live'],
  ['1.3.1', 'A', 'Info and Relationships', 'info-and-relationships'],
  ['1.3.2', 'A', 'Meaningful Sequence', 'meaningful-sequence'],
  ['1.3.3', 'A', 'Sensory Characteristics', 'sensory-characteristics'],
  ['1.3.4', 'AA', 'Orientation', 'orientation'],
  ['1.3.5', 'AA', 'Identify Input Purpose', 'identify-input-purpose'],
  ['1.3.6', 'AAA', 'Identify Purpose', 'identify-purpose'],
  ['1.4.1', 'A', 'Use of Color', 'use-of-color'],
  ['1.4.2', 'A', 'Audio Control', 'audio-control'],
  ['1.4.3', 'AA', 'Contrast (Minimum)', 'contrast-minimum'],
  ['1.4.4', 'AA', 'Resize Text', 'resize-text'],
  ['1.4.5', 'AA', 'Images of Text', 'images-of-text'],
  ['1.4.6', 'AAA', 'Contrast (Enhanced)', 'contrast-enhanced'],
  ['1.4.7', 'AAA', 'Low or No Background Audio', 'low-or-no-background-audio'],
  ['1.4.8', 'AAA', 'Visual Presentation', 'visual-presentation'],
  ['1.4.9', 'AAA', 'Images of Text (No Exception)', 'images-of-text-no-exception'],
  ['1.4.10', 'AA', 'Reflow', 'reflow'],
  ['1.4.11', 'AA', 'Non-text Contrast', 'non-text-contrast'],
  ['1.4.12', 'AA', 'Text Spacing', 'text-spacing'],
  ['1.4.13', 'AA', 'Content on Hover or Focus', 'content-on-hover-or-focus'],
  ['2.1.1', 'A', 'Keyboard', 'keyboard'],
  ['2.1.2', 'A', 'No Keyboard Trap', 'no-keyboard-trap'],
  ['2.1.3', 'AAA', 'Keyboard (No Exception)', 'keyboard-no-exception'],
  ['2.1.4', 'A', 'Character Key Shortcuts', 'character-key-shortcuts'],
  ['2.2.1', 'A', 'Timing Adjustable', 'timing-adjustable'],
  ['2.2.2', 'A', 'Pause, Stop, Hide', 'pause-stop-hide'],
  ['2.2.3', 'AAA', 'No Timing', 'no-timing'],
  ['2.2.4', 'AAA', 'Interruptions', 'interruptions'],
  ['2.2.5', 'AAA', 'Re-authenticating', 're-authenticating'],
  ['2.2.6', 'AAA', 'Timeouts', 'timeouts'],
  ['2.3.1', 'A', 'Three Flashes or Below Threshold', 'three-flashes-or-below-threshold'],
  ['2.3.2', 'AAA', 'Three Flashes', 'three-flashes'],
  ['2.3.3', 'AAA', 'Animation from Interactions', 'animation-from-interactions'],
  ['2.4.1', 'A', 'Bypass Blocks', 'bypass-blocks'],
  ['2.4.2', 'A', 'Page Titled', 'page-titled'],
  ['2.4.3', 'A', 'Focus Order', 'focus-order'],
  ['2.4.4', 'A', 'Link Purpose (In Context)', 'link-purpose-in-context'],
  ['2.4.5', 'AA', 'Multiple Ways', 'multiple-ways'],
  ['2.4.6', 'AA', 'Headings and Labels', 'headings-and-labels'],
  ['2.4.7', 'AA', 'Focus Visible', 'focus-visible'],
  ['2.4.8', 'AAA', 'Location', 'location'],
  ['2.4.9', 'AAA', 'Link Purpose (Link Only)', 'link-purpose-link-only'],
  ['2.4.10', 'AAA', 'Section Headings', 'section-headings'],
  ['2.4.11', 'AA', 'Focus Not Obscured (Minimum)', 'focus-not-obscured-minimum'],
  ['2.4.12', 'AAA', 'Focus Not Obscured (Enhanced)', 'focus-not-obscured-enhanced'],
  ['2.4.13', 'AAA', 'Focus Appearance', 'focus-appearance'],
  ['2.5.1', 'A', 'Pointer Gestures', 'pointer-gestures'],
  ['2.5.2', 'A', 'Pointer Cancellation', 'pointer-cancellation'],
  ['2.5.3', 'A', 'Label in Name', 'label-in-name'],
  ['2.5.4', 'A', 'Motion Actuation', 'motion-actuation'],
  ['2.5.5', 'AAA', 'Target Size (Enhanced)', 'target-size-enhanced'],
  ['2.5.6', 'AAA', 'Concurrent Input Mechanisms', 'concurrent-input-mechanisms'],
  ['2.5.7', 'AA', 'Dragging Movements', 'dragging-movements'],
  ['2.5.8', 'AA', 'Target Size (Minimum)', 'target-size-minimum'],
  ['3.1.1', 'A', 'Language of Page', 'language-of-page'],
  ['3.1.2', 'AA', 'Language of Parts', 'language-of-parts'],
  ['3.1.3', 'AAA', 'Unusual Words', 'unusual-words'],
  ['3.1.4', 'AAA', 'Abbreviations', 'abbreviations'],
  ['3.1.5', 'AAA', 'Reading Level', 'reading-level'],
  ['3.1.6', 'AAA', 'Pronunciation', 'pronunciation'],
  ['3.2.1', 'A', 'On Focus', 'on-focus'],
  ['3.2.2', 'A', 'On Input', 'on-input'],
  ['3.2.3', 'AA', 'Consistent Navigation', 'consistent-navigation'],
  ['3.2.4', 'AA', 'Consistent Identification', 'consistent-identification'],
  ['3.2.5', 'AAA', 'Change on Request', 'change-on-request'],
  ['3.2.6', 'A', 'Consistent Help', 'consistent-help'],
  ['3.3.1', 'A', 'Error Identification', 'error-identification'],
  ['3.3.2', 'A', 'Labels or Instructions', 'labels-or-instructions'],
  ['3.3.3', 'AA', 'Error Suggestion', 'error-suggestion'],
  ['3.3.4', 'AA', 'Error Prevention (Legal, Financial, Data)', 'error-prevention-legal-financial-data'],
  ['3.3.5', 'AAA', 'Help', 'help'],
  ['3.3.6', 'AAA', 'Error Prevention (All)', 'error-prevention-all'],
  ['3.3.7', 'A', 'Redundant Entry', 'redundant-entry'],
  ['3.3.8', 'AA', 'Accessible Authentication (Minimum)', 'accessible-authentication-minimum'],
  ['3.3.9', 'AAA', 'Accessible Authentication (Enhanced)', 'accessible-authentication-enhanced'],
  ['4.1.2', 'A', 'Name, Role, Value', 'name-role-value'],
  ['4.1.3', 'AA', 'Status Messages', 'status-messages']
].map(([criterion, level, title, slug]) => ({ criterion, level, title, slug })) as CriterionDefinition[];

function criterionFromTag(tag: string): string | undefined {
  const match = /^wcag(\d)(\d)(\d+)$/.exec(tag.toLowerCase());
  return match ? `${match[1]}.${match[2]}.${match[3]}` : undefined;
}

function axeEvidence(pages: PageAudit[]): Map<string, { passes: Set<string>; incomplete: Set<string> }> {
  const result = new Map<string, { passes: Set<string>; incomplete: Set<string> }>();
  const entry = (criterion: string): { passes: Set<string>; incomplete: Set<string> } => {
    const existing = result.get(criterion) ?? { passes: new Set<string>(), incomplete: new Set<string>() };
    result.set(criterion, existing);
    return existing;
  };
  for (const page of pages) {
    for (const viewport of page.viewports) {
      for (const pass of viewport.axeRun.passes) {
        for (const tag of pass.tags) {
          const criterion = criterionFromTag(tag);
          if (criterion) entry(criterion).passes.add(`${pass.id} passed on ${page.url} (${viewport.viewport.name}; ${pass.nodeCount} node${pass.nodeCount === 1 ? '' : 's'})`);
        }
      }
      for (const resultItem of viewport.axe.filter((item) => item.resultType === 'incomplete')) {
        for (const tag of resultItem.tags) {
          const criterion = criterionFromTag(tag);
          if (criterion) entry(criterion).incomplete.add(`${resultItem.id} needs review on ${page.url} (${viewport.viewport.name})`);
        }
      }
    }
  }
  return result;
}

function findingMap(findings: Finding[]): Map<string, Array<{ id: string; finding: Finding }>> {
  const result = new Map<string, Array<{ id: string; finding: Finding }>>();
  findings.forEach((finding, index) => {
    const id = findingId(finding, index);
    for (const criterion of finding.wcag) result.set(criterion, [...(result.get(criterion) ?? []), { id, finding }]);
  });
  return result;
}

export function buildWcagCriterionLedger(
  pages: PageAudit[],
  findings: Finding[],
  manualChecks: ManualCheck[],
  aaaAdvisory: boolean
): WcagCriterionAssessment[] {
  const evidence = axeEvidence(pages);
  const mappedFindings = findingMap(findings);
  const manualCriteria = new Set(manualChecks.flatMap((check) => check.wcag));

  return definitions.map((definition) => {
    const scope = definition.level === 'AAA' ? 'advisory' as const : 'standard' as const;
    if (definition.level === 'AAA' && !aaaAdvisory) {
      return {
        ...definition,
        understandingUrl: `https://www.w3.org/WAI/WCAG22/Understanding/${definition.slug}.html`,
        scope,
        status: 'not-applicable' as const,
        findingIds: [],
        automatedEvidence: [],
        detail: 'AAA is outside the WCAG 2.2 AA conformance target; optional AAA advisory checks were not enabled.'
      };
    }

    const related = mappedFindings.get(definition.criterion) ?? [];
    const failed = related.filter(({ finding }) => finding.classification === 'confirmed' || finding.classification === 'blocker');
    const review = related.filter(({ finding }) => finding.classification === 'review');
    const axe = evidence.get(definition.criterion);
    const automatedEvidence = [
      ...(axe?.passes ?? []),
      ...(axe?.incomplete ?? []),
      ...related.map(({ id, finding }) => `${id}: ${finding.summary}`)
    ].slice(0, 40);

    if (failed.length) {
      return {
        ...definition,
        understandingUrl: `https://www.w3.org/WAI/WCAG22/Understanding/${definition.slug}.html`,
        scope,
        status: 'failed' as const,
        findingIds: failed.map(({ id }) => id),
        automatedEvidence,
        detail: `${failed.length} evidence-backed finding${failed.length === 1 ? '' : 's'} mapped to this criterion; a human conformance decision remains required.`
      };
    }

    const requiresManualReview = manualCriteria.has(definition.criterion);
    return {
      ...definition,
      understandingUrl: `https://www.w3.org/WAI/WCAG22/Understanding/${definition.slug}.html`,
      scope,
      status: review.length || axe?.incomplete.size ? 'inconclusive' as const : requiresManualReview ? 'manual-review-required' as const : 'inconclusive' as const,
      findingIds: related.map(({ id }) => id),
      automatedEvidence,
      detail: review.length || axe?.incomplete.size
        ? 'One or more automated or heuristic results need qualified human review.'
        : requiresManualReview
          ? 'The mandatory manual test plan includes this criterion; record the reviewer decision before making a conformance claim.'
          : axe?.passes.size
            ? 'The implemented automated rules passed, but automated coverage alone does not establish criterion-level conformance.'
            : 'No complete machine-verifiable determination is available; assess applicability and outcome manually.'
    };
  });
}

export function ledgerStatusCounts(criteria: AuditSummary['criteria'] = []): Record<string, number> {
  return criteria.reduce<Record<string, number>>((counts, criterion) => {
    counts[criterion.status] = (counts[criterion.status] ?? 0) + 1;
    return counts;
  }, {});
}
