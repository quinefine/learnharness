# Save to Anki

Lesson questions and practice problems can be saved selectively to desktop Anki. Open the quiet **⋯** menu in the question or practice card header and choose **Save to Anki**.

## Requirements

1. Desktop Anki must be running with AnkiConnect enabled.
2. AnkiConnect must listen on `http://127.0.0.1:8765`, or set `ANKI_CONNECT_URL` for the LearnHarness server.
3. Save from a lesson or practice session on the same machine, or from a server that can reach that AnkiConnect address.

The default deck is `LearnHarness`. The note type is `LearnHarness Practice`. The first save creates them if needed. Creating a note type is an Anki schema change, so Anki may require a full sync on the next AnkiWeb sync.

## Auto-save

The same menu has two independent preferences:

- **Correct answers**: graded correct lesson answers, plus practice outcomes `solved` and `solvedWithHints`.
- **Incorrect answers**: graded incorrect or don't-know lesson answers, plus practice outcome `surrendered`.

Both preferences start off. With both off, saving is manual only. `movedOn` and dismissed practice problems have no correctness verdict, so they never auto-save.

Auto-save applies only to newly completed work. Opening an old session does not export its history. Preferences persist in local storage on the current browser.

## Previous questions and practice

Answered lesson cards, old problem cards, and concluded practice cards expose the same **⋯** menu for retroactive manual saves. The item must retain its original correct answer or model solution. Preference questions and incomplete old records without that data are not eligible.

The committed solution is never shown by the menu itself. It appears only on the Anki back.

## Saved content

- The question and its options, when present.
- The correct answer or committed model solution.
- A separate explanation when the lesson provides one.
- Practice mode, proposition targets, and the source session.

## Repeated saves

`SourceId` identifies the saved question. Saving the same lesson question or practice problem again updates the existing note instead of creating a duplicate. Active and retroactive practice saves share the original problem identity. Concurrent saves of one source are serialized, and an update refreshes its fields and tags. Different source IDs may contain the same question text; Anki's content-level duplicate check does not decide identity.

The browser route accepts same-origin JSON requests only. It validates the request `Host` and never trusts spoofable forwarding headers. If a proxy rewrites `Host`, set `ANKI_PUBLIC_ORIGIN` to the deployment's trusted public origin. Native or server callers without an `Origin` header remain supported.

AnkiConnect writes only to desktop Anki. It does not trigger an AnkiWeb sync. Sync desktop Anki to review saved cards on a phone.

## Verification

- `tests/anki-connect.test.ts`: protocol, deduplication, field formatting, and errors.
- `tests/anki-export.test.ts`: stable snapshots, preferences, outcomes, and old-session protection.
- `tests/anki-save-route.test.ts`: route validation and proxy origin handling.
- `tests/anki-save-menu.test.tsx`: explicit saves, preference opt-in, and double-click locking.
- `tests/render-anki-save.test.tsx`: pending and retroactive lesson/practice menus and solution hiding.
- `tests/anki-live.test.ts`: opt-in real AnkiConnect integration. Run with `ANKI_LIVE=1` against a disposable profile.
