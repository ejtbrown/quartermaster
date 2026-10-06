// Accepted design standard. Does not import, modify, publish, or seed the application.
// Run from repository root with Node 24: node docs/design/style-guide.mjs
import { chromium } from '@playwright/test';
import { writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { format } from 'prettier';

const folder = dirname(fileURLToPath(import.meta.url));
const qaFolder = join(folder, '../../.local/style-guide');
const colors = {
  ink: '#172D3A',
  muted: '#52656E',
  brand: '#17635B',
  hover: '#124F49',
  pressed: '#0D3D38',
  canvas: '#F5F6F2',
  surface: '#FFFFFF',
  subtle: '#EEF2EF',
  selected: '#E8F3EF',
  divider: '#D7E0DC',
  control: '#81908C',
  focus: '#315ECA',
  sand: '#F4C7A1',
  success: '#256644',
  successBg: '#EAF5ED',
  warning: '#875200',
  warningBg: '#FFF4D6',
  danger: '#A33131',
  dangerBg: '#FDECEC',
  info: '#2C5DA8',
  infoBg: '#EDF3FF',
  ai: '#6952A3',
  aiBg: '#F3EFFA',
};
const escape = (v) =>
  String(v)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
const iconPaths = {
  assets:
    '<rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><rect x="14" y="14" width="6" height="6" rx="1"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7v.2"/>',
  work: '<path d="m14 5 5-1-1 5-4 1-6 10-4-4 10-6Z"/>',
  camera: '<path d="M8 6 9 3h6l1 3h5v14H3V6Z"/><circle cx="12" cy="13" r="4"/>',
  mic: '<rect x="9" y="3" width="6" height="12" rx="3"/><path d="M5 11v2a7 7 0 0 0 14 0v-2M12 20v2M8 22h8"/>',
  chevron: '<path d="m8 5 7 7-7 7"/>',
  arrow: '<path d="M4 12h16m-6-6 6 6-6 6"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  alert: '<path d="m12 3 10 18H2L12 3Z"/><path d="M12 9v5m0 3v.2"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 2"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  folder: '<path d="M3 7h7l2-3h9v16H3V7Z"/>',
  export: '<path d="M12 16V3m-4 4 4-4 4 4M4 14v7h16v-7"/>',
  edit: '<path d="m4 15 11-11 5 5L9 20l-6 1 1-6Zm9-9 5 5"/>',
};
const icon = (name, cls = '') =>
  `<svg class="icon ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${iconPaths[name] ?? iconPaths.info}</svg>`;
const mark = '<span class="mark">Q<span></span></span>';
const btn = (label, type = '', glyph = '') =>
  `<span class="btn ${type}">${glyph ? icon(glyph) : ''}${label}</span>`;
const badge = (label, kind = 'neutral', glyph = '') =>
  `<span class="badge ${kind}">${glyph ? icon(glyph) : ''}${label}</span>`;
const note = (title, body, cls = '') =>
  `<aside class="note ${cls}"><strong>${title}</strong><p>${body}</p></aside>`;
const list = (...items) =>
  `<ul>${items.map((v) => `<li>${v}</li>`).join('')}</ul>`;
const table = (head, rows, cls = '') =>
  `<table class="spec ${cls}"><thead><tr>${head.map((v) => `<th>${v}</th>`).join('')}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((v) => `<td>${v}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
const field = (label, value, hint = '', cls = '') =>
  `<div class="field ${cls}"><div class="field-label">${label}</div><div class="input">${value}</div>${hint ? `<div class="hint">${hint}</div>` : ''}</div>`;
const help = `<span class="help">${icon('info')}</span>`;
const pages = [];
const page = (section, title, deck, body, cls = '') =>
  pages.push({ section, title, deck, body, cls });
const nav = (selected = 'Assets') =>
  `<aside class="mock-nav"><div class="brand">${mark}<b>Quartermaster</b></div><div class="workspace">Quartermaster <span>⌄</span><small>Workspace</small></div><div class="nav-group">Everyday</div>${[
    ['assets', 'Assets'],
    ['mic', 'Capture'],
    ['work', 'Maintenance'],
    ['folder', 'Locations'],
  ]
    .map(
      ([i, l]) =>
        `<div class="nav-item ${l === selected ? 'on' : ''}">${icon(i)}${l}</div>`,
    )
    .join(
      '',
    )}<div class="nav-group">Planning &amp; records</div><div class="nav-text">Insurance</div><div class="nav-text">Incidents</div><div class="nav-text">Accounting</div><div class="nav-text">Reports</div><div class="nav-group">Manage</div><div class="nav-text">Asset types · Rules</div><div class="nav-text">Activity · Team · Settings</div><div class="nav-bottom">Help &amp; guidance ${icon('info')}</div></aside>`;
const assetRows = `<table class="asset-table"><thead><tr><th class="check-col">□</th><th>Asset</th><th>Location</th><th>Status</th><th class="num">Open tasks</th></tr></thead><tbody><tr><td>□</td><td><strong>Roof air conditioner</strong><small>Air conditioner · AC-014</small></td><td>Main building<small>Roof · northwest</small></td><td>${badge('Needs attention', 'warning')}</td><td class="num">2</td></tr><tr><td>□</td><td><strong>Kitchen refrigerator</strong><small>Appliance · AP-003</small></td><td>Fellowship hall<small>Kitchen</small></td><td>${badge('In service', 'success')}</td><td class="num">0</td></tr><tr><td>□</td><td><strong>Office air conditioner</strong><small>Air conditioner · AC-008</small></td><td>Office wing<small>Ground level</small></td><td>${badge('In service', 'success')}</td><td class="num">1</td></tr></tbody></table>`;
const hvac = `<svg viewBox="0 0 320 150" class="hvac" aria-label="Illustrated equipment placeholder"><path d="M30 120h260" stroke="#C5D6CC" stroke-width="3"/><path d="m78 40 28-16h138l-28 16Z" fill="#C9DCD2" stroke="#81908C"/><path d="M78 40h138v78H78Z" fill="#E7EDE6" stroke="#81908C"/><path d="m216 40 28-16v78l-28 16Z" fill="#AFC6B8" stroke="#81908C"/><circle cx="120" cy="79" r="26" fill="#F5F6F2" stroke="#81908C"/><circle cx="120" cy="79" r="6" fill="#81908C"/><path d="m120 58 5 15 16 6-16 5-5 16-5-16-16-5 16-6Z" fill="#8DA99B"/><path d="M162 60h36m-36 9h36m-36 9h36m-36 9h36m-36 9h36" stroke="#81908C" stroke-width="3"/><rect x="87" y="119" width="15" height="6" fill="#52656E"/><rect x="199" y="119" width="15" height="6" fill="#52656E"/></svg>`;

page(
  'Review proposal · v1.0',
  'Quartermaster',
  '',
  `
  <div class="cover-layout"><div><div class="cover-kicker">VISUAL STYLE &amp; UI COMPOSITION GUIDE</div><h1>A clear view.<br>A confident<br><em>next step.</em></h1><p class="cover-intro">A practical, welcoming interface for the people who care for buildings, equipment, and communities.</p><div class="cover-topics">Typography · Color · Layout<br>Components · Language · Interaction</div><div class="cover-version">Prepared for Erick Brown<br>October 6, 2026 · Design proposal for review</div></div>
  <div class="cover-art"><div class="cover-oval"></div><div class="cover-card"><div class="row between"><span class="brand">${mark}<b>Quartermaster</b></span>${badge('Workspace')}</div><h2>Your assets,<br>in good order.</h2><p>Know what you have.<br>See what needs attention.</p><div class="mini-stats"><div><b>24</b><span>Assets recorded</span></div><div><b>3</b><span>Tasks due soon</span></div></div><div class="cover-asset">${hvac}<div class="row between"><strong>Roof air conditioner</strong>${badge('Needs attention', 'warning')}</div><span class="muted">Main building · northwest roof</span></div><div class="row between" style="margin-top:18px">${btn('Add an asset', 'primary', 'plus')}<span class="text-link">View maintenance ${icon('arrow')}</span></div></div><div class="float-note">${icon('info')}<div><b>Clear labels. Useful help.</b><br>Confidence without clutter.</div></div><div class="specimen-tag">Illustrative design data only</div></div></div>
`,
  'cover',
);

page(
  '01 / Direction',
  'Businesslike, without feeling difficult.',
  'The interface should make a complex estate feel understandable—not make its complexity disappear.',
  `
<div class="cols"><div><div class="principle"><span>01</span><div><h3>Orient before asking</h3><p>Show the workspace, page purpose, asset context, and next useful action. People should not need to remember where they are.</p></div></div><div class="principle"><span>02</span><div><h3>Make the everyday path obvious</h3><p>Give common work a clear route. Put uncommon settings behind named disclosures, without hiding status or consequences.</p></div></div><div class="principle"><span>03</span><div><h3>Be warm through usefulness</h3><p>Readable text, calm spacing, human language, and recoverable mistakes provide the welcome. Avoid decoration that competes with work.</p></div></div><div class="principle"><span>04</span><div><h3>Earn trust in small details</h3><p>Distinguish unknown from zero, a suggestion from a fact, and a local edit from a server-confirmed save.</p></div></div></div>
<div><div class="panel"><h3>How to use this guide</h3>${table(
    ['Start here', 'Pages'],
    [
      ['Foundations: palette, type, spacing', '3–6'],
      ['Structure and representative screens', '7–9'],
      ['Forms, help, controls, dense information', '10–14'],
      ['Capture, AI, feedback, sensitive actions', '15–18'],
      ['Language, accessibility, handoff, review', '19–22'],
    ],
  )}</div>${note('Scope of this proposal', 'A light-theme system for the existing online-only, responsive web product. Native apps, offline behavior, and a dark theme are not introduced here. Navigation refinements and mockups are proposals—not screenshots or newly shipped features.', 'soft')}<p class="small muted">All equipment names, counts, amounts, and records shown in specimens are illustrative. Nothing in this guide is inserted into the live workspace.</p></div></div>
`,
);

const swatch = (name, key, role) =>
  `<div class="swatch"><div style="background:${colors[key]}"></div><strong>${name}</strong><code>${colors[key]}</code><p>${role}</p></div>`;
page(
  '02 / Color foundations',
  'A calm canvas. A clear accent.',
  'Teal marks intentional action. Warm whites and restrained borders keep dense information easy to scan.',
  `
<div class="swatches">${swatch('Ink', 'ink', 'Primary text and headings')}${swatch('Muted ink', 'muted', 'Supporting text—not faint text')}${swatch('Teal', 'brand', 'Primary actions, active navigation')}${swatch('Canvas', 'canvas', 'Page background')}${swatch('Surface', 'surface', 'Cards, tables, inputs')}${swatch('Soft surface', 'subtle', 'Quiet grouping and read-only areas')}${swatch('Selected', 'selected', 'Selection and active-row tint')}${swatch('Divider', 'divider', 'Decorative separators only')}${swatch('Control border', 'control', 'Essential field/control boundaries')}${swatch('Focus blue', 'focus', 'Keyboard focus ring')}${swatch('Sand', 'sand', 'Rare editorial warmth; not status')}${swatch('Teal hover', 'hover', 'Primary hover; pressed: #0D3D38')}</div>
<div class="cols three" style="margin-top:22px">${note('Let neutrals do most of the work', 'Start near 85% neutral surfaces, 10% brand, 5% semantic emphasis. This is a restraint heuristic, not a quota.')}${note('Give color a job', 'No alternating rainbow panels. Teal is not a synonym for “safe”; use a labeled status badge for a condition.')}${note('Use the named roles', 'Choose surface, text, border, and action tokens. Do not select an arbitrary green because it looks close.')}</div>
`,
);

const luminance = (hex) =>
  hex
    .slice(1)
    .match(/../g)
    .map((v) => parseInt(v, 16) / 255)
    .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
    .reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
const ratio = (a, b) => {
  const x = luminance(colors[a]),
    y = luminance(colors[b]);
  return ((Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)).toFixed(2);
};
page(
  '03 / Meaning & contrast',
  'Color reinforces meaning. It never carries it alone.',
  'Every state has plain-language text. Add a shape or icon when urgency or recognition benefits.',
  `
<div class="cols"><div class="stack">${[
    [
      'success',
      'successBg',
      'In service',
      'check',
      'Confirmed completion or a positive condition—not a guarantee of safety.',
    ],
    [
      'warning',
      'warningBg',
      'Needs attention',
      'alert',
      'Maintenance due, missing important detail, or a condition to review.',
    ],
    [
      'danger',
      'dangerBg',
      'Save failed',
      'alert',
      'An error, destructive action, or serious issue. Do not use for every overdue task.',
    ],
    [
      'info',
      'infoBg',
      'Export processing',
      'clock',
      'Neutral progress or explanatory information.',
    ],
    [
      'ai',
      'aiBg',
      'AI suggestion',
      'info',
      'Unconfirmed model output, kept distinct from saved facts.',
    ],
  ]
    .map(
      ([fg, bg, label, glyph, desc]) =>
        `<div class="semantic" style="background:${colors[bg]};color:${colors[fg]}"><div class="row">${icon(glyph)}<b>${label}</b></div><div class="small">${colors[fg]} on ${colors[bg]}</div><p>${desc}</p></div>`,
    )
    .join('')}</div><div><h3>Approved contrast pairs</h3>${table(
    ['Foreground / background', 'Ratio'],
    [
      ['Ink / white', ratio('ink', 'surface') + ':1'],
      ['Muted ink / canvas', ratio('muted', 'canvas') + ':1'],
      ['White / teal', ratio('surface', 'brand') + ':1'],
      ['Control border / white', ratio('control', 'surface') + ':1'],
      ['Focus blue / white', ratio('focus', 'surface') + ':1'],
      ['Success / success tint', ratio('success', 'successBg') + ':1'],
      ['Warning / warning tint', ratio('warning', 'warningBg') + ':1'],
      ['Danger / danger tint', ratio('danger', 'dangerBg') + ':1'],
      ['Information / information tint', ratio('info', 'infoBg') + ':1'],
      ['AI / AI tint', ratio('ai', 'aiBg') + ':1'],
    ],
    'compact',
  )}${note('Acceptance thresholds', 'Normal text: ≥4.5:1. Large text: ≥3:1 (24 CSS px regular or about 18.67 px bold). Essential control boundaries and graphical indicators: ≥3:1 against adjacent colors. Recheck actual combinations, including hover and focus. [1, 2]', 'soft')}<p class="small muted">Ratios calculated from these exact sRGB hex values using WCAG relative luminance. Divider gray and sand are not approved text or essential-control colors.</p></div></div>
`,
);

page(
  '04 / Typography',
  'Readable first. Distinctive in the right places.',
  'Two complementary families: a composed heading voice and a humanist workhorse for everyday use.',
  `
<div class="type-pair"><div><div class="eyebrow">HEADINGS &amp; WORDMARK</div><div class="type-display">Manrope</div><p class="manrope">Aa Bb 0123456789<br>Know what needs attention.</p><span class="small muted">Weights 600 / 700 · no light display weights</span></div><div><div class="eyebrow">INTERFACE, BODY &amp; DATA</div><div class="type-display source">Source Sans 3</div><p style="font-size:22px">Aa Bb 0123456789<br>Replacement cost · $12,500.00</p><span class="small muted">Weights 400 / 600 / 700 · italic only when meaningful</span></div></div>
<div class="cols" style="margin-top:24px"><div>${table(
    ['Role', 'CSS size / line', 'Weight'],
    [
      ['Page title', '32 / 40 px; phone 28 / 36', 'Manrope 700'],
      ['Section / card title', '24 / 32; 18 / 26 px', 'Manrope 600'],
      ['Body / input / button', '16 / 24 px', 'Source Sans 400 / 600'],
      ['Field label / table cell', '14 / 20 px', 'Source Sans 600 / 400'],
      ['Secondary metadata', '13 / 18 px minimum', 'Source Sans 400'],
    ],
    'compact',
  )}</div><div><h3>Composition rules</h3>${list('Use sentence case. Reserve uppercase for short group labels, not buttons or paragraphs.', 'Keep reading text around 45–75 characters per line. Use left alignment; do not justify.', 'Use tabular numerals for aligned money, dates, counts, and comparison columns. Right-align amounts.', 'Do not shrink core content to fit. Wrap labels, enlarge the container, or simplify the composition.')}<p class="small muted">Self-host licensed WOFF2 files in implementation; use <code>font-display: swap</code> and system fallbacks. This PDF embeds font subsets. Both families use SIL Open Font License 1.1; keep the license notices with distributed font files. [6, 7]</p></div></div>
`,
);

page(
  '05 / Layout & rhythm',
  'Use space to explain the structure.',
  'A 4-pixel rhythm, deliberate grouping, and a limited elevation system make complexity feel organized.',
  `
<div class="cols"><div><h3>Spacing scale · CSS px</h3><div class="spacing-demo">${[4, 8, 12, 16, 24, 32, 48, 64].map((n) => `<div><b>${n}</b><span style="width:${n * 3}px"></span></div>`).join('')}</div><p>Use 4–8 within a control, 12 between related controls, 16 within compact groups, 24 between field groups, and 32–48 between page sections.</p><div class="surface-demo"><div><b>Page</b><span>Warm canvas</span></div><div><b>Surface</b><span>White + 1 px divider</span></div><div><b>Overlay</b><span>One restrained shadow</span></div></div></div><div>${table(
    ['Constraint', 'Default'],
    [
      ['Page content', 'Max 1440 px; centered within shell'],
      ['Page padding', '32 px desktop · 24 tablet · 16 phone'],
      ['Navigation rail', '240 px desktop; drawer below 1024 px'],
      ['Columns / gutters', '12 desktop / 24 px; 4 phone / 16 px'],
      ['Editor width', '720 px reading/editing; ≤2 field columns'],
      ['Corner radius', '8 px controls; 12 cards; 16 dialogs'],
      ['Control height', '44 px normal; 48 px capture controls'],
      ['List/table row', '56 px comfortable; 44 px optional dense'],
    ],
    'compact',
  )}${note('Density is a choice—not a squeeze', 'Default to comfortable. A desktop compact mode may reduce padding and row height, but not core text below 14 px or touch targets below 44 px. Do not carry dense mode onto a phone.', 'soft')}<p class="small muted">Prefer borders and spacing over nested cards. At most two surface levels inside the page. Shadow: <code>0 8px 24px #172D3A1F</code>; reserve it for menus, popovers, and dialogs.</p></div></div>
`,
);

page(
  '06 / Navigation & hierarchy',
  'Group by the work people came to do.',
  'Replace the visual effect of a wall of equal buttons with stable places, a clear current location, and local actions.',
  `
<div class="nav-study"><div class="standalone-nav">${nav()}</div><div><h3>Recommended information architecture</h3>${table(
    ['Group', 'Destinations / intent'],
    [
      ['Everyday', 'Assets · Capture · Maintenance · Locations'],
      ['Planning & records', 'Insurance · Incidents · Accounting · Reports'],
      ['Manage', 'Asset types · Rules · Activity · Team · Settings'],
    ],
  )}<p>Use <b>Maintenance</b> in place of the ambiguous “Work,” and <b>Asset types</b> in place of “Types.” Keep the underlying permissions and capabilities unchanged.</p><h3 style="margin-top:20px">One page, one obvious priority</h3><p>Page title + one-sentence purpose → primary action → filters or local tabs → working content. Use real links for navigation and buttons for actions. Asset tabs belong within the asset, not beside global destinations.</p><div class="mobile-nav"><span>${icon('assets')}Assets</span><span>${icon('mic')}Capture</span><span>${icon('work')}Maintenance</span><span>${icon('menu')}More</span></div><p class="small muted">Phone proposal: four labeled destinations; More opens grouped navigation. Hide the bottom bar while the software keyboard is open if it would obstruct editing. Keep workspace switching in the header; never mix records across workspaces.</p>${note('Permissions & discovery', 'Omit actions a role cannot perform. Where context requires an unavailable capability, show a read-only explanation—not a mysterious disabled button. No “coming soon” controls.', 'soft')}</div></div>
`,
);

page(
  '07 / Desktop specimen',
  'The asset register: calm, capable, scannable.',
  'The working area gets the space. Selection, search, status, and next actions have distinct visual roles.',
  `
<div class="app-frame register">${nav()}<main class="mock-main"><div class="row between"><div><div class="breadcrumb">Quartermaster / Assets</div><h2>Assets</h2><p class="muted">See what you have and what needs attention.</p></div>${btn('Add an asset', 'primary', 'plus')}</div><div class="stat-strip"><div><b>24</b><span>Assets recorded</span></div><div><b>4</b><span>Need attention</span></div><div><b>3</b><span>Tasks due this month</span></div></div><div class="toolbar"><span class="search-box">${icon('search')}Search name, location, model or tag</span>${btn('Filters · 2')}${btn('Export', '', 'export')}</div><div class="row filter-row">${badge('Main building ×')}${badge('Active assets ×')}<span class="text-link">Clear filters</span><span class="push muted">Saved views ⌄</span></div><div class="table-card">${assetRows}<div class="row between table-footer"><span>Showing 1–3 of 12 matching assets</span><span>Previous &nbsp; <b>Next →</b></span></div></div><p class="small muted">Values not recorded are shown as “Not recorded,” never silently treated as zero.</p></main></div>
<div class="caption-grid"><div><b>01 · Stable orientation</b><p>Workspace and current destination stay visible.</p></div><div><b>02 · Visible scope</b><p>Applied filters and matching count stay together.</p></div><div><b>03 · Specific next step</b><p>Add, inspect, or export—without competing accents.</p></div></div><p class="specimen-caption">Proposed UI · illustrative records only · specimens are scaled; written component dimensions are authoritative.</p>
`,
);

page(
  '08 / Asset detail specimen',
  'An asset is a story—not a form with everything open.',
  'Start with identity, location, condition, and upcoming work. Put editing and deeper records in named sections.',
  `
<div class="detail-frame"><div class="breadcrumb">Assets / Main building / Roof air conditioner</div><div class="row between"><div><h2>Roof air conditioner</h2><p class="muted">AC-014 · Main building › Roof › Northwest corner</p></div><div class="row">${badge('Needs attention', 'warning')}${btn('Edit asset', '', 'edit')}</div></div><div class="tabs"><b>Overview</b><span>Photos</span><span>Maintenance</span><span>Readings</span><span>History</span></div><div class="detail-grid"><div><div class="photo-placeholder">${hvac}<span>Whole unit photo · illustration placeholder</span></div><div class="data-grid"><div><span>Asset type</span><b>Air conditioner</b></div><div><span>Asset tag</span><b>AC-014</b></div><div><span>Manufacturer</span><b>Not recorded</b></div><div><span>Serial number</span><b>Not recorded</b></div></div></div><div><div class="task-card"><div class="row between"><h3>Upcoming maintenance</h3><span class="text-link">View all</span></div><b>Replace tubing insulation</b><p>Due Dec 31, 2026</p>${badge('Open', 'warning')}<p class="small">Weathering noted during the last inspection.</p>${btn('View task', '', 'chevron')}</div><div class="access-note">${icon('info')}<div><b>Access note</b><p>Coil cover screws are rounded out. Plan additional work before coil maintenance.</p></div></div><div class="row between" style="margin-top:18px"><span class="muted">Details last updated Oct 6, 2026</span><span class="text-link">View history</span></div></div></div></div>
<div class="caption-grid"><div><b>Keep context in view</b><p>Use a location path; do not lead with internal UUIDs.</p></div><div><b>Separate read and edit</b><p>Read-only facts are text, not a wall of disabled inputs.</p></div><div><b>Keep consequences visible</b><p>Access constraints stay near the relevant work.</p></div></div>
`,
);

page(
  '09 / Forms & validation',
  'Ask clearly. Explain just enough.',
  'Visible labels are permanent. A placeholder is an example, never the only explanation of a field.',
  `
<div class="cols"><div class="panel form-specimen"><div class="row between"><h3>Financial details</h3>${badge('Optional')}</div><p class="muted">Add what you know. You can complete this later.</p>${field('Replacement cost (USD) ' + help, '12,500.00', 'Estimated cost to replace this asset today.')}<div class="cols narrow-gap">${field('Purchase date', 'Oct 6, 2020', 'Use the date on your purchase record.')}${field('Useful life (years) ' + help, '10', 'Used in depreciation estimates.')}</div>${field('Asset tag <span class="optional">(optional)</span>', 'AC-014', 'A label your team uses to identify this asset.')}<div class="field error-field"><div class="field-label">Asset name</div><div class="input">&nbsp;</div><div class="error-copy">${icon('alert')}Enter an asset name, such as “Roof air conditioner.”</div></div><div class="row" style="margin-top:18px">${btn('Save changes', 'primary')}${btn('Cancel', 'quiet')}</div></div><div><h3>Field anatomy</h3>${list('<b>Label:</b> a familiar noun phrase, above the input. State units in the label or a clearly associated unit control.', '<b>Helper text:</b> one useful sentence for requirements or interpretation. Keep it visible while typing.', '<b>Optional detail:</b> an information button for examples, purpose, or calculation rules. Do not conceal required instructions there.', '<b>Error:</b> explain what to fix and how. Keep entered values; do not rely on a red border.')}<h3>Interaction rules</h3>${list('Use one field per row on phones. Pair fields only when their relationship is obvious and space is sufficient.', 'Mark required fields in text, or state a consistent required/optional convention at the group start.', 'Validate after a meaningful interaction or submission, not on every first keystroke.', 'On failed submission, focus an error summary linked to invalid fields. Associate each inline error with its input.')}<p class="small muted">Avoid surprise autosave. Distinguish “Save draft” from “Create asset.” Guard navigation only when edits would actually be lost.</p></div></div>
`,
);

page(
  '10 / Explanatory help',
  'Help should answer “What is this, and why does it matter?”',
  'Start with a clear label. Add the smallest explanation that removes uncertainty.',
  `
<div class="cols"><div><div class="help-demo"><div class="field-label">Replacement cost (USD) <span class="help active">${icon('info')}</span></div><div class="input">12,500.00</div><div class="hint">Estimated cost to replace this asset today.</div><div class="help-pop"><div class="row between"><h3>About replacement cost</h3>${icon('close')}</div><p>The amount you expect to pay for an equivalent replacement, including installation if your estimate includes it.</p><p><b>Why we ask:</b> this supports planning and insurance summaries. It is different from purchase price and depreciated book value.</p><p><b>If you do not know:</b> leave it blank. Do not enter zero to mean unknown.</p><span class="text-link">How financial estimates are used →</span></div></div><div class="small muted" style="margin-top:16px">Open-state design specimen. On a narrow phone, reveal the same content directly below the field instead of covering surrounding controls.</div>${note('A repeatable help-content shape', 'Meaning → why it matters → example or format → what to do if unknown. Add an effect or privacy warning when relevant.', 'soft')}</div><div>${table(
    ['Use', 'For'],
    [
      ['Label', 'The name or action itself: “Save draft”'],
      ['Persistent helper', 'Required format, units, important consequences'],
      [
        'Tooltip',
        'A brief, noninteractive clarification; never the only instruction',
      ],
      [
        'Information disclosure',
        'Domain concepts, examples, calculation explanations',
      ],
      ['Help page / side panel', 'Multi-step procedures or a full reference'],
    ],
    'compact',
  )}<h3 style="margin-top:18px">Behavior contract</h3>${list('Make the (i) a real button with an accessible name, such as “About replacement cost.” Give its hit area 44 × 44 px even if the icon is 20 px.', 'Open on click, tap, Enter, or Space. Publish expanded state and the controlled content relationship. [5]', 'A nonmodal help panel keeps normal focus order; do not trap focus. Escape closes it; an explicit close button is available. Return focus if focus was inside when closed.', 'Hover/focus tooltips must be dismissible, hoverable, and persistent while needed. They contain no links or controls. Essential guidance remains visible without hover. [3]')}</div></div>
`,
);

page(
  '11 / Controls & states',
  'A small, consistent vocabulary of actions.',
  'Visual priority follows consequence and frequency—not the number of controls on the page.',
  `
<div class="control-specs"><div><h3>Primary</h3>${btn('Save changes', 'primary', 'check')}<p>One dominant action per working area. Teal fill, white text.</p></div><div><h3>Secondary</h3>${btn('Add a photo', '', 'camera')}<p>White surface, control border, ink text. Support the main task.</p></div><div><h3>Tertiary</h3>${btn('Cancel', 'quiet')}<p>Text treatment, visible focus, full hit target. No ghostly gray text.</p></div><div><h3>Destructive</h3>${btn('Delete asset', 'danger')}<p>Red only where a destructive choice is being deliberately confirmed.</p></div></div>
<div class="state-row"><div>${btn('Save changes', 'primary')}<b>Default</b></div><div>${btn('Save changes', 'hover')}<b>Hover</b></div><div>${btn('Save changes', 'pressed')}<b>Pressed</b></div><div>${btn('Save changes', 'primary focus')}<b>Keyboard focus</b></div><div>${btn('Saving…', 'loading', 'clock')}<b>Pending</b></div></div>
<div class="cols" style="margin-top:22px"><div><h3>Control rules</h3>${list('44 px minimum hit height; 48 px for capture. At least 8 px between neighboring actions. Icon-only targets are square.', 'Use action + object: “Add location,” “Run report,” “Delete photo.” Use tooltips for icon-only buttons plus accessible names.', 'Show a pending label, prevent duplicate submission, and preserve button width to avoid movement.', 'Disabled controls must have an adjacent reason when it is not obvious. Do not reduce the whole control to unreadable opacity.')}</div><div><h3>Use the right shape</h3>${list('Checkboxes select independent options; radios choose one of a small visible set.', 'Use switches only for settings that take effect immediately. Use a checkbox for a setting saved with a form.', 'A segmented control is for a small set of peer views, not unrelated destinations.', 'Menus contain secondary actions. Do not hide the only Save, required step, or current error in a menu.')}<p class="small muted">Focus: 3 px #315ECA outer ring with a 2 px white separation. Never remove focus without an equally visible replacement. Use a native button, not a styled div.</p></div></div>
`,
);

page(
  '12 / Tables, search & selection',
  'Dense information can still be generous.',
  'Support scanning, comparison, and a deliberate next step without turning every row into a control panel.',
  `
<div class="table-card">${assetRows}</div><div class="row bulk-bar">${badge('2 selected', 'info')}<b>Selected on this page</b><span class="push">${btn('Export selected', '', 'export')}${btn('Clear selection', 'quiet')}</span></div>
<div class="cols" style="margin-top:26px"><div><h3>Scanning & comparison</h3>${list('Lead with asset name and a useful identifier. Keep location and condition close; put secondary metadata on a second line.', 'Align text left, amounts right, and column headings with their values. Show currency, units, and date meaning.', 'Use thin horizontal dividers; avoid a full spreadsheet grid. Header tint is subtle and not the only header cue.', 'Use an actual asset-name link. A row may be clickable as an enhancement, never as the only keyboard route.')}<p class="small muted">If sorting is supported, make the column heading a button and expose its sort state. Do not draw sort arrows for an unsupported operation.</p></div><div><h3>Search, filters & bulk work</h3>${list('Label the search scope. “Search assets” does not imply a natural-language assistant.', 'Show applied filters, result count, and a clear reset action. Preserve filters when returning from a detail page.', 'Make selection scope explicit: this page, loaded records, or every matching result. Never silently widen it.', 'At narrow widths, use asset cards with labeled key facts. For true comparison tables, provide a labeled horizontal-scroll region and an alternative summary.')}<p class="small muted">Pagination/loading and export scope must agree. Never label a partial-page total as an estate total. Preserve filter and selection context through errors.</p></div></div>
`,
);

page(
  '13 / Reports & charts',
  'Explain the number before decorating it.',
  'Reports must reveal scope, assumptions, completeness, and what the user can do with the result.',
  `
<div class="report-frame"><div class="row between"><div><div class="eyebrow">INSURANCE SUMMARY · ILLUSTRATIVE</div><h2>Replacement cost by location</h2><p class="muted">Recorded estimates · As of Oct 6, 2026 · USD</p></div>${btn('Download report', '', 'export')}</div><div class="report-grid"><div><div class="bar-line"><span>Main building</span><div><i style="width:88%"></i></div><b>$48,000</b></div><div class="bar-line"><span>Fellowship hall</span><div><i style="width:60%"></i></div><b>$32,500</b></div><div class="bar-line"><span>Office wing</span><div><i style="width:24%"></i></div><b>$13,000</b></div><div class="axis">0 <span>USD · linear scale starts at zero</span></div><span class="text-link">View the data table</span></div><aside><span class="muted">Recorded replacement cost</span><strong class="report-total">$93,500</strong><p>20 of 24 assets have a recorded estimate.</p>${badge('4 estimates missing', 'warning', 'alert')}<p class="small">Missing values are excluded, not treated as zero.</p></aside></div></div>
<div class="cols" style="margin-top:22px"><div><h3>Chart grammar</h3>${list('Prefer labeled horizontal bars for category comparisons and a line for change over time.', 'Use direct labels and restrained gridlines. Avoid 3D effects, gradients, decorative gauges, and tiny donut segments.', 'Do not encode categories by hue alone. Provide labels, accessible text, and a data table.', 'For multiple series, use teal #17635B, blue #2C5DA8, violet #6952A3, and ochre #875200 with line styles or patterns.')}</div><div><h3>Reporting grammar</h3>${list('Show applied filters, as-of date, units, and whether figures are recorded, calculated, estimated, or partial.', 'Place assumptions next to the result; offer calculation detail through a labeled disclosure.', 'Make a printable/exported report self-contained: title, workspace, scope, generation date, units, caveats, and page numbers.', 'Never present management depreciation estimates as a certified insurance settlement, tax calculation, or posted ledger balance.')}</div></div>
`,
);

const phone = (body, title) =>
  `<div class="phone"><div class="phone-top"><b>Quartermaster</b>${icon('menu')}</div><div class="phone-body">${body}</div><div class="phone-bottom">${title}</div></div>`;
page(
  '14 / Mobile capture',
  'One useful step at a time.',
  'Large targets, clear recording state, and a visible manual path help people work with their hands and attention occupied.',
  `
<div class="phones">${phone(`<div class="eyebrow">NEW ASSET · CAPTURE</div><h2>What are we adding?</h2><div class="chat">Tell me about the asset and where it is located.</div><div class="voice-orb">${icon('mic')}</div><p class="center"><b>Ready to record</b><br><span class="muted">Tap to speak · up to 20 seconds</span></p>${btn('Record answer', 'primary', 'mic')}<span class="text-link">Type an answer instead</span><div class="phone-note">Stay online. Save your draft before leaving.</div>`, '01 · Ask')}${phone(`<div class="eyebrow">ADD A PHOTO</div><h2>Photograph the nameplate</h2><p class="muted">Keep the model and serial number in focus.</p><div class="camera-frame"><div class="nameplate">MODEL &nbsp; EX-240<br>SERIAL &nbsp; 001234<br>VOLTS &nbsp; 208/230</div><span>Camera preview</span></div>${btn('Take photo', 'primary', 'camera')}${btn('Choose existing photo')}<span class="text-link">Skip this photo</span>`, '02 · Capture')}${phone(`<div class="eyebrow">HUMAN REVIEW</div><h2>Does this look right?</h2>${badge('AI suggestion', 'ai', 'info')}${field('Asset name', 'Roof air conditioner')}${field('Location', 'Main building · northwest roof')}<div class="phone-task"><b>Proposed maintenance</b><p>Replace tubing insulation<br>Due Dec 31, 2026</p></div><p class="small">□ I have reviewed these details.</p>${btn('Create reviewed asset', 'primary', 'check')}<span class="text-link">Save draft</span>`, '03 · Confirm')}</div>
<div class="caption-grid"><div><b>Recording is explicit</b><p>No always-listening behavior. Stop or discard stays available.</p></div><div><b>Camera is optional</b><p>Request permission in context. File upload and manual entry remain usable.</p></div><div><b>Review is separate from saving</b><p>Read back or display proposed facts. A model does not authorize a save.</p></div></div>
`,
);

page(
  '15 / AI & media',
  'Make assistance visible—and uncertainty correctable.',
  'AI is a data-entry partner. The person remains in control of the record and of physical work.',
  `
<div class="cols"><div class="panel"><div class="row between"><h3>Nameplate interpretation</h3>${badge('AI suggestion', 'ai', 'info')}</div><div class="ai-proof"><div class="nameplate">MODEL &nbsp; EX-240<br>SERIAL &nbsp; 001234<br>VOLTS &nbsp; 208/230</div><p class="small muted">Nameplate image · illustrative crop<br>Open original view to inspect detail</p></div><div class="suggestion-row"><span>Model</span><b>EX-240</b>${btn('Use value', 'small-btn')}</div><div class="suggestion-row"><span>Serial number</span><b>001234</b>${badge('Check against photo', 'warning')}</div><p>“I can read the model, but the serial number needs a closer look. Please check it before saving.”</p><div class="row">${btn('Apply to review form', 'primary')}${btn('Edit manually', 'quiet')}</div><p class="small muted">Applying a suggestion changes the review form, not the saved asset.</p></div><div><h3>Presentation rules</h3>${list('Keep extracted values near the source photo. Provide zoom, rotate/view controls where supported, and a full-image view.', 'Use factual uncertainty language: “Not readable” or “Please confirm.” Do not display precision percentages unless confidence is calibrated and explained.', 'Show which fields would change before applying a suggestion. Preserve existing values unless the person approves replacement.', 'Give photos a human-readable purpose: Nameplate, Whole unit, Damage detail, or Other. Never infer condition or maintenance history from a generic image.')}${note('A safe assistant does not push for access', 'Accept “I cannot take that photo.” Record access constraints and volunteered readings. Never turn a visual prompt into an instruction to open energized equipment or attach instruments.', 'soft')}<h3 style="margin-top:16px">Privacy in context</h3><p>Explain microphone/camera use before the permission prompt. Label recording state. Raw audio is not retained; transcript text expires after 15 days. Optional device-spoken replies disclose the device speech-service boundary.</p></div></div>
`,
);

page(
  '16 / Feedback & resilience',
  'Always tell the truth about what happened.',
  'A calm interface can still be explicit about waiting, errors, and uncertain outcomes.',
  `
<div class="feedback-grid"><div class="feedback-card"><div class="row">${icon('assets')}<h3>No assets yet</h3></div><p>Start with one asset. You can type its details or use guided capture.</p>${btn('Add your first asset', 'primary')}</div><div class="feedback-card info"><div class="row">${icon('clock')}<h3>Waking your workspace…</h3></div><p>After a quiet period, this may take about a minute. Your request is still in progress.</p><div class="skeleton"></div><div class="skeleton short"></div></div><div class="feedback-card success"><div class="row">${icon('check')}<h3>Changes saved</h3></div><p>Roof air conditioner was updated on the server.</p><span class="small">Show only after confirmed completion.</span></div><div class="feedback-card warning"><div class="row">${icon('alert')}<h3>Connection lost</h3></div><p>Your unsaved input is still in this tab. Reconnect, then retry. Do not close this tab.</p>${btn('Retry save')}</div><div class="feedback-card danger"><div class="row">${icon('alert')}<h3>This record changed</h3></div><p>Someone saved a newer version. Review it before applying your changes.</p>${btn('Review newer version')}</div><div class="feedback-card"><div class="row">${icon('info')}<h3>Sign in again to continue</h3></div><p>Sign in in a new tab, then refresh this session. Keep this tab open to preserve unsaved input.</p>${btn('Sign in again')}${btn('Refresh session', 'quiet')}</div></div>
<div class="cols" style="margin-top:18px"><p><b>Persistent for consequences.</b> Keep errors and recovery actions next to the affected task. Use a brief polite status announcement for routine saves; reserve assertive announcements for a blocker. Do not toast every background event.</p><p><b>No invented progress.</b> Use a determinate bar only with a measured denominator. Otherwise show the current stage and elapsed wait. Distinguish “No matches,” “Not loaded,” and “None recorded.” Do not imply offline queuing or device-persistent drafts.</p></div>
`,
);

page(
  '17 / Sensitive actions & trust',
  'Reduce accidental harm without making routine work tedious.',
  'Confirmation should explain the target and consequence. It is not a substitute for permissions or recovery controls.',
  `
<div class="cols"><div class="dialog-stage"><div class="dialog"><div class="row between"><h2>Delete this asset?</h2>${icon('close')}</div><p><b>Roof air conditioner</b><br><span class="muted">AC-014 · Main building · northwest roof</span></p><p>This removes the asset from active views and starts purging its live records and photos. This action cannot be undone in Quartermaster.</p><div class="warning-block"><b>About retained backups</b><p>Isolated backups may retain copies until expiry, up to 90 days. Deleted content must be purged before a restored workspace is reopened.</p></div><div class="row end">${btn('Cancel')}${btn('Delete asset', 'danger')}</div></div><p class="small muted">For a whole-workspace deletion, also require its exact name. Default focus goes to Cancel; destructive confirmation requires recent authentication.</p></div><div><h3>Disclosure at the point of consequence</h3>${table(
    ['Data', 'Plain-language policy'],
    [
      ['Original photos', 'Kept for 15 days'],
      [
        'Resized asset photos',
        'Kept until the user, asset, or workspace deletes them',
      ],
      ['Transcripts / unaccepted AI proposals', 'Expire after 15 days'],
      ['Audit records', 'Kept for one year'],
      [
        'Isolated backups / deletion ledger',
        'Up to 90 days; replay deletions before restored access',
      ],
    ],
    'compact',
  )}<h3 style="margin-top:20px">Interaction rules</h3>${list('Keep Delete separate from Save and ordinary row actions. Confirm the exact target, including bulk-selection scope.', 'After acceptance, show “Removed from active views; purge in progress” until the worker confirms completion.', 'Do not offer an Undo control unless the operation is genuinely reversible.', 'A modal has a title, accessible description, contained focus, Escape behavior, and focus restoration. If its initiating item disappears, return to a sensible surviving control.')}<p class="small muted">Compliance holds remain a future product decision. Do not imply that a hold, legal certification, or guaranteed restore has been implemented by styling a badge.</p></div></div>
`,
);

page(
  '18 / Language & help library',
  'Write for a capable person who does not know our database.',
  'Use familiar terms, specific verbs, and short explanations. Be respectful—not breezy, cute, or alarmist.',
  `
${table(
  ['Avoid', 'Prefer', 'Why / accompanying help'],
  [
    [
      'Entity / object / estate item',
      'Asset',
      'One consistent noun for equipment or other tracked property.',
    ],
    ['Work', 'Maintenance', 'Names the activity people are looking for.'],
    ['Types', 'Asset types', 'Makes the scope of the setting clear.'],
    [
      'Submit / Execute',
      'Save changes / Run report',
      'Names the action and its result.',
    ],
    [
      'Depreciated NBV',
      'Estimated book value ' + help,
      'Explain cost, useful life, depreciation, and the estimate’s limits.',
    ],
    [
      'Compliance status',
      'Data completeness',
      'Use only the claim the calculation actually supports.',
    ],
    [
      'Null / — / 0 for missing data',
      'Not recorded',
      'Zero is a real value; missing information is different.',
    ],
    [
      'Oops! Something went wrong.',
      'We could not confirm the save.',
      'Keep input and show the next safe recovery action.',
    ],
  ],
  'compact',
)}
<div class="cols" style="margin-top:22px"><div><h3>Reusable help examples</h3><p><b>Useful life:</b> “How many years you expect to use this asset. Used to estimate depreciation—not to predict its failure date.”</p><p><b>Access constraints:</b> “Anything that makes inspection or maintenance harder, such as damaged fasteners or a locked enclosure.”</p><p><b>Rule preview:</b> “Shows which assets currently match and what the rule would do. Previewing does not change records.”</p></div><div><h3>Formatting conventions</h3>${list('Dates: “Oct 6, 2026,” not an ambiguous 10/6/26. Show the workspace time zone when a deadline depends on time.', 'Money: currency in the label or heading; consistent decimal precision. Counts are not padded with unnecessary decimals.', 'Measurements: value and unit together, such as 4.3 A. Explain unfamiliar units nearby.', 'Errors explain correction, not fault. Do not expose SQL, raw provider errors, secret identifiers, or implementation jargon.')}</div></div>
`,
);

page(
  '19 / Accessibility, icons & motion',
  'Approachable means usable in more than one way.',
  'Target WCAG 2.2 AA. These visual rules support accessibility; implementation and assistive-technology testing must prove it.',
  `
<div class="cols"><div><h3>Non-negotiable acceptance</h3>${list('<b>Keyboard:</b> every action is reachable and operable in a logical order. Include a skip link, clear headings, and visible focus that sticky UI does not obscure.', '<b>Text & zoom:</b> support text enlargement to 200% and reflow at 320 CSS px (typically a 1280 px viewport at 400% zoom). True two-dimensional tables may use their own scroll region; the page itself should not require horizontal scrolling. [4]', '<b>Targets:</b> Quartermaster policy is at least 44 × 44 CSS px; capture controls use 48 px. WCAG AA has a 24 × 24 px minimum with defined exceptions; do not confuse that minimum with our preferred size. [8]', '<b>Names & relationships:</b> labels are programmatically connected; help and errors are described by the correct controls. Visible labels and accessible names agree.', '<b>Alternatives:</b> voice, camera, dragging, color, or hover is never the only way to complete an essential task.')}</div><div><h3>One icon grammar</h3><div class="icon-grid">${['assets', 'search', 'plus', 'camera', 'mic', 'work', 'info', 'export', 'edit', 'check', 'clock', 'alert'].map((i) => `<span>${icon(i)}<small>${i}</small></span>`).join('')}</div><p>Use one consistent 24 px outline family with 1.5–2 px rounded strokes. Render at 20 or 24 px; pair unfamiliar icons with text. Use filled shapes only for a deliberate selected state. Do not mix emoji, outline sets, and 3D illustrations.</p><h3>Motion & imagery</h3><p>Use 120–180 ms color/opacity transitions and 180–240 ms panel transitions. Respect reduced-motion preferences; remove spatial animation and pulsing. Never animate away an error.</p><p>Use actual asset photos for evidence. Preserve the full frame when inspection matters; crop only thumbnails with access to the original view. No stock imagery pretending to document a real asset.</p>${note('Before approval', 'Test keyboard, screen reader, touch, high zoom, long labels, missing data, bright outdoor viewing, and interrupted capture. Automated contrast checks alone are not an accessibility audit.', 'soft')}</div></div>
`,
);

page(
  '20 / Designer & AI handoff',
  'Compose from roles, not one-off styling.',
  'The following contract should accompany any implementation brief or AI-generated interface task.',
  `
<div class="cols"><div><h3>Starter token contract</h3><pre class="code-block">:root {
  --qm-font-ui: "Source Sans 3", system-ui, sans-serif;
  --qm-font-heading: "Manrope", system-ui, sans-serif;
  --qm-canvas: #F5F6F2;
  --qm-surface: #FFFFFF;
  --qm-text: #172D3A;
  --qm-text-muted: #52656E;
  --qm-action: #17635B;
  --qm-action-hover: #124F49;
  --qm-action-pressed: #0D3D38;
  --qm-selected: #E8F3EF;
  --qm-divider: #D7E0DC;
  --qm-control-border: #81908C;
  --qm-focus: #315ECA;
  --qm-radius-control: 8px;
  --qm-radius-card: 12px;
  --qm-target: 44px;
  --qm-target-capture: 48px;
  --qm-space-1: 4px;
  --qm-space-2: 8px;
  --qm-space-3: 12px;
  --qm-space-4: 16px;
  --qm-space-6: 24px;
  --qm-space-8: 32px;
}</pre><p class="small muted">Semantic color pairs are specified on page 4. Use rem-based typography and min-heights rather than fixed text containers. These are proposed tokens, not a claim that the live site already uses them.</p></div><div><h3>Build reusable components</h3><p><b>Shell · PageHeader · ActionButton · FormField · InfoDisclosure · StatusBadge · DataTable · FilterBar · EmptyState · JobStatus · CaptureStep · ReviewPanel · ConfirmDialog</b></p><p>Each component defines its anatomy, accessible name, keyboard behavior, loading/error/empty states, responsive behavior, and permission handling—not only its default screenshot.</p><div class="brief"><div class="eyebrow">PASTE INTO A DESIGN BRIEF</div><p>Follow Quartermaster Visual Style Guide v1.0. Use the named type, color, spacing, and component roles. Make the everyday action obvious. Keep labels persistent and plain. Add helper text or an information disclosure for unfamiliar concepts. Preserve tenant context, supported functionality, permissions, privacy rules, and human review of AI output. Show realistic empty, loading, error, and success states. Do not invent data, APIs, metrics, offline support, or nonfunctional controls. Deliver desktop and phone compositions plus an accessibility check.</p></div><p><b>Review order:</b> hierarchy → language → interaction → responsive behavior → visual finish. A polished mockup does not authorize a product-policy change.</p></div></div>
`,
);

page(
  '21 / Review & references',
  'A system to approve, then apply consistently.',
  'Review the direction first. The next implementation pass can then replace ad hoc styling with shared components.',
  `
<div class="cols"><div><h3>Review checklist</h3><div class="review-checks">${['The overall tone is clean, businesslike, and welcoming.', 'Teal, warm neutrals, and the semantic colors feel appropriate.', 'The heading/body font pairing is readable and distinctive enough.', 'The register and detail view expose the right information first.', 'Labels and help explain financial and maintenance concepts clearly.', 'Phone capture is understandable without voice or camera permission.', 'Status, AI suggestions, saved data, and errors are visibly distinct.', 'Comfortable density is the right default for ordinary users.'].map((v) => `<p><span>□</span>${v}</p>`).join('')}</div>${note('Proposed rollout after approval', '1. Tokens, typography, shell, and navigation.<br>2. Shared fields, help, buttons, status, and tables.<br>3. Asset/capture/report screens and state coverage.<br>4. Keyboard, screen-reader, phone, and visual regression checks.', 'soft')}<p class="small muted">This document does not change the live site. Brand mark treatment is a simple evolution of the existing Q; it is not a finalized logo identity or trademark assessment. Dark mode and a broader marketing identity can be designed separately.</p></div><div><h3>Source notes · checked Oct 6, 2026</h3><ol class="references"><li><a href="https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html">W3C · Contrast (Minimum), SC 1.4.3</a><span>Text contrast thresholds and measurement.</span></li><li><a href="https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html">W3C · Non-text Contrast, SC 1.4.11</a><span>Essential control and graphical contrast.</span></li><li><a href="https://www.w3.org/WAI/WCAG22/Understanding/content-on-hover-or-focus.html">W3C · Content on Hover or Focus, SC 1.4.13</a><span>Accessible supplemental content.</span></li><li><a href="https://www.w3.org/WAI/WCAG22/Understanding/reflow.html">W3C · Reflow, SC 1.4.10</a><span>Zoom, narrow viewports, and table exceptions.</span></li><li><a href="https://www.w3.org/WAI/ARIA/apg/patterns/disclosure/">W3C APG · Disclosure pattern</a><span>Button semantics and expanded state.</span></li><li><a href="https://github.com/google/fonts/tree/main/ofl/manrope">Manrope · Font files and SIL OFL license</a><span>Heading family; source files retained with this guide.</span></li><li><a href="https://github.com/adobe-fonts/source-sans">Adobe · Source Sans 3</a><span>Interface family; font files and license also distributed through Google Fonts.</span></li><li><a href="https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html">W3C · Target Size (Minimum), SC 2.5.8</a><span>AA minimum; Quartermaster adopts larger targets.</span></li></ol><p class="small muted">Product context: Quartermaster’s current authenticated-workspace design and accepted retention/online-only decisions. Contrast values in this guide were computed locally. Accessibility references are guidance, not a claim of conformance.</p></div></div>
`,
);

const css = `
@font-face{font-family:Manrope;src:url('fonts/Manrope-Variable.ttf');font-weight:200 800;font-display:block}
@font-face{font-family:'Source Sans 3';src:url('fonts/SourceSans3-Variable.ttf');font-weight:200 900;font-display:block}
:root{--ink:#172D3A;--muted:#52656E;--teal:#17635B;--canvas:#F5F6F2;--line:#D7E0DC;--control:#81908C;--sand:#F4C7A1;--radius:12px}
*{box-sizing:border-box}body{margin:0;color:var(--ink);font:16px/1.43 'Source Sans 3',sans-serif;-webkit-print-color-adjust:exact;print-color-adjust:exact;background:#DEE5DF}a{color:var(--teal);text-decoration:underline;text-underline-offset:3px}h1,h2,h3{font-family:Manrope,sans-serif;letter-spacing:-.45px;margin:0;font-weight:700}h1{font-size:32px;line-height:1.18}h2{font-size:25px;line-height:1.25}h3{font-size:18px;line-height:1.35;margin-bottom:8px}p{margin:8px 0 12px}ul{margin:8px 0 0;padding-left:20px}li{padding-left:3px;margin-bottom:9px}b,strong{font-weight:650}code,.code-block{font-family:'DejaVu Sans Mono',monospace;font-size:.82em}code{overflow-wrap:anywhere}small,.small{font-size:13px;line-height:1.38}.muted,.hint{color:var(--muted)}.center{text-align:center}.manrope{font-family:Manrope}.row{display:flex;align-items:center;gap:10px}.between{justify-content:space-between}.end{justify-content:flex-end}.push{margin-left:auto}.cols{display:grid;grid-template-columns:1fr 1fr;gap:32px}.cols.three{grid-template-columns:repeat(3,1fr);gap:20px}.cols.narrow-gap{gap:16px}.stack{display:grid;gap:10px}.eyebrow,.cover-kicker{font-size:11px;font-weight:700;letter-spacing:1.5px;color:var(--muted)}.icon{width:20px;height:20px;flex-shrink:0;vertical-align:middle}.text-link{display:inline-flex;align-items:center;gap:5px;color:var(--teal);font-weight:600;text-decoration:underline;text-underline-offset:3px}.text-link .icon{width:16px}.page{width:297mm;height:210mm;padding:31px 44px 26px;display:flex;flex-direction:column;background:var(--canvas);position:relative;break-after:page;overflow:hidden}.page:last-child{break-after:auto}.running{display:flex;justify-content:space-between;align-items:center;font-size:10px;letter-spacing:1.4px;text-transform:uppercase;color:var(--muted);margin-bottom:21px;height:18px;flex-shrink:0}.running-brand{font-weight:750;color:var(--teal)}.heading{flex-shrink:0}.deck{font-size:17px;line-height:1.4;margin:9px 0 23px;max-width:940px;color:var(--muted)}.body{flex:1;min-height:0}.footer{display:flex;justify-content:space-between;border-top:1px solid var(--line);padding-top:9px;margin-top:15px;font-size:10px;letter-spacing:.5px;flex-shrink:0}.footer a{color:var(--muted);text-decoration:none}.folio{font-weight:700;color:var(--teal)}.panel{padding:22px;background:white;border:1px solid var(--line);border-radius:12px}.note{padding:16px 18px;background:#FFFFFF;border-left:3px solid var(--teal);border-radius:0 8px 8px 0;margin-top:14px}.note p{font-size:14px;line-height:1.42;margin:6px 0 0}.note.soft{background:#E8F3EF}.spec{width:100%;border-collapse:collapse;font-size:15px;line-height:1.32}.spec th{text-align:left;color:var(--muted);font-size:12px;font-weight:700;letter-spacing:.2px;padding:9px 9px;border-bottom:2px solid var(--line)}.spec td{border-bottom:1px solid var(--line);padding:10px 9px;vertical-align:top}.spec td:first-child{font-weight:600}.spec.compact{font-size:14px}.spec.compact td{padding:8px}.spec th:first-child,.spec td:first-child{padding-left:0}.spec th:last-child,.spec td:last-child{padding-right:0}.spec td:last-child{color:var(--muted)}.btn{font-family:'Source Sans 3';display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:42px;padding:8px 14px;border:1px solid var(--control);border-radius:8px;background:white;color:var(--ink);font-size:15px;font-weight:600;white-space:nowrap;line-height:1.1;vertical-align:middle}.btn.primary{background:var(--teal);border-color:var(--teal);color:white}.btn.quiet{background:transparent;border-color:transparent;color:var(--teal)}.btn.danger{background:#A33131;border-color:#A33131;color:white}.btn.hover{background:#124F49;color:white;border-color:#124F49}.btn.pressed{background:#0D3D38;color:white;border-color:#0D3D38}.btn.focus{outline:3px solid #315ECA;outline-offset:3px}.btn.loading{background:#EEF2EF;border-color:#81908C;color:#52656E}.btn.small-btn{font-size:13px;min-height:36px;padding:7px 10px}.badge{display:inline-flex;align-items:center;gap:5px;background:#EEF2EF;color:var(--muted);font-size:12px;font-weight:600;padding:5px 8px;border-radius:5px;white-space:nowrap;line-height:1.2}.badge .icon{width:14px;height:14px}.success{background:#EAF5ED!important;color:#256644}.warning{background:#FFF4D6!important;color:#875200}.danger{background:#FDECEC!important;color:#A33131}.info{background:#EDF3FF!important;color:#2C5DA8}.ai{background:#F3EFFA!important;color:#6952A3}.mark{width:30px;height:30px;display:inline-flex;align-items:center;justify-content:center;background:var(--teal);color:white;font-family:Manrope;font-size:22px;font-weight:800;border-radius:8px;line-height:1;position:relative}.brand{display:flex;gap:9px;align-items:center;font-family:Manrope;font-size:14px;font-weight:700;white-space:nowrap}.mark>span{display:none}.principle{display:flex;gap:16px;padding:0 0 20px;margin-bottom:8px;border-bottom:1px solid var(--line)}.principle>span{font:600 22px Manrope;color:var(--teal)}.principle p{margin-bottom:0}.swatches{display:grid;grid-template-columns:repeat(6,1fr);gap:22px 18px}.swatch>div{height:66px;border-radius:9px;margin-bottom:9px;border:1px solid #172D3A18}.swatch strong,.swatch code{display:block}.swatch code{font-size:12px;color:var(--muted);margin-top:2px}.swatch p{font-size:13px;line-height:1.3;margin:6px 0 0}.semantic{padding:12px 16px;border-radius:9px;display:grid;grid-template-columns:1fr auto;column-gap:10px}.semantic p{grid-column:1/-1;font-size:14px;line-height:1.3;margin:6px 0 0}.semantic>.small{font-size:11px;align-self:center}.type-pair{display:grid;grid-template-columns:1fr 1fr;background:white;border:1px solid var(--line);border-radius:12px;padding:20px 26px;gap:36px}.type-pair>div+div{border-left:1px solid var(--line);padding-left:30px}.type-display{font:700 44px/1.2 Manrope;letter-spacing:-1px;margin:8px 0}.type-display.source{font-family:'Source Sans 3'}.type-pair p{margin:9px 0;font-size:21px;line-height:1.35}.spacing-demo{display:grid;grid-template-columns:1fr 1fr;gap:16px 20px;margin:18px 0 24px}.spacing-demo>div{display:flex;align-items:center;gap:14px}.spacing-demo b{width:25px;font-variant-numeric:tabular-nums}.spacing-demo span{display:block;height:15px;background:var(--teal);border-radius:3px}.surface-demo{display:flex;gap:16px;margin-top:22px}.surface-demo>div{height:126px;flex:1;padding:18px 14px;border-radius:12px;display:flex;flex-direction:column;justify-content:center;font-size:13px}.surface-demo>div:first-child{border:1px dashed var(--control)}.surface-demo>div:nth-child(2){border:1px solid var(--line);background:white}.surface-demo>div:last-child{background:white;box-shadow:0 8px 24px #172D3A1F}.surface-demo b{font-size:16px;margin-bottom:6px}.nav-study{display:grid;grid-template-columns:235px 1fr;gap:34px}.mock-nav{background:#F7F9F5;border-right:1px solid var(--line);padding:18px 14px;display:flex;flex-direction:column;font-size:13px}.standalone-nav .mock-nav{height:540px;border:1px solid var(--line);border-radius:12px}.workspace{background:white;border:1px solid var(--line);border-radius:8px;padding:10px;margin:18px 0 6px;font-weight:600}.workspace span{float:right}.workspace small{display:block;font-size:11px;color:var(--muted);font-weight:400}.nav-group{font-size:9px;letter-spacing:1px;text-transform:uppercase;color:var(--muted);font-weight:650;margin:15px 9px 5px}.nav-item{display:flex;align-items:center;gap:10px;padding:8px 9px;margin:1px 0;border-radius:6px}.nav-item .icon{width:17px;height:17px}.nav-item.on{background:#E8F3EF;color:var(--teal);font-weight:700;box-shadow:inset 3px 0 var(--teal)}.nav-text{padding:5px 9px}.nav-bottom{margin-top:auto;padding:14px 9px 0;border-top:1px solid var(--line);display:flex;align-items:center;gap:12px}.mobile-nav{display:flex;justify-content:space-around;background:white;border:1px solid var(--line);border-radius:12px;padding:13px;margin-top:16px}.mobile-nav>span{display:flex;flex-direction:column;align-items:center;gap:5px;font-size:13px}.mobile-nav>span:first-child{color:var(--teal);font-weight:700}.app-frame{background:white;border:1px solid var(--line);border-radius:12px;overflow:hidden;display:grid;grid-template-columns:190px 1fr}.register{height:430px}.register .mock-nav{font-size:11px;padding:14px 10px}.register .mock-nav .brand{font-size:12px}.register .mark{width:25px;height:25px;font-size:18px}.register .nav-group{font-size:8px;margin:10px 8px 3px}.register .nav-item{padding:5px 8px}.register .nav-text{padding:3px 8px}.register .workspace{margin-top:13px;padding:8px}.register .nav-bottom{padding-top:8px;font-size:10px}.mock-main{padding:19px 22px;min-width:0}.mock-main h2{font-size:24px;margin-top:4px}.mock-main p{font-size:13px;margin:5px 0 0}.breadcrumb{font-size:11px;color:var(--muted);margin-bottom:8px}.stat-strip{display:flex;gap:0;padding:15px 0;margin-bottom:10px}.stat-strip>div{display:flex;align-items:center;gap:9px;border-right:1px solid var(--line);padding:0 22px}.stat-strip>div:first-child{padding-left:0}.stat-strip>div:last-child{border:0}.stat-strip b{font:700 25px Manrope}.stat-strip span{font-size:12px;max-width:90px;line-height:1.15;color:var(--muted)}.toolbar{display:flex;gap:9px}.toolbar .btn{min-height:36px;font-size:13px;padding:7px 10px}.search-box{height:36px;display:flex;align-items:center;gap:8px;flex:1;border:1px solid var(--control);border-radius:7px;padding:0 10px;font-size:12px;color:var(--muted)}.search-box .icon{width:16px}.filter-row{font-size:11px;margin:10px 0}.filter-row .badge{font-size:10px}.table-card{background:white;border:1px solid var(--line);border-radius:9px;overflow:hidden}.asset-table{width:100%;border-collapse:collapse;font-size:14px}.asset-table th{background:#F5F7F3;text-align:left;font-size:12px;font-weight:650;color:var(--muted);padding:12px}.asset-table td{padding:13px 12px;border-top:1px solid var(--line);vertical-align:middle}.asset-table .check-col{width:28px}.asset-table small{display:block;color:var(--muted);font-size:12px;line-height:1.35;margin-top:3px}.asset-table strong{font-weight:650;color:var(--teal)}.asset-table .num{text-align:right;font-variant-numeric:tabular-nums}.register .asset-table{font-size:12px}.register .asset-table th{font-size:10px;padding:8px 9px}.register .asset-table td{padding:8px 9px}.register .asset-table small{font-size:10px;margin-top:2px}.register .asset-table .badge{font-size:9px;padding:4px 6px}.table-footer{font-size:10px;border-top:1px solid var(--line);padding:10px;color:var(--muted)}.caption-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:24px;margin-top:19px}.caption-grid b{font-size:14px}.caption-grid p{font-size:13px;line-height:1.38;margin:5px 0 0;color:var(--muted)}.specimen-caption{font-size:10px;letter-spacing:.2px;color:var(--muted);margin-top:12px}.detail-frame{background:white;border:1px solid var(--line);border-radius:12px;padding:23px 26px}.detail-frame>div>.muted{font-size:13px}.detail-frame p{font-size:14px}.tabs{display:flex;gap:25px;border-bottom:1px solid var(--line);margin-top:17px;font-size:13px}.tabs>*{padding:10px 0}.tabs b{color:var(--teal);border-bottom:3px solid var(--teal)}.detail-grid{display:grid;grid-template-columns:1fr 1.2fr;gap:28px;margin-top:18px}.photo-placeholder{height:147px;background:#EEF2EF;border-radius:8px;text-align:center;padding:5px}.hvac{width:100%;height:122px;display:block}.photo-placeholder span{font-size:10px;color:var(--muted)}.data-grid{display:grid;grid-template-columns:1fr 1fr;gap:13px 18px;margin-top:16px;font-size:13px}.data-grid span{display:block;font-size:11px;color:var(--muted)}.data-grid b{font-weight:600}.task-card{padding:16px;background:#F8F9F5;border:1px solid var(--line);border-radius:8px}.task-card h3{font-size:16px;margin:0 0 10px}.task-card .text-link{font-size:12px}.task-card p{margin:6px 0;font-size:12px}.task-card .btn{min-height:32px;font-size:12px;padding:6px 10px;margin-top:6px}.access-note{display:flex;gap:10px;background:#EDF3FF;border-radius:8px;padding:12px;margin-top:12px;color:#2C5DA8;font-size:13px}.access-note p{font-size:12px;margin:3px 0 0}.field{margin:14px 0}.field-label{font-weight:600;font-size:14px;display:flex;align-items:center;gap:8px;margin-bottom:5px}.input{min-height:43px;border:1px solid var(--control);background:white;border-radius:8px;padding:9px 12px;font-size:16px;line-height:1.4}.hint{font-size:13px;margin-top:5px;line-height:1.3}.help{width:24px;height:24px;color:var(--muted);display:inline-flex;align-items:center;justify-content:center;border-radius:50%}.help.active{color:var(--teal);background:#E8F3EF}.help .icon{width:18px;height:18px}.optional{font-size:13px;font-weight:400;color:var(--muted)}.error-field .input{border-color:#A33131;box-shadow:0 0 0 1px #A33131}.error-copy{color:#A33131;display:flex;gap:6px;align-items:center;font-size:13px;margin-top:6px}.error-copy .icon{width:16px;height:16px}.form-specimen{padding:22px}.form-specimen .field{margin:11px 0}.form-specimen>p{font-size:14px}.form-specimen .cols .field{margin:4px 0}.help-demo{padding:24px;background:white;border:1px solid var(--line);border-radius:12px}.help-pop{padding:20px;border:1px solid var(--line);box-shadow:0 8px 24px #172D3A1F;background:white;border-radius:12px;margin-top:18px;border-top:3px solid var(--teal)}.help-pop p{font-size:15px}.help-pop .text-link{font-size:14px}.control-specs{display:grid;grid-template-columns:repeat(4,1fr);gap:24px}.control-specs p{font-size:14px;color:var(--muted);margin-top:12px}.state-row{display:flex;justify-content:space-between;border-top:1px solid var(--line);border-bottom:1px solid var(--line);padding:23px 0;margin-top:14px;gap:16px}.state-row>div{display:flex;align-items:center;flex-direction:column;gap:12px}.state-row b{font-size:12px;color:var(--muted)}.state-row .btn{font-size:13px;padding:10px 15px}.bulk-bar{padding:13px 16px;background:#EDF3FF;border:1px solid #B6C8E2;border-radius:8px;margin-top:14px;font-size:14px}.bulk-bar .btn{font-size:13px;min-height:36px}.report-frame{background:white;border:1px solid var(--line);border-radius:12px;padding:24px}.report-frame h2{margin-top:6px}.report-frame p{font-size:14px}.report-grid{display:grid;grid-template-columns:1.8fr 1fr;gap:35px;margin-top:27px}.report-grid aside{border-left:1px solid var(--line);padding-left:28px}.report-total{display:block;font:700 36px Manrope;margin:4px 0 8px}.bar-line{display:grid;grid-template-columns:108px 1fr 72px;align-items:center;gap:10px;font-size:13px;margin-bottom:15px}.bar-line>div{height:24px;border-left:1px solid var(--control)}.bar-line i{display:block;background:var(--teal);height:100%;border-radius:0 3px 3px 0}.bar-line b{text-align:right;font-variant-numeric:tabular-nums}.axis{font-size:10px;color:var(--muted);margin:0 82px 15px 118px;border-top:1px solid var(--control);display:flex;justify-content:space-between}.phones{display:flex;justify-content:center;gap:34px}.phone{width:280px;height:437px;border:1.5px solid #81908C;border-radius:22px;overflow:hidden;background:white;box-shadow:0 5px 16px #172D3A0D;display:flex;flex-direction:column}.phone-top{height:45px;border-bottom:1px solid var(--line);display:flex;justify-content:space-between;align-items:center;padding:0 16px;font-family:Manrope;font-size:11px;flex-shrink:0}.phone-top .icon{width:17px}.phone-body{padding:16px;flex:1;min-height:0;font-size:13px}.phone-body .eyebrow{font-size:8px;letter-spacing:1px}.phone-body h2{font-size:20px;line-height:1.25;margin:6px 0 12px}.phone-body .btn{width:100%;font-size:13px;min-height:35px;margin-top:9px;padding:7px}.phone-body>.text-link{display:block;text-align:center;font-size:12px;margin-top:10px}.phone-bottom{text-align:center;font-size:10px;color:var(--muted);background:#F5F6F2;padding:7px;flex-shrink:0}.chat{background:#E8F3EF;border-radius:2px 10px 10px 10px;padding:13px;line-height:1.4}.voice-orb{width:62px;height:62px;display:flex;align-items:center;justify-content:center;border-radius:50%;background:#E8F3EF;color:var(--teal);margin:15px auto 9px}.voice-orb .icon{width:27px;height:27px}.phone-body p{margin:7px 0}.phone-body .center{font-size:12px}.phone-note{padding:9px 10px;margin-top:14px;background:#F5F6F2;font-size:11px;color:var(--muted);border-radius:7px}.camera-frame{height:161px;background:#E5ECE7;border:1px solid var(--line);display:flex;flex-direction:column;align-items:center;justify-content:center;border-radius:8px;gap:15px;margin-top:12px}.camera-frame>span{font-size:10px;color:var(--muted)}.nameplate{font:10px/1.8 'DejaVu Sans Mono',monospace;background:#F6F5EC;border:1px solid #81908C;box-shadow:2px 2px 0 #B7C4BA;padding:13px 18px;color:#172D3A;transform:rotate(-2deg)}.phone-body .field{margin:8px 0}.phone-body .field-label{font-size:11px;margin-bottom:3px}.phone-body .input{font-size:12px;min-height:32px;padding:7px 8px}.phone-body .badge{font-size:10px}.phone-task{padding:10px;background:#FFF4D6;color:#875200;border-radius:7px;font-size:11px;margin-top:10px}.phone-task p{margin:3px 0 0}.phone-body .small{font-size:10px}.ai-proof{background:#EEF2EF;padding:25px 18px 10px;border-radius:8px;margin:18px 0}.ai-proof .nameplate{width:200px;margin:0 auto;font-size:12px}.ai-proof p{text-align:center;margin-top:18px}.suggestion-row{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:11px 0;border-bottom:1px solid var(--line);font-size:14px}.suggestion-row>span:first-child{width:90px;color:var(--muted)}.feedback-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:18px}.feedback-card{border:1px solid var(--line);background:white;border-radius:12px;padding:18px;min-height:190px}.feedback-card h3{font-size:16px;margin:0}.feedback-card p{font-size:14px;line-height:1.4}.feedback-card .btn{min-height:35px;font-size:12px;padding:8px 10px}.feedback-card .small{font-size:12px}.skeleton{height:11px;width:80%;background:#D7E1F1;border-radius:4px;margin:10px 0}.skeleton.short{width:55%}.dialog-stage{padding:24px;background:#E3E9E4;border-radius:16px}.dialog{background:white;border:1px solid var(--line);border-radius:16px;padding:25px;box-shadow:0 8px 24px #172D3A1F}.dialog h2{font-size:24px}.dialog p{font-size:15px;margin-top:16px}.warning-block{background:#FFF4D6;color:#875200;border-radius:8px;padding:14px;margin:20px 0}.warning-block p{font-size:13px;margin:5px 0 0}.dialog-stage>p{margin:18px 2px 0}.icon-grid{display:grid;grid-template-columns:repeat(6,1fr);gap:13px 9px;margin:18px 0}.icon-grid>span{display:flex;flex-direction:column;align-items:center;gap:8px}.icon-grid .icon{width:25px;height:25px;color:var(--teal)}.icon-grid small{font-size:10px}.code-block{background:#172D3A;color:#F5F6F2;border-radius:12px;padding:18px 22px;font-size:12px;line-height:1.53;margin:12px 0;white-space:pre-wrap}.brief{border:1px solid #B3CABC;border-radius:12px;padding:20px;background:#E8F3EF;margin:20px 0}.brief p{font-size:15px;line-height:1.5;margin-bottom:0}.review-checks p{display:flex;gap:12px;font-size:15px;margin:0 0 11px}.review-checks span{color:var(--teal);font-size:21px;line-height:1}.references{padding-left:20px;margin:12px 0}.references li{font-size:13px;margin-bottom:11px;padding-left:4px}.references span{display:block;color:var(--muted);font-size:12px;margin-top:3px}.cover .heading{display:none}.cover{background:#EFF3EA}.cover .running{margin-bottom:30px}.cover-layout{display:grid;grid-template-columns:.95fr 1.05fr;gap:40px;align-items:center;height:100%}.cover-kicker{color:var(--teal);font-size:11px}.cover h1{font-size:54px;line-height:1.14;letter-spacing:-2px;margin:23px 0 23px}.cover h1 em{font-style:normal;color:var(--teal)}.cover-intro{font-size:21px;line-height:1.42;max-width:390px}.cover-topics{font-size:15px;color:var(--muted);margin-top:35px;line-height:1.7}.cover-version{font-size:12px;color:var(--muted);margin-top:28px}.cover-art{position:relative;padding:28px 0 15px}.cover-oval{position:absolute;width:410px;height:465px;background:#D9E5D7;border-radius:190px 190px 60px 60px;right:-8px;top:0;transform:rotate(7deg)}.cover-card{position:relative;background:#FFFFFF;border:1px solid #CEDBD0;border-radius:20px;padding:24px;box-shadow:0 12px 36px #172D3A14;transform:rotate(-2deg)}.cover-card h2{font-size:33px;letter-spacing:-1px;margin:27px 0 10px}.cover-card p{font-size:16px;color:var(--muted)}.mini-stats{display:flex;gap:25px;margin:20px 0}.mini-stats>div{display:flex;flex-direction:column}.mini-stats b{font:700 30px Manrope}.mini-stats span{font-size:12px;color:var(--muted);margin-top:3px}.cover-asset{border:1px solid var(--line);padding:12px;border-radius:12px;background:#F7F9F5}.cover-asset .hvac{height:105px}.cover-asset strong{font-size:13px}.cover-asset>.muted{font-size:11px}.cover-asset .badge{font-size:9px}.cover-card>.row>.btn{font-size:13px;min-height:40px;padding:8px 12px}.cover-card .text-link{font-size:11px}.float-note{position:absolute;right:-14px;bottom:70px;display:flex;align-items:center;gap:11px;background:#F4C7A1;border:1px solid #E0AB80;border-radius:12px;box-shadow:0 8px 24px #172D3A1F;padding:13px 17px;font-size:13px;transform:rotate(2deg)}.float-note .icon{width:26px;height:26px}.specimen-tag{font-size:10px;color:var(--muted);position:relative;text-align:right;margin-top:18px}.cover .footer{border-color:#C4D5C4}
@page{size:A4 landscape;margin:0}@media screen{.page{margin:22px auto;box-shadow:0 4px 30px #172D3A22}}@media print{body{background:white}.page{margin:0}}
`;

// Print composition refinements; mockups are scaled illustrations, not the
// normative control measurements specified in the guide.
const refinements = `
.page{padding-top:28px}.running{margin-bottom:16px}.deck{margin-bottom:18px}
.body{font-size:15px;line-height:1.4}.cols{align-items:start}
.spec.compact td{padding-top:7px;padding-bottom:7px}
.note{padding:14px 17px}.note p{font-size:13px;line-height:1.4}
.standalone-nav .mock-nav{height:505px}
#page-9 .detail-frame{zoom:.90}
#page-13 .asset-table tbody tr:last-child{display:none}
#page-13 li,#page-14 li{margin-bottom:7px}
.phone{height:488px}
.code-block{font-size:11.5px;line-height:1.4}
.cover-oval{right:8px;width:390px}
.float-note{bottom:16px;right:5px}
.specimen-tag{margin-top:26px}
.form-specimen{padding:16px 22px}
.help-demo{padding:20px}.help-pop{padding:16px}
#page-14 .report-frame{padding:20px}
#page-14 .report-grid{margin-top:20px}
#page-14 .bar-line{margin-bottom:13px}
.body>.cols>div>:last-child{margin-bottom:0}
.standalone-nav .mock-nav{height:580px;zoom:.88}
.register{height:520px;zoom:.90}
.btn.danger{background:#A33131!important;color:#FFFFFF}
`;
pages[8].title = 'Give each asset a clear story.';
pages[10].title = 'Explain what it means—and why it matters.';
pages[17].title = 'Make sensitive actions deliberate.';
pages[18].title = 'Write for people, not the database.';
pages[5].body = pages[5].body.replace(
  '<div class="surface-demo">',
  '<p class="small"><b>Responsive ranges:</b> phone &lt;640 px; tablet 640–1023 px; desktop ≥1024 px. At narrow widths, stack fields and detail panels in reading order. Reflow based on available space, including zoom—not device detection.</p><div class="surface-demo">',
);
pages[10].body = pages[10].body.replace(
  'Open-state design specimen. On a narrow phone, reveal the same content directly below the field instead of covering surrounding controls.',
  'Desktop help: 320–400 px wide, at least 16 px from viewport edges. On a phone, expand inline. Outside click or Escape closes it; do not auto-dismiss while someone is reading.',
);
pages[12].body = pages[12].body
  .replaceAll('<td>□</td>', '<td>☑</td>')
  .replace('<th class="check-col">□</th>', '<th class="check-col">☑</th>');
pages[14].body = pages[14].body.replace(
  '□ I have reviewed these details.',
  '☑ I have reviewed these details.',
);
// The owner adopted v1.0. Remove the two framing pages and retain stable
// specimen IDs so their print-composition selectors do not move to other pages.
pages.splice(0, 2);
for (const [index, page] of pages.entries()) {
  page.section = page.section.replace(
    /^\d+ /,
    `${String(index + 1).padStart(2, '0')} `,
  );
  page.body = page.body
    .replace('Phone proposal:', 'Phone navigation:')
    .replace('Before approval', 'Before release')
    .replace(
      'Semantic color pairs are specified on page 4.',
      'Semantic color pairs are specified on page 2.',
    )
    .replace(
      'These are proposed tokens, not a claim that the live site already uses them.',
      'These accepted tokens govern implementation. Mockup records are illustrative, not live data.',
    )
    .replace('Proposed rollout after approval', 'Implementation sequence')
    .replace('Review checklist', 'Implementation acceptance checklist')
    .replace(
      'This document does not change the live site.',
      'Accepted by Erick Brown on October 6, 2026.',
    );
}
pages[19].section = '20 / Acceptance & references';
pages[19].title = 'One accepted standard. Applied consistently.';
pages[19].deck =
  'Use this checklist when implementing or changing Quartermaster. Preserve the product’s functionality and privacy boundaries.';
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Quartermaster — Visual Style Guide v1.0 · Accepted</title><meta name="author" content="Quartermaster"><meta name="description" content="Accepted design standard for the Quartermaster visual system and user-interface composition."><style>${css}${refinements}</style></head><body>${pages.map((p, i) => `<section class="page ${p.cls}" id="page-${i + 3}" aria-label="Page ${i + 1}: ${p.title}"><header class="running"><span class="running-brand">Quartermaster / Visual style guide</span><span>${escape(p.section)}</span></header><div class="heading"><h1>${p.title}</h1><p class="deck">${p.deck}</p></div><div class="body">${p.body}</div><footer class="footer"><span>ACCEPTED DESIGN · v1.0 · OCTOBER 2026</span><a href="#page-3">Quartermaster · Clear by design</a><span class="folio">${String(i + 1).padStart(2, '0')} / ${pages.length}</span></footer></section>`).join('')}</body></html>`;

await writeFile(
  join(folder, 'Quartermaster-Visual-Style-Guide-v1.html'),
  await format(html, {
    parser: 'html',
    singleQuote: true,
    trailingComma: 'all',
  }),
);
await mkdir(qaFolder, { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  const tab = await browser.newPage({
    viewport: { width: 1123, height: 794 },
    deviceScaleFactor: 1,
  });
  await tab.goto(
    pathToFileURL(join(folder, 'Quartermaster-Visual-Style-Guide-v1.html'))
      .href,
  );
  await tab.emulateMedia({ media: 'print' });
  await tab.evaluate(() => document.fonts.ready);
  const fontsLoaded = await tab.evaluate(
    () =>
      document.fonts.check('700 32px "Manrope"') &&
      document.fonts.check('400 16px "Source Sans 3"'),
  );
  if (!fontsLoaded) throw new Error('The accepted typefaces did not load');
  const audit = await tab.evaluate(() =>
    [...document.querySelectorAll('.page')].map((page, index) => {
      const footer = page.querySelector('.footer').getBoundingClientRect();
      const body = page.querySelector('.body');
      const boundaries = page.getBoundingClientRect();
      const leaves = [...body.querySelectorAll('*')].filter(
        (e) =>
          e.getClientRects().length &&
          !['path', 'rect', 'circle', 'svg', 'i'].includes(
            e.tagName.toLowerCase(),
          ),
      );
      const overflowing = leaves
        .filter((e) => {
          const r = e.getBoundingClientRect();
          return (
            r.bottom > footer.top - 8 ||
            r.right > boundaries.right - 18 ||
            r.left < boundaries.left + 18
          );
        })
        .map((e) => ({
          tag: e.tagName,
          text: e.textContent.trim().slice(0, 65),
          bottom: Math.round(e.getBoundingClientRect().bottom - boundaries.top),
        }));
      const clipped = [
        ...page.querySelectorAll('.phone-body,.app-frame,.mock-nav'),
      ]
        .filter((e) => e.scrollHeight > e.clientHeight + 1)
        .map((e) => ({
          container: e.className,
          needed: e.scrollHeight,
          available: e.clientHeight,
        }));
      return {
        page: index + 1,
        title: page.querySelector('h1').textContent,
        overflow: overflowing.slice(0, 8),
        clipped,
      };
    }),
  );
  console.log(
    JSON.stringify(
      {
        pages: pages.length,
        fontsLoaded,
        issues: audit.filter((p) => p.overflow.length || p.clipped.length),
      },
      null,
      2,
    ),
  );
  await writeFile(
    join(qaFolder, 'layout-audit.json'),
    JSON.stringify(audit, null, 2) + '\n',
  );
  await tab.pdf({
    path: join(folder, 'Quartermaster-Visual-Style-Guide-v1.pdf'),
    preferCSSPageSize: true,
    printBackground: true,
    tagged: true,
    outline: true,
  });
  await mkdir(join(qaFolder, 'preview'), { recursive: true });
  for (const n of [1, 2, 6, 7, 9, 10, 13, 16, 18, 20])
    await tab
      .locator('.page')
      .nth(n - 1)
      .screenshot({
        path: join(
          qaFolder,
          'preview',
          `page-${String(n).padStart(2, '0')}.png`,
        ),
      });
  console.log(
    `Created ${pages.length}-page PDF at ${join(folder, 'Quartermaster-Visual-Style-Guide-v1.pdf')}`,
  );
  if (audit.some((p) => p.overflow.length || p.clipped.length))
    process.exitCode = 2;
} finally {
  await browser.close();
}
