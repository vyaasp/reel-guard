import { spawnSync } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const bin = (name) => join(root, "node_modules", ".bin", name);
const json = (path) => JSON.parse(readFileSync(join(root, path), "utf8"));
const short = (value) =>
  value.trim().split("\n").slice(-16).join("\n").slice(-1800);

function run(command, args, label, timeout = 12_000) {
  const { status, error, stdout, stderr } = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    timeout,
    killSignal: "SIGKILL",
  });
  if (error || status !== 0) {
    throw new Error(
      `${label}: ${short(error?.message ?? (stderr || stdout || `exit ${status}`))}`,
    );
  }
  return { stdout, stderr };
}

function probe(path) {
  const { stdout } = run(
    "ffprobe",
    [
      "-v",
      "error",
      "-show_entries",
      "format=duration:stream=codec_type,duration",
      "-of",
      "json",
      path,
    ],
    `Could not inspect ${path}`,
  );
  return JSON.parse(stdout);
}

function positiveDuration(value, label) {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) {
    throw new Error(`No valid duration for ${label}.`);
  }
  return seconds;
}

const frame = (n) => Number.isSafeInteger(n) && n >= 0;
const span = (s) => s && frame(s.from) && frame(s.to) && s.to > s.from;
const timedText = (s) => span(s) && typeof s.text === "string" && s.text.trim();
const footageName = (s) =>
  typeof s === "string" && /^[a-z0-9][a-z0-9-]*\.mp4$/.test(s);
const sameText = (a, b) =>
  a.trim().replace(/\s+/g, " ") === b.trim().replace(/\s+/g, " ");

