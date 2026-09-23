---
name: JevMate
description: A self-hosted review desk for GitHub issue triage.
colors:
  canvas: '#f6f8fa'
  surface: '#ffffff'
  ink: '#1f2328'
  muted: '#59636e'
  seam: '#d1d9e0'
  action: '#1a7f37'
  action-hover: '#146c2e'
  link-focus: '#0969da'
  neutral-hover: '#f0f3f6'
  active-nav: '#eaf4ed'
  active-ink: '#17662e'
  selected-row: '#edf6ef'
  selected-outline: '#b8d6c0'
  attention: '#fff5d9'
  attention-ink: '#795b0b'
  applied: '#dafbe1'
  retry: '#fff1e5'
  retry-ink: '#853e0e'
  error: '#fff1f0'
  error-ink: '#9b242a'
typography:
  body:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Noto Sans', sans-serif"
    fontSize: '15px'
    lineHeight: 1.6
  headline:
    fontSize: '26px'
    fontWeight: 650
    letterSpacing: '-0.025em'
  title:
    fontSize: '24px'
    fontWeight: 700
    lineHeight: 1.45
    letterSpacing: '-0.02em'
  source:
    fontSize: '14px'
    lineHeight: 1.85
  label:
    fontSize: '12px'
rounded:
  status: '4px'
  control: '6px'
  inbox: '9px'
spacing:
  action-gap: '10px'
  form-gap: '12px'
  pagination: '16px'
  list-row: '18px'
  decision-top: '20px'
  review-section: '24px'
components:
  button-primary:
    backgroundColor: '{colors.action}'
    textColor: '{colors.surface}'
    rounded: '{rounded.control}'
    padding: '8px 15px'
  button-primary-hover:
    backgroundColor: '{colors.action-hover}'
  button-secondary:
    backgroundColor: '{colors.surface}'
    textColor: '{colors.ink}'
    rounded: '{rounded.control}'
    padding: '8px 15px'
  input:
    backgroundColor: '{colors.surface}'
    textColor: '{colors.ink}'
    rounded: '{rounded.control}'
    padding: '9px 11px'
  status-pending:
    backgroundColor: '{colors.attention}'
    textColor: '{colors.attention-ink}'
    rounded: '{rounded.status}'
    padding: '3px 9px'
  inbox:
    backgroundColor: '{colors.surface}'
    rounded: '{rounded.inbox}'
---

# Design System: JevMate

## Overview

**Creative North Star: “The review desk.”** Mode: Operate. Maintainers scan a persistent issue index, inspect source evidence, adjust suggested labels, and explicitly confirm a decision. Quiet white surfaces, visible seams, and restrained color support reading and comparison. The React interface is implemented directly in code; `web/style.css`, `web/App.tsx`, and `web/Review.tsx` are the implementation reference.

The direction contract favors a review desk over the considered repository list, email inbox, kanban board, operations log, lab notebook, and search browser. Instrument numerals and video-feed immersion were declined because prose comparison matters more than counts or media. Desktop selection discipline and console panel priorities inform focus and responsive behavior without their decorative skin.

Key characteristics: compact navigation; a continuous list/detail workspace; source text before confirmation; plain-language operational states. No remote fonts or imagery.

## Colors

The light-only palette uses cool neutral surfaces and a restrained green action accent. Canvas surrounds white panels; ink carries primary text, muted carries metadata, and seam separates regions.

Green identifies confirmation, active navigation, selected rows, and successful application. Amber identifies pending attention or missing information, never model correctness. Retry and stale states use the warm retry pair; skipped records use the neutral pair. Errors use the error pair. Blue is reserved for links and visible keyboard focus. Status meaning always appears in text as well as color.

## Typography

All text uses the system sans-serif stack in the frontmatter. The base is 15px/1.6. Workspace headings use 26px/650; issue titles use 24px/1.45 with bold weight. Section headings use 15px/650. Source prose is 14px/1.85 even though its semantic container is a `pre`; it is not rendered in monospace.

List titles use 15px/1.55. Labels are generally 12px; supporting metadata is 11–13px. Counts, issue numbers, page numbers, and confidence values use tabular figures where explicitly styled. The login headline is 36px/1.4. At the mobile breakpoint, workspace headings become 23px, issue titles 22px, and the login headline 32px. Long titles, repository names, and source text wrap rather than widen the layout.

