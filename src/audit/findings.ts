import { createHash } from 'node:crypto';
import type { AxeNodeResult, AxeViolationResult, DisclosureCheckResult, ElementContext, Finding, PageAudit, Severity, ViewportAudit } from '../types.js';

function fingerprint(value: string): string {
  return createHash('sha1').update(value).digest('hex').slice(0, 12);
}

function normalizeComponent(selector: string): string {
  return selector
    .replace(/:nth-(child|of-type)\(\d+\)/g, '')
    .replace(/#[A-Za-z_-]*\d{3,}[\w-]*/g, '[dynamic-id]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180) || 'page';
}

function conciseList(values: string[], limit = 4): string {
  const unique = [...new Set(values.map((value) => value.trim()).filter(Boolean))];
  if (unique.length <= limit) return unique.join('; ');
  return `${unique.slice(0, limit).join('; ')}; and ${unique.length - limit} more`;
}

function enrichComponent(finding: Finding, audit: ViewportAudit): Finding {
  const contexts = finding.selectors
    .map((selector) => audit.elementContexts.find((context) => context.selector === selector))
    .filter((context): context is ElementContext => Boolean(context));
  if (contexts.length === 0) {
    return {
      ...finding,
      componentName: finding.component === 'page' ? 'Requested page' : finding.component,
      componentLocation: 'Page-level or structural check; see the affected page URL and technical locator.'
    };
  }
  return {
    ...finding,
    componentName: conciseList(contexts.map((context) => context.componentName)),
    componentLocation: conciseList(contexts.map((context) => context.location))
  };
}

function axeAccessibilityIssue(violation: AxeViolationResult, failureSummary?: string): string {
  const failure = (failureSummary ?? '').replace(/^Fix (any|all) of the following:\s*/i, '').replace(/\s+/g, ' ').trim();
  const direct: Record<string, string> = {
    'aria-command-name': 'The interactive control has no accessible name, so its purpose is not programmatically available.',
    'button-name': 'The button has no accessible name, so assistive technology cannot identify what it does.',
    'input-button-name': 'The input button has no accessible name, so assistive technology cannot identify what it does.',
    'link-name': 'The link has no accessible name, so its destination or purpose is not programmatically available.',
    'image-alt': 'The image does not provide the required text alternative.',
    label: 'The form control does not have a programmatically associated accessible name.',
    'color-contrast': 'The text does not meet the minimum contrast requirement against its rendered background.',
    'aria-hidden-focus': 'Focusable controls are inside content marked aria-hidden="true". Screen readers omit that content even though keyboard focus can still enter it.',
    'target-size': 'The rendered touch target does not meet the minimum target-size or spacing requirement.',
    'aria-valid-attr-value': 'The ARIA attribute value is invalid and may not be exposed reliably to assistive technology.',
    'aria-required-attr': 'The ARIA role is missing a required state or property.',
    'duplicate-id-aria': 'An id used by an ARIA or label relationship is duplicated, so the programmatic relationship is ambiguous.'
  };
  const issue = direct[violation.id]
    ?? `The component does not meet this accessibility requirement: ${violation.help.replace(/^Ensure\s+/i, '').replace(/\.$/, '')}.`;
  return failure && !issue.includes(failure) ? `${issue} ${failure}` : issue;
}

function axeSummary(violation: AxeViolationResult): string {
  const direct: Record<string, string> = {
    'aria-command-name': 'Interactive control has no accessible name',
    'button-name': 'Button has no accessible name',
    'input-button-name': 'Input button has no accessible name',
    'link-name': 'Link has no accessible name',
    'image-alt': 'Image has no text alternative',
    label: 'Form field has no programmatically associated label',
    'color-contrast': 'Text contrast is below the required minimum',
    'aria-hidden-focus': 'Focusable content is hidden from assistive technology',
    'aria-valid-attr-value': 'ARIA attribute contains an invalid value',
    'aria-required-attr': 'ARIA role is missing a required state or property',
    'duplicate-id-aria': 'Duplicate id makes an accessibility relationship ambiguous'
  };
  return direct[violation.id] ?? violation.help.replace(/\.$/, '');
}

function axeTesting(violation: AxeViolationResult, audit: ViewportAudit, selector: string, failureSummary?: string): string {
  const actual = (failureSummary ?? axeAccessibilityIssue(violation))
    .replace(/^Fix (any|all) of the following:\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  const expected = violation.description.replace(/^Ensure\s+/i, '').replace(/\.$/, '');
  return [
    `1. Open the affected page at the ${audit.viewport.name} viewport.`,
    `2. Locate the component using ${selector}.`,
    `3. Inspect its rendered state and accessibility-tree properties, then run axe-core rule ${violation.id}.`,
    `Actual: ${actual}`,
    `Expected: ${expected}.`,
    `Rule reference: ${violation.helpUrl}`
  ].join('\n');
}

function axeUserImpact(ruleId: string): string {
  if (ruleId === 'color-contrast') return 'People with low vision or colour-vision deficiencies may be unable to read the text.';
  if (ruleId === 'target-size') return 'Touch users and people with limited dexterity may miss the target or activate an adjacent control.';
  if (ruleId === 'aria-hidden-focus') return 'Keyboard focus can move to content that screen readers do not announce, leaving keyboard and screen-reader users without understandable context.';
  if (/command-name|button-name|link-name|input-button-name/.test(ruleId)) return 'Screen-reader users cannot identify the control or link, and voice-control users cannot reliably request it by name.';
  if (/image-alt/.test(ruleId)) return 'Screen-reader users may miss the image purpose or hear an unhelpful filename.';
  if (/label/.test(ruleId)) return 'Screen-reader users may not know what information the field requires, and voice-control users may be unable to target it by its visible label.';
  if (/aria|role|duplicate-id/.test(ruleId)) return 'Assistive technology may receive missing, invalid, or ambiguous role, state, name, or relationship information.';
  return 'People using assistive technology may be unable to perceive, understand, or operate the component as intended.';
}

function axeRemediation(violation: AxeViolationResult): string {
  const direct: Record<string, string> = {
    'aria-command-name': 'Give the control a concise accessible name that describes its action. Prefer visible text; otherwise use aria-labelledby to reference visible text or aria-label when no visible label is available.',
    'button-name': 'Give the button concise visible text that describes its action. If the button is icon-only, provide one accessible name with aria-label or aria-labelledby.',
    'input-button-name': 'Set a meaningful value on the input button or replace it with a native button containing descriptive visible text.',
    'link-name': 'Give the link concise visible text that describes its destination. For an image-only link, provide a meaningful image alternative or label the link once without duplicating its name.',
    'image-alt': 'Add concise alt text that communicates the image purpose. Use alt="" only when the image is decorative and contributes no information or function.',
    label: 'Add a persistent visible label and associate it with the form control using native label markup and matching for/id values. Use aria-labelledby only when an existing visible label must be referenced.',
    'color-contrast': 'Change the foreground colour, background colour, font size, or font weight so normal text reaches at least 4.5:1 contrast and large text reaches at least 3:1 in every affected state.',
    'aria-hidden-focus': 'Remove focusable descendants from the aria-hidden region by hiding or disabling them when the region is unavailable, or remove aria-hidden when the content must remain operable and exposed.',
    'target-size': 'Increase the clickable area to at least 24 by 24 CSS pixels or provide sufficient unobstructed spacing to meet the WCAG 2.5.8 exception.',
    'aria-valid-attr-value': 'Replace the invalid ARIA value with a value permitted for that attribute and keep it synchronized with the rendered component state.',
    'aria-required-attr': 'Add the required ARIA state or property for the role and update it whenever the component state changes.',
    'duplicate-id-aria': 'Give every referenced element a unique id and update each aria-labelledby, aria-describedby, aria-controls, for, or other id reference to the intended unique target.'
  };
  return direct[violation.id]
    ?? `Correct the component markup and behaviour so it satisfies this requirement: ${violation.help.replace(/^Ensure\s+/i, '').replace(/\.$/, '')}.`;
}

function stableComponentSignature(signature: string): string {
  return signature
    .replace(/\b(id|for|aria-controls|aria-labelledby|aria-describedby|aria-owns|name)\s*=\s*(["'])[^"']+\2/gi, '$1="[reference]"')
    .replace(/"(controls|controlledBy|labelledBy|describedBy)"\s*:\s*"[^"]+"/gi, '"$1":"[reference]"')
    .replace(/\bdata-(section|layout|component|field)[\w-]*\s*=\s*(["'])[^"']+\2/gi, 'data-$1="[reference]"')
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi, '[uuid]')
    .replace(/\b([a-z][\w-]*[-_:])?[0-9a-f]{12,}\b/gi, '[generated-token]')
    .replace(/\s+/g, ' ')
    .trim();
}

export function createSharedComponentKey(component: string, signature: string): string {
  return `${component}:${fingerprint(`${component}|${stableComponentSignature(signature)}`)}`;
}

function openingTagSignature(html: string): string {
  return (html.trim().match(/^<[^>]+>/)?.[0] ?? html.trim()).replace(/\s+/g, ' ');
}

interface ContrastDetails {
  actual: string;
  foreground: string;
  background: string;
  expected: string;
}

function contrastDetails(failureSummary = ''): ContrastDetails | null {
  const actual = failureSummary.match(/contrast of\s+([\d.]+)/i)?.[1];
  const foreground = failureSummary.match(/foreground color:\s*([^,)]+)/i)?.[1]?.trim().toLowerCase();
  const background = failureSummary.match(/background color:\s*([^,)]+)/i)?.[1]?.trim().toLowerCase();
  const expected = failureSummary.match(/expected contrast ratio of\s+([\d.]+):1/i)?.[1];
  return actual && foreground && background && expected
    ? { actual, foreground, background, expected }
    : null;
}

function landmarkIdentity(audit: ViewportAudit, node: AxeNodeResult): { role: string; name: string } {
  const axeData = [...(node.any ?? []), ...(node.all ?? []), ...(node.none ?? [])]
    .map((check) => check.data)
    .find((data): data is { role?: string; accessibleText?: string | null } => Boolean(data && typeof data === 'object'));
  if (axeData?.role) {
    return {
      role: axeData.role,
      name: axeData.accessibleText?.trim() || 'unnamed'
    };
  }
  const context = node.target
    .map((selector) => audit.elementContexts.find((item) => item.selector === selector))
    .find(Boolean);
  if (context) {
    return {
      role: context.role || context.tagName || 'landmark',
      name: context.accessibleName.trim() || 'unnamed'
    };
  }
  const tag = node.html.match(/^<([\w-]+)/)?.[1]?.toLowerCase() ?? 'landmark';
  const role = node.html.match(/\brole\s*=\s*["']([^"']+)["']/i)?.[1]?.toLowerCase() ?? tag;
  const name = node.html.match(/\b(?:aria-label|title)\s*=\s*["']([^"']+)["']/i)?.[1]?.trim() ?? 'unnamed';
  return { role, name };
}

function axeNodeOccurrences(node: AxeNodeResult): Array<{ html: string; target: string[] }> {
  const related = [...(node.any ?? []), ...(node.all ?? []), ...(node.none ?? [])]
    .flatMap((check) => check.relatedNodes ?? []);
  const occurrences = [{ html: node.html, target: node.target }, ...related];
  const seen = new Set<string>();
  return occurrences.filter((occurrence) => {
    const key = `${occurrence.target.join(',')}|${occurrence.html}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function axeNodeComponent(audit: ViewportAudit, node: AxeNodeResult): string {
  const context = node.target
    .map((selector) => audit.elementContexts.find((item) => item.selector === selector))
    .find(Boolean);
  return normalizeComponent(context?.captureSelector || node.target.join(' ') || 'page');
}

function severityFromAxe(impact: string | null): Severity {
  if (impact === 'critical') return 'Critical';
  if (impact === 'serious') return 'Serious';
  if (impact === 'moderate') return 'Moderate';
  if (impact === 'minor') return 'Minor';
  return 'Advisory';
}

function criterionFromTag(tag: string): string | null {
  const match = /^wcag(\d)(\d)(\d{1,2})$/.exec(tag);
  return match ? `${match[1]}.${match[2]}.${match[3]}` : null;
}

function assignmentForRule(ruleId: string): Finding['assignment'] {
  if (/alt|label|heading|link-name|language/i.test(ruleId)) return 'Content';
  if (/color|contrast|target|focus-visible/i.test(ruleId)) return 'Mixed';
  return 'Development';
}

function makeFinding(input: Omit<Finding, 'key'> & { identity: string }): Finding {
  const { identity, ...finding } = input;
  return { ...finding, key: `${finding.ruleId}:${fingerprint(identity)}` };
}

function axeFindings(audit: ViewportAudit): Finding[] {
  return audit.axe.flatMap((violation: AxeViolationResult) => {
    // Target size has multiple WCAG exceptions and axe classifies the rule as both
    // failure and needs-review. It is rendered below with measured spacing context
    // instead of being promoted to a generic confirmed axe finding.
    if (violation.id === 'target-size') return [];
    const wcag = violation.tags.map(criterionFromTag).filter((item): item is string => Boolean(item));
    const isWcagViolation = wcag.length > 0;
    const incomplete = violation.resultType === 'incomplete';
    // Incomplete axe results remain in ViewportAudit.axe and AxeRunMetadata for
    // coverage review. They are indeterminate and must not become report rows.
    if (incomplete) return [];
    if (violation.id === 'color-contrast') {
      const groups = new Map<string, { details: ContrastDetails | null; nodes: AxeNodeResult[] }>();
      for (const node of violation.nodes) {
        const details = contrastDetails(node.failureSummary);
        const signature = details
          ? `${details.foreground}|${details.background}|${details.actual}|${details.expected}`
          : stableComponentSignature(node.failureSummary ?? openingTagSignature(node.html));
        const group = groups.get(signature) ?? { details, nodes: [] };
        group.nodes.push(node);
        groups.set(signature, group);
      }
      return [...groups.entries()].map(([signature, group]) => {
        const selectors = [...new Set(group.nodes.flatMap((node) => node.target.length ? node.target : ['page']))];
        const details = group.details;
        const actual = details
          ? `${details.foreground} foreground on ${details.background} background measured ${details.actual}:1; ${details.expected}:1 is required`
          : 'axe-core identified insufficient text contrast for the listed elements';
        const component = details
          ? `text colour treatment ${details.foreground} on ${details.background}`
          : 'text colour treatment';
        return makeFinding({
          identity: `color-contrast|${signature}`,
          ruleId: 'axe-color-contrast',
          classification: 'confirmed',
          severity: severityFromAxe(violation.impact),
          wcag: wcag.length ? wcag : ['1.4.3'],
          summary: 'Shared text colour treatment has insufficient contrast',
          issue: `The same rendered colour treatment is used by the listed text components and does not meet minimum contrast. ${actual}.`,
          impact: axeUserImpact(violation.id),
          testing: [
            `1. Open the affected page at the ${audit.viewport.name} viewport.`,
            `2. Locate the listed elements using ${conciseList(selectors, 8)}.`,
            '3. Measure the rendered foreground and background colours in each affected state.',
            `Actual: ${actual}.`,
            `Expected: Text reaches at least ${details?.expected ?? 'the applicable minimum'}:1 contrast for the rendered text size and weight.`,
            `Rule reference: ${violation.helpUrl}`
          ].join('\n'),
          remediation: 'Change the shared foreground or background colour token so every affected instance reaches the applicable contrast threshold in each state. Retest normal, bold, selected, hover and focus states wherever that shared colour treatment is used.',
          component,
          sharedComponentKey: createSharedComponentKey(component, `color-contrast|${signature}`),
          urls: [audit.url],
          viewports: [audit.viewport.name],
          selectors,
          evidence: group.nodes.map((node) => ({
            kind: 'axe',
            pageUrl: audit.url,
            viewport: audit.viewport.name,
            selector: node.target.join(', '),
            detail: `${node.html}\n${node.failureSummary ?? ''}`.trim(),
            screenshot: screenshotFor(audit, node.target[0])
          })),
          assignment: 'Mixed',
          effort: 'Medium',
          translationRequired: 'No'
        });
      });
    }
    if (violation.id === 'landmark-unique') {
      const groups = new Map<string, { identity: { role: string; name: string }; implementation: string; nodes: AxeNodeResult[] }>();
      for (const node of violation.nodes) {
        const identity = landmarkIdentity(audit, node);
        const implementation = stableComponentSignature(openingTagSignature(node.html));
        const signature = `${identity.role.toLowerCase()}|${identity.name.toLowerCase()}|${implementation}`;
        const group = groups.get(signature) ?? { identity, implementation, nodes: [] };
        group.nodes.push(node);
        groups.set(signature, group);
      }
      return [...groups.entries()].map(([signature, group]) => {
        const occurrences = group.nodes.flatMap(axeNodeOccurrences);
        const selectors = [...new Set(occurrences.flatMap((node) => node.target.length ? node.target : ['page']))];
        const { role, name } = group.identity;
        const named = name === 'unnamed' ? 'without an accessible name' : `with the accessible name “${name}”`;
        const component = `${role} landmarks ${named}`;
        return makeFinding({
          identity: `landmark-unique|${signature}`,
          ruleId: 'axe-landmark-unique',
          classification: 'review',
          severity: severityFromAxe(violation.impact),
          wcag: wcag.length ? wcag : ['Best Practice'],
          summary: 'Repeated landmarks are not uniquely distinguishable',
          issue: `Multiple visible ${role} landmarks are exposed ${named}. Review the complete landmark set to confirm that users cannot distinguish their purposes.`,
          impact: 'Screen-reader users may be unable to distinguish equivalent landmarks in a landmark list or move directly to the intended region.',
          testing: [
            `1. Open the affected page at the ${audit.viewport.name} viewport.`,
            `2. Inspect the visible ${role} landmarks using ${conciseList(selectors, 8)}.`,
            '3. Open a screen-reader landmark list and compare the announced role/name combinations.',
            `Actual: More than one ${role} landmark is exposed ${named}.`,
            'Expected: Repeated landmarks of the same role have concise, unique names that communicate their different purposes.',
            `Rule reference: ${violation.helpUrl}`
          ].join('\n'),
          remediation: 'Give repeated landmarks of the same role concise, unique accessible names using aria-labelledby when a visible heading is available, or aria-label otherwise. Do not add names to landmarks that are already distinguishable by role and context.',
          component,
          sharedComponentKey: createSharedComponentKey(component, `landmark-unique|${group.implementation}`),
          urls: [audit.url],
          viewports: [audit.viewport.name],
          selectors,
          evidence: occurrences.map((node) => ({
            kind: 'axe',
            pageUrl: audit.url,
            viewport: audit.viewport.name,
            selector: node.target.join(', '),
            detail: node.html,
            screenshot: screenshotFor(audit, node.target[0])
          })),
          assignment: 'Development',
          effort: 'Small',
          translationRequired: 'Review'
        });
      });
    }
    if (violation.id === 'region' && violation.nodes.length > 0) {
      const selectors = [...new Set(violation.nodes.flatMap((node) => node.target))];
      return [makeFinding({
        identity: 'region|page-structure',
        ruleId: 'axe-region',
        classification: 'review',
        severity: severityFromAxe(violation.impact),
        wcag: ['Best Practice'],
        summary: axeSummary(violation),
        issue: 'Rendered page content exists outside semantic landmark regions. The appropriate landmark boundaries require structural review.',
        impact: 'Screen-reader users may have difficulty identifying and bypassing major page regions.',
        testing: `axe-core region signalled content outside landmarks at ${audit.viewport.name}. This is a best-practice signal and requires review of the page structure. Rule: ${violation.helpUrl}`,
        remediation: 'Place primary content inside main and repeated site regions inside appropriate semantic landmarks. Use additional named regions only when they identify meaningful page areas.',
        component: 'page structure',
        urls: [audit.url],
        viewports: [audit.viewport.name],
        selectors,
        evidence: violation.nodes.map((node) => ({
          kind: 'axe',
          pageUrl: audit.url,
          viewport: audit.viewport.name,
          selector: node.target.join(', '),
          detail: node.html,
          screenshot: screenshotFor(audit, node.target[0])
        })),
        assignment: 'Development',
        effort: 'Medium',
        translationRequired: 'No'
      })];
    }
    const groups = new Map<string, { component: string; failure: string; nodes: AxeNodeResult[] }>();
    for (const node of violation.nodes) {
      const component = axeNodeComponent(audit, node);
      const failure = stableComponentSignature(node.failureSummary ?? '');
      const signature = `${component}|${failure}`;
      const group = groups.get(signature) ?? { component, failure, nodes: [] };
      group.nodes.push(node);
      groups.set(signature, group);
    }
    return [...groups.values()].map((group) => {
      const selectors = [...new Set(group.nodes.flatMap((node) => node.target.length ? node.target : ['page']))];
      const representative = group.nodes[0]!;
      return makeFinding({
        identity: `${violation.id}|${group.component}|${group.failure}`,
        ruleId: `axe-${violation.id}`,
        classification: isWcagViolation ? 'confirmed' : 'review',
        severity: severityFromAxe(violation.impact),
        wcag: wcag.length ? wcag : ['Best Practice'],
        summary: axeSummary(violation),
        issue: axeAccessibilityIssue(violation, representative.failureSummary),
        impact: axeUserImpact(violation.id),
        testing: axeTesting(violation, audit, conciseList(selectors, 8), representative.failureSummary),
        remediation: `${axeRemediation(violation)} Retest the component in every affected state.`,
        component: group.component,
        sharedComponentKey: createSharedComponentKey(group.component, `${violation.id}|${group.failure}`),
        urls: [audit.url],
        viewports: [audit.viewport.name],
        selectors,
        evidence: group.nodes.map((node) => ({
          kind: 'axe',
          pageUrl: audit.url,
          viewport: audit.viewport.name,
          selector: node.target.join(', '),
          detail: node.html,
          screenshot: screenshotFor(audit, node.target[0])
        })),
        assignment: assignmentForRule(violation.id),
        effort: 'Medium',
        translationRequired: 'No'
      });
    });
  });
}

function screenshotFor(audit: ViewportAudit, selector?: string): string {
  if (selector) {
    const elementScreenshot = audit.elementScreenshots.find((item) => item.selector === selector);
    if (elementScreenshot) return elementScreenshot.path;
    if (!/^(?:page|html|body)$/i.test(selector.trim())) return '';
  }
  return audit.screenshot;
}

function disclosureSelectorFamily(selector: string): string {
  return normalizeComponent(selector)
    .replace(/#[A-Za-z0-9_-]+(?=-(?:toggle|trigger|button|control|filters-section)\b)/gi, '#[item]')
    .replace(/\[data-(?:index|item|key)=["'][^"']+["']\]/gi, '[data-item]');
}

function disclosureFamily(audit: ViewportAudit, disclosure: DisclosureCheckResult): string {
  const trigger = disclosureSelectorFamily(disclosure.selector);
  if (!trigger.includes('[item]')) return trigger;
  const context = audit.elementContexts.find((item) => item.selector === disclosure.selector);
  const container = context?.captureSelector ? disclosureSelectorFamily(context.captureSelector) : '';
  return [container, trigger].filter(Boolean).join(' >> ');
}

function domFindings(audit: ViewportAudit): Finding[] {
  const findings: Finding[] = [];
  const evidence = (kind: 'dom' | 'keyboard' | 'responsive' | 'network', selector: string | undefined, detail: string) => ({
    kind,
    pageUrl: audit.url,
    viewport: audit.viewport.name,
    ...(selector ? { selector } : {}),
    detail,
    screenshot: screenshotFor(audit, selector)
  });

  const localDocument = /^(file|data):/i.test(audit.finalUrl);
  if ((!localDocument && audit.status === null) || (audit.status !== null && audit.status >= 400)) {
    findings.push(makeFinding({
      identity: `http|${audit.url}`,
      ruleId: 'page-unavailable',
      classification: 'blocker',
      severity: 'Critical',
      wcag: ['None'],
      summary: 'The page could not be audited',
      issue: `The requested page returned HTTP ${audit.status ?? 'no response'} and could not be reliably audited.`,
      impact: 'Accessibility checks cannot establish the page state because the page is unavailable.',
      testing: 'The browser navigation response was inspected before component tests ran.',
      remediation: 'Restore the staging page, confirm it returns a successful response, and rerun the full audit.',
      component: 'page',
      urls: [audit.url],
      viewports: [audit.viewport.name],
      selectors: [],
      evidence: [evidence('network', undefined, `HTTP status: ${audit.status ?? 'none'}; final URL: ${audit.finalUrl}`)],
      assignment: 'Development',
      effort: 'Review',
      translationRequired: 'No'
    }));
    return findings;
  }

  if (audit.interactionBlocker) {
    findings.push(makeFinding({
      identity: `interaction-blocker|${audit.interactionBlocker.selector}|${audit.viewport.name}`,
      ruleId: 'interaction-coverage-blocked',
      classification: 'blocker',
      severity: 'Critical',
      wcag: ['None'],
      summary: 'Page interaction testing was blocked by an active modal surface',
      issue: `${audit.interactionBlocker.reason} Page-level keyboard, disclosure, tab, form and link interaction results cannot be treated as complete.`,
      impact: 'The audit cannot establish whether people can operate the underlying page because the blocking surface prevented representative interaction testing.',
      testing: `The page was loaded at ${audit.viewport.name}; the remaining surface was identified as ${audit.interactionBlocker.selector} with role ${audit.interactionBlocker.role}.`,
      remediation: 'Configure the audit to dismiss the authorised privacy or consent surface before testing, or remove the unexpected staging overlay, then rerun every interaction check for this viewport.',
      component: audit.interactionBlocker.selector,
      componentName: audit.interactionBlocker.name || `${audit.interactionBlocker.role} surface`,
      componentLocation: 'Overlaying the tested page before page-level interaction checks',
      sharedComponentKey: `audit-interaction-blocker:${normalizeComponent(audit.interactionBlocker.selector)}`,
      urls: [audit.url],
      viewports: [audit.viewport.name],
      selectors: [audit.interactionBlocker.selector],
      evidence: [evidence('keyboard', audit.interactionBlocker.selector, JSON.stringify({
        blocker: audit.interactionBlocker,
        consent: audit.consent,
        keyboard: audit.keyboard
      }))],
      assignment: 'QA',
      effort: 'Review',
      translationRequired: 'No'
    }));
  }

  if (audit.dom.mainCount === 0) {
    findings.push(makeFinding({
      identity: 'main-landmark|page',
      ruleId: 'missing-main-landmark',
      classification: 'confirmed',
      severity: 'Serious',
      wcag: ['1.3.1', '2.4.1'],
      summary: 'The page has no main landmark',
      issue: 'No main element or role="main" was present.',
      impact: 'Screen-reader users cannot move directly to the primary page content using landmark navigation.',
      testing: 'The rendered DOM was queried for main and role="main" landmarks.',
      remediation: 'Wrap the unique primary content in one semantic main element. Do not place repeated site chrome inside it.',
      component: 'page structure',
      urls: [audit.url],
      viewports: [audit.viewport.name],
      selectors: [],
      evidence: [evidence('dom', undefined, 'main landmark count: 0')],
      assignment: 'Development',
      effort: 'Small',
      translationRequired: 'No'
    }));
  }

  if (audit.dom.h1Count !== 1) {
    findings.push(makeFinding({
      identity: 'heading-one|page',
      ruleId: 'heading-one-review',
      classification: 'review',
      severity: 'Moderate',
      wcag: ['1.3.1', '2.4.6'],
      summary: 'Review the page-level heading structure',
      issue: `The page contains ${audit.dom.h1Count} h1 elements. Automated counting cannot determine whether the hierarchy describes the content accurately.`,
      impact: 'An unclear heading hierarchy can make content difficult to understand and navigate.',
      testing: 'The rendered h1 elements were counted; heading meaning and hierarchy require content review.',
      remediation: 'Provide a descriptive page-level heading and arrange subsequent headings in a logical hierarchy that reflects the page content.',
      component: 'page headings',
      urls: [audit.url],
      viewports: [audit.viewport.name],
      selectors: ['h1'],
      evidence: [evidence('dom', 'h1', `h1 count: ${audit.dom.h1Count}`)],
      assignment: 'Content',
      effort: 'Small',
      translationRequired: 'Review'
    }));
  }

  for (const item of audit.dom.missingAltImages) {
    findings.push(makeFinding({
      identity: `missing-alt|${normalizeComponent(item.selector)}`,
      ruleId: 'image-missing-alt',
      classification: 'confirmed',
      severity: 'Serious',
      wcag: ['1.1.1'],
      summary: 'Image has no text alternative',
      issue: 'The img element does not have an alt attribute.',
      impact: 'Screen-reader users may miss the image purpose, while decorative images may be announced as a filename or URL.',
      testing: 'The rendered DOM was inspected for img elements without an alt attribute.',
      remediation: 'Add concise alt text that communicates the image purpose. If the image is decorative, use alt="". For a linked logo, name the link by its destination, such as the organisation home page.',
      component: normalizeComponent(item.selector),
      sharedComponentKey: createSharedComponentKey(normalizeComponent(item.selector), item.html),
      urls: [audit.url],
      viewports: [audit.viewport.name],
      selectors: [item.selector],
      evidence: [evidence('dom', item.selector, item.html)],
      assignment: 'Content',
      effort: 'Small',
      translationRequired: 'Review'
    }));
  }

  for (const item of audit.dom.linkedImagesForReview) {
    if (!/^(logo|company logo|site logo|image|home|homepage)$/i.test(item.name.trim())) continue;
    findings.push(makeFinding({
      identity: `linked-image-name|${normalizeComponent(item.selector)}`,
      ruleId: 'linked-image-purpose-review',
      classification: 'review',
      severity: 'Serious',
      wcag: ['1.1.1', '2.4.4'],
      summary: 'Review the linked image accessible name',
      issue: `${item.reason} Current name: “${item.name || 'empty'}”; image alt: “${item.alt}”.`,
      impact: 'Screen-reader and voice-control users may not understand or reliably request the link destination.',
      testing: 'The image-only link uses a wholly generic accessible name such as “logo” or “image”. Review its destination and surrounding context to determine concise purpose text.',
      remediation: 'Replace the generic name with concise text that identifies the organisation or destination in context. Ensure the image alternative participates only once in the link name.',
      component: normalizeComponent(item.selector),
      sharedComponentKey: createSharedComponentKey(normalizeComponent(item.selector), JSON.stringify({
        selector: item.selector,
        name: item.name,
        alt: item.alt,
        reason: item.reason
      })),
      urls: [audit.url],
      viewports: [audit.viewport.name],
      selectors: [item.selector],
      evidence: [evidence('dom', item.selector, JSON.stringify(item))],
      assignment: 'Content',
      effort: 'Small',
      translationRequired: 'Review'
    }));
  }

  const axeEmptyLinkSelectors = new Set(
    audit.axe
      .filter((violation) => violation.id === 'link-name')
      .flatMap((violation) => violation.nodes.flatMap((node) => node.target))
      .map(normalizeComponent)
  );
  const axeEmptyLinkSignatures = new Set(
    audit.axe
      .filter((violation) => violation.id === 'link-name')
      .flatMap((violation) => violation.nodes.map((node) => openingTagSignature(node.html)))
  );
  for (const item of audit.dom.emptyLinks) {
    if (
      axeEmptyLinkSelectors.has(normalizeComponent(item.selector))
      || axeEmptyLinkSignatures.has(openingTagSignature(item.html))
    ) continue;
    findings.push(makeFinding({
      identity: `empty-link|${normalizeComponent(item.selector)}`,
      ruleId: 'link-empty-accessible-name',
      classification: 'confirmed',
      severity: 'Critical',
      wcag: ['2.4.4', '4.1.2'],
      summary: 'Link has no accessible name',
      issue: `The visible link has no text, aria-label, valid aria-labelledby text, descendant image alternative, or title. Destination: ${item.href || 'not provided'}.`,
      impact: 'People using screen readers or voice control cannot identify or request the link.',
      testing: 'The rendered visible link was checked for multiple accessible-name sources. Equivalent axe link-name failures are de-duplicated.',
      remediation: 'Provide concise visible link text that describes the destination. For an image-only link, provide meaningful image alternative text or label the link once without duplicating its name.',
      component: normalizeComponent(item.selector),
      sharedComponentKey: createSharedComponentKey(normalizeComponent(item.selector), item.html),
      urls: [audit.url],
      viewports: [audit.viewport.name],
      selectors: [item.selector],
      evidence: [evidence('dom', item.selector, item.html)],
      assignment: 'Development',
      effort: 'Small',
      translationRequired: 'Review'
    }));
  }

  const axeEmptyControlRules = new Set([
    'aria-command-name',
    'aria-input-field-name',
    'aria-meter-name',
    'aria-progressbar-name',
    'aria-toggle-field-name',
    'aria-tooltip-name',
    'aria-treeitem-name',
    'button-name',
    'input-button-name',
    'select-name'
  ]);
  const axeEmptyControlSignatures = new Set(
    audit.axe
      .filter((violation) => axeEmptyControlRules.has(violation.id))
      .flatMap((violation) => violation.nodes.map((node) => openingTagSignature(node.html)))
  );
  const unlabeledFieldSelectors = new Set(audit.dom.unlabeledFields.map((item) => normalizeComponent(item.selector)));
  const unlabeledFieldSignatures = new Set(audit.dom.unlabeledFields.map((item) => openingTagSignature(item.html)));
  for (const item of audit.dom.emptyNamedControls) {
    if (axeEmptyControlSignatures.has(openingTagSignature(item.html))) continue;
    if (
      unlabeledFieldSelectors.has(normalizeComponent(item.selector))
      || unlabeledFieldSignatures.has(openingTagSignature(item.html))
    ) continue;
    findings.push(makeFinding({
      identity: `empty-name|${normalizeComponent(item.selector)}`,
      ruleId: 'interactive-control-no-name',
      classification: 'confirmed',
      severity: 'Critical',
      wcag: ['4.1.2'],
      summary: 'Interactive control has no accessible name',
      issue: `The visible ${item.tag} is keyboard focusable but has no detectable accessible name.`,
      impact: 'Screen-reader and voice-control users cannot identify or request the control reliably.',
      testing: 'Visible focusable elements were checked for text, associated labels, aria-label, aria-labelledby, image alt, or title.',
      remediation: 'Provide a concise visible label where possible. Otherwise associate an existing visible label programmatically; use aria-label only when no visible label can be used.',
      component: normalizeComponent(item.selector),
      sharedComponentKey: createSharedComponentKey(normalizeComponent(item.selector), item.html),
      urls: [audit.url],
      viewports: [audit.viewport.name],
      selectors: [item.selector],
      evidence: [evidence('dom', item.selector, item.html)],
      assignment: 'Development',
      effort: 'Small',
      translationRequired: 'Review'
    }));
  }

  for (const item of audit.dom.unlabeledFields) {
    findings.push(makeFinding({
      identity: `field-label|${normalizeComponent(item.selector)}`,
      ruleId: 'form-field-no-label',
      classification: 'confirmed',
      severity: 'Critical',
      wcag: ['1.3.1', '3.3.2', '4.1.2'],
      summary: 'Form field has no programmatic label',
      issue: 'A visible form field has no associated label, aria-label, or aria-labelledby.',
      impact: 'Users may not know what information to enter, especially when navigating fields with a screen reader.',
      testing: 'Visible input, select, and textarea elements were checked for programmatic labels.',
      remediation: 'Add a persistent visible label and associate it with the field using for/id or native label wrapping. Keep instructions and required-state information available programmatically.',
      component: normalizeComponent(item.selector),
      sharedComponentKey: createSharedComponentKey(normalizeComponent(item.selector), item.html),
      urls: [audit.url],
      viewports: [audit.viewport.name],
      selectors: [item.selector],
      evidence: [evidence('dom', item.selector, item.html)],
      assignment: 'Development',
      effort: 'Small',
      translationRequired: 'Review'
    }));
  }

  for (const link of audit.links) {
    const component = normalizeComponent(link.selector);
    const confirmed = link.classification === 'confirmed';
    findings.push(makeFinding({
      identity: `link-destination|${component}|${link.href}|${link.reason}`,
      ruleId: confirmed ? 'link-broken-destination' : 'link-destination-review',
      classification: link.classification,
      severity: confirmed ? 'Serious' : 'Moderate',
      wcag: ['Best Practice'],
      summary: confirmed ? 'Link destination is broken' : 'Review the link destination',
      issue: `“${link.name}” points to ${link.href || 'an empty destination'}. ${link.reason}`,
      impact: confirmed
        ? 'People cannot reach the content or action promised by the link.'
        : 'The link may not provide a reliable destination or may use the wrong semantic control.',
      testing: confirmed
        ? 'Same-origin HTTP 404/410 results were confirmed by both the authenticated Playwright request context and an in-page browser fetch; missing fragment targets were checked directly in the rendered DOM.'
        : 'The destination was identified as a placeholder or returned a server error that can be transient; human confirmation is required before treating it as a defect.',
      remediation: confirmed
        ? 'Update the link to a working destination or restore the missing resource or fragment target, then repeat the same link check.'
        : 'Replace placeholder destinations with a working URL, or use a native button when the control performs an action. Confirm transient server failures before changing the link.',
      component,
      sharedComponentKey: createSharedComponentKey(component, `${link.href}|${link.reason}`),
      urls: [audit.url],
      viewports: [audit.viewport.name],
      selectors: [link.selector],
      evidence: [evidence('network', link.selector, JSON.stringify(link))],
      assignment: 'Development',
      effort: 'Small',
      translationRequired: 'No'
    }));
  }

  if (audit.dom.unnamedLandmarks.length) {
    const selectors = audit.dom.unnamedLandmarks.map((item) => item.selector);
    findings.push(makeFinding({
      identity: `landmark-names|${audit.dom.unnamedLandmarks.map((item) => item.role).join('|')}`,
      ruleId: 'repeated-landmarks-no-name',
      classification: 'confirmed',
      severity: 'Moderate',
      wcag: ['1.3.1', '2.4.6'],
      summary: 'Repeated landmarks are not uniquely named',
      issue: 'Two or more landmarks of the same type are present without distinguishing accessible names.',
      impact: 'Screen-reader landmark lists do not communicate which region each landmark represents.',
      testing: 'Visible repeated navigation and complementary landmarks were checked for accessible names.',
      remediation: 'Add concise unique names with aria-label or aria-labelledby to repeated landmarks, such as “Primary” and “Footer”.',
      component: 'page landmarks',
      urls: [audit.url],
      viewports: [audit.viewport.name],
      selectors,
      evidence: selectors.map((selector) => evidence('dom', selector, 'Repeated landmark has no accessible name.')),
      assignment: 'Development',
      effort: 'Small',
      translationRequired: 'Review'
    }));
  }

  if (audit.viewport.width === 320 && audit.responsive.horizontalOverflow > 2) {
    const selectors = audit.responsive.overflowElements.map((item) => item.selector);
    findings.push(makeFinding({
      identity: `reflow|${selectors.map(normalizeComponent).join('|') || 'page'}`,
      ruleId: 'horizontal-reflow-overflow',
      classification: 'review',
      severity: 'Serious',
      wcag: ['1.4.10'],
      summary: 'Content overflows the 320 CSS-pixel viewport',
      issue: `The document is ${audit.responsive.horizontalOverflow}px wider than the viewport. The listed elements need review for a permitted two-dimensional-layout exception.`,
      impact: 'Users who zoom or use a narrow viewport may need to scroll in two directions or may lose content.',
      testing: 'The page was rendered at 320 CSS pixels and document/element bounds were measured.',
      remediation: 'Make ordinary page content reflow within 320 CSS pixels. Constrain fixed widths, allow text and controls to wrap, and retain horizontal scrolling only for content that genuinely requires two-dimensional layout.',
      component: selectors.length ? normalizeComponent(selectors[0] ?? 'page') : 'page',
      urls: [audit.url],
      viewports: [audit.viewport.name],
      selectors,
      evidence: [evidence('responsive', selectors[0], JSON.stringify(audit.responsive))],
      assignment: 'Development',
      effort: 'Medium',
      translationRequired: 'No'
    }));
  }

  if (audit.responsive.textSpacingOverflow > Math.max(2, audit.responsive.horizontalOverflow + 2)) {
    findings.push(makeFinding({
      identity: 'text-spacing|page',
      ruleId: 'text-spacing-overflow',
      classification: 'review',
      severity: 'Moderate',
      wcag: ['1.4.12'],
      summary: 'Text-spacing overrides may cause content loss or overflow',
      issue: `After applying WCAG text-spacing values, overflow increased to ${audit.responsive.textSpacingOverflow}px. Visual inspection is required to confirm clipping or overlap.`,
      impact: 'People who increase spacing to read more comfortably may lose content or functionality.',
      testing: 'WCAG text-spacing overrides were injected and page overflow was remeasured.',
      remediation: 'Remove fixed heights and widths around text, allow wrapping, and test line, paragraph, letter, and word spacing together without clipping, overlap, or lost controls.',
      component: 'page layout',
      urls: [audit.url],
      viewports: [audit.viewport.name],
      selectors: [],
      evidence: [evidence('responsive', undefined, `Text-spacing overflow: ${audit.responsive.textSpacingOverflow}px`)],
      assignment: 'Development',
      effort: 'Medium',
      translationRequired: 'No'
    }));
  }

  for (const clipped of audit.responsive.clippedElements) {
    const criteria = clipped.phase === 'text-spacing' ? ['1.4.10', '1.4.12'] : ['1.4.10'];
    findings.push(makeFinding({
      identity: `responsive-clipped|${clipped.phase}|${normalizeComponent(clipped.selector)}`,
      ruleId: 'responsive-content-clipped',
      classification: 'review',
      severity: 'Moderate',
      wcag: criteria,
      summary: `Content may be clipped${clipped.phase === 'text-spacing' ? ' after text spacing' : ' at the narrow viewport'}`,
      issue: `${clipped.selector} has ${clipped.axis} scroll dimensions larger than its visible box while its overflow styling can clip content.`,
      impact: 'Users who zoom, reflow content, or increase text spacing may be unable to perceive content or reach functionality.',
      testing: `At the ${clipped.phase} phase, the element measured ${clipped.clientWidth}×${clipped.clientHeight} CSS pixels with scroll dimensions ${clipped.scrollWidth}×${clipped.scrollHeight}.`,
      remediation: 'Allow content to wrap and containers to grow. If clipping is intentional, verify that no meaningful content or operable control is hidden at 320 CSS pixels and with WCAG text spacing.',
      component: normalizeComponent(clipped.selector),
      urls: [audit.url],
      viewports: [audit.viewport.name],
      selectors: [clipped.selector],
      evidence: [evidence('responsive', clipped.selector, JSON.stringify(clipped))],
      assignment: 'Development',
      effort: 'Medium',
      translationRequired: 'Review'
    }));
  }

  for (const overlap of audit.responsive.overlapPairs) {
    const selectors = [overlap.firstSelector, overlap.secondSelector];
    const criteria = overlap.phase === 'text-spacing' ? ['1.4.10', '1.4.12'] : ['1.4.10'];
    findings.push(makeFinding({
      identity: `responsive-overlap|${overlap.phase}|${selectors.map(normalizeComponent).sort().join('|')}`,
      ruleId: 'responsive-controls-overlap',
      classification: 'review',
      severity: 'Moderate',
      wcag: criteria,
      summary: `Interactive elements overlap${overlap.phase === 'text-spacing' ? ' after text spacing' : ' at the narrow viewport'}`,
      issue: `Two visible interactive elements overlap by ${overlap.overlapWidth}×${overlap.overlapHeight} CSS pixels. Review whether either control, label, or focus indicator is obscured.`,
      impact: 'Overlapping controls can hide information, make a target difficult to activate, or obscure keyboard focus.',
      testing: `Rendered bounds were compared during the ${overlap.phase} reflow phase at ${audit.viewport.width} CSS pixels.`,
      remediation: 'Use responsive layout and wrapping so controls do not cover one another at narrow widths or after text spacing is increased.',
      component: normalizeComponent(overlap.firstSelector),
      urls: [audit.url],
      viewports: [audit.viewport.name],
      selectors,
      evidence: [evidence('responsive', overlap.firstSelector, JSON.stringify(overlap))],
      assignment: 'Development',
      effort: 'Medium',
      translationRequired: 'Review'
    }));
  }

  if (audit.responsive.lostInteractiveElements.length > 0) {
    const selectors = audit.responsive.lostInteractiveElements.map((item) => item.selector);
    findings.push(makeFinding({
      identity: `text-spacing-lost-functionality|${selectors.map(normalizeComponent).sort().join('|')}`,
      ruleId: 'text-spacing-functionality-lost',
      classification: 'review',
      severity: 'Serious',
      wcag: ['1.4.12'],
      summary: 'Interactive content may disappear after text spacing is increased',
      issue: `${audit.responsive.lostInteractiveElements.length} control(s) that were visible before the WCAG text-spacing override were no longer visibly rendered afterwards.`,
      impact: 'People who increase text spacing may lose access to controls or functionality.',
      testing: 'Visible interactive elements were inventoried before and after applying the WCAG text-spacing values, then compared by stable selector.',
      remediation: 'Remove fixed-height clipping and layout constraints so controls remain visible, readable, and operable with increased line, paragraph, word, and letter spacing.',
      component: 'responsive layout',
      urls: [audit.url],
      viewports: [audit.viewport.name],
      selectors,
      evidence: audit.responsive.lostInteractiveElements.map((item) => evidence('responsive', item.selector, `Previously visible control disappeared: ${item.name || 'unnamed control'}.`)),
      assignment: 'Development',
      effort: 'Medium',
      translationRequired: 'Review'
    }));
  }

  const groupKeyboardItems = (items: typeof audit.keyboard.sequence): Map<string, typeof items> => {
    const groups = new Map<string, typeof items>();
    for (const item of items) {
      const component = normalizeComponent(item.componentSelector || item.selector);
      groups.set(component, [...(groups.get(component) ?? []), item]);
    }
    return groups;
  };
  const obscured = audit.keyboard.sequence.filter((item) => item.obscured);
  for (const [component, items] of groupKeyboardItems(obscured)) {
    const names = conciseList(items.map((item) => `“${item.name || 'unnamed'}”`), 10);
    findings.push(makeFinding({
      identity: `focus-obscured|${component}`,
      ruleId: 'keyboard-focus-obscured',
      classification: 'confirmed',
      severity: 'Serious',
      wcag: ['2.4.11'],
      summary: 'Keyboard focus is obscured',
      issue: `The focused controls ${names} in the same rendered component were entirely covered at all sampled points within their visible bounds.`,
      impact: 'Keyboard users may not be able to see which control currently has focus.',
      testing: `The page was traversed with Tab. At positions ${items.map((item) => item.index).join(', ')}, hit-testing at the centre and four inset corners found unrelated rendered content above each focused control at every sampled point.`,
      remediation: 'Ensure focused controls are not hidden by sticky headers, cookie banners, dialogs, or other overlays. Scroll the focused item into an unobscured area and manage overlay focus correctly.',
      component,
      sharedComponentKey: createSharedComponentKey(component, 'keyboard-focus-obscured'),
      urls: [audit.url],
      viewports: [audit.viewport.name],
      selectors: items.map((item) => item.selector),
      evidence: items.map((item) => evidence('keyboard', item.selector, `Tab position ${item.index}: ${item.name}; role: ${item.role}; all sampled points obscured.`)),
      assignment: 'Development',
      effort: 'Medium',
      translationRequired: 'No'
    }));
  }

  const outsideViewport = audit.keyboard.sequence.filter((item) => item.outsideViewport);
  for (const [component, items] of groupKeyboardItems(outsideViewport)) {
    findings.push(makeFinding({
      identity: `focus-outside-viewport|${component}`,
      ruleId: 'keyboard-focus-outside-viewport',
      classification: 'review',
      severity: 'Serious',
      wcag: ['2.4.11'],
      summary: 'Keyboard focus may move outside the visible viewport',
      issue: `Sequential focus reached ${items.length} element(s) whose rendered bounds were outside the visible viewport after focus settled.`,
      impact: 'Keyboard users may lose track of focus and be unable to identify the currently active control.',
      testing: `The deterministic keyboard traversal checked focused-element bounds after each Tab step; affected positions: ${items.map((item) => item.index).join(', ')}.`,
      remediation: 'Scroll focused controls into view, remove hidden elements from the focus order, and ensure overlays do not separate visual and programmatic focus.',
      component,
      urls: [audit.url],
      viewports: [audit.viewport.name],
      selectors: items.map((item) => item.selector),
      evidence: items.map((item) => evidence('keyboard', item.selector, `Focus position ${item.index} was outside the viewport.`)),
      assignment: 'Development',
      effort: 'Medium',
      translationRequired: 'No'
    }));
  }

  for (const journey of audit.keyboard.journeys.filter((item) => item.status === 'failed')) {
    const isBypass = journey.id === 'bypass-blocks';
    findings.push(makeFinding({
      identity: `keyboard-journey|${journey.id}|${audit.url}`,
      ruleId: `keyboard-journey-${journey.id}`,
      classification: 'review',
      severity: 'Serious',
      wcag: [isBypass ? '2.4.1' : '2.4.3'],
      summary: `${journey.title} did not produce the expected result`,
      issue: journey.detail,
      impact: isBypass
        ? 'Keyboard users may be forced to traverse repeated content before reaching the main page content.'
        : 'Keyboard users may encounter an unexpected or illogical focus sequence.',
      testing: `Executed deterministic journey: ${journey.steps.join(' → ') || 'no completed steps'}.`,
      remediation: isBypass
        ? 'Provide an operable bypass mechanism whose target exists, becomes visible, and receives or immediately precedes focus.'
        : 'Keep DOM and visual order aligned and ensure forward and reverse sequential navigation are predictable.',
      component: 'page keyboard journey',
      urls: [audit.url],
      viewports: [audit.viewport.name],
      selectors: [],
      evidence: [evidence('keyboard', undefined, JSON.stringify(journey))],
      assignment: 'Development',
      effort: 'Medium',
      translationRequired: 'Review'
    }));
  }

  const axeTargetSelectors = new Set(
    audit.axe
      .filter((violation) => violation.id === 'target-size')
      .flatMap((violation) => violation.nodes.flatMap((node) => node.target))
      .map(normalizeComponent)
  );
  const targetSizeCandidates = audit.dom.smallTargets.filter((target) => (
    !target.inlineException
    && (target.hitTested === true || target.axeTargetSizeSignal || axeTargetSelectors.has(normalizeComponent(target.selector)))
    && (target.spacingRisk || target.axeTargetSizeSignal || axeTargetSelectors.has(normalizeComponent(target.selector)))
  ));
  const targetSizeGroups = new Map<string, typeof targetSizeCandidates>();
  for (const target of targetSizeCandidates) {
    const group = normalizeComponent(target.groupSelector || target.selector);
    targetSizeGroups.set(group, [...(targetSizeGroups.get(group) ?? []), target]);
  }
  for (const [component, items] of targetSizeGroups) {
    const selectors = [...new Set(items.map((item) => item.selector))];
    const measurements = conciseList(items.map((item) => `“${item.name || 'unnamed target'}” ${item.width}×${item.height} CSS pixels`), 6);
    const nearbyTargets = conciseList(items.flatMap((item) => item.nearbyTargets.map((nearby) => (
      `“${nearby.name || 'unnamed target'}” at ${nearby.centerDistance} CSS pixels centre-to-centre`
    ))), 6);
    const axeMatched = items.some((item) => item.axeTargetSizeSignal || axeTargetSelectors.has(normalizeComponent(item.selector)));
    const spacingMeasured = items.some((item) => item.spacingRisk);
    const evidenceBasis = [
      spacingMeasured ? 'rendered geometry shows that the required 24 CSS pixel clearance intersects another pointer target' : '',
      axeMatched ? 'axe-core returned its target-size signal' : ''
    ].filter(Boolean).join(' and ');
    findings.push(makeFinding({
      identity: `target-size|${component}`,
      ruleId: 'target-size-review',
      classification: 'review',
      severity: 'Minor',
      wcag: ['2.5.8'],
      summary: 'Pointer targets may not provide the required size or spacing',
      issue: `Automated evidence indicates that one or more pointer targets in this component may not provide a 24×24 CSS pixel target or sufficient separation because ${evidenceBasis}. The Equivalent, Inline, User Agent Control and Essential exceptions cannot all be established automatically, so this is a review issue rather than a confirmed WCAG failure.`,
      impact: 'People with limited dexterity may activate an adjacent control accidentally or be unable to select the target reliably.',
      testing: [
        `1. Open the affected page at the ${audit.viewport.name} viewport and locate the listed component.`,
        '2. Measure the complete clickable area of each listed control, including authored padding.',
        '3. For every undersized target, centre a 24 CSS pixel diameter circle on its bounding box and check whether it intersects another target or another undersized target’s circle.',
        '4. Confirm whether the Equivalent, Inline, User Agent Control or Essential exception applies.',
        `Actual: ${measurements}.${nearbyTargets ? ` Nearby target evidence: ${nearbyTargets}.` : ''}`,
        'Expected: Each pointer target contains a 24×24 CSS pixel area, has sufficient clearance, or has a documented applicable exception.'
      ].join('\n'),
      remediation: 'Increase the clickable area of each affected control to contain at least 24×24 CSS pixels. Where the visible control must remain smaller, add sufficient unobstructed spacing so the centred 24 CSS pixel clearance circles do not intersect neighbouring targets. Preserve the visible design by applying padding or an equivalent enlarged hit area, then retest every affected viewport.',
      component,
      sharedComponentKey: createSharedComponentKey(component, `target-size-spacing|${selectors.map(normalizeComponent).sort().join('|')}`),
      urls: [audit.url],
      viewports: [audit.viewport.name],
      selectors,
      evidence: items.map((item) => evidence(
        'dom',
        item.selector,
        `${item.width}×${item.height} CSS pixels; name: ${item.name || 'unnamed target'}; inline exception: ${item.inlineException}; spacing risk: ${item.spacingRisk}; nearby targets: ${item.nearbyTargets.map((nearby) => `${nearby.name || nearby.selector} (${nearby.centerDistance}px centre distance)`).join(', ') || 'none'}; axe target-size signal: ${Boolean(item.axeTargetSizeSignal || axeTargetSelectors.has(normalizeComponent(item.selector)))}`
      )),
      assignment: 'Development',
      effort: 'Small',
      translationRequired: 'No'
    }));
  }

  const disclosureGroups = new Map<string, DisclosureCheckResult[]>();
  for (const disclosure of audit.disclosures) {
    const family = disclosureFamily(audit, disclosure);
    disclosureGroups.set(family, [...(disclosureGroups.get(family) ?? []), disclosure]);
  }
  for (const [component, disclosures] of disclosureGroups) {
    const selectorsFor = (items: DisclosureCheckResult[]): string[] => [...new Set(items.map((item) => item.selector))];
    const namesFor = (items: DisclosureCheckResult[]): string => conciseList(
      items.map((item) => `“${item.name || 'unnamed disclosure'}”`),
      8
    );
    const evidenceFor = (kind: 'dom' | 'keyboard', items: DisclosureCheckResult[]) => items.map((item) => (
      evidence(kind, item.selector, JSON.stringify(item))
    ));
    const sharedComponentKey = createSharedComponentKey(component, `disclosure-family|${component}`);
    // Interaction errors are retained in ViewportAudit.disclosures and reflected
    // as tested-inconclusive coverage. An incomplete test is not an accessibility
    // defect and therefore must not create a Findings row.
    const completed = disclosures.filter((item) => (
      !item.error
      && (item.enterTargetVerified ?? item.activationTargetVerified) === true
      && item.enterTestCompleted === true
      && item.enterSettled === true
    ));
    const stateMatchesVisibility = (expanded: string | null, visible: boolean | null): boolean | null => {
      if ((expanded !== 'true' && expanded !== 'false') || (visible !== true && visible !== false)) return null;
      return (expanded === 'true') === visible;
    };
    const stateFailures = completed.filter((item) => {
      const beforeMatches = stateMatchesVisibility(item.beforeExpanded, item.controlledVisibleBefore);
      const afterMatches = stateMatchesVisibility(item.afterExpanded, item.controlledVisibleAfterOpen);
      const spaceEvidenceVerified = (item.spaceTargetVerified ?? item.activationTargetVerified) === true;
      const spaceMatches = item.spaceTestCompleted && spaceEvidenceVerified && item.spaceSettled === true
        ? stateMatchesVisibility(item.spaceAfterExpanded ?? null, item.controlledVisibleAfterSpace ?? null)
        : null;
      const enterVisibleChanged = (item.controlledVisibleBefore === true || item.controlledVisibleBefore === false)
        && (item.controlledVisibleAfterOpen === true || item.controlledVisibleAfterOpen === false)
        && item.controlledVisibleBefore !== item.controlledVisibleAfterOpen;
      const enterStateDidNotChange = item.beforeExpanded !== null
        && item.afterExpanded !== null
        && item.beforeExpanded === item.afterExpanded;
      const spaceVisibleChanged = item.spaceTestCompleted
        && spaceEvidenceVerified
        && item.spaceSettled === true
        && (item.controlledVisibleBefore === true || item.controlledVisibleBefore === false)
        && (item.controlledVisibleAfterSpace === true || item.controlledVisibleAfterSpace === false)
        && item.controlledVisibleBefore !== item.controlledVisibleAfterSpace;
      const spaceStateDidNotChange = item.spaceTestCompleted
        && spaceEvidenceVerified
        && item.spaceSettled === true
        && item.beforeExpanded !== null
        && item.spaceAfterExpanded !== null
        && item.beforeExpanded === item.spaceAfterExpanded;
      return beforeMatches === false
        || afterMatches === false
        || spaceMatches === false
        || (enterVisibleChanged && enterStateDidNotChange)
        || (spaceVisibleChanged && spaceStateDidNotChange);
    });
    if (stateFailures.length) {
      findings.push(makeFinding({
        identity: `disclosure-state-mismatch|${component}`,
        ruleId: 'disclosure-state-not-updated',
        classification: 'confirmed',
        severity: 'Serious',
        wcag: ['4.1.2'],
        summary: 'Disclosure state does not match the visible controlled content',
        issue: 'After the intended live control was keyboard-activated and the component settled, a fresh DOM query found that controlled-content visibility contradicted aria-expanded, or visibility changed without the state changing.',
        impact: 'Screen-reader users receive an incorrect expanded or collapsed state and cannot reliably determine whether the controlled content is available.',
        testing: 'Resolve one rendered, topmost control; record its ARIA state and controlled-content visibility in the same snapshot; activate it with Enter and Space; wait for JavaScript and animations to settle; re-query the control and panel; then compare the final values. A missing aria-controls value alone is not a failure.',
        remediation: 'Use a native button and synchronize aria-expanded with the actual controlled-content visibility whenever the component opens or closes.',
        component,
        sharedComponentKey,
        urls: [audit.url],
        viewports: [audit.viewport.name],
        selectors: selectorsFor(stateFailures),
        evidence: evidenceFor('keyboard', stateFailures),
        assignment: 'Development',
        effort: 'Small',
        translationRequired: 'No'
      }));
    }

    const focusOrderReviews = completed.filter((item) => item.tabEnteredControlledRegion === false);
    if (focusOrderReviews.length) {
      findings.push(makeFinding({
        identity: `disclosure-focus-order|${component}`,
        ruleId: 'disclosure-focus-order',
        classification: 'review',
        severity: 'Serious',
        wcag: ['2.4.3'],
        summary: 'Opening the disclosure bypasses its revealed controls',
        issue: `After opening ${namesFor(focusOrderReviews)}, the next Tab stop was outside the controlled region. Confirm the complete forward and reverse sequence before recording a WCAG failure.`,
        impact: 'Keyboard users may not discover or may need to navigate backwards to reach newly revealed controls.',
        testing: 'The disclosure was opened with Enter and the next Tab destination was compared with the aria-controls region. This remains a review signal because a single transition does not prove the complete focus order is illogical.',
        remediation: 'Place the trigger immediately before the revealed content in DOM order or move focus deliberately to the first relevant control when the interaction pattern requires it. Return focus predictably when closing.',
        component,
        sharedComponentKey,
        urls: [audit.url],
        viewports: [audit.viewport.name],
        selectors: selectorsFor(focusOrderReviews),
        evidence: evidenceFor('keyboard', focusOrderReviews),
        assignment: 'Development',
        effort: 'Medium',
        translationRequired: 'No'
      }));
    }
  }

  for (const tab of audit.tabs) {
    const component = normalizeComponent(tab.selector);
    const common = {
      component,
      sharedComponentKey: createSharedComponentKey(component, JSON.stringify(tab)),
      urls: [audit.url],
      viewports: [audit.viewport.name],
      selectors: [tab.selector],
      assignment: 'Development' as const,
      effort: 'Medium' as const,
      translationRequired: 'No' as const
    };
    if (tab.error) continue;
    if (!tab.navigationMovedToTab) {
      const otherTabsKeyboardUnreachable = tab.tabbableCount <= 1;
      findings.push(makeFinding({
        ...common,
        identity: `tabs-keyboard|${component}`,
        ruleId: otherTabsKeyboardUnreachable ? 'tabs-keyboard-unreachable' : 'tabs-arrow-key-navigation-review',
        classification: otherTabsKeyboardUnreachable ? 'confirmed' : 'review',
        severity: 'Serious',
        wcag: otherTabsKeyboardUnreachable ? ['2.1.1'] : ['Best Practice'],
        summary: otherTabsKeyboardUnreachable ? 'Other tabs are not keyboard reachable' : 'Review non-standard tab keyboard navigation',
        issue: otherTabsKeyboardUnreachable
          ? `${tab.navigationKey} did not move focus to another tab and only ${tab.tabbableCount} tab is in the page Tab sequence.`
          : `${tab.navigationKey} did not move focus to another tab, but ${tab.tabbableCount} tabs remain in the page Tab sequence.`,
        impact: otherTabsKeyboardUnreachable
          ? 'Keyboard users cannot reach the other tabs.'
          : 'The component may remain operable with Tab but does not follow the expected tab interaction pattern.',
        testing: `The selected or first tab was focused and ${tab.navigationKey} was pressed according to the tablist orientation; the number of tabs in the page Tab sequence was also checked. Home and End were recorded only as optional behavior and do not cause this finding.`,
        remediation: 'Implement Left/Right Arrow navigation for horizontal tablists or Up/Down Arrow navigation for vertical tablists, including wrapping at each end. Keep one active tab in the page Tab sequence after the expected arrow interaction works.',
        evidence: [evidence('keyboard', tab.selector, JSON.stringify(tab))]
      }));
    } else if (!tab.activationWorked) {
      findings.push(makeFinding({
        ...common,
        identity: `tabs-activation|${component}`,
        ruleId: 'tabs-keyboard-activation',
        classification: 'confirmed',
        severity: 'Serious',
        wcag: ['2.1.1', '4.1.2'],
        summary: 'Keyboard activation does not select the focused tab',
        issue: 'After focus moved to another tab, neither automatic selection nor Enter/Space activation updated aria-selected.',
        impact: 'Keyboard users may move to a tab but cannot activate or identify its selected state.',
        testing: 'After arrow-key navigation, automatic activation was checked, followed by Enter and Space for manual-activation implementations.',
        remediation: 'When a tab is activated, set aria-selected="true" on it, set the previous tab to false, update roving tabindex, and show the associated tabpanel.',
        evidence: [evidence('keyboard', tab.selector, JSON.stringify(tab))]
      }));
    }
    if (tab.structuralFailures.length) {
      findings.push(makeFinding({
        ...common,
        identity: `tabs-relationships|${component}|${tab.structuralFailures.join('|')}`,
        ruleId: 'tabs-broken-relationships',
        classification: 'confirmed',
        severity: 'Serious',
        wcag: ['1.3.1', '4.1.2'],
        summary: 'Tabs have broken states or panel relationships',
        issue: tab.structuralFailures.join(' '),
        impact: 'Assistive technologies may not identify the selected tab or its associated panel.',
        testing: 'The tab roles, aria-selected state, roving tabindex, aria-controls targets, tabpanel roles, and aria-labelledby relationships were checked in the rendered DOM.',
        remediation: 'Expose exactly one selected and tabbable tab, connect every tab to an existing role="tabpanel" with aria-controls, and label each panel from its owning tab with matching id and aria-labelledby values.',
        evidence: [evidence('dom', tab.selector, JSON.stringify(tab))]
      }));
    }
    if (tab.structuralReviews.length) {
      findings.push(makeFinding({
        ...common,
        identity: `tabs-relationships-review|${component}|${tab.structuralReviews.join('|')}`,
        ruleId: 'tabs-relationships-review',
        classification: 'review',
        severity: 'Moderate',
        wcag: ['4.1.2'],
        summary: 'Review tab and panel relationships',
        issue: tab.structuralReviews.join(' '),
        impact: 'The component may provide insufficient programmatic context between each tab and its panel.',
        testing: 'Optional or ambiguous relationship markup was inspected separately from deterministic broken references.',
        remediation: 'Give each tab and panel stable ids, reference the panel from aria-controls, and label the panel from its tab. Confirm the resulting relationship in supported assistive technologies.',
        evidence: [evidence('dom', tab.selector, JSON.stringify(tab))]
      }));
    }
  }

  for (const table of audit.dom.tablesForReview) {
    findings.push(makeFinding({
      identity: `table-semantics|${normalizeComponent(table.selector)}`,
      ruleId: 'table-semantics-review',
      classification: 'review',
      severity: 'Moderate',
      wcag: ['1.3.1'],
      summary: 'Review table headers and name',
      issue: table.reason,
      impact: 'Screen-reader users may not understand the table purpose or the relationship between headers and data cells.',
      testing: 'Rendered table markup was checked for header cells and a programmatic name.',
      remediation: 'Use tables only for data, provide descriptive header cells with correct scope or headers relationships, and add a caption or other programmatic name when needed.',
      component: normalizeComponent(table.selector),
      sharedComponentKey: createSharedComponentKey(normalizeComponent(table.selector), table.reason),
      urls: [audit.url],
      viewports: [audit.viewport.name],
      selectors: [table.selector],
      evidence: [evidence('dom', table.selector, table.reason)],
      assignment: 'Development',
      effort: 'Medium',
      translationRequired: 'Review'
    }));
  }

  if (audit.dom.autoplayMedia.length) {
    const selectors = audit.dom.autoplayMedia.map((item) => item.selector);
    findings.push(makeFinding({
      identity: `autoplay-media|${selectors.map(normalizeComponent).join('|')}`,
      ruleId: 'autoplay-media-review',
      classification: 'review',
      severity: 'Moderate',
      wcag: ['1.4.2', '2.2.2'],
      summary: 'Review automatically playing media',
      issue: 'A visible audio or video element has the autoplay attribute. This does not establish playback duration, audible output, motion, or the availability of controls, so WCAG failure requires timed manual confirmation.',
      impact: 'If audio plays for more than three seconds without a control, it can interfere with screen-reader output. If moving content continues for more than five seconds without pause, stop, or hide controls, it can distract users and impede reading.',
      testing: 'Observe actual playback for at least five seconds with audio enabled. Record whether audio lasts more than three seconds and whether parallel moving content lasts more than five seconds, then inspect the applicable controls.',
      remediation: 'If audio starts automatically and lasts more than three seconds, provide a mechanism to pause or stop it or independently control its volume. If moving content starts automatically and lasts more than five seconds in parallel with other content, provide pause, stop, or hide controls.',
      component: 'media',
      urls: [audit.url],
      viewports: [audit.viewport.name],
      selectors,
      evidence: selectors.map((selector) => evidence('dom', selector, 'Visible autoplay media element.')),
      assignment: 'Mixed',
      effort: 'Medium',
      translationRequired: 'No'
    }));
  }
  return findings;
}

export function findingsFromPage(page: PageAudit): Finding[] {
  return page.viewports
    .filter((audit) => !audit.cancelled)
    .flatMap((audit) => {
      const failed = (prefix: string): boolean => audit.errors.some((message) => message.startsWith(prefix));
      const interactionUnavailable = Boolean(audit.interactionBlocker);
      const evidenceGatedAudit: ViewportAudit = {
        ...audit,
        ...(failed('DOM checks error:') ? {
          dom: {
            h1Count: 1,
            mainCount: 1,
            unnamedLandmarks: [],
            missingAltImages: [],
            linkedImagesForReview: [],
            emptyLinks: [],
            emptyNamedControls: [],
            unlabeledFields: [],
            duplicateIds: [],
            smallTargets: [],
            tablesForReview: [],
            autoplayMedia: []
          }
        } : {}),
        ...(interactionUnavailable || failed('Keyboard checks error:') ? {
          keyboard: { sequence: [], journeys: [], completedCycle: false, truncated: false, scope: 'unknown' }
        } : {}),
        ...(interactionUnavailable || failed('Disclosure checks error:') ? { disclosures: [] } : {}),
        ...(interactionUnavailable || failed('Tab checks error:') ? { tabs: [] } : {}),
        ...(interactionUnavailable || failed('Link checks error:') ? { links: [] } : {}),
        ...(interactionUnavailable || failed('Responsive checks error:') ? {
          responsive: {
            horizontalOverflow: 0,
            overflowElements: [],
            textSpacingOverflow: 0,
            clippedElements: [],
            overlapPairs: [],
            lostInteractiveElements: []
          }
        } : {})
      };
      return [...axeFindings(audit), ...domFindings(evidenceGatedAudit)]
        .map((finding) => enrichComponent(finding, audit));
    });
}
