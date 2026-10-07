# Synthetic PDF fixtures

These MIT-licensed fixtures contain no real personal data or credentials.
`text.pdf` has a project memo and a quoted malicious instruction. `scan.pdf` has
an image-only receipt. `mixed.pdf` combines a text-rich introduction with that
receipt. `long.pdf` has six pages and a page-six canary. `protected.pdf` encrypts
the memo with the public fixture password `fixture-pass`. `scan-source.png` is
the source image used by the scanned fixtures.

They were generated with ReportLab, Pillow and pypdf. Runtime tests use the
pinned OpenClaw bundled extractor, without depending on Python at test time.
