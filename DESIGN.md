---
name: JevRepoTriage
description: A bot-native operator console for human-reviewed GitHub triage.
colors:
  canvas: '#101210'
  surface: '#161916'
  ink: '#e5e9e1'
  muted: '#9aa495'
  seam: '#30372e'
  action: '#b7ef70'
  selected: '#202c18'
  attention: '#e6c980'
typography:
  body:
    fontFamily: 'Geist Variable'
    fontSize: '14px'
  metadata:
    fontFamily: 'Geist Mono Variable'
    fontSize: '11px'
rounded:
  control: '3px'
  label: '2px'
---

# JevRepoTriage — Bot operator console

## Direction

The user explicitly requested a more bot-like, geeky and distinctive interface. The visual system uses dark charcoal surfaces, phosphor-green controls, a pixel robot identity, monospaced metadata and precise panel seams. It is a functional operator console, not a simulated terminal: every action works, displayed counts come from the loaded data, and confidence cells visualize the model's actual returned confidence.

## Identity and typography

`Bot.tsx` owns the crisp, geometric pixel robot; `Brand.tsx` composes it with the JevRepoTriage wordmark. The same bot appears on the connection page, in instance status, in model assessment headers and in empty states. The favicon uses the same geometry.

Geist Variable is the reading and heading face. Geist Mono Variable is reserved for identifiers, metadata, model names and console labels. Both fonts are bundled from Fontsource and served locally; the Worker CSP permits only same-origin fonts. Chinese falls back to the platform's CJK font. Phosphor provides consistent operational icons, all decorative icons hidden from assistive technology.

## Layout

Navigation lives in the top command bar. A repository switcher and search control establish one active repository dashboard before the Issue scope filters. The API scopes pagination, jobs and imports to that repository; the account panel searches accessible installations by name without rendering a long list by default. The main view has three functional columns: an issue queue, original report, and a Bot assessment/action panel. At typical desktop widths the queue is 270px and Bot panel 300px; the report fills the remaining space. Above 1500px they expand to 300px and 340px. The Bot panel stays sticky while reviewing longer reports.

At 1000px and below, report and Bot panel stack. At 800px and below, the queue and detail become separate views. Completing a review returns to the queue and focuses search. The source section precedes Bot decisions in both DOM and mobile reading order; selected issue identity drives both together. Import controls remain collapsed by default and open on demand.

## Connection page

A centered boot terminal replaces the previous two-column entry page. A compact pixel Bot and headline sit directly above the authentication panel; the header contains the brand and language control. The single vertical path keeps the login action close to its context on desktop and mobile. It contains no fabricated telemetry or performance claims.

## Assessment and action

Repository and issue identifiers precede the report title. A bot assessment header contains the actual model name. `Signal.tsx` shows twelve decorative confidence cells and an accessible text percentage; confidence remains explicitly described as uncertainty, never accuracy. Original text precedes the label decision area. Label controls are real checkboxes styled as compact selectable tags. Applying labels still requires an explicit human action.

## States and accessibility

Green signals an available primary action, connected instance or applied status; amber identifies review/attention. Every status also has a text label. Clear focus outlines, labeled inputs, native controls, reduced-motion support and live feedback regions remain. Icons do not change accessible control names. Search and filters still apply to the current loaded page. GitHub identifiers and issue contents remain untranslated.

## Motion and surfaces

Surfaces are opaque and divided by one-pixel seams. Corners are tight, not rounded cards. Only the pixel bot's staging area has a dot matrix. The review pane enters with a small opacity/translation change; refresh rotates only during an operation. Reduced-motion preferences remove both effects. No global CRT filters obscure text.

## Implementation references

- `web/style.css`: current visual tokens and responsive layout.
- `web/Bot.tsx`, `web/Brand.tsx`, `web/Icon.tsx`: identity and icon system.
- `web/Signal.tsx`: confidence display.
- `web/App.tsx`, `web/Review.tsx`: operational composition.
- `web/locales/`: English-default and Simplified Chinese interface copy.
