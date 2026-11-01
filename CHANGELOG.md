# Changelog

All notable changes to LocalCutVideo. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), versioning: [SemVer](https://semver.org/).

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
