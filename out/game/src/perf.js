// FPS meter + adaptive quality: pure logic, no browser. The renderer asks for the
// current quality level each frame; the main loop feeds it real frame times.

/** Quality levels: 0 full (particles, rain, glows), 1 reduced, 2 minimal. */
export const QUALITY_NAMES = ['High', 'Medium', 'Low'];

export function createPerf() {
  let frames = 0;
  let acc = 0;
  let fps = 60;
  let quality = 0;
  let lowTimer = 0;
  let highTimer = 0;
  return {
    get fps() {
      return fps;
    },
    get quality() {
      return quality;
    },
    /** Feed one real frame time in seconds; returns the quality level to use. */
    update(dt) {
      frames += 1;
      acc += dt;
      if (acc >= 0.5) {
        fps = frames / acc;
        frames = 0;
        acc = 0;
        if (fps < 50) {
          lowTimer += 0.5;
          highTimer = 0;
          if (lowTimer >= 2 && quality < 2) {
            quality += 1;
            lowTimer = 0;
          }
        } else if (fps >= 58) {
          highTimer += 0.5;
          lowTimer = 0;
          if (highTimer >= 5 && quality > 0) {
            quality -= 1;
            highTimer = 0;
          }
        } else {
          lowTimer = 0;
          highTimer = 0;
        }
      }
      return quality;
    },
  };
}
