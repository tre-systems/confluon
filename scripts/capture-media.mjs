import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { run } from "./video-cli.mjs";

export function recorderTypes(losslessAudio) {
  return losslessAudio
    ? ["video/webm;codecs=vp9,pcm", "video/webm;codecs=vp8,pcm"]
    : ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus",
      "video/webm;codecs=vp9", "video/webm"];
}

export function validateLosslessOptions({ losslessAudio, silent, containers }) {
  if (!losslessAudio) return;
  if (silent) throw new Error("--lossless-audio cannot be combined with --silent");
  if (containers.some((container) => container !== "mp4")) {
    throw new Error("--lossless-audio requires --containers mp4; the PCM source is retained as Matroska");
  }
}

export function probeMedia(path) {
  return JSON.parse(run("ffprobe", [
    "-v", "error", "-show_entries",
    "format=duration:stream=index,codec_type,codec_name,sample_rate,channels,bits_per_sample,bits_per_raw_sample,start_time,duration,width,height,avg_frame_rate",
    "-of", "json", path,
  ]).stdout);
}

export function assertPcmMaster(probe, expectedDuration) {
  const streams = probe.streams.filter((stream) => stream.codec_type === "audio");
  const audio = streams[0];
  if (streams.length !== 1 || !["pcm_f32le", "pcm_s16le", "pcm_s24le"].includes(audio.codec_name)) {
    throw new Error("Lossless capture requires one supported PCM audio stream; refusing a lossy fallback");
  }
  if (audio.channels !== 2 || Number(audio.sample_rate) < 44100) {
    throw new Error("Lossless capture requires stereo audio at 44.1 kHz or higher");
  }
  const duration = Number(probe.format.duration);
  if (!Number.isFinite(duration) || Math.abs(duration - expectedDuration) > 0.15) {
    throw new Error(`Capture duration ${duration}s differs from requested ${expectedDuration}s`);
  }
  return audio;
}

export async function hashFile(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

function audioSampleHash(path) {
  return run("ffmpeg", [
    "-v", "error", "-i", path, "-map", "0:a:0", "-c:a", "pcm_f32le",
    "-f", "hash", "-hash", "sha256", "-",
  ]).stdout.trim();
}

export function extractLosslessAudio(source, output, duration) {
  const sourceProbe = probeMedia(source);
  const audio = assertPcmMaster(sourceProbe, duration);
  run("ffmpeg", ["-v", "error", "-n", "-i", source, "-map", "0:a:0", "-c:a", "copy", output]);
  const wavProbe = probeMedia(output);
  assertPcmMaster(wavProbe, duration);
  const sampleHash = audioSampleHash(source);
  if (sampleHash !== audioSampleHash(output)) {
    throw new Error("Extracted WAV samples differ from the recorded PCM source");
  }
  const video = sourceProbe.streams.find((stream) => stream.codec_type === "video");
  const audioStart = Number(audio.start_time);
  const videoStart = Number(video?.start_time);
  if (!Number.isFinite(audioStart) || !Number.isFinite(videoStart)) {
    throw new Error("Capture stream start timestamps are unavailable");
  }
  const startOffset = audioStart - videoStart;
  if (Math.abs(startOffset) > 0.05) {
    throw new Error(`Audio/video start offset ${startOffset}s exceeds 50 ms`);
  }
  return {
    source: sourceProbe, wav: wavProbe, decodedFloat32Sha256: sampleHash,
    audioMinusVideoStartSeconds: startOffset,
    note: "WAV starts at its first audio sample; retain the source timestamps when aligning it to video. No resampling, normalization or mastering is applied.",
  };
}
