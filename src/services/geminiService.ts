
import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY as string });

export async function processImageWithAI(imageBase64: string, prompt: string) {
  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: {
        parts: [
          {
            inlineData: {
              data: imageBase64.split(",")[1],
              mimeType: "image/jpeg",
            },
          },
          { text: prompt },
        ],
      },
    });

    return response.text;
  } catch (error) {
    console.error("Client-side Gemini Error:", error);
    return null;
  }
}

export const OCR_PROMPT = `
ACT AS AN EXPERT INDUSTRIAL VISION SYSTEM.
Analyze this image of a battery's top cover. 
The code is LASER-ETCHED into black plastic, which makes it low-contrast.

STRUCTURE TO LOOK FOR:
- A sequence like "18PEE6A234A" or "28PED19A019B".
- Format: [ModelID]P[Year][Month][Day][Shift][Sequence][Line]
- Often located directly ABOVE a QR code.

YOUR TASK:
1. Identify the laser-etched text specifically above the QR code.
2. If text is hard to read, look at the QR code and try to decode it mentally if possible or find the clearest alphanumeric sequence.
3. Common OCR errors to fix: '8' might look like 'B', '0' might look like 'O', '1' might look like 'I'.
4. Return ONLY the code string. Example: 18PEE6A234A
`;

export const ENHANCEMENT_PROMPT = `
This is a low-contrast laser etching on black plastic. 
Identify the battery production code (e.g., 28PED19A019B).
Tell me exactly what characters you see, focusing on the line above the barcode/QR code.
`;
