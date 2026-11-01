// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

// The sky behind the Liquid glass and Retrofind styles, from Retrofind (MIT, by
// the same author). Glass needs detail behind it, or it has nothing to blur.
export function paintDesktop(canvas) {
  const width = innerWidth,
    height = innerHeight;
  canvas.width = width;
  canvas.height = height;
  const c = canvas.getContext('2d');
  const sky = c.createLinearGradient(0, 0, 0, height);
  sky.addColorStop(0, '#0b4fae');
  sky.addColorStop(0.6, '#3d86d6');
  sky.addColorStop(1, '#5f9de0');
  c.fillStyle = sky;
  c.fillRect(0, 0, width, height);
  let seed = 7;
  const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const clouds = Math.max(8, Math.round((width * height) / 40000));
  for (let k = 0; k < clouds; k++) {
    const cx = random() * width,
      cy = random() * (height + 60),
      size = 40 + random() * 110;
    for (let i = 0; i < 22; i++) {
      const x = cx + (random() - 0.5) * size * 3,
        y = cy + (random() - 0.6) * size * 0.9,
        r = size * (0.35 + random() * 0.5);
      const puff = c.createRadialGradient(x, y, 0, x, y, r);
      // A firm edge gives the glass an outline to bend; Win98's clouds had one too.
      puff.addColorStop(0, '#ffffffc0');
      puff.addColorStop(0.7, '#eef4ff80');
      puff.addColorStop(0.85, '#dfe9fa30');
      puff.addColorStop(1, '#ffffff00');
      c.fillStyle = puff;
      c.beginPath();
      c.arc(x, y, r, 0, Math.PI * 2);
      c.fill();
    }
  }
}
