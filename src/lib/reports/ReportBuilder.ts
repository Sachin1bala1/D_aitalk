import PptxGenJS from 'pptxgenjs';

// ---------------------------------------------------------------------------
// Types — discriminated union prevents unsafe index-signature casts
// ---------------------------------------------------------------------------

export type ReportSection =
  | { type: 'title_page' }
  | { type: 'executive_summary'; bullets: string[] }
  | { type: 'analysis'; title: string; chartDataUrl: string; chartId: string; findings: string; confidence: number; tools_used: string[] }
  | { type: 'data_table'; title?: string; columns: string[]; rows: unknown[][] }
  | { type: 'recommendations'; items: { priority: string; action: string }[] };

export interface ReportSpec {
  title: string;
  author: string;
  date: string;
  connectionName: string;
  sections: ReportSection[];
}

export interface AnalysisSection {
  toolName: string;
  chartId: string;
  findings: string;
  timestamp: number;
  confidence?: number;
}

export interface AnalysisSession {
  userQuestion: string;
  sections: AnalysisSection[];
  connectionName: string;
  finalText: string;
}

// ---------------------------------------------------------------------------
// XSS-safe HTML escaping for exportToPDF
// ---------------------------------------------------------------------------

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ---------------------------------------------------------------------------
// buildFromSession
// ---------------------------------------------------------------------------

export function buildFromSession(session: AnalysisSession): ReportSpec {
  const title =
    session.userQuestion.length > 80
      ? session.userQuestion.slice(0, 80)
      : session.userQuestion;

  // Executive summary: first 3 sentences from finalText
  const bullets = session.finalText
    .split('. ')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .slice(0, 3);

  const sections: ReportSection[] = [];

  // 1. Title page
  sections.push({ type: 'title_page' });

  // 2. Executive summary
  sections.push({ type: 'executive_summary', bullets });

  // 3. Analysis sections (chartDataUrl filled at export time)
  for (const section of session.sections) {
    sections.push({
      type: 'analysis',
      title: section.toolName,
      chartDataUrl: '',
      chartId: section.chartId,
      findings: section.findings,
      confidence: section.confidence ?? 0,
      tools_used: [section.toolName],
    });
  }

  // 4. Recommendations (optional)
  const recSentences = session.finalText
    .split('. ')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .filter((s) => {
      const lower = s.toLowerCase();
      return lower.includes('recommend') || lower.includes('should') || lower.includes('consider');
    });

  if (recSentences.length > 0) {
    sections.push({
      type: 'recommendations',
      items: recSentences.map((sentence) => ({ priority: 'medium', action: sentence })),
    });
  }

  return {
    title,
    author: 'DataIQ User',
    date: new Date().toLocaleDateString(),
    connectionName: session.connectionName,
    sections,
  };
}

// ---------------------------------------------------------------------------
// exportToPDF
// ---------------------------------------------------------------------------

export function exportToPDF(spec: ReportSpec): void {
  const container = document.getElementById('report-print') ?? (() => {
    const el = document.createElement('div');
    el.id = 'report-print';
    document.body.appendChild(el);
    return el;
  })();

  // Inject print style
  document.getElementById('report-print-style')?.remove();
  const style = document.createElement('style');
  style.id = 'report-print-style';
  style.textContent =
    '@media print { body > *:not(#report-print) { display:none!important } #report-print { display:block!important } }';
  document.head.appendChild(style);

  try {
    const sectionHtml = spec.sections
      .map((s) => {
        switch (s.type) {
          case 'title_page':
            return `<div class="cover"><h1>${esc(spec.title)}</h1><p>${esc(spec.author)} · ${esc(spec.date)}</p></div>`;

          case 'executive_summary':
            return `<h2>Executive Summary</h2><ul>${s.bullets.map((b) => `<li>${esc(b)}</li>`).join('')}</ul>`;

          case 'analysis': {
            const imgTag = s.chartDataUrl
              ? `<img src="${s.chartDataUrl}" style="max-width:100%" alt="${esc(s.title)} chart" />`
              : '';
            return `<h2>${esc(s.title)}</h2>${imgTag}<p>${esc(s.findings)}</p><p>Confidence: ${Math.round(s.confidence * 100)}%</p>`;
          }

          case 'data_table': {
            const title = s.title ? `<h2>${esc(s.title)}</h2>` : '';
            const headerRow = `<tr>${s.columns.map((c) => `<th>${esc(c)}</th>`).join('')}</tr>`;
            const bodyRows = s.rows
              .map((row) => `<tr>${row.map((cell) => `<td>${esc(String(cell ?? ''))}</td>`).join('')}</tr>`)
              .join('');
            return `${title}<table>${headerRow}${bodyRows}</table>`;
          }

          case 'recommendations':
            return `<h2>Recommendations</h2><ul>${s.items.map((item) => `<li><strong>${esc(item.priority)}</strong>: ${esc(item.action)}</li>`).join('')}</ul>`;
        }
      })
      .join('');

    container.innerHTML = `
      <div style="font-family:sans-serif;padding:2rem;">
        <h1>${esc(spec.title)}</h1>
        <p>${esc(spec.connectionName)} · ${esc(spec.date)}</p>
        ${sectionHtml}
      </div>
    `;

    window.print();
  } finally {
    // Always clean up after 2 seconds (even if print throws)
    setTimeout(() => {
      document.getElementById('report-print')?.remove();
      document.getElementById('report-print-style')?.remove();
    }, 2000);
  }
}