function inspectTimeline(scores) {
  const brief = json("brief.json");
  const edit = json("src/edit.json");
  const { fps, cues, footage } = brief;
  if (
    !frame(fps) ||
    fps === 0 ||
    brief.narration !== "public/narration.wav" ||
    !Array.isArray(cues) ||
    !cues.length ||
    !cues.every(timedText) ||
    !Array.isArray(footage) ||
    !footage.every((asset) => footageName(asset?.file))
  ) {
    throw new Error(
      "brief.json needs a valid frame rate, narration, reference cues, and footage list.",
    );
  }
  if (
    edit.fps !== fps ||
    !frame(edit.durationFrames) ||
    edit.durationFrames === 0 ||
    !Array.isArray(edit.clips) ||
    !Array.isArray(edit.captions)
  ) {
    throw new Error(
      `src/edit.json needs fps=${fps}, a positive durationFrames, clips, and captions.`,
    );
  }

  const seconds = (f) => (f / fps).toFixed(2);
  const narration = probe(brief.narration);
  const narrationSeconds = positiveDuration(
    narration.streams?.find((s) => s.codec_type === "audio")?.duration,
    brief.narration,
  );
  const narrationFrames = Math.round(narrationSeconds * fps);
  scores.narrationSeconds = narrationSeconds;
  scores.timelineSeconds = edit.durationFrames / fps;
  const errors = [];
  if (Math.abs(scores.timelineSeconds - narrationSeconds) > 1 / fps + 1e-6) {
    errors.push(
      `Timeline is ${seconds(edit.durationFrames)}s; narration is ${narrationSeconds.toFixed(2)}s.`,
    );
  }

  const available = new Set(footage.map(({ file }) => file));
  const seen = new Set();
  let cursor = 0;
  Object.assign(scores, {
    footageGapFrames: 0,
    footageOverlapFrames: 0,
    reusedClips: 0,
    invalidClips: 0,
    captionMismatches: 0,
    captionMaxDriftFrames: 0,
  });
  if (!edit.clips.every(span)) {
    throw new Error("Every clip needs integer frame bounds with from < to.");
  }
  for (const { file, from, to, sourceFrom } of [...edit.clips].sort(
    (a, b) => a.from - b.from,
  )) {
    if (from > cursor) {
      scores.footageGapFrames += Math.max(
        0,
        Math.min(from, narrationFrames) - cursor,
      );
      errors.push(
        `Footage gap ${seconds(cursor)}–${seconds(from)}s. Extend or add a shot.`,
      );
    }
    if (from < cursor) {
      scores.footageOverlapFrames += Math.min(to, cursor) - from;
      errors.push(`Footage overlaps at ${seconds(from)}s.`);
    }
    cursor = Math.max(cursor, to);
    const length = to - from;
    if (length < fps || length > 8 * fps || to > edit.durationFrames) {
      scores.invalidClips++;
      errors.push(
        `${file} at ${seconds(from)}s must last 1–8s and end within the timeline.`,
      );
    }
    if (
      !available.has(file) ||
      !existsSync(join(root, "public", "footage", String(file)))
    ) {
      scores.invalidClips++;
      errors.push(`Unknown or missing footage: ${file}.`);
    } else if (!frame(sourceFrom)) {
      scores.invalidClips++;
      errors.push(`${file} needs a nonnegative integer sourceFrom frame.`);
    } else if (!seen.has(file)) {
      const media = probe(`public/footage/${file}`);
      const assetDuration = positiveDuration(
        media.streams?.find((s) => s.codec_type === "video")?.duration,
        file,
      );
      if ((sourceFrom + length) / fps > assetDuration + 1e-6) {
        scores.invalidClips++;
        errors.push(
          `${file} ends before the requested cut. Use a shorter trim or another clip.`,
        );
      }
    }
    if (seen.has(file)) {
      scores.reusedClips++;
      errors.push(`${file} is used more than once. Pick a different shot.`);
    }
    seen.add(file);
  }
  if (cursor < narrationFrames) {
    scores.footageGapFrames += narrationFrames - cursor;
    errors.push(
      `Footage gap ${seconds(cursor)}–${seconds(narrationFrames)}s at the end.`,
    );
  }

  if (edit.captions.length !== cues.length) {
    errors.push(
      `Found ${edit.captions.length} captions; the narration has ${cues.length} cues.`,
    );
    scores.captionMismatches += Math.max(0, edit.captions.length - cues.length);
  }
  cues.forEach((cue, i) => {
    const caption = edit.captions[i];
    if (!timedText(caption) || !sameText(caption.text, cue.text)) {
      scores.captionMismatches++;
      errors.push(
        `Caption ${i + 1} should say "${cue.text}" at ${seconds(cue.from)}s.`,
      );
      return;
    }
    const drift = Math.max(
      Math.abs(caption.from - cue.from),
      Math.abs(caption.to - cue.to),
    );
    scores.captionMaxDriftFrames = Math.max(
      scores.captionMaxDriftFrames,
      drift,
    );
    if (
      drift > 3 ||
      caption.to > edit.durationFrames ||
      caption.from < edit.captions[i - 1]?.to
    ) {
      scores.captionMismatches++;
      errors.push(
        `Caption ${i + 1} is out of sync. Use frames ${cue.from}–${cue.to}.`,
      );
    }
  });

  if (errors.length) throw new Error(errors.slice(0, 8).join("\n"));
}

