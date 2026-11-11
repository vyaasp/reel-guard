import { Composition } from "remotion";
import { Documentary } from "./Composition";
import edit from "./edit.json";

export const RemotionRoot = () => (
  <Composition
    id="Main"
    component={Documentary}
    durationInFrames={edit.durationFrames}
    fps={edit.fps}
    width={1280}
    height={720}
  />
);
