# Accessibility Audit for Claude Code and Claude Desktop

Accessibility Audit runs evidence-backed WCAG 2.2 A/AA checks against explicit authorized page URLs and writes a validated Excel report, JSON evidence, linked component screenshots, and a portable ZIP. It does not crawl a site or certify conformance.

## Use

Ask Claude Code and Claude Desktop to use the Accessibility Audit plugin with one URL, several URLs, or one XLSX/CSV/TXT/JSON page-list file. The plugin confirms the exact scope, landing-page QA URL, and auditor before starting. The editable auditor default is `Automated`.

The audit runs headlessly at desktop, mobile, and 320px reflow sizes. It reports progress and supports graceful cancellation with partial output. A full-site audit requires a complete canonical URL list. Screen-reader, physical-device, content-meaning, and other judgment-based procedures remain guided manual checks.

## Isolation and first activation

Node.js 22 or later and npm must be available to the client. The first activation verifies the bundled runtime checksum and installs it into client-owned plugin data; it never modifies the project open in the editor. If no supported Chromium browser exists, the first confirmed audit installs Playwright Chromium once into the same private plugin storage unless automatic browser installation is disabled.

## Output

The default output is `Accessibility Audit Results` under the user's home directory. Extract the generated ZIP and keep `Accessibility_Audit_Report.xlsx` beside the `screenshots` tree so the workbook's relative evidence links work. Treat `confirmed`, `review`, `blocker`, and `manual` evidence categories separately; an empty automated result is not proof of accessibility.

The workbook is generated from a byte-identical copy of `Accessibility Testing Boilerplate v.4 (4)`. The five worksheet names and order, worksheet tab colours, existing colour scheme, formulas, validations, and 32 Accessibility Report fields are preserved. `Page Inventroy` contains only a headerless column-A list of unique URLs whose browser testing started. `Image Inventory` contains only a headerless column-A list of unique linked relative screenshot references. No inventory metadata columns, tables, or additional worksheets are added.

This directory is generated from the private Accessibility Audit source repository. Do not edit it directly.