// ---------------------------------------------------------------------------
// exportToPPTX
// ---------------------------------------------------------------------------

export async function exportToPPTX(spec: ReportSpec): Promise<void> {
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE';

  const BG = '0d0d0d';
  const TEXT = 'ffffff';
  const ACCENT = '00d2ff';
  const MUTED = 'a0a0a0';

  // Slide 1 — Title slide
  const titleSlide = pptx.addSlide();
  titleSlide.background = { color: BG };
  titleSlide.addText(spec.title, {
    x: 0.5, y: 2.5, w: 12, h: 1.2,
    align: 'center', fontSize: 36, bold: true, color: ACCENT,
  });
  titleSlide.addText(`${spec.author} · ${spec.connectionName} · ${spec.date}`, {
    x: 0.5, y: 3.9, w: 12, h: 0.6,
    align: 'center', fontSize: 18, color: TEXT,
  });

  for (const s of spec.sections) {
    if (s.type === 'analysis') {
      const slide = pptx.addSlide();
      slide.background = { color: BG };
      slide.addText(s.title, { x: 0.2, y: 0.2, w: 10, h: 0.6, fontSize: 24, bold: true, color: ACCENT });

      if (s.chartDataUrl) {
        slide.addImage({ data: s.chartDataUrl, x: 0.2, y: 1, w: 5.5, h: 4 });
      }

      const findingsBullets = s.findings
        .split('. ')
        .map((t) => t.trim())
        .filter((t) => t.length > 0)
        .map((t) => ({ text: t, options: { bullet: true } }));

      slide.addText(findingsBullets, { x: 6, y: 1, w: 3.8, h: 4, fontSize: 14, color: TEXT });
      slide.addText(`Confidence: ${Math.round(s.confidence * 100)}%`, {
        x: 0.2, y: 5.2, w: 4, h: 0.4, fontSize: 12, color: MUTED,
      });
    } else if (s.type === 'recommendations') {
      const slide = pptx.addSlide();
      slide.background = { color: BG };
      slide.addText('Recommendations', { x: 0.2, y: 0.2, w: 10, h: 0.6, fontSize: 24, bold: true, color: ACCENT });

      const tableRows: PptxGenJS.TableRow[] = [
        [
          { text: 'Priority', options: { bold: true, color: ACCENT, fontSize: 13 } },
          { text: 'Action', options: { bold: true, color: ACCENT, fontSize: 13 } },
        ],
        ...s.items.map((item) => [
          { text: item.priority, options: { color: TEXT, fontSize: 13 } },
          { text: item.action, options: { color: TEXT, fontSize: 13 } },
        ]),
      ];

      slide.addTable(tableRows, {
        x: 0.2, y: 1, w: 12, colW: [2, 10],
        color: TEXT, fontSize: 13,
        border: { pt: 1, color: MUTED },
      });
    }
  }

  await pptx.writeFile({ fileName: 'DataIQ-Report.pptx' });
}
