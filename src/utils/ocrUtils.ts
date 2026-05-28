
/**
 * Advanced image preprocessing for low-contrast laser-etched text on dark surfaces.
 */
export const preprocessForOCR = (canvas: HTMLCanvasElement) => {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return;

  const w = canvas.width;
  const h = canvas.height;
  const imageData = ctx.getImageData(0, 0, w, h);
  const data = imageData.data;

  // 1. Grayscale (Luminance)
  for (let i = 0; i < data.length; i += 4) {
    const avg = 0.299 * data[i] + 0.587 * data[i+1] + 0.114 * data[i+2];
    data[i] = data[i+1] = data[i+2] = avg;
  }

  // 2. Adaptive Local Contrast (Unsharp Masking for laser etching)
  // This helps bring out the shallow laser marks on dark plastic
  const originalData = new Uint8ClampedArray(data);
  const sharpenStrength = 2.5;
  
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const idx = (y * w + x) * 4;
      
      // Simple 3x3 Mean
      let sum = 0;
      for (let ky = -1; ky <= 1; ky++) {
        for (let kx = -1; kx <= 1; kx++) {
          sum += originalData[((y + ky) * w + (x + kx)) * 4];
        }
      }
      const mean = sum / 9;
      const current = originalData[idx];
      
      // Amplifying the high frequencies (edges)
      let val = current + (current - mean) * sharpenStrength;
      
      // Expand Dynamic Range (Stretch)
      val = (val - 50) * 1.5; 
      
      const out = Math.max(0, Math.min(255, val));
      data[idx] = data[idx+1] = data[idx+2] = out;
    }
  }

  ctx.putImageData(imageData, 0, 0);
};

/**
 * Fuzzy matching for battery production codes.
 * Standard Format: [ModelID]P[YearChar][MonthChar][DayStr][ShiftChar][Sequence][LineChar]
 * Example: 8PAE12A123B
 */
export const fuzzyDecode = (rawCode: string) => {
  if (!rawCode) return null;
  
  // Clean string
  let s = rawCode.toUpperCase().replace(/[^A-Z0-9]/g, '');
  
  // Common substitutions
  const substitutes: Record<string, string[]> = {
    'B': ['8'],
    '8': ['B'],
    '0': ['O', 'D', 'Q'],
    'O': ['0', 'D', 'Q'],
    '1': ['I', 'L', 'J'],
    'I': ['1', 'L', 'J'],
    '5': ['S'],
    'S': ['5'],
    'Z': ['2'],
    '2': ['Z']
  };

  // Re-map common errors specifically for certain positions
  // Position 1: Model ID (usually digits)
  // Position 2: 'P' (Separator)
  // Position 3: Year (A-Z)
  // Position 4: Month (A-L)
  // Position 5-6: Day (01-31)
  // Position 7: Shift (A, B, C)
  // ...

  // Try to find the 'P' anchor
  const pIndex = s.indexOf('P');
  if (pIndex === -1) {
    // Try to find a 'P' by looking for common substitutions if P is missing
    // or if 'P' was misread as 'F' or 'R'?
    // Let's assume we need a 'P' or at least a structure.
  }

  // Regex that allows common misreads at specific positions
  // [Digits] P [Letter] [Letter] [Digits] [Letter] [Digits] [Letter]
  const regex = /([0-9OBDQ]+)P([A-Z0-9])([A-Z0-9])([0-9OBDQ]{1,2})([A-Z0-9])([0-9OBDQ]+)([A-Z0-9])/;
  const match = s.match(regex);

  if (match) {
    let [full, modelId, yearChar, monthChar, dayStr, shiftChar, seqNum, lineChar] = match;

    // Helper to fix specific characters based on expected type (Letter or Digit)
    const toDigit = (str: string) => str.replace(/O/g, '0').replace(/I/g, '1').replace(/S/g, '5').replace(/Z/g, '2').replace(/B/g, '8').replace(/D/g, '0');
    const toLetter = (str: string) => str.replace(/0/g, 'O').replace(/1/g, 'I').replace(/5/g, 'S').replace(/2/g, 'Z').replace(/8/g, 'B');

    modelId = toDigit(modelId);
    yearChar = toLetter(yearChar);
    monthChar = toLetter(monthChar);
    dayStr = toDigit(dayStr);
    shiftChar = toLetter(shiftChar);
    seqNum = toDigit(seqNum);
    lineChar = toLetter(lineChar);

    return {
      modelId,
      yearChar,
      monthChar,
      day: parseInt(dayStr),
      shiftChar,
      seqNum,
      lineChar,
      rawMatch: `${modelId}P${yearChar}${monthChar}${dayStr}${shiftChar}${seqNum}${lineChar}`
    };
  }

  return null;
};