function inspectRender(scores) {
  const dir = mkdtempSync(join(tmpdir(), "reel-guard-"));
  const output = join(dir, "preview.mp4");
  try {
    scores.renderAttempted = true;
    run(
      bin("remotion"),
      [
        "render",
        "src/index.ts",
        "Main",
        output,
        "--scale=0.25",
        "--concurrency=3",
        "--log=error",
      ],
      "Remotion render failed",
      195_000,
    );
    const { streams } = probe(output);
    const video = streams?.find((s) => s.codec_type === "video");
    const audio = streams?.find((s) => s.codec_type === "audio");
    scores.videoSeconds = positiveDuration(video?.duration, "rendered video");
    scores.audioSeconds = positiveDuration(audio?.duration, "rendered audio");

    // Exclude the caption band so changing subtitles cannot hide frozen footage.
    const { stderr } = run(
      "ffmpeg",
      [
        "-nostdin",
        "-hide_banner",
        "-nostats",
        "-loglevel",
        "info",
        "-i",
        output,
        "-map",
        "0:v:0",
        "-map",
        "0:a:0",
        "-vf",
        "crop=iw:trunc(ih*0.8/2)*2:0:0,blackdetect=d=0.5:pix_th=0.10,freezedetect=n=0.001:d=3",
        "-af",
        "silencedetect=n=-50dB:d=0.8",
        "-f",
        "null",
        "-",
      ],
      "FFmpeg could not scan the render",
    );
    scores.blackSections = [
      ...stderr.matchAll(/black_start:([\d.]+).*black_end:/g),
    ].map((m) => Number(m[1]));
    scores.freezeSections = [
      ...stderr.matchAll(/freeze_start:\s*([\d.]+)/g),
    ].map((m) => Number(m[1]));
    scores.silentSections = [
      ...stderr.matchAll(/silence_start:\s*([\d.]+)/g),
    ].map((m) => Number(m[1]));
    const errors = [];
    for (const [label, seconds] of [
      ["Video", scores.videoSeconds],
      ["Audio", scores.audioSeconds],
    ]) {
      if (Math.abs(seconds - scores.narrationSeconds) > 1) {
        errors.push(
          `${label} is ${seconds}s; narration is ${scores.narrationSeconds}s.`,
        );
      }
    }
    for (const [label, times] of [
      ["Black footage", scores.blackSections],
      ["Frozen footage", scores.freezeSections],
      ["Silent audio", scores.silentSections],
    ]) {
      if (times.length)
        errors.push(
          `${label} starting at ${times.map((s) => s.toFixed(2)).join(", ")}s.`,
        );
    }
    if (errors.length) throw new Error(errors.join("\n"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const mode = process.argv[2];
const isHook = mode === "quick" || mode === "stop";
const scores = {
  ts: new Date().toISOString(),
  mode,
  phase: "input",
  renderAttempted: false,
};
let issue;
try {
  // Read the hook payload once. The same check can also run without Claude Code.
  const input = isHook ? JSON.parse(readFileSync(0, "utf8")) : {};
  if (mode === "quick") {
    const path = input.tool_input?.file_path;
    if (typeof path !== "string") process.exit(0);
    const absolute = resolve(input.cwd ?? root, path);
    const file = relative(
      root,
      existsSync(absolute) ? realpathSync(absolute) : absolute,
    );
    if (
      isAbsolute(file) ||
      file.startsWith("..") ||
      !(
        /\.tsx?$/.test(file) ||
        file === "src/edit.json" ||
        file === "brief.json"
      )
    )
      process.exit(0);
    scores.file = file;
  }
  scores.retry = input.stop_hook_active === true;
  scores.phase = "types";
  run(bin("tsc"), ["--noEmit", "--pretty", "false"], "TypeScript check failed");
  scores.phase = "timeline";
  inspectTimeline(scores);
  if (mode === "stop" || mode === "full") {
    scores.phase = "render";
    inspectRender(scores);
  }
} catch (error) {
  issue = error.message;
}
scores.result = issue ? "fail" : "pass";
if (issue) scores.issue = short(issue);
try {
  appendFileSync(join(root, "evals.jsonl"), JSON.stringify(scores) + "\n");
} catch (error) {
  issue = [issue, `Could not log the check: ${error.message}`]
    .filter(Boolean)
    .join("\n");
}

const pass =
  scores.phase === "render"
    ? `Reel Guard passed: ${scores.videoSeconds?.toFixed(2)}s at quarter resolution. No black, frozen, or silent sections.`
    : "Reel Guard passed the timeline check. No render needed.";
if (issue && mode === "stop" && scores.retry) {
  console.log(
    JSON.stringify({
      systemMessage: `Reel Guard still fails after one correction. Run npm run check:video after fixing it.\n${issue}`,
    }),
  );
} else if (issue) {
  console.error(`Reel Guard ${scores.phase} check failed:\n${issue}`);
  if (mode === "stop")
    console.error(
      "Fix the edit and try again. Keep the narration and brief unchanged.",
    );
  process.exitCode = isHook ? 2 : 1;
} else if (!isHook) {
  console.log(pass);
} else if (scores.retry) {
  console.log(JSON.stringify({ systemMessage: pass }));
}
