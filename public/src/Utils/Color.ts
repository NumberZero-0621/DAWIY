






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