## Layout

Desktop uses a 212px sticky, full-height sidebar beside a fluid workspace capped at 1600px. Workspace padding is 30px 34px 16px. The bordered inbox has a minimum height of 580px and columns `minmax(250px, 33%) minmax(0, 1fr)`. Search sits above the index, pagination below it; the review pane has 24px 30px 28px padding. Source text scrolls inside a 360px maximum-height region.

At 1100px and below, the sidebar becomes 180px, workspace padding becomes 24px 22px, review padding becomes 22px, and import controls wrap. At 780px and below, the sidebar becomes a compact header with horizontally scrolling scope buttons and a top-right logout button. Workspace padding is 22px 16px; the inbox becomes a single pane with a 400px minimum height. Selecting an issue switches from list to detail, with a visible return button. Returning or successfully applying/skipping clears explicit selection, returns to the list, and focuses search. This preserves context after an action instead of exposing another issue's actions at the old scroll position.

The login page is capped at 1020px with a 440px form column. Spacing follows observed component needs rather than a fabricated uniform scale: 10–12px control gaps, 16–18px list padding, and 20–24px review section spacing.

## Elevation & Depth

Panels are flat: white surfaces, one-pixel seams, and selected-state tints establish hierarchy. There are no floating drop shadows. Selected issue rows use the inset outline `inset 0 0 0 1px #b8d6c0`. Keyboard focus uses a 3px blue outline with 3px offset.

Button backgrounds transition over 150ms ease-out. Review content enters over 180ms ease-out from 0.75 opacity and a 3px downward offset. Reduced-motion preferences disable animations and transitions.

## Shapes

Controls and banners have 6px corners, status badges 4px, and the inbox 9px. List rows are square and full width, divided by seams. The small brand mark uses an 8px rounded square with a white line symbol. Controls normally have a 42px minimum height; the mobile logout control uses 34px. Checkbox squares are 18px within label rows at least 32px high. These are the implemented dimensions, replacing the seed document's intended 44px control baseline.

## Components

- **Buttons and inputs:** Secondary controls are white with seam borders; hover uses the neutral tint. Primary buttons are green with white text and a darker hover. Disabled buttons use 0.55 opacity and a not-allowed cursor. Inputs share control corners and show visible labels; search has a screen-reader label. Empty label selection disables confirmation.
- **Navigation and index:** Scope buttons and selected issue rows expose `aria-pressed`. Active navigation uses the active green pair; selected rows use the pale selected-row tint and inset outline. Search and scope filtering apply to the loaded page, which is identified above the list.
- **Review desk:** Text status and GitHub link precede repository reference and title. Two judgment columns show category/module and explicitly labeled model confidence. Missing-information guidance precedes escaped, plain-text source evidence. The separate confirmation area uses native checkboxes and wrapping action buttons. Confidence is not presented as accuracy.
- **Operational states:** Pending records allow label editing and skipping. Applying records show “待重试,” lock the original selection, and offer retry. Applied and dismissed records show history; stale records explain reimport. Busy actions are disabled and use contextual progress text. Failed or unfinished jobs appear in an expandable list with retry controls.
- **Feedback and empty states:** Errors use `role="alert"`; successful operations use `role="status"`. Empty search, empty scope, first-use inbox, and processed-page states have distinct copy. Missing repository configuration disables import and provides setup guidance. Authentication uses a password field, connection progress/error states, and a full-width primary button; the token stays in page memory.

## Do's and Don'ts

- **Do** keep evidence and the explicit confirmation area distinct, retaining additive-label behavior in the copy.
- **Do** use text alongside state color, visible keyboard focus, wrapping prose, and reduced-motion support.
- **Do** retain the mobile return-to-list behavior after completed decisions.
- **Don't** imply that model confidence guarantees correctness or use amber as a correctness score.
- **Don't** replace plain issue text with trusted HTML, introduce ornamental charts or imagery, or add depth effects unsupported by the flat review-desk direction.

## Language controls

The sign-in and workspace headers include a native language select. English is the default; Simplified Chinese is available, and explicit preferences persist locally. Headers and the import toolbar wrap for translated text. On screens at or below 780px, inputs and selects use 16px text. Changing languages keeps the current review, selections, and session; metadata, accessible labels, status messages and known errors update in place.
