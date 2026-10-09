export const PUBLIC_SURFACE_V1_8_4 = {
  cli: {
    commands: ['audit [options] <inputs...>', 'validate <workbook>'],
    rootOptions: ['--help', '--version'],
    auditOptions: [
      '--aaa-advisory', '--allow-host', '--auditor', '--browser', '--channel', '--concurrency',
      '--config', '--exact-host', '--executable-path', '--headed', '--help', '--landing-page',
      '--max-links', '--max-pages', '--no-auto-install-browser', '--no-screenshots', '--output',
      '--report-name', '--staging-only', '--template', '--timeout', '--wcag-level', '--yes'
    ]
  },
  githubAction: {
    inputs: [
      'aaa-advisory', 'allowed-hosts', 'auditor', 'auto-install-browser', 'browser', 'browser-channel',
      'capture-screenshots', 'comment-on-pr', 'concurrency', 'fail-on', 'github-token',
      'exact-hosts', 'journeys', 'journeys-file', 'landing-page-url', 'max-pages', 'output-dir', 'report-name',
      'staging-only', 'timeout-ms', 'urls', 'wcag-level'
    ],
    outputs: [
      'archive-path', 'audited-pages', 'blockers', 'completed-pages', 'confirmed-findings',
      'gate-result', 'html-path', 'json-path', 'not-started-pages', 'output-dir',
      'partial-pages', 'report-path', 'requested-pages', 'review-findings', 'skipped-pages'
    ]
  },
  mcp: {
    requiredInputs: {
      audit_from_file: ['inputPath'],
      audit_pages: ['urls'],
      get_audit_instructions: [],
      list_guided_manual_checks: [],
      run_accessibility_audit: ['targets'],
      validate_accessibility_report: ['workbookPath']
    },
    legacyPayloads: {
      audit_from_file: {
        allowedHosts: ['preview.example.test'],
        auditor: 'Legacy auditor',
        autoInstallBrowser: false,
        captureScreenshots: true,
        channel: 'chrome',
        concurrency: 2,
        headless: true,
        inputPath: './pages.txt',
        landingPageUrl: 'https://preview.example.test/',
        maxLinksPerPage: 25,
        maxTabStops: 100,
        outputDir: './audit-output',
        reportName: 'legacy-report.xlsx',
        stagingOnly: true,
        templatePath: './template.xlsx',
        timeoutMs: 30_000
      },
      audit_pages: {
        allowedHosts: ['preview.example.test'],
        auditor: 'Legacy auditor',
        autoInstallBrowser: false,
        captureScreenshots: true,
        channel: 'chrome',
        concurrency: 2,
        headless: true,
        landingPageUrl: 'https://preview.example.test/',
        maxLinksPerPage: 25,
        maxTabStops: 100,
        outputDir: './audit-output',
        reportName: 'legacy-report.xlsx',
        stagingOnly: true,
        templatePath: './template.xlsx',
        timeoutMs: 30_000,
        urls: ['https://preview.example.test/']
      },
      get_audit_instructions: {
        allowedHosts: ['preview.example.test'],
        auditor: 'Legacy auditor',
        landingPageUrl: 'https://preview.example.test/',
        outputDir: './audit-output',
        stagingOnly: true,
        targets: 'https://preview.example.test/'
      },
      list_guided_manual_checks: {},
      run_accessibility_audit: {
        allowedHosts: ['preview.example.test'],
        auditor: 'Legacy auditor',
        autoInstallBrowser: false,
        captureScreenshots: true,
        channel: 'chrome',
        concurrency: 2,
        confirmed: true,
        headless: true,
        landingPageUrl: 'https://preview.example.test/',
        maxLinksPerPage: 25,
        maxTabStops: 100,
        outputDir: './audit-output',
        reportName: 'legacy-report.xlsx',
        stagingOnly: true,
        targets: ['https://preview.example.test/'],
        templatePath: './template.xlsx',
        timeoutMs: 30_000
      },
      validate_accessibility_report: {
        workbookPath: './legacy-report.xlsx'
      }
    },
    tools: {
      audit_from_file: [
        'allowedHosts', 'auditor', 'autoInstallBrowser', 'browserEngine', 'captureScreenshots', 'channel',
        'concurrency', 'exactHosts', 'headless', 'inputPath', 'landingPageUrl', 'maxLinksPerPage', 'maxPages',
        'maxTabStops', 'outputDir', 'reportName', 'stagingOnly', 'templatePath', 'timeoutMs'
      ],
      audit_pages: [
        'allowedHosts', 'auditor', 'autoInstallBrowser', 'browserEngine', 'captureScreenshots', 'channel',
        'concurrency', 'exactHosts', 'headless', 'landingPageUrl', 'maxLinksPerPage', 'maxPages', 'maxTabStops',
        'outputDir', 'reportName', 'stagingOnly', 'templatePath', 'timeoutMs', 'urls'
      ],
      get_audit_instructions: [
        'allowedHosts', 'auditor', 'exactHosts', 'landingPageUrl', 'maxPages', 'outputDir', 'stagingOnly', 'targets'
      ],
      list_guided_manual_checks: [],
      run_accessibility_audit: [
        'allowedHosts', 'auditor', 'autoInstallBrowser', 'browserEngine', 'captureScreenshots', 'channel',
        'concurrency', 'confirmed', 'exactHosts', 'headless', 'landingPageUrl', 'maxLinksPerPage', 'maxPages',
        'maxTabStops', 'outputDir', 'reportName', 'stagingOnly', 'targets', 'templatePath',
        'timeoutMs'
      ],
      validate_accessibility_report: ['workbookPath']
    }
  }
} as const;
