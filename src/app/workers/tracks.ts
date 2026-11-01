import type { Input, InputAudioTrack } from 'mediabunny';

/**
 * First audio track the browser can decode. Phones add extra tracks (e.g. Apple's spatial
 * "APAC" audio) that no browser decodes, and they are not always listed after the AAC one.
 */
export async function decodableAudioTrack(input: Input): Promise<InputAudioTrack | null> {
  for (const track of await input.getAudioTracks()) {
    if (await track.canDecode()) return track;
  }
  return null;
}
