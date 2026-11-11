import {
  AbsoluteFill,
  Html5Audio,
  OffthreadVideo,
  Sequence,
  staticFile,
} from "remotion";
import edit from "./edit.json";

export const Documentary = () => (
  <AbsoluteFill
    style={{ backgroundColor: "black", fontFamily: "Arial, sans-serif" }}
  >
    <Html5Audio src={staticFile("narration.wav")} />
    {edit.clips.map(({ file, from, to, sourceFrom }) => (
      <Sequence key={file} from={from} durationInFrames={to - from}>
        <OffthreadVideo
          src={staticFile(`footage/${file}`)}
          trimBefore={sourceFrom}
          muted
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
        />
      </Sequence>
    ))}
    <Sequence durationInFrames={72}>
      <div
        style={{
          position: "absolute",
          top: 54,
          left: 60,
          color: "#fff",
          textShadow: "0 2px 10px #000, 0 0 20px #000",
        }}
      >
        <div style={{ fontSize: 17, fontWeight: 700, letterSpacing: 5 }}>
          EARTH FROM ORBIT
        </div>
        <div
          style={{ fontFamily: "Georgia, serif", fontSize: 66, marginTop: 6 }}
        >
          Night pass
        </div>
      </div>
    </Sequence>
    <Sequence from={edit.durationFrames - 90} durationInFrames={90}>
      <div
        style={{
          position: "absolute",
          top: 42,
          right: 56,
          padding: "8px 12px",
          background: "rgba(0,0,0,0.72)",
          color: "white",
          fontSize: 18,
        }}
      >
        Footage: NASA Johnson Space Center and NASA Goddard SVS
      </div>
    </Sequence>
    {edit.captions.map(({ text, from, to }) => (
      <Sequence key={from} from={from} durationInFrames={to - from}>
        <AbsoluteFill
          style={{
            alignItems: "center",
            justifyContent: "flex-end",
            paddingBottom: 43,
            color: "#fff",
            fontSize: 35,
            fontWeight: 700,
          }}
        >
          <span style={{ padding: "9px 18px", background: "rgba(0,0,0,0.82)" }}>
            {text}
          </span>
        </AbsoluteFill>
      </Sequence>
    ))}
  </AbsoluteFill>
);
