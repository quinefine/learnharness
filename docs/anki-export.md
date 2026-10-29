# Save to Anki

Lesson questions and practice problems can be saved selectively to desktop Anki. Use **Save to Anki** in the question or practice dock. Saving never happens automatically.

## Requirements

1. Desktop Anki must be running with AnkiConnect enabled.
2. AnkiConnect must listen on `http://127.0.0.1:8765`, or set `ANKI_CONNECT_URL` for the LearnHarness server.
3. Save from a lesson or practice session on the same machine, or from a server that can reach that AnkiConnect address.

The default deck is `LearnHarness`. The note type is `LearnHarness Practice`. The first save creates them if needed. Creating a note type is an Anki schema change, so Anki may require a full sync on the next AnkiWeb sync.

## Saved content

- The question and its options, when present.
- The correct answer or committed model solution.
- A separate explanation when the lesson provides one.
- Practice mode, proposition targets, and the source session.

The committed solution is never shown by the Save button itself. It appears only on the Anki back.

## Repeated saves

`SourceId` identifies the saved question. Saving the same lesson question or practice problem again updates the existing note instead of creating a duplicate. Concurrent saves of one source are serialized, and an update refreshes its fields and tags. Different source IDs may contain the same question text; Anki's content-level duplicate check does not decide identity.

The browser route accepts same-origin JSON requests only. Native or server callers without an `Origin` header remain supported.

AnkiConnect writes only to desktop Anki. It does not trigger an AnkiWeb sync. Sync desktop Anki to review saved cards on a phone.

## Verification

- `tests/anki-connect.test.ts`: protocol, deduplication, field formatting, and errors.
- `tests/anki-save-route.test.ts`: route validation.
- `tests/render-anki-save.test.tsx`: both Save buttons and solution hiding.
- `tests/anki-live.test.ts`: opt-in real AnkiConnect integration. Run with `ANKI_LIVE=1` against a disposable profile.
