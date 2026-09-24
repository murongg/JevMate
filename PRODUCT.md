# JevRepoTriage

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

React, chosen by the user. Cloudflare Workers, D1 and Queues for self-hosting. Direct code implementation, prioritizing working operations.

## Users

GitHub repository maintainers triaging incoming issues and reviewing pull requests.

## Product Purpose

Use Jev to classify issues and identify missing information, and to assess PR risk and review checks. Maintainers remain responsible for labels and any published PR comment review.

## Operating Context

The project is named JevRepoTriage. The app runs on Cloudflare Workers and lets GitHub users connect their own repositories and supply their own Jev keys.

## Capabilities and Constraints

Public GitHub sign-in, isolated personal workspaces, encrypted per-user Jev keys, multiple installations, searchable repository dashboards, asynchronous Issue analysis, additive labels after manual confirmation, imports and retryable failures. In GitHub mode, connected repositories also have an on-demand PR inbox with file summaries, Jev risk/check signals, and editable comment reviews that require an explicit confirmation. No automatic comments, closing issues, code execution, inline PR review, or automatic PR approval. Labels and module criteria come from policy.json. The model service is external; this project does not distribute model weights.

## Evidence on Hand

The project has a live Cloudflare deployment. Automated fixtures and documentation screenshots are synthetic. Preview samples must remain separate from real GitHub operations.

## Open Decisions

MIT is the license. The source repository is https://github.com/murongg/JevRepoTriage. The dark operator console uses a pixel robot across the website and GitHub App. Existing storage, queue and session identifiers stay stable across the brand rename.

## Localization

The user requested a multilingual interface with English as the default. The implementation ships English and Simplified Chinese with a persisted explicit preference. Issue content and GitHub label identifiers remain in their original language.

## Visual direction

The user requested a more bot-like, geeky and distinctive product. The current interface is a dark operator console with a pixel robot identity, green operational accents and readable source text.
