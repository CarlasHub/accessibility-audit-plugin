import type { ManualCheck } from '../types.js';

export const REQUIRED_MANUAL_CHECKS: ManualCheck[] = [
  {
    id: 'manual-keyboard-complete',
    title: 'Complete keyboard-only journey',
    wcag: ['2.1.1', '2.1.2', '2.4.3', '2.4.7', '2.4.11'],
    applicableTo: 'Every unique page template and interactive component state',
    procedure: 'Use Tab, Shift+Tab, Enter, Space, and pattern-appropriate arrow keys without a pointer. Test Escape only for patterns that require or document it, such as dialogs and applicable menus or popovers; do not require it for an ordinary accordion or disclosure. Confirm logical order, operation, no trap, visible focus, and no focus obscuration.'
  },
  {
    id: 'manual-screen-reader-combinations',
    title: 'Supported screen-reader and browser combinations',
    wcag: ['1.3.1', '2.4.3', '2.4.6', '3.2.4', '4.1.2', '4.1.3'],
    applicableTo: 'Navigation, forms, validation, search, tabs, dialogs, carousels, and dynamic status messages',
    procedure: 'Run the agreed production screen-reader and browser combinations manually, including desktop and mobile assistive technologies. Confirm names, roles, states, values, reading order, focus, instructions, errors, and dynamic announcements.'
  },
  {
    id: 'manual-zoom-reflow',
    title: 'Zoom, text resize, and reflow',
    wcag: ['1.4.4', '1.4.10', '1.4.12'],
    applicableTo: 'Every unique responsive template',
    procedure: 'Verify 200% browser zoom, 400% reflow at 1280 CSS pixels, and the WCAG text-spacing overrides. Check that content and controls remain available without two-dimensional scrolling except permitted content.'
  },
  {
    id: 'manual-contrast-states',
    title: 'Contrast in all component states',
    wcag: ['1.4.3', '1.4.11', '2.4.7', '2.4.11'],
    applicableTo: 'Text, icons, controls, validation, hover, focus, selected, disabled, and image backgrounds',
    procedure: 'Measure foreground/background pairs in every state, including gradients and imagery that automated tools cannot resolve.'
  },
  {
    id: 'manual-content-meaning',
    title: 'Content meaning and alternatives',
    wcag: ['1.1.1', '1.2.1', '1.2.2', '1.2.3', '1.2.5', '2.4.4', '2.4.6', '3.1.2'],
    applicableTo: 'Images, icons, video/audio, headings, labels, link text, and language changes',
    procedure: 'Confirm alternatives communicate the same purpose in context, captions and descriptions are accurate, headings/labels are descriptive, and language changes are identified.'
  },
  {
    id: 'manual-cognitive-and-consistency',
    title: 'Consistency, error prevention, and cognitive checks',
    wcag: ['3.2.3', '3.2.4', '3.2.6', '3.3.1', '3.3.3', '3.3.7', '3.3.8'],
    applicableTo: 'Repeated navigation, help, authentication, and data-entry flows',
    procedure: 'Confirm consistent order and naming, findable help, understandable errors and suggestions, redundant-entry handling, and accessible authentication.'
  },
  {
    id: 'manual-mobile-device',
    title: 'Physical mobile and touch testing',
    wcag: ['1.3.4', '2.5.1', '2.5.2', '2.5.4', '2.5.7', '2.5.8'],
    applicableTo: 'Responsive navigation, touch controls, drag interactions, and orientation changes',
    procedure: 'Test portrait and landscape on physical devices with touch and mobile screen readers. Confirm alternatives to multipoint, path-based, motion, and dragging gestures and assess target-spacing exceptions.'
  }
];
