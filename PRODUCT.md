# JevMate

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

React, chosen by the user. Cloudflare Workers, D1 and Queues for self-hosting. Direct code implementation, prioritizing working operations.

## Users

Open-source GitHub repository maintainers triaging incoming issues.

## Product Purpose

Use Jev to classify issues and identify missing information, then let a maintainer review and apply labels.

## Operating Context

The user chose the name JevMate and the local project directory. This first version is self-hosted, using the deployer's GitHub App installation and Jev API key.

## Capabilities and Constraints

One installation per deployment, explicit repository allowlist, asynchronous analysis, additive labels after manual confirmation, batch imports and retryable failures. No automatic comments, closing issues, code execution, or multi-user tenancy in this version. Labels and module criteria come from policy.json. The model service is external; this project does not distribute model weights.

## Evidence on Hand

No live credentials are configured. Automated fixtures are synthetic. Any preview samples must be explicitly marked synthetic and must not enter real GitHub operations.

## Open Decisions

MIT is the proposed default license for this implementation. The source repository is https://github.com/murongg/JevMate. A production deployment has not been configured. UI details follow an operational list/detail layout; no existing branding assets are available.

## Localization

The user requested a multilingual interface with English as the default. The implementation ships English and Simplified Chinese with a persisted explicit preference. Issue content and GitHub label identifiers remain in their original language.

## Visual direction

The user requested a more bot-like, geeky and distinctive product. The current interface is a dark operator console with a pixel robot identity, green operational accents and readable source text.
