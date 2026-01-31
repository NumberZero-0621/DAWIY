






/**



 * Gets a random color in string format.



 * @return {string} - The random color.



 * @private



 */



export function getRandomColor(): string {



  var letters = '0123456789ABCDEF';



  var color = '#';



  for (var i = 0; i < 6; i++) {



    color += letters[Math.floor(Math.random() * 16)];



  }



  return color;



}







/**



 * Lightens a hex color number by a given percentage.



 * @param color - The hex color number.



 * @param percent - The percentage to lighten (0 to 1).



 * @returns - The lightened hex color number.



 */



export function lightenColor(color: number, percent: number): number {



  const r = (color >> 16) & 0xFF;



  const g = (color >> 8) & 0xFF;



  const b = color & 0xFF;







  const newR = Math.min(255, Math.floor(r + (255 - r) * percent));



  const newG = Math.min(255, Math.floor(g + (255 - g) * percent));



  const newB = Math.min(255, Math.floor(b + (255 - b) * percent));







  return (newR << 16) | (newG << 8) | newB;



}



/**
 * Mixes two colors by a given ratio.
 * @param color1 - The first hex color number.
 * @param color2 - The second hex color number.
 * @param ratio - The ratio of the second color (0 to 1).
 * @returns - The mixed hex color number.
 */
export function mixColors(color1: number, color2: number, ratio: number): number {
  const r1 = (color1 >> 16) & 0xFF;
  const g1 = (color1 >> 8) & 0xFF;
  const b1 = color1 & 0xFF;

  const r2 = (color2 >> 16) & 0xFF;
  const g2 = (color2 >> 8) & 0xFF;
  const b2 = color2 & 0xFF;

  const r = Math.round(r1 * (1 - ratio) + r2 * ratio);
  const g = Math.round(g1 * (1 - ratio) + g2 * ratio);
  const b = Math.round(b1 * (1 - ratio) + b2 * ratio);

  return (r << 16) | (g << 8) | b;
}

/**
 * Converts formatted hex string (e.g. "#FF0000") to RGB object.
 */
export function hexToRgb(hex: string): { r: number, g: number, b: number } | null {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16)
  } : null;
}

/**
 * Converts RGB components to formatted hex string.
 */
export function rgbToHex(r: number, g: number, b: number): string {
  return "#" + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1).toUpperCase();
}

/**
 * Converts RGB to HSV.
 * r, g, b: 0-255
 * returns h: 0-360, s: 0-1, v: 0-1
 */
export function rgbToHsv(r: number, g: number, b: number): { h: number, s: number, v: number } {
  r /= 255;
  g /= 255;
  b /= 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const v = max;
  const d = max - min;
  const s = max === 0 ? 0 : d / max;
  let h = 0;

  if (max !== min) {
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      case b: h = (r - g) / d + 4; break;
    }
    h /= 6;
  }

  return { h: h * 360, s, v };
}

/**
 * Converts HSV to RGB.
 * h: 0-360, s: 0-1, v: 0-1
 * returns r, g, b: 0-255
 */
export function hsvToRgb(h: number, s: number, v: number): { r: number, g: number, b: number } {
  let r = 0, g = 0, b = 0;

  const i = Math.floor(h / 60);
  const f = h / 60 - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);

  switch (i % 6) {
    case 0: r = v; g = t; b = p; break;
    case 1: r = q; g = v; b = p; break;
    case 2: r = p; g = v; b = t; break;
    case 3: r = p; g = q; b = v; break;
    case 4: r = t; g = p; b = v; break;
    case 5: r = v; g = p; b = q; break;
  }

  return {
    r: Math.round(r * 255),
    g: Math.round(g * 255),
    b: Math.round(b * 255)
  };
}
