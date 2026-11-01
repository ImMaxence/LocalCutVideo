# Changelog

All notable changes to LocalCutVideo. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), versioning: [SemVer](https://semver.org/).

## [0.14.0] - 2026-11-01

### Added
- Guided tour of the editor: arrows and highlights on each tool, started by the demo video, "?" button to replay it
- Whisper models served by the site itself (downloaded at the Docker build), Hugging Face only as a backup

### Changed
- Privacy policy: the AI model comes from this site

### Fixed
- Transcription errors are logged in the browser console for diagnosis

## [0.13.0] - 2026-11-01

### Added
- Public pages prerendered in every language, with one URL per language (/fr, /es, /it, /de)
- Page titles, descriptions, canonical URLs, language alternates, schema.org data, sitemap.xml, robots.txt, llms.txt
- "Try with a demo video" on the landing page
- Transitions at cuts: quick fade or fade to black
- Texts over the video (titles, notes) with the thumbnail title styles
- Background blur behind the person (MediaPipe selfie segmentation)
- Voice noise reduction (RNNoise) at export, with "listen to 8 s of the result"
- Save a project as a .lcv.json file and open it on another computer
- Unit tests (Vitest) of the engine and end-to-end tests (Playwright) of the key flows

### Changed
- A reconnected video with the same name and size is accepted without confirmation
- Visitors are sent to the pages in their language

## [0.12.1] - 2026-11-01

### Added
- Speed change for the words selected in the transcript

### Changed
- Dragging on the waveform selects a part (then Cut or Speed) instead of cutting it at once
- Cut and Speed are never greyed out: without a selection they explain how to make one

## [0.12.0] - 2026-11-01

### Added
- Speed changes: speed up or slow down a part (0.25× to 4×) from the Start / End marks, pitch kept in preview and export
- Thumbnail maker: hold ‹ › to scroll through the frames, ← → keys (Shift: 1 s)
- Auto edit button in the landing page mockup

### Fixed
- Site header overflowing (flag-only language picker, icon install button, menu below 1200 px)

## [0.11.0] - 2026-11-01

### Added
- Thumbnail maker: best moments suggested, big title with highlighted words, 4 styles, JPG / PNG for YouTube, Shorts and square
- Video volume up to 300 % with a limiter, mute, clip leveling
- Project rotation in 90° steps (preview, export, face tracking)
- Auto edit asks whether someone speaks in each clip, with automatic voice detection
- Clips without voice: no transcription or subtitles, only real dead air is cut

### Changed
- "Music" tab renamed "Sound"
- Silence cuts computed clip by clip
- Music ducking ignores clips without voice
- Export uses a peak limiter instead of hard clipping

### Fixed
- Auto cut chopped videos without speech (street, nature) into pieces

## [0.10.0] - 2026-11-01

### Added
- Selected cut editor on the timeline: start / end nudges (±0.1 s), listen, remove
- Delete removes the selected cut, Escape deselects it

### Changed
- Wider, visible cut edge handles
- An adjusted silence cut becomes manual and is kept by live re-detection

### Fixed
- Drawing a cut on the waveform did nothing (drag-to-seek swallowed the drag)
- Inspector content clipped on the right (face tracking row)
- Transcript selection buttons cut off in a narrow panel
- Timeline crushed in short windows and the two-column layout
- Colored edges on the auto edit button

## [0.9.0] - 2026-11-01

### Added
- Auto edit: one click for transcription, fillers, silences, framing, zoom and subtitles; undo in one step
- Manual cut with Start / End / Cut buttons (keys I, O, X)
- Transcript correction: retype a word or a whole sentence (Enter)

### Changed
- More compact preview on phones
- Audio uses the first decodable track (iPhone spatial audio ignored)

### Fixed
- Reopened project stuck on the waveform loader after reconnecting a clip
- Audio analysis errors now show a retry instead of an endless loader
- Editor wider than the screen on phones

## [0.8.0] - 2026-11-01

### Added
- Automatic spoken-language detection (Whisper language ID, majority vote)
- "Transcribe everything again" and "Transcribe the new clips" buttons
- Auto-cut from the transcript, rhythm presets, cuts updated live
- Preview quality (360p / 540p / 720p) with a "light preview" badge
- Timeline zoom buttons, "Fit" and Ctrl + wheel
- Language picker in the editor
- Mobile editor layout with a bottom tab bar
- Styled dropdowns, sliders and scrollbars

### Changed
- Resolution and frame rate moved to the export dialog
- Smart zoom also works without cuts (on sentences, else every 4 s)
- "Follow the face" starts face tracking by itself
- Silence detection: smoothing, hysteresis, short noises ignored
- Waveform scaled on the voice, not on the loudest sound

### Fixed
- Timeline zoom stretched the whole editor
- Automatic language mode transcribed other languages into English
- French elisions split by Whisper ("j 'ai")
- Inspector content clipped on the left

## [0.7.0] - 2026-11-01

### Added
- Multi-clip projects: import several videos at once, reorder, add or remove clips
- Unreadable files are skipped and reported instead of blocking the import
- Legal notice, privacy policy and terms of use pages (5 languages)
- Language picker with flags and three-way theme switch
- Mobile navigation menu
- Page transitions and scroll animations

### Changed
- Reconnect screen lists every clip with its own status
- Server access logs disabled

## [0.6.0] - 2026-11-01

### Added
- PWA: offline mode, install button, "open with" for video files, update toast
- App version in the footer and in-app changelog page
- Docker image (nginx, COOP/COEP, strict CSP) and Docker Compose for Coolify
- README with screenshots
- MIT license

## [0.5.0] - 2026-11-01

### Added
- Waveform timeline (Wavesurfer.js) with draggable, resizable cuts
- WYSIWYG canvas preview: skips cuts, plays ducked music
- MP4 export with WebCodecs + Mediabunny, streamed to disk when supported
- Undo / redo and keyboard shortcuts

## [0.4.0] - 2026-11-01

### Added
- Output formats: 16:9, 9:16, 1:1
- Silence auto-cut with adaptive threshold
- Whisper word-level subtitles: karaoke, clean, boxed
- Text-based editing and filler-word removal
- Face auto-framing (MediaPipe) and punch-in smart zoom
- Background music with auto-ducking

## [0.3.0] - 2026-11-01

### Added
- Media worker: probe, 16 kHz mono audio extraction in RAM, waveform peaks
- AI worker: Whisper via Transformers.js (WebGPU, WASM fallback)
- Self-hosted ONNX Runtime and MediaPipe binaries

## [0.2.0] - 2026-11-01

### Added
- Zero-upload import with the File System Access API, file input fallback
- Local database with Dexie (IndexedDB)
- Auto-save with RxJS `debounceTime`
- Crash recovery: reconnects the video file on reopen

## [0.1.0] - 2026-11-01

### Added
- Angular 22 app: standalone components, zoneless, signals
- Landing page
- Native light/dark theme (`prefers-color-scheme`) with manual toggle
- i18n: EN, FR, ES, IT, DE
