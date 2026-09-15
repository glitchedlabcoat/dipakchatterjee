// lib/video-transcode.ts
//
// Client-only (uses <video>, canvas, WebCodecs). Enforces the complaint
// form's video rules before a clip ever leaves the browser:
//
//   - Hard ceiling: 60 seconds. Longer clips are rejected outright —
//     there is no server-side trim, only a prompt asking the citizen to
//     pick a shorter one.
//   - Fast-track: a clip already <=10MB streams to R2 as-is (see
//     ComplaintMediaPicker) — no point re-encoding something that
//     already fits.
//   - Heavy clip (>10MB, <=60s): re-encoded in-browser via WebCodecs'
//     VideoEncoder — decode is delegated to the browser's own <video>
//     element (drawn to a canvas frame-by-frame) rather than a second,
//     hand-rolled WebCodecs VideoDecoder + container demuxer, since the
//     <video> element already does that reliably for whatever format
//     the citizen's phone/browser produced. Only the ENCODE side uses
//     WebCodecs, muxed to MP4 via the mp4-muxer package. Audio is
//     dropped (not required by the spec, and halves the bitrate budget
//     needed for a legible 720p image).
//
// Any failure at any stage (WebCodecs unsupported, encoder/muxer error,
// browser quirk) resolves to the exact fallback prompt the product spec
// calls for, rather than throwing — this is a nice-to-have compression
// path, not something that should ever hard-block a citizen's complaint.

import { Muxer, ArrayBufferTarget } from "mp4-muxer";

export const VIDEO_FAST_TRACK_MAX_BYTES = 10 * 1024 * 1024;
export const VIDEO_MAX_DURATION_SECONDS = 60;

const TARGET_HEIGHT = 720;
const TARGET_FPS = 30;
const TARGET_BITRATE = 1_200_000;
const OVER_SIZE_PROMPT =
  "Video exceeds 10 MB. Please select a clip under 10 MB or trim to under 60 seconds.";

export type VideoPrepResult = { file: File } | { error: string };

function probeVideo(file: File): Promise<{ duration: number; width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.preload = "metadata";
    video.muted = true;
    video.src = url;
    video.onloadedmetadata = () => {
      const { duration, videoWidth, videoHeight } = video;
      URL.revokeObjectURL(url);
      if (!Number.isFinite(duration) || videoWidth === 0 || videoHeight === 0) {
        reject(new Error("Could not read video metadata."));
        return;
      }
      resolve({ duration, width: videoWidth, height: videoHeight });
    };
    video.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Could not read video metadata."));
    };
  });
}

async function transcodeToUnder10MB(file: File, width: number, height: number): Promise<File> {
  const scale = Math.min(1, TARGET_HEIGHT / height);
  const outWidth = Math.max(2, Math.round((width * scale) / 2) * 2);
  const outHeight = Math.max(2, Math.round((height * scale) / 2) * 2);

  const canvas = document.createElement("canvas");
  canvas.width = outWidth;
  canvas.height = outHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable.");

  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    video: { codec: "avc", width: outWidth, height: outHeight },
    fastStart: "in-memory",
  });

  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => {
      throw e;
    },
  });
  encoder.configure({
    codec: "avc1.42001f",
    width: outWidth,
    height: outHeight,
    bitrate: TARGET_BITRATE,
    framerate: TARGET_FPS,
  });

  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.src = url;

  try {
    await new Promise<void>((resolve, reject) => {
      video.onloadeddata = () => resolve();
      video.onerror = () => reject(new Error("Could not decode source video."));
    });

    const minFrameSpacing = 1 / TARGET_FPS;
    let lastEncodedTime = -Infinity;

    await new Promise<void>((resolve, reject) => {
      const supportsRvfc = typeof video.requestVideoFrameCallback === "function";

      const step = async () => {
        if (video.ended || video.currentTime >= video.duration) {
          resolve();
          return;
        }

        if (video.currentTime - lastEncodedTime >= minFrameSpacing) {
          lastEncodedTime = video.currentTime;
          ctx.drawImage(video, 0, 0, outWidth, outHeight);
          const frame = new VideoFrame(canvas, { timestamp: Math.round(video.currentTime * 1e6) });
          // Simple backpressure: don't let the encode queue run away
          // while frames keep arriving from playback.
          while (encoder.encodeQueueSize > 4) {
            await new Promise((r) => setTimeout(r, 10));
          }
          encoder.encode(frame);
          frame.close();
        }

        if (supportsRvfc) {
          video.requestVideoFrameCallback(step);
        } else {
          setTimeout(step, 1000 / TARGET_FPS);
        }
      };

      video.onerror = () => reject(new Error("Video playback failed during transcode."));
      video
        .play()
        .then(() => {
          if (supportsRvfc) video.requestVideoFrameCallback(step);
          else setTimeout(step, 0);
        })
        .catch(reject);
    });

    await encoder.flush();
    muxer.finalize();
  } finally {
    URL.revokeObjectURL(url);
    encoder.close();
  }

  const { buffer } = muxer.target as ArrayBufferTarget;
  return new File([buffer], file.name.replace(/\.\w+$/, "") + ".mp4", { type: "video/mp4" });
}

/**
 * Validates duration, fast-tracks small clips, and attempts a WebCodecs
 * re-encode for oversized-but-short ones. Never throws.
 */
export async function prepareComplaintVideo(file: File): Promise<VideoPrepResult> {
  let meta: { duration: number; width: number; height: number };
  try {
    meta = await probeVideo(file);
  } catch {
    return { error: "Could not read this video file. Please try a different one." };
  }

  if (meta.duration > VIDEO_MAX_DURATION_SECONDS) {
    return { error: "Videos must be 60 seconds or shorter. Please trim your clip and try again." };
  }

  if (file.size <= VIDEO_FAST_TRACK_MAX_BYTES) {
    return { file };
  }

  if (typeof VideoEncoder === "undefined") {
    return { error: OVER_SIZE_PROMPT };
  }

  try {
    const compressed = await transcodeToUnder10MB(file, meta.width, meta.height);
    if (compressed.size > VIDEO_FAST_TRACK_MAX_BYTES) {
      return { error: OVER_SIZE_PROMPT };
    }
    return { file: compressed };
  } catch (err) {
    console.error("[video-transcode] WebCodecs re-encode failed:", err);
    return { error: OVER_SIZE_PROMPT };
  }
}
