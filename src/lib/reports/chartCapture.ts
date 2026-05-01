import html2canvas from 'html2canvas';

/**
 * Captures a DOM element by ID as a PNG data URL using html2canvas.
 * Returns an empty string on error (never throws).
 */
export async function captureChart(elementId: string): Promise<string> {
  try {
    const element = document.getElementById(elementId);
    if (!element) {
      return '';
    }
    const canvas = await html2canvas(element, { useCORS: true, logging: false });
    return canvas.toDataURL('image/png');
  } catch {
    return '';
  }
}
