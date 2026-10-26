# Design

## Direction

**The quiet auction room.** A financial broadsheet, not a trading dashboard. Paper-like surfaces, ruled rows, generous margins, one accent doing the work of orientation. The screen should feel like a document someone prepared carefully: a folio header with the ledger reference, a clear hierarchy, numbers aligned in columns.

Confidentiality is expressed structurally, not with magic: sealed fields look sealed (a field with no value and a lock line, "selado até a apuração"), public data looks like ordinary tabular data. The interface never draws a price it does not have.

Not: purple gradients, glass panels, floating blobs, giant marketing numbers, card grids of icons, dark neon trading chrome.

## Visual authority

Ledger books, auction catalogues, and terminal-grade financial printing. Ink on paper by default; the same document under a desk lamp in dark mode. Borders and type carry structure; shadows are rare and shallow.

## Tokens

Base palette from F-17. Everything else derives from it.

| Token | Light | Dark | Use |
|---|---|---|---|
| `--bg` | `#f8fafc` | `#030712` | page |
| `--bg-sunken` | `#eef2f6` | `#070b12` | rails, inset areas |
| `--surface` | `#ffffff` | `#0b0f19` | sheets, rows |
| `--ink` | `#0f172a` | `#f3f4f6` | primary text |
| `--ink-2` | `#475569` | `#a8b0bd` | secondary text |
| `--ink-3` | `#64748b` | `#8b93a1` | labels, captions (AA-checked per surface) |
| `--line` | `#e2e8f0` | `#1f2937` | hairlines |
| `--line-strong` | `#cbd5e1` | `#334155` | input borders |
| `--primary` | `#635bff` | `#7c75ff` | primary action, selection, current nav |
| `--primary-soft` | `#eeecff` | `#171533` | selected background |
| `--accent` | `#00a88f` | `#00d4b2` | confidential/sealed markers, live |
| `--success` | `#0f9f6e` | `#34d399` | settled, confirmed |
| `--warning` | `#b45309` | `#fbbf24` | deadline, operator late |
| `--danger` | `#dc2626` | `#f87171` | failure, destructive |
| `--focus` | `#635bff` | `#a5a0ff` | focus ring |

Radius: 10px controls, 16px sheets. Shadows: `0 1px 2px rgb(15 23 42 / .04)` light; none in dark, borders instead.

**Colour rules.** Primary appears only on the main action of a view, the current navigation item, and selected controls. Teal is reserved for "sealed/confidential/live" markers. Status is always dot + text. No gradients. No coloured left borders. Never gray on a coloured surface: tint from the surface hue.

## Typography

One family: **Plus Jakarta Sans Variable** (self-hosted via `@fontsource-variable`, no CDN), with Inter as declared fallback. **JetBrains Mono Variable** only for addresses, hashes, ledger numbers, and tabular numeric cells where character alignment matters.

Fixed rem scale, ratio ~1.18: 12 / 14 / 16 / 19 / 23 / 28 / 34 / 44. Body 15–16px, line-height 1.55. Display max 44px in-app, tracking −0.025em. Numeric data: `font-variant-numeric: tabular-nums`. Prose measure 65–72ch; tables may run wider.

No eyebrow/kicker above headings. A heading carries its own weight. Labels above fields are 12px, medium, `--ink-2`, sentence case ("Preço por cota").

## Layout

- Desktop: 232px left rail (logo, sections, mode switch), content column max 1120px, 32–48px gutters. Utility strip above the page: network badge, ledger, theme.
- Page pattern: folio header (title + one-line context left, ledger reference in mono right), then content. No centered hero.
- Market detail: 1fr + 348px aside. Aside holds the next action, operator progress, and the sealed-price notice; sticky below 24px.
- Sheets, not card grids. A sheet is a bordered surface with a title row and ruled content. No card inside a card: nested grouping uses indentation, hairlines, or a sunken band.
- Tables at ≥768px; below that, each row becomes a labelled block with the same data, never a horizontal scroll for primary content.
- Mobile: top bar + section navigation in a scrollable strip; aside content moves directly under the next action.

## Components

- **Buttons:** 40px (32 compact), 10px radius, 1px border; primary filled violet, secondary surface with border, ghost text. States: hover (darken 4%), active (translateY 1px), focus-visible ring, disabled (40% + not-allowed), loading (spinner replaces label content, label stays in DOM for width).
- **Fields:** persistent label, 44px control, 1px `--line-strong`, focus ring + border primary; help text 12px; error text with icon and `aria-describedby`; no placeholder-as-label.
- **Status:** 6px dot + 12px text in a pill-less inline cluster. Open (teal), Created (neutral), Closed/Finalized (violet), Settled (green), Cancelled (danger).
- **Demand bar:** 4px track, filled proportion of demand over total; the number is always adjacent. Not a ring.
- **Timeline:** vertical hairline, 8px nodes, ledger in mono on the right. Events read as sentences, not codes.
- **Proof progress:** three named stages (Preparando circuitos → Gerando provas → Assinando), determinate bar, elapsed seconds. It is the only place with a determinate progress bar.
- **Toasts (Sonner):** bottom-right, 360px max, surface + border, title = action, description = hash/ledger, one action. Wallet state is shown inside the toast: assinando → enviando → confirmado/falhou.
- **Dialogs:** native `<dialog>`, centered, 480px, for irreversible confirmations only (cancel market, forget key, submit bid is a page section, not a modal).
- **Skeletons:** 2–3 text-shaped bars, no shimmer sweep; a soft opacity pulse at 1.6s.

