# Reel Guard

Cut a short documentary from the narration and 12 stock shots in `public/`.
Edit `src/edit.json` and preview the cut with `npm run dev`.

Install dependencies with `npm ci`. Put FFmpeg and ffprobe on your PATH, then
start Claude Code from this folder.

- Edits to TypeScript or the timeline run the same checks as `npm run check:timeline`.
  They cover footage gaps and overlaps, clip reuse, 1–8s cuts, caption timing
  against the reference cues, and duration against the narration WAV.
- The Stop hook runs the same checks first. If they pass, it renders at 25%
  scale and scans for black frames (0.5s), freezes (3s), and silence (0.8s).
  It blocks once, then checks the correction and reports any remaining failure.
- Run `npm run check:video` in CI. It exits nonzero on any failure and appends a
  row to `evals.jsonl`. A timeline failure has `renderAttempted: false`.

`brief.json` holds the reference narration cues and source credits. The caption
check compares cue text and timing within three frames. It does not transcribe
the render or judge the quality of the cut.

Video courtesy of the Earth Science and Remote Sensing Unit, NASA Johnson
Space Center, and [NASA Goddard SVS](https://svs.gsfc.nasa.gov/). See the brief
for the original footage links and ranges. Narration uses macOS text to speech.
