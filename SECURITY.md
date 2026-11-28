# Security policy

## Reporting a vulnerability

Use the private GitHub Security Advisory form at [Report a vulnerability](https://github.com/draarivpatel-ui/nanosynth-2k/security/advisories/new). Do not open a public issue, pull request or discussion with exploit details.

Never include a live secret, token, cookie, private key, victim hostname or proprietary payload in a report. Use synthetic values and redacted transcripts.

## Supported versions

| Version | Status |
| --- | --- |
| latest `main` | Supported |

Security fixes are applied to the latest state of the default branch.

## Scope

This policy covers the static NanoSynth-2K browser application, including the deterministic state serializer, the `#ns=` share codec, generated data URIs, audio permission handling, WAV and report exports, local browser storage and browser rendering.

In scope:

- A cross-site scripting or HTML injection path through state JSON, optics or synthesizer parameters, share links, imported text or generated output.
- A share-link decoder or serialization flaw that bypasses validation, corrupts another bench state, or executes attacker-controlled code.
- A data URI or standalone-file generation flaw that emits attacker-controlled markup outside the documented byte budget.
- A report, CSV or Markdown export escaping flaw that makes generated output execute a formula or script when opened.
- An audio boundary flaw that starts capture or playback without the explicit user audio gate, or sends audio data off the device.

Out of scope:

- Browser vulnerabilities, operating system compromise or physical access to the machine.
- Damage caused by modified copies of the static application that do not come from this repository.
- The documented accuracy limits of the educational wave, optics and synthesis models, unless a report shows a specific validation or output integrity failure.

## Coordinated disclosure

- Acknowledgment: within 3 business days.
- Initial triage: within 14 calendar days.
- Fix or mitigation target: within 90 calendar days for confirmed reports.
- Coordinated public disclosure: up to 90 days by default, adjusted by mutual agreement when exploitation or user risk requires a different date.
