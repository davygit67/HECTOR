/** A browser can leave the picker unresolved. Never keep the operator stuck,
 * and stop a stream if permission arrives after this request has timed out. */
export function requestTabStream<T extends { getTracks(): { stop(): void }[] }>(request: () => Promise<T>, timeoutMs = 35000): Promise<T> {
  return new Promise((resolve, reject) => {
    let expired = false;
    const timer = setTimeout(() => {
      expired = true;
      reject(new Error('Tab sharing did not start. If no sharing prompt appeared, open this studio in Chrome or use the desktop app.'));
    }, timeoutMs);
    // Keep this call synchronous with the operator's click (browser user activation).
    try {
      void request().then(stream => {
        clearTimeout(timer);
        if (expired) stream.getTracks().forEach(track => track.stop());
        else resolve(stream);
      }, error => { clearTimeout(timer); if (!expired) reject(error); });
    } catch (error) { clearTimeout(timer); reject(error); }
  });
}

export async function startSharedVideo(video: { play(): Promise<void> }, timeoutMs = 10000) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([video.play(), new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('Sharing was allowed, but video frames did not start. Stop sharing and try again.')), timeoutMs);
    })]);
  } finally { clearTimeout(timer); }
}