## Motion

150–220ms, exponential ease-out (`cubic-bezier(.16,1,.3,1)`); exits 140ms ease-in. Motion only for state: menu/dialog open, toast enter, disclosure, row hover, progress width. No page-load choreography, no stagger on lists, no parallax. One authored moment per view at most: the bid confirmation reveal (opacity + 6px rise). `prefers-reduced-motion` removes transforms and shortens durations to 1ms.

## States and content ranges

Every surface has: loading, empty, error, and disabled explanations. Empty states teach the next action with a real control. A list of 0, 1, 10 and 50 markets must hold. Long asset codes, 56-character addresses, 7-decimal amounts, large totals (≥ 2^53 stroops) and missing event windows are normal content, not edge cases.

## Copy

pt-BR, direct, second person, no exclamation marks. Controls name the action ("Travar e enviar lance", not "Continuar"). Errors name the problem and the recovery ("O leilão fechou antes do lance. Nada foi travado."). Never show raw SDK messages or causes. Numbers are formatted with the product's own `formatXlm`/`formatQuotas`, never `toLocaleString` ad hoc.

## Per-block craft application

This maps the installed design skills to the roadmap. It is the working brief for each block, not a checklist to quote back to the user.

| Block | Design work | Skills applied |
|---|---|---|
| **0 · Fundação** | Tokens, type scale, self-hosted fonts, focus/selection/scrollbar/caret theming, reduced-motion baseline, sheet/table/button primitives, app shell. | Impeccable Operate + craft floor; Emil `emil-design-eng` for component state details; `pick-ui-library` only as a sanity check (the repo already fixed the stack). |
| **1 · Ambiente** | No user-facing surface. Script output is treated as UI copy: explicit success lines, no secrets printed, errors that say what to run next. | Impeccable copy rules applied to CLI messages; no motion. |
| **2 · Carteira e conta** | Onboarding as a sequence of decisions, never a carousel. Backup is a serious, quiet screen with a real download and an explicit confirmation. Wallet balances read as a statement, not a hero metric. Sync states are legible. | Impeccable state-rich semantics and copy; Emil motion for toasts/dialogs; `ask-sonner` when building the transaction toast. |
| **3 · Leilões (público)** | Auction list as a ruled ledger with countdown and demand; detail page with a timeline and an operator-progress narrative. Public vs sealed data must be visibly different. | Impeccable Operate density + no card-in-card; craft-floor browser surfaces; Emil `animate` only for disclosure/timeline arrival, `review-animations` as a pass. |
| **4 · Empresa** | Prerequisites as a checklist with one action each. Creation wizard as a document being filled: step rail, fieldsets, review sheet. 10% fee and net per quota shown as arithmetic, not a marketing claim. | Impeccable shape (brief already fixed by SCREENS), Operate forms; Emil input/focus microinteractions; `break-ui` on long SACs, huge quotas, empty states. |
| **5 · Investidor** | Bid checklist before the form. Price is entered once and then rendered only as a sealed placeholder after preparation. Confirmation is a page section; the unlock/submit sequence shows wallet steps. Recovery screen is calm and specific. | Impeccable copy and state semantics; Emil `animate` for proof stages and the confirmation reveal; craft floor for focus and disabled states; secrets audit as a design constraint. |
| **6 · Ponta a ponta** | No new UI. Verify the narrative end to end: created → open → closed → operator late → cancelled/settled reads correctly in the detail page. | `review-animations` and Impeccable finish pass on the flows, if the operator exists. |
| **7 · Qualidade** | Contrast, keyboard, 200% zoom, mobile widths, empty/error/loading coverage, no gradient text, no emoji icons, themed browser surfaces, honest README screenshots. | Impeccable craft floor as an audit; Emil `review-animations`; `break-ui` worst-case data; no new direction. |

## Anti-goals

- No landing-page hero above the auction list. The list is the product.
- No fake live activity, fake logos, or invented statistics.
- No prices, even blurred, for other bidders: the data does not exist client-side and must not be simulated.
- No "connect wallet" blocking public browsing.
- No glassmorphism, gradient text, oversized rounded cards, kickers, section numbers, or confetti.
- No animated number counters. Numbers change; they do not perform.
